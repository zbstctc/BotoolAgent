---
name: botoolagent-pyramidprd
description: "金字塔式 PRD 问答生成器。通过 5 层递进式问答（含确认门控）收集需求，最终生成 PRD 文档。触发词：pyramid prd, 金字塔问答, 层级问答"
user-invocable: true
---

# BotoolAgent 金字塔 PRD 生成器

通过 5 层递进式问答（含确认门控），系统性地收集需求并生成 PRD 文档。

**启动提示:** "Using BotoolAgent:PyramidPRD to collect requirements through structured Q&A."

---

## 重要：所有内容必须使用中文

所有问题、选项、描述、反馈都必须使用中文。

---

## 金字塔结构概述

```
评估复杂度 → 确定问题数量
    ↓
L1: 核心识别 - 理解需求本质
    ↓
代码库扫描（有代码库时自动执行，无代码库时跳过）
    ↓
L2: 领域分支 - 按维度深入（融合扫描结果）
    ↓
L3: 细节深入 - 实现细节
    ↓
L4: 边界确认 - 范围边界
    ↓
L5: 确认门控 - 结构化摘要确认
    ↓
生成 PRD 文档（含安全检查自动注入）
```

---

## 动态复杂度评估

**收到需求描述后，首先评估复杂度，决定每层问多少问题。**

### 复杂度判断标准

| 复杂度 | 特征 | 每层问题数 | 示例 |
|--------|------|-----------|------|
| **简单** | 单一功能、单一用户、无后端 | 3-4 个 | "做个计数器"、"添加深色模式" |
| **中等** | 多个功能点、需要后端、有数据存储 | 5-7 个 | "用户登录功能"、"数据导出" |
| **复杂** | 多角色、多模块、复杂业务逻辑 | 8-12 个 | "用户管理系统"、"订单流程" |

### 复杂度信号

**简单需求信号：**
- 描述少于 10 个字
- 只提到一个功能点
- 明确说"简单"、"基础"、"MVP"

**中等需求信号：**
- 涉及前后端
- 需要数据持久化
- 有 2-3 个功能点

**复杂需求信号：**
- 涉及多个用户角色
- 有复杂的业务流程
- 需要与多个系统集成
- 描述中有"系统"、"平台"、"管理"等词

### 在 metadata 中标注复杂度

```json
{
  "metadata": {
    "source": "pyramidprd",
    "level": 1,
    "complexity": "medium",
    "questionsPerLevel": "5-7"
  }
}
```

---

## 核心规则：使用 AskUserQuestion 批量提问

**每次调用 AskUserQuestion 时，必须在 metadata 中包含 level 信息！**

```json
{
  "questions": [...],
  "metadata": {
    "source": "pyramidprd",
    "level": 1,
    "levelName": "L1: 核心识别",
    "progress": "1/5",
    "totalLevels": 5,
    "codebaseScanned": false
  }
}
```

**问题格式要求：**
- **必须根据复杂度决定问题数量**（见上方复杂度评估）
- 每个问题第一行标注层级：`【L1: 核心识别】问题内容`
- options 要有 label 和 description
- **重要：不要固定只问 3-4 个问题，复杂需求必须问 8-12 个！**

---

## 执行流程

### Phase 0: 模式选择（AI 推荐 + 用户决定）

**目标：** 根据用户的初始需求描述，AI 评估复杂度并推荐模式，但最终由用户选择。

**注意：** 如果用户的消息中已包含 `[模式:快速修复]`、`[模式:功能开发]` 等模式标记（由 Viewer 前端自动添加），则跳过模式选择，直接按指定模式进入对应流程。

**步骤 1：接收用户需求描述**

用户提供初始需求描述后，在内部进行复杂度评估（不展示给用户）：

| 分析维度 | 权重 | Quick Fix | Feature Build | Full Planning |
|----------|------|-----------|---------------|---------------|
| 涉及文件数（预估） | 30% | 1-2个 | 3-8个 | 8+个 |
| 是否有数据模型变更 | 25% | 无 | 可能有 | 一定有 |
| 是否需要新建模块/页面 | 20% | 否 | 可能 | 是 |
| 是否涉及多个系统层 | 15% | 1层 | 2-3层 | 全栈 |
| 描述复杂度（字数/概念） | 10% | <50字 | 50-200字 | 200+字 |

**步骤 2：使用 AskUserQuestion 呈现选择**

```json
{
  "questions": [
    {
      "question": "我分析了你的需求，推荐使用以下模式。请选择：",
      "header": "模式选择",
      "options": [
        { "label": "快速修复 (~2分钟)", "description": "适合改 bug、调样式、小调整。流程：描述需求->确认任务->自动执行" },
        { "label": "功能开发 (~10-15分钟) 推荐", "description": "适合新功能、新页面、多文件变更。流程：核心问答->任务规划->确认->自动执行" },
        { "label": "完整规划 (~30-45分钟)", "description": "适合架构级变更、新模块、复杂系统。流程：5层金字塔问答->富化规格->确认->自动执行" }
      ],
      "multiSelect": false
    }
  ]
}
```

注意：「推荐」标记应根据 AI 评估结果放在对应的选项上。

**步骤 3：根据选择进入不同流程**

- **快速修复** -> 进入 Phase 1-Quick（简化流程）
- **功能开发** -> 进入 Phase 1（跳过 L2、L3，只走 L1 + L4 + 确认）
- **完整规划** -> 进入 Phase 1（完整 L1->L5 流程，即当前默认流程）

---

### Phase 1-Quick: 快速修复流程

**适用：** 用户选择了快速修复模式

1. 用户已提供初始描述
2. 执行代码库扫描（如果有代码库）
3. AI 自动生成 1-3 个 DT 任务
4. 使用 AskUserQuestion 确认任务列表
5. 跳过 PRD markdown 生成
6. 跳过 Stage 2（不选规则、不生成代码示例/测试用例）
7. 直接生成轻量 prd.json（无 spec 字段，constitution 可选）
8. 执行安全关键词扫描（仅对高风险关键词：认证/支付）

---

### Phase 1: 接收需求描述并评估复杂度

用户会提供一句话需求描述，例如：
- `/botoolagent-pyramidprd 做一个用户登录功能`
- `/botoolagent-pyramidprd 添加数据导出功能`

**收到后：**
1. **快速评估复杂度**（内部判断，不输出给用户）
2. **确定问题数量策略**
3. **立即开始 L1 提问**

**模式影响问答流程：**
- **功能开发模式** -> 只走 L1 核心识别 + L4 边界确认 + L5 确认门控（跳过 L2 领域分支和 L3 细节深入）
- **完整规划模式** -> 完整 L1 -> L2 -> L3 -> L4 -> L5 流程（当前默认行为）

**复杂度决定问题深度：**
- 简单需求 -> 每层 3-4 个问题，快速完成
- 中等需求 -> 每层 5-7 个问题，适度深入
- 复杂需求 -> 每层 8-12 个问题，全面覆盖

---

### Phase 2: L1 核心识别

**目标：** 理解需求的本质和范围

**必问话题：**
1. **问题域** - 这个需求涉及哪些领域？
2. **目标用户** - 谁会使用这个功能？
3. **核心价值** - 解决什么痛点？
4. **规模预期** - MVP 还是完整功能？

**示例 AskUserQuestion 调用（简单需求 3-4 个问题）：**

```json
{
  "questions": [
    { "question": "【L1】问题域？", "header": "问题域", "options": [...], "multiSelect": false },
    { "question": "【L1】目标用户？", "header": "目标用户", "options": [...], "multiSelect": true },
    { "question": "【L1】实现规模？", "header": "规模预期", "options": [...], "multiSelect": false }
  ],
  "metadata": { "level": 1, "complexity": "simple" }
}
```

**示例（复杂需求 8-12 个问题）：**

```json
{
  "questions": [
    { "question": "【L1】技术栈范围？", "header": "技术范围", "options": [...], "multiSelect": false },
    { "question": "【L1】目标用户群体？", "header": "目标用户", "options": [...], "multiSelect": true },
    { "question": "【L1】核心痛点？", "header": "核心价值", "options": [...], "multiSelect": true },
    { "question": "【L1】实现规模？", "header": "规模预期", "options": [...], "multiSelect": false },
    { "question": "【L1】安全要求级别？", "header": "安全等级", "options": [...], "multiSelect": false },
    { "question": "【L1】与现有系统的关系？", "header": "集成方式", "options": [...], "multiSelect": false },
    { "question": "【L1】数据敏感度？", "header": "数据安全", "options": [...], "multiSelect": false },
    { "question": "【L1】部署环境？", "header": "部署方式", "options": [...], "multiSelect": false }
  ],
  "metadata": { "level": 1, "complexity": "complex", "questionsPerLevel": "8-12" }
}
```

**完整示例（中等复杂度）：**

```json
{
  "questions": [
    {
      "question": "【L1: 核心识别】这个功能主要涉及哪些领域？",
      "header": "问题域",
      "options": [
        { "label": "仅前端", "description": "只涉及 UI/交互，不需要后端改动" },
        { "label": "前端 + 后端", "description": "需要 UI 和 API/数据库改动" },
        { "label": "仅后端", "description": "只涉及 API/数据库，无 UI 改动" },
        { "label": "全栈 + 基础设施", "description": "涉及 UI、API、部署等全方位改动" }
      ],
      "multiSelect": false
    },
    {
      "question": "【L1: 核心识别】这个功能的主要用户是谁？",
      "header": "目标用户",
      "options": [
        { "label": "开发者", "description": "使用代码或 API 的技术用户" },
        { "label": "产品/运营", "description": "管理产品和内容的内部用户" },
        { "label": "最终用户", "description": "使用产品界面的普通用户" },
        { "label": "管理员", "description": "负责系统配置和管理的用户" }
      ],
      "multiSelect": true
    },
    {
      "question": "【L1: 核心识别】核心要解决的问题是什么？",
      "header": "核心价值",
      "options": [
        { "label": "提升效率", "description": "减少重复工作，自动化流程" },
        { "label": "新增能力", "description": "提供之前没有的功能" },
        { "label": "改善体验", "description": "优化现有功能的使用体验" },
        { "label": "满足合规", "description": "满足安全、审计等合规要求" }
      ],
      "multiSelect": true
    },
    {
      "question": "【L1: 核心识别】这个功能的实现规模？",
      "header": "规模预期",
      "options": [
        { "label": "MVP 快速验证", "description": "先实现核心功能，快速上线" },
        { "label": "完整功能", "description": "一次性实现所有规划的功能" }
      ],
      "multiSelect": false
    },
    {
      "question": "【L1: 核心识别】预期的使用频率？",
      "header": "使用频率",
      "options": [
        { "label": "高频日常", "description": "每天多次使用" },
        { "label": "定期使用", "description": "每周或每月使用" },
        { "label": "偶尔使用", "description": "特定场景才使用" }
      ],
      "multiSelect": false
    }
  ],
  "metadata": {
    "source": "pyramidprd",
    "level": 1,
    "levelName": "L1: 核心识别",
    "progress": "1/5",
    "totalLevels": 5
  }
}
```

**L1 完成后：**
- 根据答案确定激活哪些 L2 维度（frontend, backend, ux, architecture）
- 简短总结收集的信息
- **进入代码库扫描阶段**（如果有代码库）
- 扫描完成后进入 L2

---

### Phase 2.5: 代码库感知扫描（L1→L2 之间）

**目标：** 扫描当前项目代码库，识别技术栈、架构模式、现有组件和数据模型，为 L2/L3 提供精准的上下文和选项。

**触发条件：** L1 完成后自动判断是否有代码库。

#### 判断是否有代码库

使用 Glob 工具检查当前工作目录是否有项目文件：
- 检查 `package.json`、`tsconfig.json`、`Cargo.toml`、`go.mod`、`requirements.txt`、`pom.xml` 等
- 如果没有任何项目文件 → **跳过扫描**，在 metadata 中标记 `codebaseScanned: false`，直接进入 L2
- 如果有项目文件 → **执行扫描**

#### 扫描步骤（有代码库时执行）

**步骤 1：技术栈检测**
- 使用 Read 读取 `package.json`（检查 dependencies/devDependencies）
- 识别框架（React、Next.js、Vue、Express、Django 等）
- 识别语言（TypeScript、JavaScript、Python、Go 等）
- 识别构建工具（Vite、Webpack、Turbo 等）

**步骤 2：目录结构分析**
- 使用 Glob 扫描顶层目录结构（`*`、`src/*`、`app/*`）
- 识别项目架构模式（monorepo、标准 src 结构、Next.js App Router 等）
- 记录关键目录（components、pages/app、api、lib、utils 等）

**步骤 3：现有组件/路由/API 识别**
- 使用 Glob 扫描 `src/components/**/*.{tsx,jsx,vue}` 识别现有组件
- 使用 Glob 扫描 `src/app/**/page.{tsx,jsx}` 或 `pages/**/*.{tsx,jsx}` 识别路由
- 使用 Glob 扫描 `src/app/api/**/*.{ts,js}` 或 `api/**/*.{ts,js}` 识别 API 接口
- 记录关键组件名称和路由路径

**步骤 4：数据模型分析**
- 使用 Grep 搜索 `schema.prisma`、`models.py`、数据库模型定义
- 使用 Grep 搜索类型定义文件（`types.ts`、`interfaces.ts`）
- 识别核心数据模型和关系

#### 扫描结果内化

**不要向用户输出扫描结果！** 扫描结果用于内化到后续问题中：

1. **L2 问题优化：**
   - 技术栈选项中预设当前项目的技术栈（如检测到 Next.js，则「技术栈」问题默认选中）
   - 前端组件选项中包含已有组件名称（如「复用现有 DataTable 组件」）
   - API 类型根据项目现有模式预设（如检测到 REST API 则默认选中）

2. **L3 问题优化：**
   - 数据模型问题中包含已有模型名称（如「关联现有 User 模型」）
   - 路由问题中展示现有路由结构供参考

3. **metadata 标记：**

```json
{
  "metadata": {
    "source": "pyramidprd",
    "level": 2,
    "codebaseScanned": true,
    "codebaseSummary": {
      "techStack": ["Next.js", "TypeScript", "Prisma"],
      "architecture": "Next.js App Router with src directory",
      "existingComponents": ["DataTable", "UserForm", "..."],
      "existingRoutes": ["/dashboard", "/settings", "..."],
      "existingAPIs": ["/api/users", "/api/data", "..."],
      "dataModels": ["User", "Project", "..."]
    }
  }
}
```


#### 步骤 5：生成/更新 PROJECT.md

在代码库扫描完成后，自动生成或更新项目根目录的 `PROJECT.md` 文件：

1. 如果 `PROJECT.md` 已存在，读取现有内容，保留用户手动添加的部分
2. 使用扫描结果生成/更新以下部分：

```markdown
# Project Constitution

## 技术栈
- Framework: [检测到的框架]
- Language: [检测到的语言]
- Styling: [检测到的样式方案]
- Database: [检测到的数据库]
- Package Manager: [检测到的包管理器]

## 架构概览
- [根据目录扫描结果生成]

## 核心约定
- [从 CLAUDE.md 提取关键约定]
- [从 patterns.json 中 confidence >= 0.8 的 active 条目自动合并]

## 目录结构
[自动生成的关键目录树，使用 tree 风格]
```

3. 使用 Write 工具写入 `PROJECT.md`
4. 如果 PROJECT.md 已存在，合并更新而非覆盖（保留用户自定义部分）

**注意：PROJECT.md 只在 Codebase Scan 阶段生成/更新，Agent 日常迭代不修改它。**

#### 无代码库时的降级处理

如果判断没有代码库（新项目）：
- 在 metadata 中标记 `codebaseScanned: false`
- 跳过扫描，直接进入 L2
- L2 问题使用通用选项（不包含项目特定内容）
- 在 metadata 中记录：

```json
{
  "metadata": {
    "source": "pyramidprd",
    "level": 2,
    "codebaseScanned": false,
    "codebaseSummary": null
  }
}
```

#### 扫描耗时提示

扫描前向用户发送简短提示：
> "正在分析项目代码库，以便为您提供更精准的问题..."

扫描完成后简短总结：
> "已识别项目技术栈：[Next.js + TypeScript + Prisma]，将基于现有架构生成更精准的问题。"

---

### Phase 3: L2 领域分支

**目标：** 按领域深入探索具体需求。**如果代码库扫描已完成（codebaseScanned: true），必须在问题选项中融入扫描发现的信息。**

**融合扫描结果的规则：**
- 技术栈选项中预设当前项目的技术栈作为推荐选项
- 组件选项中包含已有组件名称（如「复用现有 DataTable 组件」）
- API 类型和数据存储选项根据扫描结果预设
- 如果 `codebaseScanned: false`，使用通用选项

**维度定义：**

#### frontend（前端）
- 页面结构（单页/多页/仪表盘）
- 核心组件（表单/列表/图表）
- 响应式需求
- 交互方式

#### backend（后端）
- API 类型
- 数据模型
- 认证方式
- 存储需求

#### ux（用户体验）
- 用户旅程
- 核心流程
- 错误处理
- 反馈机制

#### architecture（技术架构）
- 技术栈
- 模块划分
- 部署方式

**根据 L1 答案选择激活的维度，为每个维度生成 2-4 个问题。**

**示例（假设激活了 frontend 和 backend）：**

```json
{
  "questions": [
    {
      "question": "【L2: 前端设计】页面结构是怎样的？",
      "header": "页面结构",
      "options": [
        { "label": "单页应用", "description": "所有功能在一个页面内" },
        { "label": "多页面", "description": "功能分布在多个独立页面" },
        { "label": "嵌入现有页面", "description": "作为现有页面的一部分" }
      ],
      "multiSelect": false
    },
    {
      "question": "【L2: 前端设计】核心组件有哪些？",
      "header": "核心组件",
      "options": [
        { "label": "表单", "description": "数据输入和提交" },
        { "label": "列表/表格", "description": "数据展示和浏览" },
        { "label": "图表", "description": "数据可视化" },
        { "label": "编辑器", "description": "富文本或代码编辑" }
      ],
      "multiSelect": true
    },
    {
      "question": "【L2: 后端架构】需要什么类型的 API？",
      "header": "API 类型",
      "options": [
        { "label": "REST API", "description": "标准的 RESTful 接口" },
        { "label": "Server Actions", "description": "Next.js Server Actions" },
        { "label": "GraphQL", "description": "GraphQL 查询接口" }
      ],
      "multiSelect": false
    },
    {
      "question": "【L2: 后端架构】数据存储方式？",
      "header": "数据存储",
      "options": [
        { "label": "新建数据表", "description": "需要创建新的数据库表" },
        { "label": "使用现有表", "description": "复用已有的数据结构" },
        { "label": "本地存储", "description": "使用 localStorage 或 sessionStorage" },
        { "label": "无需存储", "description": "数据不需要持久化" }
      ],
      "multiSelect": false
    }
  ],
  "metadata": {
    "source": "pyramidprd",
    "level": 2,
    "levelName": "L2: 领域分支",
    "progress": "2/5",
    "totalLevels": 5,
    "activeDimensions": ["frontend", "backend"],
    "codebaseScanned": true,
    "codebaseSummary": {
      "techStack": ["Next.js", "TypeScript", "Prisma"],
      "architecture": "Next.js App Router",
      "existingComponents": ["DataTable", "UserForm"],
      "existingRoutes": ["/dashboard", "/settings"],
      "existingAPIs": ["/api/users"],
      "dataModels": ["User", "Project"]
    }
  }
}
```

---

### Phase 4: L3 细节深入

**目标：** 根据 L2 答案，深入实现细节

**动态话题（根据 L2 答案激活）：**

#### 如果有表单
- 验证规则
- 错误提示方式
- 提交流程

#### 如果有列表
- 分页方式
- 排序过滤
- 空状态

#### 如果有 API
- 错误处理
- 权限控制

#### 如果有数据模型
- 模型关系
- 字段定义

**示例：**

```json
{
  "questions": [
    {
      "question": "【L3: 细节深入】表单验证如何处理？",
      "header": "表单验证",
      "options": [
        { "label": "实时验证", "description": "输入时立即验证" },
        { "label": "提交时验证", "description": "点击提交后统一验证" },
        { "label": "混合验证", "description": "关键字段实时，其他提交时验证" }
      ],
      "multiSelect": false
    },
    {
      "question": "【L3: 细节深入】列表如何分页？",
      "header": "分页方式",
      "options": [
        { "label": "传统分页", "description": "页码切换" },
        { "label": "无限滚动", "description": "滚动自动加载" },
        { "label": "加载更多按钮", "description": "手动点击加载" },
        { "label": "不需要分页", "description": "数据量小，一次加载" }
      ],
      "multiSelect": false
    }
  ],
  "metadata": {
    "source": "pyramidprd",
    "level": 3,
    "levelName": "L3: 细节深入",
    "progress": "3/5",
    "totalLevels": 5
  }
}
```

---

### Phase 5: L4 边界确认

**目标：** 确认范围边界，防止范围蔓延

**必问话题：**
1. **集成点** - 需要修改哪些现有代码？
2. **排除范围** - 哪些功能明确不做？
3. **非功能需求** - 性能/安全要求？
4. **MVP 边界** - 哪些可以推迟？

**示例：**

```json
{
  "questions": [
    {
      "question": "【L4: 边界确认】哪些功能明确不在本次范围内？",
      "header": "排除范围",
      "options": [
        { "label": "多语言支持", "description": "暂不支持国际化" },
        { "label": "离线模式", "description": "暂不支持离线使用" },
        { "label": "数据导出", "description": "暂不支持导出功能" },
        { "label": "高级权限", "description": "暂不支持复杂权限控制" }
      ],
      "multiSelect": true
    },
    {
      "question": "【L4: 边界确认】有特殊的非功能需求吗？",
      "header": "非功能需求",
      "options": [
        { "label": "高性能要求", "description": "需要优化加载速度或处理大数据" },
        { "label": "安全要求", "description": "有特殊的安全或合规要求" },
        { "label": "可访问性", "description": "需要支持无障碍访问" },
        { "label": "无特殊要求", "description": "按标准实现即可" }
      ],
      "multiSelect": true
    }
  ],
  "metadata": {
    "source": "pyramidprd",
    "level": 4,
    "levelName": "L4: 边界确认",
    "progress": "4/5",
    "totalLevels": 5
  }
}
```

---

### Phase 6: L5 确认门控

**目标：** L4 完成后，在生成 PRD 前，向用户展示结构化确认摘要，确保需求理解一致。

**触发条件：** L4 所有问题回答完毕后自动进入。

#### 确认摘要内容

根据 L1-L4 收集的所有答案，生成结构化确认摘要，通过 AskUserQuestion 展示给用户：

**摘要包含以下分区：**

1. **需求摘要** - 一段话总结用户的需求
2. **功能范围** - 列出将要实现的功能点（从 L1-L4 答案中提炼）
3. **技术方案** - 技术栈、架构选型概要（如果有代码库扫描结果则融入）
4. **风险评估** - 识别主要风险（HIGH/MEDIUM/LOW）
5. **复杂度估计** - 基于收集信息给出实现复杂度评估
6. **安全检查预告** - 如果需求涉及安全敏感关键词，预告将自动注入的安全项数量

#### AskUserQuestion 调用格式

```json
{
  "questions": [
    {
      "question": "【L5: 确认门控】请确认以下需求摘要是否准确：\n\n📋 需求摘要：[基于 L1-L4 答案的一段话总结]\n\n🎯 功能范围：\n- [功能点 1]\n- [功能点 2]\n- [功能点 3]\n\n🔧 技术方案：[技术栈 + 架构概要]\n\n⚠️ 风险评估：\n- HIGH: [高风险项]\n- MEDIUM: [中风险项]\n- LOW: [低风险项]\n\n📊 复杂度估计：[简单/中等/复杂]\n\n🔒 安全检查：[如果有安全关键词匹配] 将为 DT-XXX 等任务自动注入 N 项安全验收标准，你可以在确认前要求移除不适用的项。\n\n以上信息是否准确？",
      "header": "确认摘要",
      "options": [
        { "label": "确认并生成 PRD", "description": "信息准确，请直接生成 PRD 文档" },
        { "label": "需要修改", "description": "部分信息不准确，需要调整后再生成" }
      ],
      "multiSelect": false
    }
  ],
  "metadata": {
    "source": "pyramidprd",
    "phase": "confirmation",
    "level": 5,
    "levelName": "L5: 确认门控",
    "progress": "5/5",
    "totalLevels": 5,
    "codebaseScanned": true,
    "confirmationSummary": {
      "requirementSummary": "[需求摘要文本]",
      "featureScope": ["功能点1", "功能点2", "功能点3"],
      "techApproach": "[技术方案概要]",
      "risks": {
        "high": ["高风险项"],
        "medium": ["中风险项"],
        "low": ["低风险项"]
      },
      "complexityEstimate": "medium"
    }
  }
}
```

#### 用户选择处理

**选择「确认并生成 PRD」：**
- 直接进入 Phase 7 生成 PRD 文档
- 在 metadata 中标记 `confirmationResult: 'confirmed'`

**选择「需要修改」：**
- 使用 AskUserQuestion 询问用户需要修改哪些部分：

```json
{
  "questions": [
    {
      "question": "请选择需要修改的部分，或直接输入修改意见：",
      "header": "修改范围",
      "options": [
        { "label": "修改功能范围", "description": "增减功能点或调整优先级" },
        { "label": "修改技术方案", "description": "调整技术选型或架构设计" },
        { "label": "修改风险评估", "description": "补充或调整风险项" },
        { "label": "移除安全检查项", "description": "移除自动注入的不适用安全项" },
        { "label": "返回重新提问", "description": "回到之前的层级重新回答问题" }
      ],
      "multiSelect": true
    }
  ],
  "metadata": {
    "source": "pyramidprd",
    "phase": "confirmation",
    "level": 5,
    "confirmationResult": "revision_requested"
  }
}
```

- 如果选择「返回重新提问」，回到对应层级重新提问（保留已有答案作为默认值）
- 如果选择「移除安全检查项」，让用户指定要移除哪些 `[安全]` 前缀的项，更新后重新展示确认摘要
- 如果选择其他修改项，根据用户输入更新对应内容后，重新展示确认摘要

---

### Phase 7: 生成 PRD

**L5 确认门控通过后，根据收集的所有信息生成 PRD 文档。**

**PRD 格式：**

```markdown
# PRD: [功能名称]

## Introduction

[简要描述功能和解决的问题]

## Goals

- [具体可衡量的目标 1]
- [具体可衡量的目标 2]

## Dev Tasks

### DT-001: [任务标题]
**Description:** [任务描述]

**Acceptance Criteria:**
- [ ] 具体可验证的标准
- [ ] Typecheck passes
- [ ] [UI 任务] Verify in browser

### DT-002: [任务标题]
...

## Functional Requirements

- FR-1: 系统必须...
- FR-2: 当用户点击 X 时，系统必须...

## Risks & Mitigations

基于 L1-L4 收集的信息和 L5 确认门控中的风险评估，生成风险清单。

### HIGH
- **[风险标题]**: [风险描述] → **缓解措施**: [具体的缓解方案]

### MEDIUM
- **[风险标题]**: [风险描述] → **缓解措施**: [具体的缓解方案]

### LOW
- **[风险标题]**: [风险描述] → **缓解措施**: [具体的缓解方案]

**风险识别指导（Claude 根据答案自动生成）：**
- L1 规模预期为「完整功能」→ HIGH: 范围蔓延风险
- L2 涉及新数据模型 → MEDIUM: 数据迁移风险
- L2 有认证需求 → MEDIUM: 安全漏洞风险
- L3 有复杂表单验证 → LOW: 边界情况遗漏
- L4 有高性能要求 → MEDIUM: 性能瓶颈风险
- 代码库扫描发现现有代码复杂 → HIGH: 集成冲突风险

## Testing Strategy

基于 L1-L4 收集的功能需求和技术方案，生成测试策略。

### Unit Tests（单元测试）
- [针对核心业务逻辑的测试，如验证函数、数据转换、状态管理]
- [针对工具函数和辅助方法的测试]

### Integration Tests（集成测试）
- [API 接口测试：请求/响应格式、错误处理、权限控制]
- [数据层测试：数据库操作、数据模型关系]
- [组件集成测试：组件间交互、状态传递]

### E2E Tests（端到端测试）
- [核心用户流程测试：从入口到完成的完整操作]
- [边界场景测试：错误状态、空状态、极端数据]

**测试策略生成指导（Claude 根据答案自动生成）：**
- L2 有表单 → Unit: 表单验证逻辑；E2E: 表单提交流程
- L2 有 API → Integration: API 接口测试；Unit: 请求/响应处理
- L2 有列表 → Unit: 排序/过滤逻辑；E2E: 列表操作流程
- L3 有权限控制 → Integration: 权限验证；E2E: 不同角色访问
- L4 有非功能需求 → Integration: 性能基准测试

## Non-Goals (Out of Scope)

- [明确不包含的功能，从 L4 答案提取]

## Technical Considerations

- [技术约束和依赖]

## Success Metrics

- [如何衡量成功]
```

**Dev Task 规则：**
- 每个任务要小而具体，能在一次迭代中完成
- 验收标准必须可验证
- 每个任务都要包含 "Typecheck passes"
- UI 任务要包含 "Verify in browser"

---

### Phase 7.5: 安全检查自动注入

**在 Phase 7 生成所有 Dev Tasks 后、将 PRD 写入文件之前，执行以下安全扫描和自动注入。**

#### 扫描逻辑

逐个扫描每个 DT 的 title 和 description 文本，如果匹配以下关键词（不区分大小写），自动在该 DT 的 Acceptance Criteria 末尾（在 "Typecheck passes" 之前）追加对应的安全检查项：

| 触发关键词 | 自动追加的 Acceptance Criteria |
|------------|-------------------------------|
| 登录/认证/auth/密码/password/login | `- [ ] [安全] 密码使用 bcrypt/argon2 加密`<br>`- [ ] [安全] 使用 httpOnly cookies`<br>`- [ ] [安全] 登录接口设置速率限制` |
| 支付/payment/金额/price/checkout | `- [ ] [安全] 金额使用整数（分）存储避免浮点误差`<br>`- [ ] [安全] 支付接口验证签名`<br>`- [ ] [安全] CSRF 保护` |
| 用户输入/表单/form/input | `- [ ] [安全] 输入使用 schema 验证（如 zod）`<br>`- [ ] [安全] XSS 防护`<br>`- [ ] [安全] 字符串长度限制` |
| API/接口/endpoint/路由 | `- [ ] [安全] 使用参数化查询防止 SQL 注入`<br>`- [ ] [安全] 错误响应不泄露内部信息`<br>`- [ ] [安全] 添加权限检查` |
| 文件上传/upload/file | `- [ ] [安全] 文件类型白名单校验`<br>`- [ ] [安全] 文件大小限制`<br>`- [ ] [安全] 存储路径不可由用户控制` |
| 数据库/database/SQL/migration | `- [ ] [安全] 使用参数化查询`<br>`- [ ] [安全] 敏感字段加密存储`<br>`- [ ] [安全] 迁移脚本使用 IF NOT EXISTS` |

#### 注入规则

1. **`[安全]` 前缀**：所有注入的安全项必须以 `[安全]` 前缀标记，便于后续识别和统计（DT-008 评审面板依赖此前缀）
2. **多类别匹配**：一个 DT 可以匹配多个关键词类别，所有匹配类别的安全项都追加（去重，同一条安全项不重复追加）
3. **无匹配不注入**：不涉及安全关键词的 DT 不添加任何安全项
4. **Quick Fix 模式**：仅对高风险关键词注入 -- 即只有匹配「登录/认证/auth/密码/password/login」或「支付/payment/金额/price/checkout」时才注入，其余关键词在 Quick Fix 模式下忽略
5. **Feature Build / Full Planning 模式**：所有六类关键词均触发注入

#### 与 L5 确认门控的配合

在 L5 确认门控阶段展示的确认摘要中，如果有安全项被注入，需要在摘要中增加一行提示，例如：

> 🔒 安全检查：已为 DT-001、DT-003 自动注入安全验收标准（共 6 项）。你可以在确认前移除不适用的项。

用户选择「确认并生成 PRD」时，保留所有安全项；用户选择「需要修改」时，可以选择「移除安全检查项」来要求移除特定的安全项。

#### 示例

假设有一个 DT 的 title 是「用户登录表单」，description 中包含「实现登录认证接口和表单提交」，则匹配：
- 「登录/认证/auth」→ 注入 3 项认证安全
- 「表单/form」→ 注入 3 项输入安全
- 「接口」→ 注入 3 项 API 安全

去重后（如果「使用参数化查询」同时出现在 API 和数据库类别中，只保留一条），最终该 DT 的 Acceptance Criteria 会追加约 8-9 条 `[安全]` 前缀的检查项。

---

## 关键原则

1. **立即开始提问** - 收到需求后直接开始 L1，不做冗长分析
2. **使用 AskUserQuestion** - 所有问题都通过工具提问
3. **包含 metadata** - 每次提问必须带 level 信息
4. **层级递进** - 严格按 L1→L2→L3→L4→L5（确认）顺序
5. **动态调整** - 根据答案调整后续问题
6. **简洁反馈** - 每层完成后简短总结，立即进入下一层

---

## 与 botoolagent-generateprd 的区别

| 维度 | generateprd | pyramidprd |
|------|-------------|------------|
| 问答结构 | 自由对话 | 固定 5 层（含确认门控） |
| 问题数量 | 灵活 | 根据复杂度动态调整（3-12 个/层） |
| 复杂度感知 | 无 | 自动评估，简单需求快速完成 |
| 确认门控 | 无 | L5 确认摘要，可返回修改 |
| 进度可视化 | 无 | metadata 中的 level |
| 适用场景 | CLI 对话 | Viewer Stage 1 |

---

## 完成后

生成 PRD 后，告诉用户：

"PRD 已生成。下一步：
1. 查看并确认 PRD 内容
2. 使用 `/botoolagent-prd2json` 转换为 JSON
3. 运行 `/botoolagent-coding` 开始自动开发"
