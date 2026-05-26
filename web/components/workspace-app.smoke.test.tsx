import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkspaceApp } from "./workspace-app";

describe("WorkspaceApp user route integration smoke", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders secure-cookie and same-site CSRF session UX evidence as an interactive client contract", async () => {
    const { container } = render(<WorkspaceApp initialView="account" />);

    await screen.findByRole("heading", { name: "Account Settings" });

    const sessionContract = screen.getByLabelText("Auth and session status");
    expect(sessionContract).toHaveAttribute("data-session-security-evidence", "stage0.rev2.session-csrf-client-evidence");
    expect(sessionContract).toHaveAttribute("data-session-security-status", "pass");
    expect(sessionContract).toHaveAttribute("data-session-cookie-name", "__Host-zenart_session");
    expect(sessionContract).toHaveAttribute("data-session-cookie-http-only", "true");
    expect(sessionContract).toHaveAttribute("data-session-cookie-secure", "true");
    expect(sessionContract).toHaveAttribute("data-session-cookie-same-site", "lax");
    expect(sessionContract).toHaveAttribute("data-session-cookie-path", "/");
    expect(sessionContract).toHaveAttribute("data-session-csrf-header", "X-ZenArt-CSRF");
    expect(sessionContract).toHaveAttribute("data-session-csrf-origin-policy", "same-site-only");
    expect(sessionContract).toHaveAttribute("data-session-csrf-missing-operation-count", "0");

    const csrfInventory = screen.getByLabelText("Generated web API CSRF operation inventory");
    expect(csrfInventory).toHaveAttribute("data-csrf-operation-count", "15");
    expect(csrfInventory).toHaveTextContent("createUpload");
    expect(csrfInventory).toHaveTextContent("createExport");
    expect(csrfInventory).toHaveTextContent("createSupportTicket");

    fireEvent.click(screen.getByRole("button", { name: "Expire" }));
    await screen.findByText("Session expired. Refresh or sign in to continue.");
    expect(container.querySelector(".session-pill")).toHaveTextContent("expired");
    expect(screen.getByRole("button", { name: "Refresh Session" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dev@zenart.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Auth and session status")).toHaveAttribute("data-session-security-status", "pass");
    });
    expect(screen.queryByText("Session expired. Refresh or sign in to continue.")).not.toBeInTheDocument();
    expect(container.querySelector(".session-pill")).toHaveTextContent("authenticated");
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

    await waitFor(() => {
      const smoke = container.querySelector("[data-reference-upload-integration-smoke='stage0.rev2.reference-upload-integration-smoke']");
      expect(smoke).toHaveAttribute("data-reference-upload-integration-status", "pass");
      expect(smoke).toHaveAttribute("data-reference-accepted-kinds", "image");
      expect(smoke).toHaveAttribute("data-reference-rejected-count", "0");
      expect(smoke).toHaveAttribute("data-reference-package-history-count", "1");
      expect(smoke).toHaveAttribute("data-reference-ready-export-count", "1");
      expect(smoke).toHaveAttribute("data-reference-provenance-count", "1");
      expect(smoke).toHaveAttribute("data-reference-ppt-asset-grid-slide-count", "1");
      expect(smoke).toHaveAttribute("data-reference-upload-integration-failures", "");
    });

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
    expect(metadataEvidence?.getAttribute("data-package-export-zip-payloads")).toContain("safety-policy-report.json");
    expect(metadataEvidence?.getAttribute("data-package-export-zip-payloads")).toContain("ppt-ready-metadata.json");

    const safetyPolicy = container.querySelector("[data-safety-policy-export='stage0.rev2.safety-policy-export']");
    expect(safetyPolicy).toHaveAttribute("data-safety-policy-status", "pass");
    expect(safetyPolicy).toHaveAttribute("data-safety-policy-stage-count", "5");
    expect(safetyPolicy).toHaveAttribute("data-safety-policy-finding-count", "0");
  });

  it("keeps workspace rendering inside the smoke budget across the interactive canvas flow", async () => {
    const { container } = render(<WorkspaceApp initialView="workspace" />);

    await screen.findByRole("heading", { name: "Launch Direction Board" });

    const assertRenderingBudget = (expectedSteps: string[]) => {
      const canvas = container.querySelector("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
      const summary = screen.getByLabelText("Workspace rendering performance smoke");

      expect(canvas).toHaveAttribute("data-rendering-status", "pass");
      expect(canvas).toHaveAttribute("data-render-failure-count", "0");
      expect(Number(canvas?.getAttribute("data-render-element-count"))).toBeLessThanOrEqual(
        Number(canvas?.getAttribute("data-render-max-elements"))
      );
      expect(Number(canvas?.getAttribute("data-render-estimated-interaction-ms"))).toBeLessThanOrEqual(
        Number(canvas?.getAttribute("data-render-max-interaction-ms"))
      );
      for (const step of expectedSteps) {
        expect(canvas?.getAttribute("data-render-interaction-steps")).toContain(step);
        expect(summary.getAttribute("data-rendering-interaction-steps")).toContain(step);
      }
    };

    assertRenderingBudget(["load"]);

    fireEvent.click(screen.getByRole("button", { name: "Confirm Brief" }));
    await waitFor(() => {
      expect(screen.getByText("Brief confirmed. I generated four deterministic strategy candidates for review.")).toBeInTheDocument();
    });
    assertRenderingBudget(["brief-confirm"]);

    fireEvent.click(screen.getByRole("button", { name: "Select Studio System" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select Studio System" })).toHaveAttribute("aria-pressed", "true");
    });
    assertRenderingBudget(["candidate-select"]);

    fireEvent.change(screen.getByLabelText("Iteration instruction"), {
      target: { value: "Make the production handoff states more explicit." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Iterate" }));
    await screen.findByText("Studio System refined with: Make the production handoff states more explicit.");
    assertRenderingBudget(["iteration"]);

    fireEvent.click(screen.getByRole("button", { name: "Add Selection" }));
    await waitFor(() => {
      expect(screen.getAllByText("Studio System").length).toBeGreaterThanOrEqual(3);
    });
    assertRenderingBudget(["package-add"]);

    fireEvent.click(screen.getByRole("button", { name: "Export ZIP" }));
    await screen.findByText("zenart-001.zip");
    assertRenderingBudget(["export-ready"]);

    fireEvent.click(screen.getByRole("button", { name: "Initial brief" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Initial brief" })).toHaveAttribute("aria-pressed", "true");
    });
    assertRenderingBudget(["version-restore"]);
  });
});
