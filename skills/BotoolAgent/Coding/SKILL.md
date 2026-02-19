---
name: botoolagent-coding
description: "Start and monitor autonomous development with BotoolAgent. Use when you have a prd.json ready and want to start coding. Triggers on: start coding, run botool, start development, begin implementing."
user-invocable: true
---

# BotoolAgent 自动开发流水线

CLI 自动开发流水线：前置检查 → 运行 BotoolAgent.sh (tmux + Agent Teams) → 输出完成信息。

质量检查和 PR 创建由独立的 `/botoolagent-testing` 和 `/botoolagent-finalize` Skill 负责。

**Announce at start:** "正在启动 BotoolAgent 自动开发流水线..."

---

## 参数解析

如果用户提供了参数（如 `/botoolagent-coding tasks/prd-adversarial-review/`），从参数中提取 PROJECT_ID：

```bash
# 参数形式: tasks/{projectId}/ 或 tasks/{projectId} 或直接 {projectId}
# 提取 PROJECT_ID:
#   "tasks/prd-adversarial-review/"  → "prd-adversarial-review"
#   "tasks/prd-adversarial-review"   → "prd-adversarial-review"
#   "prd-adversarial-review"         → "prd-adversarial-review"
ARG="<用户参数>"
ARG="${ARG%/}"                    # 去除尾部斜杠
ARG="${ARG#tasks/}"               # 去除 tasks/ 前缀
PROJECT_ID="$ARG"
```

如果没有参数，`PROJECT_ID` 留空，进入 Step 0 交互式选择。

---

## Step 0: 项目选择（多 PRD 模式）

**优先级：用户参数 > registry.json > 单项目 fallback**

1. **如果参数已提供 PROJECT_ID** → 跳过选择，直接使用
2. **否则**检查 `tasks/registry.json`（或 `BotoolAgent/tasks/registry.json`）：
   - 如果存在且有多个项目 → 用 AskUserQuestion 列出项目让用户选择
   - 如果不存在 registry 或只有一个项目 → 直接读根目录 `prd.json`（向后兼容）

选定后，设置 `PRD_PATH`（**必须为绝对路径**，因为 BotoolAgent.sh 在 worktree 中运行时相对路径会失效）：
- 有 `PROJECT_ID` 时：`PRD_PATH="$(pwd)/tasks/${PROJECT_ID}/prd.json"`
- 无 `PROJECT_ID`（单项目兼容）时：`PRD_PATH="$(pwd)/prd.json"`

后续所有对 prd.json 的引用均使用 `$PRD_PATH`。

---

## Step 1: 前置检查

依次执行以下 4 项检查，任一失败则**停止并告知用户**。

### 1a. 检查 prd.json

```bash
# 如果 Step 0 选定了 projectId，检查 per-project prd.json
# 否则检查根目录 prd.json（向后兼容）
if [ -n "$PROJECT_ID" ]; then
  ls tasks/${PROJECT_ID}/prd.json 2>/dev/null
else
  ls prd.json 2>/dev/null
fi
```

**如果 prd.json 不存在：**
```
错误：未找到 prd.json。

恢复建议：
- 运行 /botoolagent-prd2json 从 PRD 文档生成
- 或通过 Viewer the Viewer /stage2 page 完成 Stage 2
```
Then stop here.

### 1b. 检查 branchName

```bash
# 使用 Step 0 确定的 PRD_PATH（per-project 或根目录）
grep -o '"branchName": "[^"]*"' "$PRD_PATH" | cut -d'"' -f4
```

**如果 branchName 为空：**
```
错误：prd.json 中缺少 branchName 字段。

恢复建议：在 prd.json 顶层添加 "branchName": "your-branch-name"
```
Then stop here.

### 1c. 分支检查（区分 worktree 模式和单项目模式）

```bash
git branch --show-current
```

**如果有 PROJECT_ID（worktree 模式）：**
- **不要 checkout 分支**。BotoolAgent.sh 会自动创建 worktree 并在 worktree 中管理分支。
- 主仓库应保持在 `main`（或其他稳定分支），以便多个项目并行使用各自的 worktree。
- 仅提示用户当前主仓库分支状态即可。

**如果没有 PROJECT_ID（单项目兼容模式）且当前分支不是 branchName：**
```bash
git checkout <branchName> 2>/dev/null || git checkout -b <branchName>
```

### 1d. 检查是否有重复进程

```bash
# 检查当前项目是否有 agent 在运行
if [ -n "$PROJECT_ID" ]; then
  pgrep -f "project-id.*$PROJECT_ID" 2>/dev/null
else
  pgrep -f "BotoolAgent.sh" 2>/dev/null
fi
```

**如果有进程在运行：**
```
错误：BotoolAgent 已在运行中（PID: <pid>）。

恢复建议：
- 等待当前任务完成
- 或终止进程：kill <pid>
```
Then stop here.

### 1e. 检查 tmux 可用性

```bash
command -v tmux &>/dev/null
```

**如果 tmux 不可用：**
```
错误：tmux 未安装，BotoolAgent 需要 tmux 才能运行。

恢复建议：安装 tmux：brew install tmux
```
Then stop here.

**前置检查全部通过后，告知用户：** "前置检查通过，开始执行自动开发..."

---

## Step 2: 执行自动开发

自动检测脚本位置（standalone 或 portable 模式）。

```bash
# 自动检测 BotoolAgent 目录
if [ -d "BotoolAgent" ]; then
  AGENT_DIR="BotoolAgent"
else
  AGENT_DIR="$(dirname "$(dirname "$(find . -maxdepth 3 -path '*/scripts/BotoolAgent.sh' -type f 2>/dev/null | head -1)")" 2>/dev/null)"
  [ -z "$AGENT_DIR" ] && AGENT_DIR="."
fi
echo "Agent directory: $AGENT_DIR"
```

**如果找不到脚本目录：**
```
错误：未找到 BotoolAgent 脚本目录。

恢复建议：确认 BotoolAgent 目录结构完整
```
Then stop here.

### 启动 Agent Teams

**后台启动（抗父进程崩溃）：**

```bash
# 构建参数（PRD_PATH 必须是绝对路径，worktree 中相对路径会失效）
BOTOOL_ARGS="$AGENT_DIR/scripts/BotoolAgent.sh"
if [ -n "$PROJECT_ID" ]; then
  BOTOOL_ARGS="$BOTOOL_ARGS --project-id $PROJECT_ID --prd-path $PRD_PATH"
fi

# 后台启动（抗父进程崩溃）
nohup bash $BOTOOL_ARGS > /tmp/botool-agent-${PROJECT_ID:-default}.log 2>&1 & disown
BOTOOL_PID=$!
echo "BotoolAgent 已后台启动 (PID: $BOTOOL_PID)"
```

其中 `$PROJECT_ID` 和 `$PRD_PATH` 来自参数解析/Step 0。`PRD_PATH` 必须是绝对路径（在 Step 0 中已通过 `$(pwd)` 前缀处理）。如果是单项目模式（无 PROJECT_ID），则不传 `--project-id` 和 `--prd-path`。

### 等待完成

**定期轮询 agent-status 文件** 确认执行状态（每 30 秒检查一次，最多等待 60 分钟）：

```bash
# 确定 status 文件路径
if [ -n "$PROJECT_ID" ]; then
  STATUS_PATH="$AGENT_DIR/tasks/${PROJECT_ID}/agent-status"
else
  STATUS_PATH="$AGENT_DIR/.state/agent-status"
fi

# 轮询等待完成
for i in $(seq 1 120); do
  sleep 30
  STATUS=$(grep -o '"status": "[^"]*"' "$STATUS_PATH" 2>/dev/null | head -1 | cut -d'"' -f4)
  echo "[$i/120] Agent status: $STATUS"
  if [ "$STATUS" = "complete" ] || [ "$STATUS" = "max_rounds" ] || [ "$STATUS" = "stopped" ]; then
    break
  fi
done
```

**如果最终状态不是 `complete`：**
```
错误：自动开发未正常完成（状态: <status>）

恢复建议：
- 查看 progress.txt 了解最后完成到哪个任务
- 查看 agent-status 了解失败原因
- 查看日志：cat /tmp/botool-agent-<projectId>.log
- 修复问题后重新运行 /botoolagent-coding
```
Then stop here.

---

## Step 3: 输出完成信息

展示执行结果并提示下一步：

```
BotoolAgent 自动开发完成！

完成的任务:
<列出所有 passes: true 的任务，格式: - [DT-XXX] 标题>

未完成的任务:
<列出所有 passes: false 的任务，格式: - [DT-XXX] 标题>（如果没有则显示"无"）

下一步:
1. 运行 /botoolagent-testing 进行质量检查和测试验证
2. 运行 /botoolagent-finalize 创建 PR 并完成合并
```

---

## 错误恢复速查表

| 错误 | 恢复建议 |
|------|----------|
| prd.json 不存在 | 运行 `/botoolagent-prd2json` 先生成 |
| branchName 缺失 | 在 prd.json 中添加 branchName 字段 |
| 进程重复运行 | `kill <pid>` 终止后重试 |
| tmux 未安装 | `brew install tmux` |
| 自动开发未正常完成 | 查看 progress.txt、agent-status 和 `/tmp/botool-agent-*.log`，修复后重试 |

---

## 与 Viewer 对齐

CLI Coding Skill 专注于 Viewer 的 Stage 3（自动开发）。
质量检查（Stage 4）和 PR 创建（Stage 5）由独立 Skill 负责。

| CLI Skill | Viewer Stage | 说明 |
|-----------|-------------|------|
| `/botoolagent-coding` | Stage 3 | 自动开发（Agent Teams + tmux） |
| `/botoolagent-testing` | Stage 4 | 质量检查 + 测试验证 |
| `/botoolagent-finalize` | Stage 5 | PR 创建 + 合并 |
