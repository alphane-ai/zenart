import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const billingContracts =
  "createAdminBillingManualCredit:POST:/billing/manual-credit:include:X-Zenari-CSRF:true|createAdminBillingRefundNote:POST:/billing/refund-note:include:X-Zenari-CSRF:true|createAdminBillingSubscriptionSync:POST:/billing/subscription-sync:include:X-Zenari-CSRF:true|createAdminBillingAccountLock:POST:/billing/account-lock:include:X-Zenari-CSRF:true";

const azureReadinessEvidence = JSON.parse(
  readFileSync(resolve(process.cwd(), "../ops/evidence/staging/stage1-azure-origin-readiness.json"), "utf8")
) as { ssh_hard_timeout_seconds?: number };
const azureSshHardTimeoutSeconds =
  typeof azureReadinessEvidence.ssh_hard_timeout_seconds === "number" && azureReadinessEvidence.ssh_hard_timeout_seconds >= 20
    ? azureReadinessEvidence.ssh_hard_timeout_seconds
    : 20;

test("provider registry and strategy group admin surface remains browser-covered", async ({ page }) => {
  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Provider Health" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider Registry" })).toBeVisible();
  await expect(page.getByText("fixture fallback").first()).toBeVisible();
  await expect(page.getByText("Live provider registry API is unavailable; fixture fallback is read-only.")).toBeVisible();

  await expect(page.getByRole("cell", { name: "openai" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "internal" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "image-generation-default" }).first()).toBeVisible();
  await expect(page.getByText("Strategy groups bind tool surfaces to provider membership")).toBeVisible();
  await expect(page.getByText("Provider sandbox routing smoke").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "production_provider_or_comp_only_mode", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "blocked_by_other_production_runtime_items", exact: true })).toBeVisible();

  const createStrategyGroup = page.locator("form.provider-create").filter({ hasText: "Create Strategy Group" });
  await expect(createStrategyGroup.getByLabel("Group ID")).toHaveValue("image-generation-default");
  await expect(createStrategyGroup.getByLabel("Selection policy")).toBeDisabled();
  await expect(createStrategyGroup.getByLabel("Fallback providers")).toHaveValue("internal");
  await expect(createStrategyGroup.getByLabel("Member provider IDs")).toHaveValue("openai, internal");
  await expect(createStrategyGroup.getByLabel("Member provider IDs")).toBeDisabled();
  await expect(createStrategyGroup.getByRole("button", { name: "Create Strategy Group" })).toBeDisabled();

  const createProvider = page.locator("form.provider-create").filter({ hasText: "Create Provider Registry Entry" });
  await expect(createProvider.getByLabel("Secret reference")).toBeDisabled();
  await expect(createProvider.getByLabel("Estimated cents")).toBeDisabled();
  await expect(createProvider.getByLabel("Supports batch")).toBeDisabled();
  await expect(createProvider.getByRole("button", { name: "Create Provider" })).toBeDisabled();

  const openaiProvider = page.locator(".provider-control-stack").filter({ hasText: "openai" }).first();
  await expect(openaiProvider.getByLabel("Secret reference")).toHaveValue("secrets/provider/ph-1");
  await expect(openaiProvider.getByLabel("Weight")).toBeDisabled();
  await expect(openaiProvider.getByLabel("Canary %")).toBeDisabled();
  await expect(openaiProvider.getByLabel("Max concurrency")).toBeDisabled();
  await expect(openaiProvider.getByLabel("Model").first()).toBeDisabled();
  await expect(openaiProvider.getByRole("button", { name: "Save Routing" })).toBeDisabled();
  await expect(openaiProvider.getByRole("button", { name: "Run Test Call" })).toBeDisabled();
  await expect(openaiProvider.getByRole("button", { name: "Probe Health" })).toBeDisabled();
  await expect(openaiProvider.getByRole("button", { name: "Delete Provider" })).toBeDisabled();

  await expect(page.getByRole("heading", { name: "Provider Routing RBAC Evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider Routing RBAC Runtime Decisions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider Routing RBAC Override Attempt Evidence" })).toBeVisible();
  await expect(page.getByText("No silent fallback").first()).toBeVisible();
});

test("quota, team seats, and billing operation admin surface remains browser-covered", async ({ page }) => {
  await page.goto("/quota");
  await expect(page.getByRole("heading", { name: "Quota Credit and Debit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team Seat Operations" })).toBeVisible();
  await expect(page.getByText("fixture").first()).toBeVisible();
  await expect(page.getByText("Live team seat operations API is unavailable; fixture fallback is read-only.")).toBeVisible();

  const teamSeatOps = page.locator("[data-admin-endpoint='team-seat-ops']");
  await expect(teamSeatOps.getByText("Seat Limit", { exact: true }).first()).toBeVisible();
  await expect(teamSeatOps.getByText("Active Seats", { exact: true }).first()).toBeVisible();
  await expect(teamSeatOps.getByText("Invited Seats", { exact: true }).first()).toBeVisible();
  await expect(teamSeatOps.getByText("Available Seats", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "team_1" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "si_test_team_seats" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "create_prorations" }).first()).toBeVisible();

  const createTeam = page.locator("form.provider-control").filter({ hasText: "Create Team" });
  await expect(createTeam.getByLabel("Team ID")).toHaveValue("team_1");
  await expect(createTeam.getByLabel("Seat limit")).toBeDisabled();
  await expect(createTeam.getByRole("button", { name: "Create Team" })).toBeDisabled();

  const inviteSeat = page.locator("form.provider-control").filter({ hasText: "Invite Seat" });
  await expect(inviteSeat.getByLabel("Email")).toHaveValue("member@example.com");
  await expect(inviteSeat.getByLabel("Role")).toBeDisabled();
  await expect(inviteSeat.getByRole("button", { name: "Invite Seat" })).toBeDisabled();

  const billingLink = page.locator("form.provider-control").filter({ hasText: "Stripe subscription item" });
  await expect(billingLink.getByLabel("Provider")).toBeDisabled();
  await expect(billingLink.getByLabel("Subscription", { exact: true })).toHaveValue("sub_test_team_seats");
  await expect(billingLink.getByLabel("Subscription item")).toHaveValue("si_test_team_seats");
  await expect(billingLink.getByLabel("Proration")).toBeDisabled();
  await expect(billingLink.getByRole("button", { name: "Save Billing Link" })).toBeDisabled();

  const billingOps = page.locator("[data-admin-endpoint='billing-ops']");
  await expect(billingOps).toHaveAttribute("data-admin-endpoint", "billing-ops");
  await expect(billingOps.getByText("Live admin billing operations API is unavailable; mutation forms are disabled.")).toBeVisible();
  await expect(billingOps.locator("[data-admin-billing-contracts]")).toHaveAttribute("data-admin-billing-contracts", billingContracts);
  await expect(billingOps.locator("[data-admin-billing-op='manual_credit']")).toBeVisible();
  await expect(billingOps.locator("[data-admin-billing-op='refund_note']")).toBeVisible();
  await expect(billingOps.locator("[data-admin-billing-op='sync_subscription']")).toBeVisible();
  await expect(billingOps.locator("[data-admin-billing-op='account_lock']")).toBeVisible();
  await expect(billingOps.getByRole("button", { name: "Record Manual Credit" })).toBeDisabled();
  await expect(billingOps.getByRole("button", { name: "Record Refund Note" })).toBeDisabled();
  await expect(billingOps.getByRole("button", { name: "Sync Subscription" })).toBeDisabled();
  await expect(billingOps.getByRole("button", { name: "Save Account Lock" })).toBeDisabled();

  await expect(page.getByRole("cell", { name: "admin_billing_op_manual_credit_fixture_1" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "admin-billing-manual-credit-fixture-1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Production Paid Billing Lifecycle Evidence" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "production_paid_billing_lifecycle", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quota Override RBAC", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Staging Quota Rate Limit Spend Cap Evidence" })).toBeVisible();
});

test("release readiness exposes production non-clearing refresh without manual go controls", async ({ page }) => {
  await page.goto("/release");
  await expect(page.getByRole("heading", { name: "Release Readiness" })).toBeVisible();

  const gateVerdict = page.locator("[data-decision-source='validator_evidence_only']");
  await expect(gateVerdict).toHaveAttribute("data-approval-controls", "disabled");
  await expect(gateVerdict.getByRole("heading", { name: "Gate Verdict" })).toBeVisible();
  await expect(gateVerdict.getByText("strict gates blocked")).toBeVisible();

  const nextBlockers = page.locator("[data-stage1-next-blockers-summary='validator-derived']");
  await expect(nextBlockers).toHaveAttribute("data-stage1-next-blockers-summary-non-clearing", "true");
  await expect(nextBlockers).toHaveAttribute("data-stage1-next-blockers-summary-top-action", /^(production_source_probes_missing|production_dns_https)$/);
  await expect(nextBlockers.getByRole("heading", { name: "Stage1 Next Blockers" })).toBeVisible();
  await expect(nextBlockers.getByText("6/14", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("42.9% complete; 8 open")).toBeVisible();
  await expect(nextBlockers.getByText("2/60", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("3.3% configured; 58 blockers")).toBeVisible();
  await expect(nextBlockers.getByText("0/4", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("4/6", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("Azure SSH").locator("..").getByText("pass", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("Azure SSH").locator("..").getByText("ssh_key_auth_ok", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("Azure transport lane").locator("..").getByText("origin_probe_non_clearing_pass", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("Password/key repair").locator("..").getByText("viable", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("ssh phase auth_reached; Run Command required no", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByRole("heading", { name: "Azure Transport Diagnosis" }).first()).toBeVisible();
  await expect(nextBlockers.getByText("local_azure_cli_missing", { exact: true }).first()).toBeVisible();
  await expect(nextBlockers.getByText("superseded", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("source blocked; superseded by azure_origin_pass", { exact: true })).toBeVisible();
  await expect(nextBlockers.getByText("missing_output")).toBeVisible();
  await expect(nextBlockers.getByText("raw_run_command_output_persisted")).toBeVisible();
  await expect(nextBlockers.getByRole("heading", { name: "Top Priority Action" })).toBeVisible();
  await expect(nextBlockers.locator("strong.mono").filter({ hasText: /ingest_stage1_production_return_artifacts\.py|stage1_production_dns_cutover_plan\.py|stage1_production_source_probe\.py/ })).toBeVisible();

  const copySafeCommands = page.locator("[data-production-copy-safe-commands='operator-handoff']");
  await expect(copySafeCommands).toHaveAttribute("data-production-copy-safe-commands-non-clearing", "true");
  await expect(copySafeCommands).toHaveAttribute("data-production-copy-safe-commands-private-env", "<private-production-env>");
  await expect(copySafeCommands).toHaveAttribute("data-production-copy-safe-commands-exec-controls", "absent");
  await expect(copySafeCommands.getByRole("heading", { name: "Copy-Safe Production Commands" })).toBeVisible();
  await expect(copySafeCommands.getByText("non-clearing", { exact: true })).toBeVisible();
  await expect(copySafeCommands.getByText("Command count")).toBeVisible();
  await expect(copySafeCommands.getByText("9", { exact: true })).toBeVisible();
  await expect(copySafeCommands.getByText("<private-production-env>", { exact: true })).toBeVisible();
  await expect(copySafeCommands.getByRole("cell", { name: "refresh", exact: true })).toBeVisible();
  await expect(copySafeCommands.getByRole("cell", { name: "dns_plan", exact: true })).toBeVisible();
  await expect(copySafeCommands.getByRole("cell", { name: "proof_bundle_private_env", exact: true })).toBeVisible();
  await expect(
    copySafeCommands.getByRole("cell", { name: "python3 scripts/refresh_stage1_production_non_clearing_evidence.py", exact: true })
  ).toBeVisible();
  await expect(
    copySafeCommands.getByRole("cell", {
      name: "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
      exact: true
    })
  ).toBeVisible();
  await expect(copySafeCommands.getByText("copy-safe list does not include --apply")).toBeVisible();

  const actionMatrix = page.locator("[data-production-action-matrix='validator-derived']");
  await expect(actionMatrix).toHaveAttribute("data-production-action-matrix-non-clearing", "true");
  await expect(actionMatrix).toHaveAttribute("data-production-action-matrix-export", "ops/evidence/non_clearing/production-action-matrix.json");
  await expect(actionMatrix.getByRole("heading", { name: "Production Action Matrix" })).toBeVisible();
  await expect(actionMatrix.getByText("58 blockers / no_go")).toBeVisible();
  await expect(actionMatrix.getByText("Open lanes", { exact: true })).toBeVisible();
  await expect(actionMatrix.getByText("Production inputs", { exact: true })).toBeVisible();
  await expect(actionMatrix.getByText("2/60", { exact: true })).toBeVisible();
  await expect(actionMatrix.getByText("3.3% configured")).toBeVisible();
  await expect(actionMatrix.getByText("Missing / invalid", { exact: true })).toBeVisible();
  await expect(actionMatrix.getByText("55/3", { exact: true })).toBeVisible();

  for (const lane of [
    "production_dns_https",
    "production_live_billing",
    "production_security_runtime",
    "production_governance_release"
  ]) {
    await expect(actionMatrix.getByRole("cell", { name: lane, exact: true })).toHaveCount(2);
  }

  for (const ask of [
    "Provide PRODUCTION_DNS_TARGET plus Cloudflare zone/token, or apply the apex/www records manually.",
    "Use live Stripe mode and collect sanitized live checkout, subscription, invoice, refund, quota, and webhook IDs.",
    "Attach production runtime refs for session cookie, CSRF, redaction, admin privacy, key containment, CSP, RBAC, audit, and spend caps.",
    "Provide activation, abuse, and skill release runtime request IDs plus immutable production audit refs."
  ]) {
    await expect(actionMatrix.getByRole("cell", { name: ask, exact: true })).toHaveCount(2);
  }

  for (const loopBreaker of [
    "staging aggregate is already go",
    "R2 zenari bucket is already a staging resource, not the current production blocker",
    "Stripe sandbox is not the current blocker; live mode proof is required",
    "z.ai/OpenAI-compatible LLM is not the current blocker",
    "worker/crawler/migrate are backend runtime entrypoints, not release images",
    "manager is legacy local-only and not a release surface"
  ]) {
    await expect(actionMatrix.getByRole("cell", { name: loopBreaker, exact: true })).toBeVisible();
  }

  const operatorPackets = page.locator("[data-production-operator-packets='validator-derived']");
  await expect(operatorPackets).toHaveAttribute("data-production-operator-packets-non-clearing", "true");
  await expect(operatorPackets).toHaveAttribute(
    "data-production-billing-operator-packet",
    "ops/evidence/non_clearing/production-billing-operator-packet.json"
  );
  await expect(operatorPackets).toHaveAttribute(
    "data-production-security-operator-packet",
    "ops/evidence/non_clearing/production-security-operator-packet.json"
  );
  await expect(operatorPackets).toHaveAttribute(
    "data-production-legal-support-operator-packet",
    "ops/evidence/non_clearing/production-legal-support-operator-packet.json"
  );
  await expect(operatorPackets).toHaveAttribute(
    "data-production-governance-operator-packet",
    "ops/evidence/non_clearing/production-governance-operator-packet.json"
  );
  await expect(operatorPackets).toHaveAttribute("data-production-billing-live-artifacts", "variable-names-only");
  await expect(operatorPackets).toHaveAttribute("data-production-security-runtime-refs", "variable-names-only");
  await expect(operatorPackets).toHaveAttribute("data-production-security-private-env-template", "blank-values-only");
  await expect(operatorPackets).toHaveAttribute("data-production-security-operator-command-packet", "review-gated-source-write");
  await expect(operatorPackets).toHaveAttribute("data-production-legal-support-public-paths", "public-path-tokens-only");
  await expect(operatorPackets).toHaveAttribute("data-production-governance-required-ids", "variable-names-only");
  await expect(operatorPackets).toHaveAttribute("data-production-governance-private-env-template", "blank-values-only");
  await expect(operatorPackets).toHaveAttribute("data-production-governance-operator-command-packet", "review-gated-source-write");
  await expect(operatorPackets.getByRole("heading", { name: "Production Operator Packets" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Billing Live Proof Inputs" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Required Live Stripe Artifacts" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Security Runtime Proof Inputs" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Required Security Runtime Refs" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Security Private Env Template" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Security Operator Command Packet" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Legal Support Production Proof Inputs" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Required Legal Support Public Paths" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Legal Operator Command Packet" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Governance Production Proof Inputs" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Governance Required IDs" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Governance Private Env Template" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Governance Operator Command Packet" })).toBeVisible();

  await expect(operatorPackets.locator("article").filter({ hasText: "Packet files" }).getByText("4/4", { exact: true })).toBeVisible();
  await expect(operatorPackets.locator("article").filter({ hasText: "Open packets" }).getByText("4", { exact: true })).toBeVisible();
  await expect(operatorPackets.locator("article").filter({ hasText: "Canonical sources" }).getByText("0/4", { exact: true })).toBeVisible();
  await expect(operatorPackets.locator("article").filter({ hasText: "Blocked until" }).getByText("36", { exact: true })).toBeVisible();
  await expect(operatorPackets.locator("article").filter({ hasText: "Billing live artifacts" }).getByText("14", { exact: true })).toBeVisible();
  await expect(operatorPackets.locator("article").filter({ hasText: "Security runtime refs" }).getByText("10", { exact: true })).toBeVisible();
  await expect(operatorPackets.locator("article").filter({ hasText: "Legal public paths" }).getByText("9", { exact: true })).toBeVisible();
  await expect(operatorPackets.locator("article").filter({ hasText: "Governance refs" }).getByText("15", { exact: true })).toBeVisible();

  await expect(operatorPackets.getByRole("cell", { name: "--checkout-session-id", exact: true })).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "cs_live_", exact: true })).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "--secure-session-cookie-ref", exact: true })).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "secure_session_cookie", exact: true })).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "/legal/terms", exact: true })).toHaveCount(2);
  await expect(operatorPackets.getByRole("cell", { name: "/report-problem", exact: true })).toHaveCount(2);
  await expect(operatorPackets.getByRole("cell", { name: "activation", exact: true }).first()).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "abuse", exact: true }).first()).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "skill", exact: true }).first()).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "--skill-release-notes-id", exact: true })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Billing Private Env Template" })).toBeVisible();
  await expect(operatorPackets.getByRole("heading", { name: "Billing Operator Command Packet" })).toBeVisible();
  await expect(operatorPackets.locator("article").filter({ hasText: "Private env" }).getByText("<private-production-env>", { exact: true })).toHaveCount(3);
  await expect(operatorPackets.locator("article").filter({ hasText: "Canonical writes" }).getByText("1", { exact: true })).toHaveCount(4);
  await expect(operatorPackets.locator("article").filter({ hasText: "DNS apply commands" }).getByText("1", { exact: true })).toBeVisible();
  for (const blankLine of [
    "STRIPE_MODE=",
    "STRIPE_SECRET_KEY=",
    "STRIPE_API_KEY=",
    "STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID=",
    "STAGE1_PROD_BILLING_WEBHOOK_IDEMPOTENCY_REF="
  ]) {
    await expect(operatorPackets.getByRole("cell", { name: blankLine, exact: true })).toBeVisible();
  }
  for (const step of [
    "validate_live_billing_candidate_or_diagnostic",
    "run_billing_source_probe_after_candidate_passes",
    "generate_strict_billing_evidence",
    "validate_strict_billing_evidence"
  ]) {
    await expect(operatorPackets.getByRole("cell", { name: step, exact: true })).toBeVisible();
  }
  await expect(operatorPackets.getByRole("cell", { name: "run_private_env_proof_bundle", exact: true })).toHaveCount(3);
  await expect(operatorPackets.getByRole("cell", { name: "refresh_non_clearing_summary", exact: true })).toHaveCount(3);
  await expect(
    operatorPackets.getByRole("cell", {
      name: "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
      exact: true
    })
  ).toHaveCount(3);
  await expect(operatorPackets.getByRole("cell", { name: "writes billing canonical source only after live billing proof passes", exact: true })).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "plan_dns_cutover_with_private_env", exact: true })).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "apply_dns_cutover_after_review", exact: true })).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "run_legal_support_source_probe_after_https_passes", exact: true })).toBeVisible();
  await expect(
    operatorPackets.getByRole("cell", {
      name: "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
      exact: true
    })
  ).toHaveCount(2);
  await expect(
    operatorPackets.getByRole("cell", {
      name: "python3 scripts/stage1_production_source_probe.py --legal-support --release-sha $(git rev-parse HEAD) --production-web-url https://zenari.ai --diagnostic ops/evidence/production/source-probe-diagnostics.legal-support.json --write-canonical-source",
      exact: true
    })
  ).toHaveCount(3);
  await expect(
    operatorPackets.getByRole("cell", {
      name: "writes legal/support canonical source only after production DNS and HTTPS public pages pass",
      exact: true
    })
  ).toBeVisible();

  for (const blankLine of [
    "STAGE1_PROD_SECURITY_SAME_SITE=",
    "STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF=",
    "STAGE1_PROD_SECURITY_AUDIT_REF=",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS=",
    "STAGE1_PROD_GOVERNANCE_SKILL_CANARY_SAMPLE_SIZE=",
    "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_REF="
  ]) {
    await expect(operatorPackets.getByRole("cell", { name: blankLine, exact: true })).toBeVisible();
  }
  for (const step of [
    "validate_security_candidate_or_diagnostic",
    "run_security_source_probe_after_candidate_passes",
    "generate_strict_security_evidence",
    "validate_strict_security_evidence",
    "validate_governance_candidate_or_diagnostic",
    "run_governance_source_probe_after_candidate_passes",
    "generate_strict_governance_evidence",
    "validate_strict_governance_evidence"
  ]) {
    await expect(operatorPackets.getByRole("cell", { name: step, exact: true })).toBeVisible();
  }
  await expect(operatorPackets.getByRole("cell", { name: "writes security canonical source only after production security proof passes", exact: true })).toBeVisible();
  await expect(operatorPackets.getByRole("cell", { name: "writes governance canonical source only after production governance proof passes", exact: true })).toBeVisible();

  const dnsRepair = page.locator("[data-production-dns-repair-packet='validator-derived']");
  await expect(dnsRepair).toHaveAttribute("data-production-dns-repair-packet-non-clearing", "true");
  await expect(dnsRepair).toHaveAttribute("data-production-dns-repair-packet-export", "ops/evidence/non_clearing/production-dns-repair-packet.json");
  await expect(dnsRepair.getByRole("heading", { name: "Production DNS Repair Packet" })).toBeVisible();
  await expect(dnsRepair.getByRole("heading", { name: "Private DNS Env Template" })).toBeVisible();
  await expect(dnsRepair.getByRole("heading", { name: "DNS Operator Command Packet" })).toBeVisible();
  await expect(dnsRepair.locator("article").filter({ hasText: "Private env" }).getByText("<private-production-env>", { exact: true })).toBeVisible();
  await expect(dnsRepair.locator("article").filter({ hasText: "DNS write steps" }).getByText("1", { exact: true })).toBeVisible();
  for (const blankLine of [
    "PRODUCTION_DNS_TARGET=",
    "CLOUDFLARE_ZONE_ID=",
    "CF_ZONE_ID=",
    "CLOUDFLARE_API_TOKEN=",
    "CF_API_TOKEN="
  ]) {
    await expect(dnsRepair.getByRole("cell", { name: blankLine, exact: true })).toBeVisible();
  }
  for (const step of [
    "generate_plan_with_private_env",
    "validate_plan",
    "apply_reviewed_dns",
    "wait_and_probe_dns",
    "regenerate_repair_packet",
    "validate_repair_packet",
    "refresh_non_clearing_summary"
  ]) {
    await expect(dnsRepair.getByRole("cell", { name: step, exact: true })).toBeVisible();
  }
  await expect(
    dnsRepair.getByRole("cell", {
      name: "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
      exact: true
    })
  ).toHaveCount(2);
  await expect(dnsRepair.getByRole("cell", { name: "operator-owned Cloudflare DNS write after review", exact: true })).toBeVisible();

  const refresh = page.locator("[data-production-non-clearing-refresh='validator-derived']");
  await expect(refresh).toHaveAttribute("data-production-non-clearing-refresh-export", "ops/evidence/non_clearing/production-non-clearing-refresh.json");
  await expect(refresh).toHaveAttribute("data-production-non-clearing-refresh-non-clearing", "true");
  await expect(refresh).toHaveAttribute("data-production-non-clearing-refresh-canonical-sources-requested", "false");
  await expect(refresh).toHaveAttribute("data-production-non-clearing-refresh-dns-apply-requested", "false");
  await expect(refresh.getByRole("heading", { name: "Production Non-Clearing Refresh" })).toBeVisible();
  await expect(refresh.getByText("blocked / no_go")).toBeVisible();
  await expect(refresh.getByText("Refresh steps", { exact: true })).toBeVisible();
  await expect(refresh.getByRole("heading", { name: "Refresh Steps" })).toBeVisible();
  await expect(refresh.getByText("35/38", { exact: true })).toBeVisible();
  await expect(refresh.getByText("3 blocked / 0 failed")).toBeVisible();
  await expect(refresh.getByText("Stage1 gates", { exact: true })).toBeVisible();
  await expect(refresh.getByText("6/14", { exact: true })).toBeVisible();
  await expect(refresh.getByText("42.9% complete")).toBeVisible();
  await expect(refresh.getByText("External resources", { exact: true })).toBeVisible();
  await expect(refresh.getByText("5/7", { exact: true })).toBeVisible();
  await expect(refresh.getByText("71.4% ready")).toBeVisible();
  await expect(refresh.getByText("Production inputs", { exact: true })).toBeVisible();
  await expect(refresh.getByText("2/60", { exact: true })).toBeVisible();
  await expect(refresh.getByText("3.3% configured")).toBeVisible();
  await expect(refresh.getByText("Source probes", { exact: true })).toBeVisible();
  await expect(refresh.getByText("0/4", { exact: true })).toBeVisible();

  for (const lane of [
    "production_dns_https",
    "production_live_billing",
    "production_security_runtime",
    "production_governance_release"
  ]) {
    await expect(refresh.getByRole("cell", { name: lane, exact: true })).toBeVisible();
  }

  await expect(refresh.getByRole("cell", { name: "billing_proof_missing", exact: true })).toBeVisible();
  await expect(refresh.getByRole("cell", { name: "security_proof_missing", exact: true })).toBeVisible();
  await expect(refresh.getByRole("cell", { name: "governance_proof_missing", exact: true })).toBeVisible();
  await expect(refresh.getByRole("heading", { name: "Refresh Output Refs" })).toBeVisible();
  await expect(refresh.getByRole("cell", { name: "ops/evidence/non_clearing/production-action-matrix.json", exact: true })).toBeVisible();

  const azureOrigin = page.locator("[data-azure-origin-readiness='validator-derived']");
  await expect(azureOrigin).toHaveAttribute("data-azure-origin-readiness-non-clearing", "true");
  await expect(azureOrigin).toHaveAttribute("data-azure-origin-readiness-export", "ops/evidence/staging/stage1-azure-origin-readiness.json");
  await expect(azureOrigin.getByRole("heading", { name: "Azure Origin Readiness" })).toBeVisible();
  await expect(azureOrigin.getByText("pass / no_go")).toBeVisible();
  await expect(azureOrigin.locator("article").filter({ hasText: "Azure IP" }).getByText("52.237.80.117", { exact: true })).toBeVisible();
  await expect(azureOrigin.locator("article").filter({ hasText: "TCP ports" }).getByText("3/3", { exact: true })).toBeVisible();
  await expect(azureOrigin.locator("article").filter({ hasText: "HTTP probes" }).getByText("4/6", { exact: true })).toBeVisible();
  await expect(
    azureOrigin
      .locator("article")
      .filter({ hasText: "SSH hard timeout" })
      .getByText(`${azureSshHardTimeoutSeconds}s`, { exact: true })
  ).toBeVisible();
  await expect(azureOrigin.locator("article").filter({ hasText: "Transport lane" }).getByText("origin_probe_non_clearing_pass", { exact: true })).toBeVisible();
  await expect(azureOrigin.locator("article").filter({ hasText: "SSH transport phase" }).getByText("auth_reached", { exact: true })).toBeVisible();
  await expect(azureOrigin.locator("article").filter({ hasText: "Password/key repair viable" }).getByText("yes", { exact: true })).toBeVisible();
  await expect(azureOrigin.getByRole("heading", { name: "Azure Transport Diagnosis" }).first()).toBeVisible();
  await expect(azureOrigin.getByRole("cell", { name: "azurePortalRunCommandRequired", exact: true })).toBeVisible();
  await expect(azureOrigin.getByRole("cell", { name: "sshPasswordKeyRepairViable", exact: true })).toBeVisible();
  await expect(azureOrigin.locator("article").filter({ hasText: "Azure CLI preflight" }).getByText("blocked", { exact: true })).toBeVisible();
  await expect(azureOrigin.getByText("az_cli_missing", { exact: true }).first()).toBeVisible();
  await expect(azureOrigin.locator("article").filter({ hasText: "Repair env key" }).getByText("STAGING_SSH_PASSWORD", { exact: true })).toBeVisible();
  await expect(azureOrigin.getByText("local_azure_cli_missing", { exact: true }).first()).toBeVisible();
  await expect(azureOrigin.getByText("tls_error", { exact: true }).first()).toBeVisible();
  const azureRunCommandHandoff = azureOrigin.locator("[data-azure-run-command-handoff='operator-card-derived']");
  await expect(azureRunCommandHandoff).toHaveAttribute("data-azure-run-command-operator-card", "ops/evidence/staging/azure-run-command-operator-card.md");
  await expect(azureRunCommandHandoff).toHaveAttribute("data-azure-run-command-payload", "ops/evidence/staging/azure-run-command-ssh-repair.sh");
  await expect(azureRunCommandHandoff).toHaveAttribute("data-azure-run-command-ingest", "python3 scripts/ingest_azure_run_command_output.py");
  await expect(azureRunCommandHandoff).toHaveAttribute("data-azure-run-command-password-key-repair-viable", "yes");
  await expect(azureRunCommandHandoff).toHaveAttribute("data-azure-run-command-required", "no");
  await expect(azureRunCommandHandoff.getByRole("heading", { name: "Azure Portal Run Command Handoff" })).toBeVisible();
  await expect(azureRunCommandHandoff.getByText("RunShellScript", { exact: true })).toBeVisible();
  await expect(azureRunCommandHandoff.getByRole("cell", { name: "operator_card", exact: true })).toBeVisible();
  await expect(azureRunCommandHandoff.getByRole("cell", { name: "portal_payload", exact: true })).toBeVisible();
  await expect(azureRunCommandHandoff.getByRole("cell", { name: "local_ingest", exact: true })).toBeVisible();
  await expect(azureRunCommandHandoff.getByRole("cell", { name: "open ops/evidence/staging/azure-run-command-operator-card.md", exact: true })).toBeVisible();
  await expect(azureRunCommandHandoff.getByRole("cell", { name: "ops/evidence/staging/azure-run-command-ssh-repair.sh", exact: true })).toBeVisible();
  await expect(azureRunCommandHandoff.getByRole("cell", { name: "python3 scripts/ingest_azure_run_command_output.py", exact: true })).toBeVisible();
  await expect(azureRunCommandHandoff.getByText("check auth", { exact: true })).toBeVisible();
  const azureOriginRepairCommands = azureOrigin.locator(".release-subsection").filter({ hasText: "Azure Origin Repair Commands" });
  await expect(azureOriginRepairCommands.getByRole("heading", { name: "Azure Origin Repair Commands" })).toBeVisible();
  await expect(azureOriginRepairCommands.getByRole("cell", { name: "scripts/azure_staging_run_command_payload.sh", exact: true })).toBeVisible();
  await expect(azureOriginRepairCommands.getByRole("cell", { name: "python3 scripts/ingest_azure_run_command_output.py", exact: true })).toBeVisible();
  await expect(
    azureOriginRepairCommands.getByRole("cell", {
      name: "python3 scripts/sanitize_azure_run_command_output.py --output ops/evidence/staging/azure-run-command-ssh-repair.output.txt --require-marker",
      exact: true
    })
  ).toBeVisible();
  await expect(
    azureOriginRepairCommands.getByRole("cell", {
      name: "python3 scripts/classify_azure_run_command_output.py --input ops/evidence/staging/azure-run-command-ssh-repair.output.txt --output ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json || test $? -eq 2",
      exact: true
    })
  ).toBeVisible();
  await expect(azureOriginRepairCommands.getByRole("cell", { name: "scripts/azure_staging_cli_preflight.sh", exact: true })).toBeVisible();
  await expect(
    azureOriginRepairCommands.getByRole("cell", { name: "RUN_AZURE_STAGING_RUN_COMMAND=1 scripts/azure_staging_run_command_invoke.sh", exact: true })
  ).toBeVisible();
  await expect(azureOriginRepairCommands.getByRole("cell", { name: "scripts/azure_staging_password_key_repair.sh", exact: true })).toBeVisible();
  await expect(azureOriginRepairCommands.getByRole("cell", { name: "scripts/azure_staging_origin_repair.sh", exact: true })).toBeVisible();
  await expect(azureOrigin.getByRole("heading", { name: "Azure Origin Next Actions" })).toBeVisible();
  await expect(azureOrigin.getByText("Azure origin probes returned at least one usable HTTP response", { exact: false }).first()).toBeVisible();

  await expect(page.getByRole("button", { name: /go|approve|override|launch/i })).toHaveCount(0);
});
