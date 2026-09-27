#!/usr/bin/env bash
# scripts/deploy.sh — ChatBI 发布脚本（唯一发布入口，仅发布 captain = ZCode 执行）
#
# 流程：本地 main 校验 → push GitHub main → push 妙搭 sprint/default → +release-create
#       → 轮询 +release-get 到 finished → 输出 online_url →（可选）评论回 Linear issue
#
# 用法：
#   bash scripts/deploy.sh                       # 交互确认后发布 main
#   bash scripts/deploy.sh --yes                 # 免确认（agent 场景）
#   bash scripts/deploy.sh --ref feat/xxx        # 直接试部署某分支（不动 GitHub main）
#   bash scripts/deploy.sh --linear NL2SQL-45 --yes   # 发布并把结果评论回 Linear issue
#   bash scripts/deploy.sh --skip-github         # 跳过 GitHub 推送（GitHub 未配好时）
#
# 前置：本机已 lark-cli 登录（auth login --domain apps）；GITHUB remote 已配置且凭证可用；
#       LINEAR_API_KEY 环境变量（仅 --linear 需要）。
set -euo pipefail

YES=0; REF="main"; LINEAR_ID=""; SKIP_GITHUB=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=1; shift;;
    --ref) REF="${2:?缺少分支名}"; shift 2;;
    --linear) LINEAR_ID="${2:?缺少 Linear issue ID}"; shift 2;;
    --skip-github) SKIP_GITHUB=1; shift;;
    -h|--help) grep '^#' "$0" | head -20; exit 0;;
    *) echo "未知参数: $1"; exit 1;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "❌ [deploy] $1" >&2; exit 1; }
step() { echo -e "\n🚀 [deploy] $1"; }

command -v lark-cli >/dev/null || fail "lark-cli 未安装"
git remote get-url origin >/dev/null 2>&1 || fail "缺少 origin（妙搭 git）remote"
if [ "$SKIP_GITHUB" -eq 0 ]; then
  git remote get-url github >/dev/null 2>&1 || fail "缺少 github remote（git remote add github https://github.com/last842/intelligent-data-analysis-assistant.git），或加 --skip-github"
fi

# ---- APP_ID：env > .env.local > 默认值 ----
APP_ID="${MIAODA_APP_ID:-}"
if [ -z "$APP_ID" ] && [ -f .env.local ]; then
  APP_ID=$(grep -oE '^(MIAODA_APP_ID|app_id)=app_[A-Za-z0-9_-]+' .env.local | head -1 | cut -d= -f2)
fi
APP_ID="${APP_ID:-app_17exfupns90}"
[[ "$APP_ID" == app_* ]] || fail "APP_ID 非法（应 app_ 开头）：$APP_ID"

# ---- 工作区状态提示（推送的是 ref，未提交改动不会随本次发布上线）----
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  [deploy] 工作区有未提交改动（不影响本次发布内容，但请确认不是要发的东西）"
fi

# ---- main 一致性校验（只对 main 生效）----
if [ "$REF" = "main" ] && [ "$SKIP_GITHUB" -eq 0 ]; then
  git fetch github main --quiet
  LOCAL=$(git rev-parse main 2>/dev/null || echo "none")
  GHR=$(git rev-parse github/main)
  [ "$LOCAL" = "none" ] && fail "本地没有 main 分支"
  if [ "$LOCAL" != "$GHR" ]; then
    if git merge-base --is-ancestor "$LOCAL" "$GHR"; then
      git checkout main --quiet 2>/dev/null || true
      git branch -f main "$GHR" 2>/dev/null || git pull --ff-only github main --quiet
      echo "📥 [deploy] 本地 main 落后，已快进到 github/main"
    else
      fail "本地 main 与 github/main 分叉，请先在 GitHub 上完成合并/同步后再发布"
    fi
  fi
fi

COMMIT=$(git rev-parse --short "$REF")
COMMIT_MSG=$(git log -1 --format=%s "$REF")

# ---- 确认 ----
if [ "$YES" -ne 1 ]; then
  echo "────────────────────────────────────────────"
  echo " 发布对象: $REF ($COMMIT) — $COMMIT_MSG"
  echo " 目标: 妙搭 app=$APP_ID (sprint/default)  GitHub main: $([ "$SKIP_GITHUB" -eq 0 ] && [ "$REF" = "main" ] && echo 是 || echo 跳过)"
  echo " Linear 回写: ${LINEAR_ID:-无}"
  echo "────────────────────────────────────────────"
  read -r -p "确认发布? [y/N] " A; [[ "$A" == "y" || "$A" == "Y" ]] || fail "已取消"
fi

# ---- 推送 ----
step "推送 GitHub（main）"
if [ "$SKIP_GITHUB" -eq 0 ] && [ "$REF" = "main" ]; then
  git push github "$REF:main"
else
  echo "  [skip] --skip-github 或非 main ref"
fi

step "推送妙搭 git（$REF → sprint/default）"
git push origin "$REF:sprint/default"

# ---- 发布 ----
step "创建发布（release-create）"
REL_OUT=$(lark-cli apps +release-create --app-id "$APP_ID" --as user --json)
REL_ID=$(echo "$REL_OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["data"]["release_id"])' 2>/dev/null) \
  || fail "未能解析 release_id：$REL_OUT"
echo "  release_id = $REL_ID"

step "轮询发布状态（最长 10 分钟）"
STATUS="publishing"; ONLINE_URL=""; ERRLOGS=""
for i in $(seq 1 40); do
  sleep 15
  OUT=$(lark-cli apps +release-get --app-id "$APP_ID" --release-id "$REL_ID" --as user --json) || true
  STATUS=$(echo "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"].get("status","unknown"))' 2>/dev/null || echo unknown)
  echo "  [poll $i] $STATUS"
  if [ "$STATUS" = "finished" ]; then
    ONLINE_URL=$(echo "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"].get("online_url",""))' 2>/dev/null || true)
    break
  fi
  if echo "$STATUS" | grep -qE 'failed|error'; then
    ERRLOGS=$(echo "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"].get("error_logs",[]))' 2>/dev/null || true)
    echo "❌ 发布失败，error_logs：$ERRLOGS"
    exit 1
  fi
done
[ "$STATUS" = "finished" ] || fail "10 分钟未完成，手动查: lark-cli apps +release-get --app-id $APP_ID --release-id $REL_ID"

ONLINE_URL="${ONLINE_URL:-https://cp4n1erpxd.feishuapp.com/app/$APP_ID}"

# ---- 汇报 ----
echo ""
echo "✅ 发布完成"
echo "   提交:   $COMMIT — $COMMIT_MSG"
echo "   线上:   $ONLINE_URL"
echo "   探针:   $ONLINE_URL/probe/"
echo "   release: $REL_ID"
echo "   👉 冒烟: 浏览器打开探针页点 health，或检查首页渲染"

# ---- Linear 回写（可选）----
if [ -n "$LINEAR_ID" ]; then
  step "评论回 Linear（$LINEAR_ID）"
  if [ -z "${LINEAR_API_KEY:-}" ]; then
    echo "  ⚠️ 未设置 LINEAR_API_KEY，跳过 Linear 回写"
  else
    python3 - "$LINEAR_ID" "$COMMIT" "$COMMIT_MSG" "$ONLINE_URL" "$REL_ID" <<'PYEOF'
import json, os, sys, urllib.request
key, ident, commit, msg, url, rel = sys.argv[1:7]
def gql(query, variables):
    req = urllib.request.Request("https://api.linear.app/graphql",
        data=json.dumps({"query": query, "variables": variables}).encode(),
        headers={"Content-Type": "application/json", "Authorization": key})
    return json.load(urllib.request.urlopen(req, timeout=30))
q = gql('query($id:String!){issues(filter:{identifier:{eq:$id}}){nodes{id identifier title}}}', {"id": ident})
nodes = q.get("data", {}).get("issues", {}).get("nodes", [])
if not nodes:
    print(f"  ⚠️ 未找到 {ident}，跳过"); sys.exit(0)
issue = nodes[0]
body = f"🚀 已部署\n- commit: `{commit}` — {msg}\n- 线上: {url}\n- release: {rel}\n- 探针: {url}/probe/"
gql('mutation($i:String!,$b:String!){commentCreate(input:{issueId:$i,body:$b}){success}}',
    {"i": issue["id"], "b": body})
print(f"  ✅ 已评论 {issue['identifier']} — {issue['title']}")
PYEOF
  fi
fi
