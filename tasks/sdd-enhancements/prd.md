# PRD: BotoolAgent SDD 增强 — Spec-Driven Development 体系升级

## Introduction

基于对 Martin Fowler 团队 SDD（Spec-Driven Development）文章的分析，以及对 Kiro、Spec-kit、Tessl 三个工具的对比研究，结合 everything-claude-code 生态的设计模式，本 PRD 旨在系统性升级 BotoolAgent 的规格驱动开发能力。

### 核心问题

1. **一刀切流程**：修个 bug 和建新模块走同一套 5 层金字塔问答，小需求太重，大需求又不够深
2. **Stage 2 富化数据丢失**：代码示例、测试用例、规则审计结果只用于 Viewer 展示，不写入 prd.json，Agent 在 Stage 3 看不到
3. **Spec 遵循无验证**：Agent 说"完成了"，没有机制验证它是否真的按 spec 做了
4. **缺少项目级上下文**：每次迭代只有 CLAUDE.md（指令）和 progress.txt（经验），缺少"这个项目是什么"的结构化描述
5. **经验库非结构化**：progress.txt 的 Codebase Patterns 是纯文本，无法按置信度排序或按领域过滤

### 三层 Spec 架构（核心设计理念）

本 PRD 将 BotoolAgent 的规格体系划分为三个层级，借鉴 Kiro 的三层文档和 Spec-kit 的 Constitution 概念：

```
┌─────────────────────────────────────────┐
│  Layer 1: Constitution（项目级）         │
│  rules/ 目录 + PROJECT.md               │
│  "所有代码都应该怎么写"                   │
│  → 用户手动选择，跨所有 DT 共享          │
│  → 写入 prd.json 的 constitution 字段   │
├─────────────────────────────────────────┤
│  Layer 2: PRD（功能级）                  │
│  PRD markdown + 确认门控                 │
│  "这个功能要做什么"                       │
│  → 用户问答驱动                          │
│  → 写入 prd.json 的项目级字段            │
├─────────────────────────────────────────┤
│  Layer 3: Task Spec（任务级）            │
│  代码示例 + 测试用例 + evals             │
│  "这个具体任务怎么实现和验证"              │
│  → AI 自动生成，一键完成                  │
│  → 写入 prd.json 的 devTasks[].spec     │
└─────────────────────────────────────────┘
```

**设计原则：**
- Constitution（规范）是架构决策，由用户手动选择 — 不自动化
- Task Spec（代码示例+测试用例）是实现细节，由 AI 自动生成 — 一键完成
- 三层数据全部持久化到 prd.json，Agent 在 Stage 3 能获得完整上下文

### 参考来源

- Martin Fowler 文章：[SDD Tools Analysis](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- Kiro（Requirements → Design → Tasks 三层文档）
- Spec-kit（Constitution + Memory Bank）
- Tessl（Spec-as-source 双向同步）
- everything-claude-code（eval-harness, iterative-retrieval, continuous-learning-v2, security-review）

---

## Goals

1. 让不同规模的需求走**匹配的流程**，减少小需求的摩擦，保证大需求的深度
2. 建立**三层 Spec 架构**，将 Constitution（规范）、PRD（功能）、Task Spec（任务）分层管理
3. 将 Stage 2 生成的富化数据**持久化到 prd.json**，让 Agent 获得完整的 spec 上下文
4. 建立 **Spec 遵循度验证**机制，Agent 每次提交前必须自证合规
5. 自动生成 **PROJECT.md** + **.project-status**，提供项目级全局上下文
6. 将 Codebase Patterns 升级为**结构化 patterns.json**，支持置信度和领域分类
7. 为 DT 任务添加**可执行 eval**，实现自动化验收
8. 在 PRD 生成阶段**自动注入安全检查项**，保护非技术用户

---

## Design Decisions (已确认)

以下设计决策在规划阶段已确认，各 DT 实现时应严格遵循：

| # | 决策 | 结论 |
|---|------|------|
| D1 | Quick Fix 是否需要单独的 Viewer 路由？ | **不需要**。复用 Stage 1 页面，通过模式切换 UI 展示不同内容。Quick Fix 选中时隐藏金字塔导航，显示单输入框+任务确认列表 |
| D2 | patterns.json 的最大条目数？ | **30 条上限**。按领域分配（每个领域最多 10 条）。淘汰规则：confidence < 0.4 且超过 30 天未验证的条目标记为 `deprecated`，Agent 不读取但不删除 |
| D3 | eval 失败是否阻塞提交？ | **code-based eval 默认阻塞，model-based eval 默认不阻塞**。通过 `blocking` 字段控制，可覆盖默认值 |
| D4 | PROJECT.md 是否提交到 git？ | **拆为两个文件**：`PROJECT.md`（技术栈、架构、约定 → 提交 git）+ `.project-status`（当前分支、进行中任务 → .gitignore） |
| D5 | Feature Build 模式的 Stage 2 自动富化是否需要用户确认？ | **不需要逐步确认**。自动跑完后展示合并确认页（摘要+可展开详情），用户可直接点"开始开发"或展开查看 |
| D6 | 规范（rules）在 prd.json 中的位置？ | **项目级 `constitution` 字段**，不放在每个 DT 的 spec 中。规范是 Constitution 层，跨所有 DT 共享 |
| D7 | Stage 2 流水线步骤数？ | **从 4 步精简为 3 步**：①规则选择（手动）→ ②自动生成代码示例+测试用例（一键）→ ③确认。CodeExampleStep 和 TestCaseStep 合并为 AutoEnrichStep |

---

## Dev Tasks

### DT-001: 需求模式选择系统 — AI 推荐 + 用户决定

**描述：** 在 pyramidprd SKILL.md 和 Viewer Stage 1 入口增加三档模式选择。AI 根据用户输入自动分析并推荐模式，但最终由用户选择。

**三个模式定义：**

| 模式 | 名称 | 用户交互时间 | 适用场景 |
|------|------|-------------|----------|
| 🟢 | 快速修复 (Quick Fix) | ~2 分钟 | 改 bug、调样式、小调整 |
| 🟡 | 功能开发 (Feature Build) | ~10-15 分钟 | 新功能、新页面、多文件变更 |
| 🔴 | 完整规划 (Full Planning) | ~30-45 分钟 | 架构级变更、新模块、复杂系统 |

**AI 推荐逻辑（内部评分，不展示给用户）：**

| 分析维度 | 权重 | Quick | Feature | Project |
|----------|------|-------|---------|---------|
| 涉及文件数（预估） | 30% | 1-2个 | 3-8个 | 8+个 |
| 是否有数据模型变更 | 25% | 无 | 可能有 | 一定有 |
| 是否需要新建模块/页面 | 20% | 否 | 可能 | 是 |
| 是否涉及多个系统层 | 15% | 1层 | 2-3层 | 全栈 |
| 描述复杂度（字数/概念） | 10% | <50字 | 50-200字 | 200+字 |

**交互设计（Viewer UI）：**

```
┌──────────────────────────────────────────────────────┐
│  📋 我分析了你的需求，推荐使用以下模式：                │
│                                                      │
│  🟢 快速修复                          ⏱️ 约 2 分钟    │
│     适合：改 bug、调样式、小调整                       │
│     流程：描述需求 → 确认任务 → 自动执行               │
│                                                      │
│  🟡 功能开发  ⭐ 推荐                 ⏱️ 约 10-15 分钟 │
│     适合：新功能、新页面、多文件变更                    │
│     流程：核心问答 → 任务规划 → 确认 → 自动执行        │
│                                                      │
│  🔴 完整规划                          ⏱️ 约 30-45 分钟 │
│     适合：架构级变更、新模块、复杂系统                  │
│     流程：5层金字塔问答 → 富化规格 → 确认 → 自动执行   │
│                                                      │
│  💡 推荐理由：你的需求涉及新增页面和 API 接口，         │
│     但不涉及架构变更，功能开发模式最合适。              │
│                                                      │
│  [🟢 快速修复]  [🟡 功能开发 ⭐]  [🔴 完整规划]        │
└──────────────────────────────────────────────────────┘
```

**交互设计（CLI / SKILL.md）：**

使用 AskUserQuestion 的 options 格式呈现相同的选择。

**每个模式的完整流程（Stage 1 + Stage 2）：**

🟢 **快速修复（~2 分钟用户交互）**：

Stage 1:
1. 用户一句话描述（30秒）
2. AI 扫描代码库 + 生成 1-3 个 DT 任务（自动）
3. 用户确认任务列表（1分钟）

Stage 2:
- **跳过**。不选规则，不生成代码示例/测试用例
- 如果项目已有默认规则集（上次选择记录） → 自动应用到 prd.json 的 `constitution` 字段，不问用户
- 直接生成轻量 prd.json（无 `spec` 字段、`constitution` 可选）→ 进入 Stage 3

产物：
- 不产生 PRD markdown 文件
- prd.json 只有基本 devTasks 字段

🟡 **功能开发（~10-15 分钟用户交互）**：

Stage 1:
1. L1 核心问答（3-5 个问题，5分钟）
2. Codebase Scan（自动）
3. L4 任务拆解 + 确认门控（5分钟）
4. 生成 PRD markdown（自动）
- 跳过 L2（领域维度）和 L3（详细需求）

Stage 2（3 步流水线）:
1. **①规则选择**（手动，保留当前 RuleCheckStep UI）
2. **②自动生成**（一键，AutoEnrichStep 合并生成代码示例+测试用例，后台自动）
3. **③合并确认页**（EnrichmentSummary，展示摘要，可展开详情，不需逐项审阅）

```
┌──────────────────────────────────────────┐
│  📋 自动规划完成，请确认：                  │
│                                          │
│  📦 3 个开发任务                          │
│  💻 生成了 5 个代码示例                   │
│  🧪 生成了 8 个测试用例                   │
│  📏 应用了 2 条编码规则                   │
│                                          │
│  [查看详情 ▼]  ← 可展开查看，默认收起      │
│                                          │
│  [开始开发]  [返回修改]                    │
└──────────────────────────────────────────┘
```

产物：
- PRD markdown 文件
- 富化 prd.json（含 `constitution` + `devTasks[].spec`）

🔴 **完整规划（~30-45 分钟用户交互）**：

Stage 1:
1. L1 愿景与背景（5分钟）
2. Codebase Scan（自动）
3. L2 核心维度（10分钟）
4. L3 详细需求（10分钟）
5. L4 任务拆解（5分钟）
6. L5 确认门控（5分钟）
7. 生成 PRD markdown（自动）

Stage 2（3 步流水线）:
1. **①规则选择**（手动，保留当前 RuleCheckStep UI）
2. **②生成+审阅**（AutoEnrichStep 生成后暂停，展示代码示例和测试用例供用户审阅和修改）
3. **③最终确认**（EnrichmentSummary，展示完整详情）

产物：
- PRD markdown 文件
- 富化 prd.json（含 `constitution` + `devTasks[].spec` + `devTasks[].evals`）

**关键规则：**
- 可以升档（Quick → Feature → Full），不能降档
- AI 推荐带 ⭐ 标记，但用户可选任意模式
- 时间估算只包含用户主动交互时间，不含 AI 处理时间
- Viewer Stage 1 复用同一路由（D1），通过模式切换 UI 控制显示内容

**核心改动：**
- `~/.claude/skills/botoolagent-pyramidprd/SKILL.md` — 增加模式选择入口和三条流程分支
- `viewer/src/app/stage1/page.tsx` — 增加模式选择 UI，根据模式切换显示内容（D1）
- `viewer/src/components/pyramid/ModeSelector.tsx` — 新组件：模式选择卡片（含 AI 推荐标记和时间估算）
- `viewer/src/lib/tool-types.ts` — 增加 `mode: 'quick' | 'feature' | 'full'` 类型

**Acceptance Criteria：**
- [ ] pyramidprd SKILL.md 支持三种模式流程
- [ ] Viewer Stage 1 展示模式选择 UI（带推荐标记和时间估算）
- [ ] AI 根据用户输入自动推荐模式并显示推荐理由
- [ ] 用户可选择任意模式（不受推荐限制）
- [ ] Quick Fix 模式：跳过 PRD markdown，跳过 Stage 2，直接生成轻量 prd.json
- [ ] Feature Build 模式：Stage 1 只走 L1 + L4 + 确认；Stage 2 走 3 步流水线（规则手动→自动生成→合并确认）
- [ ] Full Planning 模式：Stage 1 走完整 L1→L5；Stage 2 走 3 步流水线（规则手动→生成+审阅→最终确认）
- [ ] 支持升档（用户可在过程中切换到更详细的模式）
- [ ] Stage 1 页面根据模式切换显示内容（Quick Fix 隐藏金字塔导航）
- [ ] Typecheck passes

**Priority:** 1

---

### DT-002: 富化 prd.json + Stage 2 UI 改造

**描述：** 扩展 prd.json schema（增加项目级 `constitution` 字段和任务级 `spec` 字段），将 Stage 2 生成的规则、代码示例、测试用例持久化到 prd.json。同时改造 Stage 2 Viewer UI：将 4 步流水线精简为 3 步，CodeExampleStep 和 TestCaseStep 合并为 AutoEnrichStep。

**当前问题：** Stage 2 的 RuleCheckStep、CodeExampleStep、TestCaseStep 生成了丰富的数据，但只用于 Viewer UI 展示，不写入 prd.json。JsonConvertStep 只保存基本任务结构。

### A) prd.json Schema 更新

**新增项目级 `constitution` 字段**（规范属于 Constitution 层，跨所有 DT 共享）：

```json
{
  "project": "ProjectName",
  "branchName": "botool/feature-name",
  "description": "Feature description",

  "constitution": {
    "rules": [
      {
        "id": "frontend/react-best-practices",
        "name": "React 最佳实践",
        "category": "frontend",
        "content": "规则全文内容（可选，Agent 可按 id 查找 rules/ 目录）"
      }
    ],
    "ruleAuditSummary": "PRD 与规则无冲突，建议关注组件命名规范"
  },

  "devTasks": [
    {
      "id": "DT-001",
      "title": "任务标题",
      "description": "任务描述",
      "acceptanceCriteria": ["标准验收条件"],
      "priority": 1,
      "passes": false,
      "dependsOn": [],
      "contextHint": "",
      "notes": "",

      "spec": {
        "codeExamples": [
          {
            "language": "typescript",
            "description": "数据类型定义",
            "code": "export type Status = 'pending' | 'active' | 'done';"
          }
        ],
        "testCases": [
          {
            "type": "unit",
            "description": "测试状态转换",
            "steps": ["创建对象", "调用方法", "断言结果"]
          },
          {
            "type": "e2e",
            "description": "用户操作流程",
            "steps": ["打开页面", "点击按钮", "验证状态"]
          }
        ],
        "filesToModify": ["src/types/task.ts", "src/components/TaskCard.tsx"],
        "relatedFiles": ["src/lib/task-actions.ts"]
      },

      "evals": []
    }
  ]
}
```

**字段说明：**

项目级：
- `constitution.rules[]`: Stage 2 RuleCheckStep 选择的规则（Constitution 层，跨所有 DT 共享）
- `constitution.ruleAuditSummary`: 规则审计摘要

任务级：
- `dependsOn`: 该任务依赖哪些前置任务（Agent 据此读取相关历史日志）
- `contextHint`: 自然语言提示，告诉 Agent 重点关注什么上下文
- `spec.codeExamples`: Stage 2 AutoEnrichStep 生成的代码示例（Task Spec 层）
- `spec.testCases`: Stage 2 AutoEnrichStep 生成的测试用例（Task Spec 层）
- `spec.filesToModify`: 预计需要修改的文件列表
- `spec.relatedFiles`: 相关但不一定修改的文件
- `evals`: 可执行验证命令（详见 DT-006）

**注意：规范不在 `spec` 中。** 规范属于 Constitution 层，放在项目级 `constitution` 字段。`spec` 只包含任务级的实现细节。

### B) Stage 2 Viewer UI 改造

**当前 4 步流水线（废弃）：**
```
Step 1: 规则选择 → Step 2: 代码示例 → Step 3: 测试用例 → Step 4: JSON 转换
   手动              手动               手动              手动
```

**新 3 步流水线：**

```
Step 1: 规则选择          Step 2: 自动生成           Step 3: 确认
   手动选择规范      →    代码示例+测试用例+JSON   →   合并摘要页
   (RuleCheckStep)       (AutoEnrichStep)           (EnrichmentSummary)
   保留当前 UI            一键 / 可审阅               确认或返回修改
```

**各步骤行为按模式区分：**

| 步骤 | Feature Build | Full Planning |
|------|---------------|---------------|
| ①规则选择 | 手动选择（同当前） | 手动选择（同当前） |
| ②自动生成 | 一键自动，不暂停审阅 | 生成后暂停，展示结果供审阅修改 |
| ③确认 | 合并摘要页（默认收起详情） | 最终确认页（默认展开详情） |

**组件变更：**
- `CodeExampleStep.tsx` + `TestCaseStep.tsx` → 合并为 `AutoEnrichStep.tsx`
- `JsonConvertStep.tsx` → 重构为 `EnrichmentSummary.tsx`（合并确认 + JSON 转换）
- `PipelineProgress.tsx` — 从 4 步改为 3 步进度指示器
- Stage 2 page.tsx — 更新步骤编排逻辑，接受 `mode` 参数控制各步骤行为

**数据流：**
```
RuleCheckStep.output (rules[])
        │
        ▼
AutoEnrichStep.output (codeExamples[], testCases[])
        │
        ▼
EnrichmentSummary → 合并所有数据 → 写入 prd.json
                    ├─ constitution.rules ← RuleCheckStep
                    ├─ devTasks[].spec.codeExamples ← AutoEnrichStep
                    ├─ devTasks[].spec.testCases ← AutoEnrichStep
                    └─ devTasks[].spec.filesToModify ← AutoEnrichStep
```

**核心改动：**
- `viewer/src/app/stage2/page.tsx` — 重构为 3 步流水线，接受 `mode` 参数
- `viewer/src/components/pipeline/AutoEnrichStep.tsx` — 新组件：合并代码示例+测试用例生成
- `viewer/src/components/pipeline/EnrichmentSummary.tsx` — 新组件：合并确认页+JSON 转换
- `viewer/src/components/pipeline/PipelineProgress.tsx` — 从 4 步改为 3 步
- `viewer/src/components/pipeline/RuleCheckStep.tsx` — 保留，输出写入 `constitution` 字段
- `viewer/src/components/pipeline/CodeExampleStep.tsx` — 废弃，逻辑迁入 AutoEnrichStep
- `viewer/src/components/pipeline/TestCaseStep.tsx` — 废弃，逻辑迁入 AutoEnrichStep
- `viewer/src/components/pipeline/JsonConvertStep.tsx` — 废弃，逻辑迁入 EnrichmentSummary
- `viewer/src/lib/tool-types.ts` — 增加 `Constitution`, `DevTaskSpec`, `EnrichmentData` 类型
- `~/.claude/skills/botoolagent-prd2json/SKILL.md` — 更新 prd.json schema 说明

**Acceptance Criteria：**
- [ ] prd.json 包含项目级 `constitution` 字段（含 rules[] 和 ruleAuditSummary）
- [ ] prd.json 的 devTasks 包含 `spec` 字段（含 codeExamples, testCases, filesToModify, relatedFiles）
- [ ] prd.json 的 devTasks 包含 `dependsOn` 和 `contextHint` 字段
- [ ] 规范数据写入 `constitution`（项目级），不写入 `devTasks[].spec`
- [ ] Stage 2 流水线从 4 步精简为 3 步（规则选择→自动生成→确认）
- [ ] AutoEnrichStep 合并了原 CodeExampleStep 和 TestCaseStep 的功能
- [ ] EnrichmentSummary 合并了原 JsonConvertStep 的功能，增加摘要展示
- [ ] Feature Build 模式：AutoEnrichStep 一键自动，EnrichmentSummary 默认收起详情
- [ ] Full Planning 模式：AutoEnrichStep 生成后暂停供审阅，EnrichmentSummary 默认展开详情
- [ ] EnrichmentSummary 正确合并 constitution + spec 数据并写入 prd.json
- [ ] 向后兼容：没有 `constitution` 或 `spec` 字段的旧 prd.json 仍可正常使用
- [ ] Quick Fix 模式跳过 Stage 2，prd.json 可以没有 `constitution` 和 `spec` 字段
- [ ] Typecheck passes

**Priority:** 2

---

### DT-003: Agent 指令升级 — Spec 遵循验证 + 渐进式上下文

**描述：** 更新 CLAUDE.md 的 Agent 指令，增加三层 Spec 读取流程、Spec 遵循度自检步骤、渐进式上下文检索策略。Agent 在每次迭代中先读 Constitution（项目规范），再读 Task Spec（任务细节）。

**新增 CLAUDE.md 内容：**

**A) 三层 Spec 读取流程：**

```markdown
## 任务执行流程（更新）

1. 读取 PROJECT.md（如果存在）— 了解项目全局
2. 读取 .project-status（如果存在）— 了解当前状态
3. 读取 patterns.json（如果存在）— 了解累积经验，按 confidence 降序
4. 读取 prd.json：
   a. 读取 `constitution.rules` — 了解项目编码规范（Constitution 层）
   b. 选择优先级最高且 passes: false 的任务
   c. 读取该任务的 `spec` 字段（如果存在）— 了解实现细节（Task Spec 层）：
      - spec.codeExamples → 期望的代码结构和类型定义
      - spec.testCases → 需要通过的测试场景
   d. 读取该任务的 `evals` 字段（如果存在）— 了解验证命令
5. 执行上下文检索（见下文）
6. 实现任务
7. 运行 evals（见下文）
8. 执行 Spec 对照检查（见下文）
9. 提交 + 更新状态
```

**B) 渐进式上下文检索（实现任务前执行）：**

```markdown
## 上下文检索（步骤 5）

1. 读取当前任务的 `spec.filesToModify` 和 `spec.relatedFiles`
2. 如果这些字段存在，直接读取这些文件
3. 如果这些字段为空或不存在，执行搜索：
   a. 用任务标题和描述中的关键词搜索相关文件
   b. 评估每个文件与当前任务的相关性
   c. 只深度阅读高相关性的文件（最多 5 个）
4. 如果任务有 `dependsOn`，读取依赖任务在 progress.txt 中的日志
5. 如果任务有 `contextHint`，按提示重点关注特定上下文
```

**C) Eval 执行（提交前，步骤 7）：**

```markdown
## Eval 执行（步骤 7）

如果当前任务有 `evals` 字段：
1. 按顺序运行所有 eval
2. 对 code-based eval（blocking: true）：
   - 运行命令，检查 expect 条件
   - 如果失败 → 必须修复后重新运行，不可提交
3. 对 model-based eval（blocking: false）：
   - 评估相关文件是否满足 criteria
   - 如果不满足 → 记录警告，不阻塞提交
4. 将所有 eval 结果写入 progress.txt 的任务日志
```

**D) Spec 遵循度验证（提交前，步骤 8）：**

```markdown
## Spec 对照检查（步骤 8）

在 git commit 之前，必须执行以下检查：

1. ✅ typecheck 通过
2. ✅ lint 通过
3. ✅ test 通过（如果有）
4. ✅ evals 通过（blocking 类型必须全部通过）
5. ✅ **Spec 对照检查**：
   - 逐条核对当前任务的 acceptanceCriteria
   - 对每条写出：✅ 已满足 / ❌ 未满足（附原因）/ ⬚ 不适用
   - 如果有 spec.testCases，确认测试覆盖情况
   - 如果有 spec.codeExamples，确认实现是否符合预期类型/接口
   - 如果有 constitution.rules，确认代码是否遵循选定的编码规范
   - 将检查结果写入 progress.txt 的任务日志中
```

**核心改动：**
- `CLAUDE.md` — 更新任务执行流程（三层 Spec 读取、上下文检索、Eval 执行、Spec 对照检查）

**Acceptance Criteria：**
- [ ] CLAUDE.md 包含三层 Spec 读取流程（PROJECT.md → constitution → spec）
- [ ] CLAUDE.md 包含渐进式上下文检索策略（spec.filesToModify 优先）
- [ ] CLAUDE.md 包含 Eval 执行指令（blocking/non-blocking 区分）
- [ ] CLAUDE.md 包含 Spec 对照检查指令（含 constitution.rules 检查）
- [ ] Agent 在 progress.txt 的任务日志中包含 Spec 对照检查结果
- [ ] Agent 在 progress.txt 的任务日志中包含 Eval 执行结果
- [ ] Agent 优先使用 spec.filesToModify 而非盲目搜索
- [ ] Agent 读取 dependsOn 任务的历史日志
- [ ] Typecheck passes（N/A — 纯 Markdown 改动）

**Priority:** 3

---

### DT-004: PROJECT.md + .project-status — 项目 Constitution

**描述：** 在 Codebase Scan 阶段自动生成或更新 `PROJECT.md`（稳定项目描述，提交 git）和 `.project-status`（动态运行状态，.gitignore）。Agent 每次迭代时先读取这两个文件，无需通读整个 progress.txt。

**PROJECT.md 结构（提交 git）：**

```markdown
# Project Constitution

## 技术栈
- Framework: Next.js 16
- Language: TypeScript 5
- Styling: Tailwind CSS v4
- Database: PostgreSQL via Prisma
- Package Manager: npm

## 架构概览
- /src/app → App Router pages
- /src/components → 可复用组件
- /src/lib → 工具函数和 API 客户端
- /src/app/api → API 路由

## 核心约定
- [从 CLAUDE.md 和 rules/ 自动提取]
- [从 patterns.json 中 confidence ≥ 0.8 的条目自动合并]

## 目录结构
[自动生成的关键目录树]
```

**.project-status 结构（.gitignore）：**

```json
{
  "currentBranch": "botool/feature-name",
  "lastCompleted": ["DT-001", "DT-002"],
  "inProgress": "DT-003",
  "updatedAt": "2026-02-10T12:00:00Z"
}
```

**生成时机：**
1. pyramidprd / generateprd 的 Codebase Scan 阶段 → 首次生成 PROJECT.md
2. Agent 每次完成任务后 → 更新 `.project-status`
3. 用户手动触发（Viewer Dashboard 按钮）→ 完整重新生成 PROJECT.md

**核心改动：**
- `~/.claude/skills/botoolagent-pyramidprd/SKILL.md` — Codebase Scan 时生成 PROJECT.md
- `~/.claude/skills/botoolagent-generateprd/SKILL.md` — 同上
- `CLAUDE.md` — Agent 每次迭代读取 PROJECT.md 和 .project-status；完成任务后更新 .project-status
- `.gitignore` — 添加 `.project-status`

**Acceptance Criteria：**
- [ ] pyramidprd Codebase Scan 阶段自动生成 PROJECT.md
- [ ] generateprd Codebase Scan 阶段自动生成 PROJECT.md
- [ ] PROJECT.md 包含技术栈、架构概览、核心约定、目录结构（不包含动态状态）
- [ ] .project-status 包含当前分支、最近完成、正在进行、更新时间
- [ ] .project-status 在 .gitignore 中
- [ ] CLAUDE.md 指示 Agent 在每次迭代开始时读取 PROJECT.md 和 .project-status
- [ ] Agent 完成任务后更新 .project-status（不修改 PROJECT.md）
- [ ] 如果 PROJECT.md 已存在，Codebase Scan 时更新而非覆盖
- [ ] 核心约定部分自动合并 patterns.json 中 confidence ≥ 0.8 的条目
- [ ] Typecheck passes（N/A — 纯 Markdown/JSON 改动）

**Priority:** 4

---

### DT-005: 结构化经验库 — patterns.json

**描述：** 将 progress.txt 顶部的 Codebase Patterns 纯文本部分升级为结构化的 `patterns.json` 文件，支持置信度评分、领域分类、证据追踪。总条目上限 30 条，按领域分配（每领域最多 10 条）。

**patterns.json 结构：**

```json
{
  "version": "1.0",
  "maxEntries": 30,
  "lastUpdated": "2026-02-10T12:00:00Z",
  "patterns": [
    {
      "id": "pat-001",
      "trigger": "修改 prisma schema 后",
      "action": "必须同时更新 types/ 目录的 TypeScript 类型定义",
      "confidence": 0.9,
      "domain": "database",
      "evidence": [
        "DT-003: 忘了更新类型导致 typecheck 失败",
        "DT-007: 按此模式成功完成"
      ],
      "status": "active",
      "createdAt": "2026-01-15",
      "lastValidated": "2026-02-08"
    },
    {
      "id": "pat-002",
      "trigger": "添加新 API 路由时",
      "action": "检查 middleware.ts 是否需要添加对应的权限规则",
      "confidence": 0.6,
      "domain": "security",
      "evidence": [
        "DT-005: 发现缺少权限检查"
      ],
      "status": "active",
      "createdAt": "2026-02-01",
      "lastValidated": "2026-02-01"
    }
  ]
}
```

**置信度规则：**
- 0.3 — 初始（首次发现）
- 0.6 — 有 2+ 条证据
- 0.9 — 有 3+ 条证据且近期验证过
- confidence ≥ 0.8 → 硬性规则（Agent 必须遵循）+ 自动合并到 PROJECT.md 核心约定
- confidence < 0.8 → 建议（Agent 可酌情忽略）

**淘汰规则：**
- 总条目 > 30 时，将 confidence < 0.4 且超过 30 天未验证的条目 `status` 改为 `deprecated`
- Agent 只读取 `status: "active"` 的条目
- `deprecated` 条目不删除（人可以恢复）

**领域分类（domain）：**
- `database` — 数据库和 ORM 相关
- `frontend` — 前端组件和 UI 相关
- `backend` — API 和服务端相关
- `security` — 安全相关
- `testing` — 测试相关
- `general` — 通用模式
- 每个领域最多 10 条 active 条目

**Agent 行为：**
- 每次迭代开始时读取 patterns.json，按 confidence 降序排列，只读 `status: "active"`
- 任务完成后，如果发现新模式或验证了旧模式，更新 patterns.json
- progress.txt 的 Codebase Patterns 部分改为引用 patterns.json（"详见 patterns.json"，向后兼容）

**核心改动：**
- `CLAUDE.md` — 更新 Agent 指令，读取和更新 patterns.json
- `BotoolAgent.sh` — 初始化时创建空 patterns.json（如果不存在）
- progress.txt — 保留 Codebase Patterns 部分但标注"详见 patterns.json"

**Acceptance Criteria：**
- [ ] patterns.json 结构包含 id、trigger、action、confidence、domain、evidence、status 字段
- [ ] 总条目上限 30 条，每领域最多 10 条 active
- [ ] CLAUDE.md 指示 Agent 在迭代开始时读取 patterns.json（只读 status: active）
- [ ] CLAUDE.md 指示 Agent 在发现新模式时更新 patterns.json
- [ ] confidence ≥ 0.8 的条目被标记为硬性规则
- [ ] 淘汰规则：confidence < 0.4 且 30 天未验证 → deprecated
- [ ] 向后兼容：没有 patterns.json 时 Agent 仍正常工作（回退到 progress.txt）
- [ ] BotoolAgent.sh 在初始化时创建空 patterns.json（如不存在）
- [ ] Typecheck passes（N/A — JSON + Markdown 改动）

**Priority:** 5

---

### DT-006: Eval 系统 — DT 级别可执行验证命令

**描述：** 在 prd.json 的 devTasks 中启用 `evals` 字段（schema 已在 DT-002 中定义），定义可执行的验证命令。code-based eval 默认阻塞提交（`blocking: true`），model-based eval 默认不阻塞（`blocking: false`）。Stage 2 的 AutoEnrichStep 在生成测试用例时同步生成 eval 命令建议。

**eval 类型和阻塞行为（D3）：**

| 类型 | 执行方式 | 默认 blocking | 适用场景 |
|------|----------|---------------|----------|
| code-based | 运行 shell 命令 | `true`（阻塞） | typecheck、grep、test runner |
| model-based | Agent 自然语言评估 | `false`（不阻塞） | 代码质量、UI 合理性 |

**prd.json 中的 evals 字段：**

```json
{
  "id": "DT-001",
  "title": "...",
  "evals": [
    {
      "type": "code-based",
      "blocking": true,
      "description": "验证类型定义存在",
      "command": "grep -r 'TaskStatus' src/types/",
      "expect": "exit-0"
    },
    {
      "type": "code-based",
      "blocking": true,
      "description": "Typecheck 通过",
      "command": "npx tsc --noEmit",
      "expect": "exit-0"
    },
    {
      "type": "model-based",
      "blocking": false,
      "description": "检查 TaskCard 组件是否根据 status 显示不同颜色",
      "files": ["src/components/TaskCard.tsx"],
      "criteria": "组件根据 status prop 渲染不同的背景颜色类名"
    }
  ]
}
```

**expect 类型：**
- `exit-0` — 命令退出码为 0
- `exit-non-0` — 命令退出码不为 0（用于测试预期失败）
- `contains:xxx` — 命令输出包含指定字符串
- `not-contains:xxx` — 命令输出不包含指定字符串

**生成时机：**
- Stage 2 的 AutoEnrichStep 在生成测试用例时，同步生成对应的 code-based eval 命令建议
- Full Planning 模式下用户可在审阅时修改 eval 命令
- Agent 在执行过程中可以添加或修改 eval（如发现更好的验证命令）

**执行时机（已在 DT-003 的 CLAUDE.md 中定义）：**
1. Agent 提交前 — CLAUDE.md 步骤 7
2. BotoolAgent.sh — 可选的 iteration 后验检查

**核心改动：**
- `viewer/src/lib/tool-types.ts` — 增加 `DevTaskEval` 类型（含 `blocking` 字段）
- `viewer/src/components/pipeline/AutoEnrichStep.tsx` — 在生成测试用例时同步生成 eval 建议
- `~/.claude/skills/botoolagent-prd2json/SKILL.md` — 更新 prd.json schema 说明（含 evals）
- `BotoolAgent.sh` — 可选的 eval 执行后验（读取 prd.json 的 evals 并执行 code-based 类型）

**Acceptance Criteria：**
- [ ] prd.json 的 devTasks 支持 `evals` 字段（含 type, blocking, description, command/criteria, expect）
- [ ] code-based eval 默认 `blocking: true`，model-based eval 默认 `blocking: false`
- [ ] `blocking` 字段可被显式覆盖
- [ ] AutoEnrichStep 在生成测试用例时同步生成 eval 命令建议
- [ ] CLAUDE.md 中的 Eval 执行指令正确区分 blocking/non-blocking（已在 DT-003 中实现）
- [ ] eval 结果记录在 progress.txt 的任务日志中
- [ ] 向后兼容：没有 `evals` 字段时正常工作
- [ ] Typecheck passes

**Priority:** 6

---

### DT-007: 安全检查自动注入 — PRD 阶段关键词触发

**描述：** 在 PRD 生成阶段（pyramidprd 和 generateprd），当检测到涉及安全敏感功能的关键词时，自动在相关 DT 的 acceptanceCriteria 中注入安全检查项。非技术用户不需要懂安全，系统自动保护。Quick Fix 模式默认不注入（除非关键词匹配度很高）。

**关键词 → 安全检查项映射：**

| 触发关键词 | 自动注入的 acceptanceCriteria |
|------------|-------------------------------|
| 登录/认证/auth/密码 | "[安全] 密码使用 bcrypt/argon2 加密", "[安全] 使用 httpOnly cookies", "[安全] 登录接口设置速率限制" |
| 支付/payment/金额 | "[安全] 金额使用整数（分）存储避免浮点误差", "[安全] 支付接口验证签名", "[安全] CSRF 保护" |
| 用户输入/表单/form | "[安全] 输入使用 schema 验证（如 zod）", "[安全] XSS 防护（DOMPurify 或框架内置）", "[安全] 字符串长度限制" |
| API/接口/endpoint | "[安全] 使用参数化查询防止 SQL 注入", "[安全] 错误响应不泄露内部信息", "[安全] 添加权限检查" |
| 文件上传/upload | "[安全] 文件类型白名单校验", "[安全] 文件大小限制", "[安全] 存储路径不可由用户控制" |
| 数据库/database/SQL | "[安全] 使用参数化查询", "[安全] 敏感字段加密存储", "[安全] 迁移脚本使用 IF NOT EXISTS" |

**注入方式：**
- 在 PRD 生成的最后一步，扫描所有 DT 的 title 和 description
- 匹配关键词后，在对应 DT 的 acceptanceCriteria 末尾追加安全项
- 所有安全项以 `[安全]` 前缀标记，便于识别和在评审摘要中统计（DT-008 依赖此前缀）
- 用户在确认门控（L5 或合并确认页）时可以看到并移除不适用的安全项
- Quick Fix 模式：仅在关键词为"登录/认证/auth/密码"或"支付/payment"时注入（高风险），其余不注入

**核心改动：**
- `~/.claude/skills/botoolagent-pyramidprd/SKILL.md` — PRD 生成模板增加安全关键词扫描逻辑
- `~/.claude/skills/botoolagent-generateprd/SKILL.md` — 同上

**Acceptance Criteria：**
- [ ] pyramidprd 在生成 PRD 时扫描关键词并注入安全 acceptanceCriteria
- [ ] generateprd 同样支持安全检查注入
- [ ] 安全项以 `[安全]` 前缀标识
- [ ] 确认门控阶段用户可以看到注入的安全项
- [ ] 映射关系覆盖：认证、支付、用户输入、API、文件上传、数据库 六大类
- [ ] 不涉及安全敏感功能的 DT 不会被注入额外项
- [ ] Quick Fix 模式仅对高风险关键词（认证/支付）注入
- [ ] Typecheck passes（N/A — 纯 SKILL.md 改动）

**Priority:** 7

---

### DT-008: Viewer 智能评审面板 — Stage 4/5 人话摘要

**描述：** 在 Viewer 的 Stage 4（测试验证）和 Stage 5（合并发布）增加 AI 评审摘要面板。从 prd.json 的 `constitution`、`devTasks[].spec`、`devTasks[].evals` 以及 progress.txt 中的 Spec 对照检查结果提取数据，翻译为非技术用户能理解的人话摘要。

**评审摘要内容：**

```
┌──────────────────────────────────────────────────────┐
│  📊 开发摘要                                         │
│                                                      │
│  ✅ 完成 5/5 个任务                                   │
│  ✅ 所有类型检查通过                                   │
│  ✅ Spec 遵循率: 94% (16/17 项验收标准满足)            │
│                                                      │
│  ⚠️ 1 个偏差：                                       │
│    DT-003 用了 Drawer 替代 Modal                     │
│    原因：移动端体验更好                                │
│                                                      │
│  📝 代码变更概要：                                    │
│    新增 3 个组件、修改 2 个 API 路由                   │
│    新增 147 行、删除 32 行                            │
│                                                      │
│  📏 编码规范遵循：应用了 2 条规则（React 最佳实践、    │
│     命名规范），未发现违规                             │
│                                                      │
│  🔒 安全检查：4/4 项 [安全] 验收标准通过               │
│                                                      │
│  🧪 Eval 结果：6/7 通过（1 个 model-based 警告）      │
│                                                      │
│  🎯 建议你手动验证：                                  │
│    1. 打开 /dashboard 检查新按钮是否显示               │
│    2. 尝试搜索功能（输入关键词、清空、特殊字符）        │
│    3. 在手机浏览器打开检查移动端布局                    │
└──────────────────────────────────────────────────────┘
```

**数据来源映射：**

| 摘要项 | 数据来源 | 依赖的 DT |
|--------|----------|-----------|
| 任务完成数 | prd.json 的 `devTasks[].passes` | DT-002 |
| Spec 遵循率 | progress.txt 中的 Spec 对照检查结果 | DT-003 |
| 代码变更概要 | `git diff --stat` | — |
| 编码规范遵循 | prd.json 的 `constitution.rules` + progress.txt | DT-002, DT-003 |
| 安全检查 | acceptanceCriteria 中 `[安全]` 前缀项的通过情况 | DT-007 |
| Eval 结果 | progress.txt 中的 Eval 执行结果 | DT-006 |
| 手动验证建议 | acceptanceCriteria 中含"验证"、"检查"、"浏览器"关键词的项 | — |

**核心改动：**
- `viewer/src/app/stage4/page.tsx` — 增加评审摘要面板
- `viewer/src/app/stage5/page.tsx` — 增加评审摘要面板
- `viewer/src/components/ReviewSummary.tsx` — 新组件：评审摘要
- `viewer/src/app/api/review-summary/route.ts` — API 路由：解析 progress.txt + prd.json 生成摘要数据

**Acceptance Criteria：**
- [ ] Stage 4 页面展示评审摘要面板
- [ ] Stage 5 页面展示评审摘要面板
- [ ] 摘要包含：任务完成数、Spec 遵循率、代码变更概要
- [ ] 摘要包含：编码规范遵循情况（来自 constitution.rules）
- [ ] 摘要包含：安全检查结果（统计 `[安全]` 前缀项通过率）
- [ ] 摘要包含：Eval 执行结果（blocking/non-blocking 分别统计）
- [ ] 摘要包含：具体的手动验证建议（从 acceptanceCriteria 提取）
- [ ] 如果有 Spec 偏差，明确展示偏差内容和原因
- [ ] 非技术用户可以理解摘要内容（无技术术语或有解释）
- [ ] 向后兼容：没有 constitution/spec/evals 数据时仍展示基本摘要（任务完成数+代码变更）
- [ ] Typecheck passes

**Priority:** 8

---

## Risks & Mitigations

### HIGH
- **模式选择增加了系统复杂度**：三条流程分支 × Stage 1 + Stage 2 意味着更多的代码路径需要维护
  - Mitigation: Quick Fix 和 Feature Build 是 Full Planning 的子集，不是独立实现。Stage 2 三步流水线共享组件，通过 `mode` 参数控制行为差异
- **Agent 可能忽略富化的 spec 和 constitution 字段**：即使写入 prd.json，Agent 可能不读取
  - Mitigation: 在 CLAUDE.md 中用明确的步骤编号指示分层读取（先 constitution 再 spec）；在 progress.txt 中要求记录"是否使用了 spec/constitution 信息"

### MEDIUM
- **patterns.json 可能变得过大**：长期项目累积大量 patterns
  - Mitigation: 总条目上限 30 条，每领域最多 10 条 active。confidence < 0.4 且 30 天未验证 → deprecated
- **安全检查注入可能过于保守**：简单表单也被注入大量安全项
  - Mitigation: 用户在确认门控时可移除不适用的安全项；Quick Fix 模式仅对高风险关键词注入
- **eval 命令可能误判**：grep 命令可能因命名变化而失败
  - Mitigation: code-based eval 失败阻塞提交（促使 Agent 修复或更新 eval）；model-based eval 不阻塞，只记录警告
- **Stage 2 UI 改造可能破坏现有功能**：合并组件和重构数据流有回归风险
  - Mitigation: 保留 RuleCheckStep 不动；AutoEnrichStep 复用原组件的核心 API 调用逻辑；增加向后兼容测试

### LOW
- **PROJECT.md 与 CLAUDE.md 信息重复**
  - Mitigation: PROJECT.md 聚焦项目描述（Constitution 层），CLAUDE.md 聚焦 Agent 指令，职责分离
- **向后兼容风险**：旧 prd.json 没有 constitution/spec/evals 字段
  - Mitigation: 所有新字段设为可选，Agent 和 Viewer 代码中做 fallback 处理

---

## Testing Strategy

### Unit Tests
- prd.json schema 验证：确保 constitution、spec、evals 字段正确解析和 fallback
- 模式选择逻辑：测试 AI 推荐算法的各种输入场景
- patterns.json 读写：测试置信度更新和淘汰逻辑
- AutoEnrichStep 数据合并：测试 codeExamples + testCases 正确写入各 DT

### Integration Tests
- Stage 2 三步流水线数据流：RuleCheckStep → AutoEnrichStep → EnrichmentSummary → prd.json
- constitution 写入路径：规则选择结果正确写入 prd.json 项目级 constitution 字段
- spec 写入路径：代码示例和测试用例正确写入 prd.json 各 DT 的 spec 字段
- Agent 读取富化 prd.json：验证 constitution 和 spec 字段被正确解析和使用
- eval 执行：验证 code-based eval 的 blocking 行为和 model-based eval 的非阻塞行为

### E2E Tests
- 完整 Quick Fix 流程：从输入到轻量 prd.json 生成（无 constitution/spec）
- 完整 Feature Build 流程：L1 + L4 + 确认 + 3 步 Stage 2 + 富化 prd.json
- 完整 Full Planning 流程：L1→L5 + 3 步 Stage 2（含审阅）+ 富化 prd.json
- 安全关键词触发：输入含"登录"的需求，验证安全项注入和 `[安全]` 前缀
- 评审摘要生成：验证 Stage 4/5 的摘要面板正确聚合所有数据

### Coverage Target
- 新增代码覆盖率 ≥ 70%
- 重点覆盖：模式选择逻辑、prd.json schema 处理、Stage 2 数据流

---

## Functional Requirements

- FR-1: 系统必须支持三种需求处理模式（Quick Fix / Feature Build / Full Planning）
- FR-2: AI 必须根据用户输入自动推荐模式，并显示推荐理由，用户可选择任意模式
- FR-3: prd.json 必须支持项目级 `constitution` 字段存储编码规范（Constitution 层）
- FR-4: prd.json 的 devTasks 必须支持任务级 `spec` 字段存储代码示例和测试用例（Task Spec 层）
- FR-5: Stage 2 流水线必须为 3 步：规则选择（手动）→ 自动生成（一键）→ 确认
- FR-6: Agent 在提交前必须执行 Spec 对照检查（含 constitution 和 spec）并记录结果
- FR-7: Codebase Scan 阶段必须自动生成 PROJECT.md（提交 git）和 .project-status（.gitignore）
- FR-8: 经验库必须以 patterns.json 格式存储，总上限 30 条，支持置信度和领域分类
- FR-9: DT 任务可以定义 evals，code-based 默认阻塞提交，model-based 默认不阻塞
- FR-10: 涉及安全敏感功能的 DT 必须自动注入 `[安全]` 前缀的验收标准
- FR-11: Stage 4/5 必须展示评审摘要面板（含 Spec 遵循率、安全检查、Eval 结果、编码规范遵循）
- FR-12: 所有新功能必须向后兼容旧格式的 prd.json（无 constitution/spec/evals 字段时正常工作）

---

## Non-Goals (Out of Scope)

- **Spec-as-source 双向同步**：不做 Tessl 式的 spec↔code 自动同步，保持 spec-first 模式
- **Instinct Hook 系统**：不做 everything-claude-code 式的 Hook 观察学习系统（patterns.json 是手动触发版）
- **SaaS 多租户支持**：本 PRD 只覆盖单用户本地使用场景
- **AI 自动降档**：不允许系统自动将用户选择的模式降级
- **progress.txt 格式迁移**：保留 progress.txt 的追加式日志，patterns.json 是补充而非替代
- **规则内容直接嵌入 prd.json**：constitution.rules 存储规则引用和可选摘要，完整内容仍在 rules/ 目录

---

## Technical Considerations

- SKILL.md 文件位于 `~/.claude/skills/`，不在 git repo 中，修改需要写绝对路径
- Viewer TypeScript 代码使用 `npx tsc --noEmit` 进行类型检查
- prd.json、progress.txt、patterns.json、PROJECT.md、.project-status 均在项目根目录
- Stage 2 pipeline 的各 Step 组件通过 props 回调传递数据，合并后需保证数据流清晰
- BotoolAgent.sh 是 1989 行 bash 脚本，DT-005 和 DT-006 涉及的修改需谨慎
- 合并 CodeExampleStep + TestCaseStep 为 AutoEnrichStep 时，需保留原组件的 API 调用逻辑
- .project-status 是 JSON 格式（便于 Agent 解析），PROJECT.md 是 Markdown 格式（便于人类阅读）
- constitution.rules[].content 字段可选 — 如果 Agent 需要规则全文，可按 id 在 rules/ 目录查找

---

## Success Metrics

1. **Quick Fix 使用率 > 40%**：说明小需求不再走重流程
2. **Spec 遵循率 > 85%**：Agent 在自检中报告的验收标准满足率
3. **Stage 2 → Agent 数据传递率 100%**：所有 constitution 和 spec 数据都写入 prd.json
4. **安全检查注入覆盖率 100%**：所有涉及安全关键词的 DT 都被注入 `[安全]` 项
5. **非技术用户满意度**：评审摘要让用户无需看代码就能判断质量
6. **Stage 2 步骤减少**：从 4 步降为 3 步，Feature Build 用户无需逐步审阅

---

## Implementation Order & Dependencies

```
第一批（无依赖，可并行）：
  DT-003 (CLAUDE.md 指令升级)     ← 纯 Markdown，定义 Agent 读取三层 Spec 的流程
  DT-005 (patterns.json)          ← 纯 JSON + Markdown
  DT-007 (安全注入)               ← 纯 SKILL.md
      │
      ▼
第二批（依赖第一批）：
  DT-004 (PROJECT.md)             ← 依赖 DT-003（CLAUDE.md 已定义读取流程）
                                     依赖 DT-005（patterns.json ≥ 0.8 的条目合并到 PROJECT.md）
  DT-002 (富化 prd.json + UI)     ← 依赖 DT-003（Agent 知道怎么读 constitution 和 spec）
      │
      ▼
第三批（依赖第二批）：
  DT-006 (Eval 系统)              ← 依赖 DT-002（prd.json 有 evals 字段 schema）
                                     依赖 DT-003（CLAUDE.md 已定义 Eval 执行流程）
  DT-001 (模式选择)               ← 依赖 DT-002（不同模式产生不同的 prd.json 结构）
      │
      ▼
第四批（依赖前面所有）：
  DT-008 (智能评审面板)           ← 依赖 DT-002（constitution 数据）
                                     依赖 DT-003（Spec 对照检查结果）
                                     依赖 DT-006（Eval 结果）
                                     依赖 DT-007（[安全] 前缀统计）
```
