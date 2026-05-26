import { describe, expect, it } from "vitest";
import { buildManifest, createDisabledShareLink, createInitialWorkspace, evaluatePackageQa } from "./dev-state";

describe("dev workspace contracts", () => {
  it("creates four deterministic candidates", () => {
    const state = createInitialWorkspace();

    expect(state.candidates).toHaveLength(4);
    expect(new Set(state.candidates.map((candidate) => candidate.strategy)).size).toBe(4);
  });

  it("blocks empty exports and includes required manifest outputs", () => {
    const state = createInitialWorkspace();
    const qa = evaluatePackageQa([]);
    const manifest = buildManifest(state.activeProjectId, []);

    expect(qa.some((finding) => finding.severity === "block")).toBe(true);
    expect(manifest.required_outputs).toEqual(["manifest.json", "qa-report.json", "provenance.json", "assets/"]);
  });

  it("models local alpha share links as disabled and private", () => {
    const shareLink = createDisabledShareLink("export-001", 0);

    expect(shareLink.status).toBe("disabled");
    expect(shareLink.access).toBe("private");
    expect(shareLink.reason).toContain("disabled in local alpha");
  });
});
