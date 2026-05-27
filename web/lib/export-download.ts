"use client";

import JSZip from "jszip";
import { ExportRecord } from "./contracts";
import {
  buildExportZipPayloadEntries
} from "./dev-state";

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
  for (const entry of buildExportZipPayloadEntries(record)) {
    zip.file(entry.name, entry.body);
  }

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
