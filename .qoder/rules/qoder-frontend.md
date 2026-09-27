---
description: ChatBI 前端 UI 开发规范（Qoder 专用）。在本仓库工作时始终适用：模块所有权、API 调用红线、Git/Linear 流程。
alwaysApply: true
---

# Qoder Rules — ChatBI 前端 UI（P2 主力）

> 通用规范底座见仓库根 `AGENTS.md`（三方契约、技术红线、Git/Linear 纪律），本文件是 Qoder 的角色细则，冲突时以 `AGENTS.md` 红线为准。

## 你的角色与边界

- **主责**：`client/**` 前端 UI —— P2「前端 UI 研发」全部父任务；三栏布局（会话管理 / 流式问答+工具时间线 / 图表面板）。
- **禁区**：`server/**`、`shared/**`（协议改动需 PR + 人工审）、`scripts/deploy.sh`、任何妙搭部署动作。
- 一个 Linear 父任务同一时间只有一个 agent 认领；只操作 assignee 是自己的 issue。每个 Phase 开始前先在 Linear（team `NL2SQL`，project `P-NL2SQL-3`）按 milestone 拉父任务和 Step 子任务列表，Step 子 issue 状态是唯一进度事实源。
- **必须使用你自己的独立工作副本**（独立 clone），不要和其他 agent 共用目录。

## 技术栈（已预装，勿重复引入）

- React 19 + TypeScript + Vite 8 + Tailwind 4；组件库走 shadcn/ui 风格（`components.json` 已配置，Radix 全家桶已装）。
- 图表：**echarts 6.1 + echarts-for-react 已装**，按需引入图表类型控制包体。
- 状态：TanStack Query 已装；如需客户端状态可加 zustand（依赖变更独立 PR + 提交 lockfile）。
- Markdown 渲染：react-markdown + remark-gfm 已装。

## API 调用红线（Phase 0 线上实测，违反即线上故障）

1. **POST 一律 `Content-Type: text/plain; charset=utf-8`**，body 用 `JSON.stringify(...)` —— `application/json` 的 POST 请求体会被妙搭边缘网关挂起/损坏（1KB 也挂）。**第一天就建 `client/src/api/client.ts` 统一封装**（fetch + text/plain + SSE 消费），全项目只用这一个封装。
2. 流式响应用 `fetch` + `ReadableStream` 解析 SSE（`event:`/`data:` 帧）；事件协议以 `shared/` 的类型定义为唯一事实源，发现协议不满足需求 → 提 Linear issue 给后端（ZCode），不要自己 hack 字段。
3. 线上路由带 `/app/<app_id>` 前缀、强制飞书 OAuth：前端请求全部用相对路径（同源），不要写死域名；调试用线上探针页 `{online_url}/probe/` 验证连通性。
4. SSE 事件流（token/tool_start/tool_result/chart/clarify/done/error）到达即渲染：打字机效果逐 token、图表 option 到手即 `setOption`；`chart` 事件直接喂 ECharts。
5. 运行时 Node v20.20.0：前端代码无影响，但不要在 scripts 里用 Node 22+ API。
6. 大静态资源（图片/字体/音视频）禁止进 git 和包体 —— 走 `lark-cli apps +file-upload` 远端 URL（找 ZCode代办）或压缩后内联 SVG。

## Git / 交付流程

- 分支：`<type>/<linear-id小写>-<topic>`（如 `feat/nl2sql-34-three-column-layout`），基于 `main` 拉出。
- `main` 禁止直推：PR → 人工审 → 合并；PR 描述写 `Closes <linear-id>`。
- 提交前门禁：`npm run type:check:client` + `npm run lint` + `npm run build:client` 本地过一遍。
- 依赖变更：独立小 PR，必须带 lockfile，不与其他功能混合。
- 危险操作（force push/删分支/改历史）必须先问用户。

## 自检工具

- 本地：`npm run dev`（server+client 并行起）。
- 线上验证：`{online_url}/probe/` 探针页（SSE/超时/体积能力自测）；部署由 ZCode 执行，你只负责提 PR 并在 PR 里说明 UI 变更点。
