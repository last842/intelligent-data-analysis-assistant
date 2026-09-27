# 接入：把本应用的 MCP 连到外部客户端

适用于「应用已经有 MCP 工具，用户要在自己的 Agent（Claude Code / Codex / 其它 MCP 客户端）里调用它」。开发态自己验工具走 `debugging.md` 的 `mcp_inspect`，与本文无关。

**产出是一条用户复制即可执行的命令，不是操作说明。**连接地址和凭证都由你查出来填好，不要让用户自己去界面上找。

## 取连接配置

```bash
lark-cli apps +mcp-get --app-id "$app_id" --include-secret
```

`data.config` 里是完整的 `mcpServers` 对象，含连接地址与 `X-Mcp-Token`。不加 `--include-secret` 拿到的是脱敏展示（`data.redacted=true`），不能用于连接。

命令语义、风险等级与权限要求以 `lark-apps-ops` 的 `references/lark-apps-mcp.md` 与各命令 `--help` 为准，本文不复述。两条只在这里强调：

- **该命令会创建缺失的运行态凭证，风险是 `write`。**不要仅为「看看这应用开没开 MCP」而调用它。重复调用返回已有凭证，不轮换、不重置。
- 拿不到命令（沙箱 CLI 版本不带该子命令）时如实告知用户，**不要自己拼连接地址兜底**——地址形如 `https://<租户域名>.<环境后缀>/mcp/app`，两段都不可推测。

## 服务名你来起

`<名字>` 会成为客户端里的工具前缀（`mcp__<名字>__<工具名>`），用户此后每次看到这些工具都要读它。**直接给一个贴合本 MCP 用途的名字，不要问用户要。**

- 取材于这个 MCP 做什么：差旅审批叫 `travel-approval`，库存查询叫 `inventory`
- 小写字母 + 数字 + `-` 或 `_`，两三个词以内；不要空格、点号、中文
- 同一台机器内唯一。用户可能已经接过别的妙搭应用，泛指类的名字会撞上
- server 声明的 `serverName` 一眼能看出这个 MCP 做什么时，直接用它，保持开发态与客户端一致
- 给完顺带说一句名字可改，但不要停下来等用户确认

## 落到客户端

从 `data.config` 的 `mcpServers` 条目里取出连接地址与请求头，连同上面定好的名字填进下面对应模板，整条给用户。

**Claude Code**

```bash
claude mcp add --transport http <名字> <连接地址> --header "X-Mcp-Token: <凭证>"
claude mcp login <名字>
```

**Codex**

```bash
codex mcp add <名字> --url "<连接地址>?x-mcp-token=<凭证>"
codex mcp login <名字>
```

`codex mcp add` 没有传请求头的参数，凭证走 query 参数。不要用 `--bearer-token-env-var`，它会走静态 token 分支把 OAuth 跳过去。

## 为什么是两条命令

`X-Mcp-Token` 认「连的是哪个应用」，第二条命令办的是「谁在调用」——浏览器里完成一次飞书授权，客户端拿到用户令牌并自行续期。两者缺一都连不上，也互相替代不了。应用凭证不是用户身份，查出凭证不等于用户已获授权。

`login` 只服务 HTTP 传输。用户若报「only supported for streamable HTTP servers」，是配置成了本地 stdio 形态，按上面的模板改成 `url` 形式。

## 两件命令解决不了的事

凭证能提前建，但要真正调通还需要：

| 条件 | 不满足时的表现 |
|---|---|
| 应用已发布且线上 MCP 已启用 | 连接失败；创建凭证不要求发布，所以拿到凭证不代表能连 |
| 调用人在应用可用范围内 | 403，与凭证是否有效无关 |

这两条你查不到也改不了，连不上时按下表对号，属于这两类就直接告诉用户去处理，不要反复重试。

## 排错

| 现象 | 原因 | 动作 |
|---|---|---|
| 401，reason `lark_oauth_client_mismatch` | 授权用的 client_id 与服务端元数据不一致 | 清掉客户端授权缓存重新 `login` |
| 401，reason `lark_oauth_conf_unavailable` | 平台侧配置问题 | 告知用户找平台同学，不要让他反复重试 |
| 401，无 reason | 凭证复制不全，或配的是预览态凭证 | 重新 `+mcp-get --include-secret` 取一次，整段替换 |
| 403 `user is not in the visible scope of this app` | 不在可用范围，或授权账号不属于应用租户 | 前者找负责人放开范围；后者换应用租户内的账号授权 |
| 404 | 应用没启用 MCP；或零工具零资源无应用 Skill（SDK 此时也返回 404） | 后者是正常状态不是故障，先确认本应用确实注册了工具 |
| POST 被拒，CSRF 相关 | 旧模板应用对 POST 有 CSRF 双提交校验 | 平台侧已知未收口项，告知用户，不在客户端侧拼 cookie 绕 |

## 凭证纪律

- `--include-secret` 的输出只用于拼那条给用户的命令。**不写进项目任何文件、不进日志、不复述进汇报与摘要、不提交仓库。**
- 保持客户端默认的 local scope；不要建议 `--scope project`——那会把凭证写进随代码提交的配置文件。
- 用户自己贴出过凭证（聊天、issue、文档）时提醒他重置，旧值立即失效。
