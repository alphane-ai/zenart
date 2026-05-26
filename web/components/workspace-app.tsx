"use client";

import {
  AlertTriangle,
  Archive,
  Check,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileArchive,
  Flag,
  History,
  ImagePlus,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  LogIn,
  LogOut,
  Loader2,
  PackagePlus,
  RefreshCcw,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Gauge,
  Upload,
  User
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AccountSettings, BillingScenario, Candidate, ExportFormat, QaSeverity, WorkspaceState } from "@/lib/contracts";
import { zenArtClient } from "@/lib/api-client";
import {
  buildPackageExportMetadataEvidence,
  buildBriefUploadConfirmationRuntimeEvidence,
  buildEcommerceGrowthApiSmokeEvidence,
  buildReferenceUploadIntegrationSmoke,
  buildSupportProblemContext,
  buildWorkspaceRenderingPerformanceSmoke
} from "@/lib/dev-state";
import { downloadExportPackage } from "@/lib/export-download";
import { apiOperations } from "@/lib/generated/zenart-api";
import { legalPolicyList, supportContactEmail } from "@/lib/legal-policies";
import { buildSessionSecurityContractEvidence } from "@/lib/request-security";
import { AnalyticsEventName, captureAnalyticsEvent, reportFrontendError } from "@/lib/telemetry";

export type ViewKey = "workspace" | "projects" | "export" | "billing" | "account" | "support";

const routeByView: Record<ViewKey, string> = {
  workspace: "/workspace",
  projects: "/project",
  export: "/export",
  billing: "/billing",
  account: "/account",
  support: "/support"
};

const titleByView: Record<ViewKey, string> = {
  workspace: "Workspace",
  projects: "Projects",
  export: "Export",
  billing: "Billing",
  account: "Account",
  support: "Support"
};

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const severityClass: Record<QaSeverity, string> = {
  pass: "qa-pass",
  warn: "qa-warn",
  block: "qa-block"
};

const sessionSecurityEvidenceSchema = "stage0.rev2.session-csrf-client-evidence";

export function WorkspaceApp({ initialView = "workspace" }: { initialView?: ViewKey }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const view = initialView;
  const [briefInput, setBriefInput] = useState("");
  const [iterationInput, setIterationInput] = useState("");
  const [loginEmail, setLoginEmail] = useState("dev@zenart.local");
  const [supportBody, setSupportBody] = useState("");
  const [supportCategory, setSupportCategory] = useState<"bug" | "billing" | "export" | "quality" | "other">("quality");
  const [referenceName, setReferenceName] = useState("visual-reference.png");
  const [referenceKind, setReferenceKind] = useState<"image" | "document" | "url">("image");
  const [busy, setBusy] = useState<string | null>(null);
  const capturedBillingView = useRef(false);

  useEffect(() => {
    let mounted = true;
    zenArtClient.loadWorkspace().then((loaded) => {
      if (mounted) {
        setState(loaded);
        setBriefInput(loaded.brief.prompt);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (state && view === "billing" && !capturedBillingView.current) {
      capturedBillingView.current = true;
      captureAnalyticsEvent("billing_viewed", state, {
        view
      });
    }
  }, [state, view]);

  const selectedCandidate = useMemo(
    () => state?.candidates.find((candidate) => candidate.id === state.selectedCandidateId),
    [state]
  );

  const quotaPercent = state ? Math.min(100, Math.round((state.billing.quotaUsed / state.billing.quotaLimit) * 100)) : 0;
  const runAction = async (label: string, action: () => Promise<WorkspaceState>) => {
    setBusy(label);
    try {
      const nextState = await action();
      setState(nextState);
      captureAnalyticsEvent(eventNameByAction(label), nextState, {
        action: label,
        view
      });
    } finally {
      setBusy(null);
    }
  };

  const runTrackedAction = async (label: string, action: () => Promise<WorkspaceState>) => {
    try {
      await runAction(label, action);
    } catch (error) {
      reportFrontendError(error, "action-error", state ?? undefined, label);
    }
  };

  const confirmBrief = (event: FormEvent) => {
    event.preventDefault();
    void runTrackedAction("brief", () => zenArtClient.confirmBrief(briefInput));
  };

  const iterate = (event: FormEvent) => {
    event.preventDefault();
    const instruction = iterationInput;
    setIterationInput("");
    void runTrackedAction("iterate", () => zenArtClient.iterateSelected(instruction));
  };

  const reportProblem = (event: FormEvent) => {
    event.preventDefault();
    const body = supportBody;
    setSupportBody("");
    void runTrackedAction("support", () =>
      zenArtClient.reportProblem({
        category: supportCategory,
        body,
        linkedExportId: state?.exports[0]?.id
      })
    );
  };

  if (!state) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" size={28} aria-hidden="true" />
        <span>Loading workspace</span>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">Z</div>
          <div>
            <strong>ZenArt</strong>
            <span>Stage 0</span>
          </div>
        </div>
        <nav>
          <NavButton icon={<Sparkles size={18} aria-hidden="true" />} label="Workspace" view="workspace" active={view === "workspace"} />
          <NavButton icon={<LayoutDashboard size={18} aria-hidden="true" />} label="Projects" view="projects" active={view === "projects"} />
          <NavButton icon={<FileArchive size={18} aria-hidden="true" />} label="Export" view="export" active={view === "export"} />
          <NavButton icon={<CircleDollarSign size={18} aria-hidden="true" />} label="Billing" view="billing" active={view === "billing"} />
          <NavButton icon={<User size={18} aria-hidden="true" />} label="Account" view="account" active={view === "account"} />
          <NavButton icon={<LifeBuoy size={18} aria-hidden="true" />} label="Support" view="support" active={view === "support"} />
        </nav>
        <div className="quota-card">
          <div className="quota-head">
            <span>{state.billing.name}</span>
            <strong>{state.billing.quotaLimit - state.billing.quotaUsed}</strong>
          </div>
          <div className="meter" role="progressbar" aria-label="Quota used" aria-valuemin={0} aria-valuemax={state.billing.quotaLimit} aria-valuenow={state.billing.quotaUsed}>
            <span style={{ width: `${quotaPercent}%` }} />
          </div>
          <small>{state.billing.quotaUsed} of {state.billing.quotaLimit} credits used</small>
        </div>
        <div className="sidebar-links" aria-label="Support and legal links">
          <a href={`mailto:${supportContactEmail}`}>{supportContactEmail}</a>
          {legalPolicyList.map((policy) => (
            <Link key={policy.key} href={policy.route}>
              {policy.title}
            </Link>
          ))}
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div>
            <span className="eyebrow">{titleByView[view]}</span>
            <h1>{state.projects.find((project) => project.id === state.activeProjectId)?.name}</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => void runTrackedAction("load", () => zenArtClient.loadWorkspace())} aria-label="Reload workspace">
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
            <span className={`session-pill session-${state.sessionContract.status}`}>{state.session.email} · {state.sessionContract.status}</span>
          </div>
        </header>
        <SessionPanel
          state={state}
          loginEmail={loginEmail}
          setLoginEmail={setLoginEmail}
          runAction={runTrackedAction}
        />
        <div className="action-status" role="status" aria-live="polite">
          {busy ? `${titleByView[view]} action in progress` : `${titleByView[view]} ready`}
        </div>

        {view === "workspace" && (
          <WorkspaceView
            state={state}
            busy={busy}
            briefInput={briefInput}
            iterationInput={iterationInput}
            referenceName={referenceName}
            referenceKind={referenceKind}
            selectedCandidate={selectedCandidate}
            setBriefInput={setBriefInput}
            setIterationInput={setIterationInput}
            setReferenceName={setReferenceName}
            setReferenceKind={setReferenceKind}
            confirmBrief={confirmBrief}
            iterate={iterate}
            runAction={runTrackedAction}
          />
        )}
        {view === "projects" && <ProjectsView state={state} />}
        {view === "export" && <ExportView state={state} runAction={runTrackedAction} />}
        {view === "billing" && <BillingView state={state} busy={busy} runAction={runTrackedAction} />}
        {view === "account" && <AccountView state={state} runAction={runTrackedAction} />}
        {view === "support" && (
          <SupportView
            state={state}
            busy={busy}
            body={supportBody}
            category={supportCategory}
            setBody={setSupportBody}
            setCategory={setSupportCategory}
            reportProblem={reportProblem}
          />
        )}
      </section>
    </main>
  );
}

function eventNameByAction(action: string): AnalyticsEventName {
  const eventByAction: Record<string, AnalyticsEventName> = {
    brief: "brief_confirmed",
    reference: "reference_attached",
    select: "candidate_selected",
    iterate: "iteration_submitted",
    package: "package_item_added",
    export: "export_requested",
    checkout: "checkout_started",
    "billing-scenario": "billing_scenario_selected",
    account: "account_updated",
    support: "support_ticket_opened",
    login: "route_viewed",
    logout: "route_viewed",
    "session-refresh": "route_viewed",
    "session-expire": "route_viewed"
  };

  return eventByAction[action] ?? "route_viewed";
}

function SessionPanel({
  state,
  loginEmail,
  setLoginEmail,
  runAction
}: {
  state: WorkspaceState;
  loginEmail: string;
  setLoginEmail: (value: string) => void;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const sessionBlocked = state.sessionContract.status !== "authenticated";
  const expectedSessionCookieName = "__Host-zenart_session";
  const expectedCsrfStrategy = "same-site-origin-check";
  const expectedCsrfHeader = "X-ZenArt-CSRF";
  const expectedSameSiteRequirement = "lax-or-strict";
  const evidence = buildSessionSecurityContractEvidence(state.sessionContract, apiOperations);
  const csrfProtectedMethods = evidence.protectedMethods.join(", ");
  const sameSiteRequirement = state.sessionContract.csrf.sameSiteRequired;
  const cookieAttributes = [
    state.sessionContract.cookie.httpOnly ? "HttpOnly" : "client-readable",
    state.sessionContract.cookie.secure ? "Secure" : "insecure",
    `SameSite=${state.sessionContract.cookie.sameSite}`,
    `Path=${state.sessionContract.cookie.path}`
  ].join(" · ");

  return (
    <section
      className="session-contract"
      aria-label="Auth and session status"
      data-session-contract={`${expectedSessionCookieName}:${expectedCsrfStrategy}:${expectedCsrfHeader}:${expectedSameSiteRequirement}`}
      data-session-security-evidence={sessionSecurityEvidenceSchema}
      data-session-security-status={evidence.status}
      data-session-cookie-name={evidence.cookieName}
      data-session-cookie-http-only={String(evidence.cookieAttributes.httpOnly)}
      data-session-cookie-secure={String(evidence.cookieAttributes.secure)}
      data-session-cookie-same-site={evidence.cookieAttributes.sameSite}
      data-session-cookie-path={evidence.cookieAttributes.path}
      data-session-csrf-header={evidence.csrfHeaderName}
      data-session-csrf-origin-policy={evidence.originPolicy}
      data-session-csrf-missing-operation-count={evidence.missingCsrfOperationIds.length}
    >
      <div className="session-contract-main">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>Session {state.sessionContract.status}</strong>
          <span>
            Secure cookie {state.sessionContract.cookie.name} · {cookieAttributes} · CSRF {state.sessionContract.csrf.headerName}
          </span>
        </div>
      </div>
      <dl className="session-contract-evidence" aria-label="CSRF and same-site contract evidence">
        <div>
          <dt>Cookie</dt>
          <dd>{state.sessionContract.cookie.name}</dd>
        </div>
        <div>
          <dt>SameSite</dt>
          <dd>{state.sessionContract.cookie.sameSite}</dd>
        </div>
        <div>
          <dt>CSRF</dt>
          <dd>{state.sessionContract.csrf.strategy}</dd>
        </div>
        <div>
          <dt>Header</dt>
          <dd>{state.sessionContract.csrf.headerName}</dd>
        </div>
        <div>
          <dt>Credentials</dt>
          <dd>{state.sessionContract.csrf.credentialMode}</dd>
        </div>
        <div>
          <dt>Origin policy</dt>
          <dd>{state.sessionContract.csrf.originPolicy}</dd>
        </div>
        <div>
          <dt>Protected</dt>
          <dd>{csrfProtectedMethods}</dd>
        </div>
        <div>
          <dt>Requirement</dt>
          <dd>{sameSiteRequirement}</dd>
        </div>
      </dl>
      <div
        className="csrf-operation-inventory"
        aria-label="Generated web API CSRF operation inventory"
        data-csrf-operation-count={evidence.protectedOperationIds.length}
      >
        <strong>{evidence.protectedOperationIds.length} generated web operations require same-site CSRF headers</strong>
        <span>{evidence.protectedOperationIds.join(", ")}</span>
      </div>
      {sessionBlocked ? (
        <div className="inline-alert session-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{state.sessionContract.status === "expired" ? "Session expired. Refresh or sign in to continue." : "Signed out. Sign in to continue."}</span>
        </div>
      ) : null}
      <div className="session-actions">
        <label className="sr-only" htmlFor="login-email">Email</label>
        <input id="login-email" type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
        <button className="secondary-button compact" onClick={() => void runAction("login", () => zenArtClient.login(loginEmail))}>
          <LogIn size={15} aria-hidden="true" />
          Sign In
        </button>
        <button className="secondary-button compact" disabled={sessionBlocked} onClick={() => void runAction("session-refresh", () => zenArtClient.refreshSession())}>
          <RefreshCcw size={15} aria-hidden="true" />
          Refresh Session
        </button>
        <button className="secondary-button compact" disabled={sessionBlocked} onClick={() => void runAction("session-expire", () => zenArtClient.expireSession())}>
          <RotateCcw size={15} aria-hidden="true" />
          Expire
        </button>
        <button className="secondary-button compact" disabled={state.sessionContract.status === "signed_out"} onClick={() => void runAction("logout", () => zenArtClient.logout())}>
          <LogOut size={15} aria-hidden="true" />
          Log Out
        </button>
      </div>
    </section>
  );
}

function NavButton({
  icon,
  label,
  view,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  view: ViewKey;
  active: boolean;
}) {
  return (
    <Link className={active ? "nav-button active" : "nav-button"} href={routeByView[view]} aria-current={active ? "page" : undefined}>
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function WorkspaceView({
  state,
  busy,
  briefInput,
  iterationInput,
  referenceName,
  referenceKind,
  selectedCandidate,
  setBriefInput,
  setIterationInput,
  setReferenceName,
  setReferenceKind,
  confirmBrief,
  iterate,
  runAction
}: {
  state: WorkspaceState;
  busy: string | null;
  briefInput: string;
  iterationInput: string;
  referenceName: string;
  referenceKind: "image" | "document" | "url";
  selectedCandidate?: Candidate;
  setBriefInput: (value: string) => void;
  setIterationInput: (value: string) => void;
  setReferenceName: (value: string) => void;
  setReferenceKind: (value: "image" | "document" | "url") => void;
  confirmBrief: (event: FormEvent) => void;
  iterate: (event: FormEvent) => void;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const latestReference = state.brief.references.at(-1);
  const acceptedReferenceIds = state.brief.references
    .filter((reference) => reference.validation.state === "accepted")
    .map((reference) => reference.id);
  const packagedReferenceIds = new Set(
    state.packageItems.filter((item) => item.type === "reference").map((item) => item.sourceId)
  );
  const renderingSmoke = buildWorkspaceRenderingPerformanceSmoke(state);
  const referenceIntegrationSmoke = buildReferenceUploadIntegrationSmoke(state);
  const briefUploadConfirmationEvidence = buildBriefUploadConfirmationRuntimeEvidence(state);
  const ecommerceApiSmoke = buildEcommerceGrowthApiSmokeEvidence(state);
  return (
    <div className="workspace-grid">
      <section className="panel chat-panel">
        <PanelTitle icon={<Sparkles size={18} aria-hidden="true" />} title="Brief" />
        <div className="messages" aria-live="polite">
          {state.chat.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <span>{message.role}</span>
              <p>{message.body}</p>
            </article>
          ))}
        </div>
        <form onSubmit={confirmBrief} className="stack">
          {state.brief.missingInfo.length > 0 && (
            <div className="missing-info" id="brief-missing-info">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>Missing: {state.brief.missingInfo.join(", ")}</span>
            </div>
          )}
          <label className="sr-only" htmlFor="brief-input">Brief</label>
          <textarea id="brief-input" value={briefInput} onChange={(event) => setBriefInput(event.target.value)} rows={5} aria-describedby={state.brief.missingInfo.length > 0 ? "brief-missing-info" : undefined} />
          <button className="primary-button" disabled={busy === "brief" || !briefInput.trim()}>
            <Check size={18} aria-hidden="true" />
            Confirm Brief
          </button>
        </form>
        <div className="reference-row">
          <label className="sr-only" htmlFor="reference-name">Reference asset name or URL</label>
          <input id="reference-name" value={referenceName} onChange={(event) => setReferenceName(event.target.value)} />
          <label className="sr-only" htmlFor="reference-kind">Reference type</label>
          <select id="reference-kind" value={referenceKind} onChange={(event) => setReferenceKind(event.target.value as typeof referenceKind)}>
            <option value="image">Image</option>
            <option value="document">Document</option>
            <option value="url">URL</option>
          </select>
          <button
            className="secondary-button"
            disabled={!referenceName.trim()}
            onClick={() =>
              void runAction("reference", () =>
                zenArtClient.attachReference({
                  name: referenceName,
                  kind: referenceKind
                })
              )
            }
          >
            <Upload size={17} aria-hidden="true" />
            Attach
          </button>
        </div>
        {latestReference?.validation.state === "rejected" ? (
          <div className="inline-alert" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{latestReference.validation.reason}</span>
          </div>
        ) : null}
        <div
          className="brief-upload-confirmation-evidence"
          aria-label="Brief upload confirmation runtime evidence"
          data-brief-upload-confirmation-runtime-evidence={briefUploadConfirmationEvidence.schema_version}
          data-brief-upload-confirmation-status={briefUploadConfirmationEvidence.status}
          data-brief-upload-confirmation-scenario={briefUploadConfirmationEvidence.scenario}
          data-brief-upload-confirmation-gate-impact={briefUploadConfirmationEvidence.gateImpact}
          data-brief-confirmed={String(briefUploadConfirmationEvidence.briefConfirmed)}
          data-brief-missing-info-count={briefUploadConfirmationEvidence.missingInfoCount}
          data-brief-accepted-reference-count={briefUploadConfirmationEvidence.acceptedReferenceCount}
          data-brief-rejected-reference-count={briefUploadConfirmationEvidence.rejectedReferenceCount}
          data-brief-latest-reference-validation={briefUploadConfirmationEvidence.latestReferenceValidationState}
          data-brief-confirmation-message-visible={String(briefUploadConfirmationEvidence.confirmationMessageVisible)}
          data-brief-candidate-set-ready={String(briefUploadConfirmationEvidence.candidateSetReady)}
          data-brief-upload-confirmation-operation-count={briefUploadConfirmationEvidence.apiOperationIds.length}
          data-brief-upload-confirmation-operations={briefUploadConfirmationEvidence.apiOperationIds.join(",")}
          data-brief-upload-confirmation-failures={briefUploadConfirmationEvidence.failures.join(",")}
        >
          <strong>Brief upload confirmation</strong>
          <span>
            {briefUploadConfirmationEvidence.status} · {briefUploadConfirmationEvidence.acceptedReferenceCount} accepted references ·{" "}
            {briefUploadConfirmationEvidence.missingInfoCount} missing fields · {briefUploadConfirmationEvidence.apiOperationIds.length} user
            operations.
          </span>
        </div>
        <div
          className="reference-export-smoke"
          aria-label="Reference upload export integration smoke"
          data-reference-export-smoke="reference-upload-to-ready-zip-export"
          data-reference-upload-integration-smoke={referenceIntegrationSmoke.schema_version}
          data-reference-upload-integration-status={referenceIntegrationSmoke.status}
          data-reference-accepted-count={acceptedReferenceIds.length}
          data-reference-accepted-kinds={referenceIntegrationSmoke.acceptedKinds.join(",")}
          data-reference-rejected-count={referenceIntegrationSmoke.rejectedCount}
          data-reference-packaged-count={packagedReferenceIds.size}
          data-reference-package-history-count={referenceIntegrationSmoke.packageHistoryReferenceCount}
          data-reference-ready-export-count={referenceIntegrationSmoke.readyExportCount}
          data-reference-provenance-count={referenceIntegrationSmoke.provenanceCount}
          data-reference-ppt-asset-grid-slide-count={referenceIntegrationSmoke.pptAssetGridSlideCount}
          data-reference-upload-integration-failures={referenceIntegrationSmoke.failures.join(",")}
        >
          <strong>Reference export path</strong>
          <span>Accepted references can be added to package history and ZIP manifest provenance.</span>
        </div>
        <div
          className="workflow-api-smoke"
          aria-label="Ecommerce growth pack API smoke"
          data-workflow-api-smoke={ecommerceApiSmoke.schema_version}
          data-workflow-api-smoke-workflow={ecommerceApiSmoke.workflow_id}
          data-workflow-api-smoke-fixture={ecommerceApiSmoke.fixture_id}
          data-workflow-api-smoke-scenario={ecommerceApiSmoke.scenario}
          data-workflow-api-smoke-status={ecommerceApiSmoke.status}
          data-workflow-api-smoke-operation-count={ecommerceApiSmoke.apiOperationIds.length}
          data-workflow-api-smoke-candidate-count={ecommerceApiSmoke.candidateCount}
          data-workflow-api-smoke-taxonomy-count={ecommerceApiSmoke.taxonomyCount}
          data-workflow-api-smoke-packaged-taxonomy-count={ecommerceApiSmoke.packagedTaxonomyCount}
          data-workflow-api-smoke-ready-zip-export-count={ecommerceApiSmoke.readyZipExportCount}
          data-workflow-api-smoke-required-output-count={ecommerceApiSmoke.requiredOutputCount}
          data-workflow-api-smoke-missing-output-count={ecommerceApiSmoke.missingRequiredOutputs.length}
          data-workflow-api-smoke-qa-taxonomy-status={ecommerceApiSmoke.qaTaxonomyStatus}
          data-workflow-api-smoke-safety-status={ecommerceApiSmoke.safetyStatus}
          data-workflow-api-smoke-operations={ecommerceApiSmoke.apiOperationIds.join(",")}
          data-workflow-api-smoke-failures={ecommerceApiSmoke.failures.join(",")}
        >
          <strong>Ecommerce growth API smoke</strong>
          <span>
            {ecommerceApiSmoke.status} · {ecommerceApiSmoke.candidateCount} candidates · {ecommerceApiSmoke.packagedTaxonomyCount} packaged taxonomy routes ·{" "}
            {ecommerceApiSmoke.missingRequiredOutputs.length} missing outputs.
          </span>
        </div>
        <div className="reference-list">
          {state.brief.references.map((reference) => (
            <span key={reference.id} className={reference.validation.state === "rejected" ? "rejected-reference" : ""}>
              <ImagePlus size={14} aria-hidden="true" />
              {reference.name} · {reference.validation.state}
              {reference.validation.state === "accepted" ? (
                <button
                  className="reference-package-button"
                  disabled={packagedReferenceIds.has(reference.id)}
                  onClick={() => void runAction("package", () => zenArtClient.addPackageItem(reference.id))}
                  aria-label={`Add reference ${reference.name} to package`}
                >
                  {packagedReferenceIds.has(reference.id) ? "Packaged" : "Package"}
                </button>
              ) : null}
            </span>
          ))}
        </div>
      </section>

      <section className="panel canvas-panel">
        <div className="panel-header">
          <PanelTitle icon={<Save size={18} aria-hidden="true" />} title="Canvas" />
          <span className="soft-label">Autosaved {dateLabel(state.canvas.autosavedAt)}</span>
        </div>
        <div
          className={renderingSmoke.status === "pass" ? "rendering-smoke pass" : "rendering-smoke fail"}
          role="status"
          aria-label="Workspace rendering performance smoke"
          data-rendering-smoke-summary={renderingSmoke.schema_version}
          data-rendering-smoke-status={renderingSmoke.status}
          data-rendering-smoke-failures={renderingSmoke.failures.join(",")}
          data-rendering-interaction-steps={renderingSmoke.interactionSteps.join(",")}
          data-rendering-estimated-interaction-ms={renderingSmoke.estimatedInteractionMs}
          data-rendering-budget-node-count={renderingSmoke.budgets.maxNodes}
          data-rendering-budget-edge-count={renderingSmoke.budgets.maxEdges}
          data-rendering-budget-version-count={renderingSmoke.budgets.maxVersions}
        >
          <Gauge size={15} aria-hidden="true" />
          <span>
            {renderingSmoke.status === "pass" ? "Render budget pass" : "Render budget fail"} · {renderingSmoke.renderElementCount}/
            {renderingSmoke.budgets.maxRenderElements} elements · {renderingSmoke.estimatedInteractionMs}/
            {renderingSmoke.budgets.maxInteractionMs} ms
          </span>
        </div>
        <div
          className="canvas-surface"
          data-rendering-smoke={renderingSmoke.schema_version}
          data-rendering-status={renderingSmoke.status}
          data-render-node-count={renderingSmoke.nodeCount}
          data-render-edge-count={renderingSmoke.edgeCount}
          data-render-element-count={renderingSmoke.renderElementCount}
          data-render-estimated-interaction-ms={renderingSmoke.estimatedInteractionMs}
          data-render-interaction-steps={renderingSmoke.interactionSteps.join(",")}
          data-render-failure-count={renderingSmoke.failures.length}
          data-render-max-elements={renderingSmoke.budgets.maxRenderElements}
          data-render-max-interaction-ms={renderingSmoke.budgets.maxInteractionMs}
        >
          {state.canvas.edges.map((edge) => (
            <div key={`${edge.from}-${edge.to}`} className="canvas-edge" />
          ))}
          {state.canvas.nodes.map((node) => (
            <article key={node.id} className={`canvas-node ${node.kind}`} style={{ left: node.x, top: node.y }}>
              <strong>{node.title}</strong>
              <p>{node.body}</p>
            </article>
          ))}
        </div>
        <div className="version-row">
          {state.canvas.versions.map((version) => (
            <button
              key={version.id}
              className={version.id === state.canvas.activeVersionId ? "version-chip active" : "version-chip"}
              onClick={() => void runAction("restore", () => zenArtClient.restoreCanvasVersion(version.id))}
              aria-pressed={version.id === state.canvas.activeVersionId}
            >
              <History size={14} aria-hidden="true" />
              {version.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel candidates-panel" data-testid="candidate-grid">
        <PanelTitle icon={<Archive size={18} aria-hidden="true" />} title="Candidates" />
        <div className="candidate-grid">
          {state.candidates.map((candidate) => (
            <article
              key={candidate.id}
              className={state.selectedCandidateId === candidate.id ? "candidate-card selected" : "candidate-card"}
              aria-current={state.selectedCandidateId === candidate.id ? "true" : undefined}
              data-testid={candidate.strategyTaxonomy ? `candidate-card-${candidate.strategyTaxonomy}` : undefined}
              data-workflow-id={candidate.workflowId}
              data-strategy-taxonomy={candidate.strategyTaxonomy}
            >
              <div className="swatches">
                {candidate.palette.map((color) => (
                  <span key={color} style={{ background: color }} />
                ))}
              </div>
              <h2>{candidate.title}</h2>
              <p>{candidate.strategy}</p>
              <small>{candidate.rationale}</small>
              <button
                className="secondary-button"
                data-testid="candidate-select"
                onClick={() => void runAction("select", () => zenArtClient.selectCandidate(candidate.id))}
                aria-pressed={state.selectedCandidateId === candidate.id}
                aria-label={`Select ${candidate.title}`}
              >
                <ChevronRight size={17} aria-hidden="true" />
                Select
              </button>
            </article>
          ))}
        </div>
        <form className="iteration-form" onSubmit={iterate} data-testid="iterate-selected-direction">
          <label className="sr-only" htmlFor="iteration-input">Iteration instruction</label>
          <input
            id="iteration-input"
            value={iterationInput}
            onChange={(event) => setIterationInput(event.target.value)}
            placeholder={selectedCandidate ? `Iterate ${selectedCandidate.title}` : "Select a candidate to iterate"}
          />
          <button className="primary-button" disabled={!selectedCandidate || !iterationInput.trim()}>
            <Send size={18} aria-hidden="true" />
            Iterate
          </button>
        </form>
      </section>

      <PackagePanel state={state} runAction={runAction} />
    </div>
  );
}

function PackagePanel({
  state,
  runAction
}: {
  state: WorkspaceState;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  return (
    <section className="panel package-panel">
      <PanelTitle icon={<PackagePlus size={18} aria-hidden="true" />} title="Package" />
      <div className="package-actions">
        <button
          className="secondary-button"
          data-testid="package-add-selected"
          disabled={!state.selectedCandidateId}
          onClick={() => {
            const candidateId = state.selectedCandidateId;
            if (candidateId) {
              void runAction("package", () => zenArtClient.addPackageItem(candidateId));
            }
          }}
        >
          <PackagePlus size={17} aria-hidden="true" />
          Add Selection
        </button>
        <button className="primary-button" data-testid="export-download" onClick={() => void runAction("export", () => zenArtClient.createExport("zip"))}>
          <Download size={17} aria-hidden="true" />
          Export ZIP
        </button>
        <button className="secondary-button" onClick={() => void runAction("export", () => zenArtClient.createExport("pdf-placeholder"))}>
          <FileArchive size={17} aria-hidden="true" />
          PDF
        </button>
      </div>
      <div className="history-list">
        <h3>Package history</h3>
        {state.packageItems.length === 0 ? <p className="empty">No package items yet.</p> : null}
        {state.packageItems.map((item) => (
          <article key={item.id}>
            <strong>{item.title}</strong>
            <span>{item.type} · {dateLabel(item.addedAt)}</span>
          </article>
        ))}
      </div>
      <div className="history-list">
        <h3>Export history</h3>
        {state.exports.length === 0 ? <p className="empty">Export creates manifest, QA report, and deterministic file name.</p> : null}
        {state.exports.map((item) => (
          <article key={item.id} className={item.status === "blocked" ? "blocked-export" : ""}>
            <strong>{item.fileName}</strong>
            <span>{item.status} · {dateLabel(item.createdAt)}</span>
            <span>Manifest {item.manifest.package_id} · {item.manifest.items.length} provenance entries</span>
            <div className="qa-list">
              {item.qaReport.map((finding) => (
                <span key={finding.id} className={severityClass[finding.severity]}>
                  {finding.severity}: {finding.title}
                </span>
              ))}
            </div>
            {item.status === "ready" ? (
              <button className="secondary-button compact" onClick={() => void downloadExportPackage(item)}>
                <Download size={15} aria-hidden="true" />
                Download
              </button>
            ) : null}
            <ShareLinkState state={state} exportId={item.id} runAction={runAction} compact />
          </article>
        ))}
      </div>
    </section>
  );
}

function ProjectsView({ state }: { state: WorkspaceState }) {
  return (
    <section className="content-view">
      <div className="section-title">
        <h2>Project Dashboard</h2>
      </div>
      <div className="project-grid">
        {state.projects.map((project) => (
          <article key={project.id} className={project.id === state.activeProjectId ? "project-card active" : "project-card"}>
            <strong>{project.name}</strong>
            <p>{project.brief}</p>
            <span>{project.assetCount} assets · {project.exportCount} exports · {dateLabel(project.updatedAt)}</span>
          </article>
        ))}
      </div>
      <div className="empty-state">
        <Sparkles size={22} aria-hidden="true" />
        <strong>Workflow examples</strong>
        <span>Campaign direction, product launch kit, editorial board, presentation asset package.</span>
      </div>
    </section>
  );
}

function ExportView({
  state,
  runAction
}: {
  state: WorkspaceState;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const latestExport = state.exports[0];
  const latestShareLink = latestExport ? state.shareLinks.find((item) => item.exportId === latestExport.id) : undefined;
  const metadataEvidence = latestExport ? buildPackageExportMetadataEvidence(latestExport) : undefined;
  const ecommerceApiSmoke = buildEcommerceGrowthApiSmokeEvidence(state);
  return (
    <section className="content-view export-view" data-testid="export-preview">
      <div className="section-title">
        <h2>Export Preview</h2>
      </div>
      <div className="export-layout">
        <PackagePanel state={state} runAction={runAction} />
        <article className="export-summary">
          <span className="eyebrow">Latest package</span>
          {latestExport ? (
            <>
              <h3>{latestExport.fileName}</h3>
              <p>{latestExport.status} · {dateLabel(latestExport.createdAt)}</p>
              <dl>
                <div>
                  <dt>Manifest</dt>
                  <dd>{latestExport.manifest.required_outputs.join(", ")}</dd>
                </div>
                <div>
                  <dt>Items</dt>
                  <dd>{latestExport.manifest.items.length}</dd>
                </div>
                <div>
                  <dt>QA findings</dt>
                  <dd>{latestExport.qaReport.length}</dd>
                </div>
                <div>
                  <dt>Safety</dt>
                  <dd>{latestExport.safetyReport.status} · {latestExport.safetyReport.enforcementStages.length} stages</dd>
                </div>
                <div>
                  <dt>Provenance</dt>
                  <dd>{latestExport.manifest.items.map((item) => item.provenance).join(", ") || "No package provenance yet"}</dd>
                </div>
                <div>
                  <dt>PPT-ready</dt>
                  <dd>
                    {latestExport.manifest.ppt_ready_metadata.aspect_ratio} · {latestExport.manifest.ppt_ready_metadata.slides.length} slide
                    {latestExport.manifest.ppt_ready_metadata.slides.length === 1 ? "" : "s"} · {latestExport.manifest.ppt_ready_metadata.canvas_size.width}x
                    {latestExport.manifest.ppt_ready_metadata.canvas_size.height}
                  </dd>
                </div>
                <div>
                  <dt>Share link</dt>
                  <dd>{latestShareLink ? `${latestShareLink.status} · ${latestShareLink.access}` : "Not requested"}</dd>
                </div>
              </dl>
              <div className="export-detail-grid">
                {metadataEvidence ? (
                  <section
                    className="export-detail-panel package-export-metadata-evidence"
                    aria-label="Package export metadata UI evidence"
                    data-package-export-metadata-ui={metadataEvidence.schema_version}
                    data-package-export-metadata-status={metadataEvidence.status}
                    data-package-export-id={metadataEvidence.exportId}
                    data-package-export-package-id={metadataEvidence.packageId}
                    data-package-export-download-artifact-status={metadataEvidence.downloadArtifactStatus}
                    data-package-export-download-artifact-format={metadataEvidence.downloadArtifactFormat}
                    data-package-export-required-output-count={metadataEvidence.requiredOutputCount}
                    data-package-export-missing-output-count={metadataEvidence.missingRequiredOutputs.length}
                    data-package-export-provenance-count={metadataEvidence.provenanceCount}
                    data-package-export-blocking-qa-count={metadataEvidence.blockingQaCount}
                    data-package-export-ppt-slide-count={metadataEvidence.pptSlideCount}
                    data-package-export-zip-payload-count={metadataEvidence.zipPayloadCount}
                    data-package-export-zip-payloads={metadataEvidence.zipPayloadNames.join(",")}
                    data-package-export-required-zip-payloads={metadataEvidence.requiredZipPayloadNames.join(",")}
                    data-package-export-missing-zip-payload-count={metadataEvidence.missingZipPayloadNames.length}
                    data-package-export-workflow-zip-payload-count={metadataEvidence.workflowZipPayloadCount}
                  >
                    <h4>Metadata Evidence</h4>
                    <div className="metadata-evidence-grid">
                      <span className={metadataEvidence.status === "pass" ? "qa-pass" : "qa-block"}>
                        {metadataEvidence.status}
                      </span>
                      <span>{metadataEvidence.requiredOutputCount} required outputs</span>
                      <span>{metadataEvidence.provenanceCount}/{metadataEvidence.itemCount} provenance entries</span>
                      <span>{metadataEvidence.qaFindingCount} QA findings</span>
                      <span>{metadataEvidence.pptSlideCount} PPT slides</span>
                      <span>{metadataEvidence.downloadArtifactStatus} ZIP payload contract</span>
                    </div>
                    <p>
                      ZIP payload contract: {metadataEvidence.zipPayloadNames.join(", ")}.
                      {metadataEvidence.missingRequiredOutputs.length > 0 || metadataEvidence.missingZipPayloadNames.length > 0
                        ? ` Missing ${[...metadataEvidence.missingRequiredOutputs, ...metadataEvidence.missingZipPayloadNames].join(", ")}.`
                        : " All required metadata outputs are present."}
                    </p>
                  </section>
                ) : null}
                <section
                  className="export-detail-panel workflow-api-smoke-evidence"
                  aria-label="Ecommerce growth pack API smoke export evidence"
                  data-workflow-api-smoke-export={ecommerceApiSmoke.schema_version}
                  data-workflow-api-smoke-export-status={ecommerceApiSmoke.status}
                  data-workflow-api-smoke-export-workflow={ecommerceApiSmoke.workflow_id}
                  data-workflow-api-smoke-export-fixture={ecommerceApiSmoke.fixture_id}
                  data-workflow-api-smoke-export-scenario={ecommerceApiSmoke.scenario}
                  data-workflow-api-smoke-export-operation-count={ecommerceApiSmoke.apiOperationIds.length}
                  data-workflow-api-smoke-export-missing-output-count={ecommerceApiSmoke.missingRequiredOutputs.length}
                  data-workflow-api-smoke-export-qa-taxonomy-status={ecommerceApiSmoke.qaTaxonomyStatus}
                  data-workflow-api-smoke-export-safety-status={ecommerceApiSmoke.safetyStatus}
                  data-workflow-api-smoke-export-failures={ecommerceApiSmoke.failures.join(",")}
                >
                  <h4>Workflow API Smoke</h4>
                  <div className="metadata-evidence-grid">
                    <span className={ecommerceApiSmoke.status === "pass" ? "qa-pass" : "qa-block"}>
                      {ecommerceApiSmoke.status}
                    </span>
                    <span>{ecommerceApiSmoke.workflow_id}</span>
                    <span>{ecommerceApiSmoke.apiOperationIds.length} API operations</span>
                    <span>{ecommerceApiSmoke.packagedTaxonomyCount}/4 packaged taxonomy routes</span>
                  </div>
                  <p>
                    Brief, product reference, four candidates, selection, iteration, package, and ZIP export are represented in the local web client
                    contract.
                  </p>
                </section>
                <section className="export-detail-panel manifest-preview" aria-label="Manifest preview">
                  <h4>Manifest Preview</h4>
                  <dl>
                    <div>
                      <dt>Package</dt>
                      <dd>{latestExport.manifest.package_id}</dd>
                    </div>
                    <div>
                      <dt>Project</dt>
                      <dd>{latestExport.manifest.project_id}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{dateLabel(latestExport.manifest.created_at)}</dd>
                    </div>
                  </dl>
                </section>
                <section className="export-detail-panel qa-report" aria-label="QA report">
                  <h4>QA Report</h4>
                  <div className="qa-list">
                    {latestExport.qaReport.map((finding) => (
                      <span key={finding.id} className={severityClass[finding.severity]}>
                        {finding.severity}: {finding.title}
                      </span>
                    ))}
                  </div>
                </section>
                <section
                  className="export-detail-panel safety-policy-report"
                  aria-label="Safety policy report"
                  data-safety-policy-export={latestExport.safetyReport.schema_version}
                  data-safety-policy-status={latestExport.safetyReport.status}
                  data-safety-policy-stage-count={latestExport.safetyReport.enforcementStages.length}
                  data-safety-policy-finding-count={latestExport.safetyReport.findings.length}
                >
                  <h4>Safety Policy</h4>
                  <div className="metadata-evidence-grid">
                    <span className={latestExport.safetyReport.status === "pass" ? "qa-pass" : "qa-block"}>
                      {latestExport.safetyReport.status}
                    </span>
                    <span>{latestExport.safetyReport.enforcementStages.join(", ")}</span>
                  </div>
                  {latestExport.safetyReport.findings.length === 0 ? (
                    <p>Brief, provider request, provider response, QA, and export checks passed.</p>
                  ) : (
                    <ul>
                      {latestExport.safetyReport.findings.map((finding) => (
                        <li key={`${finding.stage}-${finding.ruleId}`}>
                          <strong>{finding.stage}: {finding.title}</strong>
                          <span>{finding.userMessage}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="export-detail-panel provenance-report" aria-label="Provenance report">
                  <h4>Provenance Report</h4>
                  {latestExport.manifest.items.length === 0 ? (
                    <p>No package items are eligible for final export.</p>
                  ) : (
                    <ul>
                      {latestExport.manifest.items.map((item) => (
                        <li key={item.id}>
                          <strong>{item.title}</strong>
                          <span>{item.type} · {item.provenance}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section
                  className="export-detail-panel reference-upload-export-contract"
                  aria-label="Reference upload to ready ZIP export contract"
                  data-reference-upload-export-contract="reference-upload-to-ready-zip-export"
                  data-reference-provenance-count={
                    latestExport.manifest.items.filter((item) => item.type === "reference").length
                  }
                >
                  <h4>Reference Upload Export Contract</h4>
                  <p>Accepted references enter package history as reference items and emit dev-client-reference provenance in ZIP exports.</p>
                  {latestExport.manifest.items.some((item) => item.type === "reference") ? (
                    <ul>
                      {latestExport.manifest.items
                        .filter((item) => item.type === "reference")
                        .map((item) => (
                          <li key={item.id}>
                            <strong>{item.title}</strong>
                            <span>{item.provenance}</span>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p>No reference items are packaged in the latest export.</p>
                  )}
                </section>
                <section className="export-detail-panel ppt-ready-metadata" aria-label="PPT-ready metadata">
                  <h4>PPT-ready Metadata</h4>
                  <dl>
                    <div>
                      <dt>Canvas</dt>
                      <dd>
                        {latestExport.manifest.ppt_ready_metadata.canvas_size.width}x{latestExport.manifest.ppt_ready_metadata.canvas_size.height} ·{" "}
                        {latestExport.manifest.ppt_ready_metadata.aspect_ratio}
                      </dd>
                    </div>
                    <div>
                      <dt>Safe area</dt>
                      <dd>
                        {latestExport.manifest.ppt_ready_metadata.safe_area.top}/{latestExport.manifest.ppt_ready_metadata.safe_area.right}/
                        {latestExport.manifest.ppt_ready_metadata.safe_area.bottom}/{latestExport.manifest.ppt_ready_metadata.safe_area.left}
                      </dd>
                    </div>
                    <div>
                      <dt>Theme</dt>
                      <dd>
                        {latestExport.manifest.ppt_ready_metadata.theme.font_family} · {latestExport.manifest.ppt_ready_metadata.theme.accent}
                      </dd>
                    </div>
                  </dl>
                  <ul>
                    {latestExport.manifest.ppt_ready_metadata.slides.map((slide) => (
                      <li key={slide.id}>
                        <strong>{slide.title}</strong>
                        <span>{slide.layout} · {slide.notes}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="export-detail-panel share-link-state" aria-label="Share link state">
                  <h4>Share Link State</h4>
                  <ShareLinkState state={state} exportId={latestExport.id} runAction={runAction} />
                </section>
              </div>
            </>
          ) : (
            <p>No export has been created for this local alpha workspace.</p>
          )}
        </article>
      </div>
    </section>
  );
}

function ShareLinkState({
  state,
  exportId,
  runAction,
  compact = false
}: {
  state: WorkspaceState;
  exportId: string;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
  compact?: boolean;
}) {
  const shareLink = state.shareLinks.find((item) => item.exportId === exportId);

  return (
    <div className={compact ? "share-state compact-share" : "share-state"}>
      <div>
        <strong>{shareLink ? `Share ${shareLink.status}` : "Share private"}</strong>
        <span>{shareLink?.reason ?? "Local alpha exports stay private until signed sharing is available."}</span>
      </div>
      <button
        className="secondary-button compact"
        disabled={Boolean(shareLink)}
        onClick={() => void runAction("share", () => zenArtClient.createShareLink(exportId))}
      >
        <Link2 size={15} aria-hidden="true" />
        Request Share
      </button>
    </div>
  );
}

function BillingView({
  state,
  busy,
  runAction
}: {
  state: WorkspaceState;
  busy: string | null;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const remaining = Math.max(0, state.billing.quotaLimit - state.billing.quotaUsed);
  const billingScenarios: Array<{ key: BillingScenario; label: string }> = [
    { key: "trialing", label: "Trial" },
    { key: "active", label: "Active" },
    { key: "past_due", label: "Past Due" },
    { key: "inactive", label: "Inactive" },
    { key: "quota_exhausted", label: "No Quota" }
  ];
  const isBlocked = state.billing.status === "inactive" || state.billing.status === "past_due" || remaining === 0;

  return (
    <section className="content-view">
      <div className="section-title">
        <h2>Billing and Quota</h2>
        <Link href="/legal/billing-policy">Billing policy</Link>
      </div>
      <div className="billing-layout">
        <article className="billing-card">
          <span className="eyebrow">Subscription</span>
          <h3>{state.billing.name}</h3>
          <p>Status: {state.billing.status}</p>
          <p>Renewal: {state.billing.renewalMode}</p>
          {isBlocked ? (
            <div className="inline-alert" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{remaining === 0 ? "Quota is exhausted. Exports are blocked without spending more credits." : "Subscription is not active. Quota-consuming actions are blocked."}</span>
            </div>
          ) : null}
          <button className="primary-button" disabled={busy === "checkout"} onClick={() => void runAction("checkout", () => zenArtClient.createMockCheckout())}>
            <CircleDollarSign size={18} aria-hidden="true" />
            Mock Checkout
          </button>
        </article>
        <article className="billing-card">
          <span className="eyebrow">Quota</span>
          <h3>{remaining} credits remaining</h3>
          <p>Weekly reset: {dateLabel(state.billing.resetAt)}</p>
          <div className="meter large" role="progressbar" aria-label="Billing quota used" aria-valuemin={0} aria-valuemax={state.billing.quotaLimit} aria-valuenow={state.billing.quotaUsed}>
            <span style={{ width: `${Math.round((state.billing.quotaUsed / state.billing.quotaLimit) * 100)}%` }} />
          </div>
        </article>
        <article className="billing-card edge-state-panel">
          <span className="eyebrow">Edge States</span>
          <h3>Local alpha scenarios</h3>
          <div className="segmented-control" aria-label="Billing edge state scenarios">
            {billingScenarios.map((scenario) => (
              <button
                key={scenario.key}
                className="secondary-button compact"
                disabled={busy === "billing-scenario"}
                onClick={() => void runAction("billing-scenario", () => zenArtClient.setBillingScenario(scenario.key))}
              >
                {scenario.label}
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function AccountView({
  state,
  runAction
}: {
  state: WorkspaceState;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const [settings, setSettings] = useState<AccountSettings>(state.account);

  useEffect(() => {
    setSettings(state.account);
  }, [state.account]);

  return (
    <section className="content-view">
      <div className="section-title">
        <h2>Account Settings</h2>
      </div>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction("account", () => zenArtClient.updateAccount(settings));
        }}
      >
        <label>
          Brand name
          <input value={settings.brandName} onChange={(event) => setSettings({ ...settings, brandName: event.target.value })} />
        </label>
        <label>
          Default export
          <select value={settings.defaultExportFormat} onChange={(event) => setSettings({ ...settings, defaultExportFormat: event.target.value as ExportFormat })}>
            <option value="zip">ZIP package</option>
            <option value="pdf-placeholder">PDF placeholder</option>
          </select>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.emailNotifications}
            onChange={(event) => setSettings({ ...settings, emailNotifications: event.target.checked })}
          />
          Email notifications
        </label>
        <button className="primary-button">
          <Settings size={18} aria-hidden="true" />
          Save Settings
        </button>
      </form>
    </section>
  );
}

function SupportView({
  state,
  busy,
  body,
  category,
  setBody,
  setCategory,
  reportProblem
}: {
  state: WorkspaceState;
  busy: string | null;
  body: string;
  category: "bug" | "billing" | "export" | "quality" | "other";
  setBody: (value: string) => void;
  setCategory: (value: "bug" | "billing" | "export" | "quality" | "other") => void;
  reportProblem: (event: FormEvent) => void;
}) {
  const problemContext = buildSupportProblemContext(state, state.exports[0]?.id);

  return (
    <section className="content-view">
      <div className="section-title">
        <h2>Report Problem</h2>
        <a href={`mailto:${supportContactEmail}`}>{supportContactEmail}</a>
      </div>
      <section className="support-context" aria-label="Attached support context">
        <div>
          <span className="eyebrow">Attached Context</span>
          <strong>{problemContext.projectName}</strong>
        </div>
        <dl>
          <div>
            <dt>Export</dt>
            <dd>{problemContext.linkedExportId ?? "No export yet"}</dd>
          </div>
          <div>
            <dt>Task</dt>
            <dd>{problemContext.linkedTaskId}</dd>
          </div>
          <div>
            <dt>Trace</dt>
            <dd>{problemContext.linkedTraceId}</dd>
          </div>
          <div>
            <dt>Assets</dt>
            <dd>{problemContext.linkedAssetNames.length > 0 ? problemContext.linkedAssetNames.join(", ") : "No accepted references"}</dd>
          </div>
          <div>
            <dt>Quota</dt>
            <dd>
              {problemContext.linkedQuotaSnapshot.used}/{problemContext.linkedQuotaSnapshot.limit} used ·{" "}
              {problemContext.linkedQuotaSnapshot.status}
            </dd>
          </div>
        </dl>
      </section>
      <section className="legal-notice-grid" aria-label="Privacy and AI content notices">
        <article className="legal-notice privacy-notice">
          <span className="eyebrow">Privacy Notice</span>
          <p>
            Support tickets attach project, export, task, trace, accepted reference, and quota context for investigation. Do not include secrets,
            credentials, or unrelated personal data in ticket text.
          </p>
          <Link href="/legal/privacy">Privacy Policy</Link>
        </article>
        <article className="legal-notice ai-content-disclaimer">
          <span className="eyebrow">AI Content Responsibility</span>
          <p>
            Local alpha previews use deterministic generation evidence unless a real provider is explicitly configured. Review rights, claims,
            likeness, and brand usage before sharing exported assets.
          </p>
          <Link href="/legal/acceptable-use">Acceptable Use Policy</Link>
        </article>
      </section>
      <section className="policy-link-grid" aria-label="Legal and policy routes">
        {legalPolicyList.map((policy) => (
          <Link key={policy.key} href={policy.route}>
            <strong>{policy.title}</strong>
            <span>{policy.summary}</span>
          </Link>
        ))}
      </section>
      <form className="support-form" onSubmit={reportProblem}>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
            <option value="quality">Quality</option>
            <option value="export">Export</option>
            <option value="billing">Billing</option>
            <option value="bug">Bug</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="sr-only" htmlFor="support-body">Problem description</label>
        <textarea id="support-body" value={body} onChange={(event) => setBody(event.target.value)} rows={6} placeholder="Describe what went wrong." />
        <button className="primary-button" disabled={busy === "support" || !body.trim()}>
          <Flag size={18} aria-hidden="true" />
          Submit Ticket
        </button>
      </form>
      <div className="history-list tickets">
        {state.supportTickets.map((ticket) => (
          <article key={ticket.id}>
            <strong>{ticket.id} · {ticket.category}</strong>
            <span>{ticket.status} · {ticket.projectName} · quota {ticket.linkedQuotaSnapshot.used}/{ticket.linkedQuotaSnapshot.limit}</span>
            <span>
              export {ticket.linkedExportId ?? "none"} · task {ticket.linkedTaskId} · trace {ticket.linkedTraceId} · assets {ticket.linkedAssetIds.length}
            </span>
            <p>{ticket.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}
