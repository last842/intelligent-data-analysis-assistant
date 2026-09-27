# Phase 0 实测结果

- 执行人：杨羿瀚（last）+ ZCode agent 全自动执行
- 日期：2026-09-27
- 妙搭应用：app_id = `app_17exfupns90`「ChatBI 智能问数」（full_stack）
- 线上地址：https://cp4n1erpxd.feishuapp.com/app/app_17exfupns90
- 探针页面：`{online_url}/probe/`，数据存档：`RESULTS.miaoda.json`（线上完整模式 20 项）
- 本地基线：本机浏览器快速模式 13/13 全通过（SSE 首包 11ms、5 路并发最慢 1013ms），基线无任何限制，线上差异即平台限制。

## A 组 — 开发链路：全部通过 ✅

| ID | 结论 | 实测记录 |
|----|------|----------|
| A1 lark-cli 安装 | ✅ | v1.0.96（npx @larksuite/cli） |
| A2 登录 | ✅ | `config init --new`（CLI 应用 cli_aafff11563391bc6）+ 设备流授权 `--domain apps` |
| A3~A4 创建应用 | ✅ | `apps +create --app-type full_stack` → app_17exfupns90 |
| A5 拉脚手架 | ✅ | `apps +init --dir ./miaoda-app`（注意：是 `--dir` 不是 `--path`）；NestJS 10 + React 19 模板，echarts 6.1/zod 4/TanStack/react-markdown/eventsource 预装，drizzle + SUDA_DATABASE_URL 内置 |
| A6 git push | ✅ | miaoda-git.feishu.cn，branch sprint/default |
| A7 云端发布 | ✅ | 3 次发布全部 finished，单次约 78~90s；`+release-create` → 轮询 `+release-get` |
| A8 线上访问 | ✅ | online_url 可访问；**强制飞书 OAuth 登录**（未登录 302） |
| A9 zip 对照 | ➖ 未做 | git 链路全程顺畅，zip 路径无必要性（如需交付快照再补测） |
| A10 环境变量 | ✅（间接） | `.env.local` 自动拉取（+init 时 env_pulled=true），含 SUDA_DATABASE_URL/FORCE_AUTHN_* |
| A11 静态资源 | ➖ 未做 | 构建脚本证实：JS/CSS 走 CDN、HTML 强制同源（不上 CDN） |
| A12 可观测性 | ✅ | `+log-list` 可查网关日志（method/path/status/duration/trace_id），本次排障靠它定位 POST 问题 |

## B 组 — 运行时能力（线上完整模式）：18 通过 / 2 失败

| ID | 基线 | 线上实测 | 结论 |
|----|------|----------|------|
| B1 EventSource SSE | ✅ | ✅ 1244ms | **GET SSE 完全可用** |
| B2 POST 流式 | ✅ | ⚠️ 仅 1 事件 | application/json POST 流被边缘掐断；**text/plain POST 流完整**（诊断证实） |
| B3 SSE 短连接 | ✅ | ✅ 首包 281ms | |
| B4 SSE 60s 长连接 | ✅ | ✅ 存活 60s/73 事件 | **无强制断连，心跳保留** |
| B5 SSE 1MB 流式 | ✅ | ✅ 1.86s | |
| B6 体积阶梯 | ✅ | ✅ 至 4MB 全过 | **响应体积上限 ≥4MB**，图表数据可直出 |
| B7 超时阶梯 | ✅ | ✅ 至 60s 全过 | **请求超时上限 ≥60s**，慢 SQL/L多余轮次有余量 |
| B8 chunked | ✅ | ✅ | |
| B9 Header 透传 | ✅ | ✅ 171ms | 自定义鉴权头可带 |
| B10 POST JSON body | ✅ | ❌ 100KB 超时 / 1MB 损坏 | **核心限制，见下** |
| B11 5 路并发 SSE | ✅ | ✅ 最慢 1217ms | |
| B12 CORS | ✅ | ✅（同源记录） | |

### 🔴 核心发现：`Content-Type: application/json` 的 POST 请求体不可用

诊断矩阵（线上实测 + 网关日志取证）：

| 请求形态 | 结果 |
|----------|------|
| POST + application/json，1KB/8KB/32KB/64KB | **全部挂起至客户端超时，请求未到达服务端**（网关日志无记录） |
| POST + application/json，1MB | 边缘层弄坏 body 后转发，服务端 readBody 异常 → 500 |
| POST + text/plain，100KB | ✅ 200，294ms，服务端完整收到 |
| POST + 无 Content-Type（fetch 默认 text/plain），流式 SSE 响应 | ✅ 11 个 SSE 事件完整接收 |
| 7B 极小 JSON body + application/json（B9） | ✅ 通过（阈值约在 7B~1KB 之间，无工程价值） |

结论：**边缘网关对 application/json 请求体做安全检查/缓冲，导致挂起或损坏。服务端 JSON.parse 不依赖 Content-Type。**

### 对 ChatBI 架构的直接影响（原设计 → 修正后）

| 环节 | 原设计 | 修正后（实测可行） |
|------|--------|-------------------|
| Chat 流式接口 | POST application/json + SSE 响应 | **POST `Content-Type: text/plain`（body 仍是 JSON 字符串）+ SSE 响应直出**（已实测 11 事件完整） |
| 备选方案 | — | POST(text/plain) 建任务 → GET SSE 拉流（双保险） |
| 大载荷（文件/长上下文） | 直接 POST | 走 `apps +file-upload` 远端 URL 或分片；100KB text/plain 已验证可用 |
| 前端 fetch | `Content-Type: application/json` | 统一 `text/plain; charset=utf-8` 封装 |

## C 组 — 数据层：未执行（下一步）

前置条件未备齐（飞书开放平台自建应用凭证 + 测试多维表格）。`scripts/06-bitable-probe.mjs` 已就绪，C6（db-sync + SQL）命令已写入 RUNBOOK 第 7 步。

## D 组 — 架构决策（基于实测勾选）

- [x] 代码同步：**git/lark-cli**（A 组全通过，zip 仅留作快照）
- [x] 流式方案：**SSE 全链路**，但请求体必须 **text/plain 承载 JSON**；保留 GET SSE 备选（B4/B5/B11 全过，无需分段降级）
- [x] 图表数据接口：**直出**（响应上限 ≥4MB，无需分页压缩；>4MB 再采样）
- [x] 前端载体：**妙搭 full_stack 自有前端**（NestJS+React 模板即生产形态，无需独立 H5 兜底）
- [ ] 数据层：待 C 组（倾向 db-sync + SQL，待验证）
- [x] 运行时事实：Node v20.20.0；路由前缀 `/app/<app_id>`；强制 OAuth；HTML 同源不上 CDN；cwd=dist/

## 结论

**Phase 0 通过（C 组顺延）。** 平台能力远超预期：60s+ SSE 长连接、4MB 响应、5 路并发、60s+ 超时全部可用；唯一硬限制是 application/json 请求体，已有实测可行的绕行方案且不影响原架构设计。可直接进入 monorepo 脚手架阶段（apps/server 已天然融合妙搭脚手架）。
