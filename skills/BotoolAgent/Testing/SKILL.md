---
name: botoolagent-testing
description: "Run the 6-layer automated verification pipeline for BotoolAgent projects. Use when development is complete and you need to verify quality before merging. Triggers on: run tests, verify, test my code, start testing, run verification."
user-invocable: true
---

# BotoolAgent 6 层自动化测试流水线

CLI 端自动化测试验收：Layer 1 Regression → Layer 2 Unit → Layer 3 E2E → Layer 4 Code Review → Layer 5 Codex 红队审查 → Layer 6 PR 创建 + PR-Agent 守门。全部自动化，通过后直接进入 finalize。

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
  Layer 6 — PR 创建 + PR-Agent 守门 （PR-Agent 修复循环 ≤ 2 轮）
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
7. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker → AskUserQuestion：
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
6. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker → AskUserQuestion：
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
6. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker → AskUserQuestion：
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

# 2. Auto-detect port: BotoolAgent repo = 3000, other project = 3100
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"

# 3. 检查 dev server 是否在运行且健康
curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:$VIEWER_PORT
```

**处理逻辑：**
- HTTP 200 → dev server 健康，继续
- 超时或非 200 → dev server 假死或未运行，需要重启：
  ```bash
  VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
  lsof -ti :"$VIEWER_PORT" | xargs kill -9 2>/dev/null || true
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
5. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker → AskUserQuestion：
   ```
   E2E 测试自动修复无进展（2 轮无进展）。以下测试持续失败：
   <失败测试列表>
   根因分析结论：<分析结论>

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
6. 如果错误没变化（连续 **2 次**无进展）→ Circuit Breaker → AskUserQuestion：
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

```bash
# 创建临时输出文件
REVIEW_OUTPUT=$(mktemp /tmp/codex-review-XXXXXX.json)

codex exec -a never --full-auto \
  "You are a red-team security reviewer. Read AGENTS.md for project conventions. \
   Analyze the following git diff output for: \
   1. Security vulnerabilities (OWASP Top 10: injection, XSS, SSRF, path traversal, hardcoded secrets) \
   2. Logic bugs (off-by-one, null/undefined handling, race conditions, boundary errors) \
   3. Missing error handling (uncaught exceptions, missing fallbacks, unvalidated inputs) \
   4. Test coverage gaps (critical paths not tested, edge cases missed) \
   \
   Output ONLY a valid JSON object with a 'findings' array. Each finding must have: \
   severity (HIGH/MEDIUM/LOW), category (security/logic/error-handling/test-coverage/style), \
   rule (identifier like owasp-injection), file (relative path), line (number), \
   message (description), suggestion (actionable fix). \
   \
   If no issues found, output: {\"findings\": []} \
   \
   Git diff: \
   $(git diff main...HEAD)" \
   > "$REVIEW_OUTPUT" 2>/dev/null
```

### 5d. 分文件审查模式（大 diff 缓解）

当 diff 超过 5000 行时自动拆分：

```bash
REVIEW_OUTPUT=$(mktemp /tmp/codex-review-XXXXXX.json)
echo '{"findings":[]}' > "$REVIEW_OUTPUT"

for file in $(git diff main...HEAD --name-only); do
  FILE_REVIEW=$(mktemp /tmp/codex-file-review-XXXXXX.json)

  codex exec -a never --full-auto \
    "You are a red-team security reviewer. Read AGENTS.md for project conventions. \
     Review $file for security vulnerabilities, logic bugs, missing error handling, \
     and test coverage gaps. \
     Output ONLY a valid JSON object with a 'findings' array per codex-review-schema.json format. \
     Focus on: OWASP Top 10, logic bugs, boundary conditions, missing validation. \
     If no issues found, output: {\"findings\": []} \
     \
     File diff: \
     $(git diff main...HEAD -- "$file")" \
     > "$FILE_REVIEW" 2>/dev/null

  # 合并 findings（使用 node 合并 JSON 数组）
  node -e "
    const fs = require('fs');
    const main = JSON.parse(fs.readFileSync('$REVIEW_OUTPUT','utf8'));
    try {
      const part = JSON.parse(fs.readFileSync('$FILE_REVIEW','utf8'));
      if (part.findings) main.findings.push(...part.findings);
    } catch(e) { /* skip unparseable output */ }
    fs.writeFileSync('$REVIEW_OUTPUT', JSON.stringify(main, null, 2));
  "
  rm -f "$FILE_REVIEW"
done
```

### 5e. 解析审查结果

```bash
# 读取 Codex 审查输出
node -e "
  const fs = require('fs');
  try {
    const raw = fs.readFileSync('$REVIEW_OUTPUT', 'utf8');
    // 尝试提取 JSON（Codex 输出可能包含额外文本）
    const jsonMatch = raw.match(/\{[\s\S]*\"findings\"[\s\S]*\}/);
    if (!jsonMatch) {
      console.log(JSON.stringify({findings:[], parseError: 'No valid JSON found in codex output'}));
      process.exit(0);
    }
    const data = JSON.parse(jsonMatch[0]);
    const findings = data.findings || [];
    const high = findings.filter(f => f.severity === 'HIGH');
    const medium = findings.filter(f => f.severity === 'MEDIUM');
    const low = findings.filter(f => f.severity === 'LOW');
    console.log(JSON.stringify({
      total: findings.length,
      high: high.length,
      medium: medium.length,
      low: low.length,
      findings: findings
    }, null, 2));
  } catch(e) {
    console.log(JSON.stringify({findings:[], parseError: e.message}));
  }
"
```

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
codex exec -a never --full-auto \
  "A developer argues this finding should NOT be fixed. \
   Finding: {finding.message} (file: {finding.file}, line: {finding.line}) \
   Developer's argument: {rejection_reason} \
   \
   As an independent reviewer, evaluate the argument. \
   Output ONLY a JSON object: {\"accepted\": true/false, \"reason\": \"your reasoning\"} \
   \
   Accept only if the argument is technically sound and the finding is indeed a false positive or non-issue."
```

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

codex exec -a never --full-auto \
  "You are a red-team security reviewer performing incremental re-review. \
   Only review the following changed files: $CHANGED_FILES \
   Check if the fixes properly address the previously reported issues. \
   Also check if the fixes introduced any NEW issues. \
   \
   Output ONLY a valid JSON object with a 'findings' array. Each finding must have: \
   severity (HIGH/MEDIUM/LOW), category, rule, file, line, message, suggestion. \
   If all issues are resolved and no new issues, output: {\"findings\": []}" \
   > "$REVIEW_OUTPUT" 2>/dev/null
```

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
    → AskUserQuestion:
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

### 5h. 更新 codex-review.json

对抗循环结束后，将最终状态写入 `tasks/{projectId}/codex-review.json`（合并初始 findings + 对抗循环结果），供 Viewer 读取。

**Layer 5 完成后，告知用户：**
```
Layer 5 Codex 红队审查 通过
  发现问题: {total}  HIGH: {high}  MEDIUM: {medium}  LOW: {low}
  对抗轮次: {rounds}/3
  已修复: {fixed}  论证拒绝: {rejected}  未解决: {unresolved}
```

---

## Layer 6 — PR 创建 + PR-Agent 守门

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
AskUserQuestion 让用户选择：手动修复后继续 / 跳过 Layer 6 / 终止测试。

### 6c. 检查是否已有 PR

```bash
gh pr list --head "$BRANCH_NAME" --json number,title,url,state --jq '.[0]'
```

**如果已有 OPEN PR：**
- 记录 PR 信息（编号、标题、URL）
- 跳到 6e（PR-Agent 守门）

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
AskUserQuestion 让用户选择：手动创建后继续 / 跳过 PR 创建 / 终止测试。

**创建成功后：** 记录 PR 编号、标题和 URL。

### 6e. PR-Agent 守门 — 等待自动审查评论

PR 创建后，等待 PR-Agent SaaS 自动触发 `/review` 和 `/improve` 评论。

**PR-Agent 是可选层** — 如果仓库未配置 PR-Agent，超时后自动跳过。

```bash
# 获取 PR 编号
PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number')

# Polling: 等待 PR-Agent bot 评论（最多 60 秒）
MAX_WAIT=60
INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  # 获取 PR 评论，过滤 PR-Agent bot 评论
  AGENT_COMMENTS=$(gh api repos/{owner}/{repo}/pulls/$PR_NUMBER/comments \
    --jq '[.[] | select(.user.login | test("pr-agent|codiumai"; "i"))] | length')

  if [ "$AGENT_COMMENTS" -gt 0 ]; then
    echo "PR-Agent 评论已到达: $AGENT_COMMENTS 条"
    break
  fi

  echo "等待 PR-Agent 评论... ($ELAPSED/$MAX_WAIT 秒)"
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "PR-Agent 超时（${MAX_WAIT}秒未收到评论）。跳过 PR-Agent 守门。"
fi
```

**超时处理：**
```
Layer 6: PR-Agent 未在 60 秒内响应。
跳过 PR-Agent 守门，继续生成质检报告。
（提示：若需配置 PR-Agent，参见 docs/pr-agent-setup.md）
```
记录为 warning，不阻塞流水线。跳到 6g。

**收到评论后：** 读取并解析 PR-Agent 评论内容。

```bash
# 读取 PR-Agent 评论内容
gh api repos/{owner}/{repo}/pulls/$PR_NUMBER/comments \
  --jq '[.[] | select(.user.login | test("pr-agent|codiumai"; "i"))] | .[].body'
```

### 6f. PR-Agent 修复循环（最多 2 轮）

解析 PR-Agent 评论中的 HIGH severity 问题：

**解析逻辑：**
1. 正则匹配评论中的 severity 标记（如 `severity: high`、`🔴`、`Critical`）
2. 提取问题描述、涉及文件、建议修复
3. 如果无法解析格式（PR-Agent 版本变化等）→ 将评论内容作为参考，记录 warning 跳过

**修复循环（最多 2 轮）：**

对于每一轮 (round = 1, 2):

#### Step 1: 分析 HIGH 问题

筛选 PR-Agent 评论中标记为 HIGH/Critical 的问题。

- **如果没有 HIGH 问题** → PR-Agent 守门通过，跳到 6g
- **如果有 HIGH 问题** → 进入修复

#### Step 2: 自动修复

逐个修复 PR-Agent 指出的 HIGH 问题：
- 读取涉及文件
- 按照 PR-Agent 的建议修改代码
- 修复后提交：

```bash
git add <修改的文件>
git commit -m "fix(testing): PR-Agent round $ROUND fixes"
```

#### Step 3: 重新推送

```bash
git push origin "$BRANCH_NAME"
```

推送后 PR-Agent SaaS 会自动重新审查。

#### Step 4: 等待 PR-Agent 重审

```bash
# 等待新一轮 PR-Agent 评论（最多 60 秒）
# 同 6e 的 polling 逻辑，但只关注推送后的新评论
LAST_PUSH_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

MAX_WAIT=60
INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  NEW_COMMENTS=$(gh api repos/{owner}/{repo}/pulls/$PR_NUMBER/comments \
    --jq "[.[] | select(.user.login | test(\"pr-agent|codiumai\"; \"i\")) | select(.created_at > \"$LAST_PUSH_TIME\")] | length")

  if [ "$NEW_COMMENTS" -gt 0 ]; then
    echo "PR-Agent 重审评论已到达"
    break
  fi

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done
```

#### Step 5: 收敛判断

```
检查重审评论：
  无新 HIGH 问题 → PR-Agent 守门通过，继续 6g
  仍有 HIGH 且 round < 2 → 继续下一轮
  仍有 HIGH 且 round = 2 → 记录未解决问题，继续 6g
```

**2 轮后仍有 HIGH 问题：**
```
PR-Agent 修复循环 2 轮后仍有 HIGH 问题未解决。
将未解决问题记录到 testing-report.json，继续生成报告。
```
记录 warning，不阻塞（PR-Agent 为增强层，不是强制门控）。

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
      "rounds": 0
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
2. L5 数据从 `adversarial-state.json` 读取（如果存在）
3. L6 数据从当前步骤的 PR 信息 + PR-Agent 修复记录填充
4. `verdict` 判断：全部 pass → `all_pass`；有 fail → `has_failures`；有 circuit_breaker → `circuit_breaker`
5. `prReady` = verdict === "all_pass" && prUrl 存在

写入完成后，告知用户报告路径。

**Layer 6 通过后，告知用户：**
```
Layer 6 PR 创建 + PR-Agent 守门 通过
  PR: #<number> — <title>
  URL: <pr-url>
  PR-Agent: {agent_comments} 条评论, {fix_rounds} 轮修复 / 超时跳过
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
  Layer 6 — PR + PR-Agent:    通过 / 跳过

  自动修复统计:
  - TypeCheck: N 轮修复 / 直接通过
  - Lint: N 轮修复 / 直接通过 / eslint --fix 一次通过
  - Unit Tests: N 轮修复 / 直接通过 / 跳过
  - E2E Tests: N 轮修复 / 直接通过 / 跳过
  - Code Review: N 轮修复 / 直接通过
  - Codex 审查: N 个问题修复, M 个论证拒绝 / 跳过
  - PR-Agent: N 轮修复 / 跳过

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
| Layer 6 | PR-Agent 评论无法解析 | 记录 warning，跳过 PR-Agent 守门 |
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
| Layer 6 — PR + PR-Agent | PR 守门 | gh pr create → PR-Agent 修复 |

**手动验收（Manual Checklist）已移出 testing 流水线**，用户可在 finalize 前自行验证。

**行为一致性：**
- 两端都从 prd.json 读取 testCases
- CLI 6 层全自动（Ralph 自动修复 + Codex 对抗审查）：失败不停止，自动修 → 重跑 → 超限才问用户
- Layer 2/3 在没有对应 testCases 或脚本时自动跳过
- Layer 5 在 codex CLI 不可用时自动跳过
- 全部通过后，CLI 直接提示运行 `/botoolagent-finalize`
