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
  Loader2,
  PackagePlus,
  RefreshCcw,
  RotateCcw,
  Save,
  Send,
  Settings,
  Sparkles,
  Upload,
  User
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AccountSettings, Candidate, ExportFormat, QaSeverity, WorkspaceState } from "@/lib/contracts";
import { zenArtClient } from "@/lib/api-client";
import { downloadExportPackage } from "@/lib/export-download";

type ViewKey = "workspace" | "projects" | "billing" | "account" | "support";

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

export function WorkspaceApp() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [view, setView] = useState<ViewKey>("workspace");
  const [briefInput, setBriefInput] = useState("");
  const [iterationInput, setIterationInput] = useState("");
  const [supportBody, setSupportBody] = useState("");
  const [supportCategory, setSupportCategory] = useState<"bug" | "billing" | "export" | "quality" | "other">("quality");
  const [referenceName, setReferenceName] = useState("visual-reference.png");
  const [busy, setBusy] = useState<string | null>(null);

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

  const selectedCandidate = useMemo(
    () => state?.candidates.find((candidate) => candidate.id === state.selectedCandidateId),
    [state]
  );

  const quotaPercent = state ? Math.round((state.billing.quotaUsed / state.billing.quotaLimit) * 100) : 0;

  const runAction = async (label: string, action: () => Promise<WorkspaceState>) => {
    setBusy(label);
    try {
      setState(await action());
    } finally {
      setBusy(null);
    }
  };

  const confirmBrief = (event: FormEvent) => {
    event.preventDefault();
    void runAction("brief", () => zenArtClient.confirmBrief(briefInput));
  };

  const iterate = (event: FormEvent) => {
    event.preventDefault();
    const instruction = iterationInput;
    setIterationInput("");
    void runAction("iterate", () => zenArtClient.iterateSelected(instruction));
  };

  const reportProblem = (event: FormEvent) => {
    event.preventDefault();
    const body = supportBody;
    setSupportBody("");
    void runAction("support", () =>
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
          <NavButton icon={<Sparkles size={18} />} label="Workspace" active={view === "workspace"} onClick={() => setView("workspace")} />
          <NavButton icon={<LayoutDashboard size={18} />} label="Projects" active={view === "projects"} onClick={() => setView("projects")} />
          <NavButton icon={<CircleDollarSign size={18} />} label="Billing" active={view === "billing"} onClick={() => setView("billing")} />
          <NavButton icon={<User size={18} />} label="Account" active={view === "account"} onClick={() => setView("account")} />
          <NavButton icon={<LifeBuoy size={18} />} label="Support" active={view === "support"} onClick={() => setView("support")} />
        </nav>
        <div className="quota-card">
          <div className="quota-head">
            <span>{state.billing.name}</span>
            <strong>{state.billing.quotaLimit - state.billing.quotaUsed}</strong>
          </div>
          <div className="meter" aria-label={`${quotaPercent}% quota used`}>
            <span style={{ width: `${quotaPercent}%` }} />
          </div>
          <small>{state.billing.quotaUsed} of {state.billing.quotaLimit} credits used</small>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div>
            <span className="eyebrow">Project</span>
            <h1>{state.projects.find((project) => project.id === state.activeProjectId)?.name}</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => void runAction("load", () => zenArtClient.loadWorkspace())} aria-label="Reload workspace">
              <RefreshCcw size={18} />
            </button>
            <span className="session-pill">{state.session.email}</span>
          </div>
        </header>

        {view === "workspace" && (
          <WorkspaceView
            state={state}
            busy={busy}
            briefInput={briefInput}
            iterationInput={iterationInput}
            referenceName={referenceName}
            selectedCandidate={selectedCandidate}
            setBriefInput={setBriefInput}
            setIterationInput={setIterationInput}
            setReferenceName={setReferenceName}
            confirmBrief={confirmBrief}
            iterate={iterate}
            runAction={runAction}
          />
        )}
        {view === "projects" && <ProjectsView state={state} />}
        {view === "billing" && <BillingView state={state} busy={busy} runAction={runAction} />}
        {view === "account" && <AccountView state={state} runAction={runAction} />}
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

function NavButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={active ? "nav-button active" : "nav-button"} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function WorkspaceView({
  state,
  busy,
  briefInput,
  iterationInput,
  referenceName,
  selectedCandidate,
  setBriefInput,
  setIterationInput,
  setReferenceName,
  confirmBrief,
  iterate,
  runAction
}: {
  state: WorkspaceState;
  busy: string | null;
  briefInput: string;
  iterationInput: string;
  referenceName: string;
  selectedCandidate?: Candidate;
  setBriefInput: (value: string) => void;
  setIterationInput: (value: string) => void;
  setReferenceName: (value: string) => void;
  confirmBrief: (event: FormEvent) => void;
  iterate: (event: FormEvent) => void;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  return (
    <div className="workspace-grid">
      <section className="panel chat-panel">
        <PanelTitle icon={<Sparkles size={18} />} title="Brief" />
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
            <div className="missing-info">
              <AlertTriangle size={16} />
              <span>Missing: {state.brief.missingInfo.join(", ")}</span>
            </div>
          )}
          <textarea value={briefInput} onChange={(event) => setBriefInput(event.target.value)} rows={5} />
          <button className="primary-button" disabled={busy === "brief" || !briefInput.trim()}>
            <Check size={18} />
            Confirm Brief
          </button>
        </form>
        <div className="reference-row">
          <input value={referenceName} onChange={(event) => setReferenceName(event.target.value)} />
          <button
            className="secondary-button"
            onClick={() =>
              void runAction("reference", () =>
                zenArtClient.attachReference({
                  name: referenceName,
                  kind: referenceName.startsWith("http") ? "url" : "image"
                })
              )
            }
          >
            <Upload size={17} />
            Attach
          </button>
        </div>
        <div className="reference-list">
          {state.brief.references.map((reference) => (
            <span key={reference.id}>
              <ImagePlus size={14} />
              {reference.name}
            </span>
          ))}
        </div>
      </section>

      <section className="panel canvas-panel">
        <div className="panel-header">
          <PanelTitle icon={<Save size={18} />} title="Canvas" />
          <span className="soft-label">Autosaved {dateLabel(state.canvas.autosavedAt)}</span>
        </div>
        <div className="canvas-surface">
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
            >
              <History size={14} />
              {version.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel candidates-panel">
        <PanelTitle icon={<Archive size={18} />} title="Candidates" />
        <div className="candidate-grid">
          {state.candidates.map((candidate) => (
            <article key={candidate.id} className={state.selectedCandidateId === candidate.id ? "candidate-card selected" : "candidate-card"}>
              <div className="swatches">
                {candidate.palette.map((color) => (
                  <span key={color} style={{ background: color }} />
                ))}
              </div>
              <h2>{candidate.title}</h2>
              <p>{candidate.strategy}</p>
              <small>{candidate.rationale}</small>
              <button className="secondary-button" onClick={() => void runAction("select", () => zenArtClient.selectCandidate(candidate.id))}>
                <ChevronRight size={17} />
                Select
              </button>
            </article>
          ))}
        </div>
        <form className="iteration-form" onSubmit={iterate}>
          <input
            value={iterationInput}
            onChange={(event) => setIterationInput(event.target.value)}
            placeholder={selectedCandidate ? `Iterate ${selectedCandidate.title}` : "Select a candidate to iterate"}
          />
          <button className="primary-button" disabled={!selectedCandidate || !iterationInput.trim()}>
            <Send size={18} />
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
      <PanelTitle icon={<PackagePlus size={18} />} title="Package" />
      <div className="package-actions">
        <button
          className="secondary-button"
          disabled={!state.selectedCandidateId}
          onClick={() => {
            const candidateId = state.selectedCandidateId;
            if (candidateId) {
              void runAction("package", () => zenArtClient.addPackageItem(candidateId));
            }
          }}
        >
          <PackagePlus size={17} />
          Add Selection
        </button>
        <button className="primary-button" onClick={() => void runAction("export", () => zenArtClient.createExport("zip"))}>
          <Download size={17} />
          Export ZIP
        </button>
        <button className="secondary-button" onClick={() => void runAction("export", () => zenArtClient.createExport("pdf-placeholder"))}>
          <FileArchive size={17} />
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
            <div className="qa-list">
              {item.qaReport.map((finding) => (
                <span key={finding.id} className={severityClass[finding.severity]}>
                  {finding.severity}: {finding.title}
                </span>
              ))}
            </div>
            {item.status === "ready" ? (
              <button className="secondary-button compact" onClick={() => void downloadExportPackage(item)}>
                <Download size={15} />
                Download
              </button>
            ) : null}
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
        <Sparkles size={22} />
        <strong>Workflow examples</strong>
        <span>Campaign direction, product launch kit, editorial board, presentation asset package.</span>
      </div>
    </section>
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
  const remaining = state.billing.quotaLimit - state.billing.quotaUsed;
  return (
    <section className="content-view">
      <div className="section-title">
        <h2>Billing and Quota</h2>
      </div>
      <div className="billing-layout">
        <article className="billing-card">
          <span className="eyebrow">Subscription</span>
          <h3>{state.billing.name}</h3>
          <p>Status: {state.billing.status}</p>
          <p>Renewal: {state.billing.renewalMode}</p>
          <button className="primary-button" disabled={busy === "checkout"} onClick={() => void runAction("checkout", () => zenArtClient.createMockCheckout())}>
            <CircleDollarSign size={18} />
            Mock Checkout
          </button>
        </article>
        <article className="billing-card">
          <span className="eyebrow">Quota</span>
          <h3>{remaining} credits remaining</h3>
          <p>Weekly reset: {dateLabel(state.billing.resetAt)}</p>
          <div className="meter large">
            <span style={{ width: `${Math.round((state.billing.quotaUsed / state.billing.quotaLimit) * 100)}%` }} />
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
          <Settings size={18} />
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
  return (
    <section className="content-view">
      <div className="section-title">
        <h2>Report Problem</h2>
      </div>
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
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} placeholder="Describe what went wrong." />
        <button className="primary-button" disabled={busy === "support" || !body.trim()}>
          <Flag size={18} />
          Submit Ticket
        </button>
      </form>
      <div className="history-list tickets">
        {state.supportTickets.map((ticket) => (
          <article key={ticket.id}>
            <strong>{ticket.id} · {ticket.category}</strong>
            <span>{ticket.status} · quota {ticket.linkedQuotaSnapshot.used}/{ticket.linkedQuotaSnapshot.limit}</span>
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
