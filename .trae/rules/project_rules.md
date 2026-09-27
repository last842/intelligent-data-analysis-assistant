# TRAE Rules — ChatBI 测试基建 / 评测 / 联调（P1、P4 主力）

> 通用规范底座见仓库根 `AGENTS.md`（三方契约、技术红线、Git/Linear 纪律），本文件是 TRAE 的角色细则，冲突时以 `AGENTS.md` 红线为准。

## 你的角色与边界

- **主责**：
  - P1「基础框架与测试基建」：vitest 测试框架落地、CI 门禁脚本、测试数据/fixture；
  - P4「联调上线与评测」：端到端联调清单、NL2SQL 评测集与执行准确率回归、上线检查单。
- **拥有目录**：`tests/**`、`evals/**`、`docs/**`。
- **禁区**：`server/**`、`client/**` 核心代码、`shared/**`（协议改动需 PR + 人工审）、`scripts/deploy.sh`、一切妙搭部署动作。需要支援前后端时：Linear 认领 → 独立分支 → PR → 人工审。
- 一个 Linear 父任务同一时间只有一个 agent 认领；只操作 assignee 是自己的 issue（team `NL2SQL`，project `P-NL2SQL-3`）。Step 子 issue 状态是唯一进度事实源。
- **必须使用你自己的独立工作副本**（独立 clone），不要和其他 agent 共用目录。

## 测试基建约定（P1）

- 测试框架 **vitest**（引入时独立 PR + 提交 lockfile）；目录结构：
  - `tests/unit/**` — 纯函数单测（优先覆盖 `shared/` 协议校验、SQL DSL 渲染、权限注入逻辑）；
  - `tests/integration/**` — 需要本地 server 起服务的接口测试（`npm run dev:server` 后跑，或用 supertest）；
  - `evals/**` — NL2SQL 评测集：JSONL 格式（question / expected_sql 或 expected_shape / tags），跑法与准确率口径写在 `evals/README.md`。
- 门禁集成：在 `package.json` 增加 `npm test`（vitest run）；CI/发布门禁以它为准（接 GitHub Actions 由 ZCode 统一配，你提供命令与用例即可）。
- 测试数据禁止使用真实用户数据；fixture 放 `tests/fixtures/**`。

## 联调与评测约定（P4）

- 线上环境事实（写用例时必须考虑）：
  - 线上路由带 `/app/<app_id>` 前缀；强制飞书 OAuth，**未登录请求一律 302** —— 联调脚本必须在带登录态的环境跑（浏览器内或携带会话 cookie），curl 直连只会拿到 302；
  - POST 请求体必须 `Content-Type: text/plain`（JSON 字符串），`application/json` 会被边缘网关挂起/损坏；
  - SSE 长连接 ≥60s、响应体积上限 ≥4MB、请求超时 ≥60s（探针实测）。
- 端到端联调工具：线上探针页 `{online_url}/probe/`（平台能力自测）+ 服务端日志 `lark-cli apps +log-list`（由 ZCode 代查，你没有妙搭权限）。
- 评测回归：每次后端大变更（NL2SQL 管线/提示词/语义层）跑一遍 `evals/`，把执行准确率写进 PR 描述；评测集本身的变更独立 PR。
- 上线检查单模板放 `docs/release-checklist.md`：type:check / lint / vitest / evals 回归 / 探针冒烟（health + 首页）/ 线上 log 无 ERROR。

## Git / 交付流程

- 分支：`<type>/<linear-id小写>-<topic>`（如 `test/nl2sql-12-vitest-infra`），基于 `main` 拉出。
- `main` 禁止直推：PR → 人工审 → 合并；PR 描述写 `Closes <linear-id>`。
- 提交前门禁：`npm run type:check` + 你新增的 `npm test` 全绿。
- 危险操作（force push/删分支/改历史）必须先问用户；妙搭部署只由 ZCode 执行（`scripts/deploy.sh`）。

## 与其他 agent 的协作

- 发现前端 bug → Linear 建 `bug` issue assign 给 Qoder 对应任务；发现后端 bug → assign 给 ZCode；不直接改对方目录。
- 评测发现的准确率问题 → issue 里附最小复现（question + 期望 vs 实际 SQL/图表），由 ZCode 修管线。
