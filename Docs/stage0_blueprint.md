# ZenArt Stage 0 Blueprint

日期：2026-05-26

## 0. 权威边界

本文件是 ZenArt Stage 0 工程落地和后续执行型 cron 的唯一权威需求源。

执行型 cron 后续只能从本文件的「18. Authoritative Execution Checklist」生成每日 todo，不得把 `Docs/stage0_draft.md`、README、issue、聊天记录或其他文档当成需求源。

本蓝图目标：纯 Web 端三端落地，结构类似 Alphane 体系：

- `web/`：用户端 React + Next.js + TypeScript。
- `admin/`：管理端 React + Next.js + TypeScript。
- `backend/`：Go + Gin/Gorm/Postgres + Docker。
- `docker-compose.yml`：本地 Web、Admin、Backend、Postgres、Redis/worker 的一键开发栈。

产品原则：

- 用户只感知 chatbox、无限画布、4 选 1、agentic 调用、打包带走。
- skill、prompt、meta prompt、crawler、feedback loop、routing、版本、评分、回放、审核全部是后台能力，不暴露给普通用户。
- 管理端必须能管理 skill，但用户端不能显示 skill 市场或 prompt 参数面板。
- Stage 0 先做可运行工程骨架和闭环，不做移动端、不做桌面端、不做原生 App。

## 1. 技术栈落地

### 1.1 Monorepo 结构

建议仓库结构：

```text
zenart/
  web/                         # 用户端 Next.js TypeScript
  admin/                       # 管理端 Next.js TypeScript
  backend/                     # Go API + worker
  scripts/                     # repo-level scripts
  Docs/
    stage0_draft.md
    stage0_blueprint.md        # 本文件，唯一权威蓝图
  docker-compose.yml
  .env.example
  README.md
```

### 1.2 用户端 Web

用户端采用 Next.js + React + TypeScript，参考 `../alphane-new-web` / `../alphane-ai-web` 的工具型 Web 前端结构：

- Next.js App Router 或 Pages Router 二选一，优先 App Router。
- TypeScript 严格模式。
- Tailwind 或现有 Alphane 风格的 utility CSS。
- `lucide-react` 做工具图标。
- Zustand 或轻量 store 管理 workspace/canvas/session 状态。
- API client 统一封装，所有后台调用走 typed client。
- Playwright 用于核心工作流截图和 UI 回归。

用户端核心页面：

- `/`：登录态后直接进入 workspace，不做营销 landing。
- `/workspace/:projectId`：chatbox + infinite canvas + package panel。
- `/billing`：套餐、额度、周重置、用量明细。
- `/exports/:packageId`：导出包预览和下载。

用户端不能出现：

- skill 列表。
- prompt 模板市场。
- crawler 数据源。
- prompt fragment 编辑器。
- meta prompt/spec 编辑器。
- 模型路由和 provider 配置。

### 1.3 管理端 Admin

管理端采用 Next.js + React + TypeScript，参考 `../alphane_ai_admin_frontend` 的 admin 结构：

- 表格、筛选、批量操作、详情抽屉、审计日志。
- 管理员 RBAC。
- skill、crawler、prompt fragment、meta prompt/spec、模型 provider、用量、反馈、审核、导出包管理。
- 管理端必须支持灰度发布和回滚 skill 版本。

管理端核心模块：

- Skill Registry。
- Skill Version Review。
- Skill Source Crawler。
- Prompt Fragment Library。
- Meta Prompt/Spec Library。
- GPT Image 2 Optimization Seeds。
- Agent Invocation Trace。
- Feedback & Rating Queue。
- Skill Evolution Proposals。
- Provider/Model Routing。
- Quota and Billing Oversight。
- Safety/Compliance Rules。
- Export Package Audit。

### 1.4 后端 Go

后端采用 Go + Gin + Gorm + Postgres，参考 `../alphane_ai_backend`：

- Go 1.23+。
- Gin HTTP API。
- Gorm + Postgres。
- Redis 用于队列、锁、速率限制和 agent task 状态缓存。
- Worker 可以先放在同一个 Go binary 内，用 cobra command 区分 `server` / `worker` / `crawler` / `migrate`。
- Dockerfile 和 docker-compose 必须支持本地启动。

后端目录建议：

```text
backend/
  cmd/
    server.go
    worker.go
    crawler.go
    migrate.go
  controllers/
  services/
    agent/
    canvas/
    skill/
    prompt/
    imagegen/
    crawler/
    feedback/
    package/
    quota/
    billing/
    safety/
  database/
    migrations/
    seed/
  models/
  middleware/
  internal/
  Dockerfile
  go.mod
```

## 2. 产品域模型

### 2.1 用户可见域

用户只需要理解：

- Project：一个工作项目。
- Workspace：一个项目里的工作台。
- Chat：用户和 agent 的交互。
- Canvas：无限画布。
- Candidate Set：每轮 4 个候选。
- Selected Direction：用户选中的方向。
- Asset：生成图、图层、frame、参考图、文字块、导出文件。
- Package：打包带走的资产包。
- Quota：本周额度和用量。

### 2.2 用户不可见域

用户不可见，但系统必须完整建模：

- Skill。
- Skill Version。
- Skill Source。
- Skill Seed。
- Skill Evaluation。
- Prompt Fragment。
- Prompt Mutation。
- Meta Prompt。
- Image Spec。
- Model Provider。
- Model Routing Rule。
- Agent Plan。
- Agent Invocation Trace。
- Safety Rule。
- Feedback Signal。
- Evolution Proposal。
- Crawler Run。
- Crawler Finding。

## 3. 数据库核心表

Postgres 需要覆盖以下最小 schema。字段名可实现时细化，但语义不能缺。

### 3.1 用户/项目/画布

- `users`
- `projects`
- `workspaces`
- `canvas_nodes`
- `canvas_edges`
- `canvas_frames`
- `canvas_versions`
- `chat_sessions`
- `chat_messages`
- `agent_tasks`
- `candidate_sets`
- `candidate_assets`
- `selected_directions`
- `asset_packages`
- `package_items`
- `exports`

### 3.2 Skill 管理

- `skills`
- `skill_versions`
- `skill_sources`
- `skill_seed_imports`
- `skill_tags`
- `skill_evaluations`
- `skill_release_channels`
- `skill_usage_stats`
- `skill_invocation_traces`

Skill 最小字段：

- `id`
- `slug`
- `name`
- `description`
- `domain`
- `visibility`：internal only。
- `status`：draft/review/active/paused/deprecated。
- `owner`
- `risk_level`
- `created_at`
- `updated_at`

Skill version 最小字段：

- `skill_id`
- `version`
- `system_prompt`
- `routing_prompt`
- `input_schema`
- `output_schema`
- `model_preferences`
- `safety_policy_refs`
- `eval_suite_id`
- `release_notes`
- `status`

### 3.3 Prompt 自迭代

- `prompt_fragments`
- `prompt_fragment_versions`
- `prompt_fragment_embeddings`
- `prompt_mutations`
- `prompt_mutation_reviews`
- `feedback_events`
- `feedback_labels`
- `prompt_performance_daily`

Prompt fragment 最小字段：

- `domain`
- `workflow`
- `skill_id`
- `fragment_type`：style/layout/safety/negative/structure/channel/qa/export。
- `text`
- `source`：seed/user_feedback/agent_trace/admin/manual/crawler。
- `score`
- `status`：candidate/active/rejected/archived。
- `created_from_trace_id`

### 3.4 Meta prompt/spec

- `meta_prompts`
- `meta_prompt_versions`
- `image_specs`
- `image_spec_versions`
- `spec_instances`
- `spec_evaluations`

需要支持 bachmeta 级冷启动：一个高层 meta prompt 生成行业/场景/角色/构图/风格/质量/负面约束的结构化 spec，再实例化成具体 workflow 的图像生成 prompt。

### 3.5 Crawler

- `crawler_sources`
- `crawler_runs`
- `crawler_documents`
- `crawler_findings`
- `crawler_skill_candidates`
- `crawler_import_reviews`

Crawler 必须保留：

- 来源 URL。
- 抓取时间。
- robots/allowlist 决策。
- 原文摘要。
- 提取出的 skill/prompt/spec。
- 去重 hash。
- 风险标签。
- 管理端审核状态。

### 3.6 Quota/Billing

- `subscription_plans`
- `user_subscriptions`
- `quota_buckets`
- `quota_transactions`
- `generation_cost_estimates`
- `provider_usage_logs`

Stage 0 默认 plan：

- `zenart_pro`
- `$20/month`
- `3500 images/week`
- 支持草稿模式、高清模式、批量模式消耗倍率。

## 4. API 面

### 4.1 用户端 API

最小 API：

- `POST /api/v1/projects`
- `GET /api/v1/projects`
- `GET /api/v1/workspaces/:id`
- `POST /api/v1/chat/sessions`
- `POST /api/v1/chat/messages`
- `POST /api/v1/agent/tasks`
- `GET /api/v1/agent/tasks/:id`
- `POST /api/v1/candidate-sets/:id/select`
- `POST /api/v1/canvas/nodes`
- `PATCH /api/v1/canvas/nodes/:id`
- `POST /api/v1/packages`
- `POST /api/v1/packages/:id/items`
- `POST /api/v1/packages/:id/export`
- `GET /api/v1/exports/:id`
- `GET /api/v1/quota/current`

### 4.2 管理端 API

最小 API：

- `GET/POST/PATCH /api/admin/skills`
- `GET/POST/PATCH /api/admin/skills/:id/versions`
- `POST /api/admin/skills/:id/release`
- `POST /api/admin/skills/:id/rollback`
- `GET /api/admin/skill-invocations`
- `GET /api/admin/prompt-fragments`
- `POST /api/admin/prompt-fragments/:id/approve`
- `POST /api/admin/prompt-fragments/:id/reject`
- `GET/POST /api/admin/meta-prompts`
- `GET/POST /api/admin/image-specs`
- `GET/POST/PATCH /api/admin/crawler-sources`
- `POST /api/admin/crawler-runs`
- `GET /api/admin/crawler-findings`
- `POST /api/admin/crawler-findings/:id/import`
- `GET /api/admin/feedback`
- `GET /api/admin/safety-rules`
- `PATCH /api/admin/safety-rules/:id`

## 5. Agentic 调用链

用户请求进入系统后：

```text
user message
  -> intent router
  -> workflow planner
  -> hidden skill selector
  -> meta prompt/spec resolver
  -> prompt fragment composer
  -> safety policy injector
  -> provider/model router
  -> image generation request
  -> candidate set builder
  -> canvas node writer
  -> user selects 1 of 4
  -> iteration planner
  -> package/export builder
  -> feedback collector
  -> prompt fragment evolution queue
```

关键要求：

- 用户永远不需要知道调用了哪个 skill。
- 每次 agent 调用必须记录 trace。
- 每个候选图必须能追溯 skill version、meta prompt version、fragment set、provider、model、seed/参数、输入摘要、安全策略。
- 失败任务不得静默吞掉，必须展示可理解状态并处理额度。

## 6. 多源生图 Skill 冷启动 Crawler

### 6.1 目标

需要一个脚本/worker 维护多源生图 skill 站点，定期抓取针对 GPT Image 2 优化的 skills/prompt/spec 作为冷启动种子。

注意：该 crawler 是内部冷启动和持续发现机制，不是公开功能。

### 6.2 数据源类型

支持多源：

- 官方文档和示例。
- 开源 prompt/skill 仓库。
- 设计工作流博客。
- 社区公开 prompt 集。
- 图片模型 benchmark 文章。
- GPT Image 2 相关教程、示例、最佳实践。
- 内部人工维护 URL allowlist。

Stage 0 必须采用 allowlist，不做全网无边界爬取。

### 6.3 Crawler 脚本

建议路径：

```text
backend/cmd/crawler.go
backend/services/crawler/
scripts/seed_image_skill_sources.ts
```

Crawler 能力：

- 读取 `crawler_sources` allowlist。
- HTTP 抓取页面和 markdown/raw 文本。
- 解析标题、正文、代码块、prompt block、schema-like block。
- 针对 GPT Image 2 相关内容做分类。
- 提取候选 skill、prompt fragment、negative constraints、image spec。
- 去重 hash。
- 风险标记：版权、仿风格、品牌、医疗、金融、成人、暴力、不可商用等。
- 写入 `crawler_findings`，默认 `pending_review`。
- 管理端审核后才进入 `skill_seed_imports` 或 `prompt_fragments`。

### 6.4 合规边界

- 不能抓取付费墙内容。
- 不能绕过 robots 或访问控制。
- 不能把第三方完整文章原文作为产品内容重发布。
- 导入时只保留结构化摘要、短片段、来源链接、内部改写结果。
- 管理端必须能删除某来源及其派生 seed。

## 7. Skill 自迭代机制

### 7.1 信号来源

Skill 使用过程中持续收集：

- 用户选择了 4 个候选中的哪一个。
- 用户拒绝了哪些候选。
- 用户继续迭代的指令。
- 用户局部修改指令。
- 用户加入 package 的资产。
- 用户导出行为。
- 用户显式评分。
- 用户反馈文本。
- QA warning 和 export failure。
- 管理员人工标注。

### 7.2 Prompt 碎片生成

从 trace 和 feedback 中抽取 prompt fragment：

- 成功的风格描述。
- 成功的布局约束。
- 成功的行业术语。
- 成功的 negative prompt。
- 失败原因。
- 用户反复要求的修正短语。
- 平台尺寸/安全区规则。
- 行业合规提醒。

所有新 fragment 默认进入 `candidate`，不能直接生效。

### 7.3 自迭代流程

```text
trace + feedback
  -> fragment extractor
  -> dedupe + cluster
  -> score by export/select/satisfaction
  -> mutation proposal
  -> offline eval
  -> admin review
  -> canary release
  -> monitor regression
  -> promote or rollback
```

### 7.4 版本治理

要求：

- Skill version 不可原地修改，必须新版本。
- Fragment version 不可原地修改，必须新版本。
- 每次发布有 release note。
- 每次回滚记录原因。
- 每个 skill 必须有 eval suite。
- 自动迭代不能绕过管理端审核。

## 8. Bachmeta 级图像冷启动 Meta Prompt/Spec

### 8.1 要求

需要建立类似 `../bachmeta` 的 meta prompt/spec 体系，用高层框架生成可实例化的图像 prompt/spec。

核心不是写单条 prompt，而是建立三层结构：

- Level 1：行业/工作流大类。
- Level 2：视觉任务、场景、用户意图、交付格式。
- Level 3：构图、主体、背景、材质、风格、光照、文字区、负面约束、QA。

### 8.2 Meta Prompt 库

最小 meta prompt：

- `image_generation_universal_spec_v1`
- `four_option_strategy_spec_v1`
- `ecommerce_product_pack_spec_v1`
- `business_document_visual_spec_v1`
- `local_merchant_pack_spec_v1`
- `game_ip_concept_spec_v1`
- `industrial_visual_communication_spec_v1`
- `space_marketing_spec_v1`
- `safety_compliance_visual_spec_v1`

### 8.3 Image Spec JSON

每个生成任务最终落成结构化 spec：

```json
{
  "intent": "ecommerce_launch_pack",
  "audience": "young skincare buyers",
  "channel": ["xiaohongshu", "tiktok_shop"],
  "candidate_strategy": "ingredient_trust",
  "subject": {},
  "composition": {},
  "style": {},
  "lighting": {},
  "color": {},
  "text_zones": {},
  "brand_constraints": {},
  "safety_constraints": {},
  "negative_constraints": [],
  "export_targets": [],
  "qa_checks": []
}
```

### 8.4 冷启动种子

Stage 0 必须手工提供一批冷启动 spec：

- 电商商品上新包。
- 电商详情页模块。
- 广告素材矩阵。
- 直播贴片包。
- 本地商家活动包。
- 菜单/价目表包。
- PPT/销售方案包。
- 工业流程图/售前包。
- 角色/IP 设定包。
- 空间风格板/招商图。

## 9. Skill 管理端

管理端必须支持但不暴露给用户：

### 9.1 Skill Registry

- 列表、搜索、标签、状态。
- 查看版本。
- 编辑 draft。
- 提交 review。
- 发布 active。
- 暂停 paused。
- 回滚 rollback。

### 9.2 Crawler Review

- 查看来源。
- 查看提取结果。
- 查看风险标签。
- 一键导入为 seed。
- 一键转为 prompt fragment。
- 拒绝并记录原因。
- block source。

### 9.3 Prompt Fragment Library

- 按 domain/workflow/skill/filter 搜索。
- 查看来源 trace。
- 查看表现分。
- 审核候选 fragment。
- 合并重复 fragment。
- 发布/回滚。

### 9.4 Meta Prompt/Spec 管理

- 编辑 meta prompt。
- 编辑 image spec schema。
- 运行实例化测试。
- 对比不同版本输出。
- 绑定 skill version。

### 9.5 Trace 和反馈

- 查看一次 agent 调用链。
- 查看 4 个候选。
- 查看用户选择。
- 查看导出包。
- 查看失败原因。
- 标注好/坏样本。

## 10. 用户端功能

Stage 0 用户端最小闭环：

1. 登录/匿名试用可先简化，但必须预留用户体系。
2. 创建 project。
3. 进入 workspace。
4. Chatbox 输入目标。
5. Agent 创建 4 个候选。
6. Canvas 展示候选组。
7. 用户选择 1 个。
8. 用户继续迭代。
9. 用户把选中资产加入 package。
10. 用户导出 ZIP/PDF/PNG。
11. 用户看到额度消耗。
12. 用户给结果反馈。

## 11. 管理端功能

Stage 0 管理端最小闭环：

1. 管理员登录。
2. 查看 skill 列表。
3. 创建/编辑 skill draft。
4. 发布 skill version。
5. 查看 crawler source。
6. 启动 crawler run。
7. 审核 crawler finding。
8. 查看 prompt fragment candidate。
9. 审核 fragment。
10. 查看 agent invocation trace。
11. 查看用户反馈。
12. 查看 quota/provider usage。

## 12. Worker 和队列

后台任务类型：

- `agent_plan`
- `image_generate`
- `candidate_build`
- `package_export`
- `crawler_fetch`
- `crawler_extract`
- `feedback_extract`
- `prompt_mutation_eval`
- `quota_reconcile`

要求：

- Redis queue 或 Postgres-backed queue 二选一，Stage 0 优先 Redis。
- 每个任务有状态：pending/running/succeeded/failed/cancelled。
- 每个任务有 retry、timeout、error message。
- 每个任务写 trace。

## 13. Docker 和本地开发

根目录必须提供：

- `docker-compose.yml`
- `.env.example`
- `web/Dockerfile`
- `admin/Dockerfile`
- `backend/Dockerfile`

本地一键启动目标：

```bash
docker compose up --build
```

服务端口建议：

- Web: `3000`
- Admin: `3001`
- Backend: `8080`
- Postgres: `5432`
- Redis: `6379`

## 14. 验证标准

Stage 0 不是文档完成，必须可运行。

最小真实验证：

- `web` 能启动并打开 workspace。
- `admin` 能启动并打开 skill registry。
- `backend` 能启动并连接 Postgres。
- migration 能创建核心表。
- Web 发起 chat message 后后端创建 agent task。
- 后端用 mock provider 或 dev provider 生成 4 个 candidate records。
- Canvas 能显示 4 个候选卡。
- 用户选择 1 个候选。
- Package 能加入资产并导出 zip。
- Admin 能看到 skill、trace、feedback。
- Crawler 能从 allowlist 抓取一个测试源并写入 pending finding。
- Prompt fragment candidate 能从一次 feedback 中生成，并等待 admin review。

注意：Stage 0 可以使用 dev image provider adapter，但不能假装接入真实 provider 已完成。文档、UI 和 admin 必须清楚标记 provider 状态。

## 15. 执行型 Cron 规范适配

后续执行 cron 必须遵守：

- 只读取本文件。
- checklist 在本文件内。
- 初始 checklist 全部 `[ ]`。
- 每次 batch 只做一个最小集群。
- 不允许 doc-only 完成。
- 不允许 fake provider、fake inference、fake success 被标记完成。
- 每次完成必须更新本 checklist。
- 每日 todo 只能由本 checklist 生成。
- 本地 `.cron/`、`.ops/`、todo snapshot、日志、测试临时文件不得提交，除非人工明确提升。

## 16. 非目标

Stage 0 不做：

- 原生 iOS/Android。
- 桌面端。
- 完整 Figma 替代。
- 完整 PPT 编辑器。
- 游戏生产级资产管线。
- CAD/BIM/工程图纸。
- 医疗/法律/金融专业建议。
- 公开 skill 市场。
- 用户可见 prompt playground。

## 17. 首批垂直 Workflow

### 17.1 电商增长包

输入：商品、目标平台、卖点、价格、人群。

输出：

- 4 个策略候选。
- 商品主图。
- 详情页模块。
- 广告多比例。
- 直播贴片。
- 社媒封面。
- ZIP 导出包。

### 17.2 商业视觉文档包

输入：业务目标、文档/大纲、受众、行业。

输出：

- 4 个叙事/视觉方向。
- 封面。
- 方案架构。
- 流程图。
- 路线图。
- PPT-ready/PDF package。

### 17.3 本地商家活动包

输入：店名、活动、商品/服务、价格、渠道。

输出：

- 4 个用途候选。
- 小红书图。
- 朋友圈图。
- 门店打印图。
- 外卖/团购封面。
- ZIP/PDF。

### 17.4 角色/IP 概念包

输入：角色一句话设定、风格、用途。

输出：

- 4 个角色方向。
- 头像。
- 半身。
- 服装/武器变体。
- 表情。
- 宣发图。
- 设定板 package。

## 18. Authoritative Execution Checklist

### 18.1 Repository bootstrap

- [ ] 创建 monorepo 目录：`web/`、`admin/`、`backend/`、`scripts/`。
- [ ] 新增根目录 `.env.example`，覆盖 Web/Admin/Backend/Postgres/Redis/image provider 配置。
- [ ] 新增根目录 `docker-compose.yml`，可启动 web、admin、backend、postgres、redis。
- [ ] 新增根目录 README，说明本蓝图是唯一权威源，并给出本地启动命令。
- [ ] 配置 git ignore，排除 `.cron/`、`.ops/`、logs、node_modules、build 输出、临时导出包。

### 18.2 Backend foundation

- [ ] 初始化 `backend/go.mod`，模块名使用 `github.com/alphane-ai/zenart/backend`。
- [ ] 实现 Go server 入口 `backend/cmd/server.go`。
- [ ] 实现 Go worker 入口 `backend/cmd/worker.go`。
- [ ] 实现 Go crawler 入口 `backend/cmd/crawler.go`。
- [ ] 实现 Postgres 连接和 healthcheck。
- [ ] 实现 Redis 连接和 healthcheck。
- [ ] 实现 migration runner。
- [ ] 新增 backend Dockerfile。
- [ ] 新增 `/healthz` 和 `/readyz` API。

### 18.3 Database schema

- [ ] 创建用户、项目、workspace、chat、agent task 基础表 migration。
- [ ] 创建 canvas node/frame/version 表 migration。
- [ ] 创建 candidate set、candidate asset、selected direction 表 migration。
- [ ] 创建 package、package item、export 表 migration。
- [ ] 创建 skill、skill version、skill source、skill usage 表 migration。
- [ ] 创建 prompt fragment、mutation、feedback 表 migration。
- [ ] 创建 meta prompt、image spec、spec instance 表 migration。
- [ ] 创建 crawler source、run、document、finding 表 migration。
- [ ] 创建 quota、subscription、provider usage 表 migration。
- [ ] 创建 seed 数据：默认 plan、默认 admin、默认 internal skills、默认 crawler allowlist。

### 18.4 User Web foundation

- [ ] 初始化 `web/` Next.js TypeScript 应用。
- [ ] 配置 `web` lint/typecheck/build 脚本。
- [ ] 实现用户端 API client。
- [ ] 实现 workspace shell：顶栏、左侧、画布、右侧。
- [ ] 实现 chatbox 输入和消息列表。
- [ ] 实现 candidate set 4 卡片展示。
- [ ] 实现 candidate select 交互。
- [ ] 实现 canvas node 基础渲染。
- [ ] 实现 package panel。
- [ ] 实现 quota meter。
- [ ] 新增 web Dockerfile。

### 18.5 Admin foundation

- [ ] 初始化 `admin/` Next.js TypeScript 应用。
- [ ] 配置 `admin` lint/typecheck/build 脚本。
- [ ] 实现 admin API client。
- [ ] 实现 admin shell 和登录占位。
- [ ] 实现 Skill Registry 列表。
- [ ] 实现 Skill Version 详情和发布/回滚按钮。
- [ ] 实现 Crawler Source/Finding 列表。
- [ ] 实现 Prompt Fragment candidate 审核列表。
- [ ] 实现 Agent Invocation Trace 详情页。
- [ ] 实现 Feedback Queue。
- [ ] 新增 admin Dockerfile。

### 18.6 Agent backend loop

- [ ] 实现 intent router service。
- [ ] 实现 workflow planner service。
- [ ] 实现 hidden skill selector。
- [ ] 实现 meta prompt/spec resolver。
- [ ] 实现 prompt fragment composer。
- [ ] 实现 safety policy injector。
- [ ] 实现 image provider adapter interface。
- [ ] 实现 dev image provider adapter，并在 UI/API 中明确标记为 dev。
- [ ] 实现 candidate set builder，每次返回 4 个候选。
- [ ] 实现 agent invocation trace 写入。
- [ ] 实现用户选择候选后的 selected direction 写入。

### 18.7 Image skill crawler

- [ ] 实现 crawler source allowlist model 和 API。
- [ ] 实现 HTTP fetcher，支持 robots/allowlist 检查。
- [ ] 实现 markdown/html/plain text 提取器。
- [ ] 实现 GPT Image 2 相关内容分类器。
- [ ] 实现 prompt block/spec block 提取器。
- [ ] 实现 hash 去重。
- [ ] 实现风险标签器。
- [ ] 写入 crawler finding，默认 pending review。
- [ ] 管理端支持 finding 导入为 skill seed。
- [ ] 管理端支持 finding 导入为 prompt fragment candidate。

### 18.8 Prompt self-evolution

- [ ] 实现 feedback event API。
- [ ] 实现用户选择/拒绝/导出/评分信号记录。
- [ ] 实现 trace-to-fragment extractor。
- [ ] 实现 fragment 去重和聚类。
- [ ] 实现 fragment score 计算。
- [ ] 实现 prompt mutation proposal。
- [ ] 实现 admin review gate，candidate 不能自动发布。
- [ ] 实现 canary release 字段和回滚记录。
- [ ] 实现 prompt performance daily 聚合任务。

### 18.9 Bachmeta-level meta prompt/spec

- [ ] 创建 `meta_prompts` seed：universal image spec。
- [ ] 创建 `meta_prompts` seed：four-option strategy spec。
- [ ] 创建 `meta_prompts` seed：ecommerce product pack spec。
- [ ] 创建 `meta_prompts` seed：business document visual spec。
- [ ] 创建 `meta_prompts` seed：local merchant pack spec。
- [ ] 创建 `meta_prompts` seed：game/IP concept spec。
- [ ] 创建 `meta_prompts` seed：industrial visual communication spec。
- [ ] 创建 `meta_prompts` seed：space marketing spec。
- [ ] 创建 image spec JSON schema validator。
- [ ] 实现 spec instance 生成和保存。

### 18.10 Packaging and export

- [ ] 实现 package create/add/remove item API。
- [ ] 实现 export job。
- [ ] 实现 ZIP 导出。
- [ ] 实现 PNG/JPG 文件归档。
- [ ] 实现 PDF 导出占位或真实导出。
- [ ] 实现 PPT-ready metadata 文件。
- [ ] 实现 Figma-ready layout spec 文件。
- [ ] 实现 export QA report。
- [ ] 用户端可下载 export。

### 18.11 Quota and billing

- [ ] 实现默认 `$20/month` plan seed。
- [ ] 实现 `3500 images/week` quota bucket。
- [ ] 实现生成前 cost estimate。
- [ ] 实现 quota transaction。
- [ ] 实现失败任务额度处理策略。
- [ ] 用户端显示本周剩余、已用、重置日期。
- [ ] 管理端显示 provider usage 和用户 quota。

### 18.12 Safety

- [ ] 实现 sensitive domain detector。
- [ ] 实现法律/金融/医疗/合规/工程安全风险标签。
- [ ] 实现敏感导出声明注入。
- [ ] 实现禁止声明词检查：医疗级、律师级、投资顾问级、版权无忧、自动合规等。
- [ ] 实现商品功效/认证/评价/前后对比风险标记。
- [ ] 管理端可查看 safety rule 列表。

### 18.13 Vertical workflows

- [ ] 实现电商增长包 workflow。
- [ ] 实现商业视觉文档包 workflow。
- [ ] 实现本地商家活动包 workflow。
- [ ] 实现角色/IP 概念包 workflow。
- [ ] 每个 workflow 都必须生成 4 个候选。
- [ ] 每个 workflow 都必须能加入 package。
- [ ] 每个 workflow 都必须写 trace 和 feedback hook。

### 18.14 Validation gates

- [ ] `docker compose up --build` 能启动所有服务。
- [ ] Backend `/healthz` 和 `/readyz` 通过。
- [ ] Migration 能在空库执行成功。
- [ ] Web workspace 页面可打开。
- [ ] Admin skill registry 页面可打开。
- [ ] Web chat message 能创建 agent task。
- [ ] Dev provider 能生成 4 个 candidate records。
- [ ] Web 能选择 candidate。
- [ ] Web 能创建 package 并导出 zip。
- [ ] Admin 能看到 skill、trace、feedback。
- [ ] Crawler 能抓取一个 allowlist 测试源并生成 pending finding。
- [ ] Feedback 能生成 prompt fragment candidate，且需 admin review。
- [ ] Web/Admin/Backend build/typecheck/test 命令全部通过。

### 18.15 Execution cron readiness

- [ ] 本文件保持唯一权威蓝图源。
- [ ] 所有 checklist 初始项保持 `[ ]`，只能由真实实现和验证关闭。
- [ ] 新增 `.ops/` 和 `.cron/` 私有 helper 时不得提交。
- [ ] 执行 cron 生成的每日 todo 不得成为需求源。
- [ ] 执行 cron 每次关闭 checklist 项时必须同步更新本文件。
- [ ] 执行 cron 不得提交 tests/spec-only/doc-only 伪完成。

