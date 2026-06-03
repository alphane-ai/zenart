# Stage 0 Rev2 Runtime Evidence Closure

This runbook keeps the final Rev2 release-gate closure mechanical and auditable.
It does not replace the validator, and it must not be used to close Stripe rows
while paid billing is deferred.

## One Command Pipeline

The default pipeline is non-mutating. It still renders reconciliation and plan
reports when source artifacts are missing, so operators get a complete no-go
state instead of a partial failed run:

```bash
scripts/run_release_closure_pipeline.sh
```

The pipeline writes `runtime-input-manifest.json`, which classifies each blocker
as `runtime_artifact_required`, `upstream_gate_dependency`, or
`deferred_by_user` and includes the expected input directory plus the operator
command for the missing artifact.
It also writes `runtime-input-workspace.json`; when run with `--apply`, that
step creates only input directories and README files, not JSON evidence.

Use `--apply` only after the collector/promoter passes and the generated plans
contain the expected pass-ready changes:

```bash
scripts/run_release_closure_pipeline.sh \
  --run-id <github-actions-run-id> \
  --apply
```

## Inputs

- CI artifacts downloaded from the installed `.github/workflows/stage0-rev2-ci.yml` PR/main run.
- External staging probe artifacts for object retention cleanup, legal pages, and support contact visibility.
- Production runtime artifacts for backup/restore and rollback/incident/post-deploy smoke.
- Stripe production billing artifacts only after paid billing work is resumed.

## Collection

Prepare the runtime input directories and run the strict promoter in dry-run mode:

```bash
RUN_ID=<github-actions-run-id> DRY_RUN=1 scripts/collect_release_runtime_artifacts.sh
```

For manually staged inputs, place artifacts under:

```text
ops/evidence/runtime-inputs/ci
ops/evidence/runtime-inputs/staging
ops/evidence/runtime-inputs/production
```

Then run:

```bash
python3 scripts/promote_release_runtime_artifacts.py \
  --ci-input-dir ops/evidence/runtime-inputs/ci \
  --staging-input-dir ops/evidence/runtime-inputs/staging \
  --production-input-dir ops/evidence/runtime-inputs/production \
  --dry-run
```

Only remove `--dry-run` when every promoter returns pass evidence and no output
contains a local, blocked, incomplete, or deferred claim.

## Reconciliation

Render the non-mutating reconciliation report:

```bash
python3 scripts/reconcile_release_gate_runtime_evidence.py \
  --out ops/evidence/release/runtime-reconciliation.json
```

Generate the runtime input manifest:

```bash
python3 scripts/plan_release_runtime_inputs.py \
  --reconciliation ops/evidence/release/runtime-reconciliation.json \
  --out ops/evidence/release/runtime-input-manifest.json
```

Prepare the input workspace without creating evidence:

```bash
python3 scripts/prepare_release_runtime_inputs.py \
  --manifest ops/evidence/release/runtime-input-manifest.json \
  --artifact-root ops/evidence/runtime-inputs \
  --out ops/evidence/release/runtime-input-workspace.json
```

Generate the fixture update plan:

```bash
python3 scripts/plan_release_gate_fixture_updates.py \
  --reconciliation ops/evidence/release/runtime-reconciliation.json \
  --out ops/evidence/release/fixture-update-plan.json
```

Generate the blueprint checklist closure plan:

```bash
python3 scripts/plan_stage0_rev2_checklist_closure.py \
  --fixture-plan ops/evidence/release/fixture-update-plan.json \
  --out ops/evidence/release/checklist-closure-plan.json
```

Both plan files are dry-run artifacts. They describe what can be changed; they
do not edit release gate fixtures or `Docs/stage0_blueprint_rev2.md`.

Render the non-mutating apply report:

```bash
python3 scripts/apply_release_closure_plan.py \
  --fixture-plan ops/evidence/release/fixture-update-plan.json \
  --checklist-plan ops/evidence/release/checklist-closure-plan.json \
  --out ops/evidence/release/closure-apply-report.json
```

Only use `--apply` after the plan has non-zero pass-ready changes and every
referenced runtime evidence file exists:

```bash
python3 scripts/apply_release_closure_plan.py \
  --fixture-plan ops/evidence/release/fixture-update-plan.json \
  --checklist-plan ops/evidence/release/checklist-closure-plan.json \
  --out ops/evidence/release/closure-apply-report.json \
  --apply
```

The one-command pipeline writes the same reports under `ops/evidence/release/`
and adds `runtime-input-manifest.json`, `runtime-input-workspace.json`, and
`closure-pipeline-report.json`.

## Closure Order

1. Promote real canonical runtime evidence.
2. Reconcile runtime evidence against release gate fixtures.
3. Inspect `fixture-update-plan.json`.
4. Apply only the pass-ready fixture check updates named in the plan.
5. Recompute each fixture `gate_decision` from its remaining blocked checks and active Do-Not-Launch conditions.
6. Inspect `checklist-closure-plan.json`.
7. Close only checklist rows whose matching fixture checks are already pass.
8. Prefer `scripts/apply_release_closure_plan.py --apply` so fixture updates, checklist closures, and validation run as one operation.
9. Run `python3 scripts/validate_stage0_rev2.py`.
10. Run `LOCAL_CI_BACKEND=0 LOCAL_CI_WEB=0 LOCAL_CI_ADMIN=0 LOCAL_CI_INSTALL=0 scripts/local_ci.sh`.

## Current Deferred Work

Stripe is intentionally deferred by the user. The following rows must remain
open until production billing evidence exists and paid billing is resumed:

- `Production paid billing lifecycle runtime/deployment evidence 通过。`
- `Production checkout/subscription/cancellation/past_due runtime evidence 通过 under ops/evidence/production/。`
- `Production refund/credit/quota reset/webhook idempotency runtime evidence 通过 under ops/evidence/production/。`
- `Production Launch Gate 全部通过。`
- `Do-Not-Launch Conditions 全部为 false。`
