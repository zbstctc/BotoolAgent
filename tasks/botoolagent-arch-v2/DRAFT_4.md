# Draft 4: GAP-1 确定性门控 + GAP-2 Hooks 沙箱

> Stage 0 头脑风暴产出 | 日期: 2026-02-26
> 前置: DRAFT_combined_v3.md (v2 全链路架构)

## 定位

将 BotoolAgent 的质量检查从"LLM 自我报告"升级为"Shell 脚本独立验证"，同时通过 Claude Code Hooks 拦截危险命令，零用户门槛。

**两个 GAP**:
- **GAP-1 确定性门控** — DT 级 Shell 脚本独立验证，不信任 LLM 的 `passes: true` 自我报告
- **GAP-2 Hooks 沙箱** — `preToolUse` hook 拦截危险命令，弥补 `--dangerously-skip-permissions` 的安全缺口

---

## 1. 背景与动机

### 1.1 GAP-1: 验证铁律是纸老虎

当前 Lead Agent 的验证铁律（CLAUDE.lead.md §验证铁律）是"软性约束"：

| # | 问题 | 根因 | 影响 |
|---|------|------|------|
| 1 | **LLM 可跳过验证** | 铁律写在 prompt 中，LLM 可以忽略 | passes: true 无任何独立校验 |
| 2 | **Context 爆炸后遗忘** | compact/context limit 后 Lead 丢失铁律 | 后续 DT 无验证直接标记通过 |
| 3 | **Ralph 盲信** | `grep '"passes": true'` 计数 | LLM 写 passes: true 即为通过，零独立验证 |
| 4 | **Teammate 自报告** | Teammate 报告"全部通过"但实际未运行 | Lead 有时直接采信不复验 |

**核心问题**: 整个验证链条建立在"信任 LLM 会按指令执行"之上，无任何确定性保障。

### 1.2 GAP-2: --dangerously-skip-permissions 裸奔

BotoolAgent.sh 启动 Claude CLI 时使用 `--dangerously-skip-permissions`：

```bash
# BotoolAgent.sh L420
tmux new-session -d -s "$SESSION_NAME" -c "$WORK_DIR" \
  "env -u CLAUDECODE $TMUX_ENV $CLAUDE_CMD --session-id $CLAUDE_SESSION_ID \
   --dangerously-skip-permissions --model $BOTOOL_MODEL ..."
```

这意味着 Lead Agent 和 Teammate 可以执行**任何** Shell 命令，包括：
- `rm -rf /` — 删除系统文件
- `npx prisma db push --force-reset` — 删除数据库所有数据
- `git push --force origin main` — 覆盖主分支历史
- `curl ... | bash` — 执行远程脚本

Claude Code 的 Hooks 机制（`.claude/settings.json` 中的 `preToolUse`）可以在工具执行前拦截，即使在 skip-permissions 模式下也生效。

---

## 2. 架构决策记录 (ADR)

### ADR-G1: gateCheck 字段 + gate-check.sh 独立验证

```
决策: 在 dev.json DT 中新增 gateCheck: boolean 字段
      gateCheck=true 的 DT 必须由 gate-check.sh 独立验证
      gateCheck=false 的 DT 保持现有 LLM 验证流程
机制: Lead Agent 调用 bash scripts/gate-check.sh <project-dir> <DT-ID>
      gate-check.sh 读 blocking evals → 逐条执行 → 写结果到 .state/gate-results/
      Exit 0=全通过, Exit 1=有失败
```

**理由**:
- 确定性：Shell 脚本的 exit code 不会撒谎
- 增量采纳：gateCheck=false 的 DT 不受影响，渐进式迁移
- 可审计：gate-results JSON 记录每条 eval 的 exit code + 输出

### ADR-G2: Ralph 安全网（session 后扫描）

```
决策: Ralph 循环每个 session 结束后扫描 dev.json
      找到 gateCheck=true + passes=true 但无 gate-results 的 DT → 撤销 passes
机制: BotoolAgent.sh session 结束后追加扫描逻辑
```

**理由**:
- 兜底层：即使 Lead Agent 绕过 gate-check.sh 直接写 passes:true，Ralph 也能发现
- 不信任链：Ralph（Shell 脚本）→ 不信任 → Lead Agent（LLM）

### ADR-G3: Hooks 沙箱（黑名单模式）

```
决策: 使用 Claude Code preToolUse hook 拦截危险命令
      sandbox-guard.sh 检查 Bash 命令是否匹配危险模式黑名单
      匹配 → exit 2 阻止执行 + 输出原因
      不匹配 → exit 0 放行
模式: 黑名单（拒绝已知危险，默认放行）
替代方案: 白名单 — 被否决（BotoolAgent 需要执行任意构建/测试命令，白名单不可行）
```

**理由**:
- 零用户门槛：用户无需手动配置权限
- 最小侵入：黑名单模式不阻塞正常开发命令
- 安全底线：即使 skip-permissions，也能拦截最危险的操作

---

## 3. GAP-1 详细设计: 确定性门控

### 3.1 dev.json 新增字段

在 DRAFT_combined_v3.md §4A.1 dev.json Schema 的 DT 对象中新增：

```json
{
  "id": "DT-001",
  "title": "...",
  "gateCheck": true,
  "passes": false,
  "evals": [
    {
      "type": "code-based",
      "blocking": true,
      "command": "npx tsc --noEmit",
      "expect": "exit-0"
    },
    {
      "type": "code-based",
      "blocking": true,
      "command": "grep -q 'export function createUser' src/lib/user.ts",
      "expect": "exit-0"
    },
    {
      "type": "code-based",
      "blocking": false,
      "command": "npm run lint",
      "expect": "exit-0"
    }
  ]
}
```

**字段语义**:

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `gateCheck` | boolean | `false` | 是否需要 gate-check.sh 独立验证 |
| `evals[].blocking` | boolean | `true` | gate-check.sh 只执行 blocking=true 的 eval |

**gateCheck 设置规则**（PRD2JSON 生成时决定）:

| DT 类型 | gateCheck | 理由 |
|---------|-----------|------|
| 涉及数据库 schema 变更 | `true` | SQL 正确性需确定性验证 |
| 涉及 API 端点 | `true` | 端点可达性可确定性验证 |
| 有 typecheck eval | `true` | typecheck 结果是确定性的 |
| 纯文档/配置修改 | `false` | 无确定性 eval 可执行 |
| 有 e2e test eval | `true` | e2e 测试结果是确定性的 |

**实际上大多数 DT 都应该是 gateCheck=true**，因为几乎所有 DT 至少有 typecheck eval。gateCheck=false 主要用于纯 Markdown/配置修改等无法自动验证的 DT。

### 3.2 gate-check.sh 设计

```bash
#!/bin/bash
# gate-check.sh — DT 确定性门控验证
# 用法: bash scripts/gate-check.sh <project-dir> <DT-ID>
# Exit: 0=全通过, 1=有失败, 2=参数错误

PROJECT_DIR="$1"
DT_ID="$2"

# 1. 定位 dev.json（回退到 prd.json 向后兼容）
DEV_JSON="$PROJECT_DIR/dev.json"
if [ ! -f "$DEV_JSON" ]; then
  DEV_JSON="$PROJECT_DIR/prd.json"
fi
[ -f "$DEV_JSON" ] || { echo "ERROR: No dev.json or prd.json found"; exit 2; }

# 2. 提取该 DT 的 blocking evals
#    使用 jq 从 devTasks[] 中找到匹配 DT-ID 的任务
#    过滤 blocking=true 的 evals

# 3. 逐条执行 eval command
#    记录: exit code + 输出前 200 行 + 耗时

# 4. 写结果到 .state/gate-results/{DT-ID}.json
#    格式:
#    {
#      "dtId": "DT-001",
#      "timestamp": "2026-02-26T12:00:00Z",
#      "results": [
#        {
#          "command": "npx tsc --noEmit",
#          "exitCode": 0,
#          "durationMs": 3200,
#          "outputHead": "...(前 200 行)"
#        }
#      ],
#      "allPassed": true
#    }

# 5. Exit 0 (全通过) 或 1 (有失败)
```

**关键设计点**:

1. **jq 依赖**: gate-check.sh 使用 jq 解析 JSON。如果系统无 jq，回退到 grep/sed 模式（功能降级但可用）
2. **输出截断**: 每条 eval 输出限前 200 行，防止日志爆炸
3. **超时控制**: 每条 eval 默认 120 秒超时（可通过 eval 字段扩展）
4. **工作目录**: eval command 在 `$PROJECT_DIR` 下执行（cd 到项目目录）

### 3.3 CLAUDE.lead.md 集成

在验证铁律章节追加 gate-check 调用逻辑：

```markdown
## 验证铁律（增强版）

任何 DT 在标记 passes: true 之前，Lead Agent 必须：

1. 运行该任务的所有 evals（不仅仅是 typecheck）
2. 读取完整输出并确认退出码为 0

**3. 如果该 DT 的 gateCheck=true（确定性门控）：**
   a. 调用: `bash $BOTOOL_SCRIPT_DIR/scripts/gate-check.sh $BOTOOL_PROJECT_DIR {DT-ID}`
   b. 读取 exit code:
      - Exit 0 → 门控通过，可以继续写 passes: true
      - Exit 1 → 门控失败，**禁止写 passes: true**，读取 gate-results 诊断失败原因
      - Exit 2 → 配置错误，停止并报告
   c. gate-check.sh 的结果文件写在 `.state/gate-results/{DT-ID}.json`
   d. gate-check.sh 的输出优先级高于 Lead Agent 自己运行 evals 的判断
      （即使 Lead 认为"应该通过"，gate-check.sh 说失败就是失败）

**4. 如果该 DT 的 gateCheck=false：**
   保持现有流程（Lead Agent 自行运行 evals 并判断）
```

### 3.4 Ralph 安全网

BotoolAgent.sh 在每个 session 结束后（`start_session` 返回后、下一轮开始前）增加扫描逻辑：

```bash
# Session 结束后安全网检查
safety_net_check() {
  local dev_json="$DEV_JSON"  # 或回退到 prd.json
  [ -f "$dev_json" ] || return

  # 需要 jq
  command -v jq &>/dev/null || return

  # 扫描: gateCheck=true + passes=true 但无 gate-results 的 DT
  local gated_passed_ids
  gated_passed_ids=$(jq -r '.devTasks[] |
    select(.gateCheck == true and .passes == true) | .id' "$dev_json" 2>/dev/null)

  for dt_id in $gated_passed_ids; do
    local result_file="$SCRIPT_DIR/.state/gate-results/${dt_id}.json"
    if [ ! -f "$result_file" ]; then
      echo ">>> [SAFETY NET] $dt_id: gateCheck=true + passes=true 但无 gate-results!"
      echo ">>>   撤销 passes → false"
      # 使用 jq 将该 DT 的 passes 改回 false
      # (具体 jq in-place 编辑命令)
    else
      # 有 gate-results，检查 allPassed
      local all_passed
      all_passed=$(jq -r '.allPassed' "$result_file" 2>/dev/null)
      if [ "$all_passed" != "true" ]; then
        echo ">>> [SAFETY NET] $dt_id: gate-results 显示失败但 passes=true!"
        echo ">>>   撤销 passes → false"
      fi
    fi
  done
}
```

**调用位置**: `start_session` 函数返回后、`check_all_tasks_complete` 之前。

### 3.5 gate-results 目录结构

```
.state/
├── agent-status
├── agent-pid
└── gate-results/
    ├── DT-001.json
    ├── DT-002.json
    └── DT-003.json
```

每个 JSON 文件格式：

```json
{
  "dtId": "DT-001",
  "timestamp": "2026-02-26T12:00:00Z",
  "projectDir": "/path/to/project",
  "devJsonPath": "/path/to/dev.json",
  "results": [
    {
      "command": "npx tsc --noEmit",
      "blocking": true,
      "exitCode": 0,
      "durationMs": 3200,
      "outputHead": "No errors found.\n",
      "passed": true
    },
    {
      "command": "grep -q 'export function createUser' src/lib/user.ts",
      "blocking": true,
      "exitCode": 1,
      "durationMs": 50,
      "outputHead": "",
      "passed": false
    }
  ],
  "allPassed": false,
  "failedCount": 1,
  "totalCount": 2
}
```

---

## 4. GAP-2 详细设计: Hooks 沙箱

### 4.1 sandbox-guard.sh 设计

```bash
#!/bin/bash
# sandbox-guard.sh — Claude Code preToolUse hook
# 读取 stdin JSON，检查 Bash 命令是否匹配危险模式
# Exit: 0=放行, 2=阻止

# Claude Code hook 通过 stdin 传入 JSON:
# {
#   "tool_name": "Bash",
#   "tool_input": { "command": "rm -rf /" }
# }

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# 只检查 Bash 工具
[ "$TOOL_NAME" = "Bash" ] || exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -n "$COMMAND" ] || exit 0

# 危险模式黑名单
DENY_PATTERNS=(
  # 文件系统破坏
  'rm\s+-[a-zA-Z]*r[a-zA-Z]*f'    # rm -rf, rm -fr
  'rm\s+-[a-zA-Z]*f[a-zA-Z]*r'    # rm -fr variant

  # 数据库破坏
  'prisma\s+db\s+push.*--force-reset'
  'prisma\s+db\s+push.*--accept-data-loss'
  'prisma\s+db\s+push'              # 全面禁止 prisma db push
  'DROP\s+DATABASE'
  'DROP\s+TABLE'
  'TRUNCATE\s+TABLE'

  # Git 危险操作
  'git\s+push\s+--force'
  'git\s+push\s+-f\b'
  'git\s+reset\s+--hard'
  'git\s+clean\s+-[a-zA-Z]*f'

  # 系统级危险
  'mkfs\.'
  'dd\s+if=.*of=/dev/'
  '>\s*/dev/sd[a-z]'
  'chmod\s+-R\s+777\s+/'
  'curl.*\|\s*bash'
  'wget.*\|\s*bash'
  'curl.*\|\s*sh'
  'wget.*\|\s*sh'

  # 环境破坏
  'npm\s+cache\s+clean\s+--force'
  'env\s+-i'                        # 清空环境变量
)

for pattern in "${DENY_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qEi "$pattern"; then
    # 输出 JSON 到 stdout（Claude Code hook 协议）
    echo '{"decision":"block","reason":"sandbox-guard: 命令匹配危险模式 ['"$pattern"']"}'
    exit 2
  fi
done

# 不匹配任何危险模式 → 放行
exit 0
```

### 4.2 .claude/settings.json 配置

```json
{
  "hooks": {
    "preToolUse": [
      {
        "matcher": "Bash",
        "command": "bash $BOTOOL_SCRIPT_DIR/scripts/sandbox-guard.sh"
      }
    ]
  }
}
```

**注意**: `$BOTOOL_SCRIPT_DIR` 需要在 hook 注册时替换为实际路径。可以在 `setup.sh` 或 BotoolAgent.sh 启动时动态写入。

### 4.3 Hook 协议说明

Claude Code preToolUse hook 协议：

| 行为 | Exit Code | Stdout |
|------|-----------|--------|
| 放行 | 0 | （可选）无 |
| 阻止 | 2 | `{"decision":"block","reason":"..."}` |
| hook 本身出错 | 非 0 非 2 | 忽略，命令继续执行 |

**重要**:
- hook 脚本接收 stdin JSON（包含 tool_name 和 tool_input）
- hook 脚本必须快速返回（< 1 秒），否则阻塞所有命令执行
- hook 在 `--dangerously-skip-permissions` 模式下仍然生效

### 4.4 黑名单维护策略

| 级别 | 模式 | 理由 | 可否解除 |
|------|------|------|---------|
| **HARD** | rm -rf, prisma db push --force-reset | 不可逆数据丢失 | 不可，除非修改 sandbox-guard.sh |
| **HARD** | git push --force, git reset --hard | 不可逆代码丢失 | 不可 |
| **HARD** | DROP DATABASE/TABLE | 不可逆数据丢失 | 不可 |
| **SOFT** | curl|bash, wget|bash | 远程代码执行 | 不可 |
| **SOFT** | prisma db push（无 flag） | 项目约定只用 SQL 脚本 | 可根据项目调整 |

---

## 5. 与 v3 架构的关系

### 5.1 GAP-1 在 v3 管线中的位置

```
v3 Pipeline (DRAFT_combined_v3.md):
  PyramidPRD → A1 PRDReview → A2 PRD2JSON → dev.json → Lead Agent → passes:true

GAP-1 插入点:
  Lead Agent 执行 DT
    → 验证铁律 (evals)
    → [NEW] gate-check.sh (gateCheck=true 的 DT)
    → Stage A/B Review
    → passes: true

  Ralph 外循环 session 结束
    → [NEW] safety_net_check()
    → check_all_tasks_complete
```

GAP-1 不改变 v3 的管线架构，只在 Lead Agent 验证阶段和 Ralph 循环中增加确定性检查。

### 5.2 GAP-2 在 v3 管线中的位置

```
Claude CLI 启动 (BotoolAgent.sh)
  → --dangerously-skip-permissions
  → [NEW] preToolUse hook → sandbox-guard.sh 拦截危险命令
  → Lead Agent / Teammate 执行命令
```

GAP-2 是全局安全层，作用于所有 BotoolAgent session 中的 Bash 命令。

### 5.3 dev.json Schema 增量变化

相对于 DRAFT_combined_v3.md §4A.1 的 Schema：

| 变化 | 字段 | 说明 |
|------|------|------|
| 🆕 | `DT.gateCheck: boolean` | 是否需要确定性门控（默认 false） |
| 语义明确化 | `DT.evals[].blocking: boolean` | 已有字段，gate-check.sh 只执行 blocking=true 的 eval |

其他字段不变。PRD2JSON 的 17 项 Checklist 不需要变更（gateCheck 字段由 PRD2JSON 根据 DT 类型自动设置）。

### 5.4 新增文件清单

| 文件 | 说明 | 依赖 |
|------|------|------|
| `scripts/gate-check.sh` | DT 确定性门控脚本 | jq（可选降级） |
| `scripts/sandbox-guard.sh` | Hooks 沙箱拦截脚本 | jq |

### 5.5 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `CLAUDE.lead.md` | 验证铁律增加 gate-check 调用逻辑 |
| `scripts/BotoolAgent.sh` | session 结束后增加 safety_net_check() |
| `.claude/settings.json` | 添加 hooks.preToolUse 配置 |

---

## 6. 开发计划

GAP-1 和 GAP-2 可以独立实施，无相互依赖。

### Phase G1: 确定性门控（3 DT）

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-G01 | 新建 scripts/gate-check.sh | 读 dev.json blocking evals → 逐条执行 → 写 gate-results JSON → exit code |
| DT-G02 | CLAUDE.lead.md 验证铁律增强 | gateCheck=true 的 DT 必须调用 gate-check.sh；exit code 优先级高于 LLM 判断 |
| DT-G03 | BotoolAgent.sh Ralph 安全网 | session 结束后扫描 gateCheck=true + passes=true 但无 gate-results 的 DT → 撤销 |

### Phase G2: Hooks 沙箱（2 DT）

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-G04 | 新建 scripts/sandbox-guard.sh | preToolUse hook，黑名单模式拦截危险 Bash 命令 |
| DT-G05 | .claude/settings.json hooks 配置 | 注册 preToolUse hook 指向 sandbox-guard.sh |

---

## 7. 业务规则

| ID | 规则 | 说明 | 影响 DT |
|----|------|------|---------|
| BR-G01 | gateCheck=true 的 DT 必须有 gate-results | 无 gate-results + passes=true → Ralph 撤销 | DT-G01, DT-G03 |
| BR-G02 | gate-check.sh exit code 优先于 LLM 判断 | Shell 脚本说失败就是失败，Lead Agent 不能覆盖 | DT-G02 |
| BR-G03 | gate-check.sh 只执行 blocking=true 的 eval | non-blocking eval 失败不阻塞 passes | DT-G01 |
| BR-G04 | sandbox-guard.sh 使用黑名单模式 | 默认放行，只拦截已知危险模式 | DT-G04 |
| BR-G05 | prisma db push 全面禁止 | 不区分有无 flag，一律拦截 | DT-G04 |
| BR-G06 | hook 脚本必须 < 1 秒返回 | 超时会阻塞所有命令 | DT-G04 |

---

## 8. 验证方案

### 手动验证

```bash
# 1. gate-check.sh 基本功能
# 在有 prd.json 的项目目录下，手动运行
bash scripts/gate-check.sh . DT-001
echo "Exit code: $?"
cat .state/gate-results/DT-001.json | jq .

# 2. sandbox-guard.sh 拦截危险命令
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | bash scripts/sandbox-guard.sh
echo "Exit code: $?"  # 应为 2

# 3. sandbox-guard.sh 放行安全命令
echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | bash scripts/sandbox-guard.sh
echo "Exit code: $?"  # 应为 0

# 4. sandbox-guard.sh 拦截 prisma db push
echo '{"tool_name":"Bash","tool_input":{"command":"npx prisma db push"}}' | bash scripts/sandbox-guard.sh
echo "Exit code: $?"  # 应为 2

# 5. TypeCheck（确保修改不破坏类型系统）
cd viewer && npx tsc --noEmit
```

---

## 9. 范围边界

### 要做的

- `scripts/gate-check.sh`: 读 dev.json blocking evals、逐条执行、写 gate-results
- `scripts/sandbox-guard.sh`: preToolUse hook、黑名单拦截
- `CLAUDE.lead.md`: 验证铁律增加 gate-check 调用
- `scripts/BotoolAgent.sh`: Ralph 安全网检查
- `.claude/settings.json`: hooks 配置

### 不做的（YAGNI）

- **不做白名单模式** — BotoolAgent 需要执行任意构建/测试命令
- **不做 GUI 配置界面** — 黑名单修改直接编辑 sandbox-guard.sh
- **不做 eval 结果上传** — gate-results 只存本地，无远程同步
- **不修改 dev.json Schema 的其他字段** — 只新增 gateCheck
- **不修改 PRD2JSON Checklist** — gateCheck 由 PRD2JSON 自动设置，无需新 checklist 项
- **不做 postToolUse hook** — 先做 preToolUse 拦截，事后审计留给 v3+

---

## 10. 开放问题

1. **jq 依赖**: gate-check.sh 和 sandbox-guard.sh 都依赖 jq。是否需要在 setup.sh 中检查/安装 jq？还是提供纯 grep/sed 降级模式？
2. **hook 路径**: `.claude/settings.json` 中的 hook command 需要绝对路径。setup.sh 是否应该动态写入？还是使用相对路径 + 约定工作目录？
3. **gate-results 清理**: 重新运行 DT 时旧的 gate-results 是否自动覆盖？还是保留历史？
4. **多 worktree 场景**: gate-results 存在哪个目录？主仓库的 .state/ 还是 worktree 的 .state/？

---

> 下一步: 实施 DT-G01 ~ DT-G05
