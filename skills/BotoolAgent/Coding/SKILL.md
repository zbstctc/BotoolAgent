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

如果用户提供了参数（如 `/botoolagent-coding`），直接启动 Agent Teams 模式。
无需额外参数。

---

## Step 0: 项目选择（多 PRD 模式）

检查 `tasks/registry.json`（或 `BotoolAgent/tasks/registry.json`）是否存在：
- 如果存在且有多个项目 → 用 AskUserQuestion 列出项目让用户选择
- 选择后，使用 `tasks/prd-{projectId}.json` 作为 prd.json 路径
- 如果不存在 registry 或只有一个项目 → 直接读根目录 `prd.json`（向后兼容）

选定后，后续所有对 prd.json 的引用均指向选定项目的路径。

---

## Step 1: 前置检查

依次执行以下 4 项检查，任一失败则**停止并告知用户**。

### 1a. 检查 prd.json

```bash
# 如果 Step 0 选定了 projectId，检查项目特定的 prd.json
# 否则检查根目录 prd.json
ls prd.json 2>/dev/null
```

**如果 prd.json 不存在：**
```
错误：未找到 prd.json。

恢复建议：
- 运行 /botoolagent-prd2json 从 PRD 文档生成
- 或通过 Viewer http://localhost:3000/stage2 完成 Stage 2
```
Then stop here.

### 1b. 检查 branchName

```bash
grep -o '"branchName": "[^"]*"' prd.json | cut -d'"' -f4
```

**如果 branchName 为空：**
```
错误：prd.json 中缺少 branchName 字段。

恢复建议：在 prd.json 顶层添加 "branchName": "your-branch-name"
```
Then stop here.

### 1c. 确保在正确的分支上

```bash
git branch --show-current
```

**如果当前分支不是 branchName：**
```bash
git checkout <branchName> 2>/dev/null || git checkout -b <branchName>
```

### 1d. 检查是否有重复进程

```bash
pgrep -f "BotoolAgent" 2>/dev/null
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

```bash
bash "$AGENT_DIR/scripts/BotoolAgent.sh"
```

**注意：** BotoolAgent 通过 tmux 启动交互式 Agent Teams 会话，包含自动重试的 Ralph 外循环。此命令会长时间运行。使用 `run_in_background` 参数在后台运行，定期检查 `.state/agent-status` 文件了解进度：

```bash
cat .state/agent-status 2>/dev/null
```

### 等待完成

**等待脚本完成。** 检查退出码：

**如果退出码非零：**
```
错误：自动开发执行异常（退出码: <code>）

恢复建议：
- 查看 progress.txt 了解最后完成到哪个任务
- 查看 .state/agent-status 了解失败原因
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
| 自动开发执行异常 | 查看 progress.txt 和 .state/agent-status，修复后重试 |

---

## 与 Viewer 对齐

CLI Coding Skill 专注于 Viewer 的 Stage 3（自动开发）。
质量检查（Stage 4）和 PR 创建（Stage 5）由独立 Skill 负责。

| CLI Skill | Viewer Stage | 说明 |
|-----------|-------------|------|
| `/botoolagent-coding` | Stage 3 | 自动开发（Agent Teams + tmux） |
| `/botoolagent-testing` | Stage 4 | 质量检查 + 测试验证 |
| `/botoolagent-finalize` | Stage 5 | PR 创建 + 合并 |
