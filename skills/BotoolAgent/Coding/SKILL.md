---
name: botoolagent-coding
description: "Start and monitor autonomous development with BotoolAgent. Use when you have a prd.json ready and want to start coding. Triggers on: start coding, run botool, start development, begin implementing."
user-invocable: true
---

# BotoolAgent 自动开发流水线

CLI 全自动流水线：前置检查 → 运行 BotoolAgent.sh → typecheck+lint+test → gh pr create → 输出 PR 链接。

**Announce at start:** "正在启动 BotoolAgent 自动开发流水线..."

---

## 参数解析

如果用户提供了参数（如 `/botoolagent-coding 20`），将第一个数字参数作为 `maxIterations`。
默认值：`maxIterations=10`。

---

## Step 1: 前置检查

依次执行以下 4 项检查，任一失败则**停止并告知用户**。

### 1a. 检查 prd.json

```bash
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
pgrep -f "BotoolAgent.sh" 2>/dev/null
```

**如果有进程在运行：**
```
错误：BotoolAgent 已在运行中（PID: <pid>）。

恢复建议：
- 等待当前任务完成
- 或终止进程：kill <pid>
```
Then stop here.

**前置检查全部通过后，告知用户：** "前置检查通过，开始执行自动开发..."

---

## Step 2: 执行 BotoolAgent.sh

自动检测 BotoolAgent.sh 位置（standalone 或 portable 模式）。

```bash
# 自动检测路径
if [ -f "BotoolAgent/BotoolAgent.sh" ]; then
  AGENT_SCRIPT="BotoolAgent/BotoolAgent.sh"
else
  AGENT_SCRIPT="$(dirname "$(find . -maxdepth 2 -name BotoolAgent.sh -type f 2>/dev/null | head -1)" 2>/dev/null)/BotoolAgent.sh"
  [ ! -f "$AGENT_SCRIPT" ] && AGENT_SCRIPT="BotoolAgent.sh"
fi
echo "Agent script: $AGENT_SCRIPT"
```

**如果找不到 BotoolAgent.sh：**
```
错误：未找到 BotoolAgent.sh。

恢复建议：确认 BotoolAgent 目录结构完整
```
Then stop here.

然后运行（使用后台模式，设置长超时）：

```bash
bash "$AGENT_SCRIPT" <maxIterations>
```

**注意：** 此命令会长时间运行（每次迭代约 5-30 分钟）。使用 `run_in_background` 参数在后台运行，定期检查 `.agent-status` 文件了解进度：

```bash
cat .agent-status 2>/dev/null
```

**等待 BotoolAgent.sh 完成。** 检查退出码：

**如果退出码非零：**
```
错误：BotoolAgent.sh 执行异常（退出码: <code>）

恢复建议：
- 查看 progress.txt 了解最后完成到哪个任务
- 查看 .agent-status 了解失败原因
- 修复问题后重新运行 /botoolagent-coding
```
Then stop here.

---

## Step 3: 自动质量检查

### 3a. TypeCheck

```bash
# 自动检测 viewer 目录
VIEWER_DIR="$([ -d BotoolAgent/viewer ] && echo BotoolAgent/viewer || echo viewer)"
cd "$VIEWER_DIR" && npx tsc --noEmit
```

**如果 TypeCheck 失败：**
```
错误：TypeCheck 失败。

恢复建议：
- 运行 npx tsc --noEmit 查看具体错误
- 修复类型错误后重新运行 /botoolagent-coding
```
Then stop here.

### 3b. Lint（不阻塞）

```bash
npm run lint 2>/dev/null || echo "Lint 跳过或有警告（不阻塞）"
```

如果 Lint 失败，记录警告但**不停止流程**。

**质量检查通过后，告知用户：** "质量检查通过，准备创建 PR..."

---

## Step 4: 自动创建 PR

### 4a. 推送代码

```bash
git push origin <branchName>
```

**如果推送失败：**
```
错误：代码推送失败。

恢复建议：
- 检查是否有未解决的冲突：git status
- 检查远程权限：gh auth status
- 手动推送：git push origin <branchName>
```
Then stop here.

### 4b. 检查是否已有 PR

```bash
gh pr list --head <branchName> --state open --json url --jq '.[0].url'
```

**如果已有 PR：** 跳过创建，使用现有 PR URL，进入 Step 5。

### 4c. 创建 PR

从 prd.json 提取项目名称和任务列表，创建 PR：

```bash
PROJECT_NAME=$(grep -o '"project": "[^"]*"' prd.json | cut -d'"' -f4)
```

```bash
gh pr create \
  --title "feat: $PROJECT_NAME" \
  --body "## 自动生成的 PR

由 BotoolAgent 自动开发流水线创建。

### 完成的任务
$(python3 -c "import json; data=json.load(open('prd.json')); [print(f'- [{t[\"id\"]}] {t[\"title\"]} ({\"通过\" if t.get(\"passes\") else \"未通过\"})') for t in data.get('devTasks',[])]" 2>/dev/null || grep -o '"id": "DT-[0-9]*"' prd.json | while read line; do echo "- $line"; done)

### 测试结果
- TypeCheck: 通过
- Lint: 通过
"
```

**如果 PR 创建失败：**
```
错误：PR 创建失败。

恢复建议：
- 确认 gh CLI 已登录：gh auth status
- 确认有仓库写权限
- 手动创建：gh pr create --title "feat: <项目名>" --body "自动开发完成"
```
Then stop here.

---

## Step 5: 输出最终结果

展示完整的执行结果给用户：

```
BotoolAgent 自动开发流水线完成！

PR 链接: <PR_URL>

完成的任务:
<列出所有 passes: true 的任务，格式: - [DT-XXX] 标题>

下一步:
1. 在 GitHub 上查看 PR: <PR_URL>
2. 请求团队成员 Code Review
3. 通过后合并到主分支
```

---

## 支持的参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| maxIterations | 最大迭代次数 | 10 |

用法：`/botoolagent-coding 20`（设置最大迭代为 20）

---

## 错误恢复速查表

| 错误 | 恢复建议 |
|------|----------|
| prd.json 不存在 | 运行 `/botoolagent-prd2json` 先生成 |
| branchName 缺失 | 在 prd.json 中添加 branchName 字段 |
| 进程重复运行 | `kill <pid>` 终止后重试 |
| BotoolAgent.sh 执行异常 | 查看 progress.txt 和 .agent-status，修复后重试 |
| TypeCheck 失败 | 修复类型错误后重新运行 |
| 代码推送失败 | 检查 git 状态和远程权限 |
| PR 创建失败 | 确认 `gh auth status` 和仓库权限 |

---

## 与 Viewer 对齐

CLI 流水线对应 Viewer 的 Stage 3→4→5：

| CLI Step | Viewer Stage | 说明 |
|----------|-------------|------|
| Step 2 | Stage 3 | 自动开发（BotoolAgent.sh 执行） |
| Step 3 | Stage 4 | 自动验收（typecheck + lint + test） |
| Step 4 | Stage 5 | 确认合并（PR 创建） |
