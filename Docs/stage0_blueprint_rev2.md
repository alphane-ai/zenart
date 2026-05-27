# ZenArt Stage 0 Blueprint Rev2

日期：2026-05-26

## 0. Rev2 结论

`Docs/stage0_blueprint.md` 已经足以驱动本地工程骨架和 dev provider 演示闭环，但不足以作为付费生产上线标准。

本 Rev2 的判断：

- 本地 alpha：可以通过 Stage 0 实现，但必须补齐合同化验证、fixture、对象存储和可重复测试。
- 私测 beta：必须补齐真实账号、权限、支持、对象存储、可观测性、rate limit、QA、安全、workflow acceptance。
- 生产上线：必须补齐真实 provider 或明确 invite/comp-only 模式、支付/订阅或隐藏付费声明、备份恢复、回滚、事故响应、法律商业页面、AI 治理和 do-not-launch gate。

Rev2 不扩大用户可见产品范围。Stage 0 仍然只承诺：

```text
chatbox -> 4 个策略不同的候选 -> 选择 1 个 -> 在画布继续迭代 -> 加入 package -> 导出可交付资产包
```

Rev2 增加的是上线级定义：什么叫可测试、可付费、可审计、可恢复、可回滚、可度量、可安全外部使用。

## 1. 权威边界

本文件是 ZenArt Stage 0 Rev2 的唯一权威需求源。后续执行型 cron、开发计划、验收和 release gate 必须以本文件为准。

`Docs/stage0_blueprint.md` 和 `Docs/stage0_draft.md` 是 Rev2 的输入参考，不再作为 Rev2 执行源。

执行 cron 后续只能从本文件的「25. Authoritative Rev2 Execution Checklist」生成每日 todo，不得把 README、issue、聊天记录、debating-runs 或其他文档当成需求源。

## 2. 阶段定义

### 2.1 Local Alpha

目标：本地一键启动，使用 deterministic dev provider 跑通四条 starter workflow。

允许：

- dev provider。
- local object storage。
- local seed user/admin。
- mock checkout。
- staging/prod 未配置。

不允许：

- 把 dev provider 伪装成真实生成。
- checklist doc-only 完成。
- workflow 只渲染通用 4 卡片就标记完成。
- export 缺 manifest、QA report、provenance 仍标记完成。

### 2.2 Private Beta / Staging

目标：外部受控用户可以真实试用，系统可观测、可支持、可恢复。

必须具备：

- 用户 auth 和独立 admin auth。
- RBAC、tenant isolation、audit log。
- production-like object storage 和 signed URL。
- rate limit、quota transaction、support ticket。
- workflow acceptance packs 全通过。
- structured QA、安全策略和 admin review。
- staging logs、metrics、traces、alerts、backups、rollback drill。

### 2.3 Production Launch

目标：公开或付费上线。

必须具备：

- 如果声称真实生成，至少一个 real production provider 完成合同化接入、监控、成本记录和 staging verification。
- 如果未接入真实付费 provider，只能是 invite/comp-only，并隐藏付费/真实生成相关声明。
- 如果启用付费，支付、订阅、取消、past_due、退款/信用、quota reset、webhook idempotency 必须验收。
- 安全、隐私、法律、支持、备份、恢复、回滚、事故响应全部完成。

## 3. 产品范围

### 3.1 用户可见范围

用户端只暴露：

- Account/project 基础能力。
- Chatbox。
- Infinite canvas。
- 每轮 4 个策略不同的候选。
- 选择 1 个方向。
- 继续迭代。
- Package panel。
- Export preview/download。
- Billing/quota。
- Support/report problem。

用户端不得暴露：

- skill 市场。
- prompt playground。
- crawler source。
- prompt fragment 编辑器。
- meta prompt/spec 编辑器。
- provider/model routing。
- eval suite。
- admin review 队列。

### 3.2 后台隐藏范围

后台必须完整管理：

- Skill / Skill Version。
- Prompt Fragment / Prompt Mutation。
- Meta Prompt / Image Spec。
- Provider / Model Routing。
- Agent Invocation Trace。
- Safety Policy。
- Image QA。
- Crawler Source/Finding。
- Feedback Signal。
- Eval Suite。
- Canary / Rollback。
- Support / Abuse / Audit。

### 3.3 非目标

Stage 0 Rev2 不做：

- 原生 iOS/Android。
- 桌面端。
- 完整 Figma 替代。
- 完整 PPT 编辑器。
- 游戏生产级资产管线。
- CAD/BIM/工程图纸。
- 医疗、法律、金融专业建议。
- 公开 skill 市场。
- 用户可见 prompt playground。

## 4. 系统结构

ZenArt Stage 0 Rev2 是纯 Web 三端架构，沿用 Alphane-style 三目录落地方式：

- `web/`：用户端。
- `admin/`：管理端。
- `backend/`：Go API、worker、crawler、migrate。

不得拆成移动端、桌面端或多仓库服务矩阵。worker/crawler/migrate 可以是同一个 Go backend binary 的不同 command。

目标 monorepo：

```text
zenart/
  web/                         # 用户端 Next.js TypeScript
  admin/                       # 管理端 Next.js TypeScript
  backend/                     # Go API + worker/crawler
  scripts/
  Docs/
    stage0_blueprint.md
    stage0_blueprint_rev2.md   # Rev2 唯一权威源
  docker-compose.yml
  .env.example
  README.md
```

服务：

- Web: `3000`
- Admin: `3001`
- Backend API: `8080`
- Worker: Go binary command。
- Crawler: Go binary command。
- Postgres: `5432`
- Redis: `6379`
- Local object storage: MinIO 或隔离 local filesystem adapter。

本地启动目标：

```bash
docker compose up --build
```

## 5. SaaS 用户生命周期

### 5.1 访问模式

Stage 0 必须明确选择一种访问模式：

- authenticated-only。
- anonymous trial。
- invite-only beta。
- comped private beta。

如果是 public paid launch，不能只依赖 seeded local user。

### 5.2 账号能力

最小能力：

- signup 或 invite accept。
- login。
- logout。
- session refresh。
- expired-session handling。
- account settings。
- plan/subscription/quota/account status 展示。
- 用户数据删除请求或 admin-assisted deletion。

### 5.3 角色

最小角色：

- `user_owner`
- `user_member`
- `support_operator`
- `admin_viewer`
- `admin_operator`
- `admin_reviewer`
- `admin_superadmin`

用户 auth 和 admin auth 必须分离。普通用户不得访问 `/api/admin/*`。

### 5.4 项目和工作区生命周期

用户端必须支持：

- project dashboard。
- project create/rename/archive/restore/delete。
- recent projects。
- workspace autosave。
- canvas version history。
- package history。
- export history。
- failed task retry。
- task 状态：empty/loading/running/failed/retrying/succeeded/cancelled/blocked。

## 6. Workflow Brief 和垂直验收

Rev2 必须把 `stage0_draft.md` 的业务判断转成可执行 fixture 和 acceptance pack。

### 6.1 通用要求

每条 workflow 必须定义：

- required brief slots。
- missing-info clarification questions。
- 4-option strategy taxonomy。
- required generated assets。
- required package contents。
- required QA checks。
- required safety checks。
- export targets。
- golden fixtures。
- negative/unsafe fixtures。
- pass/fail thresholds。
- API smoke test。
- Playwright happy path。

不得把“能生成 4 张通用卡片”标记为 workflow 完成。

### 6.2 电商增长包

输入槽：

- product。
- platform/channel。
- audience。
- price。
- selling points。
- brand constraints。
- reference/product images。
- claims needing verification。

4 选 1 应代表：

- 转化导向。
- 生活方式。
- 功能证明。
- 促销/活动。

必要输出：

- 商品主图。
- 详情页模块。
- 广告多比例。
- 社媒封面。
- 直播贴片。
- ZIP package。

必须检查：

- 商品主体、logo、颜色、材质不被未授权改变。
- 不编造功效、认证、评价、销量、前后对比。
- 尺寸、安全区、平台适配。
- 文本可读性。

首个 fixture：

- skincare/social launch pack，包含产品约束、渠道尺寸和禁用功效声明。

### 6.3 商业视觉文档包

输入槽：

- business goal。
- audience。
- source content。
- industry。
- narrative intent。
- desired export format。
- claims needing verification。

4 选 1 应代表：

- 高管摘要。
- 方案架构。
- ROI 叙事。
- 实施路线。

必要输出：

- 封面。
- 方案架构图。
- 流程图。
- 路线图。
- PPT-ready metadata。
- PDF/package。

必须检查：

- ROI、案例、数据来源是否用户提供或明确标记估算。
- 不制造法律/财务/医疗/工程安全专业建议。
- 图表和架构文本可读。

首个 fixture：

- manufacturing/business sales visual document，包含 ROI source/estimate labeling。

### 6.4 本地商家活动包

输入槽：

- business name。
- offer。
- product/service。
- price。
- date/time。
- address/contact。
- channels。
- print/mobile needs。

4 选 1 应代表：

- 微信成交。
- 小红书质感。
- 门店打印。
- 平台封面。

必要输出：

- 小红书图。
- 朋友圈图。
- 门店打印图。
- 外卖/团购封面。
- ZIP/PDF。

必须检查：

- 价格、日期、电话、地址、二维码区域。
- 移动端裁切。
- 打印尺寸。
- 禁止虚假优惠、虚假库存、虚假认证。

首个 fixture：

- local coffee shop activity pack，包含 price、date、contact、mobile outputs、print outputs。

### 6.5 角色/IP 概念包

输入槽：

- character premise。
- genre。
- use case。
- originality constraints。
- style boundary。
- consistency constraints。

4 选 1 应代表：

- 可爱。
- 英气。
- 暗黑。
- 华丽。

或按角色/服装/道具/场景方向区分，但必须策略不同。

必要输出：

- 头像。
- 半身。
- 服装/武器变体。
- 表情。
- 宣发图。
- 设定板 package。

必须检查：

- 原创角色约束。
- protected IP/style refusal。
- 角色一致性。
- 不伪装成已有受保护角色。

首个 fixture：

- character/IP concept pack，包含 original-character constraints 和 protected-IP/style refusal checks。

## 7. Billing、Entitlement、Quota 和成本控制

### 7.1 订阅状态

必须支持状态：

- `trialing`
- `active`
- `past_due`
- `cancelled`
- `expired`
- `comped`

### 7.2 Checkout

Stage 0 必须实现 checkout provider abstraction。

Local alpha 可以使用 mock checkout。Production paid launch 必须明确真实支付 provider，并验证：

- checkout。
- webhook idempotency。
- active subscription。
- cancellation。
- past_due。
- refund/credit 或 admin credit。
- invoice/receipt placeholder 或真实页面。

### 7.3 Entitlement

生成、导出、付费 workflow 必须经过 entitlement middleware。

当 subscription inactive 或 quota insufficient：

- 不得创建 quota-consuming provider task。
- UI 必须给出可理解状态。
- 失败不得静默吞掉。

### 7.4 Quota Transaction

必须采用 reservation/commit/refund：

```text
generation requested
  -> estimate cost
  -> reserve quota
  -> create task
  -> provider/task success: commit
  -> provider/task failure/cancel/timeout: refund or policy-specific partial commit
```

必须测试：

- 并发 reservation。
- retry idempotency。
- task timeout。
- task cancellation。
- failed provider。
- export failure。
- weekly reset。

### 7.5 Provider Cost Control

必须支持：

- provider usage reconciliation。
- daily spend cap。
- emergency kill switch。
- provider concurrency limit。
- cost per successful package report。
- admin quota credit/debit with reason and audit log。

## 8. Package、Export、Share 和对象存储

### 8.1 Object Storage

必须有对象存储抽象，覆盖：

- user uploads。
- generated images。
- thumbnails。
- crawler raw documents。
- package manifests。
- ZIP/PDF exports。
- QA reports。
- prompt/spec artifacts。

Local alpha 使用 MinIO 或隔离 local filesystem adapter。Staging/production 使用 S3-compatible config。

### 8.2 Object Metadata

Postgres 必须保存对象元数据：

- owner。
- tenant/project。
- asset type。
- content type。
- byte size。
- checksum。
- provider。
- retention state。
- created timestamp。
- derived-from relationship。

### 8.3 Signed Download

所有下载必须：

- tenant authorization。
- signed URL。
- expiration。
- 不暴露 raw bucket URL。
- 记录 access log。
- 支持 cross-tenant denial tests。

### 8.4 Package Manifest

每个 export package 必须包含 manifest：

```json
{
  "package_id": "",
  "project_id": "",
  "workflow": "",
  "selected_direction": "",
  "assets": [],
  "specs": [],
  "qa_report": "",
  "warnings": [],
  "provenance": {},
  "human_confirmation_flags": []
}
```

### 8.5 Export Contract

ZIP 必须包含：

- assets。
- manifest。
- QA report。
- prompt/spec/skill/provider metadata。
- dimensions。
- safety disclaimer when applicable。
- file naming deterministic。

PDF、PPT-ready、Figma-ready 如果未真实完成，必须在 UI/API/admin 中明确标记 placeholder，不得宣称完成。

### 8.6 Share/Review

Stage 0 可以默认关闭 share，但必须有数据模型。

如果启用，必须支持：

- private link。
- expiration。
- revoke。
- access log。
- tenant/project authorization。

## 9. API 和实现合同

Route list 不等于 API 合同。Rev2 必须新增 OpenAPI 或等价 schema。

必须覆盖：

- user/session/account。
- project/workspace。
- chat/message。
- agent task。
- candidate set。
- canvas node/frame/version。
- upload/asset。
- package/export/share。
- quota/billing。
- support ticket。
- skill/version。
- crawler source/run/finding。
- prompt fragment。
- trace。
- feedback。
- safety rule。
- audit log。

统一要求：

- shared error envelope。
- `request_id`。
- auth/RBAC per endpoint。
- pagination/filtering/sorting/search。
- idempotency key。
- long-running task schema。
- typed TypeScript clients for Web/Admin。
- backend contract tests。
- CI stale schema/client check。

标准错误：

```json
{
  "code": "string",
  "message": "string",
  "request_id": "string",
  "details": {},
  "field_errors": []
}
```

Long-running task：

- status：pending/running/succeeded/failed/cancelled。
- progress。
- retry count。
- timeout。
- error code。
- user-visible message。
- timestamps。
- app/worker version。
- schema version。

## 10. 数据库、迁移和数据生命周期

### 10.1 Migration Policy

必须选择并记录一个 migration tool。

必须提供命令：

- local。
- CI。
- staging。
- production。

默认 forward-only。每个 migration 必须说明 rollback 是否安全。

必须定义 expand/contract 策略：

- columns。
- indexes。
- constraints。
- status fields。
- enum-like values。

### 10.2 Migration Tests

必须测试：

- empty database apply all migrations。
- seeded previous-version database apply all migrations。
- local demo seed。
- CI seed。
- staging bootstrap seed。
- production bootstrap seed。

### 10.3 Retention

必须定义保留策略：

- traces。
- generated assets。
- exports。
- crawler raw documents。
- crawler findings。
- audit logs。
- support tickets。
- feedback。
- provider logs。
- billing/quota records。

### 10.4 Backup and Restore

必须定义：

- Postgres backup schedule。
- object storage backup/versioning。
- Redis persistence expectations。
- acceptable loss。
- RPO/RTO。
- Postgres restore drill。
- exported package object restore drill。

## 11. AI Artifact Lifecycle

每个生成物必须走完整生命周期：

```text
brief
  -> intent/workflow decision
  -> hidden skill version
  -> meta prompt/spec version
  -> prompt fragment set
  -> safety policy decision
  -> provider/model request
  -> generated assets
  -> image QA result
  -> user selection/feedback
  -> package/export
  -> eval/admin review/canary
  -> prompt or skill evolution
```

每一步必须有：

- schema validation。
- provenance。
- trace id。
- safety status。
- QA/eval status。
- quota transaction。
- admin visibility。
- user-visible failure mapping。

候选资产必须记录：

- workflow。
- skill version。
- meta prompt version。
- image spec version。
- prompt fragment ids。
- safety rule versions。
- provider id。
- model id/version。
- endpoint version。
- seed/parameters。
- request hash。
- cost estimate。
- actual usage when available。
- QA status。
- trace id。
- package/export references。

缺少必要 provenance 的资产不得进入 final export。

## 12. Agent Step Contracts

必须定义 `AgentStepContract` base schema：

- input。
- output。
- trace。
- error categories。
- retry behavior。
- idempotency。
- quota behavior。
- safety enforcement。
- user-status mapping。
- admin/debug visibility。
- eval fixture coverage。

必须实现 typed contracts：

- intent router。
- brief completion。
- workflow planner。
- hidden skill selector。
- meta prompt/spec resolver。
- prompt fragment composer。
- safety policy injector。
- provider/model router。
- candidate set builder。
- iteration planner。
- design QA runner。
- package/export builder。
- feedback extractor。
- prompt mutation proposer。

必须测试：

- contract validation。
- trace completeness。
- retry idempotency。
- quota behavior。
- user-visible failure state。
- old worker 不处理 unsupported new task schema。

## 13. Provider Contracts

### 13.1 Provider Schema

必须定义 provider request/response schema。

Provider capability matrix：

- generation。
- edit。
- inpainting。
- reference image support。
- text rendering quality。
- transparent output。
- max resolution。
- batch support。
- seed support。
- moderation behavior。
- cost model。

Provider status：

- `dev`
- `staging`
- `production`
- `paused`
- `deprecated`

### 13.2 Provider Operations

必须定义：

- timeout。
- retry。
- backoff。
- idempotency。
- dedupe。
- circuit breaker。
- safety/moderation error mapping。
- fallback rules。
- provider concurrency limit。
- daily spend cap。
- emergency kill switch。

不得 silent fallback 到安全、隐私或能力更弱的 provider。

### 13.3 Provider Admin

Admin 必须展示：

- provider status。
- mode。
- latency。
- error rate。
- last success。
- usage。
- cost。
- incidents。

Production provider launch gate 必须要求：

- real credentials。
- real usage logs。
- cost reconciliation。
- monitoring。
- production status。

## 14. Eval Suites 和 Skill Release

### 14.1 Eval Suite

必须定义 eval suite schema，覆盖：

- skills。
- prompt fragments。
- prompt mutations。
- meta prompts。
- image specs。
- vertical workflow packs。

Fixtures：

- golden。
- ambiguous brief。
- unsafe。
- negative。
- brand/product preservation。
- text-heavy。
- export completeness。
- regression from production failures/admin bad samples/support tickets。

Eval 维度：

- intent routing accuracy。
- brief completeness。
- spec schema validity。
- prompt composition compatibility。
- safety tag recall。
- four-option distinctness。
- image QA。
- text readability。
- product/logo preservation。
- package/export completeness。

### 14.2 Release Gate

Skill version 进入 canary 或 active 前必须 eval pass。

Prompt fragment 进入 active 前必须 eval pass。

### 14.3 Skill States

Skill release states：

- `draft`
- `review`
- `eval_passed`
- `internal_canary`
- `allowlist_canary`
- `percent_canary`
- `active`
- `paused`
- `rolled_back`
- `deprecated`

### 14.4 Canary Metrics

按 skill version 统计：

- task success。
- provider failure。
- cost per package。
- selection rate。
- iteration rate。
- package add rate。
- export success。
- QA warning/blocking。
- safety block。
- user rating。
- admin bad-sample。
- regression fixture pass rate。

必须定义 stop thresholds 和 critical safety regression 自动 pause。

## 15. Image QA 和 Safety Policy

### 15.1 QA Result Schema

```json
{
  "check_id": "",
  "severity": "info|warning|blocking",
  "workflow": "",
  "asset_id": "",
  "evidence": {},
  "auto_fix_available": false,
  "review_required": false,
  "user_visible_message": "",
  "admin_reason": ""
}
```

Blocking QA failure 必须阻止 final export，除非有 eligible admin override 且 audit 完整。

### 15.2 QA Checks

必须检查：

- file integrity。
- dimensions。
- aspect ratio。
- platform safe area。
- blank/near-blank output。
- duplicate candidate similarity。
- four-option strategic distinctness。
- OCR/text readability 或 manual-review placeholder。
- structured text：price/date/phone/address/QR。
- product/logo preservation。
- forbidden claims。
- watermark/signature risk。
- export completeness。

每个 export package 必须包含 QA report。

### 15.3 Safety Policy Engine

Safety rule schema：

- rule id/version。
- domain。
- severity。
- enforcement point。
- user message。
- admin override eligibility。
- audit requirement。
- eval fixture link。

Enforcement points：

- brief。
- provider request。
- provider response。
- QA。
- export。

Actions：

- allow。
- warn。
- require user confirmation。
- require admin review。
- block。

必须覆盖：

- legal。
- medical。
- financial。
- compliance。
- industrial safety。
- ecommerce claims。
- IP/brand。
- adult/minor。
- violence/hate。
- privacy/protected person。
- prompt injection。
- hidden prompt/skill extraction。

必须有 red-team fixtures，并作为 production launch gate。

## 16. Crawler Governance

Crawler 只能用于内部冷启动和持续发现，不能成为公开功能。

### 16.1 Source Approval

Crawler source fetch 前必须 approved。

Source metadata：

- owner/publisher。
- source type。
- URL。
- terms URL。
- license classification。
- commercial-use status。
- derivative-use status。
- attribution requirement。
- prohibited-use notes。
- legal review date。
- reviewer id。
- takedown contact/process。

### 16.2 Fetch Controls

必须实现：

- allowlist。
- robots evidence。
- private IP blocking。
- redirect validation。
- DNS rebinding guard。
- max response size。
- timeout。
- content-type checks。
- source/global rate limits。

### 16.3 Import Governance

必须实现：

- raw content retention limit。
- exact third-party prompt/code import warning。
- exact text special approval。
- provenance links from active seeds/fragments to source/finding。
- source blocklist。
- takedown workflow。
- derivative review/delete workflow。

Crawler finding 不得直接进入 active skill 或 active prompt fragment。

## 17. Feedback、Learning 和 Abuse

### 17.1 Feedback Taxonomy

必须记录：

- select。
- reject。
- iterate。
- edit。
- package add。
- export。
- rating。
- text feedback。
- QA warning。
- export failure。
- admin label。
- support ticket。

Feedback 必须归因到：

- workflow。
- skill version。
- prompt/spec version。
- provider/model。
- asset。
- package/export。
- trace。

### 17.2 Learning Governance

要求：

- 区分 non-selection 和 explicit rejection。
- 过滤 test accounts。
- 过滤 suspected abuse。
- 支持 delayed feedback。
- prompt mutation 必须有 trace provenance。
- repeated bad-sample clusters 转 regression fixtures。
- feedback 不能绕过 eval/review 直接激活 prompt/skill。

### 17.3 Abuse Monitoring

Abuse event model 必须覆盖：

- generation spikes。
- quota drain。
- repeated safety blocks。
- prompt injection。
- hidden prompt extraction。
- brand/IP impersonation。
- crawler abuse。
- export/share abuse。

必须支持：

- rate-limit。
- temporary hold。
- admin abuse queue。
- incident severity。
- resolution。

## 18. Admin、Review 和 Support Operations

### 18.1 Admin Review Governance

Review queues：

- skill version。
- prompt fragment。
- prompt mutation。
- meta prompt。
- image spec。
- crawler source。
- crawler finding。
- safety rule。
- provider routing。
- export override。

Review detail 必须展示：

- diff。
- provenance。
- eval summary。
- risk labels。
- QA samples。
- reviewer rationale。
- temporary override expiration。
- rollback plan。
- audit log。

High-risk production changes 必须 second reviewer。

### 18.2 Support Console

必须支持：

- user lookup。
- view projects。
- view recent tasks。
- view traces。
- view assets/exports。
- view quota transactions。
- view subscription state。
- support tickets。
- retry failed task。
- regenerate failed export。
- quota credit/debit。
- user risk flags。

### 18.3 Operations Dashboards

Admin 必须展示：

- provider health。
- queue/dead-letter。
- export jobs。
- failed jobs。
- quota anomalies。
- spend cap。
- safety/risky export queue。
- abuse queue。
- audit log search。
- release/canary dashboard。

## 19. Security、Privacy、Legal、Commercial

### 19.1 Security Engineering

必须实现：

- secure sessions。
- CORS allowlist。
- CSRF 或 same-site strategy。
- secure cookie attributes。
- security headers。
- upload validation。
- malware-scan placeholder/interface。
- SSRF protections for crawler。
- dependency scan。
- Docker image scan。
- secret scan。
- admin RBAC tests。
- tenant isolation tests。

### 19.2 Secrets

`.env.example` 必须覆盖：

- web。
- admin。
- backend。
- Postgres。
- Redis。
- object storage。
- auth/session。
- providers。
- billing。
- observability。
- crawler。
- analytics。

每个 key 必须标注：

- public config。
- private config。
- secret。

要求：

- frontend 只暴露 public。
- startup validation。
- staging/prod secret source。
- rotation docs。
- redaction for logs/traces/errors/audit/support/screenshots/exports/crawler findings/admin UI。

### 19.3 Privacy and Legal

Public/private beta 必须有：

- Privacy notice。
- AI/content responsibility disclaimer。
- support contact。

Public production 必须有：

- Terms of Service。
- Privacy Policy。
- Acceptable Use Policy。
- IP/copyright/trademark complaint flow。
- visible support contact。

Paid launch 还必须有：

- billing/cancellation/refund policy。

必须审查 marketing、onboarding、billing、in-app copy，不能出现未支持声明，如：

- 真实 provider 未接入却声称真实生产生成。
- 支付未接入却声称可购买。
- “自动合规”。
- “版权无忧”。
- “医疗级/律师级/投资顾问级”。

## 20. CI/CD、Environments、Rollback

### 20.1 CI

PR/main CI 必须运行：

- Web install/lint/typecheck/unit/build。
- Admin install/lint/typecheck/unit/build。
- Backend fmt/lint/vet/unit/integration/build。
- migration tests。
- OpenAPI generation/stale check。
- generated client check。
- API contract tests。
- agent contract tests。
- Playwright smoke。
- Docker build。
- dependency scan。
- image scan。
- secret scan。

CI 必须启动：

- Postgres。
- Redis。
- object storage。

### 20.2 Environments

必须定义：

- local。
- CI。
- staging。
- production。

Docker images 必须 immutable git SHA tag。

Staging deploy：

- main branch CI pass 后部署。
- 使用 production 同命令 migrations。
- post-deploy smoke tests。

Production deploy：

- manual approval 或 protected release tag。
- release notes。
- post-deploy smoke。

### 20.3 Feature Flags

必须有 feature flags：

- provider adapters。
- crawler imports。
- prompt self-evolution。
- export formats。
- sharing。
- billing mode。
- vertical workflows。

### 20.4 Rollback

必须定义 rollback：

- web。
- admin。
- backend server。
- worker。
- crawler。
- feature flags。
- provider routing。
- skill version。
- non-reversible migrations 的限制。

Workers 必须支持 drain。Task records 必须包含 app/worker version 和 schema version。

## 21. Observability、SLO、Incident、Load Test

### 21.1 Observability

必须实现：

- request id middleware。
- request/task/trace id propagation。
- structured JSON logs。
- OpenTelemetry traces。
- backend/worker/crawler metrics。
- frontend error reporting。

Metrics：

- request latency/error。
- queue depth。
- task duration/failure。
- provider latency/error。
- quota reservation/refund。
- export failure。
- crawler failure。
- object storage error。
- safety block。
- QA warning/block。
- abuse event。
- spend cap。

Dashboards：

- API。
- worker。
- provider。
- queue。
- quota/cost。
- export。
- crawler。
- safety。
- admin/security。
- object storage。
- frontend errors。

Alerts：

- API 5xx spike。
- queue backlog。
- worker crash loop。
- provider error spike。
- export failure spike。
- DB/Redis/object storage saturation。
- quota anomaly。
- spend cap breach。
- safety spike。
- bad skill release。
- crawler policy violation。
- payment outage。

### 21.2 SLO and Incidents

必须定义：

- API availability SLO。
- task completion SLO。
- export success SLO。
- staging deploy health SLO。
- incident severity。
- escalation。
- incident template。
- customer communication notes。
- postmortem requirements。

Runbooks：

- provider outage。
- quota accounting bug。
- object storage leak/cross-tenant access bug。
- bad skill release。
- prompt regression。
- crawler policy violation。
- payment/billing outage。
- failed deploy。

### 21.3 Load and Capacity

必须定义 Stage 0 assumptions：

- concurrent users。
- generations per minute。
- active workers。
- export size。
- crawler frequency。
- admin users。

Load tests：

- chat/task creation。
- worker candidate generation。
- ZIP export。
- signed download。
- crawler throttling。
- quota contention。
- workspace rendering。

必须定义 p95 API latency、queue delay、export duration、UI load、error rate 阈值。

## 22. Product Analytics

必须埋点：

- signup。
- onboarding completion。
- project creation。
- first chat。
- candidate set generated。
- candidate selected。
- iteration requested。
- package item added。
- export started。
- export completed。
- export failed。
- QA warning/block。
- billing viewed。
- subscription started/cancelled。
- support ticket opened。
- safety block。

Admin reports：

- first prompt to four candidates。
- 4-option selection rate。
- iteration rate。
- package add rate。
- export completion rate。
- weekly return。
- average assets per package。
- cost per successful package。
- QA warning/block rate。
- failed export rate。
- support ticket rate。
- provider cost anomaly。

Private beta 和 production launch gate 必须使用这些指标作为 go/no-go 信号。

## 23. Release Gates

### 23.1 Local Alpha Gate

必须全部通过：

- `docker compose up --build` 启动 web、admin、backend server、worker、crawler、Postgres、Redis、local object storage。
- migrations 在空库执行成功。
- seed default plan、admin、local user、internal skills、crawler test source、workflow fixtures。
- OpenAPI/generated clients/contract tests 通过。
- Web 使用 deterministic dev provider 对四条 workflow fixture 都完成：brief -> 4 candidates -> select -> iterate -> package -> export ZIP。
- Candidate assets 包含 workflow、skill、prompt/spec、provider、model、safety、QA、trace provenance。
- Export ZIP 包含 manifest、assets、QA report、prompt/spec/skill/provider metadata、applicable safety disclaimer。
- Admin 能查看 skill、trace、feedback、crawler finding、prompt fragment candidate、quota transaction、provider usage/status、safety decision、audit log、export job、failed job。
- Crawler 只能处理 approved local/test source 并生成 pending finding。
- Prompt fragment candidate 不能绕过 admin review 变 active。
- Web/Admin/backend build、typecheck、unit、integration、migration、agent contract、API contract、Playwright smoke 全部通过。

### 23.2 CI Gate

main 合并前必须通过：

- lint/typecheck/unit/integration。
- migration empty/seeded tests。
- OpenAPI stale check。
- generated client stale check。
- API contract tests。
- agent contract tests。
- RBAC/tenant isolation tests。
- quota transaction/concurrency tests。
- SSRF deny tests。
- upload validation tests。
- Playwright smoke。
- Docker build。
- dependency/image/secret scans。

### 23.3 Private Beta / Staging Gate

必须全部通过：

- Auth、admin auth、RBAC、tenant isolation、audit logs、secure sessions 工作。
- Brief slots、clarification flows、uploads、brief confirmation 工作。
- Object storage、signed downloads、retention、cross-tenant denial tests 通过。
- Quota reservation/commit/refund、entitlement、rate limits、provider spend cap 工作。
- Support tickets、admin retry、export regeneration、quota credit、user lookup、安全队列、abuse queue 工作。
- Starter skill eval suites 通过。
- Image QA 产生 pass/warn/block，并阻止 blocking export。
- Safety policy 在 required enforcement points 运行。
- Crawler source approval 和 provenance 强制执行。
- Staging 有 logs、metrics、traces、alerts、dashboards、backups、rollback procedure、feature flags、load-test results。
- Legal pages、support contact、privacy notice、AI/content disclaimers 对外部测试用户可见。

### 23.4 Production Launch Gate

必须全部通过：

- Real provider 按 provider contract 接入、监控、记录成本，并且 status 为 production；或 launch 明确为 invite/comp-only 且隐藏付费/真实生成声明。
- Paid launch 已验证 checkout、active subscription、cancellation、past_due、quota reset、insufficient quota、webhook idempotency、admin credit。
- Active skills 有 owner、risk level、safety refs、eval suite IDs、passing evals、release notes、canary metrics、rollback targets。
- Prompt/skill/crawler/provider/safety changes 必须 eval/review/audit 后才能 activation。
- Safety red-team 通过。
- High-risk admin changes 需要 RBAC、rationale、immutable audit、second review。
- Abuse monitoring 可 throttle/hold accounts。
- Security checks 通过：tenant isolation、admin RBAC、signed URLs、SSRF、upload validation、CORS、CSRF/session、dependency/image/secret scanning、secret redaction、audit access。
- Backup/restore drill、app rollback drill、feature flag rollback drill、incident runbooks、dashboards、alerts、SLOs、post-deploy smoke 完成。
- Terms、Privacy、Acceptable Use、AI/content disclaimer、support contact、IP complaint flow 上线。
- Paid checkout 启用时 billing/refund/cancellation policy 上线。

## 24. Do-Not-Launch Conditions

任何一条为真，都不得 public 或 paid production launch：

- Dev/mock provider 被 UI、docs、marketing 或 billing 暗示为真实生产生成。
- Candidate assets 缺 provider/model/prompt/spec/skill/safety provenance。
- External APIs 或 internal agent steps 缺合同和 trace completeness。
- User projects、assets、exports、traces、quota、support tickets、audit logs 任何 tenant-isolation test 失败。
- Prompt、skill、provider routing、safety rule、crawler-derived changes 可绕过 eval/review/audit activation。
- Active skills 缺 owner、risk level、eval suite、safety refs、release notes、canary metrics 或 rollback target。
- Crawler 可抓取或导入 unapproved source。
- Crawler-derived active materials 缺 provenance、raw-retention limits 或 takedown path。
- Safety 只是 disclaimer，没有在 brief/provider request/provider response/QA/export 强制执行。
- Safety red-team fixtures 失败。
- Export package 可带 blocking QA failure 出口且没有 eligible audited override。
- Vertical workflows 只通过 generic rendering tests，没有 domain fixtures、four-option taxonomy、required outputs、QA/safety checks、manifest validation。
- Admin review decisions 可变更、缺 reviewer rationale，或 high-risk changes 绕过 RBAC/audit/second review。
- Feedback 可影响 prompt/skill evolution，但缺 provenance、filtering、weighting、regression fixtures。
- Rate limits、provider concurrency limits、spend cap 或 emergency kill switch 缺失。
- Quota reservation/commit/refund 未经过 retry/concurrency transaction tests。
- Secrets 或 provider keys 可进入 frontend bundle、logs、traces、exports、crawler findings、screenshots、support tickets 或 admin UI。
- Object storage 缺 tenant-scoped signed access、retention policy、cleanup 或 cross-tenant denial tests。
- Staging 缺 provider、queue、export、quota、safety、crawler、object storage、billing、admin failure 的 logs/metrics/traces/dashboards/alerts/runbooks。
- Backups 和 restore drills 未完成。
- Production deploy 缺 rollback plan、migration compatibility notes、post-deploy smoke test。
- Public launch 缺 Terms、Privacy、Acceptable Use、support contact、AI/content responsibility disclaimer 或 IP complaint flow。
- Paid launch 缺 checkout/subscription/cancellation/past_due/quota reset 流程测试，且没有明确 invite/comp-only 模式并隐藏付费声明。

## 25. Authoritative Rev2 Execution Checklist

### 25.1 Repository Bootstrap

- [x] 创建 Alphane-style 纯 Web 三端 monorepo 目录：`web/` 用户端、`admin/` 管理端、`backend/` Go API/worker/crawler/migrate、`scripts/`。
- [x] 新增根目录 `.env.example`，覆盖 web、admin、backend、Postgres、Redis、object storage、auth、session、provider、billing、observability、crawler、analytics。
- [x] 新增根目录 `docker-compose.yml`，可启动 web、admin、backend server、worker、crawler、Postgres、Redis、local object storage。
- [x] 新增 README，说明 Rev2 是唯一权威源，并给出本地启动命令。
- [x] 配置 git ignore，排除 `.cron/`、`.ops/`、logs、node_modules、build 输出、临时导出包、本地对象存储数据。

### 25.2 Backend Foundation

- [x] 初始化 `backend/go.mod`。
- [x] 实现 Go server 入口。
- [x] 实现 Go worker 入口。
- [x] 实现 Go crawler 入口。
- [x] 实现 Postgres 连接和 healthcheck。
- [x] 实现 Redis 连接和 healthcheck。
- [x] 实现 object storage 连接和 healthcheck。
- [x] 实现 migration runner。
- [x] 新增 backend Dockerfile。
- [x] 新增 `/healthz` 和 `/readyz`。

### 25.3 Database Schema

- [x] 创建 users、sessions、roles、audit logs 表。
- [x] 创建 projects、workspaces、canvas nodes/edges/frames/versions 表。
- [x] 创建 chat sessions/messages、agent tasks、agent traces 表。
- [x] 创建 candidate sets/assets、selected directions 表。
- [x] 创建 uploads/assets/object metadata 表。
- [x] 创建 packages、package items、exports、share links 表。
- [x] 创建 skills、skill versions、skill sources、skill release channels、skill usage stats 表。
- [x] 创建 prompt fragments、fragment versions、mutations、mutation reviews 表。
- [x] 创建 meta prompts、meta prompt versions、image specs、spec instances、spec evaluations 表。
- [x] 创建 eval suites、eval fixtures、eval results 表。
- [x] 创建 crawler sources/runs/documents/findings/import reviews 表。
- [x] 创建 quota buckets、quota transactions、subscription plans、user subscriptions、provider usage logs 表。
- [x] 创建 feedback events/labels/performance daily 表。
- [x] 创建 safety rules/decisions、QA results 表。
- [x] 创建 support tickets、abuse events、incident logs 表。
- [x] 创建 seed：default plan、local admin、local user、internal skills、workflow fixtures、crawler test source。

### 25.4 API Contracts

- [x] 新增 OpenAPI 或等价 API schema。
- [x] 定义 shared error envelope。
- [x] 定义 auth/RBAC per endpoint。
- [x] 定义 pagination/filtering/sorting/search。
- [x] 定义 idempotency keys。
- [x] 定义 long-running task status。
- [x] 生成 Web typed client。
- [x] 生成 Admin typed client。
- [x] 添加 backend contract tests。
- [x] 添加 CI stale schema/client check。

### 25.5 Web Foundation

- [x] 初始化 `web/` Next.js TypeScript 应用。
- [x] 配置 lint/typecheck/test/build。
- [x] 实现 typed API client。
- [x] 实现 auth/session flow。
- [x] 实现 account settings。
- [x] 实现 project dashboard。
- [x] 实现 workspace shell：顶栏、左侧、画布、右侧。
- [x] 实现 onboarding empty state 和 workflow examples。
- [x] 实现 chatbox、missing-info clarification、brief confirmation。
- [x] 实现 reference upload。
- [x] 实现 candidate set 4 卡片展示。
- [x] 实现 candidate select 和 iteration。
- [x] 实现 canvas node 基础渲染、autosave、version restore。
- [x] 实现 package panel、package history、export history。
- [x] 实现 export preview、ZIP download、QA warning/block UI。
- [x] 实现 billing/quota meter。
- [x] 实现 report problem。
- [x] 新增 web Dockerfile。

### 25.6 Admin Foundation

- [x] 初始化 `admin/` Next.js TypeScript 应用。
- [x] 配置 lint/typecheck/test/build。
- [x] 实现 typed admin API client。
- [x] 实现独立 admin auth。
- [x] 实现 admin shell。
- [x] 实现 Skill Registry。
- [x] 实现 Skill Version review/release/rollback/canary dashboard。
- [x] 实现 Crawler Source/Finding review。
- [x] 实现 Prompt Fragment candidate review。
- [x] 实现 Meta Prompt/Image Spec review。
- [x] 实现 Agent Invocation Trace detail。
- [x] 实现 Feedback Queue。
- [x] 实现 Provider Health dashboard。
- [x] 实现 Queue/Dead-letter dashboard。
- [x] 实现 Export Job detail/regenerate。
- [x] 实现 Support Console/user lookup。
- [x] 实现 Quota credit/debit。
- [x] 实现 Safety/Risky Export queue。
- [x] 实现 Abuse queue。
- [x] 实现 Audit Log search。
- [x] 新增 admin Dockerfile。

### 25.7 Auth, RBAC, Tenant Isolation, Audit

- [x] 决定 Stage 0 access mode。
- [x] 实现 Web user auth。
- [x] 实现 Admin auth。
- [x] 定义角色和权限矩阵。
- [x] 对项目、工作区、聊天、画布、资产、package、export、quota、feedback、support ticket、trace 强制 tenant isolation。
- [x] 对 skill release、crawler import、prompt approval、provider routing、quota override、safety rule、export override 强制 admin RBAC。
- [x] 实现 immutable audit log。
- [x] 添加 cross-tenant denial tests。
- [x] 添加 non-admin `/api/admin/*` denial tests。
- [x] 默认禁用 `/api/admin/*` dev identity headers；admin endpoints 默认只接受独立 admin session cookie，local dev header fallback 需显式 `ADMIN_DEV_IDENTITY_HEADERS_ENABLED=true`。

### 25.8 Billing, Quota, Entitlement

- [x] 实现 subscription state machine。
- [x] 实现 local mock checkout provider。
- [x] 实现 paid provider abstraction。
- [x] 实现 billing page。
- [x] 实现 entitlement middleware。
- [x] 实现 weekly quota reset。
- [x] 实现 quota reservation。
- [x] 实现 quota commit/refund。
- [x] 实现 quota retry/idempotency。
- [x] 实现 admin quota credit/debit。
- [x] 实现 provider usage reconciliation。
- [x] 实现 daily spend cap。
- [x] 实现 emergency kill switch。
- [x] 添加 quota transaction/concurrency tests。

### 25.9 Object Storage and Export

- [x] 实现 object storage abstraction。
- [x] 实现 local object storage adapter。
- [x] 实现 S3-compatible config。
- [x] 实现 object metadata。
- [x] 实现 thumbnail generation。
- [x] 实现 signed URL。
- [x] 实现 cross-tenant object denial。
- [x] 实现 package manifest schema。
- [x] 实现 deterministic file naming。
- [x] 实现 ZIP export。
- [x] 实现 PDF placeholder 或真实 PDF export。
- [x] 实现 PPT-ready metadata。
- [x] 实现 Figma-ready layout spec。
- [x] 实现 export retry/regenerate。
- [x] 实现 cleanup expired exports/orphaned objects。
- [x] admin 触发 object retention cleanup 在执行前记录 rationale/request audit，成功、dry-run preview、partial failure 均记录 redacted immutable audit。
- [x] S3-compatible retention cleanup skips corrupt/unscoped expiry markers without deleting their objects and continues valid tenant-scoped expired object deletion.
- [x] 添加 upload/download/export integration tests。

### 25.10 Agent and Provider Contracts

- [x] 定义 `AgentStepContract`。
- [x] 实现 intent router contract。
- [x] 实现 brief completion contract。
- [x] 实现 workflow planner contract。
- [x] 实现 hidden skill selector contract。
- [x] 实现 meta prompt/spec resolver contract。
- [x] 实现 prompt fragment composer contract。
- [x] 实现 safety injector contract。
- [x] 实现 provider router contract。
- [x] 实现 candidate builder contract。
- [x] 实现 iteration planner contract。
- [x] 实现 QA runner contract。
- [x] 实现 export builder contract。
- [x] 实现 feedback extractor contract。
- [x] 实现 prompt mutation proposer contract。
- [x] 定义 provider request/response schema。
- [x] 定义 provider capability matrix。
- [x] 实现 dev provider。
- [x] 实现 provider status。
- [x] 实现 provider fallback rules。
- [x] 实现 provider trace/provenance fields。
- [x] 添加 agent contract tests。
- [x] 添加 trace completeness tests。
- [x] 添加 provider contract tests。

### 25.11 Eval, QA, Safety

- [x] 定义 eval suite schema。
- [x] 创建四条 workflow golden fixtures。
- [x] 创建 ambiguous/unsafe/negative fixtures。
- [x] 创建 brand/product preservation fixtures。
- [x] 创建 text-heavy fixtures。
- [x] 创建 export completeness fixtures。
- [x] 实现 eval runner。
- [x] 存储 eval results。
- [x] Eval result storage write/idempotency contract 通过：`fixtures/stage0/rev2/eval/eval_storage_contract.json` declares exact replay、same-key divergent replay、source fixture digest conflict、cross-tenant same-subject write cases, and `scripts/run_eval_storage_write_contract.py --check` validates the write conflict outcomes without rerunning eval。
- [x] Eval result retention/redaction/no-public-delete contract 通过：`fixtures/stage0/rev2/eval/eval_storage_contract.json` declares pass/fail/blocked retention, summary/runner hash preservation, no public delete, admin-audited deletion/redaction semantics, and `scripts/run_eval_storage_retention_contract.py --check` validates retention outcomes without rerunning eval。
- [x] skill canary 前要求 eval pass。
- [x] prompt fragment active 前要求 eval pass。
- [x] 定义 QA result schema。
- [x] 实现 file integrity/dimensions/aspect/safe-area QA。
- [x] 实现 blank/duplicate/four-option distinctness QA。
- [x] 实现 text readability 或 manual-review placeholder。
- [x] 实现 structured text QA。
- [x] 实现 product/logo preservation QA。
- [x] 实现 forbidden claims QA。
- [x] 实现 export completeness QA。
- [x] QA result coverage 高风险类别通过 pass/warn/block 语义验证：file integrity、blank output、text readability、structured text、product/logo preservation、forbidden claims、export completeness 均有 fixture、eval result、trace/export gate 链接。
- [x] QA source artifact resolution contract 通过：`fixtures/stage0/rev2/eval/qa_result_coverage.json` declares source-artifact resolvers, and `scripts/run_qa_source_artifact_contract.py` validates QA source artifacts against workflow acceptance、export bundle、generated asset、eval gate、trace export links、QA observed/expected fields、safety decisions。
- [x] 实现 safety rule schema。
- [x] 定义并验证 brief/provider request/provider response/QA/export safety policy contract evidence。
- [x] 在 brief/provider request/provider response/QA/export 运行 safety policy。
- [x] 实现 red-team fixtures。

### 25.12 Workflow Acceptance

- [x] 定义 vertical acceptance schema。
- [x] 实现电商增长包 acceptance fixture。
- [x] 电商增长包 API smoke test 通过。
- [x] 电商增长包 Playwright happy path 通过。
- [x] 电商增长包 export ZIP evidence 通过：`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。
- [x] 实现商业视觉文档包 acceptance fixture。
- [x] 商业视觉文档包 API smoke test 通过。
- [x] 商业视觉文档包 Playwright happy path 通过。
- [x] 商业视觉文档包 export ZIP evidence 通过：`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。
- [x] 实现本地商家活动包 acceptance fixture。
- [x] 本地商家活动包 API smoke test 通过。
- [x] 本地商家活动包 Playwright happy path 通过。
- [x] 本地商家活动包 export ZIP evidence 通过：`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。
- [x] 实现角色/IP 概念包 acceptance fixture。
- [x] 角色/IP 概念包 API smoke test 通过。
- [x] 角色/IP 概念包 Playwright happy path 通过。
- [x] 角色/IP 概念包 export ZIP evidence 通过：`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。
- [x] 每条 workflow 定义 required inputs。
- [x] 每条 workflow 定义 clarification questions。
- [x] 每条 workflow 定义 4-option taxonomy。
- [x] 每条 workflow 定义 required package outputs。
- [x] 每条 workflow 定义 QA/safety/export pass thresholds。
- [x] 每条 workflow export ZIP evidence contract 通过：`fixtures/stage0/rev2/eval/workflow_export_zip_evidence_contract.json` maps required ZIP payloads、manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads、four-option taxonomy to exact passing local-alpha evidence files。

### 25.13 Crawler Governance

- [x] 实现 admin crawler source approval evidence。
- [x] backend/local crawler fetch/import runtime 强制 source approval gate。
- [x] 实现 source legal metadata。
- [x] 定义 robots evidence fixture/contract。
- [x] backend/local crawler runtime 强制 robots evidence。
- [x] 定义 SSRF protection fixture/contract：private IP blocking、redirect validation、DNS rebinding guard。
- [x] backend/local crawler runtime 强制 SSRF protections。
- [x] 定义 source/global rate limit fixture/contract。
- [x] backend/local crawler runtime 强制 source/global rate limits。
- [x] 定义 raw content retention fixture/contract。
- [x] backend/local crawler runtime 强制 raw content retention limit。
- [x] 定义 exact-text import warning fixture/contract。
- [x] backend/local crawler runtime 强制 exact-text import warning。
- [x] 定义 provenance links fixture/contract。
- [x] backend/local crawler runtime 强制 provenance links。
- [x] 定义 source blocklist fixture/contract。
- [x] backend/local crawler runtime 强制 source blocklist。
- [x] 实现 takedown/derivative review workflow。
- [x] 添加 disallowed source、robots denied、duplicate hash、pending-review import tests。
- [x] staging crawler fetch/import governance runtime evidence 通过：source approval、robots、SSRF、rate limits、retention、exact-text warning、provenance links、source blocklist 均有 staging evidence。

### 25.14 Skill, Review, Feedback, Abuse

- [x] 实现 skill release states。
- [x] 实现 skill traffic allocation。
- [x] 实现 canary metrics aggregation。
- [x] 实现 canary stop thresholds。
- [x] 实现 rollback with audit。
- [x] 实现 review queue model。
- [x] 实现 review detail with diff/provenance/eval/QA/risk。
- [x] 要求 reviewer rationale。
- [x] high-risk changes 要求 second review。
- [x] 实现 feedback taxonomy。
- [x] 实现 feedback attribution。
- [x] 实现 feedback filtering/weighting。
- [x] 实现 delayed feedback。
- [x] bad samples 转 regression fixtures。
- [x] 实现 abuse event model。
- [x] 实现 temporary hold/throttle hooks admin fixture/evidence。
- [x] temporary hold/throttle hooks runtime enforcement 通过。
- [x] 实现 admin abuse queue fixture/evidence。
- [x] admin abuse queue runtime enforcement 通过。

### 25.15 Support and Operations

- [x] 实现 report problem。
- [x] 实现 support ticket model。
- [x] 实现 support ticket 前端上下文：project/task/trace/asset/export/quota 可见并随 report problem 生成。
- [x] 实现 admin support ticket 关联证据视图：user/trace/export/quota/audit 引用可查。
- [x] support ticket 后端持久化并强制关联 user/project/task/trace/asset/export/quota。
- [x] 实现 admin user lookup。
- [x] 实现 failed task retry/cancel。
- [x] 实现 export regenerate。
- [x] 实现 queue/dead-letter dashboard。
- [x] 实现 incident log model。
- [x] 实现 maintenance banner。

### 25.16 Security, Privacy, Legal

- [x] 实现 secure cookie 和 same-site CSRF 客户端/session contract evidence。
- [x] 后端设置并验证 secure/HttpOnly/SameSite session cookies。
- [x] 配置 CORS。
- [x] 配置 Web/generated client CSRF same-site request contract。
- [x] 后端/API runtime 验证 CSRF 或 same-site strategy。
- [x] 配置 security headers。
- [x] 实现 upload validation。
- [x] 实现 malware-scan placeholder/interface。
- [x] 实现 secret classification。
- [x] 实现 startup config validation。
- [x] 实现 secret redaction。
- [x] 扩展 export/support/crawler/audit secret redaction 覆盖 S3-compatible、OSS/COS、CloudFront、B2 signed URL 查询字段。
- [x] 扩展结构化签名 URL metadata redaction/classification，覆盖 S3/GCS/Azure/CloudFront 分拆字段并保留非签名 public response override 字段。
- [x] 扩展 launch storage secret redaction 覆盖 OSS V4、Tencent COS `q-*`、B2 authorization/access key、Azure SAS IP/policy/encryption/delegation 字段的字符串和结构化 metadata。
- [x] 扩展 launch analytics/support/email/identity secret redaction/classification 覆盖 PostHog、Segment、Amplitude、Mixpanel、LaunchDarkly、PagerDuty、Opsgenie、Zendesk、Intercom、Resend、Postmark、Mailchimp、Clerk、Auth0、Supabase、Firebase metadata keys and token value patterns.
- [x] 硬化 malware scan 外部边界：scanner request/response metadata redaction、status normalization、unsupported status fail-closed tests。
- [x] 添加 dependency/image/secret scans。
- [x] 添加 Privacy notice。
- [x] 添加 Terms of Service。
- [x] 添加 Privacy Policy。
- [x] 添加 Acceptable Use Policy。
- [x] 添加 AI/content disclaimer。
- [x] 添加 IP complaint flow。
- [x] paid launch 添加 billing/cancellation/refund policy。
- [x] 添加 visible support contact。

### 25.17 CI/CD and Environments

- [ ] 添加 PR/main CI 到 `.github/workflows`。（token-blocked：当前 token 缺 workflow scope；draft/evidence 已落在 `ops/ci/` 和 `fixtures/ops/`。）
- [x] 添加 PR/main CI draft/evidence 到 `ops/ci/` 和 `fixtures/ops/`。
- [x] CI 运行 Web/Admin lint/typecheck/unit/build。
- [x] CI 运行 backend fmt/lint/vet/unit/integration/build。
- [x] CI 启动 Postgres/Redis/object storage。
- [x] CI 运行 migration tests。
- [x] CI 运行 OpenAPI/client stale checks。
- [x] CI 运行 API/agent contract tests。
- [x] CI 定义 Playwright smoke draft/evidence。
- [ ] CI 在已安装 PR/main workflow 中运行 Playwright smoke。
- [x] CI 定义 Docker image build draft/evidence。
- [ ] CI 在已安装 PR/main workflow 中 build Docker images。
- [x] CI 运行 security scans。
- [x] 定义 local/CI/staging/production。
- [x] Docker images 使用 git SHA tag。
- [x] 定义 staging deploy plan。
- [x] 执行 staging deploy。
- [x] 执行 staging smoke tests。
- [x] 定义 production approval/release tag。
- [x] 定义 feature flags。
- [x] 定义 rollback procedures。
- [x] 实现 worker drain。
- [x] 实现 task schema compatibility checks。

### 25.18 Observability, Backup, Incident, Load

- [x] 定义 request id propagation staging smoke contract。
- [x] 实现 backend request id propagation local contract。
- [x] staging request id propagation runtime evidence 通过。
- [x] 定义 structured JSON logs contract。
- [x] 实现 backend structured JSON access/error logs local contract。
- [x] staging structured JSON logs runtime evidence 通过。
- [x] 定义 OpenTelemetry traces contract。
- [x] staging OpenTelemetry traces runtime evidence 通过。
- [x] 定义 backend/worker/crawler metrics contract。
- [x] 实现 backend local metrics endpoint。
- [x] staging backend/worker/crawler metrics runtime evidence 通过。
- [x] 实现 frontend error reporting。
- [x] 定义 dashboards。
- [x] 导入并验证 staging dashboards runtime evidence。
- [x] 定义 alerts。
- [x] 配置并验证 staging alert routes/runtime evidence。
- [x] 定义 SLOs。
- [x] 定义 incident severity/escalation/template/postmortem。
- [x] 编写 runbooks。
- [x] 定义 backup schedule。
- [x] 定义 object storage backup/versioning。
- [x] 定义 RPO/RTO。
- [x] 执行 Postgres restore drill。
- [x] 执行 object restore drill。
- [x] 定义 load assumptions。
- [x] 添加 chat/task load test。
- [x] 添加 worker generation load test。
- [x] 添加 ZIP export load test。
- [x] 添加 signed download load test。
- [x] 添加 crawler throttle load test。
- [x] 添加 quota contention test。
- [x] 添加 workspace rendering performance test。

### 25.19 Product Analytics

- [x] 定义 analytics event taxonomy。
- [x] 实现 server-side core workflow event capture。
- [x] 实现 client-side onboarding/UI funnel capture。
- [x] 实现 admin report：first prompt to four candidates。
- [x] 实现 admin report：selection rate。
- [x] 实现 admin report：iteration rate。
- [x] 实现 admin report：package add/export completion。
- [x] 实现 admin report：weekly return。
- [x] 实现 admin report：QA warning/block。
- [x] 实现 admin report：cost per successful package。
- [x] 实现 admin report：support ticket/failure rate。

### 25.20 Release Gate Execution

- [x] Local Alpha Gate 全部通过。
- [ ] CI Gate 全部通过。
- [ ] Private Beta/Staging Gate 全部通过。
- [ ] Production Launch Gate 全部通过。
- [ ] Do-Not-Launch Conditions 全部为 false。
- [x] 定义 release gate evidence schema/fixtures 和 no-go release notes renderer。
- [x] 定义 post-deploy smoke evidence contract。
- [x] Release notes 包含 SHA、migration list、config diff、feature flags、owner、smoke plan、rollback plan、known risks、go/no-go。
- [x] Backfill Local Alpha release gate fixture evidence: workflow/eval/crawler/schema/service/runtime-stack checks pass in `fixtures/stage0/rev2/release_gate_evidence.local_alpha.json`。
- [x] Local Alpha workflow API/Playwright end-to-end smoke evidence 通过并写入 release gate fixture。
- [x] Local Alpha 电商增长包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/ecommerce_growth_pack.api_smoke.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` 均证明 running local stack。
- [x] Local Alpha 商业视觉文档包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/business_visual_doc_pack.api_smoke.json`、`ops/evidence/local_alpha/business_visual_doc_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` 均证明 running local stack。
- [x] Local Alpha 本地商家活动包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/local_merchant_campaign_pack.api_smoke.json`、`ops/evidence/local_alpha/local_merchant_campaign_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` 均证明 running local stack。
- [x] Local Alpha 角色/IP 概念包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/character_ip_concept_pack.api_smoke.json`、`ops/evidence/local_alpha/character_ip_concept_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` 均证明 running local stack。
- [x] Backfill CI draft/no-go evidence: ops CI draft coverage passes while installed `.github/workflows` runtime remains blocked in `fixtures/stage0/rev2/release_gate_evidence.ci.json`。
- [ ] CI installed workflow runtime evidence 通过：PR/main run、Playwright smoke、Docker image build 均有 validator-resolvable evidence。
- [ ] CI installed workflow file evidence 通过：`.github/workflows/stage0-rev2-ci.yml` 存在且被 release gate fixture 引用。
- [ ] CI PR/main workflow run evidence 通过：已安装 workflow 的 PR/main run 结果写入 `ops/evidence/ci/`。
- [ ] CI Playwright smoke runtime evidence 通过：已安装 PR/main workflow 运行 Playwright smoke 并写入 `ops/evidence/ci/`。
- [ ] CI Docker image build runtime evidence 通过：已安装 PR/main workflow build Docker images 并写入 `ops/evidence/ci/`。
- [x] Backfill Private Beta/Staging no-go evidence: contract/fixture evidence is separated from external-user staging runtime blockers in `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json`。
- [ ] Private Beta/Staging external-user runtime evidence 通过：auth/RBAC/tenant、storage、quota/rate limit、support/abuse、safety/QA/crawler、observability/backup/load、legal visibility 均有 staging evidence。
- [x] Private Beta/Staging auth/RBAC/tenant/audit runtime evidence 通过。
- [x] Private Beta/Staging brief/upload/confirmation runtime evidence 通过。
- [ ] Private Beta/Staging object storage signed download/retention runtime evidence 通过。
- [x] Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。
- [ ] Private Beta/Staging object retention/cleanup runtime evidence 通过：staging evidence proves retention policy, expired export cleanup, orphan cleanup, and audit refs under `ops/evidence/staging/`。
- [x] Private Beta/Staging object retention/cleanup blocked probe evidence recorded but launch blocker preserved: `ops/evidence/staging/object-storage-retention-cleanup.blocked.json` has `status=blocked`, documents missing staging base URL/admin auth/runtime input requirements, preserves `object_storage_signed_retention_runtime_missing`, and cannot close object retention/cleanup, aggregate Private Beta/Staging, Production, or Do-Not-Launch readiness。
- [x] Private Beta/Staging quota/rate-limit/spend-cap runtime evidence 通过。
- [x] Private Beta/Staging support/retry/abuse runtime evidence 通过。
- [x] Private Beta/Staging eval/QA/safety enforcement runtime evidence 通过。
- [x] Private Beta/Staging crawler approval/provenance runtime evidence 通过。
- [x] Private Beta/Staging observability/backup/load runtime evidence 通过。
- [x] Private Beta/Staging observability runtime evidence 通过：staging evidence proves request-id、structured logs、OpenTelemetry traces、backend/worker/crawler metrics、dashboard import、alert routes in `ops/evidence/staging/20260527T1830Z-observability-runtime.json`; this observability-only artifact preserved backup/restore、load、post-deploy smoke blockers until the later combined preflight closed them。
- [x] Private Beta/Staging backup/restore runtime evidence 通过：staging evidence proves Postgres restore and object restore entries required by `staging_observability_backup_load` preflight。
- [x] Private Beta/Staging load runtime evidence 通过：staging evidence proves chat/task、worker generation、ZIP export、signed download、crawler throttle、quota contention、workspace rendering load entries required by `staging_observability_backup_load` preflight。
- [x] Private Beta/Staging legal/support external-user visibility runtime evidence 通过。
- [x] Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。
- [x] Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。
- [x] Backfill Production Launch no-go evidence: provider/billing/skill/activation/abuse/security/backup/legal blockers remain active in `fixtures/stage0/rev2/release_gate_evidence.production_launch.json`。
- [ ] Production Launch runtime/deployment evidence 通过：provider-or-comp-only、paid lifecycle、skill canary、activation audit、abuse hold、security、backup/rollback/post-deploy smoke、legal/support policy 均有 production evidence。
- [x] Production provider-or-comp-only runtime/deployment evidence 通过。
- [x] Production provider mode deployment evidence 通过：production evidence proves either real provider contract/monitoring/cost/staging verification or explicit invite/comp-only mode under `ops/evidence/production/`。
- [x] Production public paid/real-generation claims evidence 通过：production evidence proves paid and real-generation claims are enabled only with real provider evidence, or hidden for invite/comp-only mode under `ops/evidence/production/`。
- [x] Production paid billing lifecycle runtime/deployment evidence 通过。
- [x] Production checkout/subscription/cancellation/past_due runtime evidence 通过 under `ops/evidence/production/`。
- [x] Production refund/credit/quota reset/webhook idempotency runtime evidence 通过 under `ops/evidence/production/`。
- [x] Production skill release/eval/canary runtime/deployment evidence 通过。
- [x] Production activation review/audit runtime/deployment evidence 通过。
- [x] Production abuse throttle/hold runtime/deployment evidence 通过。
- [x] Production security launch-check runtime/deployment evidence 通过。
- [ ] Production backup/rollback/incident/post-deploy smoke runtime/deployment evidence 通过。
- [ ] Production backup/restore runtime evidence 通过：production evidence proves backup schedule, Postgres restore, object restore, RPO/RTO, and audit refs under `ops/evidence/production/`。
- [ ] Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves rollback drill, incident/alert path, migration compatibility, and post-deploy smoke under `ops/evidence/production/`。
- [x] Production backup/rollback/incident/post-deploy admin-visible probe evidence recorded but launch blocker preserved: `ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json` has `status=blocked_by_upstream_gates`, proves backup、rollback、incident、post-deploy smoke probes, and cannot close production backup/rollback launch readiness until upstream CI/Staging gates and exact split files pass。
- [x] Production legal/support policy deployment evidence 通过。
- [x] Production public legal policy deployment evidence 通过：production evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow visibility under `ops/evidence/production/`。
- [x] Production public support/billing policy deployment evidence 通过：production evidence proves support contact and paid billing/cancellation/refund policy visibility under `ops/evidence/production/`。
- [x] Staging post-deploy smoke tests 通过。
- [ ] Production post-deploy launch-clearing smoke evidence 通过：exact production split evidence exists at `ops/evidence/production/rollback-incident-post-deploy-smoke.json`, cites passing CI and Private Beta/Staging gate fixtures, and clears `production_deploy_rollback_smoke_missing` without preserved blockers。

Release gate evidence map:

- Local Alpha Gate: `fixtures/stage0/rev2/release_gate_evidence.local_alpha.json` records fixture/runtime-stack pass evidence and all four workflow API/Playwright/export ZIP runtime smoke artifacts.
- CI Gate: `fixtures/stage0/rev2/release_gate_evidence.ci.json` records ops CI draft coverage and keeps installed workflow/runtime execution, Playwright smoke, and Docker image build blocked.
- Private Beta/Staging Gate: `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json` records fixture/definition evidence where present, clears auth/RBAC/tenant/audit, brief/upload/confirmation, quota/rate-limit/spend-cap, support/retry/abuse, eval/QA/safety enforcement, crawler runtime checks, observability/backup/load/post-deploy-smoke, and legal/support external-user visibility with staging evidence, and keeps Private Beta/Staging aggregate no-go only for production-like object storage retention/cleanup.
- Production Launch Gate: `fixtures/stage0/rev2/release_gate_evidence.production_launch.json` records fixture/definition evidence where present, clears provider/comp-only mode, paid billing lifecycle, skill release/eval/canary, abuse throttle/hold, activation review/audit, security launch checks, and legal/support policy with production evidence, records admin-visible backup/rollback/incident/post-deploy smoke probes, and keeps launch evidence blocked for backup/rollback/incident readiness until upstream gates pass.

Release gate closure policy:

- `fixtures/stage0/rev2/release_gate_evidence.*.json` must cite the exact Do-Not-Launch condition text covered by each gate condition.
- Each release gate fixture must include a `gate_decision` object whose `status`, `blocked_by_checks`, and `active_do_not_launch_conditions` exactly match the computed check statuses and active Do-Not-Launch conditions; a fixture-level `go` decision is invalid while any check is blocked/failing or any Do-Not-Launch condition is active.
- Release gate fixture `checks.check_id`, `do_not_launch_checks.condition_id`, `gate_decision.blocked_by_checks`, and `gate_decision.active_do_not_launch_conditions` must contain unique non-empty IDs; duplicate IDs are invalid even if their set of values would look complete.
- Required release gate checks cannot use `not_applicable`; any required Local Alpha、CI、Private Beta/Staging、Production check without pass evidence must remain `blocked` or `fail` and, outside the Local Alpha workflow-smoke exception, map to an active Do-Not-Launch condition.
- `gate_decision.blocked_by_checks` and `gate_decision.active_do_not_launch_conditions` must preserve fixture order from the current blocked/failing checks and active Do-Not-Launch conditions; sorted or stale blocker arrays cannot close or preserve a launch gate.
- For a `no_go` fixture, `gate_decision.evidence_ref` must name every blocked/failing check ID and every active Do-Not-Launch condition ID from the same fixture; summary prose cannot hide a still-active blocker.
- For a `no_go` fixture, `gate_decision.evidence_ref` must also cite every exact validator-owned blocker artifact path required by the blocked checks and active Do-Not-Launch conditions, and must state whether each exact path is present/passed or absent/missing; aggregate decision prose cannot rely only on check IDs or broad evidence directories.
- Every `gate_decision.evidence_ref` must name the aggregate runtime checklist row it governs; decision prose that only names low-level check IDs cannot silently drift away from the visible Local Alpha、CI、Private Beta/Staging、Production checklist state.
- `gate_decision.status` must also align with the authoritative checklist: each open gate checklist item requires the matching fixture decision to stay `no_go`, and each checked gate checklist item requires the matching fixture decision to be `go`.
- A gate checklist item may close only when every check in its evidence fixture is `pass` and every Do-Not-Launch condition in that fixture is false.
- If a gate checklist item remains open, its release gate fixture must still contain at least one computed blocker; if the fixture becomes fully passable, the checklist must be updated in the same change.
- Passed gate checks and cleared Do-Not-Launch conditions must cite validator-resolvable repository artifacts such as `fixtures/`, `schemas/`, `openapi/`, `scripts/`, `backend/`, `web/`, `admin/`, `ops/`, `.env.example`, or `docker-compose.yml`; prose-only evidence is not sufficient.
- Passed gate checks and cleared Do-Not-Launch conditions may not mix real and missing concrete artifact paths in one evidence ref; every cited concrete artifact path must resolve, while active blockers may name the absent runtime/deployment evidence path they are waiting on.
- A blocked Do-Not-Launch condition must state the missing runtime or deployment evidence; prose-only readiness claims are not sufficient.
- Definition-only artifacts can close checklist subitems only when the corresponding runtime subitem remains open.
- Fixture or contract evidence can never close CI, Private Beta/Staging, Production Launch, or Do-Not-Launch checklist items by itself; those gates require runtime or deployment evidence in their matching release gate fixture.
- Runtime gate checks that pass must cite environment-specific evidence paths, not only schema, fixture, draft, README, blueprint, or contract artifacts.
- Passed runtime gate checks must cite exact validator-owned evidence files when the checklist subitem is closed by a named `ops/evidence` artifact; citing only a broad evidence directory or prose summary is insufficient.
- Passed runtime evidence files must declare the expected environment and, when present, a `release_gate_check_id` or preserved gate check ID matching the release gate check being closed; stale or cross-gate evidence cannot close a runtime check.
- Passed runtime evidence JSON under `ops/evidence/` must explicitly back-reference the same release gate check through `release_gate_check_id` and must name one validator-owned checklist row in `gate_impact`; a valid path plus generic `status=pass` is not enough to close Local Alpha、CI、Private Beta/Staging、Production, or Do-Not-Launch evidence.
- Exact split runtime evidence files for CI、Private Beta/Staging、Production, and checked split checklist rows must include `release_gate_check_id` equal to the release-gate check they support; an omitted or mismatched check ID cannot close or preserve a split launch gate.
- Passed runtime evidence file environments are gate-specific: Local Alpha accepts only `local` or `local_alpha`, CI accepts only `ci`, Private Beta/Staging accepts only `staging`, and Production Launch accepts only `production`; a JSON file from another environment cannot close a runtime gate even when its path is cited.
- Passed runtime evidence files that carry `release_gate_check_id` must themselves have a passing status (`pass`、`passed`、or `pass_with_blockers_preserved`); blocked preflight reports, files with `blocked_slots`, or files with `missing_blockers` cannot be cited as pass evidence for Local Alpha、CI、Private Beta/Staging、Production, or global Do-Not-Launch closure.
- Any JSON runtime evidence file cited by a passed runtime gate check must have a gate-appropriate passing `status` when a status field is present, even if the file omits `release_gate_check_id`; blocked, failed, or stale JSON cannot be used as silent supporting pass evidence, and blocker-preserving JSON remains subject to the explicit aggregate/global closure guards.
- Blocked runtime evidence artifacts may be checked only as explicit non-closure probe rows; they must keep the matching concrete pass row open, keep the matching release gate check blocked, keep the matching Do-Not-Launch condition active, cite the canonical pass artifact path they are waiting on, and must not appear in any passed release-gate check evidence, aggregate gate closure evidence, Production upstream-clearing evidence, or global Do-Not-Launch closure evidence.
- Passed runtime gate checks may cite blocker-preserving JSON only when that file is a validator-owned partial or check-level source input with dedicated exact-file validation and preserved-blocker semantics; arbitrary `pass_with_blockers_preserved` evidence cannot be smuggled into Local Alpha、CI、Private Beta/Staging、Production, or global Do-Not-Launch closure.
- Any passed runtime gate check must cite at least one exact existing file under its gate-specific runtime evidence area: `ops/evidence/local_alpha/` or `ops/evidence/local/` for Local Alpha, `.github/workflows/` plus `ops/evidence/ci/` for CI, `ops/evidence/staging/` for Private Beta/Staging, and `ops/evidence/production/` for Production Launch. Directory-only runtime evidence cannot close a check.
- Blocked or failing runtime gate checks must name the missing gate-specific evidence area and required runtime coverage, for example `ops/evidence/local_alpha/` workflow API/Playwright/export evidence, `.github/workflows/` plus `ops/evidence/ci/` PR/main CI evidence, `ops/evidence/staging/` external-user staging evidence, or `ops/evidence/production/` production deployment evidence. Vague blocked prose cannot preserve an open launch gate.
- Checked runtime subitems that partially satisfy a larger release gate must have validator-owned file-level checks that prove environment, status, release gate check ID, matching checklist item, required runtime coverage, and preserved aggregate blockers.
- A top-level gate checklist item, aggregate runtime checklist item, global Do-Not-Launch item, or fixture-level `go` decision cannot cite runtime evidence that preserves blockers: `status=pass_with_blockers_preserved`、non-empty `remaining_blockers`、`blocked_slots`、`missing_blockers`、`closure_blockers`、`preserved_release_gate_check_id`、`preserved_do_not_launch_condition_id`、or `can_clear_aggregate_item=false`.
- Private Beta/Staging checked partial subitems must be backed by named validator constants for their exact `ops/evidence/staging/*.json` files; a generic staging evidence path or release-gate prose cannot close auth/RBAC/tenant/audit, brief/upload/confirmation, quota/rate-limit/spend-cap, support/retry/abuse, eval/QA/safety, crawler approval/provenance, observability/backup/load, or legal/support visibility subitems.
- CI aggregate runtime evidence may close only after all four CI runtime subitems are closed: installed workflow file, PR/main workflow run, Playwright smoke, and Docker image build.
- CI installed workflow file evidence may close only when `fixtures/stage0/rev2/release_gate_evidence.ci.json` cites the exact `.github/workflows/stage0-rev2-ci.yml` path and the installed workflow contains Stage 0 Rev2 validation, Playwright smoke, and Docker build jobs consistent with `ops/ci/stage0-rev2-ci.yml`.
- Passed gate checks must not leave their directly related Do-Not-Launch condition active in the same release gate fixture.
- CI, Private Beta/Staging, and Production blocked/failing release gate checks must each map to at least one active Do-Not-Launch condition in the same fixture, and every active Do-Not-Launch condition must map back to a blocked/failing check.
- CI, Private Beta/Staging, and Production gate fixtures may not be `no_go` with zero active Do-Not-Launch conditions; every non-local launch blocker must be visible in Section 24 coverage.
- Local Alpha may remain `no_go` with zero active Do-Not-Launch conditions only for local workflow runtime smoke that has not yet produced per-workflow API/Playwright/export ZIP evidence; this exception cannot apply to CI, Private Beta/Staging, Production, or the global Do-Not-Launch checklist item.
- Active CI、Private Beta/Staging、Production Do-Not-Launch conditions must also map to validator-owned launch-readiness checklist rows that remain open; an active blocker cannot be hidden behind a checked or deleted checklist row.
- Every active CI、Private Beta/Staging、Production Do-Not-Launch condition must have a validator-owned checklist blocker mapping; unmapped active conditions are invalid even if their fixture evidence_ref names a missing artifact.
- If a Do-Not-Launch condition is active, every matching concrete evidence row for that blocker must stay unchecked until the release gate fixture condition is false and the matching check is passable; stale checked rows cannot coexist with active launch blockers.
- The validator must fail any fixture/checklist mismatch where an active Do-Not-Launch condition has no visible open checklist row in Section 25, even when the fixture `gate_decision` is correctly `no_go`.
- Release gate fixture files are closed-world: only `release_gate_evidence.local_alpha.json`, `release_gate_evidence.ci.json`, `release_gate_evidence.private_beta_staging.json`, and `release_gate_evidence.production_launch.json` are valid.
- Release gate fixture identities are closed-world: those four files must respectively use `gate_local_alpha_fixture_baseline`, `gate_ci_draft_blocked`, `gate_private_beta_staging_blocked`, and `gate_production_launch_blocked` as `evidence_id`; copied, renamed, or extra release-gate fixtures cannot contribute to gate closure.
- Release gate fixture top-level keys are closed-world: only `schema_version`, `gate`, `evidence_id`, `checks`, `do_not_launch_checks`, `gate_decision`, and `provenance` are allowed; extra override or summary fields are invalid.
- Release gate fixture check objects are closed-world: each `checks[]` item may contain only `check_id`, `status`, and `evidence_ref`; each `do_not_launch_checks[]` item may contain only `condition_id`, `blueprint_condition`, `is_present`, and `evidence_ref`; extra per-check closure flags cannot override the computed gate state.
- Release gate fixture `gate_decision.blocked_by_checks` may contain only IDs present in the same fixture's `checks.check_id`, and `gate_decision.active_do_not_launch_conditions` may contain only IDs present in the same fixture's `do_not_launch_checks.condition_id`; unknown blocker IDs are invalid even if the computed blocker arrays otherwise look ordered.
- Release gate fixture `gate_decision` is a closed object: only `status`, `blocked_by_checks`, `active_do_not_launch_conditions`, and `evidence_ref` are allowed; extra summary or override fields are invalid because they can mask stale launch state.
- Release gate fixture `schema_version` must remain `stage0.rev2`, `gate` must match the filename's canonical gate, `provenance.created_by_lane` must remain `lane6`, and `provenance.blueprint_sections` must be a non-empty list; a fixture with the right checklist prose but wrong identity/provenance is invalid.
- Local Alpha workflow smoke pass evidence must name all four workflows and cite exact per-workflow API, Playwright, and export ZIP runtime evidence files under `ops/evidence/local_alpha/`; one generic local smoke artifact or directory-level reference cannot close the aggregate Local Alpha runtime check.
- Local Alpha per-workflow runtime evidence must validate three distinct exact files for each workflow: API smoke evidence with required operation IDs and four-candidate/package/export assertions, Playwright evidence with brief/upload/four-candidate/select/iterate/package/export/download steps, and export ZIP evidence with manifest、QA、safety、provenance、AI disclaimer、metadata、trace payloads and four-option taxonomy; a file with only `status=pass` is insufficient.
- Blocked Local Alpha workflow smoke evidence must also name the exact missing per-workflow files for every still-open workflow row; broad `ops/evidence/local_alpha/` blocker prose cannot preserve an aggregate Local Alpha blocker.
- Blocked CI runtime evidence must name the exact installed-workflow/runtime files required for closure: `.github/workflows/stage0-rev2-ci.yml`、`ops/evidence/ci/stage0-rev2-pr-main-run.json`、`ops/evidence/ci/stage0-rev2-playwright-smoke.json`、and `ops/evidence/ci/stage0-rev2-docker-image-build.json`; broad `.github/workflows/` or `ops/evidence/ci/` blocker prose cannot preserve CI Gate.
- Active CI Do-Not-Launch condition evidence refs must name the exact installed-workflow/runtime file they are waiting on and state whether each exact file is present or absent: `.github/workflows/stage0-rev2-ci.yml` for workflow installation, `ops/evidence/ci/stage0-rev2-pr-main-run.json` for PR/main execution, `ops/evidence/ci/stage0-rev2-playwright-smoke.json` for Playwright smoke, and `ops/evidence/ci/stage0-rev2-docker-image-build.json` for Docker image build; a broad draft CI artifact or `ops/evidence/ci/` directory cannot preserve active CI launch blockers.
- Private Beta/Staging check-level runtime subitems must remain open until each matching release gate check has staging evidence: auth/RBAC/tenant/audit; brief/upload/confirmation; object storage signed downloads/retention; quota/rate-limit/spend-cap; support/retry/abuse; eval/QA/safety; crawler approval/provenance; observability/backup/load; legal/support external-user visibility.
- Private Beta/Staging object storage signed download/retention cannot close from local object storage tests, S3 config, or backend integration tests alone; it requires separate staging signed URL and staging retention/cleanup evidence files, and both must be cited by `staging_object_storage_signed_downloads`.
- Private Beta/Staging object retention/cleanup blocked probe evidence at `ops/evidence/staging/object-storage-retention-cleanup.blocked.json` may close only the explicit blocked-probe row; it cannot close `ops/evidence/staging/object-storage-retention-cleanup.json`, `staging_object_storage_signed_downloads`, `object_storage_signed_retention_runtime_missing`, the aggregate Private Beta/Staging gate, Production upstream readiness, or global Do-Not-Launch readiness.
- Private Beta/Staging `staging_observability_backup_load` may pass only when its release gate evidence cites an exact passed `ops/evidence/staging/*.json` preflight report with `kind=staging_observability_backup_load_preflight`, `status=passed`, `release_gate_check_id=staging_observability_backup_load`, verified observability entries, verified Postgres/object restore entries, verified load entries, verified post-deploy smoke entries, and no preserved `staging_observability_restore_load_missing` blocker.
- Private Beta/Staging `staging_observability_backup_load` named validator evidence must be the combined preflight report itself; component observability、backup、load、post-deploy smoke files may be cited as source inputs only and cannot substitute for `ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json` when closing the aggregate check.
- Private Beta/Staging legal/support visibility cannot close from web source files or policy text alone; it requires external-user staging visibility evidence for both legal pages and support contact/report-problem flow.
- Production check-level runtime subitems must remain open until each matching release gate check has production evidence: provider-or-comp-only; paid billing lifecycle; skill release/eval/canary; activation review/audit; abuse throttle/hold; security launch checks; backup/rollback/incident/post-deploy smoke; legal/support policy deployment.
- Production provider-or-comp-only cannot close from provider abstractions, billing UI, or policy prose; it requires production evidence for the chosen launch mode and a separate production evidence check that public paid/real-generation claims match that mode.
- Production paid billing lifecycle cannot close from mock checkout or subscription-state implementation alone; it requires production runtime evidence for checkout/subscription/cancellation/past_due plus refund/credit/quota reset/webhook idempotency.
- Production backup/rollback/incident readiness cannot close from runbooks or release templates alone; it requires production backup/restore evidence and production rollback/incident/post-deploy smoke evidence, and still remains blocked until CI and Private Beta/Staging gates pass.
- Production legal/support policy cannot close from web page artifacts alone; it requires production deployment evidence for public legal pages, support contact, and billing/cancellation/refund policy visibility.
- Combined split release checks must cite every concrete split evidence file before they can pass; one combined prose summary or one side of the split cannot close the release check.
- Private Beta/Staging object storage pass evidence must cite both signed URL and retention/cleanup staging files: `ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json` and `ops/evidence/staging/object-storage-retention-cleanup.json`.
- Private Beta/Staging legal/support pass evidence must cite both legal-page and support-contact staging files: `ops/evidence/staging/legal-pages-external-user.json` and `ops/evidence/staging/support-contact-external-user.json`.
- Production provider mode pass evidence must cite both launch-mode and public-claims production files: `ops/evidence/production/provider-mode.json` and `ops/evidence/production/public-paid-real-generation-claims.json`.
- Production billing pass evidence must cite both checkout/subscription and refund/credit/webhook production files: `ops/evidence/production/billing-lifecycle.json` and `ops/evidence/production/billing-refund-credit-webhook.json`.
- Production backup/rollback pass evidence must cite both backup/restore and rollback/incident/post-deploy production files: `ops/evidence/production/backup-restore.json` and `ops/evidence/production/rollback-incident-post-deploy-smoke.json`.
- Production legal/support pass evidence must cite both public legal policy and support/billing policy production files: `ops/evidence/production/public-legal-policy.json` and `ops/evidence/production/public-support-billing-policy.json`.
- Production legal/support policy deployment evidence may close only the legal/support policy check and its concrete split rows; it cannot clear provider/comp-only mode, paid billing lifecycle runtime, backup/rollback/post-deploy readiness, `ci_staging_gates_not_passed`, or aggregate Production Launch readiness.
- Production public support/billing policy visibility evidence may mention billing, cancellation, refund, credit, quota reset, and `past_due` policy copy only as public-policy visibility; it cannot substitute for `ops/evidence/production/billing-lifecycle.json` or `ops/evidence/production/billing-refund-credit-webhook.json` runtime proof.
- Runtime pass evidence must be gate-specific: Local Alpha workflow smoke evidence under `ops/evidence/local_alpha/` or `ops/evidence/local/`, CI installed workflow/run evidence under `.github/workflows/` plus `ops/evidence/ci/`, staging evidence under `ops/evidence/staging/`, and production launch evidence under `ops/evidence/production/`. Source files, schemas, fixtures, README, or draft ops documents alone cannot close these runtime checks.
- Local backup/restore, load, observability, or smoke evidence under `ops/evidence/backup-restore/`, `ops/evidence/observability/`, or other non-staging/non-production paths cannot close Private Beta/Staging or Production launch gates; staging gates require `environment=staging` evidence under `ops/evidence/staging/`, and production gates require `environment=production` evidence under `ops/evidence/production/`.
- Aggregate runtime checklist items may close only after all concrete runtime subitems in that gate are closed and the matching release gate fixture has no blocked/failing checks or active Do-Not-Launch conditions. This applies to Local Alpha workflow smoke, Private Beta/Staging external-user runtime evidence, and Production Launch runtime/deployment evidence.
- A top-level gate checklist item may close only after its aggregate runtime checklist item is closed, every concrete aggregate checklist subitem is checked, the matching release fixture has no blockers, `gate_decision.status` is `go`, and the validator's checklist-to-gate alignment has no stale checked/open state; if those are all true, the gate checklist item must be updated in the same change.
- Private Beta/Staging observability runtime evidence may close only its observability-only subitem when it cites `ops/evidence/staging/20260527T1830Z-observability-runtime.json`, verifies request-id、structured logs、OpenTelemetry traces、backend/worker/crawler metrics、dashboard import、alert routes, and preserves `staging_observability_backup_load` plus `staging_observability_restore_load_missing` until backup/restore、load、post-deploy smoke evidence pass.
- Production Launch cannot clear `ci_staging_gates_not_passed` or pass backup/rollback/post-deploy evidence until both `fixtures/stage0/rev2/release_gate_evidence.ci.json` and `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json` allow checklist completion.
- Production backup/rollback/post-deploy pass evidence must cite both upstream gate fixtures and can pass only when CI and Private Beta/Staging are computed ready by the validator.
- Production check-level evidence for skill/canary, activation review, abuse hold/throttle, security launch checks, or legal/support policy deployment may close only its matching subitem when it cites exact `ops/evidence/production/` files and preserves unrelated blockers; those subitems do not clear `ci_staging_gates_not_passed`, provider/comp-only mode, paid billing lifecycle runtime, backup/rollback/post-deploy, or aggregate Production Launch readiness.
- Production admin-visible backup/rollback/incident/post-deploy probe evidence with `status=blocked_by_upstream_gates` may close only the explicit admin-visible probe checklist row; it must not close production backup/rollback launch readiness, production post-deploy launch-clearing smoke, or `production_deploy_rollback_smoke_missing`.
- The ambiguous checklist item `Production post-deploy smoke tests 通过。` must not appear checked or open; production post-deploy evidence must be split into admin-visible blocked probe evidence and launch-clearing evidence backed by exact split files plus computed-ready upstream CI/Staging gates.
- The ambiguous checklist label `Production post-deploy smoke tests 通过。` must not appear inside release-gate fixtures or runtime evidence `gate_impact.checklist_items`; split production evidence must name either the explicit admin-visible probe row or the explicit launch-clearing row.
- Blocked split runtime/deployment checks must name every exact split evidence file still required for closure; a broad `ops/evidence/staging/` or `ops/evidence/production/` placeholder cannot preserve a launch blocker.
- Blocked split runtime/deployment checks must also state whether each exact split evidence file is already present/passed or still absent/missing; stale blocker prose that describes an existing exact file as absent, or a missing exact file as present/passed, is invalid.
- Blocked split runtime/deployment checks that mention an existing split evidence file must validate that file against its owning checked checklist row: environment、release_gate_check_id、allowed status、preserved-blocker policy、and row-specific semantic tokens must all match before the blocker prose may call that split present/passed.
- Active split Do-Not-Launch condition evidence refs must obey the same exact-file present/absent rule as blocked split release checks: object-storage retention, production provider/claims, production billing, production backup/restore, production rollback/post-deploy, and upstream CI/Staging dependency blockers must name their exact files and cannot describe a missing file as present or an existing file as absent.
- Active split Do-Not-Launch condition evidence refs cannot use a generic launch-blocker sentence to preserve a gate; each active blocker must cite the validator-owned exact artifact path plus row-specific semantic terms such as provider mode/claims, checkout/subscription, refund/webhook, backup/RPO/RTO, rollback/migration/post-deploy, or CI/Staging gate dependency.
- Open split checklist rows cannot remain open after their exact validator-owned evidence file becomes passable; if the file exists, declares the right environment/check ID/status, satisfies preserved-blocker policy, and covers the row semantics, the blueprint row must be checked in the same change.
- Existing half-split evidence can only close its own concrete subitem; the combined check remains blocked until every required split file exists, declares the matching environment and release gate check ID when present, has a passing status, and covers its required runtime/deployment semantics.
- Checked split evidence checklist rows require their validator-owned exact file to exist, declare the matching gate environment, carry an allowed passing status, and cover the row's required semantics; checklist prose or a sibling split file cannot close the row.
- A combined split release-gate check cannot pass while any exact split evidence file is missing/non-passable or while any validator-owned split checklist row remains open; stale mixed states where the release fixture passes before the exact split rows close are invalid.
- A combined split release-gate check cannot remain blocked after every exact split evidence file is passable and every validator-owned split checklist row is checked, except Production backup/rollback/post-deploy, which may remain blocked only while computed CI or Private Beta/Staging gates are still not ready.
- Checked partial split rows may preserve the combined release-gate blocker only when the row is explicitly partial, such as staging signed URL evidence preserving the object retention cleanup blocker; full split rows must not preserve blockers.
- Partial check-level runtime evidence must name the exact checklist subitem it can close, must not list its own cleared release-gate check as a remaining blocker, and must preserve at least every still-open sibling release-gate check. Stale blocker-preservation lists are invalid evidence.
- Partial check-level runtime evidence `remaining_blockers` must exactly match the current blocked/failing check IDs in the matching release gate fixture after excluding the check it closes; naming an already-passed sibling check is invalid stale evidence.
- Private Beta/Staging partial runtime evidence for auth/RBAC/tenant/audit, brief/upload/confirmation, quota/rate-limit/spend-cap, support/retry/abuse, eval/QA/safety, and crawler approval/provenance may close only its matching check-level subitem; it cannot imply object storage, observability/backup/load, legal/support visibility, or aggregate Private Beta/Staging readiness.
- Production partial runtime evidence for skill/canary, activation review/audit, abuse throttle/hold, security launch checks, and legal/support policy deployment may close only its matching check-level subitem; it cannot imply provider-or-comp-only mode, paid billing lifecycle, backup/rollback/post-deploy smoke, CI/Staging dependency clearance, or aggregate Production Launch readiness.
- Local Alpha closes only when four workflow API/Playwright smokes prove brief -> 4 candidates -> select -> iterate -> package -> export ZIP against the running local stack.
- CI remains open until an installed `.github/workflows` PR/main workflow runs and records Playwright smoke plus Docker image build evidence.
- Private Beta/Staging remains open until external-user staging runtime evidence exists for object storage signed download/retention cleanup and the remaining aggregate workflow evidence.
- Production Launch remains open until CI and Private Beta/Staging gates pass and production-specific provider/comp-only, paid billing, skill/canary, activation review, abuse throttle/hold, security, backup/rollback, post-deploy smoke, and legal/support deployment evidence exists; the current legal/support policy evidence is already closed but does not clear the remaining production blockers.
- `Do-Not-Launch Conditions 全部为 false。` remains open while any release-gate evidence fixture has `is_present: true`.
- `Do-Not-Launch Conditions 全部为 false。` may close only when all four release gate fixtures have no active Do-Not-Launch conditions and Local Alpha, CI, Private Beta/Staging, and Production Launch gate checklist items are also closed in the blueprint.
- `Do-Not-Launch Conditions 全部为 false。` also requires all four release gate `gate_decision.status` values to be `go`; a global close with any fixture-level `no_go` decision is invalid.
- The validator must enforce the global Do-Not-Launch checklist item against active fixture conditions, open gate checklist items, and every release fixture `gate_decision.status`; absence of active Do-Not-Launch rows alone cannot close the global launch blocker.
- Release gate fixture IDs are closed-world: unknown check IDs or unknown Do-Not-Launch condition IDs are invalid, even when their status is blocked.
