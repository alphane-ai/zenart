"use client";

import JSZip from "jszip";
import { ExportRecord } from "./contracts";

export const buildExportPackageBlob = async (record: ExportRecord) => {
  if (record.format === "pdf-placeholder") {
    const body = [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj",
      "4 0 obj << /Length 86 >> stream",
      "BT /F1 18 Tf 72 720 Td (ZenArt PDF placeholder export) Tj 0 -28 Td (Manifest and QA are available in ZIP export.) Tj ET",
      "endstream endobj",
      "xref",
      "0 5",
      "0000000000 65535 f ",
      "trailer << /Root 1 0 R /Size 5 >>",
      "startxref",
      "0",
      "%%EOF"
    ].join("\n");
    return new Blob([body], { type: "application/pdf" });
  }

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(record.manifest, null, 2));
  zip.file("qa-report.json", JSON.stringify(record.qaReport, null, 2));
  zip.file("safety-policy-report.json", JSON.stringify(record.safetyReport, null, 2));
  zip.file("ppt-ready-metadata.json", JSON.stringify(record.manifest.ppt_ready_metadata, null, 2));
  zip.file(
    "provenance.json",
    JSON.stringify(
      {
        export_id: record.id,
        generated_by: "zenart-web-dev-client",
        items: record.manifest.items.map((item) => ({
          id: item.id,
          provenance: item.provenance
        }))
      },
      null,
      2
    )
  );
  zip.file(
    "assets/README.txt",
    "Deterministic local alpha export placeholder. Replace with object-storage asset references in backend export builder."
  );

  return zip.generateAsync({ type: "blob" });
};

export const downloadExportPackage = async (record: ExportRecord) => {
  downloadBlob(await buildExportPackageBlob(record), record.fileName);
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
