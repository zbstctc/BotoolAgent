# PRD: BotoolAgent Scanner — 项目结构智能可视化

## 1. 项目概述

### 1.1 背景与动机

BotoolAgent 是一个自主 AI 开发代理，部署在目标项目的根目录下协助开发。随着项目迭代，
开发者和非技术用户都面临一个问题：**难以快速了解当前项目有哪些模块、每个模块具体实现
了什么功能**——尤其是在经过多轮 PR 迭代后。

Scanner 是 BotoolAgent 的第二大功能模块，通过 Codex CLI 语义分析和 React Flow 交互式图谱，
让项目功能结构一目了然，并与最新 PR 联动高亮新增功能。

### 1.2 核心目标

1. 以交互式图谱展示项目模块层次和每个模块的具体功能列表（bullet points）
2. 通过 Codex CLI 本地语义分析提取功能描述，无需调用外部 AI API
3. 与最新 PR 联动：变更文件所属节点高亮绿色边框，新增功能标记 NEW badge
4. 缓存机制避免重复分析，内置 PR 更新检测与提示

### 1.3 成功指标

- 用户点击"开始分析"后，30-120 秒内呈现完整图谱
- 功能提取准确率：每个模块至少 3 条可辨识的具体功能描述
- PR NEW 标记：变更文件对应节点 100% 高亮

---

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| `@xyflow/react` | ✅ 已安装 | FlowChart 组件已使用，dagre 布局可复用 |
| `api/codex-review/route.ts` | ✅ 已有 | Codex CLI 读取 JSON 文件模式，可参考 spawn 模式 |
| `api/git/pr/route.ts` | ✅ 已有 | gh CLI 获取 PR 信息，PR 号读取逻辑可复用 |
| `components/FlowChart/` | ✅ 已有 | 现有工作流图谱，xyflow 集成模式可参考 |
| `TabBar.tsx` + `TabContext` | ✅ 已有 | utility tab（带 url）机制已存在，Rules 页面是先例 |
| `lib/project-root.ts` | ✅ 已有 | `getProjectRoot()` 返回项目根目录 |
| `DashboardContent` | ✅ 已有 | 入口卡片区域，Scanner 卡片在此新增 |

### 2.2 缺口分析

- 无 Scanner 入口卡片（Dashboard 需新增）
- 无 `/scanner` 路由和 ScannerPanel 组件
- 无 Codex CLI spawn 分析 API（现有 codex-review 是读文件，不是 spawn）
- 无 scan-result.json 数据结构和写入逻辑
- 无 FeatureNode 自定义节点类型（现有 CustomNode 专为工作流步骤设计）

---

## 3. 架构设计

### 3.1 分析管道概览

```
PROJECT_ROOT 目录
      │
      ├── 文件树 (find, 深度限制 max-depth=4)
      ├── README.md / README.mdx
      └── package.json / CLAUDE.md / go.mod / requirements.txt
            │
            ▼
    POST /api/scanner/analyze
            │
            ▼
       spawn codex CLI
    "分析此项目结构，提取每个模块的具体功能列表"
     输入: 文件树 + README + 关键配置文件内容
    要求 Codex 输出 JSON 格式:
     { nodes[], edges[] }
            │
       SSE 进度事件流
       { type: 'progress', message: '...' }
       { type: 'result', data: ScanResult }
       { type: 'error', message: '...' }
            │
            ▼
    写入 PROJECT_ROOT/.botoolagent-scan-result.json
            │
   ─────────┼────────────────────────────────
            │                  gh CLI 最新 PR 号
            ▼                        │
       React Flow              GET /api/scanner/status
        图谱画布          (同时返回 scan-result + 当前 PR 号)
            │                        │
            └──── PR 匹配 ────────────┘
                  changedFiles → node.changedInPR=true
                  绿色边框 + features[].isNew → NEW badge
```

### 3.2 模块关系

```
TabBar
  │
  ├── [Dashboard] ← 固定 Tab（已有）
  ├── [Scanner]   ← utility Tab（从 Dashboard 打开，可关闭）
  └── [项目 Tab...] ← 动态项目 Tab（已有）

TabPanelManager
  │
  ├── DashboardContent ← 已有，新增 Scanner 入口卡片
  ├── ScannerPanel     ← 新建，挂载于 /scanner 路由
  │     ├── ScannerFlowChart  ← 新建，核心图谱渲染
  │     │     └── FeatureNode ← 新建，自定义节点类型
  │     ├── ScannerToolbar    ← 新建，浮层工具栏
  │     └── ScannerErrorView  ← 新建，统一错误展示
  └── StageRouter ← 已有

API Routes（新建）：
  /api/scanner/analyze  POST - spawn Codex, SSE 流式返回
  /api/scanner/status   GET  - 读 scan-result.json + PR 检查
```

### 3.3 Scanner Tab 入口流程

```
Dashboard 页面
      │
   [Scanner 卡片] (新增至 DashboardContent)
      │
  用户点击
      │
      ▼
TabContext.openTab({
  id: 'scanner',
  name: 'Scanner',
  url: '/scanner',    ← utility tab 模式（已有基础设施支持）
  isUtility: true
})
      │
      ▼
TabBar 显示 [Scanner] Tab（可关闭）
TabPanelManager 渲染 /scanner 路由 → ScannerPanel
```

### 3.4 核心工作流

```
进入 /scanner 页面
      │
      ▼
GET /api/scanner/status
  ├── 有 scan-result.json → 加载缓存图谱
  │         │
  │         ▼
  │   调 gh CLI 检查最新 PR 号
  │         │
  │   ├── PR 号不匹配 → 顶部提示条 "发现 PR #N 更新，建议重新分析"
  │   └── PR 号匹配  → 正常显示图谱（已是最新）
  │
  └── 无 scan-result.json → 空状态面板
            + [开始分析] 按钮

用户点击 [开始分析] / [重新分析]
      │
      ▼
POST /api/scanner/analyze (SSE)
  "正在读取项目文件树..."
  "读取 README 和配置文件..."
  "调用 Codex 分析中 (可能需要 30-120 秒)..."
  "解析 Codex 输出..."
  "写入分析结果..."
      │
      ▼
渲染 React Flow 图谱
changedFiles 路径匹配 → 节点绿色边框 + NEW badge

错误路径:
  Codex 未安装 → ScannerErrorView（fatal，无法分析）
  Codex 分析失败 / JSON 解析失败 → ScannerErrorView（fatal，显示 sanitized 错误详情）
  非 git 目录 / gh CLI 未认证 → 降级模式（仍可分析，但 PR 联动不可用，工具栏提示）
```

---

## 4. 数据设计

### 4.1 scan-result.json 数据模型

**存储路径**: `PROJECT_ROOT/.botoolagent-scan-result.json`（隐藏文件，项目根目录，不在 tasks/ 内）

```typescript
// 完整类型定义（写入 viewer/src/types/scanner.ts）

export interface ScanResult {
  scannedAt: string;           // ISO 8601 时间戳
  projectRoot: string;         // 分析时的 PROJECT_ROOT 绝对路径
  prNumber: number | null;     // 分析时的最新 PR 号（无 PR 则 null）
  prTitle: string | null;      // PR 标题
  changedFiles: string[];      // PR 变更文件路径列表（相对于 projectRoot）
  nodes: ScanNode[];
  edges: ScanEdge[];
}

export interface ScanNode {
  id: string;                  // 唯一 ID，如 "root", "viewer", "viewer-src-components"
  label: string;               // 显示名称，如 "viewer/", "scripts/"
  type: 'root' | 'module' | 'submodule';
  path: string;                // 相对于 projectRoot 的路径
  description: string;         // 一句话模块描述（由 Codex 生成）
  features: FeatureItem[];     // 功能列表（由 Codex 生成）
  techStack: string[];         // 技术栈 badges，如 ["Next.js", "TypeScript"]
  changedInPR: boolean;        // 是否有文件在最新 PR 中变更
  children: string[];          // 子节点 id 列表
}

export interface FeatureItem {
  text: string;                // 功能描述，如 "红队对抗审查"
  isNew: boolean;              // 是否为本次 PR 新增功能
  relatedFiles: string[];      // 相关文件路径（可为空）
}

export interface ScanEdge {
  source: string;              // 源节点 id
  target: string;              // 目标节点 id
}
```

### 4.2 Codex CLI 调用 Prompt 设计

发送给 Codex 的 prompt 结构（存储在 API route 内）：

```
你是一个项目结构分析专家。请分析以下项目，提取每个主要模块的功能列表。

项目文件树:
<FILE_TREE>

README 内容:
<README_CONTENT>

主要配置文件:
<CONFIG_FILES>

请以 JSON 格式返回分析结果，格式如下:
{
  "nodes": [
    {
      "id": "模块唯一ID",
      "label": "模块名称（带斜杠如 viewer/）",
      "type": "root|module|submodule",
      "path": "相对路径",
      "description": "一句话描述此模块的用途",
      "features": [
        {
          "text": "具体功能描述（如：红队对抗审查、带上下文的点击重试）",
          "isNew": false,
          "relatedFiles": []
        }
      ],
      "techStack": ["技术1", "技术2"],
      "changedInPR": false,
      "children": ["子节点ID列表"]
    }
  ],
  "edges": [
    { "source": "父节点ID", "target": "子节点ID" }
  ]
}

要求:
- 每个模块至少提取 3-8 条具体功能（越具体越好，避免泛泛而谈）
- features.text 要描述实际功能，如"金字塔 6 层 PRD 问答"而非"问答功能"
- features.relatedFiles 必须填写该功能的关键实现文件（相对于 projectRoot，1-3 个文件）
  - 例: "红队对抗审查" → ["viewer/src/app/api/codex-review/route.ts"]
  - 若无法确定，填写该功能所在模块目录，如 ["viewer/src/components/Scanner/"]
- features.isNew 固定填写 false（isNew 由客户端根据 changedFiles 动态计算，见 §4.3）
- 层次结构由 AI 根据项目复杂度自行决定
- 文件树过大时，聚焦在 top-level 目录和关键子目录
```

### 4.3 changedFiles 路径匹配逻辑

```typescript
// PR 变更文件路径匹配到节点（segment-safe，防止 viewer/src2 误匹配 viewer/src）
function markChangedNodes(nodes: ScanNode[], changedFiles: string[]): ScanNode[] {
  return nodes.map(node => ({
    ...node,
    // root 节点不标记 changedInPR（BR-009: root 始终匹配所有文件，标记无意义）
    changedInPR: node.type !== 'root' && changedFiles.some(file =>
      file === node.path || file.startsWith(node.path + '/')
    ),
  }));
}

// features[].isNew 客户端推导（确定性规则，不依赖 Codex 输出）
// Codex 负责填写 relatedFiles；isNew 由客户端根据 changedFiles 计算
function deriveIsNew(features: FeatureItem[], changedFiles: string[]): FeatureItem[] {
  return features.map(feature => ({
    ...feature,
    isNew: feature.relatedFiles.some(rf =>
      changedFiles.some(cf => cf === rf || cf.startsWith(rf + '/'))
    ),
  }));
}
```

**推导规则**: `feature.isNew = feature.relatedFiles ∩ changedFiles ≠ ∅`
- `relatedFiles` 由 Codex CLI 在分析时填写（实现该功能的源文件列表）
- `isNew` 在客户端渲染时计算，不写入 scan-result.json（每次加载动态计算）
- 使用 segment-safe 比较，避免路径前缀误匹配（如 `src2` 误匹配 `src`）

---

## 5. UI 设计

### 5.1 页面清单

| 页面 | 路由 | 说明 | 状态 |
|------|------|------|------|
| Scanner 主页 | `/scanner` | ScannerPanel，全屏 React Flow | 新建 |
| Dashboard | `/` | 新增 Scanner 入口卡片 | 修改 |

### 5.2 组件清单

| 组件 | 文件路径 | Props 接口 | 状态 |
|------|---------|-----------|------|
| `ScannerPanel` | `components/Scanner/ScannerPanel.tsx` | 无（从 /api/scanner/status 自取数据） | 新建 |
| `ScannerFlowChart` | `components/Scanner/ScannerFlowChart.tsx` | `{ scanResult: ScanResult }` | 新建 |
| `FeatureNode` | `components/Scanner/FeatureNode.tsx` | `{ data: ScanNode }` (React Flow 节点数据) | 新建 |
| `ScannerToolbar` | `components/Scanner/ScannerToolbar.tsx` | `{ status, onAnalyze, onRefresh }` | 新建 |
| `ScannerErrorView` | `components/Scanner/ScannerErrorView.tsx` | `{ errorType: ScannerErrorType, detail?: string }` | 新建 |
| `ScannerCard` | 内联于 `DashboardContent.tsx` | 无 | 新建（内联） |

### 5.3 全屏 Scanner 面板布局

```
┌──────────────────────────────────────────────────────────────────┐
│  [Dashboard][Scanner ●][项目 Tab...]                             │  ← TabBar
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    【全屏 React Flow 画布】                       │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                                                          │  │
│   │           [Root: BotoolAgent]                            │  │
│   │               │              │                           │  │
│   │         [viewer/]        [skills/]    [scripts/]         │  │
│   │        ┌──────────┐    ┌──────────┐                      │  │
│   │        │📁 viewer/ │    │📝 skills/ │                     │  │
│   │        │──────────│    │──────────│                      │  │
│   │        │● 5阶段流程│    │● 红队检查 │                     │  │
│   │        │● React   │    │● PRD生成 │                      │  │
│   │        │  Flow图谱│    │● 开始开发│                      │  │
│   │        │──────────│    │──────────│                      │  │
│   │        │viewer/src│    │skills/...│                      │  │
│   │        └──────────┘    └──────────┘                      │  │
│   │                                                          │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ 右上角浮层工具栏                                         │   │
│   │ 📋 PR #42 · 上次分析: 5 分钟前          [重新分析]       │   │
│   │ ⚠️ 发现 PR #43 更新，建议重新分析       [立即分析]       │   │
│   └─────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 5.4 FeatureNode 节点设计

```
┌────────────────────────────────────┐  ┌─────────────────────────────────────┐
│  📁 viewer/                        │  │  📝 skills/  ← 绿色边框（PR 变更）  │
│  Next.js · TypeScript              │  │  Shell · Markdown                   │
│  ────────────────────────────────  │  │  ─────────────────────────────────  │
│  ● 5阶段 PRD 开发工作流             │  │  ● 红队对抗审查          [NEW]      │
│  ● 交互式 React Flow 图谱           │  │  ● 金字塔 6 层 PRD 问答              │
│  ● 实时 Agent 状态监控              │  │  ● 带上下文的点击重试                │
│  ● Codex 红队审查面板               │  │  ● 自动开发启动                     │
│  ────────────────────────────────  │  │  ─────────────────────────────────  │
│  viewer/src/                       │  │  skills/botoolagent-*/              │
└────────────────────────────────────┘  └─────────────────────────────────────┘

节点颜色规范:
  type=root:      bg-neutral-900 text-white（深色根节点）
  type=module:    bg-white border-neutral-200（普通模块）
  changedInPR:    bg-white border-green-400 border-2（PR 变更高亮）
  NEW badge:      bg-green-100 text-green-700 rounded text-xs px-1
```

### 5.5 空状态 + 进度展示

```
┌────────────────────────────────────────┐
│          🔍 项目扫描器                  │
│                                        │
│  分析 PROJECT_ROOT 的模块结构和功能    │
│  使用 Codex CLI 提取语义级功能列表     │
│                                        │
│           [开始分析]                   │
│                                        │
└────────────────────────────────────────┘

分析中状态:
┌────────────────────────────────────────┐
│  ⏳ 正在分析...                        │
│  ✅ 读取项目文件树                      │
│  ✅ 读取 README 和配置文件              │
│  ⏳ 调用 Codex 分析中 (30-120秒)...    │
│  ○  解析结果                           │
│  ○  生成图谱                           │
└────────────────────────────────────────┘
```

### 5.6 Dashboard Scanner 入口卡片

新增至 `DashboardContent.tsx` 的卡片区域：

```
┌────────────────────────────────────────┐
│  🔍 Scanner                            │
│  项目结构可视化                         │
│                                        │
│  查看项目模块功能图谱，                 │
│  与最新 PR 联动标记新增功能             │
│                                        │
│             [打开 Scanner]             │
└────────────────────────────────────────┘
```

---

## 6. 业务规则

### 6.1 缓存与更新规则

| ID | 规则 | 影响任务 |
|----|------|---------|
| BR-001 | 有 `.botoolagent-scan-result.json` 则直接渲染，不自动重分析 | DT-003, DT-005 |
| BR-002 | 进入 Scanner 时调 `gh CLI` 检查最新 PR 号，与缓存 `prNumber` 对比 | DT-009 |
| BR-003 | PR 号不匹配 → 顶部黄色提示条，包含 [立即分析] 按钮 | DT-008, DT-009 |
| BR-004 | 无 PR（本地仓库或无远程分支）→ 显示图谱但无 NEW 标记，工具栏显示 "无 PR 信息" | DT-008 |
| BR-005 | 分析进行中，[开始分析] 按钮禁用，防止重复触发 | DT-004, DT-008 |

### 6.2 NEW 标记规则

| ID | 规则 | 影响任务 |
|----|------|---------|
| BR-006 | `changedFiles` 中任一文件满足 `f === node.path \|\| f.startsWith(node.path + '/')` → `node.changedInPR = true`（segment-safe 匹配，防止 `src2` 误匹配 `src`） | DT-010 |
| BR-007 | `changedInPR=true` 的节点显示绿色边框（`border-green-400`） | DT-010 |
| BR-008 | `feature.isNew` 在客户端推导：`feature.relatedFiles` 与 `changedFiles` 有任意文件交集（segment-safe 比较）则为 `true`，显示绿色 NEW badge | DT-006, DT-010 |
| BR-009 | root 节点不标记 `changedInPR=true`（type=root 始终匹配所有文件，标记无意义） | DT-010 |

### 6.3 错误处理规则

**Fatal 错误**（显示 ScannerErrorView，无法继续分析）：

| 错误类型 | 触发条件 | 展示内容 |
|---------|---------|---------|
| `codex-not-installed` | `which codex` 失败 | "请安装 Codex CLI: npm install -g @openai/codex" |
| `analysis-failed` | spawn 进程非零退出 | "Codex 分析失败" + **sanitized** 错误摘要 + 展开面板（原始输出，截断至 2000 字符，屏蔽绝对路径） |
| `json-parse-error` | Codex 输出非 JSON / Zod 验证失败 | "Codex 输出格式异常" + **sanitized** 原始输出摘要（截断至 2000 字符）+ 展开面板 |

**降级模式**（分析继续，PR 联动不可用，工具栏静默提示）：

| 降级条件 | 触发条件 | 行为 |
|---------|---------|------|
| `git-not-repo` | `git rev-parse --git-dir` 失败 | 分析继续，工具栏显示"非 git 仓库，PR 联动不可用" |
| `gh-not-auth` | `gh auth status` 失败 / `gh` 未安装 | 分析继续，工具栏显示"GitHub CLI 未登录，PR 联动不可用" |

**stderr 脱敏规则**（适用于 `analysis-failed` 和 `json-parse-error` 错误）：
- 截断原始输出至最多 2000 字符
- 屏蔽绝对路径（替换为 `<path>` 占位符）
- 不暴露服务器内部文件结构或环境变量

### 6.4 文件树限制规则

| ID | 规则 |
|----|------|
| BR-010 | `find` 命令限制 `max-depth=4`，避免过深遍历 |
| BR-011 | 自动排除: `node_modules/`, `.git/`, `dist/`, `.next/`, `__pycache__/` |
| BR-012 | 文件树条目超过 500 行时，截断并在 prompt 中注明 |

---

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 (P0) ──▶ Phase 2 (P0) ──▶ Phase 3 (P1)
基础设施            核心图谱          PR联动+错误处理
DT-001~005        DT-006~008        DT-009~011

依赖关系:
  Phase 1 是 Phase 2/3 的前置（全部）
  Phase 3 DT-009  → 依赖 DT-005 (status API)    → 可与 Phase 2 并行
  Phase 3 DT-010  → 依赖 DT-006 + DT-007 (FeatureNode + FlowChart) → 必须等 Phase 2 完成
  Phase 3 DT-011  → 依赖 DT-003 (ScannerPanel 骨架)  → 可与 Phase 2 并行
注意: Phase 3 整体应在 Phase 2 完成后进行，以确保 DT-010 的依赖满足
```

### 7.1 Phase 1: 基础设施 (P0)

> **前置**: 无
> **产出**: Scanner Tab 可打开，骨架页面可访问，分析 API 可调用
> **对应设计**: Section 3.2, 3.3, 4.2

- [ ] DT-001: Dashboard Scanner 入口卡片
  - 在 `DashboardContent.tsx` 新增 Scanner 卡片
  - 点击调用 `TabContext.openTab({ id: 'scanner', name: 'Scanner', url: '/scanner', isUtility: true })`
  - 使用 shadcn Button + 卡片布局（参考现有卡片样式）
  - 文件: `viewer/src/components/panels/DashboardContent.tsx`
  - 验收: 点击卡片，TabBar 出现 [Scanner] Tab，可关闭

- [ ] DT-002: TabContext 支持 Scanner utility tab
  - 检查 `TabContext` 是否已支持 `openTab({ url })` 形式（utility tab）
  - 若已支持（Rules 页面先例），确认 scanner tab 不需要 `agentStatus` 等字段
  - 若需扩展，在 `lib/tab-storage.ts` 中添加 scanner tab 类型支持
  - 文件: `viewer/src/contexts/TabContext.tsx`, `viewer/src/lib/tab-storage.ts`
  - 验收: Typecheck passes

- [ ] DT-003: `/app/scanner/page.tsx` + ScannerPanel 骨架
  - 新建 `viewer/src/app/scanner/page.tsx`，渲染 `<ScannerPanel />`
  - 新建 `viewer/src/components/Scanner/ScannerPanel.tsx`
  - 初始状态：加载中 → 调 `/api/scanner/status` → 根据结果渲染空状态或图谱
  - 文件: `viewer/src/app/scanner/page.tsx`, `viewer/src/components/Scanner/ScannerPanel.tsx`
  - 验收: 访问 `/scanner` 页面不报错，显示加载状态

- [ ] DT-004: `POST /api/scanner/analyze` — spawn Codex + SSE 流式返回
  - 新建 `viewer/src/app/api/scanner/analyze/route.ts`
  - **完整步骤**:
    1. 并发保护: 内存 flag `isAnalyzing` — 若已在分析中返回 `409 Conflict { error: "Analysis already in progress" }`
    2. 检查 Codex CLI 安装（`which codex` / `codex --version`），未安装返回 `error` SSE 事件
    3. 生成文件树（`find` + max-depth=4，排除 node_modules/.git/dist/.next/\_\_pycache\_\_）
    4. 读取 README.md / package.json / CLAUDE.md 等关键配置文件
    5. **获取当前 PR 元数据**（`gh pr list --head $(git branch --show-current)`），失败则降级（`prNumber: null, changedFiles: []`）
    6. 将文件树 + README + 配置 + changedFiles 信息传给 Codex spawn 并流式推送 SSE 进度
    7. Zod 验证 Codex 输出 JSON（fail-closed: 验证失败 → error SSE + stop）
    8. 将 `{ ...scanResult, prNumber, changedFiles, scannedAt, projectRoot }` 写入 `.botoolagent-scan-result.json`
    9. 推送 `{ type: 'result', data: scanResult }` SSE 事件
  - SSE 事件格式: `data: {"type":"progress"|"result"|"error","message"?:"...","data"?:{...}}\n\n`
  - Codex spawn 使用参数数组（不拼接 shell 字符串）
  - **stderr 脱敏**: 捕获 spawn stderr，截断至 2000 字符，屏蔽绝对路径后再传入 SSE error 事件
  - **注**: BotoolAgent 仅运行在本地 localhost，不需要额外认证（与同项目其他 API 路由一致）
  - 文件: `viewer/src/app/api/scanner/analyze/route.ts`, `viewer/src/types/scanner.ts`
  - 验收: SSE 事件流正确推送 progress/result/error 三种类型; 已在分析中时返回 409; spawn 使用参数数组; stderr 不直接暴露（截断+脱敏）; Typecheck passes

- [ ] DT-005: `GET /api/scanner/status` — 读取缓存 + PR 检查
  - 新建 `viewer/src/app/api/scanner/status/route.ts`
  - 读取 `PROJECT_ROOT/.botoolagent-scan-result.json`（不存在返回 `{ hasResult: false }`）
  - 调用 `gh pr list` 获取当前最新 PR 号（失败则 `currentPrNumber: null`）
  - 返回: `{ hasResult, scanResult?, currentPrNumber, needsUpdate }`
  - 文件: `viewer/src/app/api/scanner/status/route.ts`
  - 验收: 无缓存时返回 `{ hasResult: false }`; Typecheck passes

### 7.2 Phase 2: 核心图谱 (P0)

> **前置**: Phase 1
> **产出**: 完整交互式 React Flow 图谱可渲染
> **对应设计**: Section 3.1, 4.3, 5.3, 5.4

- [ ] DT-006: FeatureNode 自定义节点组件
  - 新建 `viewer/src/components/Scanner/FeatureNode.tsx`
  - Props: React Flow 节点 data 字段为 `ScanNode`
  - 布局: 标题行（图标+名称+techStack badges）→ 分隔线 → features bullet list（含 NEW badge） → 分隔线 → path 文件路径
  - 样式: `type=root` 深色 `bg-neutral-900 text-white`; `type=module/submodule` 白色底; `changedInPR` 绿色边框 `border-green-400 border-2`
  - NEW badge: `<Badge variant="success" className="text-xs">NEW</Badge>`（复用已有 success 变体）
  - 文件: `viewer/src/components/Scanner/FeatureNode.tsx`
  - 验收: Storybook 或直接渲染，显示正确; Typecheck passes

- [ ] DT-007: ScannerFlowChart — scan-result → dagre 布局 → React Flow
  - 新建 `viewer/src/components/Scanner/ScannerFlowChart.tsx`
  - 输入: `ScanResult`，输出: React Flow 节点+边（参考现有 `FlowChart.tsx` 的 dagre 集成）
  - 使用 `@dagrejs/dagre` 做层次布局（从 nodes[].children 构建层次树）
  - 注册 `FeatureNode` 为自定义节点类型: `nodeTypes = { feature: FeatureNode }`
  - 配置: 拖拽/缩放/平移 enabled，节点不可连接（只读），fit view on load
  - 文件: `viewer/src/components/Scanner/ScannerFlowChart.tsx`
  - 验收: 传入 mock ScanResult，图谱正常渲染，节点可拖拽; Typecheck passes

- [ ] DT-008: ScannerToolbar — 浮层工具栏
  - 新建 `viewer/src/components/Scanner/ScannerToolbar.tsx`
  - 绝对定位右上角，z-index 高于 React Flow 画布
  - 展示内容: PR 号（`#42`）、上次分析时间（"5 分钟前"，用 `formatDistanceToNow`）
  - 按钮: `[重新分析]`（isAnalyzing 时禁用）
  - 更新提示条: `needsUpdate=true` 时显示黄色横幅 + `[立即分析]` 按钮
  - SSE 进度: 分析进行中显示进度步骤列表
  - **超时处理**: 分析开始后 180 秒无 result/error 事件，触发超时状态:
    - 显示: "分析时间较长，Codex 可能仍在运行..."
    - 提供两个操作: `[继续等待]`（重置超时计时）/ `[取消]`（关闭 SSE 连接，重置 isAnalyzing 状态）
    - 取消后 `[重新分析]` 按钮重新启用
  - 文件: `viewer/src/components/Scanner/ScannerToolbar.tsx`
  - 验收: PR 信息正确显示，按钮状态正确; 180 秒超时后显示超时选项; Verify in browser; Typecheck passes

### 7.3 Phase 3: PR 联动 + 错误处理 (P1)

> **前置**: Phase 1
> **产出**: PR 变更高亮、错误状态友好展示
> **对应设计**: Section 6.2, 6.3

- [ ] DT-009: PR 更新检测
  - 在 `ScannerPanel` 进入时调用 `/api/scanner/status`
  - 响应中 `needsUpdate = scanResult.prNumber !== currentPrNumber`
  - 将 `needsUpdate` 传递给 `ScannerToolbar` 显示更新提示条
  - 文件: `viewer/src/components/Scanner/ScannerPanel.tsx`
  - 验收: PR 号变化时提示条出现; Typecheck passes

- [ ] DT-010: NEW 标记渲染
  - 在 `ScannerFlowChart` 内，将 `changedFiles` 路径与各节点 `path` 匹配
  - 使用 segment-safe 比较: `file === node.path || file.startsWith(node.path + '/')`（见 §4.3）
  - root 节点不标记 `changedInPR`（type=root 跳过匹配）
  - 匹配节点设置 `changedInPR=true`（客户端计算，不修改 scan-result.json）
  - 同时调用 `deriveIsNew(node.features, changedFiles)` 计算各功能的 `isNew`（客户端动态计算）
  - `FeatureNode` 读取 `data.changedInPR` 应用绿色边框
  - `FeatureNode` 读取 `feature.isNew` 显示 NEW badge
  - 文件: `viewer/src/components/Scanner/ScannerFlowChart.tsx`, `FeatureNode.tsx`
  - 验收: segment-safe 路径匹配（`src2` 不误匹配 `src`）; root 节点无绿框; 有 PR 变更文件时节点高亮正确; Verify in browser; Typecheck passes

- [ ] DT-011: 统一错误状态页
  - 新建 `viewer/src/components/Scanner/ScannerErrorView.tsx`
  - Props: `{ errorType: 'codex-not-installed' | 'git-error' | 'gh-not-auth' | 'analysis-failed' | 'json-parse-error', detail?: string }`
  - 每种错误类型显示具体操作指引（见 Section 6.3）
  - `analysis-failed` 和 `json-parse-error` 提供"展开原始输出"折叠面板
  - 文件: `viewer/src/components/Scanner/ScannerErrorView.tsx`
  - 验收: 各错误类型渲染正确; Typecheck passes

---

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `viewer/src/app/scanner/page.tsx` | 待开发 | Phase 1 | DT-003 |
| `viewer/src/app/api/scanner/analyze/route.ts` | 待开发 | Phase 1 | DT-004 |
| `viewer/src/app/api/scanner/status/route.ts` | 待开发 | Phase 1 | DT-005 |
| `viewer/src/components/Scanner/ScannerPanel.tsx` | 待开发 | Phase 1 | DT-003 |
| `viewer/src/components/Scanner/ScannerFlowChart.tsx` | 待开发 | Phase 2 | DT-007 |
| `viewer/src/components/Scanner/FeatureNode.tsx` | 待开发 | Phase 2 | DT-006 |
| `viewer/src/components/Scanner/ScannerToolbar.tsx` | 待开发 | Phase 2 | DT-008 |
| `viewer/src/components/Scanner/ScannerErrorView.tsx` | 待开发 | Phase 3 | DT-011 |
| `viewer/src/types/scanner.ts` | 待开发 | Phase 1 | DT-004 |
| `viewer/src/components/panels/DashboardContent.tsx` | ✅ 已有，需修改 | Phase 1 | DT-001 |
| `viewer/src/contexts/TabContext.tsx` | ✅ 已有，可能需微调 | Phase 1 | DT-002 |
| `viewer/src/lib/tab-storage.ts` | ✅ 已有，可能需微调 | Phase 1 | DT-002 |
| `viewer/src/components/FlowChart/FlowChart.tsx` | ✅ 已有（参考用） | - | - |

### B. 风险与缓解措施

#### HIGH
- **Codex 输出格式不一致**: Codex CLI 版本差异可能导致 JSON 输出格式不同 → **缓解**: 使用 Zod schema 验证，验证失败时记录原始输出并向用户展示错误详情（`ScannerErrorView`）

#### MEDIUM
- **大型项目文件树过大**: 文件树超过 500 行会超过 Codex 上下文限制 → **缓解**: `find` 命令限制 `max-depth=4`，排除常见依赖目录，超出则截断并注明
- **Codex 分析超时**: Codex CLI 首次运行可能需要 1-3 分钟 → **缓解**: SSE 实时推送进度步骤，用户可见当前状态；超过 3 分钟显示超时提示

#### LOW
- **gh CLI 未安装/未认证**: 无法获取 PR 信息 → **缓解**: 降级处理，仍显示图谱但工具栏显示 "PR 信息不可用"，不阻断主功能

### C. 非目标 (Out of Scope)

- ❌ 节点编辑功能（只读可视化，不是 draw.io 编辑器）
- ❌ 远程仓库扫描（只扫描本地 `PROJECT_ROOT`）
- ❌ 历史版本对比（只展示当前状态）
- ❌ Scanner 参与 Viewer 的 5 阶段工作流
- ❌ 自动定时扫描（必须由用户手动触发）

### D. 安全检查项

- [ ] [安全] `analyze` API 中 `spawn` Codex 使用参数数组形式，不拼接 shell 字符串
- [ ] [安全] 文件路径操作使用 `path.join` 并验证不越界 `PROJECT_ROOT`
- [ ] [安全] `.botoolagent-scan-result.json` 读写限制在 `PROJECT_ROOT` 内
- [ ] [安全] SSE 响应正确设置 `Content-Type: text/event-stream`
- [ ] [安全] Zod 验证所有 Codex 输出，拒绝非预期字段（fail-closed：验证失败不等于"无问题"）
- [ ] [安全] stderr/错误输出在发送给客户端前脱敏（截断至 2000 字符，屏蔽绝对路径）
- [ ] [安全] 并发保护：`isAnalyzing` flag 防止重复分析，重复请求返回 409
- [ ] [安全] changedFiles 路径匹配使用 segment-safe 比较（防止路径前缀误匹配）
- [ ] [注] BotoolAgent 为本地 localhost 工具，API 不需要额外认证（与项目其他 API 路由一致）

---

*PRD 生成时间: 2026-02-21*
*生成工具: BotoolAgent PyramidPRD*
