import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getStage1ReleaseReadiness } from "@/lib/admin-api";
import type {
  Stage1AggregateEvidence,
  Stage1AggregateGateCheck,
  Stage1AggregateResultRow,
  Stage1AzureCliPreflight,
  Stage1AzureOriginHttpProbe,
  Stage1AzureOriginReadiness,
  Stage1AzureOriginTcpProbe,
  Stage1AzureTransportDiagnosis,
  Stage1EvidenceClosureQueueOperatorActionPacketItem,
  Stage1EvidenceClosureQueueOperatorActionPacketSummary,
  Stage1EvidenceClosureQueueParallelBlocker,
  Stage1EvidenceClosureQueueRow,
  Stage1ExternalResourceNonClearingRefreshSummary,
  Stage1ExternalResourceGroup,
  Stage1NonClearingRefreshBlockedEvidenceDetail,
  Stage1ReleaseBundlePreflight,
  Stage1CIEvidence,
  Stage1MissingEvidenceRef,
  Stage1ProductionActionMatrix,
  Stage1ProductionActionMatrixHelpItem,
  Stage1ProductionActionMatrixLane,
  Stage1ProductionBlockerAudit,
  Stage1ProductionBlockerChecklist,
  Stage1ProductionBlockerAuditSourceRow,
  Stage1ProductionDnsDetail,
  Stage1ProductionDnsProbeRow,
  Stage1ProductionInputTemplate,
  Stage1ProductionInputTemplateGroup,
  Stage1ProductionLaunchInputPacket,
  Stage1ProductionLaunchInputPacketCommandGroup,
  Stage1ProductionLaunchInputPacketEnvGroup,
  Stage1ProductionLaunchInputPacketSourceInput,
  Stage1ProductionLaunchOperatorBrief,
  Stage1ProductionLaunchOperatorBriefMatrixRow,
  Stage1ProductionMissingInputChecklist,
  Stage1ProductionMissingInputChecklistGroup,
  Stage1ProductionMissingInputChecklistItem,
  Stage1ProductionLaunchSourcePipeline,
  Stage1ProductionLaunchSourcePipelineProofReadiness,
  Stage1ProductionLaunchSourcePipelineStep,
  Stage1ProductionSourceProbeRunbook,
  Stage1ProductionSourceProbeRunbookStep,
  Stage1ProductionNonClearingRefresh,
  Stage1ProductionNonClearingRefreshActionLane,
  Stage1ProductionNonClearingRefreshStep,
  Stage1NextBlockersSummary,
  Stage1ProductionOperatorPacket,
  Stage1ProductionOperatorPacketRequirementGroup,
  Stage1ProductionProofBundle,
  Stage1ProductionProofBundleInputGroup,
  Stage1ProductionProofBundleProof,
  Stage1ProductionProofBundleRequirement,
  Stage1ProductionProofBundleStep,
  Stage1ProductionProofDiagnostic,
  Stage1ProductionProofDiagnosticFlag,
  Stage1ProductionProofDiagnostics,
  Stage1ProductionProofInputCoverageGroup,
  Stage1ProductionSourceProbeRequirement,
  Stage1ReleaseGateFixture,
  Stage1ReleaseReadinessComponent,
  Stage1ReleaseReadinessContractAnchor,
  Stage1ReleaseReadinessSummary
} from "@/lib/types";

type ProviderSandboxHandoffRow = {
  check: string;
  status: string;
  detail: string;
  evidence: string;
  nextAction: string;
};

type ProductionProofStatusRow = {
  proof: string;
  status: string;
};

type ProductionLaunchBlockerMatrixRow = {
  blocker: string;
  status: string;
  gate: string;
  configured: number;
  total: number;
  missing: number;
  invalid: number;
  firstBlocker: string;
  evidence: string;
  nextAction: string;
};

type ProductionCopySafeCommandRow = {
  lane: string;
  command: string;
  source: string;
  sideEffect: string;
};

type AzureTransportDiagnosisRow = {
  field: keyof Pick<
    Stage1AzureTransportDiagnosis,
    | "nextAction"
    | "sshTransportPhase"
    | "tcpEntryPortsReachable"
    | "sshBannerReceived"
    | "sshAuthReached"
    | "sshPasswordKeyRepairViable"
    | "httpRequestSent"
    | "httpResponseStarted"
    | "httpZeroBytesAfterRequest"
    | "tlsServerhelloTimeout"
    | "azurePortalRunCommandRequired"
  >;
  value: string;
};

type AzureRunCommandHandoffRow = {
  order: number;
  phase: string;
  location: string;
  action: string;
  command: string;
  reason: string;
  sideEffect: string;
};

const AZURE_ORIGIN_PRIORITY_FAILURE_CATEGORIES = [
  "http_no_bytes_after_request",
  "tls_serverhello_timeout",
  "https_no_bytes_after_tls"
];
const AZURE_ORIGIN_SSH_FAILURE_REASONS = [
  "ssh_key_auth_permission_denied",
  "ssh_connect_timeout",
  "ssh_server_not_responding",
  "ssh_auth_hard_timeout"
];
const AZURE_CLI_PREFLIGHT_REASONS = [
  "env_vm_found",
  "env_vm_not_found",
  "az_cli_missing",
  "az_not_logged_in",
  "vm_ip_discovery_failed",
  "vm_found_by_public_ip",
  "vm_not_found_by_public_ip",
  "az_cli_preflight_timeout",
  "az_cli_preflight_unparseable"
];
const AZURE_ORIGIN_LOCAL_REPAIR_PASSWORD_ENV_KEY = "STAGING_SSH_PASSWORD";
const AZURE_RUN_COMMAND_OPERATOR_CARD = "ops/evidence/staging/azure-run-command-operator-card.md";
const AZURE_RUN_COMMAND_PAYLOAD = "ops/evidence/staging/azure-run-command-ssh-repair.sh";
const AZURE_RUN_COMMAND_INGEST = "python3 scripts/ingest_azure_run_command_output.py";
const STAGE1_PRODUCTION_RETURN_ARTIFACT_INGEST = "python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2";
const PRODUCTION_MISSING_INPUT_DISALLOWED_SUBSTITUTES = [
  "local_debug_evidence",
  "staging_preflight_evidence",
  "stripe_sandbox_test_mode",
  "stripe_test_keys"
];
const AZURE_ORIGIN_REPAIR_COMMAND_FALLBACKS = [
  "scripts/azure_staging_run_command_payload.sh",
  "python3 scripts/ingest_azure_run_command_output.py",
  "python3 scripts/sanitize_azure_run_command_output.py --output ops/evidence/staging/azure-run-command-ssh-repair.output.txt --require-marker",
  "python3 scripts/classify_azure_run_command_output.py --input ops/evidence/staging/azure-run-command-ssh-repair.output.txt --output ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json || test $? -eq 2",
  "scripts/azure_staging_cli_preflight.sh",
  "RUN_AZURE_STAGING_RUN_COMMAND=1 scripts/azure_staging_run_command_invoke.sh",
  "scripts/azure_staging_password_key_repair.sh",
  "scripts/azure_staging_ssh_preflight.sh",
  "scripts/azure_staging_bootstrap.sh",
  "scripts/azure_staging_deploy.sh",
  "scripts/azure_staging_origin_diagnostics.sh",
  "scripts/azure_staging_origin_repair.sh"
];

function statusTone(value: string) {
  if (value === "go" || value === "pass" || value === "passed" || value === "true") {
    return "pass";
  }
  if (value === "blocked" || value === "missing" || value === "no_go" || value === "false") {
    return "blocked";
  }
  return value;
}

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}

function operatorActionPacketOwnerSummary(summary: Stage1EvidenceClosureQueueOperatorActionPacketSummary) {
  return Object.entries(summary.ownerCounts).map(([key, value]) => `${key}:${value}`).join(", ");
}

function operatorActionPacketGateImpactSummary(summary: Stage1EvidenceClosureQueueOperatorActionPacketSummary) {
  return Object.entries(summary.gateImpactCounts).map(([key, value]) => `${key}:${value}`).join(", ");
}

function evidenceSummary(evidence: Stage1AggregateEvidence) {
  const passed = evidence.components.filter((component) => component.status === "pass" || component.status === "passed").length;
  return `${passed}/${evidence.components.length}`;
}

function blockerPreview(blockers: string[]) {
  if (blockers.length === 0) {
    return "none";
  }
  return blockers.slice(0, 2).join(" | ");
}

function resourceReadinessLabel(row: Stage1ExternalResourceGroup) {
  if (row.status === "ready") {
    return "ready";
  }
  if (row.status === "provided_unverified") {
    return "provided, not strict-pass";
  }
  return row.status;
}

function nonClearingRefreshStatusLabel(summary: Stage1ExternalResourceNonClearingRefreshSummary) {
  return `${summary.stepSummary.passed}/${summary.stepSummary.total} refresh steps passed`;
}

function providerFailureCategory(blockers: string[]) {
  return (
    blockers.find((blocker) =>
      [
        "provider_quota_unavailable",
        "provider_retryable_http_error",
        "provider_http_error",
        "adapter_health_probe",
        "admin_sandbox_test_call",
        "provider_sandbox"
      ].some((pattern) => blocker.includes(pattern))
    ) ?? "not reported by current aggregate"
  );
}

function releaseBundleRows(preflight: Stage1ReleaseBundlePreflight) {
  return [
    { check: "bundle_status", passed: preflight.status === "passed" && preflight.decision === "go", detail: `${preflight.status} / ${preflight.decision}` },
    { check: "stage1_staging_runtime", passed: preflight.stage1StagingRuntimeVerified, detail: preflight.stage1StagingRuntimeBlockingReasons.join(", ") || "verified" },
    { check: "stage1_quota_replay", passed: preflight.stage1QuotaReplayVerified, detail: preflight.stage1QuotaReplayBlockingReasons.join(", ") || "verified" },
    { check: "stage1_load", passed: preflight.stage1LoadVerified, detail: preflight.stage1LoadBlockingReasons.join(", ") || "verified" },
    { check: "object_retention_cleanup", passed: preflight.objectRetentionCleanupVerified, detail: yesNo(preflight.objectRetentionCleanupVerified) },
    { check: "legal_support_visibility", passed: preflight.legalSupportVisibilityVerified, detail: yesNo(preflight.legalSupportVisibilityVerified) },
    { check: "ci_closure_artifacts", passed: preflight.ciClosureArtifactsReady, detail: yesNo(preflight.ciClosureArtifactsReady) },
    { check: "production_backup_rollback_split", passed: preflight.productionBackupRollbackSplitReady, detail: yesNo(preflight.productionBackupRollbackSplitReady) },
    { check: "release_metadata_preflight", passed: preflight.releaseMetadataPreflightComplete, detail: preflight.releaseMetadataPreflightStatus },
    { check: "release_metadata_missing_slots", passed: preflight.releaseMetadataMissingSlots.length === 0, detail: preflight.releaseMetadataMissingSlots.join(", ") || "none" },
    { check: "release_metadata_unverified_slots", passed: preflight.releaseMetadataUnverifiedSlots.length === 0, detail: preflight.releaseMetadataUnverifiedSlots.join(", ") || "none" },
    {
      check: "release_metadata_blockers",
      passed: preflight.releaseMetadataBlockingReasons.length === 0,
      detail: preflight.releaseMetadataBlockingReasons.join(", ") || "none"
    },
    { check: "missing_slots", passed: preflight.missingSlots.length === 0, detail: preflight.missingSlots.join(", ") || "none" },
    { check: "unverified_slots", passed: preflight.unverifiedSlots.length === 0, detail: preflight.unverifiedSlots.join(", ") || "none" },
    {
      check: "ci_closure_artifact_blockers",
      passed: preflight.ciClosureArtifactBlockingReasons.length === 0,
      detail: preflight.ciClosureArtifactBlockingReasons.join(", ") || "none"
    },
    {
      check: "production_backup_rollback_split_blockers",
      passed: preflight.productionBackupRollbackSplitBlockingReasons.length === 0,
      detail: preflight.productionBackupRollbackSplitBlockingReasons.join(", ") || "none"
    },
    {
      check: "blocking_reason_count",
      passed: (preflight.blockingReasonCount ?? preflight.blockingReasons.length) === 0,
      detail: String(preflight.blockingReasonCount ?? preflight.blockingReasons.length)
    }
  ];
}

function providerSandboxHandoffRows(staging: Stage1AggregateEvidence): ProviderSandboxHandoffRow[] {
  const component = staging.components.find((item) => item.componentId === "provider_sandbox");
  const resultRow = staging.resultRows.find((item) => item.componentId === "provider_sandbox");
  const blockers = [
    ...staging.blockers,
    ...(component?.blockers ?? []),
    ...(resultRow?.blockers ?? []),
    ...(staging.releaseBundlePreflight?.blockingReasons ?? [])
  ];
  const componentStatus = component?.status ?? "missing";
  const resultStatus = resultRow?.status ?? (staging.resultsPresent ? "missing" : "missing_results");
  const exactEvidence = component?.exactEvidence === true && resultRow?.exactEvidence === true;
  const safeProjection =
    component?.secretLeakDetected !== true &&
    component?.rawPayloadPersisted !== true &&
    resultRow?.secretLeakDetected !== true &&
    resultRow?.rawPayloadPersisted !== true &&
    staging.safetyPolicy.rawProviderPayloadPersisted !== true;

  return [
    {
      check: "provider_sandbox_component",
      status: componentStatus === "pass" || componentStatus === "passed" ? "pass" : "blocked",
      detail: component ? blockerPreview(component.blockers) : "provider_sandbox component missing from aggregate",
      evidence: component?.evidenceRefs.join(", ") || "ops/evidence/staging/stage1-provider-sandbox.json + .ndjson",
      nextAction: "Run scripts/stage1_provider_sandbox_smoke.sh against staging/test provider endpoints, then rerun strict validator."
    },
    {
      check: "provider_sandbox_result_row",
      status: resultStatus === "pass" || resultStatus === "passed" ? "pass" : "blocked",
      detail: resultRow ? blockerPreview(resultRow.blockers) : "provider_sandbox row missing from stage1-runtime.ndjson",
      evidence: staging.resultsPath,
      nextAction: "Regenerate ops/evidence/staging/stage1-runtime.ndjson only from validator-accepted child evidence."
    },
    {
      check: "provider_failure_category",
      status: blockers.length === 0 ? "pass" : "blocked",
      detail: providerFailureCategory(blockers),
      evidence: "provider_quota_unavailable | provider_retryable_http_error | provider_http_error",
      nextAction:
        "Keep z.ai/OpenAI-compatible failure categories redacted and machine-readable; do not persist raw provider response bodies."
    },
    {
      check: "openai_compatible_selftest",
      status: exactEvidence ? "pass" : "blocked",
      detail: component?.validatorCommands.join(", ") || "python3 scripts/validate_stage1_provider_sandbox_evidence.py --contract-only",
      evidence: "scripts/openai_compatible_provider_selftest.sh --contract-only",
      nextAction:
        "Use live calls only when env is configured; keep API keys in environment variables and never write them into evidence."
    },
    {
      check: "provider_safe_projection",
      status: safeProjection ? "pass" : "blocked",
      detail: safeProjection ? "no secret or raw provider payload projection flags are set" : "unsafe provider projection flag detected",
      evidence: "secretLeakDetected=false, rawPayloadPersisted=false, rawProviderPayloadPersisted=false",
      nextAction: "Fix redaction before using provider sandbox output in release evidence."
    }
  ];
}

function productionProofStatusRows(audit: Stage1ProductionBlockerAudit): ProductionProofStatusRow[] {
  return Object.entries(audit.proofStatuses).map(([proof, status]) => ({ proof, status }));
}

function productionLaunchBlockerMatrixRows({
  audit,
  dnsDetail,
  bundle,
  diagnostics
}: {
  audit: Stage1ProductionBlockerAudit;
  dnsDetail: Stage1ProductionDnsDetail;
  bundle: Stage1ProductionProofBundle;
  diagnostics: Stage1ProductionProofDiagnostics;
}): ProductionLaunchBlockerMatrixRow[] {
  const inputGroups = Object.fromEntries(bundle.inputGroups.map((group) => [group.groupId, group]));
  const diagnosticByProof = Object.fromEntries(diagnostics.diagnostics.map((diagnostic) => [diagnostic.proofId, diagnostic]));
  const dnsGroup = inputGroups.production_dns;
  const billingGroup = inputGroups.billing;
  const securityGroup = inputGroups.security;
  const governanceGroup = inputGroups.governance;

  return [
    {
      blocker: "production_dns_https",
      status: dnsDetail.status,
      gate: "production_legal_support_policy",
      configured: dnsGroup?.requiredConfigured ?? 0,
      total: dnsGroup?.requiredTotal ?? 0,
      missing: dnsGroup?.requiredMissing ?? 0,
      invalid: dnsGroup?.requiredInvalid ?? 0,
      firstBlocker: dnsDetail.blockedChecks[0] ?? audit.productionDnsReadiness.firstBlocker,
      evidence: `${dnsDetail.readinessPath} + ${dnsDetail.cutoverPlanPath}`,
      nextAction: dnsDetail.operatorNextActions[0] ?? "provide production DNS target and Cloudflare DNS edit inputs"
    },
    {
      blocker: "production_paid_billing_lifecycle",
      status: diagnosticByProof.billing?.status ?? "missing",
      gate: "production_paid_billing_lifecycle",
      configured: billingGroup?.requiredConfigured ?? 0,
      total: billingGroup?.requiredTotal ?? 0,
      missing: billingGroup?.requiredMissing ?? 0,
      invalid: billingGroup?.requiredInvalid ?? 0,
      firstBlocker: diagnosticByProof.billing?.blockedChecks[0] ?? "production live billing proof missing",
      evidence: diagnosticByProof.billing?.sourcePath ?? "ops/evidence/non_clearing/production-live-billing-proof.blocked.json",
      nextAction: "run live Stripe proof only after STRIPE_MODE=live and production artifacts are available"
    },
    {
      blocker: "production_security_launch_checks",
      status: diagnosticByProof.security?.status ?? "missing",
      gate: "production_security_launch_checks",
      configured: securityGroup?.requiredConfigured ?? 0,
      total: securityGroup?.requiredTotal ?? 0,
      missing: securityGroup?.requiredMissing ?? 0,
      invalid: securityGroup?.requiredInvalid ?? 0,
      firstBlocker: diagnosticByProof.security?.blockedChecks[0] ?? "production security proof missing",
      evidence: diagnosticByProof.security?.sourcePath ?? "ops/evidence/non_clearing/production-security-proof.blocked.json",
      nextAction: "attach production security runtime refs, then run the security source probe"
    },
    {
      blocker: "production_governance_release",
      status: diagnosticByProof.governance?.status ?? "missing",
      gate: "production_governance_release",
      configured: governanceGroup?.requiredConfigured ?? 0,
      total: governanceGroup?.requiredTotal ?? 0,
      missing: governanceGroup?.requiredMissing ?? 0,
      invalid: governanceGroup?.requiredInvalid ?? 0,
      firstBlocker: diagnosticByProof.governance?.blockedChecks[0] ?? "production governance proof missing",
      evidence: diagnosticByProof.governance?.sourcePath ?? "ops/evidence/non_clearing/production-governance-proof.blocked.json",
      nextAction: "attach activation, abuse, and skill release production governance refs"
    }
  ];
}

function productionCopySafeCommandRows({
  refresh,
  dnsDetail,
  inputTemplate,
  proofBundle,
  packet
}: {
  refresh: Stage1ProductionNonClearingRefresh;
  dnsDetail: Stage1ProductionDnsDetail;
  inputTemplate: Stage1ProductionInputTemplate;
  proofBundle: Stage1ProductionProofBundle;
  packet: Stage1ProductionLaunchInputPacket;
}): ProductionCopySafeCommandRow[] {
  const rows: ProductionCopySafeCommandRow[] = [
    {
      lane: "refresh",
      command: refresh.generatorCommand,
      source: refresh.sourcePath,
      sideEffect: refresh.nonClearingRefresh ? "non-clearing; no DNS apply; no canonical source write" : "check refresh policy"
    },
    {
      lane: "refresh_validate",
      command: refresh.validatorCommand,
      source: refresh.sourcePath,
      sideEffect: "read-only validation"
    },
    {
      lane: "dns_plan",
      command:
        "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
      source: dnsDetail.cutoverPlanPath,
      sideEffect: "non-clearing plan only"
    },
    {
      lane: "dns_readiness",
      command: "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json || test $? -eq 2",
      source: dnsDetail.readinessPath,
      sideEffect: "probe only; expected blocked exit allowed"
    },
    {
      lane: "dns_repair_packet",
      command: "python3 scripts/generate_stage1_production_dns_repair_packet.py --operator-markdown ops/evidence/non_clearing/production-dns-operator-checklist.md",
      source: dnsDetail.repairPacket.sourcePath,
      sideEffect: "writes non-clearing operator packet"
    },
    {
      lane: "private_env_template",
      command: inputTemplate.generatorCommand,
      source: inputTemplate.sourcePath,
      sideEffect: "blank values only"
    },
    {
      lane: "proof_bundle_private_env",
      command: "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
      source: proofBundle.sourcePath,
      sideEffect: "uses private gitignored env; blocked exit allowed"
    },
    {
      lane: "proof_bundle_validate",
      command: proofBundle.strictValidator,
      source: proofBundle.sourcePath,
      sideEffect: "read-only validation"
    },
    {
      lane: "launch_input_packet",
      command: "python3 scripts/generate_stage1_production_launch_input_packet.py",
      source: packet.sourcePath,
      sideEffect: "non-clearing packet regeneration"
    }
  ];

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.lane}:${row.command}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function azureRunCommandHandoffRows(readiness: Stage1AzureOriginReadiness): AzureRunCommandHandoffRow[] {
  const operatorCardCommand =
    readiness.originRepairCommands.find((command) => command.includes(AZURE_RUN_COMMAND_OPERATOR_CARD)) ?? `open ${AZURE_RUN_COMMAND_OPERATOR_CARD}`;
  const ingestCommand =
    readiness.originRepairCommands.find((command) => command === AZURE_RUN_COMMAND_INGEST || command.includes("ingest_azure_run_command_output.py")) ??
    AZURE_RUN_COMMAND_INGEST;

  return [
    {
      order: 1,
      phase: "operator_card",
      location: "local repo",
      action: "Open the Azure Run Command operator card",
      command: operatorCardCommand,
      reason: readiness.transportDiagnosis.operatorSummary,
      sideEffect: "read-only; no gate clearing"
    },
    {
      order: 2,
      phase: "portal_payload",
      location: `Azure Portal VM Run Command on ${readiness.azureIp}`,
      action: "Paste the VM-internal RunShellScript payload",
      command: AZURE_RUN_COMMAND_PAYLOAD,
      reason: "repairs sshd/public-key access and emits VM-internal origin diagnostics",
      sideEffect: "runs inside the Azure VM; does not write repo evidence"
    },
    {
      order: 3,
      phase: "local_ingest",
      location: "local repo stdin",
      action: "Paste the Azure Portal output into the ingest command",
      command: ingestCommand,
      reason: "sanitizes output, classifies the VM state, and refreshes Azure readiness plus next-blockers evidence",
      sideEffect: "writes sanitized local evidence; preserves no_go unless strict probes pass"
    },
    {
      order: 4,
      phase: "post_ingest_guard",
      location: "local repo",
      action: "Validate refreshed Azure and blocker evidence",
      command: "python3 scripts/validate_stage1_next_blockers_summary.py",
      reason: `transport lane ${readiness.transportDiagnosis.lane}; password/key repair viable ${yesNo(readiness.transportDiagnosis.sshPasswordKeyRepairViable)}`,
      sideEffect: "read-only validation"
    }
  ];
}

function readinessLabel(evidence: Stage1AggregateEvidence) {
  if (evidence.status === "pass" && evidence.releaseGateDecision === "go") {
    return "go";
  }
  if (!evidence.evidencePresent) {
    return "missing evidence";
  }
  return `${evidence.status} / ${evidence.releaseGateDecision}`;
}

function AggregatePanel({ evidence }: { evidence: Stage1AggregateEvidence }) {
  const runtimeRows = Object.entries(evidence.runtimeInputReadiness).map(([input, ready]) => ({ input, ready }));
  const safetyRows = Object.entries(evidence.safetyPolicy).map(([field, persisted]) => ({ field, persisted }));

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>{evidence.environment === "staging" ? "Stage 1 Staging Runtime" : "Stage 1 Production Launch"}</h3>
          <p>{evidence.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(evidence.releaseGateDecision)} label={readinessLabel(evidence)} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Strict Gate</span>
          <strong>{evidence.gateSafety.verdict}</strong>
          <small>{evidence.gateSafety.strictGateBlockers[0] ?? "all strict release checks passed"}</small>
        </article>
        <article>
          <span>Evidence file</span>
          <strong>{evidence.evidencePresent ? "present" : "missing"}</strong>
          <small>{evidence.schemaVersion}</small>
        </article>
        <article>
          <span>Results file</span>
          <strong>{evidence.resultsPresent ? "present" : "missing"}</strong>
          <small>{evidence.resultsPath}</small>
        </article>
        <article>
          <span>Components passed</span>
          <strong>{evidenceSummary(evidence)}</strong>
          <small>{evidence.allComponentsPassed ? "all exact child evidence passed" : "blocked child evidence remains"}</small>
        </article>
        <article>
          <span>Do-Not-Launch</span>
          <strong>{evidence.doNotLaunchConditions.length}</strong>
          <small>{evidence.doNotLaunchConditions.join(", ") || "none"}</small>
        </article>
        <article>
          <span>Blockers</span>
          <strong>{evidence.blockers.length}</strong>
          <small>{blockerPreview(evidence.blockers)}</small>
        </article>
      </div>

      <DataTable<Stage1ReleaseReadinessComponent>
        rows={evidence.components}
        columns={[
          { key: "component", header: "Component", render: (row) => <span className="mono">{row.componentId}</span> },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
          { key: "exact", header: "Exact Evidence", render: (row) => yesNo(row.exactEvidence) },
          { key: "local", header: "Local Only", render: (row) => yesNo(row.localOnly) },
          { key: "dry-run", header: "Dry Run", render: (row) => yesNo(row.dryRun) },
          { key: "safe", header: "Safe Projection", render: (row) => (row.secretLeakDetected || row.rawPayloadPersisted ? "unsafe" : "safe") },
          {
            key: "check-level",
            header: "Check-Level Pass",
            render: (row) =>
              typeof row.checkLevelPassed === "boolean" ? (
                <StatusBadge value={statusTone(String(row.checkLevelPassed))} label={yesNo(row.checkLevelPassed)} />
              ) : (
                "n/a"
              )
          },
          {
            key: "preserved",
            header: "Preserved Gate Blockers",
            render: (row) => yesNo(row.checkLevelBlockersPreserved === true)
          },
          { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") || "missing" },
          { key: "results", header: "Results Ref", render: (row) => row.resultsRef ?? "none" },
          { key: "validators", header: "Validators", render: (row) => row.validatorCommands.join(", ") || "none" },
          { key: "blockers", header: "Blockers", render: (row) => blockerPreview(row.blockers) }
        ]}
      />

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Strict Gate Checks</h3>
              <p>Every row must pass before this aggregate can contribute to a launch decision.</p>
            </div>
          </div>
          <DataTable<Stage1AggregateGateCheck>
            rows={evidence.gateSafety.checks}
            columns={[
              { key: "check", header: "Check", render: (row) => <span className="mono">{row.checkId}</span> },
              { key: "passed", header: "Passed", render: (row) => <StatusBadge value={statusTone(String(row.passed))} label={yesNo(row.passed)} /> },
              { key: "detail", header: "Detail", render: (row) => row.detail }
            ]}
          />
        </div>

        {evidence.releaseBundlePreflight ? (
          <div className="release-subsection span-12">
            <div className="panel-header">
              <div>
                <h3>Release Bundle Preflight</h3>
                <p>{evidence.releaseBundlePreflight.path}</p>
              </div>
              <StatusBadge
                value={statusTone(evidence.releaseBundlePreflight.status === "passed" && evidence.releaseBundlePreflight.decision === "go" ? "go" : "blocked")}
                label={`${evidence.releaseBundlePreflight.status} / ${evidence.releaseBundlePreflight.decision}`}
              />
            </div>
            <DataTable<{ check: string; passed: boolean; detail: string }>
              rows={releaseBundleRows(evidence.releaseBundlePreflight)}
              columns={[
                { key: "check", header: "Check", render: (row) => <span className="mono">{row.check}</span> },
                { key: "passed", header: "Passed", render: (row) => <StatusBadge value={statusTone(String(row.passed))} label={yesNo(row.passed)} /> },
                { key: "detail", header: "Detail", render: (row) => row.detail }
              ]}
            />
            <p className="evidence-note">
              Blocking reasons: {blockerPreview(evidence.releaseBundlePreflight.blockers)}
            </p>
          </div>
        ) : null}

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Missing Evidence Refs</h3>
              <p>Paths are parsed from aggregate and component blockers; Admin cannot mark them complete.</p>
            </div>
          </div>
          <DataTable<Stage1MissingEvidenceRef>
            rows={evidence.missingEvidenceRefs}
            columns={[
              { key: "component", header: "Component", render: (row) => <span className="mono">{row.componentId}</span> },
              { key: "type", header: "Type", render: (row) => row.refType },
              { key: "path", header: "Path", render: (row) => <span className="mono">{row.path}</span> },
              { key: "source", header: "Source", render: (row) => row.source },
              { key: "blocker", header: "Blocker", render: (row) => row.blocker }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Aggregate Results Rows</h3>
              <p>NDJSON result rows must match components and remain exact, safe, and blocker-free.</p>
            </div>
          </div>
          <DataTable<Stage1AggregateResultRow>
            rows={evidence.resultRows}
            columns={[
              { key: "component", header: "Component", render: (row) => <span className="mono">{row.componentId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "exact", header: "Exact Evidence", render: (row) => yesNo(row.exactEvidence) },
              { key: "safe", header: "Safe Projection", render: (row) => (row.secretLeakDetected || row.rawPayloadPersisted ? "unsafe" : "safe") },
              { key: "preserved", header: "Preserved Blockers", render: (row) => yesNo(row.blockersPreserved === true) },
              { key: "check-level", header: "Check-Level Pass", render: (row) => yesNo(row.checkLevelPassed === true) },
              { key: "blockers", header: "Blockers", render: (row) => blockerPreview(row.blockers) }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Runtime Inputs</h3>
              <p>Inputs are projected from aggregate evidence and cannot be toggled from Admin.</p>
            </div>
          </div>
          <DataTable<{ input: string; ready: boolean }>
            rows={runtimeRows}
            columns={[
              { key: "input", header: "Input", render: (row) => <span className="mono">{row.input}</span> },
              { key: "ready", header: "Ready", render: (row) => <StatusBadge value={statusTone(String(row.ready))} label={yesNo(row.ready)} /> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Safe Projection Policy</h3>
              <p>Any persisted secret, raw prompt, raw provider payload, or signed URL keeps the gate blocked.</p>
            </div>
          </div>
          <DataTable<{ field: string; persisted: boolean }>
            rows={safetyRows}
            columns={[
              { key: "field", header: "Field", render: (row) => <span className="mono">{row.field}</span> },
              { key: "persisted", header: "Persisted", render: (row) => <StatusBadge value={statusTone(String(!row.persisted))} label={yesNo(row.persisted)} /> }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function Stage1NextBlockersSummaryPanel({ summary }: { summary: Stage1NextBlockersSummary }) {
  const refreshPercent = summary.nonClearingRefresh.total
    ? Math.round((summary.nonClearingRefresh.passed / summary.nonClearingRefresh.total) * 1000) / 10
    : 0;
  const originSummaryRows = Object.entries(summary.azureRunCommandDiagnosis.originSummary).map(([key, value]) => ({ key, value }));
  const safetyFlags = [
    summary.secretMaterialPersisted,
    summary.rawPromptPersisted,
    summary.rawProviderPayloadPersisted,
    summary.rawStripePayloadPersisted,
    summary.rawSupportBodyProjected,
    summary.signedUrlPersisted,
    summary.authorizationHeaderPersisted,
    summary.cookiePersisted,
    summary.rawRunCommandOutputPersisted
  ];

  return (
    <section
      className="panel"
      data-stage1-next-blockers-summary="validator-derived"
      data-stage1-next-blockers-summary-export="ops/evidence/non_clearing/stage1-next-blockers-summary.json"
      data-stage1-next-blockers-summary-non-clearing="true"
      data-stage1-next-blockers-summary-top-action={summary.topPriorityAction.actionId}
      data-stage1-next-blockers-summary-validator="python3 scripts/validate_stage1_next_blockers_summary.py"
      data-stage1-next-blockers-summary-generator="python3 scripts/generate_stage1_next_blockers_summary.py"
      data-stage1-next-blockers-production-return-ingest={STAGE1_PRODUCTION_RETURN_ARTIFACT_INGEST}
      data-stage1-next-blockers-transport-diagnosis="transport_diagnosis"
      data-stage1-next-blockers-operator-shortlist="operator_shortlist"
      data-stage1-next-blockers-operator-shortlist-count={summary.operatorShortlist.length}
    >
      <div className="panel-header">
        <div>
          <h3>Stage1 Next Blockers</h3>
          <p>{summary.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(summary.status)} label={`${summary.status} / ${summary.releaseGateDecision}`} />
      </div>
      <div className="dependency-summary">
        <article>
          <span>Stage1 gates</span>
          <strong>{`${summary.stage1.completed}/${summary.stage1.total}`}</strong>
          <small>{`${summary.stage1.completionPercent}% complete; ${summary.stage1.open} open`}</small>
        </article>
        <article>
          <span>Production inputs</span>
          <strong>{`${summary.productionInputs.configured}/${summary.productionInputs.total}`}</strong>
          <small>{`${summary.productionInputs.completionPercent}% configured; ${summary.productionInputs.blockingInputCount} blockers`}</small>
        </article>
        <article>
          <span>Missing / invalid</span>
          <strong>{`${summary.productionInputs.missing}/${summary.productionInputs.invalid}`}</strong>
          <small>required production inputs only</small>
        </article>
        <article>
          <span>Source probes</span>
          <strong>{`${summary.productionSourceProbes.ready}/${summary.productionSourceProbes.total}`}</strong>
          <small>{`${summary.productionSourceProbes.blocked} blocked; ${summary.productionSourceProbes.blockingInputCount} blocking inputs`}</small>
        </article>
        <article>
          <span>Non-clearing refresh</span>
          <strong>{`${summary.nonClearingRefresh.passed}/${summary.nonClearingRefresh.total}`}</strong>
          <small>{`${refreshPercent}% passed; ${summary.nonClearingRefresh.blocked} blocked / ${summary.nonClearingRefresh.failed} failed`}</small>
        </article>
        <article>
          <span>Azure HTTP probes</span>
          <strong>{`${summary.azureOrigin.httpPassed}/${summary.azureOrigin.httpTotal}`}</strong>
          <small>{summary.azureOrigin.blockedChecks.join(", ") || "none"}</small>
        </article>
        <article>
          <span>Azure TCP probes</span>
          <strong>{`${summary.azureOrigin.tcpPassed}/${summary.azureOrigin.tcpTotal}`}</strong>
          <small>{summary.azureOrigin.httpFailureCategories.join(", ") || "no HTTP failure category"}</small>
        </article>
        <article>
          <span>Azure SSH</span>
          <strong>{summary.azureOrigin.sshStatus}</strong>
          <small>{summary.azureOrigin.sshReason}</small>
        </article>
        <article>
          <span>Azure transport lane</span>
          <strong>{summary.azureOrigin.transportLane}</strong>
          <small>{summary.azureOrigin.transportNextAction}</small>
        </article>
        <article>
          <span>Password/key repair</span>
          <strong>{summary.azureOrigin.sshPasswordKeyRepairViable ? "viable" : "blocked"}</strong>
          <small>{`ssh phase ${summary.azureOrigin.sshTransportPhase}; Run Command required ${yesNo(summary.azureOrigin.azurePortalRunCommandRequired)}`}</small>
        </article>
        <article>
          <span>Run Command diagnosis</span>
          <strong>{summary.azureRunCommandDiagnosis.status}</strong>
          <small>{`source ${summary.azureRunCommandDiagnosis.sourceStatus}; superseded by ${summary.azureRunCommandDiagnosis.supersededBy}`}</small>
        </article>
        <article>
          <span>Run Command source findings</span>
          <strong>{summary.azureRunCommandDiagnosis.sourceFindings.join(", ") || "none"}</strong>
          <small>{`repair ${summary.azureRunCommandDiagnosis.sshRepairStatus}; runtime ${summary.azureRunCommandDiagnosis.originRuntimeStatus}; next ${summary.azureRunCommandDiagnosis.nextRepairLane}`}</small>
        </article>
        <article>
          <span>Raw output persisted</span>
          <strong>{summary.azureRunCommandDiagnosis.rawOutputPersisted ? "yes" : "no"}</strong>
          <small>raw_run_command_output_persisted</small>
        </article>
        <article>
          <span>Top action</span>
          <strong>{summary.topPriorityAction.actionId}</strong>
          <small>{summary.topPriorityAction.requiresExternalInput ? summary.topPriorityAction.externalInput : "agent executable"}</small>
        </article>
        <article>
          <span>Safe projection flags</span>
          <strong>{safetyFlags.some(Boolean) ? "unsafe" : "clear"}</strong>
          <small>secret/raw/auth/cookie/signed URL flags remain false</small>
        </article>
      </div>
      <div className="release-subsection span-12">
        <div className="panel-header">
          <div>
            <h3>Operator Shortlist</h3>
            <p>Machine-derived non-clearing queue for the remaining production and parallel staging actions.</p>
          </div>
          <StatusBadge value="warn" label={`${summary.operatorShortlist.length}/5 items`} />
        </div>
        <DataTable<Stage1NextBlockersSummary["operatorShortlist"][number]>
          rows={summary.operatorShortlist}
          columns={[
            { key: "order", header: "#", render: (row) => row.order },
            { key: "item", header: "Item", render: (row) => <span className="mono">{row.itemId}</span> },
            { key: "blocker", header: "Current Blocker", render: (row) => row.currentBlocker },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction },
            { key: "command", header: "Agent Command", render: (row) => <span className="mono">{row.command}</span> },
            { key: "impact", header: "Gate Impact", render: (row) => <span className="mono">{row.gateImpact}</span> }
          ]}
        />
      </div>
      <div
        className="release-subsection span-12"
        data-stage1-next-blockers-action-packet="blind-operator-handoff"
        data-stage1-next-blockers-action-packet-count={summary.operatorActionPacket.length}
        data-stage1-next-blockers-action-packet-non-clearing="true"
      >
        <div className="panel-header">
          <div>
            <h3>Operator Action Packet</h3>
            <p>Blind-friendly return artifacts and agent commands for each remaining blocker.</p>
          </div>
          <StatusBadge value="warn" label={`${summary.operatorActionPacket.length} handoff rows`} />
        </div>
        <DataTable<Stage1NextBlockersSummary["operatorActionPacket"][number]>
          rows={summary.operatorActionPacket}
          columns={[
            { key: "order", header: "#", render: (row) => row.order },
            { key: "item", header: "Item", render: (row) => <span className="mono">{row.itemId}</span> },
            { key: "owner", header: "Owner", render: (row) => <span className="mono">{row.owner}</span> },
            { key: "return", header: "Return Artifact", render: (row) => row.requiredReturnArtifact },
            { key: "agent", header: "Agent Command After Return", render: (row) => <span className="mono">{row.agentCommandAfterReturn}</span> },
            { key: "validate", header: "Validation", render: (row) => <span className="mono">{row.validationAfterReturn}</span> },
            { key: "note", header: "Handoff Note", render: (row) => row.blindHandoffNote },
            { key: "impact", header: "Gate Impact", render: (row) => <span className="mono">{row.gateImpact}</span> }
          ]}
        />
      </div>
      <div className="release-subsection span-12">
        <div className="panel-header">
          <div>
            <h3>Azure Transport Diagnosis</h3>
            <p>{summary.azureOrigin.transportSummary}</p>
          </div>
          <StatusBadge value={statusTone(summary.azureOrigin.status)} label={summary.azureOrigin.transportLane} />
        </div>
        <DataTable<{ reason: string }>
          rows={summary.azureOrigin.transportBlockedReasons.map((reason) => ({ reason }))}
          columns={[{ key: "reason", header: "Transport Blocked Reason", render: (row) => <span className="mono">{row.reason}</span> }]}
        />
      </div>
      <div className="release-subsection span-12">
        <div className="panel-header">
          <div>
            <h3>Top Priority Action</h3>
            <p>{summary.topPriorityAction.why}</p>
          </div>
          <StatusBadge value={statusTone(summary.topPriorityAction.status)} label={summary.topPriorityAction.lane} />
        </div>
        <div className="record-list panel-body">
          <article className="record-card">
            <strong className="mono">{summary.topPriorityAction.command}</strong>
            <p>{summary.topPriorityAction.externalInput}</p>
          </article>
        </div>
      </div>
      <DataTable<Stage1NextBlockersSummary["productionLanes"][number]>
        rows={summary.productionLanes}
        columns={[
          { key: "lane", header: "Lane", render: (row) => <span className="mono">{row.laneId}</span> },
          { key: "blockers", header: "Blockers", render: (row) => row.blockingInputCount },
          { key: "percent", header: "Percent", render: (row) => `${row.completionPercent}%` },
          { key: "first", header: "First Blocker", render: (row) => row.firstBlocker }
        ]}
      />
      {originSummaryRows.length > 0 ? (
        <DataTable<(typeof originSummaryRows)[number]>
          rows={originSummaryRows}
          columns={[
            { key: "key", header: "Run Command Origin Signal", render: (row) => <span className="mono">{row.key}</span> },
            { key: "value", header: "Value", render: (row) => row.value }
          ]}
        />
      ) : null}
    </section>
  );
}

function AzureOriginReadinessPanel({ readiness }: { readiness: Stage1AzureOriginReadiness }) {
  const tcpPass = readiness.tcpPorts.filter((row) => row.status === "pass").length;
  const httpPass = readiness.httpProbes.filter((row) => row.status === "pass").length;
  const runCommandHandoffRows = azureRunCommandHandoffRows(readiness);
  const dnsAddressSummary = readiness.stagingDns.addresses.slice(0, 4).join(", ") || readiness.stagingDns.errorSummary || "none";
  const firstHttpBlocker =
    readiness.httpProbes.find((row) => AZURE_ORIGIN_PRIORITY_FAILURE_CATEGORIES.includes(row.failureCategory))?.failureCategory ||
    readiness.httpProbes.find((row) => row.status !== "pass" && row.failureCategory !== "none")?.failureCategory ||
    readiness.blockedChecks.find((item) => item.includes("http")) ||
    "origin HTTP responses available";
  const sshPreflightReason = AZURE_ORIGIN_SSH_FAILURE_REASONS.includes(readiness.sshKeyPreflight.reason)
    ? readiness.sshKeyPreflight.reason
    : readiness.sshKeyPreflight.reason || "ssh preflight reason not reported";
  const azureCliReason = AZURE_CLI_PREFLIGHT_REASONS.includes(readiness.azureCliPreflight.reason)
    ? readiness.azureCliPreflight.reason
    : readiness.azureCliPreflight.reason || "azure cli preflight reason not reported";
  const transport = readiness.transportDiagnosis;

  return (
    <section
      className="panel"
      data-azure-origin-readiness="validator-derived"
      data-azure-origin-readiness-non-clearing={String(readiness.nonClearingOriginProbe)}
      data-azure-origin-readiness-export="ops/evidence/staging/stage1-azure-origin-readiness.json"
      data-azure-origin-readiness-generator="python3 scripts/stage1_azure_origin_readiness.py"
      data-azure-origin-readiness-validator="python3 scripts/validate_stage1_azure_origin_readiness.py"
      data-azure-origin-transport-diagnosis="transport_diagnosis"
    >
      <div className="panel-header">
        <div>
          <h3>Azure Origin Readiness</h3>
          <p>{readiness.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(readiness.status)} label={`${readiness.status} / ${readiness.releaseGateDecision}`} />
      </div>
      <div className="dependency-summary">
        <article>
          <span>Evidence file</span>
          <strong>{readiness.evidencePresent ? "present" : "missing"}</strong>
          <small>{readiness.schemaVersion}</small>
        </article>
        <article>
          <span>Azure IP</span>
          <strong>{readiness.azureIp}</strong>
          <small>{readiness.stagingWebUrl}</small>
        </article>
        <article>
          <span>TCP ports</span>
          <strong>{`${tcpPass}/${readiness.tcpPorts.length}`}</strong>
          <small>22, 80, and 443 are the first origin checks</small>
        </article>
        <article>
          <span>HTTP probes</span>
          <strong>{`${httpPass}/${readiness.httpProbes.length}`}</strong>
          <small>{firstHttpBlocker}</small>
        </article>
        <article>
          <span>Priority HTTP failures</span>
          <strong>{AZURE_ORIGIN_PRIORITY_FAILURE_CATEGORIES.length}</strong>
          <small className="inline-token-list">
            {AZURE_ORIGIN_PRIORITY_FAILURE_CATEGORIES.map((category) => (
              <span className="mono" key={category}>
                {category}
              </span>
            ))}
          </small>
        </article>
        <article>
          <span>Staging DNS</span>
          <strong>{readiness.stagingDns.status}</strong>
          <small>{dnsAddressSummary}</small>
        </article>
        <article>
          <span>SSH key preflight</span>
          <strong>{readiness.sshKeyPreflight.status}</strong>
          <small>{sshPreflightReason}</small>
        </article>
        <article>
          <span>Transport lane</span>
          <strong>{transport.lane}</strong>
          <small>{transport.nextAction}</small>
        </article>
        <article>
          <span>SSH transport phase</span>
          <strong>{transport.sshTransportPhase}</strong>
          <small>{transport.sshBannerReceived ? "SSH banner received" : "SSH banner not received"}</small>
        </article>
        <article>
          <span>Password/key repair viable</span>
          <strong>{transport.sshPasswordKeyRepairViable ? "yes" : "no"}</strong>
          <small>{transport.azurePortalRunCommandRequired ? "Azure Run Command required" : "local SSH repair may be possible"}</small>
        </article>
        <article>
          <span>Azure CLI preflight</span>
          <strong>{readiness.azureCliPreflight.status}</strong>
          <small>{azureCliReason}</small>
        </article>
        <article>
          <span>SSH hard timeout</span>
          <strong>{`${readiness.sshHardTimeoutSeconds}s`}</strong>
          <small>preflight exits instead of hanging on Azure SSH auth stalls</small>
        </article>
        <article>
          <span>Repair env key</span>
          <strong>{readiness.localRepairPasswordEnvKey || AZURE_ORIGIN_LOCAL_REPAIR_PASSWORD_ENV_KEY}</strong>
          <small>{readiness.localRepairPasswordRequired && !readiness.localRepairPasswordConfigured ? "required locally, value not persisted" : "not required"}</small>
        </article>
        <article>
          <span>Diagnostics command</span>
          <strong>{readiness.originDiagnosticsCommand}</strong>
          <small>originDiagnosticsCommand</small>
        </article>
        <article>
          <span>Repair command</span>
          <strong>{readiness.originRepairCommand}</strong>
          <small>originRepairCommand</small>
        </article>
        <article>
          <span>Password persisted</span>
          <strong>{readiness.sshKeyPreflight.passwordAttempted ? "attempted" : "no"}</strong>
          <small>diagnostic evidence must not store SSH passwords</small>
        </article>
        <article>
          <span>Clears gates</span>
          <strong>
            {readiness.canClearStage1StagingRuntimeGate || readiness.canClearStage1ProductionLaunchGate || readiness.canCloseDoNotLaunch
              ? "unsafe"
              : "no"}
          </strong>
          <small>non-clearing staging origin probe only</small>
        </article>
      </div>
      <div className="release-subsection">
        <div className="panel-header">
          <div>
            <h3>Azure Transport Diagnosis</h3>
            <p>{transport.operatorSummary}</p>
          </div>
          <StatusBadge value={statusTone(transport.status)} label={transport.lane} />
        </div>
        <DataTable<AzureTransportDiagnosisRow>
          rows={[
            { field: "nextAction", value: transport.nextAction },
            { field: "sshTransportPhase", value: transport.sshTransportPhase },
            { field: "tcpEntryPortsReachable", value: yesNo(transport.tcpEntryPortsReachable) },
            { field: "sshBannerReceived", value: yesNo(transport.sshBannerReceived) },
            { field: "sshAuthReached", value: yesNo(transport.sshAuthReached) },
            { field: "sshPasswordKeyRepairViable", value: yesNo(transport.sshPasswordKeyRepairViable) },
            { field: "httpRequestSent", value: yesNo(transport.httpRequestSent) },
            { field: "httpResponseStarted", value: yesNo(transport.httpResponseStarted) },
            { field: "httpZeroBytesAfterRequest", value: yesNo(transport.httpZeroBytesAfterRequest) },
            { field: "tlsServerhelloTimeout", value: yesNo(transport.tlsServerhelloTimeout) },
            { field: "azurePortalRunCommandRequired", value: yesNo(transport.azurePortalRunCommandRequired) }
          ]}
          columns={[
            { key: "field", header: "Transport Field", render: (row) => <span className="mono">{row.field}</span> },
            { key: "value", header: "Value", render: (row) => row.value }
          ]}
        />
        <DataTable<{ reason: string }>
          rows={transport.blockedReasons.map((reason) => ({ reason }))}
          columns={[{ key: "reason", header: "Transport Blocked Reason", render: (row) => <span className="mono">{row.reason}</span> }]}
        />
      </div>
      <div
        className="release-subsection"
        data-azure-run-command-handoff="operator-card-derived"
        data-azure-run-command-operator-card={AZURE_RUN_COMMAND_OPERATOR_CARD}
        data-azure-run-command-payload={AZURE_RUN_COMMAND_PAYLOAD}
        data-azure-run-command-ingest={AZURE_RUN_COMMAND_INGEST}
        data-azure-run-command-password-key-repair-viable={yesNo(transport.sshPasswordKeyRepairViable)}
        data-azure-run-command-required={yesNo(transport.azurePortalRunCommandRequired)}
      >
        <div className="panel-header">
          <div>
            <h3>Azure Portal Run Command Handoff</h3>
            <p>{transport.operatorSummary}</p>
          </div>
          <StatusBadge value={transport.azurePortalRunCommandRequired ? "blocked" : "pass"} label={transport.nextAction} />
        </div>
        <div className="dependency-summary">
          <article>
            <span>Portal action</span>
            <strong>RunShellScript</strong>
            <small>{`target ${readiness.sshKeyPreflight.targetUser}@${readiness.azureIp}`}</small>
          </article>
          <article>
            <span>Payload path</span>
            <strong>{AZURE_RUN_COMMAND_PAYLOAD}</strong>
            <small>paste into the Azure VM page, not Cloud Shell</small>
          </article>
          <article>
            <span>Local ingest</span>
            <strong>{AZURE_RUN_COMMAND_INGEST}</strong>
            <small>paste Azure output into stdin; raw output is sanitized</small>
          </article>
          <article>
            <span>Not a password loop</span>
            <strong>{transport.sshPasswordKeyRepairViable ? "check auth" : "transport first"}</strong>
            <small>{transport.sshTransportPhase}</small>
          </article>
        </div>
        <DataTable<AzureRunCommandHandoffRow>
          rows={runCommandHandoffRows}
          columns={[
            { key: "order", header: "#", render: (row) => row.order },
            { key: "phase", header: "Phase", render: (row) => <span className="mono">{row.phase}</span> },
            { key: "location", header: "Location", render: (row) => row.location },
            { key: "action", header: "Action", render: (row) => row.action },
            { key: "command", header: "Command Or Path", render: (row) => <span className="mono">{row.command}</span> },
            { key: "reason", header: "Reason", render: (row) => row.reason },
            { key: "sideEffect", header: "Side Effect", render: (row) => row.sideEffect }
          ]}
        />
      </div>
      <DataTable<Stage1AzureOriginTcpProbe>
        rows={readiness.tcpPorts}
        columns={[
          { key: "port", header: "Port", render: (row) => <span className="mono">{row.port}</span> },
          { key: "host", header: "Host", render: (row) => row.host },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
          { key: "error", header: "Error", render: (row) => row.errorSummary || "none" }
        ]}
      />
      <DataTable<Stage1AzureOriginHttpProbe>
        rows={readiness.httpProbes}
        columns={[
          { key: "method", header: "Method", render: (row) => row.method },
          { key: "url", header: "URL", render: (row) => <span className="mono">{row.url}</span> },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
          { key: "http", header: "HTTP", render: (row) => (row.httpStatus === null ? "none" : String(row.httpStatus)) },
          { key: "host", header: "Final Host", render: (row) => row.finalUrlHost },
          { key: "phase", header: "Phase", render: (row) => <span className="mono">{row.networkPhase}</span> },
          { key: "failure", header: "Failure", render: (row) => <span className="mono">{row.failureCategory}</span> },
          { key: "bytes", header: "Bytes", render: (row) => String(row.responseBytes) },
          { key: "body", header: "Body Sample", render: (row) => yesNo(row.bodySamplePresent) },
          { key: "error", header: "Error", render: (row) => row.errorSummary || "none" }
        ]}
      />
      <DataTable<{ field: string; value: string }>
        rows={[
          { field: "target", value: `${readiness.sshKeyPreflight.targetUser}@${readiness.sshKeyPreflight.targetHost}` },
          { field: "auth_method", value: readiness.sshKeyPreflight.authMethod },
          { field: "exit_code", value: String(readiness.sshKeyPreflight.exitCode) },
          { field: "reason", value: sshPreflightReason },
          { field: "hard_timeout_seconds", value: String(readiness.sshKeyPreflight.hardTimeoutSeconds) },
          { field: "error_summary", value: readiness.sshKeyPreflight.errorSummary || "none" }
        ]}
        columns={[
          { key: "field", header: "SSH Field", render: (row) => <span className="mono">{row.field}</span> },
          { key: "value", header: "Value", render: (row) => row.value }
        ]}
      />
      <DataTable<Stage1AzureCliPreflight>
        rows={[{ ...readiness.azureCliPreflight, reason: azureCliReason }]}
        columns={[
          { key: "status", header: "Azure CLI Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
          { key: "reason", header: "Reason", render: (row) => <span className="mono">{row.reason}</span> },
          { key: "subscription", header: "Subscription", render: (row) => row.subscriptionId || "none" },
          { key: "resourceGroup", header: "Resource Group", render: (row) => row.resourceGroup || "none" },
          { key: "vmName", header: "VM", render: (row) => row.vmName || "none" },
          { key: "azureIp", header: "Azure IP", render: (row) => <span className="mono">{row.azureIp}</span> },
          { key: "exitCode", header: "Exit", render: (row) => String(row.exitCode) },
          { key: "error", header: "Error", render: (row) => row.errorSummary || "none" }
        ]}
      />
      <DataTable<{ blocker: string }>
        rows={readiness.blockedChecks.map((blocker) => ({ blocker }))}
        columns={[{ key: "blocker", header: "Blocked Check", render: (row) => <span className="mono">{row.blocker}</span> }]}
      />
      <div className="release-subsection">
        <div className="panel-header">
          <div>
            <h3>Azure Origin Repair Commands</h3>
            <p>Run only after the local gitignored environment contains the required private staging inputs.</p>
          </div>
        </div>
        <DataTable<{ command: string }>
          rows={(readiness.originRepairCommands.length > 0 ? readiness.originRepairCommands : AZURE_ORIGIN_REPAIR_COMMAND_FALLBACKS).map((command) => ({ command }))}
          columns={[{ key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }]}
        />
      </div>
      <div className="release-subsection">
        <div className="panel-header">
          <div>
            <h3>Azure Origin Next Actions</h3>
            <p>These actions repair staging origin reachability only; production DNS and launch gates stay blocked.</p>
          </div>
        </div>
        <DataTable<{ action: string }>
          rows={readiness.operatorNextActions.map((action) => ({ action }))}
          columns={[{ key: "action", header: "Action", render: (row) => row.action }]}
        />
      </div>
    </section>
  );
}

function ProductionLaunchBlockerMatrixPanel({
  audit,
  dnsDetail,
  bundle,
  diagnostics
}: {
  audit: Stage1ProductionBlockerAudit;
  dnsDetail: Stage1ProductionDnsDetail;
  bundle: Stage1ProductionProofBundle;
  diagnostics: Stage1ProductionProofDiagnostics;
}) {
  const rows = productionLaunchBlockerMatrixRows({ audit, dnsDetail, bundle, diagnostics });
  const openRows = rows.filter((row) => row.status !== "pass").length;
  const configured = rows.reduce((sum, row) => sum + row.configured, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const missing = rows.reduce((sum, row) => sum + row.missing, 0);
  const invalid = rows.reduce((sum, row) => sum + row.invalid, 0);

  return (
    <section
      className="panel"
      data-production-launch-blocker-matrix="validator-derived"
      data-production-launch-blocker-matrix-non-clearing="true"
      data-production-launch-blocker-matrix-sources="productionDnsDetail,productionProofBundle,productionProofDiagnostics,productionBlockerAudit"
    >
      <div className="panel-header">
        <div>
          <h3>Production Launch Blocker Matrix</h3>
          <p>Four remaining production blocker classes, merged from validator-derived evidence.</p>
        </div>
        <StatusBadge value={openRows === 0 ? "pass" : "blocked"} label={`${rows.length - openRows}/${rows.length} clear`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Open blocker classes</span>
          <strong>{openRows}</strong>
          <small>{rows.find((row) => row.status !== "pass")?.firstBlocker ?? "none"}</small>
        </article>
        <article>
          <span>Proof inputs</span>
          <strong>{`${configured}/${total}`}</strong>
          <small>{`${bundle.inputCoverage.requiredCompletionPercent}% configured`}</small>
        </article>
        <article>
          <span>Missing / invalid</span>
          <strong>{`${missing}/${invalid}`}</strong>
          <small>{`${bundle.inputCoverage.blockingInputCount} blocking inputs`}</small>
        </article>
        <article>
          <span>Release decision</span>
          <strong>{audit.releaseGateDecision}</strong>
          <small>{`${audit.closureSummary.completed}/${audit.closureSummary.total} gates, ${audit.finalBlockerCount} final blockers`}</small>
        </article>
      </div>

      <DataTable<ProductionLaunchBlockerMatrixRow>
        rows={rows}
        columns={[
          { key: "blocker", header: "Blocker", render: (row) => <span className="mono">{row.blocker}</span> },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
          { key: "gate", header: "Gate", render: (row) => <span className="mono">{row.gate}</span> },
          { key: "inputs", header: "Inputs", render: (row) => `${row.configured}/${row.total}` },
          { key: "missing", header: "Missing/Invalid", render: (row) => `${row.missing}/${row.invalid}` },
          { key: "first", header: "First Blocker", render: (row) => row.firstBlocker },
          { key: "evidence", header: "Evidence", render: (row) => <span className="mono">{row.evidence}</span> },
          { key: "next", header: "Next Action", render: (row) => row.nextAction }
        ]}
      />
    </section>
  );
}

function ProductionLaunchOperatorBriefPanel({ brief }: { brief: Stage1ProductionLaunchOperatorBrief }) {
  const summary = brief.summary;
  const openRows = brief.blockerMatrix.filter((row) => row.status !== "pass").length;
  const firstOpenRow = brief.blockerMatrix.find((row) => row.status !== "pass");
  const actions = brief.operatorNextActions.map((action, index) => ({ index: index + 1, action }));

  return (
    <section
      className="panel"
      data-production-launch-operator-brief="validator-derived"
      data-production-launch-operator-brief-export="ops/evidence/non_clearing/production-launch-operator-brief.json"
      data-production-launch-operator-brief-generator="python3 scripts/generate_stage1_production_launch_operator_brief.py"
      data-production-launch-operator-brief-validator="python3 scripts/validate_stage1_production_launch_operator_brief.py"
      data-production-launch-operator-brief-non-clearing={brief.nonClearingOperatorBrief ? "true" : "false"}
      data-production-launch-operator-brief-redaction={brief.valueRedaction}
    >
      <div className="panel-header">
        <div>
          <h3>Production Launch Operator Brief</h3>
          <p>{brief.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(brief.releaseGateDecision)} label={`${brief.status} / ${brief.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Evidence file</span>
          <strong>{brief.evidencePresent ? "present" : "missing"}</strong>
          <small>{brief.schemaVersion}</small>
        </article>
        <article>
          <span>Stage 1 gates</span>
          <strong>{`${summary.stage1GatesCompleted}/${summary.stage1GatesTotal}`}</strong>
          <small>{`${summary.stage1CompletionPercent}% complete; ${summary.openGateCount} open`}</small>
        </article>
        <article>
          <span>Final blocker classes</span>
          <strong>{summary.finalBlockerCount}</strong>
          <small>{firstOpenRow?.firstBlocker ?? "none"}</small>
        </article>
        <article>
          <span>Production inputs</span>
          <strong>{`${summary.productionInputsConfigured}/${summary.productionInputsTotal}`}</strong>
          <small>{`${summary.productionInputsCompletionPercent}% configured`}</small>
        </article>
        <article>
          <span>Missing / invalid</span>
          <strong>{`${summary.productionInputsMissing}/${summary.productionInputsInvalid}`}</strong>
          <small>{`${summary.blockingInputCount} blocking inputs`}</small>
        </article>
        <article>
          <span>Canonical gate</span>
          <strong>{brief.canClearStage1ProductionLaunchGate ? "clearable" : "preserved"}</strong>
          <small>{brief.canCloseDoNotLaunch ? "DNL closeable" : "DNL remains open"}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Brief Blocker Matrix</h3>
              <p>Rows come directly from the non-clearing operator brief.</p>
            </div>
            <StatusBadge value={openRows === 0 ? "pass" : "blocked"} label={`${brief.blockerMatrix.length - openRows}/${brief.blockerMatrix.length} clear`} />
          </div>
          <DataTable<Stage1ProductionLaunchOperatorBriefMatrixRow>
            rows={brief.blockerMatrix}
            columns={[
              { key: "blocker", header: "Blocker", render: (row) => <span className="mono">{row.blockerId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.coverageGroup}</span> },
              { key: "inputs", header: "Inputs", render: (row) => `${row.requiredConfigured}/${row.requiredTotal}` },
              { key: "missing", header: "Missing/Invalid", render: (row) => `${row.requiredMissing}/${row.requiredInvalid}` },
              { key: "blocking", header: "Blocking", render: (row) => row.blockingInputCount },
              { key: "first", header: "First Blocker", render: (row) => row.firstBlocker },
              { key: "diagnostic", header: "Diagnostic", render: (row) => <span className="mono">{row.diagnostic.path}</span> },
              { key: "next", header: "Next Action", render: (row) => row.operatorNextActions[0] ?? "none" }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Brief Open Gates</h3>
              <p>{brief.valueRedaction}</p>
            </div>
          </div>
          <div className="record-list panel-body">
            {brief.openGates.map((gate) => (
              <article className="record-card" key={gate}>
                <p className="mono">{gate}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Brief Next Actions</h3>
              <p>Operator actions are safe text only; Admin does not execute production writes.</p>
            </div>
          </div>
          <DataTable<{ index: number; action: string }>
            rows={actions}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "action", header: "Action", render: (row) => row.action }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionBlockerAuditPanel({ audit }: { audit: Stage1ProductionBlockerAudit }) {
  const coverage = audit.proofInputCoverage;
  const proofRows = productionProofStatusRows(audit);
  const sourceAuditReady = audit.productionSourceAudit.length > 0 && audit.productionSourceAudit.every((row) => row.status === "present");

  return (
    <section
      className="panel"
      data-production-blocker-audit="validator-derived"
      data-production-blocker-audit-export="ops/evidence/non_clearing/production-blocker-audit.json"
      data-production-blocker-audit-generator="python3 scripts/generate_stage1_production_blocker_audit.py"
      data-production-blocker-audit-validator="python3 scripts/validate_stage1_production_blocker_audit.py"
      data-production-proof-bundle="ops/evidence/non_clearing/production-proof-bundle.json"
      data-production-proof-input-coverage="variable_names_only"
      data-production-proof-input-coverage-field="input_variable_coverage"
      data-production-blocker-audit-non-clearing={audit.nonClearingAudit ? "true" : "false"}
    >
      <div className="panel-header">
        <div>
          <h3>Production Blocker Audit</h3>
          <p>{audit.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(audit.releaseGateDecision)} label={`${audit.status} / ${audit.releaseGateDecision}`} />
      </div>
      <div className="dependency-summary">
        <article>
          <span>Evidence file</span>
          <strong>{audit.evidencePresent ? "present" : "missing"}</strong>
          <small>{audit.schemaVersion}</small>
        </article>
        <article>
          <span>Gate completion</span>
          <strong>{`${audit.closureSummary.completed}/${audit.closureSummary.total}`}</strong>
          <small>{`${audit.closureSummary.completionPercent}% complete; ${audit.closureSummary.open} open`}</small>
        </article>
        <article>
          <span>Final blockers</span>
          <strong>{audit.finalBlockerCount}</strong>
          <small>{audit.nonClearingAudit ? "non-clearing audit preserves no-go" : "canonical pass path required"}</small>
        </article>
        <article>
          <span>Production DNS</span>
          <strong>{audit.productionDnsReadiness.status}</strong>
          <small>{audit.productionDnsReadiness.firstBlocker}</small>
        </article>
        <article>
          <span>Proof inputs</span>
          <strong>{`${coverage.requiredConfigured}/${coverage.requiredTotal}`}</strong>
          <small>{`${coverage.requiredCompletionPercent}% configured; ${coverage.blockingInputCount} blocking`}</small>
        </article>
        <article>
          <span>Missing / invalid</span>
          <strong>{`${coverage.requiredMissing}/${coverage.requiredInvalid}`}</strong>
          <small>{coverage.firstMissingOrInvalidInputs.slice(0, 3).join(", ") || "none"}</small>
        </article>
        <article>
          <span>Sandbox / staging</span>
          <strong>{audit.stripeSandboxIsNotCurrentBlocker && audit.stagingIsNotCurrentBlocker ? "not blockers" : "check audit"}</strong>
          <small>production live evidence is required</small>
        </article>
        <article>
          <span>Open probes</span>
          <strong>{audit.openSourceProbeIds.length}</strong>
          <small>{audit.openSourceProbeIds.slice(0, 3).join(", ") || "none"}</small>
        </article>
      </div>
      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Proof Input Coverage</h3>
              <p>Only variable names and counts are rendered; secret values are not loaded into the page.</p>
            </div>
            <StatusBadge
              value={coverage.blockingInputCount === 0 ? "pass" : "blocked"}
              label={`${coverage.requiredConfigured}/${coverage.requiredTotal} configured`}
            />
          </div>
          <DataTable<Stage1ProductionProofInputCoverageGroup>
            rows={coverage.groups}
            columns={[
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.groupId}</span> },
              { key: "configured", header: "Configured", render: (row) => row.requiredConfigured },
              { key: "missing", header: "Missing", render: (row) => row.requiredMissing },
              { key: "invalid", header: "Invalid", render: (row) => row.requiredInvalid },
              { key: "total", header: "Total", render: (row) => row.requiredTotal }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>First Missing Or Invalid Inputs</h3>
              <p>{coverage.valueRedaction}</p>
            </div>
          </div>
          <div className="record-list panel-body">
            {coverage.firstMissingOrInvalidInputs.map((input) => (
              <article className="record-card" key={input}>
                <p className="mono">{input}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Proof Statuses</h3>
              <p>{audit.proofBundlePath}</p>
            </div>
            <StatusBadge value={statusTone(audit.proofBundleStatus)} label={audit.proofBundleStatus} />
          </div>
          <DataTable<ProductionProofStatusRow>
            rows={proofRows}
            columns={[
              { key: "proof", header: "Proof", render: (row) => <span className="mono">{row.proof}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Production DNS Readiness</h3>
              <p>{audit.productionDnsReadiness.path}</p>
            </div>
            <StatusBadge
              value={statusTone(audit.productionDnsReadiness.status)}
              label={audit.productionDnsReadiness.releaseGateDecision}
            />
          </div>
          <DataTable<{ check: string; status: string }>
            rows={[
              { check: "production_web_url", status: audit.productionDnsReadiness.productionWebUrl },
              { check: "public_dns_a_status", status: audit.productionDnsReadiness.publicDnsAStatus },
              { check: "public_dns_aaaa_status", status: audit.productionDnsReadiness.publicDnsAaaaStatus },
              { check: "system_resolver_status", status: audit.productionDnsReadiness.systemResolverStatus }
            ]}
            columns={[
              { key: "check", header: "Check", render: (row) => <span className="mono">{row.check}</span> },
              { key: "status", header: "Status", render: (row) => row.status }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Production Source Audit</h3>
              <p>Strict production source probes must pass before the aggregate launch gate can clear.</p>
            </div>
            <StatusBadge
              value={sourceAuditReady ? "pass" : "blocked"}
              label={`${audit.productionSourceAudit.filter((row) => row.status === "present").length}/${audit.productionSourceAudit.length} present`}
            />
          </div>
          <DataTable<Stage1ProductionBlockerAuditSourceRow>
            rows={audit.productionSourceAudit}
            columns={[
              { key: "probe", header: "Probe", render: (row) => <span className="mono">{row.probeId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "missing", header: "Missing Input", render: (row) => <span className="mono">{row.missingInput}</span> },
              { key: "blocker", header: "First Blocker", render: (row) => row.firstBlocker },
              { key: "action", header: "Operator Action", render: (row) => row.operatorAction },
              { key: "path", header: "Source Path", render: (row) => <span className="mono">{row.sourcePath}</span> },
              { key: "strict", header: "Strict Validation", render: (row) => row.strictValidationSummary }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionCopySafeCommandListPanel({
  refresh,
  dnsDetail,
  inputTemplate,
  proofBundle,
  packet
}: {
  refresh: Stage1ProductionNonClearingRefresh;
  dnsDetail: Stage1ProductionDnsDetail;
  inputTemplate: Stage1ProductionInputTemplate;
  proofBundle: Stage1ProductionProofBundle;
  packet: Stage1ProductionLaunchInputPacket;
}) {
  const commandRows = productionCopySafeCommandRows({ refresh, dnsDetail, inputTemplate, proofBundle, packet });
  const unsafeSideEffectsRequested =
    refresh.dnsApplyRequested || refresh.canonicalSourcesRequested || proofBundle.canonicalSourcesRequested || packet.proofBundleCanonicalSourcesRequested;

  return (
    <section
      className="panel"
      data-production-copy-safe-commands="operator-handoff"
      data-production-copy-safe-commands-non-clearing={unsafeSideEffectsRequested ? "false" : "true"}
      data-production-copy-safe-commands-private-env="<private-production-env>"
      data-production-copy-safe-commands-exec-controls="absent"
    >
      <div className="panel-header">
        <div>
          <h3>Copy-Safe Production Commands</h3>
          <p>Operator handoff only; commands are rendered as text and the Admin page does not execute production writes.</p>
        </div>
        <StatusBadge value={unsafeSideEffectsRequested ? "blocked" : "pass"} label={unsafeSideEffectsRequested ? "side effect requested" : "non-clearing"} />
      </div>
      <div className="dependency-summary">
        <article>
          <span>Command count</span>
          <strong>{commandRows.length}</strong>
          <small>refresh, DNS, private env, proof bundle, launch packet</small>
        </article>
        <article>
          <span>Private env</span>
          <strong>{"<private-production-env>"}</strong>
          <small>must stay gitignored and outside evidence</small>
        </article>
        <article>
          <span>DNS apply</span>
          <strong>{refresh.dnsApplyRequested ? "requested" : "not requested"}</strong>
          <small>copy-safe list does not include --apply</small>
        </article>
        <article>
          <span>Canonical writes</span>
          <strong>{refresh.canonicalSourcesRequested || proofBundle.canonicalSourcesRequested ? "requested" : "not requested"}</strong>
          <small>production source writes remain gated on strict proof</small>
        </article>
      </div>
      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Command List</h3>
              <p>Rows intentionally contain placeholders and paths only; no token, password, key, cookie, or webhook value is loaded.</p>
            </div>
          </div>
          <DataTable<ProductionCopySafeCommandRow>
            rows={commandRows}
            columns={[
              { key: "lane", header: "Lane", render: (row) => <span className="mono">{row.lane}</span> },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> },
              { key: "source", header: "Source", render: (row) => <span className="mono">{row.source}</span> },
              { key: "side-effect", header: "Side Effect", render: (row) => row.sideEffect }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionDnsDetailPanel({ dnsDetail }: { dnsDetail: Stage1ProductionDnsDetail }) {
  const currentRecordPassCount = dnsDetail.currentRecords.filter((row) => row.status === "pass").length;
  const httpsPassCount = dnsDetail.httpsProbe.filter((row) => row.status === "pass").length;
  const blockedChecks = dnsDetail.blockedChecks.map((blocker, index) => ({ index: index + 1, blocker }));
  const operatorActions = dnsDetail.operatorNextActions.map((action, index) => ({ index: index + 1, action }));
  const repairPacket = dnsDetail.repairPacket;
  const repairRequiredInputs = repairPacket.requiredInputs.map((input, index) => ({ index: index + 1, input }));
  const repairBlockedChecks = repairPacket.blockedChecks.map((blocker, index) => ({ index: index + 1, blocker }));
  const repairCommands = repairPacket.commandsAfterInputs.map((command, index) => ({ index: index + 1, command }));
  const repairActions = repairPacket.operatorNextActions.map((action, index) => ({ index: index + 1, action }));
  const cloudflareUiSteps = repairPacket.cloudflareUiSteps.map((step, index) => ({ index: index + 1, step }));
  const cloudflareApiPlan = repairPacket.cloudflareApiPlan.map((step, index) => ({ index: index + 1, step }));
  const privateEnvTemplateRows = repairPacket.privateEnvTemplate.templateLines.map((line, index) => ({ index: index + 1, line }));
  const verificationCommands = repairPacket.verificationCommands.map((command, index) => ({ index: index + 1, command }));
  const operatorCommandRows = repairPacket.operatorCommandPacket.map((row, index) => ({ index: index + 1, ...row }));
  const evidenceOutputs = [
    { output: "dns_readiness", path: dnsDetail.evidenceOutputs.dnsReadiness },
    { output: "cutover_plan", path: dnsDetail.evidenceOutputs.cutoverPlan },
    { output: "legal_support_operator_packet", path: dnsDetail.evidenceOutputs.legalSupportOperatorPacket },
    { output: "production_dns_repair_packet", path: dnsDetail.evidenceOutputs.dnsRepairPacket ?? repairPacket.sourcePath }
  ];

  return (
    <section
      className="panel"
      data-production-dns-detail="validator-derived"
      data-production-dns-detail-readiness="ops/evidence/non_clearing/production-dns-readiness.json"
      data-production-dns-detail-cutover-plan="ops/evidence/non_clearing/production-dns-cutover-plan.json"
      data-production-dns-detail-readiness-runner="python3 scripts/stage1_production_dns_readiness.py"
      data-production-dns-detail-cutover-runner="python3 scripts/stage1_production_dns_cutover_plan.py"
      data-production-dns-detail-validator="python3 scripts/validate_stage1_production_dns_readiness.py && python3 scripts/validate_stage1_production_dns_cutover_plan.py"
      data-production-dns-detail-non-clearing={dnsDetail.nonClearingCutoverPlan ? "true" : "false"}
      data-production-dns-repair-packet="validator-derived"
      data-production-dns-repair-packet-export="ops/evidence/non_clearing/production-dns-repair-packet.json"
      data-production-dns-repair-packet-generator="python3 scripts/generate_stage1_production_dns_repair_packet.py"
      data-production-dns-repair-packet-validator="python3 scripts/validate_stage1_production_dns_repair_packet.py"
      data-production-dns-repair-packet-non-clearing={repairPacket.nonClearingRepairPacket ? "true" : "false"}
    >
      <div className="panel-header">
        <div>
          <h3>Production DNS Detail</h3>
          <p>{dnsDetail.readinessPath}</p>
        </div>
        <StatusBadge value={statusTone(dnsDetail.releaseGateDecision)} label={`${dnsDetail.status} / ${dnsDetail.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Readiness file</span>
          <strong>{dnsDetail.readinessPresent ? "present" : "missing"}</strong>
          <small>{dnsDetail.schemaVersion}</small>
        </article>
        <article>
          <span>Cutover plan</span>
          <strong>{dnsDetail.cutoverPlanPresent ? dnsDetail.cutoverStatus : "missing"}</strong>
          <small>{dnsDetail.cutoverPlanPath}</small>
        </article>
        <article>
          <span>Production URL</span>
          <strong>{dnsDetail.productionWebUrl}</strong>
          <small>{dnsDetail.stagingControlUrl}</small>
        </article>
        <article>
          <span>Cloudflare inputs</span>
          <strong>{`${yesNo(dnsDetail.cloudflareZone.zoneIdConfigured)}/${yesNo(dnsDetail.cloudflareZone.apiTokenConfigured)}`}</strong>
          <small>zone id / dns edit token</small>
        </article>
        <article>
          <span>Target</span>
          <strong>{dnsDetail.target.status}</strong>
          <small>{dnsDetail.target.targetHint}</small>
        </article>
        <article>
          <span>Current DNS</span>
          <strong>{`${currentRecordPassCount}/${dnsDetail.currentRecords.length}`}</strong>
          <small>{dnsDetail.requiredHosts.join(", ") || "required hosts missing"}</small>
        </article>
        <article>
          <span>HTTPS paths</span>
          <strong>{`${httpsPassCount}/${dnsDetail.httpsProbe.length}`}</strong>
          <small>{dnsDetail.httpsProbe.find((row) => row.status !== "pass")?.error || "all paths passing"}</small>
        </article>
        <article>
          <span>Launch gate</span>
          <strong>{dnsDetail.canClearStage1ProductionLaunchGate ? "clearable" : "preserved"}</strong>
          <small>{dnsDetail.canCloseDoNotLaunch ? "DNL closeable" : "DNL remains open"}</small>
        </article>
        <article>
          <span>Repair packet</span>
          <strong>{repairPacket.evidencePresent ? repairPacket.status : "missing"}</strong>
          <small>{`${repairPacket.summary.requiredInputCount} inputs / ${repairPacket.summary.dnsBlockerCount} blockers`}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Production DNS Repair Packet</h3>
              <p>{repairPacket.sourcePath}</p>
            </div>
            <StatusBadge value={statusTone(repairPacket.releaseGateDecision)} label={`${repairPacket.status} / ${repairPacket.releaseGateDecision}`} />
          </div>

          <div className="dependency-summary">
            <article>
              <span>Evidence file</span>
              <strong>{repairPacket.evidencePresent ? "present" : "missing"}</strong>
              <small>{repairPacket.schemaVersion}</small>
            </article>
            <article>
              <span>Production resolver</span>
              <strong>{repairPacket.summary.productionSystemResolverStatus}</strong>
              <small>{`A ${repairPacket.summary.productionAStatus} / AAAA ${repairPacket.summary.productionAaaaStatus}`}</small>
            </article>
            <article>
              <span>Staging control</span>
              <strong>{repairPacket.summary.stagingControlResolverStatus}</strong>
              <small>{`staging A ${repairPacket.summary.stagingAStatus}`}</small>
            </article>
            <article>
              <span>Cloudflare repair</span>
              <strong>{`${yesNo(repairPacket.summary.cloudflareZoneIdConfigured)}/${yesNo(repairPacket.summary.cloudflareApiTokenConfigured)}`}</strong>
              <small>{`target ${repairPacket.summary.productionDnsTargetStatus}`}</small>
            </article>
            <article>
              <span>Runbook step</span>
              <strong>{repairPacket.summary.sourceRunbookStepId}</strong>
              <small>{`${repairPacket.summary.sourceRunbookBlockingInputCount} blocking inputs`}</small>
            </article>
            <article>
              <span>Apply state</span>
              <strong>{repairPacket.canApplyDnsChanges ? "applyable" : "blocked"}</strong>
              <small>{repairPacket.nonClearingRepairPacket ? "non-clearing packet" : "clearing packet"}</small>
            </article>
            <article>
              <span>Private env</span>
              <strong>{repairPacket.privateEnvTemplate.pathPlaceholder}</strong>
              <small>{repairPacket.privateEnvTemplate.gitignoreRequired ? "gitignored copy required" : "gitignore not declared"}</small>
            </article>
            <article>
              <span>DNS write steps</span>
              <strong>{repairPacket.operatorCommandPacket.filter((row) => row.mayWriteDns).length}</strong>
              <small>{repairPacket.operatorCommandPacket.find((row) => row.mayWriteDns)?.requiresReview ? "review required" : "no write step"}</small>
            </article>
          </div>
        </div>

        <div className="release-subsection span-4">
          <div className="panel-header">
            <div>
              <h3>Repair Required Inputs</h3>
              <p>Variable names only; no token values are persisted.</p>
            </div>
          </div>
          <DataTable<{ index: number; input: string }>
            rows={repairRequiredInputs}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "input", header: "Input", render: (row) => <span className="mono">{row.input}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-8">
          <div className="panel-header">
            <div>
              <h3>Repair Blocked Checks</h3>
              <p>Current apex DNS and Cloudflare input blockers.</p>
            </div>
          </div>
          <DataTable<{ index: number; blocker: string }>
            rows={repairBlockedChecks}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "blocker", header: "Blocked Check", render: (row) => row.blocker }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Recommended DNS Records</h3>
              <p>Apex and www records to create after PRODUCTION_DNS_TARGET is known; values remain placeholders.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof repairPacket>["recommendedRecords"][number]>
            rows={repairPacket.recommendedRecords}
            columns={[
              { key: "host", header: "Host", render: (row) => <span className="mono">{row.host}</span> },
              { key: "type", header: "Type", render: (row) => <span className="mono">{row.type}</span> },
              { key: "name", header: "Name", render: (row) => <span className="mono">{row.name}</span> },
              { key: "content", header: "Content", render: (row) => <span className="mono">{row.content}</span> },
              { key: "proxied", header: "Proxied", render: (row) => yesNo(row.proxied) },
              { key: "ttl", header: "TTL", render: (row) => <span className="mono">{row.ttl}</span> },
              { key: "status", header: "Current", render: (row) => <StatusBadge value={statusTone(row.currentStatus)} label={row.currentStatus} /> },
              { key: "when", header: "Required When", render: (row) => row.requiredWhen }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Cloudflare UI Steps</h3>
              <p>Manual dashboard path for operators without exposing tokens.</p>
            </div>
          </div>
          <DataTable<{ index: number; step: string }>
            rows={cloudflareUiSteps}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "step", header: "Step", render: (row) => row.step }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Cloudflare API Plan</h3>
              <p>Environment-only plan; token values are never rendered or persisted.</p>
            </div>
          </div>
          <DataTable<{ index: number; step: string }>
            rows={cloudflareApiPlan}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "step", header: "Step", render: (row) => row.step }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Private DNS Env Template</h3>
              <p>Blank assignments only; fill a gitignored copy outside evidence.</p>
            </div>
          </div>
          <DataTable<{ index: number; line: string }>
            rows={privateEnvTemplateRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "line", header: "Blank Line", render: (row) => <span className="mono">{row.line}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>DNS Operator Command Packet</h3>
              <p>Copy-safe sequence using the private env placeholder.</p>
            </div>
          </div>
          <DataTable<(typeof operatorCommandRows)[number]>
            rows={operatorCommandRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> },
              { key: "write", header: "DNS Write", render: (row) => yesNo(row.mayWriteDns) },
              { key: "review", header: "Review", render: (row) => yesNo(row.requiresReview) },
              { key: "side-effect", header: "Side Effect", render: (row) => row.sideEffect }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>DNS Verification Commands</h3>
              <p>Run after DNS propagation before writing legal/support production source evidence.</p>
            </div>
          </div>
          <DataTable<{ index: number; command: string }>
            rows={verificationCommands}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Repair Next Actions</h3>
              <p>Operator handoff after production DNS inputs are available.</p>
            </div>
          </div>
          <DataTable<{ index: number; action: string }>
            rows={repairActions}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "action", header: "Action", render: (row) => row.action }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Commands After Inputs</h3>
              <p>Run only after the missing production DNS inputs are set.</p>
            </div>
          </div>
          <DataTable<{ index: number; command: string }>
            rows={repairCommands}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Current DNS Records</h3>
              <p>Public DNS state from the non-clearing cutover plan.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionDnsProbeRow>
            rows={dnsDetail.currentRecords}
            columns={[
              { key: "probe", header: "Probe", render: (row) => <span className="mono">{row.probeId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "host", header: "Host", render: (row) => <span className="mono">{row.host}</span> },
              { key: "rrtype", header: "Type", render: (row) => <span className="mono">{row.rrtype}</span> },
              { key: "records", header: "Records", render: (row) => (row.records.length > 0 ? row.records.join(", ") : row.addresses.join(", ") || "none") },
              { key: "error", header: "Error", render: (row) => row.error || "none" }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Authoritative DNS</h3>
              <p>A/AAAA probes for production and staging control.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionDnsProbeRow>
            rows={dnsDetail.authoritativePublicDnsProbe}
            columns={[
              { key: "probe", header: "Probe", render: (row) => <span className="mono">{row.probeId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "host", header: "Host", render: (row) => <span className="mono">{row.host}</span> },
              { key: "addresses", header: "Addresses", render: (row) => row.addresses.join(", ") || "none" }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>System Resolver</h3>
              <p>Local resolver view used by the production DNS readiness probe.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionDnsProbeRow>
            rows={dnsDetail.systemResolver}
            columns={[
              { key: "probe", header: "Probe", render: (row) => <span className="mono">{row.probeId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "host", header: "Host", render: (row) => <span className="mono">{row.host}</span> },
              { key: "addresses", header: "Addresses", render: (row) => row.addresses.join(", ") || "none" },
              { key: "error", header: "Error", render: (row) => row.error || "none" }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>HTTPS Probe Paths</h3>
              <p>Production legal/support paths must pass before canonical legal/support source can clear.</p>
            </div>
            <StatusBadge value={httpsPassCount === dnsDetail.httpsProbe.length ? "pass" : "blocked"} label={`${httpsPassCount}/${dnsDetail.httpsProbe.length} pass`} />
          </div>
          <DataTable<Stage1ProductionDnsProbeRow>
            rows={dnsDetail.httpsProbe}
            columns={[
              { key: "probe", header: "Probe", render: (row) => <span className="mono">{row.probeId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "status-code", header: "HTTP", render: (row) => row.httpStatus ?? "n/a" },
              { key: "url", header: "URL", render: (row) => <span className="mono">{row.url}</span> },
              { key: "error", header: "Error", render: (row) => row.error || "none" }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>DNS Blocked Checks</h3>
              <p>These blockers are diagnostic only and cannot clear the production gate.</p>
            </div>
          </div>
          <DataTable<{ index: number; blocker: string }>
            rows={blockedChecks}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "blocker", header: "Blocked Check", render: (row) => row.blocker }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>DNS Next Actions</h3>
              <p>Operator actions from the cutover plan, rendered without secret values.</p>
            </div>
          </div>
          <DataTable<{ index: number; action: string }>
            rows={operatorActions}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "action", header: "Action", render: (row) => row.action }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>DNS Evidence Outputs</h3>
              <p>Output paths remain non-clearing until strict production validators pass.</p>
            </div>
          </div>
          <DataTable<{ output: string; path: string }>
            rows={evidenceOutputs}
            columns={[
              { key: "output", header: "Output", render: (row) => <span className="mono">{row.output}</span> },
              { key: "path", header: "Path", render: (row) => <span className="mono">{row.path}</span> }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionMissingInputChecklistPanel({ checklist }: { checklist: Stage1ProductionMissingInputChecklist }) {
  const summary = checklist.summary;
  const blockingRows = checklist.items.filter((row) => row.status === "missing" || row.status === "invalid");
  const firstBlockingRow = blockingRows[0];
  const actionRows = checklist.operatorNextActions.map((action, index) => ({ index: index + 1, action }));

  return (
    <section
      className="panel"
      data-production-missing-input-checklist="validator-derived"
      data-production-missing-input-checklist-export="ops/evidence/non_clearing/production-missing-input-checklist.json"
      data-production-missing-input-checklist-generator="python3 scripts/generate_stage1_production_missing_input_checklist.py"
      data-production-missing-input-checklist-validator="python3 scripts/validate_stage1_production_missing_input_checklist.py"
      data-production-missing-input-checklist-non-clearing={checklist.nonClearingChecklist ? "true" : "false"}
      data-production-missing-input-checklist-redaction={checklist.valueRedaction}
    >
      <div className="panel-header">
        <div>
          <h3>Production Missing Input Checklist</h3>
          <p>{checklist.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(checklist.releaseGateDecision)} label={`${checklist.status} / ${checklist.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Evidence file</span>
          <strong>{checklist.evidencePresent ? "present" : "missing"}</strong>
          <small>{checklist.schemaVersion}</small>
        </article>
        <article>
          <span>Production inputs</span>
          <strong>{`${summary.requiredConfigured}/${summary.requiredTotal}`}</strong>
          <small>{`${summary.requiredCompletionPercent}% configured`}</small>
        </article>
        <article>
          <span>Missing</span>
          <strong>{summary.requiredMissing}</strong>
          <small>{firstBlockingRow?.displayName ?? "none"}</small>
        </article>
        <article>
          <span>Invalid</span>
          <strong>{summary.requiredInvalid}</strong>
          <small>{summary.blockingInputCount} blocking inputs</small>
        </article>
        <article>
          <span>Groups</span>
          <strong>{checklist.groups.length}</strong>
          <small>{checklist.groups.map((group) => group.groupId).join(", ") || "none"}</small>
        </article>
        <article>
          <span>Canonical gate</span>
          <strong>{checklist.canClearStage1ProductionLaunchGate ? "clearable" : "preserved"}</strong>
          <small>{checklist.canCloseDoNotLaunch ? "DNL closeable" : "DNL remains open"}</small>
        </article>
        <article>
          <span>Sandbox/staging substitutes</span>
          <strong>rejected</strong>
          <small className="inline-token-list">
            {PRODUCTION_MISSING_INPUT_DISALLOWED_SUBSTITUTES.map((item) => (
              <span className="mono" key={item}>
                {item}
              </span>
            ))}
          </small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Checklist Groups</h3>
              <p>Counts are derived from the production proof bundle input coverage.</p>
            </div>
            <StatusBadge value={blockingRows.length === 0 ? "pass" : "blocked"} label={`${blockingRows.length} blocking`} />
          </div>
          <DataTable<Stage1ProductionMissingInputChecklistGroup>
            rows={checklist.groups}
            columns={[
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.groupId}</span> },
              { key: "title", header: "Title", render: (row) => row.title },
              { key: "inputs", header: "Inputs", render: (row) => `${row.requiredConfigured}/${row.requiredTotal}` },
              { key: "missing", header: "Missing/Invalid", render: (row) => `${row.requiredMissing}/${row.requiredInvalid}` },
              { key: "blocking", header: "Blocking", render: (row) => row.blockingInputCount },
              { key: "completion", header: "Completion", render: (row) => `${row.completionPercent}%` },
              {
                key: "first",
                header: "First Inputs",
                render: (row) => [...row.firstMissingRequiredInputs, ...row.invalidRequiredInputs].slice(0, 2).join(" | ") || "none"
              },
              { key: "next", header: "Next Action", render: (row) => row.operatorNextAction }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Blocking Input Items</h3>
              <p>Only variable names and sanitized operator actions are shown.</p>
            </div>
            <StatusBadge value={summary.blockingInputCount === 0 ? "pass" : "blocked"} label={`${summary.blockingInputCount} inputs`} />
          </div>
          <DataTable<Stage1ProductionMissingInputChecklistItem>
            rows={checklist.items}
            columns={[
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.groupId}</span> },
              { key: "requirement", header: "Requirement", render: (row) => <span className="mono">{row.requirementId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "display", header: "Input", render: (row) => <span className="mono">{row.displayName}</span> },
              { key: "accepted", header: "Accepted Names", render: (row) => <span className="mono">{row.acceptedVariableNames.join(" | ")}</span> },
              { key: "configured", header: "Configured Name", render: (row) => <span className="mono">{row.configuredVariableName ?? "none"}</span> },
              { key: "source", header: "Acceptable Source", render: (row) => <span className="mono">{row.acceptableEvidenceSource}</span> },
              {
                key: "substitutes",
                header: "Sandbox/Staging",
                render: (row) => (row.canBeSatisfiedByExistingSandboxOrStagingResources ? "allowed" : `rejected: ${row.disallowedSubstitutes.slice(0, 2).join(" | ")}`)
              },
              { key: "action", header: "Operator Action", render: (row) => row.operatorAction }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Checklist Next Actions</h3>
              <p>{checklist.valueRedaction}</p>
            </div>
          </div>
          <DataTable<{ index: number; action: string }>
            rows={actionRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "action", header: "Action", render: (row) => row.action }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionLaunchInputPacketPanel({ packet }: { packet: Stage1ProductionLaunchInputPacket }) {
  const coverage = packet.proofInputCoverage;
  const sourceInputsReady = packet.sourceInputs.length > 0 && packet.sourceInputs.every((row) => row.status === "present");

  return (
    <section
      className="panel"
      data-production-launch-input-packet="validator-derived"
      data-production-launch-input-packet-export="ops/evidence/non_clearing/production-launch-input-packet.json"
      data-production-launch-input-packet-generator="python3 scripts/generate_stage1_production_launch_input_packet.py"
      data-production-launch-input-packet-validator="python3 scripts/validate_stage1_production_launch_input_packet.py"
      data-production-launch-input-packet-non-clearing={packet.nonClearingInputPacket ? "true" : "false"}
      data-production-launch-input-packet-canonical-pass-path={packet.canonicalPassPath ? "true" : "false"}
    >
      <div className="panel-header">
        <div>
          <h3>Production Launch Input Packet</h3>
          <p>{packet.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(packet.releaseGateDecision)} label={`${packet.status} / ${packet.releaseGateDecision}`} />
      </div>
      <div className="dependency-summary">
        <article>
          <span>Evidence file</span>
          <strong>{packet.evidencePresent ? "present" : "missing"}</strong>
          <small>{packet.schemaVersion}</small>
        </article>
        <article>
          <span>Source inputs</span>
          <strong>{`${packet.sourceInputs.filter((row) => row.status === "present").length}/${packet.sourceInputs.length}`}</strong>
          <small>{sourceInputsReady ? "all canonical source probes present" : "real production source probes still missing"}</small>
        </article>
        <article>
          <span>Proof inputs</span>
          <strong>{`${coverage.requiredConfigured}/${coverage.requiredTotal}`}</strong>
          <small>{`${coverage.requiredCompletionPercent}% configured; ${coverage.blockingInputCount} blocking`}</small>
        </article>
        <article>
          <span>Missing variables</span>
          <strong>{packet.missingVariables.length}</strong>
          <small>{packet.missingVariables.slice(0, 2).join(", ") || "none"}</small>
        </article>
        <article>
          <span>DNS readiness</span>
          <strong>{packet.productionDnsReadinessStatus}</strong>
          <small>{packet.productionDnsReadinessFirstBlocker}</small>
        </article>
        <article>
          <span>Proof bundle</span>
          <strong>{packet.proofBundleStatus}</strong>
          <small>{packet.proofBundleFirstBlockers[0] ?? packet.proofBundlePath}</small>
        </article>
        <article>
          <span>Canonical writes</span>
          <strong>{packet.proofBundleCanonicalSourcesRequested ? "requested" : "not requested"}</strong>
          <small>{packet.canonicalPassPath ? "canonical pass path" : "blocked until real production inputs pass"}</small>
        </article>
        <article>
          <span>Command groups</span>
          <strong>{packet.executionOrder.length}</strong>
          <small>operator sequence from non-clearing packet</small>
        </article>
      </div>
      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Missing Production Inputs</h3>
              <p>{packet.canonicalWritePolicy}</p>
            </div>
          </div>
          <div className="record-list panel-body">
            {packet.missingVariables.map((variable) => (
              <article className="record-card" key={variable}>
                <p className="mono">{variable}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Source Input Commands</h3>
              <p>Commands are visible for handoff only; the page does not execute production canonical writes.</p>
            </div>
            <StatusBadge
              value={sourceInputsReady ? "pass" : "blocked"}
              label={`${packet.sourceInputs.filter((row) => row.status === "present").length}/${packet.sourceInputs.length} present`}
            />
          </div>
          <DataTable<Stage1ProductionLaunchInputPacketSourceInput>
            rows={packet.sourceInputs}
            columns={[
              { key: "probe", header: "Probe", render: (row) => <span className="mono">{row.probeId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "missing", header: "Missing Input", render: (row) => <span className="mono">{row.missingInput}</span> },
              { key: "blocker", header: "First Blocker", render: (row) => row.firstBlocker },
              { key: "source", header: "Source Path", render: (row) => <span className="mono">{row.sourcePath}</span> },
              { key: "template", header: "Template", render: (row) => <span className="mono">{row.sourceTemplateRef}</span> },
              { key: "command", header: "Source Probe Command", render: (row) => <span className="mono">{row.sourceProbeCommand}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Required Env Variable Groups</h3>
              <p>Variable names only; values remain in environment or external proof files.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionLaunchInputPacketEnvGroup>
            rows={packet.requiredEnvVariableGroups}
            columns={[
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.groupId}</span> },
              { key: "count", header: "Count", render: (row) => row.variables.length },
              { key: "variables", header: "Variables", render: (row) => row.variables.slice(0, 12).join(", ") }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Execution Order</h3>
              <p>Preflight commands stay non-clearing; canonical source writes are gated on real production inputs.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionLaunchInputPacketCommandGroup>
            rows={packet.executionOrder}
            columns={[
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.groupId}</span> },
              { key: "count", header: "Commands", render: (row) => row.commands.length },
              { key: "commands", header: "Command List", render: (row) => row.commands.join(" | ") }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionProofBundlePanel({ bundle }: { bundle: Stage1ProductionProofBundle }) {
  const configuredGroups = Object.entries(bundle.configuredInputVariableNames).map(([groupId, names]) => ({
    groupId,
    names
  }));
  const requirements = bundle.inputGroups.flatMap((group) => group.requirements);
  const blockedProofs = bundle.proofs.filter((proof) => proof.status !== "pass").length;
  const passedSteps = bundle.steps.filter((step) => step.status === "pass").length;

  return (
    <section
      className="panel"
      data-production-proof-bundle-detail="validator-derived"
      data-production-proof-bundle-detail-export="ops/evidence/non_clearing/production-proof-bundle.json"
      data-production-proof-bundle-detail-runner="python3 scripts/run_stage1_production_proof_bundle.py"
      data-production-proof-bundle-detail-validator="python3 scripts/validate_stage1_production_proof_bundle.py"
      data-production-proof-bundle-detail-non-clearing={bundle.nonClearingBundle ? "true" : "false"}
      data-production-proof-bundle-detail-redaction={bundle.inputCoverage.valueRedaction}
    >
      <div className="panel-header">
        <div>
          <h3>Production Proof Bundle</h3>
          <p>{bundle.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(bundle.releaseGateDecision)} label={`${bundle.status} / ${bundle.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Evidence file</span>
          <strong>{bundle.evidencePresent ? "present" : "missing"}</strong>
          <small>{bundle.schemaVersion}</small>
        </article>
        <article>
          <span>Proofs</span>
          <strong>{`${bundle.proofs.length - blockedProofs}/${bundle.proofs.length}`}</strong>
          <small>{bundle.proofs.find((proof) => proof.status !== "pass")?.firstBlocker ?? "all proofs passed"}</small>
        </article>
        <article>
          <span>Required inputs</span>
          <strong>{`${bundle.inputCoverage.requiredConfigured}/${bundle.inputCoverage.requiredTotal}`}</strong>
          <small>{`${bundle.inputCoverage.requiredCompletionPercent}% configured; ${bundle.inputCoverage.blockingInputCount} blocking`}</small>
        </article>
        <article>
          <span>Missing / invalid</span>
          <strong>{`${bundle.inputCoverage.requiredMissing}/${bundle.inputCoverage.requiredInvalid}`}</strong>
          <small>{bundle.inputCoverage.firstMissingOrInvalidInputs.slice(0, 3).join(", ") || "none"}</small>
        </article>
        <article>
          <span>Steps</span>
          <strong>{`${passedSteps}/${bundle.steps.length}`}</strong>
          <small>{bundle.blockedChecks[0] ?? "all steps passed"}</small>
        </article>
        <article>
          <span>Canonical writes</span>
          <strong>{bundle.canonicalSourcesRequested ? "requested" : "not requested"}</strong>
          <small>{bundle.canClearStage1ProductionLaunchGate ? "launch gate clearable" : "launch gate preserved"}</small>
        </article>
        <article>
          <span>Configured groups</span>
          <strong>{configuredGroups.length}</strong>
          <small>{configuredGroups.map((group) => `${group.groupId}:${group.names.length}`).join(", ") || "none"}</small>
        </article>
        <article>
          <span>Release SHA</span>
          <strong>{bundle.releaseSha.slice(0, 12)}</strong>
          <small>{bundle.productionWebUrl}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Proof Bundle Inputs</h3>
              <p>Variable names only; no secret values are loaded into the admin page.</p>
            </div>
            <StatusBadge
              value={bundle.inputCoverage.blockingInputCount === 0 ? "pass" : "blocked"}
              label={`${bundle.inputCoverage.requiredConfigured}/${bundle.inputCoverage.requiredTotal} configured`}
            />
          </div>
          <DataTable<Stage1ProductionProofBundleInputGroup>
            rows={bundle.inputGroups}
            columns={[
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.groupId}</span> },
              { key: "configured", header: "Configured", render: (row) => row.requiredConfigured },
              { key: "missing", header: "Missing", render: (row) => row.requiredMissing },
              { key: "invalid", header: "Invalid", render: (row) => row.requiredInvalid },
              { key: "total", header: "Total", render: (row) => row.requiredTotal },
              { key: "configured-names", header: "Configured Names", render: (row) => row.configuredVariableNames.join(", ") || "none" },
              { key: "optional", header: "Optional/Defaulted", render: (row) => `${row.optionalOrDefaultedConfigured}/${row.optionalOrDefaultedTotal}` }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Proof Bundle Requirements</h3>
              <p>Each row is a required production input by variable name and status.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionProofBundleRequirement>
            rows={requirements}
            columns={[
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.groupId}</span> },
              { key: "id", header: "Requirement", render: (row) => <span className="mono">{row.requirementId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "display", header: "Display Name", render: (row) => <span className="mono">{row.displayName}</span> },
              { key: "configured", header: "Configured As", render: (row) => <span className="mono">{row.configuredVariableName ?? "none"}</span> },
              { key: "accepted", header: "Accepted Variables", render: (row) => row.acceptedVariableNames.join(", ") }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Proof Bundle Proofs</h3>
              <p>Billing, security, and governance proof candidates must pass before source writes.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionProofBundleProof>
            rows={bundle.proofs}
            columns={[
              { key: "proof", header: "Proof", render: (row) => <span className="mono">{row.proofId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "blocker", header: "First Blocker", render: (row) => row.firstBlocker },
              { key: "path", header: "Path", render: (row) => <span className="mono">{row.path}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Proof Bundle Steps</h3>
              <p>Expected exit code 2 remains blocked evidence until strict production inputs pass.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionProofBundleStep>
            rows={bundle.steps}
            columns={[
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "exit", header: "Exit", render: (row) => `${row.exitCode}${row.expectedExit ? " expected" : " unexpected"}` },
              { key: "summary", header: "Output Summary", render: (row) => row.outputSummary }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionProofDiagnosticsPanel({ diagnostics }: { diagnostics: Stage1ProductionProofDiagnostics }) {
  const safetyFlags = diagnostics.diagnostics.flatMap((diagnostic) =>
    diagnostic.safetyFlags.map((flag) => ({
      proofId: diagnostic.proofId,
      ...flag
    }))
  );
  const blockedChecks = diagnostics.diagnostics.flatMap((diagnostic) =>
    diagnostic.blockedChecks.map((blocker, index) => ({
      proofId: diagnostic.proofId,
      index: index + 1,
      blocker
    }))
  );

  return (
    <section
      className="panel"
      data-production-proof-diagnostics="validator-derived"
      data-production-proof-diagnostics-non-clearing="true"
      data-production-proof-diagnostics-billing="ops/evidence/non_clearing/production-live-billing-proof.blocked.json"
      data-production-proof-diagnostics-security="ops/evidence/non_clearing/production-security-proof.blocked.json"
      data-production-proof-diagnostics-governance="ops/evidence/non_clearing/production-governance-proof.blocked.json"
    >
      <div className="panel-header">
        <div>
          <h3>Production Proof Diagnostics</h3>
          <p>Blocked proof diagnostics for billing, security, and governance source probes.</p>
        </div>
        <StatusBadge value={statusTone(diagnostics.releaseGateDecision)} label={`${diagnostics.status} / ${diagnostics.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Diagnostic files</span>
          <strong>{`${diagnostics.diagnostics.filter((diagnostic) => diagnostic.evidencePresent).length}/${diagnostics.diagnostics.length}`}</strong>
          <small>{diagnostics.generatedAt}</small>
        </article>
        <article>
          <span>Blocked diagnostics</span>
          <strong>{diagnostics.blockedDiagnosticCount}</strong>
          <small>{diagnostics.firstBlockers.slice(0, 2).join(", ") || "none"}</small>
        </article>
        <article>
          <span>Canonical sources</span>
          <strong>{`${diagnostics.canonicalSourcesWritten}/${diagnostics.diagnostics.length}`}</strong>
          <small>proof diagnostics cannot write sources while blocked</small>
        </article>
        <article>
          <span>Safe projection</span>
          <strong>{diagnostics.safeProjectionReady ? "safe" : "unsafe"}</strong>
          <small>secret, cookie, raw payload, and signed URL flags</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Proof Diagnostic Summary</h3>
              <p>These diagnostics are non-clearing until strict production inputs pass and canonical source probes run.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionProofDiagnostic>
            rows={diagnostics.diagnostics}
            columns={[
              { key: "proof", header: "Proof", render: (row) => <span className="mono">{row.proofId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "source", header: "Diagnostic Path", render: (row) => <span className="mono">{row.sourcePath}</span> },
              { key: "schema", header: "Schema", render: (row) => <span className="mono">{row.schemaVersion}</span> },
              { key: "canonical", header: "Canonical Source Written", render: (row) => yesNo(row.canonicalSourceWritten) },
              { key: "blocker", header: "First Blocker", render: (row) => row.blockedChecks[0] ?? "none" },
              { key: "release", header: "Release SHA", render: (row) => row.releaseSha.slice(0, 12) }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Proof Blocked Checks</h3>
              <p>Current blocker codes from each blocked proof diagnostic.</p>
            </div>
          </div>
          <DataTable<{ proofId: Stage1ProductionProofDiagnostic["proofId"]; index: number; blocker: string }>
            rows={blockedChecks}
            columns={[
              { key: "proof", header: "Proof", render: (row) => <span className="mono">{row.proofId}</span> },
              { key: "index", header: "#", render: (row) => row.index },
              { key: "blocker", header: "Blocked Check", render: (row) => <span className="mono">{row.blocker}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Proof Safety Flags</h3>
              <p>All persisted flags must remain false; no raw payload or secret values are rendered.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionProofDiagnosticFlag & { proofId: Stage1ProductionProofDiagnostic["proofId"] }>
            rows={safetyFlags}
            columns={[
              { key: "proof", header: "Proof", render: (row) => <span className="mono">{row.proofId}</span> },
              { key: "flag", header: "Flag", render: (row) => <span className="mono">{row.flag}</span> },
              { key: "persisted", header: "Persisted", render: (row) => <StatusBadge value={statusTone(String(!row.persisted))} label={yesNo(row.persisted)} /> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Proof Source Commands</h3>
              <p>Commands are handoff text only; Admin does not execute canonical production writes.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionProofDiagnostic>
            rows={diagnostics.diagnostics}
            columns={[
              { key: "proof", header: "Proof", render: (row) => <span className="mono">{row.proofId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "command", header: "Next Command After Pass", render: (row) => <span className="mono">{row.operatorNextCommandAfterPass}</span> }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionLaunchSourcePipelinePanel({ pipeline }: { pipeline: Stage1ProductionLaunchSourcePipeline }) {
  const sourceSteps = pipeline.steps.filter((step) => step.stepId.endsWith("_source_probe"));
  const passedSteps = pipeline.steps.filter((step) => step.status === "pass").length;

  return (
    <section
      className="panel"
      data-production-launch-source-pipeline="validator-derived"
      data-production-launch-source-pipeline-export="ops/evidence/non_clearing/production-launch-source-pipeline.json"
      data-production-launch-source-pipeline-runner="python3 scripts/run_stage1_production_launch_source_pipeline.py"
      data-production-launch-source-pipeline-validator="python3 scripts/validate_stage1_production_launch_source_pipeline.py"
      data-production-launch-source-pipeline-non-clearing={pipeline.nonClearingPipelineSummary ? "true" : "false"}
      data-production-launch-source-pipeline-canonical-sources-requested={pipeline.canonicalSourcesRequested ? "true" : "false"}
    >
      <div className="panel-header">
        <div>
          <h3>Production Launch Source Pipeline</h3>
          <p>{pipeline.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(pipeline.releaseGateDecision)} label={`${pipeline.status} / ${pipeline.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Evidence file</span>
          <strong>{pipeline.evidencePresent ? "present" : "missing"}</strong>
          <small>{pipeline.schemaVersion}</small>
        </article>
        <article>
          <span>Source probes</span>
          <strong>{`${sourceSteps.filter((step) => step.status === "pass").length}/${sourceSteps.length}`}</strong>
          <small>{sourceSteps.find((step) => step.status !== "pass")?.outputSummary ?? "all source probes passed"}</small>
        </article>
        <article>
          <span>Proof candidates</span>
          <strong>{`${pipeline.proofReadiness.filter((proof) => proof.exists).length}/${pipeline.proofReadiness.length}`}</strong>
          <small>{pipeline.proofReadiness.find((proof) => !proof.exists)?.path ?? "all required proof candidates present"}</small>
        </article>
        <article>
          <span>Pipeline steps</span>
          <strong>{`${passedSteps}/${pipeline.steps.length}`}</strong>
          <small>{`${pipeline.blockedChecks.length} blocked checks`}</small>
        </article>
        <article>
          <span>Canonical writes</span>
          <strong>{pipeline.canonicalSourcesRequested ? "requested" : "not requested"}</strong>
          <small>{pipeline.canonicalSourcesMayBeWritten ? "allowed by runner flag" : "blocked until real production inputs pass"}</small>
        </article>
        <article>
          <span>Aggregate attempted</span>
          <strong>{yesNo(pipeline.aggregateAttempted)}</strong>
          <small>{pipeline.strictValidator}</small>
        </article>
        <article>
          <span>Do-Not-Launch</span>
          <strong>{pipeline.canClearStage1ProductionLaunchGate ? "clearable" : "preserved"}</strong>
          <small>{pipeline.preservedDoNotLaunchCondition}</small>
        </article>
        <article>
          <span>Release SHA</span>
          <strong>{pipeline.releaseSha.slice(0, 12)}</strong>
          <small>{pipeline.productionWebUrl}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Pipeline Steps</h3>
              <p>Expected exit code 2 is still blocked evidence; it does not clear production launch.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionLaunchSourcePipelineStep>
            rows={pipeline.steps}
            columns={[
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "exit", header: "Exit", render: (row) => `${row.exitCode}${row.expectedExit ? " expected" : " unexpected"}` },
              { key: "summary", header: "Output Summary", render: (row) => row.outputSummary },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Proof Readiness</h3>
              <p>Candidate proof files are checked by path only; secret values are never rendered.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionLaunchSourcePipelineProofReadiness>
            rows={pipeline.proofReadiness}
            columns={[
              { key: "proof", header: "Proof", render: (row) => <span className="mono">{row.proofId}</span> },
              { key: "exists", header: "Exists", render: (row) => <StatusBadge value={statusTone(String(row.exists))} label={yesNo(row.exists)} /> },
              { key: "required", header: "Required", render: (row) => yesNo(row.required) },
              { key: "path", header: "Path", render: (row) => <span className="mono">{row.path}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Blocked Checks</h3>
              <p>{pipeline.strictValidator}</p>
            </div>
          </div>
          <div className="record-list panel-body">
            {pipeline.blockedChecks.map((blocker) => (
              <article className="record-card" key={blocker}>
                <p>{blocker}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}

function ProductionSourceProbeRunbookPanel({ runbook }: { runbook: Stage1ProductionSourceProbeRunbook }) {
  const summary = runbook.summary;
  const firstBlockedStep = runbook.steps.find((step) => step.status !== "pass");
  const actionRows = runbook.operatorNextActions.map((action, index) => ({ index: index + 1, action }));
  const dependencyRows = runbook.steps.map((step) => ({
    step,
    requiredBefore: step.requiredBefore.join(", ") || "none",
    gateIds: step.gateIds.join(", ")
  }));

  return (
    <section
      className="panel"
      data-production-source-probe-runbook="validator-derived"
      data-production-source-probe-runbook-export="ops/evidence/non_clearing/production-source-probe-runbook.json"
      data-production-source-probe-runbook-generator="python3 scripts/generate_stage1_production_source_probe_runbook.py"
      data-production-source-probe-runbook-validator="python3 scripts/validate_stage1_production_source_probe_runbook.py"
      data-production-source-probe-runbook-non-clearing={runbook.nonClearingRunbook ? "true" : "false"}
      data-production-source-probe-runbook-redaction={runbook.valueRedaction}
      data-production-proof-cockpit="source-probe-runbook-derived"
      data-production-proof-cockpit-non-clearing="true"
      data-production-proof-cockpit-source-commands="operator-handoff-only"
      data-production-proof-cockpit-template-refs="variable-names-only"
      data-production-proof-cockpit-strict-validators="validator-derived"
      data-production-proof-cockpit-evidence-policy="production-only"
    >
      <div className="panel-header">
        <div>
          <h3>Production Source Probe Runbook</h3>
          <p>{runbook.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(runbook.releaseGateDecision)} label={`${runbook.status} / ${runbook.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Evidence file</span>
          <strong>{runbook.evidencePresent ? "present" : "missing"}</strong>
          <small>{runbook.schemaVersion}</small>
        </article>
        <article>
          <span>Runbook steps</span>
          <strong>{`${summary.readyToExecuteCount}/${summary.runbookStepCount}`}</strong>
          <small>{`${summary.blockedStepCount} blocked`}</small>
        </article>
        <article>
          <span>Production inputs</span>
          <strong>{`${summary.productionInputsConfigured}/${summary.productionInputsTotal}`}</strong>
          <small>{`${summary.productionInputsCompletionPercent}% configured`}</small>
        </article>
        <article>
          <span>Blocking inputs</span>
          <strong>{summary.blockingInputCount}</strong>
          <small>{`${summary.productionInputsMissing} missing / ${summary.productionInputsInvalid} invalid`}</small>
        </article>
        <article>
          <span>Stage1 gates</span>
          <strong>{`${summary.stage1GatesCompleted}/${summary.stage1GatesTotal}`}</strong>
          <small>{`${summary.stage1CompletionPercent}% complete`}</small>
        </article>
        <article>
          <span>Canonical writes</span>
          <strong>{runbook.pipelineState.canonicalSourcesRequested ? "requested" : "not requested"}</strong>
          <small>{runbook.pipelineState.canonicalSourcesMayBeWritten ? "allowed" : "blocked until real inputs pass"}</small>
        </article>
        <article>
          <span>Aggregate attempted</span>
          <strong>{yesNo(runbook.pipelineState.aggregateAttempted)}</strong>
          <small>{firstBlockedStep?.firstBlocker ?? "all runbook steps passed"}</small>
        </article>
        <article>
          <span>Do-Not-Launch</span>
          <strong>{runbook.canClearStage1ProductionLaunchGate ? "clearable" : "preserved"}</strong>
          <small>{runbook.canCloseDoNotLaunch ? "DNL closeable" : "DNL remains open"}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Production Proof Collection Cockpit</h3>
              <p>One operator matrix for the four production source probes; no production writes run from Admin.</p>
            </div>
            <StatusBadge value={summary.readyToExecuteCount === summary.runbookStepCount ? "pass" : "blocked"} label={`${summary.readyToExecuteCount}/${summary.runbookStepCount} executable`} />
          </div>

          <div className="dependency-summary">
            <article>
              <span>Source probes</span>
              <strong>{runbook.steps.length}</strong>
              <small>{runbook.steps.map((step) => step.probeId).join(", ")}</small>
            </article>
            <article>
              <span>Ready now</span>
              <strong>{summary.readyToExecuteCount}</strong>
              <small>{firstBlockedStep?.operatorNextAction ?? "all source probes are executable"}</small>
            </article>
            <article>
              <span>Canonical sources</span>
              <strong>{runbook.pipelineState.canonicalSourcesMayBeWritten ? "allowed" : "blocked"}</strong>
              <small>{runbook.pipelineState.canonicalSourcesRequested ? "writes requested" : "writes not requested"}</small>
            </article>
            <article>
              <span>Missing/invalid</span>
              <strong>{summary.blockingInputCount}</strong>
              <small>{`${summary.productionInputsMissing} missing / ${summary.productionInputsInvalid} invalid`}</small>
            </article>
            <article>
              <span>Redaction</span>
              <strong>{runbook.valueRedaction}</strong>
              <small>variable names only</small>
            </article>
            <article>
              <span>Launch gate</span>
              <strong>{runbook.releaseGateDecision}</strong>
              <small>{runbook.canClearStage1ProductionLaunchGate ? "clearable" : "preserved no-go"}</small>
            </article>
          </div>
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Cockpit Source Commands</h3>
              <p>Run these only after the matching real production inputs exist; command text is non-clearing handoff.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionSourceProbeRunbookStep>
            rows={runbook.steps}
            columns={[
              { key: "order", header: "#", render: (row) => row.order },
              { key: "probe", header: "Probe", render: (row) => <span className="mono">{row.probeId}</span> },
              { key: "ready", header: "Ready", render: (row) => yesNo(row.readyToExecute) },
              { key: "command", header: "Source Probe Command", render: (row) => <span className="mono">{row.sourceProbeCommand}</span> },
              { key: "source", header: "Canonical Source", render: (row) => <span className="mono">{row.sourceOutputPath}</span> },
              { key: "diagnostic", header: "Diagnostic", render: (row) => <span className="mono">{row.diagnosticPath}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Cockpit Templates And Dependencies</h3>
              <p>Template paths and prerequisite step IDs only; production proof values stay outside the repo.</p>
            </div>
          </div>
          <DataTable<{ step: Stage1ProductionSourceProbeRunbookStep; requiredBefore: string; gateIds: string }>
            rows={dependencyRows}
            columns={[
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.step.stepId}</span> },
              { key: "gates", header: "Gate IDs", render: (row) => <span className="mono">{row.gateIds}</span> },
              { key: "before", header: "Required Before", render: (row) => <span className="mono">{row.requiredBefore}</span> },
              { key: "source-template", header: "Source Template", render: (row) => <span className="mono">{row.step.sourceTemplateRef ?? "none"}</span> },
              { key: "proof-template", header: "Proof Template", render: (row) => <span className="mono">{row.step.proofTemplateRef ?? "none"}</span> },
              { key: "packet", header: "Operator Packet", render: (row) => <span className="mono">{row.step.operatorPacketRef}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Cockpit Strict Evidence Commands</h3>
              <p>After a source probe writes canonical source JSON, run the generator and strict validator in this row.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionSourceProbeRunbookStep>
            rows={runbook.steps}
            columns={[
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "generator", header: "Evidence Generator", render: (row) => <span className="mono">{row.evidenceGenerator}</span> },
              { key: "validator", header: "Strict Validator", render: (row) => <span className="mono">{row.strictValidator}</span> },
              { key: "blocker", header: "First Blocker", render: (row) => row.firstBlocker },
              { key: "next", header: "Next Action", render: (row) => row.operatorNextAction }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Cockpit Production Evidence Policy</h3>
              <p>Only production source evidence can unblock these probes; existing sandbox, staging, local, and template evidence is rejected.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionSourceProbeRunbookStep>
            rows={runbook.steps}
            columns={[
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              {
                key: "sources",
                header: "Acceptable Evidence Sources",
                render: (row) => <span className="mono">{row.acceptableEvidenceSources.join(" | ")}</span>
              },
              {
                key: "sandbox-staging",
                header: "Existing Sandbox/Staging",
                render: (row) => (row.canBeSatisfiedByExistingSandboxOrStagingResources ? "allowed" : "rejected")
              },
              {
                key: "rejected",
                header: "Rejected Substitutes",
                render: (row) => <span className="mono">{row.disallowedSubstitutes.slice(0, 6).join(" | ")}</span>
              }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Ordered Source Probe Steps</h3>
              <p>Commands are operator handoff text only; Admin never executes production writes.</p>
            </div>
            <StatusBadge value={summary.blockedStepCount === 0 ? "pass" : "blocked"} label={`${summary.blockedStepCount} blocked`} />
          </div>
          <DataTable<Stage1ProductionSourceProbeRunbookStep>
            rows={runbook.steps}
            columns={[
              { key: "order", header: "#", render: (row) => row.order },
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "inputs", header: "Inputs", render: (row) => `${row.requiredConfigured}/${row.requiredTotal}` },
              { key: "blocking", header: "Blocking", render: (row) => row.blockingInputCount },
              { key: "completion", header: "Completion", render: (row) => `${row.completionPercent}%` },
              { key: "source", header: "Source Output", render: (row) => <span className="mono">{row.sourceOutputPath}</span> },
              { key: "validator", header: "Strict Validator", render: (row) => <span className="mono">{row.strictValidator}</span> },
              { key: "packet", header: "Operator Packet", render: (row) => <span className="mono">{row.operatorPacketRef}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Runbook Blockers</h3>
              <p>Variable names only; no secret or raw production payload values are rendered.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionSourceProbeRunbookStep>
            rows={runbook.steps}
            columns={[
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "first", header: "First Blocker", render: (row) => row.firstBlocker },
              { key: "missing", header: "Missing/Invalid Inputs", render: (row) => <span className="mono">{row.missingOrInvalidInputs.slice(0, 4).join(" | ")}</span> },
              { key: "diagnostic", header: "Diagnostic", render: (row) => <span className="mono">{row.diagnosticPath}</span> },
              { key: "next", header: "Next Action", render: (row) => row.operatorNextAction }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Runbook Source Refs</h3>
              <p>Every ref remains non-clearing until strict production evidence passes.</p>
            </div>
          </div>
          <DataTable<{ ref: string; path: string }>
            rows={Object.entries(runbook.sourceRefs).map(([ref, path]) => ({ ref, path }))}
            columns={[
              { key: "ref", header: "Ref", render: (row) => <span className="mono">{row.ref}</span> },
              { key: "path", header: "Path", render: (row) => <span className="mono">{row.path}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Runbook Next Actions</h3>
              <p>{runbook.valueRedaction}</p>
            </div>
          </div>
          <DataTable<{ index: number; action: string }>
            rows={actionRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "action", header: "Action", render: (row) => row.action }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionOperatorPacketsPanel({ packets }: { packets: Stage1ProductionOperatorPacket[] }) {
  const billingPacket = packets.find((packet) => packet.packetId === "billing");
  const securityPacket = packets.find((packet) => packet.packetId === "security");
  const legalSupportPacket = packets.find((packet) => packet.packetId === "legal_support");
  const governancePacket = packets.find((packet) => packet.packetId === "governance");
  const billingEnvRows = Object.entries(billingPacket?.billingEnvClassification ?? {}).map(([key, value]) => ({ key, value }));
  const billingAuditRefs = (billingPacket?.billingAuditRefs ?? []).map((ref, index) => ({ index: index + 1, ref }));
  const billingExecutionOrder = (billingPacket?.billingExecutionOrder ?? []).map((command, index) => ({
    index: index + 1,
    command
  }));
  const billingPrivateEnvTemplateRows = (billingPacket?.billingPrivateEnvTemplate.templateLines ?? []).map((line, index) => ({
    index: index + 1,
    line
  }));
  const billingOperatorCommandRows = (billingPacket?.billingOperatorCommandPacket ?? []).map((row, index) => ({
    index: index + 1,
    ...row
  }));
  const securityExecutionOrder = (securityPacket?.securityExecutionOrder ?? []).map((command, index) => ({
    index: index + 1,
    command
  }));
  const securityPrivateEnvTemplateRows = (securityPacket?.securityPrivateEnvTemplate.templateLines ?? []).map((line, index) => ({
    index: index + 1,
    line
  }));
  const securityOperatorCommandRows = (securityPacket?.securityOperatorCommandPacket ?? []).map((row, index) => ({
    index: index + 1,
    ...row
  }));
  const legalOperatorNextActions = (legalSupportPacket?.legalOperatorNextActions ?? []).map((action, index) => ({
    index: index + 1,
    action
  }));
  const legalExecutionOrder = (legalSupportPacket?.legalExecutionOrder ?? []).map((command, index) => ({
    index: index + 1,
    command
  }));
  const legalOperatorCommandRows = (legalSupportPacket?.legalOperatorCommandPacket ?? []).map((row, index) => ({
    index: index + 1,
    ...row
  }));
  const governanceExecutionOrder = (governancePacket?.governanceExecutionOrder ?? []).map((command, index) => ({
    index: index + 1,
    command
  }));
  const governancePrivateEnvTemplateRows = (governancePacket?.governancePrivateEnvTemplate.templateLines ?? []).map((line, index) => ({
    index: index + 1,
    line
  }));
  const governanceOperatorCommandRows = (governancePacket?.governanceOperatorCommandPacket ?? []).map((row, index) => ({
    index: index + 1,
    ...row
  }));
  const evidenceOutputs = packets.flatMap((packet) =>
    Object.entries(packet.evidenceOutputs).map(([outputId, path]) => ({
      packetId: packet.packetId,
      outputId,
      path
    }))
  );
  const blockedUntil = packets.flatMap((packet) =>
    packet.blockedUntil.map((blocker, index) => ({
      packetId: packet.packetId,
      index: index + 1,
      blocker
    }))
  );
  const requirementGroups = packets.flatMap((packet) =>
    packet.requirementGroups.map((group) => ({
      packetId: packet.packetId,
      ...group
    }))
  );
  const openPackets = packets.filter((packet) => packet.status !== "pass" || packet.releaseGateDecision !== "go").length;

  return (
    <section
      className="panel"
      data-production-operator-packets="validator-derived"
      data-production-operator-packets-non-clearing="true"
      data-production-billing-operator-packet="ops/evidence/non_clearing/production-billing-operator-packet.json"
      data-production-security-operator-packet="ops/evidence/non_clearing/production-security-operator-packet.json"
      data-production-legal-support-operator-packet="ops/evidence/non_clearing/production-legal-support-operator-packet.json"
      data-production-governance-operator-packet="ops/evidence/non_clearing/production-governance-operator-packet.json"
      data-production-billing-live-artifacts="variable-names-only"
      data-production-billing-execution-order="non-clearing"
      data-production-security-runtime-refs="variable-names-only"
      data-production-security-execution-order="non-clearing"
      data-production-security-private-env-template="blank-values-only"
      data-production-security-operator-command-packet="review-gated-source-write"
      data-production-legal-support-dns-requirements="variable-names-only"
      data-production-legal-support-public-paths="public-path-tokens-only"
      data-production-legal-support-https-probes="redacted-errors-only"
      data-production-legal-support-execution-order="non-clearing"
      data-production-legal-support-operator-command-packet="review-gated-dns-and-source-write"
      data-production-governance-components="variable-names-only"
      data-production-governance-section-refs="variable-names-only"
      data-production-governance-required-ids="variable-names-only"
      data-production-governance-execution-order="non-clearing"
      data-production-governance-private-env-template="blank-values-only"
      data-production-governance-operator-command-packet="review-gated-source-write"
    >
      <div className="panel-header">
        <div>
          <h3>Production Operator Packets</h3>
          <p>Non-clearing handoff packets for the final production blockers.</p>
        </div>
        <StatusBadge value={openPackets === 0 ? "pass" : "blocked"} label={`${packets.length - openPackets}/${packets.length} packets clear`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Packet files</span>
          <strong>{`${packets.filter((packet) => packet.evidencePresent).length}/${packets.length}`}</strong>
          <small>billing, security, legal/support, governance</small>
        </article>
        <article>
          <span>Open packets</span>
          <strong>{openPackets}</strong>
          <small>{packets.find((packet) => packet.status !== "pass")?.proof.firstBlocker ?? "none"}</small>
        </article>
        <article>
          <span>Canonical sources</span>
          <strong>{`${packets.filter((packet) => packet.sourceProbe.canonicalSourceExists).length}/${packets.length}`}</strong>
          <small>must be real production source probes before canonical evidence can clear</small>
        </article>
        <article>
          <span>Blocked until</span>
          <strong>{blockedUntil.length}</strong>
          <small>{blockedUntil[0]?.blocker ?? "none"}</small>
        </article>
        <article>
          <span>Billing live artifacts</span>
          <strong>{billingPacket?.billingLiveArtifacts.length ?? 0}</strong>
          <small>{billingPacket?.proof.firstBlocker ?? "billing packet missing"}</small>
        </article>
        <article>
          <span>Security runtime refs</span>
          <strong>{securityPacket?.securityRuntimeRefs.length ?? 0}</strong>
          <small>{securityPacket?.proof.firstBlocker ?? "security packet missing"}</small>
        </article>
        <article>
          <span>Legal public paths</span>
          <strong>{legalSupportPacket?.legalPublicPaths.length ?? 0}</strong>
          <small>{legalSupportPacket?.proof.firstBlocker ?? "legal/support packet missing"}</small>
        </article>
        <article>
          <span>Governance refs</span>
          <strong>{governancePacket?.governanceSectionRefs.length ?? 0}</strong>
          <small>{governancePacket?.proof.firstBlocker ?? "governance packet missing"}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Billing Live Proof Inputs</h3>
              <p>Stripe production proof requirements are rendered as IDs, flags, and refs only.</p>
            </div>
            <StatusBadge
              value={statusTone(billingPacket?.releaseGateDecision ?? "no_go")}
              label={`${billingPacket?.status ?? "missing"} / ${billingPacket?.releaseGateDecision ?? "no_go"}`}
            />
          </div>

          <div className="dependency-summary">
            <article>
              <span>Local Stripe mode</span>
              <strong>{billingPacket?.billingEnvClassification.stripe_mode ?? "missing"}</strong>
              <small>{`secret ${billingPacket?.billingEnvClassification.secret_key_class ?? "missing"}`}</small>
            </article>
            <article>
              <span>Live artifacts</span>
              <strong>{billingPacket?.billingLiveArtifacts.length ?? 0}</strong>
              <small>checkout, subscription, invoice, refund, quota reset</small>
            </article>
            <article>
              <span>Numeric controls</span>
              <strong>{billingPacket?.billingNumericControls.length ?? 0}</strong>
              <small>seat sync and webhook mutation counts</small>
            </article>
            <article>
              <span>Webhook controls</span>
              <strong>{billingPacket?.billingWebhookControls.length ?? 0}</strong>
              <small>event IDs and replay idempotency</small>
            </article>
            <article>
              <span>Audit refs</span>
              <strong>{billingPacket?.billingAuditRefs.length ?? 0}</strong>
              <small>operator/runtime refs, no raw Stripe payloads</small>
            </article>
            <article>
              <span>Execution order</span>
              <strong>{billingPacket?.billingExecutionOrder.length ?? 0}</strong>
              <small>proof, source probe, strict evidence, launch validator</small>
            </article>
            <article>
              <span>Private env</span>
              <strong>{billingPacket?.billingPrivateEnvTemplate.pathPlaceholder ?? "missing"}</strong>
              <small>{billingPacket?.billingPrivateEnvTemplate.gitignoreRequired ? "gitignored copy required" : "gitignore not declared"}</small>
            </article>
            <article>
              <span>Canonical writes</span>
              <strong>{billingPacket?.billingOperatorCommandPacket.filter((row) => row.mayWriteCanonicalSource).length ?? 0}</strong>
              <small>{billingPacket?.billingOperatorCommandPacket.find((row) => row.mayWriteCanonicalSource)?.requiresReview ? "review required" : "blocked until proof passes"}</small>
            </article>
          </div>
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Billing Env Classification</h3>
              <p>Key classes only; secret values are never rendered.</p>
            </div>
          </div>
          <DataTable<{ key: string; value: string }>
            rows={billingEnvRows}
            columns={[
              { key: "key", header: "Field", render: (row) => <span className="mono">{row.key}</span> },
              { key: "value", header: "Class", render: (row) => <span className="mono">{row.value}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Billing Webhook Controls</h3>
              <p>Replay and duplicate mutation rules for live Stripe webhooks.</p>
            </div>
          </div>
          <DataTable<{ controlId: string; rule: string }>
            rows={billingPacket?.billingWebhookControls ?? []}
            columns={[
              { key: "control", header: "Control", render: (row) => <span className="mono">{row.controlId}</span> },
              { key: "rule", header: "Rule", render: (row) => row.rule }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Required Live Stripe Artifacts</h3>
              <p>Live object IDs required by the proof helper; test/sandbox IDs remain invalid.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof billingPacket>["billingLiveArtifacts"][number]>
            rows={billingPacket?.billingLiveArtifacts ?? []}
            columns={[
              { key: "name", header: "Name", render: (row) => <span className="mono">{row.name}</span> },
              { key: "flag", header: "CLI Flag", render: (row) => <span className="mono">{row.flag}</span> },
              { key: "prefix", header: "Required Prefix", render: (row) => <span className="mono">{row.prefix}</span> },
              { key: "section", header: "Section", render: (row) => <span className="mono">{row.section}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Billing Numeric Controls</h3>
              <p>Counts that must match live lifecycle and idempotency evidence.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof billingPacket>["billingNumericControls"][number]>
            rows={billingPacket?.billingNumericControls ?? []}
            columns={[
              { key: "name", header: "Name", render: (row) => <span className="mono">{row.name}</span> },
              { key: "flag", header: "CLI Flag", render: (row) => <span className="mono">{row.flag}</span> },
              { key: "rule", header: "Rule", render: (row) => row.rule }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Billing Audit Refs</h3>
              <p>Refs bind production events to sanitized runtime or audit evidence.</p>
            </div>
          </div>
          <DataTable<{ index: number; ref: string }>
            rows={billingAuditRefs}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "ref", header: "Ref Flag", render: (row) => <span className="mono">{row.ref}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Billing Execution Order</h3>
              <p>Commands stay blocked until live Stripe proof IDs and refs are available.</p>
            </div>
          </div>
          <DataTable<{ index: number; command: string }>
            rows={billingExecutionOrder}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Billing Private Env Template</h3>
              <p>Blank assignments only; fill a gitignored copy outside evidence.</p>
            </div>
          </div>
          <DataTable<{ index: number; line: string }>
            rows={billingPrivateEnvTemplateRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "line", header: "Blank Line", render: (row) => <span className="mono">{row.line}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Billing Operator Command Packet</h3>
              <p>Copy-safe sequence using the private env placeholder.</p>
            </div>
          </div>
          <DataTable<(typeof billingOperatorCommandRows)[number]>
            rows={billingOperatorCommandRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> },
              { key: "source", header: "Canonical Write", render: (row) => yesNo(row.mayWriteCanonicalSource) },
              { key: "review", header: "Review", render: (row) => yesNo(row.requiresReview) },
              { key: "side-effect", header: "Side Effect", render: (row) => row.sideEffect }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Security Runtime Proof Inputs</h3>
              <p>Production security proof requirements are rendered as section refs and assertions only.</p>
            </div>
            <StatusBadge
              value={statusTone(securityPacket?.releaseGateDecision ?? "no_go")}
              label={`${securityPacket?.status ?? "missing"} / ${securityPacket?.releaseGateDecision ?? "no_go"}`}
            />
          </div>

          <div className="dependency-summary">
            <article>
              <span>Runtime refs</span>
              <strong>{securityPacket?.securityRuntimeRefs.length ?? 0}</strong>
              <small>session, CSRF, redaction, provider, Stripe, rate, CSP, RBAC, audit</small>
            </article>
            <article>
              <span>Proof diagnostic</span>
              <strong>{securityPacket?.proof.blockedDiagnosticStatus ?? "missing"}</strong>
              <small>{securityPacket?.proof.firstBlocker ?? "security proof missing"}</small>
            </article>
            <article>
              <span>Canonical source</span>
              <strong>{securityPacket?.sourceProbe.canonicalSourceExists ? "present" : "missing"}</strong>
              <small>{securityPacket?.sourceProbe.canonicalSourcePath ?? "missing"}</small>
            </article>
            <article>
              <span>Private env</span>
              <strong>{securityPacket?.securityPrivateEnvTemplate.pathPlaceholder ?? "missing"}</strong>
              <small>{securityPacket?.securityPrivateEnvTemplate.templateLines.length ?? 0} blank lines</small>
            </article>
            <article>
              <span>Canonical writes</span>
              <strong>{securityPacket?.securityOperatorCommandPacket.filter((row) => row.mayWriteCanonicalSource).length ?? 0}</strong>
              <small>{securityPacket?.securityOperatorCommandPacket.find((row) => row.mayWriteCanonicalSource)?.requiresReview ? "review required" : "blocked until proof passes"}</small>
            </article>
            <article>
              <span>Execution order</span>
              <strong>{securityPacket?.securityExecutionOrder.length ?? 0}</strong>
              <small>proof, source probe, strict evidence, launch validator</small>
            </article>
          </div>
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Required Security Runtime Refs</h3>
              <p>Each row maps one proof helper flag to the sanitized production assertion it must prove.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof securityPacket>["securityRuntimeRefs"][number]>
            rows={securityPacket?.securityRuntimeRefs ?? []}
            columns={[
              { key: "section", header: "Section", render: (row) => <span className="mono">{row.section}</span> },
              { key: "flag", header: "CLI Flag", render: (row) => <span className="mono">{row.flag}</span> },
              { key: "assertions", header: "Required Assertions", render: (row) => <span className="mono">{row.requiredRuntimeAssertions}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Security Execution Order</h3>
              <p>Commands stay blocked until production runtime refs are available.</p>
            </div>
          </div>
          <DataTable<{ index: number; command: string }>
            rows={securityExecutionOrder}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Security Private Env Template</h3>
              <p>Blank assignments only; fill a gitignored copy outside evidence.</p>
            </div>
          </div>
          <DataTable<{ index: number; line: string }>
            rows={securityPrivateEnvTemplateRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "line", header: "Blank Line", render: (row) => <span className="mono">{row.line}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Security Operator Command Packet</h3>
              <p>Copy-safe sequence using the private env placeholder.</p>
            </div>
          </div>
          <DataTable<(typeof securityOperatorCommandRows)[number]>
            rows={securityOperatorCommandRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> },
              { key: "source", header: "Canonical Write", render: (row) => yesNo(row.mayWriteCanonicalSource) },
              { key: "review", header: "Review", render: (row) => yesNo(row.requiresReview) },
              { key: "side-effect", header: "Side Effect", render: (row) => row.sideEffect }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Legal Support Production Proof Inputs</h3>
              <p>Production legal and support proof requirements are rendered as public paths, DNS facts, and commands only.</p>
            </div>
            <StatusBadge
              value={statusTone(legalSupportPacket?.releaseGateDecision ?? "no_go")}
              label={`${legalSupportPacket?.status ?? "missing"} / ${legalSupportPacket?.releaseGateDecision ?? "no_go"}`}
            />
          </div>

          <div className="dependency-summary">
            <article>
              <span>DNS requirements</span>
              <strong>{legalSupportPacket?.legalDnsRequirements.length ?? 0}</strong>
              <small>apex host, public DNS, TLS, HTTP status, disallowed inputs</small>
            </article>
            <article>
              <span>Public paths</span>
              <strong>{legalSupportPacket?.legalPublicPaths.length ?? 0}</strong>
              <small>terms, privacy, acceptable use, support, billing policy</small>
            </article>
            <article>
              <span>HTTPS probes</span>
              <strong>{legalSupportPacket?.legalHttpsProbes.filter((row) => row.status === "pass").length ?? 0}/{legalSupportPacket?.legalHttpsProbes.length ?? 0}</strong>
              <small>{legalSupportPacket?.legalHttpsProbes.find((row) => row.status !== "pass")?.errorSummary ?? "all public paths passing"}</small>
            </article>
            <article>
              <span>Source diagnostic</span>
              <strong>{legalSupportPacket?.sourceProbe.diagnosticStatus ?? "missing"}</strong>
              <small>{legalSupportPacket?.sourceProbe.firstBlocker ?? "legal/support source probe missing"}</small>
            </article>
            <article>
              <span>Next actions</span>
              <strong>{legalSupportPacket?.legalOperatorNextActions.length ?? 0}</strong>
              <small>{legalSupportPacket?.legalOperatorNextActions[0] ?? "legal/support packet missing"}</small>
            </article>
            <article>
              <span>Execution order</span>
              <strong>{legalSupportPacket?.legalExecutionOrder.length ?? 0}</strong>
              <small>DNS, HTTPS source probe, strict evidence, launch validator</small>
            </article>
            <article>
              <span>DNS apply commands</span>
              <strong>{legalSupportPacket?.legalOperatorCommandPacket.filter((row) => row.mayApplyProductionDns).length ?? 0}</strong>
              <small>{legalSupportPacket?.legalOperatorCommandPacket.find((row) => row.mayApplyProductionDns)?.requiresReview ? "review required" : "no DNS apply command"}</small>
            </article>
            <article>
              <span>Canonical writes</span>
              <strong>{legalSupportPacket?.legalOperatorCommandPacket.filter((row) => row.mayWriteCanonicalSource).length ?? 0}</strong>
              <small>{legalSupportPacket?.legalOperatorCommandPacket.find((row) => row.mayWriteCanonicalSource)?.requiresReview ? "review required" : "blocked until HTTPS passes"}</small>
            </article>
          </div>
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Legal DNS HTTPS Requirements</h3>
              <p>Production gate accepts only public zenari.ai HTTPS; staging, localhost, and IP-only URLs stay blocked.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof legalSupportPacket>["legalDnsRequirements"][number]>
            rows={legalSupportPacket?.legalDnsRequirements ?? []}
            columns={[
              { key: "field", header: "Field", render: (row) => <span className="mono">{row.field}</span> },
              { key: "value", header: "Required Value", render: (row) => <span className="mono">{row.value}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Legal HTTPS Probe Status</h3>
              <p>Current production HTTPS path probe status; errors are summarized and credential-free.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof legalSupportPacket>["legalHttpsProbes"][number]>
            rows={legalSupportPacket?.legalHttpsProbes ?? []}
            columns={[
              { key: "path", header: "Path", render: (row) => <span className="mono">{row.path}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "http", header: "HTTP", render: (row) => <span className="mono">{row.httpStatus}</span> },
              { key: "error", header: "Error Summary", render: (row) => row.errorSummary }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Required Legal Support Public Paths</h3>
              <p>Each path must be public GET 200 and contain the listed policy/support tokens for an external user.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof legalSupportPacket>["legalPublicPaths"][number]>
            rows={legalSupportPacket?.legalPublicPaths ?? []}
            columns={[
              { key: "page", header: "Page", render: (row) => <span className="mono">{row.pageId}</span> },
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.group}</span> },
              { key: "method", header: "Method", render: (row) => <span className="mono">{row.method}</span> },
              { key: "path", header: "Path", render: (row) => <span className="mono">{row.path}</span> },
              { key: "status", header: "Expected", render: (row) => row.expectedHttpStatus },
              { key: "public", header: "Public", render: (row) => yesNo(row.externalUserVisible && !row.adminSessionRequired) },
              { key: "tokens", header: "Required Tokens", render: (row) => <span className="mono">{row.requiredTokens.join(", ")}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Legal Next Actions</h3>
              <p>Operator actions stay non-clearing until public production HTTPS probes pass.</p>
            </div>
          </div>
          <DataTable<{ index: number; action: string }>
            rows={legalOperatorNextActions}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "action", header: "Action", render: (row) => row.action }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Legal Execution Order</h3>
              <p>Commands remain blocked until zenari.ai DNS and public HTTPS are production reachable.</p>
            </div>
          </div>
          <DataTable<{ index: number; command: string }>
            rows={legalExecutionOrder}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Legal Operator Command Packet</h3>
              <p>DNS apply and canonical source write rows are review-gated and use only placeholders.</p>
            </div>
          </div>
          <DataTable<(typeof legalOperatorCommandRows)[number]>
            rows={legalOperatorCommandRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> },
              { key: "dns", header: "DNS Apply", render: (row) => yesNo(row.mayApplyProductionDns) },
              { key: "source", header: "Canonical Write", render: (row) => yesNo(row.mayWriteCanonicalSource) },
              { key: "review", header: "Review", render: (row) => yesNo(row.requiresReview) },
              { key: "side-effect", header: "Side Effect", render: (row) => row.sideEffect }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Governance Production Proof Inputs</h3>
              <p>Activation, abuse, and skill release governance requirements are rendered as flags and refs only.</p>
            </div>
            <StatusBadge
              value={statusTone(governancePacket?.releaseGateDecision ?? "no_go")}
              label={`${governancePacket?.status ?? "missing"} / ${governancePacket?.releaseGateDecision ?? "no_go"}`}
            />
          </div>

          <div className="dependency-summary">
            <article>
              <span>Components</span>
              <strong>{governancePacket?.governanceComponents.length ?? 0}</strong>
              <small>activation, abuse, skill release</small>
            </article>
            <article>
              <span>Section refs</span>
              <strong>{governancePacket?.governanceSectionRefs.length ?? 0}</strong>
              <small>RBAC, review, audit, gates, holds, limits, canary, rollback</small>
            </article>
            <article>
              <span>Required IDs</span>
              <strong>{governancePacket?.governanceRequiredIds.length ?? 0}</strong>
              <small>skill owner, suite, rollback, notes, canary sample</small>
            </article>
            <article>
              <span>Proof diagnostic</span>
              <strong>{governancePacket?.proof.blockedDiagnosticStatus ?? "missing"}</strong>
              <small>{governancePacket?.proof.firstBlocker ?? "governance proof missing"}</small>
            </article>
            <article>
              <span>Canonical source</span>
              <strong>{governancePacket?.sourceProbe.canonicalSourceExists ? "present" : "missing"}</strong>
              <small>{governancePacket?.sourceProbe.canonicalSourcePath ?? "missing"}</small>
            </article>
            <article>
              <span>Private env</span>
              <strong>{governancePacket?.governancePrivateEnvTemplate.pathPlaceholder ?? "missing"}</strong>
              <small>{governancePacket?.governancePrivateEnvTemplate.templateLines.length ?? 0} blank lines</small>
            </article>
            <article>
              <span>Canonical writes</span>
              <strong>{governancePacket?.governanceOperatorCommandPacket.filter((row) => row.mayWriteCanonicalSource).length ?? 0}</strong>
              <small>{governancePacket?.governanceOperatorCommandPacket.find((row) => row.mayWriteCanonicalSource)?.requiresReview ? "review required" : "blocked until proof passes"}</small>
            </article>
            <article>
              <span>Execution order</span>
              <strong>{governancePacket?.governanceExecutionOrder.length ?? 0}</strong>
              <small>proof, source probe, strict evidence, launch validator</small>
            </article>
          </div>
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Governance Components</h3>
              <p>Each component maps runtime request IDs, immutable audit refs, and release gate checks.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof governancePacket>["governanceComponents"][number]>
            rows={governancePacket?.governanceComponents ?? []}
            columns={[
              { key: "component", header: "Component", render: (row) => <span className="mono">{row.component}</span> },
              { key: "gate", header: "Gate Check", render: (row) => <span className="mono">{row.releaseGateCheckId}</span> },
              { key: "runtime", header: "Runtime Flag", render: (row) => <span className="mono">{row.runtimeFlag}</span> },
              { key: "audit", header: "Audit Flag", render: (row) => <span className="mono">{row.auditFlag}</span> },
              { key: "sections", header: "Section Refs", render: (row) => row.sectionRefCount },
              { key: "ids", header: "Required IDs", render: (row) => row.requiredIdCount }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Governance Section Refs</h3>
              <p>Production refs must prove the required assertion shape without raw payload or credential material.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof governancePacket>["governanceSectionRefs"][number]>
            rows={governancePacket?.governanceSectionRefs ?? []}
            columns={[
              { key: "component", header: "Component", render: (row) => <span className="mono">{row.component}</span> },
              { key: "section", header: "Section", render: (row) => <span className="mono">{row.section}</span> },
              { key: "flag", header: "CLI Flag", render: (row) => <span className="mono">{row.flag}</span> },
              { key: "assertions", header: "Required Assertions", render: (row) => <span className="mono">{row.requiredAssertions}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Governance Required IDs</h3>
              <p>Skill release identity and canary controls required by the governance proof helper.</p>
            </div>
          </div>
          <DataTable<NonNullable<typeof governancePacket>["governanceRequiredIds"][number]>
            rows={governancePacket?.governanceRequiredIds ?? []}
            columns={[
              { key: "component", header: "Component", render: (row) => <span className="mono">{row.component}</span> },
              { key: "field", header: "Field", render: (row) => <span className="mono">{row.field}</span> },
              { key: "flag", header: "CLI Flag", render: (row) => <span className="mono">{row.flag}</span> },
              { key: "rule", header: "Rule", render: (row) => row.rule }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Governance Execution Order</h3>
              <p>Commands stay blocked until production governance refs and IDs are available.</p>
            </div>
          </div>
          <DataTable<{ index: number; command: string }>
            rows={governanceExecutionOrder}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Governance Private Env Template</h3>
              <p>Blank assignments only; fill a gitignored copy outside evidence.</p>
            </div>
          </div>
          <DataTable<{ index: number; line: string }>
            rows={governancePrivateEnvTemplateRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "line", header: "Blank Line", render: (row) => <span className="mono">{row.line}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Governance Operator Command Packet</h3>
              <p>Copy-safe sequence using the private env placeholder.</p>
            </div>
          </div>
          <DataTable<(typeof governanceOperatorCommandRows)[number]>
            rows={governanceOperatorCommandRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> },
              { key: "source", header: "Canonical Write", render: (row) => yesNo(row.mayWriteCanonicalSource) },
              { key: "review", header: "Review", render: (row) => yesNo(row.requiresReview) },
              { key: "side-effect", header: "Side Effect", render: (row) => row.sideEffect }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Packet Summary</h3>
              <p>These rows point to operator-owned proof work; the admin page does not execute writes.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionOperatorPacket>
            rows={packets}
            columns={[
              { key: "packet", header: "Packet", render: (row) => <span className="mono">{row.packetId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.releaseGateDecision)} label={`${row.status} / ${row.releaseGateDecision}`} /> },
              { key: "gate", header: "Gate Check", render: (row) => <span className="mono">{row.releaseGateCheckId}</span> },
              { key: "source", header: "Canonical Source", render: (row) => <span className="mono">{row.sourceProbe.canonicalSourcePath}</span> },
              { key: "exists", header: "Source Exists", render: (row) => yesNo(row.sourceProbe.canonicalSourceExists) },
              { key: "first", header: "First Blocker", render: (row) => row.proof.firstBlocker || row.sourceProbe.firstBlocker },
              { key: "candidate", header: "Proof Candidate", render: (row) => <span className="mono">{row.proof.candidatePath}</span> },
              { key: "blocked", header: "Blocked Until", render: (row) => row.blockedUntil.length },
              { key: "outputs", header: "Evidence Outputs", render: (row) => Object.keys(row.evidenceOutputs).length },
              { key: "non-clearing", header: "Non-Clearing", render: (row) => yesNo(row.nonClearingOperatorPacket) }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Source Probe Commands</h3>
              <p>Commands are visible as handoff text only; canonical writes remain gated on real production proof.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionOperatorPacket>
            rows={packets}
            columns={[
              { key: "packet", header: "Packet", render: (row) => <span className="mono">{row.packetId}</span> },
              { key: "diagnostic", header: "Diagnostic", render: (row) => <span className="mono">{row.sourceProbe.diagnosticPath}</span> },
              { key: "diagnostic-status", header: "Diagnostic Status", render: (row) => <StatusBadge value={statusTone(row.sourceProbe.diagnosticStatus)} label={row.sourceProbe.diagnosticStatus} /> },
              { key: "command", header: "Source Probe Command", render: (row) => <span className="mono">{row.sourceProbe.sourceProbeCommand}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Requirement Groups</h3>
              <p>Counts and variable names only; no secret or raw production payload values are rendered.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionOperatorPacketRequirementGroup & { packetId: Stage1ProductionOperatorPacket["packetId"] }>
            rows={requirementGroups}
            columns={[
              { key: "packet", header: "Packet", render: (row) => <span className="mono">{row.packetId}</span> },
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.groupId}</span> },
              { key: "count", header: "Count", render: (row) => row.count },
              { key: "summary", header: "Summary", render: (row) => row.summary }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Blocked Until</h3>
              <p>Every item must be satisfied by strict production evidence before the launch gate can clear.</p>
            </div>
          </div>
          <DataTable<{ packetId: Stage1ProductionOperatorPacket["packetId"]; index: number; blocker: string }>
            rows={blockedUntil}
            columns={[
              { key: "packet", header: "Packet", render: (row) => <span className="mono">{row.packetId}</span> },
              { key: "index", header: "#", render: (row) => row.index },
              { key: "blocker", header: "Blocked Until", render: (row) => row.blocker }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Evidence Outputs</h3>
              <p>Operator packet output paths are non-clearing until their strict validators pass.</p>
            </div>
          </div>
          <DataTable<{ packetId: Stage1ProductionOperatorPacket["packetId"]; outputId: string; path: string }>
            rows={evidenceOutputs}
            columns={[
              { key: "packet", header: "Packet", render: (row) => <span className="mono">{row.packetId}</span> },
              { key: "output", header: "Output", render: (row) => <span className="mono">{row.outputId}</span> },
              { key: "path", header: "Path", render: (row) => <span className="mono">{row.path}</span> }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionBlockerChecklistPanel({ checklist }: { checklist: Stage1ProductionBlockerChecklist }) {
  const sectionRows = checklist.sections.map((section) => ({
    ...section,
    anchor: section.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
  }));
  const firstBlockingRows = checklist.firstBlockingRows.map((row, index) => ({ index: index + 1, row }));

  return (
    <section
      className="panel"
      data-production-blocker-checklist="validator-derived"
      data-production-blocker-checklist-export="ops/evidence/non_clearing/production-blocker-checklist.md"
      data-production-blocker-checklist-generator={checklist.generatorCommand}
      data-production-blocker-checklist-validator={checklist.validatorCommand}
      data-production-blocker-checklist-non-clearing={checklist.nonClearingChecklist ? "true" : "false"}
    >
      <div className="panel-header">
        <div>
          <h3>Production Blocker Checklist</h3>
          <p>{checklist.sourcePath}</p>
        </div>
        <StatusBadge value={statusTone(checklist.releaseGateDecision)} label={`${checklist.blockingProductionInputs} blockers / ${checklist.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Checklist file</span>
          <strong>{checklist.evidencePresent ? "present" : "missing"}</strong>
          <small>{`${checklist.lineCount} lines / ${checklist.commandCount} commands`}</small>
        </article>
        <article>
          <span>Stage1 gates</span>
          <strong>{`${checklist.stage1GatesCompleted}/${checklist.stage1GatesTotal}`}</strong>
          <small>{`${checklist.stage1CompletionPercent}% complete`}</small>
        </article>
        <article>
          <span>Production inputs</span>
          <strong>{`${checklist.productionInputsConfigured}/${checklist.productionInputsTotal}`}</strong>
          <small>{`${checklist.productionInputsCompletionPercent}% configured`}</small>
        </article>
        <article>
          <span>Missing / invalid</span>
          <strong>{`${checklist.productionInputsMissing}/${checklist.productionInputsInvalid}`}</strong>
          <small>{`${checklist.blockingProductionInputs} blocking inputs`}</small>
        </article>
        <article>
          <span>Source probes</span>
          <strong>{`${checklist.productionSourceProbesReady}/${checklist.productionSourceProbesTotal}`}</strong>
          <small>{`${checklist.productionSourceProbesBlocked} blocked / ${checklist.sourceProbeBlockingInputCount} inputs`}</small>
        </article>
        <article>
          <span>Launch gate</span>
          <strong>{checklist.canClearStage1ProductionLaunchGate ? "clearable" : "preserved"}</strong>
          <small>{checklist.canCloseDoNotLaunch ? "DNL closeable" : "DNL remains open"}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Checklist Sections</h3>
              <p>Operator reading order for the final production blockers.</p>
            </div>
          </div>
          <DataTable<(typeof sectionRows)[number]>
            rows={sectionRows}
            columns={[
              { key: "line", header: "Line", render: (row) => row.lineNumber },
              { key: "section", header: "Section", render: (row) => row.title },
              { key: "anchor", header: "Anchor", render: (row) => <span className="mono">{row.anchor}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>First Blocking Rows</h3>
              <p>Top rows from the grouped input and source-probe tables.</p>
            </div>
          </div>
          <DataTable<{ index: number; row: string }>
            rows={firstBlockingRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "row", header: "Row", render: (row) => <span className="mono">{row.row}</span> }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionActionMatrixPanel({ matrix }: { matrix: Stage1ProductionActionMatrix }) {
  const openLanes = matrix.lanes.filter((lane) => lane.status !== "ready").length;
  const firstHelp = matrix.immediateHelpQueue[0];
  const notCurrentRows = matrix.notCurrentBlockers.map((blocker, index) => ({ index: index + 1, blocker }));

  return (
    <section
      className="panel"
      data-production-action-matrix="validator-derived"
      data-production-action-matrix-export={matrix.sourcePath}
      data-production-action-matrix-markdown={matrix.markdownPath}
      data-production-action-matrix-generator="python3 scripts/generate_stage1_production_action_matrix.py"
      data-production-action-matrix-validator="python3 scripts/validate_stage1_production_action_matrix.py"
      data-production-action-matrix-non-clearing={matrix.nonClearingActionMatrix ? "true" : "false"}
    >
      <div className="panel-header">
        <div>
          <h3>Production Action Matrix</h3>
          <p>Short operator queue for the final production-only blockers.</p>
        </div>
        <StatusBadge value={statusTone(matrix.releaseGateDecision)} label={`${matrix.blockingInputCount} blockers / ${matrix.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Matrix file</span>
          <strong>{matrix.evidencePresent ? "present" : "missing"}</strong>
          <small>{`${matrix.markdownLineCount} markdown lines / ${matrix.commandCount} commands`}</small>
        </article>
        <article>
          <span>Open lanes</span>
          <strong>{openLanes}</strong>
          <small>{firstHelp?.ask ?? "none"}</small>
        </article>
        <article>
          <span>Stage1 gates</span>
          <strong>{`${matrix.stage1GatesCompleted}/${matrix.stage1GatesTotal}`}</strong>
          <small>{`${matrix.stage1CompletionPercent}% complete`}</small>
        </article>
        <article>
          <span>Production inputs</span>
          <strong>{`${matrix.productionInputsConfigured}/${matrix.productionInputsTotal}`}</strong>
          <small>{`${matrix.productionInputsCompletionPercent}% configured`}</small>
        </article>
        <article>
          <span>Missing / invalid</span>
          <strong>{`${matrix.productionInputsMissing}/${matrix.productionInputsInvalid}`}</strong>
          <small>{`${matrix.blockingInputCount} blocking inputs`}</small>
        </article>
        <article>
          <span>Source probes</span>
          <strong>{`${matrix.sourceProbesReady}/${matrix.sourceProbesTotal}`}</strong>
          <small>{`${matrix.sourceProbesBlocked} blocked`}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Action Lanes</h3>
              <p>Each lane is non-clearing until strict production evidence passes.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionActionMatrixLane>
            rows={matrix.lanes}
            columns={[
              { key: "order", header: "Order", render: (row) => row.order },
              { key: "lane", header: "Lane", render: (row) => <span className="mono">{row.laneId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "owner", header: "Owner", render: (row) => row.owner },
              { key: "inputs", header: "Inputs", render: (row) => `${row.requiredConfigured}/${row.requiredTotal}` },
              { key: "blockers", header: "Blockers", render: (row) => row.blockingInputCount },
              { key: "first", header: "First Blocker", render: (row) => row.firstBlocker },
              { key: "action", header: "Immediate Action", render: (row) => row.immediateAction }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Immediate Help Queue</h3>
              <p>Sorted asks for the operator before strict production source probes can pass.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionActionMatrixHelpItem>
            rows={matrix.immediateHelpQueue}
            columns={[
              { key: "rank", header: "Rank", render: (row) => row.rank },
              { key: "lane", header: "Lane", render: (row) => <span className="mono">{row.laneId}</span> },
              { key: "blockers", header: "Blockers", render: (row) => row.blockingInputCount },
              { key: "ask", header: "Ask", render: (row) => row.ask },
              { key: "material", header: "First Material", render: (row) => row.firstRequiredMaterial.slice(0, 3).join(", ") || "none" }
            ]}
          />
        </div>

        <div className="release-subsection span-6">
          <div className="panel-header">
            <div>
              <h3>Not Current Blockers</h3>
              <p>Loop breakers explicitly excluded from the final production blocker set.</p>
            </div>
          </div>
          <DataTable<(typeof notCurrentRows)[number]>
            rows={notCurrentRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "blocker", header: "Not Current Blocker", render: (row) => row.blocker }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionNonClearingRefreshPanel({ refresh }: { refresh: Stage1ProductionNonClearingRefresh }) {
  const firstBlockedStep = refresh.steps.find((step) => step.status !== "pass");
  const outputRows = Object.entries(refresh.outputRefs).map(([key, value]) => ({ key, value }));

  return (
    <section
      className="panel"
      data-production-non-clearing-refresh="validator-derived"
      data-production-non-clearing-refresh-export="ops/evidence/non_clearing/production-non-clearing-refresh.json"
      data-production-non-clearing-refresh-generator={refresh.generatorCommand}
      data-production-non-clearing-refresh-validator={refresh.validatorCommand}
      data-production-non-clearing-refresh-non-clearing={refresh.nonClearingRefresh ? "true" : "false"}
      data-production-non-clearing-refresh-canonical-sources-requested={refresh.canonicalSourcesRequested ? "true" : "false"}
      data-production-non-clearing-refresh-dns-apply-requested={refresh.dnsApplyRequested ? "true" : "false"}
    >
      <div className="panel-header">
        <div>
          <h3>Production Non-Clearing Refresh</h3>
          <p>One command refreshes the final production-only blockers without applying DNS or writing canonical sources.</p>
        </div>
        <StatusBadge value={statusTone(refresh.releaseGateDecision)} label={`${refresh.status} / ${refresh.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Refresh file</span>
          <strong>{refresh.evidencePresent ? "present" : "missing"}</strong>
          <small>{refresh.schemaVersion}</small>
        </article>
        <article>
          <span>Refresh steps</span>
          <strong>{`${refresh.stepSummary.passed}/${refresh.stepSummary.total}`}</strong>
          <small>{`${refresh.stepSummary.blocked} blocked / ${refresh.stepSummary.failed} failed`}</small>
        </article>
        <article>
          <span>Stage1 gates</span>
          <strong>{`${refresh.progress.stage1.completed}/${refresh.progress.stage1.total}`}</strong>
          <small>{`${refresh.progress.stage1.completionPercent}% complete`}</small>
        </article>
        <article>
          <span>External resources</span>
          <strong>{`${refresh.progress.externalResources.ready}/${refresh.progress.externalResources.total}`}</strong>
          <small>{`${refresh.progress.externalResources.readyPercent}% ready`}</small>
        </article>
        <article>
          <span>Production inputs</span>
          <strong>{`${refresh.progress.productionInputs.configured}/${refresh.progress.productionInputs.total}`}</strong>
          <small>{`${refresh.progress.productionInputs.completionPercent}% configured`}</small>
        </article>
        <article>
          <span>Missing / invalid</span>
          <strong>{`${refresh.progress.productionInputs.missing}/${refresh.progress.productionInputs.invalid}`}</strong>
          <small>{`${refresh.progress.productionInputs.blockingInputCount} blocking inputs`}</small>
        </article>
        <article>
          <span>Source probes</span>
          <strong>{`${refresh.progress.productionSourceProbes.ready}/${refresh.progress.productionSourceProbes.total}`}</strong>
          <small>{`${refresh.progress.productionSourceProbes.blocked} blocked`}</small>
        </article>
        <article>
          <span>Side effects</span>
          <strong>{refresh.canonicalSourcesRequested || refresh.dnsApplyRequested ? "requested" : "none"}</strong>
          <small>{firstBlockedStep?.outputSummary ?? refresh.preservedDoNotLaunchCondition}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Refresh Action Lanes</h3>
              <p>These numbers are copied from the latest non-clearing refresh summary.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionNonClearingRefreshActionLane>
            rows={refresh.progress.productionActionLanes}
            columns={[
              { key: "lane", header: "Lane", render: (row) => <span className="mono">{row.laneId}</span> },
              { key: "blockers", header: "Blockers", render: (row) => row.blockingInputCount },
              { key: "percent", header: "Completion", render: (row) => `${row.completionPercent}%` },
              { key: "first", header: "First Blocker", render: (row) => row.firstBlocker }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Refresh Steps</h3>
              <p>Exit code 2 is expected for blocked production diagnostics.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionNonClearingRefreshStep>
            rows={refresh.steps}
            columns={[
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "exit", header: "Exit", render: (row) => `${row.exitCode}${row.expectedExit ? " expected" : " unexpected"}` },
              { key: "summary", header: "Output Summary", render: (row) => row.outputSummary },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Refresh Output Refs</h3>
              <p>{refresh.strictLaunchValidator}</p>
            </div>
          </div>
          <DataTable<(typeof outputRows)[number]>
            rows={outputRows}
            columns={[
              { key: "key", header: "Output", render: (row) => <span className="mono">{row.key}</span> },
              { key: "value", header: "Path", render: (row) => <span className="mono">{row.value}</span> }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

function ProductionInputTemplatePanel({ template }: { template: Stage1ProductionInputTemplate }) {
  const commandRows = template.commandsAfterFill.map((command, index) => ({ index: index + 1, command }));

  return (
    <section
      className="panel"
      data-production-input-template="validator-derived"
      data-production-input-template-export="ops/evidence/non_clearing/production-input-template.env"
      data-production-input-template-manifest="ops/evidence/non_clearing/production-input-template.json"
      data-production-input-template-generator="python3 scripts/generate_stage1_production_input_template.py"
      data-production-input-template-validator="python3 scripts/validate_stage1_production_input_template.py"
      data-production-input-template-non-clearing={template.nonClearingTemplate ? "true" : "false"}
    >
      <div className="panel-header">
        <div>
          <h3>Production Input Template</h3>
          <p>Blank values only; filled copies must stay private and cannot be committed as evidence.</p>
        </div>
        <StatusBadge value={statusTone(template.releaseGateDecision)} label={`${template.templateVariableCount} blank slots / ${template.releaseGateDecision}`} />
      </div>

      <div className="dependency-summary">
        <article>
          <span>Template file</span>
          <strong>{template.templatePresent ? "present" : "missing"}</strong>
          <small>{`${template.templateLineCount} lines / ${template.valuePolicy}`}</small>
        </article>
        <article>
          <span>Manifest file</span>
          <strong>{template.evidencePresent ? "present" : "missing"}</strong>
          <small>{template.manifestPath}</small>
        </article>
        <article>
          <span>Variable slots</span>
          <strong>{template.templateVariableCount}</strong>
          <small>{`${template.requiredTemplateVariableCount} required / ${template.optionalOrDefaultedVariableCount} optional`}</small>
        </article>
        <article>
          <span>Required proofs</span>
          <strong>{template.requiredRequirementCount}</strong>
          <small>{template.canClearStage1ProductionLaunchGate ? "clears gate" : "non-clearing template"}</small>
        </article>
        <article>
          <span>Groups</span>
          <strong>{template.groups.length}</strong>
          <small>{template.groups.map((group) => group.groupId).join(", ") || "none"}</small>
        </article>
        <article>
          <span>Launch gate</span>
          <strong>{template.canCloseDoNotLaunch ? "closeable" : "preserved"}</strong>
          <small>{template.canonicalPassPath ? "canonical pass path" : "template-only artifact"}</small>
        </article>
      </div>

      <section className="grid">
        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Template Groups</h3>
              <p>Variable counts mirror the production proof bundle input contract.</p>
            </div>
          </div>
          <DataTable<Stage1ProductionInputTemplateGroup>
            rows={template.groups}
            columns={[
              { key: "group", header: "Group", render: (row) => <span className="mono">{row.groupId}</span> },
              { key: "title", header: "Title", render: (row) => row.title },
              { key: "requirements", header: "Proofs", render: (row) => row.requiredRequirementCount },
              { key: "required", header: "Required Slots", render: (row) => row.requiredTemplateVariableCount },
              { key: "optional", header: "Optional", render: (row) => row.optionalOrDefaultedCount },
              {
                key: "variables",
                header: "First Variables",
                render: (row) => <span className="mono">{row.requiredTemplateVariables.slice(0, 4).join(", ") || "none"}</span>
              },
              { key: "notes", header: "Notes", render: (row) => row.notes[0] ?? "none" }
            ]}
          />
        </div>

        <div className="release-subsection span-12">
          <div className="panel-header">
            <div>
              <h3>Commands After Fill</h3>
              <p>Run only with a private production env file after real production values exist.</p>
            </div>
          </div>
          <DataTable<(typeof commandRows)[number]>
            rows={commandRows}
            columns={[
              { key: "index", header: "#", render: (row) => row.index },
              { key: "command", header: "Command", render: (row) => <span className="mono">{row.command}</span> }
            ]}
          />
        </div>
      </section>
    </section>
  );
}

export default async function ReleaseReadinessPage() {
  const readiness = await getStage1ReleaseReadiness();
  const strictLaunchReady = readiness.staging.gateSafety.strictGateReady && readiness.production.gateSafety.strictGateReady;
  const closureQueue = readiness.closureQueue;
  const providerHandoffRows = providerSandboxHandoffRows(readiness.staging);
  const resourceReadiness = readiness.resourceReadiness;

  return (
    <>
      <PageHeader
        title="Release Readiness"
        description="Read-only Stage 1 launch status from validator-readable staging and production aggregate evidence."
      />

      <section className="panel" data-decision-source="validator_evidence_only" data-approval-controls="disabled">
        <div className="panel-header">
          <div>
            <h3>Gate Verdict</h3>
            <p>Admin renders validator evidence only; approval override controls are disabled by contract.</p>
          </div>
          <StatusBadge
            value={statusTone(strictLaunchReady && !readiness.manualGoControlsEnabled ? "go" : "blocked")}
            label={strictLaunchReady && !readiness.manualGoControlsEnabled ? "strict gates ready" : "strict gates blocked"}
          />
        </div>
        <div className="dependency-summary">
          <article>
            <span>Decision source</span>
            <strong>{readiness.decisionSource}</strong>
            <small>validator and generator artifacts only</small>
          </article>
          <article>
            <span>Staging decision</span>
            <strong>{readiness.staging.gateSafety.verdict}</strong>
            <small>{readiness.staging.gateSafety.strictGateBlockers[0] ?? readiness.staging.sourcePath}</small>
          </article>
          <article>
            <span>Production decision</span>
            <strong>{readiness.production.gateSafety.verdict}</strong>
            <small>{readiness.production.gateSafety.strictGateBlockers[0] ?? readiness.production.sourcePath}</small>
          </article>
          <article>
            <span>Latest aggregate</span>
            <strong>{readiness.generatedAt}</strong>
            <small>newest generated_at from aggregate evidence</small>
          </article>
        </div>
      </section>

      <Stage1NextBlockersSummaryPanel summary={readiness.nextBlockersSummary} />
      <ProductionCopySafeCommandListPanel
        refresh={readiness.productionNonClearingRefresh}
        dnsDetail={readiness.productionDnsDetail}
        inputTemplate={readiness.productionInputTemplate}
        proofBundle={readiness.productionProofBundle}
        packet={readiness.productionLaunchInputPacket}
      />
      <ProductionLaunchBlockerMatrixPanel
        audit={readiness.productionBlockerAudit}
        dnsDetail={readiness.productionDnsDetail}
        bundle={readiness.productionProofBundle}
        diagnostics={readiness.productionProofDiagnostics}
      />
      <ProductionLaunchOperatorBriefPanel brief={readiness.productionLaunchOperatorBrief} />
      <ProductionNonClearingRefreshPanel refresh={readiness.productionNonClearingRefresh} />
      <ProductionActionMatrixPanel matrix={readiness.productionActionMatrix} />
      <ProductionInputTemplatePanel template={readiness.productionInputTemplate} />
      <ProductionMissingInputChecklistPanel checklist={readiness.productionMissingInputChecklist} />
      <ProductionBlockerChecklistPanel checklist={readiness.productionBlockerChecklist} />
      <AggregatePanel evidence={readiness.staging} />
      <AggregatePanel evidence={readiness.production} />
      <ProductionBlockerAuditPanel audit={readiness.productionBlockerAudit} />
      <ProductionDnsDetailPanel dnsDetail={readiness.productionDnsDetail} />
      <ProductionLaunchInputPacketPanel packet={readiness.productionLaunchInputPacket} />
      <ProductionProofBundlePanel bundle={readiness.productionProofBundle} />
      <ProductionProofDiagnosticsPanel diagnostics={readiness.productionProofDiagnostics} />
      <ProductionLaunchSourcePipelinePanel pipeline={readiness.productionLaunchSourcePipeline} />
      <ProductionSourceProbeRunbookPanel runbook={readiness.productionSourceProbeRunbook} />
      <ProductionOperatorPacketsPanel packets={readiness.productionOperatorPackets} />
      <AzureOriginReadinessPanel readiness={readiness.azureOriginReadiness} />

      <section
        className="panel"
        data-external-resource-readiness="validator-derived"
        data-external-resource-readiness-contract="external_resource_readiness"
        data-external-resource-readiness-export="ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json"
        data-external-resource-readiness-generator="python3 scripts/generate_stage1_external_resource_readiness.py"
        data-external-resource-readiness-validator="python3 scripts/validate_stage1_external_resource_readiness.py --allow-preflight"
      >
        <div className="panel-header">
          <div>
            <h3>External Resource Readiness</h3>
            <p>{resourceReadiness.sourcePath}</p>
          </div>
          <StatusBadge
            value={statusTone(resourceReadiness.status)}
            label={`${resourceReadiness.ready}/${resourceReadiness.total} ready (${resourceReadiness.readyPercent}%)`}
          />
        </div>
        <div className="dependency-summary">
          <article>
            <span>Evidence file</span>
            <strong>{resourceReadiness.evidencePresent ? "present" : "missing"}</strong>
            <small>{resourceReadiness.schemaVersion}</small>
          </article>
          <article>
            <span>Provided, not strict-pass</span>
            <strong>{resourceReadiness.providedUnverified}</strong>
            <small>needs canonical validator evidence</small>
          </article>
          <article>
            <span>Blocked</span>
            <strong>{resourceReadiness.blocked}</strong>
            <small>{blockerPreview(resourceReadiness.blockers)}</small>
          </article>
          <article>
            <span>Missing</span>
            <strong>{resourceReadiness.missing}</strong>
            <small>external inputs needed</small>
          </article>
          <article data-external-resource-operator-handoff="isolated-staging">
            <span>Operator Handoff</span>
            <strong>{resourceReadiness.operatorHandoff.status}</strong>
            <small>{resourceReadiness.operatorHandoff.currentLoopBreaker}</small>
          </article>
          <article>
            <span>Staging Scope</span>
            <strong>{resourceReadiness.operatorHandoff.nonClearingPreflight ? "isolated staging" : "unsafe"}</strong>
            <small>not production server access; no live user data or Stripe live keys</small>
          </article>
          <article>
            <span>Missing Variables</span>
            <strong>{resourceReadiness.operatorHandoff.missingVariables.length}</strong>
            <small>{resourceReadiness.operatorHandoff.missingVariables.slice(0, 4).join(", ") || "none"}</small>
          </article>
          <article>
            <span>Next Commands</span>
            <strong>{resourceReadiness.operatorHandoff.commandsAfterInputs.length}</strong>
            <small>{resourceReadiness.operatorHandoff.commandsAfterInputs[0] ?? "none"}</small>
          </article>
          <article data-external-resource-production-handoff-refs="operator-brief,input-packet,missing-input-checklist,source-probe-runbook">
            <span>Production Handoff Refs</span>
            <strong>brief + packet + checklist + runbook</strong>
            <small>
              {`${resourceReadiness.operatorHandoff.operatorBriefRef} | ${resourceReadiness.operatorHandoff.inputPacketRef} | ${resourceReadiness.operatorHandoff.missingInputChecklistRef} | ${resourceReadiness.operatorHandoff.sourceProbeRunbookRef}`}
            </small>
          </article>
        </div>
        <div
          className="release-subsection span-12"
          data-external-resource-non-clearing-refresh-summary="validator-derived"
          data-external-resource-non-clearing-refresh-source={resourceReadiness.nonClearingRefreshSummary.path}
          data-external-resource-non-clearing-refresh-status={resourceReadiness.nonClearingRefreshSummary.status}
        >
          <div className="panel-header">
            <div>
              <h3>Non-Clearing Refresh Summary</h3>
              <p>{resourceReadiness.nonClearingRefreshSummary.path}</p>
            </div>
            <StatusBadge
              value={statusTone(resourceReadiness.nonClearingRefreshSummary.status)}
              label={nonClearingRefreshStatusLabel(resourceReadiness.nonClearingRefreshSummary)}
            />
          </div>
          <div className="dependency-summary">
            <article>
              <span>Stage1 Progress</span>
              <strong>{`${resourceReadiness.nonClearingRefreshSummary.stage1Progress.completed}/${resourceReadiness.nonClearingRefreshSummary.stage1Progress.total}`}</strong>
              <small>{`${resourceReadiness.nonClearingRefreshSummary.stage1Progress.completionPercent}% complete`}</small>
            </article>
            <article>
              <span>Production Inputs</span>
              <strong>{`${resourceReadiness.nonClearingRefreshSummary.productionInputProgress.configured}/${resourceReadiness.nonClearingRefreshSummary.productionInputProgress.total}`}</strong>
              <small>{`${resourceReadiness.nonClearingRefreshSummary.productionInputProgress.completionPercent}% configured`}</small>
            </article>
            <article>
              <span>Refresh Passed</span>
              <strong>{resourceReadiness.nonClearingRefreshSummary.stepSummary.passed}</strong>
              <small>{`${resourceReadiness.nonClearingRefreshSummary.stepSummary.failed} failed`}</small>
            </article>
            <article>
              <span>Refresh Blocked</span>
              <strong>{resourceReadiness.nonClearingRefreshSummary.stepSummary.blocked}</strong>
              <small>{`${resourceReadiness.nonClearingRefreshSummary.stepSummary.unexpectedExitCount} unexpected exits`}</small>
            </article>
            <article>
              <span>Handoff Mirror</span>
              <strong>{resourceReadiness.operatorHandoff.nonClearingRefreshSummary.status}</strong>
              <small>{`${resourceReadiness.operatorHandoff.nonClearingRefreshSummary.blockedEvidenceDetails.length} blocked evidence details`}</small>
            </article>
          </div>
          <DataTable<Stage1NonClearingRefreshBlockedEvidenceDetail>
            rows={resourceReadiness.nonClearingRefreshSummary.blockedEvidenceDetails}
            columns={[
              { key: "step", header: "Step", render: (row) => <span className="mono">{row.stepId}</span> },
              { key: "source", header: "Source", render: (row) => <span className="mono">{row.source}</span> },
              { key: "detail", header: "Detail", render: (row) => row.detail }
            ]}
          />
        </div>
        <DataTable<Stage1ExternalResourceGroup>
          rows={resourceReadiness.resourceGroups}
          columns={[
            { key: "resource", header: "Resource", render: (row) => <span className="mono">{row.resourceId}</span> },
            { key: "lane", header: "Lane", render: (row) => <StatusBadge value={row.lane} label={row.lane} /> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={resourceReadinessLabel(row)} /> },
            { key: "required", header: "Required", render: (row) => row.requiredResource },
            { key: "provided", header: "Provided Signal", render: (row) => row.providedSignal },
            { key: "validation", header: "Validation Signal", render: (row) => row.validationSignal },
            { key: "blocker", header: "Current Blocker", render: (row) => row.currentBlocker },
            { key: "source-probes", header: "Source Probes", render: (row) => row.sourceProbeRequirements.length },
            { key: "gate", header: "Gate Dependency", render: (row) => <span className="mono">{row.gateDependency}</span> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "validator", header: "Validator", render: (row) => row.validator },
            { key: "action", header: "Next Action", render: (row) => row.nextAction },
            { key: "ask", header: "Operator Ask", render: (row) => row.operatorAsk }
          ]}
        />
        <div
          className="release-subsection span-12"
          data-production-source-probe-requirements="validator-derived"
          data-production-source-probe-requirements-field="production_source_probe_requirements"
          data-source-probe-requirements-field="source_probe_requirements"
          data-production-source-probe-billing="ops/evidence/production/billing-paid-lifecycle-source.json"
          data-production-source-probe-security="ops/evidence/production/production-security-launch-source.json"
          data-production-source-probe-legal="ops/evidence/production/production-legal-support-source.json"
          data-production-source-probe-governance="ops/evidence/production/production-governance-release-source.json"
          data-production-source-probe-count={resourceReadiness.productionSourceProbeRequirements.length}
        >
          <div className="panel-header">
            <div>
              <h3>Production Source Probes</h3>
              <p>Live production source probes required before billing, security, legal/support, and governance can clear.</p>
            </div>
            <StatusBadge
              value={statusTone(resourceReadiness.productionSourceProbeRequirements.every((row) => row.status === "present") ? "pass" : "missing")}
              label={`${resourceReadiness.productionSourceProbeRequirements.filter((row) => row.status === "present").length}/${resourceReadiness.productionSourceProbeRequirements.length} present`}
            />
          </div>
          <DataTable<Stage1ProductionSourceProbeRequirement>
            rows={resourceReadiness.productionSourceProbeRequirements}
            columns={[
              { key: "probe", header: "Probe", render: (row) => <span className="mono">{row.probeId}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "path", header: "Path", render: (row) => <span className="mono">{row.path}</span> },
              { key: "schema", header: "Schema", render: (row) => <span className="mono">{row.schemaVersion}</span> },
              { key: "reported", header: "Aggregate Reported", render: (row) => yesNo(row.reportedByProductionAggregate) },
              { key: "blocker", header: "Current Blocker", render: (row) => row.currentBlocker },
              { key: "generator", header: "Generator", render: (row) => row.generator },
              { key: "validator", header: "Strict Validator", render: (row) => row.strictValidator }
            ]}
          />
        </div>
      </section>

      <section
        className="panel"
        data-release-evidence-closure-queue="validator-derived"
        data-release-evidence-closure-queue-contract="release_evidence_closure_queue"
        data-release-evidence-closure-queue-export="ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json"
        data-release-evidence-closure-queue-generator="python3 scripts/generate_stage1_release_evidence_closure_queue.py"
        data-release-evidence-closure-queue-validator="python3 scripts/validate_stage1_release_evidence_closure_queue.py --allow-preflight"
        data-release-evidence-parallel-operational-field="parallel_operational_blockers"
        data-release-evidence-parallel-operational-blockers={closureQueue.parallelOperationalBlockerCount}
        data-release-evidence-azure-origin-parallel-blocker={yesNo(
          closureQueue.parallelOperationalBlockers.some((row) => row.blockerId === "azure_origin_run_command_required")
        )}
        data-ci-artifact-fetcher="python3 scripts/fetch_stage1_ci_artifacts.py --run-url <github-actions-run-url>"
      >
        <div className="panel-header">
          <div>
            <h3>Evidence Closure Queue</h3>
            <p>{closureQueue.sourcePath}</p>
          </div>
          <StatusBadge
            value={statusTone(closureQueue.status)}
            label={`${closureQueue.open}/${closureQueue.total} open evidence tasks`}
          />
        </div>
        <div className="dependency-summary">
          <article>
            <span>Evidence file</span>
            <strong>{closureQueue.evidencePresent ? "present" : "missing"}</strong>
            <small>{closureQueue.schemaVersion}</small>
          </article>
          <article>
            <span>Completed</span>
            <strong>{`${closureQueue.completed}/${closureQueue.total}`}</strong>
            <small>{`${closureQueue.completionPercent}% closed`}</small>
          </article>
          <article>
            <span>P0 / P1 / P2</span>
            <strong>{`${closureQueue.p0}/${closureQueue.p1}/${closureQueue.p2}`}</strong>
            <small>open priority split</small>
          </article>
          <article>
            <span>Staging / CI / Production</span>
            <strong>{`${closureQueue.staging}/${closureQueue.ci}/${closureQueue.production}`}</strong>
            <small>open lane split</small>
          </article>
          <article>
            <span>Decision</span>
            <strong>{closureQueue.releaseGateDecision}</strong>
            <small>non-clearing preflight</small>
          </article>
          <article>
            <span>Parallel ops blockers</span>
            <strong>{closureQueue.parallelOperationalBlockerCount}</strong>
            <small>non-clearing staging ops only</small>
          </article>
        </div>
        <DataTable<Stage1EvidenceClosureQueueRow>
          rows={closureQueue.queue}
          columns={[
            { key: "priority", header: "Priority", render: (row) => <span className="mono">{row.priority}</span> },
            { key: "lane", header: "Lane", render: (row) => <StatusBadge value={row.lane === "production" ? "blocked" : "pending"} label={row.lane} /> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.rowStatus)} label={row.rowStatus} /> },
            { key: "gate", header: "Gate", render: (row) => <span className="mono">{row.gate}</span> },
            { key: "required", header: "Required Evidence", render: (row) => <span className="mono">{row.requiredEvidence}</span> },
            { key: "validator", header: "Validator", render: (row) => row.validator },
            { key: "generator", header: "Generator", render: (row) => row.generator },
            { key: "blocker", header: "Current Blocker", render: (row) => row.currentBlocker },
            { key: "impact", header: "DNL Impact", render: (row) => row.dnlImpact }
          ]}
        />
        {closureQueue.parallelOperationalBlockers.length > 0 ? (
          <div
            className="release-subsection"
            data-release-evidence-parallel-operational-blockers="validator-derived"
            data-release-evidence-parallel-operational-impact="non_clearing_parallel_ops_only"
            data-release-evidence-azure-origin-parallel-blocker={yesNo(
              closureQueue.parallelOperationalBlockers.some((row) => row.blockerId === "azure_origin_run_command_required")
            )}
          >
            <div className="panel-header">
              <div>
                <h3>Parallel Ops Blockers</h3>
                <p>Non-clearing operational blockers tracked beside the evidence queue; these rows cannot close staging, production, or DNL gates.</p>
              </div>
              <StatusBadge value="blocked" label={`${closureQueue.parallelOperationalBlockerCount} ops blockers`} />
            </div>
            <DataTable<Stage1EvidenceClosureQueueParallelBlocker>
              rows={closureQueue.parallelOperationalBlockers}
              columns={[
                { key: "blocker", header: "Blocker", render: (row) => <span className="mono">{row.blockerId}</span> },
                { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
                { key: "impact", header: "Gate Impact", render: (row) => <span className="mono">{row.releaseGateImpact}</span> },
                { key: "current", header: "Current Blocker", render: (row) => row.currentBlocker },
                { key: "next", header: "Next Action", render: (row) => row.nextAction },
                { key: "command", header: "Operator Command", render: (row) => <span className="mono">{row.operatorCommand}</span> },
                { key: "lane", header: "Repair Lane", render: (row) => <span className="mono">{row.runCommandNextRepairLane}</span> },
                { key: "input", header: "Run Command Input", render: (row) => yesNo(row.runCommandInputPresent) }
              ]}
            />
          </div>
        ) : null}
        <div
          className="release-subsection"
          data-release-evidence-operator-action-packet-summary="next-blockers-projection"
          data-release-evidence-operator-action-packet-field="operator_action_packet_summary"
          data-release-evidence-operator-action-packet-count-field="operator_action_packet_items"
          data-release-evidence-operator-action-packet-count={closureQueue.operatorActionPacketItems}
          data-release-evidence-operator-action-packet-non-clearing={yesNo(
            closureQueue.operatorActionPacketSummary.sourceGateFlagsAllFalse &&
              !closureQueue.operatorActionPacketSummary.canClearStage1StagingRuntimeGate &&
              !closureQueue.operatorActionPacketSummary.canClearStage1ProductionLaunchGate &&
              !closureQueue.operatorActionPacketSummary.canCloseDoNotLaunch
          )}
        >
          <div className="panel-header">
            <div>
              <h3>Production / Azure Operator Action Packet</h3>
              <p>{closureQueue.operatorActionPacketSummary.sourcePath}</p>
            </div>
            <StatusBadge
              value={statusTone(closureQueue.operatorActionPacketSummary.status)}
              label={`${closureQueue.operatorActionPacketSummary.blocked}/${closureQueue.operatorActionPacketSummary.total} blocked`}
            />
          </div>
          <div className="dependency-summary">
            <article>
              <span>External input</span>
              <strong>{`${closureQueue.operatorActionPacketSummary.requiresExternalInput}/${closureQueue.operatorActionPacketSummary.total}`}</strong>
              <small>return artifacts still required</small>
            </article>
            <article>
              <span>Owners</span>
              <strong>{Object.keys(closureQueue.operatorActionPacketSummary.ownerCounts).length}</strong>
              <small>{operatorActionPacketOwnerSummary(closureQueue.operatorActionPacketSummary)}</small>
            </article>
            <article>
              <span>Gate impact</span>
              <strong>{closureQueue.operatorActionPacketSummary.sourceGateFlagsAllFalse ? "non-clearing" : "unsafe"}</strong>
              <small>{operatorActionPacketGateImpactSummary(closureQueue.operatorActionPacketSummary)}</small>
            </article>
            <article>
              <span>Decision</span>
              <strong>{closureQueue.operatorActionPacketSummary.releaseGateDecision}</strong>
              <small>{closureQueue.operatorActionPacketSummary.sourceSchemaVersion}</small>
            </article>
          </div>
          <DataTable<Stage1EvidenceClosureQueueOperatorActionPacketItem>
            rows={closureQueue.operatorActionPacketSummary.items}
            columns={[
              { key: "order", header: "#", render: (row) => row.order },
              { key: "item", header: "Item", render: (row) => <span className="mono">{row.itemId}</span> },
              { key: "owner", header: "Owner", render: (row) => <span className="mono">{row.owner}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
              { key: "return", header: "Return Artifact", render: (row) => row.requiredReturnArtifact },
              { key: "agent", header: "Agent Command After Return", render: (row) => <span className="mono">{row.agentCommandAfterReturn}</span> },
              { key: "validate", header: "Validation", render: (row) => <span className="mono">{row.validationAfterReturn}</span> },
              { key: "impact", header: "Gate Impact", render: (row) => <span className="mono">{row.gateImpact}</span> }
            ]}
          />
        </div>
      </section>

      <section className="panel" data-provider-sandbox-handoff="validator-derived">
        <div className="panel-header">
          <div>
            <h3>Provider Sandbox Handoff</h3>
            <p>
              z.ai/OpenAI-compatible provider readiness is derived from staging aggregate evidence, provider sandbox validators,
              and safe redaction flags.
            </p>
          </div>
          <StatusBadge
            value={providerHandoffRows.every((row) => row.status === "pass") ? "pass" : "blocked"}
            label={providerHandoffRows.every((row) => row.status === "pass") ? "provider sandbox clear" : "provider sandbox blocked"}
          />
        </div>
        <DataTable<ProviderSandboxHandoffRow>
          rows={providerHandoffRows}
          columns={[
            { key: "check", header: "Check", render: (row) => <span className="mono">{row.check}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
            { key: "detail", header: "Detail", render: (row) => row.detail },
            { key: "evidence", header: "Evidence / Category", render: (row) => <span className="mono">{row.evidence}</span> },
            { key: "action", header: "Next Action", render: (row) => row.nextAction }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Stage 0 Gate Dependencies</h3>
            <p>Production launch can only proceed when all upstream gate fixtures report go with no active Do-Not-Launch conditions.</p>
          </div>
        </div>
        <DataTable<Stage1ReleaseReadinessSummary>
          rows={readiness.releaseGateSummary}
          columns={[
            { key: "gate", header: "Gate", render: (row) => <span className="mono">{row.gateId}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
            { key: "blockers", header: "Blockers", render: (row) => row.blockerCount },
            { key: "dnl", header: "DNL Conditions", render: (row) => row.activeDoNotLaunchCount },
            { key: "path", header: "Fixture", render: (row) => row.path }
          ]}
        />
        <DataTable<Stage1ReleaseGateFixture>
          rows={readiness.production.releaseGateFixtures}
          columns={[
            { key: "gate", header: "Gate Fixture", render: (row) => <span className="mono">{row.gateId}</span> },
            { key: "status", header: "Decision", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
            { key: "blocked", header: "Blocked Checks", render: (row) => row.blockedByChecks.join(", ") || "none" },
            { key: "conditions", header: "Active Conditions", render: (row) => row.activeDoNotLaunchConditions.join(", ") || "none" },
            { key: "blockers", header: "Fixture Blockers", render: (row) => blockerPreview(row.blockers) },
            { key: "path", header: "Path", render: (row) => row.path }
          ]}
        />
      </section>

      <section
        className="panel"
        data-r2-bucket-readiness-contract="r2_bucket_readiness"
        data-r2-bucket-readiness-export="ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json"
        data-r2-bucket-readiness-generator="python3 scripts/stage1_r2_bucket_readiness.py --create-bucket"
        data-r2-bucket-readiness-validator="python3 scripts/validate_stage1_r2_bucket_readiness.py --allow-preflight"
      >
        <div className="panel-header">
          <div>
            <h3>CI Evidence</h3>
            <p>Production aggregate evidence requires exact CI files before release gate fixtures can close.</p>
          </div>
        </div>
        <DataTable<Stage1CIEvidence>
          rows={readiness.production.ciEvidence}
          columns={[
            { key: "path", header: "Evidence", render: (row) => row.path },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={statusTone(row.status)} label={row.status} /> },
            { key: "blockers", header: "Blockers", render: (row) => blockerPreview(row.blockers) }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Validator Contract Anchors</h3>
            <p>Release readiness is computed by these contracts, generators, and strict validators.</p>
          </div>
        </div>
        <DataTable<Stage1ReleaseReadinessContractAnchor>
          rows={readiness.contractAnchors}
          columns={[
            { key: "id", header: "Gate", render: (row) => <span className="mono">{row.id}</span> },
            { key: "contract", header: "Contract", render: (row) => row.contractPath },
            { key: "evidence", header: "Evidence", render: (row) => row.evidencePath },
            { key: "results", header: "Results", render: (row) => row.resultsPath },
            { key: "contract-validator", header: "Contract Validator", render: (row) => row.contractValidatorCommand },
            { key: "strict-validator", header: "Strict Validator", render: (row) => row.strictValidatorCommand },
            { key: "preflight-validator", header: "Preflight Validator", render: (row) => row.preflightValidatorCommand ?? "n/a" },
            { key: "generator", header: "Generator", render: (row) => row.generatorCommand },
            { key: "policy", header: "Gate Policy", render: (row) => row.gatePolicy }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Next Operator Actions</h3>
            <p>These are blocker summaries from aggregate evidence, not release approval controls.</p>
          </div>
        </div>
        <div className="record-list panel-body">
          {readiness.nextOperatorActions.map((action) => (
            <article className="record-card" key={action}>
              <p>{action}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
