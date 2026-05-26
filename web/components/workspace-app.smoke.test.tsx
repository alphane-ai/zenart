import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkspaceApp } from "./workspace-app";

describe("WorkspaceApp user route integration smoke", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("drives an accepted reference through package history, ZIP export, and export metadata UI evidence", async () => {
    const { container, rerender } = render(<WorkspaceApp initialView="workspace" />);

    await screen.findByRole("heading", { name: "Launch Direction Board" });

    const referenceName = screen.getByLabelText("Reference asset name or URL");
    fireEvent.change(referenceName, { target: { value: "campaign-reference.webp" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    const referenceSmoke = await waitFor(() => {
      const smoke = container.querySelector("[data-reference-export-smoke='reference-upload-to-ready-zip-export']");
      expect(smoke).toHaveAttribute("data-reference-accepted-count", "2");
      return smoke as HTMLElement;
    });
    expect(referenceSmoke).toHaveAttribute("data-reference-packaged-count", "0");

    fireEvent.click(await screen.findByRole("button", { name: "Add reference campaign-reference.webp to package" }));
    await waitFor(() => {
      expect(container.querySelector("[data-reference-export-smoke='reference-upload-to-ready-zip-export']")).toHaveAttribute(
        "data-reference-packaged-count",
        "1"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Select Studio System" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select Studio System" })).toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Selection" }));
    await waitFor(() => {
      expect(screen.getAllByText("Studio System").length).toBeGreaterThanOrEqual(3);
    });

    fireEvent.click(screen.getByRole("button", { name: "Export ZIP" }));
    await screen.findByText("zenart-001.zip");

    const renderingSmoke = container.querySelector("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
    expect(renderingSmoke).toHaveAttribute("data-rendering-status", "pass");
    expect(Number(renderingSmoke?.getAttribute("data-render-element-count"))).toBeLessThanOrEqual(
      Number(renderingSmoke?.getAttribute("data-render-max-elements"))
    );

    rerender(<WorkspaceApp initialView="export" />);

    await screen.findByRole("heading", { name: "Export Preview" });
    const referenceContract = container.querySelector(
      "[data-reference-upload-export-contract='reference-upload-to-ready-zip-export']"
    );
    expect(referenceContract).toHaveAttribute("data-reference-provenance-count", "1");
    expect(within(referenceContract as HTMLElement).getByText("dev-client-reference:ref-campaign-reference-webp")).toBeInTheDocument();

    const metadataEvidence = container.querySelector(
      "[data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui']"
    );
    expect(metadataEvidence).toHaveAttribute("data-package-export-metadata-status", "pass");
    expect(metadataEvidence).toHaveAttribute("data-package-export-missing-output-count", "0");
    expect(metadataEvidence).toHaveAttribute("data-package-export-provenance-count", "2");
    expect(metadataEvidence).toHaveAttribute("data-package-export-blocking-qa-count", "0");
    expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-slide-count", "2");
    expect(metadataEvidence?.getAttribute("data-package-export-zip-payloads")).toContain("ppt-ready-metadata.json");
  });
});
