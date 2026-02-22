# PRD: URL → Tab 同步修复

## 1. 项目概述

### 1.1 背景与动机

BotoolAgent Viewer 的 Tab 系统存在一个 Bug：当页面通过带有 `?req=` 参数的 URL 加载时（例如直接导航或 Fast Refresh 全量重载后），如果 `?req=` 的值不是 UUID 格式（如 `remote-mobile-pwa`、`dashboard-clock-widget` 等），Tab 激活状态不会同步到 URL 指定的 Tab，而是仍然显示 localStorage 中缓存的上一个活跃 Tab。

**触发场景**：
- Fast Refresh 全量重载后（例如 TodoWrite 触发 webpack 文件监听，或 webpack 无法热替换时发生 full reload）
- 用户直接访问分享链接（`/stage1?req=remote-mobile-pwa`）
- 用户刷新非 UUID reqId 的 Stage 页面

**实际效果**：页面内容（Panel）来自 localStorage `activeTabId` 对应的 Tab（可能是另一个项目），但 Header Tab 栏视觉上高亮的是 URL 对应的 Tab，产生严重的内容错位。

### 1.2 根本原因

`TabPanelManager.tsx` 的 `urlReqId` 初始化逻辑在接收 `?req=` 参数时，调用了 `isValidReqId()` 进行 UUID 格式校验：

```typescript
// TabPanelManager.tsx:31-33 — 当前代码（有问题）
const reqId = params.get('req');
return reqId && isValidReqId(reqId) ? reqId : null;
//                ^^^^^^^^^^^^^^^^^
//                UUID 正则只匹配 8-4-4-4-12 格式
//                "remote-mobile-pwa" 等非 UUID id 被静默丢弃
```

`isValidReqId()` 在 `TabContext.tsx` 中定义，仅接受 UUID 格式：

```typescript
// TabContext.tsx:7-10
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidReqId(id: string): boolean {
  return UUID_REGEX.test(id);
}
```

`isValidReqId()` 的设计目的是在"创建新 Tab 时"校验 reqId 是否为合法的 requirement UUID，防止无效 URL 参数触发无效的 requirement 查找。但它被错误地用于"URL bootstrap 入口"，连同"已在 tabs 中的 Tab"一起拦截，导致非 UUID 格式的 reqId 即使对应一个已存在的 Tab 也无法激活。

### 1.3 核心目标

修复 `TabPanelManager.tsx` 的 `urlReqId` 初始化和 URL bootstrap 逻辑，使其能正确处理任意格式的 reqId，保证"URL 参数 → Tab 激活"路径对所有 reqId 格式都可靠工作。

### 1.4 成功指标

- 访问 `/stage1?req=remote-mobile-pwa`，页面内容和 Tab 高亮均显示 `remote-mobile-pwa` 项目
- 访问 `/stage3?req=dashboard-clock-widget`，页面内容和 Tab 高亮均显示 `dashboard-clock-widget` 项目
- Fast Refresh 全量重载后，Tab 恢复到 URL 中的 `?req=` 所指向的项目
- UUID 格式 reqId 的现有行为保持不变
- `isValidReqId()` 的语义不变（仅用于"是否查找 requirements"的判断）

## 2. 当前状态

### 2.1 问题流程（有 Bug 的执行路径）

```
用户访问 /stage1?req=remote-mobile-pwa
          │
          ▼
TabPanelManager 挂载
          │
          ▼
urlReqId 初始化：
  params.get('req') → "remote-mobile-pwa"
  isValidReqId("remote-mobile-pwa") → false（不是 UUID）
  → urlReqId = null  ← BUG：直接被丢弃
          │
          ▼
URL bootstrap effect：
  urlReqId = null → 跳过，什么都不做
          │
          ▼
TabContext 从 localStorage 恢复：
  activeTabId = "dashboard-clock-widget"（上次会话）
          │
          ▼
结果：页面显示 dashboard-clock-widget (Stage 3) 的内容
      Header Tab 高亮"BotoolAgent Remote Access (S1)"
      ← 严重的内容错位
```

### 2.2 目标流程（修复后）

```
用户访问 /stage1?req=remote-mobile-pwa
          │
          ▼
TabPanelManager 挂载
          │
          ▼
urlReqId 初始化：
  params.get('req') → "remote-mobile-pwa"
  → urlReqId = "remote-mobile-pwa"  ← 直接接受，不做 UUID 校验
          │
          ▼
URL bootstrap effect：
  tabs.some(t => t.id === "remote-mobile-pwa") → true
  → switchTab("remote-mobile-pwa", "/stage1?req=remote-mobile-pwa")
  → setUrlReqId(null)
          │
          ▼
结果：页面显示 remote-mobile-pwa (Stage 1) 的内容 ✓
      Header Tab 高亮正确 ✓
```

### 2.3 修复后的 UUID 校验位置

UUID 校验仍然保留，但下移到"查找 requirements"这一步：

```
URL bootstrap effect：
  已在 tabs? → 是 → 直接 switchTab（不需要 UUID）
            → 否 → isValidReqId? → 是 → 查找 requirements（需要 UUID）
                               → 否 → 清空 urlReqId，放弃（无效 reqId）
```

## 3. 架构设计

### 3.1 修改范围

只修改一个文件：`viewer/src/components/TabPanelManager.tsx`，两处改动：

| 修改点 | 当前行号 | 说明 |
|--------|---------|------|
| `urlReqId` 初始化 | 28-33 | 移除 `isValidReqId()` 校验，直接接受非空 reqId |
| URL bootstrap effect | 97-127 | 在"已在 tabs"分支之后，添加"非 UUID → 清空退出"守卫 |

### 3.2 修改前后对比

**DT-001: `urlReqId` 初始化**

```typescript
// BEFORE（当前代码，有 Bug）
const [urlReqId, setUrlReqId] = useState<string | null>(() => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const reqId = params.get('req');
  return reqId && isValidReqId(reqId) ? reqId : null;  // ← UUID 校验错误拦截
});

// AFTER（修复后）
const [urlReqId, setUrlReqId] = useState<string | null>(() => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('req') || null;  // ← 接受任意非空 reqId
});
```

**DT-002: URL bootstrap effect 添加非 UUID 守卫**

```typescript
// AFTER（修复后，在现有 "Already in tabs" 分支之后添加守卫）
useEffect(() => {
  if (!urlReqId || !isHydrated) return;

  // 已在 tabs → 确保激活，清空 URL bootstrap 状态（适用于任意格式 reqId）
  if (tabs.some((t) => t.id === urlReqId)) {
    if (activeTabId !== urlReqId) {
      const stageNum = STAGE_TO_PAGE[tabs.find((t) => t.id === urlReqId)!.stage] ?? 1;
      switchTab(urlReqId, `/stage${stageNum}?req=${urlReqId}`);
    }
    setUrlReqId(null);
    return;
  }

  // 非 UUID reqId 且不在 tabs → 放弃（不会存在于 requirements 里）
  if (!isValidReqId(urlReqId)) {
    setUrlReqId(null);
    return;
  }

  // --- 以下为现有 UUID requirement 查找逻辑，保持不变 ---
  if (isRequirementsLoading) return;
  // ... 查找 requirements，openTab 等
}, [urlReqId, isHydrated, isRequirementsLoading, requirements, tabs, activeTabId, openTab, switchTab]);
```

### 3.3 不修改的内容

| 内容 | 原因 |
|------|------|
| `isValidReqId()` 函数本体 | 语义不变，只是调用位置下移 |
| `TabContext.tsx` | 不涉及 |
| `TabBar.tsx` | 不涉及 |
| URL bootstrap 的 UUID 路径 | 逻辑保持不变，只是前面增加了守卫 |
| `requirements` 相关逻辑 | 不涉及 |

## 4. 数据设计

无数据模型变更。此修复不引入新的状态、API 或文件。

## 5. UI 设计

无 UI 变更。此修复不引入任何可见的 UI 改动，只修复现有行为。

## 6. 业务规则

| ID | 规则 | 说明 |
|----|------|------|
| BR1 | `urlReqId` 接受任意非空字符串 | 不对 reqId 格式做预校验，允许 UUID 和非 UUID 格式 |
| BR2 | 已在 tabs → 优先直接激活，无需 UUID | 适用于所有 reqId 格式（UUID 或非 UUID） |
| BR3 | 不在 tabs 且非 UUID → 放弃 | 非 UUID reqId 不存在于 requirements，无需等待查找 |
| BR4 | 不在 tabs 且 UUID → 查找 requirements | 现有逻辑，保持不变 |
| BR5 | URL bootstrap 只运行一次 | `setUrlReqId(null)` 清空后 effect 不再重复执行 |

### 6.1 决策树

```
URL 有 ?req= 参数?
├── 否 → urlReqId = null，跳过所有 bootstrap
└── 是 → urlReqId = params.get('req')
          │
          ▼
    Tab 已在 tabs 列表中?
    ├── 是 → switchTab 激活 → setUrlReqId(null) → 结束
    └── 否 → isValidReqId(urlReqId)?
              ├── 否 → setUrlReqId(null) → 结束（无效 reqId）
              └── 是 → 等待 requirements 加载 → 查找 → openTab 或显示"未找到"
```

## 7. 开发计划

### 7.1 任务列表

> **前置**: 无
> **产出**: `TabPanelManager.tsx` 修复后，URL → Tab 激活路径对所有 reqId 格式可靠工作
> **对应设计**: Section 3.2

- [ ] DT-001: 移除 `urlReqId` 初始化中的 UUID 校验 (`文件: viewer/src/components/TabPanelManager.tsx`)
  - 验收标准:
    - `urlReqId` 初始化时，`params.get('req')` 的非空结果直接赋值，不再过 `isValidReqId()`
    - `import { isValidReqId }` 保持不变（后续 DT-002 仍需要）
    - Typecheck passes (`npx tsc --noEmit`)

- [ ] DT-002: URL bootstrap effect 添加非 UUID 守卫 (`文件: viewer/src/components/TabPanelManager.tsx`)
  - 验收标准:
    - 在"已在 tabs"分支之后，新增 `if (!isValidReqId(urlReqId)) { setUrlReqId(null); return; }` 守卫
    - 守卫位于"等待 requirements loading"判断之前
    - 不修改 UUID 查找路径的任何逻辑
    - 不添加多余的 `console.log` 或注释
    - Typecheck passes (`npx tsc --noEmit`)

### 7.2 验证场景

完成两个 DT 后，手动验证以下场景：

| 场景 | 操作 | 预期结果 |
|------|------|---------|
| 非 UUID reqId，Tab 已存在 | 访问 `/stage1?req=remote-mobile-pwa`，该 Tab 已在 localStorage | 内容和 Tab 高亮均显示 remote-mobile-pwa |
| 非 UUID reqId，Tab 不存在 | 访问 `/stage1?req=remote-mobile-pwa`，localStorage 中无此 Tab | 显示"加载中"后显示项目内容（或未找到提示） |
| UUID reqId，Tab 已存在 | 访问 `/stage3?req=<uuid>`，该 Tab 已在 localStorage | 行为与修复前一致 |
| UUID reqId，Tab 不存在 | 访问 `/stage3?req=<uuid>`，通过 requirements 查找并创建 Tab | 行为与修复前一致 |
| Fast Refresh 后恢复 | 在 `/stage1?req=remote-mobile-pwa` 页面触发 Fast Refresh | Tab 正确恢复到 remote-mobile-pwa |
| 无 ?req= 参数 | 访问 `/` | urlReqId = null，正常显示 Dashboard |

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | 任务 |
|---------|------|------|
| `viewer/src/components/TabPanelManager.tsx` | 修改 | DT-001, DT-002 |

### B. 非目标 (Out of Scope)

- ❌ 修改 `isValidReqId()` 的实现
- ❌ 修改 `TabContext.tsx`
- ❌ 修改 `TabBar.tsx`
- ❌ 修改 localStorage 恢复逻辑
- ❌ 修改任何 API 端点
- ❌ 添加新组件或新文件

### C. 相关 Bug 背景

此修复与 `next.config.ts` 的 `.claude/` webpack 监听排除（Fast Refresh 修复）配套使用：

- **已修复**: `next.config.ts` — 排除 `.claude/**` 文件监听，避免 TodoWrite 触发 Fast Refresh 全量重载
- **此 PR 修复**: `TabPanelManager.tsx` — 修复非 UUID reqId 的 URL → Tab 激活路径

即使 Fast Refresh 触发了全量重载，修复后的 URL bootstrap 逻辑也能正确恢复 Tab 状态。
