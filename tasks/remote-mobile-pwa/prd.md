# PRD: BotoolAgent Remote Access + Mobile PWA

## 1. 项目概述

BotoolAgent Viewer 目前是纯桌面应用（localhost:3100/3101），无法从手机或外网访问，且未做移动端适配。本项目通过 Cloudflare Tunnel 安全暴露本机服务、对 Viewer 进行移动端响应式优化、并添加 PWA 支持，使用户可以在手机浏览器上完整操作 5 阶段开发工作流，并添加到主屏幕获得接近原生 App 的体验。

**核心目标：**
1. 手机浏览器可访问并操作完整 5 阶段工作流
2. 通过 Cloudflare Tunnel + Access 安全暴露本机服务
3. PWA 支持添加到主屏幕 + App Shell 缓存

## 3. 架构设计（概要）

```
────── 访问路径 ──────

  桌面电脑 (本地)              手机/平板/其他电脑
       │                              │
       │ http://localhost:3100        │ https://botool.domain.com
       │                              │
       │                       ┌──────▼──────────────────┐
       │                       │  Cloudflare Edge         │
       │                       │                          │
       │                       │  CF Access (零信任认证)   │
       │                       │  ↓ 验证通过              │
       │                       │  CF Tunnel (加密隧道)    │
       │                       └──────┬───────────────────┘
       │                              │ 加密隧道 (outbound)
       │                              │
┌──────▼──────────────────────────────▼──────────┐
│  Local Machine                                  │
│                                                 │
│  cloudflared (常驻进程)                          │
│      │                                          │
│      └──▶ Viewer :3100 或 :3101                 │
│           (响应式前端, API 不改动)                │
│               │                                 │
│         BotoolAgent Runtime                     │
│         (tmux + Claude CLI, 不改动)              │
│                                                 │
└─────────────────────────────────────────────────┘

────── 多端口 Tunnel 映射 ──────

单个 cloudflared 实例，多 ingress rule:

  botool.domain.com      → localhost:3100  (BotoolAgent 自身开发)
  project-a.domain.com   → localhost:3101  (项目 A 的 BotoolAgent)
  project-b.domain.com   → localhost:3101  (项目 B，需先切换)

端口检测逻辑 (现有):
  [ -d BotoolAgent/viewer ] && echo 3101 || echo 3100
  • BotoolAgent 自身仓库 → viewer/ 在根目录 → 3100
  • BotoolAgent 安装在其他项目 → BotoolAgent/viewer/ 子目录 → 3101

────── 移动端 UI 策略 ──────

断点策略 (Tailwind v4 默认):
  • < 768px (md:) → 移动端布局 (单列 + Tab 切换)
  • ≥ 768px → 平板/桌面布局 (多列, 现有布局)

Stage 3 三栏 → 移动端 Tab 切换:
  Desktop: [TaskList | Content | AgentData]
  Mobile:  Tab: [任务] [进度] [数据]  ← 底部 Tab 栏

Stage 5 两栏 → 移动端垂直堆叠:
  Desktop: [Changes | PR Summary]
  Mobile:  Tab: [变更] [PR]

FlowChart: 移动端直接隐藏，只显示任务列表+进度条
```

## 5. UI 设计（概要）

### 5.1 需修改的组件清单

| 组件 | 文件路径 | 改动类型 | 说明 |
|------|---------|----------|------|
| Root Layout | `src/app/layout.tsx` | 修改 | 添加 viewport meta, PWA manifest link |
| Header | `src/components/Header.tsx` | 修改 | 移动端 hamburger menu, 隐藏 repo name |
| Stage 1 Page | `src/app/stage1/layout.tsx` | 修改 | 左侧栏 → drawer, 竖屏单列 |
| Stage 2 Page | `src/app/stage2/page.tsx` | 修改 | 容器宽度响应式 |
| Stage 3 Page | `src/app/stage3/page.tsx` | 修改 | 三栏 → Tab 切换, 隐藏 FlowChart |
| Stage 4 Page | `src/app/stage4/page.tsx` | 修改 | 日志面板响应式 |
| Stage 5 Page | `src/app/stage5/page.tsx` | 修改 | 两栏 → Tab 切换 |
| FlowChart | `src/components/FlowChart/FlowChart.tsx` | 修改 | 添加 `hidden md:block` |
| BatchPanel | `src/components/BatchPanel.tsx` | 修改 | grid 响应式 (1col mobile) |
| MobileTabBar | `src/components/MobileTabBar.tsx` | **新建** | 移动端底部 Tab 栏组件 |

### 5.2 新增文件

| 文件 | 用途 |
|------|------|
| `viewer/public/manifest.json` | PWA Web App Manifest |
| `viewer/public/sw.js` | Service Worker (App Shell 缓存) |
| `viewer/public/icons/icon-192.png` | PWA 图标 192x192 |
| `viewer/public/icons/icon-512.png` | PWA 图标 512x512 |
| `scripts/tunnel.sh` | Tunnel 启停脚本 |
| `scripts/tunnel-config.yml` | Tunnel 配置模板 |
| `skills/BotoolAgent/Tunnel/SKILL.md` | /botoolagent-tunnel Skill |

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 3 (Skill 依赖 Tunnel 基础)
CF 基础
(P0)

Phase 2 ── (独立, 可与 Phase 1 并行)
Viewer 响应式
(P0)

Phase 3
PWA + Tunnel Skill
(P1)
```

### 7.1 Phase 1: Cloudflare Tunnel 基础设施 (P0)

> **前置**: 无
> **产出**: 可通过 CF Tunnel 从外网访问 localhost Viewer
> **对应设计**: Section 3 架构设计

- [ ] DT-001: Tunnel 配置模板 + 多 ingress 支持 (`文件: scripts/tunnel-config.yml`)
  - 创建 cloudflared 配置文件模板（YAML 格式）
  - 支持多 ingress rule（不同子域名 → 不同本地端口）
  - 包含 catch-all 404 规则
  - 包含注释说明每个配置项的用途
  - AC:
    - [ ] 配置文件包含 `tunnel:`, `credentials-file:`, `ingress:` 字段
    - [ ] 支持多个 hostname → localhost:port 映射
    - [ ] 有 `service: http_status:404` 的 catch-all 规则
    - [ ] Typecheck passes

- [ ] DT-002: Tunnel 启停脚本 (`文件: scripts/tunnel.sh`)
  - 创建 bash 脚本支持 `start`, `stop`, `status`, `add-project` 子命令
  - `start`: 启动 cloudflared tunnel，使用 scripts/tunnel-config.yml
  - `stop`: 优雅停止 cloudflared 进程（SIGTERM）
  - `status`: 检查 tunnel 是否运行 + 显示映射的 URL
  - `add-project`: 向 tunnel-config.yml 添加新的 ingress 规则
  - 自动检测端口（复用现有 `[ -d BotoolAgent/viewer ]` 逻辑）
  - PID 文件管理（`.state/tunnel-pid`）
  - AC:
    - [ ] `scripts/tunnel.sh start` 能启动 cloudflared
    - [ ] `scripts/tunnel.sh stop` 能优雅停止
    - [ ] `scripts/tunnel.sh status` 显示运行状态和 URL
    - [ ] `scripts/tunnel.sh add-project <subdomain> <port>` 追加 ingress 规则
    - [ ] PID 文件正确写入和清理
    - [ ] Typecheck passes

- [ ] DT-003: BotoolAgent.sh 集成 (`文件: scripts/BotoolAgent.sh`)
  - 在 BotoolAgent.sh 启动流程中添加 tunnel 自动启动逻辑
  - 检测 `scripts/tunnel-config.yml` 是否存在 → 存在则自动调用 `scripts/tunnel.sh start`
  - 在 BotoolAgent.sh 退出时调用 `scripts/tunnel.sh stop`（使用 trap）
  - 添加 `--no-tunnel` 参数跳过 tunnel 启动
  - AC:
    - [ ] BotoolAgent.sh 启动时如有 tunnel 配置则自动启动 tunnel
    - [ ] BotoolAgent.sh 退出时自动停止 tunnel
    - [ ] `--no-tunnel` 参数可跳过 tunnel
    - [ ] 无 tunnel-config.yml 时静默跳过，不报错
    - [ ] Typecheck passes

- [ ] DT-004: CF Access 配置指南 (`文件: scripts/tunnel-config.yml 注释 + SKILL.md 内嵌`)
  - 在 Tunnel Skill（DT-016）中内嵌 CF Access 配置步骤（不单独建文件）
  - 覆盖：创建 CF 账号 → 添加域名 → 创建 Tunnel → 配置 Access Policy
  - 包含 Email OTP 认证方式的具体配置命令
  - AC:
    - [ ] Skill 文档中有完整的 CF Access 配置步骤
    - [ ] 包含 `cloudflared tunnel create` 命令示例
    - [ ] 包含 CF Dashboard Access Policy 配置步骤
    - [ ] Typecheck passes

### 7.2 Phase 2: Viewer 响应式优化 (P0)

> **前置**: 无（可与 Phase 1 并行）
> **产出**: Viewer 在 < 768px 设备上可正常使用所有 5 个 Stage
> **对应设计**: Section 5 UI 设计

- [ ] DT-005: viewport meta + 移动端基础设置 (`文件: src/app/layout.tsx, src/app/globals.css`)
  - 在 layout.tsx 添加 `export const viewport: Viewport` 配置
  - 设置 `width: 'device-width', initialScale: 1`
  - 在 globals.css 中添加 `-webkit-tap-highlight-color: transparent`
  - 添加 `touch-action: manipulation` 到 body（禁止双击缩放）
  - AC:
    - [ ] 手机浏览器不再按桌面宽度渲染
    - [ ] 无双击缩放行为
    - [ ] Verify in browser (Chrome DevTools 移动端模拟)
    - [ ] Typecheck passes

- [ ] DT-006: Header 移动端适配 (`组件: Header.tsx`)
  - < 768px 时隐藏 repo name 和 version badge
  - Tab 栏在 < 768px 时改为可横向滚动（`overflow-x-auto`）
  - 或改为 hamburger menu（Sheet 组件从左侧滑出）
  - Logo 和核心导航保持可见
  - AC:
    - [ ] < 768px 时 Header 不溢出屏幕
    - [ ] 所有 Tab 仍然可达（通过滚动或 menu）
    - [ ] 桌面端布局不受影响
    - [ ] Verify in browser
    - [ ] Typecheck passes

- [ ] DT-007: Stage 1 响应式布局 (`文件: src/app/stage1/layout.tsx`)
  - < 768px 时隐藏左侧 PyramidNavigation 侧栏（`hidden md:block`）
  - 添加一个简化的移动端层级指示器（如顶部进度条或小型 Tab）
  - 问答面板占满全宽
  - AC:
    - [ ] 移动端无水平溢出
    - [ ] 用户仍可看到当前问答层级
    - [ ] 桌面端左侧栏正常显示
    - [ ] Verify in browser
    - [ ] Typecheck passes

- [ ] DT-008: Stage 2 响应式布局 (`文件: src/app/stage2/page.tsx`)
  - `max-w-4xl` 改为响应式 (`max-w-4xl` → `w-full max-w-4xl px-4`)
  - Pipeline 步骤卡片在移动端改为单列
  - EnrichmentSummary grid 在移动端改为 2 列（`grid-cols-2 md:grid-cols-6`，已部分实现）
  - AC:
    - [ ] 移动端内容不被截断
    - [ ] Pipeline 步骤在小屏可正常操作
    - [ ] Verify in browser
    - [ ] Typecheck passes

- [ ] DT-009: Stage 3 响应式布局 — 三栏转 Tab (`文件: src/app/stage3/page.tsx, 新建: src/components/MobileTabBar.tsx`)
  - **这是最关键的改动**
  - 新建 MobileTabBar 组件：底部 Tab 栏，3 个 Tab（任务/进度/数据）
  - < 768px 时：
    - 隐藏左侧 `w-[240px]` 任务列表面板
    - 隐藏右侧 `w-[260px]` AgentData 面板
    - 中间内容区全宽
    - 底部显示 MobileTabBar
    - Tab "任务" → 显示任务列表（全宽）
    - Tab "进度" → 显示 BatchPanel + ProgressStrip（隐藏 FlowChart）
    - Tab "数据" → 显示 AgentDataPanel（全宽）
  - ≥ 768px 时：保持现有三栏布局
  - MobileTabBar 使用 shadcn/ui 样式 + 固定在底部 (`fixed bottom-0`)
  - AC:
    - [ ] 移动端三栏正确折叠为 Tab 切换
    - [ ] FlowChart 在移动端不渲染
    - [ ] 所有信息仍可通过 Tab 切换访问
    - [ ] 桌面端三栏布局不受影响
    - [ ] MobileTabBar 固定在底部，不遮挡内容
    - [ ] Verify in browser
    - [ ] Typecheck passes

- [ ] DT-010: Stage 4 响应式布局 (`文件: src/app/stage4/page.tsx`)
  - 日志面板在移动端改为全宽 + 可滚动
  - 字体大小在移动端适当放大（`text-xs md:text-xs` → `text-sm md:text-xs`）
  - 测试结果卡片单列排列
  - AC:
    - [ ] 日志内容在移动端可读
    - [ ] 不出现水平溢出
    - [ ] Verify in browser
    - [ ] Typecheck passes

- [ ] DT-011: Stage 5 响应式布局 (`文件: src/app/stage5/page.tsx`)
  - < 768px 时：两栏转 Tab 切换（复用 MobileTabBar 思路）
    - Tab "变更" → ChangeSummary + CompletionSummary
    - Tab "PR" → PR Summary + Merge 按钮
  - 右侧 `w-[420px]` 固定宽度改为响应式 (`w-[420px]` → `w-full md:w-[420px]`)
  - AC:
    - [ ] 移动端两栏正确折叠
    - [ ] Merge 按钮在移动端可达且触摸友好
    - [ ] 桌面端两栏布局不受影响
    - [ ] Verify in browser
    - [ ] Typecheck passes

- [ ] DT-012: 触屏交互优化 (`文件: 全局, src/app/globals.css`)
  - 为所有可点击元素添加 `:active` 状态反馈（`active:scale-[0.98]` 或 `active:bg-neutral-200`）
  - 确保所有按钮最小触摸区域 44x44px（`min-h-[44px] min-w-[44px]`）
  - BatchPanel teammate 卡片 grid 在移动端改为单列（`grid-cols-1 md:grid-cols-2 lg:grid-cols-4`）
  - 移动端隐藏 hover-only 提示，改用常驻显示或点击展开
  - AC:
    - [ ] 所有按钮在触摸时有视觉反馈
    - [ ] 无 44px 以下的点击目标
    - [ ] BatchPanel 移动端不溢出
    - [ ] Verify in browser (touch simulation)
    - [ ] Typecheck passes

### 7.3 Phase 3: PWA 支持 + Tunnel Skill (P1)

> **前置**: Phase 1（Tunnel Skill 依赖 tunnel 基础脚本）
> **产出**: 可添加到 iPhone 主屏幕 + /botoolagent-tunnel 交互式配置
> **对应设计**: Section 3, 5

- [ ] DT-013: PWA Manifest + 图标 (`文件: viewer/public/manifest.json, viewer/public/icons/`)
  - 创建 Web App Manifest（name, short_name, icons, start_url, display, theme_color）
  - `display: "standalone"` 获得无浏览器 UI 的体验
  - `theme_color` 和 `background_color` 使用 Rock 色系（neutral）
  - 生成 192x192 和 512x512 PNG 图标（可用现有 logo 缩放）
  - 在 layout.tsx 添加 `<link rel="manifest" href="/manifest.json">`
  - 添加 Apple 特有 meta tags（`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`）
  - AC:
    - [ ] Chrome DevTools → Application → Manifest 无错误
    - [ ] iOS Safari 可看到 "添加到主屏幕" 选项
    - [ ] 从主屏幕打开时无浏览器地址栏
    - [ ] Typecheck passes

- [ ] DT-014: Service Worker — App Shell 缓存 (`文件: viewer/public/sw.js, src/app/layout.tsx`)
  - 创建最小 Service Worker：仅缓存 App Shell（HTML, CSS, JS, 图标）
  - 使用 Cache-First 策略（静态资源从缓存加载，API 请求始终走网络）
  - 在 layout.tsx 中注册 Service Worker（`navigator.serviceWorker.register('/sw.js')`）
  - 版本管理：缓存名含版本号，新版本时自动清除旧缓存
  - AC:
    - [ ] 首次加载后静态资源从缓存加载（Network tab 可见）
    - [ ] API 请求不被缓存（始终走网络）
    - [ ] 断网时显示缓存的 App Shell（而非 Chrome 恐龙页）
    - [ ] Typecheck passes

- [ ] DT-015: /botoolagent-tunnel Skill (`文件: skills/BotoolAgent/Tunnel/SKILL.md`)
  - 创建新 Skill：`/botoolagent-tunnel`
  - 交互式引导完整配置流程：
    1. 检测 cloudflared 是否安装 → 未安装则引导 `brew install cloudflared`
    2. 检测是否已登录 → 未登录则引导 `cloudflared tunnel login`
    3. 引导创建 tunnel → `cloudflared tunnel create botool`
    4. 自动生成 `scripts/tunnel-config.yml`
    5. 引导配置 CF Access（Dashboard 步骤说明）
    6. 测试连接 → `scripts/tunnel.sh start` + 验证
  - 支持子命令：`/botoolagent-tunnel setup`, `/botoolagent-tunnel start`, `/botoolagent-tunnel stop`
  - AC:
    - [ ] SKILL.md 包含完整的 YAML frontmatter（name, description, user-invocable: true）
    - [ ] 从零配置到可访问的完整引导流程
    - [ ] 包含 CF Access 配置步骤（Email OTP 认证）
    - [ ] Typecheck passes

- [ ] DT-016: Tunnel 多端口 ingress 管理 (`文件: scripts/tunnel.sh, skills/BotoolAgent/Tunnel/SKILL.md`)
  - 在 tunnel.sh 的 `add-project` 命令中实现动态 ingress 管理
  - 自动检测当前 Viewer 端口（3100 或 3101）
  - 当添加新项目时，生成对应的子域名 → 端口映射
  - 更新 tunnel-config.yml 并重启 cloudflared（`cloudflared tunnel --config ... run`）
  - 在 Skill 中添加 `/botoolagent-tunnel add <subdomain>` 引导
  - AC:
    - [ ] `tunnel.sh add-project myapp 3101` 正确追加 ingress 规则
    - [ ] 重启后新映射生效
    - [ ] 不影响已有映射
    - [ ] Typecheck passes

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `scripts/tunnel-config.yml` | 新建 | Phase 1 | DT-001 |
| `scripts/tunnel.sh` | 新建 | Phase 1 | DT-002, DT-016 |
| `scripts/BotoolAgent.sh` | 修改 | Phase 1 | DT-003 |
| `viewer/src/app/layout.tsx` | 修改 | Phase 2, 3 | DT-005, DT-013, DT-014 |
| `viewer/src/app/globals.css` | 修改 | Phase 2 | DT-005, DT-012 |
| `viewer/src/components/Header.tsx` | 修改 | Phase 2 | DT-006 |
| `viewer/src/app/stage1/layout.tsx` | 修改 | Phase 2 | DT-007 |
| `viewer/src/app/stage2/page.tsx` | 修改 | Phase 2 | DT-008 |
| `viewer/src/app/stage3/page.tsx` | 修改 | Phase 2 | DT-009 |
| `viewer/src/components/MobileTabBar.tsx` | **新建** | Phase 2 | DT-009 |
| `viewer/src/app/stage4/page.tsx` | 修改 | Phase 2 | DT-010 |
| `viewer/src/app/stage5/page.tsx` | 修改 | Phase 2 | DT-011 |
| `viewer/src/components/BatchPanel.tsx` | 修改 | Phase 2 | DT-012 |
| `viewer/src/components/FlowChart/FlowChart.tsx` | 修改 | Phase 2 | DT-009 |
| `viewer/public/manifest.json` | 新建 | Phase 3 | DT-013 |
| `viewer/public/sw.js` | 新建 | Phase 3 | DT-014 |
| `viewer/public/icons/icon-192.png` | 新建 | Phase 3 | DT-013 |
| `viewer/public/icons/icon-512.png` | 新建 | Phase 3 | DT-013 |
| `skills/BotoolAgent/Tunnel/SKILL.md` | **新建** | Phase 3 | DT-015, DT-016 |

### B. 风险与缓解措施

#### HIGH
- **Stage 3 响应式改动影响桌面端**: 三栏转 Tab 是大改动，可能引入桌面端回归
  → **缓解**: 使用 `md:` 断点严格隔离，桌面端 CSS 完全不变。改动后在桌面端手动验证。

#### MEDIUM
- **iOS Safari PWA 限制**: 无后台刷新、无 Web Push 通知、Service Worker 行为不稳定
  → **缓解**: PWA 仅用于主屏图标 + App Shell 缓存，不依赖高级 PWA 功能。
- **CF Tunnel 断连**: 网络不稳定时 tunnel 可能断开
  → **缓解**: cloudflared 内建自动重连机制，加上 PID 监控脚本。

#### LOW
- **多端口 ingress 配置复杂度**: 用户可能不理解子域名 → 端口映射
  → **缓解**: Tunnel Skill 提供交互式引导，自动生成配置。

### C. 测试策略

#### 手动测试
- Chrome DevTools Device Mode 模拟 iPhone 14 (390x844)、iPad (768x1024)
- 真机 iOS Safari 测试 PWA 安装和使用体验
- 桌面端回归测试（确认所有 Stage 不受影响）

#### 自动化测试
- Playwright 移动端 viewport 测试（项目已有 Playwright 配置）
- 验证 < 768px 时 FlowChart 不渲染
- 验证 MobileTabBar 在移动端可见、桌面端隐藏

### D. 非目标 (Out of Scope)
- Telegram Bot / ClawBot — 不做通知和命令
- claw-gateway 守护进程 — 不做文件监听推送
- 云端 Relay / Mini App — 直接用 CF Tunnel
- 多用户 / 多设备支持 — 单用户场景
- Viewer 架构重构 — 只做响应式适配
- 离线操作能力 — PWA 仅缓存 App Shell，不支持离线执行
- iPhone 原生 App — PWA 已足够
