---
name: botoolagent-testing
description: "Run the 6-layer automated verification pipeline for BotoolAgent projects. Use when development is complete and you need to verify quality before merging. Triggers on: run tests, verify, test my code, start testing, run verification."
user-invocable: true
---

# BotoolAgent 6 层自动化测试流水线

CLI 端自动化测试验收：Layer 1 Regression → Layer 2 Unit → Layer 3 E2E → Layer 4 Code Review → Layer 5 Codex 红队审查 → Layer 6 PR 创建 + Claude Review 守门。全部自动化，通过后直接进入 finalize。

**核心升级：Ralph 弹性迭代 + Agent Teams 并行修复 + Codex 红队对抗审查。** 遇到错误不停止，自动修复后重跑，直到通过或断路器触发。

**Announce at start:** "正在启动 BotoolAgent 6 层自动化测试流水线（Ralph 迭代模式 + Codex 对抗审查）..."

---

## 参数解析

如果用户提供了参数（如 `/botoolagent-testing 3`），将第一个数字参数作为 `startLayer`，表示从第 N 层开始执行。
默认值：`startLayer=1`（从头执行全部 6 层）。

用法示例：
- `/botoolagent-testing` — 执行全部 6 层
- `/botoolagent-testing 3` — 从 Layer 3 (E2E) 开始执行
- `/botoolagent-testing 5` — 从 Layer 5 (Codex 红队审查) 开始执行

---

## 运行模式检测

在执行任何操作之前，检测运行环境：

```bash
NON_INTERACTIVE=${CLAUDE_CODE_NON_INTERACTIVE:-0}
```

**如果 `NON_INTERACTIVE=1`（Viewer 模式）：**
- 所有 Circuit Breaker 触发时，**自动选择"跳过此层，继续下一层"**，不调用 AskUserQuestion
- 将该层 status 记录为 `skipped`，reason 为 `circuit_breaker: 2 轮无进展，Viewer 自动跳过`
- E2E / Unit / TypeCheck 等失败详情仍需完整记录到报告文件

---

## Step 0: 项目选择 + 前置检查

### 项目选择（多 PRD 模式）

检查 `tasks/registry.json`（或 `BotoolAgent/tasks/registry.json`）是否存在：
- 如果存在且有多个项目 → 用 AskUserQuestion 列出项目让用户选择
- 选择后，设置 `PRD_PATH="tasks/${PROJECT_ID}/prd.json"`
- 如果不存在 registry 或只有一个项目 → 设置 `PRD_PATH="prd.json"`（向后兼容）

### 前置检查

依次执行以下检查，任一失败则**停止并告知用户**。

### 0a. 检查 prd.json

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

### 0b. 检查 branchName

```bash
grep -o '"branchName": "[^"]*"' "$PRD_PATH" | cut -d'"' -f4
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

**前置检查通过后，告知用户：** "前置检查通过，开始执行 6 层自动化测试（Ralph 迭代模式 + Codex 对抗审查）..."

并显示测试计划：
```
测试计划:
  Layer 1 — Regression: TypeCheck + Lint （自动修复）
  Layer 2 — Unit Tests: npm test （自动修复）
  Layer 3 — E2E Tests: Playwright （自动修复）
  Layer 4 — Code Review: Claude 审查 git diff （自动修复 HIGH）
  Layer 5 — Codex 红队审查: Codex 对抗审查 （对抗循环 ≤ 3 轮）
  Layer 6 — PR 创建 + Claude Review 守门 （Claude Review 修复循环 ≤ 2 轮）
```

---

## 自动修复规则（Ralph 迭代模式 + 根因分析）

借鉴 BotoolAgent.sh 的 Ralph 弹性迭代模式，Testing 流水线遇到错误时
**不立即停止**，而是自动尝试修复。**核心改进：按信号清晰度分档，避免试错式修复。**

### 信号清晰度判断（每次修复循环前必须执行）

收到错误信息后，先判断信号清晰度：

```
信号清晰（同时满足以下全部条件）：
  ✓ 有 file:line:errorCode（精确定位）
  ✓ 错误数 < 5 个
  ✓ 错误类型 < 3 种
  → 跳过根因分析，直接修复

信号模糊（满足以下任一条件）：
  ✗ 只有症状描述，无 file:line:errorCode
  ✗ 错误数 >= 5 个
  ✗ 错误类型 >= 3 种
  → 执行三阶段根因分析
```

### 三阶段根因分析（信号模糊时）

**Phase 1 — 根因诊断**：将错误分类为以下三种之一：
- **独立错误**：每个错误互不相关，各自有独立原因
- **级联错误**：一个根因导致多个下游错误（例如一个 interface 定义错误导致 10+ 个 TS 编译错误）
- **环境问题**：非代码问题（mock 配置、依赖版本、dev server 状态等）

**Phase 2 — 制定修复方案**：
- 级联错误 → **优先修复根因**（修一个可能消除多个下游错误）
- 独立错误 → 按严重程度逐个修复
- 环境问题 → 修复环境配置而非代码

**Phase 3 — 执行修复**：按方案执行，然后重跑检查。

### 单文件修复（默认）
1. **执行信号清晰度判断**
2. 信号清晰 → 直接定位修复
3. 信号模糊 → 三阶段根因分析后修复
4. 重新运行该层检查命令
5. **持续循环直到通过**

### 多文件并行修复（Agent Teams 模式）
当一层发现 **3 个以上不同文件** 有错误时，启用 Agent Teams 并行修复：
1. **执行信号清晰度判断**（信号模糊时先完成根因分析再分派）
2. 按文件分组错误（级联错误的根因文件优先修复）
3. 使用 Task 工具并行启动多个修复 agent，每个 agent 负责一组文件
   - subagent_type: `general-purpose`
   - 每个 agent 的 prompt 包含：错误信息、文件路径、修复指示、**根因分析结论**
4. 等待所有 agent 完成
5. 重新运行该层检查命令
6. **持续循环直到通过**

### 修复后提交

每层 Ralph 修复循环通过后，必须提交修复代码，避免 Finalize 推送时遗漏：
```bash
git add <修改的文件>
git commit -m "fix(testing): auto-fix Layer N errors"
```

### Circuit Breaker（断路器）
不设固定重试上限。持续修复直到通过，但有安全机制：

- **无进展检测**：如果连续 **2 次**修复尝试后，错误数量和内容**完全没变化** → 触发断路器
- **断路器触发后**：不是停止，而是用 AskUserQuestion 问用户：
  1. 提供当前无法解决的错误详情
  2. 附带根因分析结论（如果执行过）
  3. 让用户选择：手动修复后继续 / 跳过此层继续下一层 / 终止测试
  4. 拿到用户指示后继续执行
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

**如果 TypeCheck 失败（Ralph 自动修复 + 根因分析）：**

Ralph 修复循环（持续直到通过或断路器触发）：

1. 分析 tsc 错误输出，提取错误文件列表和具体错误
2. **信号清晰度判断**：
   - tsc 输出天然有 file:line:errorCode → 检查错误数量和类型种数
   - **信号清晰**（< 5 个错误，类型 < 3 种）→ 直接修复
   - **信号模糊**（>= 5 个错误，或 >= 3 种类型）→ 三阶段根因分析：
     - **Phase 1 根因诊断 — TypeCheck 特化重点：级联 vs 独立错误**
       - 检查是否有 interface/type 定义错误导致下游级联（一个类型改动引发 N 个使用处报错）
       - 区分：独立的类型错误 vs 由共享 interface/type 导致的级联错误
     - **Phase 2 制定方案**：级联错误 → **优先修 interface/type 定义**（根因），可能一次消除多个下游错误
     - **Phase 3 执行修复**
3. 如果错误涉及 **≤ 3 个文件**：直接逐个修复
4. 如果错误涉及 **> 3 个文件**：使用 Task 工具并行修复
   - 按文件分组错误（级联根因文件优先）
   - 每组启动一个修复 agent（subagent_type: `general-purpose`）
   - agent prompt: "修复以下 TypeScript 编译错误：\n{错误详情}\n文件路径：{path}\n根因分析：{分析结论}\n只修改这个文件，修复所有列出的 TS 错误。"
   - 等待全部完成
5. 重新运行 `cd "$PROJECT_DIR" && npx tsc --noEmit`
6. 如果通过 → 继续 Layer 1b
7. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker：

   **如果 `NON_INTERACTIVE=1`（Viewer 模式）：** 自动跳过 TypeCheck，继续 Lint 检查，不调用 AskUserQuestion。将该层记录为 `skipped`，reason: `circuit_breaker`。

   **否则** → AskUserQuestion：
   ```
   TypeCheck 自动修复无进展（2 轮无进展）。以下错误无法自动解决：
   <错误列表>
   根因分析结论：<分析结论>

   选项：
   1. 我来手动修复，修好后继续
   2. 跳过 TypeCheck，继续 Lint 检查
   3. 终止测试
   ```

常见修复模式：
- TS2322 类型不匹配 → 修正类型注解或类型断言
- TS6133 未使用变量 → 删除或前缀 _
- TS2339 属性不存在 → 更新接口定义（**高级联风险：检查是否是共享 interface**）
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

**如果 Lint 失败（Ralph 自动修复 + 根因分析）：**

Ralph 修复循环（持续直到通过或断路器触发）：

1. **首先尝试 eslint --fix（Lint 特化：先自动修复再分析）**：
   ```bash
   cd "$PROJECT_DIR" && npx eslint --fix .
   ```
2. 重新运行 `cd "$PROJECT_DIR" && npm run lint`
3. 如果仍有 errors（忽略 warnings）：
   - **信号清晰度判断**：
     - eslint 输出天然有 file:line:rule → 检查错误数量和类型种数
     - **信号清晰**（< 5 个错误，类型 < 3 种）→ 直接修复
     - **信号模糊**（>= 5 个错误，或 >= 3 种类型）→ 三阶段根因分析：
       - **Phase 1 根因诊断 — Lint 特化重点：auto-fixable vs manual-fix**
         - 分类：哪些规则是 eslint --fix 无法处理的（manual-fix）
         - 检查是否有共同模式（如全局配置缺失导致批量报错）
       - **Phase 2 制定方案**：优先处理可能是配置问题的批量错误，再处理 manual-fix
       - **Phase 3 执行修复**
   - 如果 **≤ 3 文件**：直接修复
   - 如果 **> 3 文件**：Agent Teams 并行修复
     - 每个 agent（subagent_type: `general-purpose`）：
     - prompt: "修复以下 ESLint 错误：\n{错误详情}\n文件路径：{path}\n根因分析：{分析结论}\n只修改这个文件。"
4. 重新运行 `cd "$PROJECT_DIR" && npm run lint`
5. 如果只剩 warnings → 通过（记录 warnings）
6. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker：

   **如果 `NON_INTERACTIVE=1`（Viewer 模式）：** 自动跳过 Lint，继续 Layer 2，不调用 AskUserQuestion。

   **否则** → AskUserQuestion：
   ```
   Lint 自动修复无进展（2 轮无进展）。以下错误无法自动解决：
   <错误列表>
   根因分析结论：<分析结论>

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

**如果单元测试失败（Ralph 自动修复 + 根因分析）：**

Ralph 修复循环（持续直到通过或断路器触发）：

1. 分析测试输出（期望值 vs 实际值、错误堆栈）
2. **信号清晰度判断**：
   - 检查测试输出是否有明确的 file:line + assertion diff
   - **信号清晰**（< 5 个失败测试，类型 < 3 种 — 如全是 assertion 失败）→ 直接修复
   - **信号模糊**（>= 5 个失败测试，或类型混杂）→ 三阶段根因分析：
     - **Phase 1 根因诊断 — Unit Test 特化重点：assertion 失败 vs 环境问题**
       - **assertion 失败**：实现逻辑错误 vs 期望值过期（实现改了但测试没更新）
       - **环境问题**：mock/setup 配置错误、依赖未正确注入、测试间状态泄漏
       - 检查是否有共享 setup/fixture 变更导致多测试级联失败
     - **Phase 2 制定方案**：环境问题 → 优先修 setup/mock 配置（可能一次修好多个测试）；assertion → 判断是修实现还是更新期望
     - **Phase 3 执行修复**
3. 判断根因并修复：
   - 断言不匹配 → 检查实现逻辑，修复 bug 或更新期望值
   - mock 问题 → 修复 mock 配置
   - 导入错误 → 修复路径
   - 环境问题 → 修复 setup/teardown
4. 如果涉及多个测试文件 **> 3 个**：Agent Teams 并行修复
   - 每个 agent（subagent_type: `general-purpose`）：
   - prompt: "修复以下单元测试失败：\n{测试名 + 错误信息}\n文件路径：{path}\n根因分析：{分析结论}\n分析根因并修复。"
5. 重新运行 `cd "$PROJECT_DIR" && npm run <detected_script>`
6. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker：

   **如果 `NON_INTERACTIVE=1`（Viewer 模式）：** 自动跳过 Unit Tests，继续 Layer 3，不调用 AskUserQuestion。

   **否则** → AskUserQuestion：
   ```
   单元测试自动修复无进展（2 轮无进展）。以下测试持续失败：
   <失败测试列表>
   根因分析结论：<分析结论>

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

# 2. 分配测试端口（从 3200 开始动态分配，绝对不使用 3100/3101）
# Port 3100 = 主 Viewer（用户界面，永久保护，禁止 kill）
# Port 3101 = BotoolAgent dev repo Viewer（同样保护）
# Port 3200+ = 测试专用，动态分配
find_free_test_port() {
  local port=3200
  while lsof -i :"$port" &>/dev/null; do
    ((port++))
  done
  echo "$port"
}
TEST_PORT=$(find_free_test_port)
export TEST_PORT

# 3. 检查 test server 端口是否已被占用（正常情况应该是空闲的）
curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:$TEST_PORT
```

**处理逻辑：**
- 端口空闲 → Playwright webServer 会自动在 `$TEST_PORT` 启动 dev server，继续
- 端口被占用（find_free_test_port 已跳过，理论上不会发生）→ 重新调用 `find_free_test_port`

**⚠️ 严禁操作：**
- 禁止 kill port 3100（主 Viewer）
- 禁止 kill port 3101（BotoolAgent dev Viewer）
- 测试完成后只 kill `$TEST_PORT` 上的进程

- 如果所有 3200-3299 端口都被占用 → AskUserQuestion 让用户排查

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

**如果 E2E 测试失败（Ralph 自动修复 + 根因分析）：**

Ralph 修复循环（持续直到通过或断路器触发）：

1. 分析 Playwright 错误（元素未找到、超时、断言失败）
2. **信号清晰度判断**：
   - 检查 Playwright 输出是否有明确的 test name + error type + selector/locator
   - **信号清晰**（< 5 个失败测试，类型 < 3 种）→ 直接修复
   - **信号模糊**（>= 5 个失败测试，或类型混杂 — selector/timeout/assertion 混合）→ 三阶段根因分析：
     - **Phase 1 根因诊断 — E2E 特化重点：三种根因分类**
       - **selector 过期**：页面结构/组件变更导致选择器失效（批量 selector 失败通常是共享组件改动）
       - **实现 bug**：功能逻辑变更导致测试断言失败（检查最近的代码改动）
       - **环境问题**：dev server 未就绪、端口冲突、网络超时、测试间状态泄漏
     - **Phase 2 制定方案**：环境问题 → 先修环境再重跑；selector 过期 → 检查共享组件是否有批量影响；实现 bug → 修源码
     - **Phase 3 执行修复**
3. 修复：
   - 选择器过期 → 更新选择器（检查是否有共享组件批量影响）
   - 超时 → 增加等待时间或添加 waitFor
   - 状态问题 → 修复 setup/teardown
   - 实现 bug → 修复源码
4. 只重跑失败的测试（不跑全套）：
   ```bash
   cd "$PROJECT_DIR" && npx playwright test --grep "<failed_test_name>"
   ```
5. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker：

   **无论何种模式，Circuit Breaker 触发后必须先生成 E2E 失败报告：**

   将失败详情写入 `tasks/{projectId}/e2e-failures.md`：
   ```markdown
   # E2E 测试失败报告

   生成时间：{ISO timestamp}
   项目：{projectId}

   ## 失败摘要

   - 总失败：{n} 个测试
   - 修复尝试：{rounds} 轮，无进展

   ## 失败测试列表

   {每条: - `{test file}` > `{test name}` — {error type}}

   ## 根因分析

   {分析结论（Phase 1-3 的结果）}

   ## 错误详情

   {Playwright 原始错误输出（最多 100 行）}

   ## 修复历史

   {每轮尝试：轮次、修改了哪些文件、重跑结果}
   ```

   **如果 `NON_INTERACTIVE=1`（Viewer 模式）：** 自动跳过 E2E Tests，继续 Layer 4，不调用 AskUserQuestion。
   在 testing-report.json L3 中记录 `status: "skipped"`, `reason: "circuit_breaker"`, `reportFile: "tasks/{projectId}/e2e-failures.md"`。

   **否则** → AskUserQuestion：
   ```
   E2E 测试自动修复无进展（2 轮无进展）。以下测试持续失败：
   <失败测试列表>
   根因分析结论：<分析结论>

   已生成失败报告：tasks/{projectId}/e2e-failures.md

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
2. **信号清晰度判断**（Code Review 的 HIGH 问题通常信号较清晰，但仍需判断）：
   - **信号清晰**（< 5 个 HIGH 问题，类型 < 3 种）→ 直接修复
   - **信号模糊**（>= 5 个 HIGH 问题，或类型混杂）→ 三阶段根因分析：
     - **Phase 1 根因诊断**：检查 HIGH 问题是否有共同根因（如缺少统一的输入验证层）
     - **Phase 2 制定方案**：优先修共同根因（如添加全局 sanitize 中间件），再修独立问题
     - **Phase 3 执行修复**
3. 按类型修复：
   - 安全漏洞（SQL 注入）→ 加参数化查询
   - 安全漏洞（XSS）→ 加转义/sanitize
   - 数据丢失风险 → 加事务/备份检查
   - 逻辑错误 → 修复逻辑
4. 如果涉及多文件 **> 3 个**：Agent Teams 并行修复
   - 每个 agent（subagent_type: `general-purpose`）：
   - prompt: "修复以下 Code Review HIGH 问题：\n{问题描述}\n文件路径：{path}\n根因分析：{分析结论}\n只修改这个文件。"
5. 修复后重新运行 Code Review（重新获取 diff 并审查）
6. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker：

   **如果 `NON_INTERACTIVE=1`（Viewer 模式）：** 自动跳过 Code Review，继续 Layer 5，不调用 AskUserQuestion。

   **否则** → AskUserQuestion：
   ```
   Code Review HIGH 问题自动修复无进展（2 轮无进展）。以下问题无法自动解决：
   <HIGH 问题列表>
   根因分析结论：<分析结论>

   选项：
   1. 我来手动修复，修好后继续
   2. 跳过 Code Review，继续最终总结
   3. 终止测试
   ```

**Layer 4 通过后，告知用户：** "Layer 4 Code Review 通过"，并输出审查摘要。

---

## Layer 5 — Codex 红队对抗审查

**跳过条件：** `startLayer > 5` 时跳过此层。

### 5a. 检测 Codex CLI 可用性

```bash
which codex >/dev/null 2>&1 && echo "codex available" || echo "codex not available"
```

**如果 codex 不可用：**
```
Layer 5: 跳过（codex CLI 未安装。安装方式: npm install -g @openai/codex）
```
记录跳过并继续 Layer 6。

### 5b. 获取 diff 并计算规模

```bash
DIFF_LINES=$(git diff main...HEAD | wc -l | tr -d ' ')
echo "Diff lines: $DIFF_LINES"
```

根据 diff 规模选择审查模式：
- `DIFF_LINES <= 5000` → **全量审查模式**（一次审查全部 diff）
- `DIFF_LINES > 5000` → **分文件审查模式**（逐文件审查后合并 findings）

### 5c. 全量审查模式

**两步法：** `codex exec review` 的 `--base` 参数与自定义 prompt 互斥，因此采用两步法：
1. Codex 以自由文本输出审查结果
2. Claude 解析自由文本，结构化为 JSON

```bash
# 创建临时输出文件
REVIEW_OUTPUT=$(mktemp /tmp/codex-review-XXXXXX.txt)

# Step 1: Codex 审查（自由文本输出）
codex exec review --base main --full-auto 2>&1 | tee "$REVIEW_OUTPUT"
```

**Step 2: Claude 解析 Codex 输出**

读取 `$REVIEW_OUTPUT` 的内容，Claude 自行解析 Codex 的自由文本审查结果，提取每个 finding 并结构化为 `codex-review-schema.json` 格式：

```json
{
  "findings": [
    {
      "severity": "HIGH|MEDIUM|LOW",
      "category": "security|logic|error-handling|test-coverage|style",
      "rule": "rule-identifier",
      "file": "relative/path.ts",
      "line": 42,
      "message": "问题描述",
      "suggestion": "修复建议"
    }
  ]
}
```

解析规则：
- Codex 输出中每个提到具体文件+行号+问题描述的段落 → 一个 finding
- severity 根据问题性质判断：安全漏洞/崩溃=HIGH，逻辑错误/缺失处理=MEDIUM，风格/命名=LOW
- 如果 Codex 输出为空或无法解析 → `{"findings": []}`

### 5d. 分文件审查模式（大 diff 缓解）

当 diff 超过 5000 行时，按文件分批审查：

```bash
# 获取变更文件列表
CHANGED_FILES=$(git diff main...HEAD --name-only)

# 按 10 个文件一批分组，每批运行一次 codex exec review
# 使用 --base main 审查指定文件
for batch in $(echo "$CHANGED_FILES" | xargs -n 10); do
  BATCH_OUTPUT=$(mktemp /tmp/codex-batch-XXXXXX.txt)
  codex exec review --base main --full-auto 2>&1 | tee "$BATCH_OUTPUT"
  # Claude 解析每批输出，合并到总 findings 列表
done
```

**Claude 解析**：同 5c Step 2，将每批 Codex 自由文本输出解析为结构化 findings，合并去重后生成最终 JSON。

### 5e. 解析审查结果

**Claude 直接解析 Codex 自由文本输出**（5c Step 2 已完成结构化），无需 node 脚本。

Claude 读取 `$REVIEW_OUTPUT` 文件内容，将 Codex 的自由文本审查结果结构化为 findings JSON。

统计摘要：
```
total: findings 总数
high:  HIGH severity 数量
medium: MEDIUM severity 数量
low:   LOW severity 数量
```

如果 Codex 输出为空或无法识别任何 finding → `findings: []`（不阻塞流水线）。

### 5f. 按 severity 分类处理

**解析结果后，将审查数据写入项目目录：**

将完整 findings 写入 `tasks/{projectId}/codex-review.json`（供 Viewer 读取）。

**分类处理逻辑：**

1. **HIGH + MEDIUM findings** → 记录列表，传给 DT-004 对抗修复循环处理
2. **LOW findings** → 存入 `lowFindings` 列表，后续 Layer 6 写入 PR body 的 "Advisory" 章节
3. **无 findings 或全部 LOW** → Layer 5 直接通过，跳过对抗循环

```
判断：
  有 HIGH 或 MEDIUM → 进入对抗修复循环（5g）
  只有 LOW 或无 findings → Layer 5 通过，继续 Layer 6
```

**如果 Codex 输出无法解析为 JSON（parseError）：**
```
Layer 5: Codex 审查输出无法解析。原始输出已保存到 codex-review.json。
跳过对抗循环，继续 Layer 6。
```
记录为 warning，不阻塞流水线。

### 5g. 对抗修复循环 (Adversarial Loop)

**触发条件：** 5f 中检测到 HIGH 或 MEDIUM findings。

**状态初始化：** 创建 `tasks/{projectId}/adversarial-state.json`

```json
{
  "round": 0,
  "maxRounds": 3,
  "status": "in_progress",
  "rounds": []
}
```

**循环逻辑（最多 3 轮）：**

对于每一轮 (round = 1, 2, 3):

#### Step 1: Claude 逐条处理 HIGH/MEDIUM findings

对每个 HIGH 或 MEDIUM finding，Claude 选择以下两种模式之一：

**模式 A — 修复：**
- 直接修改代码修复问题
- 记录修复的文件和修改内容

**模式 B — 论证拒绝：**
- Claude 提供书面论证理由（为什么不需要修复）
- 调用 codex exec 让 Codex 判断是否接受论证：

```bash
REJECTION_EVAL=$(mktemp /tmp/codex-rejection-XXXXXX.txt)
codex exec --full-auto \
  "A developer argues this finding should NOT be fixed. \
   Finding: {finding.message} (file: {finding.file}, line: {finding.line}) \
   Developer's argument: {rejection_reason} \
   \
   As an independent reviewer, evaluate the argument. \
   State clearly whether you ACCEPT or REJECT the developer's argument, and explain your reasoning. \
   Accept only if the argument is technically sound and the finding is indeed a false positive or non-issue." \
   2>&1 | tee "$REJECTION_EVAL"
```

Claude 解析 Codex 的自由文本回复，判断是否包含 "accept" 或 "reject" 语义，提取为 `{accepted: boolean, reason: string}`。

- **Codex 接受论证** → 记录到日志，该 finding 标记为 resolved
- **Codex 不接受论证** → 该 finding 计入未解决 (unresolved)

#### Step 2: 提交修复

```bash
git add <修改的文件>
git commit -m "fix(testing): adversarial round {round} fixes"
```

#### Step 3: Codex 增量复审

只复审本轮变更的文件（不是全量重审）：

```bash
# 获取本轮修改的文件列表
CHANGED_FILES=$(git diff HEAD~1 --name-only | tr '\n' ' ')

# 使用 codex exec review 复审变更文件
INCREMENTAL_OUTPUT=$(mktemp /tmp/codex-incremental-XXXXXX.txt)
codex exec review --base HEAD~1 --full-auto 2>&1 | tee "$INCREMENTAL_OUTPUT"
```

Claude 解析增量复审的自由文本输出（同 5c Step 2），提取新的 findings。重点关注：
- 之前报告的问题是否已修复
- 修复是否引入了新问题

#### Step 4: 解析增量复审结果

解析新的 findings（同 5e 逻辑），更新 adversarial-state.json：

```json
{
  "round": {current_round},
  "maxRounds": 3,
  "status": "in_progress",
  "rounds": [
    {
      "round": 1,
      "codexFindings": 8,
      "fixed": 6,
      "rejected": 1,
      "rejectionReasons": [
        {
          "finding": "问题摘要",
          "reason": "Claude 的论证理由",
          "codexAccepted": true
        }
      ],
      "remaining": 1
    }
  ]
}
```

#### Step 5: 收敛判断

```
检查增量复审结果：
  无新 HIGH/MEDIUM findings → 对抗循环收敛 ✓
    → adversarial-state.status = "converged"
    → 继续 Layer 6

  仍有 HIGH/MEDIUM 且 round < 3 → 继续下一轮
    → 回到 Step 1

  仍有 HIGH/MEDIUM 且 round = 3 → Circuit Breaker
    → adversarial-state.status = "circuit_breaker"
    → **如果 `NON_INTERACTIVE=1`（Viewer 模式）：** 自动选择选项 2（记录为 advisory，继续 Layer 6），不调用 AskUserQuestion。
    → **否则** → AskUserQuestion:
```

**Circuit Breaker 触发：**
```
Codex 红队对抗审查 — 3 轮未收敛。以下问题仍未解决：
<未解决 findings 列表>

对抗轮次详情：
  Round 1: 发现 {n}, 修复 {m}, 拒绝 {r}
  Round 2: ...
  Round 3: ...

选项：
1. 我来手动修复未解决的问题，修好后继续
2. 将未解决问题记录为 advisory，跳过继续 Layer 6
3. 终止测试
```

### 5h. 写入审查结果文件

对抗循环结束后，写入**两个文件**供 Viewer API 读取：

**文件 1: `tasks/{projectId}/codex-review.json`** — findings 列表（含 resolution 字段）

```json
{
  "findings": [
    {
      "severity": "HIGH",
      "category": "logic",
      "rule": "rule-id",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "问题描述",
      "suggestion": "修复建议",
      "resolution": "fixed|rejected|unresolved",
      "rejectionReason": "拒绝理由（仅 rejected 时）",
      "codexAccepted": true,
      "fixCommit": "commit-hash（仅 fixed 时）"
    }
  ],
  "adversarialState": { ... },
  "timestamp": "ISO timestamp"
}
```

**文件 2: `tasks/{projectId}/adversarial-state.json`** — 对抗循环状态（独立文件，Viewer API 单独读取）

```json
{
  "round": 1,
  "maxRounds": 3,
  "status": "converged|in_progress|circuit_breaker",
  "rounds": [
    {
      "round": 1,
      "codexFindings": 8,
      "fixed": 6,
      "rejected": 1,
      "rejectionReasons": [...],
      "remaining": 1
    }
  ]
}
```

**注意：** Viewer API (`/api/codex-review`) 从两个独立文件分别读取 findings 和 adversarialState，因此必须写两个文件。

**Layer 5 完成后，告知用户：**
```
Layer 5 Codex 红队审查 通过
  发现问题: {total}  HIGH: {high}  MEDIUM: {medium}  LOW: {low}
  对抗轮次: {rounds}/3
  已修复: {fixed}  论证拒绝: {rejected}  未解决: {unresolved}
```

---

## Layer 6 — PR 创建 + Claude Review 守门

**跳过条件：** `startLayer > 6` 时跳过此层。

Layer 6 将审查通过的代码推送到远程并自动创建 PR，然后等待 PR-Agent SaaS 自动审查。PR 创建职责从 Finalize 移至 Testing。

### 6a. 确保所有修复已提交

```bash
# 检查是否有未提交的更改（L1-L5 自动修复残留）
git status --porcelain
```

如果有未提交的更改：
```bash
git add -A
git commit -m "fix(testing): commit remaining auto-fixes before PR creation"
```

### 6b. 推送代码到远程

```bash
# 从 prd.json 读取 branchName
BRANCH_NAME=$(grep -o '"branchName": "[^"]*"' "$PRD_PATH" | cut -d'"' -f4)

git push origin "$BRANCH_NAME"
```

**如果推送失败：**
```
Layer 6: 推送失败。

恢复建议：
- 检查是否有未提交的更改：git status
- 检查远程仓库连接：git remote -v
- 如果有冲突，先 pull 再 push
```
**如果 `NON_INTERACTIVE=1`（Viewer 模式）：** 自动跳过 Layer 6，继续生成报告，不调用 AskUserQuestion。
**否则：** AskUserQuestion 让用户选择：手动修复后继续 / 跳过 Layer 6 / 终止测试。

### 6c. 检查是否已有 PR

```bash
gh pr list --head "$BRANCH_NAME" --json number,title,url,state --jq '.[0]'
```

**如果已有 OPEN PR：**
- 记录 PR 信息（编号、标题、URL）
- 跳到 6e（Claude Review 守门）

### 6d. 创建 PR

读取 prd.json 中的 `project`（项目名称）和 `description`（项目描述）。
读取 progress.txt 的最近内容作为变更摘要。
收集 Layer 5 的 LOW findings 列表，写入 PR body 的 Advisory 章节。

```bash
# 读取项目信息
PROJECT_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PRD_PATH','utf8')).project)")
PROJECT_DESC=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PRD_PATH','utf8')).description)")

# 创建 PR
gh pr create --title "feat: $PROJECT_NAME" --body "$(cat <<EOF
## 自动生成 PR

**项目：** $PROJECT_NAME

**描述：** $PROJECT_DESC

### 变更摘要

$(tail -50 "$PROGRESS_FILE")

### Advisory (LOW severity — 不阻塞合并)

$(if [ -n "$LOW_FINDINGS" ]; then
  echo "$LOW_FINDINGS"
else
  echo "_无 LOW severity 问题_"
fi)

---
*由 BotoolAgent Testing Layer 6 自动创建*
EOF
)"
```

其中 `$LOW_FINDINGS` 来自 Layer 5 的 5f 步骤中收集的 LOW findings 列表，格式为每行一个 `- [severity] rule: message (file:line)`。

**如果创建失败：**
```
Layer 6: PR 创建失败。

恢复建议：
- 检查 gh 是否已认证：gh auth status
- 检查远程仓库是否有写入权限
- 手动创建 PR：gh pr create
```
**如果 `NON_INTERACTIVE=1`（Viewer 模式）：** 自动跳过 PR 创建，继续生成报告，不调用 AskUserQuestion。
**否则：** AskUserQuestion 让用户选择：手动创建后继续 / 跳过 PR 创建 / 终止测试。

**创建成功后：** 记录 PR 编号、标题和 URL。

### 6e. Claude Review 守门 — 等待 GitHub Actions 自动审查

PR 创建后，等待 `.github/workflows/claude-pr-review.yml` 自动触发并完成审查。

**Claude Review 是可选层** — 检测到 workflow 未配置时立即跳过，不浪费等待时间。

```bash
# 获取 PR 编号
PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number')

# Step 1: 快速检测 claude-pr-review workflow 是否存在（立即判断，不等待）
WORKFLOW_EXISTS=$(gh workflow list --json name \
  --jq '[.[].name] | contains(["Claude PR Review"])')

if [ "$WORKFLOW_EXISTS" != "true" ]; then
  echo "claude-pr-review workflow 未配置，跳过 Claude Review 守门。"
  # 跳到 6g
fi
```

**如果 workflow 不存在：**
```
Layer 6: Claude PR Review workflow 未配置，立即跳过。
（提示：若需配置，参见 .github/workflows/claude-pr-review.yml）
```
记录为 info，不阻塞流水线。跳到 6g。

**如果 workflow 存在：** 等待本次推送触发的 run 完成（最多 5 分钟）。

```bash
# Step 2: 等待 claude-pr-review workflow 完成（最多 300 秒）
MAX_WAIT=300
INTERVAL=15
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  RUN_STATUS=$(gh run list --workflow=claude-pr-review.yml \
    --branch "$BRANCH_NAME" \
    --json status,conclusion \
    --jq '[.[] | select(.status == "completed")] | .[0].conclusion // "pending"')

  if [ "$RUN_STATUS" != "pending" ]; then
    echo "Claude PR Review 完成: $RUN_STATUS"
    break
  fi

  echo "等待 Claude PR Review workflow 完成... ($ELAPSED/$MAX_WAIT 秒)"
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "Claude PR Review 超时（${MAX_WAIT}秒）。跳过守门。"
  # 跳到 6g
fi
```

**超时处理：**
```
Layer 6: Claude PR Review 未在 5 分钟内完成。
跳过守门，继续生成质检报告。
```
记录为 warning，不阻塞流水线。跳到 6g。

**workflow 完成后：** 读取并解析 Claude 发布的审查评论。

```bash
# Step 3: 读取 Claude Review 评论（gh pr comment 写入 issue comments）
CLAUDE_REVIEW=$(gh api repos/{owner}/{repo}/issues/$PR_NUMBER/comments \
  --jq '[.[] | select(.body | contains("## Claude Code Review"))] | .[0].body // ""')
```

### 6f. Claude Review 修复循环（最多 2 轮）

解析 Claude Review 评论中的 HIGH severity 问题：

**解析逻辑：**
1. 从 `## Claude Code Review` 评论中提取 `### HIGH severity` 章节
2. 如果该章节内容为 `_None_` 或为空 → 直接通过，跳到 6g
3. 如果有 HIGH 问题 → 进入修复循环
4. 如果评论内容无法识别格式 → 记录 warning 跳过（不阻塞）

**修复循环（最多 2 轮）：**

对于每一轮 (round = 1, 2):

#### Step 1: 分析 HIGH 问题

从 Claude Review 评论的 `### HIGH severity` 章节提取问题列表。

- **如果没有 HIGH 问题** → Claude Review 守门通过，跳到 6g
- **如果有 HIGH 问题** → 进入修复

#### Step 2: 自动修复

逐个修复 Claude 指出的 HIGH 问题：
- 读取涉及文件
- 按照 Claude 的建议修改代码
- 修复后提交：

```bash
git add <修改的文件>
git commit -m "fix(testing): Claude Review round $ROUND fixes"
```

#### Step 3: 重新推送

```bash
git push origin "$BRANCH_NAME"
```

推送后 `claude-pr-review.yml` workflow 会自动重新触发。

#### Step 4: 等待 Claude 重审

```bash
# 等待新一轮 workflow 完成（最多 5 分钟）
LAST_PUSH_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

MAX_WAIT=300
INTERVAL=15
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  NEW_RUN=$(gh run list --workflow=claude-pr-review.yml \
    --branch "$BRANCH_NAME" \
    --json status,conclusion,createdAt \
    --jq "[.[] | select(.createdAt > \"$LAST_PUSH_TIME\") | select(.status == \"completed\")] | .[0].conclusion // \"pending\"")

  if [ "$NEW_RUN" != "pending" ]; then
    echo "Claude PR Review 重审完成: $NEW_RUN"
    break
  fi

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done
```

#### Step 5: 收敛判断

```
检查重审评论（同 6e Step 3 读取最新 ## Claude Code Review 评论）：
  ### HIGH severity 为 _None_ → Claude Review 守门通过，继续 6g
  仍有 HIGH 且 round < 2 → 继续下一轮
  仍有 HIGH 且 round = 2 → 记录未解决问题，继续 6g
```

**2 轮后仍有 HIGH 问题：**
```
Claude Review 修复循环 2 轮后仍有 HIGH 问题未解决。
将未解决问题记录到 testing-report.json，继续生成报告。
```
记录 warning，不阻塞（Claude Review 为增强层，不是强制门控）。

### 6g. 更新 agent-status 为 testing_complete

```bash
# 获取 PR URL
PR_URL=$(gh pr list --head "$BRANCH_NAME" --json url --jq '.[0].url')
PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number')

# 写入 agent-status（路径优先使用 per-project 路径）
STATUS_PATH="tasks/${PROJECT_ID}/agent-status"
cat > "$STATUS_PATH" << STATUSEOF
{
  "status": "testing_complete",
  "message": "6 层质检全部通过，PR #${PR_NUMBER} 已创建",
  "timestamp": "$(date '+%Y-%m-%d %H:%M:%S')",
  "prUrl": "$PR_URL",
  "prNumber": "$PR_NUMBER",
  "currentTask": "testing_complete"
}
STATUSEOF
```

**重要：** `status` 必须为 `testing_complete`，这是 Finalize Skill 的前置检查条件。

### 6h. 写入 testing-report.json

将 6 层完整测试报告写入 `tasks/{projectId}/testing-report.json`，供 Viewer 和 Finalize 读取：

```bash
REPORT_PATH="tasks/${PROJECT_ID}/testing-report.json"
```

报告结构（根据每层执行情况动态生成）：

```json
{
  "layers": [
    {
      "id": "L1",
      "name": "Regression (TypeCheck + Lint)",
      "status": "pass|fail|skipped",
      "fixCount": 0,
      "rounds": 0
    },
    {
      "id": "L2",
      "name": "Unit Tests",
      "status": "pass|fail|skipped",
      "fixCount": 0,
      "rounds": 0
    },
    {
      "id": "L3",
      "name": "E2E Tests",
      "status": "pass|fail|skipped",
      "fixCount": 0,
      "rounds": 0,
      "failedTests": ["test file > test name（仅 fail/skipped 时填充）"],
      "errorSummary": "根因分析结论（仅 fail/skipped 时填充）",
      "reportFile": "tasks/{projectId}/e2e-failures.md（仅 Circuit Breaker 时填充）"
    },
    {
      "id": "L4",
      "name": "Code Review",
      "status": "pass|fail|skipped",
      "fixCount": 0,
      "rounds": 0
    },
    {
      "id": "L5",
      "name": "Codex 红队审查",
      "status": "pass|fail|skipped",
      "adversarialRounds": 0,
      "findingsTotal": 0,
      "fixed": 0,
      "rejected": 0
    },
    {
      "id": "L6",
      "name": "PR 创建 + PR-Agent",
      "status": "pass|fail|skipped",
      "prUrl": "...",
      "agentComments": 0,
      "fixRounds": 0
    }
  ],
  "verdict": "all_pass|has_failures|circuit_breaker",
  "prReady": true,
  "prUrl": "...",
  "timestamp": "2026-02-19T14:30:00Z"
}
```

**生成逻辑：**
1. 遍历 L1-L6 每层的执行记录，填充 status/fixCount/rounds
2. L3 数据额外填充 failedTests（失败测试名列表）、errorSummary（根因分析结论）、reportFile（e2e-failures.md 路径，仅 Circuit Breaker 时）
3. L5 数据从 `adversarial-state.json` 读取（如果存在）
4. L6 数据从当前步骤的 PR 信息 + PR-Agent 修复记录填充
5. `verdict` 判断：全部 pass → `all_pass`；有 fail/skipped(circuit_breaker) → `has_failures`；有 circuit_breaker → `circuit_breaker`
6. `prReady` = verdict === "all_pass" && prUrl 存在

**渐进式写入（Progressive Write）：**
每当一层 Circuit Breaker 触发并跳过后，立即将已完成层的数据写入 `testing-report.json`（partial report），未完成的层填 `status: "pending"`。
Layer 6 结束时用完整数据覆盖写入最终版本。
这样即使流水线中途中断，用户也能看到已完成的层的结果。

写入完成后，告知用户报告路径。

**Layer 6 通过后，告知用户：**
```
Layer 6 PR 创建 + Claude Review 守门 通过
  PR: #<number> — <title>
  URL: <pr-url>
  Claude Review: {fix_rounds} 轮修复 / 跳过（workflow 未配置）/ 超时跳过
  agent-status: testing_complete
  testing-report.json: 已生成
```

---

## 最终总结

全部 6 层自动化测试通过后，输出总结：

```
BotoolAgent 6 层自动化测试 — 全部通过!

  Layer 1 — Regression:       通过 (TypeCheck + Lint)
  Layer 2 — Unit Tests:       通过 / 跳过
  Layer 3 — E2E Tests:        通过 / 跳过
  Layer 4 — Code Review:      通过 (无 HIGH 级别问题)
  Layer 5 — Codex 红队审查:    通过 / 跳过 (对抗轮次: N/3)
  Layer 6 — PR + Claude Review: 通过 / 跳过

  自动修复统计:
  - TypeCheck: N 轮修复 / 直接通过
  - Lint: N 轮修复 / 直接通过 / eslint --fix 一次通过
  - Unit Tests: N 轮修复 / 直接通过 / 跳过
  - E2E Tests: N 轮修复 / 直接通过 / 跳过
  - Code Review: N 轮修复 / 直接通过
  - Codex 审查: N 个问题修复, M 个论证拒绝 / 跳过
  - Claude Review: N 轮修复 / 跳过 / workflow 未配置

下一步：运行 /botoolagent-finalize 完成合并流程
```

---

## 支持的参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| startLayer | 从第 N 层开始执行（跳过之前的层，1-6） | 1 |

用法：`/botoolagent-testing 5`（从 Layer 5 Codex 红队审查开始执行）

---

## 错误恢复速查表

| 层级 | 错误 | 处理方式 |
|------|------|----------|
| 前置 | prd.json 不存在 | 停止，提示运行 `/botoolagent-prd2json` |
| 前置 | branchName 缺失 | 停止，提示添加字段 |
| Layer 1 | TypeCheck 失败 | **信号清晰度判断 → Ralph 自动修复（根因分析）** → 2 轮无进展才问用户 |
| Layer 1 | Lint 失败 | **eslint --fix → 信号清晰度判断 → Ralph 自动修复（根因分析）** → 2 轮无进展才问用户 |
| Layer 2 | 单元测试失败 | **信号清晰度判断 → Ralph 自动修复（根因分析）** → 2 轮无进展才问用户 |
| Layer 3 | E2E 测试失败 | **信号清晰度判断 → Ralph 自动修复（根因分析）** → 2 轮无进展才问用户 |
| Layer 4 | Code Review 有 HIGH | **信号清晰度判断 → Ralph 自动修复（根因分析）** → 2 轮无进展才问用户 |
| Layer 5 | Codex CLI 不可用 | 跳过 Layer 5，继续 Layer 6 |
| Layer 5 | Codex 输出无法解析 | 记录 warning，跳过对抗循环，继续 Layer 6 |
| Layer 5 | 对抗循环未收敛 | 3 轮后 Circuit Breaker → AskUserQuestion 转人工 |
| Layer 6 | 推送失败 | 检查 git status 和 git remote -v，解决冲突后重试 |
| Layer 6 | PR 创建失败 | 检查 gh auth status，手动 gh pr create |
| Layer 6 | gh 未认证 | 运行 gh auth login |
| Layer 6 | PR-Agent 超时 | PR-Agent 为可选层，超时自动跳过，参见 docs/pr-agent-setup.md |
| Layer 6 | claude-pr-review workflow 未配置 | 立即跳过，不等待 |
| Layer 6 | Claude Review 评论格式无法解析 | 记录 warning，跳过守门 |
| Layer 6 | PR-Agent 修复循环未收敛 | 2 轮后记录未解决问题，不阻塞 |

---

## 与 Viewer 对齐

CLI 的 6 层自动化测试对应 Viewer Stage 4 的分层验收：

| CLI Layer | Viewer Layer | 说明 |
|-----------|-------------|------|
| Layer 1 — Regression | 全量回归 | TypeCheck + Lint |
| Layer 2 — Unit Tests | 单元测试 | npm test / npm run test:unit |
| Layer 3 — E2E Tests | E2E 测试 | npx playwright test |
| Layer 4 — Code Review | Code Review | git diff → Claude 审查 |
| Layer 5 — Codex 红队审查 | Codex 审查 | codex exec → 对抗循环 |
| Layer 6 — PR + Claude Review | PR 守门 | gh pr create → claude-pr-review workflow → 修复循环 |

**手动验收（Manual Checklist）已移出 testing 流水线**，用户可在 finalize 前自行验证。

**行为一致性：**
- 两端都从 prd.json 读取 testCases
- CLI 6 层全自动（Ralph 自动修复 + Codex 对抗审查）：失败不停止，自动修 → 重跑 → 超限才问用户
- Layer 2/3 在没有对应 testCases 或脚本时自动跳过
- Layer 5 在 codex CLI 不可用时自动跳过
- 全部通过后，CLI 直接提示运行 `/botoolagent-finalize`
