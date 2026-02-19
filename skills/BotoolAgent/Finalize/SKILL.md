---
name: botoolagent-finalize
description: "Finalize the BotoolAgent development cycle: review testing report, merge PR to main, and clean up branches. Use when development and testing are complete. Triggers on: finalize, create pr, merge, finish project."
user-invocable: true
---

# BotoolAgent Finalize 流水线（一键 Merge）

CLI 端的合并发布流程。**前置条件：Testing 已完成（agent-status = `testing_complete`）。**

Testing Skill 负责全部质量保障（6 层自动质检 + PR 创建），Finalize 只负责：
1. 检查 Testing 是否完成
2. 展示质检摘要
3. 用户确认 merge
4. 执行 merge + 清理
5. 输出完成摘要

**Announce at start:** "正在启动 BotoolAgent Finalize 流水线（一键 Merge 模式）..."

---

## Step 1: 项目选择 + 前置检查

### 1a. 项目选择（多 PRD 模式）

检查 `tasks/registry.json`（或 `BotoolAgent/tasks/registry.json`）是否存在：
- 如果存在且有多个项目 → 用 AskUserQuestion 列出项目让用户选择
- 选择后，设置 `PRD_PATH="tasks/${PROJECT_ID}/prd.json"`
- 如果不存在 registry 或只有一个项目 → 设置 `PRD_PATH="prd.json"`（向后兼容）

### 1b. 检查 prd.json 和 branchName

```bash
# 使用 Step 1a 确定的 PRD_PATH（per-project 或根目录）
ls "$PRD_PATH" 2>/dev/null
```

**如果 prd.json 不存在：**
```
错误：未找到 prd.json。

恢复建议：
- 运行 /botoolagent-prd2json 从 PRD 文档生成
- 或通过 Viewer /stage2 page 完成 Stage 2
```
Then stop here.

```bash
BRANCH_NAME=$(grep -o '"branchName": "[^"]*"' "$PRD_PATH" | cut -d'"' -f4)
```

**如果 branchName 为空：**
```
错误：prd.json 中缺少 branchName 字段。

恢复建议：在 prd.json 顶层添加 "branchName": "your-branch-name"
```
Then stop here.

### 1c. 检查 testing_complete 状态

```bash
# 读取 agent-status（per-project 路径）
STATUS_PATH="tasks/${PROJECT_ID}/agent-status"
STATUS=$(node -e "
  try {
    const s = JSON.parse(require('fs').readFileSync('$STATUS_PATH','utf8'));
    console.log(s.status || 'unknown');
  } catch(e) { console.log('not_found'); }
")
echo "agent-status: $STATUS"
```

**如果 status 不是 `testing_complete`：**
```
错误：Testing 尚未完成。当前状态：{status}

Finalize 需要 Testing 全部通过后才能执行。
请先运行 /botoolagent-testing 完成 6 层自动质检。
```
Then stop here.

**前置检查通过后，告知用户：** "前置检查通过，Testing 已完成。"

---

## Step 2: 展示质检摘要

### 2a. 读取 testing-report.json

```bash
REPORT_PATH="tasks/${PROJECT_ID}/testing-report.json"
cat "$REPORT_PATH"
```

**如果 testing-report.json 不存在：**
```
警告：未找到 testing-report.json。Testing 可能使用了旧版本。

跳过质检摘要展示，直接进入确认合并。
```
跳到 Step 3。

### 2b. 展示 6 层质检报告

解析 testing-report.json，展示格式化的质检摘要：

```
质检报告摘要:

  Layer 1 — Regression:       ✓ 通过 / ✗ 失败 / ○ 跳过
  Layer 2 — Unit Tests:       ✓ 通过 / ✗ 失败 / ○ 跳过
  Layer 3 — E2E Tests:        ✓ 通过 / ✗ 失败 / ○ 跳过
  Layer 4 — Code Review:      ✓ 通过 / ✗ 失败 / ○ 跳过
  Layer 5 — Codex 红队审查:    ✓ 通过 / ✗ 失败 / ○ 跳过
  Layer 6 — PR 创建:          ✓ 通过 / ✗ 失败 / ○ 跳过

  Verdict: {verdict}
  PR: #{prNumber} — {prUrl}
```

### 2c. 读取 PR 信息

```bash
# 从 agent-status 获取 PR URL
PR_URL=$(node -e "
  try {
    const s = JSON.parse(require('fs').readFileSync('$STATUS_PATH','utf8'));
    console.log(s.prUrl || '');
  } catch(e) { console.log(''); }
")
PR_NUMBER=$(node -e "
  try {
    const s = JSON.parse(require('fs').readFileSync('$STATUS_PATH','utf8'));
    console.log(s.prNumber || '');
  } catch(e) { console.log(''); }
")

# 如果 agent-status 中没有 PR 信息，从 gh CLI 获取
if [ -z "$PR_URL" ]; then
  PR_URL=$(gh pr list --head "$BRANCH_NAME" --json url --jq '.[0].url')
  PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number')
fi

echo "PR #$PR_NUMBER: $PR_URL"
```

**如果没有找到 PR：**
```
错误：未找到对应的 PR。

Testing Layer 6 应该已经创建了 PR。
请检查远程仓库是否有该分支的 PR，或手动创建：gh pr create
```
AskUserQuestion 让用户选择：手动创建后继续 / 终止 finalize。

---

## Step 3: 用户确认 Merge

**使用 AskUserQuestion 询问：**
```
质检报告已展示。是否将 PR #<number> 合并到 main？

选项：
1. 确认 Merge — 执行普通 merge 到 main
2. 取消 — 保留 PR，稍后手动处理
```

**如果用户选择取消：**
```
已取消合并。PR #<number> 保持开放状态。
你可以稍后重新运行 /botoolagent-finalize 继续合并流程。
```
Then stop here.

---

## Step 4: 执行 Merge + 清理

### 4a. 确保在正确的分支上

```bash
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "main" ]; then
  echo "错误：当前在 main 分支上"
fi
```

### 4b. 执行 Merge

使用普通 merge（**不使用 squash**），保留完整的提交历史。

```bash
gh pr merge "$PR_NUMBER" --merge
```

**重要：使用 `--merge` 而不是 `--squash`，以保留每个任务的独立提交记录。**

**如果合并失败：**
```
错误：合并失败。

恢复建议：
- 检查是否有合并冲突：gh pr checks <pr-number>
- 检查 PR 状态：gh pr view <pr-number>
- 手动合并：gh pr merge <pr-number> --merge
```
Then stop here.

**合并成功后告知用户：** "PR #<number> 已成功合并到 main！"

### 4c. 清理远程分支

```bash
git push origin --delete "$BRANCH_NAME" 2>/dev/null || echo "远程分支删除失败（可能已自动删除）"
```

如果删除失败，记录警告但不阻塞流程。

### 4d. 切换到 main 并拉取最新代码

```bash
git checkout main
git pull origin main
```

### 4e. 删除本地分支

```bash
git branch -d "$BRANCH_NAME" 2>/dev/null || echo "本地分支删除失败（可能未完全合并）"
```

如果删除失败，记录警告但不阻塞流程。

### 4f. 清理 per-project 状态文件

```bash
# 清理 per-project 运行时状态文件
if [ -n "$PROJECT_ID" ]; then
  rm -f "tasks/${PROJECT_ID}/agent-status"
  rm -f "tasks/${PROJECT_ID}/agent-pid"
  rm -f "tasks/${PROJECT_ID}/teammates.json"
  rm -f "tasks/${PROJECT_ID}/last-branch"
fi
```

同时更新 `tasks/registry.json` 中该项目的 status 为 `"complete"`。

### 4g. 清理 worktree + PID（如有残留）

```bash
# 清理可能残留的 git worktree
git worktree list | grep "$BRANCH_NAME" | awk '{print $1}' | while read wt; do
  git worktree remove "$wt" --force 2>/dev/null || true
done

# 清理可能残留的 agent PID
if [ -n "$PROJECT_ID" ] && [ -f "tasks/${PROJECT_ID}/agent-pid" ]; then
  PID=$(cat "tasks/${PROJECT_ID}/agent-pid")
  kill "$PID" 2>/dev/null || true
  rm -f "tasks/${PROJECT_ID}/agent-pid"
fi
```

---

## Step 5: 完成摘要

```
BotoolAgent Finalize 完成！

  PR: #<number> - <title>
  URL: <pr-url>
  状态: 已合并到 main
  清理: 远程分支已删除，已切换到 main

项目 "<project-name>" 开发周期已完成。
```

---

## 错误恢复速查表

| 错误 | 恢复建议 |
|------|----------|
| prd.json 不存在 | 运行 `/botoolagent-prd2json` 先生成 |
| branchName 缺失 | 在 prd.json 中添加 branchName 字段 |
| agent-status 不是 testing_complete | 运行 `/botoolagent-testing` 完成 6 层质检 |
| testing-report.json 不存在 | 运行 `/botoolagent-testing` 生成报告 |
| 未找到 PR | 检查远程仓库，或手动 `gh pr create` |
| gh 未认证 | 运行 `gh auth login` |
| 合并冲突 | 先解决冲突，再重新运行 finalize |
| 合并失败 | 检查 PR checks，手动 `gh pr merge --merge` |
| 分支删除失败 | 手动 `git push origin --delete <branch>` |

---

## 与 Viewer 对齐

CLI Finalize Skill 对应 Viewer 的 Stage 5（合并发布）。

| CLI Skill | Viewer Stage | 说明 |
|-----------|-------------|------|
| `/botoolagent-coding` | Stage 3 | 自动开发（Teams 或单 agent） |
| `/botoolagent-testing` | Stage 4 | 6 层质检 + PR 创建 + PR-Agent 守门 |
| `/botoolagent-finalize` | Stage 5 | 展示摘要 + 确认 merge + 清理 |

**CLI 与 Viewer 的行为一致性：**
- 两者都在 Finalize 前检查 `testing_complete` 状态
- 两者都使用**普通 merge**（非 squash），保留完整提交历史
- 两者都在合并后执行分支清理
- PR 创建已移至 Testing Layer 6，Finalize 只负责 merge
