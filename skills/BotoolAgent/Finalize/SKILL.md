---
name: botoolagent-finalize
description: "Finalize the BotoolAgent development cycle: push code, create PR, review changes, merge to main, and clean up branches. Use when development and testing are complete. Triggers on: finalize, create pr, merge, finish project."
user-invocable: true
---

# BotoolAgent Finalize 流水线

CLI 端的 PR 创建、Code Review 摘要、合并、清理流程。

前置条件：开发（`/botoolagent-coding`）和测试（`/botoolagent-testing`）已完成。

**Announce at start:** "正在启动 BotoolAgent Finalize 流水线..."

---

## Step 0: 项目选择（多 PRD 模式）

检查 `tasks/registry.json`（或 `BotoolAgent/tasks/registry.json`）是否存在：
- 如果存在且有多个项目 → 用 AskUserQuestion 列出项目让用户选择
- 选择后，使用 `tasks/{projectId}/prd.json` 作为 prd.json 路径（设置 `PRD_PATH`）
- 如果不存在 registry 或只有一个项目 → 直接读根目录 `prd.json`（向后兼容，`PRD_PATH="prd.json"`）

---

## Step 1: 前置检查 & 推送代码

### 1a. 检查 prd.json 和 branchName

```bash
# 使用 Step 0 确定的 PRD_PATH（per-project 或根目录）
ls "$PRD_PATH" 2>/dev/null
```

**如果 prd.json 不存在：**
```
错误：未找到 prd.json。

恢复建议：
- 运行 /botoolagent-prd2json 从 PRD 文档生成
- 或通过 Viewer the Viewer /stage2 page 完成 Stage 2
```
Then stop here.

```bash
grep -o '"branchName": "[^"]*"' "$PRD_PATH" | cut -d'"' -f4
```

**如果 branchName 为空：**
```
错误：prd.json 中缺少 branchName 字段。

恢复建议：在 prd.json 顶层添加 "branchName": "your-branch-name"
```
Then stop here.

### 1b. 确保在正确的分支上

```bash
git branch --show-current
```

**如果当前分支不是 branchName：**
```bash
git checkout <branchName>
```

**如果当前分支是 main：**
```
错误：当前在 main 分支上，没有可合并的功能分支。

恢复建议：切换到开发分支后重试
```
Then stop here.

### 1c-pre. 检查未提交的更改

```bash
git status --porcelain
```

如果有未提交的更改（Testing 自动修复残留）：
```bash
git add -A
git commit -m "fix: commit testing auto-fixes before finalize"
```

### 1c. 推送代码到远程

```bash
git push origin <branchName>
```

**如果推送失败：**
```
错误：推送失败。

恢复建议：
- 检查是否有未提交的更改：git status
- 检查远程仓库连接：git remote -v
- 如果有冲突，先 pull 再 push
```
Then stop here.

**推送成功后告知用户：** "代码已推送到远程分支 `<branchName>`。"

---

## Step 2: 检查 / 创建 PR

### 2a. 检查是否已有 PR

```bash
gh pr list --head <branchName> --json number,title,url,state --jq '.[0]'
```

**如果已有 PR：**
- 输出 PR 信息（编号、标题、URL）
- 跳到 Step 3

### 2b. 创建新 PR

读取 prd.json 中的 `project`（项目名称）和 `description`（项目描述）。

```bash
gh pr create --title "feat: $PROJECT_NAME" --body "$(cat <<EOF
## 自动生成 PR

**项目：** $PROJECT_NAME

**描述：** $PROJECT_DESCRIPTION

### 变更摘要

本 PR 包含 BotoolAgent 自动开发的全部代码变更。

---
*由 BotoolAgent Finalize 自动创建*
EOF
)"
```

**如果创建失败：**
```
错误：PR 创建失败。

恢复建议：
- 检查 gh 是否已认证：gh auth status
- 检查远程仓库是否有写入权限
- 手动创建 PR：gh pr create
```
Then stop here.

**创建成功后：** 输出 PR 编号、标题和 URL。

---

## Step 3: Code Review 摘要

生成代码审查摘要，审查 `main` 分支到当前分支的所有变更。

### 3a. 获取变更差异

```bash
git diff main...HEAD --stat
git diff main...HEAD
```

### 3b. Claude 生成 Review 摘要

分析 diff 内容，生成结构化的审查摘要，涵盖以下方面：

1. **变更概述**：修改了哪些模块、新增了什么功能
2. **代码质量**：代码风格一致性、命名规范、注释完整度
3. **潜在风险**：可能的 bug、安全隐患、性能问题
4. **改进建议**：可选的优化方向
5. **总体评价**：是否建议合并（推荐/谨慎/不推荐）

输出格式：
```
## Code Review 摘要

### 变更概述
- ...

### 代码质量
评分: ⭐⭐⭐⭐ (4/5)
- ...

### 潜在风险
- ...（如果没有风险则标注"未发现明显风险"）

### 改进建议
- ...（可选优化，不阻塞合并）

### 总体评价
✅ 建议合并 / ⚠️ 谨慎合并 / ❌ 不建议合并
理由: ...
```

---

## Step 4: 确认合并

展示 Review 摘要后，向用户确认是否合并。

**使用 AskUserQuestion 询问：**
```
Code Review 已完成。是否将 PR #<number> 合并到 main？

选项：
1. 合并 — 执行普通 merge 到 main
2. 取消 — 保留 PR，稍后手动处理
```

**如果用户选择取消：**
```
已取消合并。PR #<number> 保持开放状态。
你可以稍后重新运行 /botoolagent-finalize 继续合并流程。
```
Then stop here.

---

## Step 5: 执行合并

使用普通 merge（**不使用 squash**），保留完整的提交历史。

```bash
gh pr merge <pr-number> --merge
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

---

## Step 6: 清理

### 6a. 删除远程分支

```bash
git push origin --delete <branchName>
```

如果删除失败，记录警告但不阻塞流程。

### 6b. 切换到 main 并拉取最新代码

```bash
git checkout main
git pull origin main
```

### 6c. 删除本地分支（可选）

```bash
git branch -d <branchName>
```

如果删除失败（未完全合并），记录警告但不阻塞流程。

### 6d. 清理 per-project 状态文件

```bash
# 清理 per-project 状态文件（如果使用了 PROJECT_ID）
if [ -n "$PROJECT_ID" ]; then
  rm -f "tasks/${PROJECT_ID}/agent-status"
  rm -f "tasks/${PROJECT_ID}/agent-pid"
  rm -f "tasks/${PROJECT_ID}/teammates.json"
  rm -f "tasks/${PROJECT_ID}/last-branch"
fi
```

同时更新 `tasks/registry.json` 中该项目的 status 为 `"complete"`（通过 jq 或 sed）。

---

## Step 7: 输出总结

```
BotoolAgent Finalize 完成！

📋 PR: #<number> - <title>
🔗 URL: <pr-url>
✅ 状态: 已合并到 main
🧹 清理: 远程分支已删除，已切换到 main

项目 "<project-name>" 开发周期已完成。
```

---

## 错误恢复速查表

| 错误 | 恢复建议 |
|------|----------|
| prd.json 不存在 | 运行 `/botoolagent-prd2json` 先生成 |
| branchName 缺失 | 在 prd.json 中添加 branchName 字段 |
| 推送失败 | 检查 `git status` 和 `git remote -v` |
| gh 未认证 | 运行 `gh auth login` |
| PR 创建失败 | 检查 gh 权限，或手动 `gh pr create` |
| 合并冲突 | 先解决冲突，再重新运行 finalize |
| 合并失败 | 检查 PR checks，手动 `gh pr merge --merge` |
| 分支删除失败 | 手动 `git push origin --delete <branch>` |

---

## 与 Viewer 对齐

CLI Finalize Skill 对应 Viewer 的 Stage 5（合并发布）。

| CLI Skill | Viewer Stage | 说明 |
|-----------|-------------|------|
| `/botoolagent-coding` | Stage 3 | 自动开发（Teams 或单 agent） |
| `/botoolagent-testing` | Stage 4 | 质量检查 + 测试验证 |
| `/botoolagent-finalize` | Stage 5 | PR 创建 + Review + 合并 + 清理 |

**CLI 与 Viewer 的行为一致性：**
- 两者都使用**普通 merge**（非 squash），保留完整提交历史
- 两者都在合并后执行分支清理
- CLI 额外提供交互式 Review 确认步骤
