# PRD: Tab 切换缓存优化

## 1. 项目概述

当前 BotoolAgent Viewer 的 Tab 切换使用 Next.js `router.push()` 进行页面导航，导致每次切换 Tab 时全页面重新挂载。所有组件状态（表单进度、滚动位置、轮询定时器）全部丢失，用户体验严重受损——例如 Stage 1 的 PRD 编写进度在切换后重置到"选择开发模式"。

本次优化将 Tab 切换机制从路由导航改为 **CSS display:none/block** 切换，实现：

1. **Tab 切换 <200ms**，无页面重载，允许短暂过渡动画
2. **后台 Tab 完全活跃**——所有轮询（claude-processes 2s、cli/status 5s）、定时器继续运行
3. **F5 刷新后恢复 Tab 列表 + 各页面关键状态**（通过 RequirementContext localStorage 持久化的数据自动恢复；滚动位置不保证恢复，因为 CSS display:none 的面板在刷新后重新挂载）
4. **Dashboard 始终常驻**，不可关闭
5. **所有 Tab 关闭时弹窗确认**

> **注**: 本文档使用功能开发模式，§ 2（当前状态）和 § 6（业务规则）按模式规范省略。附录 § 8.C（测试策略）省略。

## 3. 架构设计（概要）

```
───────── 当前架构 vs 目标架构 ─────────

[当前]
layout.tsx
  ├── Header + TabBar
  └── Main
        └── {children}  ← Next.js 路由渲染，router.push() 切换
                           每次切换 = 全组件卸载 + 重新挂载

[目标]
layout.tsx
  ├── Header + TabBar
  └── Main
        └── TabPanelManager (新)  ← 替代 {children}
              ├── DashboardPanel (常驻，display:block/none)
              ├── ProjectPanel [req-1] (display:block/none)
              │     └── <StageXContent reqId={req-1}>
              └── ProjectPanel [req-2] (display:block/none)
                    └── <StageXContent reqId={req-2}>

───────── 切换流程 ─────────

用户点击 Tab
    │
    ├── TabBar.handleTabClick()
    │     └── switchTab(id)  ← 不再调用 router.push()
    │           ├── setActiveTabId(id)
    │           └── history.replaceState(url)  ← URL 同步，不触发路由
    │
    └── TabPanelManager
          └── 根据 activeTabId 切换 CSS display
                active panel:  display: block
                other panels:  display: none
```

## 4. 数据设计（概要）

| 模型 | 用途 | 关键字段 | 状态 |
|------|------|---------|------|
| `TabItem` | Tab 元数据 | id, name, stage, isRunning, url, agentStatus, needsAttention, progress | 已有，无需修改 |
| `TabStorage` | localStorage 持久化 | tabs, activeTabId | 已有，无需修改 |
| `TabContextValue` | Context 接口 | tabs, activeTabId, switchTab, openTab, closeTab... | 修改：switchTab 签名变更 |

本次不涉及数据库变更，不新增数据模型。状态管理完全在前端 Context + localStorage 完成。

## 5. UI 设计（概要）

| 组件 | Props | 状态 |
|------|-------|------|
| `TabPanelManager` | `children: ReactNode`（从 TabContext 读取 tabs/activeTabId） | 新建 |
| `DashboardContent` | 无 (从 page.tsx 提取) | 提取自 `app/page.tsx` |
| `Stage1Content` | `reqId: string` | 提取自 `app/stage1/page.tsx` |
| `Stage3Content` | `reqId: string` | 提取自 `app/stage3/page.tsx` |
| `Stage4Content` | `reqId: string` | 提取自 `app/stage4/page.tsx` |
| `Stage5Content` | `reqId: string` | 提取自 `app/stage5/page.tsx` |
| `CloseTabDialog` | `tabName: string, onConfirm, onCancel` | 新建（从 TabBar 提取） |

注意：各 `StageXContent` 组件目前已存在于对应 page.tsx 内部（如 `Stage1PageContent`、`Stage3PageContent` 等），只需提取为独立导出。

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3
组件抽取      TabPanelManager    集成与测试
(P0)         (P0)                (P0)

依赖关系:
Phase 1 是 Phase 2 的前置（需先有独立组件才能在 Manager 中渲染）
Phase 2 是 Phase 3 的前置（集成完成后才能测试）
```

### 7.1 Phase 1: 组件抽取 (P0)

> **前置**: 无
> **产出**: 各 Stage 页面的核心逻辑提取为独立可导入组件，原路由页面保持功能不变（作为 fallback）
> **对应设计**: Section 3, 5
> **适用规范**: 状态管理规范, 项目结构规范, 命名规范
> **规范要点**: PascalCase 组件命名 · Props 接口用 {Name}Props · 新组件放 components/panels/ · 标记 'use client'

- [ ] DT-001: 提取 DashboardContent 组件 (`文件: src/components/panels/DashboardContent.tsx`, 提取自 `src/app/page.tsx`)
  - 从 `app/page.tsx` 的 `DashboardContent` 函数（约 300 行）提取为独立组件
  - 组件无需接收 props（使用 context 获取数据）
  - 原 `app/page.tsx` 改为导入并渲染 `<DashboardContent />`（保持路由 fallback）
  - 验收标准:
    - [ ] `DashboardContent` 可独立导入和渲染
    - [ ] 原 Dashboard 路由 (`/`) 功能不变
    - [ ] 所有轮询（claude-processes, cli/status）正常工作
    - [ ] [规范] 组件导出名 PascalCase, 标记 'use client'
    - [ ] [规范] 新文件放 components/panels/ 子目录
    - [ ] Typecheck passes

- [ ] DT-002: 提取 Stage1Content 组件 (`文件: src/components/panels/Stage1Content.tsx`, 提取自 `src/app/stage1/page.tsx`)
  - 从 `app/stage1/page.tsx` 的 `Stage1PageContent`（约 1400 行）提取为独立组件
  - Props: `{ reqId: string }`（替代 `useSearchParams().get('req')`）
  - 原 `app/stage1/page.tsx` 改为: 从 searchParams 获取 reqId → 渲染 `<Stage1Content reqId={reqId} />`
  - 验收标准:
    - [ ] `Stage1Content` 接受 `reqId` prop 并正确渲染
    - [ ] 原 Stage 1 路由 (`/stage1?req=xxx`) 功能不变
    - [ ] 模式选择、金字塔问答、CLI 聊天全部正常
    - [ ] [规范] Props 接口使用 Stage1ContentProps 格式
    - [ ] [规范] 标记 'use client' 指令
    - [ ] Typecheck passes

- [ ] DT-003: 提取 Stage3Content 组件 (`文件: src/components/panels/Stage3Content.tsx`, 提取自 `src/app/stage3/page.tsx`)
  - 从 `app/stage3/page.tsx` 的 `Stage3PageContent`（约 1000 行）提取为独立组件
  - Props: `{ reqId: string }`
  - 原路由页面保持 fallback
  - 验收标准:
    - [ ] `Stage3Content` 接受 `reqId` prop 并正确渲染
    - [ ] 原 Stage 3 路由功能不变（Agent 监控、日志、进度条）
    - [ ] 轮询和文件监听正常
    - [ ] Typecheck passes

- [ ] DT-004: 提取 Stage4Content 组件 (`文件: src/components/panels/Stage4Content.tsx`, 提取自 `src/app/stage4/page.tsx`)
  - 从 `app/stage4/page.tsx` 的 `Stage4PageContent`（约 600 行）提取为独立组件
  - Props: `{ reqId: string }`
  - 原路由页面保持 fallback
  - 验收标准:
    - [ ] `Stage4Content` 接受 `reqId` prop 并正确渲染
    - [ ] 原 Stage 4 路由功能不变
    - [ ] Typecheck passes

- [ ] DT-005a: 提取 Stage2Content 组件 (`文件: src/components/panels/Stage2Content.tsx`, 提取自 `src/app/stage2/page.tsx`)
  - 从 `app/stage2/page.tsx` 的 `Stage2PageContent`（约 260 行）提取为独立组件
  - Props: `{ reqId: string }`
  - 原路由页面保持 fallback
  - 验收标准:
    - [ ] `Stage2Content` 接受 `reqId` prop 并正确渲染
    - [ ] 原 Stage 2 路由 (`/stage2?req=xxx`) 功能不变（规范检查、自动富化、对抗审查）
    - [ ] Typecheck passes

- [ ] DT-005: 提取 Stage5Content 组件 (`文件: src/components/panels/Stage5Content.tsx`, 提取自 `src/app/stage5/page.tsx`)
  - 从 `app/stage5/page.tsx` 的 `Stage5PageContent`（约 480 行）提取为独立组件
  - Props: `{ reqId: string }`
  - 原路由页面保持 fallback
  - 验收标准:
    - [ ] `Stage5Content` 接受 `reqId` prop 并正确渲染
    - [ ] 原 Stage 5 路由功能不变
    - [ ] Typecheck passes

- [ ] DT-006: 创建 StageRouter 辅助组件 (`文件: src/components/panels/StageRouter.tsx`)
  - 根据 `stage` 数字动态选择渲染对应 StageContent 组件
  - Props: `{ reqId: string, stage: number }`
  - Stage 映射：`{ 0: Stage1Content, 1: Stage1Content, 2: Stage2Content, 3: Stage3Content, 4: Stage4Content, 5: Stage5Content }`
  - 注意：Stage 2 有独立页面 (`/stage2/page.tsx`)，不再映射到 Stage 3
  - 验收标准:
    - [ ] `StageRouter` 根据 stage 正确渲染对应组件
    - [ ] Stage 0/1 → Stage1Content, Stage 2 → Stage2Content, Stage 3 → Stage3Content, Stage 4 → Stage4Content, Stage 5 → Stage5Content
    - [ ] Typecheck passes

### 7.2 Phase 2: TabPanelManager + 切换逻辑 (P0)

> **前置**: Phase 1
> **产出**: Tab 切换从路由导航改为 CSS 显示/隐藏，Dashboard 常驻
> **对应设计**: Section 3
> **适用规范**: 状态管理规范, 项目结构规范, 命名规范, 样式规范
> **规范要点**: Context hook 含 null check · localStorage 用 scopedKey() · 弹窗背景白色 bg-white · 按钮 bg-neutral-900

- [ ] DT-007: 创建 TabPanelManager 组件 (`文件: src/components/TabPanelManager.tsx`)
  - 从 TabContext 读取 `tabs` 和 `activeTabId`
  - 始终渲染 `<DashboardContent />`，通过 `display: activeTabId === 'dashboard' ? 'block' : 'none'` 控制可见性
  - 为每个 Tab 渲染 `<div style={{ display: tab.id === activeTabId ? 'block' : 'none' }}>` 包裹的 `<StageRouter reqId={tab.id} stage={tab.stage} />`
  - 当 Tab 从 `tabs` 数组移除时，对应面板自动卸载（React 自然 unmount）
  - 每个面板使用 `key={tab.id}` 确保独立实例
  - 验收标准:
    - [ ] Dashboard 始终渲染，仅通过 CSS 隐藏/显示
    - [ ] 项目 Tab 通过 CSS 切换，组件不卸载
    - [ ] 新打开的 Tab 动态挂载对应 Stage 组件
    - [ ] 关闭的 Tab 对应组件被 React 卸载
    - [ ] [规范] Context hook (useTab) 包含 null check
    - [ ] [规范] 样式使用 Tailwind 工具类
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-008: 修改 layout.tsx 集成 TabPanelManager (`文件: src/app/layout.tsx`)
  - 将 `<Main>{children}</Main>` 替换为 `<Main><TabPanelManager>{children}</TabPanelManager></Main>`
  - TabPanelManager 路由判断逻辑：
    - **托管路由**（`/`、`/stage1`、`/stage2`、`/stage3`、`/stage4`、`/stage5` 带有效 `?req=`）：使用面板模式（CSS 切换），隐藏 `{children}`
    - **非托管路由**（`/rules`、其他未知路由、stage 路由无 `?req=` 参数）：隐藏所有面板，显示 `{children}`（Next.js 路由 fallback）
    - 通过检查 `pathname` 和 `searchParams` 判断是否为托管路由
  - 验收标准:
    - [ ] TabPanelManager 正确集成到 layout
    - [ ] 通过 TabBar 切换时使用面板模式（CSS 切换）
    - [ ] 访问 `/rules` 页面时正确显示 `{children}`，面板全部隐藏
    - [ ] 直接访问 `/stage3?req=xxx`（有效 reqId）时使用面板模式
    - [ ] 直接访问 `/stage3`（无 req）时显示 `{children}` fallback
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-009: 修改 TabContext.switchTab 移除 router.push (`文件: src/contexts/TabContext.tsx`)
  - `switchTab` 改为: 设置 `activeTabId` + `history.replaceState(null, '', url)` 同步 URL（不新增历史记录）
  - `openTab` 改为: 将新 Tab 加入 tabs 数组 + 设置 `activeTabId` + `history.replaceState`（不再 `router.push`）
  - `closeTab` 改为: 关闭后切回 Dashboard 时用 `history.replaceState(null, '', '/')`
  - 移除 pathname sync effect（不再需要，因为不走路由了）
  - 移除对 `useRouter` 的依赖
  - **历史管理策略**: 统一使用 `replaceState`，Tab 切换不产生浏览器历史记录。浏览器前进/后退按钮仅在 Tab 内部导航时生效（如 Stage 内的子页面跳转），Tab 间切换不影响浏览器历史栈。
  - **reqId 格式校验**: 所有 `req` 参数必须通过 UUID 格式校验（`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`），非法值忽略并回退到 Dashboard
  - 验收标准:
    - [ ] Tab 切换不触发 Next.js 路由导航
    - [ ] URL 栏正确反映当前 Tab 对应的路径
    - [ ] 浏览器前进/后退按钮不会导致 Tab 间跳转（replaceState 不影响历史栈）
    - [ ] 非 UUID 格式的 req 参数被忽略，页面不崩溃
    - [ ] [规范] localStorage key 使用 scopedKey() 前缀
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-010: 修改 TabBar 关闭确认逻辑 (`文件: src/components/TabBar.tsx`)
  - 所有 Tab（不只是运行中的）关闭时弹窗确认
  - Dashboard Tab 不显示关闭按钮（始终常驻）
  - 确认弹窗文案根据 Tab 状态区分：运行中显示"Agent 正在运行"，空闲显示"确认关闭"
  - 验收标准:
    - [ ] 关闭任何 Tab 都弹出确认 Dialog
    - [ ] Dashboard 无关闭按钮
    - [ ] 确认后 Tab 关闭、面板卸载
    - [ ] [规范] 确认弹窗使用 shadcn Dialog, 背景白色 bg-white
    - [ ] [规范] 按钮配色遵循样式规范 (bg-neutral-900)
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-011: Tab 切换时 stage 变更检测与面板更新 (`文件: src/components/TabPanelManager.tsx`)
  - 当项目从 Stage 1 推进到 Stage 3 时，TabPanelManager 需要响应 `tab.stage` 变化
  - StageRouter 根据最新 `tab.stage` 渲染对应组件
  - 阶段变化时卸载旧组件、挂载新组件（通过 `key={tab.id + '-' + tab.stage}` 实现）
  - 验收标准:
    - [ ] 项目推进到下一阶段时，面板自动切换到对应 Stage 组件
    - [ ] 旧 Stage 组件被卸载，新 Stage 组件挂载
    - [ ] Typecheck passes

### 7.3 Phase 3: F5 状态恢复 + 回归测试 (P0)

> **前置**: Phase 2
> **产出**: 刷新恢复 + 确保所有现有功能正常
> **对应设计**: Section 3
> **适用规范**: 状态管理规范, 前端测试
> **规范要点**: localStorage 读取防 SSR (typeof window) · scopedKey() 前缀 · 边界状态覆盖 · 条件等待代替 sleep

- [ ] DT-012: F5 刷新后 Tab 面板恢复 (`文件: src/components/TabPanelManager.tsx`, `src/contexts/TabContext.tsx`)
  - 页面刷新后，TabContext 从 localStorage 加载 tabs + activeTabId
  - TabPanelManager 根据加载的 tabs 重新挂载所有面板
  - 活跃 Tab 立即显示，非活跃 Tab 在后台挂载
  - 各 Stage 组件的内部状态通过 RequirementContext（localStorage 持久化）恢复
  - **Hydration 防闪烁**: TabPanelManager 在 localStorage 加载完成前显示轻量占位（如空白或骨架屏），避免先渲染 Dashboard 再跳转到活跃 Tab 的闪烁
  - **状态恢复范围**: Tab 列表 + activeTabId + RequirementContext 中的持久化字段（pipelineMode、prdSessionId 等）自动恢复。滚动位置和临时表单输入（未持久化的 useState）不在恢复范围内。
  - 验收标准:
    - [ ] F5 后所有之前打开的 Tab 重新出现
    - [ ] 活跃 Tab 立即显示正确内容，无 Dashboard→活跃Tab 的闪烁跳变
    - [ ] Stage 1 的模式选择状态正确恢复（不重置到选择页面）
    - [ ] Stage 3 的 Agent 状态和进度从 API 重新加载（轮询自动恢复）
    - [ ] Dashboard 数据从 API 重新加载（项目列表、CLI 状态）
    - [ ] [规范] localStorage 读取检查 typeof window 防 SSR 报错
    - [ ] [规范] localStorage key 使用 scopedKey() 前缀
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-013: 直接 URL 访问 fallback (`文件: src/components/TabPanelManager.tsx`)
  - 用户直接访问 `/stage3?req=xxx` 时：
    - **reqId 校验**: 先验证 `xxx` 是否为合法 UUID 格式，非法值忽略并显示 Dashboard
    - 如果 `xxx` 已在 tabs 中，激活该 Tab
    - 如果 `xxx` 不在 tabs 中，查询 RequirementContext 确认项目存在后自动添加并激活
    - 如果项目不存在/已删除，显示错误提示并提供"返回 Dashboard"按钮
    - 如果没有 `?req=` 参数，显示 Next.js 路由 children fallback
  - **异常状态处理**:
    - 加载中：显示 loading 骨架屏
    - 项目不存在：显示"项目未找到"提示 + 返回 Dashboard 按钮
    - reqId 格式非法：静默忽略，显示 Dashboard
  - 验收标准:
    - [ ] 直接 URL 访问正确打开对应 Tab
    - [ ] 分享 URL 给他人时能正确打开
    - [ ] 无效 reqId 不会导致页面崩溃或无限加载
    - [ ] 项目不存在时显示友好提示
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-014: 回归测试与清理
  - 验证所有 Stage 的核心功能在新架构下正常工作（Stage 2 无独立页面，通过 Stage 3 页面访问）
  - 验证 Tab 切换性能 <200ms
  - 验证后台 Tab 轮询继续运行
  - 清理不再需要的 pathname sync effect 和其他遗留代码
  - 验收标准:
    - [ ] Dashboard: 项目列表、创建项目、CLI 状态正常
    - [ ] Stage 1: 模式选择、金字塔问答、CLI 聊天正常
    - [ ] Stage 3: Agent 监控、日志流、进度条正常
    - [ ] Stage 4: 测试验证界面正常
    - [ ] Stage 5: 合并发布界面正常
    - [ ] Tab 切换无页面闪烁
    - [ ] 后台 Tab 轮询未中断
    - [ ] Typecheck passes
    - [ ] Verify in browser

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `src/components/panels/DashboardContent.tsx` | 新建 | Phase 1 | DT-001 |
| `src/components/panels/Stage1Content.tsx` | 新建 | Phase 1 | DT-002 |
| `src/components/panels/Stage3Content.tsx` | 新建 | Phase 1 | DT-003 |
| `src/components/panels/Stage4Content.tsx` | 新建 | Phase 1 | DT-004 |
| `src/components/panels/Stage2Content.tsx` | 新建 | Phase 1 | DT-005a |
| `src/components/panels/Stage5Content.tsx` | 新建 | Phase 1 | DT-005 |
| `src/components/panels/StageRouter.tsx` | 新建 | Phase 1 | DT-006 |
| `src/components/TabPanelManager.tsx` | 新建 | Phase 2 | DT-007, DT-011, DT-012, DT-013 |
| `src/app/layout.tsx` | 修改 | Phase 2 | DT-008 |
| `src/contexts/TabContext.tsx` | 修改 | Phase 2 | DT-009 |
| `src/components/TabBar.tsx` | 修改 | Phase 2 | DT-010 |
| `src/app/page.tsx` | 修改 | Phase 1 | DT-001 |
| `src/app/stage1/page.tsx` | 修改 | Phase 1 | DT-002 |
| `src/app/stage2/page.tsx` | 修改 | Phase 1 | DT-005a |
| `src/app/stage3/page.tsx` | 修改 | Phase 1 | DT-003 |
| `src/app/stage4/page.tsx` | 修改 | Phase 1 | DT-004 |
| `src/app/stage5/page.tsx` | 修改 | Phase 1 | DT-005 |

### B. 风险与缓解措施

#### HIGH
- **Stage 页面提取可能破坏现有功能**: 各 Stage 页面内部依赖 `useSearchParams()` 获取 reqId，提取后改为 props 传入，可能遗漏某些内部引用
  → **缓解**: 保留原路由页面作为 fallback 入口，逐步验证每个 Stage 的完整功能

#### MEDIUM
- **后台多 Tab 轮询增加 API 压力**: 每个后台 Tab 的轮询（claude-processes 2s, cli/status 5s）持续运行，Tab 数量增多时 API 请求量线性增长
  → **缓解**: 本期保持全速轮询以满足"后台完全活跃"目标。如实际部署后观察到 API 压力问题，后续版本可添加自适应节流（后台 Tab 降频、Tab 数量上限等）。

#### LOW
- **内存占用随 Tab 数量线性增长**: 每个 Tab 的 DOM 保留在内存中
  → **缓解**: 暂不限制 Tab 数量，未来可添加 LRU 驱逐策略

### D. 非目标 (Out of Scope)

- Tab 拖拽排序
- Tab 分屏/平铺（同时显示多个 Tab 内容）
- 自定义 Tab 图标/颜色
- Lazy loading 优化（首次打开 Tab 时的加载优化）
- Tab 数量限制/LRU 驱逐
- 后端 API 变更
- Stage 页面内部业务逻辑修改（仅允许最小必要的参数来源改造：`useSearchParams` → `reqId` prop）
