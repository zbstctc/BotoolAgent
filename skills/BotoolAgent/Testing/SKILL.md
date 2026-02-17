---
name: botoolagent-testing
description: "Run the 4-layer automated verification pipeline for BotoolAgent projects. Use when development is complete and you need to verify quality before merging. Triggers on: run tests, verify, test my code, start testing, run verification."
user-invocable: true
---

# BotoolAgent 4 层自动化测试流水线

CLI 端自动化测试验收：Layer 1 Regression → Layer 2 Unit → Layer 3 E2E → Layer 4 Code Review。全部自动化，通过后直接进入 finalize。

**核心升级：Ralph 弹性迭代 + Agent Teams 并行修复。** 遇到错误不停止，自动修复后重跑，直到通过或断路器触发。

**Announce at start:** "正在启动 BotoolAgent 4 层自动化测试流水线（Ralph 迭代模式）..."

---

## 参数解析

如果用户提供了参数（如 `/botoolagent-testing 3`），将第一个数字参数作为 `startLayer`，表示从第 N 层开始执行。
默认值：`startLayer=1`（从头执行全部 4 层）。

用法示例：
- `/botoolagent-testing` — 执行全部 4 层
- `/botoolagent-testing 3` — 从 Layer 3 (E2E) 开始执行
- `/botoolagent-testing 4` — 只执行 Layer 4 (Code Review)

---

## Step 0: 项目选择 + 前置检查

### 项目选择（多 PRD 模式）

检查 `tasks/registry.json`（或 `BotoolAgent/tasks/registry.json`）是否存在：
- 如果存在且有多个项目 → 用 AskUserQuestion 列出项目让用户选择
- 选择后，使用 `tasks/prd-{projectId}.json` 作为 prd.json 路径
- 如果不存在 registry 或只有一个项目 → 直接读根目录 `prd.json`（向后兼容）

### 前置检查

依次执行以下检查，任一失败则**停止并告知用户**。

### 0a. 检查 prd.json

```bash
# 如果选定了 projectId，检查 tasks/prd-{projectId}.json
# 否则检查根目录 prd.json
ls prd.json 2>/dev/null
```

**如果 prd.json 不存在：**
```
错误：未找到 prd.json。

恢复建议：
- 运行 /botoolagent-prd2json 从 PRD 文档生成
- 或通过 Viewer http://localhost:3100/stage2 完成 Stage 2
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
# 检测项目目录（优先项目根目录的 package.json，兼容 standalone 和 portable 模式）
if [ -f "package.json" ]; then
  PROJECT_DIR="."
elif [ -f "viewer/package.json" ]; then
  PROJECT_DIR="viewer"
else
  PROJECT_DIR="."
fi
echo "项目目录: $PROJECT_DIR"
```

**前置检查通过后，告知用户：** "前置检查通过，开始执行 4 层自动化测试（Ralph 迭代模式）..."

并显示测试计划：
```
测试计划:
  Layer 1 — Regression: TypeCheck + Lint （自动修复）
  Layer 2 — Unit Tests: npm test （自动修复）
  Layer 3 — E2E Tests: Playwright （自动修复）
  Layer 4 — Code Review: Claude 审查 git diff （自动修复 HIGH）
```

---

## 自动修复规则（Ralph 迭代模式）

借鉴 BotoolAgent.sh 的 Ralph 弹性迭代模式，Testing 流水线遇到错误时
**不立即停止**，而是自动尝试修复：

### 单文件修复（默认）
1. 分析错误输出，定位问题文件和原因
2. 直接修改代码修复问题
3. 重新运行该层检查命令
4. **持续循环直到通过**

### 多文件并行修复（Agent Teams 模式）
当一层发现 **3 个以上不同文件** 有错误时，启用 Agent Teams 并行修复：
1. 按文件分组错误
2. 使用 Task 工具并行启动多个修复 agent，每个 agent 负责一组文件
   - subagent_type: `general-purpose`
   - 每个 agent 的 prompt 包含：错误信息、文件路径、修复指示
3. 等待所有 agent 完成
4. 重新运行该层检查命令
5. **持续循环直到通过**

### 修复后提交

每层 Ralph 修复循环通过后，必须提交修复代码，避免 Finalize 推送时遗漏：
```bash
git add <修改的文件>
git commit -m "fix(testing): auto-fix Layer N errors"
```

### Circuit Breaker（断路器）
不设固定重试上限。持续修复直到通过，但有安全机制：

- **无进展检测**：如果连续 3 次修复尝试后，错误数量和内容**完全没变化** → 触发断路器
- **断路器触发后**：不是停止，而是用 AskUserQuestion 问用户：
  1. 提供当前无法解决的错误详情
  2. 让用户选择：手动修复后继续 / 跳过此层继续下一层 / 终止测试
  3. 拿到用户指示后继续执行
- **warnings 不阻塞**：只记录，不触发修复流程
- **手动验收已移出**：不在 testing 流水线中执行，用户可在 finalize 前自行验证

---

## Layer 1 — Regression (TypeCheck + Lint)

**跳过条件：** `startLayer > 1` 时跳过此层。

### 1a. TypeCheck

```bash
cd "$PROJECT_DIR" && npx tsc --noEmit
```

**如果 TypeCheck 通过：** 继续 Layer 1b。

**如果 TypeCheck 失败（Ralph 自动修复）：**

Ralph 修复循环（持续直到通过或断路器触发）：

1. 分析 tsc 错误输出，提取错误文件列表和具体错误
2. 如果错误涉及 **≤ 3 个文件**：直接逐个修复
3. 如果错误涉及 **> 3 个文件**：使用 Task 工具并行修复
   - 按文件分组错误
   - 每组启动一个修复 agent（subagent_type: `general-purpose`）
   - agent prompt: "修复以下 TypeScript 编译错误：\n{错误详情}\n文件路径：{path}\n只修改这个文件，修复所有列出的 TS 错误。"
   - 等待全部完成
4. 重新运行 `cd "$PROJECT_DIR" && npx tsc --noEmit`
5. 如果通过 → 继续 Layer 1b
6. 如果错误没变化（连续 3 次无进展）→ Circuit Breaker → AskUserQuestion：
   ```
   TypeCheck 自动修复无进展。以下错误无法自动解决：
   <错误列表>

   选项：
   1. 我来手动修复，修好后继续
   2. 跳过 TypeCheck，继续 Lint 检查
   3. 终止测试
   ```

常见修复模式：
- TS2322 类型不匹配 → 修正类型注解或类型断言
- TS6133 未使用变量 → 删除或前缀 _
- TS2339 属性不存在 → 更新接口定义
- TS2307 找不到模块 → 修正导入路径

### 1b. Lint

检测项目中是否有 lint 脚本：

```bash
cd "$PROJECT_DIR" && node -e "const s=JSON.parse(require('fs').readFileSync('package.json','utf8')).scripts||{}; console.log(s.lint?'lint':'none')"
```

**如果没有 lint 脚本：** 跳过 Lint，记录 "Lint: 跳过（未配置 lint 脚本）"。

**如果有 lint 脚本：**
```bash
cd "$PROJECT_DIR" && npm run lint
```

**如果 Lint 通过（或只有 warnings）：** 记录 warnings，继续 Layer 2。

**如果 Lint 失败（Ralph 自动修复）：**

Ralph 修复循环（持续直到通过或断路器触发）：

1. 首先尝试自动修复命令：
   ```bash
   cd "$PROJECT_DIR" && npx eslint --fix .
   ```
2. 重新运行 `cd "$PROJECT_DIR" && npm run lint`
3. 如果仍有 errors（忽略 warnings）：
   - 分析每个 error 的类型和文件
   - 如果 **≤ 3 文件**：直接修复
   - 如果 **> 3 文件**：Agent Teams 并行修复
     - 每个 agent（subagent_type: `general-purpose`）：
     - prompt: "修复以下 ESLint 错误：\n{错误详情}\n文件路径：{path}\n只修改这个文件。"
4. 重新运行 `cd "$PROJECT_DIR" && npm run lint`
5. 如果只剩 warnings → 通过（记录 warnings）
6. 如果错误没变化（连续 3 次无进展）→ Circuit Breaker → AskUserQuestion：
   ```
   Lint 自动修复无进展。以下错误无法自动解决：
   <错误列表>

   选项：
   1. 我来手动修复，修好后继续
   2. 跳过 Lint，继续 Layer 2
   3. 终止测试
   ```

常见修复模式：
- no-unused-vars → 删除或前缀 _
- no-require-imports → 改为 ES import
- prefer-const → let 改 const
- react/no-unescaped-entities → 使用 HTML 实体
- react-hooks/exhaustive-deps → 补全依赖数组
- @next/next/no-img-element → 改为 next/image

**Layer 1 通过后，告知用户：** "Layer 1 Regression 通过 (TypeCheck + Lint)"

---

## Layer 2 — Unit Tests

**跳过条件：** `startLayer > 2` 时跳过此层。

检测项目中是否有测试脚本：

```bash
cd "$PROJECT_DIR" && node -e "const s=JSON.parse(require('fs').readFileSync('package.json','utf8')).scripts||{}; console.log(s['test:unit']?'test:unit':s.test?'test':'none')"
```

**如果没有测试脚本：**
```
Layer 2: 跳过（未检测到 test 或 test:unit 脚本）
```
记录跳过并继续 Layer 3。

**如果有测试脚本：**
```bash
cd "$PROJECT_DIR" && npm run <detected_script>
```

其中 `<detected_script>` 为 `test:unit` 或 `test`（优先使用 `test:unit`）。

**如果测试通过：** 继续 Layer 3。

**如果单元测试失败（Ralph 自动修复）：**

Ralph 修复循环（持续直到通过或断路器触发）：

1. 分析测试输出（期望值 vs 实际值、错误堆栈）
2. 判断根因并修复：
   - 断言不匹配 → 检查实现逻辑，修复 bug 或更新期望值
   - mock 问题 → 修复 mock 配置
   - 导入错误 → 修复路径
   - 环境问题 → 修复 setup/teardown
3. 如果涉及多个测试文件 **> 3 个**：Agent Teams 并行修复
   - 每个 agent（subagent_type: `general-purpose`）：
   - prompt: "修复以下单元测试失败：\n{测试名 + 错误信息}\n文件路径：{path}\n分析根因并修复。"
4. 重新运行 `cd "$PROJECT_DIR" && npm run <detected_script>`
5. 如果错误没变化（连续 3 次无进展）→ Circuit Breaker → AskUserQuestion：
   ```
   单元测试自动修复无进展。以下测试持续失败：
   <失败测试列表>

   选项：
   1. 我来手动修复，修好后继续
   2. 跳过 Unit Tests，继续 Layer 3
   3. 终止测试
   ```

**Layer 2 通过后，告知用户：** "Layer 2 Unit Tests 通过"

---

## Layer 3 — E2E Tests

**跳过条件：** `startLayer > 3` 时跳过此层。

### 3a. 环境清理 + 健康检查（E2E 前置）

E2E 测试依赖 dev server，必须先确保环境干净：

```bash
# 1. 杀掉残留的 Playwright 测试进程（避免端口/锁冲突）
pkill -f "playwright test" 2>/dev/null || true

# 2. 检查 dev server 是否在运行且健康
curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3100
```

**处理逻辑：**
- HTTP 200 → dev server 健康，继续
- 超时或非 200 → dev server 假死或未运行，需要重启：
  ```bash
  # 杀掉假死的 dev server
  lsof -ti :3100 | xargs kill -9 2>/dev/null || true
  sleep 2
  # Playwright config 中的 webServer 会自动启动，无需手动启动
  ```
- 如果杀掉后仍无法启动（端口仍被占用）→ AskUserQuestion 让用户排查

### 3b. 检测 E2E 配置

检测是否有 Playwright 配置：

```bash
# 检测 Playwright 配置
ls playwright.config.* 2>/dev/null || ls "$PROJECT_DIR/playwright.config."* 2>/dev/null
```

同时检测 package.json 中的 E2E 脚本：

```bash
cd "$PROJECT_DIR" && node -e "const s=JSON.parse(require('fs').readFileSync('package.json','utf8')).scripts||{}; console.log(s['test:e2e']?'test:e2e':s.e2e?'e2e':'none')"
```

**如果既没有 E2E 脚本也没有 Playwright 配置：**
```
Layer 3: 跳过（未检测到 E2E 测试配置）
```
记录跳过并继续 Layer 4。

**如果有 E2E 脚本：**
```bash
cd "$PROJECT_DIR" && npm run <detected_e2e_script>
```

**如果没有 E2E 脚本但有 Playwright 配置：**
```bash
cd "$PROJECT_DIR" && npx playwright test
```

**如果 E2E 测试通过：** 继续 Layer 4。

**如果 E2E 测试失败（Ralph 自动修复）：**

Ralph 修复循环（持续直到通过或断路器触发）：

1. 分析 Playwright 错误（元素未找到、超时、断言失败）
2. 修复：
   - 选择器过期 → 更新选择器
   - 超时 → 增加等待时间或添加 waitFor
   - 状态问题 → 修复 setup/teardown
   - 实现 bug → 修复源码
3. 只重跑失败的测试（不跑全套）：
   ```bash
   cd "$PROJECT_DIR" && npx playwright test --grep "<failed_test_name>"
   ```
4. 如果错误没变化（连续 3 次无进展）→ Circuit Breaker → AskUserQuestion：
   ```
   E2E 测试自动修复无进展。以下测试持续失败：
   <失败测试列表>

   选项：
   1. 我来手动修复，修好后继续
   2. 跳过 E2E Tests，继续 Layer 4
   3. 终止测试
   ```

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
记录跳过并继续最终总结。

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

- **如果只有 MEDIUM / LOW 问题或无问题：**
输出审查摘要（包含 MEDIUM/LOW 建议），继续最终总结。

- **如果有 HIGH 级别问题（Ralph 自动修复）：**

Ralph 修复循环（持续直到通过或断路器触发）：

1. 逐个分析 HIGH 问题
2. 按类型修复：
   - 安全漏洞（SQL 注入）→ 加参数化查询
   - 安全漏洞（XSS）→ 加转义/sanitize
   - 数据丢失风险 → 加事务/备份检查
   - 逻辑错误 → 修复逻辑
3. 如果涉及多文件 **> 3 个**：Agent Teams 并行修复
   - 每个 agent（subagent_type: `general-purpose`）：
   - prompt: "修复以下 Code Review HIGH 问题：\n{问题描述}\n文件路径：{path}\n只修改这个文件。"
4. 修复后重新运行 Code Review（重新获取 diff 并审查）
5. 如果错误没变化（连续 3 次无进展）→ Circuit Breaker → AskUserQuestion：
   ```
   Code Review HIGH 问题自动修复无进展。以下问题无法自动解决：
   <HIGH 问题列表>

   选项：
   1. 我来手动修复，修好后继续
   2. 跳过 Code Review，继续最终总结
   3. 终止测试
   ```

**Layer 4 通过后，告知用户：** "Layer 4 Code Review 通过"，并输出审查摘要。

---

## 最终总结

全部 4 层自动化测试通过后，输出总结：

```
BotoolAgent 4 层自动化测试 — 全部通过!

  Layer 1 — Regression:   通过 (TypeCheck + Lint)
  Layer 2 — Unit Tests:   通过 / 跳过
  Layer 3 — E2E Tests:    通过 / 跳过
  Layer 4 — Code Review:  通过 (无 HIGH 级别问题)

  自动修复统计:
  - TypeCheck: N 轮修复 / 直接通过
  - Lint: N 轮修复 / 直接通过 / eslint --fix 一次通过
  - Unit Tests: N 轮修复 / 直接通过 / 跳过
  - E2E Tests: N 轮修复 / 直接通过 / 跳过
  - Code Review: N 轮修复 / 直接通过

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

| 层级 | 错误 | 处理方式 |
|------|------|----------|
| 前置 | prd.json 不存在 | 停止，提示运行 `/botoolagent-prd2json` |
| 前置 | branchName 缺失 | 停止，提示添加字段 |
| Layer 1 | TypeCheck 失败 | **Ralph 自动修复** → 修不好才问用户 |
| Layer 1 | Lint 失败 | **eslint --fix → Ralph 自动修复** → 修不好才问用户 |
| Layer 2 | 单元测试失败 | **Ralph 自动修复** → 修不好才问用户 |
| Layer 3 | E2E 测试失败 | **Ralph 自动修复** → 修不好才问用户 |
| Layer 4 | Code Review 有 HIGH | **Ralph 自动修复** → 修不好才问用户 |

---

## 与 Viewer 对齐

CLI 的 4 层自动化测试对应 Viewer Stage 4 的分层验收：

| CLI Layer | Viewer Layer | 说明 |
|-----------|-------------|------|
| Layer 1 — Regression | 全量回归 | TypeCheck + Lint |
| Layer 2 — Unit Tests | 单元测试 | npm test / npm run test:unit |
| Layer 3 — E2E Tests | E2E 测试 | npx playwright test |
| Layer 4 — Code Review | Code Review | git diff → Claude 审查 |

**手动验收（Manual Checklist）已移出 testing 流水线**，用户可在 finalize 前自行验证。

**行为一致性：**
- 两端都从 prd.json 读取 testCases
- CLI 4 层全自动（Ralph 自动修复）：失败不停止，自动修 → 重跑 → 超限才问用户
- Layer 2/3 在没有对应 testCases 或脚本时自动跳过
- 全部通过后，CLI 直接提示运行 `/botoolagent-finalize`
