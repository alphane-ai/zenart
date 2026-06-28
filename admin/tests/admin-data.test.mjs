import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fixtures = readFileSync(new URL("../lib/fixtures.ts", import.meta.url), "utf8");
const routes = [
  "skills",
  "skills/releases",
  "reviews",
  "crawler",
  "prompt-fragments",
  "meta-prompts",
  "traces",
  "feedback",
  "providers",
  "queues",
  "operations",
  "release",
  "exports",
  "exports/[id]",
  "support",
  "quota",
  "safety",
  "abuse",
  "audit",
  "analytics"
];

test("admin fixtures cover required operational surfaces", () => {
  for (const token of [
    "export const skills",
    "export const skillVersions",
    "export const adminReviewDecisions",
    "export const crawlerFindings",
    "export const crawlerSourceApprovals",
    "export const crawlerGovernanceWorkflows",
    "export const crawlerStagingRuntimeEvidence",
    "export const promptFragments",
    "export const metaPrompts",
    "export const traces",
    "export const feedbackItems",
    "export const regressionFixtures",
    "export const providerHealth",
    "export const queueHealth",
    "export const stage1BatchQueueRuntime",
    "export const stage1BatchChildTasks",
    "export const failedTaskControls",
    "export const incidentLogs",
    "export const maintenanceBanners",
    "export const exportJobs",
    "export const supportTickets",
    "export const supportEscalationRunbooks",
    "export const supportAdminDeletionGovernanceContract",
    "export const supportUsers",
    "export const quotaAccounts",
    "export const riskyExports",
    "export const releaseEvidence",
    "export const abuseEvents",
    "export const abuseControlHooks",
    "export const stagingAuthRbacTenantAuditEvidence",
    "export const stagingSupportRetryAbuseEvidence",
    "export const stagingLegalSupportVisibilityEvidence",
    "export const stagingQuotaRateLimitSpendCapEvidence",
    "export const productionSkillReleaseEvalCanaryEvidence",
    "export const productionSecurityLaunchCheckEvidence",
    "export const productionBackupRollbackIncidentEvidence",
    "export const operationsIncidentRunbookContract",
    "export const operationalDashboards",
    "export const operationalDashboardRuntimeEvidence",
    "export const alertRoutes",
    "export const alertRouteRuntimeEvidence",
    "export const backendMetricsRuntimeEvidence",
    "export const observabilityTelemetryRuntimeEvidence",
    "export const stagingObservabilityBackupLoadPreflightEvidence",
    "export const stagingObjectStorageRetentionCleanupEvidence",
    "export const releaseBlockers",
    "export const auditEvents",
    "export const analyticsReports",
    "export const skillReleaseStateDefinitions",
    "export const skillCanaryMetrics",
    "export const adminRbacEvidence",
    "export const adminRbacOverrideAttempts"
  ]) {
    assert.match(fixtures, new RegExp(token.replaceAll(" ", "\\s+")));
  }
});

test("admin operations page exposes incident runbook contract without launch controls", () => {
  const operationsPage = readFileSync(new URL("../app/operations/page.tsx", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
  const fixtures = readFileSync(new URL("../lib/fixtures.ts", import.meta.url), "utf8");
  const adminApi = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const contract = readFileSync(
    new URL("../../fixtures/stage1/operations_incident_runbook/local_contract.json", import.meta.url),
    "utf8"
  );
  const repoValidate = readFileSync(new URL("../../scripts/repo_validate.sh", import.meta.url), "utf8");

  for (const token of [
    "stage1.operations-incident-runbook-local-contract",
    "OperationsIncidentRunbookContract",
    "OperationsIncidentRunbookAction",
    "Incident Runbook Contract",
    "data-ops-incident-runbook-contract",
    "data-ops-runbook-non-launch-status",
    "data-ops-runbook-blocked-gate-checks",
    "data-ops-runbook-preserved-dnl",
    "data-ops-runbook-required-incident-fields",
    "data-ops-runbook-required-alert-fields",
    "data-ops-runbook-required-rollback-evidence",
    "data-ops-runbook-action-matrix",
    "canClearStagingGate: false",
    "canClearProductionGate: false",
    "canCloseDoNotLaunch: false",
    "manualGoControlsEnabled: false",
    "blocked_by_do_not_launch",
    "blocked_until_evidence",
    "ops/evidence/production/backup-restore.json",
    "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
    "ops/evidence/production/backup-rollback-split.blocked.json",
    "staging_observability_restore_load_missing",
    "production_paid_billing_lifecycle"
  ]) {
    assert.match(operationsPage + types + fixtures + contract, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(adminApi, /getOperationsIncidentRunbookContract/);
  assert.match(repoValidate, /validate_stage1_operations_incident_runbook_contract\.py/);
  assert.doesNotMatch(operationsPage.toLowerCase(), /<form|type="submit"|manual go|mark go|set go/);
});

test("admin release readiness panel reads aggregate validator evidence only", () => {
  const releasePage = readFileSync(new URL("../app/release/page.tsx", import.meta.url), "utf8");
  const adminShell = readFileSync(new URL("../components/AdminShell.tsx", import.meta.url), "utf8");
  const adminApi = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
  const contract = readFileSync(
    new URL("../../fixtures/stage1/release_readiness/local_contract.json", import.meta.url),
    "utf8"
  );
  const productionActionMatrix = readFileSync(
    new URL("../../ops/evidence/non_clearing/production-action-matrix.json", import.meta.url),
    "utf8"
  );
  const nextBlockersSummary = JSON.parse(
    readFileSync(new URL("../../ops/evidence/non_clearing/stage1-next-blockers-summary.json", import.meta.url), "utf8")
  );
  const releaseEvidenceClosureQueue = JSON.parse(
    readFileSync(
      new URL("../../ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json", import.meta.url),
      "utf8"
    )
  );
  const productionOperatorPackets = {
    billing: JSON.parse(
      readFileSync(new URL("../../ops/evidence/non_clearing/production-billing-operator-packet.json", import.meta.url), "utf8")
    ),
    security: JSON.parse(
      readFileSync(new URL("../../ops/evidence/non_clearing/production-security-operator-packet.json", import.meta.url), "utf8")
    ),
    legalSupport: JSON.parse(
      readFileSync(new URL("../../ops/evidence/non_clearing/production-legal-support-operator-packet.json", import.meta.url), "utf8")
    ),
    governance: JSON.parse(
      readFileSync(new URL("../../ops/evidence/non_clearing/production-governance-operator-packet.json", import.meta.url), "utf8")
    )
  };
  const repoValidate = readFileSync(new URL("../../scripts/repo_validate.sh", import.meta.url), "utf8");
  const releaseReadinessValidator = "validate_stage1_release_readiness_contract.py";

  for (const token of [
    "Release Readiness",
    "Gate Verdict",
    "Stage1 Next Blockers",
    "Stage1NextBlockersSummaryPanel",
    "data-stage1-next-blockers-summary=\"validator-derived\"",
    "data-stage1-next-blockers-summary-export",
    "data-stage1-next-blockers-summary-non-clearing",
    "data-stage1-next-blockers-summary-top-action",
    "data-stage1-next-blockers-operator-shortlist",
    "data-stage1-next-blockers-operator-shortlist-count",
    "data-stage1-next-blockers-action-packet",
    "data-stage1-next-blockers-action-packet-count",
    "operatorActionPacket",
    "Operator Action Packet",
    "requiredReturnArtifact",
    "agentCommandAfterReturn",
    "blindHandoffNote",
    "validate_stage1_next_blockers_summary.py",
    "generate_stage1_next_blockers_summary.py",
    "Operator Shortlist",
    "Top Priority Action",
    "Run Command diagnosis",
    "Azure Transport Diagnosis",
    "Azure Portal Run Command Handoff",
    "AzureRunCommandHandoffRow",
    "azureRunCommandHandoffRows",
    "data-azure-run-command-handoff=\"operator-card-derived\"",
    "data-azure-run-command-operator-card",
    "data-azure-run-command-payload",
    "data-azure-run-command-ingest",
    "data-azure-run-command-password-key-repair-viable",
    "data-azure-run-command-required",
    "ops/evidence/staging/azure-run-command-operator-card.md",
    "ops/evidence/staging/azure-run-command-ssh-repair.sh",
    "RunShellScript",
    "Azure transport lane",
    "Transport Blocked Reason",
    "Raw output persisted",
    "Safe projection flags",
    "raw_run_command_output_persisted",
    "Production Launch Blocker Matrix",
    "Stage 1 Staging Runtime",
    "Stage 1 Production Launch",
    "Production Blocker Audit",
    "Production DNS Detail",
    "Production Launch Input Packet",
    "Production Proof Bundle",
    "Production Proof Diagnostics",
    "Production Launch Source Pipeline",
    "Production Source Probe Runbook",
    "Production Proof Collection Cockpit",
    "Copy-Safe Production Commands",
    "ProductionCopySafeCommandRow",
    "productionCopySafeCommandRows",
    "ProductionCopySafeCommandListPanel",
    "data-production-copy-safe-commands=\"operator-handoff\"",
    "data-production-copy-safe-commands-non-clearing",
    "data-production-copy-safe-commands-private-env",
    "data-production-copy-safe-commands-exec-controls",
    "Command List",
    "<private-production-env>",
    "must stay gitignored and outside evidence",
    "copy-safe list does not include --apply",
    "refresh_validate",
    "dns_plan",
    "dns_readiness",
    "dns_repair_packet",
    "private_env_template",
    "proof_bundle_private_env",
    "proof_bundle_validate",
    "launch_input_packet",
    "refresh.generatorCommand",
    "refresh.validatorCommand",
    "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
    "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json || test $? -eq 2",
    "python3 scripts/generate_stage1_production_dns_repair_packet.py --operator-markdown ops/evidence/non_clearing/production-dns-operator-checklist.md",
    "inputTemplate.generatorCommand",
    "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
    "proofBundle.strictValidator",
    "python3 scripts/generate_stage1_production_launch_input_packet.py",
    "Cockpit Source Commands",
    "Cockpit Templates And Dependencies",
    "Cockpit Strict Evidence Commands",
    "Production Operator Packets",
    "Proof Input Coverage",
    "Open blocker classes",
    "production_dns_https",
    "production_paid_billing_lifecycle",
    "production_security_launch_checks",
    "production_governance_release",
    "First Missing Or Invalid Inputs",
    "Proof Statuses",
    "Production DNS Readiness",
    "Current DNS Records",
    "Authoritative DNS",
    "System Resolver",
    "HTTPS Probe Paths",
    "DNS Blocked Checks",
    "DNS Next Actions",
    "DNS Evidence Outputs",
    "Production Source Audit",
    "Missing Production Inputs",
    "Source Input Commands",
    "Packet Summary",
    "Source Probe Commands",
    "Pipeline Steps",
    "Proof Readiness",
    "Blocked Checks",
    "Proof Bundle Inputs",
    "Proof Bundle Requirements",
    "Proof Bundle Proofs",
    "Proof Bundle Steps",
    "Proof Diagnostic Summary",
    "Proof Blocked Checks",
    "Proof Safety Flags",
    "Proof Source Commands",
    "Requirement Groups",
    "Blocked Until",
    "Evidence Outputs",
    "Required Env Variable Groups",
    "Execution Order",
    "Release Bundle Preflight",
    "Azure Origin Readiness",
    "data-azure-origin-readiness=\"validator-derived\"",
    "ops/evidence/staging/stage1-azure-origin-readiness.json",
    "python3 scripts/stage1_azure_origin_readiness.py",
    "python3 scripts/validate_stage1_azure_origin_readiness.py",
    "Azure Origin Next Actions",
    "Azure Origin Repair Commands",
    "Password persisted",
    "SSH hard timeout",
    "Transport lane",
    "SSH transport phase",
    "Password/key repair viable",
    "Azure CLI preflight",
    "Repair env key",
    "sshHardTimeoutSeconds",
    "hardTimeoutSeconds",
    "hard_timeout_seconds",
    "ssh_connect_timeout",
    "transportDiagnosis",
    "transport_diagnosis",
    "Stage1AzureTransportDiagnosis",
    "sshPasswordKeyRepairViable",
    "azurePortalRunCommandRequired",
    "azureCliPreflight",
    "az_cli_missing",
    "vm_found_by_public_ip",
    "ssh_server_not_responding",
    "ssh_auth_hard_timeout",
    "localRepairPasswordEnvKey",
    "localRepairPasswordConfigured",
    "originRepairCommands",
    "originDiagnosticsCommand",
    "originRepairCommand",
    "STAGING_SSH_PASSWORD",
    "scripts/azure_staging_run_command_payload.sh",
    "ingest_azure_run_command_output.py",
    "ingest_stage1_production_return_artifacts.py",
    "sanitize_azure_run_command_output.py",
    "classify_azure_run_command_output.py",
    "azure-run-command-ssh-repair-diagnosis.json",
    "scripts/azure_staging_cli_preflight.sh",
    "RUN_AZURE_STAGING_RUN_COMMAND=1 scripts/azure_staging_run_command_invoke.sh",
    "scripts/azure_staging_password_key_repair.sh",
    "scripts/azure_staging_origin_diagnostics.sh",
    "scripts/azure_staging_origin_repair.sh",
    "networkPhase",
    "failureCategory",
    "responseBytes",
    "http_no_bytes_after_request",
    "tls_serverhello_timeout",
    "https_no_bytes_after_tls",
    "External Resource Readiness",
    "Evidence Closure Queue",
    "Provider Sandbox Handoff",
    "Stage 0 Gate Dependencies",
    "CI Evidence",
    "Validator Contract Anchors",
    "Next Operator Actions",
    "Strict Gate Checks",
    "Missing Evidence Refs",
    "Aggregate Results Rows",
    "Check-Level Pass",
    "Preserved Gate Blockers",
    "manualGoControlsEnabled",
    "decisionSource",
    "validator_evidence_only",
    "releaseGateDecision",
    "doNotLaunchConditions",
    "runtimeInputReadiness",
    "gateSafety",
    "missingEvidenceRefs",
    "resultsPresent",
    "resultRows",
    "checkLevelPassed",
    "checkLevelBlockersPreserved",
    "safetyPolicy",
    "releaseBundlePreflight",
    "stage1StagingRuntimeVerified",
    "stage1QuotaReplayVerified",
    "stage1QuotaReplayBlockingReasons",
    "stage1LoadVerified",
    "stage1LoadBlockingReasons",
    "objectRetentionCleanupVerified",
    "legalSupportVisibilityVerified",
    "ciClosureArtifactsReady",
    "productionBackupRollbackSplitReady",
    "releaseMetadataPreflightStatus",
    "releaseMetadataPreflightComplete",
    "releaseMetadataMissingSlots",
    "releaseMetadataUnverifiedSlots",
    "releaseMetadataBlockingReasons",
    "missingSlots",
    "unverifiedSlots",
    "ciClosureArtifactBlockingReasons",
    "productionBackupRollbackSplitBlockingReasons",
    "blockingReasonCount",
    "blockingReasons",
    "Stage1ExternalResourceGroup",
    "resourceReadiness",
    "operatorHandoff",
    "Operator Handoff",
    "data-external-resource-operator-handoff",
    "data-external-resource-production-handoff-refs",
    "Production Handoff Refs",
    "operatorBriefRef",
    "inputPacketRef",
    "missingInputChecklistRef",
    "sourceProbeRunbookRef",
    "Non-Clearing Refresh Summary",
    "data-external-resource-non-clearing-refresh-summary",
    "data-external-resource-non-clearing-refresh-source",
    "nonClearingRefreshSummary",
    "blockedEvidenceDetails",
    "Stage1ExternalResourceNonClearingRefreshSummary",
    "Stage1NonClearingRefreshBlockedEvidenceDetail",
    "production_dns_readiness",
    "production_dns_cutover_plan",
    "production_proof_bundle",
    "production-missing-input-checklist.json",
    "production-source-probe-runbook.json",
    "isolated staging",
    "not production server access",
    "currentBlocker",
    "Current Blocker",
    "Production Source Probes",
    "data-production-blocker-audit",
    "data-production-blocker-audit-export",
    "data-production-blocker-audit-generator",
    "data-production-blocker-audit-validator",
    "data-production-proof-bundle",
    "data-production-proof-input-coverage",
    "data-production-proof-input-coverage-field",
    "data-production-blocker-audit-non-clearing",
    "data-production-launch-operator-brief",
    "data-production-launch-operator-brief-export",
    "data-production-launch-operator-brief-generator",
    "data-production-launch-operator-brief-validator",
    "data-production-launch-operator-brief-non-clearing",
    "data-production-launch-operator-brief-redaction",
    "data-production-input-template",
    "data-production-input-template-export",
    "data-production-input-template-manifest",
    "data-production-input-template-generator",
    "data-production-input-template-validator",
    "data-production-input-template-non-clearing",
    "data-production-missing-input-checklist",
    "data-production-missing-input-checklist-export",
    "data-production-missing-input-checklist-generator",
    "data-production-missing-input-checklist-validator",
    "data-production-missing-input-checklist-non-clearing",
    "data-production-missing-input-checklist-redaction",
    "data-production-launch-input-packet",
    "data-production-launch-input-packet-export",
    "data-production-launch-input-packet-generator",
    "data-production-launch-input-packet-validator",
    "data-production-launch-input-packet-non-clearing",
    "data-production-launch-input-packet-canonical-pass-path",
    "data-production-launch-source-pipeline",
    "data-production-launch-source-pipeline-export",
    "data-production-launch-source-pipeline-runner",
    "data-production-launch-source-pipeline-validator",
    "data-production-launch-source-pipeline-non-clearing",
    "data-production-launch-source-pipeline-canonical-sources-requested",
    "data-production-source-probe-runbook",
    "data-production-source-probe-runbook-export",
    "data-production-source-probe-runbook-generator",
    "data-production-source-probe-runbook-validator",
    "data-production-source-probe-runbook-non-clearing",
    "data-production-source-probe-runbook-redaction",
    "data-production-proof-bundle-detail",
    "data-production-proof-bundle-detail-export",
    "data-production-proof-bundle-detail-runner",
    "data-production-proof-bundle-detail-validator",
    "data-production-proof-bundle-detail-non-clearing",
    "data-production-proof-bundle-detail-redaction",
    "data-production-operator-packets",
    "data-production-operator-packets-non-clearing",
    "data-production-billing-operator-packet",
    "data-production-billing-live-artifacts",
    "data-production-billing-execution-order",
    "data-production-security-operator-packet",
    "data-production-security-runtime-refs",
    "data-production-security-execution-order",
    "data-production-legal-support-operator-packet",
    "data-production-legal-support-dns-requirements",
    "data-production-legal-support-public-paths",
    "data-production-legal-support-https-probes",
    "data-production-legal-support-execution-order",
    "data-production-legal-support-operator-command-packet",
    "data-production-governance-operator-packet",
    "data-production-governance-components",
    "data-production-governance-section-refs",
    "data-production-governance-required-ids",
    "data-production-governance-execution-order",
    "variable_names_only",
    "input_variable_coverage",
    "production-blocker-audit.json",
    "production-launch-operator-brief.json",
    "production-input-template.env",
    "production-input-template.json",
    "production-missing-input-checklist.json",
    "production-proof-bundle.json",
    "production-launch-input-packet.json",
    "production-launch-source-pipeline.json",
    "production-source-probe-runbook.json",
    "production-non-clearing-refresh.json",
    "production-billing-operator-packet.json",
    "production-security-operator-packet.json",
    "production-legal-support-operator-packet.json",
    "production-governance-operator-packet.json",
    "ProductionProofStatusRow",
    "productionProofStatusRows",
    "Stage1ProductionBlockerAudit",
    "Stage1ProductionActionMatrix",
    "Stage1ProductionActionMatrixLane",
    "Stage1ProductionActionMatrixHelpItem",
    "Stage1ProductionInputTemplate",
    "Stage1ProductionInputTemplateGroup",
    "Stage1ProductionBlockerAuditSourceRow",
    "Stage1ProductionLaunchOperatorBrief",
    "Stage1ProductionLaunchOperatorBriefMatrixRow",
    "Stage1ProductionMissingInputChecklist",
    "Stage1ProductionMissingInputChecklistGroup",
    "Stage1ProductionMissingInputChecklistItem",
    "Stage1ProductionLaunchInputPacket",
    "Stage1ProductionLaunchSourcePipeline",
    "Stage1ProductionLaunchSourcePipelineStep",
    "Stage1ProductionLaunchSourcePipelineProofReadiness",
    "Stage1ProductionSourceProbeRunbook",
    "Stage1ProductionSourceProbeRunbookStep",
    "Stage1AzureOriginReadiness",
    "Stage1AzureOriginTcpProbe",
    "Stage1AzureOriginHttpProbe",
    "Stage1ProductionNonClearingRefresh",
    "Stage1ProductionNonClearingRefreshStep",
    "Stage1ProductionNonClearingRefreshActionLane",
    "Stage1ProductionProofBundle",
    "Stage1ProductionProofBundleInputGroup",
    "Stage1ProductionProofBundleRequirement",
    "Stage1ProductionProofBundleProof",
    "Stage1ProductionProofBundleStep",
    "Stage1ProductionOperatorPacket",
    "Stage1ProductionOperatorPacketRequirementGroup",
    "Stage1ProductionLaunchInputPacketSourceInput",
    "Stage1ProductionLaunchInputPacketCommandGroup",
    "Stage1ProductionLaunchInputPacketEnvGroup",
    "Stage1ProductionProofInputCoverageGroup",
    "data-production-source-probe-requirements",
    "data-production-proof-cockpit",
    "data-production-proof-cockpit-non-clearing",
    "data-production-proof-cockpit-source-commands",
    "data-production-proof-cockpit-template-refs",
    "data-production-proof-cockpit-strict-validators",
    "data-production-proof-cockpit-evidence-policy",
    "Stage1ProductionSourceProbeRequirement",
    "productionSourceProbeRequirements",
    "sourceProbeRequirements",
    "reportedByProductionAggregate",
    "source_probe_requirements",
    "production_source_probe_requirements",
    "billing-paid-lifecycle-source.json",
    "production-security-launch-source.json",
    "production-legal-support-source.json",
    "production-governance-release-source.json",
    "data-external-resource-readiness",
    "external_resource_readiness",
    "stage1-external-resource-readiness.preflight.json",
    "generate_stage1_external_resource_readiness.py",
    "validate_stage1_external_resource_readiness.py --allow-preflight",
    "r2_bucket_readiness",
    "stage1-r2-bucket-readiness.preflight.json",
    "stage1_r2_bucket_readiness.py --create-bucket",
    "validate_stage1_r2_bucket_readiness.py --allow-preflight",
    "Stage1EvidenceClosureQueueRow",
    "Stage1EvidenceClosureQueueParallelBlocker",
    "Stage1EvidenceClosureQueueOperatorActionPacketSummary",
    "Stage1EvidenceClosureQueueOperatorActionPacketItem",
    "parallel_operational_blockers",
    "operator_action_packet_summary",
    "parallelOperationalBlockers",
    "parallelOperationalBlockerCount",
    "operatorActionPacketSummary",
    "operatorActionPacketItems",
    "rowStatus",
    "completed",
    "completionPercent",
    "release_evidence_closure_queue",
    "stage1-evidence-closure-queue.preflight.json",
    "generate_stage1_release_evidence_closure_queue.py",
    "validate_stage1_release_evidence_closure_queue.py --allow-preflight",
    "fetch_stage1_ci_artifacts.py",
    "data-release-evidence-parallel-operational-blockers",
    "data-release-evidence-azure-origin-parallel-blocker",
    "data-release-evidence-operator-action-packet-summary",
    "data-release-evidence-operator-action-packet-count",
    "data-release-evidence-operator-action-packet-non-clearing",
    "Production / Azure Operator Action Packet",
    "sourceGateFlagsAllFalse",
    "operator_action_packet_items",
    "azure_origin_run_command_required",
    "non_clearing_parallel_ops_only",
    "ProviderSandboxHandoffRow",
    "data-release-evidence-closure-queue",
    "data-provider-sandbox-handoff",
    "validator-derived",
    "providerSandboxHandoffRows",
    "providerFailureCategory",
    "provider_sandbox_component",
    "provider_sandbox_result_row",
    "provider_failure_category",
    "openai_compatible_selftest",
    "provider_safe_projection",
    "data-production-launch-blocker-matrix=\"validator-derived\"",
    "data-production-launch-operator-brief=\"validator-derived\"",
    "data-production-action-matrix=\"validator-derived\"",
    "data-production-action-matrix-non-clearing",
    "data-production-non-clearing-refresh=\"validator-derived\"",
    "data-production-input-template=\"validator-derived\"",
    "data-production-missing-input-checklist=\"validator-derived\"",
    "data-production-source-probe-runbook=\"validator-derived\"",
    "data-production-dns-repair-packet=\"validator-derived\"",
    "data-production-blocker-checklist=\"validator-derived\"",
    "Production Launch Operator Brief",
    "Production Non-Clearing Refresh",
    "Production Action Matrix",
    "Production Input Template",
    "Action Lanes",
    "Refresh Action Lanes",
    "Refresh Steps",
    "Refresh Output Refs",
    "Immediate Help Queue",
    "Not Current Blockers",
    "Template Groups",
    "Commands After Fill",
    "Blank values only",
    "Production Missing Input Checklist",
    "Production DNS Repair Packet",
    "Production Blocker Checklist",
    "Short operator queue for the final production-only blockers.",
    "Checklist Sections",
    "First Blocking Rows",
    "Recommended DNS Records",
    "Cloudflare UI Steps",
    "Cloudflare API Plan",
    "Private DNS Env Template",
    "DNS Operator Command Packet",
    "DNS Verification Commands",
    "Billing Live Proof Inputs",
    "Billing Env Classification",
    "Billing Webhook Controls",
    "Required Live Stripe Artifacts",
    "Billing Numeric Controls",
    "Billing Audit Refs",
    "Billing Execution Order",
    "Billing Private Env Template",
    "Billing Operator Command Packet",
    "Security Runtime Proof Inputs",
    "Required Security Runtime Refs",
    "Security Execution Order",
    "Security Private Env Template",
    "Security Operator Command Packet",
    "Legal Support Production Proof Inputs",
    "Legal DNS HTTPS Requirements",
    "Legal HTTPS Probe Status",
    "Required Legal Support Public Paths",
    "Legal Next Actions",
    "Legal Execution Order",
    "Legal Operator Command Packet",
    "Governance Production Proof Inputs",
    "Governance Components",
    "Governance Section Refs",
    "Governance Required IDs",
    "Governance Execution Order",
    "Governance Private Env Template",
    "Governance Operator Command Packet",
    "Repair Required Inputs",
    "Repair Blocked Checks",
    "Commands After Inputs",
    "Brief Blocker Matrix",
    "Brief Open Gates",
    "Brief Next Actions",
    "Checklist Groups",
    "Blocking Input Items",
    "Checklist Next Actions",
    "generate_stage1_production_launch_operator_brief.py",
    "generate_stage1_production_action_matrix.py",
    "validate_stage1_production_action_matrix.py",
    "generate_stage1_production_input_template.py",
    "validate_stage1_production_input_template.py",
    "validate_stage1_production_launch_operator_brief.py",
    "generate_stage1_production_missing_input_checklist.py",
    "validate_stage1_production_missing_input_checklist.py",
    "generate_stage1_production_source_probe_runbook.py",
    "validate_stage1_production_source_probe_runbook.py",
    "generate_stage1_production_dns_repair_packet.py",
    "validate_stage1_production_dns_repair_packet.py",
    "provider_quota_unavailable",
    "provider_retryable_http_error",
    "provider_http_error",
    "ops/evidence/staging/stage1-provider-sandbox.json + .ndjson",
    "scripts/openai_compatible_provider_selftest.sh --contract-only",
    "python3 scripts/validate_stage1_provider_sandbox_evidence.py --contract-only",
    "rawProviderPayloadPersisted",
    "--allow-preflight",
  ]) {
    assert.match(releasePage, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const token of [
    "stage1.production_action_matrix.v1",
    "staging aggregate is already go",
    "R2 zenari bucket is already a staging resource, not the current production blocker",
    "Stripe sandbox is not the current blocker; live mode proof is required",
    "z.ai/OpenAI-compatible LLM is not the current blocker",
    "worker/crawler/migrate are backend runtime entrypoints, not release images",
    "manager is legacy local-only and not a release surface",
    "Provide PRODUCTION_DNS_TARGET plus Cloudflare zone/token, or apply the apex/www records manually.",
    "Use live Stripe mode and collect sanitized live checkout, subscription, invoice, refund, quota, and webhook IDs.",
    "Attach production runtime refs for session cookie, CSRF, redaction, admin privacy, key containment, CSP, RBAC, audit, and spend caps.",
    "Provide activation, abuse, and skill release runtime request IDs plus immutable production audit refs."
  ]) {
    assert.match(productionActionMatrix, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.equal(nextBlockersSummary.schema_version, "stage1.next_blockers_summary.v1");
  assert.equal(nextBlockersSummary.status, "blocked");
  assert.equal(nextBlockersSummary.release_gate_decision, "no_go");
  assert.equal(nextBlockersSummary.can_clear_stage1_production_launch_gate, false);
  assert.equal(nextBlockersSummary.can_close_do_not_launch, false);
  assert.equal(nextBlockersSummary.secret_material_persisted, false);
  assert.equal(nextBlockersSummary.raw_run_command_output_persisted, false);
  for (const key of ["completed", "total", "open", "completion_percent", "open_gates"]) {
    assert.deepEqual(nextBlockersSummary.stage1[key], releaseEvidenceClosureQueue.queue_summary[key]);
  }
  assert.equal(nextBlockersSummary.production_inputs.configured, 2);
  assert.equal(nextBlockersSummary.production_inputs.total, 60);
  assert.equal(nextBlockersSummary.production_source_probes.ready, 0);
  assert.equal(nextBlockersSummary.production_source_probes.total, 4);
  assert.equal(nextBlockersSummary.azure_origin.status, "pass");
  assert.equal(nextBlockersSummary.azure_origin.http_passed, 4);
  assert.equal(nextBlockersSummary.azure_origin.http_total, 6);
  assert.equal(nextBlockersSummary.azure_origin.ssh_status, "pass");
  assert.equal(nextBlockersSummary.azure_origin.ssh_reason, "ssh_key_auth_ok");
  assert.equal(nextBlockersSummary.azure_origin.azure_portal_run_command_required, false);
  assert.equal(nextBlockersSummary.azure_origin.http_response_started, true);
  assert.deepEqual(nextBlockersSummary.azure_origin.blocked_checks, []);
  assert.equal(nextBlockersSummary.azure_run_command_diagnosis.status, "superseded");
  assert.equal(nextBlockersSummary.azure_run_command_diagnosis.source_status, "blocked");
  assert.equal(nextBlockersSummary.azure_run_command_diagnosis.superseded_by, "azure_origin_pass");
  assert.deepEqual(nextBlockersSummary.azure_run_command_diagnosis.findings, []);
  assert.deepEqual(nextBlockersSummary.azure_run_command_diagnosis.source_findings, ["missing_output"]);
  assert.equal(nextBlockersSummary.operator_shortlist.length, 4);
  assert.deepEqual(
    nextBlockersSummary.operator_shortlist.map((item) => item.item_id),
    [
      "production_dns_https",
      "production_live_billing",
      "production_security_runtime",
      "production_governance_release"
    ]
  );
  assert.equal(nextBlockersSummary.operator_shortlist[0].gate_impact, "non_clearing_operator_shortlist_only");
  assert.equal(nextBlockersSummary.operator_shortlist[3].gate_impact, "non_clearing_operator_shortlist_only");
  assert.equal(nextBlockersSummary.operator_shortlist[3].can_close_do_not_launch, false);
  assert.ok([4, 5].includes(nextBlockersSummary.operator_action_packet.length));
  const actionPacketById = Object.fromEntries(nextBlockersSummary.operator_action_packet.map((item) => [item.item_id, item]));
  if (nextBlockersSummary.top_priority_action.action_id === "production_source_probes_missing") {
    assert.equal(nextBlockersSummary.operator_action_packet[0].item_id, "production_source_probes_missing");
    assert.match(nextBlockersSummary.top_priority_action.command, /ingest_stage1_production_return_artifacts\.py/);
  } else if (nextBlockersSummary.top_priority_action.action_id === "production_dns_https") {
    assert.match(nextBlockersSummary.top_priority_action.command, /stage1_production_dns_cutover_plan\.py/);
  }
  assert.match(JSON.stringify(nextBlockersSummary.operator_action_packet), /ingest_stage1_production_return_artifacts\.py/);
  assert.equal(actionPacketById.production_dns_https.owner, "operator_cloudflare_dns");
  assert.equal(actionPacketById.production_dns_https.agent_command_after_return.includes("stage1_production_dns_cutover_plan.py"), true);
  assert.equal(actionPacketById.production_dns_https.validation_after_return.includes("stage1_production_dns_readiness.py"), true);
  assert.match(actionPacketById.production_dns_https.blind_handoff_note, /R2 S3/);
  assert.equal(actionPacketById.production_live_billing.owner, "operator_production_account");
  assert.match(actionPacketById.production_live_billing.required_return_artifact, /Stripe live/);
  assert.equal(actionPacketById.azure_run_command_output_missing, undefined);
  assert.ok(["production_source_probes_missing", "production_dns_https"].includes(nextBlockersSummary.top_priority_action.action_id));

  for (const [packetId, packet] of Object.entries(productionOperatorPackets)) {
    assert.equal(packet.environment, "production", `${packetId} packet environment`);
    assert.equal(packet.status, "blocked", `${packetId} packet status`);
    assert.equal(packet.release_gate_decision, "no_go", `${packetId} packet release decision`);
    assert.equal(packet.non_clearing_operator_packet, true, `${packetId} packet non-clearing`);
    assert.equal(packet.can_clear_stage1_production_launch_gate, false, `${packetId} packet launch gate safety`);
    assert.equal(packet.can_close_do_not_launch, false, `${packetId} packet DNL safety`);
    assert.equal(packet.canonical_pass_path, false, `${packetId} packet canonical pass path`);
    assert.equal(packet.secret_material_persisted, false, `${packetId} packet secret safety`);
    assert.equal(packet.authorization_header_persisted, false, `${packetId} packet auth header safety`);
    assert.equal(packet.cookie_persisted, false, `${packetId} packet cookie safety`);
    assert.equal(packet.raw_provider_payload_persisted, false, `${packetId} packet provider payload safety`);
    assert.equal(packet.raw_stripe_payload_persisted, false, `${packetId} packet Stripe payload safety`);
    assert.equal(packet.raw_support_body_projected, false, `${packetId} packet support body safety`);
    assert.ok(packet.blocked_until.length > 0, `${packetId} packet blocked_until`);
    assert.ok(packet.execution_order.length > 0, `${packetId} packet execution_order`);
    assert.ok(Object.keys(packet.evidence_outputs).length > 0, `${packetId} packet evidence_outputs`);
    assert.equal(packet.source_probe.canonical_source_exists, false, `${packetId} packet canonical source`);
  }

  assert.equal(productionOperatorPackets.billing.schema_version, "stage1.production_billing_operator_packet.v1");
  assert.equal(productionOperatorPackets.billing.release_gate_check_id, "production_paid_billing_lifecycle");
  assert.equal(productionOperatorPackets.billing.required_live_artifacts.length, 14);
  assert.equal(productionOperatorPackets.billing.required_numeric_controls.length, 5);
  assert.equal(Object.keys(productionOperatorPackets.billing.required_webhook_controls).length, 5);
  assert.equal(productionOperatorPackets.billing.required_audit_refs.length, 14);
  assert.equal(productionOperatorPackets.billing.execution_order.length, 7);
  assert.equal(productionOperatorPackets.billing.blocked_until.length, 8);
  assert.equal(productionOperatorPackets.billing.sandbox_scope.sandbox_can_clear_production_live_billing, false);
  assert.equal(productionOperatorPackets.billing.live_mode_prerequisites.sandbox_can_clear_production_live_billing, false);
  assert.ok(productionOperatorPackets.billing.sandbox_scope.live_billing_requires.includes("STRIPE_MODE=live"));
  assert.ok(
    productionOperatorPackets.billing.blocked_until.includes(
      "Stripe sandbox/test configuration is replaced with production live-mode billing proof inputs"
    )
  );
  assert.equal(Object.keys(productionOperatorPackets.billing.evidence_outputs).length, 6);
  assert.equal(productionOperatorPackets.billing.required_live_artifacts[0].flag, "--checkout-session-id");
  assert.equal(productionOperatorPackets.billing.required_live_artifacts[0].prefix, "cs_live_");
  assert.equal(productionOperatorPackets.billing.private_env_template.path_placeholder, "<private-production-env>");
  assert.equal(productionOperatorPackets.billing.private_env_template.gitignore_required, true);
  assert.equal(productionOperatorPackets.billing.private_env_template.blank_values_only, true);
  assert.equal(productionOperatorPackets.billing.private_env_template.template_lines.length, 45);
  assert.ok(productionOperatorPackets.billing.private_env_template.template_lines.includes("STRIPE_MODE="));
  assert.ok(productionOperatorPackets.billing.private_env_template.template_lines.includes("STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID="));
  assert.ok(productionOperatorPackets.billing.private_env_template.template_lines.includes("STAGE1_PROD_BILLING_WEBHOOK_IDEMPOTENCY_REF="));
  assert.equal(productionOperatorPackets.billing.operator_command_packet.length, 6);
  assert.deepEqual(
    productionOperatorPackets.billing.operator_command_packet.map((row) => row.step_id),
    [
      "run_private_env_proof_bundle",
      "validate_live_billing_candidate_or_diagnostic",
      "run_billing_source_probe_after_candidate_passes",
      "generate_strict_billing_evidence",
      "validate_strict_billing_evidence",
      "refresh_non_clearing_summary"
    ]
  );
  assert.equal(
    productionOperatorPackets.billing.operator_command_packet.filter((row) => row.may_write_canonical_source).length,
    1
  );
  assert.equal(
    productionOperatorPackets.billing.operator_command_packet.find((row) => row.may_write_canonical_source).requires_review,
    true
  );
  assert.match(productionOperatorPackets.billing.operator_command_packet[0].command, /<private-production-env>/);

  assert.equal(productionOperatorPackets.security.schema_version, "stage1.production_security_operator_packet.v1");
  assert.equal(productionOperatorPackets.security.release_gate_check_id, "production_security_launch_checks");
  assert.equal(productionOperatorPackets.security.required_security_runtime_refs.length, 10);
  assert.equal(productionOperatorPackets.security.execution_order.length, 7);
  assert.equal(productionOperatorPackets.security.blocked_until.length, 12);
  assert.equal(Object.keys(productionOperatorPackets.security.evidence_outputs).length, 5);
  assert.equal(productionOperatorPackets.security.required_security_runtime_refs[0].flag, "--secure-session-cookie-ref");
  assert.equal(productionOperatorPackets.security.required_security_runtime_refs[0].section, "secure_session_cookie");
  assert.equal(productionOperatorPackets.security.private_env_template.path_placeholder, "<private-production-env>");
  assert.equal(productionOperatorPackets.security.private_env_template.gitignore_required, true);
  assert.equal(productionOperatorPackets.security.private_env_template.blank_values_only, true);
  assert.equal(productionOperatorPackets.security.private_env_template.template_lines.length, 13);
  assert.ok(productionOperatorPackets.security.private_env_template.template_lines.includes("STAGE1_PROD_SECURITY_SAME_SITE="));
  assert.ok(productionOperatorPackets.security.private_env_template.template_lines.includes("STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF="));
  assert.ok(productionOperatorPackets.security.private_env_template.template_lines.includes("STAGE1_PROD_SECURITY_AUDIT_REF="));
  assert.equal(productionOperatorPackets.security.operator_command_packet.length, 6);
  assert.deepEqual(
    productionOperatorPackets.security.operator_command_packet.map((row) => row.step_id),
    [
      "run_private_env_proof_bundle",
      "validate_security_candidate_or_diagnostic",
      "run_security_source_probe_after_candidate_passes",
      "generate_strict_security_evidence",
      "validate_strict_security_evidence",
      "refresh_non_clearing_summary"
    ]
  );
  assert.equal(
    productionOperatorPackets.security.operator_command_packet.filter((row) => row.may_write_canonical_source).length,
    1
  );
  assert.equal(
    productionOperatorPackets.security.operator_command_packet.find((row) => row.may_write_canonical_source).requires_review,
    true
  );
  assert.match(productionOperatorPackets.security.operator_command_packet[0].command, /<private-production-env>/);

  assert.equal(productionOperatorPackets.legalSupport.schema_version, "stage1.production_legal_support_operator_packet.v1");
  assert.equal(productionOperatorPackets.legalSupport.release_gate_check_id, "production_legal_support_policy");
  assert.equal(Object.keys(productionOperatorPackets.legalSupport.required_dns_and_https).length, 6);
  assert.equal(productionOperatorPackets.legalSupport.required_public_paths.length, 9);
  assert.equal(productionOperatorPackets.legalSupport.dns_readiness.production_paths.length, 8);
  assert.equal(productionOperatorPackets.legalSupport.operator_next_actions.length, 6);
  assert.equal(productionOperatorPackets.legalSupport.execution_order.length, 10);
  assert.equal(productionOperatorPackets.legalSupport.blocked_until.length, 7);
  assert.equal(Object.keys(productionOperatorPackets.legalSupport.evidence_outputs).length, 6);
  assert.equal(productionOperatorPackets.legalSupport.required_public_paths[0].path, "/legal/terms");
  assert.ok(productionOperatorPackets.legalSupport.required_public_paths.some((path) => path.path === "/report-problem"));
  assert.equal(productionOperatorPackets.legalSupport.operator_command_packet.length, 9);
  assert.deepEqual(
    productionOperatorPackets.legalSupport.operator_command_packet.map((row) => row.step_id),
    [
      "plan_dns_cutover_with_private_env",
      "verify_cloudflare_scope_before_apply",
      "apply_dns_cutover_after_review",
      "refresh_dns_readiness",
      "run_legal_support_source_probe_after_https_passes",
      "generate_strict_legal_support_evidence",
      "validate_strict_legal_support_evidence",
      "refresh_production_launch_evidence",
      "validate_production_launch_evidence"
    ]
  );
  assert.equal(
    productionOperatorPackets.legalSupport.operator_command_packet.filter((row) => row.may_apply_production_dns).length,
    1
  );
  assert.equal(
    productionOperatorPackets.legalSupport.operator_command_packet.find((row) => row.may_apply_production_dns).requires_review,
    true
  );
  assert.equal(
    productionOperatorPackets.legalSupport.operator_command_packet.filter((row) => row.may_write_canonical_source).length,
    1
  );
  assert.equal(
    productionOperatorPackets.legalSupport.operator_command_packet.find((row) => row.may_write_canonical_source).requires_review,
    true
  );
  assert.match(productionOperatorPackets.legalSupport.operator_command_packet[0].command, /<private-production-env>/);
  assert.match(productionOperatorPackets.legalSupport.operator_command_packet[1].command, /--verify-cloudflare/);
  assert.match(productionOperatorPackets.legalSupport.operator_command_packet[4].command, /--production-web-url https:\/\/zenari\.ai/);

  assert.equal(productionOperatorPackets.governance.schema_version, "stage1.production_governance_operator_packet.v1");
  assert.equal(productionOperatorPackets.governance.release_gate_check_id, "production_governance_release");
  assert.deepEqual(
    productionOperatorPackets.governance.required_governance_components.map((component) => component.component),
    ["activation", "abuse", "skill"]
  );
  assert.equal(
    productionOperatorPackets.governance.required_governance_components.reduce(
      (total, component) => total + component.required_section_refs.length,
      0
    ),
    15
  );
  assert.equal(
    productionOperatorPackets.governance.required_governance_components.reduce(
      (total, component) => total + (component.required_ids ?? []).length,
      0
    ),
    5
  );
  assert.equal(productionOperatorPackets.governance.execution_order.length, 7);
  assert.equal(productionOperatorPackets.governance.blocked_until.length, 9);
  assert.equal(Object.keys(productionOperatorPackets.governance.evidence_outputs).length, 7);
  assert.equal(productionOperatorPackets.governance.private_env_template.path_placeholder, "<private-production-env>");
  assert.equal(productionOperatorPackets.governance.private_env_template.gitignore_required, true);
  assert.equal(productionOperatorPackets.governance.private_env_template.blank_values_only, true);
  assert.equal(productionOperatorPackets.governance.private_env_template.template_lines.length, 27);
  assert.ok(productionOperatorPackets.governance.private_env_template.template_lines.includes("STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS="));
  assert.ok(productionOperatorPackets.governance.private_env_template.template_lines.includes("STAGE1_PROD_GOVERNANCE_SKILL_CANARY_SAMPLE_SIZE="));
  assert.ok(productionOperatorPackets.governance.private_env_template.template_lines.includes("STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_REF="));
  assert.equal(productionOperatorPackets.governance.operator_command_packet.length, 6);
  assert.deepEqual(
    productionOperatorPackets.governance.operator_command_packet.map((row) => row.step_id),
    [
      "run_private_env_proof_bundle",
      "validate_governance_candidate_or_diagnostic",
      "run_governance_source_probe_after_candidate_passes",
      "generate_strict_governance_evidence",
      "validate_strict_governance_evidence",
      "refresh_non_clearing_summary"
    ]
  );
  assert.equal(
    productionOperatorPackets.governance.operator_command_packet.filter((row) => row.may_write_canonical_source).length,
    1
  );
  assert.equal(
    productionOperatorPackets.governance.operator_command_packet.find((row) => row.may_write_canonical_source).requires_review,
    true
  );
  assert.match(productionOperatorPackets.governance.operator_command_packet[0].command, /<private-production-env>/);
  assert.ok(
    productionOperatorPackets.governance.required_governance_components
      .flatMap((component) => component.required_ids ?? [])
      .some((requiredId) => requiredId.flag === "--skill-release-notes-id")
  );

  for (const token of [
    "getStage1ReleaseReadiness",
    "Stage1ReleaseReadinessSnapshot",
    "nextBlockersSummary",
    "Stage1NextBlockersSummary",
    "operatorShortlist",
    "mapStage1NextBlockersSummary",
    "missingStage1NextBlockersSummary",
    "mapStage1NextBlockersOperatorShortlistItem",
    "summarizeStage1NextBlockersSummaryActions",
    "productionBlockerAudit",
    "productionLaunchOperatorBrief",
    "productionActionMatrix",
    "productionInputTemplate",
    "productionMissingInputChecklist",
    "productionSourceProbeRunbook",
    "productionDnsDetail",
    "productionLaunchInputPacket",
    "productionOperatorPackets",
    "productionLaunchSourcePipeline",
    "productionProofBundle",
    "productionProofDiagnostics",
    "productionNonClearingRefresh",
    "Stage1ProductionBlockerAudit",
    "Stage1ProductionLaunchOperatorBrief",
    "Stage1ProductionLaunchOperatorBriefSummary",
    "Stage1ProductionLaunchOperatorBriefDiagnostic",
    "Stage1ProductionLaunchOperatorBriefMatrixRow",
    "Stage1ProductionMissingInputChecklist",
    "Stage1ProductionMissingInputChecklistSummary",
    "Stage1ProductionMissingInputChecklistGroup",
    "Stage1ProductionMissingInputChecklistItem",
    "Stage1ProductionDnsDetail",
    "Stage1ProductionDnsProbeRow",
    "Stage1ProductionDnsRepairPacket",
    "Stage1ProductionDnsRepairPacketSummary",
    "Stage1ProductionProofInputCoverage",
    "Stage1ProductionProofInputCoverageGroup",
    "Stage1ProductionBlockerAuditSourceRow",
    "Stage1ProductionLaunchInputPacket",
    "Stage1ProductionLaunchSourcePipeline",
    "Stage1ProductionLaunchSourcePipelineStep",
    "Stage1ProductionLaunchSourcePipelineProofReadiness",
    "Stage1ProductionNonClearingRefresh",
    "Stage1ProductionNonClearingRefreshStep",
    "Stage1ProductionNonClearingRefreshActionLane",
    "Stage1ProductionProofBundle",
    "Stage1ProductionProofBundleProof",
    "Stage1ProductionProofBundleStep",
    "Stage1ProductionProofBundleInputGroup",
    "Stage1ProductionProofBundleRequirement",
    "Stage1ProductionProofDiagnostics",
    "Stage1ProductionProofDiagnostic",
    "Stage1ProductionProofDiagnosticFlag",
    "Stage1ProductionOperatorPacket",
    "Stage1ProductionOperatorPacketSourceProbe",
    "Stage1ProductionOperatorPacketProof",
    "Stage1ProductionOperatorPacketRequirementGroup",
    "Stage1ProductionBillingLiveArtifact",
    "Stage1ProductionBillingNumericControl",
    "Stage1ProductionBillingWebhookControl",
    "Stage1ProductionBillingPrivateEnvTemplate",
    "Stage1ProductionBillingOperatorCommand",
    "Stage1ProductionSecurityRuntimeRef",
    "Stage1ProductionLaunchInputPacketSourceInput",
    "Stage1ProductionLaunchInputPacketCommandGroup",
    "Stage1ProductionLaunchInputPacketEnvGroup",
    "Stage1AggregateEvidence",
    "Stage1ReleaseBundlePreflight",
    "mapStage1ProductionSourceProbeRequirement",
    "mapStage1AzureOriginReadiness",
    "mapStage1AzureTransportDiagnosis",
    "missingStage1AzureOriginReadiness",
    "summarizeAzureOriginReadinessActions",
    "azureOriginReadiness",
    "mapStage1ProductionBlockerAudit",
    "mapStage1ProductionActionMatrix",
    "mapStage1ProductionActionMatrixLane",
    "mapStage1ProductionActionMatrixHelpItem",
    "summarizeProductionActionMatrixActions",
    "mapStage1ProductionInputTemplate",
    "mapStage1ProductionInputTemplateGroup",
    "missingStage1ProductionInputTemplate",
    "summarizeProductionInputTemplateActions",
    "mapStage1ProductionLaunchOperatorBrief",
    "mapStage1ProductionLaunchOperatorBriefMatrixRow",
    "missingStage1ProductionLaunchOperatorBrief",
    "summarizeProductionLaunchOperatorBriefActions",
    "mapStage1ProductionMissingInputChecklist",
    "mapStage1ProductionMissingInputChecklistGroup",
    "mapStage1ProductionMissingInputChecklistItem",
    "missingStage1ProductionMissingInputChecklist",
    "summarizeProductionMissingInputChecklistActions",
    "mapStage1ProductionProofInputCoverage",
    "mapStage1ProductionBlockerAuditSourceRow",
    "missingStage1ProductionBlockerAudit",
    "summarizeProductionBlockerAuditActions",
    "mapStage1ProductionDnsDetail",
    "missingStage1ProductionDnsDetail",
    "mapStage1ProductionDnsRepairPacket",
    "mapStage1ProductionDnsProbeRecord",
    "mapStage1ProductionDnsProbeRow",
    "summarizeProductionDnsDetailActions",
    "mapStage1ProductionLaunchInputPacket",
    "mapStage1ProductionLaunchInputPacketSourceInput",
    "missingStage1ProductionLaunchInputPacket",
    "summarizeProductionLaunchInputPacketActions",
    "mapStage1ProductionLaunchSourcePipeline",
    "mapStage1ProductionLaunchSourcePipelineStep",
    "mapStage1ProductionLaunchSourcePipelineProofReadiness",
    "missingStage1ProductionLaunchSourcePipeline",
    "summarizeProductionLaunchSourcePipelineActions",
    "mapStage1ProductionNonClearingRefresh",
    "mapStage1ProductionNonClearingRefreshProgress",
    "mapStage1ProductionNonClearingRefreshStep",
    "missingStage1ProductionNonClearingRefresh",
    "summarizeProductionNonClearingRefreshActions",
    "mapStage1ProductionProofBundle",
    "mapStage1ProductionProofBundleInputGroups",
    "mapStage1ProductionProofBundleRequirement",
    "mapStage1ProductionProofBundleProofs",
    "mapStage1ProductionProofBundleStep",
    "missingStage1ProductionProofBundle",
    "mapStage1ProductionProofDiagnostics",
    "mapStage1ProductionProofDiagnostic",
    "missingStage1ProductionProofDiagnostic",
    "mapStage1ProductionProofDiagnosticSafetyFlags",
    "summarizeProductionProofBundleActions",
    "summarizeProductionProofDiagnosticsActions",
    "proofBundleRequirementStatus",
    "mapStage1ProductionOperatorPacket",
    "mapStage1ProductionOperatorPacketSourceProbe",
    "mapStage1ProductionOperatorPacketProof",
    "mapStage1ProductionOperatorPacketRequirementGroups",
    "missingStage1ProductionOperatorPacket",
    "summarizeProductionOperatorPacketActions",
    "Stage1AggregateGateSafety",
    "Stage1AggregateGateCheck",
    "Stage1AggregateResultRow",
    "Stage1MissingEvidenceRef",
    "Stage1ReleaseReadinessComponent",
    "buildStage1AggregateGateSafety",
    "extractStage1MissingEvidenceRefs",
    "readNdjsonIfPresent",
    "mapStage1AggregateResultRow",
    "mapStage1ReleaseBundlePreflight",
    "strictGateReady",
    "strictGateBlockers",
    "missingEvidenceRefs",
    "checkLevelEvidenceRefs",
    "stage1-runtime.ndjson",
    "stage1-production-launch.ndjson",
    "manualGoControlsEnabled: false",
    "release_bundle_preflight",
    "stage1_staging_runtime_verified",
    "stage1_quota_replay_verified",
    "stage1_quota_replay_blocking_reasons",
    "stage1_load_verified",
    "stage1_load_blocking_reasons",
    "object_retention_cleanup_verified",
    "legal_support_visibility_verified",
    "ci_closure_artifacts_ready",
    "production_backup_rollback_split_ready",
    "release_metadata_preflight",
    "release_metadata_blocking_reasons",
    "missing_slots",
    "unverified_slots",
    "ci_closure_artifact_blocking_reasons",
    "production_backup_rollback_split_blocking_reasons",
    "blocking_reason_count",
    "blocking_reasons",
    "resourceReadiness",
    "productionBlockerAudit",
    "productionLaunchOperatorBrief",
    "productionMissingInputChecklist",
    "productionDnsDetail",
    "productionLaunchInputPacket",
    "productionOperatorPackets",
    "productionLaunchSourcePipeline",
    "productionProofBundle",
    "productionProofDiagnostics",
    "production-blocker-audit.json",
    "production-launch-operator-brief.json",
    "production-missing-input-checklist.json",
    "production-launch-input-packet.json",
    "production-launch-source-pipeline.json",
    "production-proof-bundle.json",
    "production-non-clearing-refresh.json",
    "production-dns-readiness.json",
    "production-dns-cutover-plan.json",
    "production-dns-repair-packet.json",
    "production-blocker-checklist.md",
    "production-action-matrix.json",
    "production-action-matrix.md",
    "production-input-template.env",
    "production-input-template.json",
    "recommendedRecords",
    "mapStage1ProductionDnsRecommendedRecord",
    "cloudflareUiSteps",
    "cloudflareApiPlan",
    "verificationCommands",
    "production-live-billing-proof.blocked.json",
    "production-security-proof.blocked.json",
    "production-governance-proof.blocked.json",
    "stage1_production_dns_readiness.py",
    "stage1_production_dns_cutover_plan.py",
    "generate_stage1_production_dns_repair_packet.py",
    "generate_stage1_production_blocker_checklist.py",
    "validate_stage1_production_dns_readiness.py",
    "validate_stage1_production_dns_cutover_plan.py",
    "validate_stage1_production_dns_repair_packet.py",
    "validate_stage1_production_blocker_checklist.py",
    "configured_input_variable_names",
    "missing_required_inputs",
    "invalid_required_inputs",
    "accepted_variable_names",
    "configured_variable_name",
    "acceptable_evidence_source",
    "acceptable_evidence_sources",
    "acceptableEvidenceSources",
    "disallowed_substitutes",
    "disallowedSubstitutes",
    "can_be_satisfied_by_existing_sandbox_or_staging_resources",
    "canBeSatisfiedByExistingSandboxOrStagingResources",
    "stripe_sandbox_test_mode",
    "stripe_test_keys",
    "live_stripe_production_billing_evidence",
    "requirement_id",
    "display_name",
    "non_clearing_pipeline_summary",
    "proof_readiness",
    "aggregate_attempted",
    "canonical_sources_requested",
    "canonical_sources_may_be_written",
    "blocked_checks",
    "production-billing-operator-packet.json",
    "production-security-operator-packet.json",
    "production-legal-support-operator-packet.json",
    "production-governance-operator-packet.json",
    "required_live_artifacts",
    "billingLiveArtifacts",
    "billingNumericControls",
    "billingWebhookControls",
    "billingAuditRefs",
    "billingExecutionOrder",
    "billingPrivateEnvTemplate",
    "billingOperatorCommandPacket",
    "securityPrivateEnvTemplate",
    "securityOperatorCommandPacket",
    "governancePrivateEnvTemplate",
    "governanceOperatorCommandPacket",
    "Stage1ProductionPrivateEnvTemplate",
    "Stage1ProductionOperatorCommand",
    "mapBillingLiveArtifact",
    "mapBillingNumericControl",
    "mapBillingWebhookControls",
    "mapBillingOperatorCommand",
    "mapBillingEnvClassification",
    "required_security_runtime_refs",
    "securityRuntimeRefs",
    "securityExecutionOrder",
    "mapSecurityRuntimeRef",
    "legalDnsRequirements",
    "legalPublicPaths",
    "legalHttpsProbes",
    "legalOperatorNextActions",
    "legalExecutionOrder",
    "mapLegalDnsRequirements",
    "mapLegalPublicPath",
    "mapLegalHttpsProbes",
    "governanceComponents",
    "governanceSectionRefs",
    "governanceRequiredIds",
    "governanceExecutionOrder",
    "mapGovernanceComponents",
    "mapGovernanceSectionRefs",
    "mapGovernanceRequiredIds",
    "required_dns_and_https",
    "required_public_paths",
    "required_governance_components",
    "non_clearing_operator_packet",
    "blocked_until",
    "evidence_outputs",
    "source_probe",
    "production_proof_bundle",
    "input_variable_coverage",
    "blocking_input_count",
    "requiredCompletionPercent",
    "required_completion_percent",
    "first_missing_or_invalid_inputs",
    "variable_names_only",
    "production_source_audit",
    "open_source_probe_ids",
    "non_clearing_operator_brief",
    "blocker_matrix",
    "operator_next_actions",
    "production_inputs_completion_percent",
    "production_inputs_configured",
    "production_inputs_total",
    "blocking_input_count",
    "production_dns_readiness",
    "stripe_sandbox_is_not_current_blocker",
    "staging_is_not_current_blocker",
    "non_clearing_input_packet",
    "required_env_variable_groups",
    "source_inputs",
    "execution_order",
    "canonical_write_policy",
    "canonicalWritePolicy",
    "canonicalPassPath",
    "Stage1ExternalResourceReadiness",
    "Stage1ExternalResourceGroup",
    "Stage1ExternalResourceHandoff",
    "Stage1EvidenceClosureQueue",
    "Stage1EvidenceClosureQueueRow",
    "Stage1EvidenceClosureQueueParallelBlocker",
    "Stage1EvidenceClosureQueueOperatorActionPacketSummary",
    "Stage1EvidenceClosureQueueOperatorActionPacketItem",
    "parallel_operational_blockers",
    "operator_action_packet_summary",
    "parallelOperationalBlockers",
    "parallelOperationalBlockerCount",
    "operatorActionPacketSummary",
    "operatorActionPacketItems",
    "rowStatus",
    "completionPercent",
    "completed",
    "readyPercent",
    "operatorAsk",
    "operatorHandoff",
    "mapStage1ExternalResourceHandoff",
    "missingStage1ExternalResourceHandoff",
    "operator_handoff",
    "current_loop_breaker",
    "commands_after_inputs",
    "private_env_template",
    "operator_command_packet",
    "privateEnvTemplate",
    "operatorCommandPacket",
    "Stage1ProductionDnsPrivateEnvTemplate",
    "Stage1ProductionDnsOperatorCommand",
    "input_packet_ref",
    "operator_brief_ref",
    "source_probe_runbook_ref",
    "currentBlocker",
    "current_blocker",
    "closureQueue",
    "mapStage1EvidenceClosureQueue",
    "missingStage1EvidenceClosureQueue",
    "mapStage1EvidenceClosureQueueParallelBlocker",
    "mapStage1EvidenceClosureQueueOperatorActionPacketSummary",
    "mapStage1ExternalResourceReadiness",
    "missingStage1ExternalResourceReadiness",
    "external_resource_readiness",
    "stage1-external-resource-readiness.preflight.json",
    "generate_stage1_external_resource_readiness.py",
    "validate_stage1_external_resource_readiness.py",
    "validate_stage1_r2_bucket_readiness.py",
    "stage1-r2-bucket-readiness.preflight.json",
    "llm_zai_openai_compatible",
    "r2_zenari_bucket",
    "staging_public_urls",
    "staging_admin_access",
    "staging_quota_replay_db",
    "ci_exact_artifacts",
    "production_launch_inputs",
    "stage1StagingRuntimeVerified",
    "stage1QuotaReplayVerified",
    "stage1QuotaReplayBlockingReasons",
    "stage1LoadVerified",
    "stage1LoadBlockingReasons",
    "objectRetentionCleanupVerified",
    "legalSupportVisibilityVerified",
    "ciClosureArtifactsReady",
    "productionBackupRollbackSplitReady",
    "releaseMetadataPreflightStatus",
    "releaseMetadataPreflightComplete",
    "releaseMetadataMissingSlots",
    "releaseMetadataUnverifiedSlots",
    "releaseMetadataBlockingReasons",
    "missingSlots",
    "unverifiedSlots",
    "ciClosureArtifactBlockingReasons",
    "productionBackupRollbackSplitBlockingReasons",
    "blockingReasonCount",
    "blockingReasons",
    "ops/evidence/staging/stage1-runtime.json",
    "ops/evidence/production/stage1-production-launch.json",
    "fixtures/stage1/staging_runtime/local_contract.json",
    "fixtures/stage1/production_launch/local_contract.json",
    "fixtures/stage1/release_evidence_closure_queue/local_contract.json",
    "fixtures/stage1/external_resource_readiness/local_contract.json",
    "python3 scripts/validate_stage1_staging_runtime.py",
    "python3 scripts/validate_stage1_staging_runtime.py --allow-preflight",
    "python3 scripts/validate_stage1_production_launch.py",
    "python3 scripts/validate_stage1_production_launch.py --allow-preflight",
    "python3 scripts/generate_stage1_staging_runtime_evidence.py",
    "python3 scripts/generate_stage1_production_launch_evidence.py",
    "python3 scripts/generate_stage1_release_evidence_closure_queue.py",
    "python3 scripts/validate_stage1_release_evidence_closure_queue.py --allow-preflight",
    "python3 scripts/generate_stage1_external_resource_readiness.py",
    "python3 scripts/validate_stage1_external_resource_readiness.py --allow-preflight",
    "load_ready",
    "quota_replay_ready",
    "stage1_quota_replay_verified",
    "stage1_quota_replay_blocking_reasons",
    "stage1_load_verified",
    "stage1_load_blocking_reasons",
    "evidence_closure_queue",
    "release_evidence_closure_queue",
    "stage1-evidence-closure-queue.preflight.json",
    "generate_stage1_release_evidence_closure_queue.py",
    "validate_stage1_release_evidence_closure_queue.py",
    "provider_sandbox_handoff",
    "provider_failure_category",
    "provider_quota_unavailable",
    "provider_retryable_http_error",
    "provider_http_error",
    "openai_compatible_selftest",
    "provider_safe_projection",
    "staging_quota_replay",
    "stage1_staging_runtime_preflight",
    "validate_stage1_staging_runtime.py --allow-preflight",
    "stage1-quota-replay.preflight",
    "object-storage-retention-cleanup.preflight",
    "preflight_stage1",
    "ci_pr_main_run",
    "ci_playwright_smoke",
    "ci_docker_image_build",
    "stage1-ci-exact.preflight",
    "stage1_production_launch_preflight",
    "validate_stage1_production_launch.py --allow-preflight",
    "production_backup_rollback_split",
    "production_provider_claims",
    "production_paid_billing_lifecycle",
    "production_security_launch_checks",
    "production_legal_support_policy",
    "production_governance_release"
  ]) {
    assert.match(adminApi + types + contract, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(adminShell, /Release Readiness/);
  assert.match(adminShell, /\/release/);
  assert.match(releasePage, /Cockpit Production Evidence Policy/);
  assert.match(releasePage, /Only production source evidence can unblock these probes/);
  assert.match(repoValidate, new RegExp(releaseReadinessValidator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(releasePage.toLowerCase(), /<form|type="submit"|manual go|mark go|set go/);
});

test("admin audit page exposes search, filtered results, and safe export contract", () => {
  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
  const contract = readFileSync(
    new URL("../../fixtures/stage1/audit_search_export/local_contract.json", import.meta.url),
    "utf8"
  );
  const repoValidate = readFileSync(new URL("../../scripts/repo_validate.sh", import.meta.url), "utf8");

  for (const token of [
    "stage1.audit-search-export-local-contract",
    "AuditSearchExportManifest",
    "Audit Export Manifest",
    "Allowed Export Fields",
    "Denied Raw Fields",
    "Search Facets",
    "Filtered Audit Results",
    "data-audit-export-manifest",
    "data-audit-export-field-allowlist",
    "data-audit-export-denied-fields",
    "data-audit-filter-result-count",
    "data-audit-filter-high-risk-count",
    "data-audit-filter-second-review-open-count",
    "data-audit-filter-immutable-count",
    "canClearStagingGate: false",
    "canClearProductionGate: false",
    "canCloseDoNotLaunch: false",
    "raw_payload",
    "provider_payload",
    "hidden_prompt",
    "signed_url",
    "stripe_payload",
    "webhook_signature"
  ]) {
    assert.match(auditPage + types + contract, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(repoValidate, /validate_stage1_audit_search_export_contract\.py/);
  assert.doesNotMatch(auditPage.toLowerCase(), /<form|type="submit"|manual go|mark go|set go/);
});

test("admin skill release fixtures define state, allocation, canary, and rollback controls", () => {
  const releasesPage = readFileSync(
    new URL("../app/skills/releases/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "internal_canary",
    "allowlist_canary",
    "percent_canary",
    "trafficAllocation",
    "holdoutPercent",
    "routeEvidence",
    "stopThreshold",
    "pause_release",
    "regression_fixture_pass_rate",
    "criticalSafetyRegression",
    "rolled_back",
    "rollbackAuditRef"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }

  for (const token of [
    "Production Skill Release Runtime Evidence",
    "ProductionSkillReleaseEvalCanaryCoverage",
    "Runtime Probe",
    "Deployment Evidence",
    "RBAC Audit Evidence",
    "Remaining blockers"
  ]) {
    assert.match(releasesPage, new RegExp(token));
  }

  for (const token of [
    "productionSkillReleaseEvalCanaryEvidence",
    "production_skill_release_eval_canary_20260527T1600Z",
    "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
    "eval_suite_gate",
    "canary_threshold_gate",
    "release_notes_gate",
    "rollback_gate",
    "gate_blocker_preservation"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }

  const api = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const generatedAdminApi = readFileSync(
    new URL("../lib/generated/zenart-api.ts", import.meta.url),
    "utf8"
  );
  for (const token of [
    "getStage1BatchQueueRuntime",
    "getStage1BatchChildTasks",
    "/api/admin/v1/batch-generations/queue-runtime?page_size=50",
    "/api/admin/v1/batch-generation-children?page_size=50",
    "mapAdminBatchQueueRuntime",
    "mapAdminBatchChildTask",
    "AdminBatchQueueRuntimeAPI",
    "AdminBatchChildTaskAPI",
    "listAdminBatchQueueRuntime",
    "listAdminBatchGenerationChildren",
    'path: "/batch-generations/queue-runtime"',
    'path: "/batch-generation-children"'
  ]) {
    assert.match(api + generatedAdminApi, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("admin queue fixtures expose retry idempotency, RBAC, and quota effects", () => {
  const queuesPage = readFileSync(
    new URL("../app/queues/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Idempotency Scope",
    "Retry Backoff",
    "Requested By",
    "RBAC Decision",
    "Role Authorization",
    "Role Authorization Evidence",
    "Second Review Status",
    "Second Review Distinctness",
    "Second Review Header",
    "Idempotency Key",
    "Quota Effect",
    "State Transition",
    "Closure Outcome",
    "Release Gate",
    "App Version Gate",
    "Worker Version Gate",
    "Schema Version Gate",
    "Regression Fixture",
    "Closure Evidence"
  ]) {
    assert.match(queuesPage, new RegExp(token));
  }

  for (const token of [
    "Stage 1 Batch Queue Runtime",
    "Stage 1 Batch Child Tasks",
    "Provider Strategy Group",
    "Provider/Model Concurrency",
    "Claim Timeout",
    "Claim Lease Policy",
    "Drain Policy",
    "Provider Idempotency Scope",
    "Fanout Stage",
    "Claim Attempt",
    "Claim Expires At",
    "Dead Letter",
    "Quota Estimate/Commit/Refund",
    "Provider Usage"
  ]) {
    assert.match(queuesPage, new RegExp(token));
  }

  for (const token of [
    "idempotencyScope",
    "retryBackoffPolicy",
    "requestedByRole",
    "rbacDecision",
    "requestedByAdminId",
    "secondReviewRequired",
    "secondReviewEvidenceRefs",
    "idempotencyKey",
    "quotaEffect",
    "regressionFixtureRef",
    "closureEvidenceRefs",
    "rbacEvidenceRefs",
    "stage1BatchQueueRuntime",
    "stage1BatchChildTasks",
    "providerStrategyGroupId",
    "providerSelectionPolicy",
    "claimLeasePolicy",
    "drainPolicy",
    "claimTimeoutSeconds",
    "deadLetterPolicy",
    "claimAttempt",
    "claimExpiresAt",
    "providerUsageRef"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin audit page exposes RBAC stale override replay evidence", () => {
  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");
  const rbacRuntime = readFileSync(new URL("../lib/rbac-runtime.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");

  for (const token of [
    "RBAC Stale Override Replay",
    "getAdminRbacStaleReplayDecisions",
    "Stale Replays Blocked",
    "Stale Outcome",
    "State Restoration",
    "Release Gate",
    "Stale Replay Outcomes",
    "Stale Replay IDs"
  ]) {
    assert.match(auditPage, new RegExp(token));
  }

  for (const token of [
    "AdminRbacStaleReplayDecision",
    "blocked_stale_replay",
    "policy_block_preserved",
    "release_gate_preserved",
    "buildAdminRbacStaleReplayDecisions"
  ]) {
    assert.match(rbacRuntime + api + types, new RegExp(token));
  }
});

test("admin export pages expose regeneration governance evidence", () => {
  const exportsPage = readFileSync(
    new URL("../app/exports/page.tsx", import.meta.url),
    "utf8"
  );
  const exportDetailPage = readFileSync(
    new URL("../app/exports/[id]/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "RBAC Decision",
    "Support Ticket",
    "Quota Effect",
    "Audit Ref",
    "Regeneration Runtime Decisions",
    "QA Gate",
    "Closure Evidence",
    "Submit Disabled Reason",
    "Operator Action"
  ]) {
    assert.match(exportsPage, new RegExp(token));
  }

  for (const token of [
    "Idempotency key",
    "Requested role",
    "Required role",
    "Closure evidence",
    "Operator runbook",
    "Runtime Decision",
    "QA gate",
    "Audit status",
    "Closure evidence status",
    "Blocker codes",
    "Submit disabled reason",
    "regenerationRationale",
    "closureEvidenceRefs",
    "rbacDecision"
  ]) {
    assert.match(exportDetailPage, new RegExp(token));
  }

  for (const token of [
    "supportTicketId",
    "requestedByRole",
    "requiredRole",
    "idempotencyKey",
    "quotaEffect",
    "regenerationMode",
    "operatorRunbook",
    "regenerate:ex-909:sup-2209:missing-qa-report"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin export operations expose API-backed override retention controls", () => {
  const exportsPage = readFileSync(
    new URL("../app/exports/page.tsx", import.meta.url),
    "utf8"
  );
  const exportDetailPage = readFileSync(
    new URL("../app/exports/[id]/page.tsx", import.meta.url),
    "utf8"
  );
  const exportActions = readFileSync(
    new URL("../app/exports/actions.ts", import.meta.url),
    "utf8"
  );
  const adminApiSource = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const generatedAdminApiSourceForExports = readFileSync(new URL("../lib/generated/zenart-api.ts", import.meta.url), "utf8");

  for (const token of [
    "Export Operations",
    "live api",
    "fixture fallback",
    "Export API Contract",
    "listExports",
    "regenerateExport",
    "createExportOverride",
    "exports cleanup",
    "X-Zenari-CSRF",
    "Idempotency-Key",
    "Signed URL",
    "Retention Until",
    "Blocked Reasons",
    "Manifest",
    "QA Report",
    "Provenance",
    "Trace",
    "data-export-op-form=\"regenerateExport\"",
    "data-export-op-form=\"createExportOverride\"",
    "data-export-op-form=\"exportsCleanup\""
  ]) {
    assert.match(exportsPage, new RegExp(token));
  }

  for (const token of [
    "Stage 1 Export Safety",
    "Signed URL",
    "Retention until",
    "Blocked reasons",
    "Manifest",
    "QA report",
    "Provenance",
    "Trace",
    "finalExportAllowed"
  ]) {
    assert.match(exportDetailPage, new RegExp(token));
  }

  for (const token of [
    "regenerateExportAction",
    "createExportOverrideAction",
    "cleanupExportsAction",
    "/api/admin/v1/exports/${encodeURIComponent(exportID)}/regenerate",
    "/api/admin/v1/exports/${encodeURIComponent(exportID)}/override",
    "/api/admin/v1/exports/cleanup",
    "Idempotency-Key",
    "X-Zenari-CSRF",
    "second_reviewer_id",
    "second_review_rationale",
    "source_type",
    "denial_reason",
    "dry_run"
  ]) {
    assert.match(exportActions, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const token of [
    "/api/admin/v1/exports?page_size=100",
    "mapExportToJob",
    "source: \"api\"",
    "source: \"fixture\"",
    "download_enabled",
    "download_expires_at",
    "retention_until",
    "denial_reasons",
    "manifestPresent",
    "qaReportPresent",
    "provenancePresent",
    "trace_id"
  ]) {
    assert.match(adminApiSource, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const token of [
    "listExports",
    "regenerateExport",
    "createExportOverride",
    "path: \"/exports/{export_id}/regenerate\"",
    "path: \"/exports/{export_id}/override\"",
    "idempotencyRequired: true"
  ]) {
    assert.match(generatedAdminApiSourceForExports, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("admin abuse fixtures expose hold throttle telemetry and release evidence", () => {
  const abusePage = readFileSync(
    new URL("../app/abuse/page.tsx", import.meta.url),
    "utf8"
  );
  const abuseRuntime = readFileSync(
    new URL("../lib/abuse-runtime.ts", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Telemetry Signal",
    "User Visible State",
    "Execution Mode",
    "Dry Run Evidence",
    "Release Evidence",
    "Temporary Hold and Throttle Hooks",
    "Runtime Enforcement Decisions",
    "Expiry Lifecycle",
    "Abuse Queue Runtime",
    "Quota Task",
    "Closure Allowed"
  ]) {
    assert.match(abusePage, new RegExp(token));
  }

  for (const token of [
    "telemetrySignal",
    "userVisibleState",
    "executionMode",
    "lastDryRunEvidence",
    "releaseEvidenceRefs",
    "hook-ab-304-hold",
    "rbacDecision"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }

  for (const token of [
    "buildAbuseRuntimeDecisions",
    "buildAbuseQueueRuntime",
    "expiryLifecycle",
    "expired_requires_release_evidence",
    "deny_423_account_hold",
    "throttle_429_rate_limited",
    "canCreateQuotaConsumingTask: false",
    "closureAllowed: false"
  ]) {
    assert.match(abuseRuntime, new RegExp(token));
  }
});

test("admin operations page exposes backend worker crawler metrics runtime evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Backend Worker Crawler Metrics",
    "Scrape Target",
    "Required Signals",
    "Cardinality Probe",
    "SLO Probe",
    "Release Gate Check",
    "Can Clear Row",
    "Remaining Blockers",
    "getBackendMetricsRuntimeEvidence"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  for (const token of [
    "backendMetricsRuntimeEvidence",
    "staging-metrics-backend-api-20260527T1215Z",
    "staging-metrics-worker-20260527T1215Z",
    "staging-metrics-crawler-20260527T1215Z",
    "quota_reservation_total",
    "queue_dead_letter_total",
    "crawler_derivative_review_open_total",
    "pass_with_blockers_preserved"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin operations page exposes observability telemetry runtime evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Observability Telemetry Runtime",
    "getObservabilityTelemetryRuntimeEvidence",
    "Closed Checklist Rows",
    "Propagation Probe",
    "Redaction Probe",
    "Trace Linkage",
    "Can Clear Rows"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  for (const token of [
    "observabilityTelemetryRuntimeEvidence",
    "staging-request-id-admin-api-worker-crawler-20260527T1815Z",
    "staging-json-logs-admin-api-worker-crawler-20260527T1815Z",
    "staging-otel-admin-api-worker-crawler-20260527T1815Z",
    "request_id_propagation",
    "structured_json_logs",
    "opentelemetry_traces",
    "ops/evidence/staging/20260527T1815Z-observability-telemetry.json"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin operations page exposes observability backup load preflight evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Observability Backup Load Preflight",
    "getStagingObservabilityBackupLoadPreflightEvidence",
    "Can Clear Aggregate",
    "Preserved Condition",
    "Preflight Report",
    "Required Entries",
    "Missing Entries",
    "Blocking Reason"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  for (const token of [
    "stagingObservabilityBackupLoadPreflightEvidence",
    "obl-preflight-staging-20260527T013207Z",
    "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
    "ops/evidence/staging/20260527T2115Z-backup-restore.json",
    "ops/evidence/staging/20260527T2120Z-load.json",
    "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json",
    "backup_restore_evidence",
    "load_evidence",
    "post_deploy_smoke_evidence",
    "canClearAggregateItem: true",
    "preservedDoNotLaunchConditionId: \"none\""
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin quota page exposes staging quota rate limit spend cap evidence", () => {
  const quotaPage = readFileSync(
    new URL("../app/quota/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Staging Quota Rate Limit Spend Cap Evidence",
    "getStagingQuotaRateLimitSpendCapEvidence",
    "Release Gate Check",
    "Do Not Launch Condition",
    "Can Clear Row",
    "Remaining Blockers",
    "External User Evidence",
    "Enforcement Evidence"
  ]) {
    assert.match(quotaPage, new RegExp(token));
  }

  for (const token of [
    "stagingQuotaRateLimitSpendCapEvidence",
    "staging_quota_rate_limit_spend_cap_20260527T2015Z",
    "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
    "quota_reservation_commit_refund",
    "rate_limit_enforcement",
    "provider_spend_cap",
    "emergency_kill_switch",
    "rate_limit_spend_cap_runtime_missing"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin quota page exposes team seat operations and billing link controls", () => {
  const quotaPage = readFileSync(new URL("../app/quota/page.tsx", import.meta.url), "utf8");
  const quotaActions = readFileSync(new URL("../app/quota/actions.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");

  for (const token of [
    "Team Seat Operations",
    "Create Team",
    "Invite Seat",
    "Remove Member",
    "TeamSeatUsage",
    "createAdminTeamAction",
    "createAdminTeamInviteAction",
    "removeAdminTeamMemberAction",
    "team-seat-ops",
    "Team Billing Link",
    "Stripe subscription item",
    "upsertTeamBillingLinkAction",
    "provider_subscription_item_id",
    "proration_behavior",
    "seat-syncs"
  ]) {
    assert.match(quotaPage, new RegExp(token));
  }

  for (const token of [
    "createAdminTeamAction",
    "createAdminTeamInviteAction",
    "removeAdminTeamMemberAction",
    "/api/admin/v1/teams",
    "/invites",
    "/members/",
    "/remove",
    "upsertTeamBillingLinkAction",
    "/api/admin/v1/team-seat-ops/",
    "/billing-link",
    "Idempotency-Key",
    "X-Zenari-CSRF",
    "provider_subscription_item_id",
    "proration_behavior"
  ]) {
    assert.match(quotaActions, new RegExp(token));
  }

  for (const token of [
    "getTeamSeatOpsPanel",
    "TeamSeatUsage",
    "Team",
    "TeamInvite",
    "AdminTeamMemberRemoveResult",
    "getTeamBillingLinkPanel",
    "TeamBillingLink",
    "TeamSeatBillingSync",
    "TeamBillingLinkSource"
  ]) {
    assert.match(api + types, new RegExp(token));
  }
});

test("admin quota page exposes audited billing operation controls", () => {
  const quotaPage = readFileSync(new URL("../app/quota/page.tsx", import.meta.url), "utf8");
  const quotaActions = readFileSync(new URL("../app/quota/actions.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
  const generatedAdminApi = readFileSync(
    new URL("../lib/generated/zenart-api.ts", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Admin Billing Operations",
    "Manual Credit",
    "Refund Note",
    "Subscription Sync",
    "Account Lock",
    "data-admin-endpoint=\"billing-ops\"",
    "data-admin-billing-op=\"manual_credit\"",
    "data-admin-billing-op=\"refund_note\"",
    "data-admin-billing-op=\"sync_subscription\"",
    "data-admin-billing-op=\"account_lock\"",
    "createAdminBillingManualCredit:POST:/billing/manual-credit:include:X-Zenari-CSRF:true",
    "createAdminBillingRefundNote:POST:/billing/refund-note:include:X-Zenari-CSRF:true",
    "createAdminBillingSubscriptionSync:POST:/billing/subscription-sync:include:X-Zenari-CSRF:true",
    "createAdminBillingAccountLock:POST:/billing/account-lock:include:X-Zenari-CSRF:true"
  ]) {
    assert.match(quotaPage, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const token of [
    "createAdminBillingManualCreditAction",
    "createAdminBillingRefundNoteAction",
    "createAdminBillingSubscriptionSyncAction",
    "createAdminBillingAccountLockAction",
    "/api/admin/v1/billing/manual-credit",
    "/api/admin/v1/billing/refund-note",
    "/api/admin/v1/billing/subscription-sync",
    "/api/admin/v1/billing/account-lock",
    "Idempotency-Key",
    "X-Zenari-CSRF",
    "target_user_id",
    "rationale",
    "ticketMetadata"
  ]) {
    assert.match(quotaActions, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const token of [
    "getAdminBillingOpsPanel",
    "AdminBillingOperation",
    "AdminBillingOperationKind",
    "AdminBillingOpsPanel",
    "adminBillingOperationFixtures"
  ]) {
    assert.match(api + types, new RegExp(token));
  }

  for (const token of [
    "createAdminBillingManualCredit",
    "createAdminBillingRefundNote",
    "createAdminBillingSubscriptionSync",
    "createAdminBillingAccountLock"
  ]) {
    assert.match(generatedAdminApi, new RegExp(token));
  }
});

test("admin analytics reports cover stage 0 go/no-go reports", () => {
  const analyticsPage = readFileSync(
    new URL("../app/analytics/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "first prompt to four candidates",
    "selection",
    "iteration",
    "package/export completion",
    "weekly return",
    "QA",
    "cost",
    "support failure rate",
    "Decision Use",
    "Source Events"
  ]) {
    assert.match(analyticsPage, new RegExp(token));
  }

  assert.match(fixtures, /first_prompt_to_four_candidates/);
  assert.match(fixtures, /package_add_export_completion/);
  assert.match(fixtures, /support_ticket_failure_rate/);
});

test("admin feedback page surfaces bad samples converted to regression fixtures", () => {
  const feedbackPage = readFileSync(
    new URL("../app/feedback/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Bad Samples to Regression Fixtures",
    "Regression Fixture Runtime Gates",
    "RegressionFixture",
    "RegressionFixtureRuntimeSummary",
    "getRegressionFixtureRuntimeSummaries",
    "Release Gate Disposition",
    "High Risk Gate",
    "Expected Assertion",
    "Reviewer Rationale",
    "Canary Metric",
    "fixturePath"
  ]) {
    assert.match(feedbackPage, new RegExp(token));
  }

  for (const token of [
    "regressionFixtures",
    "brand_similarity_fb_203",
    "mobile_readability_fb_211",
    "export_manifest_sup_2204",
    "failed_task_retry_task_export_489",
    "failed_task_cancel_task_crawler_019",
    "admin_bad_sample",
    "failed_task",
    "requiredGate",
    "linkedCanaryMetric",
    "reviewerRationale"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin support page surfaces staging support retry abuse evidence", () => {
  const supportPage = readFileSync(
    new URL("../app/support/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Staging Support Retry Abuse Evidence",
    "Runtime Probe",
    "External User Evidence",
    "RBAC Audit Evidence",
    "Gate impact",
    "Runtime request ids"
  ]) {
    assert.match(supportPage, new RegExp(token));
  }

  for (const token of [
    "stagingSupportRetryAbuseEvidence",
    "staging_support_retry_abuse_20260527T1000Z",
    "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
    "support_ticket_linkage",
    "failed_task_retry_cancel",
    "abuse_hold_throttle",
    "abuse_queue_closure"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin support page exposes deletion governance contract without mutation controls", () => {
  const supportPage = readFileSync(new URL("../app/support/page.tsx", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
  const fixtures = readFileSync(new URL("../lib/fixtures.ts", import.meta.url), "utf8");
  const adminApi = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const contract = readFileSync(
    new URL("../../fixtures/stage1/support_admin_deletion_governance/local_contract.json", import.meta.url),
    "utf8"
  );
  const repoValidate = readFileSync(new URL("../../scripts/repo_validate.sh", import.meta.url), "utf8");

  for (const token of [
    "stage1.support-admin-deletion-governance-local-contract",
    "SupportAdminDeletionGovernanceContract",
    "SupportAdminDeletionRequest",
    "Deletion Governance",
    "data-support-deletion-governance-contract",
    "data-support-deletion-non-launch-status",
    "data-support-deletion-blocked-gate-checks",
    "data-support-deletion-preserved-dnl",
    "data-support-deletion-required-fields",
    "data-support-deletion-linked-evidence",
    "data-support-deletion-denied-fields",
    "data-support-deletion-request-links",
    "canClearStagingGate: false",
    "canClearProductionGate: false",
    "canCloseDoNotLaunch: false",
    "mutationControlsEnabled: false",
    "account_deletion",
    "project_deletion",
    "export_deletion",
    "billing_data_erasure_review",
    "blocked_pending_evidence",
    "ready_for_second_review",
    "retention_hold",
    "closed_no_action",
    "raw_support_body",
    "provider_payload",
    "billing_payload",
    "webhook_signature",
    "public_legal_support_policy_not_deployed",
    "production_paid_billing_lifecycle"
  ]) {
    assert.match(supportPage + types + fixtures + contract, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(adminApi, /getSupportAdminDeletionGovernanceContract/);
  assert.match(repoValidate, /validate_stage1_support_admin_deletion_governance_contract\.py/);
  assert.doesNotMatch(supportPage, /<form|type="submit"|formAction=|approve deletion|execute deletion|confirm deletion|mark go|set go|manual go/i);
});

test("admin audit page surfaces production security launch evidence", () => {
  const auditPage = readFileSync(
    new URL("../app/audit/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Production Security Evidence",
    "ProductionSecurityLaunchCheckCoverage",
    "Security Audit Evidence",
    "secure cookies",
    "CSRF/same-site",
    "secret redaction"
  ]) {
    assert.match(auditPage, new RegExp(token));
  }

  for (const token of [
    "productionSecurityLaunchCheckEvidence",
    "production_security_launch_checks_20260527T1700Z",
    "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
    "secure_session_cookie",
    "csrf_same_site_enforcement",
    "secret_exposure_redaction",
    "admin_surface_privacy",
    "security_privacy_legal_incomplete",
    "secret_exposure_runtime_not_verified"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin operations page surfaces production backup rollback incident evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );
  const adminApi = readFileSync(
    new URL("../lib/admin-api.ts", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Production Backup Rollback Incident Evidence",
    "ProductionBackupRollbackIncidentCoverage",
    "Operational Audit Evidence",
    "Launch-Clearing Split",
    "Split Preflight",
    "Upstream Gate",
    "Exact Split File",
    "Exact Evidence Path",
    "Required Runtime Proof",
    "Tracked Conditions",
    "Can Clear Rows",
    "Remaining Blockers",
    "getProductionBackupRollbackIncidentEvidence",
    "getProductionBackupRollbackSplitPreflightEvidence"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  assert.match(adminApi, /getProductionBackupRollbackIncidentEvidence/);
  assert.match(adminApi, /getProductionBackupRollbackSplitPreflightEvidence/);

  for (const token of [
    "productionBackupRollbackIncidentEvidence",
    "productionBackupRollbackSplitPreflightEvidence",
    "production_backup_rollback_incident_20260527T1800Z",
    "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
    "ops/evidence/production/backup-rollback-split.blocked.json",
    "backup_restore",
    "rollback_drill",
    "incident_alert_path",
    "post_deploy_smoke",
    "splitReadiness",
    "releaseShaStatus: \"bound\"",
    "gateDecisionStatus: \"go\"",
    "exact_split_ready_blocked_by_other_production_runtime_items",
    "production_gate_fixture_has_unrelated_blockers",
    "blocked_by_other_production_runtime_items",
    "production_skill_release_eval_canary",
    "production_activation_review_audit",
    "production_abuse_throttle_hold",
    "production_security_launch_checks",
    "production_legal_support_policy",
    "ops/evidence/production/backup-restore.json",
    "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
    "status: \"pass\"",
    "blocked_until_exact_split_file",
    "paid_billing_or_comp_only_mode_missing"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin operations page surfaces legal support visibility evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Dashboards",
    "Alert Routes",
    "Release Blocker Matrix",
    "Runtime Evidence",
    "Required Evidence",
    "Unblock Criteria"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  for (const token of [
    "od-legal-support-visibility",
    "legal_support_visibility",
    "al-legal-support-visibility",
    "rb-private-beta-legal-support-visibility",
    "eg-005",
    "au-020",
    "staging-dashboard-legal-support-20260527T2200Z",
    "staging-alert-legal-support-20260527T2200Z",
    "scripts/staging_legal_support_visibility_smoke.sh",
    "ops/evidence/staging/legal-pages-external-user.json",
    "ops/evidence/staging/support-contact-external-user.json",
    "staging_legal_support_visibility_20260527T2230Z",
    "legal_pages_visibility",
    "support_contact_visibility",
    "external_user_legal_pages_missing"
  ]) {
    assert.match(fixtures, new RegExp(token.replaceAll("/", "\\/")));
  }
});

test("admin audit page surfaces staging auth rbac tenant audit evidence", () => {
  const auditPage = readFileSync(
    new URL("../app/audit/page.tsx", import.meta.url),
    "utf8"
  );
  const adminApi = readFileSync(
    new URL("../lib/admin-api.ts", import.meta.url),
    "utf8"
  );

  for (const token of [
    "getStagingAuthRbacTenantAuditEvidence",
    "Staging Auth RBAC Tenant Audit Evidence",
    "Runtime request ids",
    "Remaining blockers",
    "Runtime Probe",
    "External User Evidence",
    "RBAC Audit Evidence"
  ]) {
    assert.match(auditPage + adminApi, new RegExp(token));
  }

  for (const token of [
    "stagingAuthRbacTenantAuditEvidence",
    "staging_auth_rbac_tenant_audit_20260527T1515Z",
    "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
    "admin_session_boundary",
    "tenant_isolation_denial",
    "admin_rbac_runtime",
    "immutable_audit_linkage"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin fixtures expose review governance and release evidence", () => {
  for (const token of [
    "secondReviewRequired",
    "secondReviewer",
    "reviewerRationale",
    "canaryEvidence",
    "releaseEvidence",
    "contractEvidence",
    "reviewRationale",
    "evidenceRefs",
    "smokeEvidence",
    "rollbackEvidence"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin review and audit pages expose RBAC runtime decisions", () => {
  const reviewsPage = readFileSync(
    new URL("../app/reviews/page.tsx", import.meta.url),
    "utf8"
  );
  const auditPage = readFileSync(
    new URL("../app/audit/page.tsx", import.meta.url),
    "utf8"
  );
  const adminApi = readFileSync(
    new URL("../lib/admin-api.ts", import.meta.url),
    "utf8"
  );
  const rbacRuntime = readFileSync(
    new URL("../lib/rbac-runtime.ts", import.meta.url),
    "utf8"
  );

  for (const token of [
    "getAdminRbacRuntimeDecisions",
    "getAdminRbacEvidencePacks",
    "RBAC Runtime Decisions",
    "RBAC Override Evidence Pack",
    "RBAC Release Evidence Closure",
    "Effective Decision",
    "Request Outcome",
    "Queue Action",
    "Release Gate Status",
    "Release Gate Disposition",
    "Evidence Completeness",
    "Highest Required Role",
    "Operator Checklist",
    "API Scopes",
    "Expiry Enforcement",
    "Expiry Enforced IDs",
    "Policy Block IDs",
    "Attempt Coverage",
    "Stale Replay Coverage",
    "Closure Status",
    "Closure Evidence Refs",
    "Override Window",
    "Pre-Override State",
    "Expiry Action",
    "Stale Override Probe",
    "Runtime Rationale"
  ]) {
    assert.match(reviewsPage, new RegExp(token));
    assert.match(auditPage, new RegExp(token));
  }

  for (const token of [
    "buildAdminRbacRuntimeDecisions",
    "buildAdminRbacSurfaceSummaries",
    "buildAdminRbacEvidencePacks",
    "buildAdminRbacReleaseEvidenceClosures",
    "denied_insufficient_role",
    "denied_policy_block",
    "queued_second_review",
    "denied_expired_override",
    "apply_with_expiry",
    "held_for_second_review",
    "blocked_by_policy_or_role",
    "overrideWindow",
    "staleOverrideProbe",
    "operatorAction",
    "apiScopes",
    "expiryEnforcementStatus",
    "expiryEnforcedEvidenceIds",
    "policyBlockEvidenceIds"
  ]) {
    assert.match(adminApi + rbacRuntime, new RegExp(token));
  }
});

test("admin fixtures cover RBAC evidence for governed override surfaces", () => {
  for (const token of [
    "adminRbacEvidence",
    "skill_release",
    "crawler_import",
    "prompt_approval",
    "provider_routing",
    "quota_override",
    "safety_rule",
    "export_override",
    "overrideScope",
    "overrideDurationPolicy",
    "expiryEnforced",
    "requiredRole",
    "attemptedRole",
    "secondReviewStatus",
    "apiScope",
    "mutationOutcome",
    "overrideStartedAt",
    "overrideExpiresAt",
    "preOverrideState",
    "expiryAction",
    "staleOverrideProbe",
    "runtimeCheck",
    "postDecisionControl",
    "releaseEvidenceRequired"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin review and audit pages expose RBAC override release summaries", () => {
  const reviewsPage = readFileSync(new URL("../app/reviews/page.tsx", import.meta.url), "utf8");
  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");

  for (const source of [reviewsPage, auditPage]) {
    for (const token of [
      "getAdminRbacSurfaceSummaries",
      "AdminRbacSurfaceSummary",
      "Override Scope",
      "Decision Summary",
      "Release Gate Statuses",
      "Operator Action",
      "Release Evidence Required",
      "Audit Refs"
    ]) {
      assert.match(source, new RegExp(token));
    }
  }

  assert.match(reviewsPage, /Override Surface Summary/);
  assert.match(auditPage, /RBAC Override Release Summary/);
});

test("admin review and audit pages expose computed RBAC override evidence packs", () => {
  const reviewsPage = readFileSync(new URL("../app/reviews/page.tsx", import.meta.url), "utf8");
  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");
  const adminApi = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const rbacRuntime = readFileSync(new URL("../lib/rbac-runtime.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
  const statusBadge = readFileSync(new URL("../components/StatusBadge.tsx", import.meta.url), "utf8");

  for (const source of [reviewsPage, auditPage]) {
    for (const token of [
      "getAdminRbacEvidencePacks",
      "AdminRbacEvidencePack",
      "RBAC Override Evidence Pack",
      "Release Gate Disposition",
      "Evidence Completeness",
      "Highest Required Role",
      "Request Outcomes",
      "API Scopes",
      "Expiry Statuses",
      "Expiry Enforcement",
      "Expiry Enforced IDs",
      "Policy Block IDs",
      "Second Review Statuses",
      "Operator Checklist"
    ]) {
      assert.match(source, new RegExp(token));
    }
  }

  for (const token of [
    "buildAdminRbacEvidencePacks",
    "evidenceCompleteness",
    "releaseGateDisposition",
    "operatorChecklist",
    "apiScopes",
    "expiryEnforcementStatus",
    "expiryEnforcedEvidenceIds",
    "policyBlockEvidenceIds",
    "all_enforced",
    "policy_block_only",
    "mixed_enforcement",
    "missing_enforcement",
    "applied_with_expiry",
    "held_for_second_review",
    "blocked_by_policy_or_role",
    "mixed_preserved",
    "missing_audit",
    "missing_runtime",
    "missing_release_evidence"
  ]) {
    assert.match(adminApi + rbacRuntime + types + statusBadge, new RegExp(token));
  }
});

test("admin action pages show scoped RBAC evidence at decision points", () => {
  const pages = [
    {
      path: "../app/skills/releases/page.tsx",
      heading: "Skill Release RBAC Evidence",
      runtimeHeading: "Skill Release RBAC Runtime Decisions",
      surface: "skill_release"
    },
    {
      path: "../app/crawler/page.tsx",
      heading: "Crawler Import RBAC Evidence",
      runtimeHeading: "Crawler Import RBAC Runtime Decisions",
      surface: "crawler_import"
    },
    {
      path: "../app/prompt-fragments/page.tsx",
      heading: "Prompt Approval RBAC Evidence",
      runtimeHeading: "Prompt Approval RBAC Runtime Decisions",
      surface: "prompt_approval"
    },
    {
      path: "../app/providers/page.tsx",
      heading: "Provider Routing RBAC Evidence",
      runtimeHeading: "Provider Routing RBAC Runtime Decisions",
      surface: "provider_routing"
    },
    {
      path: "../app/quota/page.tsx",
      heading: "Quota Override RBAC",
      runtimeHeading: "Quota Override RBAC Runtime Decisions",
      surface: "quota_override"
    },
    {
      path: "../app/exports/page.tsx",
      heading: "Export Override RBAC Evidence",
      runtimeHeading: "Export Override RBAC Runtime Decisions",
      surface: "export_override"
    },
    {
      path: "../app/safety/page.tsx",
      heading: "Safety and Export Override RBAC",
      runtimeHeading: "Safety and Export Override RBAC Runtime Decisions",
      surface: "safety_rule"
    }
  ];

  for (const page of pages) {
    const source = readFileSync(new URL(page.path, import.meta.url), "utf8");

    for (const token of [
      "getAdminRbacEvidence",
      "getAdminRbacRuntimeDecisions",
      "RbacRuntimeDecisionTable",
      page.heading,
      page.runtimeHeading,
      page.surface,
      "Override Scope",
      "Required Role",
      "Attempted Role",
      "Decision",
      "Second Review",
      "API Scope",
      "Mutation Outcome",
      "Duration Policy",
      "Override Start",
      "Override Expiration",
      "Expiry Enforced",
      "Pre-Override State",
      "Expiry Action",
      "Stale Override Probe",
      "Runtime Check",
      "Post Decision Control",
      "Release Evidence Required",
      "Evidence Refs",
      "Audit Ref",
      "Rationale"
    ]) {
      assert.match(source, new RegExp(token));
    }
  }
});

test("shared RBAC runtime table exposes computed override outcomes", () => {
  const source = readFileSync(new URL("../components/RbacRuntimeDecisionTable.tsx", import.meta.url), "utf8");

  for (const token of [
    "Runtime Evidence",
    "Enforcement Point",
    "Expiry Policy Status",
    "Override Window",
    "Effective Decision",
    "Request Outcome",
    "Mutation Allowed",
    "Queue Action",
    "Release Gate Status",
    "Pre-Override State",
    "Expiry Action",
    "Stale Override Probe",
    "Evaluated At",
    "Audit Ref",
    "Evidence Refs",
    "Runtime Rationale",
    "allow_mutation",
    "queue_for_review",
    "denied"
  ]) {
    assert.match(source, new RegExp(token));
  }
});

test("admin crawler page exposes staging runtime governance evidence", () => {
  const crawlerPage = readFileSync(new URL("../app/crawler/page.tsx", import.meta.url), "utf8");

  for (const token of [
    "getCrawlerStagingRuntimeEvidence",
    "getCrawlerGovernanceClosureSummaries",
    "Staging Crawler Governance Runtime Evidence",
    "Crawler Release Closure Summary",
    "source approval, robots, SSRF, rate limits, retention, exact-text warnings, provenance, and blocklist controls",
    "Runtime Controls",
    "Evidence Path",
    "Release Gate Check",
    "Remaining Blockers",
    "Release Closure State",
    "Activation Safety State",
    "Evidence Completeness",
    "Takedown Delete Status",
    "Deadline Escalation Status",
    "Release Gate Disposition",
    "Missing Evidence Refs",
    "Operator Summary"
  ]) {
    assert.match(crawlerPage, new RegExp(token));
  }

  for (const token of [
    "crawlerStagingRuntimeEvidence",
    "source_approval",
    "robots",
    "ssrf",
    "rate_limit",
    "retention",
    "exact_text_warning",
    "provenance",
    "source_blocklist",
    "ops/evidence/staging/20260527T1100Z-crawler-governance-runtime.json"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin fixtures cover operations gate evidence", () => {
  for (const token of [
    "customerImpact",
    "mitigation",
    "nextUpdateAt",
    "linkedSupportTickets",
    "rollbackPlan",
    "operationalDashboards",
    "operationalDashboardRuntimeEvidence",
    "alertRoutes",
    "provider_latency_error",
    "crawler_policy_violation",
    "releaseGateUse",
    "runtimeEnvironment",
    "runtimeEvidenceStatus",
    "runtimeEvidenceRef",
    "runtimeValidatedAt",
    "staging-dashboard-crawler",
    "staging-alert-crawler",
    "ops/evidence/staging/20260526T1000Z-dashboard-runtime.json",
    "ops/evidence/staging/20260526T1000Z-alert-runtime.json",
    "ops/evidence/staging/20260527T1815Z-observability-telemetry.json",
    "importProbe",
    "signalProbe",
    "sloProbe",
    "blockerProbe",
    "deliveryProbe",
    "thresholdProbe",
    "escalationProbe",
    "runbookProbe",
    "incidentLinkage",
    "releaseBlockers",
    "blockingSignal",
    "requiredEvidence",
    "unblockCriteria",
    "rb-production-admin-security",
    "escalationRole",
    "audience",
    "approval",
    "auditRef"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }

  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Release Blocker Matrix",
    "Dashboard Runtime Evidence",
    "getOperationalDashboardRuntimeEvidence",
    "Import Probe",
    "Signal Probe",
    "SLO Probe",
    "Blocker Probe",
    "getReleaseBlockers",
    "getObservabilityTelemetryRuntimeEvidence",
    "Blocking Signal",
    "Required Evidence",
    "Unblock Criteria"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }
});

test("admin app exposes a route for every stage 0 admin surface", () => {
  for (const route of routes) {
    const page = readFileSync(
      new URL(`../app/${route}/page.tsx`, import.meta.url),
      "utf8"
    );
    assert.match(page, /PageHeader/);
  }
});

test("admin routes surface governance evidence", () => {
  const releasePage = readFileSync(
    new URL("../app/skills/releases/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(releasePage, /Second Review/);
  assert.match(releasePage, /Reviewer Rationale/);
  assert.match(releasePage, /Canary Evidence/);
  assert.match(releasePage, /Release Gate Evidence/);
  assert.match(releasePage, /Eval Result Store/);
  assert.match(releasePage, /API Contract Anchors/);
  assert.match(releasePage, /listSkills/);
  assert.match(releasePage, /listSkillVersions/);
  assert.match(releasePage, /listEvalResults/);
  assert.match(releasePage, /getEvalResultArtifact/);
  assert.match(releasePage, /skill_release:admin/);

  const skillRegistryPage = readFileSync(
    new URL("../app/skills/page.tsx", import.meta.url),
    "utf8"
  );
  const adminApiForSkillRelease = readFileSync(
    new URL("../lib/admin-api.ts", import.meta.url),
    "utf8"
  );
  assert.match(skillRegistryPage, /live api/);
  assert.match(skillRegistryPage, /fixture fallback/);
  assert.match(adminApiForSkillRelease, /getEvalResults/);
  assert.match(adminApiForSkillRelease, /mapSkillVersionAPI/);
  assert.match(adminApiForSkillRelease, /mapEvalResultAPI/);
  assert.match(adminApiForSkillRelease, /\/api\/admin\/v1\/eval\/results\?page_size=100&latest_only=true/);

  const providerPage = readFileSync(
    new URL("../app/providers/page.tsx", import.meta.url),
    "utf8"
  );
  const providerControls = readFileSync(
    new URL("../app/providers/ProviderRegistryControls.tsx", import.meta.url),
    "utf8"
  );
  const providerActions = readFileSync(
    new URL("../app/providers/actions.ts", import.meta.url),
    "utf8"
  );
  const generatedAdminApi = readFileSync(
    new URL("../lib/generated/zenart-api.ts", import.meta.url),
    "utf8"
  );
  assert.match(providerPage, /Contract Evidence/);
  assert.match(providerPage, /Canary Evidence/);
  assert.match(providerPage, /Release Evidence/);
  assert.match(providerPage, /provider_test/);
  assert.match(providerPage, /Provider Strategy Groups/);
  assert.match(providerPage, /getProviderStrategyGroups/);
  assert.match(providerPage, /selection_policy/);
  assert.match(providerPage, /Kill Switch/);
  assert.match(providerControls, /Sandbox Test Call/);
  assert.match(providerControls, /Run Test Call/);
  assert.match(providerControls, /Create Strategy Group/);
  assert.match(providerControls, /Save Strategy Group/);
  assert.match(providerControls, /Selection policy/);
  assert.match(providerControls, /Member provider IDs/);
  assert.match(providerControls, /Kill switch group/);
  assert.match(providerControls, /Capability and Cost/);
  assert.match(providerControls, /Secret reference/);
  assert.match(providerControls, /estimated_cost_cents/);
  assert.match(providerControls, /supported_aspect_ratios/);
  assert.match(providerControls, /runProviderSandboxTestCallAction/);
  assert.match(providerControls, /createProviderStrategyGroupAction/);
  assert.match(providerControls, /updateProviderStrategyGroupAction/);
  assert.match(providerActions, /\/test-call/);
  assert.match(providerActions, /\/api\/admin\/v1\/providers\/strategy-groups/);
  assert.match(providerActions, /createProviderStrategyGroupAction/);
  assert.match(providerActions, /updateProviderStrategyGroupAction/);
  assert.match(providerActions, /strategyMembersFromFormData/);
  assert.match(providerActions, /strategyMetadataField/);
  assert.match(providerActions, /secret_ref/);
  assert.match(providerActions, /capabilities/);
  assert.match(providerActions, /estimated_cost_cents/);
  assert.match(providerActions, /Idempotency-Key/);
  assert.match(providerActions, /X-Zenari-CSRF/);
  assert.match(generatedAdminApi, /runProviderSandboxTestCall/);
  assert.match(generatedAdminApi, /updateProviderRegistry/);
  assert.match(generatedAdminApi, /listProviderStrategyGroups/);
  assert.match(generatedAdminApi, /createProviderStrategyGroup/);
  assert.match(generatedAdminApi, /updateProviderStrategyGroup/);

  const reviewsPage = readFileSync(
    new URL("../app/reviews/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(reviewsPage, /Review Queue/);
  assert.match(reviewsPage, /Second Review/);
  assert.match(reviewsPage, /Evidence Refs/);

  const auditPage = readFileSync(
    new URL("../app/audit/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(auditPage, /Review Rationale Evidence/);
  assert.match(auditPage, /Second Review/);
  assert.match(auditPage, /High-risk admin changes/);
  assert.match(auditPage, /Support and quota actions/);
  assert.match(auditPage, /Release and canary changes/);
  assert.match(auditPage, /RBAC Override Evidence/);
  assert.match(auditPage, /Required Role/);

  const safetyPage = readFileSync(
    new URL("../app/safety/page.tsx", import.meta.url),
    "utf8"
  );
  const adminApiSource = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const generatedAdminApiSourceForSafety = readFileSync(new URL("../lib/generated/zenart-api.ts", import.meta.url), "utf8");
  const openapiSource = readFileSync(new URL("../../openapi/zenart.v1.yaml", import.meta.url), "utf8");
  assert.match(safetyPage, /Safety Review Queue/);
  assert.match(safetyPage, /live api/);
  assert.match(safetyPage, /fixture fallback/);
  assert.match(safetyPage, /Safety Decision/);
  assert.match(safetyPage, /User Outcome/);
  assert.match(adminApiSource, /\/api\/admin\/v1\/safety\/reviews/);
  assert.match(adminApiSource, /safety_decision_id/);
  assert.match(openapiSource, /raw_provider_payload_persisted/);
  assert.match(generatedAdminApiSourceForSafety, /listSafetyReviews/);
  assert.match(generatedAdminApiSourceForSafety, /createSafetyReviewDecision/);
  assert.match(safetyPage, /Review Rationale/);
  assert.match(safetyPage, /Safety and Export Override RBAC/);

  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(operationsPage, /Incident Log/);
  assert.match(operationsPage, /Maintenance Banner/);
  assert.match(operationsPage, /Dashboards/);
  assert.match(operationsPage, /Alert Routes/);
  assert.match(operationsPage, /Alert Runtime Evidence/);
  assert.match(operationsPage, /SLO Threshold/);
  assert.match(operationsPage, /Escalation Role/);
  assert.match(operationsPage, /Runtime Evidence/);
  assert.match(operationsPage, /Runtime Status/);
  assert.match(operationsPage, /Validated At/);
  assert.match(operationsPage, /Delivery Probe/);
  assert.match(operationsPage, /Threshold Probe/);
  assert.match(operationsPage, /Incident Linkage/);
  assert.match(operationsPage, /Rollback Plan/);

  const queuesPage = readFileSync(
    new URL("../app/queues/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(queuesPage, /Retry Policy/);
  assert.match(queuesPage, /Cancel Policy/);
  assert.match(queuesPage, /Failed Task Retry and Cancel Controls/);
  assert.match(queuesPage, /Operator Runbook/);
  assert.match(queuesPage, /Allowed Role/);

  const crawlerPage = readFileSync(
    new URL("../app/crawler/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(crawlerPage, /Takedown and Derivative Review Workflow/);
  assert.match(crawlerPage, /getCrawlerGovernanceRuntimeDecisions/);
  assert.match(crawlerPage, /getCrawlerGovernanceClosureSummaries/);
  assert.match(crawlerPage, /Crawler Governance Runtime Decisions/);
  assert.match(crawlerPage, /Crawler Release Closure Summary/);
  assert.match(crawlerPage, /Closure Decision/);
  assert.match(crawlerPage, /Activation Decision/);
  assert.match(crawlerPage, /Release Closure State/);
  assert.match(crawlerPage, /Activation Safety State/);
  assert.match(crawlerPage, /Release Gate Disposition/);
  assert.match(crawlerPage, /Deletion Evidence/);
  assert.match(crawlerPage, /Requester Notice/);
  assert.match(crawlerPage, /Blockers/);
  assert.match(crawlerPage, /Crawler Source Approval/);
  assert.match(crawlerPage, /Robots Evidence/);
  assert.match(crawlerPage, /Exact-text Policy/);
  assert.match(crawlerPage, /Requester/);
  assert.match(crawlerPage, /Source Contact/);
  assert.match(crawlerPage, /Derivative Use/);
  assert.match(crawlerPage, /Retention Action/);
  assert.match(crawlerPage, /Activation/);
  assert.match(crawlerPage, /Linked Review/);
  assert.match(crawlerPage, /Fixture Case/);
  assert.match(crawlerPage, /Operator Next Action/);
  assert.match(crawlerPage, /Closure Criteria/);
  assert.match(crawlerPage, /Review Rationale/);
  assert.match(crawlerPage, /Crawler Admin Action Contracts/);
  assert.match(crawlerPage, /Admin Session Scope/);
  assert.match(crawlerPage, /Request Attempt Ref/);
  assert.match(crawlerPage, /Idempotency Key/);
  assert.match(crawlerPage, /Request State Digest/);
  assert.match(crawlerPage, /Stale Replay Outcome/);
  assert.match(crawlerPage, /Request Audit Order/);
  assert.match(crawlerPage, /Request Evidence Refs/);
  assert.match(crawlerPage, /Audit Ref/);

  const quotaPage = readFileSync(
    new URL("../app/quota/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(quotaPage, /Quota Override RBAC/);
  assert.match(quotaPage, /Attempted Role/);

  assert.match(releasePage, /Release Gate Evidence/);
  assert.match(reviewsPage, /Admin RBAC Evidence/);
  assert.match(reviewsPage, /Attempted Role/);

  const abusePage = readFileSync(
    new URL("../app/abuse/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(abusePage, /Temporary Hold and Throttle Hooks/);
  assert.match(abusePage, /Enforcement Point/);
  assert.match(abusePage, /Hook Payload/);
  assert.match(abusePage, /Attempted Role/);
  assert.match(abusePage, /RBAC Decision/);
  assert.match(abusePage, /Rollback Action/);
  assert.match(abusePage, /Release Condition/);
  assert.match(abusePage, /Evidence Refs/);
  assert.match(abusePage, /Operator Runbook/);
  assert.match(abusePage, /Audit Ref/);
});

test("support console surfaces ticket linkage and audit evidence", () => {
  const supportPage = readFileSync(
    new URL("../app/support/page.tsx", import.meta.url),
    "utf8"
  );
  for (const token of [
    "Ticket Linkage",
    "Project",
    "Task",
    "Trace",
    "Asset",
    "Export",
    "Quota Txn",
    "Next Action",
    "Escalation Readiness",
    "Update Cadence",
    "Customer Message",
    "Closure Blockers",
    "Audit Ref"
  ]) {
    assert.match(supportPage, new RegExp(token));
  }

  for (const token of [
    "projectId",
    "taskId",
    "traceId",
    "assetId",
    "exportId",
    "quotaTransactionId",
    "customerUpdateCadence",
    "customerMessage",
    "requiredEvidenceRefs",
    "closureBlockers",
    "auditRef"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});
