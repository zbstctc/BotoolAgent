# PRD: 简单计数器应用

## Introduction

一个极简风格的个人计数器应用，支持基本的加减和重置操作，数据保存在浏览器本地存储中。

## Goals

- 提供简洁直观的计数功能
- 数据持久化，刷新页面后保留计数值
- 极简 UI，专注核心功能

## Dev Tasks

### DT-001: 创建计数器页面路由
**Description:** 在项目中创建一个新的独立页面用于计数器应用

**Acceptance Criteria:**
- [ ] 创建 `/counter` 路由页面
- [ ] 页面可正常访问
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-002: 实现计数器核心逻辑
**Description:** 实现计数状态管理，包括 +1、-1、重置功能，最小值为 0

**Acceptance Criteria:**
- [ ] 点击 +1 按钮计数增加
- [ ] 点击 -1 按钮计数减少（最小为 0）
- [ ] 点击重置按钮计数归零
- [ ] Typecheck passes

### DT-003: 实现本地存储持久化
**Description:** 使用 localStorage 保存计数值，页面刷新后恢复

**Acceptance Criteria:**
- [ ] 计数值变化时自动保存到 localStorage
- [ ] 页面加载时从 localStorage 恢复计数值
- [ ] Typecheck passes
- [ ] Verify in browser: 刷新页面后计数值保留

### DT-004: 实现极简 UI 界面
**Description:** 设计极简风格界面，显示数字和三个操作按钮，按钮有点击变色反馈

**Acceptance Criteria:**
- [ ] 居中显示大号计数数字
- [ ] 三个按钮：+1、-1、重置
- [ ] 按钮点击时有颜色变化反馈
- [ ] 整体风格极简，无多余装饰
- [ ] Typecheck passes
- [ ] Verify in browser

## Functional Requirements

- FR-1: 系统必须显示当前计数值
- FR-2: 当用户点击 +1 按钮时，计数值增加 1
- FR-3: 当用户点击 -1 按钮时，计数值减少 1（最小为 0）
- FR-4: 当用户点击重置按钮时，计数值归零
- FR-5: 计数值必须在页面刷新后保留

## Non-Goals (Out of Scope)

- 多计数器支持
- 计数变化历史记录
- 云端同步/跨设备同步
- 自定义步长
- 弹窗确认

## Technical Considerations

- 使用 React + TypeScript
- 使用 localStorage 进行数据持久化
- 作为独立页面添加到现有项目

## Success Metrics

- 计数功能正常工作
- 刷新页面数据不丢失
- UI 简洁易用

---

**PRD 已生成。下一步：**
1. 查看并确认 PRD 内容
2. 使用 `/botoolagent-prd2json` 转换为 JSON
3. 运行 `./BotoolAgent.sh` 开始自动开发