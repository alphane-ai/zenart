import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevZenArtClient } from "./api-client";
import { ExportRecord } from "./contracts";
import { buildExportPackageBlob, downloadExportPackage } from "./export-download";

const makeClient = () => new DevZenArtClient();

const readBlobAsArrayBuffer = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as ArrayBuffer));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });

const readBlobAsText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });

describe("reference upload and export download integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("smokes reference validation through ready ZIP export contents and browser download handoff", async () => {
    const client = makeClient();

    const rejectedReference = await client.attachReference({ name: "unsafe-reference.exe", kind: "image" });
    const acceptedReference = await client.attachReference({ name: "campaign-reference.webp", kind: "image" });
    await client.selectCandidate("cand-studio");
    await client.addPackageItem("cand-studio");
    const packaged = await client.addPackageItem("ref-campaign-reference-webp");
    const exported = await client.createExport("zip");
    const record = exported.exports[0];

    expect(rejectedReference.brief.references.at(-1)).toMatchObject({
      status: "queued",
      validation: {
        state: "rejected"
      }
    });
    expect(acceptedReference.brief.references.at(-1)).toMatchObject({
      id: "ref-campaign-reference-webp",
      status: "attached",
      validation: {
        state: "accepted"
      }
    });
    expect(packaged.packageItems).toHaveLength(2);
    expect(record).toMatchObject({
      format: "zip",
      status: "ready",
      fileName: "zenart-001.zip"
    });
    expect(record.manifest.required_outputs).toEqual([
      "manifest.json",
      "qa-report.json",
      "safety-policy-report.json",
      "provenance.json",
      "ppt-ready-metadata.json",
      "assets/"
    ]);

    const zipBlob = await buildExportPackageBlob(record);
    const zip = await JSZip.loadAsync(await readBlobAsArrayBuffer(zipBlob));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as ExportRecord["manifest"];
    const qaReport = JSON.parse(await zip.file("qa-report.json")!.async("string")) as ExportRecord["qaReport"];
    const safetyReport = JSON.parse(await zip.file("safety-policy-report.json")!.async("string")) as ExportRecord["safetyReport"];
    const pptReadyMetadata = JSON.parse(await zip.file("ppt-ready-metadata.json")!.async("string")) as ExportRecord["manifest"]["ppt_ready_metadata"];
    const provenance = JSON.parse(await zip.file("provenance.json")!.async("string")) as {
      export_id: string;
      generated_by: string;
      items: Array<{ id: string; provenance: string }>;
    };
    const readme = await zip.file("assets/README.txt")!.async("string");

    expect(manifest.items).toEqual([
      {
        id: "pkg-item-001",
        title: "Studio System",
        type: "candidate",
        provenance: "dev-client:cand-studio"
      },
      {
        id: "pkg-item-002",
        title: "campaign-reference.webp",
        type: "reference",
        provenance: "dev-client-reference:ref-campaign-reference-webp"
      }
    ]);
    expect(qaReport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "qa-manifest",
          severity: "pass"
        }),
        expect.objectContaining({
          id: "qa-candidate",
          severity: "pass"
        })
      ])
    );
    expect(safetyReport).toEqual({
      schema_version: "stage0.rev2.safety-policy-export",
      status: "pass",
      enforcementStages: ["brief", "provider_request", "provider_response", "qa", "export"],
      findings: []
    });
    expect(pptReadyMetadata).toMatchObject({
      schema_version: "stage0.rev2.ppt-ready-metadata",
      aspect_ratio: "16:9",
      canvas_size: {
        width: 1920,
        height: 1080
      },
      safe_area: {
        top: 72,
        right: 96,
        bottom: 72,
        left: 96
      },
      theme: {
        accent: "#2563eb"
      },
      slides: [
        {
          id: "slide-01",
          source_item_id: "pkg-item-001",
          title: "Studio System",
          layout: "title-and-asset"
        },
        {
          id: "slide-02",
          source_item_id: "pkg-item-002",
          title: "campaign-reference.webp",
          layout: "asset-grid"
        }
      ]
    });
    expect(provenance).toMatchObject({
      export_id: record.id,
      generated_by: "zenart-web-dev-client",
      items: [
        { id: "pkg-item-001", provenance: "dev-client:cand-studio" },
        { id: "pkg-item-002", provenance: "dev-client-reference:ref-campaign-reference-webp" }
      ]
    });
    expect(readme).toContain("Deterministic local alpha export placeholder");

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:zenart-export")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
    const createObjectUrl = vi.mocked(URL.createObjectURL);
    const revokeObjectUrl = vi.mocked(URL.revokeObjectURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await downloadExportPackage(record);

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:zenart-export");
  });

  it("builds the PDF placeholder download contract with a PDF blob and deterministic filename", async () => {
    const client = makeClient();
    await client.selectCandidate("cand-utility");
    await client.addPackageItem("cand-utility");

    const exported = await client.createExport("pdf-placeholder");
    const record = exported.exports[0];
    const blob = await buildExportPackageBlob(record);
    const body = await readBlobAsText(blob);

    expect(record).toMatchObject({
      format: "pdf-placeholder",
      status: "ready",
      fileName: "zenart-001.pdf"
    });
    expect(blob.type).toBe("application/pdf");
    expect(body).toContain("%PDF-1.4");
    expect(body).toContain("ZenArt PDF placeholder export");
  });
});
