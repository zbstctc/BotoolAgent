# PRD: 自动化流水线 + 可靠性提升 + Agent Teams 集成

## Introduction

BotoolAgent 的核心理念是：**用户把时间花在 PRD 上，开发-测试-交付全自动化**。基于对 5 个 Stage 的系统性审查，本次改造聚焦四个方向：

1. **可靠性基础**：修复进程管理、保存失败等关键问题，让现有功能先稳定
2. **prd.json schema 升级**：新增 `testCases` 字段，让测试成为 PRD 的一等公民
3. **Stage 3→4→5 自动串联**：Agent 开发+自测完成后，Viewer 验收、自动创建 PR，用户只需一键合并
4. **增强**：术语优化、CLI 自动化、Stage 1 心跳

### 架构变更：BotoolAgent.sh → BotoolAgentTeams.sh

本次 PRD 基于 **BotoolAgentTeams.sh**（Agent Teams 模式），替代原有的 BotoolAgent.sh（Ralph 迭代模式）。

```
旧 (Ralph / BotoolAgent.sh):
  Bash 外循环 → claude --print 单轮 → Bash 分析响应 → 重试/下一轮
  控制者: Bash 脚本 | Claude 是无状态工具

新 (Agent Teams / BotoolAgentTeams.sh):
  Bash launcher → tmux 交互式 Claude → Lead Agent 自主编排 → spawn teammates 并行
  控制者: Claude Lead Agent | Bash 只是 launcher

分工:
  Agent Teams 负责:              Viewer Stage 4 负责:
  ├─ 开发所有 DT（可并行）        ├─ Playwright E2E（需要 dev server + browser）
  ├─ typecheck 验证               ├─ Code Review（Claude 审 git diff）
  ├─ unit tests 验证              ├─ 手动验收 checklist
  └─ git commit + push            └─ 创建 PR → Stage 5
```

### 设计原则

```
用户时间分配目标：
  Stage 1 (PRD 交互)     ████████████████████  80%  ← 用户核心价值
  Stage 2 (规范确认)      ███                   10%  ← 开发者一次性搭好，业务可跳过
  Stage 3→4→5 (自动化)   ██                    10%  ← 全自动流水线，用户只点"合并"
```

## Goals

- 消除 Stage 3 重复启动代理和孤儿进程问题（tmux session 管理）
- 修复 Stage 2 保存失败仍跳转的 bug
- prd.json 支持 `testCases` 字段，区分 typecheck/unit/e2e/manual 类型
- 支持 TDD 模式：逻辑密集的 DT 先写测试再实现
- Stage 3 完成后自动进入 Stage 4（不等用户手动点）
- 引入 Playwright 测试框架，支持 E2E 自动化测试
- Stage 4 重新定义：展示 Agent 自测结果 + E2E + Code Review + 手动验收
- Stage 4 通过后自动创建 PR 进入 Stage 5
- 面向非技术用户的术语优化
- CLI 层 `/botoolagent-coding` skill 使用 Agent Teams 实现全自动流水线
- Stage 1 CLI 心跳检测和自动重连

## Dev Tasks

---

### Phase 1: 可靠性基础

---

### DT-001: Stage 3 代理进程防重复启动 + tmux session 管理
**Description:** 修复 Stage 3 最严重的可靠性问题：用户刷新页面后可能启动第二个代理实例。改用 BotoolAgentTeams.sh（tmux session）替代 BotoolAgent.sh（直接进程）。

**实现方案：**
- API `POST /api/agent/start` 改为 spawn `BotoolAgentTeams.sh`（替代 BotoolAgent.sh）
- 启动前检查：`tmux has-session -t botool-teams` → 存在则拒绝启动，返回 "已在运行"
- SSE 每次 poll 时 `tmux has-session -t botool-teams` 验证 session 存活
- session 不存在但 `.agent-status` 仍为 running → 状态改为 "crashed"
- 页面加载时：检测到 running 状态 + tmux session 存在 → 自动恢复监控
- 停止代理：`tmux kill-session -t botool-teams`（替代 `kill -9 PID`）
- 不再需要 `.agent-pid` 锁文件（tmux session name 本身就是锁）

**API 变更：**
- `POST /api/agent/start`: spawn BotoolAgentTeams.sh，不再传 maxIterations（Agent Teams 自主管理）
- `GET /api/agent/status`: 增加 tmux session 存活检测
- `DELETE /api/agent/status`: `tmux kill-session -t botool-teams`

**Acceptance Criteria:**
- [ ] `POST /api/agent/start` spawn BotoolAgentTeams.sh
- [ ] 启动前 `tmux has-session` 检查，已有则返回 409
- [ ] 已有代理运行时，启动按钮显示"代理运行中"
- [ ] 刷新页面后自动恢复对运行中代理的监控
- [ ] tmux session 异常退出后，前端在 60 秒内检测到并显示"代理异常退出"
- [ ] 停止代理通过 `tmux kill-session` 清理
- [ ] AgentDataPanel 优雅处理 Agent Teams 模式下缺失的 rateLimit/circuitBreaker 字段
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### DT-002: Stage 2 保存失败修复 + 异步跳转安全
**Description:** 修复 Stage 2 的 EnrichmentSummary 组件中 catch 块调用 `onComplete()` 的 bug。确保只有保存成功才跳转到 Stage 3。

**Acceptance Criteria:**
- [ ] catch 块中不再调用 `onComplete()`，改为显示错误提示 + 重试按钮
- [ ] `updateProject()` 被 await，失败时显示错误
- [ ] 只有 updateProject 成功后才 `router.push('/stage3')`
- [ ] prd.json schema 验证：branchName 必填、devTasks 非空
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### Phase 2: Schema + TDD 基础设施

---

### DT-003: prd.json schema 升级 — 新增 testCases 字段
**Description:** 扩展 prd.json 的 devTask schema，新增 `testCases` 数组字段。每个 testCase 包含类型、描述、是否 TDD。同时更新所有读取 prd.json 的代码（Stage 2 的 JsonConvertStep、Stage 3 的任务列表、Stage 4 的测试执行器）。

**新 schema：**
```json
{
  "id": "DT-003",
  "title": "状态指示灯",
  "acceptanceCriteria": ["..."],
  "testCases": [
    { "type": "typecheck" },
    { "type": "unit", "desc": "status=waiting_network → 红灯", "tdd": true },
    { "type": "unit", "desc": "rateLimit 80% → 黄灯", "tdd": true },
    { "type": "e2e", "desc": "Stage 3 页面状态指示灯区域可见" },
    { "type": "manual", "desc": "指示灯颜色视觉清晰" }
  ],
  "passes": false
}
```

**testCase 类型说明：**
- `typecheck` — 自动运行 `npx tsc --noEmit`
- `lint` — 自动运行 lint 命令
- `unit` — 单元测试，`tdd: true` 时 agent 先写测试再实现
- `e2e` — 端到端测试（Playwright），验证页面级行为
- `manual` — 人工验证（视觉、动画等无法自动化的项）

**哪些 DT 适合哪种测试：**
- 逻辑/映射函数 → unit + tdd:true（如状态指示灯映射、FlowChart 步骤高亮）
- API 调用/数据处理 → unit（如启动/停止代理）
- 布局/页面结构 → e2e（如三栏布局渲染）
- 纯 CSS/动画 → e2e 或 manual（如虚线流动、呼吸动画）
- 中文化/文案 → e2e 快照 或 manual

**Acceptance Criteria:**
- [ ] prd.json TypeScript 类型定义（DevTask interface）新增 `testCases?: TestCase[]`
- [ ] TestCase interface：`{ type: 'typecheck'|'lint'|'unit'|'e2e'|'manual', desc?: string, tdd?: boolean }`
- [ ] Stage 2 JsonConvertStep 生成 prd.json 时包含 testCases 字段
- [ ] Stage 3 任务列表中展示 testCases 数量（如"3 个自动测试 + 1 个手动"）
- [ ] 向后兼容：testCases 为可选字段，不存在时退回到现有 acceptanceCriteria 逻辑
- [ ] Typecheck passes

---

### DT-004: CLAUDE.md + CLAUDE.team.md TDD 指令 + testCases 读取
**Description:** 更新 CLAUDE.md（Ralph 模式）和 CLAUDE.team.md（Agent Teams 模式）的指令，让 agent 在执行任务时读取 `testCases` 字段。对 `tdd: true` 的 testCase，先写测试文件再写实现代码。非 TDD 的 testCase 仍然在实现后验证。

**TDD 指令（两个文件都需要）：**
```
## 测试驱动开发
1. 读取当前任务的 testCases 字段（如果存在）
2. 对 tdd: true 的 unit 测试：先创建测试文件，编写测试用例，确认测试失败
3. 实现功能代码，使测试通过
4. 对非 TDD 的 testCase：实现后运行验证
5. 如果没有 testCases 字段，按现有流程工作（读 acceptanceCriteria）
```

**注意：** TDD 逻辑是单个 DT 内部的行为，不受执行模式（Ralph 串行 vs Agent Teams 并行）影响。

**Acceptance Criteria:**
- [ ] CLAUDE.md 包含 testCases 读取和 TDD 工作流指令
- [ ] CLAUDE.team.md 的「单任务执行协议」和 teammate prompt 包含同样的 TDD 指令
- [ ] 指令清晰说明 tdd: true 时的"红-绿-重构"流程
- [ ] 指令兼容无 testCases 的旧格式 prd.json
- [ ] 在终端中用一个示例 DT 验证 agent 确实先写了测试

---

### Phase 3: 自动串联（核心价值）

---

### DT-005: Stage 3→4 自动串联
**Description:** 当 Agent Teams 完成所有任务后，Stage 3 自动进入 Stage 4 验收流程。Agent Teams 在内部已完成 typecheck + unit tests，Stage 4 只需跑 E2E + Code Review + 手动验收。

**自动串联流程：**
```
Agent Teams 完成（.agent-status → "complete", 所有 passes: true）
  → Stage 3 SSE 检测到 .agent-status.status === "complete"
  → 显示"开发完成，Agent 已通过 typecheck + 单元测试"
  → 显示"正在进入验收..."（3 秒倒计时，用户可取消）
  → 自动更新 currentStage = 4
  → 路由跳转到 /stage4
  → Stage 4 自动开始 Viewer 验收（E2E + Code Review）
```

**与 Agent Teams 的衔接：**
- Agent Teams 的 Lead Agent 在完成所有 DT 后已做过：
  - 全量 `npx tsc --noEmit` ✅
  - 所有 unit tests ✅
  - `git push origin {branchName}` ✅
- Stage 4 不需要重复这些，只展示"Agent 已验证"状态，然后运行 Viewer 专属测试

**断线恢复：**
- 用户关闭浏览器后再打开，`useProjectValidation` 根据 `currentStage` 自动重定向到 Stage 4
- 已有 currentStage=4 则直接进入 Stage 4

**Acceptance Criteria:**
- [ ] Stage 3 检测到 .agent-status "complete" 后显示倒计时提示（可取消）
- [ ] 倒计时结束后自动跳转到 Stage 4
- [ ] Stage 4 加载后自动开始 Viewer 验收流程（无需用户点击）
- [ ] 用户可在倒计时内取消自动跳转（停留在 Stage 3 查看结果）
- [ ] 断线恢复：根据 currentStage 自动进入正确的 Stage
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### DT-006: Playwright 安装配置
**Description:** 引入 Playwright 测试框架，为 Stage 4 的 E2E 测试层打基础。安装 @playwright/test，创建配置文件和基础目录结构。

**实现方案：**
- `npm install -D @playwright/test` 在 viewer 目录
- 创建 `viewer/playwright.config.ts`（baseURL: http://localhost:3000）
- 创建 `viewer/tests/` 目录 + 一个 smoke test（验证首页加载）
- package.json 新增 scripts: `"test:e2e": "playwright test"`, `"test:unit": "echo 'no unit tests yet'"`
- `.gitignore` 添加 Playwright 产物目录（`test-results/`, `playwright-report/`）

**测试文件位置约定：**
- 单元测试：colocated，放在组件旁边（如 `AgentDataPanel.test.tsx`）
- E2E 测试：放在 `viewer/tests/` 目录（Playwright 标准约定）

**Acceptance Criteria:**
- [ ] `@playwright/test` 安装到 devDependencies
- [ ] `viewer/playwright.config.ts` 配置正确
- [ ] `viewer/tests/smoke.spec.ts` 存在并能运行
- [ ] `npm run test:e2e` 命令可用
- [ ] `.gitignore` 包含 Playwright 产物目录
- [ ] Typecheck passes

---

### DT-007: Stage 4 重构 — Agent 自测 + Viewer 验收
**Description:** 重构 Stage 4，分为两大区域：**Agent 已验证**（展示 Agent Teams 的自测结果）和 **Viewer 验收**（跑 Agent 做不了的测试）。Agent Teams 在 tmux 中没有 browser 环境，无法跑 Playwright E2E，所以 E2E + Code Review + 手动验收由 Viewer 负责。

**验收层次：**

**区域一：Agent 已验证（只读展示，不重复执行）**
1. **Typecheck**（Agent 已做）：显示 ✅ 或 ❌（从 progress.txt / .agent-status 读取）
2. **Unit Tests**（Agent 已做）：显示 ✅ 或 ❌

**区域二：Viewer 验收（Stage 4 自动执行）**
3. **E2E 测试**（自动）：运行 testCases 中 type=e2e 的测试（Playwright，需要 dev server）
4. **Code Review**（自动）：用 Claude 对 `git diff main...HEAD` 做安全/质量审查
5. **手动验收**（人工）：仅 testCases 中 type=manual 的项生成 checklist

**为什么 Agent 不能做 E2E：**
- Playwright 需要 browser + dev server（localhost:3000）
- Agent Teams 运行在 tmux session 中，无 GUI 环境
- Viewer 本身就是 dev server，天然适合跑 E2E

**通过条件：**
- 区域一全部 ✅（Agent 已通过，否则不会进入 Stage 4）
- 区域二的 E2E 全部绿色（自动）
- Code Review 无 HIGH 级别问题（自动）
- 手动项全部勾选（如果有的话；没有 manual testCase 则跳过）

**Acceptance Criteria:**
- [ ] Stage 4 从 prd.json 读取所有 DT 的 testCases
- [ ] 区域一：展示 Agent 的 typecheck + unit test 结果（只读，不重复执行）
- [ ] 区域二：自动执行 E2E + Code Review
- [ ] E2E 测试从 testCases 中 type=e2e 提取并用 Playwright 执行
- [ ] Code Review 调用 Claude 分析 git diff，输出 HIGH/MEDIUM/LOW 问题列表
- [ ] 无 manual testCase 时跳过手动验收层，直接可通过
- [ ] 任一层失败时显示"返回 Stage 3 修复"按钮（重启 Agent Teams）
- [ ] E2E 测试进程增加 5 分钟超时
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### DT-008: Stage 4→5 自动串联 + PR 自动创建
**Description:** Stage 4 全部验收通过后，自动创建 PR 并进入 Stage 5。Stage 5 简化为"确认合并"页面。

**自动串联流程：**
```
Stage 4 全部通过
  → 显示"验收通过，正在创建 PR..."
  → 自动调用 POST /api/git/pr 创建 PR
  → 自动更新 currentStage = 5
  → 路由跳转到 /stage5
  → Stage 5 显示 PR 信息 + "合并到 main" 按钮
```

**Acceptance Criteria:**
- [ ] Stage 4 验收全部通过后自动调用 PR 创建 API
- [ ] PR 创建成功后自动跳转到 Stage 5
- [ ] PR 创建失败时显示错误 + 重试按钮（不自动跳转）
- [ ] Stage 5 加载时不再重复创建 PR（检测已有 PR）
- [ ] [安全] 错误响应不泄露内部信息
- [ ] [安全] 添加权限检查
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### Phase 4: 增强

---

### DT-009: 全局 ErrorRecovery 组件
**Description:** 创建统一的错误恢复组件，替换所有 Stage 的"显示错误 + 刷新页面"模式。

**应用场景：**
- Stage 1 CLI 崩溃 → "连接中断" + 自动重连（3 次）+ "重新开始"
- Stage 3 tmux session 异常退出 → "代理异常退出" + "查看日志" + "重新启动"
- Stage 3 Agent Teams 内部错误 → "Agent 报告错误: {message}" + "重新启动"
- Stage 4 E2E 测试超时 → "测试超时" + "强制终止" + "重新运行"
- Stage 5 PR 失败 → "创建失败：{原因}" + "重试" + "在 GitHub 手动创建"

**Acceptance Criteria:**
- [ ] 创建 `ErrorRecovery` 组件，props: error, diagnosis, actions[]
- [ ] 替换 Stage 1/3/4/5 的错误展示
- [ ] 所有错误消息中文化
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### DT-010: BotoolAgentTeams.sh 模型 + teammate 配置
**Description:** 为 BotoolAgentTeams.sh 增加模型选择和 teammate 模式配置。BotoolAgentTeams.sh 已内置 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 和 `--teammate-mode`，需要补充模型和 effort level 的环境变量传递。

**.botoolrc 新增配置项：**
```bash
CLAUDE_MODEL="opus"              # opus | sonnet | haiku
CLAUDE_EFFORT="high"             # low | medium | high
BOTOOL_TEAMMATE_MODE="in-process" # in-process | tmux (Agent Teams teammate 模式)
```

**实现：** 在 BotoolAgentTeams.sh 的 tmux 环境变量中添加：
```bash
TMUX_ENV="$TMUX_ENV CLAUDE_CODE_EFFORT_LEVEL=${CLAUDE_EFFORT:-high}"
# --model 通过 claude CLI 参数传递
```

**Acceptance Criteria:**
- [ ] BotoolAgentTeams.sh 读取 .botoolrc 中的 CLAUDE_MODEL 配置
- [ ] tmux session 启动时传递 `--model $CLAUDE_MODEL`（如果配置）
- [ ] 传递 `CLAUDE_CODE_EFFORT_LEVEL` 环境变量
- [ ] `.agent-status` 中记录当前使用的模型名
- [ ] .botoolrc.example 包含新配置项及注释
- [ ] 在终端中验证

---

### DT-011: Stage 2 testCases 自动推导
**Description:** 在 Stage 2 的 prd2json 转换过程中，根据每个 DT 的 description 和 acceptanceCriteria 自动推导 testCases。用户可在 JSON 编辑器中修改。

**推导规则：**
- 每个 DT 默认添加 `{ "type": "typecheck" }`
- acceptanceCriteria 中含"映射"/"转换"/"返回"/"计算" → 添加 unit + tdd:true
- acceptanceCriteria 中含"页面"/"布局"/"渲染"/"显示" → 添加 e2e
- acceptanceCriteria 中含"动画"/"视觉"/"颜色"/"流畅" → 添加 manual
- acceptanceCriteria 中含"中文化"/"文案" → 添加 e2e 快照

**Acceptance Criteria:**
- [ ] JsonConvertStep 输出的 prd.json 包含 testCases 字段
- [ ] 推导规则基于关键词匹配 acceptanceCriteria
- [ ] 用户可在 JSON 编辑器中添加/删除/修改 testCases
- [ ] 无匹配时仅添加 typecheck（不报错）
- [ ] Typecheck passes

---

### DT-012: 术语中文化
**Description:** 全面排查 Viewer 中残留的英文和技术术语，替换为非技术用户可理解的中文表达。

**术语替换清单：**
| 当前 | 替换为 | 位置 |
|------|--------|------|
| PRD（首次出现） | 需求文档 (PRD) | Dashboard、Stage 1 |
| Acceptance Criteria | 完成条件 | Stage 3、Stage 4 |
| testCases | 测试用例 | Stage 3、Stage 4 |
| Rule Check | 规范检查 | Stage 2 |
| Auto Enrich | 智能补充 | Stage 2 |
| "Coding" | "自动开发" | Stage 导航 |
| "Testing" | "自动验收" | Stage 导航 |
| "Review" | "确认合并" | Stage 导航 |

**Acceptance Criteria:**
- [ ] 所有 Stage 导航标签使用中文
- [ ] Dashboard 中"PRD"有括号说明
- [ ] Stage 2 步骤名中文化
- [ ] Stage 4 显示"测试用例"和"完成条件"
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### DT-013: /botoolagent-coding skill 重构 — Agent Teams CLI 全自动流水线
**Description:** 将 `/botoolagent-coding` skill 重构为使用 BotoolAgentTeams.sh 的 CLI 自动化入口。Agent Teams 模式下，开发+基础测试由 Lead Agent 内部处理，CLI skill 负责启动 tmux session、等待完成、然后跑 E2E + 创建 PR。

**架构定位：**
```
CLI Layer（开发者）          Viewer Layer（非技术同事）
/botoolagent-generateprd  ←→  Stage 1 (pyramidprd 问答 UI)
/botoolagent-prd2json     ←→  Stage 2 (Pipeline 可视化)
/botoolagent-coding       ←→  Stage 3→4→5 (监控面板)
```

三个 CLI skill 是底层能力，Viewer 是面向非技术用户的前端壳。

**skill 执行流程：**
```
/botoolagent-coding
  1. 前置检查
     ├─ 检查 prd.json 存在且有 passes:false 的任务
     ├─ 检查当前分支是否为 prd.json 中的 branchName（不是则切换/创建）
     └─ 检查无 tmux session botool-teams 在运行（防重复）
  2. 启动 Agent Teams
     ├─ 运行 ./BotoolAgentTeams.sh
     ├─ 定期读 .agent-status 输出进度摘要
     └─ 等待 tmux session 结束或用户 Ctrl+C 中断
  3. 后置验收（Agent 做不了的部分）
     ├─ 运行 Playwright E2E 测试（如果有 testCases type=e2e）
     └─ 输出测试结果摘要
  4. 自动创建 PR（Stage 5 等价）
     ├─ 检查 gh CLI 已认证
     ├─ gh pr create --title "feat: {project}" --body "{自动生成}"
     └─ 输出 PR 链接
  5. 完成
     └─ "开发完成！PR: https://github.com/...  请在 GitHub 上确认合并"
```

**失败处理：**
- Agent Teams 失败/中断 → 输出已完成任务数（从 .agent-status），提示"运行 /botoolagent-coding 继续"
- E2E 测试失败 → 输出失败项，提示"修复后运行 /botoolagent-coding 重新验收"
- PR 创建失败 → 输出错误原因，提示手动 `gh pr create`
- 每步失败都不阻塞，给出明确的下一步操作

**Acceptance Criteria:**
- [ ] /botoolagent-coding skill SKILL.md 重写为 Agent Teams 执行流程
- [ ] 前置检查：prd.json 存在、branchName 分支、无重复 tmux session
- [ ] 启动 BotoolAgentTeams.sh 并等待 tmux session 结束
- [ ] 完成后运行 Playwright E2E（如果有 e2e testCases）
- [ ] E2E 通过后自动 gh pr create
- [ ] 输出 PR 链接作为最终结果
- [ ] 每步失败有明确的错误消息和恢复建议
- [ ] 在终端中验证完整流程

---

### DT-014: Stage 1 CLI 心跳 + 自动重连
**Description:** 为 Stage 1 的 CLI 对话添加心跳检测和自动重连机制，防止 CLI 进程断开后用户不知道怎么办。

**实现方案：**
- 前端定期检测 CLI 进程存活（通过 SSE 或 API ping）
- 心跳间隔：10 秒
- 断开后 3 次自动重连（每次间隔 5 秒）
- 重连失败 → 使用 ErrorRecovery 组件显示"连接中断" + "重新开始"
- 依赖 DT-009 的 ErrorRecovery 组件

**Acceptance Criteria:**
- [ ] Stage 1 前端有心跳检测机制
- [ ] CLI 进程断开后自动尝试重连（最多 3 次）
- [ ] 重连成功时无感知恢复对话
- [ ] 重连失败时显示 ErrorRecovery 组件
- [ ] 错误消息中文化："连接中断，正在重新连接..."
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

## Functional Requirements

- FR-1: Stage 3 不允许同时运行两个代理实例（tmux session 名检测）
- FR-2: Stage 2 保存失败不跳转，显示错误和重试
- FR-3: prd.json 支持 `testCases` 字段，含 type/desc/tdd 属性
- FR-4: agent 在 tdd:true 的任务上先写测试再写实现（TDD 逻辑与执行模式无关）
- FR-5: Stage 3 检测到 Agent Teams 完成后自动进入 Stage 4 验收（3 秒倒计时可取消）
- FR-6: Stage 4 两区域验收：Agent 已验证（只读展示）+ Viewer 验收（E2E + Code Review + 手动）
- FR-7: Stage 4 通过后自动创建 PR 并进入 Stage 5
- FR-8: 所有 async 操作失败时提供具体的恢复操作（tmux session 异常等）
- FR-9: BotoolAgentTeams.sh 支持模型和 effort 配置
- FR-10: 面向非技术用户，全界面无裸露技术术语
- FR-11: `/botoolagent-coding` skill 使用 Agent Teams 实现 CLI 全自动流水线（开发→E2E→PR）
- FR-12: CLI 三个 skill 与 Viewer 五个 Stage 功能对齐，共享底层能力
- FR-13: Stage 1 CLI 对话有心跳检测和自动重连

## Risks & Mitigations

### HIGH
- **testCases 推导准确性**: 关键词匹配可能误判 DT 类型 → **缓解**: 推导结果可在 JSON 编辑器中人工修正；默认只加 typecheck 兜底
- **Stage 3→4 自动串联中断**: 网络断开或浏览器关闭时自动跳转可能失败 → **缓解**: Stage 4 支持手动进入；currentStage 已更新则下次打开直接进 Stage 4
- **Agent Teams 上下文耗尽**: 长时间运行的 tmux session 可能耗尽上下文窗口 → **缓解**: CLAUDE.team.md 指令每批次后执行 /compact；progress.txt 作为外部记忆

### MEDIUM
- **Code Review 质量**: Claude 审查自己写的代码可能不够客观 → **缓解**: 仅作为辅助参考，HIGH 级别问题才阻塞；用户可跳过
- **E2E 测试环境依赖**: Playwright 需要浏览器环境 → **缓解**: E2E 失败时降级为 manual checklist
- **Agent Teams teammate 冲突**: 并行 teammate 修改同一文件可能产生 merge conflict → **缓解**: Lead Agent 在 CLAUDE.team.md 中负责冲突解决；dependsOn 字段确保有依赖的任务不并行
- **tmux session 意外退出**: Claude CLI 崩溃或 OOM → **缓解**: Viewer SSE 检测 tmux session 不存在 → 显示 ErrorRecovery 组件

### LOW
- **向后兼容**: 旧 prd.json 无 testCases → **缓解**: 字段设为可选，不存在时退回 acceptanceCriteria 逻辑
- **术语替换遗漏**: 动态生成的文案可能遗漏 → **缓解**: 逐 Stage 浏览器人工验证
- **.agent-status 格式差异**: Agent Teams 模式不产生 rateLimit/circuitBreaker 字段 → **缓解**: AgentDataPanel 优雅处理缺失字段

## Testing Strategy

### Unit Tests（单元测试）
- TestCase 类型推导逻辑（给定不同 acceptanceCriteria，验证推导出的 testCase 类型）
- tmux session 存活检测逻辑（`tmux has-session` 封装）
- ErrorRecovery 组件渲染不同 action 组合
- .agent-status 解析逻辑（优雅处理 Agent Teams 缺失字段）
- Stage 3→4 串联条件判断（.agent-status "complete" 检测）

### Integration Tests（集成测试）
- Stage 2 生成的 prd.json 包含正确的 testCases
- Stage 3 启动 BotoolAgentTeams.sh → tmux session 创建 → SSE 监控
- Stage 3 完成 → 自动跳转 Stage 4 → 展示 Agent 自测结果 → 执行 E2E
- Stage 4 通过 → 自动创建 PR → 跳转 Stage 5
- Stage 3 刷新页面 → 检测 tmux session → 自动恢复监控
- Stage 1 CLI 断开 → 自动重连 → 恢复对话

### E2E Tests（端到端测试）
- 完整自动化流程：Stage 3 Agent Teams 完成 → Stage 4 验收 → Stage 5 合并
- Stage 4 E2E 测试失败 → 返回 Stage 3 → 重启 Agent Teams → 回 Stage 4
- Stage 1 smoke test：首页加载、导航到各 Stage

## Non-Goals (Out of Scope)

- 后端数据库持久化（继续使用文件系统）
- WebSocket 替代 SSE
- 移动端适配
- 新用户引导/教程系统
- Viewer 前端模型选择 UI（仅 .botoolrc 配置）
- 测试覆盖率强制门槛（不要求 80%，只要求 testCases 定义的项通过）

## Technical Considerations

- prd.json testCases 字段为可选（`testCases?: TestCase[]`），确保向后兼容
- TDD 指令在 CLAUDE.md 和 CLAUDE.team.md 中以"如果存在 testCases"为前提，不破坏现有流程
- Stage 3→4 自动串联通过 `currentStage` 状态机驱动，不引入新的后端逻辑
- Stage 4 Code Review 通过 `/api/cli/chat` 调用 Claude（复用现有 CLI 通道）
- E2E 测试使用 Playwright 框架，配置文件在 `viewer/playwright.config.ts`
- 单元测试文件 colocated（放组件旁边），E2E 测试在 `viewer/tests/`
- **tmux session 名 `botool-teams` 作为进程锁**，不再需要 `.agent-pid` 文件
- **`POST /api/agent/start` 改为 spawn BotoolAgentTeams.sh**（替代 BotoolAgent.sh）
- **`DELETE /api/agent/status` 改为 `tmux kill-session -t botool-teams`**（替代 kill PID）
- **AgentDataPanel 需优雅处理 Agent Teams 模式缺失的 rateLimit/circuitBreaker 字段**
- ErrorRecovery 组件放在 `viewer/src/components/ErrorRecovery/`
- .botoolrc 已存在，DT-010 新增模型和 teammate 配置项
- Claude Code 环境变量：`CLAUDE_CODE_EFFORT_LEVEL`、`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
- 断线恢复基于 `currentStage` 状态机，`useProjectValidation` 已有重定向逻辑
- BotoolAgentTeams.sh 和 CLAUDE.team.md 已存在（前置创建完毕）

## Success Metrics

- 从 Stage 3 开发完成到 Stage 5 可合并，用户只需点击 1 次（合并按钮）
- Agent Teams 并行执行 DT 比 Ralph 串行更快（有 dependsOn 的场景）
- 有 testCases 的 DT 中，tdd:true 的任务确实先产生测试文件再产生实现文件
- Stage 4 清晰区分"Agent 已验证"和"Viewer 验收"，用户能看到每层的通过/失败状态
- 无 manual testCase 的项目，Stage 4 全自动通过，零人工干预
- CLI 用户通过 `/botoolagent-coding` 一条命令完成开发→E2E→PR 全流程
- Stage 1 CLI 断开后，用户在 15 秒内看到自动重连或错误提示

## Architecture

```
┌───────────────────────────────────────────────────┐
│                CLI Layer（开发者）                  │
│                                                   │
│  /botoolagent-generateprd  →  生成 PRD.md         │
│  /botoolagent-prd2json     →  转换 prd.json       │
│  /botoolagent-coding       →  Agent Teams + E2E + PR │
└────────────────────┬──────────────────────────────┘
                     │ 共享底层: BotoolAgentTeams.sh
┌────────────────────┴──────────────────────────────┐
│             Viewer Layer（非技术同事）              │
│                                                   │
│  Stage 1  →  pyramidprd 引导式问答 UI             │
│  Stage 2  →  prd2json Pipeline 可视化             │
│  Stage 3  →  Agent Teams 实时监控面板              │
│  Stage 4  →  Agent 自测展示 + Viewer 验收          │
│  Stage 5  →  确认合并                              │
│         (Stage 3→4→5 自动串联)                     │
└───────────────────────────────────────────────────┘

Agent Teams 内部架构:
┌──────────────────────────────────────┐
│  BotoolAgentTeams.sh (Bash launcher) │
│  └─ tmux session: botool-teams       │
│     └─ Claude CLI (交互式, Lead Agent)│
│        ├─ 读 CLAUDE.team.md 指令      │
│        ├─ 读 prd.json 任务列表        │
│        ├─ 构建依赖图 + 拓扑排序       │
│        ├─ 单任务批次 → 自己做         │
│        ├─ 多任务批次 → spawn teammates │
│        ├─ typecheck + unit tests      │
│        ├─ git commit + push           │
│        └─ 更新 .agent-status          │
│           ↓ (Viewer SSE 读取)         │
│  Stage 3 前端监控                     │
└──────────────────────────────────────┘
```

## Open Questions

- 无（已在对话中确认所有决策）
