import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevZenArtClient } from "./api-client";
import { ExportRecord } from "./contracts";
import {
  buildDownloadableExportZipPayloadNames,
  buildExportZipPayloadSmokeEvidence,
  buildExportWorkflowMetadataPayload,
  ecommerceGrowthWorkflowAcceptance,
  isSafeExportZipPayloadName,
  requiredExportPackageOutputs
} from "./dev-state";
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
    const acceptedDocument = await client.attachReference({ name: "launch-brief.pdf", kind: "document" });
    const acceptedUrl = await client.attachReference({ name: "https://assets.example.com/reference-pack", kind: "url" });
    const rejectedHttpUrl = await client.attachReference({ name: "http://assets.example.com/reference-pack", kind: "url" });
    await client.selectCandidate("cand-studio");
    await client.addPackageItem("cand-studio");
    await client.addPackageItem("ref-campaign-reference-webp");
    await client.addPackageItem("ref-launch-brief-pdf");
    const packaged = await client.addPackageItem("ref-https-assets-example-com-reference-pack");
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
    expect(acceptedDocument.brief.references.at(-1)).toMatchObject({
      id: "ref-launch-brief-pdf",
      kind: "document",
      validation: {
        state: "accepted"
      }
    });
    expect(acceptedUrl.brief.references.at(-1)).toMatchObject({
      id: "ref-https-assets-example-com-reference-pack",
      kind: "url",
      validation: {
        state: "accepted"
      }
    });
    expect(rejectedHttpUrl.brief.references.at(-1)).toMatchObject({
      kind: "url",
      validation: {
        state: "rejected",
        reason: "Reference URLs must use HTTPS."
      }
    });
    expect(packaged.packageItems).toHaveLength(4);
    expect(record).toMatchObject({
      format: "zip",
      status: "ready",
      fileName: "zenart-001.zip"
    });
    expect(record.manifest.required_outputs).toEqual(
      expect.arrayContaining([
        ...requiredExportPackageOutputs,
        ...ecommerceGrowthWorkflowAcceptance.required_files
      ])
    );

    const zipBlob = await buildExportPackageBlob(record);
    const zip = await JSZip.loadAsync(await readBlobAsArrayBuffer(zipBlob));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as ExportRecord["manifest"];
    const qaReport = JSON.parse(await zip.file("qa-report.json")!.async("string")) as ExportRecord["qaReport"];
    const safetyReport = JSON.parse(await zip.file("safety-policy-report.json")!.async("string")) as ExportRecord["safetyReport"];
    const aiContentDisclaimer = JSON.parse(await zip.file("ai-content-disclaimer.json")!.async("string")) as {
      schema_version: string;
      export_id: string;
      package_id: string;
      project_id: string;
      generation_mode: string;
      workflow_id: string;
      provider: string;
      model: string;
      prompt_spec: string[];
      skill: string;
      responsibility_notice: string;
      policy_routes: string[];
      safety_status: string;
    };
    const pptReadyMetadata = JSON.parse(await zip.file("ppt-ready-metadata.json")!.async("string")) as ExportRecord["manifest"]["ppt_ready_metadata"];
    const provenance = JSON.parse(await zip.file("provenance.json")!.async("string")) as {
      export_id: string;
      package_id: string;
      project_id: string;
      generated_by: string;
      workflow_id: string;
      provider: string;
      model: string;
      prompt_spec: string[];
      skill: string;
      safety: string;
      items: Array<{ id: string; provenance: string }>;
    };
    const workflowAsset = JSON.parse(await zip.file("assets/square_social_ad.png")!.async("string")) as {
      output_name: string;
      workflow_id: string;
    };
    const workflowMetadata = JSON.parse(await zip.file("metadata.json")!.async("string")) as {
      export_id: string;
      package_id: string;
      project_id: string;
      output_name: string;
      workflow_id: string;
      workflow_fixture_id: string;
      provider: string;
      model: string;
      prompt_spec: string[];
      skill: string;
      safety: string;
    };
    const traceProvenance = JSON.parse(await zip.file("trace_provenance.json")!.async("string")) as {
      export_id: string;
      package_id: string;
      project_id: string;
      output_name: string;
      workflow_id: string;
      provider: string;
      model: string;
      prompt_spec: string[];
      skill: string;
      safety: string;
    };
    const readme = await zip.file("assets/README.txt")!.async("string");
    const expectedPayloadNames = buildDownloadableExportZipPayloadNames(record);

    for (const payloadName of expectedPayloadNames) {
      expect(zip.file(payloadName), `ZIP payload ${payloadName} should exist`).toBeTruthy();
    }
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
      },
      {
        id: "pkg-item-003",
        title: "launch-brief.pdf",
        type: "reference",
        provenance: "dev-client-reference:ref-launch-brief-pdf"
      },
      {
        id: "pkg-item-004",
        title: "https://assets.example.com/reference-pack",
        type: "reference",
        provenance: "dev-client-reference:ref-https-assets-example-com-reference-pack"
      }
    ]);
    const campaignReferenceItem = manifest.items.find((item) => item.provenance === "dev-client-reference:ref-campaign-reference-webp");
    expect(campaignReferenceItem).toEqual({
      id: "pkg-item-002",
      title: "campaign-reference.webp",
      type: "reference",
      provenance: "dev-client-reference:ref-campaign-reference-webp"
    });
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
    expect(aiContentDisclaimer).toMatchObject({
      schema_version: "stage0.rev2.ai-content-disclaimer",
      export_id: record.id,
      package_id: record.manifest.package_id,
      project_id: record.manifest.project_id,
      generation_mode: "deterministic-local-alpha",
      workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id,
      provider: "dev-provider",
      model: "deterministic-local-alpha",
      prompt_spec: ["social_proof"],
      skill: ecommerceGrowthWorkflowAcceptance.workflow_id,
      responsibility_notice: expect.stringContaining("Review rights, claims, likeness, and brand usage"),
      policy_routes: ["/legal/terms", "/legal/acceptable-use", "/legal/ip-complaints"],
      safety_status: "pass"
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
        },
        {
          id: "slide-03",
          source_item_id: "pkg-item-003",
          title: "launch-brief.pdf",
          layout: "asset-grid"
        },
        {
          id: "slide-04",
          source_item_id: "pkg-item-004",
          title: "https://assets.example.com/reference-pack",
          layout: "asset-grid"
        }
      ]
    });
    expect(pptReadyMetadata.slides.find((slide) => slide.source_item_id === campaignReferenceItem?.id)).toMatchObject({
      title: "campaign-reference.webp",
      layout: "asset-grid"
    });
    expect(provenance).toMatchObject({
      export_id: record.id,
      package_id: record.manifest.package_id,
      project_id: record.manifest.project_id,
      generated_by: "zenart-web-dev-client",
      workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id,
      provider: "dev-provider",
      model: "deterministic-local-alpha",
      prompt_spec: ["social_proof"],
      skill: ecommerceGrowthWorkflowAcceptance.workflow_id,
      safety: "pass",
      items: [
        { id: "pkg-item-001", provenance: "dev-client:cand-studio" },
        { id: "pkg-item-002", provenance: "dev-client-reference:ref-campaign-reference-webp" },
        { id: "pkg-item-003", provenance: "dev-client-reference:ref-launch-brief-pdf" },
        { id: "pkg-item-004", provenance: "dev-client-reference:ref-https-assets-example-com-reference-pack" }
      ]
    });
    expect(workflowAsset).toMatchObject({
      output_name: "assets/square_social_ad.png",
      workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id
    });
    expect(workflowMetadata).toMatchObject({
      ...buildExportWorkflowMetadataPayload(record, "metadata.json"),
      output_name: "metadata.json",
      workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id,
      workflow_fixture_id: ecommerceGrowthWorkflowAcceptance.fixture_id,
      provider: "dev-provider",
      model: "deterministic-local-alpha",
      prompt_spec: ["social_proof"],
      skill: ecommerceGrowthWorkflowAcceptance.workflow_id,
      safety: "pass"
    });
    expect(traceProvenance).toMatchObject({
      ...buildExportWorkflowMetadataPayload(record, "trace_provenance.json"),
      output_name: "trace_provenance.json",
      workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id,
      provider: "dev-provider",
      model: "deterministic-local-alpha",
      prompt_spec: ["social_proof"],
      skill: ecommerceGrowthWorkflowAcceptance.workflow_id,
      safety: "pass"
    });
    const identityPayloads = [provenance, aiContentDisclaimer, workflowMetadata, traceProvenance];
    for (const payload of identityPayloads) {
      expect(payload.export_id).toBe(record.id);
      expect(payload.package_id).toBe(record.manifest.package_id);
      expect(payload.project_id).toBe(record.manifest.project_id);
      expect(payload.workflow_id).toBe(ecommerceGrowthWorkflowAcceptance.workflow_id);
      expect(payload.provider).toBe("dev-provider");
      expect(payload.model).toBe("deterministic-local-alpha");
      expect(payload.prompt_spec).toEqual(["social_proof"]);
      expect(payload.skill).toBe(ecommerceGrowthWorkflowAcceptance.workflow_id);
    }
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

  it("rejects unsafe manifest ZIP payload paths before browser download generation", async () => {
    const client = makeClient();
    await client.selectCandidate("cand-studio");
    await client.addPackageItem("cand-studio");
    const exported = await client.createExport("zip");
    const record = structuredClone(exported.exports[0]) as ExportRecord;
    record.manifest.required_outputs = [
      ...record.manifest.required_outputs,
      "../evil.json",
      "/absolute.json",
      "nested/../evil.json",
      "https://assets.example.com/evil.json",
      "folder/"
    ];

    const payloadNames = buildDownloadableExportZipPayloadNames(record);
    const zipPayloadSmoke = buildExportZipPayloadSmokeEvidence(record);

    expect(payloadNames.every(isSafeExportZipPayloadName)).toBe(true);
    expect(payloadNames).not.toEqual(expect.arrayContaining(["../evil.json", "/absolute.json", "nested/../evil.json"]));
    expect(zipPayloadSmoke.status).toBe("fail");
    expect(zipPayloadSmoke.failures).toContain("unsafe-payload-name");
    expect(zipPayloadSmoke.unsafeManifestPayloadNames).toEqual([
      "../evil.json",
      "/absolute.json",
      "nested/../evil.json",
      "https://assets.example.com/evil.json",
      "folder/"
    ]);
    expect(zipPayloadSmoke.unsafeExpectedPayloadNames).toEqual([]);
    await expect(buildExportPackageBlob(record)).rejects.toThrow("Unsafe export ZIP payload name: ../evil.json");
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
