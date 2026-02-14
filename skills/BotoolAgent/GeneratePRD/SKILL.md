---
name: botoolagent-generateprd
description: "Generate a Product Requirements Document through collaborative dialogue. Use when planning a feature, starting a new project, or when asked to create a PRD. Triggers on: create a prd, write prd for, plan this feature, requirements for, spec out."
user-invocable: true
---

# BotoolAgent PRD Generator

Turn ideas into well-formed PRDs through natural collaborative dialogue - one question at a time.

---

## Overview

This skill combines deep exploration with structured output. Instead of asking all questions upfront, we have a conversation to truly understand what you're building, then produce a PRD ready for BotoolAgent execution.

**Preferred method:** Use the BotoolAgent Viewer web interface for the best PRD creation experience with real-time preview, chat UI, and automatic saving.

**Announce at start:** "Using BotoolAgent:GeneratePRD to create your PRD."

---

## Mode Selection

**Web Interface Mode (Recommended):**
- Launch the BotoolAgent Viewer and navigate to Stage 1
- Interactive chat interface with real-time PRD preview
- Automatic PRD saving and seamless transition to conversion

**CLI Mode (Fallback):**
- Use when Viewer is unavailable or user explicitly requests CLI
- Traditional dialogue-based PRD creation in terminal

---

## Web Interface Mode

### Step 1: Check and Start Viewer

```bash
# Check if port 3000 is in use
lsof -i :3000 | grep LISTEN
```

If the server is not running:

```bash
# Navigate to viewer directory and start dev server in background
# Auto-detect: standalone (viewer/) or portable (BotoolAgent/viewer/)
VIEWER_DIR="$([ -d BotoolAgent/viewer ] && echo BotoolAgent/viewer || echo viewer)"
cd "$VIEWER_DIR" && npm run dev &
```

Wait a few seconds for the server to start.

### Step 2: Open Stage 1 in Browser

```bash
# macOS
open http://localhost:3000/stage1

# Linux
xdg-open http://localhost:3000/stage1
```

### Step 3: Announce to User

Output to the user:

```
BotoolAgent Viewer is now running!

Opening Stage 1 - PRD Creation...

Access URL: http://localhost:3000/stage1

The web interface provides:
- AI chat for collaborative PRD creation
- Real-time PRD preview panel
- Automatic PRD saving to tasks/
- Seamless transition to Stage 2 for JSON conversion

If the browser doesn't open, navigate manually to the URL above.
```

**Then stop here.** The user will complete PRD creation in the browser.

---

## CLI Mode (Fallback)

Use this mode when:
- User explicitly requests CLI mode
- Viewer is unavailable or not installed
- Running in a headless environment

### The Process

### Phase 1: Understand the Idea

**Start by checking context:**
- Look at current project state (files, docs, recent commits)
- Understand the existing codebase structure

**Then ask questions ONE AT A TIME using AskUserQuestion:**
- Focus on: purpose, constraints, success criteria
- Prefer multiple choice when possible
- Open-ended is fine for complex topics
- If a topic needs more exploration, break into multiple questions

**Key questions to cover:**
1. What problem does this solve? (the "why")
2. Who is the target user?
3. What are the core actions/features?
4. What should it NOT do? (scope boundaries)
5. How do we know it's done? (success criteria)
6. Any technical constraints?

### Phase 2: Explore Approaches

Before settling on a design:
- Propose 2-3 different approaches with trade-offs
- Present your recommendation first with reasoning
- Let the user choose or suggest alternatives
- Use AskUserQuestion for the choice

### Phase 3: Present the Design

Once you understand what you're building:
- Present the design in sections (200-300 words each)
- After each section, ask: "Does this look right so far?"
- Cover: architecture, data model, UI structure, business rules, dev tasks
- Be ready to go back and clarify

**Sections to cover (adapt by complexity):**

For **simple features** (1-2 files):
1. Overview & Goals
2. Dev Tasks
3. Non-Goals

For **medium features** (3-8 files):
1. Overview & Goals
2. Architecture overview (1 ASCII diagram)
3. Data model (table if applicable)
4. Component list (table)
5. Dev Tasks (with file paths, API routes)
6. Non-Goals

For **complex features** (8+ files):
1. Overview & Goals
2. Current state analysis (if existing codebase)
3. Architecture (ASCII: concepts, roles, workflows)
4. Data design (Schema + ER diagram)
5. UI design (ASCII layouts + component list)
6. Business rules (tables + decision trees)
7. Dev Tasks grouped by Phase (with dependencies)
8. Appendix (file index, risks, testing strategy, non-goals)

### Phase 4: Generate PRD

After all sections are validated:
- Compile into final PRD format
- Auto-detect tasks directory: `TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"`
- Save to `$TASKS_DIR/prd-[feature-name].md`
- Announce: "PRD saved. Use BotoolAgent:PRD2JSON to convert for autonomous execution."

---

## Dev Task Guidelines

Each task must be **small enough to complete in one iteration**:

**Right-sized:**
- Add a database column and migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

**Too big (split these):**
- "Build the entire dashboard"
- "Add authentication"
- "Refactor the API"

**Rule of thumb:** If you can't describe the change in 2-3 sentences, it's too big.

**Acceptance criteria must be verifiable:**
- Good: "Button shows confirmation dialog before deleting"
- Bad: "Works correctly"

**Always include:**
- "Typecheck passes" for every task
- "Verify in browser" for UI tasks
- File paths, API routes, or component names in each DT
- Phase "对应设计" references to §3-§6 sections

---

## PRD Output Format

Use the **new multi-dimensional PRD template** (same as PyramidPRD). Adapt sections by complexity:

### Full Template (complex features)

```markdown
# PRD: [Feature Name]

## 1. 项目概述
### 1.1 背景与动机
### 1.2 核心目标
### 1.3 成功指标

## 2. 当前状态
### 2.1 已有能力 (表格: 模块|状态|说明)
### 2.2 缺口分析

## 3. 架构设计
### 3.1 核心概念 (ASCII 关系图)
### 3.2 用户角色 (ASCII 角色权限图)
### 3.3 核心工作流 (ASCII 流程图)
### 3.4 状态机 (ASCII, 如有)

## 4. 数据设计
### 4.1 数据模型概览 (表格)
### 4.2 Schema 定义 (SQL CREATE)
### 4.3 模型关系 (ASCII ER 图)
### 4.4 约束与规则

## 5. UI 设计
### 5.1 页面清单 (表格)
### 5.2 组件清单 (表格: 组件|Props|复用|状态)
### 5.3 关键页面布局 (ASCII)
### 5.4 关键弹窗/交互 (ASCII)

## 6. 业务规则
### 6.1 [领域] 规则 (表格)
### 6.2 决策树 (ASCII)

## 7. 开发计划
### 7.0 Phase 依赖图 (ASCII)
### 7.1 Phase 1: [名称] (P0)
> **前置**: 无
> **产出**: [具体产出]
> **对应设计**: Section 3.3, 4.2
- [ ] DT-001: [任务] (`API: /api/xxx`, `文件: src/xxx`)

### 7.2 Phase 2: [名称] (P1)
> **前置**: Phase 1
> **产出**: [具体产出]
> **对应设计**: Section 5.3, 5.4
- [ ] DT-002: [任务]

## 8. 附录
### A. 代码文件索引 (表格: 文件|状态|Phase|任务)
### B. 风险与缓解措施
### C. 测试策略
### D. 非目标 (Out of Scope)
### E. 安全检查项
```

### Simplified Template (simple/medium features)

For simple features, skip §2/3/4/5/6 and use flat DT list without Phases.
For medium features, include §3(概要)/§4(表格)/§5(组件清单) but skip §2/§6.

---

## Key Principles

- **One question at a time** - Don't overwhelm
- **Use AskUserQuestion** - Better UX than text prompts
- **Multiple choice preferred** - Easier to answer
- **YAGNI ruthlessly** - Remove unnecessary features
- **Explore alternatives** - Always propose 2-3 approaches
- **Incremental validation** - Present design in sections
- **Be flexible** - Go back and clarify when needed

---

## After the PRD (CLI Mode Only)

Offer next steps:

"PRD complete and saved. Next steps:

1. **Open Viewer** - Use `/botoolagent` to open the web interface and continue from Stage 2
2. **Convert to JSON** - Use `/botoolagent-prd2json` to create prd.json
3. **Run autonomously** - Run `/botoolagent-coding` to implement

Which would you like to do?"

---

## Checklist

### Web Interface Mode
- [ ] Started Viewer dev server if not running
- [ ] Opened Stage 1 (http://localhost:3000/stage1) in browser
- [ ] Announced access URL to user

### CLI Mode
Before saving the PRD:
- [ ] Asked questions one at a time with AskUserQuestion
- [ ] Explored 2-3 approaches before settling
- [ ] Presented design in sections and validated each
- [ ] Dev tasks are small and specific
- [ ] Acceptance criteria are verifiable
- [ ] Non-goals section defines clear boundaries
- [ ] Saved to `$TASKS_DIR/prd-[feature-name].md` (auto-detect portable mode)
