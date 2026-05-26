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

- [ ] 创建 Alphane-style 纯 Web 三端 monorepo 目录：`web/` 用户端、`admin/` 管理端、`backend/` Go API/worker/crawler/migrate、`scripts/`。
- [x] 新增根目录 `.env.example`，覆盖 web、admin、backend、Postgres、Redis、object storage、auth、session、provider、billing、observability、crawler、analytics。
- [x] 新增根目录 `docker-compose.yml`，可启动 web、admin、backend server、worker、crawler、Postgres、Redis、local object storage。
- [ ] 新增 README，说明 Rev2 是唯一权威源，并给出本地启动命令。
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
- [ ] 实现 auth/session flow。
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
- [ ] 对项目、工作区、聊天、画布、资产、package、export、quota、feedback、support ticket、trace 强制 tenant isolation。
- [ ] 对 skill release、crawler import、prompt approval、provider routing、quota override、safety rule、export override 强制 admin RBAC。
- [x] 实现 immutable audit log。
- [x] 添加 cross-tenant denial tests。
- [x] 添加 non-admin `/api/admin/*` denial tests。

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
- [ ] 实现 provider usage reconciliation。
- [x] 实现 daily spend cap。
- [x] 实现 emergency kill switch。
- [ ] 添加 quota transaction/concurrency tests。

### 25.9 Object Storage and Export

- [x] 实现 object storage abstraction。
- [x] 实现 local object storage adapter。
- [ ] 实现 S3-compatible config。
- [ ] 实现 object metadata。
- [ ] 实现 thumbnail generation。
- [x] 实现 signed URL。
- [x] 实现 cross-tenant object denial。
- [x] 实现 package manifest schema。
- [x] 实现 deterministic file naming。
- [x] 实现 ZIP export。
- [x] 实现 PDF placeholder 或真实 PDF export。
- [ ] 实现 PPT-ready metadata。
- [ ] 实现 Figma-ready layout spec。
- [x] 实现 export retry/regenerate。
- [ ] 实现 cleanup expired exports/orphaned objects。
- [ ] 添加 upload/download/export integration tests。

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
- [ ] 添加 trace completeness tests。
- [x] 添加 provider contract tests。

### 25.11 Eval, QA, Safety

- [x] 定义 eval suite schema。
- [x] 创建四条 workflow golden fixtures。
- [x] 创建 ambiguous/unsafe/negative fixtures。
- [x] 创建 brand/product preservation fixtures。
- [x] 创建 text-heavy fixtures。
- [x] 创建 export completeness fixtures。
- [ ] 实现 eval runner。
- [ ] 存储 eval results。
- [ ] skill canary 前要求 eval pass。
- [ ] prompt fragment active 前要求 eval pass。
- [x] 定义 QA result schema。
- [ ] 实现 file integrity/dimensions/aspect/safe-area QA。
- [ ] 实现 blank/duplicate/four-option distinctness QA。
- [ ] 实现 text readability 或 manual-review placeholder。
- [ ] 实现 structured text QA。
- [ ] 实现 product/logo preservation QA。
- [ ] 实现 forbidden claims QA。
- [ ] 实现 export completeness QA。
- [x] 实现 safety rule schema。
- [ ] 在 brief/provider request/provider response/QA/export 运行 safety policy。
- [x] 实现 red-team fixtures。

### 25.12 Workflow Acceptance

- [x] 定义 vertical acceptance schema。
- [ ] 实现电商增长包 fixture/API test/Playwright test。
- [ ] 实现商业视觉文档包 fixture/API test/Playwright test。
- [ ] 实现本地商家活动包 fixture/API test/Playwright test。
- [ ] 实现角色/IP 概念包 fixture/API test/Playwright test。
- [x] 每条 workflow 定义 required inputs。
- [x] 每条 workflow 定义 clarification questions。
- [x] 每条 workflow 定义 4-option taxonomy。
- [x] 每条 workflow 定义 required package outputs。
- [x] 每条 workflow 定义 QA/safety/export pass thresholds。

### 25.13 Crawler Governance

- [ ] 实现 crawler source approval。
- [x] 实现 source legal metadata。
- [ ] 实现 robots evidence。
- [ ] 实现 SSRF protections。
- [ ] 实现 source/global rate limits。
- [ ] 实现 raw content retention limit。
- [ ] 实现 exact-text import warning。
- [ ] 实现 provenance links。
- [ ] 实现 source blocklist。
- [ ] 实现 takedown/derivative review workflow。
- [x] 添加 disallowed source、robots denied、duplicate hash、pending-review import tests。

### 25.14 Skill, Review, Feedback, Abuse

- [ ] 实现 skill release states。
- [ ] 实现 skill traffic allocation。
- [ ] 实现 canary metrics aggregation。
- [ ] 实现 canary stop thresholds。
- [ ] 实现 rollback with audit。
- [x] 实现 review queue model。
- [x] 实现 review detail with diff/provenance/eval/QA/risk。
- [x] 要求 reviewer rationale。
- [x] high-risk changes 要求 second review。
- [x] 实现 feedback taxonomy。
- [x] 实现 feedback attribution。
- [ ] 实现 feedback filtering/weighting。
- [ ] 实现 delayed feedback。
- [ ] bad samples 转 regression fixtures。
- [x] 实现 abuse event model。
- [ ] 实现 temporary hold/throttle hooks。
- [ ] 实现 admin abuse queue。

### 25.15 Support and Operations

- [x] 实现 report problem。
- [x] 实现 support ticket model。
- [ ] support ticket 关联 user/project/task/trace/asset/export/quota。
- [ ] 实现 admin user lookup。
- [ ] 实现 failed task retry/cancel。
- [x] 实现 export regenerate。
- [ ] 实现 queue/dead-letter dashboard。
- [x] 实现 incident log model。
- [x] 实现 maintenance banner。

### 25.16 Security, Privacy, Legal

- [ ] 实现 secure cookies。
- [ ] 配置 CORS。
- [ ] 配置 CSRF 或 same-site strategy。
- [ ] 配置 security headers。
- [ ] 实现 upload validation。
- [ ] 实现 malware-scan placeholder/interface。
- [ ] 实现 secret classification。
- [ ] 实现 startup config validation。
- [ ] 实现 secret redaction。
- [ ] 添加 dependency/image/secret scans。
- [x] 添加 Privacy notice。
- [ ] 添加 Terms of Service。
- [ ] 添加 Privacy Policy。
- [ ] 添加 Acceptable Use Policy。
- [x] 添加 AI/content disclaimer。
- [ ] 添加 IP complaint flow。
- [ ] paid launch 添加 billing/cancellation/refund policy。
- [ ] 添加 visible support contact。

### 25.17 CI/CD and Environments

- [ ] 添加 PR/main CI 到 `.github/workflows`。（token-blocked：当前 token 缺 workflow scope；draft/evidence 已落在 `ops/ci/` 和 `fixtures/ops/`。）
- [x] 添加 PR/main CI draft/evidence 到 `ops/ci/` 和 `fixtures/ops/`。
- [x] CI 运行 Web/Admin lint/typecheck/unit/build。
- [x] CI 运行 backend fmt/lint/vet/unit/integration/build。
- [x] CI 启动 Postgres/Redis/object storage。
- [x] CI 运行 migration tests。
- [x] CI 运行 OpenAPI/client stale checks。
- [x] CI 运行 API/agent contract tests。
- [ ] CI 运行 Playwright smoke。
- [ ] CI build Docker images。
- [x] CI 运行 security scans。
- [x] 定义 local/CI/staging/production。
- [x] Docker images 使用 git SHA tag。
- [ ] 实现 staging deploy。
- [ ] 实现 staging smoke tests。
- [x] 定义 production approval/release tag。
- [x] 定义 feature flags。
- [x] 定义 rollback procedures。
- [ ] 实现 worker drain。
- [x] 实现 task schema compatibility checks。

### 25.18 Observability, Backup, Incident, Load

- [ ] 实现 request id propagation。
- [ ] 实现 structured JSON logs。
- [ ] 实现 OpenTelemetry traces。
- [ ] 实现 backend/worker/crawler metrics。
- [ ] 实现 frontend error reporting。
- [ ] 实现 dashboards。
- [ ] 实现 alerts。
- [x] 定义 SLOs。
- [x] 定义 incident severity/escalation/template/postmortem。
- [x] 编写 runbooks。
- [x] 定义 backup schedule。
- [x] 定义 object storage backup/versioning。
- [x] 定义 RPO/RTO。
- [ ] 执行 Postgres restore drill。
- [ ] 执行 object restore drill。
- [x] 定义 load assumptions。
- [x] 添加 chat/task load test。
- [ ] 添加 worker generation load test。
- [ ] 添加 ZIP export load test。
- [ ] 添加 signed download load test。
- [ ] 添加 crawler throttle load test。
- [ ] 添加 quota contention test。
- [ ] 添加 workspace rendering performance test。

### 25.19 Product Analytics

- [ ] 定义 analytics event taxonomy。
- [ ] 实现 server-side core workflow event capture。
- [ ] 实现 client-side onboarding/UI funnel capture。
- [ ] 实现 admin report：first prompt to four candidates。
- [ ] 实现 admin report：selection rate。
- [ ] 实现 admin report：iteration rate。
- [ ] 实现 admin report：package add/export completion。
- [ ] 实现 admin report：weekly return。
- [ ] 实现 admin report：QA warning/block。
- [ ] 实现 admin report：cost per successful package。
- [ ] 实现 admin report：support ticket/failure rate。

### 25.20 Release Gate Execution

- [ ] Local Alpha Gate 全部通过。
- [ ] CI Gate 全部通过。
- [ ] Private Beta/Staging Gate 全部通过。
- [ ] Production Launch Gate 全部通过。
- [ ] Do-Not-Launch Conditions 全部为 false。
- [ ] Release notes 包含 SHA、migration list、config diff、feature flags、owner、smoke plan、rollback plan、known risks、go/no-go。
- [ ] Post-deploy smoke tests 通过。
