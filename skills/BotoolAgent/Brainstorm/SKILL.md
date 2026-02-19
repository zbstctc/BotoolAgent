---
name: botoolagent-brainstorm
description: "You MUST use this before any feature work, new functionality, or creative implementation in BotoolAgent projects. When a user describes an idea, feature request, or says 'I want to build...', invoke this skill FIRST to explore the idea and generate a Draft before any planning or coding. Stage 0 brainstorming that produces a DRAFT document for PyramidPRD import. Triggers on: brainstorm, build something, new feature, I want to make, add functionality, create a tool, implement, stage 0"
user-invocable: true
---

# BotoolAgent Stage 0: 头脑风暴

通过轻量级对话（每轮 2-3 个问题）帮助用户把模糊想法变成结构化的 Draft 文档，然后衔接 PyramidPRD 导入模式生成完整 PRD。

**启动提示:** "Using BotoolAgent:Brainstorm to explore your idea and generate a draft."

---

## 重要：所有内容必须使用中文

所有问题、选项、描述、反馈都必须使用中文。

---

## 定位：Stage 0 — PyramidPRD 的前置

```
brainstorm (Stage 0)     PyramidPRD [模式:导入]     prd2json        coding
  探索想法 → Draft.md  →  补充细节 → 完整 PRD.md  →  prd.json  →  自动开发
  (轻量对话)              (结构化问答)               (转换)        (执行)
```

**与 PyramidPRD 的分工：**
- **brainstorm**：从 0 到 1 — 把模糊想法变成有方向的 Draft
- **PyramidPRD**：从 1 到 100 — 把 Draft 深化为高颗粒度 PRD

---

## 核心规则

<HARD-GATE>
不要写任何代码、不要创建组件、不要修改文件。brainstorm 的唯一输出是 Draft 文档。
在用户确认 Draft 之前，不要生成文档。
</HARD-GATE>

---

## Checklist

你必须按顺序完成以下步骤：

1. **探索项目上下文** — 扫描文件、文档、最近提交
2. **理解核心意图** — 用 2-3 个问题理解用户想做什么
3. **探索方向与约束** — 用 2-3 个问题明确方向、用户、边界
4. **提出 2-3 种方案** — 带权衡和推荐
5. **逐段呈现设计** — 按复杂度缩放每段篇幅，每段确认后再继续
6. **生成 Draft 文档** — 写入 `$TASKS_DIR/<projectId>/DRAFT.md`
7. **衔接 PyramidPRD** — 引导用户进入导入模式

---

## 流程详解

### Phase 1: 探索项目上下文

在提问之前，先快速了解项目现状：

- 使用 Glob 检查 `package.json`、`tsconfig.json` 等项目文件
- 如果有 `package.json`，使用 Read 读取 dependencies，识别技术栈
- 使用 Glob 扫描顶层目录结构，了解项目架构
- 检查 `tasks/` 或 `BotoolAgent/tasks/` 目录，了解是否有现有 PRD

将扫描结果内化到后续问题的选项中（不直接输出给用户）。

---

### Phase 2: 理解核心意图（第 1 轮提问）

使用 AskUserQuestion，2-3 个问题并发：

```json
{
  "questions": [
    {
      "question": "你想做的东西，用一句话描述核心价值是什么？\n\n比如：'让业务人员不用写代码就能做数据报表'",
      "header": "核心价值",
      "options": [
        { "label": "[根据用户初始描述推断的选项 A]", "description": "[解释]" },
        { "label": "[推断的选项 B]", "description": "[解释]" },
        { "label": "[推断的选项 C]", "description": "[解释]" }
      ],
      "multiSelect": false
    },
    {
      "question": "谁会用这个功能？他们目前怎么解决这个问题？",
      "header": "目标用户",
      "options": [
        { "label": "[推断的用户类型 A]", "description": "[现状描述]" },
        { "label": "[推断的用户类型 B]", "description": "[现状描述]" }
      ],
      "multiSelect": false
    },
    {
      "question": "这个项目的规模期望是？",
      "header": "规模",
      "options": [
        { "label": "最小可用 (MVP)", "description": "先跑通核心流程，其他以后再说" },
        { "label": "功能完整", "description": "覆盖主要场景，可以正式使用" },
        { "label": "生产就绪", "description": "需要考虑性能、安全、边界情况" }
      ],
      "multiSelect": false
    }
  ],
  "metadata": {
    "source": "brainstorm",
    "phase": 2,
    "phaseName": "理解核心意图",
    "progress": "1/4"
  }
}
```

**注意：** 以上问题模板仅供参考，必须根据用户的实际输入动态调整问题内容和选项。

---

### Phase 3: 探索方向与约束（第 2 轮提问）

根据第 1 轮答案，深入方向和边界：

```json
{
  "questions": [
    {
      "question": "[根据第 1 轮答案，提出实现方向的问题]",
      "header": "实现方向",
      "options": [...],
      "multiSelect": false
    },
    {
      "question": "[根据第 1 轮答案，提出约束/边界的问题]",
      "header": "约束边界",
      "options": [...],
      "multiSelect": false
    }
  ],
  "metadata": {
    "source": "brainstorm",
    "phase": 3,
    "phaseName": "探索方向与约束",
    "progress": "2/4"
  }
}
```

**典型问题方向：**
- 技术方向偏好（基于扫描到的现有技术栈）
- 哪些是必须有的 vs 可以以后做的
- 已有哪些可以复用的东西
- 有没有明确不想要的东西（YAGNI）

**动态调整：** 如果 2 轮问答后仍有关键信息缺失，可以追加 1 轮（最多 3 轮提问）。如果信息已经充分，直接进入 Phase 4。

---

### Phase 4: 提出方案（2-3 种方案 + 推荐）

基于前两轮的信息，提出 2-3 种方案。直接用文本呈现：

```
基于我们讨论的内容，我有以下几种思路：

**方案 A: [名称]**（推荐）
- 思路: [一句话]
- 优势: [列出]
- 劣势: [列出]
- 复杂度: [简单/中等/复杂]

**方案 B: [名称]**
- 思路: [一句话]
- 优势: [列出]
- 劣势: [列出]
- 复杂度: [简单/中等/复杂]
```

然后用 AskUserQuestion 让用户选择：

```json
{
  "questions": [
    {
      "question": "以上方案哪个最接近你的想法？",
      "header": "方案选择",
      "options": [
        { "label": "方案 A（推荐）", "description": "[一句话]" },
        { "label": "方案 B", "description": "[一句话]" },
        { "label": "都不对，我来说", "description": "以上方案都有偏差" }
      ],
      "multiSelect": false
    }
  ],
  "metadata": {
    "source": "brainstorm",
    "phase": 4,
    "phaseName": "方案选择",
    "progress": "3/4"
  }
}
```

---

### Phase 5: 逐段呈现设计

选定方案后，按段呈现设计，每段确认后继续下一段。

**段落缩放规则：**
- 简单项目：每段 2-3 句话，总共 3-4 段
- 中等项目：每段 1 小段，总共 4-5 段
- 复杂项目：每段可含 ASCII 图，总共 5-6 段

**必须覆盖的设计段落（按需缩放）：**

1. **一句话定位** — 这个东西是什么、给谁用
2. **核心功能** — 要做什么（3-7 个要点）
3. **技术方向** — 用什么技术栈、大致架构
4. **范围边界** — 做什么 + 不做什么（YAGNI）
5. **成功标准** — 怎么算做完了

每段呈现后用 AskUserQuestion 确认：

```json
{
  "questions": [
    {
      "question": "[当前段落的设计内容]\n\n以上是否准确？",
      "header": "[段落名]",
      "options": [
        { "label": "准确，继续", "description": "这部分没问题" },
        { "label": "需要调整", "description": "有不对的地方，我会说明" }
      ],
      "multiSelect": false
    }
  ],
  "metadata": {
    "source": "brainstorm",
    "phase": 5,
    "phaseName": "设计确认",
    "progress": "4/4",
    "section": "[段落编号]"
  }
}
```

**如果用户选「需要调整」：** 根据反馈修改后重新呈现该段（最多重试 1 次）。

---

### Phase 6: 生成 Draft 文档

所有段落确认后，生成 Draft 文档。

**输出路径（per-project 子目录）：**
```bash
TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"
# projectId 从功能名称派生（kebab-case，如 "adversarial-review"）
PROJECT_DIR="$TASKS_DIR/<projectId>"
mkdir -p "$PROJECT_DIR"
# 写入: $PROJECT_DIR/DRAFT.md
```

**Draft 模板：**

```markdown
# Draft: [功能名称]

> Stage 0 头脑风暴产出 | 日期: YYYY-MM-DD

## 定位

[一句话描述：这是什么、给谁用、解决什么问题]

## 背景与动机

[为什么要做这个？现状是什么？痛点是什么？]

## 核心功能

1. [功能 1] — [简要描述]
2. [功能 2] — [简要描述]
3. [功能 3] — [简要描述]
...

## 技术方向

- **技术栈**: [框架 + 语言 + 数据库 + 其他]
- **架构思路**: [一段描述]
- **关键决策**: [选择了什么方案、为什么]

## 目标用户

- **主要用户**: [角色描述]
- **使用场景**: [典型场景]

## 范围边界

### 要做的
- [功能项 1]
- [功能项 2]
- [功能项 3]

### 不做的（YAGNI）
- [排除项 1] — [原因]
- [排除项 2] — [原因]

## 成功标准

- [标准 1]
- [标准 2]
- [标准 3]

## 开放问题

- [待确认的问题 1]
- [待确认的问题 2]

---

> 下一步: 使用 `/botoolagent-pyramidprd` 导入此 Draft，生成完整 PRD
```

**写入后用 git 提交 Draft 文档。**

---

### Phase 7: 衔接 PyramidPRD

Draft 生成后，告诉用户：

```
Draft 已生成: $TASKS_DIR/<projectId>/DRAFT.md

下一步选择:
1. 运行 `/botoolagent-pyramidprd` → 选择「PRD 导入」模式
   → 系统会读取 Draft，补充细节，生成完整 PRD 到同一目录
2. 如果 Draft 已经够详细，也可以直接手动编写 PRD

推荐走 PyramidPRD 导入模式，它会自动：
- 分析 Draft 覆盖度
- 针对缺失部分提问（最多 2 轮）
- 生成标准格式 PRD 到 $TASKS_DIR/<projectId>/prd.md + 更新 registry.json
```

---

## 关键原则

1. **轻量优先** — brainstorm 是探索阶段，不要过度深入细节（细节留给 PyramidPRD）
2. **每轮 2-3 个问题** — 比一问一答高效，比 PyramidPRD 的批量提问轻松
3. **方案导向** — 尽早提出 2-3 个方案让用户选择，避免发散
4. **YAGNI** — 积极排除不必要的功能，保持范围精简
5. **逐段确认** — 分段呈现设计，每段确认，避免最后推翻
6. **不写代码** — brainstorm 只产出文档，不触碰实现
7. **快速收敛** — 总共 2-3 轮提问 + 方案选择 + 分段确认，控制在 10 分钟内

---

## 与其他 Skill 的关系

| Skill | 阶段 | 作用 |
|-------|------|------|
| **botoolagent-brainstorm** (本 Skill) | Stage 0 | 探索想法 → 生成 Draft |
| **botoolagent-pyramidprd** | Stage 1 | Draft → 完整 PRD（导入模式） |
| **botoolagent-prd2json** | Stage 1→2 | PRD.md → prd.json |
| **botoolagent-coding** | Stage 3 | 自动开发 |
