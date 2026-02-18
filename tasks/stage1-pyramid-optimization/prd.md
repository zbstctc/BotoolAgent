# PRD: BotoolAgent Viewer Stage 1/2 优化 - 金字塔问答与规范管理

## Introduction

本 PRD 描述对 BotoolAgent Viewer 的重大升级，将现有的线性聊天式 PRD 生成流程改造为**金字塔式多轮问答系统**，并新增**规范管理**功能和 **Stage 2 四步流水线**。

核心目标是让非技术用户能够通过结构化、可视化的问答流程，逐层深入地描述需求，最终生成高质量、可执行的 PRD 文档。

### 背景

当前 Stage 1 采用线性聊天模式，存在以下问题：
- 问题是预定义的固定分组，不够灵活
- 无法根据用户回答动态调整后续问题
- 缺少多轮迭代打磨机制
- 用户无法直观看到整体进度和结构

### 目标用户

- **业务人员**：需要自动化工作流但没有编程经验
- **领域专家**：了解业务需求，希望将想法快速转化为工具
- **非软件工程师**：有技术背景但不熟悉现代软件开发

---

## Goals

1. **提升需求收集深度**：通过 4 层金字塔结构（核心识别→领域分支→细节深入→边界确认）确保需求完整性
2. **支持多轮迭代**：用户可以反复打磨 PRD，每轮只问增量问题
3. **可视化设计确认**：生成页面布局图让用户直观确认前端设计
4. **规范自动应用**：规范文档自动转为 Skill，在开发过程中自动注入
5. **进度可恢复**：所有进度实时保存，支持断点续传

---

## Dev Tasks

### 模块一：Dashboard 创建弹窗改造

#### DT-001: 改造创建需求弹窗 - 需求描述输入
**Description:** 将现有的标题输入改为需求描述输入，支持多行文本

**Acceptance Criteria:**
- [ ] 修改 Dashboard 的创建弹窗组件
- [ ] 将单行标题输入改为多行文本框（textarea）
- [ ] placeholder: "请描述你想要构建的功能或解决的问题..."
- [ ] 支持至少 500 字符输入
- [ ] 移除原有的标题输入框
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-002: 添加需求类型选择器
**Description:** 在创建弹窗中添加需求类型标签选择

**Acceptance Criteria:**
- [ ] 在描述输入框上方添加需求类型选择器
- [ ] 预设选项：新功能、改功能、修bug（使用标签/chip 样式）
- [ ] 添加"其他"选项，选中后显示自定义输入框
- [ ] 默认选中"新功能"
- [ ] 选中状态使用蓝色高亮
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-003: 实现自动生成标题功能
**Description:** 调用 AI 根据需求描述自动生成标题

**Acceptance Criteria:**
- [ ] 用户输入描述后，显示"生成标题"按钮或自动触发
- [ ] 调用 /api/cli/chat 生成简短标题（10-20字）
- [ ] 生成的标题显示在可编辑的输入框中
- [ ] 显示加载状态
- [ ] 用户可以修改生成的标题
- [ ] 点击"创建"后保存标题、描述、类型到项目状态
- [ ] 创建后携带这些信息跳转到 Stage 1
- [ ] Typecheck passes
- [ ] Verify in browser

---

### 模块二：Stage 1 金字塔问答

#### DT-004: 创建金字塔导航组件 PyramidNavigation
**Description:** 创建左侧金字塔导航面板组件

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/pyramid/PyramidNavigation.tsx
- [ ] Props: currentLevel, levels, collectedSummary, onLevelClick
- [ ] 显示 4 个层级：L1 核心识别、L2 领域分支、L3 细节深入、L4 边界确认
- [ ] 当前层级显示 ▶ 图标和高亮背景
- [ ] 已完成层级显示 ✓ 和收集的信息摘要（缩进显示 key: value）
- [ ] 未解锁层级显示 ○ 灰色文字
- [ ] 每个层级显示维度进度条（如 "前端 ██░░ 2/5"）
- [ ] 底部显示"已收集信息摘要"区域
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-005: 创建维度卡片组件 DimensionCard
**Description:** 创建单个维度的问题卡片组件

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/pyramid/DimensionCard.tsx
- [ ] Props: dimension, questions, answers, isLocked, onAnswer
- [ ] 卡片标题显示维度名称和进度（如 "前端设计 (3/5)"）
- [ ] 锁定状态显示 "(待解锁)" 并灰显
- [ ] 展开状态显示所有问题
- [ ] 可折叠/展开
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-006: 创建问题项组件 QuestionItem
**Description:** 创建单个问题的渲染组件，支持多种输入类型

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/pyramid/QuestionItem.tsx
- [ ] Props: question, answer, isAnswered, onAnswer
- [ ] 支持单选（radio）、多选（checkbox）、文本输入三种类型
- [ ] 已回答状态：收缩为一行，显示 ✓ 和答案摘要，可点击展开修改
- [ ] 未回答状态：展开显示完整问题和选项
- [ ] 当前回答中状态：显示 ▶ 图标
- [ ] 选项使用白色背景卡片样式
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-007: 创建层级问题面板 LevelPanel
**Description:** 创建右侧当前层级的问题面板

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/pyramid/LevelPanel.tsx
- [ ] Props: level, dimensions, questions, answers, onAnswer, onComplete
- [ ] 顶部显示层级标题（如 "Level 2: 领域分支"）
- [ ] 按维度分组显示 DimensionCard
- [ ] 底部显示"完成当前层级 →"按钮
- [ ] 按钮在所有必填问题回答后才可点击
- [ ] 点击后触发 onComplete 回调
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-008: 创建维度框架配置
**Description:** 定义金字塔各层级的维度和话题框架

**Acceptance Criteria:**
- [ ] 创建 viewer/src/lib/dimension-framework.ts
- [ ] 定义 L1 层级：4-6 个核心问题话题（问题域、目标用户、核心价值、紧急度）
- [ ] 定义 L2 层级：4 个维度（frontend, backend, ux, architecture）及其触发词和话题
- [ ] 定义 L3 层级：动态话题（form, list, api, data 等）
- [ ] 定义 L4 层级：边界确认话题
- [ ] 定义问题数量约束（min, max）
- [ ] 导出 TypeScript 类型定义
- [ ] Typecheck passes

#### DT-009: 创建问题生成 API
**Description:** 创建 API 端点，调用 Claude 动态生成问题

**Acceptance Criteria:**
- [ ] 创建 viewer/src/app/api/pyramid/questions/route.ts
- [ ] POST 接口，接收：level, collectedAnswers, activeDimensions, requirementType, initialDescription
- [ ] 构造 prompt 包含维度框架、已收集信息、数量约束
- [ ] 调用 Claude API 生成具体问题和选项
- [ ] 返回格式：{ questions: Question[], suggestedDimensions?: string[] }
- [ ] 支持流式响应
- [ ] Typecheck passes

#### DT-010: 创建金字塔进度存储
**Description:** 扩展 session storage 支持金字塔进度保存

**Acceptance Criteria:**
- [ ] 创建 viewer/src/lib/pyramid-session-storage.ts
- [ ] 存储结构：{ currentLevel, answers, generatedQuestions, activeDimensions, prdDraft, versions }
- [ ] localStorage key: botool-pyramid-session-{projectId}
- [ ] 提供 savePyramidProgress, loadPyramidProgress, clearPyramidProgress 方法
- [ ] 每个问题回答后自动保存（debounce 500ms）
- [ ] 页面加载时自动恢复
- [ ] Typecheck passes

#### DT-011: 重写 Stage 1 页面为金字塔界面
**Description:** 完全重写 Stage 1 页面，使用金字塔组件

**Acceptance Criteria:**
- [ ] 重写 viewer/src/app/stage1/page.tsx
- [ ] 保留顶部 5 阶段进度条（StageIndicator）
- [ ] 三栏布局：左侧 PyramidNavigation、中间 LevelPanel、右侧 PRD 预览
- [ ] 从 Dashboard 获取初始描述和需求类型
- [ ] 进入时自动生成 L1 问题
- [ ] 完成每层后生成下一层问题
- [ ] 实时更新 PRD 预览
- [ ] 显示"自动保存中 ✓"状态
- [ ] L4 完成后进入设计确认页面
- [ ] Typecheck passes
- [ ] Verify in browser

---

### 模块三：设计确认与版本迭代

#### DT-012: 创建可视化布局图组件 LayoutPreview
**Description:** 创建 React 组件渲染页面布局预览图

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/design-confirm/LayoutPreview.tsx
- [ ] Props: layoutData (结构化布局描述)
- [ ] 渲染页面主要区域（Header, Sidebar, Main, Footer）
- [ ] 渲染关键组件占位（按钮、表单、列表等）
- [ ] 使用灰色边框和标签标注各区域
- [ ] 底部显示组件列表
- [ ] 支持点击组件高亮显示
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-013: 创建布局图生成 API
**Description:** 创建 API 端点，根据 PRD 生成布局描述

**Acceptance Criteria:**
- [ ] 创建 viewer/src/app/api/pyramid/layout/route.ts
- [ ] POST 接口，接收：prdContent, collectedAnswers
- [ ] 调用 Claude 生成结构化布局 JSON
- [ ] 返回格式：{ layout: LayoutData, components: ComponentInfo[] }
- [ ] Typecheck passes

#### DT-014: 创建版本历史组件 VersionHistory
**Description:** 创建版本历史显示组件

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/design-confirm/VersionHistory.tsx
- [ ] Props: versions, currentVersion, onVersionClick
- [ ] 水平显示版本链（v1 → v2 → v3...）
- [ ] 每个版本显示简短描述
- [ ] 当前版本高亮显示
- [ ] 点击历史版本可查看（只读）
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-015: 创建设计确认页面 DesignConfirmPage
**Description:** 创建 L4 完成后的设计确认页面

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/design-confirm/DesignConfirmPage.tsx
- [ ] 顶部显示 VersionHistory
- [ ] 中间显示 LayoutPreview
- [ ] 下方显示完整 PRD 预览（可折叠）
- [ ] 底部显示"继续修改"区域：多行文本框 + 提交按钮
- [ ] 底部显示"确认并进入 Stage 2"按钮
- [ ] 集成到 Stage 1 页面，L4 完成后显示
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-016: 实现版本迭代逻辑
**Description:** 实现提交修改后的增量金字塔流程

**Acceptance Criteria:**
- [ ] 用户提交修改需求后创建新版本（v2, v3...）
- [ ] 调用 API 分析修改需求，判断哪些层级需要重新提问
- [ ] 返回增量问题（数量减少）
- [ ] 无变化的层级显示"━"跳过标记
- [ ] 底部显示上一版本已确认内容摘要
- [ ] 完成后合并生成新版本 PRD
- [ ] 版本历史更新
- [ ] Typecheck passes
- [ ] Verify in browser

---

### 模块四：规范管理

#### DT-017: 创建规范管理页面路由
**Description:** 在 Dashboard 添加规范管理 Tab 和页面

**Acceptance Criteria:**
- [ ] 修改 Dashboard 页面，顶部添加 Tab 切换
- [ ] Tab 选项：[项目列表] [规范管理]
- [ ] 点击"规范管理"切换到规范管理视图
- [ ] Tab 切换使用状态控制，无页面刷新
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-018: 创建规范分类树组件 CategoryTree
**Description:** 创建左侧规范分类树组件

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/rules/CategoryTree.tsx
- [ ] 显示 6 个分类：前端规范、后端规范、测试规范、部署规范、应用规范、其他规范
- [ ] 每个分类可展开显示其下的规范文档列表
- [ ] 显示每个分类的规范数量
- [ ] 支持选中某个规范文档
- [ ] 底部显示"+ 新建规范"按钮
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-019: 创建 Markdown 编辑器组件
**Description:** 创建规范文档的 Markdown 编辑器

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/rules/MarkdownEditor.tsx
- [ ] 左右分栏：左侧编辑、右侧预览
- [ ] 支持常用 Markdown 语法高亮
- [ ] 工具栏：加粗、斜体、代码、链接、列表
- [ ] 保存按钮
- [ ] 显示保存状态
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-020: 创建规范文件存储 API
**Description:** 创建规范文档的读写 API

**Acceptance Criteria:**
- [ ] 创建 viewer/src/app/api/rules/route.ts
- [ ] GET: 获取所有规范列表（按分类）
- [ ] POST: 保存规范文档到 rules/{category}/{name}.md
- [ ] DELETE: 删除规范文档
- [ ] 确保 rules/ 目录存在
- [ ] Typecheck passes

#### DT-021: 创建规范管理主组件 RulesManager
**Description:** 组装规范管理的完整界面

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/rules/RulesManager.tsx
- [ ] 左侧显示 CategoryTree
- [ ] 右侧显示 MarkdownEditor
- [ ] 选中规范时加载内容到编辑器
- [ ] 新建规范时显示空编辑器 + 名称输入
- [ ] 保存时调用 API 写入文件
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-022: 实现规范转 Skill 功能
**Description:** 将规范文档自动转换为 Skill 文件

**Acceptance Criteria:**
- [ ] 创建 viewer/src/lib/rules-to-skill.ts
- [ ] 规范保存时自动生成对应 Skill 文件
- [ ] Skill 目录：~/.claude/skills/botool-rules/
- [ ] Skill 文件命名：{category}-{name}.md
- [ ] Skill 格式符合 Claude Code Skill 规范
- [ ] 提供"预览 Skill"功能
- [ ] Typecheck passes

---

### 模块五：Stage 2 四步流水线

#### DT-023: 创建流水线进度条组件 PipelineProgress
**Description:** 创建 Stage 2 的四步流水线进度条

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/pipeline/PipelineProgress.tsx
- [ ] Props: currentStep, steps, onStepClick
- [ ] 显示四个步骤：v6 规范检查 → v7 代码示例 → v9 测试用例 → JSON 转换
- [ ] 当前步骤高亮，已完成步骤显示 ✓
- [ ] 点击已完成步骤可回看（只读）
- [ ] 使用连接线连接各步骤
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-024: 创建规范检查步骤组件 RuleCheckStep
**Description:** 创建 v6 规范检查步骤的界面

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/pipeline/RuleCheckStep.tsx
- [ ] 加载所有相关规范文档
- [ ] 显示检查进度
- [ ] 列出不符合项，每项显示：问题描述、建议修改
- [ ] 每项提供 [采纳] [修改] [跳过] 按钮
- [ ] 采纳后显示 ✓
- [ ] 所有项处理完毕后显示"继续下一步"按钮
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-025: 创建代码示例步骤组件 CodeExampleStep
**Description:** 创建 v7 代码示例补全步骤的界面

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/pipeline/CodeExampleStep.tsx
- [ ] 遍历 PRD 中的每个开发任务
- [ ] 为涉及数据结构的任务生成 TypeScript interface
- [ ] 代码使用语法高亮显示
- [ ] 每个示例提供 [采纳] [修改] [跳过] 按钮
- [ ] 修改时打开代码编辑器
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-026: 创建测试用例步骤组件 TestCaseStep
**Description:** 创建 v9 测试用例生成步骤的界面

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/pipeline/TestCaseStep.tsx
- [ ] 遍历 PRD 中的每个开发任务
- [ ] 生成单元测试用例描述（测什么、预期结果）
- [ ] 生成 E2E 测试场景描述
- [ ] 每个用例提供 [采纳] [修改] [跳过] 按钮
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-027: 创建 JSON 转换步骤组件 JsonConvertStep
**Description:** 创建最终 JSON 转换步骤的界面

**Acceptance Criteria:**
- [ ] 创建 viewer/src/components/pipeline/JsonConvertStep.tsx
- [ ] 解析最终 PRD 生成 prd.json 结构
- [ ] 在 JSON 编辑器中显示
- [ ] 用户可以编辑任务详情
- [ ] 保存按钮写入 prd.json 文件
- [ ] 显示"开始开发"按钮进入 Stage 3
- [ ] Typecheck passes
- [ ] Verify in browser

#### DT-028: 重写 Stage 2 页面为流水线界面
**Description:** 重写 Stage 2 页面，集成流水线组件

**Acceptance Criteria:**
- [ ] 重写 viewer/src/app/stage2/page.tsx
- [ ] 保留顶部 5 阶段进度条
- [ ] 顶部显示 PipelineProgress
- [ ] 根据当前步骤显示对应组件
- [ ] 步骤间数据传递（PRD 内容累积更新）
- [ ] 最终步骤完成后可进入 Stage 3
- [ ] Typecheck passes
- [ ] Verify in browser

---

## Functional Requirements

### 数据存储

- FR-1: 金字塔问答进度存储在 localStorage，key 为 `botool-pyramid-session-{projectId}`
- FR-2: 规范文档存储在 `rules/` 目录下，按分类子目录组织
- FR-3: 生成的 Skill 存储在 `~/.claude/skills/botool-rules/` 目录
- FR-4: PRD 版本历史存储在项目元数据中

### 界面布局

- FR-5: Stage 1/2 顶部保留现有的 5 阶段进度条
- FR-6: Stage 1 金字塔界面采用三栏布局：左侧金字塔导航、中间问题面板、右侧 PRD 预览
- FR-7: Stage 2 流水线界面采用上下布局：顶部进度条、中间内容区
- FR-8: 规范管理采用左右布局：左侧分类树、右侧编辑器

### AI 集成

- FR-9: 问题生成调用 Claude API，传入维度框架、已收集信息、数量约束
- FR-10: 布局图生成调用 Claude API，返回结构化的布局描述 JSON
- FR-11: 规范检查调用 Claude API，传入 PRD 和规范文档内容
- FR-12: 代码示例和测试用例生成调用 Claude API

### 版本迭代

- FR-13: 每次迭代创建新版本号（v1, v2, v3...）
- FR-14: PRD 文档包含变更记录章节
- FR-15: 增量金字塔只问与修改相关的问题
- FR-16: 历史版本可查看但不可编辑

---

## Non-Goals (Out of Scope)

1. **语音输入**：虽然设计中预留了位置，但当前版本不实现语音转文字功能
2. **协作编辑**：不支持多用户同时编辑同一个 PRD
3. **规范版本控制**：规范文档不支持版本历史
4. **AI 模型切换**：不支持用户选择不同的 AI 模型（如 v4 换模型审查）
5. **导出功能**：不支持将 PRD 导出为 PDF 或其他格式
6. **模板市场**：不支持用户分享/下载规范模板

---

## Technical Considerations

### Skill 架构

金字塔模式使用独立的 Skill：`botoolagent-pyramidprd`

```
~/.claude/skills/
├── botoolagent-generateprd/     # CLI 模式 + Viewer 聊天模式（旧）
│   └── SKILL.md
└── botoolagent-pyramidprd/      # Viewer 金字塔模式（新）
    └── SKILL.md                 # 包含维度框架、Prompt 模板、生成规则
```

**Skill 内容：**
- 维度框架定义（L1-L4 的话题、问题数量约束）
- 问题生成 Prompt 模板（L1/L2/L3/L4_QUESTION_PROMPT）
- PRD 生成 Prompt（PRD_GENERATION_PROMPT）
- 布局图生成 Prompt（LAYOUT_GENERATION_PROMPT）
- 版本迭代分析 Prompt（ITERATION_ANALYSIS_PROMPT）

**API 如何使用 Skill：**
1. API 读取 `~/.claude/skills/botoolagent-pyramidprd/SKILL.md`
2. 解析出对应层级的 Prompt 模板
3. 填充变量（用户输入、已收集答案、维度配置）
4. 调用 Claude API
5. 返回结构化 JSON

### 现有代码集成

- Stage 1 金字塔界面将**完全替代**现有的聊天界面（`viewer/src/app/stage1/page.tsx`）
- **不再使用** `useCliChat` hook（改为直接调用 pyramid API）
- 复用现有的 `prd-session-storage.ts` 进行进度存储，需扩展数据结构
- 复用现有的 `ProjectContext` 进行项目状态管理

### 新增文件结构

```
viewer/src/
├── components/
│   ├── pyramid/
│   │   ├── PyramidNavigation.tsx      # 金字塔导航
│   │   ├── LevelPanel.tsx             # 层级问题面板
│   │   ├── DimensionCard.tsx          # 维度卡片
│   │   ├── QuestionItem.tsx           # 问题项
│   │   └── index.ts
│   ├── design-confirm/
│   │   ├── DesignConfirmPage.tsx      # 设计确认页面
│   │   ├── LayoutPreview.tsx          # 可视化布局图
│   │   ├── VersionHistory.tsx         # 版本历史
│   │   └── index.ts
│   ├── rules/
│   │   ├── RulesManager.tsx           # 规范管理主页
│   │   ├── CategoryTree.tsx           # 分类树
│   │   ├── MarkdownEditor.tsx         # MD编辑器
│   │   └── index.ts
│   └── pipeline/
│       ├── PipelineProgress.tsx       # 流水线进度条
│       ├── RuleCheckStep.tsx          # v6 规范检查
│       ├── CodeExampleStep.tsx        # v7 代码示例
│       ├── TestCaseStep.tsx           # v9 测试用例
│       ├── JsonConvertStep.tsx        # JSON 转换
│       └── index.ts
├── lib/
│   ├── dimension-framework.ts         # 维度框架定义（从 Skill 解析或硬编码）
│   ├── pyramid-prompts.ts             # Prompt 模板（从 Skill 读取）
│   ├── pyramid-session-storage.ts     # 金字塔进度存储
│   ├── skill-parser.ts                # Skill 文件解析工具
│   └── rules-to-skill.ts              # 规范转 Skill
└── app/
    ├── api/
    │   ├── pyramid/
    │   │   ├── questions/route.ts     # 问题生成
    │   │   └── layout/route.ts        # 布局图生成
    │   └── rules/
    │       └── route.ts               # 规范 CRUD
    ├── stage1/
    │   └── page.tsx                   # 重写为金字塔界面
    └── stage2/
        └── page.tsx                   # 改为流水线界面
```

### API 端点

| 端点 | 方法 | 说明 | 使用的 Prompt |
|------|------|------|--------------|
| /api/pyramid/questions | POST | 生成金字塔问题 | L1/L2/L3/L4_QUESTION_PROMPT |
| /api/pyramid/layout | POST | 生成布局图 | LAYOUT_GENERATION_PROMPT |
| /api/pyramid/prd | POST | 生成 PRD 文档 | PRD_GENERATION_PROMPT |
| /api/pyramid/iterate | POST | 分析迭代影响 | ITERATION_ANALYSIS_PROMPT |
| /api/rules | GET | 获取规范列表 | - |
| /api/rules | POST | 保存规范文档 | - |
| /api/rules | DELETE | 删除规范文档 | - |

### 性能考虑

- 问题生成采用流式响应，避免长时间等待
- 布局图渲染使用 React.memo 优化
- 进度保存使用 debounce，避免频繁写入

---

## Success Metrics

1. **需求完整度**：通过金字塔问答生成的 PRD 比聊天模式平均多收集 50% 的需求细节
2. **用户迭代次数**：平均每个 PRD 经历 2-3 轮迭代打磨
3. **Stage 3 成功率**：使用新流程生成的 PRD，Stage 3 自动开发成功率提升 30%
4. **用户满意度**：设计确认阶段用户首次确认率 > 60%

---

## Open Questions

1. **布局图组件库**：可视化布局图使用什么 React 组件库实现？考虑 react-flow 或自定义 div/CSS
2. **Skill 解析方式**：API 是否需要实时读取 Skill 文件，还是构建时提取？
3. ~~增量问题算法~~：已在 `botoolagent-pyramidprd` Skill 中定义 `ITERATION_ANALYSIS_PROMPT`
4. **文本框字数限制**：Dashboard 创建弹窗的需求描述最大字数是多少？建议 2000 字符

---

## Implementation Priority

### Phase 1: Stage 1 金字塔（核心功能）
- DT-001 ~ DT-003: Dashboard 创建弹窗改造
- DT-004 ~ DT-011: 金字塔问答核心功能
- DT-012 ~ DT-016: 设计确认与版本迭代

### Phase 2: 规范管理
- DT-017 ~ DT-022: 规范管理完整功能

### Phase 3: Stage 2 流水线
- DT-023 ~ DT-028: 四步流水线

---

## Appendix: 维度框架定义

```typescript
// viewer/src/lib/dimension-framework.ts

export interface DimensionFramework {
  L1: LevelConfig;
  L2: LevelWithDimensions;
  L3: LevelWithDynamicTopics;
  L4: LevelConfig;
}

export const DIMENSION_FRAMEWORK: DimensionFramework = {
  L1: {
    name: '核心识别',
    questionCount: { min: 4, max: 6 },
    topics: ['问题域', '目标用户', '核心价值', '紧急度/规模']
  },
  L2: {
    name: '领域分支',
    questionCount: { min: 8, max: 12 },
    dimensions: {
      frontend: {
        name: '前端设计',
        triggers: ['前端', '界面', 'UI', '页面', '组件'],
        topics: ['页面结构', '组件类型', '设计风格', '响应式', '交互', '状态管理']
      },
      backend: {
        name: '后端架构',
        triggers: ['后端', 'API', '服务', '数据', '接口'],
        topics: ['API 类型', '数据模型', '认证', '存储', '集成', '缓存']
      },
      ux: {
        name: 'UX 流程',
        triggers: ['用户', '流程', '体验', '操作'],
        topics: ['用户旅程', '核心流程', '边缘场景', '反馈机制']
      },
      architecture: {
        name: '技术架构',
        triggers: ['架构', '部署', '扩展', '技术栈'],
        topics: ['技术栈', '模块划分', '部署方式', '依赖管理']
      }
    }
  },
  L3: {
    name: '细节深入',
    questionCount: { min: 8, max: 12 },
    dynamicTopics: {
      form: ['验证规则', '错误提示', '提交流程', '多步表单'],
      list: ['分页方式', '排序过滤', '空状态', '加载状态'],
      api: ['错误处理', '限流', '版本控制', '幂等性'],
      data: ['模型关系', '索引策略', '迁移计划', '种子数据']
    }
  },
  L4: {
    name: '边界确认',
    questionCount: { min: 4, max: 6 },
    topics: ['现有代码集成', '排除范围', '非功能需求', 'MVP边界']
  }
};
```

---

## Appendix: 规范分类

| 分类 | 目录 | 包含内容 |
|------|------|----------|
| 前端规范 | rules/frontend/ | 组件库、CSS、颜色/间距/圆角 |
| 后端规范 | rules/backend/ | API、数据库、环境配置 |
| 测试规范 | rules/testing/ | 单元测试、E2E测试 |
| 部署规范 | rules/deployment/ | Docker、环境变量、域名 |
| 应用规范 | rules/application/ | 认证、通知、支付、iframe |
| 其他规范 | rules/other/ | 自定义规范 |
