# Lovart Final - Zenari Done - Bridge Blueprint

Status: candidate execution blueprint  
Date: 2026-06-21  
Owner lane: master product/engineering lane  
Skill model: looper final/done/bridge execution surface  
Primary target: move Zenari from a Stage 0 workflow shell toward a Lovart-class AI design agent workspace.

## 0. Authority And Evidence Boundary

This file is a bridge blueprint, not a replacement for
`Docs/stage0_blueprint_rev2.md`. Stage 0 Rev2 remains the current launch-readiness
authority. This bridge expands the product target after Stage 0 by comparing:

- Final: Lovart.ai public product/docs behavior researched on 2026-06-21.
- Done: current Zenari repository state and Stage 0 Rev2 evidence.
- Bridge: executable loops that close the gap without breaking existing release
  gates, tenant isolation, export safety, provider provenance, billing/quota, or
  audit contracts.

Evidence used:

- Lovart official pages and docs captured under `tmp/lovart-research/`:
  `playwright-summary.json`, `cdp-evidence.json`, `extracted/*.txt`,
  `curl-text/*.txt`, and screenshots in `pages/*.png`.
- Lovart public docs URLs:
  `https://www.lovart.ai/docs/getting-started/how-lovart-works`,
  `https://www.lovart.ai/docs/getting-started/design-your-first-project`,
  `https://www.lovart.ai/docs/how-to-prompt/adding-references`,
  `https://www.lovart.ai/docs/how-to-prompt/selecting-ai-models`,
  `https://www.lovart.ai/docs/how-to-prompt/chat-tools`,
  `https://www.lovart.ai/docs/how-to-prompt/agent-skills`,
  `https://www.lovart.ai/docs/how-to-prompt/other-things-you-can-prompt-to-create`,
  `https://www.lovart.ai/docs/edit-your-design/basic-editing`,
  `https://www.lovart.ai/docs/edit-your-design/basic-ai-editing`,
  `https://www.lovart.ai/docs/edit-your-design/advanced-ai-editing`,
  `https://www.lovart.ai/docs/edit-your-design/ai-transformation`,
  `https://www.lovart.ai/docs/edit-your-design/canvas-objects`.
- CDP limitation: the local CDP session loaded Lovart page titles but produced
  empty body text in headless DOM. The content evidence therefore comes from
  Lovart's official HTML/RSC responses and Playwright-visible pages. Treat CDP
  title capture as navigation evidence, not as full interaction proof.
- Zenari Done evidence:
  `README.md`, `Docs/stage0_blueprint_rev2.md`, `openapi/zenart.v1.yaml`,
  `web/components/workspace-app.tsx`, `web/lib/dev-state.ts`, and local-alpha
  evidence under `ops/evidence/local_alpha/`.

Private runtime note: `tmp/lovart-research/` is local research evidence. Do not
make it a permanent launch gate. If this blueprint becomes authoritative, copy
only compact, non-private evidence summaries into a committed `Docs/looper/`
report and keep raw captures disposable.

## 1. Final: Lovart-Class Product Target

Lovart's public docs describe a product that is not only a four-candidate
workflow generator. The target is a single creative workspace where an AI agent
plans, routes models, generates assets, edits assets, keeps brand/style context,
and exports production files from an infinite canvas.

### 1.1 Final Product Shape

Final user promise:

```text
plain-language brief + references + brand context
  -> agent picks tools/models or follows explicit user model/skill choices
  -> assets land on an infinite editable canvas
  -> user can select, mark, layer, transform, regenerate, animate, and organize
  -> agent preserves brand/style context across iterations
  -> export individual or multi-asset deliverables in production formats
```

Observed Lovart final capabilities:

- AI design agent turns ideas into product shots, social posts, marketing kits,
  brand videos, slides, and campaign assets.
- The agent can choose tools/models automatically, with explicit override via
  model selection or `@` mentions.
- Requests can include prompt text, reference files, Brand Kits, Canvas elements,
  uploaded assets, and web search context.
- Outputs land on an infinite Canvas, where elements are editable and reversible.
- Quickstart projects sit near the input box and load preset prompt/model/reference
  bundles.
- One-click Skills encode prompt best practices, design guidelines, missing-info
  collection, and multi-step chains.
- Custom Skills can be created from successful conversations and rerun later.
- Image and video generators can bypass the agent for direct model control.
- Web Search can gather current trends, public URLs, design references, and
  factual context.
- Thinking Mode favors multi-step structured work; Fast Mode favors quick
  exploration.
- Voice Mode can input prompts without keyboard use.
- OpenClaw integration is documented as a way to use Lovart from another agent
  environment.
- Brand Kit stores logos, colors, fonts, guidance, and parsed brand books, and
  can be applied globally to a project or mentioned for one generation.
- Assets Library stores reusable character, audio, and video assets across
  projects.

### 1.2 Final Canvas And Editing Surface

Final canvas target:

- Infinite canvas with pan/zoom/hand tool behavior.
- Add to Canvas for images/videos via upload and drag/drop.
- Selectable objects and Canvas mentions.
- Frames as artboards/containers for multi-panel layouts and specific export
  sizes.
- Shapes, pencil/freehand vector lines, and editable text layers.
- Top-bar tools for selected images.
- Multi-select and batch export.
- Reversible edits that create fresh assets beside originals.
- Community/publish flow can exist later, but is not required for the first
  Zenari bridge.

Final editing target:

- Basic edits: adjust sliders, crop, flip, rotate.
- Basic AI edits: upscale to 2K/4K/8K, remove background, eraser/inpaint,
  expand/outpaint.
- Advanced AI edits: Quick Edit via selected element, mark/touch edit on a
  region or object, Edit Elements to split into movable layers, Edit Text to
  rewrite embedded text while preserving style.
- Transformations: Multi-Angles for viewpoint changes, Move Object with
  rectangle/lasso, Vectorize raster to SVG, Mockup on real-world surfaces.
- Generated font, slide deck, and video clipper workflows are available from the
  prompt/canvas surface.

### 1.3 Final Provider And Commerce Target

Final provider target:

- A capability registry spans image, video, and 3D providers/models.
- Auto routing chooses suitable models for each task.
- User model preference supports image/video/3D categories.
- Strict model lock is possible through mentions.
- Direct generators expose model-specific parameters such as resolution, aspect
  ratio, duration, start/end frames, and reference modes.
- Provider routing should optimize quality, speed, stability, cost, and safety.

Final commerce target:

- Credits/quota govern generation and concurrent tasks.
- Plan tiers unlock model access, concurrent tasks, commercial license, credit
  refill discounts, team seats, and priority/express queues.
- Stripe or equivalent payment plumbing can be treated as a lower-risk bridge
  for Zenari because current repository already has billing/quota abstractions;
  the higher-risk gap is product surface, interaction, provider depth, and agentic
  creative execution.

## 2. Done: Current Zenari State

Zenari currently has a Stage 0 local-alpha product with strong operational,
contract, and safety scaffolding. It does not yet have a Lovart-class editor.

Done product path:

```text
chatbox
  -> missing-info clarification and brief confirmation
  -> deterministic local provider workflow fixtures
  -> 4 strategy candidates
  -> select one direction
  -> iterate selected direction
  -> basic canvas nodes/autosave/version restore
  -> package panel/history
  -> export preview/download with QA/safety/provenance
```

Done evidence:

- README states Zenari is an early-stage product planning repository for an
  agentic visual design workspace and points to Stage 0 Rev2 as authority.
- Stage 0 Rev2 intentionally limits the user-visible scope to account/project,
  chatbox, infinite canvas, four candidates, selection, iteration, package,
  export, billing/quota, and support.
- Stage 0 Rev2 has completed rows for monorepo, schema, API contracts, web shell,
  auth/session, project dashboard, chatbox, reference upload, four candidate
  cards, candidate select/iteration, canvas node rendering/autosave/version
  restore, package/export UI, billing/quota, support, admin, tenant isolation,
  billing abstraction, object storage/export, and provider contracts.
- OpenAPI defines workspace, chat, task, candidate, selected direction, canvas
  node/frame/version, upload, package/export, billing/quota, provider status,
  provider usage, skill, trace, QA, safety, and admin surfaces.
- `web/components/workspace-app.tsx` renders a dashboard-style product shell:
  Brief panel, reference attachment, evidence panels, a bounded `canvas-surface`
  with absolute-positioned nodes, version chips, candidate cards, iteration form,
  package panel, export panel, billing, account, and support.
- Current canvas rendering is evidence-rich but editor-light: it maps nodes and
  edges to DOM blocks and restores versions, but it lacks pan/zoom interaction,
  object transforms, selection handles, region marking, layer manipulation,
  crop/rotate/upscale/remove-bg/expand/move-object/vectorize/mockup/text-edit
  tools, direct image/video generator panels, and model parameter controls.
- Current provider surface is contract-rich but production-provider-light:
  Stage 0 has dev provider, provider status, capability matrix, routing contract,
  trace/provenance, and fallback rules, but the user side intentionally hides
  provider/model routing.
- Current billing is already a favorable bridge base: subscription state machine,
  mock checkout, paid provider abstraction, entitlement, weekly quota, reservation,
  commit/refund, retry/idempotency, provider usage reconciliation, spend cap, and
  kill switch exist.

Done conclusion:

Zenari is not missing the scaffolding for a paid SaaS. It is missing the core
Lovart-like creative workspace: a true infinite canvas, direct manipulation,
agentic tool invocation from selection/context, provider-rich generation, and
editing tools that create usable visual assets rather than contract evidence.

## 3. Gap Model

Severity scale:

- P0: must bridge before claiming Lovart-class workspace.
- P1: required for private beta with creative users.
- P2: required for differentiation, scale, or monetization, but can follow after
  the core editor works.

### 3.1 P0 Gaps

| Gap | Final | Done | Bridge |
| --- | --- | --- | --- |
| Infinite canvas interaction | Pan/zoom, selection, drag/drop, frames, multi-select, object transforms | Static bounded `canvas-surface` with nodes/edges and version chips | Replace visual workspace with transformable canvas runtime and stable object model |
| Canvas object model | Images, videos, text, shapes, frames, vectors, generated layers | Canvas nodes/edges/frames exist in schema; UI renders text-like nodes | Add typed canvas object schema, transforms, z-index, selection state, asset refs |
| Agentic selection/context | Selected Canvas element enters input as context; `@` mentions lock assets/models/Brand Kits | Selected candidate only; no canvas object mention model | Add prompt composer with selected object chips, mention picker, contextual tool invocation |
| Editing tools | Adjust/crop/flip/rotate/upscale/remove-bg/eraser/expand/mark/edit-elements/edit-text | No actual image editing tools in user UI | Ship tool rail/top-bar and backend task contracts for edit operations |
| Provider-rich generation | Auto model routing plus direct image/video/3D generator controls | Dev provider and hidden routing contracts | Add provider adapter layer for real image/video providers and user-safe model picker |
| Reversible creative versions | Edits land as fresh assets beside originals | Canvas version restore exists, but not per-object edit lineage | Add asset lineage graph and branchable edit history |
| Production asset visibility | Generated assets are visual files with preview, provenance, safety, QA | Deterministic placeholder evidence and local-alpha fixtures | Store/render generated images/videos and show status/provenance inline |

### 3.2 P1 Gaps

| Gap | Final | Done | Bridge |
| --- | --- | --- | --- |
| Brand Kit | Logos, colors, fonts, guidance, parsed brand book, project/global application | Account settings and reference upload; no Brand Kit object | Add Brand Kit CRUD, parser, project selector, prompt mention, provider payload injection |
| Assets Library | Reusable character/audio/video assets across projects | Reference upload is per workspace/export path | Add asset library with tenant-scoped reusable assets and prompt/canvas insertion |
| Skills as user-visible workflows | Skill Book, built-in skills, custom skills from conversation | Hidden skills in admin; user side forbidden to expose skill market in Stage 0 | Add curated user-visible Skills after Stage0, separate from admin skill registry |
| Direct generator panels | Image/video generator with model settings bypasses agent | Candidate generation task only | Add direct generation panels with provider-specific parameter schema |
| Web Search/Visual Insights | Real-time trend/reference/webpage context | Crawler/admin hidden; no user-facing web search | Add safe user-facing web search mode with citation/provenance/redaction |
| Slide/video workflows | Slides on canvas, video clipper, image-to-video | PPT-ready metadata; PDF placeholder; no video UI | Add slide frame workflow and video object pipeline |

### 3.3 P2 Gaps

| Gap | Final | Done | Bridge |
| --- | --- | --- | --- |
| Voice Mode | Speak to agent | Not present | Add after core prompt surface stabilizes |
| OpenClaw/local agent integration | External agent skill | Not present | Add API/plugin adapter after provider/tool contracts stabilize |
| Community publish | Publish to Lovart community feed | Private share link/export support | Defer until moderation, abuse, and public profiles exist |
| Team plan UX | Team seats, seat credit settings, task/device limits | Admin/user roles and billing abstraction | Add after Stripe/team billing is live |
| Generated font library | Custom font generator saved to Font Library | Not present | Add after text layers and Brand Kit fonts exist |

## 4. Bridge Surfaces

The bridge uses Looper `BridgeSurface` records. Each surface can move via
document, code, test, UX, and runtime evidence deltas. Workers may create
candidate outputs (`[_]`); master lane alone accepts (`[x]`).

```yaml
bridge_surfaces:
  - surface_id: final_done_lovart_bridge_blueprint
    bridge_level: blueprint
    owner_loop: LOOP-LOVART-BRIDGE-MASTER
    source_refs:
      - Docs/looper/lovart_final_done_bridge_blueprint.md
      - Docs/stage0_blueprint_rev2.md
      - tmp/lovart-research/playwright-summary.json
      - tmp/lovart-research/cdp-evidence.json
    target_refs:
      - Docs/looper/lovart_final_done_bridge_blueprint.md
      - future Stage 1/2 execution checklist
    movement_goal: convert Lovart final evidence and Zenari done evidence into executable bridge loops
    evidence_policy:
      required:
        - final_evidence_refs
        - done_evidence_refs
        - gap_matrix
        - loop_specs
        - acceptance_gates
    privacy_class: repo_committable

  - surface_id: static_canvas_to_infinite_editor
    bridge_level: artifact
    owner_loop: LOOP-CANVAS-EDITOR
    source_refs:
      - web/components/workspace-app.tsx
      - openapi/zenart.v1.yaml
    target_refs:
      - web/components/canvas/**
      - web/lib/canvas/**
      - backend/internal/canvas/**
      - openapi/zenart.v1.yaml
    movement_goal: replace static node view with pan/zoom/select/drag/frame/object editor
    evidence_policy:
      required:
        - unit_tests_for_canvas_reducer
        - playwright_canvas_interaction_smoke
        - object_schema_contract_tests
        - no_regression_existing_workspace_smokes
    privacy_class: repo_committable

  - surface_id: prompt_to_agentic_tool_invocation
    bridge_level: artifact
    owner_loop: LOOP-AGENTIC-TOOLS
    source_refs:
      - web/components/workspace-app.tsx
      - backend/internal/agent/**
      - backend/internal/provider/**
    target_refs:
      - web/components/prompt-composer/**
      - backend/internal/agent/tool_invocation.go
      - schemas/agentic-tools/**
    movement_goal: make selected canvas objects, mentions, models, brand kits, and tools first-class agent inputs
    evidence_policy:
      required:
        - prompt_context_contract
        - selected_object_chip_ui_smoke
        - tool_invocation_trace_contract
        - safety_and_quota_gate_contract
    privacy_class: repo_committable

  - surface_id: dev_provider_to_multi_provider_generation
    bridge_level: artifact
    owner_loop: LOOP-PROVIDER-DEPTH
    source_refs:
      - backend/internal/provider/**
      - openapi/zenart.v1.yaml
      - Docs/stage0_blueprint_rev2.md
    target_refs:
      - backend/internal/provider/adapters/**
      - backend/internal/billing/**
      - admin/app/providers/**
      - web/components/generators/**
    movement_goal: connect real image/video providers through capability registry, cost, quota, safety, and trace
    evidence_policy:
      required:
        - sandbox_provider_contract_tests
        - provider_capability_matrix
        - cost_and_quota_reconciliation
        - user_safe_model_picker_smoke
    privacy_class: repo_committable_without_secrets

  - surface_id: workflow_shell_to_lovart_skillbook
    bridge_level: strategy
    owner_loop: LOOP-SKILLBOOK
    source_refs:
      - admin/app/skills/**
      - backend/internal/agent/**
      - Docs/stage0_blueprint_rev2.md
    target_refs:
      - web/components/skillbook/**
      - backend/internal/skillbook/**
      - schemas/skillbook/**
    movement_goal: expose curated user Skills and custom skill replay without leaking admin/internal skill registry
    evidence_policy:
      required:
        - public_skill_contract
        - missing_info_flow_tests
        - custom_skill_replay_fixture
        - admin_review_boundary_tests
    privacy_class: repo_committable

  - surface_id: package_export_to_production_asset_pipeline
    bridge_level: artifact
    owner_loop: LOOP-ASSET-EXPORT
    source_refs:
      - web/lib/dev-state.ts
      - backend/internal/objectstore/**
      - backend/internal/worker/**
      - web/components/workspace-app.tsx
    target_refs:
      - backend/internal/assets/**
      - backend/internal/export/**
      - web/components/export/**
    movement_goal: turn placeholder local-alpha exports into visual asset files, layer exports, video exports, and branch lineage
    evidence_policy:
      required:
        - real_asset_storage_smoke
        - image_video_preview_smoke
        - layered_export_contract
        - trace_qa_safety_export_gate
    privacy_class: repo_committable
```

## 5. Loop Specs

### 5.1 LOOP-CANVAS-EDITOR

```yaml
loop_id: LOOP-CANVAS-EDITOR
attach_to:
  bridge_surface_ids:
    - static_canvas_to_infinite_editor
purpose: build a Lovart-class infinite canvas editor without regressing Stage 0 workflow/export gates
trigger:
  any:
    - bridge_target_changed: static_canvas_to_infinite_editor
    - validator_failed: canvas_interaction_smoke
preconditions:
  authoritative_blueprint_exists: true
  existing_workspace_smokes_identified: true
  owned_paths_declared: true
resource_envelope_ref: ENV-LOVART-BRIDGE-P0
max_parallel_attempts: 3
owned_paths:
  - web/components/canvas/**
  - web/components/workspace-app.tsx
  - web/lib/canvas/**
  - web/tests/**
  - web/validation/**
  - openapi/zenart.v1.yaml
  - backend/internal/canvas/**
forbidden_paths:
  - .git/**
  - .cron/**
  - .ops/**
  - ops/evidence/production/**
validators:
  cheap:
    - command: "cd web && npm run typecheck"
    - command: "cd web && npm run test -- workspace-app"
  expensive:
    - command: "cd web && npm run smoke:workspace-rendering-performance"
    - command: "cd web && npx playwright test tests/*workspace* tests/*ecommerce*"
reward_model:
  primary_rewards:
    - accepted_canvas_editor_runtime
    - playwright_canvas_interaction_pass
  secondary_rewards:
    - canvas_reducer_tests_added
    - object_schema_contract_added
  negative_rewards:
    - static_canvas_only
    - existing_workflow_smoke_regressed
pause_resume:
  pause_when:
    - no_reward_attempt_limit_reached
    - validator_missing
    - repeated_layout_regression
  resume_when:
    - explicit_resource_refund
    - new_canvas_validator_added
    - bridge_target_changed
```

Acceptance:

- User can pan/zoom the canvas and reset view.
- User can drag, select, multi-select, duplicate, delete, and reorder image/text/
  shape/frame objects.
- User can create frames and place objects inside frames.
- Existing Stage 0 brief/candidate/package/export smoke still passes.
- Canvas state persists through typed API/schema or dev-state substitute during
  first iteration.

### 5.2 LOOP-AGENTIC-TOOLS

```yaml
loop_id: LOOP-AGENTIC-TOOLS
attach_to:
  bridge_surface_ids:
    - prompt_to_agentic_tool_invocation
purpose: make canvas selection, mentions, model locks, and edit tools executable through agent traces
trigger:
  any:
    - canvas_selection_model_available
    - provider_tool_contract_changed
preconditions:
  canvas_object_ids_stable: true
  trace_contract_exists: true
  quota_gate_exists: true
resource_envelope_ref: ENV-LOVART-BRIDGE-P0
max_parallel_attempts: 2
owned_paths:
  - web/components/prompt-composer/**
  - web/components/workspace-app.tsx
  - web/lib/agent/**
  - backend/internal/agent/**
  - backend/internal/task/**
  - backend/internal/billing/**
  - schemas/agentic-tools/**
  - scripts/validate_*agent*.py
validators:
  cheap:
    - command: "cd web && npm run typecheck"
    - command: "go test ./backend/internal/agent/... ./backend/internal/task/..."
  expensive:
    - command: "python3 scripts/validate_trace_completeness.py"
    - command: "python3 scripts/validate_export_eligibility_decision_contract.py"
reward_model:
  primary_rewards:
    - selected_object_tool_invocation_pass
    - trace_and_quota_gate_pass
  secondary_rewards:
    - prompt_context_schema_added
    - tool_failure_taxonomy_added
  negative_rewards:
    - tool_call_without_trace
    - quota_consumed_without_refund_path
pause_resume:
  pause_when:
    - safety_gate_missing
    - no_reward_budget_exhausted
  resume_when:
    - new_validator_added
    - explicit_resource_refund
```

Acceptance:

- Prompt composer supports selected object chips, uploaded references, Brand Kit
  mentions, asset mentions, and model mentions.
- Tool calls produce agent traces with input object refs, provider/model, quota
  reservation, safety decision, QA result, and output asset refs.
- Tool failure preserves original object and refunds/commits quota according to
  policy.
- Workers cannot bypass export eligibility or trace completeness.

### 5.3 LOOP-EDITING-TOOLS

```yaml
loop_id: LOOP-EDITING-TOOLS
attach_to:
  bridge_surface_ids:
    - static_canvas_to_infinite_editor
    - prompt_to_agentic_tool_invocation
    - package_export_to_production_asset_pipeline
purpose: add Lovart-like editing tools in risk-ordered slices
trigger:
  any:
    - canvas_object_model_ready
    - provider_adapter_ready
preconditions:
  source_asset_storage_exists: true
  output_asset_lineage_exists: true
resource_envelope_ref: ENV-LOVART-BRIDGE-P0
max_parallel_attempts: 3
owned_paths:
  - web/components/edit-tools/**
  - web/components/canvas/**
  - web/lib/edit-tools/**
  - backend/internal/assets/**
  - backend/internal/provider/**
  - backend/internal/worker/**
  - schemas/edit-tools/**
validators:
  cheap:
    - command: "cd web && npm run typecheck"
    - command: "go test ./backend/internal/provider/... ./backend/internal/worker/..."
  expensive:
    - command: "cd web && npx playwright test tests/edit-tools.spec.ts"
reward_model:
  primary_rewards:
    - accepted_edit_tool_slice
  secondary_rewards:
    - mock_provider_edit_fixture
    - lineage_contract_added
  negative_rewards:
    - edit_tool_ui_without_asset_output
    - destructive_edit_without_original_preserved
pause_resume:
  pause_when:
    - provider_output_unverifiable
    - no_reward_attempt_limit_reached
  resume_when:
    - mock_provider_fixture_added
    - real_provider_contract_added
```

Risk-ordered slices:

1. Non-provider local tools: crop, flip, rotate, adjust metadata transforms.
2. Mock-provider AI tools with deterministic fixtures: upscale, remove background,
   eraser/inpaint, expand.
3. Selection/mark tools: region mark, brush/lasso/rectangle selection, touch edit.
4. Layer tools: edit elements, text layer extraction, text rewrite.
5. Transform tools: multi-angle, move object, vectorize, mockup.

Acceptance:

- Every edit creates a new asset or layer revision and preserves the original.
- Every generated output has lineage, provider/model, prompt/tool parameters,
  safety, QA, and export eligibility state.
- UI exposes unavailable tools as disabled with machine-readable reason, not as
  dead buttons.

### 5.4 LOOP-PROVIDER-DEPTH

```yaml
loop_id: LOOP-PROVIDER-DEPTH
attach_to:
  bridge_surface_ids:
    - dev_provider_to_multi_provider_generation
purpose: connect real image/video providers behind a capability and quota contract
trigger:
  any:
    - provider_contract_added
    - bridge_target_changed: multi_provider_generation
preconditions:
  secrets_boundary_defined: true
  quota_reservation_exists: true
  safety_injection_exists: true
resource_envelope_ref: ENV-LOVART-BRIDGE-P1
max_parallel_attempts: 2
owned_paths:
  - backend/internal/provider/**
  - backend/internal/billing/**
  - backend/internal/security/**
  - backend/internal/worker/**
  - admin/app/providers/**
  - web/components/generators/**
  - openapi/zenart.v1.yaml
  - schemas/provider/**
validators:
  cheap:
    - command: "go test ./backend/internal/provider/... ./backend/internal/billing/..."
    - command: "cd web && npm run typecheck"
  expensive:
    - command: "python3 scripts/validate_trace_completeness.py"
    - command: "python3 scripts/validate_safety_enforcement_contract.py"
reward_model:
  primary_rewards:
    - real_or_sandbox_provider_adapter_pass
    - user_safe_model_picker_pass
  secondary_rewards:
    - capability_matrix_expanded
    - cost_reconciliation_added
  negative_rewards:
    - provider_key_leak_risk
    - silent_provider_fallback
pause_resume:
  pause_when:
    - secret_redaction_failure
    - provider_contract_unverified
  resume_when:
    - new_secret_redaction_validator_added
    - provider_sandbox_available
```

Acceptance:

- Provider capability matrix covers image, video, and optional 3D categories.
- User-safe model picker can set Auto, preferred models, and strict `@` locks.
- Direct image/video generators expose only supported model parameters.
- Provider usage/cost ties to quota reservation and trace provenance.
- No provider key or hidden prompt leaks to frontend, logs, exports, support, or
  screenshots.

### 5.5 LOOP-BRAND-ASSET-SKILLBOOK

```yaml
loop_id: LOOP-BRAND-ASSET-SKILLBOOK
attach_to:
  bridge_surface_ids:
    - workflow_shell_to_lovart_skillbook
    - prompt_to_agentic_tool_invocation
purpose: add Brand Kit, reusable asset library, public Skill Book, and custom skill replay
trigger:
  any:
    - prompt_composer_mentions_ready
    - skillbook_contract_changed
preconditions:
  admin_skill_registry_boundary_documented: true
  tenant_asset_library_exists: true
resource_envelope_ref: ENV-LOVART-BRIDGE-P1
max_parallel_attempts: 2
owned_paths:
  - web/components/brand-kit/**
  - web/components/asset-library/**
  - web/components/skillbook/**
  - backend/internal/brandkit/**
  - backend/internal/assets/**
  - backend/internal/skillbook/**
  - admin/app/skills/**
  - schemas/brand-kit/**
  - schemas/skillbook/**
validators:
  cheap:
    - command: "cd web && npm run typecheck"
    - command: "go test ./backend/internal/assets/... ./backend/internal/skillbook/..."
  expensive:
    - command: "cd web && npx playwright test tests/brand-kit-skillbook.spec.ts"
reward_model:
  primary_rewards:
    - brand_kit_prompt_application_pass
    - public_skillbook_flow_pass
  secondary_rewards:
    - reusable_asset_library_added
    - custom_skill_replay_fixture_added
  negative_rewards:
    - internal_admin_skill_leaked
    - brand_assets_cross_tenant_risk
pause_resume:
  pause_when:
    - tenant_isolation_validator_missing
    - no_reward_budget_exhausted
  resume_when:
    - new_cross_tenant_test_added
    - explicit_resource_refund
```

Acceptance:

- Brand Kit stores logos, colors, fonts, design guidance, and source references.
- Brand Kit applies at project level and one-generation mention level.
- Assets Library stores reusable image/video/audio/character references.
- Public Skill Book exposes curated workflows only, not raw internal skill
  registry/admin review surfaces.
- Custom Skill replay is gated by user ownership, safety, and eval/review rules.

### 5.6 LOOP-ASSET-EXPORT

```yaml
loop_id: LOOP-ASSET-EXPORT
attach_to:
  bridge_surface_ids:
    - package_export_to_production_asset_pipeline
purpose: evolve exports from local-alpha evidence packages to usable visual deliverables
trigger:
  any:
    - real_asset_output_available
    - layered_canvas_object_available
preconditions:
  object_storage_gate_exists: true
  export_eligibility_gate_exists: true
resource_envelope_ref: ENV-LOVART-BRIDGE-P1
max_parallel_attempts: 2
owned_paths:
  - backend/internal/export/**
  - backend/internal/objectstore/**
  - backend/internal/assets/**
  - web/components/export/**
  - web/lib/export-download.ts
  - schemas/export/**
  - scripts/validate_*export*.py
validators:
  cheap:
    - command: "go test ./backend/internal/objectstore/... ./backend/internal/worker/..."
    - command: "cd web && npm run test -- export"
  expensive:
    - command: "python3 scripts/validate_export_eligibility_decision_contract.py"
    - command: "cd web && npm run smoke:package-export-metadata"
reward_model:
  primary_rewards:
    - real_visual_export_pass
    - layered_export_pass
  secondary_rewards:
    - video_export_fixture_added
    - asset_lineage_manifest_added
  negative_rewards:
    - placeholder_asset_exported_as_real
    - missing_trace_or_qa_metadata
pause_resume:
  pause_when:
    - export_gate_regression
    - asset_payload_unverifiable
  resume_when:
    - new_export_validator_added
    - provider_output_fixture_added
```

Acceptance:

- Export can package actual image/video/SVG/PDF/PPTX artifacts when those object
  types exist.
- PSD/layered export can start as a deterministic layer manifest if full PSD
  writing is not yet implemented.
- Export preview shows visual thumbnails, object lineage, provider/model, safety,
  QA, and blocking reasons.
- Existing ZIP manifest/provenance/safety gates remain fail-closed.

## 6. Execution Phases

### Phase A: Editor Skeleton And State Contract

Goal: make the workspace feel like an actual editor before adding expensive
providers.

Checklist:

- [ ] Create `CanvasObject` model with kinds `image`, `video`, `text`, `shape`,
  `frame`, `group`, `generated_layer`, and `vector`.
- [ ] Add transform fields: `x`, `y`, `width`, `height`, `rotation`, `zIndex`,
  `frameId`, `locked`, `hidden`, `selected`.
- [ ] Add pan/zoom viewport state.
- [ ] Add selection reducer and keyboard/mouse interaction tests.
- [ ] Replace static node surface with object renderer while preserving old
  workflow smoke attributes.
- [ ] Add Playwright smoke: pan, zoom, select, drag, frame, add text, add shape,
  restore version.

Gate to Phase B: canvas interaction smoke passes and Stage 0 workspace/export
smokes still pass.

### Phase B: Prompt Composer And Tool Invocation

Goal: connect selected canvas state to agentic actions.

Checklist:

- [ ] Build prompt composer with selected object chips and object mention picker.
- [ ] Add `@` mention grammar for model, asset, Brand Kit, and canvas object.
- [ ] Define tool invocation schema for `generate_image`, `generate_video`,
  `edit_image`, `remove_background`, `upscale`, `expand`, `move_object`,
  `vectorize`, `mockup`, `edit_text`, `split_layers`.
- [ ] Persist tool invocation trace with quota reservation and safety gate.
- [ ] Show tool progress inline on canvas objects.
- [ ] Add cancellation/retry/refund states.

Gate to Phase C: selected-object edit through deterministic provider creates a
new asset with trace and original preserved.

### Phase C: Editing Tools

Goal: ship Lovart-like editing capability using deterministic fixtures first,
then real providers.

Checklist:

- [ ] Local basic edit tools: adjust, crop, flip, rotate.
- [ ] Deterministic AI edit fixtures: upscale, remove background, eraser, expand.
- [ ] Mark/touch edit UI: point, rectangle, lasso, multi-mark limit.
- [ ] Layer split/edit elements surface with layer list and flatten.
- [ ] Edit text flow for generated images and canvas text layers.
- [ ] Transform tools: multi-angle, move object, vectorize, mockup.

Gate to Phase D: at least one tool in every category produces output asset,
lineage, safety/QA metadata, and export eligibility projection.

### Phase D: Provider Depth And Direct Generators

Goal: move from dev provider to a real multi-provider creative stack.

Checklist:

- [ ] Capability registry for image/video/3D/editing operations.
- [ ] Provider adapter contract with request/response schemas.
- [ ] Sandbox adapters and fixtures before production keys.
- [ ] User-safe model picker: Auto, image preferences, video preferences, 3D
  preference, strict mention lock.
- [ ] Direct image generator panel with resolution/aspect ratio/reference modes.
- [ ] Direct video generator panel with resolution/aspect ratio/duration/start
  frame/end frame/reference modes.
- [ ] Cost, quota, concurrency, retry, refund, provider usage reconciliation.

Gate to Phase E: provider traces and quota ledger prove no silent fallback and no
secret leakage.

### Phase E: Brand Kit, Asset Library, Skill Book

Goal: close the context/preset gap.

Checklist:

- [ ] Brand Kit CRUD and project selector.
- [ ] Brand Kit parser for PDFs as a later sub-slice; manual kit first.
- [ ] Prompt mention of Brand Kit and assets.
- [ ] Reusable Assets Library for image/video/audio/character references.
- [ ] Curated public Skill Book mapped to internal approved skill versions.
- [ ] Missing-info guided flow for Skill runs.
- [ ] Custom Skill replay from a successful conversation, gated by ownership and
  safety.

Gate to Phase F: user can run a Brand Kit applied skill and receive editable
canvas outputs with brand context in trace.

### Phase F: Export And Commercial Hardening

Goal: monetize useful outputs without misrepresenting capabilities.

Checklist:

- [ ] Export actual visual assets, not only metadata placeholders.
- [ ] Add layered export manifest; PSD writer can follow behind manifest.
- [ ] Add PPTX/PDF slide deck export when slide frames exist.
- [ ] Add MP4 export when video objects exist.
- [ ] Integrate Stripe or chosen payment provider through existing paid provider
  abstraction.
- [ ] Add team/seat/concurrency controls only after single-user quota and provider
  cost reconciliation pass.

Gate: private beta can use real providers, pay or comp credits, generate/edit
visual assets, and export them with QA/safety/provenance.

## 7. Bridge Metrics And Signals

```yaml
bridge_signals:
  - signal_id: canvas_editor_interaction_pass
    surface_id: static_canvas_to_infinite_editor
    signal_type: validator_result
    required_evidence:
      - playwright_canvas_pan_zoom_select_drag_frame
      - no_existing_workspace_smoke_regression
    reward_weight: 5
    failure_signal: canvas remains a static node display

  - signal_id: selected_object_tool_trace_pass
    surface_id: prompt_to_agentic_tool_invocation
    signal_type: artifact_delta
    required_evidence:
      - selected_object_ref_in_prompt_context
      - tool_invocation_trace
      - quota_reservation_commit_or_refund
      - output_asset_lineage
    reward_weight: 5
    failure_signal: edit/generation occurs without trace, quota, or lineage

  - signal_id: real_asset_output_visible
    surface_id: package_export_to_production_asset_pipeline
    signal_type: artifact_delta
    required_evidence:
      - object_storage_asset_ref
      - rendered_thumbnail_or_video_preview
      - export_payload_contains_asset
      - qa_safety_provenance_pass
    reward_weight: 5
    failure_signal: placeholder metadata is exported as if it were real output

  - signal_id: provider_capability_user_safe
    surface_id: dev_provider_to_multi_provider_generation
    signal_type: binary_gate
    required_evidence:
      - provider_capability_matrix
      - no_secret_frontend_exposure
      - model_picker_smoke
      - provider_usage_cost_ledger
    reward_weight: 4
    failure_signal: user can select unavailable provider or provider key leaks

  - signal_id: brand_skill_context_applied
    surface_id: workflow_shell_to_lovart_skillbook
    signal_type: qualitative
    required_evidence:
      - brand_kit_context_in_trace
      - skill_missing_info_flow
      - output_style_consistency_check
      - admin_internal_skill_boundary
    reward_weight: 3
    failure_signal: public Skill Book leaks admin/internal skill surfaces
```

Suggested product metrics:

- First prompt to editable canvas asset: p50 <= 45 seconds with dev/sandbox
  provider, p95 tracked for real providers.
- Canvas interaction latency: p95 <= 100 ms for pan/zoom/drag at 200 objects.
- Edit success rate: >= 85% deterministic fixture pass, real-provider pass
  measured per tool.
- Export readiness: 100% of downloadable outputs have provider/model/prompt/tool,
  safety, QA, trace, and lineage metadata.
- Package add/export rate: improve from Stage 0 baseline after real visual output.
- Cost per accepted asset: reported per provider/model/tool.

## 8. Side-Effect Gates

Gated side effects:

- Provider spend and production API calls: `network_or_spend`.
- Provider secrets, generated prompts, and hidden system instructions:
  `secret_exposure`.
- Export download enablement: `protected_path` plus `authoritative_blueprint_write`
  when gate definitions change.
- Public claims that Zenari has Lovart-class capability: `identity_level_write`.
- Payment/Stripe live mode: `network_or_spend`.
- Destructive object cleanup and broad asset deletion:
  `delete_or_destructive_write`.

Default rule:

Workers may implement UI/components/tests and deterministic fixtures inside owned
paths. Workers may not enable real provider spend, claim public launch, weaken
export gates, or write `[x]` acceptance. Master lane decides acceptance after
evidence exists.

## 9. Evidence Ledger Contract

Every loop attempt should create compact evidence like:

```json
{
  "evidence_id": "EVID-LOVART-BRIDGE-0001",
  "loop_id": "LOOP-CANVAS-EDITOR",
  "attempt_id": "ATTEMPT-0001",
  "lease_id": "LEASE-0001",
  "input_contract_ref": "Docs/looper/lovart_final_done_bridge_blueprint.md#LOOP-CANVAS-EDITOR",
  "owned_paths": ["web/components/canvas/**", "web/lib/canvas/**"],
  "changed_files": [],
  "commands_run": [],
  "validation_result": "pending",
  "bridge_delta_refs": [],
  "side_effect_decisions": [],
  "nested_run_refs": [],
  "looper_log_refs": [],
  "reward_candidates": [],
  "master_decision": "pending"
}
```

Runtime ledgers should remain ignored under `.b3ehive/looper/` or `.cron/`.
Committed summaries must not include provider secrets, account identifiers,
local absolute paths, raw Lovart cookies/session values, billing identifiers, or
private user prompts.

## 10. Acceptance Definition

This bridge is complete only when evidence proves all of the following:

- A user starts from an empty workspace and creates a visual asset on an infinite
  canvas.
- The user can pan/zoom/select/drag/resize/frame/text/shape canvas objects.
- The user can invoke at least one agentic generation and one agentic edit from
  selected canvas context.
- The user can choose Auto model routing and at least one explicit image/video
  provider/model preference through a user-safe UI.
- The system creates output asset lineage, original preservation, provider/model
  trace, quota ledger, safety decision, QA result, and export eligibility state.
- The user can package and export real visual assets with metadata, not only
  placeholder evidence.
- Brand Kit or equivalent style context can be applied to a generation and is
  visible in trace/provenance.
- Stage 0 local-alpha workflows, export gates, tenant isolation, CSRF/session
  guards, and safety/export validators still pass.
- Provider secrets remain server-side and redacted from UI/logs/traces/export/
  support/screenshot surfaces.
- Payment integration, if enabled, uses existing billing/quota abstraction and
  does not block creative bridge work; Stripe live mode has its own evidence
  gate before public paid claims.

## 11. Master Checklist

P0:

- [ ] Canvas object model and editor runtime.
- [ ] Canvas interaction Playwright smoke.
- [ ] Prompt composer with selected object and mention context.
- [ ] Tool invocation trace contract.
- [ ] Basic edit tools and deterministic AI edit fixtures.
- [ ] Asset lineage and original preservation.
- [ ] Real or sandbox provider adapter for at least one image generation path.
- [ ] Real visual asset preview and export.

P1:

- [ ] Brand Kit model, UI, and prompt application.
- [ ] Assets Library with reusable image/video/audio refs.
- [ ] Public Skill Book with missing-info flows.
- [ ] Direct image/video generator panels.
- [ ] Web Search/visual insights with safe provenance.
- [ ] Slide frame workflow and PPTX/PDF export.

P2:

- [ ] Voice input.
- [ ] OpenClaw/local agent adapter.
- [ ] Community publish/moderation.
- [ ] Team plan UX and seat credit settings.
- [ ] Generated font library.

Kill criteria:

- Three consecutive attempts on a loop produce no validator, no artifact delta,
  and no stronger evidence.
- A loop repeatedly weakens Stage 0 safety/export/tenant gates.
- A provider integration cannot prove secret containment or cost accounting.
- Editor work remains a visual mock without real object state, tests, or
  exportable assets.

Resume criteria:

- Explicit resource refund plus changed strategy.
- New validator added.
- New provider sandbox or fixture added.
- Bridge target changed by master lane.
- Blocking dependency accepted by master lane.

## 12. Recommended Next Execution Step

Start with `LOOP-CANVAS-EDITOR`, not Stripe and not real providers.

Reasoning:

- Stripe/payment is expected to be a relatively tractable integration because
  Zenari already has billing/quota/provider-usage abstractions.
- Lovart's actual product advantage is the editable infinite canvas plus agentic
  creative tool invocation.
- Real provider depth only creates value after generated assets can be placed,
  selected, edited, versioned, and exported from the canvas.

First concrete implementation slice:

```text
CanvasObject schema + pan/zoom/select/drag/frame/text/shape runtime
  -> selected-object prompt chip
  -> deterministic "generate image" fixture creates image object
  -> deterministic "remove background" edit creates child asset
  -> package/export includes visual asset placeholder file plus full lineage
```

This slice gives the smallest real bridge from current Done to Lovart Final:
it moves from workflow cards and static nodes to an editable canvas with agentic
tool output, while keeping provider spend and Stripe behind later gates.
