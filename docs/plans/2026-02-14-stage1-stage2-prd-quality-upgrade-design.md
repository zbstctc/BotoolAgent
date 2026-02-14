# Stage 1/2 PRD 生成质量升级设计

> **版本**: v1.0
> **创建日期**: 2026-02-14
> **状态**: 待实施
> **涉及 Skill**: PyramidPRD, GeneratePRD, PRD2JSON
> **参考文档**: `v1.6_Botool_Present_v2PRD copy.md`（目标 PRD 样板）

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [核心差距分析](#2-核心差距分析)
3. [设计原则](#3-设计原则)
4. [Stage 1 改造：PRD 生成质量升级](#4-stage-1-改造prd-生成质量升级)
5. [Stage 2 改造：prd.json 精简为自动化索引层](#5-stage-2-改造prdjson-精简为自动化索引层)
6. [CLAUDE.md 配合修改](#6-claudemd-配合修改)
7. [实施计划](#7-实施计划)

---

## 1. 背景与动机

### 1.1 现状

BotoolAgent 的 PRD 生成（Stage 1）和 JSON 转换（Stage 2）存在信息密度不足的问题。

对比参考 PRD（`v1.6_Botool_Present_v2PRD copy.md`，3000+ 行，覆盖架构/数据库/UI/业务规则/开发计划/代码索引），我们当前生成的 PRD 只有 ~100-200 行，仅包含简单的 Introduction + Goals + Dev Tasks + Risks。

### 1.2 目标

1. **PRD 生成质量升级**：让 PyramidPRD/GeneratePRD 输出的 PRD markdown 接近参考 PRD 的颗粒度
2. **prd.json 精简**：PRD.md 作为唯一信息源（Single Source of Truth），prd.json 只保留自动化必需字段
3. **L5 门控升级**：从纯文字确认 → 多维度 ASCII 可视化确认

### 1.3 核心洞察

**PRD.md 是给人和 coding agent 读内容的，prd.json 是给机器做自动化循环的。**

```
PRD.md (人读 + agent 读内容)          prd.json (机器读 + 自动化循环)
════════════════════════════          ════════════════════════════════

完整的设计信息：                        精简的自动化信息：
- 架构设计 (ASCII)                    - 任务列表 (id/title/passes)
- 数据模型 (SQL)                      - 依赖关系 (dependsOn)
- UI 设计 (ASCII)                     - 验证命令 (evals)
- 业务规则 (表格)                     - 进度追踪 (passes: true/false)
- 开发计划 (每个任务完整描述)          - 会话分组 (sessions)
- 代码示例                            - 编码规范 (constitution)
- 测试用例描述                        - 分支名 (branchName)
- 安全检查项                          - prdFile 指向 PRD 路径
                                      - prdSection 指向对应章节

Coding Agent 工作流：
1. 读 prd.json → 找到下一个 passes:false 的任务
2. 读 PRD.md 对应 Section → 获取完整设计上下文
3. 实现 → 验证 → 更新 prd.json 的 passes
```

---

## 2. 核心差距分析

### 2.1 PRD 输出颗粒度对比

| 维度 | 参考 PRD | 当前 PRD 输出 | 差距 |
|------|---------|-------------|------|
| **当前状态** | 代码 vs 数据库对比表、已完成/未完成清单 | 无 | 完全缺失 |
| **架构设计** | 核心概念 ASCII、角色流程、多阶段工作流 | 无（只有简单 FR 列表） | 完全缺失 |
| **数据库设计** | 完整 SQL CREATE 语句、字段注释、约束、RLS 策略 | 无 | 完全缺失 |
| **UI 组件设计** | 每个组件单独 ASCII 布局 + Props 接口 + 交互规格 | 无 | 完全缺失 |
| **业务规则** | 按维度分类的规则表（版本管理/指派/翻译各 10+ 条） | 无 | 完全缺失 |
| **开发计划** | 分 Phase + 依赖图 + 每任务指定 API 路径/组件/文件 | 只有 DT 列表（标题+AC） | 严重不足 |
| **代码文件索引** | 文件→状态→Phase 完整映射表 | 无 | 完全缺失 |
| **交叉引用** | 任务↔设计↔数据库↔组件互相引用（"见 8.2"） | 无 | 完全缺失 |
| **决策树/状态机** | 多个（版本状态、权限决策、翻译流程） | 无 | 完全缺失 |

### 2.2 DT 描述颗粒度对比

**当前 DT 描述：**
```markdown
### DT-001: Add status field to database
**Description:** As a developer, I need to store task status.
**Acceptance Criteria:**
- [ ] Add status column: 'pending' | 'in_progress' | 'done'
- [ ] Typecheck passes
```

**参考 PRD 等价描述：**
```markdown
### 7.3 Phase 3: 版本管理 (P1)
> 前置：Phase 2
> 产出：支持大/小版本创建、语言版本状态管理、选择性发布
> 对应设计：Section 4（版本管理）、Section 3.7（版本创建流程）

- [ ] 实现 <CreateVersionDialog> 版本创建弹窗（大版本/小版本选择）
- [ ] 实现 <ContentSourceSelector> 内容来源三选项（上传/从库选择/Duplicate）
- [ ] 实现版本创建 API（/api/presentations/[id]/versions）
- [ ] 简化语言版本状态为 draft/published
- [ ] 实现选择性发布（单个语言发布/取消发布）
- [ ] 提取 <PPTDetailCard> 组件（支持 user/admin 模式，见 8.1）
- [ ] 实现 <LanguageVersionList> 语言面板（用户/管理员，见 8.5）
```

差距：具体组件名、API 路径、文件路径、交叉引用全部缺失。

### 2.3 我们的独有优势（保留并增强）

| 优势 | 来源 Skill | 保留策略 |
|------|-----------|---------|
| 代码库实时扫描 | PyramidPRD Phase 2.5 | 增强：新增数据库/接口/组件接口扫描维度 |
| 动态复杂度评估 | PyramidPRD Phase 0 | 不变 |
| 安全关键词自动注入 | PyramidPRD Phase 7.5 | 不变 |
| 5 层递进问答 + 确认门控 | PyramidPRD L1-L5 | 增强：L5 → ASCII 多维度确认 |
| 编码规范嵌入 | PRD2JSON constitution | 不变 |
| TDD 标记 | PRD2JSON testCases | 不变 |
| 自动化验证命令 | PRD2JSON evals | 不变 |
| 会话分组 | PRD2JSON sessions | 不变 |

---

## 3. 设计原则

1. **PRD.md 是唯一信息源** — 所有设计信息（架构/数据/UI/规则）只在 PRD.md 中，prd.json 不重复
2. **复杂度自适应** — 简单需求不生 2000 行 PRD，按模式裁剪
3. **向后兼容** — 新字段 optional，不破坏现有 coding agent 和 Viewer
4. **保留现有优势** — 代码库扫描、安全注入、TDD、evals 等完全保留
5. **最小改动** — 不改 Viewer 前端代码，只改 Skill 文件和 CLAUDE.md

---

## 4. Stage 1 改造：PRD 生成质量升级

### 4.1 涉及 Skill

- **PyramidPRD** (`skills/BotoolAgent/PyramidPRD/SKILL.md`) — 主要改动
- **GeneratePRD** (`skills/BotoolAgent/GeneratePRD/SKILL.md`) — 对齐输出格式

### 4.2 新 PRD 模板结构

```
旧 PRD 模板 (~100行)                    新 PRD 模板 (~500-2000行，按复杂度裁剪)
═══════════════════                    ═══════════════════════════════════════

# PRD: [名称]                          # PRD: [名称]

## Introduction                        ## 1. 项目概述
## Goals                                  - 背景与动机
                                          - 核心目标
                                          - 成功指标

                                       ## 2. 当前状态 (NEW - 来自代码库扫描)
                                          - 已有能力清单 (表格: 模块|状态|说明)
                                          - 代码 vs 实际状态对比
                                          - 缺口分析

                                       ## 3. 架构设计 (NEW)
                                          - 核心概念 (ASCII 关系图)
                                          - 用户角色与权限 (ASCII 角色图)
                                          - 核心工作流 (分 Phase ASCII 流程)
                                          - 数据流 / 状态机 (ASCII)

                                       ## 4. 数据设计 (NEW)
                                          - 数据模型概览 (表格: 模型|用途|关键字段)
                                          - Schema 定义 (SQL 或 Prisma 语法)
                                          - 模型关系 (ASCII ER 图)
                                          - 约束与规则

                                       ## 5. UI 设计 (NEW)
                                          - 页面清单 (表格: 页面|路由|说明)
                                          - 组件清单 (表格: 组件|Props|复用)
                                          - 关键页面布局 (ASCII)
                                          - 关键弹窗/交互 (ASCII)

                                       ## 6. 业务规则 (NEW)
                                          - 按领域分类 (表格)
                                          - 决策树 (复杂逻辑用 ASCII)
                                          - 边界情况

## Dev Tasks                           ## 7. 开发计划
  DT-001: 标题                            - Phase 依赖图 (ASCII)
    Description                           - Phase N: [名称]
    Acceptance Criteria                     前置: Phase X
                                            产出: [具体产出]
                                            对应设计: Section X.X
                                            - [ ] 任务清单 (含 API 路径/组件名/文件)

## Functional Requirements             ## 8. 附录
## Risks & Mitigations                    - A. 代码文件索引 (表: 文件|状态|Phase)
## Testing Strategy                       - B. 业务规则汇总
## Non-Goals                              - C. 风险与缓解措施
## Technical Considerations               - D. 测试策略
## Success Metrics                        - E. 非目标 (Out of Scope)
                                          - F. 安全检查项
```

### 4.3 复杂度自适应裁剪规则

不是所有项目都需要 2000 行 PRD。按模式裁剪：

| 节 | 快速修复 | 功能开发 | 完整规划 |
|---|---------|---------|---------|
| § 1. 项目概述 | 2-3 句 | 1 段 | 完整 |
| § 2. 当前状态 | 跳过 | 简要表格 | 完整（含 ASCII） |
| § 3. 架构设计 | 跳过 | 概要（1 个 ASCII） | 完整（多 ASCII） |
| § 4. 数据设计 | 跳过 | Schema 表格 | 完整 SQL + ER 图 |
| § 5. UI 设计 | 跳过 | 组件清单 | 完整 ASCII 布局 |
| § 6. 业务规则 | 跳过 | 简要表格 | 完整分类表 + 决策树 |
| § 7. 开发计划 | 1-3 个 DT | Phase 列表 | 完整 Phase + 依赖图 |
| § 8. 附录 | 跳过 | 文件索引 | 完整 |

### 4.4 PyramidPRD SKILL.md 改动明细

#### 4.4.1 Phase 2.5 代码库扫描增强

**现有能力（保留）：**
- 技术栈检测（package.json 等）
- 目录结构分析
- 现有组件/路由/API 识别
- 数据模型分析
- PROJECT.md 生成

**新增扫描维度：**

| 新增维度 | 扫描方法 | 用于 PRD 哪个节 |
|---------|---------|----------------|
| 现有数据库 Schema | Grep 搜索 `*.sql`, `schema.prisma`, `migrations/` | § 2 当前状态 + § 4 数据设计 |
| 现有 UI 组件接口 | Grep 搜索 `interface.*Props`, `type.*Props` | § 5 UI 设计（标记可复用组件） |
| 现有 API 签名 | Grep 搜索 `export.*GET\|POST\|PUT\|DELETE` | § 2 当前状态 |
| 已有的业务逻辑 | 读取关键 service/lib 文件的 export | § 2 当前状态 |

**输出变化：** 扫描结果不再仅内化到问题选项中，还要作为 PRD § 2 当前状态的数据源。

#### 4.4.2 L2-L4 问答增强

问题设计框架不变（5 层结构、复杂度自适应），但增加新的问题话题以收集生成新 PRD 节所需的信息：

**L2 新增话题（功能开发+完整规划模式）：**
- 数据模型：新建表还是修改现有表？核心字段？约束？
- UI 层次：几个新页面？复用哪些已有组件？需要哪些新弹窗？

**L3 新增话题（仅完整规划模式）：**
- 状态流转：有几种状态？转换条件？谁能触发？
- 业务规则：版本管理？权限控制？删除级联？
- 组件交互：弹窗确认流程？下拉选项内容？拖拽排序？

**L4 新增话题（功能开发+完整规划模式）：**
- 文件命名约定：API 路径模式、组件文件名约定
- 已有代码修改范围：哪些现有文件会被修改？

#### 4.4.3 L5 门控重写

**旧 L5（纯文字）：**
```
📋 需求摘要：做一个用户管理系统
🎯 功能范围：- 用户列表 - 搜索 - CRUD
🔧 技术方案：Next.js + Supabase
⚠️ 风险评估：HIGH: 范围蔓延
📊 复杂度估计：中等
```

**新 L5（多维度 ASCII 确认，分步展示）：**

```
═══════════════════════════════════════════
        L5 确认门控 — 需求确认摘要
═══════════════════════════════════════════

📋 需求摘要: [1 段话]

───────── 架构概览 ─────────
┌─────────────────────────────────────┐
│         用户角色 / 核心概念          │
│   (ASCII 关系图)                    │
└─────────────────────────────────────┘

───────── 核心工作流 ─────────
Phase 1 ──▶ Phase 2 ──▶ Phase 3
[名称]     [名称]     [名称]

───────── 数据模型 ─────────
┌──────────┬─────────────┬──────────┐
│ 模型     │ 关键字段     │ 关系     │
├──────────┼─────────────┼──────────┤
│ User     │ id,name,role│ hasMany  │
│ Task     │ id,title    │ belongsTo│
└──────────┴─────────────┴──────────┘

───────── 关键页面 ─────────
┌─────────────────────────────────────┐
│  [Header]                           │
│  ┌─────────┬───────────────────┐   │
│  │ Sidebar │ Main Content      │   │
│  │         │                   │   │
│  └─────────┴───────────────────┘   │
└─────────────────────────────────────┘

───────── 业务规则 (核心) ─────────
- 规则 1: ...
- 规则 2: ...

───────── 风险评估 ─────────
HIGH: ...
MEDIUM: ...
```

**L5 分步确认流程：**

```
L5 确认流程（完整规划模式）:

Step 1: 展示「架构 + 工作流」ASCII → 用户确认/修改
Step 2: 展示「数据模型」表格 + 关系 → 用户确认/修改
Step 3: 展示「关键 UI」ASCII 布局 → 用户确认/修改 (仅有前端时)
Step 4: 展示「业务规则」表格 → 用户确认/修改 (仅完整规划模式)
Step 5: 展示「开发计划」Phase 列表 + 风险 → 总确认

快速修复: 跳过 L5（直接生成轻量 prd.json）
功能开发: Step 1 + Step 5（跳过 2/3/4）
完整规划: 全部 5 步
```

#### 4.4.4 Phase 7 PRD 模板重写

完整规划模式的 PRD 模板：

```markdown
# PRD: [功能名称]

## 1. 项目概述

### 1.1 背景与动机
[基于 L1 答案]

### 1.2 核心目标
- [目标 1]
- [目标 2]

### 1.3 成功指标
- [指标 1]
- [指标 2]

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| [模块名] | ✅ 已实现 / ⚠️ 部分实现 / ❌ 未实现 | [描述] |

### 2.2 缺口分析

```
[基于代码库扫描，ASCII 展示代码 vs 实际状态]
```

## 3. 架构设计

### 3.1 核心概念

```
[ASCII 核心概念关系图]
```

### 3.2 用户角色

```
[ASCII 角色与权限图]
```

### 3.3 核心工作流

```
[ASCII 多 Phase 流程图，含依赖关系]
```

### 3.4 状态机

```
[ASCII 状态转换图 — 如有状态流转需求]
```

## 4. 数据设计

### 4.1 数据模型概览

| 模型 | 用途 | 关键字段 | 状态 |
|------|------|---------|------|
| [表名] | [用途] | [字段列表] | 新建/修改/已有 |

### 4.2 Schema 定义

```sql
-- [表名]: [用途]
CREATE TABLE [表名] (
  [字段定义，含注释]
);
```

### 4.3 模型关系

```
[ASCII ER 图]
```

### 4.4 约束与规则

| 约束 | 说明 |
|------|------|
| [约束名] | [描述] |

## 5. UI 设计

### 5.1 页面清单

| 页面 | 路由 | 说明 | 状态 |
|------|------|------|------|
| [页面名] | [路由] | [描述] | 新建/已有 |

### 5.2 组件清单

| 组件 | Props 接口 | 复用位置 | 状态 |
|------|-----------|---------|------|
| [组件名] | `{ prop1: type }` | [页面列表] | 新建/已有/提取 |

### 5.3 关键页面布局

```
[ASCII 页面布局]
```

### 5.4 关键弹窗/交互

```
[ASCII 弹窗布局]
```

## 6. 业务规则

### 6.1 [领域 1] 规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-001 | [规则名] | [描述] | DT-XXX |

### 6.2 决策树

```
[ASCII 决策树 — 复杂逻辑]
```

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3
[名称]     [名称]     [名称]
(P0)       (P0)       (P1)

依赖关系:
Phase 1 是所有后续 Phase 的前置
Phase 2, Phase 3 可并行
```

### 7.1 Phase 1: [名称] (P0)

> **前置**: 无
> **产出**: [具体产出描述]
> **对应设计**: Section 3.3, 4.2

- [ ] DT-001: [任务描述] (`API: /api/xxx`, `文件: src/xxx`)
- [ ] DT-002: [任务描述] (`组件: <Xxx>`, `文件: src/components/xxx`)
- [ ] DT-003: [任务描述]

### 7.2 Phase 2: [名称] (P1)

> **前置**: Phase 1
> **产出**: [具体产出描述]
> **对应设计**: Section 5.3, 5.4

- [ ] DT-004: [任务描述]
- [ ] DT-005: [任务描述]

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `src/components/xxx.tsx` | 待开发 | Phase 2 | DT-004 |
| `src/api/xxx/route.ts` | 待开发 | Phase 1 | DT-001 |
| `src/lib/auth.ts` | ✅ 已有 | - | - |

### B. 风险与缓解措施

#### HIGH
- **[风险标题]**: [描述] → **缓解**: [方案]

#### MEDIUM
- **[风险标题]**: [描述] → **缓解**: [方案]

### C. 测试策略

#### 单元测试
- [测试场景]

#### 集成测试
- [测试场景]

#### E2E 测试
- [测试场景]

### D. 非目标 (Out of Scope)
- [明确不包含的功能]

### E. 安全检查项
[由安全关键词自动注入生成]
```

#### 4.4.5 安全注入逻辑

不变。仍然在 Phase 7 生成所有 Dev Tasks 后、写入文件前执行关键词扫描和自动注入。注入的安全项放在 § 8.E 和对应 DT 的验收标准中。

### 4.5 GeneratePRD SKILL.md 改动

改动较小，主要对齐：
- Phase 4（生成 PRD）使用新 PRD 模板（§ 4.4.4）
- 保持对话式风格不变（不强制 5 层）
- 最终输出与 PyramidPRD 同格式，便于 PRD2JSON 统一处理

---

## 5. Stage 2 改造：prd.json 精简为自动化索引层

### 5.1 涉及 Skill

- **PRD2JSON** (`skills/BotoolAgent/PRD2JSON/SKILL.md`)

### 5.2 设计理念

PRD.md 已经包含完整设计信息（架构/数据/UI/规则/代码示例/测试用例），prd.json 不需要重复这些内容。prd.json 只保留机器自动化循环必需的结构化字段。

### 5.3 新 prd.json Schema

```json
{
  "project": "[项目名称]",
  "branchName": "botool/[feature-name-kebab-case]",
  "description": "[功能描述]",
  "prdFile": "tasks/prd-[feature-name].md",
  "constitution": {
    "rules": [
      {
        "id": "rule-001",
        "name": "[规范名称]",
        "category": "[backend|frontend|testing|...]",
        "content": "[完整规范内容]"
      }
    ],
    "ruleAuditSummary": ""
  },
  "devTasks": [
    {
      "id": "DT-001",
      "title": "[任务标题]",
      "prdSection": "7.1",
      "priority": 1,
      "passes": false,
      "dependsOn": [],
      "evals": [
        {
          "type": "code-based",
          "blocking": true,
          "description": "Typecheck passes",
          "command": "npx tsc --noEmit",
          "expect": "exit-0"
        }
      ],
      "testCases": [
        { "type": "typecheck", "desc": "TypeScript 编译通过" },
        { "type": "unit", "desc": "核心逻辑单元测试", "tdd": true }
      ]
    }
  ],
  "sessions": [
    {
      "id": "S1",
      "tasks": ["DT-001", "DT-002", "DT-003"],
      "reason": "数据库基础 + 后端逻辑，有依赖关系"
    }
  ]
}
```

### 5.4 字段变化对比

| 字段 | 旧 Schema | 新 Schema | 变化原因 |
|------|----------|----------|---------|
| `project` | 保留 | 保留 | - |
| `branchName` | 保留 | 保留 | - |
| `description` | 保留 | 保留 | - |
| `prdFile` | **不存在** | **新增** | 指向 PRD 文件路径 |
| `constitution` | 保留 | 保留 | - |
| `devTasks[].id` | 保留 | 保留 | - |
| `devTasks[].title` | 保留 | 保留 | - |
| `devTasks[].description` | 保留 | **移除** | 在 PRD.md 中更完整 |
| `devTasks[].acceptanceCriteria` | 保留 | **移除** | 在 PRD.md 中更完整 |
| `devTasks[].prdSection` | **不存在** | **新增** | 映射到 PRD 对应章节 |
| `devTasks[].priority` | 保留 | 保留 | - |
| `devTasks[].passes` | 保留 | 保留 | - |
| `devTasks[].dependsOn` | 保留 | 保留 | 自动化排序必需 |
| `devTasks[].contextHint` | 保留 | **移除** | PRD § 7 每个 Phase 有"对应设计"引用 |
| `devTasks[].notes` | 保留 | **移除** | 进度信息在 progress.txt |
| `devTasks[].spec` | 保留 | **移除** | 设计信息在 PRD.md §3-6 |
| `devTasks[].evals` | 保留 | 保留 | 自动化验证必需 |
| `devTasks[].testCases` | 保留 | 保留 | TDD 标记必需 |
| `sessions` | 保留 | 保留 | - |

### 5.5 prdSection 映射规则

PRD2JSON 在转换时自动将每个 DT 映射到 PRD 中对应的章节号：

```
PRD § 7.1 Phase 1 下的 DT-001 → prdSection: "7.1"
PRD § 7.3 Phase 3 下的 DT-005 → prdSection: "7.3"
```

Coding agent 读到 `prdSection: "7.3"` 时：
1. 打开 `prdFile` 指向的 PRD.md
2. 找到 `## 7.3` 标题
3. 读取该章节的前置依赖、对应设计节引用、完整任务清单
4. 根据「对应设计: Section 3.3, 4.2, 5.3」跳读获取 ASCII/Schema/规则等上下文

### 5.6 转换逻辑变化

```
旧流程:
PRD.md → [解析 DT] → [富化 spec/evals/testCases] → prd.json (大而全)

新流程:
PRD.md → [解析 Phase/DT 结构] → [提取自动化字段] → prd.json (精简索引)
                                       ↑
                                  只提取:
                                  - DT id/title/priority
                                  - prdSection 映射
                                  - dependsOn (依赖)
                                  - evals (验证命令)
                                  - testCases (TDD 标记)
                                  - sessions (分组)
                                  - constitution (规范)
```

### 5.7 向后兼容

- 所有移除的字段原本就是 optional，coding agent 已有 fallback 逻辑
- 新增的 `prdFile` 和 `prdSection` 需要配合 CLAUDE.md 修改（见 § 6）
- Viewer 前端只读取 `devTasks[].id/title/passes/priority`，不受影响

### 5.8 保留的规则选择流程

PRD2JSON 现有的规则扫描和选择流程（Step 1-2）不变：
1. 扫描 `rules/` 目录
2. 用 AskUserQuestion 确认规则选择
3. 读取选中规则内容嵌入 `constitution.rules`

---

## 6. CLAUDE.md 配合修改

### 6.1 修改位置

项目根目录 `CLAUDE.md` 的「上下文检索（实现前）」部分。

### 6.2 修改内容

```diff
 ## 上下文检索（实现前）

-1. 读取当前任务的 `spec.filesToModify` 和 `spec.relatedFiles`
-2. 如果存在，直接读取这些文件
-3. 如果为空或不存在，执行搜索：
+1. 读取 prd.json 的 `prdFile` 字段，定位 PRD markdown 文件
+2. 读取当前任务的 `prdSection`，在 PRD 中找到对应章节
+3. 从该章节提取上下文：
+   - 「前置」和「产出」— 理解任务边界
+   - 「对应设计: Section X.X」— 跳读相关设计节获取：
+     - 架构 ASCII 图（§ 3）
+     - 数据 Schema（§ 4）
+     - UI ASCII 布局（§ 5）
+     - 业务规则（§ 6）
+   - 任务清单中的 API 路径、组件名、文件路径
+4. 如果 prdSection 不存在（兼容旧格式），回退到现有逻辑：
+   a. 读取 `spec.filesToModify` 和 `spec.relatedFiles`
+   b. 如果为空，执行搜索
    a. 用任务关键词搜索相关文件
    b. 只深度阅读高相关性文件（最多 5 个）
 5. 如果有 `dependsOn`，读取依赖任务在 progress.txt 中的日志
-6. 如果有 `contextHint`，按提示重点关注特定上下文
```

---

## 7. 实施计划

### 7.1 实施顺序

```
Phase 1: PyramidPRD SKILL.md 重写
├── 改造 Phase 2.5 代码库扫描（新增维度）
├── 改造 L2-L4 问题话题（新增设计相关问题）
├── 重写 L5 门控（ASCII 多维度确认）
├── 重写 Phase 7 PRD 模板（新模板结构）
└── 更新复杂度裁剪规则

Phase 2: PRD2JSON SKILL.md 重写
├── 精简 prd.json schema（移除 spec/description/AC）
├── 新增 prdFile 和 prdSection 字段
├── 更新转换逻辑和示例
└── 更新检查清单

Phase 3: 配合修改
├── CLAUDE.md 上下文检索逻辑更新
├── GeneratePRD SKILL.md 对齐输出格式
└── 更新 README / 使用说明
```

### 7.2 验证方法

- 用参考 PRD 的需求描述（"做一个 PPT 文档管理系统，支持版本管理、多语言翻译、分类指派"）作为输入，运行改造后的 PyramidPRD，对比输出与参考 PRD 的颗粒度
- 验证 prd.json 精简后 coding agent 仍能正确读取上下文
- 验证 Viewer 前端不受影响
