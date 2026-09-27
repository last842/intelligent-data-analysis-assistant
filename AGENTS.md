# AGENTS.md — 智能数据分析助手（ChatBI）协作规范

> 本文件是**所有 agent 读取的唯一执行规范**（ZCode 直接适用全文；Qoder/TRAE 另有自己的 rules 文件，但其内容与本文件的红线部分保持一致）。
> 人读版流程规范在飞书 wiki（口语化开发流程管理），本文件是它的 agent 执行版 + 技术红线。
> 修改本文件必须走 PR 并由项目所有者人工审。

## 1. 项目速览

| 项 | 值 |
|----|-----|
| 项目 | 智能数据分析助手（ChatBI）：自然语言 → NL2SQL → 实时图表 |
| 妙搭应用 | `app_17exfupns90`（full_stack），线上 https://cp4n1erpxd.feishuapp.com/app/app_17exfupns90 |
| 探针（自检工具） | `{online_url}/probe/` — 平台能力自测页面 |
| GitHub（事实源） | `https://github.com/last842/intelligent-data-analysis-assistant`，默认分支 `main`（受保护，禁止直推） |
| 妙搭 git（部署目标） | remote `origin`，分支 `sprint/default` —— **只能由发布 captain push** |
| Linear | team `NL2SQL`，project `P-NL2SQL-3`，状态流 Backlog→Todo→In Progress→In Review→Done |
| 技术栈 | NestJS 10（`server/`）+ React 19/Vite 8/Tailwind 4（`client/`）+ 共享协议（`shared/`）；echarts 6.1、zod 4、TanStack Query 已预装 |

## 2. 三个 agent 的分工与所有权

| Agent | 角色 | 拥有目录 | 主责 Phase |
|-------|------|----------|-----------|
| **Qoder** | 前端 UI | `client/**` | P2 前端 UI 研发 |
| **TRAE** | 测试/评测/联调 | `tests/**`、`evals/**`、`docs/**`（支援性改动走 PR） | P1 测试基建、P4 联调与评测 |
| **ZCode** | 后端 + 发布 captain | `server/**`、`shared/**`、`scripts/**` | P3 后端接口研发 + 全程部署 |

**硬规则：**
1. **每个 agent 必须使用自己独立的工作副本**（独立 clone 或独立 git worktree），禁止两个 agent 共用同一目录 —— 一个切分支会把别人的未提交工作冲掉。
2. 越界改动（如 Qoder 想改 `server/`）必须：先在 Linear 认领任务 → 独立分支 → PR → 人工审。
3. `shared/**`（API 协议定义）是三方契约：任何改动都要 PR 并在 PR 描述里 @ 受影响的其他端。
4. 一个 Linear 父任务同一时间只能有一个 agent 认领（assignee 标记），agent 只操作 assignee 是自己的 issue。

## 3. 技术红线（Phase 0 线上实测结论，违反即线上故障）

> 实测数据见 `docs/phase0/RESULTS.md`；线上探针可随时复测。

1. **禁止 `Content-Type: application/json` 的 POST 请求体** —— 妙搭边缘网关会挂起（1KB 也挂，未到服务端）或损坏（1MB→服务端 500）。所有 POST 一律用 `Content-Type: text/plain; charset=utf-8`，body 仍是 `JSON.stringify(...)` 字符串；服务端 `JSON.parse` 不依赖 Content-Type。前端统一封装 fetch 客户端，禁止散落手写。
2. **线上路由带前缀** `/app/<app_id>`：后端新增路由不要假设根路径；需要前缀无关的中间件参考 `server/main.ts` 的探针挂载写法。
3. **线上强制飞书 OAuth**：未登录一律 302。前端/接口调试必须在带登录态的浏览器里做；服务端可从 `req.userContext` 取用户身份。
4. **运行时 Node v20.20.0**（本地开发 ≥22）：禁止使用 Node 22+ 独有 API。
5. **HTML 不上 CDN**：页面 HTML 同源由 node 服务；大静态资源（图片/字体/音视频）禁止进 git 和包体，用 `lark-cli apps +file-upload` 换远端 URL。
6. **禁止在妙搭云端 AI 会话里改代码** —— 会与本地 git 冲突。云端只用于发布、资源上传、看日志。
7. **SSE 可用但注意**：GET SSE（EventSource）与 POST+SSE（text/plain）均已实测可用（60s 长连接、1MB 流、5 路并发全过）。流式接口设计优先：POST(text/plain JSON) 建流 → SSE 直出。

## 4. Git 工作流

- 分支：`<type>/<linear-id小写>-<topic>`（type: feat/fix/hotfix/chore/docs/refactor/test），基于 `main` 拉出，topic ≤5 个英文单词。
- 提交信息：`<type>(<scope>): <一句话>`，如 `feat(chat): session CRUD + SSE endpoint`。
- **`main` 禁止直推**：走 PR → 人工审 → 合并（GitHub）。
- **依赖变更独立小 PR**：动 `package.json` 必须同 PR 提交 lockfile，禁止手编 lockfile，禁止与其他功能混在一个 PR。
- 提交前跑门禁：`npm run type:check` + `npm run lint`（后端另跑相关测试）。
- 找不到对应 Linear issue 时**不得编造 ID**：先建 issue 或征询用户。
- 危险操作必须二次确认：force push、删分支、改写历史、取消 issue。

## 5. Linear 纪律

- 层级：Milestone(Phase) → 父任务(Px.y) → Step 子任务(`[Px.y · Sn]`)。**Step 子 issue 状态是唯一进度事实源**，不要在父任务描述里维护 checkbox 进度。
- 口语化流程（开始/暂停/完成/修 bug/上线）按飞书 wiki《口语化开发流程管理》执行；其核心= 动作驱动状态与分支，不只回文字。
- Step 含高危动作（db 迁移、online env-set、Base 同步、force push、删数据）时：停下等用户确认，确认前该 Step 不置 Done。
- 父任务出口门禁：全部 Step Done + typecheck/build/测试通过 → In Review；不通过不推进。

## 6. 部署（仅发布 captain = ZCode）

- 唯一入口：`bash scripts/deploy.sh`（push GitHub main → push 妙搭 sprint/default → `+release-create` → 轮询到 finished → 输出 online_url；`--linear <ID>` 可把结果评论回 Linear）。
- **Qoder/TRAE 禁止**：`git push origin`（妙搭 remote）、执行 `lark-cli apps +release-create`、在妙搭云端会话改代码。
- 发布前门禁：type:check + lint + 测试全绿；发布后冒烟：访问 `{online_url}/probe/` health 与首页。
- 观测排障：`lark-cli apps +log-list / +trace-list`（keyword 可过滤 path）。

## 7. 环境与密钥

- `.env.local` 已被 gitignore（含 SUDA_DATABASE_URL、FORCE_AUTHN_*），**禁止提交任何密钥**；Linear token 走环境变量 `LINEAR_API_KEY`；GitHub 用各自环境的 gh/凭证。
- 飞书 CLI 仅 ZCode 环境配置（`--as user`，应用是用户个人资产）；其他 agent 无需也不应配置妙搭部署权限。
