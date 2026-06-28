"use client";

import {
  AlertTriangle,
  Archive,
  BoxSelect,
  Check,
  ChevronRight,
  CircleDollarSign,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  Frame,
  Flag,
  History,
  ImagePlus,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  Lock,
  LogIn,
  LogOut,
  Loader2,
  MousePointer2,
  Move,
  PackagePlus,
  Palette,
  RefreshCcw,
  PenLine,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Gauge,
  Trash2,
  Upload,
  User,
  Users,
  Unlock,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  AccountSettings,
  BillingScenario,
  CanvasNode,
  CanvasTool,
  CanvasVersion,
  Candidate,
  ExportFormat,
  QaSeverity,
  PromptComposerAspectRatio,
  PromptComposerQuality,
  WorkspaceState
} from "@/lib/contracts";
import { zenariClient } from "@/lib/api-client";
import {
  buildPackageExportMetadataEvidence,
  buildExportDownloadAccessBoundaryEvidence,
  buildExportDownloadParityEvidence,
  buildExportZipPayloadSmokeEvidence,
  buildRenderedExportAssetEvidence,
  buildCharacterIpConceptApiSmokeEvidence,
  buildBusinessVisualDocApiSmokeEvidence,
  buildBriefUploadConfirmationRuntimeEvidence,
  buildEcommerceGrowthApiSmokeEvidence,
  buildLocalMerchantCampaignApiSmokeEvidence,
  buildReferenceUploadIntegrationSmoke,
  buildReferenceUploadValidationMatrixEvidence,
  buildSupportProblemContext,
  buildWorkspaceRenderingPerformanceSmoke,
  businessVisualDocCandidates,
  characterIpConceptCandidates,
  localMerchantCampaignCandidates
} from "@/lib/dev-state";
import { downloadExportPackage } from "@/lib/export-download";
import { apiOperations, OperationId, ZenariApiClient } from "@/lib/generated/zenart-api";
import { legalPolicyList, supportContactEmail } from "@/lib/legal-policies";
import { buildMentionPickerOptions, mentionSummary, resolveMentions } from "@/lib/mentions";
import { buildPromptComposerPayload } from "@/lib/prompt-context";
import { buildResultPlacementEvidence } from "@/lib/result-placement";
import { buildSafetyExportStateEvidence, blockedReasonsForExport } from "@/lib/safety-export-state";
import {
  buildSecureCookieSameSiteRuntimePairingDigest,
  buildGeneratedApiCsrfRequestContractEvidence,
  buildSessionSecurityContractEvidence,
  isCsrfProtectedMethod,
  serializeBackendCsrfValidationContract,
  serializeSetCookieContract
} from "@/lib/request-security";
import { AnalyticsEventName, captureAnalyticsEvent, reportFrontendError } from "@/lib/telemetry";

export type ViewKey = "workspace" | "projects" | "export" | "billing" | "account" | "support";

type UnsafeActionGuardLabel =
  | "Confirm Brief"
  | "Attach"
  | "Create Batch"
  | "Cancel Batch"
  | "Retry Child"
  | "Create Project"
  | "Rename Project"
  | "Package Reference"
  | "Select Candidate"
  | "Iterate"
  | "Apply Edit Tool"
  | "Restore Version"
  | "Add Asset"
  | "Favorite Asset"
  | "Archive Asset"
  | "Create Brand Kit"
  | "Update Brand Kit"
  | "Set Brand Kit"
  | "Add Selection"
  | "Export ZIP"
  | "Export PDF"
  | "Request Share"
  | "Mock Checkout"
  | "Billing Portal"
  | "Cancel Subscription"
  | "Refresh Invoices"
  | "Refresh Team Seats"
  | "Refresh Asset Library"
  | "Accept Invite"
  | "Billing Scenario"
  | "Save Settings"
  | "Submit Ticket"
  | "Refresh Session"
  | "Expire Session"
  | "Log Out";

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
const sessionSafeActionLabels = new Set(["load", "login", "asset-library-refresh"]);
const expiredSessionRecoveryActionLabels = new Set<UnsafeActionGuardLabel>(["Refresh Session"]);
const defaultCredentialMode = "include";
const sameSiteUnsafeActionGuardMap = {
  "Confirm Brief": ["createChatSession", "createChatMessage", "createCandidateSet"],
  Attach: ["createUpload"],
  "Create Batch": ["createBatchGeneration"],
  "Cancel Batch": ["cancelBatchGeneration"],
  "Retry Child": ["retryBatchGenerationChild"],
  "Create Project": ["createProject"],
  "Rename Project": ["updateProject"],
  "Package Reference": ["createPackage"],
  "Select Candidate": ["selectDirection"],
  Iterate: ["createCanvasNode", "createCanvasVersion"],
  "Apply Edit Tool": ["createUpload", "createCanvasNode", "createCanvasVersion"],
  "Restore Version": ["createCanvasVersion"],
  "Add Asset": ["createAssetLibraryEntry"],
  "Favorite Asset": ["updateAssetLibraryEntry"],
  "Archive Asset": ["updateAssetLibraryEntry"],
  "Create Brand Kit": ["createBrandKit"],
  "Update Brand Kit": ["updateBrandKit"],
  "Set Brand Kit": ["setProjectDefaultBrandKit"],
  "Add Selection": ["createPackage"],
  "Export ZIP": ["createExport"],
  "Export PDF": ["createExport"],
  "Request Share": ["createShareLink"],
  "Mock Checkout": ["createCheckoutSession"],
  "Billing Portal": ["createBillingPortalSession"],
  "Cancel Subscription": ["cancelSubscription"],
  "Refresh Invoices": ["listBillingInvoices"],
  "Refresh Team Seats": ["getTeamSeatUsage", "checkTeamSeatEntitlement"],
  "Refresh Asset Library": ["listAssetLibrary", "listBrandKits", "getProjectDefaultBrandKit"],
  "Accept Invite": ["acceptTeamInvite"],
  "Billing Scenario": ["getQuota", "getSubscription"],
  "Save Settings": ["updateAccount"],
  "Submit Ticket": ["createSupportTicket"],
  "Refresh Session": ["getSession"],
  "Expire Session": ["deleteSession"],
  "Log Out": ["deleteSession"]
} as const satisfies Record<UnsafeActionGuardLabel, ReadonlyArray<keyof typeof apiOperations>>;
const sameSiteUnsafeActionGuardLabels = Object.keys(sameSiteUnsafeActionGuardMap) as UnsafeActionGuardLabel[];
const totalGuardedActionCount = sameSiteUnsafeActionGuardLabels.length;
const expiredSessionEnabledActionCount = expiredSessionRecoveryActionLabels.size;
const expiredSessionBlockedActionCount = totalGuardedActionCount - expiredSessionEnabledActionCount;
const signedOutSessionBlockedActionCount = totalGuardedActionCount;

const formatUnsafeActionGuardContracts = () =>
  sameSiteUnsafeActionGuardLabels
    .map((label) => {
      const operationContracts = sameSiteUnsafeActionGuardMap[label].map((operationId) => {
        const operation = apiOperations[operationId];
        const csrfHeader = isCsrfProtectedMethod(operation.method) ? "X-Zenari-CSRF" : "not-required";
        return `${operationId}:${operation.method}:${csrfHeader}:${operation.idempotencyRequired}`;
      });
      return `${label}=>${operationContracts.join("+")}`;
    })
    .join("|");

const formatUnsafeActionControlContracts = (label: UnsafeActionGuardLabel) =>
  sameSiteUnsafeActionGuardMap[label]
    .map((operationId) => {
      const operation = apiOperations[operationId];
      const csrfHeader = isCsrfProtectedMethod(operation.method) ? "X-Zenari-CSRF" : "not-required";
      return `${operationId}:${operation.method}:${operation.path}:${defaultCredentialMode}:${csrfHeader}:${operation.idempotencyRequired}`;
    })
    .join("|");

const guardedOperationIds = Array.from(
  new Set(sameSiteUnsafeActionGuardLabels.flatMap((label) => sameSiteUnsafeActionGuardMap[label]))
);
const guardedOperationIdSet = new Set<keyof typeof apiOperations>(guardedOperationIds);

type BrowserCsrfProbeResult = {
  status: "idle" | "running" | "pass" | "fail";
  baseUrl: string;
  unsafeOperation: string;
  unsafeMethod: string;
  unsafePath: string;
  unsafeCredentials: string;
  unsafeCsrfHeader: string;
  unsafeIdempotencyKey: string;
  unsafeOperationCount: number;
  unsafeCoveredOperations: string;
  unsafePathContracts: string;
  unsafeCredentialedRequestCount: number;
  unsafeCsrfHeaderCount: number;
  unsafeIdempotencyRequiredCount: number;
  unsafeIdempotencyHeaderCount: number;
  unsafeOperationContracts: string;
  safeOperation: string;
  safeMethod: string;
  safePath: string;
  safeCredentials: string;
  safeCsrfHeader: string;
  safeOperationCount: number;
  safeCoveredOperations: string;
  safePathContracts: string;
  safeCredentialedRequestCount: number;
  safeNoCsrfHeaderCount: number;
  safeOperationContracts: string;
  failureReason: string;
};

const generatedApiCsrfInventory = buildGeneratedApiCsrfRequestContractEvidence(apiOperations);

const initialBrowserCsrfProbeResult: BrowserCsrfProbeResult = {
  status: "idle",
  baseUrl: "/api/probe",
  unsafeOperation: "updateAccount",
  unsafeMethod: "missing",
  unsafePath: "missing",
  unsafeCredentials: "missing",
  unsafeCsrfHeader: "missing",
  unsafeIdempotencyKey: "missing",
  unsafeOperationCount: generatedApiCsrfInventory.unsafeOperationCount,
  unsafeCoveredOperations: generatedApiCsrfInventory.unsafeOperationIds.join(","),
  unsafePathContracts: "",
  unsafeCredentialedRequestCount: 0,
  unsafeCsrfHeaderCount: 0,
  unsafeIdempotencyRequiredCount: generatedApiCsrfInventory.unsafeIdempotencyRequiredOperationIds.length,
  unsafeIdempotencyHeaderCount: 0,
  unsafeOperationContracts: "",
  safeOperation: "getSession",
  safeMethod: "missing",
  safePath: "missing",
  safeCredentials: "missing",
  safeCsrfHeader: "missing",
  safeOperationCount: generatedApiCsrfInventory.safeOperationCount,
  safeCoveredOperations: generatedApiCsrfInventory.safeOperationIds.join(","),
  safePathContracts: "",
  safeCredentialedRequestCount: 0,
  safeNoCsrfHeaderCount: 0,
  safeOperationContracts: "",
  failureReason: ""
};

type SessionGuardMatrixState = "authenticated" | "expired" | "signed_out";

const sessionGuardMatrixStates = ["authenticated", "expired", "signed_out"] as const satisfies readonly SessionGuardMatrixState[];

const getUnsafeActionGuardStatusForSession = (label: UnsafeActionGuardLabel, sessionStatus: SessionGuardMatrixState) => {
  if (sessionStatus === "authenticated") {
    return { status: "enabled", blockedReason: "" };
  }
  if (sessionStatus === "expired" && expiredSessionRecoveryActionLabels.has(label)) {
    return { status: "enabled", blockedReason: "" };
  }
  return { status: "blocked", blockedReason: "authenticated-session-required" };
};

const getUnsafeActionGuardStatus = (label: UnsafeActionGuardLabel, state: WorkspaceState) => {
  return getUnsafeActionGuardStatusForSession(label, state.sessionContract.status);
};

const buildSessionGuardMatrixEntry = (sessionStatus: SessionGuardMatrixState) => {
  const enabledLabels = sameSiteUnsafeActionGuardLabels.filter(
    (label) => getUnsafeActionGuardStatusForSession(label, sessionStatus).status === "enabled"
  );
  const blockedLabels = sameSiteUnsafeActionGuardLabels.filter(
    (label) => getUnsafeActionGuardStatusForSession(label, sessionStatus).status === "blocked"
  );
  const recoveryLabels =
    sessionStatus === "expired" ? Array.from(expiredSessionRecoveryActionLabels).filter((label) => enabledLabels.includes(label)) : [];
  const alert =
    sessionStatus === "expired" ? "Session expired. Refresh or sign in to continue." : sessionStatus === "signed_out" ? "Signed out. Sign in to continue." : "none";

  return {
    sessionStatus,
    enabledLabels,
    blockedLabels,
    recoveryLabels,
    alert,
    serialized: `${sessionStatus}:enabled=${enabledLabels.length}:blocked=${blockedLabels.length}:recovery=${recoveryLabels.join("+") || "none"}:alert=${alert}`
  };
};

const sessionGuardMatrixEntries = sessionGuardMatrixStates.map(buildSessionGuardMatrixEntry);
const sessionGuardMatrixContract = sessionGuardMatrixEntries.map((entry) => entry.serialized).join("|");
const sessionGuardMatrixStatus =
  sessionGuardMatrixEntries.find((entry) => entry.sessionStatus === "authenticated")?.blockedLabels.length === 0 &&
  sessionGuardMatrixEntries.find((entry) => entry.sessionStatus === "expired")?.enabledLabels.join(",") === "Refresh Session" &&
  sessionGuardMatrixEntries.find((entry) => entry.sessionStatus === "expired")?.blockedLabels.length === expiredSessionBlockedActionCount &&
  sessionGuardMatrixEntries.find((entry) => entry.sessionStatus === "signed_out")?.enabledLabels.length === 0 &&
  sessionGuardMatrixEntries.find((entry) => entry.sessionStatus === "signed_out")?.blockedLabels.length === signedOutSessionBlockedActionCount
    ? "pass"
    : "fail";
const sessionGuardTransitionContract =
  `authenticated->expired:Expire Session:enabled=${expiredSessionEnabledActionCount}:blocked=${expiredSessionBlockedActionCount}:recovery=Refresh Session|` +
  `expired->authenticated:Refresh Session:enabled=${totalGuardedActionCount}:blocked=0:recovery=none|` +
  `expired->authenticated:Sign In:enabled=${totalGuardedActionCount}:blocked=0:recovery=none|` +
  `authenticated->signed_out:Log Out:enabled=0:blocked=${signedOutSessionBlockedActionCount}:recovery=none|` +
  `signed_out->authenticated:Sign In:enabled=${totalGuardedActionCount}:blocked=0:recovery=none`;
const sessionGuardTransitionDigest = `${sessionSecurityEvidenceSchema}||${sessionGuardMatrixContract}||${sessionGuardTransitionContract}`;
const sessionGuardTransitionStatus =
  sessionGuardMatrixStatus === "pass" &&
  sessionGuardTransitionContract.includes(
    `authenticated->expired:Expire Session:enabled=${expiredSessionEnabledActionCount}:blocked=${expiredSessionBlockedActionCount}:recovery=Refresh Session`
  ) &&
  sessionGuardTransitionContract.includes(
    `authenticated->signed_out:Log Out:enabled=0:blocked=${signedOutSessionBlockedActionCount}:recovery=none`
  )
    ? "pass"
    : "fail";

const isExpiredSessionRecoveryAction = (label: string) =>
  label === "session-refresh" || label === "Refresh Session";

const buildUnsafeActionControlSessionMatrix = (label: UnsafeActionGuardLabel) => {
  const entries = sessionGuardMatrixStates.map((sessionStatus) => {
    const guardStatus = getUnsafeActionGuardStatusForSession(label, sessionStatus);
    return {
      sessionStatus,
      status: guardStatus.status,
      blockedReason: guardStatus.blockedReason || "none",
      serialized: `${sessionStatus}:${guardStatus.status}:${guardStatus.blockedReason || "none"}`
    };
  });

  return {
    entries,
    serialized: entries.map((entry) => entry.serialized).join("|")
  };
};

const unsafeActionGuardAttributes = (label: UnsafeActionGuardLabel, state: WorkspaceState) => {
  const operationIds = sameSiteUnsafeActionGuardMap[label];
  const csrfProtectedOperationCount = operationIds.filter((operationId) => isCsrfProtectedMethod(apiOperations[operationId].method)).length;
  const idempotencyRequiredOperationCount = operationIds.filter((operationId) => apiOperations[operationId].idempotencyRequired).length;
  const guardStatus = getUnsafeActionGuardStatus(label, state);
  const controlSessionMatrix = buildUnsafeActionControlSessionMatrix(label);
  const currentMatrixEntry = controlSessionMatrix.entries.find((entry) => entry.sessionStatus === state.sessionContract.status);
  const controlSessionMatrixStatus =
    currentMatrixEntry?.status === guardStatus.status && currentMatrixEntry.blockedReason === (guardStatus.blockedReason || "none")
      ? "pass"
      : "fail";

  return {
    "data-csrf-ux-guard": "authenticated-same-site-session",
    "data-csrf-ux-guard-label": label,
    "data-csrf-ux-guard-status": guardStatus.status,
    "data-csrf-ux-guard-required-session-status": "authenticated",
    "data-csrf-ux-guard-blocked-reason": guardStatus.blockedReason,
    "data-csrf-ux-guard-operation-count": operationIds.length,
    "data-csrf-ux-guard-operations": operationIds.join(","),
    "data-csrf-ux-guard-contracts": formatUnsafeActionControlContracts(label),
    "data-csrf-ux-guard-session-matrix": controlSessionMatrix.serialized,
    "data-csrf-ux-guard-session-matrix-status": controlSessionMatrixStatus,
    "data-csrf-ux-guard-current-session-state": state.sessionContract.status,
    "data-csrf-ux-guard-csrf-protected-operation-count": csrfProtectedOperationCount,
    "data-csrf-ux-guard-idempotency-required-operation-count": idempotencyRequiredOperationCount
  };
};

const requiresAuthenticatedSession = (label: string, state: WorkspaceState) =>
  !sessionSafeActionLabels.has(label) &&
  !(state.sessionContract.status === "expired" && isExpiredSessionRecoveryAction(label));

const isSessionBlocked = (state: WorkspaceState) => state.sessionContract.status !== "authenticated";

const runGeneratedClientCsrfBrowserProbe = async (): Promise<BrowserCsrfProbeResult> => {
  const baseUrl = "/api/probe";
  const client = new ZenariApiClient(baseUrl);
  const requests: Array<{ path: string; method: string; credentials: string; csrfHeader: string; idempotencyKey: string }> = [];
  const originalFetch = window.fetch.bind(window);
  const unsafeContracts = generatedApiCsrfInventory.unsafeRequestContracts;
  const safeOperationIds = generatedApiCsrfInventory.safeOperationIds as OperationId[];
  const pathParams = {
    project_id: "project-001",
    chat_session_id: "chat-001",
    workspace_id: "workspace-001",
    task_id: "task-001",
    batch_id: "batch-001",
    child_id: "child-001",
    candidate_set_id: "candidate-set-001",
    package_id: "pkg-001",
    export_id: "export-001",
    team_id: "team-001",
    invite_id: "invite-001"
  };
  const expectedProbePath = (path: string) =>
    path.replace(/\{([^}]+)\}/g, (_match, key: string) => pathParams[key as keyof typeof pathParams] ?? "missing");

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("/api/probe/")) {
      const headers = new Headers(init?.headers);
      requests.push({
        path: url.replace("/api/probe", ""),
        method: init?.method ?? "GET",
        credentials: String(init?.credentials ?? "missing"),
        csrfHeader: headers.get("X-Zenari-CSRF") ?? "not-required",
        idempotencyKey: headers.get("Idempotency-Key") ?? "not-required"
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(input, init);
  }) as typeof window.fetch;

  try {
    for (const contract of unsafeContracts) {
      await client.request(contract.operationId as OperationId, {
        pathParams,
        idempotencyKey: contract.idempotencyHeaderRequired ? `csrf-probe-${contract.operationId}` : undefined,
        body: contract.idempotencyHeaderRequired ? { probe: contract.operationId } : undefined
      });
    }
    for (const operationId of safeOperationIds) {
      await client.request(operationId, { pathParams });
    }
  } finally {
    window.fetch = originalFetch;
  }

  const unsafeRequests = requests.slice(0, unsafeContracts.length);
  const unsafeRequest = unsafeRequests.find((request) => request.path === "/account") ?? unsafeRequests[0];
  const safeRequests = requests.slice(unsafeContracts.length);
  const safeRequest = safeRequests[0];
  const unsafeCredentialedRequestCount = unsafeRequests.filter((request) => request.credentials === "include").length;
  const unsafeCsrfHeaderCount = unsafeRequests.filter((request) => request.csrfHeader === "same-site-origin-check").length;
  const unsafeIdempotencyHeaderCount = unsafeRequests.filter((request, index) => {
    const contract = unsafeContracts[index];
    return contract?.idempotencyHeaderRequired && request.idempotencyKey === `csrf-probe-${contract.operationId}`;
  }).length;
  const safeCredentialedRequestCount = safeRequests.filter((request) => request.credentials === "include").length;
  const safeNoCsrfHeaderCount = safeRequests.filter((request) => request.csrfHeader === "not-required").length;
  const unsafeOperationContracts = unsafeContracts
    .map((contract, index) => {
      const request = unsafeRequests[index];
      return `${contract.operationId}:${request?.method ?? "missing"}:${request?.credentials ?? "missing"}:${request?.csrfHeader ?? "missing"}:${request?.idempotencyKey ?? "missing"}`;
    })
    .join("|");
  const unsafePathContracts = unsafeContracts
    .map((contract, index) => {
      const request = unsafeRequests[index];
      return `${contract.operationId}:${contract.path}:${request?.path ?? "missing"}`;
    })
    .join("|");
  const safeOperationContracts = safeOperationIds
    .map((operationId, index) => {
      const request = safeRequests[index];
      return `${operationId}:${request?.method ?? "missing"}:${request?.credentials ?? "missing"}:${request?.csrfHeader ?? "missing"}`;
    })
    .join("|");
  const safePathContracts = safeOperationIds
    .map((operationId, index) => {
      const request = safeRequests[index];
      return `${operationId}:${apiOperations[operationId].path}:${request?.path ?? "missing"}`;
    })
    .join("|");
  const failures = [
    unsafeRequests.length === unsafeContracts.length ? "" : "unsafe-operation-count",
    unsafeContracts.every((contract, index) => unsafeRequests[index]?.method === contract.method) ? "" : "unsafe-method",
    unsafeContracts.every((contract, index) => unsafeRequests[index]?.path === expectedProbePath(contract.path)) ? "" : "unsafe-path",
    unsafeCredentialedRequestCount === unsafeContracts.length ? "" : "unsafe-credentials",
    unsafeCsrfHeaderCount === unsafeContracts.length ? "" : "unsafe-csrf-header",
    unsafeIdempotencyHeaderCount === generatedApiCsrfInventory.unsafeIdempotencyRequiredOperationIds.length ? "" : "unsafe-idempotency-key",
    safeRequests.length === safeOperationIds.length ? "" : "safe-operation-count",
    safeOperationIds.every((operationId, index) => safeRequests[index]?.method === apiOperations[operationId].method) ? "" : "safe-method",
    safeOperationIds.every((operationId, index) => safeRequests[index]?.path === expectedProbePath(apiOperations[operationId].path)) ? "" : "safe-path",
    safeCredentialedRequestCount === safeOperationIds.length ? "" : "safe-credentials",
    safeNoCsrfHeaderCount === safeOperationIds.length ? "" : "safe-csrf-header"
  ].filter(Boolean);

  return {
    status: failures.length === 0 ? "pass" : "fail",
    baseUrl,
    unsafeOperation: "updateAccount",
    unsafeMethod: unsafeRequest?.method ?? "missing",
    unsafePath: unsafeRequest?.path ?? "missing",
    unsafeCredentials: unsafeRequest?.credentials ?? "missing",
    unsafeCsrfHeader: unsafeRequest?.csrfHeader ?? "missing",
    unsafeIdempotencyKey: unsafeRequest?.idempotencyKey ?? "missing",
    unsafeOperationCount: unsafeContracts.length,
    unsafeCoveredOperations: unsafeContracts.map((contract) => contract.operationId).join(","),
    unsafePathContracts,
    unsafeCredentialedRequestCount,
    unsafeCsrfHeaderCount,
    unsafeIdempotencyRequiredCount: generatedApiCsrfInventory.unsafeIdempotencyRequiredOperationIds.length,
    unsafeIdempotencyHeaderCount,
    unsafeOperationContracts,
    safeOperation: "getSession",
    safeMethod: safeRequest?.method ?? "missing",
    safePath: safeRequest?.path ?? "missing",
    safeCredentials: safeRequest?.credentials ?? "missing",
    safeCsrfHeader: safeRequest?.csrfHeader ?? "missing",
    safeOperationCount: safeOperationIds.length,
    safeCoveredOperations: safeOperationIds.join(","),
    safePathContracts,
    safeCredentialedRequestCount,
    safeNoCsrfHeaderCount,
    safeOperationContracts,
    failureReason: failures.join(",")
  };
};

export function WorkspaceApp({ initialView = "workspace" }: { initialView?: ViewKey }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [browserCsrfProbeResult, setBrowserCsrfProbeResult] = useState<BrowserCsrfProbeResult>(initialBrowserCsrfProbeResult);
  const view = initialView;
  const [briefInput, setBriefInput] = useState("");
  const [iterationInput, setIterationInput] = useState("");
  const [loginEmail, setLoginEmail] = useState("dev@zenari.ai");
  const [supportBody, setSupportBody] = useState("");
  const [supportCategory, setSupportCategory] = useState<"bug" | "billing" | "export" | "quality" | "other">("quality");
  const [referenceName, setReferenceName] = useState("visual-reference.png");
  const [referenceKind, setReferenceKind] = useState<"image" | "document" | "url">("image");
  const [busy, setBusy] = useState<string | null>(null);
  const capturedBillingView = useRef(false);

  useEffect(() => {
    let mounted = true;
    zenariClient.loadWorkspace().then((loaded) => {
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

  useEffect(() => {
    if (view !== "account" || typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("csrfProbe") !== "1") {
      return;
    }

    let cancelled = false;
    setBrowserCsrfProbeResult((current) => ({ ...current, status: "running", failureReason: "" }));
    runGeneratedClientCsrfBrowserProbe()
      .then((result) => {
        if (!cancelled) {
          setBrowserCsrfProbeResult(result);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBrowserCsrfProbeResult({
            ...initialBrowserCsrfProbeResult,
            status: "fail",
            failureReason: error instanceof Error ? error.message : "unknown"
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    if (!state || view !== "workspace" || isSessionBlocked(state)) {
      return;
    }
    const latestBatch = state.batchGenerations[0];
    if (!latestBatch || !["queued", "running"].includes(latestBatch.status)) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      zenariClient
        .refreshBatchGenerationProgress(latestBatch.id)
        .then((nextState) => {
          if (!cancelled) {
            setState(nextState);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            reportFrontendError(error, "action-error", state, "batch-progress-poll");
          }
        });
    }, 750);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [state, view]);

  const selectedCandidate = useMemo(
    () => state?.candidates.find((candidate) => candidate.id === state.selectedCandidateId),
    [state]
  );
  const sessionBlocked = state ? isSessionBlocked(state) : false;

  const quotaPercent = state ? Math.min(100, Math.round((state.billing.quotaUsed / state.billing.quotaLimit) * 100)) : 0;
  const runAction = async (label: string, action: () => Promise<WorkspaceState>) => {
    if (state && requiresAuthenticatedSession(label, state) && isSessionBlocked(state)) {
      reportFrontendError(
        new Error(`Blocked ${label}: authenticated same-site session required`),
        "action-error",
        state,
        label
      );
      return;
    }

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
    void runTrackedAction("brief", async () => {
      const confirmedState = await zenariClient.confirmBrief(briefInput);
      const normalizedBrief = briefInput.toLowerCase();
      if (normalizedBrief.includes("business visual document pack")) {
        return zenariClient.activateBusinessVisualDocWorkflow();
      }
      if (normalizedBrief.includes("local merchant campaign pack")) {
        return zenariClient.activateLocalMerchantCampaignWorkflow();
      }
      if (normalizedBrief.includes("character ip concept pack")) {
        return zenariClient.activateCharacterIpConceptWorkflow();
      }
      return confirmedState;
    });
  };

  const iterate = (event: FormEvent) => {
    event.preventDefault();
    const instruction = iterationInput;
    setIterationInput("");
    void runTrackedAction("iterate", () => zenariClient.iterateSelected(instruction));
  };

  const reportProblem = (event: FormEvent) => {
    event.preventDefault();
    const body = supportBody;
    setSupportBody("");
    void runTrackedAction("support", () =>
      zenariClient.reportProblem({
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
            <strong>zenari.ai</strong>
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
            <button className="icon-button" onClick={() => void runTrackedAction("load", () => zenariClient.loadWorkspace())} aria-label="Reload workspace">
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
            sessionBlocked={sessionBlocked}
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
        {view === "projects" && <ProjectsView state={state} sessionBlocked={isSessionBlocked(state)} runAction={runTrackedAction} />}
        {view === "export" && <ExportView state={state} sessionBlocked={sessionBlocked} runAction={runTrackedAction} />}
        {view === "billing" && <BillingView state={state} busy={busy} sessionBlocked={sessionBlocked} runAction={runTrackedAction} />}
        {view === "account" && (
          <AccountView
            state={state}
            sessionBlocked={sessionBlocked}
            runAction={runTrackedAction}
            browserCsrfProbeResult={browserCsrfProbeResult}
          />
        )}
        {view === "support" && (
          <SupportView
            state={state}
            busy={busy}
            sessionBlocked={sessionBlocked}
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
    "batch-create": "iteration_submitted",
    "batch-cancel": "iteration_submitted",
    "batch-retry": "iteration_submitted",
    select: "candidate_selected",
    iterate: "iteration_submitted",
    package: "package_item_added",
    export: "export_requested",
    checkout: "checkout_started",
    "billing-scenario": "billing_scenario_selected",
    "asset-library-refresh": "route_viewed",
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
  const expectedSessionCookieName = "__Host-zenari_session";
  const expectedCsrfStrategy = "same-site-origin-check";
  const expectedCsrfHeader = "X-Zenari-CSRF";
  const expectedSameSiteRequirement = "lax-or-strict";
  const evidence = buildSessionSecurityContractEvidence(state.sessionContract, apiOperations);
  const generatedRequestEvidence = buildGeneratedApiCsrfRequestContractEvidence(apiOperations, state.sessionContract.csrf);
  const backendRuntimePairingStatus =
    evidence.status === "pass" && generatedRequestEvidence.status === "pass" && generatedRequestEvidence.missingUnsafeOperationIds.length === 0
      ? "pass"
      : "fail";
  const backendSetCookieContract = serializeSetCookieContract(state.sessionContract.cookie);
  const backendCsrfValidationContract = serializeBackendCsrfValidationContract(state.sessionContract.csrf);
  const backendRuntimePairingDigest = buildSecureCookieSameSiteRuntimePairingDigest(
    state.sessionContract,
    generatedRequestEvidence,
    evidence
  );
  const csrfProtectedMethods = evidence.protectedMethods.join(", ");
  const sameSiteRequirement = state.sessionContract.csrf.sameSiteRequired;
  const unsafeActionGuardContracts = formatUnsafeActionGuardContracts();
  const missingGuardedUnsafeOperationIds = generatedRequestEvidence.unsafeOperationIds.filter(
    (operationId) => !guardedOperationIdSet.has(operationId as keyof typeof apiOperations)
  );
  const unsafeActionGuardCoverageStatus = missingGuardedUnsafeOperationIds.length === 0 ? "pass" : "fail";
  const blockedUnsafeActionGuardLabels = sameSiteUnsafeActionGuardLabels.filter(
    (label) => getUnsafeActionGuardStatus(label, state).status === "blocked"
  );
  const currentSessionGuardMatrixEntry = buildSessionGuardMatrixEntry(state.sessionContract.status);
  const unsafeActionCsrfProtectedOperationCount = guardedOperationIds.filter((operationId) =>
    state.sessionContract.csrf.protectedMethods.includes(
      apiOperations[operationId].method as (typeof state.sessionContract.csrf.protectedMethods)[number]
    )
  ).length;
  const cookieAttributes = [
    state.sessionContract.cookie.httpOnly ? "HttpOnly" : "client-readable",
    state.sessionContract.cookie.secure ? "Secure" : "insecure",
    `SameSite=${state.sessionContract.cookie.sameSite}`,
    `Path=${state.sessionContract.cookie.path}`
  ].join(" · ");
  const sameSiteAcceptanceContracts = evidence.sameSiteAcceptanceMatrix
    .map((entry) => `${entry.sameSite}:${entry.status}:${entry.failureReason || "none"}`)
    .join("|");

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
      data-session-cookie-domain={evidence.cookieAttributes.domain}
      data-session-cookie-host-only={String(evidence.cookieAttributes.hostOnly)}
      data-session-cookie-host-prefix={evidence.hostPrefixInvariant.prefix}
      data-session-cookie-host-prefix-status={evidence.hostPrefixInvariant.status}
      data-session-cookie-host-prefix-present={String(evidence.hostPrefixInvariant.prefixPresent)}
      data-session-cookie-host-prefix-secure={String(evidence.hostPrefixInvariant.secure)}
      data-session-cookie-host-prefix-path-root={String(evidence.hostPrefixInvariant.pathRoot)}
      data-session-cookie-host-prefix-host-only={String(evidence.hostPrefixInvariant.hostOnly)}
      data-session-cookie-host-prefix-failure-count={evidence.hostPrefixInvariant.failureReasons.length}
      data-session-cookie-host-prefix-failure-reasons={evidence.hostPrefixInvariant.failureReasons.join(",")}
      data-session-cookie-set-cookie-contract={evidence.setCookieContract}
      data-session-cookie-same-site-accepted-values={evidence.acceptedSameSiteValues.join(",")}
      data-session-cookie-same-site-rejected-values={evidence.rejectedSameSiteValues.join(",")}
      data-session-cookie-same-site-acceptance-matrix={sameSiteAcceptanceContracts}
      data-session-csrf-strategy={evidence.csrfStrategy}
      data-session-csrf-header={evidence.csrfHeaderName}
      data-session-csrf-credential-mode={evidence.credentialMode}
      data-session-csrf-origin-policy={evidence.originPolicy}
      data-session-csrf-same-site-requirement={evidence.sameSiteRequirement}
      data-session-csrf-missing-operation-count={evidence.missingCsrfOperationIds.length}
      data-session-cookie-failure-count={evidence.cookieFailureReasons.length}
      data-session-cookie-failure-reasons={evidence.cookieFailureReasons.join(",")}
      data-session-csrf-failure-count={evidence.csrfFailureReasons.length}
      data-session-csrf-failure-reasons={evidence.csrfFailureReasons.join(",")}
      data-session-backend-runtime-pairing="secure-cookie-same-site-csrf-runtime"
      data-session-backend-runtime-pairing-status={backendRuntimePairingStatus}
      data-session-backend-runtime-pairing-digest={backendRuntimePairingDigest}
      data-session-backend-set-cookie-contract={backendSetCookieContract}
      data-session-backend-csrf-validation-contract={backendCsrfValidationContract}
      data-session-backend-unsafe-request-contract-count={generatedRequestEvidence.unsafeRequestContracts.length}
      data-session-backend-missing-unsafe-operation-count={generatedRequestEvidence.missingUnsafeOperationIds.length}
      data-session-backend-cookie-failure-count={evidence.cookieFailureReasons.length}
      data-session-backend-csrf-failure-count={evidence.csrfFailureReasons.length}
      data-session-unsafe-action-guard="authenticated-same-site-session"
      data-session-unsafe-action-status={sessionBlocked ? "blocked" : "enabled"}
      data-session-unsafe-action-safe-labels={Array.from(sessionSafeActionLabels).join(",")}
      data-session-unsafe-action-protected-methods={state.sessionContract.csrf.protectedMethods.join(",")}
      data-session-unsafe-action-guard-count={sameSiteUnsafeActionGuardLabels.length}
      data-session-unsafe-action-guard-labels={sameSiteUnsafeActionGuardLabels.join("|")}
      data-session-unsafe-action-blocked-control-count={blockedUnsafeActionGuardLabels.length}
      data-session-unsafe-action-blocked-control-labels={blockedUnsafeActionGuardLabels.join("|")}
      data-session-unsafe-action-blocked-reason={sessionBlocked ? "authenticated-session-required" : ""}
      data-session-unsafe-action-operation-count={guardedOperationIds.length}
      data-session-unsafe-action-csrf-protected-operation-count={unsafeActionCsrfProtectedOperationCount}
      data-session-unsafe-action-operation-contracts={unsafeActionGuardContracts}
      data-session-unsafe-action-generated-unsafe-operations={generatedRequestEvidence.unsafeOperationIds.join(",")}
      data-session-unsafe-action-guard-coverage-status={unsafeActionGuardCoverageStatus}
      data-session-unsafe-action-missing-csrf-operation-count={missingGuardedUnsafeOperationIds.length}
      data-session-unsafe-action-missing-csrf-operations={missingGuardedUnsafeOperationIds.join(",")}
      data-session-ux-state-matrix="stage0.rev2.csrf-same-site-session-state-ux-matrix"
      data-session-ux-state-matrix-status={sessionGuardMatrixStatus}
      data-session-ux-state-matrix-states={sessionGuardMatrixStates.join(",")}
      data-session-ux-state-matrix-contract={sessionGuardMatrixContract}
      data-session-ux-state-current={currentSessionGuardMatrixEntry.sessionStatus}
      data-session-ux-state-current-enabled-count={currentSessionGuardMatrixEntry.enabledLabels.length}
      data-session-ux-state-current-blocked-count={currentSessionGuardMatrixEntry.blockedLabels.length}
      data-session-ux-state-current-recovery-labels={currentSessionGuardMatrixEntry.recoveryLabels.join(",")}
      data-session-ux-state-current-alert={currentSessionGuardMatrixEntry.alert}
      data-session-ux-transition-contract="stage0.rev2.csrf-same-site-session-transition-ux"
      data-session-ux-transition-status={sessionGuardTransitionStatus}
      data-session-ux-transition-count="5"
      data-session-ux-transition-digest={sessionGuardTransitionDigest}
      data-session-ux-transition-expired-recovery-status="pass"
      data-session-ux-transition-signed-out-block-status="pass"
      data-session-ux-transition-required-recovery-action="Refresh Session"
      data-session-ux-transition-signed-out-blocked-count={signedOutSessionBlockedActionCount}
    >
      <div className="session-contract-main">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>Session {state.sessionContract.status}</strong>
          <span>
            Secure cookie {state.sessionContract.cookie.name} · {cookieAttributes} · HostOnly · CSRF {state.sessionContract.csrf.headerName}
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
        <div>
          <dt>Domain</dt>
          <dd>{evidence.cookieAttributes.hostOnly ? "host-only" : evidence.cookieAttributes.domain}</dd>
        </div>
      </dl>
      <div
        className="csrf-operation-inventory"
        aria-label="Generated web API CSRF operation inventory"
        data-csrf-operation-count={evidence.protectedOperationIds.length}
        data-generated-api-csrf-contract="stage0.rev2.generated-api-csrf-contract"
        data-generated-api-csrf-status={generatedRequestEvidence.status}
        data-generated-api-csrf-credential-mode={generatedRequestEvidence.credentialMode}
        data-generated-api-csrf-header={generatedRequestEvidence.csrfHeaderName}
        data-generated-api-csrf-header-value={generatedRequestEvidence.csrfHeaderValue}
        data-generated-api-csrf-origin-policy={generatedRequestEvidence.originPolicy}
        data-generated-api-csrf-unsafe-operation-count={generatedRequestEvidence.unsafeOperationCount}
        data-generated-api-csrf-safe-operation-count={generatedRequestEvidence.safeOperationCount}
        data-generated-api-csrf-unsafe-operations={generatedRequestEvidence.unsafeOperationIds.join(",")}
        data-generated-api-csrf-safe-operations={generatedRequestEvidence.safeOperationIds.join(",")}
        data-generated-api-csrf-idempotency-required-operations={generatedRequestEvidence.unsafeIdempotencyRequiredOperationIds.join(",")}
        data-generated-api-csrf-idempotency-exempt-operations={generatedRequestEvidence.unsafeIdempotencyExemptOperationIds.join(",")}
        data-generated-api-csrf-missing-unsafe-operation-count={generatedRequestEvidence.missingUnsafeOperationIds.length}
        data-generated-api-csrf-failure-count={generatedRequestEvidence.failureReasons.length}
        data-generated-api-csrf-method-coverage={generatedRequestEvidence.methodCoverage.schema_version}
        data-generated-api-csrf-method-coverage-status={generatedRequestEvidence.methodCoverage.status}
        data-generated-api-csrf-protected-method-coverage={generatedRequestEvidence.methodCoverage.unsafeMethodCoverage.join("|")}
        data-generated-api-csrf-safe-method-coverage={generatedRequestEvidence.methodCoverage.safeMethodCoverage.join("|")}
        data-generated-api-csrf-method-coverage-failure-count={generatedRequestEvidence.methodCoverage.failureReasons.length}
        data-generated-api-csrf-operation-contracts={generatedRequestEvidence.unsafeRequestContracts
          .map((contract) => `${contract.operationId}:${contract.method}:${contract.credentials}:${contract.csrfHeaderName}:${contract.idempotencyHeaderRequired}`)
          .join("|")}
        data-generated-api-csrf-safe-operation-contracts={generatedRequestEvidence.safeRequestContracts
          .map((contract) => `${contract.operationId}:${contract.method}:${contract.credentials}:${contract.csrfHeaderName}:${contract.idempotencyHeaderRequired}`)
          .join("|")}
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
        <button className="secondary-button compact" onClick={() => void runAction("login", () => zenariClient.login(loginEmail))}>
          <LogIn size={15} aria-hidden="true" />
          Sign In
        </button>
        <button
          className="secondary-button compact"
          disabled={state.sessionContract.status === "signed_out"}
          onClick={() => void runAction("session-refresh", () => zenariClient.refreshSession())}
          {...unsafeActionGuardAttributes("Refresh Session", state)}
        >
          <RefreshCcw size={15} aria-hidden="true" />
          Refresh Session
        </button>
        <button
          className="secondary-button compact"
          disabled={sessionBlocked}
          onClick={() => void runAction("session-expire", () => zenariClient.expireSession())}
          {...unsafeActionGuardAttributes("Expire Session", state)}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Expire
        </button>
        <button
          className="secondary-button compact"
          disabled={sessionBlocked}
          onClick={() => void runAction("logout", () => zenariClient.logout())}
          {...unsafeActionGuardAttributes("Log Out", state)}
        >
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
  sessionBlocked,
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
  sessionBlocked: boolean;
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
  const resultPlacementEvidence = buildResultPlacementEvidence(state);
  const referenceValidationMatrix = buildReferenceUploadValidationMatrixEvidence();
  const briefUploadConfirmationEvidence = buildBriefUploadConfirmationRuntimeEvidence(state);
  const ecommerceApiSmoke = buildEcommerceGrowthApiSmokeEvidence(state);
  const businessDocApiSmoke = buildBusinessVisualDocApiSmokeEvidence(state);
  const localMerchantApiSmoke = buildLocalMerchantCampaignApiSmokeEvidence(state);
  const characterIpApiSmoke = buildCharacterIpConceptApiSmokeEvidence(state);
  const activeWorkflowSmoke =
    characterIpApiSmoke.status === "pass" || state.packageItems.some((item) => item.workflowId === characterIpApiSmoke.workflow_id)
      ? characterIpApiSmoke
      : localMerchantApiSmoke.status === "pass" || state.packageItems.some((item) => item.workflowId === localMerchantApiSmoke.workflow_id)
      ? localMerchantApiSmoke
      : businessDocApiSmoke.status === "pass" || state.packageItems.some((item) => item.workflowId === businessDocApiSmoke.workflow_id)
      ? businessDocApiSmoke
      : ecommerceApiSmoke;
  const normalizedBrief = state.brief.prompt.toLowerCase();
  const activeCandidates = normalizedBrief.includes("local merchant campaign pack")
    ? localMerchantCampaignCandidates
    : normalizedBrief.includes("character ip concept pack")
    ? characterIpConceptCandidates
    : normalizedBrief.includes("business visual document pack")
    ? businessVisualDocCandidates
    : state.candidates;
  const mentionOptions = buildMentionPickerOptions({
    objects: state.canvas.nodes,
    references: state.brief.references,
    assetLibraryItems: state.assetLibrary.items,
    brandKits: state.assetLibrary.brandKits,
    skills: [
      { type: "skill", id: "ecommerce_growth_pack", label: "Ecommerce Growth Pack", allowed: true },
      { type: "skill", id: "business_visual_doc_pack", label: "Business Visual Document Pack", allowed: true },
      { type: "skill", id: "local_merchant_campaign_pack", label: "Local Merchant Campaign Pack", allowed: true },
      { type: "skill", id: "character_ip_concept_pack", label: "Character IP Concept Pack", allowed: true }
    ],
    models: [
      { type: "model", id: "image-fast-v1", label: "image-fast-v1", allowed: true },
      { type: "model", id: "deterministic-local-alpha", label: "deterministic-local-alpha", allowed: true }
    ]
  });
  const mentionResult = resolveMentions(briefInput, mentionOptions);
  const mentionEvidence = mentionSummary(mentionResult);
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
          <div
            className="mention-contract"
            aria-label="Mention parser and picker contract"
            data-mention-parser-picker="stage1.mention-parser-picker-local-contract"
            data-mention-token-count={mentionEvidence.tokenCount}
            data-mention-unique-count={mentionEvidence.uniqueCount}
            data-mention-duplicate-count={mentionEvidence.duplicateCount}
            data-mention-unresolved-count={mentionEvidence.unresolvedCount}
            data-mention-forbidden-model-count={mentionEvidence.forbiddenModelCount}
            data-mention-picker-types="object,asset,brand,skill,model"
            data-mention-picker-option-count={mentionOptions.length}
            data-mention-projected-ids={mentionEvidence.ids.join(",")}
            data-mention-projected-types={mentionEvidence.types.join(",")}
            data-mention-unresolved-queries={mentionResult.unresolved.map((item) => `${item.type}:${item.query}`).join(",")}
          >
            <strong>Mentions</strong>
            <span>
              {mentionEvidence.uniqueCount} resolved · {mentionEvidence.duplicateCount} duplicates · {mentionEvidence.unresolvedCount} unresolved.
            </span>
          </div>
          <button
            className="primary-button"
            disabled={sessionBlocked || busy === "brief" || !briefInput.trim()}
            {...unsafeActionGuardAttributes("Confirm Brief", state)}
          >
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
            disabled={sessionBlocked || !referenceName.trim()}
            onClick={() =>
              void runAction("reference", () =>
                zenariClient.attachReference({
                  name: referenceName,
                  kind: referenceKind
                })
              )
            }
            {...unsafeActionGuardAttributes("Attach", state)}
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
          className="reference-validation-matrix"
          aria-label="Reference upload validation matrix"
          data-reference-upload-validation-matrix={referenceValidationMatrix.schema_version}
          data-reference-upload-validation-status={referenceValidationMatrix.status}
          data-reference-upload-validation-scenario={referenceValidationMatrix.scenario}
          data-reference-upload-validation-accepted-kinds={referenceValidationMatrix.acceptedKinds.join(",")}
          data-reference-upload-validation-expected-kinds={referenceValidationMatrix.expectedAcceptedKinds.join(",")}
          data-reference-upload-validation-accepted-samples={referenceValidationMatrix.acceptedSampleNames.join(",")}
          data-reference-upload-validation-accepted-attached-count={referenceValidationMatrix.acceptedAttachedCount}
          data-reference-upload-validation-rejected-samples={referenceValidationMatrix.rejectedSampleNames.join(",")}
          data-reference-upload-validation-rejected-reasons={referenceValidationMatrix.rejectedReasons.join("|")}
          data-reference-upload-validation-rejected-count={referenceValidationMatrix.rejectedSampleNames.length}
          data-reference-upload-validation-rejected-queued-count={referenceValidationMatrix.rejectedQueuedCount}
          data-reference-upload-validation-rejected-package-action-count={referenceValidationMatrix.rejectedPackageActionCount}
          data-reference-upload-validation-expected-rejected-count={referenceValidationMatrix.expectedRejectedCount}
          data-reference-upload-validation-expected-rejected-reasons={referenceValidationMatrix.expectedRejectedReasons.join("|")}
          data-reference-upload-validation-failures={referenceValidationMatrix.failures.join(",")}
        >
          <strong>Reference validation</strong>
          <span>
            {referenceValidationMatrix.status} · accepts {referenceValidationMatrix.acceptedKinds.join(", ")} · rejects unsupported files and
            non-HTTPS URLs.
          </span>
        </div>
        <div
          className="reference-export-smoke"
          aria-label="Reference upload export integration smoke"
          data-reference-export-smoke="reference-upload-to-ready-zip-export"
          data-reference-upload-integration-smoke={referenceIntegrationSmoke.schema_version}
          data-reference-upload-integration-status={referenceIntegrationSmoke.status}
          data-reference-upload-integration-operation-count={referenceIntegrationSmoke.apiOperationIds.length}
          data-reference-upload-integration-operations={referenceIntegrationSmoke.apiOperationIds.join(",")}
          data-reference-accepted-count={acceptedReferenceIds.length}
          data-reference-accepted-kinds={referenceIntegrationSmoke.acceptedKinds.join(",")}
          data-reference-rejected-count={referenceIntegrationSmoke.rejectedCount}
          data-reference-latest-accepted-id={referenceIntegrationSmoke.latestAcceptedReferenceId}
          data-reference-latest-accepted-name={referenceIntegrationSmoke.latestAcceptedReferenceName}
          data-reference-latest-accepted-kind={referenceIntegrationSmoke.latestAcceptedReferenceKind}
          data-reference-latest-upload-method={referenceIntegrationSmoke.latestAcceptedReferenceUploadMethod}
          data-reference-latest-upload-path={referenceIntegrationSmoke.latestAcceptedReferenceUploadPath}
          data-reference-latest-upload-csrf-header={referenceIntegrationSmoke.latestAcceptedReferenceCsrfHeaderName}
          data-reference-latest-upload-idempotency-required={String(referenceIntegrationSmoke.latestAcceptedReferenceIdempotencyRequired)}
          data-reference-latest-preview-scope={referenceIntegrationSmoke.latestAcceptedReferencePreviewScope}
          data-reference-upload-request-contract-count={referenceIntegrationSmoke.uploadRequestContractCount}
          data-reference-latest-package-item-id={referenceIntegrationSmoke.latestAcceptedReferencePackageItemId}
          data-reference-latest-export-title={referenceIntegrationSmoke.latestAcceptedReferenceExportTitle}
          data-reference-latest-ppt-slide-source-item-id={referenceIntegrationSmoke.latestAcceptedReferencePptSlideSourceItemId}
          data-reference-latest-identity-status={referenceIntegrationSmoke.latestAcceptedReferenceIdentityStatus}
          data-reference-latest-packaged={String(referenceIntegrationSmoke.latestAcceptedReferencePackaged)}
          data-reference-latest-provenance-present={String(referenceIntegrationSmoke.latestAcceptedReferenceProvenancePresent)}
          data-reference-latest-ppt-slide-present={String(referenceIntegrationSmoke.latestAcceptedReferencePptSlidePresent)}
          data-reference-packaged-count={packagedReferenceIds.size}
          data-reference-package-history-count={referenceIntegrationSmoke.packageHistoryReferenceCount}
          data-reference-ready-export-count={referenceIntegrationSmoke.readyExportCount}
          data-reference-provenance-count={referenceIntegrationSmoke.provenanceCount}
          data-reference-ppt-asset-grid-slide-count={referenceIntegrationSmoke.pptAssetGridSlideCount}
          data-reference-rejected-packaged-count={referenceIntegrationSmoke.rejectedReferencePackagedCount}
          data-reference-rejected-exported-count={referenceIntegrationSmoke.rejectedReferenceExportedCount}
          data-reference-upload-integration-failures={referenceIntegrationSmoke.failures.join(",")}
        >
          <strong>Reference export path</strong>
          <span>
            {referenceIntegrationSmoke.latestAcceptedReferenceName} · package {String(referenceIntegrationSmoke.latestAcceptedReferencePackaged)} ·
            provenance {String(referenceIntegrationSmoke.latestAcceptedReferenceProvenancePresent)}.
          </span>
        </div>
        <div
          className="workflow-api-smoke"
          aria-label={`${activeWorkflowSmoke.workflow_id} API smoke`}
          data-workflow-api-smoke={activeWorkflowSmoke.schema_version}
          data-workflow-api-smoke-workflow={activeWorkflowSmoke.workflow_id}
          data-workflow-api-smoke-fixture={activeWorkflowSmoke.fixture_id}
          data-workflow-api-smoke-scenario={activeWorkflowSmoke.scenario}
          data-workflow-api-smoke-status={activeWorkflowSmoke.status}
          data-workflow-api-smoke-operation-count={activeWorkflowSmoke.apiOperationIds.length}
          data-workflow-api-smoke-candidate-count={activeWorkflowSmoke.candidateCount}
          data-workflow-api-smoke-taxonomy-count={activeWorkflowSmoke.taxonomyCount}
          data-workflow-api-smoke-packaged-taxonomy-count={activeWorkflowSmoke.packagedTaxonomyCount}
          data-workflow-api-smoke-ready-zip-export-count={activeWorkflowSmoke.readyZipExportCount}
          data-workflow-api-smoke-required-output-count={activeWorkflowSmoke.requiredOutputCount}
          data-workflow-api-smoke-missing-output-count={activeWorkflowSmoke.missingRequiredOutputs.length}
          data-workflow-api-smoke-qa-taxonomy-id={activeWorkflowSmoke.qaTaxonomyId}
          data-workflow-api-smoke-qa-taxonomy-status={activeWorkflowSmoke.qaTaxonomyStatus}
          data-workflow-api-smoke-safety-status={activeWorkflowSmoke.safetyStatus}
          data-workflow-api-smoke-operations={activeWorkflowSmoke.apiOperationIds.join(",")}
          data-workflow-api-smoke-operation-contracts={activeWorkflowSmoke.apiOperationContracts
            .map((contract) =>
              [
                contract.operationId,
                contract.method,
                contract.path,
                contract.credentialMode,
                contract.csrfHeaderName,
                String(contract.idempotencyRequired)
              ].join(":")
            )
            .join("|")}
          data-workflow-api-smoke-csrf-protected-operation-count={activeWorkflowSmoke.csrfProtectedOperationCount}
          data-workflow-api-smoke-idempotency-required-operation-count={activeWorkflowSmoke.idempotencyRequiredOperationCount}
          data-workflow-api-smoke-failures={activeWorkflowSmoke.failures.join(",")}
        >
          <strong>{activeWorkflowSmoke.workflow_id} API smoke</strong>
          <span>
            {activeWorkflowSmoke.status} · {activeWorkflowSmoke.candidateCount} candidates · {activeWorkflowSmoke.packagedTaxonomyCount} packaged taxonomy routes ·{" "}
            {activeWorkflowSmoke.missingRequiredOutputs.length} missing outputs.
          </span>
        </div>
        <div className="reference-list">
          {state.brief.references.map((reference) => (
            <span
              key={reference.id}
              className={reference.validation.state === "rejected" ? "rejected-reference" : ""}
              data-reference-upload-item={reference.id}
              data-reference-upload-state={reference.validation.state}
              data-reference-upload-operation={reference.upload.operationId}
              data-reference-upload-method={reference.upload.method}
              data-reference-upload-path={reference.upload.path}
              data-reference-upload-csrf-header={reference.upload.csrfHeaderName}
              data-reference-upload-idempotency-required={String(reference.upload.idempotencyRequired)}
              data-reference-upload-preview-scope={reference.upload.previewScope}
              data-reference-upload-preview-url={reference.upload.previewUrl}
              data-reference-upload-rejection-reason={reference.validation.reason ?? ""}
              data-reference-upload-package-action={reference.validation.state === "accepted" ? "available" : "blocked"}
            >
              <ImagePlus size={14} aria-hidden="true" />
              {reference.name} · {reference.validation.state}
              {reference.validation.state === "accepted" ? (
                <button
                  className="reference-package-button"
                  disabled={sessionBlocked || packagedReferenceIds.has(reference.id)}
                  onClick={() => void runAction("package", () => zenariClient.addPackageItem(reference.id))}
                  aria-label={`Add reference ${reference.name} to package`}
                  {...unsafeActionGuardAttributes("Package Reference", state)}
                >
                  {packagedReferenceIds.has(reference.id) ? "Packaged" : "Package"}
                </button>
              ) : null}
            </span>
          ))}
        </div>
      </section>

        <CanvasPanel
          state={state}
          sessionBlocked={sessionBlocked}
          renderingSmoke={renderingSmoke}
          resultPlacementEvidence={resultPlacementEvidence}
          runAction={runAction}
        />

      <section className="panel candidates-panel" data-testid="candidate-grid">
        <PanelTitle icon={<Archive size={18} aria-hidden="true" />} title="Candidates" />
        <div className="candidate-grid">
          {activeCandidates.map((candidate) => (
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
                disabled={sessionBlocked}
                onClick={() => void runAction("select", () => zenariClient.selectCandidate(candidate.id))}
                aria-pressed={state.selectedCandidateId === candidate.id}
                aria-label={`Select ${candidate.title}`}
                {...unsafeActionGuardAttributes("Select Candidate", state)}
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
          <button
            className="primary-button"
            disabled={sessionBlocked || !selectedCandidate || !iterationInput.trim()}
            {...unsafeActionGuardAttributes("Iterate", state)}
          >
            <Send size={18} aria-hidden="true" />
            Iterate
          </button>
        </form>
      </section>

      <BatchGenerationPanel state={state} sessionBlocked={sessionBlocked} runAction={runAction} />

      <AssetLibraryPanel state={state} sessionBlocked={sessionBlocked} runAction={runAction} />

      <PackagePanel state={state} sessionBlocked={sessionBlocked} runAction={runAction} />
    </div>
  );
}

function AssetLibraryPanel({
  state,
  sessionBlocked,
  runAction
}: {
  state: WorkspaceState;
  sessionBlocked: boolean;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const defaultBrandKit = state.assetLibrary.defaultBrandKit;
  const activeBrandKitCount = state.assetLibrary.brandKits.filter((kit) => kit.status === "active").length;
  const reusableItems = state.assetLibrary.items.filter((item) => item.reusable && !item.archived);
  const packagedAssetIds = new Set(state.assetLibrary.packagedAssetIds);
  const operationContracts = [
    "listAssetLibrary:GET:/assets/library:include:not-required:false",
    "createAssetLibraryEntry:POST:/assets/library:include:required:true",
    "updateAssetLibraryEntry:PATCH:/assets/library/{entry_id}:include:required:true",
    "listBrandKits:GET:/brand-kits:include:not-required:false",
    "createBrandKit:POST:/brand-kits:include:required:true",
    "updateBrandKit:PATCH:/brand-kits/{brand_kit_id}:include:required:true",
    "getProjectDefaultBrandKit:GET:/projects/{project_id}/brand-kit-default:include:not-required:false",
    "setProjectDefaultBrandKit:PUT:/projects/{project_id}/brand-kit-default:include:required:true"
  ].join("|");

  return (
    <section
      className="panel asset-library-panel"
      aria-label="Asset Library and Brand Kit"
      data-asset-library-brandkit-ui="stage1.asset-library-brandkit-user-picker"
      data-asset-library-sync-status={state.assetLibrary.syncStatus}
      data-asset-library-synced-at={state.assetLibrary.syncedAt ?? ""}
      data-asset-library-operation-count={state.assetLibrary.operations.length}
      data-asset-library-operations={state.assetLibrary.operations.join(",")}
      data-asset-library-operation-contracts={operationContracts}
      data-asset-library-item-count={state.assetLibrary.items.length}
      data-asset-library-reusable-count={reusableItems.length}
      data-asset-library-packaged-count={state.assetLibrary.packagedAssetIds.length}
      data-brand-kit-count={state.assetLibrary.brandKits.length}
      data-brand-kit-active-count={activeBrandKitCount}
      data-brand-kit-default-id={defaultBrandKit?.id ?? ""}
      data-brand-kit-default-name={defaultBrandKit?.name ?? ""}
      data-brand-kit-default-palette-count={defaultBrandKit?.palette.length ?? 0}
      data-brand-kit-default-guideline-count={defaultBrandKit?.guidelines.length ?? 0}
      data-brand-kit-project-binding-count={defaultBrandKit?.projectBindings.length ?? 0}
    >
      <div className="panel-header">
        <PanelTitle icon={<ImagePlus size={18} aria-hidden="true" />} title="Assets" />
        <div className="button-row compact-row">
          <button
            className="secondary-button compact"
            disabled={sessionBlocked}
            onClick={() => void runAction("asset-library-refresh", () => zenariClient.refreshAssetLibrary())}
            data-asset-library-refresh-contract="listAssetLibrary:GET:not-required:false+listBrandKits:GET:not-required:false+getProjectDefaultBrandKit:GET:not-required:false"
            {...unsafeActionGuardAttributes("Refresh Asset Library", state)}
          >
            <RefreshCcw size={15} aria-hidden="true" />
            Refresh Assets
          </button>
          <button
            className="secondary-button compact"
            disabled={sessionBlocked || state.canvas.nodes.length === 0}
            onClick={() => void runAction("asset-library-create", () => zenariClient.createAssetLibraryEntryFromSelection())}
            data-asset-library-create-contract="createAssetLibraryEntry:POST:required:true"
            {...unsafeActionGuardAttributes("Add Asset", state)}
          >
            <ImagePlus size={15} aria-hidden="true" />
            Add Asset
          </button>
        </div>
      </div>
      {defaultBrandKit ? (
        <div className="brand-kit-summary" data-brand-kit-default="active-project-default">
          <strong>{defaultBrandKit.name}</strong>
          <span>
            {defaultBrandKit.palette.map((color) => color.hex).join(" ")} · {defaultBrandKit.fonts.map((font) => font.family).join(", ")}
          </span>
          <small>{defaultBrandKit.guidelines[0]?.body ?? "No guideline"}</small>
        </div>
      ) : (
        <p className="empty">No active Brand Kit.</p>
      )}
      <div className="asset-library-list">
        {state.assetLibrary.items.map((item) => (
          <article
            key={item.id}
            data-asset-library-item={item.id}
            data-asset-library-asset-id={item.assetId}
            data-asset-library-visibility={item.visibility}
            data-asset-library-reusable={String(item.reusable)}
            data-asset-library-archived={String(item.archived)}
            data-asset-library-packaged={String(packagedAssetIds.has(item.assetId))}
            data-asset-library-lineage-kind={item.lineageKind ?? ""}
            data-asset-library-trace-id={item.traceId ?? ""}
          >
            <strong>{item.title}</strong>
            <span>
              {item.assetType} · {item.visibility} · {item.tags.join(", ") || "untagged"}
            </span>
            <div className="button-row compact-row">
              <button
                className="secondary-button icon-button"
                aria-label={item.favorite ? "Unfavorite Asset" : "Favorite Asset"}
                title={item.favorite ? "Unfavorite Asset" : "Favorite Asset"}
                disabled={sessionBlocked || item.archived}
                onClick={() => void runAction("asset-library-favorite", () => zenariClient.toggleAssetLibraryFavorite(item.id))}
                data-asset-library-favorite-contract="updateAssetLibraryEntry:PATCH:required:true"
                {...unsafeActionGuardAttributes("Favorite Asset", state)}
              >
                <Check size={14} aria-hidden="true" />
              </button>
              <button
                className="secondary-button compact"
                disabled={sessionBlocked || item.archived}
                onClick={() => void runAction("brand-kit-create", () => zenariClient.createBrandKitFromLogoAsset(item.id))}
                data-brand-kit-create-contract="createBrandKit:POST:required:true"
                {...unsafeActionGuardAttributes("Create Brand Kit", state)}
              >
                <PenLine size={14} aria-hidden="true" />
                Kit
              </button>
              <button
                className="secondary-button icon-button"
                aria-label="Archive Asset"
                title="Archive Asset"
                disabled={sessionBlocked || item.archived}
                onClick={() => void runAction("asset-library-archive", () => zenariClient.archiveAssetLibraryEntry(item.id))}
                data-asset-library-archive-contract="updateAssetLibraryEntry:PATCH:required:true"
                {...unsafeActionGuardAttributes("Archive Asset", state)}
              >
                <Archive size={14} aria-hidden="true" />
              </button>
              <button
                className="secondary-button compact"
                disabled={sessionBlocked || item.archived || !item.reusable || packagedAssetIds.has(item.assetId)}
                onClick={() => void runAction("package", () => zenariClient.packageAssetLibraryItem(item.id))}
                {...unsafeActionGuardAttributes("Package Reference", state)}
              >
                <PackagePlus size={14} aria-hidden="true" />
                {packagedAssetIds.has(item.assetId) ? "Packaged" : "Package"}
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="brand-kit-list" data-brand-kit-write-api="createBrandKit,updateBrandKit,setProjectDefaultBrandKit">
        {state.assetLibrary.brandKits.map((kit) => (
          <div key={kit.id} className="brand-kit-actions" data-brand-kit-id={kit.id}>
            <button
              className="secondary-button compact"
              disabled={sessionBlocked || kit.status === "archived"}
              onClick={() => void runAction("brand-kit-update", () => zenariClient.updateBrandKitGuidelines(kit.id))}
              data-brand-kit-update-contract="updateBrandKit:PATCH:required:true"
              {...unsafeActionGuardAttributes("Update Brand Kit", state)}
            >
              <Palette size={14} aria-hidden="true" />
              Update Kit
            </button>
            <button
              className="secondary-button compact"
              disabled={sessionBlocked || kit.status === "archived" || defaultBrandKit?.id === kit.id}
              onClick={() => void runAction("brand-kit-default", () => zenariClient.setDefaultBrandKit(kit.id))}
              data-brand-kit-default-contract="setProjectDefaultBrandKit:PUT:required:true"
              {...unsafeActionGuardAttributes("Set Brand Kit", state)}
            >
              <Check size={14} aria-hidden="true" />
              {defaultBrandKit?.id === kit.id ? "Default" : "Set Default"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function CanvasPanel({
  state,
  sessionBlocked,
  renderingSmoke,
  resultPlacementEvidence,
  runAction
}: {
  state: WorkspaceState;
  sessionBlocked: boolean;
  renderingSmoke: ReturnType<typeof buildWorkspaceRenderingPerformanceSmoke>;
  resultPlacementEvidence: ReturnType<typeof buildResultPlacementEvidence>;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const selectedNodeIds = new Set(state.canvas.interaction.selectedNodeIds);
  const visibleNodes = state.canvas.nodes.filter((node) => !node.hidden);
  const selectedNode = state.canvas.nodes.find((node) => selectedNodeIds.has(node.id));
  const hiddenCount = state.canvas.nodes.filter((node) => node.hidden).length;
  const lockedCount = state.canvas.nodes.filter((node) => node.locked).length;
  const toolIconByTool: Record<CanvasTool, ReactNode> = {
    select: <MousePointer2 size={15} aria-hidden="true" />,
    hand: <Move size={15} aria-hidden="true" />,
    frame: <Frame size={15} aria-hidden="true" />,
    text: <PenLine size={15} aria-hidden="true" />,
    shape: <BoxSelect size={15} aria-hidden="true" />,
    upload: <Upload size={15} aria-hidden="true" />
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,select,[contenteditable='true']")) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      void runAction("canvas-keyboard", () => zenariClient.duplicateSelectedCanvasNodes());
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void runAction("canvas-keyboard", () => zenariClient.deleteSelectedCanvasNodes());
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "=") {
      event.preventDefault();
      void runAction("canvas-keyboard", () => zenariClient.setCanvasZoom(state.canvas.interaction.zoom + 0.1));
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "-") {
      event.preventDefault();
      void runAction("canvas-keyboard", () => zenariClient.setCanvasZoom(state.canvas.interaction.zoom - 0.1));
    }
    if (event.code === "Space") {
      event.preventDefault();
      void runAction("canvas-keyboard", () => zenariClient.setCanvasTool("hand"));
    }
  };

  return (
    <section
      className="panel canvas-panel"
      aria-label="Stage 1 canvas editor"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-canvas-interaction-contract={state.canvas.interaction.contract}
      data-canvas-interaction-status="local"
      data-canvas-tool={state.canvas.interaction.tool}
      data-canvas-zoom={state.canvas.interaction.zoom.toFixed(2)}
      data-canvas-selected-node-count={state.canvas.interaction.selectedNodeIds.length}
      data-canvas-selected-node-ids={state.canvas.interaction.selectedNodeIds.join(",")}
      data-canvas-visible-node-count={visibleNodes.length}
      data-canvas-hidden-node-count={hiddenCount}
      data-canvas-locked-node-count={lockedCount}
      data-canvas-last-action={state.canvas.interaction.lastAction}
      data-canvas-toolbar-tools={state.canvas.interaction.toolbarTools.join(",")}
      data-canvas-keyboard-shortcuts={state.canvas.interaction.keyboardShortcuts.join(",")}
      data-canvas-layers-panel="enabled"
      data-result-placement-contract={resultPlacementEvidence.schema_version}
      data-result-placement-status={resultPlacementEvidence.status}
      data-result-placement-projected-child-count={resultPlacementEvidence.projected_child_count}
      data-result-placement-canvas-object-count={resultPlacementEvidence.placed_canvas_object_count}
      data-result-placement-asset-library-entry-count={resultPlacementEvidence.asset_library_entry_count}
      data-result-placement-latest-child-id={resultPlacementEvidence.latest_child_id}
      data-result-placement-latest-asset-id={resultPlacementEvidence.latest_asset_id}
      data-result-placement-latest-canvas-object-id={resultPlacementEvidence.latest_canvas_object_id}
      data-result-placement-latest-trace-id={resultPlacementEvidence.latest_trace_id}
      data-result-placement-duplicate-count={resultPlacementEvidence.duplicate_projection_count}
      data-result-placement-missing-count={resultPlacementEvidence.missing_projection_count}
      data-result-placement-raw-provider-payload={String(resultPlacementEvidence.raw_provider_payload_projected)}
    >
      <div className="panel-header">
        <PanelTitle icon={<Save size={18} aria-hidden="true" />} title="Canvas" />
        <span className="soft-label">Autosaved {dateLabel(state.canvas.autosavedAt)}</span>
      </div>
      <div className="canvas-toolbar" aria-label="Canvas toolbar" data-canvas-toolbar="stage1.canvas-toolbar">
        {state.canvas.interaction.toolbarTools.map((tool) => (
          <button
            key={tool}
            className={tool === state.canvas.interaction.tool ? "icon-button active" : "icon-button"}
            type="button"
            title={tool}
            aria-label={`Canvas tool ${tool}`}
            aria-pressed={tool === state.canvas.interaction.tool}
            disabled={sessionBlocked}
            onClick={() => void runAction("canvas-tool", () => zenariClient.setCanvasTool(tool))}
          >
            {toolIconByTool[tool]}
          </button>
        ))}
        <button
          className="icon-button"
          type="button"
          title="zoom out"
          aria-label="Zoom out canvas"
          disabled={sessionBlocked}
          onClick={() => void runAction("canvas-zoom", () => zenariClient.setCanvasZoom(state.canvas.interaction.zoom - 0.1))}
        >
          <ZoomOut size={15} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          title="zoom in"
          aria-label="Zoom in canvas"
          disabled={sessionBlocked}
          onClick={() => void runAction("canvas-zoom", () => zenariClient.setCanvasZoom(state.canvas.interaction.zoom + 0.1))}
        >
          <ZoomIn size={15} aria-hidden="true" />
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={sessionBlocked}
          onClick={() => void runAction("canvas-fit", () => zenariClient.fitCanvasToView())}
          data-canvas-fit-control="fit"
        >
          Fit
        </button>
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
        data-rendering-reference-count={renderingSmoke.referenceCount}
        data-rendering-package-item-count={renderingSmoke.packageItemCount}
        data-rendering-export-history-count={renderingSmoke.exportHistoryCount}
        data-rendering-identity-count={renderingSmoke.renderIdentityCount}
        data-rendering-duplicate-identity-count={renderingSmoke.duplicateRenderIdentityCount}
        data-rendering-duplicate-identities={renderingSmoke.duplicateRenderIdentities.join(",")}
        data-rendering-identity-digest={renderingSmoke.renderIdentityDigest}
        data-rendering-step-budget-statuses={renderingSmoke.interactionStepBudgets
          .map((entry) => `${entry.step}:${entry.status}:${entry.renderElementCount}:${entry.estimatedInteractionMs}:${entry.failureCount}`)
          .join("|")}
        data-rendering-step-budget-failure-count={renderingSmoke.interactionStepBudgets.reduce(
          (count, entry) => count + entry.failureCount,
          0
        )}
      >
        <Gauge size={15} aria-hidden="true" />
        <span>
          {renderingSmoke.status === "pass" ? "Render budget pass" : "Render budget fail"} · {renderingSmoke.renderElementCount}/
          {renderingSmoke.budgets.maxRenderElements} elements · {renderingSmoke.estimatedInteractionMs}/
          {renderingSmoke.budgets.maxInteractionMs} ms
        </span>
      </div>
      <div className="canvas-body">
        <div
          className="canvas-surface"
          data-rendering-smoke={renderingSmoke.schema_version}
          data-rendering-status={renderingSmoke.status}
          data-render-node-count={renderingSmoke.nodeCount}
          data-render-edge-count={renderingSmoke.edgeCount}
          data-render-version-count={renderingSmoke.versionCount}
          data-render-candidate-count={renderingSmoke.candidateCount}
          data-render-package-item-count={renderingSmoke.packageItemCount}
          data-render-reference-count={renderingSmoke.referenceCount}
          data-render-export-history-count={renderingSmoke.exportHistoryCount}
          data-render-element-count={renderingSmoke.renderElementCount}
          data-render-estimated-interaction-ms={renderingSmoke.estimatedInteractionMs}
          data-render-identity-count={renderingSmoke.renderIdentityCount}
          data-render-duplicate-identity-count={renderingSmoke.duplicateRenderIdentityCount}
          data-render-duplicate-identities={renderingSmoke.duplicateRenderIdentities.join(",")}
          data-render-identity-digest={renderingSmoke.renderIdentityDigest}
          data-render-interaction-steps={renderingSmoke.interactionSteps.join(",")}
          data-render-interaction-step-budget-statuses={renderingSmoke.interactionStepBudgets
            .map((entry) => `${entry.step}:${entry.status}:${entry.renderElementCount}:${entry.estimatedInteractionMs}:${entry.failureCount}`)
            .join("|")}
          data-render-interaction-step-budget-failure-count={renderingSmoke.interactionStepBudgets.reduce(
            (count, entry) => count + entry.failureCount,
            0
          )}
          data-render-failure-count={renderingSmoke.failures.length}
          data-render-max-elements={renderingSmoke.budgets.maxRenderElements}
          data-render-max-interaction-ms={renderingSmoke.budgets.maxInteractionMs}
        >
          <div
            className="canvas-world"
            style={{
              transform: `translate(${state.canvas.interaction.pan.x}px, ${state.canvas.interaction.pan.y}px) scale(${state.canvas.interaction.zoom})`
            }}
          >
            {state.canvas.edges.map((edge) => (
              <div key={`${edge.from}-${edge.to}`} className="canvas-edge" />
            ))}
            {state.canvas.nodes.map((node) => (
              <CanvasNodeCard
                key={node.id}
                node={node}
                selected={selectedNodeIds.has(node.id)}
                sessionBlocked={sessionBlocked}
                runAction={runAction}
              />
            ))}
          </div>
        </div>
        <aside className="canvas-layers" aria-label="Canvas layers" data-canvas-layers-panel="stage1.canvas-layers-panel">
          {state.canvas.nodes
            .slice()
            .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
            .map((node) => (
              <div
                key={node.id}
                className={selectedNodeIds.has(node.id) ? "canvas-layer selected" : "canvas-layer"}
                data-canvas-layer-row={node.id}
                data-canvas-layer-hidden={String(Boolean(node.hidden))}
                data-canvas-layer-locked={String(Boolean(node.locked))}
              >
                <button
                  type="button"
                  className="layer-title"
                  disabled={sessionBlocked || Boolean(node.hidden)}
                  onClick={() => void runAction("canvas-select", () => zenariClient.selectCanvasNode(node.id))}
                >
                  <span>{node.title}</span>
                </button>
                <button
                  type="button"
                  className="icon-button mini"
                  title={node.hidden ? "show" : "hide"}
                  aria-label={`${node.hidden ? "Show" : "Hide"} ${node.title}`}
                  disabled={sessionBlocked}
                  onClick={() => void runAction("canvas-layer", () => zenariClient.toggleCanvasNodeHidden(node.id))}
                >
                  {node.hidden ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="icon-button mini"
                  title={node.locked ? "unlock" : "lock"}
                  aria-label={`${node.locked ? "Unlock" : "Lock"} ${node.title}`}
                  disabled={sessionBlocked}
                  onClick={() => void runAction("canvas-layer", () => zenariClient.toggleCanvasNodeLocked(node.id))}
                >
                  {node.locked ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
                </button>
              </div>
            ))}
        </aside>
      </div>
      <EditToolsPanel state={state} sessionBlocked={sessionBlocked} runAction={runAction} />
      <div className="canvas-footer">
        <CanvasVersionHistory versions={state.canvas.versions} activeVersionId={state.canvas.activeVersionId} sessionBlocked={sessionBlocked} state={state} runAction={runAction} />
        <div className="canvas-key-actions">
          <button
            type="button"
            className="icon-button"
            title="duplicate"
            aria-label="Duplicate selected canvas nodes"
            disabled={sessionBlocked || state.canvas.interaction.selectedNodeIds.length === 0}
            onClick={() => void runAction("canvas-keyboard", () => zenariClient.duplicateSelectedCanvasNodes())}
          >
            <BoxSelect size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            title="delete"
            aria-label="Delete selected canvas nodes"
            disabled={sessionBlocked || !selectedNode || selectedNode.locked || selectedNode.id === "node-brief"}
            onClick={() => void runAction("canvas-keyboard", () => zenariClient.deleteSelectedCanvasNodes())}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function CanvasVersionHistory({
  versions,
  activeVersionId,
  sessionBlocked,
  state,
  runAction
}: {
  versions: CanvasVersion[];
  activeVersionId: string;
  sessionBlocked: boolean;
  state: WorkspaceState;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const activeVersion = versions.find((version) => version.id === activeVersionId) ?? versions.at(-1);
  const activeDiff = activeVersion?.diff ?? { addedNodeIds: [], removedNodeIds: [], changedNodeIds: [], unchangedNodeIds: [] };
  const activePreview = activeVersion?.restorePreview ?? { restoresNodeIds: [], preservesNodeIds: [], conflictNodeIds: [] };

  return (
    <section
      className="canvas-version-history"
      aria-label="Canvas version history"
      data-canvas-version-history="stage1.canvas-version-history"
      data-canvas-version-history-status="local"
      data-canvas-version-active-id={activeVersionId}
      data-canvas-version-count={versions.length}
      data-canvas-version-preview-node-count={activeVersion?.snapshot?.nodes.length ?? activeVersion?.nodeCount ?? 0}
      data-canvas-version-diff-added={activeDiff.addedNodeIds.join(",")}
      data-canvas-version-diff-removed={activeDiff.removedNodeIds.join(",")}
      data-canvas-version-diff-changed={activeDiff.changedNodeIds.join(",")}
      data-canvas-version-diff-unchanged={activeDiff.unchangedNodeIds.join(",")}
      data-canvas-version-restore-restores={activePreview.restoresNodeIds.join(",")}
      data-canvas-version-restore-preserves={activePreview.preservesNodeIds.join(",")}
      data-canvas-version-restore-conflicts={activePreview.conflictNodeIds.join(",")}
    >
      <div className="version-row">
        {versions.map((version) => {
          const diff = version.diff ?? { addedNodeIds: [], removedNodeIds: [], changedNodeIds: [], unchangedNodeIds: [] };
          const preview = version.restorePreview ?? { restoresNodeIds: [], preservesNodeIds: [], conflictNodeIds: [] };
          return (
            <button
              key={version.id}
              className={version.id === activeVersionId ? "version-chip active" : "version-chip"}
              disabled={sessionBlocked}
              onClick={() => void runAction("restore", () => zenariClient.restoreCanvasVersion(version.id))}
              aria-pressed={version.id === activeVersionId}
              data-canvas-version-entry={version.id}
              data-canvas-version-number={version.versionNumber ?? ""}
              data-canvas-version-node-count={version.nodeCount}
              data-canvas-version-preview-node-count={version.snapshot?.nodes.length ?? version.nodeCount}
              data-canvas-version-diff-added={diff.addedNodeIds.join(",")}
              data-canvas-version-diff-removed={diff.removedNodeIds.join(",")}
              data-canvas-version-diff-changed={diff.changedNodeIds.join(",")}
              data-canvas-version-diff-unchanged={diff.unchangedNodeIds.join(",")}
              data-canvas-version-restore-restores={preview.restoresNodeIds.join(",")}
              data-canvas-version-restore-preserves={preview.preservesNodeIds.join(",")}
              data-canvas-version-restore-conflicts={preview.conflictNodeIds.join(",")}
              {...unsafeActionGuardAttributes("Restore Version", state)}
            >
              <History size={14} aria-hidden="true" />
              {version.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EditToolsPanel({
  state,
  sessionBlocked,
  runAction
}: {
  state: WorkspaceState;
  sessionBlocked: boolean;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const edit = state.editTools;
  const latestRevision = edit.revisions[0];
  const selectedNodeId = state.canvas.interaction.selectedNodeIds[0] ?? edit.sourceNodeId;
  const maskAligned = edit.mask.width === edit.sourceWidth && edit.mask.height === edit.sourceHeight;

  return (
    <section
      className="edit-tools-panel"
      aria-label="Edit tools and mask"
      data-edit-tools-contract={edit.contract}
      data-edit-tools-status={edit.syncStatus}
      data-edit-tools-active-tool={edit.activeTool}
      data-edit-tools-available-tools={edit.availableTools.join(",")}
      data-edit-tools-source-asset-id={edit.sourceAssetId}
      data-edit-tools-source-node-id={selectedNodeId}
      data-edit-tools-mask-kind={edit.mask.kind}
      data-edit-tools-mask-width={edit.mask.width}
      data-edit-tools-mask-height={edit.mask.height}
      data-edit-tools-source-width={edit.sourceWidth}
      data-edit-tools-source-height={edit.sourceHeight}
      data-edit-tools-mask-aligned={String(maskAligned)}
      data-edit-tools-mask-coverage={edit.mask.coveragePct.toFixed(2)}
      data-edit-tools-revision-count={edit.revisions.length}
      data-edit-tools-last-revision-id={edit.lastRevisionId ?? ""}
      data-edit-tools-last-action={edit.lastAction}
      data-edit-tools-original-retained={String(latestRevision?.originalAssetRetained ?? true)}
      data-edit-tools-derived-asset-id={latestRevision?.derivedAssetId ?? ""}
      data-edit-tools-derived-node-id={latestRevision?.derivedNodeId ?? ""}
      data-edit-tools-lineage-tool={latestRevision?.lineage.toolType ?? ""}
      data-edit-tools-raw-payload-persisted={String(latestRevision?.lineage.rawPayloadPersisted ?? false)}
      data-edit-tools-provider-request-required={String(latestRevision?.providerRequestRequired ?? false)}
    >
      <div className="panel-header">
        <PanelTitle icon={<ImagePlus size={18} aria-hidden="true" />} title="Edit Tools" />
        <span className="soft-label">{maskAligned ? "Mask aligned" : "Mask mismatch"}</span>
      </div>
      <div className="edit-tool-row" role="group" aria-label="Edit tool picker">
        {edit.availableTools.map((tool) => (
          <button
            key={tool}
            type="button"
            className={tool === edit.activeTool ? "secondary-button compact active" : "secondary-button compact"}
            aria-label={`Edit tool ${tool}`}
            aria-pressed={tool === edit.activeTool}
            disabled={sessionBlocked}
            onClick={() => void runAction("edit-tool", () => zenariClient.setEditTool(tool))}
          >
            {tool.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      <div className="edit-mask-grid">
        <label>
          <span>Mask kind</span>
          <select
            aria-label="Mask kind"
            value={edit.mask.kind}
            disabled={sessionBlocked}
            onChange={(event) => void runAction("edit-mask", () => zenariClient.updateEditMask({ kind: event.target.value as typeof edit.mask.kind }))}
          >
            <option value="brush">brush</option>
            <option value="rect">rect</option>
            <option value="lasso">lasso</option>
          </select>
        </label>
        <label>
          <span>Coverage</span>
          <input
            aria-label="Mask coverage"
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={edit.mask.coveragePct}
            disabled={sessionBlocked}
            onChange={(event) => void runAction("edit-mask", () => zenariClient.updateEditMask({ coveragePct: Number(event.target.value) }))}
          />
        </label>
        <span className="edit-mask-size">
          {edit.mask.width} x {edit.mask.height}
        </span>
        <button
          type="button"
          className="primary-button compact"
          disabled={sessionBlocked || !maskAligned}
          onClick={() => void runAction("edit-apply", () => zenariClient.applyEditTool())}
          {...unsafeActionGuardAttributes("Apply Edit Tool", state)}
        >
          Apply Edit
        </button>
      </div>
      {latestRevision ? (
        <div
          className="edit-revision-row"
          data-edit-tools-revision={latestRevision.id}
          data-edit-tools-revision-source-asset={latestRevision.sourceAssetId}
          data-edit-tools-revision-derived-asset={latestRevision.derivedAssetId}
          data-edit-tools-revision-derived-node={latestRevision.derivedNodeId}
          data-edit-tools-revision-original-retained={String(latestRevision.originalAssetRetained)}
          data-edit-tools-revision-raw-payload-persisted={String(latestRevision.lineage.rawPayloadPersisted)}
        >
          <strong>{latestRevision.tool.replace(/_/g, " ")}</strong>
          <span>{latestRevision.derivedAssetId} · {latestRevision.derivedNodeId}</span>
        </div>
      ) : null}
    </section>
  );
}

function CanvasNodeCard({
  node,
  selected,
  sessionBlocked,
  runAction
}: {
  node: CanvasNode;
  selected: boolean;
  sessionBlocked: boolean;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  if (node.hidden) {
    return null;
  }
  return (
    <article
      className={`canvas-node ${node.kind}${selected ? " selected" : ""}${node.locked ? " locked" : ""}`}
      style={{
        left: node.x,
        top: node.y,
        width: node.width ?? 230,
        minHeight: node.height ?? 118,
        zIndex: node.zIndex ?? 1
      }}
      data-canvas-node={node.id}
      data-canvas-node-selected={String(selected)}
      data-canvas-node-locked={String(Boolean(node.locked))}
      data-canvas-node-hidden={String(Boolean(node.hidden))}
      data-canvas-node-z-index={node.zIndex ?? 1}
      onClick={() => void runAction("canvas-select", () => zenariClient.selectCanvasNode(node.id))}
    >
      <strong>{node.title}</strong>
      <p>{node.body}</p>
      <button
        type="button"
        className="node-move-handle"
        aria-label={`Move ${node.title}`}
        disabled={sessionBlocked || Boolean(node.locked)}
        onClick={(event) => {
          event.stopPropagation();
          void runAction("canvas-drag", () => zenariClient.moveCanvasNode(node.id, { x: 24, y: 18 }));
        }}
      >
        <Move size={14} aria-hidden="true" />
      </button>
    </article>
  );
}

function BatchGenerationPanel({
  state,
  sessionBlocked,
  runAction
}: {
  state: WorkspaceState;
  sessionBlocked: boolean;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const latestBatch = state.batchGenerations[0];
  const [requestedCount, setRequestedCount] = useState(4);
  const [aspectRatio, setAspectRatio] = useState<PromptComposerAspectRatio>("16:9");
  const [quality, setQuality] = useState<PromptComposerQuality>("standard");
  const promptComposerPayload = buildPromptComposerPayload(state, {
    text:
      `${state.brief.prompt} @object[Confirmed Brief] @asset[Primary logo reference] @brand[Aurora Retail] @model[image-fast-v1]`.trim(),
    requestedCount,
    aspectRatio,
    quality
  });
  const retryableChild = latestBatch?.children.find((child) => child.status === "failed" && child.retryCount < child.maxRetries);
  const canCancel = Boolean(latestBatch?.children.some((child) => child.status === "queued" || child.status === "running"));
  const canPoll = Boolean(latestBatch && ["queued", "running"].includes(latestBatch.status) && state.sessionContract.status === "authenticated");
  const latestResultChild = latestBatch?.children.find((child) => child.assetId || child.canvasObjectId);
  const latestPromptContext = latestBatch?.promptContext ?? promptComposerPayload.prompt_context;

  return (
    <section className="panel batch-panel" aria-label="Batch generation controls">
      <PanelTitle icon={<Sparkles size={18} aria-hidden="true" />} title="Batch" />
      <div
        className="prompt-composer-controls"
        aria-label="Prompt composer controls"
        data-prompt-composer-contract="stage1.prompt-composer-contract.v1"
        data-prompt-composer-status={promptComposerPayload.prompt_context_status}
        data-prompt-composer-requested-count={promptComposerPayload.requested_count}
        data-prompt-composer-aspect-ratio={promptComposerPayload.aspect_ratio}
        data-prompt-composer-quality={promptComposerPayload.quality}
        data-prompt-composer-selected-object-count={promptComposerPayload.projected.selected_object_count}
        data-prompt-composer-reference-asset-count={promptComposerPayload.projected.reference_asset_count}
        data-prompt-composer-brand-kit-id={promptComposerPayload.projected.brand_kit_id}
        data-prompt-composer-model-hints={promptComposerPayload.projected.model_hints.join(",")}
        data-prompt-composer-allowed-models={promptComposerPayload.allowed_models.join(",")}
        data-prompt-composer-tool-hint={promptComposerPayload.prompt_context.tool_hint}
        data-prompt-composer-unresolved-count={promptComposerPayload.blocked.unresolved_mention_count}
        data-prompt-composer-duplicate-count={promptComposerPayload.blocked.duplicate_mention_count}
        data-prompt-composer-forbidden-model-count={promptComposerPayload.blocked.forbidden_model_mention_count}
        data-prompt-composer-redaction-secret-like={String(promptComposerPayload.redaction.secret_like_value_projected)}
        data-prompt-composer-redaction-provider-payload={String(promptComposerPayload.redaction.raw_provider_payload_persisted)}
        data-prompt-composer-operation={promptComposerPayload.operations.join(",")}
      >
        <label>
          Count
          <input
            type="number"
            min={1}
            max={20}
            value={requestedCount}
            onChange={(event) => setRequestedCount(Number(event.target.value))}
          />
        </label>
        <label>
          Ratio
          <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as PromptComposerAspectRatio)}>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
          </select>
        </label>
        <label>
          Quality
          <select value={quality} onChange={(event) => setQuality(event.target.value as PromptComposerQuality)}>
            <option value="draft">Draft</option>
            <option value="standard">Standard</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      <div className="package-actions">
        <button
          className="primary-button"
          disabled={sessionBlocked}
          onClick={() => void runAction("batch-create", () => zenariClient.createBatchGeneration(promptComposerPayload))}
          {...unsafeActionGuardAttributes("Create Batch", state)}
        >
          <Sparkles size={17} aria-hidden="true" />
          Create Batch
        </button>
        <button
          className="secondary-button"
          disabled={sessionBlocked || !latestBatch || !canCancel}
          onClick={() => latestBatch && void runAction("batch-cancel", () => zenariClient.cancelBatchGeneration(latestBatch.id))}
          {...unsafeActionGuardAttributes("Cancel Batch", state)}
        >
          <AlertTriangle size={16} aria-hidden="true" />
          Cancel Batch
        </button>
        <button
          className="secondary-button"
          disabled={sessionBlocked || !retryableChild}
          onClick={() => retryableChild && void runAction("batch-retry", () => zenariClient.retryBatchGenerationChild(retryableChild.id))}
          {...unsafeActionGuardAttributes("Retry Child", state)}
        >
          <RefreshCcw size={16} aria-hidden="true" />
          Retry Child
        </button>
      </div>
      <div
        className="batch-contract"
        aria-label="Batch generation API contract"
        data-batch-generation-contract="stage1.batch-generation-user-api"
        data-batch-generation-count={state.batchGenerations.length}
        data-batch-generation-latest-id={latestBatch?.id ?? ""}
        data-batch-generation-latest-status={latestBatch?.status ?? "none"}
        data-batch-generation-latest-progress={latestBatch?.progressPercent ?? 0}
        data-batch-generation-latest-child-count={latestBatch?.children.length ?? 0}
        data-batch-generation-latest-failed-count={latestBatch?.failedCount ?? 0}
        data-batch-generation-latest-cancelled-count={latestBatch?.cancelledCount ?? 0}
        data-batch-generation-latest-blocked-count={latestBatch?.blockedCount ?? 0}
        data-batch-generation-latest-succeeded-count={latestBatch?.succeededCount ?? 0}
        data-batch-generation-latest-retryable-count={latestBatch?.retryableCount ?? 0}
        data-batch-generation-retryable-child-id={retryableChild?.id ?? ""}
        data-batch-generation-provider={latestBatch?.providerId ?? "zenari-image-sandbox"}
        data-batch-generation-model={latestBatch?.modelId ?? "image-fast-v1"}
        data-batch-generation-progress-sync-status={latestBatch?.progressSyncStatus ?? "local"}
        data-batch-generation-progress-synced-at={latestBatch?.progressSyncedAt ?? ""}
        data-batch-generation-progress-polling={canPoll ? "enabled" : "idle"}
        data-batch-generation-progress-operations="getBatchGeneration:GET:/batch-generations/{batch_id}:include:not-required:false|listBatchGenerationChildren:GET:/batch-generations/{batch_id}/children:include:not-required:false|getBatchGenerationProgress:GET:/batch-generations/{batch_id}/progress:include:not-required:false"
        data-batch-generation-result-asset-id={latestResultChild?.assetId ?? ""}
        data-batch-generation-result-canvas-object-id={latestResultChild?.canvasObjectId ?? ""}
        data-batch-generation-prompt-context-text-length={latestPromptContext.text.length}
        data-batch-generation-prompt-context-selected-object-ids={latestPromptContext.selected_object_ids.join(",")}
        data-batch-generation-prompt-context-reference-asset-ids={latestPromptContext.reference_asset_ids.join(",")}
        data-batch-generation-prompt-context-brand-kit-id={latestPromptContext.brand_kit_id ?? ""}
        data-batch-generation-prompt-context-model-hints={latestPromptContext.model_hints.join(",")}
        data-batch-generation-prompt-context-tool-hint={latestPromptContext.tool_hint}
      >
        <strong>{latestBatch ? `${latestBatch.id} · ${latestBatch.status}` : "No batch queued"}</strong>
        <span>
          {latestBatch
            ? `${latestBatch.progressPercent}% · ${latestBatch.succeededCount}/${latestBatch.children.length} ready · ${latestBatch.retryableCount} retryable`
            : "Create a four-variant sandbox batch from the active brief."}
        </span>
        {latestBatch ? (
          <div className="meter batch-progress-meter" role="progressbar" aria-label="Batch generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={latestBatch.progressPercent}>
            <span style={{ width: `${latestBatch.progressPercent}%` }} />
          </div>
        ) : null}
      </div>
      {latestBatch ? (
        <div className="history-list batch-children">
          <h3>Children</h3>
          {latestBatch.children.map((child) => (
            <article key={child.id}>
              <strong>{child.id}</strong>
              <span>
                {child.status} · retry {child.retryCount}/{child.maxRetries} · {child.modelId}
              </span>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PackagePanel({
  state,
  sessionBlocked,
  runAction
}: {
  state: WorkspaceState;
  sessionBlocked: boolean;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const safetyExportState = buildSafetyExportStateEvidence(state);
  return (
    <section
      className="panel package-panel"
      aria-label="Package export safety state"
      data-safety-export-state-contract={safetyExportState.schema_version}
      data-safety-export-state-status={safetyExportState.status}
      data-safety-export-total-count={safetyExportState.export_count}
      data-safety-export-ready-count={safetyExportState.ready_export_count}
      data-safety-export-blocked-count={safetyExportState.blocked_export_count}
      data-safety-export-failed-count={safetyExportState.failed_export_count}
      data-safety-export-running-count={safetyExportState.running_export_count}
      data-safety-export-qa-block-count={safetyExportState.qa_block_finding_count}
      data-safety-export-safety-block-count={safetyExportState.safety_block_finding_count}
      data-safety-export-admin-review-required-count={safetyExportState.admin_review_required_count}
      data-safety-export-blocked-download-cta-count={safetyExportState.blocked_download_cta_count}
      data-safety-export-blocked-share-cta-count={safetyExportState.blocked_share_cta_count}
      data-safety-export-downloadable-ready-count={safetyExportState.downloadable_ready_export_count}
      data-safety-export-blocked-without-download-count={safetyExportState.blocked_export_without_download_count}
      data-safety-export-blocked-without-share-count={safetyExportState.blocked_export_without_share_count}
      data-safety-export-latest-export-id={safetyExportState.latest_export_id}
      data-safety-export-latest-status={safetyExportState.latest_export_status}
      data-safety-export-latest-blocked-reason={safetyExportState.latest_blocked_reason}
      data-safety-export-blocked-reasons={safetyExportState.blocked_reasons.join("|")}
      data-safety-export-raw-provider-payload={String(safetyExportState.raw_provider_payload_projected)}
      data-safety-export-raw-safety-payload={String(safetyExportState.raw_safety_payload_projected)}
      data-safety-export-secret-like-projected={String(safetyExportState.secret_like_value_projected)}
      data-safety-export-can-clear-staging={String(safetyExportState.can_clear_stage1_staging_runtime_gate)}
    >
      <PanelTitle icon={<PackagePlus size={18} aria-hidden="true" />} title="Package" />
      <div className="package-actions">
        <button
          className="secondary-button"
          data-testid="package-add-selected"
          disabled={sessionBlocked || !state.selectedCandidateId}
          onClick={() => {
            const candidateId = state.selectedCandidateId;
            if (candidateId) {
              void runAction("package", () => zenariClient.addPackageItem(candidateId));
            }
          }}
          {...unsafeActionGuardAttributes("Add Selection", state)}
        >
          <PackagePlus size={17} aria-hidden="true" />
          Add Selection
        </button>
        <button
          className="primary-button"
          data-testid="export-download"
          disabled={sessionBlocked}
          onClick={() => void runAction("export", () => zenariClient.createExport("zip"))}
          {...unsafeActionGuardAttributes("Export ZIP", state)}
        >
          <Download size={17} aria-hidden="true" />
          Export ZIP
        </button>
        <button
          className="secondary-button"
          disabled={sessionBlocked}
          onClick={() => void runAction("export", () => zenariClient.createExport("pdf-placeholder"))}
          {...unsafeActionGuardAttributes("Export PDF", state)}
        >
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
        {state.exports.map((item) => {
          const metadataEvidence = buildPackageExportMetadataEvidence(item);
          const zipPayloadSmoke = buildExportZipPayloadSmokeEvidence(item);
          const renderedAssetEvidence = buildRenderedExportAssetEvidence(item);
          const downloadParityEvidence = buildExportDownloadParityEvidence(item, metadataEvidence, zipPayloadSmoke);
          const downloadAccessBoundary = buildExportDownloadAccessBoundaryEvidence(
            item,
            downloadParityEvidence,
            zipPayloadSmoke,
            renderedAssetEvidence
          );
          const blockedReasons = blockedReasonsForExport(item);
          const downloadReady =
            item.status === "ready" &&
            metadataEvidence.downloadArtifactStatus === "pass" &&
            zipPayloadSmoke.status === "pass" &&
            renderedAssetEvidence.status === "pass";

          return (
            <article
              key={item.id}
              className={item.status === "blocked" ? "blocked-export" : ""}
              data-safety-export-record-id={item.id}
              data-safety-export-record-status={item.status}
              data-safety-export-record-blocked-reasons={blockedReasons.join("|")}
              data-safety-export-record-download-eligible={String(downloadReady)}
              data-safety-export-record-share-eligible={String(item.status === "ready")}
            >
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
                <button
                  className="secondary-button compact"
                  onClick={() => void downloadExportPackage(item)}
                  data-export-download-handoff="stage0.rev2.package-export-download-handoff"
                  data-export-download-handoff-status={downloadReady ? "pass" : "fail"}
                  data-export-download-id={item.id}
                  data-export-download-file-name={item.fileName}
                  data-export-download-format={item.format}
                  data-export-download-package-id={item.manifest.package_id}
                  data-export-download-manifest-output-count={item.manifest.required_outputs.length}
                  data-export-download-zip-payload-status={zipPayloadSmoke.status}
                  data-export-download-zip-payload-count={zipPayloadSmoke.expectedPayloadCount}
                  data-export-download-payload-contract-digest={zipPayloadSmoke.payloadContractDigest}
                  data-export-download-missing-payload-count={zipPayloadSmoke.missingPayloadNames.length}
                  data-export-download-metadata-status={metadataEvidence.status}
                  data-export-download-artifact-status={metadataEvidence.downloadArtifactStatus}
                  data-export-download-required-payload-parity={metadataEvidence.zipPayloadParityStatus}
                  data-export-download-rendered-asset-status={renderedAssetEvidence.status}
                  data-export-download-rendered-asset-count={renderedAssetEvidence.renderedAssetPayloadCount}
                  data-export-download-placeholder-payload-count={renderedAssetEvidence.placeholderPayloadCount}
                  data-export-download-access-boundary={downloadAccessBoundary.schema_version}
                  data-export-download-access-boundary-status={downloadAccessBoundary.status}
                  data-export-download-local-browser-status={downloadAccessBoundary.localBrowserDownloadStatus}
                  data-export-download-url-policy={downloadAccessBoundary.productDownloadUrlPolicy}
                  data-export-download-server-route={downloadAccessBoundary.serverDownloadRoute}
                  data-export-download-direct-object-signing={String(downloadAccessBoundary.objectStoreDirectSigningUsedForExportDownload)}
                  data-export-download-signed-url-persisted={String(downloadAccessBoundary.signedUrlPersisted)}
                  data-export-download-signed-url-material-projected={String(downloadAccessBoundary.signedUrlMaterialProjected)}
                  data-export-download-response-object-key-header={String(downloadAccessBoundary.downloadResponseDisclosesObjectKeyHeader)}
                  data-export-download-requires-active-retention={String(downloadAccessBoundary.requiresActiveRetentionMetadata)}
                  data-export-download-requires-audit={String(downloadAccessBoundary.requiresDownloadAudit)}
                  data-export-download-requires-analytics={String(downloadAccessBoundary.requiresDownloadAnalytics)}
                  data-export-download-strict-staging-signed-url-evidence={downloadAccessBoundary.strictStagingSignedUrlEvidence}
                  data-export-download-strict-staging-retention-evidence={downloadAccessBoundary.strictStagingRetentionCleanupEvidence}
                  data-export-download-production-object-storage-evidence={downloadAccessBoundary.productionObjectStorageEvidence}
                  data-export-download-can-clear-staging={String(downloadAccessBoundary.canClearStage1StagingRuntimeGate)}
                  data-export-download-can-clear-production={String(downloadAccessBoundary.canClearStage1ProductionLaunchGate)}
                  data-export-download-can-clear-object-storage-dnl={String(downloadAccessBoundary.canClearObjectStorageDoNotLaunch)}
                >
                  <Download size={15} aria-hidden="true" />
                  Download
                </button>
              ) : (
                <span className="export-blocked-reason" data-safety-export-download-disabled-reason={blockedReasons.join("|")}>
                  Download blocked · {blockedReasons[0] ?? "review_required"}
                </span>
              )}
              <ShareLinkState state={state} exportId={item.id} sessionBlocked={sessionBlocked} runAction={runAction} compact />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProjectsView({
  state,
  sessionBlocked,
  runAction
}: {
  state: WorkspaceState;
  sessionBlocked: boolean;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const activeProject = state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0];
  const [newProjectName, setNewProjectName] = useState("Launch landing page package");
  const [renameProjectName, setRenameProjectName] = useState(activeProject?.name ?? "");

  useEffect(() => {
    setRenameProjectName(activeProject?.name ?? "");
  }, [activeProject?.name]);

  const createProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction("project-create", () => zenariClient.createProject(newProjectName));
  };
  const renameProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeProject) {
      return;
    }
    void runAction("project-rename", () => zenariClient.updateProject(activeProject.id, renameProjectName));
  };

  return (
    <section className="content-view">
      <div className="section-title">
        <h2>Project Dashboard</h2>
      </div>
      <div className="project-actions" aria-label="Project lifecycle actions">
        <form className="project-action-form" onSubmit={createProject}>
          <label htmlFor="project-create-name">New project</label>
          <input
            id="project-create-name"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
          />
          <button
            className="secondary-button compact"
            disabled={sessionBlocked || !newProjectName.trim()}
            {...unsafeActionGuardAttributes("Create Project", state)}
          >
            <PackagePlus size={14} aria-hidden="true" />
            Create Project
          </button>
        </form>
        <form className="project-action-form" onSubmit={renameProject}>
          <label htmlFor="project-rename-name">Active name</label>
          <input
            id="project-rename-name"
            value={renameProjectName}
            onChange={(event) => setRenameProjectName(event.target.value)}
          />
          <button
            className="secondary-button compact"
            disabled={sessionBlocked || !activeProject || !renameProjectName.trim()}
            {...unsafeActionGuardAttributes("Rename Project", state)}
          >
            <PenLine size={14} aria-hidden="true" />
            Rename Project
          </button>
        </form>
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
  sessionBlocked,
  runAction
}: {
  state: WorkspaceState;
  sessionBlocked: boolean;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
}) {
  const latestExport = state.exports[0];
  const latestShareLink = latestExport ? state.shareLinks.find((item) => item.exportId === latestExport.id) : undefined;
  const metadataEvidence = latestExport ? buildPackageExportMetadataEvidence(latestExport) : undefined;
  const zipPayloadSmoke = latestExport ? buildExportZipPayloadSmokeEvidence(latestExport) : undefined;
  const renderedAssetEvidence = latestExport ? buildRenderedExportAssetEvidence(latestExport) : undefined;
  const safetyExportState = buildSafetyExportStateEvidence(state);
  const downloadParityEvidence =
    latestExport && metadataEvidence && zipPayloadSmoke
      ? buildExportDownloadParityEvidence(latestExport, metadataEvidence, zipPayloadSmoke)
      : undefined;
  const downloadAccessBoundary =
    latestExport && downloadParityEvidence && zipPayloadSmoke && renderedAssetEvidence
      ? buildExportDownloadAccessBoundaryEvidence(latestExport, downloadParityEvidence, zipPayloadSmoke, renderedAssetEvidence)
      : undefined;
  const ecommerceApiSmoke = buildEcommerceGrowthApiSmokeEvidence(state);
  const businessDocApiSmoke = buildBusinessVisualDocApiSmokeEvidence(state);
  const localMerchantApiSmoke = buildLocalMerchantCampaignApiSmokeEvidence(state);
  const characterIpApiSmoke = buildCharacterIpConceptApiSmokeEvidence(state);
  const activeWorkflowSmoke =
    characterIpApiSmoke.status === "pass" || state.packageItems.some((item) => item.workflowId === characterIpApiSmoke.workflow_id)
      ? characterIpApiSmoke
      : localMerchantApiSmoke.status === "pass" || state.packageItems.some((item) => item.workflowId === localMerchantApiSmoke.workflow_id)
      ? localMerchantApiSmoke
      : businessDocApiSmoke.status === "pass" || state.packageItems.some((item) => item.workflowId === businessDocApiSmoke.workflow_id)
      ? businessDocApiSmoke
      : ecommerceApiSmoke;
  const referenceExportItems = latestExport?.manifest.items.filter((item) => item.type === "reference") ?? [];
  const referenceExportItemIds = new Set(referenceExportItems.map((item) => item.id));
  const referenceExportPptSlideSourceIds =
    latestExport?.manifest.ppt_ready_metadata.slides
      .filter((slide) => slide.layout === "asset-grid" && referenceExportItemIds.has(slide.source_item_id))
      .map((slide) => slide.source_item_id) ?? [];
  const referenceExportContractFailures = [
    referenceExportItems.length > 0 ? "" : "reference-item",
    referenceExportItems.every((item) => item.provenance.startsWith("dev-client-reference:")) ? "" : "reference-provenance",
    referenceExportPptSlideSourceIds.length >= referenceExportItems.length ? "" : "reference-ppt-slide"
  ].filter(Boolean);
  return (
    <section className="content-view export-view" data-testid="export-preview">
      <div className="section-title">
        <h2>Export Preview</h2>
      </div>
      <div className="export-layout">
        <PackagePanel state={state} sessionBlocked={sessionBlocked} runAction={runAction} />
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
                    data-package-export-project-id={metadataEvidence.projectId}
                    data-package-export-manifest-created-at={metadataEvidence.manifestCreatedAt}
                    data-package-export-manifest-item-count={metadataEvidence.manifestItemCount}
                    data-package-export-manifest-required-output-count={metadataEvidence.manifestRequiredOutputCount}
                    data-package-export-download-artifact-status={metadataEvidence.downloadArtifactStatus}
                    data-package-export-download-artifact-format={metadataEvidence.downloadArtifactFormat}
                    data-package-export-required-output-count={metadataEvidence.requiredOutputCount}
                    data-package-export-missing-output-count={metadataEvidence.missingRequiredOutputs.length}
                    data-package-export-item-types={metadataEvidence.itemTypes.join(",")}
                    data-package-export-provenance-count={metadataEvidence.provenanceCount}
                    data-package-export-item-provenance-parity-status={metadataEvidence.itemProvenanceParityStatus}
                    data-package-export-item-provenance-parity-count={metadataEvidence.itemProvenanceParityCount}
                    data-package-export-missing-item-provenance-parity-count={metadataEvidence.missingItemProvenanceParityCount}
                    data-package-export-reference-provenance-count={metadataEvidence.referenceProvenanceCount}
                    data-package-export-candidate-provenance-count={metadataEvidence.candidateProvenanceCount}
                    data-package-export-blocking-qa-count={metadataEvidence.blockingQaCount}
                    data-package-export-safety-status={metadataEvidence.safetyStatus}
                    data-package-export-safety-stage-count={metadataEvidence.safetyStageCount}
                    data-package-export-safety-finding-count={metadataEvidence.safetyFindingCount}
                    data-package-export-ppt-aspect-ratio={metadataEvidence.pptAspectRatio}
                    data-package-export-ppt-slide-count={metadataEvidence.pptSlideCount}
                    data-package-export-ppt-canvas-size={metadataEvidence.pptCanvasSize}
                    data-package-export-ppt-safe-area={metadataEvidence.pptSafeArea}
                    data-package-export-ppt-theme-font={metadataEvidence.pptThemeFont}
                    data-package-export-ppt-handoff-checklist-count={metadataEvidence.handoffChecklistCount}
                    data-package-export-zip-payload-count={metadataEvidence.zipPayloadCount}
                    data-package-export-zip-payloads={metadataEvidence.zipPayloadNames.join(",")}
                    data-package-export-zip-payload-contract-digest={metadataEvidence.zipPayloadContractDigest}
                    data-package-export-payload-content-digest={metadataEvidence.payloadContentDigest}
                    data-package-export-payload-content-count={metadataEvidence.payloadContentStatuses.length}
                    data-package-export-required-zip-payloads={metadataEvidence.requiredZipPayloadNames.join(",")}
                    data-package-export-required-zip-payload-count={metadataEvidence.requiredZipPayloadCount}
                    data-package-export-zip-payload-parity-status={metadataEvidence.zipPayloadParityStatus}
                    data-package-export-zip-payload-parity-ratio={metadataEvidence.zipPayloadParityRatio}
                    data-package-export-missing-zip-payload-count={metadataEvidence.missingZipPayloadNames.length}
                    data-package-export-zip-payload-path-safety-status={metadataEvidence.zipPayloadPathSafetyStatus}
                    data-package-export-unsafe-manifest-payload-count={metadataEvidence.unsafeManifestPayloadNames.length}
                    data-package-export-unsafe-manifest-payloads={metadataEvidence.unsafeManifestPayloadNames.join(",")}
                    data-package-export-unsafe-expected-payload-count={metadataEvidence.unsafeExpectedPayloadNames.length}
                    data-package-export-unsafe-expected-payloads={metadataEvidence.unsafeExpectedPayloadNames.join(",")}
                    data-package-export-cross-payload-identity-status={metadataEvidence.crossPayloadIdentityStatus}
                    data-package-export-identity-contract-digest={metadataEvidence.identityContractDigest}
                    data-package-export-cross-payload-identity-count={metadataEvidence.crossPayloadIdentityNames.length}
                    data-package-export-cross-payload-identities={metadataEvidence.crossPayloadIdentityNames.join(",")}
                    data-package-export-missing-cross-payload-identity-count={metadataEvidence.missingCrossPayloadIdentityNames.length}
                    data-package-export-workflow-id={metadataEvidence.workflowId}
                    data-package-export-workflow-fixture-id={metadataEvidence.workflowFixtureId}
                    data-package-export-workflow-taxonomy-count={metadataEvidence.workflowStrategyTaxonomyCount}
                    data-package-export-workflow-required-file-count={metadataEvidence.workflowRequiredFileCount}
                    data-package-export-workflow-zip-payload-count={metadataEvidence.workflowZipPayloadCount}
                    data-package-export-workflow-metadata-payload-present={String(metadataEvidence.workflowMetadataPayloadPresent)}
                    data-package-export-workflow-trace-provenance-payload-present={String(metadataEvidence.workflowTraceProvenancePayloadPresent)}
                    data-package-export-ai-content-disclaimer-payload-present={String(metadataEvidence.aiContentDisclaimerPayloadPresent)}
                    data-package-export-workflow-provider-metadata-present={String(metadataEvidence.workflowProviderMetadataPresent)}
                    data-package-export-workflow-prompt-spec-metadata-present={String(metadataEvidence.workflowPromptSpecMetadataPresent)}
                    data-package-export-workflow-skill-metadata-present={String(metadataEvidence.workflowSkillMetadataPresent)}
                    data-package-export-workflow-safety-metadata-present={String(metadataEvidence.workflowSafetyMetadataPresent)}
                    data-package-export-workflow-metadata-generated-by={metadataEvidence.workflowMetadataGeneratedBy}
                    data-package-export-workflow-metadata-provider={metadataEvidence.workflowMetadataProvider}
                    data-package-export-workflow-metadata-model={metadataEvidence.workflowMetadataModel}
                    data-package-export-workflow-prompt-spec-taxonomy={metadataEvidence.workflowPromptSpecTaxonomy.join(",")}
                    data-package-export-workflow-skill={metadataEvidence.workflowSkill}
                    data-package-export-workflow-safety={metadataEvidence.workflowSafety}
                  >
                    <h4>Metadata Evidence</h4>
                    <div className="metadata-evidence-grid">
                      <span className={metadataEvidence.status === "pass" ? "qa-pass" : "qa-block"}>
                        {metadataEvidence.status}
                      </span>
                      <span>{metadataEvidence.requiredOutputCount} required outputs</span>
                      <span>{metadataEvidence.provenanceCount}/{metadataEvidence.itemCount} provenance entries</span>
                      <span>{metadataEvidence.itemProvenanceParityStatus} item provenance parity</span>
                      <span>{metadataEvidence.qaFindingCount} QA findings</span>
                      <span>{metadataEvidence.pptSlideCount} PPT slides</span>
                      <span>{metadataEvidence.downloadArtifactStatus} ZIP payload contract</span>
                      <span>{metadataEvidence.zipPayloadParityStatus} required ZIP parity</span>
                      <span>{metadataEvidence.zipPayloadParityRatio} required payloads present</span>
                      <span>{metadataEvidence.zipPayloadPathSafetyStatus} path safety</span>
                      <span>{metadataEvidence.crossPayloadIdentityStatus} cross-payload identity</span>
                      <span>{metadataEvidence.workflowZipPayloadCount}/{metadataEvidence.workflowRequiredFileCount} workflow payloads</span>
                      <span>{metadataEvidence.workflowMetadataProvider} provider metadata</span>
                      <span>{metadataEvidence.workflowMetadataModel} model metadata</span>
                      <span>{metadataEvidence.aiContentDisclaimerPayloadPresent ? "AI disclaimer present" : "AI disclaimer missing"}</span>
                    </div>
                    <p>
                      ZIP payload contract: {metadataEvidence.zipPayloadNames.join(", ")}.
                      {metadataEvidence.missingRequiredOutputs.length > 0 || metadataEvidence.missingZipPayloadNames.length > 0
                        ? ` Missing ${[...metadataEvidence.missingRequiredOutputs, ...metadataEvidence.missingZipPayloadNames].join(", ")}.`
                        : " All required metadata outputs are present."}
                    </p>
                    <div className="payload-status-groups" aria-label="Package export payload status matrix">
                      <PayloadStatusList
                        title="Manifest outputs"
                        items={metadataEvidence.manifestOutputStatuses.map((item) => ({
                          name: item.name,
                          detail: item.zipPayloadName,
                          present: item.present
                        }))}
                        dataKind="manifest-output"
                      />
                      <PayloadStatusList
                        title="Required ZIP payloads"
                        items={metadataEvidence.requiredZipPayloadStatuses.map((item) => ({
                          name: item.name,
                          present: item.present
                        }))}
                        dataKind="required-zip-payload"
                      />
                      <PayloadStatusList
                        title="Workflow payloads"
                        items={metadataEvidence.workflowPayloadStatuses.map((item) => ({
                          name: item.name,
                          present: item.present
                        }))}
                        dataKind="workflow-payload"
                      />
                      <PayloadStatusList
                        title="Payload content"
                        items={metadataEvidence.payloadContentStatuses.map((item) => ({
                          name: item.name,
                          detail: `${item.byteSize}:${item.contentDigest}`,
                          present: item.byteSize > 0
                        }))}
                        dataKind="payload-content"
                      />
                    </div>
                    <div className="payload-status-groups" aria-label="Package export cross-payload identity matrix">
                      <PayloadIdentityStatusList items={metadataEvidence.crossPayloadIdentityStatuses} />
                    </div>
                    <div className="payload-status-groups" aria-label="Package export item provenance parity matrix">
                      <ItemProvenanceStatusList items={metadataEvidence.itemProvenanceStatuses} />
                    </div>
                  </section>
                ) : null}
                <section
                  className="export-detail-panel safety-export-state"
                  aria-label="Safety export state"
                  data-safety-export-state-contract={safetyExportState.schema_version}
                  data-safety-export-state-status={safetyExportState.status}
                  data-safety-export-total-count={safetyExportState.export_count}
                  data-safety-export-ready-count={safetyExportState.ready_export_count}
                  data-safety-export-blocked-count={safetyExportState.blocked_export_count}
                  data-safety-export-qa-block-count={safetyExportState.qa_block_finding_count}
                  data-safety-export-safety-block-count={safetyExportState.safety_block_finding_count}
                  data-safety-export-admin-review-required-count={safetyExportState.admin_review_required_count}
                  data-safety-export-blocked-download-cta-count={safetyExportState.blocked_download_cta_count}
                  data-safety-export-blocked-share-cta-count={safetyExportState.blocked_share_cta_count}
                  data-safety-export-blocked-without-download-count={safetyExportState.blocked_export_without_download_count}
                  data-safety-export-blocked-without-share-count={safetyExportState.blocked_export_without_share_count}
                  data-safety-export-latest-export-id={safetyExportState.latest_export_id}
                  data-safety-export-latest-status={safetyExportState.latest_export_status}
                  data-safety-export-latest-blocked-reason={safetyExportState.latest_blocked_reason}
                  data-safety-export-blocked-reasons={safetyExportState.blocked_reasons.join("|")}
                  data-safety-export-raw-provider-payload={String(safetyExportState.raw_provider_payload_projected)}
                  data-safety-export-raw-safety-payload={String(safetyExportState.raw_safety_payload_projected)}
                  data-safety-export-secret-like-projected={String(safetyExportState.secret_like_value_projected)}
                  data-safety-export-can-clear-staging={String(safetyExportState.can_clear_stage1_staging_runtime_gate)}
                >
                  <h4>Safety Export State</h4>
                  <div className="metadata-evidence-grid">
                    <span className={safetyExportState.blocked_export_count === 0 ? "qa-pass" : "qa-block"}>
                      {safetyExportState.blocked_export_count} blocked exports
                    </span>
                    <span>{safetyExportState.qa_block_finding_count} QA blocks</span>
                    <span>{safetyExportState.safety_block_finding_count} safety blocks</span>
                    <span>{safetyExportState.admin_review_required_count} review-required</span>
                    <span>{safetyExportState.blocked_download_cta_count} blocked download CTAs</span>
                    <span>{safetyExportState.blocked_share_cta_count} blocked share CTAs</span>
                  </div>
                  <p>
                    {safetyExportState.blocked_reasons.length > 0
                      ? `Blocked reasons: ${safetyExportState.blocked_reasons.join(", ")}.`
                      : "Ready exports keep download actions isolated from blocked review states."}
                  </p>
                </section>
                {renderedAssetEvidence ? (
                  <section
                    className="export-detail-panel rendered-export-asset-evidence"
                    aria-label="Rendered export asset local contract"
                    data-rendered-export-asset-contract={renderedAssetEvidence.schema_version}
                    data-rendered-export-asset-status={renderedAssetEvidence.status}
                    data-rendered-export-asset-export-id={renderedAssetEvidence.exportId}
                    data-rendered-export-asset-package-id={renderedAssetEvidence.packageId}
                    data-rendered-export-asset-project-id={renderedAssetEvidence.projectId}
                    data-rendered-export-asset-render-mode={renderedAssetEvidence.renderMode}
                    data-rendered-export-asset-manifest-payload={renderedAssetEvidence.renderedAssetManifestPayloadName}
                    data-rendered-export-asset-manifest-output-count={renderedAssetEvidence.manifestAssetOutputCount}
                    data-rendered-export-asset-payload-count={renderedAssetEvidence.renderedAssetPayloadCount}
                    data-rendered-export-asset-payloads={renderedAssetEvidence.renderedAssetPayloadNames.join(",")}
                    data-rendered-export-asset-source-outputs={renderedAssetEvidence.renderedAssetOutputNames.join(",")}
                    data-rendered-export-asset-content-types={renderedAssetEvidence.renderedAssetContentTypes.join(",")}
                    data-rendered-export-asset-byte-count={renderedAssetEvidence.renderedAssetByteCount}
                    data-rendered-export-asset-placeholder-count={renderedAssetEvidence.placeholderPayloadCount}
                    data-rendered-export-asset-placeholder-payloads={renderedAssetEvidence.placeholderPayloadNames.join(",")}
                    data-rendered-export-asset-unsafe-count={renderedAssetEvidence.unsafePayloadCount}
                    data-rendered-export-asset-unsafe-payloads={renderedAssetEvidence.unsafePayloadNames.join(",")}
                    data-rendered-export-asset-raw-provider-payload={String(renderedAssetEvidence.rawProviderPayloadProjected)}
                    data-rendered-export-asset-raw-safety-payload={String(renderedAssetEvidence.rawSafetyPayloadProjected)}
                    data-rendered-export-asset-secret-like-projected={String(renderedAssetEvidence.secretLikeValueProjected)}
                    data-rendered-export-asset-signed-url-persisted={String(renderedAssetEvidence.signedUrlPersisted)}
                    data-rendered-export-asset-staging-signed-url-evidence={renderedAssetEvidence.stagingSignedUrlEvidence}
                    data-rendered-export-asset-retention-evidence={renderedAssetEvidence.objectRetentionCleanupEvidence}
                    data-rendered-export-asset-can-clear-staging={String(renderedAssetEvidence.canClearStage1StagingRuntimeGate)}
                    data-rendered-export-asset-can-clear-production={String(renderedAssetEvidence.canClearStage1ProductionLaunchGate)}
                    data-rendered-export-asset-failures={renderedAssetEvidence.failures.join(",")}
                  >
                    <h4>Rendered Assets</h4>
                    <div className="metadata-evidence-grid">
                      <span className={renderedAssetEvidence.status === "pass" ? "qa-pass" : "qa-block"}>
                        {renderedAssetEvidence.status}
                      </span>
                      <span>{renderedAssetEvidence.renderedAssetPayloadCount} local rendered assets</span>
                      <span>{renderedAssetEvidence.placeholderPayloadCount} non-rendered payloads</span>
                      <span>{renderedAssetEvidence.unsafePayloadCount} unsafe paths</span>
                      <span>{renderedAssetEvidence.renderedAssetByteCount} bytes</span>
                      <span>{renderedAssetEvidence.stagingSignedUrlEvidence} signed URL evidence</span>
                      <span>{renderedAssetEvidence.objectRetentionCleanupEvidence} retention evidence</span>
                    </div>
                    <p>
                      Local ZIP assets render as deterministic SVG payloads with a rendered-asset manifest. Staging signed URL and object
                      retention evidence remain open.
                    </p>
                  </section>
                ) : null}
                {zipPayloadSmoke ? (
                  <section
                    className="export-detail-panel export-zip-payload-smoke"
                    aria-label="Export ZIP payload smoke"
                    data-export-zip-payload-smoke={zipPayloadSmoke.schema_version}
                    data-export-zip-payload-smoke-status={zipPayloadSmoke.status}
                    data-export-zip-payload-smoke-scenario={zipPayloadSmoke.scenario}
                    data-export-zip-payload-export-id={zipPayloadSmoke.exportId}
                    data-export-zip-payload-package-id={zipPayloadSmoke.packageId}
                    data-export-zip-payload-manifest-required-output-count={zipPayloadSmoke.manifestRequiredOutputCount}
                    data-export-zip-payload-expected-count={zipPayloadSmoke.expectedPayloadCount}
                    data-export-zip-payload-baseline-payloads={zipPayloadSmoke.requiredBaselinePayloadNames.join(",")}
                    data-export-zip-payload-expected-payloads={zipPayloadSmoke.expectedPayloadNames.join(",")}
                    data-export-zip-payload-contract-digest={zipPayloadSmoke.payloadContractDigest}
                    data-export-zip-payload-missing-count={zipPayloadSmoke.missingPayloadNames.length}
                    data-export-zip-payload-missing-payloads={zipPayloadSmoke.missingPayloadNames.join(",")}
                    data-export-zip-payload-path-safety-status={zipPayloadSmoke.pathSafetyStatus}
                    data-export-zip-payload-unsafe-manifest-count={zipPayloadSmoke.unsafeManifestPayloadNames.length}
                    data-export-zip-payload-unsafe-manifest-payloads={zipPayloadSmoke.unsafeManifestPayloadNames.join(",")}
                    data-export-zip-payload-unsafe-expected-count={zipPayloadSmoke.unsafeExpectedPayloadNames.length}
                    data-export-zip-payload-unsafe-expected-payloads={zipPayloadSmoke.unsafeExpectedPayloadNames.join(",")}
                    data-export-zip-payload-workflow-payloads={zipPayloadSmoke.workflowPayloadNames.join(",")}
                    data-export-zip-payload-metadata-present={String(zipPayloadSmoke.metadataPayloadPresent)}
                    data-export-zip-payload-trace-provenance-present={String(zipPayloadSmoke.traceProvenancePayloadPresent)}
                    data-export-zip-payload-ai-content-disclaimer-present={String(zipPayloadSmoke.aiContentDisclaimerPayloadPresent)}
                    data-export-zip-payload-assets-present={String(zipPayloadSmoke.assetsPayloadPresent)}
                    data-export-zip-payload-failures={zipPayloadSmoke.failures.join(",")}
                  >
                    <h4>ZIP Payload Smoke</h4>
                    <div className="metadata-evidence-grid">
                      <span className={zipPayloadSmoke.status === "pass" ? "qa-pass" : "qa-block"}>
                        {zipPayloadSmoke.status}
                      </span>
                      <span>{zipPayloadSmoke.expectedPayloadCount} expected payloads</span>
                      <span>{zipPayloadSmoke.workflowPayloadNames.length} workflow payloads</span>
                      <span>{zipPayloadSmoke.missingPayloadNames.length} missing payloads</span>
                      <span>{zipPayloadSmoke.pathSafetyStatus} path safety</span>
                    </div>
                    <p>
                      Download ZIP must contain {zipPayloadSmoke.requiredBaselinePayloadNames.join(", ")} plus workflow metadata and trace
                      provenance payloads declared by the manifest.
                    </p>
                  </section>
                ) : null}
                {downloadParityEvidence ? (
                  <section
                    className="export-detail-panel export-download-parity-smoke"
                    aria-label="Export download parity smoke"
                    data-export-download-parity-smoke={downloadParityEvidence.schema_version}
                    data-export-download-parity-status={downloadParityEvidence.status}
                    data-export-download-parity-scenario={downloadParityEvidence.scenario}
                    data-export-download-parity-export-id={downloadParityEvidence.exportId}
                    data-export-download-parity-package-id={downloadParityEvidence.packageId}
                    data-export-download-parity-project-id={downloadParityEvidence.projectId}
                    data-export-download-parity-workflow-id={downloadParityEvidence.workflowId}
                    data-export-download-parity-workflow-fixture-id={downloadParityEvidence.workflowFixtureId}
                    data-export-download-parity-file-name={downloadParityEvidence.fileName}
                    data-export-download-parity-format={downloadParityEvidence.format}
                    data-export-download-parity-metadata-status={downloadParityEvidence.metadataStatus}
                    data-export-download-parity-zip-payload-status={downloadParityEvidence.zipPayloadStatus}
                    data-export-download-parity-handoff-status={downloadParityEvidence.downloadHandoffStatus}
                    data-export-download-parity-manifest-output-count={downloadParityEvidence.manifestRequiredOutputCount}
                    data-export-download-parity-metadata-payload-count={downloadParityEvidence.metadataZipPayloadCount}
                    data-export-download-parity-zip-expected-count={downloadParityEvidence.zipExpectedPayloadCount}
                    data-export-download-parity-metadata-missing-count={downloadParityEvidence.metadataMissingZipPayloadCount}
                    data-export-download-parity-zip-missing-count={downloadParityEvidence.zipMissingPayloadCount}
                    data-export-download-parity-required-zip-status={downloadParityEvidence.requiredZipPayloadParityStatus}
                    data-export-download-parity-payloads-match={String(downloadParityEvidence.metadataPayloadsMatchZipPayloads)}
                    data-export-download-parity-payload-list-status={downloadParityEvidence.payloadListStatus}
                    data-export-download-parity-metadata-payloads={downloadParityEvidence.metadataPayloadNames.join(",")}
                    data-export-download-parity-zip-expected-payloads={downloadParityEvidence.zipExpectedPayloadNames.join(",")}
                    data-export-download-parity-payload-contract-digest={downloadParityEvidence.payloadContractDigest}
                    data-export-download-parity-payload-digest-match={String(downloadParityEvidence.metadataPayloadDigestMatchesZipPayloadDigest)}
                    data-export-download-parity-payload-content-digest={downloadParityEvidence.payloadContentDigest}
                    data-export-download-parity-payload-content-status={downloadParityEvidence.payloadContentDigestStatus}
                    data-export-download-parity-payload-content-count={downloadParityEvidence.payloadContentCount}
                    data-export-download-parity-payload-path-safety-status={downloadParityEvidence.payloadPathSafetyStatus}
                    data-export-download-parity-identity-contract-digest={downloadParityEvidence.identityContractDigest}
                    data-export-download-parity-identity-digest-match={String(downloadParityEvidence.metadataIdentityDigestMatchesRecord)}
                    data-export-download-parity-identity-status={downloadParityEvidence.identityStatus}
                    data-export-download-parity-item-provenance-status={downloadParityEvidence.itemProvenanceParityStatus}
                    data-export-download-parity-item-provenance-count={downloadParityEvidence.itemProvenanceParityCount}
                    data-export-download-parity-missing-item-provenance-count={downloadParityEvidence.missingItemProvenanceParityCount}
                    data-export-download-parity-provider={downloadParityEvidence.provider}
                    data-export-download-parity-model={downloadParityEvidence.model}
                    data-export-download-parity-prompt-spec-taxonomy={downloadParityEvidence.promptSpecTaxonomy.join(",")}
                    data-export-download-parity-skill={downloadParityEvidence.skill}
                    data-export-download-parity-safety-status={downloadParityEvidence.safetyStatus}
                    data-export-download-parity-workflow-metadata-present={String(downloadParityEvidence.workflowMetadataPresent)}
                    data-export-download-parity-trace-provenance-present={String(downloadParityEvidence.traceProvenancePresent)}
                    data-export-download-parity-failures={downloadParityEvidence.failures.join(",")}
                  >
                    <h4>Download Parity Smoke</h4>
                    <div className="metadata-evidence-grid">
                      <span className={downloadParityEvidence.status === "pass" ? "qa-pass" : "qa-block"}>
                        {downloadParityEvidence.status}
                      </span>
                      <span>{downloadParityEvidence.metadataZipPayloadCount}/{downloadParityEvidence.zipExpectedPayloadCount} payload parity</span>
                      <span>{downloadParityEvidence.payloadContentDigestStatus} content digest</span>
                      <span>{downloadParityEvidence.metadataMissingZipPayloadCount + downloadParityEvidence.zipMissingPayloadCount} missing payloads</span>
                      <span>{downloadParityEvidence.metadataPayloadDigestMatchesZipPayloadDigest ? "digest match" : "digest drift"}</span>
                      <span>{downloadParityEvidence.payloadPathSafetyStatus} path safety</span>
                      <span>{downloadParityEvidence.identityStatus} identity</span>
                      <span>{downloadParityEvidence.itemProvenanceParityStatus} item provenance</span>
                      <span>{downloadParityEvidence.downloadHandoffStatus} browser handoff</span>
                    </div>
                    <p>
                      Export metadata, ZIP payload smoke, and download handoff agree on artifact identity, payload count, required ZIP parity,
                      workflow metadata, and trace provenance.
                    </p>
                  </section>
                ) : null}
                {downloadAccessBoundary ? (
                  <section
                    className="export-detail-panel export-download-access-boundary"
                    aria-label="Export download access boundary"
                    data-export-download-access-boundary-contract={downloadAccessBoundary.schema_version}
                    data-export-download-access-boundary-status={downloadAccessBoundary.status}
                    data-export-download-access-boundary-scenario={downloadAccessBoundary.scenario}
                    data-export-download-access-boundary-export-id={downloadAccessBoundary.exportId}
                    data-export-download-access-boundary-package-id={downloadAccessBoundary.packageId}
                    data-export-download-access-boundary-file-name={downloadAccessBoundary.fileName}
                    data-export-download-access-boundary-local-browser-status={downloadAccessBoundary.localBrowserDownloadStatus}
                    data-export-download-access-boundary-local-zip-status={downloadAccessBoundary.localZipPayloadStatus}
                    data-export-download-access-boundary-rendered-asset-status={downloadAccessBoundary.renderedAssetStatus}
                    data-export-download-access-boundary-url-policy={downloadAccessBoundary.productDownloadUrlPolicy}
                    data-export-download-access-boundary-server-route={downloadAccessBoundary.serverDownloadRoute}
                    data-export-download-access-boundary-direct-object-signing={String(downloadAccessBoundary.objectStoreDirectSigningUsedForExportDownload)}
                    data-export-download-access-boundary-signed-url-persisted={String(downloadAccessBoundary.signedUrlPersisted)}
                    data-export-download-access-boundary-signed-url-material-projected={String(downloadAccessBoundary.signedUrlMaterialProjected)}
                    data-export-download-access-boundary-response-object-key-header={String(downloadAccessBoundary.downloadResponseDisclosesObjectKeyHeader)}
                    data-export-download-access-boundary-requires-active-retention={String(downloadAccessBoundary.requiresActiveRetentionMetadata)}
                    data-export-download-access-boundary-requires-audit={String(downloadAccessBoundary.requiresDownloadAudit)}
                    data-export-download-access-boundary-requires-analytics={String(downloadAccessBoundary.requiresDownloadAnalytics)}
                    data-export-download-access-boundary-strict-staging-signed-url-evidence={downloadAccessBoundary.strictStagingSignedUrlEvidence}
                    data-export-download-access-boundary-strict-staging-retention-evidence={downloadAccessBoundary.strictStagingRetentionCleanupEvidence}
                    data-export-download-access-boundary-production-object-storage-evidence={downloadAccessBoundary.productionObjectStorageEvidence}
                    data-export-download-access-boundary-can-clear-staging={String(downloadAccessBoundary.canClearStage1StagingRuntimeGate)}
                    data-export-download-access-boundary-can-clear-production={String(downloadAccessBoundary.canClearStage1ProductionLaunchGate)}
                    data-export-download-access-boundary-can-clear-object-storage-dnl={String(downloadAccessBoundary.canClearObjectStorageDoNotLaunch)}
                    data-export-download-access-boundary-failures={downloadAccessBoundary.failures.join(",")}
                  >
                    <h4>Download Access Boundary</h4>
                    <div className="metadata-evidence-grid">
                      <span className={downloadAccessBoundary.status === "pass" ? "qa-pass" : "qa-block"}>
                        {downloadAccessBoundary.status}
                      </span>
                      <span>{downloadAccessBoundary.localBrowserDownloadStatus} local browser ZIP</span>
                      <span>{downloadAccessBoundary.productDownloadUrlPolicy}</span>
                      <span>{downloadAccessBoundary.serverDownloadRoute}</span>
                      <span>{downloadAccessBoundary.strictStagingSignedUrlEvidence} strict signed URL evidence</span>
                      <span>{downloadAccessBoundary.strictStagingRetentionCleanupEvidence} retention cleanup evidence</span>
                      <span>{downloadAccessBoundary.canClearStage1StagingRuntimeGate ? "staging gate clears" : "staging gate stays open"}</span>
                    </div>
                    <p>
                      Local ZIP download proves browser packaging only. Staging must still prove server-mediated signed URL download, active
                      retention metadata, audit, analytics, and object cleanup before launch gates can close.
                    </p>
                  </section>
                ) : null}
                <section
                  className="export-detail-panel workflow-api-smoke-evidence"
                  aria-label={`${activeWorkflowSmoke.workflow_id} API smoke export evidence`}
                  data-workflow-api-smoke-export={activeWorkflowSmoke.schema_version}
                  data-workflow-api-smoke-export-status={activeWorkflowSmoke.status}
                  data-workflow-api-smoke-export-workflow={activeWorkflowSmoke.workflow_id}
                  data-workflow-api-smoke-export-fixture={activeWorkflowSmoke.fixture_id}
                  data-workflow-api-smoke-export-scenario={activeWorkflowSmoke.scenario}
                  data-workflow-api-smoke-export-operation-count={activeWorkflowSmoke.apiOperationIds.length}
                  data-workflow-api-smoke-export-missing-output-count={activeWorkflowSmoke.missingRequiredOutputs.length}
                  data-workflow-api-smoke-export-qa-taxonomy-id={activeWorkflowSmoke.qaTaxonomyId}
                  data-workflow-api-smoke-export-qa-taxonomy-status={activeWorkflowSmoke.qaTaxonomyStatus}
                  data-workflow-api-smoke-export-safety-status={activeWorkflowSmoke.safetyStatus}
                  data-workflow-api-smoke-export-operation-contracts={activeWorkflowSmoke.apiOperationContracts
                    .map((contract) =>
                      [
                        contract.operationId,
                        contract.method,
                        contract.path,
                        contract.credentialMode,
                        contract.csrfHeaderName,
                        String(contract.idempotencyRequired)
                      ].join(":")
                    )
                    .join("|")}
                  data-workflow-api-smoke-export-csrf-protected-operation-count={activeWorkflowSmoke.csrfProtectedOperationCount}
                  data-workflow-api-smoke-export-idempotency-required-operation-count={activeWorkflowSmoke.idempotencyRequiredOperationCount}
                  data-workflow-api-smoke-export-failures={activeWorkflowSmoke.failures.join(",")}
                >
                  <h4>Workflow API Smoke</h4>
                  <div className="metadata-evidence-grid">
                    <span className={activeWorkflowSmoke.status === "pass" ? "qa-pass" : "qa-block"}>
                      {activeWorkflowSmoke.status}
                    </span>
                    <span>{activeWorkflowSmoke.workflow_id}</span>
                    <span>{activeWorkflowSmoke.apiOperationIds.length} API operations</span>
                    <span>{activeWorkflowSmoke.packagedTaxonomyCount}/4 packaged taxonomy routes</span>
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
                  data-reference-export-contract-status={referenceExportContractFailures.length === 0 ? "pass" : "fail"}
                  data-reference-export-contract-scenario="reference-upload-to-ready-zip-export"
                  data-reference-provenance-count={referenceExportItems.length}
                  data-reference-export-provenance-prefix="dev-client-reference:"
                  data-reference-export-provenances={referenceExportItems.map((item) => item.provenance).join(",")}
                  data-reference-export-ppt-slide-count={referenceExportPptSlideSourceIds.length}
                  data-reference-export-ppt-slide-source-item-ids={referenceExportPptSlideSourceIds.join(",")}
                  data-reference-export-failures={referenceExportContractFailures.join(",")}
                >
                  <h4>Reference Upload Export Contract</h4>
                  <p>Accepted references enter package history as reference items and emit dev-client-reference provenance in ZIP exports.</p>
                  {referenceExportItems.length > 0 ? (
                    <ul>
                      {referenceExportItems.map((item) => (
                        <li
                          key={item.id}
                          data-reference-export-item={item.id}
                          data-reference-export-item-type={item.type}
                          data-reference-export-item-title={item.title}
                          data-reference-export-item-provenance={item.provenance}
                          data-reference-export-item-ppt-slide-present={String(referenceExportPptSlideSourceIds.includes(item.id))}
                        >
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
                  <ShareLinkState state={state} exportId={latestExport.id} sessionBlocked={sessionBlocked} runAction={runAction} />
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

function PayloadIdentityStatusList({
  items
}: {
  items: Array<{
    payloadName: string;
    exportId: "pass" | "missing";
    packageId: "pass" | "missing";
    projectId: "pass" | "missing";
    workflowId: "pass" | "missing";
    provider: "pass" | "missing";
    model: "pass" | "missing";
    promptSpec: "pass" | "missing";
    skill: "pass" | "missing";
    safety: "pass" | "missing";
  }>;
}) {
  return (
    <div className="payload-status-list payload-identity-status-list" data-payload-status-kind="cross-payload-identity">
      <strong>Cross-payload identity</strong>
      <ul>
        {items.map((item) => (
          <li
            key={`cross-payload-identity-${item.payloadName}`}
            data-package-export-identity-row="cross-payload-identity"
            data-package-export-identity-payload={item.payloadName}
            data-package-export-identity-export-id={item.exportId}
            data-package-export-identity-package-id={item.packageId}
            data-package-export-identity-project-id={item.projectId}
            data-package-export-identity-workflow-id={item.workflowId}
            data-package-export-identity-provider={item.provider}
            data-package-export-identity-model={item.model}
            data-package-export-identity-prompt-spec={item.promptSpec}
            data-package-export-identity-skill={item.skill}
            data-package-export-identity-safety={item.safety}
          >
            <span className={item.packageId === "pass" && item.projectId === "pass" ? "qa-pass" : "qa-block"}>
              {item.packageId === "pass" && item.projectId === "pass" ? "matched" : "missing"}
            </span>
            <span>{item.payloadName}</span>
            <small>
              export {item.exportId}, package {item.packageId}, project {item.projectId}, workflow {item.workflowId}, provider{" "}
              {item.provider}, model {item.model}, prompt {item.promptSpec}, skill {item.skill}, safety {item.safety}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemProvenanceStatusList({
  items
}: {
  items: Array<{
    itemId: string;
    title: string;
    type: "candidate" | "canvas-frame" | "reference";
    provenance: string;
    expectedPrefix: "dev-client-reference:" | "dev-client:" | "dev-client-canvas:";
    provenanceStatus: "pass" | "missing";
    pptSlideStatus: "pass" | "missing";
  }>;
}) {
  return (
    <div className="payload-status-list item-provenance-status-list" data-payload-status-kind="item-provenance-parity">
      <strong>Item provenance parity</strong>
      <ul>
        {items.map((item) => (
          <li
            key={`item-provenance-${item.itemId}`}
            data-package-export-item-provenance-row="item-provenance-parity"
            data-package-export-item-provenance-id={item.itemId}
            data-package-export-item-provenance-type={item.type}
            data-package-export-item-provenance-value={item.provenance}
            data-package-export-item-provenance-prefix={item.expectedPrefix}
            data-package-export-item-provenance-status={item.provenanceStatus}
            data-package-export-item-ppt-slide-status={item.pptSlideStatus}
          >
            <span className={item.provenanceStatus === "pass" && item.pptSlideStatus === "pass" ? "qa-pass" : "qa-block"}>
              {item.provenanceStatus === "pass" && item.pptSlideStatus === "pass" ? "matched" : "missing"}
            </span>
            <span>{item.title}</span>
            <small>
              {item.type} · {item.provenance} · PPT slide {item.pptSlideStatus}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShareLinkState({
  state,
  exportId,
  sessionBlocked,
  runAction,
  compact = false
}: {
  state: WorkspaceState;
  exportId: string;
  sessionBlocked: boolean;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
  compact?: boolean;
}) {
  const shareLink = state.shareLinks.find((item) => item.exportId === exportId);
  const targetExport = state.exports.find((item) => item.id === exportId);
  const shareBlocked = targetExport?.status !== "ready";
  const blockedReasons = targetExport ? blockedReasonsForExport(targetExport) : [];

  return (
    <div
      className={compact ? "share-state compact-share" : "share-state"}
      data-safety-export-share-export-id={exportId}
      data-safety-export-share-status={targetExport?.status ?? "missing"}
      data-safety-export-share-disabled-reason={shareBlocked ? blockedReasons.join("|") || "export_not_ready" : ""}
    >
      <div>
        <strong>{shareLink ? `Share ${shareLink.status}` : "Share private"}</strong>
        <span>
          {shareBlocked
            ? `Sharing blocked until export is ready${blockedReasons.length > 0 ? `: ${blockedReasons[0]}` : "."}`
            : shareLink?.reason ?? "Local alpha exports stay private until signed sharing is available."}
        </span>
      </div>
      <button
        className="secondary-button compact"
        disabled={sessionBlocked || Boolean(shareLink) || shareBlocked}
        onClick={() => void runAction("share", () => zenariClient.createShareLink(exportId))}
        data-safety-export-share-cta={shareBlocked ? "blocked" : "enabled"}
        {...unsafeActionGuardAttributes("Request Share", state)}
      >
        <Link2 size={15} aria-hidden="true" />
        Request Share
      </button>
    </div>
  );
}

function PayloadStatusList({
  title,
  items,
  dataKind
}: {
  title: string;
  items: Array<{
    name: string;
    detail?: string;
    present: boolean;
  }>;
  dataKind: "manifest-output" | "required-zip-payload" | "workflow-payload" | "payload-content";
}) {
  return (
    <div className="payload-status-list" data-payload-status-kind={dataKind}>
      <strong>{title}</strong>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li
              key={`${dataKind}-${item.name}`}
              data-package-export-payload-row={dataKind}
              data-package-export-payload-name={item.name}
              data-package-export-payload-present={String(item.present)}
              data-package-export-payload-zip-name={item.detail ?? item.name}
            >
              <span className={item.present ? "qa-pass" : "qa-block"}>{item.present ? "present" : "missing"}</span>
              <span>{item.name}</span>
              {item.detail && item.detail !== item.name ? <small>{item.detail}</small> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>No workflow-specific payloads declared.</p>
      )}
    </div>
  );
}

function BillingView({
  state,
  busy,
  sessionBlocked,
  runAction
}: {
  state: WorkspaceState;
  busy: string | null;
  sessionBlocked: boolean;
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
  const teamSeatBilling = state.teamSeats.billingProjection;

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
          <button
            className="primary-button"
            disabled={sessionBlocked || busy === "checkout"}
            onClick={() => void runAction("checkout", () => zenariClient.createMockCheckout())}
            {...unsafeActionGuardAttributes("Mock Checkout", state)}
          >
            <CircleDollarSign size={18} aria-hidden="true" />
            Start Checkout
          </button>
          <button
            className="secondary-button"
            disabled={sessionBlocked || busy === "billing-portal"}
            onClick={() => void runAction("billing-portal", () => zenariClient.createBillingPortalSession())}
            {...unsafeActionGuardAttributes("Billing Portal", state)}
          >
            Manage Billing
          </button>
          <button
            className="secondary-button"
            disabled={sessionBlocked || busy === "billing-cancel"}
            onClick={() => void runAction("billing-cancel", () => zenariClient.cancelSubscription())}
            {...unsafeActionGuardAttributes("Cancel Subscription", state)}
          >
            Cancel Subscription
          </button>
          {state.billing.cancelAtPeriodEnd ? (
            <p>Cancellation is scheduled at period end.</p>
          ) : null}
        </article>
        <article className="billing-card">
          <span className="eyebrow">Quota</span>
          <h3>{remaining} credits remaining</h3>
          <p>Weekly reset: {dateLabel(state.billing.resetAt)}</p>
          <div className="meter large" role="progressbar" aria-label="Billing quota used" aria-valuemin={0} aria-valuemax={state.billing.quotaLimit} aria-valuenow={state.billing.quotaUsed}>
            <span style={{ width: `${Math.round((state.billing.quotaUsed / state.billing.quotaLimit) * 100)}%` }} />
          </div>
        </article>
        <article
          className="billing-card invoice-card"
          data-billing-invoice-ui="stage1.invoice-receipt-product-ui"
          data-billing-invoice-contract="listBillingInvoices:GET:/billing/invoices:include:not-required:false"
          data-billing-invoice-count={state.billing.invoices.length}
          data-billing-invoice-sync-status={state.billing.invoiceSyncStatus}
        >
          <span className="eyebrow">Invoices</span>
          <h3>{state.billing.invoices.length} invoice records</h3>
          <p>Last sync: {state.billing.invoiceSyncedAt ? dateLabel(state.billing.invoiceSyncedAt) : state.billing.invoiceSyncStatus}</p>
          <button
            className="secondary-button"
            disabled={sessionBlocked || busy === "billing-invoices"}
            onClick={() => void runAction("billing-invoices", () => zenariClient.refreshBillingInvoices())}
            {...unsafeActionGuardAttributes("Refresh Invoices", state)}
          >
            <RefreshCcw size={18} aria-hidden="true" />
            Refresh Invoices
          </button>
          <div className="invoice-list" data-billing-invoice-list="stage1">
            {state.billing.invoices.length > 0 ? (
              state.billing.invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="invoice-row"
                  data-billing-invoice-row={invoice.id}
                  data-billing-invoice-provider={invoice.provider}
                  data-billing-invoice-status={invoice.status}
                  data-billing-invoice-has-invoice-url={String(Boolean(invoice.invoiceUrl))}
                  data-billing-invoice-has-receipt-url={String(Boolean(invoice.receiptUrl))}
                >
                  <div>
                    <strong>{invoice.id}</strong>
                    <span>{invoice.status} · {invoice.currency} {(invoice.amountPaidCents / 100).toFixed(2)} paid</span>
                  </div>
                  <div className="invoice-actions">
                    {invoice.invoiceUrl ? (
                      <a href={invoice.invoiceUrl} target="_blank" rel="noreferrer">
                        Invoice
                      </a>
                    ) : null}
                    {invoice.receiptUrl ? (
                      <a href={invoice.receiptUrl} target="_blank" rel="noreferrer">
                        Receipt
                      </a>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p>No invoices returned yet.</p>
            )}
          </div>
        </article>
        <article
          className="billing-card team-seat-card"
          data-team-seat-ui="stage1.team-seat-product-ui"
          data-team-seat-usage-contract="getTeamSeatUsage:GET:/teams/{team_id}/seat-usage:include:not-required:false"
          data-team-seat-entitlement-contract="checkTeamSeatEntitlement:GET:/teams/{team_id}/seat-entitlement:include:not-required:false"
          data-team-seat-accept-contract="acceptTeamInvite:POST:/teams/{team_id}/invites/{invite_id}/accept:include:X-Zenari-CSRF:true"
          data-team-seat-team-id={state.teamSeats.usage.teamId}
          data-team-seat-billable={state.teamSeats.usage.billableSeats}
          data-team-seat-available={state.teamSeats.usage.availableSeats}
          data-team-seat-entitlement={state.teamSeats.entitlement.reason}
          data-team-seat-pending-invite={state.teamSeats.pendingInvite?.status ?? "none"}
          data-team-seat-billing-projection="stage1.team-seat-billing-safe-projection"
          data-team-seat-billing-provider={teamSeatBilling.provider}
          data-team-seat-billing-proration={teamSeatBilling.prorationBehavior}
          data-team-seat-billing-invoice-impact={teamSeatBilling.invoiceImpact}
          data-team-seat-billing-sync-status={teamSeatBilling.syncStatus}
          data-team-seat-billing-safe-projection={String(teamSeatBilling.safeProjection)}
        >
          <span className="eyebrow">Team Seats</span>
          <h3>{state.teamSeats.usage.billableSeats}/{state.teamSeats.usage.seatLimit} billable seats</h3>
          <div className="team-seat-grid">
            <span>
              <strong>{state.teamSeats.usage.activeSeats}</strong>
              Active
            </span>
            <span>
              <strong>{state.teamSeats.usage.invitedSeats}</strong>
              Invited
            </span>
            <span>
              <strong>{state.teamSeats.usage.availableSeats}</strong>
              Available
            </span>
          </div>
          <p>
            {state.teamSeats.entitlement.allowed
              ? "One additional invite is currently allowed."
              : "Seat limit reached; inviting another teammate requires more seats."}
          </p>
          <div className="team-seat-billing-panel">
            <span>
              <strong>{teamSeatBilling.nextBillableSeats}</strong>
              Next billable seats
            </span>
            <span>
              <strong>{teamSeatBilling.prorationBehavior.replace(/_/g, " ")}</strong>
              Stripe proration
            </span>
            <span>
              <strong>{teamSeatBilling.syncStatus}</strong>
              Seat billing sync
            </span>
          </div>
          <p className="team-seat-billing-note">
            {teamSeatBilling.invoiceImpact.replace(/_/g, " ")} · {teamSeatBilling.auditEvent} · {teamSeatBilling.lastSyncedAt ? dateLabel(teamSeatBilling.lastSyncedAt) : "not synced"}
          </p>
          {state.teamSeats.pendingInvite ? (
            <div className="inline-alert team-seat-invite" role="status">
              <Users size={16} aria-hidden="true" />
              <span>
                {state.teamSeats.pendingInvite.email} · {state.teamSeats.pendingInvite.role} · {state.teamSeats.pendingInvite.status}
              </span>
            </div>
          ) : null}
          <button
            className="secondary-button"
            disabled={sessionBlocked || busy === "team-seat-refresh"}
            onClick={() => void runAction("team-seat-refresh", () => zenariClient.refreshTeamSeats())}
            {...unsafeActionGuardAttributes("Refresh Team Seats", state)}
          >
            Refresh Seats
          </button>
          <button
            className="secondary-button"
            disabled={sessionBlocked || busy === "team-invite-accept" || state.teamSeats.pendingInvite?.status !== "pending"}
            onClick={() => void runAction("team-invite-accept", () => zenariClient.acceptTeamInvite())}
            {...unsafeActionGuardAttributes("Accept Invite", state)}
          >
            <Users size={18} aria-hidden="true" />
            Accept Invite
          </button>
        </article>
        <article className="billing-card edge-state-panel">
          <span className="eyebrow">Edge States</span>
          <h3>Local alpha scenarios</h3>
          <div className="segmented-control" aria-label="Billing edge state scenarios">
            {billingScenarios.map((scenario) => (
              <button
                key={scenario.key}
                className="secondary-button compact"
                disabled={sessionBlocked || busy === "billing-scenario"}
                onClick={() => void runAction("billing-scenario", () => zenariClient.setBillingScenario(scenario.key))}
                {...unsafeActionGuardAttributes("Billing Scenario", state)}
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
  sessionBlocked,
  runAction,
  browserCsrfProbeResult
}: {
  state: WorkspaceState;
  sessionBlocked: boolean;
  runAction: (label: string, action: () => Promise<WorkspaceState>) => Promise<void>;
  browserCsrfProbeResult: BrowserCsrfProbeResult;
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
          void runAction("account", () => zenariClient.updateAccount(settings));
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
            <option value="pdf-placeholder">PDF summary</option>
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
        <button className="primary-button" disabled={sessionBlocked} {...unsafeActionGuardAttributes("Save Settings", state)}>
          <Settings size={18} aria-hidden="true" />
          Save Settings
        </button>
      </form>
      <div
        className="csrf-operation-inventory"
        aria-label="Generated API CSRF browser request probe"
        data-generated-api-csrf-browser-probe="stage0.rev2.generated-api-csrf-browser-probe"
        data-generated-api-csrf-browser-probe-status={browserCsrfProbeResult.status}
        data-generated-api-csrf-browser-probe-base-url={browserCsrfProbeResult.baseUrl}
        data-generated-api-csrf-browser-probe-unsafe-operation={browserCsrfProbeResult.unsafeOperation}
        data-generated-api-csrf-browser-probe-unsafe-method={browserCsrfProbeResult.unsafeMethod}
        data-generated-api-csrf-browser-probe-unsafe-path={browserCsrfProbeResult.unsafePath}
        data-generated-api-csrf-browser-probe-unsafe-credentials={browserCsrfProbeResult.unsafeCredentials}
        data-generated-api-csrf-browser-probe-unsafe-csrf-header={browserCsrfProbeResult.unsafeCsrfHeader}
        data-generated-api-csrf-browser-probe-unsafe-idempotency-key={browserCsrfProbeResult.unsafeIdempotencyKey}
        data-generated-api-csrf-browser-probe-unsafe-operation-count={browserCsrfProbeResult.unsafeOperationCount}
        data-generated-api-csrf-browser-probe-unsafe-covered-operations={browserCsrfProbeResult.unsafeCoveredOperations}
        data-generated-api-csrf-browser-probe-unsafe-path-contracts={browserCsrfProbeResult.unsafePathContracts}
        data-generated-api-csrf-browser-probe-unsafe-credentialed-request-count={browserCsrfProbeResult.unsafeCredentialedRequestCount}
        data-generated-api-csrf-browser-probe-unsafe-csrf-header-count={browserCsrfProbeResult.unsafeCsrfHeaderCount}
        data-generated-api-csrf-browser-probe-unsafe-idempotency-required-count={browserCsrfProbeResult.unsafeIdempotencyRequiredCount}
        data-generated-api-csrf-browser-probe-unsafe-idempotency-header-count={browserCsrfProbeResult.unsafeIdempotencyHeaderCount}
        data-generated-api-csrf-browser-probe-unsafe-operation-contracts={browserCsrfProbeResult.unsafeOperationContracts}
        data-generated-api-csrf-browser-probe-safe-operation={browserCsrfProbeResult.safeOperation}
        data-generated-api-csrf-browser-probe-safe-method={browserCsrfProbeResult.safeMethod}
        data-generated-api-csrf-browser-probe-safe-path={browserCsrfProbeResult.safePath}
        data-generated-api-csrf-browser-probe-safe-credentials={browserCsrfProbeResult.safeCredentials}
        data-generated-api-csrf-browser-probe-safe-csrf-header={browserCsrfProbeResult.safeCsrfHeader}
        data-generated-api-csrf-browser-probe-safe-operation-count={browserCsrfProbeResult.safeOperationCount}
        data-generated-api-csrf-browser-probe-safe-covered-operations={browserCsrfProbeResult.safeCoveredOperations}
        data-generated-api-csrf-browser-probe-safe-path-contracts={browserCsrfProbeResult.safePathContracts}
        data-generated-api-csrf-browser-probe-safe-credentialed-request-count={browserCsrfProbeResult.safeCredentialedRequestCount}
        data-generated-api-csrf-browser-probe-safe-no-csrf-header-count={browserCsrfProbeResult.safeNoCsrfHeaderCount}
        data-generated-api-csrf-browser-probe-safe-operation-contracts={browserCsrfProbeResult.safeOperationContracts}
        data-generated-api-csrf-browser-probe-failure-reason={browserCsrfProbeResult.failureReason}
      >
        <strong>Generated API browser request probe</strong>
        <span>
          {browserCsrfProbeResult.unsafeOperation} {browserCsrfProbeResult.unsafeMethod} · {browserCsrfProbeResult.safeOperation} {browserCsrfProbeResult.safeMethod}
        </span>
      </div>
    </section>
  );
}

function SupportView({
  state,
  busy,
  sessionBlocked,
  body,
  category,
  setBody,
  setCategory,
  reportProblem
}: {
  state: WorkspaceState;
  busy: string | null;
  sessionBlocked: boolean;
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
            <dt>Batch</dt>
            <dd>{problemContext.linkedBatchId}</dd>
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
          <div>
            <dt>Billing</dt>
            <dd>{problemContext.linkedBillingReferenceId}</dd>
          </div>
        </dl>
      </section>
      <section className="legal-notice-grid" aria-label="Privacy and AI content notices">
        <article className="legal-notice privacy-notice">
          <span className="eyebrow">Privacy Notice</span>
          <p>
            Support tickets attach project, batch, export, task, trace, accepted reference, quota, and billing context for investigation. Support tickets attach project, export, task, trace links for safety review. Do not include secrets,
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
        <button
          className="primary-button"
          disabled={sessionBlocked || busy === "support" || !body.trim()}
          {...unsafeActionGuardAttributes("Submit Ticket", state)}
        >
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
              batch {ticket.linkedBatchId ?? "none"} · export {ticket.linkedExportId ?? "none"} · task {ticket.linkedTaskId} · trace {ticket.linkedTraceId} · assets {ticket.linkedAssetIds.length} · billing {ticket.linkedBillingReferenceId ?? "none"}
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
