# PRD: 简单待办事项列表

## Introduction

一个简洁的个人待办事项列表 Web 应用，使用 React + TypeScript 构建。用户可以添加、删除和标记完成待办事项，数据通过 localStorage 持久化存储。采用居中卡片式布局，提供简洁直观的使用体验。

## Goals

- 提供一个轻量、快速的个人待办事项管理工具
- 支持待办事项的添加、删除和完成状态切换
- 数据本地持久化，刷新浏览器后数据不丢失
- 简洁美观的居中卡片式 UI

## Dev Tasks

### DT-001: 项目初始化
**Description:** 使用 Vite + React + TypeScript 创建独立项目，配置基础开发环境。

**Acceptance Criteria:**
- [ ] 使用 Vite 创建 React + TypeScript 项目
- [ ] 项目可正常启动 (`npm run dev`)
- [ ] Typecheck passes
- [ ] 基础目录结构清晰

### DT-002: Todo 数据模型与状态管理
**Description:** 定义 Todo 数据类型，实现基于 useState 的状态管理，集成 localStorage 读写。

**Acceptance Criteria:**
- [ ] Todo 类型定义（id, text, completed, createdAt）
- [ ] useState 管理 todo 列表
- [ ] 页面加载时从 localStorage 读取数据
- [ ] 数据变更时自动写入 localStorage
- [ ] Typecheck passes

### DT-003: 添加待办事项功能
**Description:** 实现顶部输入框，用户输入文字后按回车或点击按钮添加新的待办事项。

**Acceptance Criteria:**
- [ ] 顶部固定输入框，支持回车提交
- [ ] 添加按钮可点击提交
- [ ] 空内容不可提交
- [ ] 添加后输入框自动清空
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-004: 待办事项列表展示
**Description:** 实现居中卡片式布局展示待办事项列表，已完成项显示划线+置灰效果。

**Acceptance Criteria:**
- [ ] 居中卡片式布局
- [ ] 每项显示文字内容和操作按钮
- [ ] 已完成项显示删除线 + 灰色文字
- [ ] 列表为空时显示"还没有待办事项，添加一个吧"提示文字
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-005: 删除与完成切换功能
**Description:** 实现点击切换完成状态和直接删除功能。

**Acceptance Criteria:**
- [ ] 点击 checkbox 或事项可切换完成/未完成状态
- [ ] 点击删除按钮直接删除，无需确认
- [ ] 状态变更实时同步到 localStorage
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-006: 统计信息展示
**Description:** 在列表底部或顶部显示完成计数统计。

**Acceptance Criteria:**
- [ ] 显示"已完成 X / 共 Y 项"格式的统计
- [ ] 统计数据实时更新
- [ ] Typecheck passes
- [ ] Verify in browser

## Functional Requirements

- FR-1: 用户在输入框输入文字后，按回车或点击添加按钮，系统必须创建一条新的待办事项
- FR-2: 用户点击待办事项的 checkbox 时，系统必须切换该项的完成状态
- FR-3: 用户点击删除按钮时，系统必须立即删除该待办事项
- FR-4: 系统必须在每次数据变更时将完整列表写入 localStorage
- FR-5: 系统必须在页面加载时从 localStorage 恢复数据
- FR-6: 列表为空时，系统必须显示引导文字提示

## Non-Goals (Out of Scope)

- 拖拽排序
- 分类/标签功能
- 到期日和提醒功能
- 深色模式
- 移动端专门适配
- 多用户/团队协作
- 后端 API 和数据库

## Technical Considerations

- **技术栈:** Vite + React 18 + TypeScript
- **样式方案:** CSS Modules 或内联样式（保持简单）
- **数据持久化:** localStorage，JSON 序列化/反序列化
- **无外部状态库依赖:** 使用 React 内置 useState 即可

## Success Metrics

- 所有 6 个 Dev Task 的验收标准全部通过
- TypeScript 类型检查无错误
- 浏览器中功能可正常使用

---

PRD 已生成。下一步：
1. 查看并确认 PRD 内容
2. 使用 `/botoolagent-prd2json` 转换为 JSON
3. 运行 `./BotoolAgent.sh` 开始自动开发