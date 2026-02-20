# PRD: Dashboard 当前时间小组件

## 1. 项目概述

在 Viewer 的 Header 右侧区域添加一个「当前时间」小组件，实时显示 HH:MM:SS 格式的时钟，每秒刷新一次。组件样式复用现有 Header 右侧 widget 的视觉模式（带边框的小圆角矩形），与 ClaudeProcesses、ClaudeStatus 等组件保持一致。

## 7. 开发计划

### 7.1 Phase 1: 时钟组件 (P0)

> **前置**: 无
> **产出**: Header 右上角显示实时时钟
> **对应设计**: Section 1

- [ ] DT-001: 创建 `CurrentTime.tsx` 组件并集成到 Header (`组件: <CurrentTime>`, `文件: viewer/src/components/CurrentTime.tsx, viewer/src/components/Header.tsx`)
  - **描述**: 新建 `CurrentTime` 客户端组件，使用 `useState` + `useEffect` + `setInterval(1000)` 实现每秒刷新的时钟。显示 HH:MM:SS（24 小时制）。使用 `lucide-react` 的 `Clock` 图标。样式复用现有 Header 右侧 widget 模式：`rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600`。在 `Header.tsx` 右侧区域（ClaudeProcesses 之前）引入该组件。
  - **验收条件**:
    - [ ] `CurrentTime` 组件创建于 `viewer/src/components/CurrentTime.tsx`
    - [ ] 标记为 `"use client"` 客户端组件
    - [ ] 显示 HH:MM:SS 格式（24 小时制，补零）
    - [ ] 每秒自动刷新
    - [ ] 组件卸载时清理 `setInterval`
    - [ ] 使用 `Clock` icon from `lucide-react`
    - [ ] 样式与 ClaudeStatus/ClaudeProcesses 按钮风格一致
    - [ ] 在 Header 右侧区域可见，位于 ClaudeProcesses 之前
    - [ ] Typecheck passes
    - [ ] Verify in browser
