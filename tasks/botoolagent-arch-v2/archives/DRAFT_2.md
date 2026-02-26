# Draft 2: PyramidPRD 上下文爆炸修复 + 大文件 Transform 架构

> Stage 0 头脑风暴产出 | 日期: 2026-02-26
> 前置: DRAFT.md (文档架构 v2 — 三件套 prd.md/dev.md/dev.json)

## 定位

解决 PyramidPRD 在多层问答和大文件导入过程中的**上下文窗口爆炸**问题。通过「Q&A Journal 持久化」+「Subagent 管线架构」+「大文件智能预处理」三个维度重构 PyramidPRD 的执行模型。

## 背景与动机

### 问题 1: 主对话上下文膨胀

PyramidPRD 所有操作（L0-L5 问答、代码扫描、L5 ASCII 确认、PRD 生成）在同一个对话上下文中执行，没有任何中间持久化：

| 阶段 | 上下文消耗 | 说明 |
|------|-----------|------|
| L0-L4 问答（5层） | 每层 ~3-5KB × 5 | 问题+选项+用户回答+总结 |
| 代码扫描 (Phase 2.5) | 10-50KB | 读文件内容全部留在上下文 |
| L5 确认门控（2轮） | ~8-15KB | 大量 ASCII 可视化 |
| PRD 生成 (Phase 7) | 5-30KB | 生成的完整文档内容 |
| **Transform 模式** | **50-150KB+** | 读取源 PRD + 比对 + 生成 |
| **总计（完整规划）** | **~80-250KB** | 极易触发 context limit |

**后果：**
- 问答中途 compact → 丢失之前层级答案
- 问答完成后 PRD 生成阶段 → 上下文不够用
- Transform Mode（8120行 PRD）→ 几乎必爆

### 问题 2: 大文件手动拆分的交叉引用断裂

用户尝试手动将 8120 行 PRD 拆为 PRD-A~H 后，用 PyramidPRD 分别处理，发现严重问题：

| 问题 | 具体表现 |
|------|---------|
| **格式不匹配** | 子 PRD 是原始章节剪切拼接，不是 §1-§8 标准结构 |
| **Schema 孤岛** | SQL CREATE TABLE 全在 PRD-A（Section 7），PRD-D~H 引用的表定义全部缺失 |
| **DT 粒度不足** | 原始 Phase 描述太简略（如 17 行），PRD2JSON 无法生成合格 devTasks |
| **跨引用断裂** | Coding Agent 跳读 §7 → §4 找表结构 → 当前子 PRD 无 §4 → 报错或猜测字段名 |

**根本原因：** 大文件的内容是互相引用的有机体，简单按章节物理切割会破坏语义完整性。

## 核心方案

### 方案 A: Q&A Journal 持久化（解决问答阶段上下文膨胀）

**原理：** 每个问答层级完成后，将结构化答案写入文件；下一层级开始时从文件恢复上下文，不依赖对话历史。

**文件路径：** `tasks/<projectId>/qa-journal.md`

**Journal 格式：**

```markdown
# Q&A Journal — [项目名]
> 模式: 功能开发 | 复杂度: 中等

## L0: 方向探索
- 选定方向: 方向 A — [一句话描述]
- 实现思路: [选定技术方案概要]
- 范围: ✅ [要做列表] / ❌ [不做列表]
- 项目技术栈: Next.js + TypeScript + Prisma

## L1: 核心识别
- 问题域: [答案]
- 目标用户: [答案]
- 核心价值: [答案]
- 规模预期: [答案]

## L2: 领域分支
### frontend
- 页面结构: [答案]
- 核心组件: [答案]
### backend
- API 类型: [答案]
- 数据模型: [答案]
...（更多维度）

## L3: 细节深入
- [话题]: [答案]
...

## L4: 边界确认
- 集成点: [答案]
- 排除范围: [答案]
- 非功能需求: [答案]
```

**执行流程变化：**

```
当前流程（无持久化）:
  L0(上下文) → L1(上下文) → L2(上下文) → ... → 全部堆积
  ↓ 上下文线性膨胀，越来越大

新流程（Journal 持久化）:
  L0(上下文) → Write qa-journal.md
  L1: Read qa-journal.md → 提问 → Write 追加 L1
  L2: Read qa-journal.md → 提问 → Write 追加 L2
  ...
  PRD 生成: Read qa-journal.md + codebase-scan.md → 生成
  ↓ 每层上下文 ≈ journal文件(~3KB) + 当前层问答(~5KB) = ~8KB
```

**Compact 恢复能力：** 即使 /compact 发生在 L2 和 L3 之间，L3 只需 Read qa-journal.md 即可恢复 L0-L2 全部上下文。

---

### 方案 B: Subagent 管线架构（解决重活消耗主对话上下文）

**原理：** 将不需要用户交互的"重活"委派给 subagent，主对话只做编排和用户交互。

**Subagent 拆分方案：**

| 阶段 | Subagent 类型 | 输入 | 输出 | 主对话节省 |
|------|-------------|------|------|-----------|
| 代码扫描 (2.5) | `Explore` | 项目目录 | `codebase-scan.md` | 30-50KB |
| PRD 生成 (7) | `general-purpose` | qa-journal.md + codebase-scan.md | prd.md | 10-30KB |
| Transform 源文件分析 (T1-T2) | `Explore` | 源 PRD 路径 | `source-analysis.md` | 50-100KB |
| Transform PRD 生成 (T7) | `general-purpose` | source-analysis.md + qa-journal.md | prd.md | 20-50KB |
| T7 原文比对 | `general-purpose` | 源 PRD + 生成 PRD | 比对报告 + 自动补充 | 15-30KB |

**不能委派给 subagent 的（需用户交互）：**
- L0-L5 问答（AskUserQuestion 必须在主对话）
- L5 确认门控（需用户逐 Tab 审阅）
- 模式选择（Phase 0）

**架构图：**

```
主对话（精简编排器, ~40KB 上下文上限）
  │
  ├─ Phase 0: 模式选择 ──── 主对话 (1x AskUserQuestion)
  │
  ├─ L0 方向探索 ─────────── 主对话 (2x AskUserQuestion)
  │   └─ Write qa-journal.md
  │
  ├─ 代码扫描 ────────────── Explore Subagent ⚡
  │   └─ Output: codebase-scan.md
  │   └─ 主对话收到: 3-5行摘要
  │
  ├─ L1-L4 问答 ──────────── 主对话 (每层 Read journal → Ask → Write journal)
  │
  ├─ L5 确认门控 ──────────── 主对话 (Read journal + scan → 生成 ASCII → Ask)
  │
  ├─ PRD 生成 ────────────── general-purpose Subagent ⚡
  │   └─ Input: Read qa-journal.md + codebase-scan.md
  │   └─ Output: 直接 Write prd.md
  │   └─ 主对话收到: "PRD 已写入 xxx/prd.md, 共 N 行"
  │
  └─ PRD2JSON ─────────────── 主对话 or Subagent
```

**预估效果：**
- 完整规划模式: 上下文从 ~150KB → ~40-50KB
- Transform 模式: 上下文从 ~200KB+ → ~50-60KB

---

### 方案 C: 大文件 Transform 智能预处理（解决大文件拆分的交叉引用断裂）

**核心理念：** 不让用户手动拆分。由 AI 预处理大文件，生成「共享上下文 + Phase 分包」结构，每个分包自带完整的交叉引用。

#### 为什么不能简单物理切割

```
源 PRD 8120 行:
  §1 产品概述 (1200行)        ← 全局共享
  §2 数据库设计 (450行)       ← 全局共享（所有 Phase 都引用）
  §3 架构设计 (600行)         ← 全局共享
  §4-§6 业务规则 (2000行)     ← 部分共享
  §7 SQL Schema (570行)       ← 全局共享（CREATE TABLE 定义）
  §8 UI 设计 (800行)          ← 部分共享
  §9 开发计划 (2000行)        ← 9 个 Phase
  §10-§11 附录+日志 (500行)   ← 部分共享

问题: Phase 9.4（翻译功能）需要引用 §7 的 present_translations 表、
§4 的翻译规则、§3 的状态机。物理切割后这些全丢。
```

#### 方案 C1: "Master Context + Phase Bundle" 架构（推荐）

**第一遍: 提取共享上下文（Explore Subagent）**

```
Explore Subagent 读取源 PRD → 生成 master-context.md:
  - §1 项目概述（压缩为 ~200 行摘要）
  - §全部 CREATE TABLE（完整保留，不压缩）
  - §架构设计（状态机、角色权限矩阵 — 完整保留）
  - §全局业务规则（跨 Phase 的约束 — 完整保留）
  - 技术栈声明
```

**第二遍: 按 Phase 创建自包含分包（general-purpose Subagent）**

```
对源 PRD 每个 Phase（或 2-3 个相关 Phase 合并为一个分包）:
  phase-bundle-N.md =
    master-context.md（完整嵌入 ~500行）
    + Phase N 原文（完整保留）
    + Phase N 引用的所有表定义（从 master-context 精选）
    + Phase N 引用的业务规则（从 §4-§6 精选）
    + Phase N 引用的 UI 设计（从 §8 精选）
```

每个分包大小: master-context ~500行 + Phase 特定内容 ~300-800行 = ~800-1300行
→ 可以在单个对话/subagent 中处理

**第三遍: 对每个分包执行 Transform（并行 Subagent）**

```
主对话并行启动 N 个 general-purpose Subagent:
  Subagent-1: phase-bundle-1.md → prd-phase-1.md (§1-§8 标准格式)
  Subagent-2: phase-bundle-2.md → prd-phase-2.md
  ...
  Subagent-N: phase-bundle-N.md → prd-phase-N.md
```

**第四遍: 合并校验（主对话或合并 Subagent）**

```
合并所有 prd-phase-N.md → 最终 prd.md:
  - §1 项目概述: 取 Phase-1 的版本
  - §3 架构设计: 合并所有 Phase 的架构补充
  - §4 数据设计: 去重合并所有 CREATE TABLE
  - §5 UI 设计: 合并所有 Phase 的组件清单
  - §6 业务规则: 合并所有 Phase 的规则（去重）
  - §7 开发计划: 按 Phase 顺序拼接所有 DT
  - §8 附录: 合并
  - 去重 + 冲突检测 + 行数校验
```

**优势：**
- 每个分包 < 1500 行，不会爆上下文
- 每个分包自带完整 Schema 和规则引用，不会出现 Schema 孤岛
- 可并行处理，总耗时 ≈ 最慢分包的处理时间
- 合并时可检测不一致（如两个 Phase 对同一表有矛盾的定义）

#### 方案 C2: "单源多遍抽取" 架构（备选）

不拆分源 PRD，而是用多个 Explore subagent 从不同维度读取同一源文件：

```
Explore Subagent A: 提取 §4 数据设计 → data-extraction.md
Explore Subagent B: 提取 §3+§6 架构+规则 → arch-rules-extraction.md
Explore Subagent C: 提取 §5+§8 UI+附录 → ui-appendix-extraction.md
Explore Subagent D: 提取 §7/§9 开发计划 → plan-extraction.md

主对话: Read 4个提取文件 → 组装 L5 确认 → 生成 PRD
```

**优势：** 不需要拆分和合并，逻辑更简单
**劣势：** 各 subagent 的提取可能不完整（依赖 subagent 的理解能力），且每个 subagent 仍需读取大文件的相关章节

#### 方案对比

| 维度 | C1 Master+Bundle | C2 单源多遍 |
|------|------------------|------------|
| 复杂度 | 较高（拆分+合并） | 较低 |
| 单次 subagent 上下文 | ~1300行（可控） | ~2000-4000行 |
| 交叉引用完整性 | ✅ master-context 保证 | ⚠️ 依赖 subagent 判断 |
| 并行度 | 高（N个Phase并行） | 中（4个维度并行） |
| 合并冲突风险 | 需要处理 | 无 |
| 适用场景 | > 5000 行超大 PRD | 2000-5000 行中大 PRD |

**建议：**
- 2000-5000 行 → C2 单源多遍（简单高效）
- \> 5000 行 → C1 Master+Bundle（可靠性更高）
- < 2000 行 → 当前 Transform 流程已够用（方案A+B 优化后）

---

## 实施优先级

| 优先级 | 方案 | 改动范围 | 收益 |
|--------|------|---------|------|
| **P0** | A. Q&A Journal | PyramidPRD SKILL.md | 防 compact 丢数据 + 每层上下文降到 ~8KB |
| **P1** | B. 代码扫描 subagent | PyramidPRD SKILL.md | 节省 30-50KB（改动最小的 subagent 化） |
| **P1** | B. PRD 生成 subagent | PyramidPRD SKILL.md | 节省 10-30KB |
| **P2** | B. Transform 分析 subagent | PyramidPRD SKILL.md | Transform 模式节省 50-100KB |
| **P2** | C2. 中大文件多遍抽取 | PyramidPRD SKILL.md | 2000-5000 行 PRD 可靠处理 |
| **P3** | C1. 超大文件 Bundle 架构 | 新增 skill 或 Phase | > 5000 行 PRD 可靠处理 |

## 与 DRAFT.md (arch-v2) 的关系

DRAFT.md 定义了**输出格式**的升级（三件套 prd.md/dev.md/dev.json）。
本 DRAFT_2.md 定义了**执行引擎**的升级（上下文管理 + 大文件处理）。

两者独立但互补：
- arch-v2 改善的是 PRD 生成后的**质量和可用性**
- 本方案改善的是 PRD 生成过程中的**可靠性和鲁棒性**

可以并行推进，也可以先做 arch-v2（输出格式），再做本方案（执行引擎），因为执行引擎的改动不影响输出格式。

## 范围边界

### 要做的

**PyramidPRD SKILL.md:**
- 新增 Q&A Journal 写入/读取指令（每层结束 Write → 下层开始 Read）
- Phase 2.5 代码扫描改为 Explore Subagent 调用指令
- Phase 7 PRD 生成改为 general-purpose Subagent 调用指令
- Transform T1-T2 源文件分析改为 Explore Subagent 调用指令
- Transform T7 原文比对改为 Subagent 调用指令
- 新增大文件预处理阶段（> 5000 行自动触发 Master+Bundle 流程）

### 不做的（YAGNI）

- 不修改 L0-L5 问答流程本身（只加 journal 写入）
- 不修改 PRD2JSON skill（输出格式不变）
- 不修改 viewer 前端
- 不创建独立的"大文件拆分 skill"（作为 PyramidPRD 内部阶段）
- 不修改 L5 确认门控的 ASCII 可视化格式

## 技术方向

- **技术栈**: 纯 Markdown Skill 文件修改
- **修改范围**: 1 个核心文件
  - `skills/BotoolAgent/PyramidPRD/SKILL.md`（主要修改）
- **关键决策**:
  - Journal 文件位置: `tasks/<projectId>/qa-journal.md`
  - Subagent 调用方式: 通过 Skill 文本中的「使用 Task 工具启动 Explore subagent」等自然语言指令
  - 大文件阈值: 5000 行触发 Bundle 架构
  - Master Context 文件: `tasks/<projectId>/master-context.md`（临时文件，PRD 生成后可删除）

## 成功标准

- [ ] 完整规划模式主对话上下文消耗 ≤ 50KB（当前 ~150KB）
- [ ] Transform 模式处理 8120 行 PRD 不触发 context limit
- [ ] /compact 后恢复 qa-journal.md 继续问答，不丢失之前回答
- [ ] 手动拆分大 PRD 的场景不再出现 Schema 孤岛问题
- [ ] 每个 Phase Bundle 的 CREATE TABLE 数量 = 该 Phase 引用的表数量（完整性校验通过）

## 开放问题

1. Subagent 调用在 Skill 指令中如何精确描述？Claude Code 的 Task 工具需要在 Skill 执行上下文中调用，是否有限制？
2. Q&A Journal 的格式是否需要更结构化（如 YAML frontmatter）以便 subagent 解析？
3. 大文件 Bundle 流程是否需要用户确认拆分结果，还是完全自动？
4. 并行 subagent 的数量上限？同时启动 5-9 个 Phase Bundle 处理是否有性能/配额问题？

---

> 下一步: 将 DRAFT.md + DRAFT_2.md 合并，使用 `/botoolagent-pyramidprd` 生成统一的 arch-v2 PRD
