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
- 非 UUID + 不在 tabs 的 reqId → 显示"项目未找到"错误状态（不静默回退到旧 Tab）

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
URL bootstrap effect — 场景 A（Tab 已在 localStorage）：
  tabs.some(t => t.id === "remote-mobile-pwa") → true
  → switchTab("remote-mobile-pwa", "/stage1?req=remote-mobile-pwa")
  → setUrlReqId(null)
          │
          ▼
结果：页面显示 remote-mobile-pwa (Stage 1) 的内容 ✓
      Header Tab 高亮正确 ✓

用户访问 /stage1?req=remote-mobile-pwa（Tab 不在 localStorage）
          │
          ▼
URL bootstrap effect — 场景 B（Tab 不在 tabs，非 UUID）：
  tabs.some(t => t.id === "remote-mobile-pwa") → false
  isRequirementsLoading → wait...
  isRequirementsLoading → false（加载完成）
  isValidReqId("remote-mobile-pwa") → false
  → return（不清空 urlReqId）
          │
          ▼
派生状态计算：
  urlNotFound = !!urlReqId && !isRequirementsLoading && !urlInTabs &&
                !requirements.some(r => r.id === urlReqId)
  → urlNotFound = true
          │
          ▼
结果：显示"项目未找到或已被删除"+ 返回 Dashboard 按钮 ✓
      用户有明确反馈 ✓
```

### 2.3 修复后的 UUID 校验位置

UUID 校验仍然保留，但下移到"查找 requirements"这一步：

```
URL bootstrap effect：
  已在 tabs? → 是 → 直接 switchTab（不需要 UUID）
            → 否 → requirements 加载中? → 是 → 等待
                 → 否 → isValidReqId? → 是 → 查找 requirements
                                     → 否 → return（保留 urlReqId → urlNotFound 显示错误）
```

**关键差异**：非 UUID 不在 tabs 时，`return`（不 `setUrlReqId(null)`），让现有 `urlNotFound` 派生状态显示错误，而不是静默回退到旧 Tab 内容。

## 3. 架构设计

### 3.1 修改范围

业务代码只改一个文件：`viewer/src/components/TabPanelManager.tsx`，两处改动。另新增一个测试文件（`tests/url-tab-bootstrap.spec.ts`，DT-003）用于回归防护。

| 修改点 | 当前行号 | 说明 |
|--------|---------|------|
| `urlReqId` 初始化 | 28-33 | 移除 `isValidReqId()` 校验，直接接受非空 reqId |
| URL bootstrap effect | 97-127 | 重构"非 UUID"处理逻辑，保留 urlReqId 让 urlNotFound 显示错误 |

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

**DT-002: URL bootstrap effect 重构非 UUID 处理**

```typescript
// AFTER（修复后）
useEffect(() => {
  if (!urlReqId || !isHydrated) return;

  // 已在 tabs → 直接激活（适用于任意格式 reqId，包括非 UUID）
  if (tabs.some((t) => t.id === urlReqId)) {
    if (activeTabId !== urlReqId) {
      const stageNum = STAGE_TO_PAGE[tabs.find((t) => t.id === urlReqId)!.stage] ?? 1;
      switchTab(urlReqId, `/stage${stageNum}?req=${encodeURIComponent(urlReqId)}`);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrlReqId(null);
    return;
  }

  // 等待 requirements 加载完成
  if (isRequirementsLoading) return;

  // 非 UUID reqId 且不在 tabs → 保留 urlReqId，让 urlNotFound 显示"项目未找到"
  // 注意：不调用 setUrlReqId(null)，否则 urlNotFound 不会触发
  if (!isValidReqId(urlReqId)) return;

  // UUID reqId → 查找 requirements 并开 Tab
  const requirement = requirements.find((r) => r.id === urlReqId);
  if (requirement) {
    const newTab: TabItem = {
      id: requirement.id,
      name: requirement.name,
      stage: requirement.stage,
    };
    const stageNum = STAGE_TO_PAGE[requirement.stage] ?? 1;
    openTab(newTab, `/stage${stageNum}?req=${encodeURIComponent(requirement.id)}`);
    setUrlReqId(null);
  }
  // "not found" case: urlReqId stays set → urlNotFound derived → shows error UI
}, [urlReqId, isHydrated, isRequirementsLoading, requirements, tabs, activeTabId, openTab, switchTab]);
```

### 3.3 不修改的内容

| 内容 | 原因 |
|------|------|
| `isValidReqId()` 函数本体 | 语义不变，只是调用位置下移 |
| `TabContext.tsx` | 不涉及 |
| `TabBar.tsx` | 不涉及 |
| `urlNotFound` 派生逻辑 | 现有实现已正确处理"未找到"显示，直接复用 |
| UUID 查找路径主体逻辑 | 不变，只是移除了前置守卫 |

## 4. 数据设计

无数据模型变更。此修复不引入新的状态、API 或文件。

## 5. UI 设计

无新增 UI 组件。复用现有 `urlNotFound` 错误状态（TabPanelManager 已实现）：

```
"项目未找到或已被删除"
[返回 Dashboard]
```

该 UI 已在代码中实现，修复后对非 UUID + 不在 tabs 的场景自动生效。

## 6. 业务规则

| ID | 规则 | 说明 |
|----|------|------|
| BR1 | `urlReqId` 接受任意非空字符串 | 不对 reqId 格式做预校验，允许 UUID 和非 UUID 格式 |
| BR2 | 已在 tabs → 优先直接激活，无需 UUID | 适用于所有 reqId 格式（UUID 或非 UUID） |
| BR3 | 不在 tabs 且非 UUID → 显示"项目未找到"错误状态 | 保留 `urlReqId`（不清空），让 `urlNotFound` 派生状态触发错误 UI |
| BR4 | 不在 tabs 且 UUID → 查找 requirements | 现有逻辑，保持不变 |
| BR5 | 成功激活或确认放弃后，`urlReqId` 被清空 | 已在 tabs 激活后 → `setUrlReqId(null)`；requirements 查找成功 → `setUrlReqId(null)`；urlNotFound 态下用户点击"返回 Dashboard" → `setUrlReqId(null)` |
| BR6 | URL bootstrap 内的拼接点使用 `encodeURIComponent(reqId)` | 本次修复覆盖的 bootstrap URL 拼接（`switchTab`/`openTab` 调用处），防止含特殊字符的 reqId 注入额外查询参数。其他路径（TabBar、DashboardContent 等）不在本次范围内。 |

### 6.1 决策树

```
URL 有 ?req= 参数?
├── 否 → urlReqId = null，跳过所有 bootstrap
└── 是 → urlReqId = params.get('req')（任意格式）
          │
          ▼
    isHydrated?
    ├── 否 → 等待
    └── 是 → Tab 已在 tabs 列表中?
              ├── 是 → switchTab 激活 → setUrlReqId(null) → 结束
              └── 否 → requirements 加载中?
                        ├── 是 → 等待
                        └── 否 → isValidReqId(urlReqId)?
                                  ├── 否 → return（保留 urlReqId）
                                  │         → urlNotFound = true
                                  │         → 显示"项目未找到"+ 返回 Dashboard
                                  └── 是 → requirements.find(urlReqId)?
                                            ├── 找到 → openTab → setUrlReqId(null)
                                            └── 未找到 → urlNotFound = true → 显示错误
```

## 7. 开发计划

### 7.1 任务列表

> **前置**: 无
> **产出**: `TabPanelManager.tsx` 修复后，URL → Tab 激活路径对所有 reqId 格式可靠工作
> **对应设计**: Section 3.2

- [ ] DT-001: 移除 `urlReqId` 初始化中的 UUID 校验 (`文件: viewer/src/components/TabPanelManager.tsx`)
  - 验收标准:
    - `urlReqId` 初始化时，`params.get('req')` 的非空结果直接赋值，不再过 `isValidReqId()`
    - `import { isValidReqId }` 保持不变（DT-002 仍需要）
    - Typecheck passes (`npx tsc --noEmit`)

- [ ] DT-002: URL bootstrap effect 重构非 UUID 处理逻辑 (`文件: viewer/src/components/TabPanelManager.tsx`)
  - 验收标准:
    - 在"已在 tabs"分支中，URL 拼接改为 `encodeURIComponent(urlReqId)`
    - 在"等待 requirements"之后，`if (!isValidReqId(urlReqId)) return;`（注意：只 `return`，不 `setUrlReqId(null)`）
    - UUID 查找路径中的 `openTab` 调用，URL 拼接改为 `encodeURIComponent(requirement.id)`
    - 不修改 `urlNotFound` 派生逻辑
    - Typecheck passes (`npx tsc --noEmit`)

- [ ] DT-003: 新增回归测试 — 非 UUID reqId Tab 激活 (`文件: viewer/tests/url-tab-bootstrap.spec.ts`)
  - 验收标准:
    - 测试场景 1（核心回归）：localStorage 中有 `remote-mobile-pwa` Tab，访问 `/stage1?req=remote-mobile-pwa` → 页面内容和 Tab 高亮均为 `remote-mobile-pwa`（不是旧 `activeTabId` 对应的 Tab）
    - 测试场景 2：清空 localStorage，访问 `/stage1?req=remote-mobile-pwa` → 显示"项目未找到或已被删除"错误态，不是旧 Tab 内容
    - 测试场景 3（回归防护）：UUID reqId 已存在 Tab，访问对应 URL → 行为与修复前一致（不退化）
    - 测试场景 4（安全回归）：使用含特殊字符的 reqId（如 `a&b=c`、`test?x=1`）作为 tab ID，验证 switchTab 生成的 URL 只有一个 `req` 参数，无额外注入
    - 测试场景 5（BR5 返回按钮）：非 UUID reqId + Tab 不在 localStorage → 显示"项目未找到"→ 点击"返回 Dashboard" → 页面回到 Dashboard，不重复触发 not-found UI
    - 测试夹具说明：
      - localStorage seed 方法：`page.evaluate(() => localStorage.setItem('botool-tabs', JSON.stringify({...})))`（参考 `multi-tab-stress.spec.ts` 的 `seedState`）
      - API mock：`page.route('/api/requirements', ...)`，返回空数组（模拟 Tab 不存在场景）或指定数据（模拟有 requirements）
      - Tab 高亮断言：`expect(page.locator('[data-testid="tab-remote-mobile-pwa"]')).toHaveClass(/border-/)` 或检查 `aria-selected`
      - 内容断言：`expect(page.locator('main')).toContainText('remote-mobile-pwa 对应的 Stage 内容')`
    - `npx playwright test tests/url-tab-bootstrap.spec.ts` 全部通过

### 7.2 验证场景

完成 DT-001~DT-003 后，验证以下场景（前 7 条手动验证，最后 1 条自动化）：

| 场景 | 前置条件 | 操作 | 预期结果 |
|------|---------|------|---------|
| 非 UUID reqId，Tab 已存在 | localStorage 中有 `remote-mobile-pwa` Tab | 访问 `/stage1?req=remote-mobile-pwa` | 内容和 Tab 高亮均为 remote-mobile-pwa |
| 非 UUID reqId，Tab 不存在 | 全新浏览器 / 清空 localStorage | 访问 `/stage1?req=remote-mobile-pwa` | 显示"加载中..."后显示"项目未找到或已被删除"+ 返回 Dashboard 按钮 |
| UUID reqId，Tab 已存在 | localStorage 中有该 UUID Tab | 访问 `/stage3?req=<uuid>` | 行为与修复前一致 |
| UUID reqId，Tab 不存在，requirement 存在 | 清空 localStorage，requirements API 返回该 UUID | 访问 `/stage3?req=<uuid>` | 行为与修复前一致，Tab 被创建并激活 |
| UUID reqId，Tab 不存在，requirement 不存在 | 清空 localStorage，requirements 无此 UUID | 访问 `/stage1?req=<unknown-uuid>` | 显示"项目未找到或已被删除" |
| Fast Refresh 后恢复 | Tab 在 localStorage，localStorage activeTabId 为另一个 Tab | 在 `/stage1?req=remote-mobile-pwa` 页面触发 Fast Refresh | Tab 正确恢复到 remote-mobile-pwa |
| 无 ?req= 参数 | 任意状态 | 访问 `/` | urlReqId = null，正常显示 Dashboard |

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | 任务 |
|---------|------|------|
| `viewer/src/components/TabPanelManager.tsx` | 修改 | DT-001, DT-002 |
| `viewer/tests/url-tab-bootstrap.spec.ts` | 新建 | DT-003 |

### B. 非目标 (Out of Scope)

- ❌ 修改 `isValidReqId()` 的实现
- ❌ 修改 `TabContext.tsx`
- ❌ 修改 `TabBar.tsx`
- ❌ 修改 localStorage 恢复逻辑
- ❌ 修改任何 API 端点
- ❌ 添加新业务组件或新业务文件（测试文件 `tests/url-tab-bootstrap.spec.ts` 除外）
- ❌ 处理 URL stage 与 tab.stage 不一致的场景（既有设计，tab.stage 权威）

### C. 安全要求

| 检查项 | 说明 | 相关 DT |
|--------|------|---------|
| URL 参数编码（bootstrap 范围） | DT-002 覆盖的两处 URL bootstrap 拼接点使用 `encodeURIComponent(reqId)` | DT-002 |
| 全仓 req URL 编码（超出范围） | TabBar (`src/components/TabBar.tsx:76`)、DashboardContent 等其他位置的 `?req=` 拼接不在本次范围。**后续任务**：`req-url-encoding-audit` — 审计并修复全仓所有 `?req=` 拼接点，统一改为 `encodeURIComponent()` 或 `URLSearchParams`，优先级 P1，在下一个 security sprint 完成。 | 后续任务 `req-url-encoding-audit` |

### E. 已知限制与后续工作

| 限制 | 说明 | 建议后续处理 |
|------|------|-------------|
| requirements API 失败态 | 当 `/api/requirements` 返回 5xx 或网络断开时，`isRequirementsLoading` 永不变 false，`urlNotFound` 无法触发。用户会停留在"加载中..."。 | 独立任务：RequirementContext 添加 isError 状态 + 超时机制，TabPanelManager 消费 isError 显示"加载失败"+ 重试按钮 |
| TabBar 在 urlNotFound/loading 时的高亮态 | 错误/加载期间 TabBar 仍高亮旧 activeTabId，与主体内容不同步。 | 独立任务：为 urlNotFound 态强制切换 activeTabId 到 'dashboard'（需评估对其他场景的影响） |

### D. 相关 Bug 背景

此修复与 `next.config.ts` 的 `.claude/` webpack 监听排除（Fast Refresh 修复）配套使用：

- **已修复**: `next.config.ts` — 排除 `.claude/**` 文件监听，避免 TodoWrite 触发 Fast Refresh 全量重载
- **此 PR 修复**: `TabPanelManager.tsx` — 修复非 UUID reqId 的 URL → Tab 激活路径

即使 Fast Refresh 触发了全量重载，修复后的 URL bootstrap 逻辑也能正确恢复 Tab 状态。非 UUID + 不在 tabs 的场景将显示明确错误态而非静默回退。
