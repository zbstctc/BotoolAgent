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

## User Stories

### 模块一：Dashboard 创建弹窗改造

#### US-001: 需求描述输入
**Description:** 作为用户，我想在创建新需求时输入一段描述文字，而不是只输入标题，以便系统能更好地理解我的需求。

**Acceptance Criteria:**
- [ ] 创建弹窗包含多行文本框（textarea），支持粘贴长文本
- [ ] 文本框 placeholder 提示："请描述你想要构建的功能或解决的问题..."
- [ ] 支持至少 500 字符输入
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-002: 需求类型标签
**Description:** 作为用户，我想选择需求类型（新功能/改功能/修bug/自定义），以便系统知道这是什么类型的需求。

**Acceptance Criteria:**
- [ ] 弹窗包含需求类型选择器（单选）
- [ ] 预设选项：新功能、改功能、修bug
- [ ] 支持自定义输入（选择"其他"后显示输入框）
- [ ] 默认选中"新功能"
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-003: 自动生成标题
**Description:** 作为用户，我希望系统根据我的需求描述自动生成标题，以便我不需要手动总结。

**Acceptance Criteria:**
- [ ] 用户输入需求描述后，点击"生成标题"或自动触发
- [ ] 调用 AI 生成简短标题（10-20字）
- [ ] 标题显示在可编辑的输入框中
- [ ] 用户可以修改生成的标题
- [ ] 点击"创建"后保存标题和描述，进入 Stage 1
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### 模块二：Stage 1 金字塔问答

#### US-004: 金字塔导航组件
**Description:** 作为用户，我想在左侧看到金字塔导航，显示 4 个层级和当前进度，以便了解整体结构。

**Acceptance Criteria:**
- [ ] 左侧显示金字塔导航面板
- [ ] 显示 4 个层级：L1 核心识别、L2 领域分支、L3 细节深入、L4 边界确认
- [ ] 当前层级高亮显示（▶ 图标）
- [ ] 已完成层级显示 ✓ 和收集的信息摘要
- [ ] 未解锁层级显示 ○ 灰色
- [ ] 每个层级显示进度条（如 "前端 2/5"）
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-005: 问题卡片面板
**Description:** 作为用户，我想在右侧看到当前层级的所有问题，按维度分组显示为卡片。

**Acceptance Criteria:**
- [ ] 右侧显示当前层级的问题面板
- [ ] 问题按维度分组（前端设计、后端架构、UX 流程等）
- [ ] 每个维度是一个可折叠的卡片
- [ ] 卡片内显示该维度的所有问题
- [ ] 已回答问题收缩为一行，显示答案摘要
- [ ] 未回答问题展开显示选项
- [ ] 支持单选、多选、文本输入三种问题类型
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-006: 问题动态生成
**Description:** 作为系统，我需要根据维度框架和用户上下文动态生成具体问题，而不是使用固定模板。

**Acceptance Criteria:**
- [ ] 定义维度框架配置（前端、后端、UX、架构等维度及其子话题）
- [ ] L1 层级生成 4-6 个核心问题
- [ ] L2-L4 层级根据前一层答案，动态生成 8-12 个问题
- [ ] 问题数量受维度框架约束
- [ ] 调用 Claude API 生成具体问题文本和选项
- [ ] Typecheck passes

#### US-007: 层级顺序控制
**Description:** 作为系统，我需要确保用户必须顺序完成各层级。

**Acceptance Criteria:**
- [ ] 用户必须完成当前层级所有必填问题才能进入下一层
- [ ] "完成当前层级"按钮在所有必填问题回答后才可点击
- [ ] 点击后触发 AI 生成下一层问题
- [ ] 显示加载状态
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-008: 实时 PRD 预览
**Description:** 作为用户，我想实时看到基于我回答生成的 PRD 内容预览。

**Acceptance Criteria:**
- [ ] 底部或右侧显示可折叠的 PRD 预览面板
- [ ] 每完成一个层级后更新 PRD 内容
- [ ] PRD 使用 Markdown 格式渲染
- [ ] 支持展开/收缩
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-009: 进度自动保存
**Description:** 作为用户，我希望我的回答进度自动保存，以便刷新页面或关闭后能继续。

**Acceptance Criteria:**
- [ ] 每个问题回答后自动保存到 localStorage
- [ ] 保存内容包括：当前层级、所有答案、生成的问题、PRD 草稿
- [ ] 页面加载时检查并恢复保存的进度
- [ ] 显示"自动保存中 ✓"状态指示器
- [ ] 支持手动清除进度重新开始
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### 模块三：设计确认与版本迭代

#### US-010: 设计确认页面
**Description:** 作为用户，完成 L4 后我想看到完整的 PRD 和可视化布局图来确认设计。

**Acceptance Criteria:**
- [ ] L4 完成后自动进入设计确认页面
- [ ] 页面上方显示版本历史（v1 → v2 → v3...）
- [ ] 中间显示可视化页面布局图（React 组件渲染）
- [ ] 下方显示完整 PRD 预览
- [ ] 底部显示两个操作区：继续修改 / 确认进入 Stage 2
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-011: 可视化布局图组件
**Description:** 作为用户，我想看到 AI 生成的页面布局可视化图，直观了解前端设计。

**Acceptance Criteria:**
- [ ] 使用 React 组件渲染布局图（不是 ASCII art）
- [ ] 显示页面主要区域（Header、Sidebar、Main、Footer 等）
- [ ] 显示关键组件位置（按钮、表单、列表等）
- [ ] 组件列表在布局图下方展示
- [ ] 支持点击组件查看详情
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-012: 继续修改功能
**Description:** 作为用户，如果我对设计不满意，我想输入修改需求开始新一轮迭代。

**Acceptance Criteria:**
- [ ] 设计确认页面包含"继续修改"区域
- [ ] 提供多行文本框输入修改需求
- [ ] 点击"提交修改"后创建新版本（v2, v3...）
- [ ] 进入增量金字塔问答流程
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-013: 增量金字塔问答
**Description:** 作为系统，新版本迭代时只需要问与修改相关的增量问题。

**Acceptance Criteria:**
- [ ] AI 分析修改需求，判断哪些层级/维度需要重新提问
- [ ] 无变化的层级显示"━"跳过标记
- [ ] 需要调整的层级只生成相关问题（数量减少）
- [ ] 底部显示上一版本已确认内容的摘要
- [ ] 完成后合并生成新版本 PRD
- [ ] Typecheck passes

#### US-014: 版本历史管理
**Description:** 作为用户，我想看到 PRD 的版本历史和变更记录。

**Acceptance Criteria:**
- [ ] 设计确认页面顶部显示版本链
- [ ] 每个版本显示简短描述（来自修改需求）
- [ ] PRD 中包含变更记录章节
- [ ] 可以查看历史版本的 PRD（只读）
- [ ] 不支持回退编辑旧版本
- [ ] Typecheck passes
- [ ] 在浏览器中验证

---

### 模块四：规范管理

#### US-015: 规范管理入口
**Description:** 作为用户，我想在 Dashboard 顶部 Tab 中访问规范管理功能。

**Acceptance Criteria:**
- [ ] Dashboard 顶部增加 Tab：[项目列表] [规范管理] [设置]
- [ ] 点击"规范管理"进入规范管理页面
- [ ] Tab 切换无页面刷新
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-016: 规范分类列表
**Description:** 作为用户，我想看到按类别组织的规范列表。

**Acceptance Criteria:**
- [ ] 左侧显示规范分类树
- [ ] 6 个分类：前端规范、后端规范、测试规范、部署规范、应用规范、其他规范
- [ ] 每个分类可展开显示其下的规范文档
- [ ] 显示每个分类的规范数量
- [ ] 支持新建规范按钮
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-017: 规范文档编辑
**Description:** 作为用户，我想使用 Markdown 编辑器创建和编辑规范文档。

**Acceptance Criteria:**
- [ ] 右侧显示 Markdown 编辑器
- [ ] 支持实时预览（左右分栏或切换模式）
- [ ] 支持常用 Markdown 语法高亮
- [ ] 保存按钮将内容写入 rules/ 目录
- [ ] 文件命名格式：{category}/{name}.md
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-018: 规范转 Skill
**Description:** 作为系统，我需要将规范文档自动转换为 Skill，以便在 Stage 2/3 中注入。

**Acceptance Criteria:**
- [ ] 规范保存时自动生成对应的 Skill 文件
- [ ] Skill 存储在 ~/.claude/skills/botool-rules/ 目录
- [ ] Stage 2 开始时自动加载相关规范 Skill
- [ ] Stage 3 开发时自动注入规范 Skill
- [ ] 提供"预览 Skill"按钮查看生成结果
- [ ] Typecheck passes

---

### 模块五：Stage 2 四步流水线

#### US-019: 流水线进度条
**Description:** 作为用户，我想看到 Stage 2 的四步流水线进度。

**Acceptance Criteria:**
- [ ] Stage 2 顶部显示流水线进度条
- [ ] 四个步骤：v6 规范检查 → v7 代码示例 → v9 测试用例 → JSON 转换
- [ ] 当前步骤高亮，已完成步骤显示 ✓
- [ ] 点击已完成步骤可以回看（只读）
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-020: v6 规范检查
**Description:** 作为用户，我希望系统根据已配置的规范检查 PRD。

**Acceptance Criteria:**
- [ ] 加载所有相关规范（根据 PRD 涉及的领域）
- [ ] AI 分析 PRD 与规范的符合度
- [ ] 列出不符合项和建议修改
- [ ] 每项建议提供：[采纳] [修改] [跳过] 操作
- [ ] 采纳后自动更新 PRD
- [ ] 所有项处理完毕后可进入下一步
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-021: v7 代码示例补全
**Description:** 作为用户，我希望系统为关键接口生成 TypeScript 定义。

**Acceptance Criteria:**
- [ ] 遍历 PRD 中的每个 User Story
- [ ] 为涉及数据结构的 Story 生成 interface 定义
- [ ] 为涉及 API 的 Story 生成 API 契约示例
- [ ] 每个示例提供：[采纳] [修改] [跳过] 操作
- [ ] 采纳的示例添加到 PRD 的技术附录
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-022: v9 测试用例生成
**Description:** 作为用户，我希望系统为每个 User Story 生成测试用例描述。

**Acceptance Criteria:**
- [ ] 遍历 PRD 中的每个 User Story
- [ ] 生成单元测试用例描述（测什么、预期结果）
- [ ] 生成 E2E 测试场景描述（用户操作流程）
- [ ] 每个用例提供：[采纳] [修改] [跳过] 操作
- [ ] 采纳的用例添加到 PRD 的测试章节
- [ ] Typecheck passes
- [ ] 在浏览器中验证

#### US-023: JSON 转换
**Description:** 作为系统，我需要将最终 PRD 转换为 prd.json 格式。

**Acceptance Criteria:**
- [ ] 解析 PRD 提取：项目名、分支名、描述、开发任务
- [ ] 每个 User Story 转为一个 devTask
- [ ] devTask 包含：id、title、description、acceptanceCriteria、passes(false)
- [ ] 生成的 JSON 显示在编辑器中供用户审核
- [ ] 用户可以编辑任务详情
- [ ] 保存到 prd.json 文件
- [ ] Typecheck passes
- [ ] 在浏览器中验证

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

### 现有代码集成

- Stage 1 金字塔界面将**完全替代**现有的聊天界面（`viewer/src/app/stage1/page.tsx`）
- 复用现有的 `useCliChat` hook 与 Claude 通信
- 复用现有的 `prd-session-storage.ts` 进行进度存储，需扩展数据结构
- 复用现有的 `ProjectContext` 进行项目状态管理

### 新增组件

```
viewer/src/
├── components/
│   ├── pyramid/
│   │   ├── PyramidNavigation.tsx      # 金字塔导航
│   │   ├── LevelPanel.tsx             # 层级问题面板
│   │   ├── DimensionCard.tsx          # 维度卡片
│   │   ├── QuestionItem.tsx           # 问题项
│   │   └── VersionHistory.tsx         # 版本历史
│   ├── design-confirm/
│   │   ├── DesignConfirmPage.tsx      # 设计确认页面
│   │   ├── LayoutPreview.tsx          # 可视化布局图
│   │   └── IterationInput.tsx         # 修改需求输入
│   ├── rules/
│   │   ├── RulesManager.tsx           # 规范管理主页
│   │   ├── CategoryTree.tsx           # 分类树
│   │   └── MarkdownEditor.tsx         # MD编辑器
│   └── pipeline/
│       ├── PipelineProgress.tsx       # 流水线进度条
│       ├── RuleCheckStep.tsx          # v6 规范检查
│       ├── CodeExampleStep.tsx        # v7 代码示例
│       ├── TestCaseStep.tsx           # v9 测试用例
│       └── JsonConvertStep.tsx        # JSON 转换
├── lib/
│   ├── dimension-framework.ts         # 维度框架定义
│   ├── pyramid-session-storage.ts     # 金字塔进度存储
│   └── rules-to-skill.ts              # 规范转 Skill
└── app/
    ├── stage1/
    │   └── page.tsx                   # 重写为金字塔界面
    ├── stage2/
    │   └── page.tsx                   # 改为流水线界面
    └── rules/
        └── page.tsx                   # 新增规范管理页
```

### API 端点

```
POST /api/pyramid/questions/generate   # 生成问题
POST /api/pyramid/layout/generate      # 生成布局图
POST /api/rules/save                   # 保存规范
POST /api/rules/to-skill               # 转换为 Skill
POST /api/pipeline/rule-check          # 规范检查
POST /api/pipeline/code-examples       # 代码示例生成
POST /api/pipeline/test-cases          # 测试用例生成
```

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

1. **布局图组件库**：可视化布局图使用什么 React 组件库实现？考虑 react-flow 或自定义 SVG
2. **规范 Skill 格式**：规范转 Skill 的具体格式是什么？需要与现有 Skill 系统兼容
3. **增量问题算法**：AI 如何判断哪些层级需要重新提问？需要定义判断规则
4. **文本框字数限制**：Dashboard 创建弹窗的需求描述最大字数是多少？

---

## Implementation Priority

### Phase 1: Stage 1 金字塔（核心功能）
1. US-001 ~ US-003: Dashboard 创建弹窗改造
2. US-004 ~ US-009: 金字塔问答核心功能
3. US-010 ~ US-014: 设计确认与版本迭代

### Phase 2: 规范管理
4. US-015 ~ US-018: 规范管理完整功能

### Phase 3: Stage 2 流水线
5. US-019 ~ US-023: 四步流水线

---

## Appendix: 维度框架定义

```typescript
const DIMENSION_FRAMEWORK = {
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
        triggers: ['前端', '界面', 'UI', '页面'],
        topics: ['页面结构', '组件类型', '设计风格', '响应式', '交互', '状态管理']
      },
      backend: {
        name: '后端架构',
        triggers: ['后端', 'API', '服务', '数据'],
        topics: ['API 类型', '数据模型', '认证', '存储', '集成', '缓存']
      },
      ux: {
        name: 'UX 流程',
        triggers: ['用户', '流程', '体验'],
        topics: ['用户旅程', '核心流程', '边缘场景', '反馈机制']
      },
      architecture: {
        name: '技术架构',
        triggers: ['架构', '部署', '扩展'],
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
