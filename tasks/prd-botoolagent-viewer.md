# PRD: BotoolAgentViewer

## Introduction

**BotoolAgentViewer** 是一个本地 Web 前端应用，为 BotoolAgent 自治开发循环提供可视化界面。它将原本在终端中进行的 PRD 生成对话和开发进度监控，转移到一个现代化的浏览器界面中，提供更好的用户体验。

### 背景

- BotoolAgent 目前通过 CLI 运行，用户交互体验有限
- 需要一个可视化界面来展示开发进度和管理多个 PRD
- 未来可能作为 SaaS 产品提供给客户

## Goals

1. **统一的工作流入口** - 通过一个主页（Dashboard）管理所有 PRD 和开发会话
2. **可视化 PRD 生成** - 在网页中完成与 AI 的对话式 PRD 创建，支持丰富交互
3. **实时进度监控** - 可视化展示开发循环的每个阶段和 Dev Task 状态
4. **阶段化流程** - 清晰的 5 阶段工作流（PRD → 规划 → Coding → 测试 → Review）
5. **多 PRD 管理** - 支持创建多个 PRD，在执行时选择要开发的项目

## Target Users

- **近期**：团队内部开发者，通过 Claude Code CLI 触发使用
- **未来**：作为 SaaS 产品提供给客户

---

## Dev Tasks

### 基础架构

#### DT-001: 创建 Next.js 项目
**Description:** 作为开发者，我需要创建 BotoolAgentViewer 的 Next.js 项目。

**Acceptance Criteria:**
- [ ] 在 `viewer/` 目录创建 Next.js 16 项目
- [ ] 配置 TypeScript、Tailwind CSS v4
- [ ] 配置 App Router
- [ ] 添加基础布局组件（Header、Main）
- [ ] Typecheck passes

---

#### DT-002: 迁移 FlowChart 组件
**Description:** 作为开发者，我需要将现有的 flowchart 组件迁移到新项目。

**Acceptance Criteria:**
- [ ] 安装 @xyflow/react 依赖
- [ ] 迁移 FlowChart 相关组件
- [ ] 确保流程图正常渲染
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-003: 设置 WebSocket 通信
**Description:** 作为开发者，我需要实现前后端实时通信。

**Acceptance Criteria:**
- [ ] 添加 socket.io 或 Server-Sent Events 支持
- [ ] 实现文件变化监听（prd.json, progress.txt）
- [ ] 前端接收并处理实时更新
- [ ] Typecheck passes

---

### 主页 Dashboard

#### DT-004: 创建主页布局
**Description:** 作为用户，我需要一个主页来查看所有 PRD 和项目状态。

**Acceptance Criteria:**
- [ ] 创建 Dashboard 页面 (`app/page.tsx`)
- [ ] 左侧显示 PRD 列表区域
- [ ] 右侧显示历史 Sessions 区域
- [ ] 顶部显示当前活跃项目状态（如有）
- [ ] UI 风格：简洁现代（类似 Linear/Vercel）
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-005: PRD 列表功能
**Description:** 作为用户，我需要看到所有已创建的 PRD 文档。

**Acceptance Criteria:**
- [ ] 创建 API Route 读取 `tasks/prd-*.md` 文件列表
- [ ] 每个 PRD 显示：名称、创建时间、状态
- [ ] 点击 PRD 可以预览内容
- [ ] 提供「选择执行」按钮
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-006: 历史 Sessions 展示
**Description:** 作为用户，我需要查看之前完成的开发会话。

**Acceptance Criteria:**
- [ ] 创建 API Route 读取 `archive/` 目录内容
- [ ] 每个 session 显示：日期、功能名称、完成状态
- [ ] 点击可展开查看详情
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-007: 添加「创建新 PRD」入口
**Description:** 作为用户，我需要从主页快速开始创建新的 PRD。

**Acceptance Criteria:**
- [ ] 主页显示「+ 创建新 PRD」按钮
- [ ] 点击后跳转到阶段1（/stage1）
- [ ] Typecheck passes
- [ ] Verify in browser

---

### 阶段导航

#### DT-008: 阶段指示器组件
**Description:** 作为用户，我需要在页面顶部看到当前处于哪个阶段。

**Acceptance Criteria:**
- [ ] 创建 StageIndicator 组件
- [ ] 显示 5 个阶段：1.PRD需求确认 → 2.开发规划 → 3.Coding → 4.测试 → 5.Review
- [ ] 当前阶段高亮显示
- [ ] 已完成阶段显示勾选标记
- [ ] 阶段4-5 显示为「即将推出」状态
- [ ] Typecheck passes
- [ ] Verify in browser

---

### 阶段1：PRD 需求确认

#### DT-009: 阶段1 页面布局
**Description:** 作为用户，我需要一个聊天界面来与 AI 对话生成 PRD。

**Acceptance Criteria:**
- [ ] 创建阶段1页面 (`app/stage1/page.tsx`)
- [ ] 左侧聊天区域，右侧 PRD 预览区域
- [ ] 包含 StageIndicator 组件
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-010: 聊天界面组件
**Description:** 作为用户，我需要一个聊天界面来输入和查看消息。

**Acceptance Criteria:**
- [ ] 创建 ChatInterface 组件
- [ ] 显示消息历史区域（支持滚动）
- [ ] 底部输入框 + 发送按钮
- [ ] AI 消息左对齐，用户消息右对齐
- [ ] 支持 Markdown 渲染
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-011: 选项卡片组件
**Description:** 作为用户，当 AI 提供选项时，我需要通过点击卡片来选择。

**Acceptance Criteria:**
- [ ] 创建 OptionCard 组件
- [ ] 支持单选和多选模式
- [ ] 选中状态有视觉反馈
- [ ] 支持「其他」选项输入自定义文本
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-012: AI 对话 API
**Description:** 作为开发者，我需要后端处理与 Anthropic API 的通信。

**Acceptance Criteria:**
- [ ] 创建 `/api/chat` API Route
- [ ] 支持流式响应（SSE）
- [ ] 维护对话历史
- [ ] 集成 PRD 生成 skill 的系统提示词
- [ ] Typecheck passes

---

#### DT-013: PRD 预览面板
**Description:** 作为用户，我需要在对话过程中实时预览生成的 PRD。

**Acceptance Criteria:**
- [ ] 创建 PRDPreview 组件
- [ ] 随着对话进行，实时更新预览
- [ ] 支持 Markdown 渲染
- [ ] 可折叠/展开
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-014: 保存 PRD 文档
**Description:** 作为用户，当 PRD 完成后，我需要将其保存为文件。

**Acceptance Criteria:**
- [ ] 提供「保存 PRD」按钮
- [ ] 创建 API Route 保存到 `tasks/prd-[name].md`
- [ ] 保存成功后显示确认消息
- [ ] 自动跳转到阶段2
- [ ] Typecheck passes
- [ ] Verify in browser

---

### 阶段2：开发规划确认

#### DT-015: 阶段2 页面布局
**Description:** 作为用户，我需要选择要执行的 PRD 并转换为 JSON。

**Acceptance Criteria:**
- [ ] 创建阶段2页面 (`app/stage2/page.tsx`)
- [ ] 显示可用的 PRD 列表
- [ ] 包含 StageIndicator 组件
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-016: PRD 选择和预览
**Description:** 作为用户，我需要选择要执行的 PRD 并预览内容。

**Acceptance Criteria:**
- [ ] 每个 PRD 显示摘要信息
- [ ] 点击可预览 PRD 完整内容
- [ ] 选中的 PRD 高亮显示
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-017: PRD 转 JSON 功能
**Description:** 作为用户，我需要将 PRD 转换为 prd.json 格式。

**Acceptance Criteria:**
- [ ] 创建 API Route 调用 AI 进行转换
- [ ] 显示转换进度
- [ ] 生成 prd.json 到项目根目录
- [ ] Typecheck passes

---

#### DT-018: Dev Task 预览和编辑
**Description:** 作为用户，我需要在执行前预览和调整 Dev Tasks。

**Acceptance Criteria:**
- [ ] 显示所有 Dev Tasks 列表
- [ ] 每个 Task 显示：ID、标题、验收标准
- [ ] 支持拖拽调整优先级
- [ ] 支持编辑 Task 详情
- [ ] 保存修改到 prd.json
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-019: 确认开始开发
**Description:** 作为用户，我需要确认后开始自治开发循环。

**Acceptance Criteria:**
- [ ] 显示「开始开发」按钮
- [ ] 点击后跳转到阶段3
- [ ] 在后台启动 BotoolAgent.sh（通过 skill）
- [ ] Typecheck passes
- [ ] Verify in browser

---

### 阶段3：Coding

#### DT-020: 阶段3 页面布局
**Description:** 作为用户，我需要看到开发的整体进度。

**Acceptance Criteria:**
- [ ] 创建阶段3页面 (`app/stage3/page.tsx`)
- [ ] 左侧显示 Dev Tasks 状态
- [ ] 右侧显示流程图和日志
- [ ] 包含 StageIndicator 组件
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-021: 开发进度总览
**Description:** 作为用户，我需要看到开发的整体进度统计。

**Acceptance Criteria:**
- [ ] 显示已完成 / 进行中 / 待完成的 Task 数量
- [ ] 进度条显示整体完成百分比
- [ ] 显示当前迭代次数
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-022: Dev Task 状态卡片
**Description:** 作为用户，我需要看到每个 Dev Task 的详细状态。

**Acceptance Criteria:**
- [ ] 每个 Task 显示为卡片
- [ ] 状态颜色区分：待做(灰)、进行中(蓝)、完成(绿)、失败(红)
- [ ] 显示验收标准的勾选状态
- [ ] 点击展开查看详情
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-023: 流程图高亮当前步骤
**Description:** 作为用户，我需要在流程图上看到当前执行到哪一步。

**Acceptance Criteria:**
- [ ] 使用迁移的 FlowChart 组件
- [ ] 根据当前状态高亮对应节点
- [ ] 完成的步骤显示勾选标记
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-024: 实时日志显示
**Description:** 作为用户，我需要看到 Agent 的实时输出日志。

**Acceptance Criteria:**
- [ ] 通过 WebSocket 接收 progress.txt 更新
- [ ] 显示最新的进度日志
- [ ] 支持滚动和自动滚动到底部
- [ ] 可折叠/展开
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-025: 文件变更显示
**Description:** 作为用户，我需要看到哪些文件被修改了。

**Acceptance Criteria:**
- [ ] 显示变更文件列表
- [ ] 区分：新增(绿)、修改(黄)、删除(红)
- [ ] 显示变更统计：+N行 / -N行
- [ ] Typecheck passes
- [ ] Verify in browser

---

#### DT-026: Git 提交历史
**Description:** 作为用户，我需要看到本次开发的所有提交。

**Acceptance Criteria:**
- [ ] 创建 API Route 获取当前分支提交
- [ ] 每个提交显示：hash、message、时间
- [ ] 提交格式：`feat: [DT-xxx] - [Task Title]`
- [ ] Typecheck passes
- [ ] Verify in browser

---

### Skills 集成

#### DT-027: 创建 botoolagent 入口 Skill
**Description:** 作为用户，我需要通过 `/botoolagent` 命令启动 Viewer。

**Acceptance Criteria:**
- [ ] 创建 `skills/BotoolAgent/Main/SKILL.md`
- [ ] Skill 启动 Viewer 开发服务器（如未运行）
- [ ] 在浏览器中打开 Viewer 主页
- [ ] 输出 Viewer 的访问地址

---

#### DT-028: 更新 botoolagent-generateprd Skill
**Description:** 作为用户，我需要通过 `/botoolagent-generateprd` 直接进入阶段1。

**Acceptance Criteria:**
- [ ] 更新现有 skill 以支持 Viewer
- [ ] 启动服务器并打开 Viewer
- [ ] 自动进入阶段1（/stage1）
- [ ] 保持原有的 CLI 对话功能作为后备

---

#### DT-029: 更新 botoolagent-prd2json Skill
**Description:** 作为用户，我需要通过 `/botoolagent-prd2json` 直接进入阶段2。

**Acceptance Criteria:**
- [ ] 更新现有 skill 以支持 Viewer
- [ ] 启动服务器并打开 Viewer
- [ ] 自动进入阶段2（/stage2）
- [ ] 如无可用 PRD，提示用户先创建

---

#### DT-030: 创建 botoolagent-coding Skill
**Description:** 作为用户，我需要通过 `/botoolagent-coding` 直接进入阶段3。

**Acceptance Criteria:**
- [ ] 创建 `skills/BotoolAgent/Coding/SKILL.md`
- [ ] 启动服务器并打开 Viewer
- [ ] 自动进入阶段3（/stage3）
- [ ] 如无 prd.json，提示用户先完成阶段2

---

## Functional Requirements

| ID | 需求 | MVP |
|----|------|-----|
| FR-1 | 系统必须提供 Web 界面访问 BotoolAgent 功能 | ✓ |
| FR-2 | 系统必须支持在浏览器中与 AI 进行 PRD 生成对话 | ✓ |
| FR-3 | 系统必须支持选项卡片、文本输入等多种交互方式 | ✓ |
| FR-4 | 系统必须实时显示 PRD 预览 | ✓ |
| FR-5 | 系统必须支持管理多个 PRD 文档 | ✓ |
| FR-6 | 系统必须支持将 PRD 转换为 prd.json | ✓ |
| FR-7 | 系统必须实时显示开发循环的进度 | ✓ |
| FR-8 | 系统必须显示文件变更统计（+/- 行数） | ✓ |
| FR-9 | 系统必须显示 Git 提交历史 | ✓ |
| FR-10 | 系统必须通过 Skills 与 Claude Code CLI 集成 | ✓ |
| FR-11 | 系统必须支持对话式 bug 反馈和修复流程 | 后续 |
| FR-12 | 系统必须支持创建 Pull Request | 后续 |

---

## Non-Goals (Out of Scope)

### MVP 不包含

1. **用户认证系统** - MVP 阶段不需要登录功能
2. **多用户协作** - 不支持多人同时使用同一个项目
3. **云端部署** - 仅本地运行，不支持远程访问
4. **代码编辑器** - 不提供在 Viewer 中直接编辑代码的功能
5. **自定义 AI 模型** - 仅使用 Anthropic Claude API
6. **项目模板** - 不提供预设的项目模板
7. **国际化 (i18n)** - 界面语言仅支持中文/英文混合
8. **移动端适配** - 仅针对桌面浏览器优化
9. **阶段4-5 完整功能** - 测试反馈和代码审查流程留待后续

---

## Technical Considerations

### 技术栈

| 层级 | 技术选择 |
|------|---------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript |
| 样式 | Tailwind CSS v4 |
| 运行时 | Node.js 22 |
| 流程图 | @xyflow/react |
| 实时通信 | WebSocket (socket.io) 或 SSE |
| AI API | Anthropic Claude API |
| CLI 集成 | Claude Code Skills |

### 项目结构

```
BotoolAgent/
├── viewer/                    # Next.js 应用
│   ├── app/                   # App Router
│   │   ├── page.tsx           # 主页 Dashboard
│   │   ├── stage1/page.tsx    # 阶段1 PRD
│   │   ├── stage2/page.tsx    # 阶段2 规划
│   │   ├── stage3/page.tsx    # 阶段3 Coding
│   │   ├── api/               # API Routes
│   │   │   ├── chat/route.ts  # AI 对话
│   │   │   ├── prd/route.ts   # PRD 操作
│   │   │   └── status/route.ts# 状态查询
│   │   └── layout.tsx
│   ├── components/            # 通用组件
│   │   ├── StageIndicator.tsx
│   │   ├── ChatInterface.tsx
│   │   ├── FlowChart.tsx
│   │   └── ...
│   └── package.json
├── skills/BotoolAgent/        # Claude Code Skills
│   ├── Main/
│   ├── GeneratePRD/
│   ├── PRD2JSON/
│   └── Coding/
├── tasks/                     # PRD 文档存放
└── archive/                   # 已完成项目归档
```

### 关键集成点

1. **Claude Code CLI ↔ Viewer**
   - Skill 启动 Viewer 服务器
   - Skill 可以传递初始状态（如进入哪个阶段）
   - CLI 仍然是实际执行者

2. **Viewer ↔ 文件系统**
   - 监听 `prd.json` 和 `progress.txt` 变化
   - 读取 `tasks/` 目录获取 PRD 列表
   - 读取 `archive/` 目录获取历史

3. **Viewer ↔ Anthropic API**
   - 通过 API Routes 代理 API 调用
   - 支持流式响应
   - 维护对话历史

---

## Success Metrics

1. **用户体验**：PRD 生成对话在网页中完成，无需在终端交互
2. **可视化**：开发进度一目了然，包括 Task 状态、流程图、日志
3. **效率**：通过 skill 一键启动 Viewer，无需手动操作

---

## Open Questions

1. **阶段4-5 设计**：测试反馈和代码审查的详细交互流程待定
2. **多项目并行**：是否需要支持同时运行多个开发循环？
3. **离线支持**：是否需要在没有网络时也能查看历史？

---

## Appendix: UI 参考

- **设计风格**：简洁现代，类似 Linear、Vercel
- **配色**：浅色主题为主，状态颜色区分
- **布局**：左右分栏，顶部阶段导航
