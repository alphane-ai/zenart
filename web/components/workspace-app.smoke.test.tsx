import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import userRouteSmoke from "../validation/user-routes-smoke.json";
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
    expect(sessionContract).toHaveAttribute("data-session-cookie-failure-count", "0");
    expect(sessionContract).toHaveAttribute("data-session-cookie-failure-reasons", "");
    expect(sessionContract).toHaveAttribute("data-session-csrf-failure-count", "0");
    expect(sessionContract).toHaveAttribute("data-session-csrf-failure-reasons", "");

    const csrfInventory = screen.getByLabelText("Generated web API CSRF operation inventory");
    expect(csrfInventory).toHaveAttribute("data-csrf-operation-count", "15");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-contract", "stage0.rev2.generated-api-csrf-contract");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-status", "pass");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-credential-mode", "include");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-header", "X-ZenArt-CSRF");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-header-value", "same-site-origin-check");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-origin-policy", "same-site-only");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-unsafe-operation-count", "15");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-safe-operation-count", "17");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-missing-unsafe-operation-count", "0");
    expect(csrfInventory).toHaveAttribute("data-generated-api-csrf-failure-count", "0");
    expect(csrfInventory.getAttribute("data-generated-api-csrf-operation-contracts")).toContain(
      "createUpload:POST:include:X-ZenArt-CSRF:true"
    );
    expect(csrfInventory.getAttribute("data-generated-api-csrf-operation-contracts")).toContain(
      "deleteSession:DELETE:include:X-ZenArt-CSRF:false"
    );
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

    const referenceValidationMatrix = screen.getByLabelText("Reference upload validation matrix");
    expect(referenceValidationMatrix).toHaveAttribute(
      "data-reference-upload-validation-matrix",
      "stage0.rev2.reference-upload-validation-matrix"
    );
    expect(referenceValidationMatrix).toHaveAttribute("data-reference-upload-validation-status", "pass");
    expect(referenceValidationMatrix).toHaveAttribute(
      "data-reference-upload-validation-scenario",
      "safe-image-document-https-url-reject-unsupported"
    );
    expect(referenceValidationMatrix).toHaveAttribute("data-reference-upload-validation-accepted-kinds", "image,document,url");
    expect(referenceValidationMatrix).toHaveAttribute("data-reference-upload-validation-expected-kinds", "image,document,url");
    expect(referenceValidationMatrix).toHaveAttribute("data-reference-upload-validation-rejected-count", "2");
    expect(referenceValidationMatrix).toHaveAttribute("data-reference-upload-validation-expected-rejected-count", "2");
    expect(referenceValidationMatrix).toHaveAttribute("data-reference-upload-validation-failures", "");
    expect(referenceValidationMatrix.getAttribute("data-reference-upload-validation-accepted-samples")).toContain(
      "accepted-product-angle.webp"
    );
    expect(referenceValidationMatrix.getAttribute("data-reference-upload-validation-accepted-samples")).toContain("launch-brief.pdf");
    expect(referenceValidationMatrix.getAttribute("data-reference-upload-validation-accepted-samples")).toContain(
      "https://assets.example.com/reference-pack"
    );
    expect(referenceValidationMatrix.getAttribute("data-reference-upload-validation-rejected-samples")).toContain("unsafe-reference.exe");
    expect(referenceValidationMatrix.getAttribute("data-reference-upload-validation-rejected-samples")).toContain(
      "http://assets.example.com/reference-pack"
    );

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
      expect(smoke).toHaveAttribute("data-reference-upload-integration-operation-count", "4");
      expect(smoke).toHaveAttribute("data-reference-upload-integration-operations", "createUpload,createPackage,createExport,getExport");
      expect(smoke).toHaveAttribute("data-reference-accepted-kinds", "image");
      expect(smoke).toHaveAttribute("data-reference-rejected-count", "0");
      expect(smoke).toHaveAttribute("data-reference-latest-accepted-id", "ref-campaign-reference-webp");
      expect(smoke).toHaveAttribute("data-reference-latest-accepted-name", "campaign-reference.webp");
      expect(smoke).toHaveAttribute("data-reference-latest-packaged", "true");
      expect(smoke).toHaveAttribute("data-reference-latest-provenance-present", "true");
      expect(smoke).toHaveAttribute("data-reference-latest-ppt-slide-present", "true");
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
    expect(metadataEvidence).toHaveAttribute("data-package-export-id", "export-001");
    expect(metadataEvidence).toHaveAttribute("data-package-export-package-id", "pkg-002");
    expect(metadataEvidence).toHaveAttribute("data-package-export-project-id", "project-001");
    expect(metadataEvidence).toHaveAttribute("data-package-export-manifest-item-count", "2");
    expect(metadataEvidence).toHaveAttribute("data-package-export-manifest-required-output-count", "13");
    expect(metadataEvidence).toHaveAttribute("data-package-export-download-artifact-status", "pass");
    expect(metadataEvidence).toHaveAttribute("data-package-export-download-artifact-format", "zip");
    expect(metadataEvidence).toHaveAttribute("data-package-export-item-types", "reference,candidate");
    expect(metadataEvidence).toHaveAttribute("data-package-export-missing-output-count", "0");
    expect(metadataEvidence).toHaveAttribute("data-package-export-missing-zip-payload-count", "0");
    expect(metadataEvidence).toHaveAttribute("data-package-export-provenance-count", "2");
    expect(metadataEvidence).toHaveAttribute("data-package-export-blocking-qa-count", "0");
    expect(metadataEvidence).toHaveAttribute("data-package-export-safety-status", "pass");
    expect(metadataEvidence).toHaveAttribute("data-package-export-safety-stage-count", "5");
    expect(metadataEvidence).toHaveAttribute("data-package-export-safety-finding-count", "0");
    expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-aspect-ratio", "16:9");
    expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-slide-count", "2");
    expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-canvas-size", "1920x1080");
    expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-safe-area", "72/96/72/96");
    expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-theme-font", "Inter, Arial, sans-serif");
    expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-handoff-checklist-count", "5");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-id", "ecommerce_growth_pack");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-fixture-id", "fx_ecommerce_growth_golden");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-taxonomy-count", "1");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-required-file-count", "8");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-metadata-payload-present", "true");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-trace-provenance-payload-present", "true");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-provider-metadata-present", "true");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-prompt-spec-metadata-present", "true");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-skill-metadata-present", "true");
    expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-safety-metadata-present", "true");
    expect(Number(metadataEvidence?.getAttribute("data-package-export-zip-payload-count"))).toBeGreaterThanOrEqual(6);
    expect(metadataEvidence?.getAttribute("data-package-export-zip-payloads")).toContain("safety-policy-report.json");
    expect(metadataEvidence?.getAttribute("data-package-export-zip-payloads")).toContain("ppt-ready-metadata.json");
    expect(metadataEvidence?.getAttribute("data-package-export-zip-payloads")).toContain("metadata.json");
    expect(metadataEvidence?.getAttribute("data-package-export-zip-payloads")).toContain("trace_provenance.json");
    expect(metadataEvidence?.getAttribute("data-package-export-required-zip-payloads")).toContain("manifest.json");
    expect(metadataEvidence?.getAttribute("data-package-export-required-zip-payloads")).toContain("assets/README.txt");

    const safetyPolicy = container.querySelector("[data-safety-policy-export='stage0.rev2.safety-policy-export']");
    expect(safetyPolicy).toHaveAttribute("data-safety-policy-status", "pass");
    expect(safetyPolicy).toHaveAttribute("data-safety-policy-stage-count", "5");
    expect(safetyPolicy).toHaveAttribute("data-safety-policy-finding-count", "0");
  });

  it("exposes user-web brief, upload, and confirmation runtime evidence before export", async () => {
    const { container } = render(<WorkspaceApp initialView="workspace" />);

    await screen.findByRole("heading", { name: "Launch Direction Board" });

    const initialEvidence = screen.getByLabelText("Brief upload confirmation runtime evidence");
    expect(initialEvidence).toHaveAttribute(
      "data-brief-upload-confirmation-runtime-evidence",
      "stage0.rev2.brief-upload-confirmation-runtime-evidence"
    );
    expect(initialEvidence).toHaveAttribute("data-brief-upload-confirmation-status", "fail");
    expect(initialEvidence).toHaveAttribute("data-brief-upload-confirmation-gate-impact", "user-web-evidence-only");
    expect(initialEvidence).toHaveAttribute(
      "data-brief-upload-confirmation-failures",
      "brief-confirmed,missing-info-cleared,confirmation-message"
    );

    fireEvent.change(screen.getByLabelText("Brief"), {
      target: {
        value:
          "Create an ecommerce launch package for the Aurora bottle with a packshot reference, shopper audience, and web/social export surfaces."
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Brief" }));
    await screen.findByText("Brief confirmed. I generated four deterministic strategy candidates for review.");

    fireEvent.change(screen.getByLabelText("Reference asset name or URL"), { target: { value: "aurora-packshot.webp" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    await waitFor(() => {
      const evidence = container.querySelector(
        "[data-brief-upload-confirmation-runtime-evidence='stage0.rev2.brief-upload-confirmation-runtime-evidence']"
      );
      expect(evidence).toHaveAttribute("data-brief-upload-confirmation-status", "pass");
      expect(evidence).toHaveAttribute("data-brief-upload-confirmation-scenario", "user-web-brief-upload-confirmation");
      expect(evidence).toHaveAttribute("data-brief-confirmed", "true");
      expect(evidence).toHaveAttribute("data-brief-missing-info-count", "0");
      expect(evidence).toHaveAttribute("data-brief-accepted-reference-count", "2");
      expect(evidence).toHaveAttribute("data-brief-rejected-reference-count", "0");
      expect(evidence).toHaveAttribute("data-brief-latest-reference-validation", "accepted");
      expect(evidence).toHaveAttribute("data-brief-confirmation-message-visible", "true");
      expect(evidence).toHaveAttribute("data-brief-candidate-set-ready", "true");
      expect(evidence).toHaveAttribute("data-brief-upload-confirmation-operation-count", "4");
      expect(evidence?.getAttribute("data-brief-upload-confirmation-operations")).toContain("createUpload");
      expect(evidence?.getAttribute("data-brief-upload-confirmation-operations")).toContain("createCandidateSet");
      expect(evidence).toHaveAttribute("data-brief-upload-confirmation-failures", "");
    });
  });

  it("drives the ecommerce growth pack through all four taxonomy candidates to ready ZIP smoke evidence", async () => {
    const { container } = render(<WorkspaceApp initialView="workspace" />);

    await screen.findByRole("heading", { name: "Launch Direction Board" });
    for (const taxonomy of ["conversion_offer", "social_proof", "feature_comparison", "retention_bundle"]) {
      expect(screen.getByTestId(`candidate-card-${taxonomy}`)).toBeInTheDocument();
    }

    fireEvent.change(screen.getByLabelText("Brief"), {
      target: {
        value:
          "Create an ecommerce growth package for the Aurora bottle using the uploaded packshot reference, shopper audience, and web, social, marketplace, and presentation export surfaces."
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Brief" }));
    await screen.findByText("Brief confirmed. I generated four deterministic strategy candidates for review.");

    fireEvent.change(screen.getByLabelText("Reference asset name or URL"), { target: { value: "aurora-packshot.webp" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    await waitFor(() => {
      expect(container.querySelector("[data-brief-upload-confirmation-runtime-evidence='stage0.rev2.brief-upload-confirmation-runtime-evidence']")).toHaveAttribute(
        "data-brief-upload-confirmation-status",
        "pass"
      );
    });

    const selectAndPackage = async (candidateTitle: string) => {
      fireEvent.click(screen.getByRole("button", { name: `Select ${candidateTitle}` }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: `Select ${candidateTitle}` })).toHaveAttribute("aria-pressed", "true");
      });
      fireEvent.click(screen.getByRole("button", { name: "Add Selection" }));
      await waitFor(() => {
        expect(screen.getAllByText(candidateTitle).length).toBeGreaterThanOrEqual(2);
      });
    };

    await selectAndPackage("Editorial Clarity");

    fireEvent.change(screen.getByLabelText("Iteration instruction"), {
      target: { value: "Refine the ecommerce story for clearer offer hierarchy and handoff notes." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Iterate" }));
    await screen.findByText("Iteration");

    await selectAndPackage("Studio System");
    await selectAndPackage("Gallery Motion");
    await selectAndPackage("Utility Kit");

    fireEvent.click(screen.getByRole("button", { name: "Export ZIP" }));
    await screen.findByText("zenart-001.zip");

    const workflowSmoke = await waitFor(() => {
      const evidence = container.querySelector("[data-workflow-api-smoke='stage0.rev2.workflow-api-smoke']");
      expect(evidence).toHaveAttribute("data-workflow-api-smoke-status", "pass");
      return evidence as HTMLElement;
    });

    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-workflow", "ecommerce_growth_pack");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-fixture", "fx_ecommerce_growth_golden");
    expect(workflowSmoke).toHaveAttribute(
      "data-workflow-api-smoke-scenario",
      "brief-reference-four-candidates-select-iterate-package-export-zip"
    );
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-operation-count", "8");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-candidate-count", "4");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-taxonomy-count", "4");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-packaged-taxonomy-count", "4");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-ready-zip-export-count", "1");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-missing-output-count", "0");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-qa-taxonomy-status", "pass");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-safety-status", "pass");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-failures", "");
    expect(workflowSmoke.getAttribute("data-workflow-api-smoke-operations")).toBe(
      "createChatSession,createChatMessage,createCandidateSet,listCandidateAssets,selectDirection,createPackage,createExport,getExport"
    );

    const renderingSmoke = container.querySelector("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
    expect(renderingSmoke).toHaveAttribute("data-rendering-status", "pass");
    expect(renderingSmoke?.getAttribute("data-render-interaction-steps")).toContain("brief-confirm");
    expect(renderingSmoke?.getAttribute("data-render-interaction-steps")).toContain("candidate-select");
    expect(renderingSmoke?.getAttribute("data-render-interaction-steps")).toContain("iteration");
    expect(renderingSmoke?.getAttribute("data-render-interaction-steps")).toContain("package-add");
    expect(renderingSmoke?.getAttribute("data-render-interaction-steps")).toContain("export-ready");
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

  it("exposes ecommerce growth workflow API smoke evidence through the user web happy path", async () => {
    const { container, rerender } = render(<WorkspaceApp initialView="workspace" />);

    await screen.findByRole("heading", { name: "Launch Direction Board" });

    fireEvent.change(screen.getByLabelText("Brief"), {
      target: {
        value:
          "Create a launch ad pack for the Aurora insulated bottle using the supplied packshot, targeting outdoor commuters on web and social."
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Brief" }));
    await screen.findByText("Brief confirmed. I generated four deterministic strategy candidates for review.");

    fireEvent.change(screen.getByLabelText("Reference asset name or URL"), { target: { value: "aurora-bottle-packshot.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    await screen.findByRole("button", { name: "Add reference aurora-bottle-packshot.png to package" });

    const candidateGrid = screen.getByTestId("candidate-grid");
    expect(within(candidateGrid).getAllByRole("article")).toHaveLength(4);
    for (const taxonomy of ["conversion_offer", "social_proof", "feature_comparison", "retention_bundle"]) {
      expect(container.querySelector(`[data-testid="candidate-card-${taxonomy}"]`)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "Select Editorial Clarity" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select Editorial Clarity" })).toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.change(screen.getByLabelText("Iteration instruction"), {
      target: { value: "Adapt ecommerce output placements for marketplace, square social, story, and web hero." }
    });
    fireEvent.submit(screen.getByTestId("iterate-selected-direction"));
    await screen.findByText("Editorial Clarity refined with: Adapt ecommerce output placements for marketplace, square social, story, and web hero.");

    for (const label of ["Select Editorial Clarity", "Select Studio System", "Select Gallery Motion", "Select Utility Kit"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
      });
      fireEvent.click(screen.getByTestId("package-add-selected"));
    }

    fireEvent.click(screen.getByTestId("export-download"));
    await screen.findByText("zenart-001.zip");

    const workflowSmoke = container.querySelector("[data-workflow-api-smoke='stage0.rev2.workflow-api-smoke']");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-status", "pass");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-workflow", "ecommerce_growth_pack");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-fixture", "fx_ecommerce_growth_golden");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-operation-count", "8");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-candidate-count", "4");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-taxonomy-count", "4");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-packaged-taxonomy-count", "4");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-ready-zip-export-count", "1");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-missing-output-count", "0");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-qa-taxonomy-status", "pass");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-safety-status", "pass");
    expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-failures", "");
    expect(workflowSmoke?.getAttribute("data-workflow-api-smoke-operations")).toContain("createCandidateSet");
    expect(workflowSmoke?.getAttribute("data-workflow-api-smoke-operations")).toContain("getExport");

    rerender(<WorkspaceApp initialView="export" />);
    await screen.findByRole("heading", { name: "Export Preview" });
    const exportSmoke = container.querySelector("[data-workflow-api-smoke-export='stage0.rev2.workflow-api-smoke']");
    expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-status", "pass");
    expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-operation-count", "8");
    expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-missing-output-count", "0");
  });

  it("keeps the user route smoke artifact aligned with machine-checkable UI evidence attributes", () => {
    const evidenceBySchema = new Map(
      userRouteSmoke.securityEvidence.map((entry) => [entry.schemaVersion, entry])
    );

    expect(evidenceBySchema.get("stage0.rev2.workspace-rendering-performance")).toMatchObject({
      route: "/workspace",
      source: "web/components/workspace-app.tsx",
      statusAttribute: "data-rendering-status",
      expectedStatus: "pass",
      expectedFailureCount: "0",
      budgetAttributes: expect.arrayContaining([
        "data-render-max-elements",
        "data-render-max-interaction-ms",
        "data-render-failure-count",
        "data-render-interaction-steps"
      ])
    });
    expect(evidenceBySchema.get("stage0.rev2.reference-upload-integration-smoke")).toMatchObject({
      route: "/workspace",
      source: "web/components/workspace-app.tsx",
      statusAttribute: "data-reference-upload-integration-status",
      expectedStatus: "pass",
      scenario: "reference-upload-to-ready-zip-export",
      requiredAttributes: expect.arrayContaining([
        "data-reference-upload-integration-operation-count",
        "data-reference-upload-integration-operations",
        "data-reference-accepted-count",
        "data-reference-latest-accepted-id",
        "data-reference-latest-accepted-name",
        "data-reference-latest-packaged",
        "data-reference-latest-provenance-present",
        "data-reference-latest-ppt-slide-present",
        "data-reference-package-history-count",
        "data-reference-ready-export-count",
        "data-reference-provenance-count",
        "data-reference-ppt-asset-grid-slide-count"
      ])
    });
    expect(evidenceBySchema.get("stage0.rev2.brief-upload-confirmation-runtime-evidence")).toMatchObject({
      route: "/workspace",
      source: "web/components/workspace-app.tsx",
      statusAttribute: "data-brief-upload-confirmation-status",
      expectedStatus: "pass",
      scenario: "user-web-brief-upload-confirmation",
      gateImpact: "user-web-evidence-only",
      expectedOperationCount: "4",
      requiredAttributes: expect.arrayContaining([
        "data-brief-confirmed",
        "data-brief-missing-info-count",
        "data-brief-accepted-reference-count",
        "data-brief-rejected-reference-count",
        "data-brief-latest-reference-validation",
        "data-brief-confirmation-message-visible",
        "data-brief-candidate-set-ready",
        "data-brief-upload-confirmation-failures"
      ])
    });
    expect(evidenceBySchema.get("stage0.rev2.package-export-metadata-ui")).toMatchObject({
      route: "/export",
      source: "web/components/workspace-app.tsx",
      statusAttribute: "data-package-export-metadata-status",
      expectedStatus: "pass",
      expectedMissingOutputCount: "0",
      expectedDownloadArtifactStatus: "pass",
      expectedMissingZipPayloadCount: "0",
      minimumZipPayloadCount: "6",
      payloadAttribute: "data-package-export-zip-payloads",
      requiredPayloadAttribute: "data-package-export-required-zip-payloads",
      requiredIdentityAttributes: expect.arrayContaining([
        "data-package-export-id",
        "data-package-export-package-id",
        "data-package-export-project-id",
        "data-package-export-manifest-created-at",
        "data-package-export-manifest-item-count",
        "data-package-export-manifest-required-output-count",
        "data-package-export-download-artifact-status",
        "data-package-export-download-artifact-format",
        "data-package-export-item-types",
        "data-package-export-safety-status",
        "data-package-export-safety-stage-count",
        "data-package-export-safety-finding-count",
        "data-package-export-ppt-aspect-ratio",
        "data-package-export-ppt-canvas-size",
        "data-package-export-ppt-safe-area",
        "data-package-export-ppt-theme-font",
        "data-package-export-ppt-handoff-checklist-count",
        "data-package-export-zip-payload-count",
        "data-package-export-workflow-id",
        "data-package-export-workflow-fixture-id",
        "data-package-export-workflow-taxonomy-count",
        "data-package-export-workflow-required-file-count",
        "data-package-export-workflow-zip-payload-count"
      ]),
      requiredPayloads: expect.arrayContaining([
        "manifest.json",
        "qa-report.json",
        "safety-policy-report.json",
        "provenance.json",
        "ppt-ready-metadata.json",
        "assets/README.txt"
      ])
    });
    expect(evidenceBySchema.get("stage0.rev2.workflow-api-smoke")).toMatchObject({
      route: "/workspace",
      source: "web/components/workspace-app.tsx",
      statusAttribute: "data-workflow-api-smoke-status",
      expectedStatus: "pass",
      workflowId: "ecommerce_growth_pack",
      fixtureId: "fx_ecommerce_growth_golden",
      expectedOperationCount: "8",
      expectedCandidateCount: "4",
      expectedTaxonomyCount: "4",
      expectedMissingOutputCount: "0"
    });
  });
});
