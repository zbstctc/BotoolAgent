# PRD: 规范管理功能

## Introduction

在 Dashboard 的"规范管理" Tab 中实现完整的规范文档管理功能。用户可以查看、创建、编辑和删除规范文档。这些规范将在 Stage 2 的"规范检查"步骤中被选择和应用。

## Goals

- 提供直观的规范文档管理界面
- 支持按分类组织规范（前端、后端、测试、部署、应用、其他）
- 支持 Markdown 格式的规范内容编辑
- 与现有 `/api/rules` API 完整集成

## Dev Tasks

### DT-001: 创建 RulesManagement 组件框架

**Description:** 创建规范管理的主组件，包含列表视图和基本布局。

**Acceptance Criteria:**
- [ ] 创建 `viewer/src/components/RulesManagement.tsx` 组件
- [ ] 组件包含：顶部操作栏（新建按钮、搜索框）、分类列表区域
- [ ] 从 `/api/rules` 加载规范列表
- [ ] 按分类分组显示规范，使用可折叠的卡片形式（类似 Stage 2 的规范选择界面）
- [ ] 空状态：当某分类无规范时显示"暂无规范"
- [ ] 在 Dashboard page.tsx 中替换占位符内容
- [ ] Typecheck passes

### DT-002: 实现规范列表项组件

**Description:** 实现单个规范的列表项展示，包含操作按钮。

**Acceptance Criteria:**
- [ ] 每个规范项显示：名称、分类标签
- [ ] 右侧显示操作按钮：查看、编辑、删除（使用图标按钮）
- [ ] 鼠标悬停时显示操作按钮（默认半透明）
- [ ] 点击规范名称可展开/收起预览（前 100 字符）
- [ ] Typecheck passes

### DT-003: 实现创建/编辑规范对话框

**Description:** 创建规范编辑对话框，支持新建和编辑模式。

**Acceptance Criteria:**
- [ ] 创建 `RuleEditorDialog` 组件
- [ ] 对话框包含：分类选择（下拉）、名称输入、内容编辑区（textarea）
- [ ] 分类下拉选项：前端规范、后端规范、测试规范、部署规范、应用规范、其他规范
- [ ] 下拉框背景必须是白色（不能透明）
- [ ] 编辑模式下预填充现有内容
- [ ] 新建模式下分类和名称为空
- [ ] 保存按钮调用 POST `/api/rules`
- [ ] 保存成功后关闭对话框并刷新列表
- [ ] Typecheck passes

### DT-004: 实现删除确认对话框

**Description:** 实现删除规范的确认对话框。

**Acceptance Criteria:**
- [ ] 创建 `DeleteConfirmDialog` 组件
- [ ] 显示要删除的规范名称
- [ ] 确认按钮调用 DELETE `/api/rules?id=xxx`
- [ ] 删除成功后关闭对话框并刷新列表
- [ ] 取消按钮关闭对话框
- [ ] Typecheck passes

### DT-005: 实现规范预览对话框

**Description:** 实现规范内容的 Markdown 预览。

**Acceptance Criteria:**
- [ ] 创建 `RulePreviewDialog` 组件
- [ ] 从 `/api/rules/{id}` 加载完整内容
- [ ] 使用 `react-markdown` 渲染 Markdown（如果已安装）或简单的 `<pre>` 展示
- [ ] 对话框可滚动查看长内容
- [ ] 底部有"关闭"和"编辑"按钮
- [ ] Typecheck passes

### DT-006: 实现搜索过滤功能

**Description:** 在规范列表中实现搜索过滤。

**Acceptance Criteria:**
- [ ] 顶部搜索框支持按规范名称搜索
- [ ] 实时过滤（输入时即时过滤）
- [ ] 搜索为空时显示全部
- [ ] 显示搜索结果数量
- [ ] Typecheck passes

## Non-Goals (Out of Scope)

- 规范版本历史
- 规范导入/导出
- 规范模板

## Technical Considerations

- 复用现有 API：`/api/rules` (GET, POST, DELETE) 和 `/api/rules/[id]` (GET)
- 对话框样式与现有设计保持一致（使用相同的 backdrop、圆角、阴影）
- 分类定义与 RuleCheckStep 中的 DEFAULT_CATEGORIES 保持一致

## UI 参考

参考 `RuleCheckStep.tsx` 中的分类卡片设计：
- 可折叠的分类卡片
- 分类图标（🎨 前端、⚙️ 后端、🧪 测试、🚀 部署、📱 应用、📋 其他）
- 简洁的复选框/操作按钮布局
