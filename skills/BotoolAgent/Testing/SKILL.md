---
name: botoolagent-testing
description: "Run the 5-layer verification pipeline for BotoolAgent projects. Use when development is complete and you need to verify quality before merging. Triggers on: run tests, verify, test my code, start testing, run verification."
user-invocable: true
---

# BotoolAgent 5 层分层测试流水线

CLI 端完整测试验收：Layer 1 Regression → Layer 2 Unit → Layer 3 E2E → Layer 4 Code Review → Layer 5 Manual Checklist。全部 blocking，任一层失败则停止并报告。

**Announce at start:** "正在启动 BotoolAgent 5 层分层测试流水线..."

---

## 参数解析

如果用户提供了参数（如 `/botoolagent-testing 3`），将第一个数字参数作为 `startLayer`，表示从第 N 层开始执行。
默认值：`startLayer=1`（从头执行全部 5 层）。

用法示例：
- `/botoolagent-testing` — 执行全部 5 层
- `/botoolagent-testing 3` — 从 Layer 3 (E2E) 开始执行
- `/botoolagent-testing 4` — 只执行 Layer 4 (Code Review) 和 Layer 5 (Manual)

---

## Step 0: 前置检查

依次执行以下检查，任一失败则**停止并告知用户**。

### 0a. 检查 prd.json

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

### 0b. 检查 branchName

```bash
grep -o '"branchName": "[^"]*"' prd.json | cut -d'"' -f4
```

**如果 branchName 为空：**
```
错误：prd.json 中缺少 branchName 字段。

恢复建议：在 prd.json 顶层添加 "branchName": "your-branch-name"
```
Then stop here.

### 0c. 自动检测项目目录

```bash
# 检测 viewer 目录（用于 typecheck/lint/test）
if [ -d "BotoolAgent/viewer" ]; then
  VIEWER_DIR="BotoolAgent/viewer"
elif [ -d "viewer" ]; then
  VIEWER_DIR="viewer"
else
  VIEWER_DIR="."
fi
echo "项目目录: $VIEWER_DIR"
```

**前置检查通过后，告知用户：** "前置检查通过，开始执行 5 层分层测试..."

并显示测试计划：
```
测试计划:
  Layer 1 — Regression: TypeCheck + Lint
  Layer 2 — Unit Tests: npm test
  Layer 3 — E2E Tests: Playwright
  Layer 4 — Code Review: Claude 审查 git diff
  Layer 5 — Manual Checklist: 人工验收项
```

---

## Layer 1 — Regression (TypeCheck + Lint)

**跳过条件：** `startLayer > 1` 时跳过此层。

### 1a. TypeCheck

```bash
cd "$VIEWER_DIR" && npx tsc --noEmit
```

**如果 TypeCheck 失败：**
```
Layer 1 FAILED: TypeCheck 失败

错误摘要:
<列出前 20 行错误>

恢复建议：
- 修复上述类型错误
- 重新运行 /botoolagent-testing
```
Then stop here. Do NOT proceed to Layer 2.

### 1b. Lint

检测项目中是否有 lint 脚本：

```bash
cd "$VIEWER_DIR" && cat package.json | python3 -c "import sys,json; scripts=json.load(sys.stdin).get('scripts',{}); print('lint' if 'lint' in scripts else 'none')"
```

**如果有 lint 脚本：**
```bash
cd "$VIEWER_DIR" && npm run lint
```

**如果 Lint 失败：**
```
Layer 1 FAILED: Lint 失败

错误摘要:
<列出 lint 错误>

恢复建议：
- 运行 npm run lint 查看完整输出
- 修复 lint 错误后重新运行 /botoolagent-testing
```
Then stop here. Do NOT proceed to Layer 2.

**如果没有 lint 脚本：** 跳过 Lint，记录 "Lint: 跳过（未配置 lint 脚本）"。

**Layer 1 通过后，告知用户：** "Layer 1 Regression 通过 (TypeCheck + Lint)"

---

## Layer 2 — Unit Tests

**跳过条件：** `startLayer > 2` 时跳过此层。

检测项目中是否有测试脚本：

```bash
cd "$VIEWER_DIR" && cat package.json | python3 -c "
import sys, json
scripts = json.load(sys.stdin).get('scripts', {})
if 'test:unit' in scripts:
    print('test:unit')
elif 'test' in scripts:
    print('test')
else:
    print('none')
"
```

**如果有测试脚本：**
```bash
cd "$VIEWER_DIR" && npm run <detected_script>
```

其中 `<detected_script>` 为 `test:unit` 或 `test`（优先使用 `test:unit`）。

**如果没有测试脚本：**
```
Layer 2: 跳过（未检测到 test 或 test:unit 脚本）
```
记录跳过并继续 Layer 3。

**如果测试失败：**
```
Layer 2 FAILED: 单元测试失败

失败的测试:
<列出失败的测试名>

恢复建议：
- 运行 npm test 查看完整输出
- 修复失败的测试后重新运行 /botoolagent-testing
```
Then stop here. Do NOT proceed to Layer 3.

**Layer 2 通过后，告知用户：** "Layer 2 Unit Tests 通过"

---

## Layer 3 — E2E Tests

**跳过条件：** `startLayer > 3` 时跳过此层。

检测是否有 Playwright 配置：

```bash
# 检测 Playwright 配置
ls playwright.config.* 2>/dev/null || ls "$VIEWER_DIR/playwright.config."* 2>/dev/null
```

同时检测 package.json 中的 E2E 脚本：

```bash
cd "$VIEWER_DIR" && cat package.json | python3 -c "
import sys, json
scripts = json.load(sys.stdin).get('scripts', {})
if 'test:e2e' in scripts:
    print('test:e2e')
elif 'e2e' in scripts:
    print('e2e')
else:
    print('none')
"
```

**如果有 E2E 脚本：**
```bash
cd "$VIEWER_DIR" && npm run <detected_e2e_script>
```

**如果没有 E2E 脚本但有 Playwright 配置：**
```bash
cd "$VIEWER_DIR" && npx playwright test
```

**如果既没有 E2E 脚本也没有 Playwright 配置：**
```
Layer 3: 跳过（未检测到 E2E 测试配置）
```
记录跳过并继续 Layer 4。

**如果 E2E 测试失败：**
```
Layer 3 FAILED: E2E 测试失败

失败摘要:
<列出失败的测试>

恢复建议：
- 运行 npx playwright test 查看完整输出
- 运行 npx playwright show-report 查看测试报告
- 修复失败的测试后重新运行 /botoolagent-testing 3
```
Then stop here. Do NOT proceed to Layer 4.

**Layer 3 通过后，告知用户：** "Layer 3 E2E Tests 通过"

---

## Layer 4 — Code Review

**跳过条件：** `startLayer > 4` 时跳过此层。

### 4a. 获取 git diff

```bash
git diff main...HEAD
```

**如果 diff 为空（无改动）：**
```
Layer 4: 跳过（没有相对于 main 的代码改动）
```
记录跳过并继续 Layer 5。

### 4b. Claude 审查

将 diff 内容发送给 Claude 进行代码审查。使用以下 prompt：

```
请审查以下 git diff，分析代码质量。按 HIGH / MEDIUM / LOW 三个级别列出问题：

- HIGH: 严重问题（安全漏洞、数据丢失风险、逻辑错误）
- MEDIUM: 中等问题（性能问题、缺少错误处理、代码风格严重不一致）
- LOW: 轻微问题（命名建议、代码风格微调、注释缺失）

如果没有严重问题，输出"审查通过"。

---

<diff 内容>
```

### 4c. 判断审查结果

- **如果审查结果包含 HIGH 级别问题：**
```
Layer 4 FAILED: Code Review 发现严重问题

HIGH 级别问题:
<列出所有 HIGH 级别问题>

恢复建议：
- 修复上述 HIGH 级别问题
- 重新运行 /botoolagent-testing 4
```
Then stop here. Do NOT proceed to Layer 5.

- **如果只有 MEDIUM / LOW 问题或无问题：**
输出审查摘要（包含 MEDIUM/LOW 建议），继续 Layer 5。

**Layer 4 通过后，告知用户：** "Layer 4 Code Review 通过"，并输出审查摘要。

---

## Layer 5 — Manual Checklist

### 5a. 提取手动验收项

从 prd.json 中提取所有 `type: "manual"` 的 testCases：

```bash
python3 -c "
import json
data = json.load(open('prd.json'))
manual_items = []
for dt in data.get('devTasks', []):
    for tc in dt.get('testCases', []):
        if tc.get('type') == 'manual':
            manual_items.append({'task': dt['id'], 'desc': tc.get('desc', '手动验证项')})
if manual_items:
    for item in manual_items:
        print(f'[{item[\"task\"]}] {item[\"desc\"]}')
else:
    print('NONE')
"
```

### 5b. 如果没有手动验收项

```
Layer 5: 跳过（prd.json 中没有 type: manual 的 testCases）
```
记录跳过并进入最终总结。

### 5c. 如果有手动验收项

列出所有手动验收项，逐条询问用户确认：

```
Layer 5 — 手动验收 Checklist

以下项目需要您手动验证：

1. [DT-001] 动画流畅无卡顿
2. [DT-003] 页面布局在移动端正常
3. ...

请逐条确认是否通过。
```

对每一项使用 **AskUserQuestion** 询问：

```
手动验收 #1: [DT-001] 动画流畅无卡顿

请确认此项是否通过？(y/n)
```

- **如果用户回答 n（不通过）：**
```
Layer 5 FAILED: 手动验收未通过

未通过项:
- [DT-001] 动画流畅无卡顿

恢复建议：
- 修复上述问题
- 重新运行 /botoolagent-testing 5
```
Then stop here.

- **如果全部通过：**

**Layer 5 通过后，告知用户：** "Layer 5 Manual Checklist 全部通过"

---

## 最终总结

全部 5 层通过后，输出总结：

```
BotoolAgent 5 层分层测试 — 全部通过!

  Layer 1 — Regression:     通过 (TypeCheck + Lint)
  Layer 2 — Unit Tests:     通过 / 跳过
  Layer 3 — E2E Tests:      通过 / 跳过
  Layer 4 — Code Review:    通过 (无 HIGH 级别问题)
  Layer 5 — Manual Checklist: 通过 / 跳过

下一步：运行 /botoolagent-finalize 完成合并流程
```

---

## 支持的参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| startLayer | 从第 N 层开始执行（跳过之前的层） | 1 |

用法：`/botoolagent-testing 3`（从 Layer 3 E2E Tests 开始执行）

---

## 错误恢复速查表

| 层级 | 错误 | 恢复建议 |
|------|------|----------|
| 前置 | prd.json 不存在 | 运行 `/botoolagent-prd2json` 先生成 |
| 前置 | branchName 缺失 | 在 prd.json 中添加 branchName 字段 |
| Layer 1 | TypeCheck 失败 | 修复类型错误，重新运行 `/botoolagent-testing` |
| Layer 1 | Lint 失败 | 修复 lint 错误，重新运行 `/botoolagent-testing` |
| Layer 2 | 单元测试失败 | 修复测试，重新运行 `/botoolagent-testing 2` |
| Layer 3 | E2E 测试失败 | 查看 playwright report，修复后运行 `/botoolagent-testing 3` |
| Layer 4 | Code Review 有 HIGH 问题 | 修复严重问题，重新运行 `/botoolagent-testing 4` |
| Layer 5 | 手动验收未通过 | 修复对应问题，重新运行 `/botoolagent-testing 5` |

---

## 与 Viewer 对齐

CLI 的 5 层测试对应 Viewer Stage 4 的分层验收：

| CLI Layer | Viewer Layer | 说明 |
|-----------|-------------|------|
| Layer 1 — Regression | 全量回归 | TypeCheck + Lint |
| Layer 2 — Unit Tests | 单元测试 | npm test / npm run test:unit |
| Layer 3 — E2E Tests | E2E 测试 | npx playwright test |
| Layer 4 — Code Review | Code Review | git diff → Claude 审查 |
| Layer 5 — Manual Checklist | 手动验收 | prd.json 中 type: manual 的 testCases |

**行为一致性：**
- 两端都从 prd.json 读取 testCases
- 两端都按 5 层顺序执行，任一层失败则停止
- Layer 2/3 在没有对应 testCases 或脚本时自动跳过
- Layer 5 无 manual testCases 时自动跳过
- 全部通过后，CLI 提示运行 `/botoolagent-finalize`，Viewer 自动创建 PR 并跳转 Stage 5
