# PRD: Botool_Present v1.6 — PPT 编辑器原地进化

## 1. 项目概述

### 1.1 背景与动机

Botool_Present（端口 3005）当前同时承载两大职责：**管理运营**（文档库管理、分类指派、版本管理、前台资料库）和 **PPT 编辑**（Ribbon 编辑器、Canvas 渲染、演示播放、DSL 引擎）。两者技术依赖差异大，混合导致构建体积大、关注点难以分离。

本 PRD 描述 Present 的 **原地进化计划**：将管理功能剥离到全新 Botool_Gallery 应用（端口 3009），Present 保留为纯 PPT 编辑器，同时完成表名迁移（`present_*` → `ppt_*`）、共享包提取（`@botool/ppt-core`）、功能扩展（审阅 Tab、翻译 Tab、PPTX 导入导出）。

```
Botool 内容工具生态:

┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   Botool_Present (3005)      ← PPT 文档工具（编辑/渲染/播放）   │
│   Botool_Video (未来)        ← 视频工具                         │
│   Botool_PDF (未来)          ← PDF 工具                         │
│                                                                  │
│   ──────────────────────────────────────────────────────────     │
│                                                                  │
│   Botool_Gallery (3009)      ← 展示平台（聚合 PPT/Video/PDF）   │
│   Botool_Task (3003)         ← 可嵌入 PPT 查看器                │
│   Botool_Meet (3007)         ← 可嵌入 PPT 演示                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 核心目标

- **Present 原地进化为纯 PPT 编辑器** — 删除管理代码，保留编辑/渲染/播放
- **提取 `@botool/ppt-core` 共享包** — 无跨应用 HTTP 调用，仅共享 types/services/converter/config/security
- **表名统一迁移** — `present_*` → `ppt_*`（~162 处引用），双轨切换保证无中断
- **功能扩展** — 新增审阅 Tab、翻译 Tab、PPTX 导入、PDF/.pptbt 导出

### 1.3 核心原则

| 原则 | 说明 |
|------|------|
| **Present 拥有文档** | PPT 文档的一切操作（CRUD、DSL、版本、协作）归 Present 拥有 |
| **共享 Service 层** | 通过 `@botool/ppt-core` 共享包提供 service/types/converter，无跨应用 HTTP 调用 |
| **ppt_ 表前缀** | PPT 文档相关表统一使用 `ppt_` 前缀（描述内容类型，非应用名） |
| **共享数据库** | 两个应用共享同一 Supabase 项目和 PostgreSQL 数据库 |
| **Present 原地进化** | 编辑器代码已在 Present 中，只需清理管理代码，无需迁移 |
| **Gallery 全新创建** | 管理功能由全新 Botool_Gallery 应用从零开发 |
| **Copy first, delete later** | 面向 Gallery 的参考实现必须先固化快照，再执行删除动作 |

### 1.4 成功指标

- 编辑器功能不受拆分影响，所有现有功能正常运行
- PPTX 导入整体视觉还原度 ≥ 80%
- `pnpm build` 无编译错误
- 管理端代码完全清除，无残留路由

### 1.5 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 16 | 应用框架 |
| React | 19.1 | UI 框架 |
| TypeScript | 5.x | 类型安全 |
| Zustand + Immer | latest | 状态管理（编辑器） |
| Tiptap | 3.14 | 富文本编辑 |
| Canvas API | - | PPT 渲染引擎 |
| pptxgenjs | 4.0 | PPTX 生成 |
| pptxtojson | 1.9 | PPTX 解析 |
| DOMPurify | 3.3 | HTML 清理 |
| @supabase/ssr | 0.6.x | 认证 Cookie 管理 |
| **@botool/ppt-core** | workspace | PPT 共享 service/types/converter |

### 1.6 应用配置

```
应用名称: Botool_Present（沿用现有应用）
端口: 3005（不变）
basePath:
  development: / (直接端口访问)
  staging:     /present
  production:  /present
```

---

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| **Ribbon UI** | ✅ 已实现 | 通用/插入/设计/视图 四个 Tab |
| **Canvas 画布** | ✅ 已实现 | 拖拽、缩放、对齐、多选 |
| **属性面板** | ✅ 已实现 | 元素属性编辑（位置/大小/样式/文本） |
| **幻灯片面板** | ✅ 已实现 | 左侧缩略图、排序、增删 |
| **撤销/重做** | ✅ 已实现 | Zustand + Immer 历史栈 |
| **富文本编辑** | ✅ 已实现 | Tiptap 集成 |
| **演示模式** | ✅ 已实现 | 全屏播放、键盘/鼠标翻页 |
| **DSL 引擎** | ✅ 已实现 | 6 种元素类型渲染器 |
| **状态管理** | ✅ 已实现 | Zustand + Immer 核心 Store |
| **认证 (ATT)** | ✅ 已实现 | 跨端口 ATT 认证流程 |
| **管理端** | ⚠️ 待剥离 | 文档库管理、分类指派等迁移到 Gallery |
| **审阅 Tab** | ❌ 未实现 | Phase 3 新增 |
| **翻译 Tab** | ❌ 未实现 | Phase 5 新增 |
| **PPTX 导入** | ❌ 未实现 | Phase 4 新增 |
| **PDF/.pptbt 导出** | ❌ 未实现 | Phase 4 新增 |

### 2.2 缺口分析

- **Ribbon 扩展**: 当前仅 4 个 Tab（通用/插入/设计/视图），需扩展到 6 个（+翻译/审阅）
- **导入导出**: 缺少 PPTX 导入、PDF 导出、.pptbt 导入导出
- **表名迁移**: 所有 `present_*` 表需迁移为 `ppt_*`，涉及 ~162 处代码引用
- **共享包**: `@botool/ppt-core` 尚未提取，types/services/converter 散布在 Present 内部
- **管理代码清理**: admin/library 页面和 API 需从 Present 中移除

---

## 3. 架构设计

### 3.1 拆分后架构

```
拆分后:
┌──────────────────────┐    ┌──────────────────────┐
│  Botool_Present      │    │  Botool_Gallery       │
│  (3005, /present)    │    │  (3009, /gallery)     │
│                      │    │                       │
│  • Ribbon 编辑器      │    │  • 分类指派           │
│  • Canvas 渲染引擎    │    │  • 前台资料库         │
│  • 演示播放器         │    │  • 术语表管理         │
│  • DSL 引擎          │    │  • 版本管理(管理端UI) │
│  • 导入导出           │    │  • 后台翻译入口       │
│  • 文档 CRUD          │    │  • 下载 UI            │
│  • AI 翻译(编辑器)    │    │                       │
│  • 审批与批注         │    │  (展示平台，消费方)    │
│  • 协作者管理         │    │                       │
│                      │    │  import               │
│  (文档工具，提供方)    │    │  @botool/ppt-core     │
│  代码保留在原地        │    │  全新应用              │
└──────────────────────┘    └──────────────────────┘
```

### 3.2 跨应用通信

```
┌──────────────────────┐         URL 跳转          ┌──────────────────────┐
│   Botool_Gallery     │ ─────────────────────────▶ │   Botool_Present     │
│   (3009, /gallery)   │                            │   (3005, /present)   │
│                      │                            │                      │
│  • 分类指派          │  编辑: {PRESENT_URL}/editor/{presentationId}     │
│  • 前台资料库        │  演示: {PRESENT_URL}/present/{id}               │
│  • 术语表管理        │  新建: {PRESENT_URL}/editor/new                 │
│                      │                            │                      │
│  import              │ ◀───────────────────────── │                      │
│  @botool/ppt-core    │  返回: {GALLERY_URL}/admin │                      │
└──────────────────────┘                            └──────────────────────┘

跨应用数据共享方式（非 HTTP 调用）:
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   Botool_Gallery                    Botool_Present               │
│       │                                  │                       │
│       │  import { DocumentService }      │                       │
│       │  from '@botool/ppt-core'         │                       │
│       │                                  │                       │
│       └──────────┐        ┌──────────────┘                       │
│                  ▼        ▼                                      │
│           @botool/ppt-core                                       │
│           (共享 service 层)                                      │
│                  │                                               │
│                  ▼                                               │
│           Supabase / PostgreSQL                                  │
│           (同一数据库实例)                                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**参数传递方式**: URL path + query parameters
- `/editor/{presentationId}` — 编辑指定 PPT
- `?versionId={versionId}` — 标记 Gallery 版本管理进入的目标语言版本
- `?lang={code}` — 当前语言上下文
- `?from=gallery` — 来源为 Gallery 管理端
- `?returnUrl={url}` — 编辑完成后返回地址

### 3.3 核心实体关系

```
───────── 核心实体关系 ─────────

   ppt_documents（文档主表）
      │
      ├──── 1:N ──── ppt_dsl_snapshots（DSL 快照）
      ├──── 1:N ──── ppt_collaborators（协作者）
      ├──── 1:N ──── ppt_comments / ppt_comment_replies（评论/批注）
      ├──── 1:N ──── ppt_reviews / ppt_reviewers（审批）
      ├──── 1:N ──── ppt_access_requests（访问请求）
      ├──── 1:N ──── ppt_access_history（访问历史）
      ├──── 1:N ──── ppt_visibility_groups（可见性分组）
      ├──── 1:N ──── ppt_translations (source_type='presentation')
      │
      └──── N:1 ──── ppt_version_groups
                        │
                        └── 1:N ──── ppt_versions
                                       │
                                       └── 1:N ──── ppt_translations (source_type='version')
```

### 3.4 用户角色

```
───────── 角色定义 ─────────

┌──────────────────┐     ┌──────────────────┐
│  内容编辑者       │     │  管理员           │
│                  │     │                  │
│  权限:           │     │  权限:           │
│  - 编辑 PPT      │     │  - 全部编辑权限  │
│  - 演示播放      │     │  - 协作者管理    │
│  - 导入导出      │     │  - 审批处理      │
│  - AI 翻译       │     │  - 访问请求审批  │
│  - 发起审批      │     │                  │
│                  │     │  入口:           │
│  入口:           │     │  /editor/[id]    │
│  /editor/[id]    │     └──────────────────┘
└──────────────────┘

┌──────────────────┐
│  查看者           │
│                  │
│  权限:           │
│  - 查看 PPT      │
│  - 演示播放      │
│                  │
│  入口:           │
│  /present/[id]   │
└──────────────────┘
```

### 3.5 核心工作流

```
───────── 开发阶段流转 ─────────

Pre-Phase ──▶ Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3/4/5
[Gate安全]    [ppt-core]   [新建表]    [删代码]    [功能开发]
(P0)          (P0)         (P0)        (P0)        (P1)

依赖: Pre-Phase → Phase 0 → Phase 1 → Phase 2
      Phase 3/4/5 可并行（均依赖 Phase 2）
```

### 3.6 编辑器保存行为

#### 草稿箱模式

```
用户访问 /editor/new
      │
      ▼
  创建新 PPT
      │ POST /api/presentations
      │ { title, type: 'private' }
      ▼
  ppt_documents
  ┌────────────────────────┐
  │ id: 123                │
  │ title: "Q1销售方案"    │
  │ type: 'private'        │
  │ current_version_group_id: NULL │
  └────────────────────────┘
      │
      │ 关键：没有创建 gallery_category_slots 记录
      ▼
  ✅ 保存到草稿箱
```

#### 版本管理模式

- 入口：Gallery `/admin` Tab 2 → 选择版本组 → 选择语言版本 → [编辑]
- 跳转：`/editor/[presentationId]?versionId={versionId}&lang={code}&from=gallery`
- 保存到 `ppt_versions` 表对应的 DSL 快照
- published 版本不可直接编辑，需先取消发布

#### 模式判断

```typescript
async function loadPresentation(id: number) {
  const query = new URLSearchParams(window.location.search)
  const versionId = query.get('versionId')
  const lang = query.get('lang')
  const from = query.get('from')

  const doc = await fetch(`/api/presentations/${id}`).then(r => r.json())
  const slot = await fetch(`/api/presentations/${id}/slot`).then(r => r.json())

  if (slot.data && from === 'gallery') {
    // 版本管理模式
    setContext({ mode: 'slot', slotInfo: slot.data, ... })
  } else {
    // 草稿箱模式
    setContext({ mode: 'draft', slotInfo: null, ... })
  }
}
```

### 3.7 DSL 引擎

**核心位置**: `@botool/ppt-core` 共享包中的 `types/dsl.ts`

**支持的元素类型**:

| 类型 | 说明 |
|------|------|
| `text` | 文本框（富文本 HTML，Tiptap 编辑） |
| `image` | 图片元素（Supabase Storage URL） |
| `shape` | 形状元素（预设形状 + 自定义 SVG path） |
| `table` | 表格元素（行/列/合并单元格） |
| `line` | 线条元素（直线/折线/曲线） |
| `group` | 组合元素（递归嵌套子元素） |

**渲染器组件**: `components/renderer/`（约 12 个文件）

| 组件 | 说明 |
|------|------|
| `ElementRenderer` | 元素路由：根据 type 分发到对应渲染器 |
| `TextRenderer` | 文本渲染：HTML → Canvas |
| `ImageRenderer` | 图片渲染：URL → Canvas |
| `ShapeRenderer` | 形状渲染：预设形状/SVG path |
| `TableRenderer` | 表格渲染：单元格/边框/合并 |
| `LineRenderer` | 线条渲染：直线/折线/曲线/箭头 |
| `GroupRenderer` | 组合渲染：递归渲染子元素 |

**状态管理**:

| 文件 | 技术 | 说明 |
|------|------|------|
| `stores/presentation-store.ts` | Zustand + Immer | 核心状态：幻灯片列表、当前选中、元素数据 |
| `stores/editor-context.tsx` | React Context | 编辑器上下文：模式、工具、缩放 |

数据流: 编辑器组件 → Zustand Store → API Routes → Supabase Client → PostgreSQL

### 3.8 认证设计

#### 开发环境（ATT 跨端口认证）

```
Dashboard (3001) 登录成功
    ↓
生成一次性 ATT（30秒有效）
    ↓
跳转: http://localhost:3005?att=xxx
    ↓
Present middleware 检测 att 参数
    ↓
调用 Dashboard /api/auth/exchange 换取 session
    ↓
设置本地 Supabase Session，清除 URL 中的 att 参数
```

#### staging/production（Cookie 共享）

同域名部署下，Supabase HttpOnly Cookie 自动跨路径共享。

### 3.9 @botool/ppt-core 共享包结构

```
libs/
└── ppt-core/                    ← @botool/ppt-core
    ├── package.json
    ├── tsconfig.json
    │
    ├── services/                ← 业务逻辑层
    │   ├── document.service.ts    ← 文档 CRUD (ppt_documents)
    │   ├── dsl.service.ts         ← DSL 读写 (ppt_dsl_snapshots)
    │   ├── version.service.ts     ← 版本管理 (ppt_versions / ppt_version_groups)
    │   ├── translation.service.ts ← 翻译任务 (ppt_translations)
    │   ├── collaborator.service.ts ← 协作者管理 (ppt_collaborators)
    │   └── review.service.ts      ← 审批管理 (ppt_reviews / ppt_reviewers)
    │
    ├── types/                   ← TypeScript 类型定义
    │   ├── dsl.ts                 ← DSL 类型（核心）
    │   ├── document.ts            ← 文档类型
    │   ├── version.ts             ← 版本类型
    │   └── translation.ts         ← 翻译类型
    │
    ├── converter/               ← 文件格式转换
    │   ├── pptx-to-dsl.ts         ← PPTX → DSL 主转换
    │   ├── pptx-types.ts          ← pptxtojson 输出类型
    │   ├── pptx-html-cleaner.ts   ← HTML 清洗
    │   ├── pptx-shape-map.ts      ← 形状映射表
    │   ├── pptx-image-upload.ts   ← 图片批量上传
    │   ├── pptx-fill-converter.ts ← 填充转换
    │   ├── dsl-to-pdf.ts          ← DSL → PDF
    │   ├── dsl-to-pptbt.ts        ← DSL → .pptbt
    │   └── pptbt-to-dsl.ts        ← .pptbt → DSL
    │
    ├── security/                ← 安全工具
    │   └── sanitize.ts            ← HTML 清理、XSS 防护
    │
    ├── config/                  ← 配置
    │   ├── languages.ts           ← 语言配置
    │   └── qwen.ts                ← 通义千问翻译配置
    │
    └── index.ts                 ← 统一导出
```

---

## 4. 数据设计

### 4.1 数据模型概览

#### Present 拥有的表（`ppt_` 前缀）

| 模型 | 用途 | 关键字段 | 状态 |
|------|------|---------|------|
| ppt_documents | 文档主表 | id, title, owner_id, dsl_json, visibility, type, status | 已有→重命名 |
| ppt_dsl_snapshots | DSL 快照 | id, presentation_id, dsl_json, snapshot_type | 已有→重命名 |
| ppt_version_groups | 版本组 | id, presentation_id, version_number, is_published | 已有→重命名 |
| ppt_versions | 语言版本 | id, version_group_id, language_code, status, dsl_snapshot_id | 已有→重命名 |
| ppt_collaborators | 协作者 | id, presentation_id, user_id, permission | 已有→重命名 |
| ppt_comments | 评论/批注 | id, presentation_id, content, slide_index | 已有→重命名 |
| ppt_comment_replies | 评论回复 | id, comment_id, content | 新建 |
| ppt_reviews | 审批 | id, presentation_id, status | 已有→重命名 |
| ppt_reviewers | 审批人 | id, review_id, user_id, decision | 已有→重命名 |
| ppt_translations | 翻译任务 | id, source_type, target_language, status, progress | 已有→重命名 |
| ppt_access_requests | 访问请求 | id, presentation_id, requester_id, status | 已有→重命名 |
| ppt_access_history | 访问历史 | id, presentation_id, user_id | 新建 |
| ppt_visibility_groups | 可见性分组 | id, presentation_id, group_type, group_value | 已有→重命名 |

#### Gallery 拥有的表（`gallery_` 前缀，不在本 PRD 范围）

| 表名 | 说明 |
|------|------|
| gallery_categories | 分类定义表（2 级结构） |
| gallery_category_slots | 分类槽位表（FK → ppt_documents.id） |
| gallery_glossary | 术语表主表 |
| gallery_glossary_translations | 术语翻译表 |

### 4.2 Schema 定义

#### 4.2.1 ppt_documents (文档主表)

```sql
CREATE TABLE ppt_documents (
  id                      SERIAL PRIMARY KEY,

  -- 标题和标识
  title                   VARCHAR(255) NOT NULL,
  title_en                VARCHAR(255),
  slug                    VARCHAR(100),

  description             TEXT,
  thumbnail_url           VARCHAR(500),
  tags                    JSONB DEFAULT '[]',
  language_code           VARCHAR(10) DEFAULT 'zh',
  translated_from_id      INT REFERENCES ppt_documents(id),

  -- 类型（访问控制标识）
  type                    VARCHAR(20) DEFAULT 'private',

  -- 导入元数据
  original_path           VARCHAR(500),
  file_name               VARCHAR(255),
  file_size               BIGINT,

  -- 文档状态
  status                  VARCHAR(20) DEFAULT 'draft',   -- draft / importing / import_failed
  review_status           VARCHAR(20) DEFAULT 'draft',   -- draft/reviewing/approved/rejected

  -- DSL 存储
  dsl_json                JSONB,
  dsl_storage_path        VARCHAR(500),

  -- 当前编辑的版本组
  current_version_group_id INT,

  -- 权限字段 (RLS 必需)
  owner_id                INT NOT NULL,
  dept_path               VARCHAR(100),

  -- 软删除
  is_deleted              BOOLEAN DEFAULT FALSE,
  deleted_at              TIMESTAMPTZ,
  deleted_by              INT,
  deleted_by_name         VARCHAR(255),

  -- 审计
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  created_by              INT,
  created_by_name         VARCHAR(255),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_by              INT,
  updated_by_name         VARCHAR(255)
);
```

**草稿箱 vs 官方资料库区分逻辑**:

| 位置 | 判断逻辑 |
|------|----------|
| 草稿箱 | `NOT EXISTS (SELECT 1 FROM gallery_category_slots s WHERE s.presentation_id = p.id)` |
| 官方资料库 | `EXISTS (SELECT 1 FROM gallery_category_slots s WHERE s.presentation_id = p.id)` |

#### 4.2.2 ppt_dsl_snapshots (DSL 快照表)

```sql
CREATE TABLE ppt_dsl_snapshots (
  id                SERIAL PRIMARY KEY,
  presentation_id       INT NOT NULL REFERENCES ppt_documents(id),
  dsl_json          JSONB,
  dsl_storage_path  VARCHAR(500),
  snapshot_type     VARCHAR(20) DEFAULT 'auto',  -- auto / manual
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        INT
);
```

#### 4.2.3 ppt_access_requests (访问申请表)

```sql
CREATE TABLE ppt_access_requests (
  id                SERIAL PRIMARY KEY,
  presentation_id       INT NOT NULL REFERENCES ppt_documents(id) ON DELETE CASCADE,
  user_id           INT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
  request_message   TEXT,
  admin_response    TEXT,
  reviewed_by       INT REFERENCES botool_users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  is_deleted        BOOLEAN DEFAULT FALSE,

  CONSTRAINT status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT uq_pending_request UNIQUE NULLS NOT DISTINCT (presentation_id, user_id, status)
    DEFERRABLE INITIALLY DEFERRED
);

-- 索引
CREATE INDEX idx_ppt_access_requests_doc ON ppt_access_requests(presentation_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_ppt_access_requests_user ON ppt_access_requests(user_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_ppt_access_requests_pending ON ppt_access_requests(presentation_id, status) WHERE status = 'pending' AND is_deleted = FALSE;

-- RLS
ALTER TABLE ppt_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ppt_access_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY "ppt_access_requests_select_own" ON ppt_access_requests
  FOR SELECT TO authenticated
  USING (user_id = (SELECT id FROM botool_users WHERE auth_user_id = auth.uid() LIMIT 1)
         OR check_ppt_access(presentation_id, 'admin'));

CREATE POLICY "ppt_access_requests_insert" ON ppt_access_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT id FROM botool_users WHERE auth_user_id = auth.uid() LIMIT 1));

CREATE POLICY "ppt_access_requests_update_admin" ON ppt_access_requests
  FOR UPDATE TO authenticated
  USING (check_ppt_access(presentation_id, 'admin'));

CREATE POLICY "ppt_access_requests_delete_admin" ON ppt_access_requests
  FOR DELETE TO authenticated
  USING (check_ppt_access(presentation_id, 'admin'));
```

#### 4.2.4 ppt_visibility_groups (可见性分组表)

```sql
CREATE TABLE ppt_visibility_groups (
  id                SERIAL PRIMARY KEY,
  presentation_id       INT NOT NULL REFERENCES ppt_documents(id) ON DELETE CASCADE,
  group_type        VARCHAR(30) NOT NULL,   -- 'dept' | 'role' | 'org'
  group_value       VARCHAR(200) NOT NULL,
  granted_by        INT REFERENCES botool_users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  is_deleted        BOOLEAN DEFAULT FALSE,

  UNIQUE(presentation_id, group_type, group_value)
);

CREATE INDEX idx_ppt_vis_groups_doc ON ppt_visibility_groups(presentation_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_ppt_vis_groups_value ON ppt_visibility_groups(group_type, group_value) WHERE is_deleted = FALSE;

ALTER TABLE ppt_visibility_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ppt_visibility_groups FORCE ROW LEVEL SECURITY;

CREATE POLICY "ppt_vis_groups_select" ON ppt_visibility_groups
  FOR SELECT TO authenticated USING (NOT is_deleted);

CREATE POLICY "ppt_vis_groups_manage" ON ppt_visibility_groups
  FOR ALL TO authenticated
  USING (check_ppt_access(presentation_id, 'admin'))
  WITH CHECK (check_ppt_access(presentation_id, 'admin'));
```

#### 4.2.5 ppt_translations (翻译任务表)

```sql
CREATE TABLE ppt_translations (
  id                      SERIAL PRIMARY KEY,

  -- 翻译入口类型
  source_type             VARCHAR(20) DEFAULT 'version',  -- 'version'(Gallery) | 'presentation'(Editor)

  -- Gallery 后台翻译
  source_version_id       INT REFERENCES ppt_versions(id),
  result_version_id       INT REFERENCES ppt_versions(id),

  -- Editor 草稿翻译
  source_presentation_id      INT REFERENCES ppt_documents(id),
  result_presentation_id      INT REFERENCES ppt_documents(id),

  target_language         VARCHAR(10) NOT NULL,
  status                  VARCHAR(20) DEFAULT 'pending',  -- pending/processing/completed/failed
  error_message           TEXT,

  -- 进度追踪
  total_slides        INT DEFAULT 0,
  completed_slides    INT DEFAULT 0,
  total_texts         INT DEFAULT 0,
  completed_texts     INT DEFAULT 0,
  total_batches       INT DEFAULT 0,
  completed_batches   INT DEFAULT 0,
  input_tokens        INT DEFAULT 0,
  output_tokens       INT DEFAULT 0,
  logs                JSONB DEFAULT '[]',

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  created_by          INT NOT NULL,
  completed_at        TIMESTAMPTZ,

  -- 字段互斥约束
  CONSTRAINT ppt_translations_source_type_check CHECK (
    source_type IN ('version', 'presentation')
  ),
  CONSTRAINT ppt_translations_version_fields CHECK (
    source_type != 'version' OR (
      source_version_id IS NOT NULL
      AND source_presentation_id IS NULL
      AND result_presentation_id IS NULL
    )
  ),
  CONSTRAINT ppt_translations_document_fields CHECK (
    source_type != 'presentation' OR (
      source_presentation_id IS NOT NULL
      AND source_version_id IS NULL
      AND result_version_id IS NULL
    )
  )
);
```

#### 4.2.6 ppt_version_groups (版本组表)

```sql
CREATE TABLE ppt_version_groups (
  id                SERIAL PRIMARY KEY,
  presentation_id       INT NOT NULL REFERENCES ppt_documents(id),
  version_number    VARCHAR(20) NOT NULL,
  version_type      VARCHAR(10) NOT NULL,       -- major / minor
  sort_key          INT NOT NULL DEFAULT 0,
  publish_note      TEXT,

  is_published      BOOLEAN DEFAULT FALSE,
  published_at      TIMESTAMPTZ,
  published_by      INT REFERENCES botool_users(id),

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        INT,

  UNIQUE(presentation_id, version_number)
);
```

#### 4.2.7 ppt_versions (语言版本表)

```sql
CREATE TABLE ppt_versions (
  id                  SERIAL PRIMARY KEY,
  version_group_id    INT NOT NULL REFERENCES ppt_version_groups(id),
  language_code       VARCHAR(10) NOT NULL,

  status              VARCHAR(20) DEFAULT 'draft',

  dsl_snapshot_id     INT,

  slide_count         INT,
  file_size           BIGINT,
  pdf_storage_path    VARCHAR(500),
  pptbt_storage_path  VARCHAR(500),

  source_version_id       INT REFERENCES ppt_versions(id),
  source_presentation_id      INT REFERENCES ppt_documents(id),

  published_at        TIMESTAMPTZ,
  published_by        INT,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  created_by          INT,

  CONSTRAINT ppt_versions_status_check CHECK (status IN ('draft', 'published')),
  UNIQUE(version_group_id, language_code)
);
```

### 4.3 模型关系

```
───────── 跨应用数据关系 ─────────

Gallery 管理侧 (gallery_*)             Present PPT文档侧 (ppt_*)
─────────────────────                   ──────────────────

gallery_categories                      ppt_documents  ← 核心实体
       │                                      │
       ▼                                      ├── ppt_dsl_snapshots
gallery_category_slots ──FK──▶ ppt_documents   ├── ppt_version_groups
                                      │       │      └── ppt_versions
gallery_glossary                      │       ├── ppt_collaborators
gallery_glossary_translations         │       ├── ppt_comments / ppt_comment_replies
                                      │       ├── ppt_reviews / ppt_reviewers
                                      │       ├── ppt_translations
                                      │       ├── ppt_access_requests / ppt_access_history
                                      │       └── ppt_visibility_groups
```

### 4.4 表名迁移映射

| 旧表名 (present_*) | 新表名 (ppt_*) | 变更 |
|---------------------|----------------|------|
| present_presentations | ppt_documents | 前缀 + 实体名 |
| present_dsl_snapshots | ppt_dsl_snapshots | 前缀 |
| present_versions | ppt_versions | 前缀 |
| present_version_groups | ppt_version_groups | 前缀 |
| present_collaborators | ppt_collaborators | 前缀 |
| present_comments | ppt_comments | 前缀 |
| present_comment_replies | ppt_comment_replies | 新建 |
| present_reviews | ppt_reviews | 前缀 |
| present_reviewers | ppt_reviewers | 前缀 |
| present_translations | ppt_translations | 前缀 |
| present_access_requests | ppt_access_requests | 前缀 |
| present_access_history | ppt_access_history | 新建 |
| present_visibility_groups | ppt_visibility_groups | 前缀 |

> 采用双轨切换：先创建 `ppt_*` → 回填与一致性校验 → API 分批切流到 `ppt_*` → 稳定后再下线 `present_*`。

### 4.5 Storage Bucket

| 原名 | 新名 | 说明 |
|------|------|------|
| `present-files` | `ppt-files` | PPT 文档相关文件存储 |

路径格式: `presentations/{presentationId}/images/{hash}.{ext}`

---

## 5. UI 设计

### 5.1 页面清单

| 页面 | 路由 | 说明 | 状态 |
|------|------|------|------|
| PPT 编辑器 | `/editor/[id]` | 核心编辑页 | 已有（增量扩展 Ribbon） |
| PPT 编辑器（新建） | `/editor/new` | 新建空白 PPT | 已有 |
| 演示模式 | `/present/[id]` | 全屏播放 | 已有（增加权限检查） |
| 预览 | `/present/preview` | 预览模式 | 已有 |

### 5.2 Ribbon Tab 扩展

```
当前（代码已实现）:
┌──────┬──────┬──────┬──────┐
│ 通用 │ 插入 │ 设计 │ 视图 │
└──────┴──────┴──────┴──────┘

目标（PRD 扩展后）:
┌──────┬──────┬──────┬──────┬──────┬──────┐
│ 通用 │ 插入 │ 设计 │ 翻译 │ 审阅 │ 视图 │
└──────┴──────┴──────┴──────┴──────┴──────┘
```

### 5.3 组件清单

| 组件 | Props 接口 | 状态 | Phase |
|------|-----------|------|-------|
| `ReviewTab` | `{}` | 新建 | 3 |
| `ReviewConfigDialog` | `{ open, onOpenChange }` | 已有 | 3 |
| `ReviewStatusPopover` | `{ presentationId }` | 已有 | 3 |
| `AnnotationTool` | `{}` | 已有 | 3 |
| `AnnotationList` | `{}` | 已有 | 3 |
| `TranslateTab` | `{}` | 新建 | 5 |
| `TranslateMenu` | `{}` | 新建 | 5 |
| `TranslateConfirmDialog` | `{ open, onOpenChange, presentationId }` | 新建 | 5 |
| `TranslateProgressDialog` | `{ translationId, open }` | 新建 | 5 |
| `TranslateHistoryPopover` | `{ presentationId }` | 新建 | 5 |
| `GlossaryViewPanel` | `{}` | 新建 | 5 |
| `ImportProgressDialog` | `{ presentationId, open }` | 新建 | 4 |
| `ExportDialog` | `{ open, onOpenChange }` | 新建 | 4 |

### 5.4 关键页面布局

```
───────── PPT 编辑器 (/editor/[id]) ─────────
┌─────────────────────────────────────────────────┐
│  [←][💾][↩][↪]  标题 [中文版]                   │
│  [通用][插入][设计][翻译][审阅][视图]             │
│  ┌────────────┬────────────────────────────┐    │
│  │ SlidePanel │  Canvas (SVG/HTML)         │    │
│  │            │  ┌────────────────────┐    │    │
│  │  [Slide 1] │  │                    │    │    │
│  │  [Slide 2] │  │  Active Slide      │    │    │
│  │  [Slide 3] │  │  (960×540 viewport)│    │    │
│  │            │  │                    │    │    │
│  │            │  └────────────────────┘    │    │
│  │            │                            │    │
│  │            │  PropertiesPanel (右侧)     │    │
│  └────────────┴────────────────────────────┘    │
│  StatusBar [缩放 | 页码 | 🌐语言 | 审阅状态]    │
└─────────────────────────────────────────────────┘
```

### 5.5 关键弹窗

```
───────── PPTX 导入进度 ─────────
┌───────────────────────────────────────────────────────┐
│  📥 导入 PowerPoint 文件                        [×]   │
│  ──────────────────────────────────────────────────── │
│                                                        │
│  📄 公司简介2026.pptx    文件大小: 58.3 MB             │
│                                                        │
│  导入进度:                                             │
│  ✅ 上传文件                             完成          │
│  ✅ 解析 PPTX 结构                       完成          │
│  🔄 处理图片资源 (12/35)                 进行中        │
│  ○  转换文档格式                         等待中        │
│  ○  保存文档                             等待中        │
│                                                        │
│  [██████████████░░░░░░░░░░░░░░] 45%                   │
│  预计剩余时间: 约 30 秒                                │
│                                                        │
│                              [取消导入]                │
└───────────────────────────────────────────────────────┘

───────── 导出对话框 ─────────
┌───────────────────────────────────────────────────┐
│  📤 导出演示文稿                            [×]    │
│  ──────────────────────────────────────────────── │
│                                                    │
│  选择导出格式:                                     │
│  ● PDF 文档 (.pdf)     - 用于分享、打印  [推荐]    │
│  ○ Botool 格式 (.pptbt) - 可再次导入编辑           │
│  ○ 图片 (.png)          - 导出为图片               │
│                                                    │
│  导出范围:                                         │
│  ● 全部幻灯片                                     │
│  ○ 当前幻灯片                                     │
│  ○ 自定义范围: 第 [1] 页 - 第 [10] 页             │
│                                                    │
│                       [取消]    [开始导出]          │
└───────────────────────────────────────────────────┘

───────── AI 翻译 ─────────
┌─────────────────────────────────────────────────┐
│  🌐 AI 翻译                               [×]   │
│  ─────────────────────────────────────────────  │
│                                                  │
│  当前文档: 公司简介 [中文版]                      │
│                                                  │
│  翻译为:                                         │
│  ○ English                                       │
│  ○ Deutsch                                       │
│  ○ 日本語                                        │
│                                                  │
│  ⚙️ 术语表: ✅ 已启用 · 28条（仅中文源时显示）   │
│                                                  │
│  ─────────────────────────────────────────────  │
│  💡 翻译完成后将创建一份新的目标语言版草稿文档    │
│                                                  │
│                          [取消]  [🤖 开始翻译]   │
└─────────────────────────────────────────────────┘
```

### 5.6 Ribbon Tab 内容定义

#### 「审阅」Tab

| 组名 | 按钮 | 交互 | 组件 |
|------|------|------|------|
| 审批 | 📋 发起审批 | 打开审批配置 | `<ReviewConfigDialog />` |
| 审批 | 📝 审批详情 | 查看审批状态 | `<ReviewStatusPopover />` |
| 批注 | 💬 新建批注 | 进入画框批注模式 | `<AnnotationTool />` |
| 批注 | 👁️ 显示批注 | 开关批注可见性 | Toggle |
| 批注 | 📌 跳转到批注 | 列表定位到对应批注 | `<AnnotationList />` |

#### 「翻译」Tab

| 组名 | 按钮 | 交互 | 组件 |
|------|------|------|------|
| AI 翻译 | 🤖 AI 翻译 ▼ | 打开翻译 Popover | `<TranslateMenu />` |
| AI 翻译 | 📋 翻译记录 | 查看翻译历史 | `<TranslateHistoryPopover />` |
| 术语表 | 📖 查看术语表 | 只读查看 | `<GlossaryViewPanel />` |
| 语言 | 🌐 当前语言 | 只读 Badge | Badge |

### 5.7 Ribbon 扩展技术实现

| 要点 | 说明 |
|------|------|
| Tab 注册 | 在 `RibbonContainer.tsx` 的 `TABS` 中新增 `translate`、`review` |
| 新组件 | `components/editor/EditorRibbon/TranslateTab.tsx` |
| 新组件 | `components/editor/EditorRibbon/ReviewTab.tsx` |
| 顶栏增强 | `RibbonTabBar` 标题区支持 `languageBadge` |
| 状态栏增强 | `StatusBar` 增加 `reviewStatus`、`onShare` |
| Tab 顺序 | 通用 → 插入 → 设计 → 翻译 → 审阅 → 视图 |

---

## 6. 业务规则

### 6.1 PPTX 导入规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-001 | 扁平化策略 | 4 层样式继承（master→layout→slide→shape）合并为 flat DSL，不保留主题/母版结构 | DT-027,028 |
| BR-002 | 6 种元素映射 | text/image/shape/table/line/group（group 可递归嵌套） | DT-027,028 |
| BR-003 | 不支持元素降级 | chart/diagram 忽略, video/audio 忽略, math 降级为 image | DT-027 |
| BR-004 | 文件大小限制 | ≤ 200MB 统一异步处理, > 200MB 拒绝上传 | DT-029 |
| BR-005 | 服务端解析 | 浏览器内存不足，强制服务端 Node.js 解析 | DT-029 |
| BR-006 | SSE 进度推送 | 14 步流程，前端 EventSource 接收进度 | DT-029,030 |
| BR-007 | 任务与 SSE 解耦 | 提交层/处理层/进度层三层分离，SSE 断开不影响后台任务 | DT-029 |

#### 逐元素类型映射规则

**文本元素 (TextElement)**:

| pptxtojson 字段 | DSL 字段 | 转换说明 |
|-----------------|---------|---------|
| `type: 'text'` | `type: 'text'` | 直接映射 |
| `left/top/width/height` | `x/y/w/h` | 直接映射（pt） |
| `rotate` | `rotate` | 直接映射（degrees） |
| `isFlipH/isFlipV` | `flipX/flipY` | 直接映射 |
| `content` (HTML) | `contentHtml` | 需 HTML 清洗 |
| `vAlign: 'mid'` | `textStyle.verticalAlign` | 'mid' → 'middle' |
| `isVertical: true` | `textStyle.writingMode` | true → 'vertical' |
| `fill` | `fill` | 颜色/渐变/图片映射 |

**图片元素 (ImageElement)**:

| pptxtojson 字段 | DSL 字段 | 转换说明 |
|-----------------|---------|---------|
| `src` (base64) | `src` (URL) | base64 → 上传 Storage → URL |
| `rect` | `crop` | PPTX 裁剪百分比 → DSL 0-1 比例 |

**形状元素 (ShapeElement)**:

| pptxtojson 字段 | DSL 字段 | 转换说明 |
|-----------------|---------|---------|
| `shapType` | `shapeType` | 需映射表，不认识的→'custom'+path |
| `path` | `path` | SVG path（custom 兜底） |
| `keypoints` | `borderRadius` | roundRect 圆角值 |
| `content` (HTML) | `text` | 形状内文字，需 HTML 清洗 |

**表格元素 (TableElement)**:

| pptxtojson 字段 | DSL 字段 | 转换说明 |
|-----------------|---------|---------|
| `data[][]` | `cells[][]` | 逐单元格转换：cell.text→content, cell.fillColor→fill, cell.colspan/rowspan→保留 |
| `colWidths[]/rowHeights[]` | `colWidths[]/rowHeights[]` | 直接映射（pt） |

**线条元素 (LineElement)**:

| pptxtojson 字段 | DSL 字段 | 转换说明 |
|-----------------|---------|---------|
| `type:'shape'` 且 shapType 为线条类型 | `type:'line'` | 检测 line/straightConnector1/bentConnector*/curvedConnector* |
| 起点/终点 | `points[]` | 根据 isFlipH/isFlipV 计算坐标 |

**组合元素 (GroupElement)**:

| pptxtojson 字段 | DSL 字段 | 转换说明 |
|-----------------|---------|---------|
| `elements[]` | `children[]` | 递归调用 convertElement |

**形状类型映射表**:

| OOXML shapType | DSL shapeType | 备注 |
|----------------|--------------|------|
| rect | rect | 矩形 |
| roundRect | roundRect | 圆角矩形 |
| snip1Rect / snip2SameRect | roundRect | 降级 |
| ellipse | ellipse | 椭圆 |
| triangle / rtTriangle | triangle | 三角形 |
| diamond | diamond | 菱形 |
| rightArrow / leftArrow / upArrow / downArrow | arrow | 箭头 |
| star4 / star5 | star | 星形 |
| 未覆盖的 shapType | custom + path | SVG path 兜底 |

**背景映射**:

| pptxtojson fill | DSL Background | 转换说明 |
|-----------------|---------------|---------|
| `type:'color'` | `type:'color'` | hex 直接映射 |
| `type:'image'` | `type:'image'` | base64 → Storage URL |
| `type:'gradient'` | `type:'gradient'` | stops/angle → CSS gradient |
| `type:'pattern'` | `type:'color'` | 降级：提取主色调 |
| undefined/null | `type:'color'` | 默认白色 |

**layoutElements 处理策略**: 合并到 elements 数组最底层，先转换 layoutElements 再转换 slide.elements，去重相同位置+内容的元素。

#### PPTX 导入验收标准

- 文本内容 100% 保留
- 文本样式 90%+ 还原
- 图片资源成功率 ≥ 98%
- 形状位置/大小 95%+ 准确
- 表格结构 100% 保留
- 整体视觉还原度 ≥ 80%

### 6.2 PPTX 导入安全规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-008 | ZIP 炸弹检测 | 解压后总大小 ≤ 2GB；单文件数 ≤ 10000；目录层级 ≤ 10；压缩比 > 100 倍终止 | DT-027 |
| BR-009 | SSRF 防护 | 图片代理：协议白名单(https)、私网 IP 阻断、MIME 校验(image/*)、≤10MB、超时 3+10s | DT-028 |
| BR-010 | HTML XSS 防护 | href 协议白名单(http/https/mailto/tel)、on* 属性剥离、内联样式白名单、target="_blank" 强制 rel="noopener noreferrer" | DT-028 |

**HTML 清洗规则** (`normalizeHtml()`):
- 保留标签白名单：`<p>`, `<span style>`, `<strong>/<b>`, `<em>/<i>`, `<u>`, `<s>/<del>`, `<a href>`, `<sub>/<sup>`
- 移除不支持标签（如 `<font>`），提取样式到 `<span>`
- 规范化空段落：空 `<p>` → `<p><br></p>`（Tiptap 要求）
- 内联样式白名单 CSS：font-size, color, font-weight, font-style, text-decoration, font-family, line-height, letter-spacing, vertical-align, background-color
- 禁止 expression()、url()、position:fixed/absolute

### 6.3 AI 翻译规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-011 | 翻译双入口 | Editor(`source_type='presentation'`) + Gallery(`source_type='version'`)，共用 `ppt_translations` 表 | DT-034 |
| BR-012 | 翻译产出 | Editor 翻译在草稿库创建独立新 draft PPT（带语言标签） | DT-034 |
| BR-013 | 术语表条件 | 仅中文源时启用术语替换，非中文源自动跳过 | DT-034 |
| BR-014 | 翻译模型 | 通义千问 qwen-max，温度 0.3，单批 ≤ 50 条文本 | DT-034 |
| BR-015 | 状态机 | pending → processing → completed / failed | DT-034 |
| BR-016 | 失败恢复 | 单批次自动重试 3 次（指数退避 2s/4s/8s），3 次仍失败则整体 failed，丢弃部分结果 | DT-034 |
| BR-017 | 幂等去重 | 同一用户对同一源+目标语言的重复提交，30s 幂等去重 | DT-034 |
| BR-018 | 共享服务层 | `source_type='version'` 和 `source_type='presentation'` 共用 `@botool/ppt-core` 翻译服务层 | DT-034 |

### 6.4 Gate-Delete-Admin 规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-019 | 先复制后删除 | 删除管理代码前必须有 Gallery seed snapshot + env contract | DT-001~004 |
| BR-020 | Gate 通过条件 | 基线 tag 已创建 + 参考清单完成 + Seed 快照可用 + Env 合同确认 | DT-004 |
| BR-021 | 禁删范围 | Gate 未通过前，禁止执行删除整页/删除管理组件/删除管理端页面路由 | DT-017 |

### 6.5 表名迁移规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-022 | 全局替换 | `present_*` → `ppt_*` (~162 处 `.from()` 调用) | DT-022 |
| BR-023 | 双轨切换 | 先创建 ppt_* → 回填 → 一致性校验 → 切流 → 下线 present_* | DT-012~016 |

### 6.6 分享与访问控制规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-024 | 文档可见性 | private/internal/public + visibility_groups 精细控制 | DT-014 |
| BR-025 | 链接访问-有权限 | 直接渲染 PPT 预览页 | DT-014 |
| BR-026 | 链接访问-无权限 | 渲染索要授权页面，PPT 标题可见，内容不可见 | DT-014 |
| BR-027 | 访问请求唯一性 | 一个用户对同一 PPT 只能有一个 pending 请求 | DT-014 |
| BR-028 | 审批→自动添加 | approve → 自动添加为 collaborator | DT-014 |

### 6.7 导入导出格式支持矩阵

| 格式 | 导入 | 导出 | 优先级 |
|------|------|------|--------|
| **.pptbt** | ✅ | ✅ | P0 |
| **PDF** | ❌ | ✅ | P1 |
| **PPTX** | ✅ | ❌ | P1 |
| **.ppt** | ❌ 不支持 | ❌ | - |
| **PNG** | ❌ | ✅ 单页/多页 | P2 |

### 6.8 边框类型映射规则

> **[T7 补充自源 PRD §5.4.3.4]**

| pptxtojson borderType | DSL border.style |
|----------------------|-----------------|
| 'solid' / undefined | 'solid' |
| 'dashed' / 'lgDash' | 'dashed' |
| 'dotted' / 'sysDot' | 'dotted' |
| 'dashDot' | 'dashed' |
| 其他 | 'solid'（兜底） |

### 6.9 PPTX 导入取消语义规则

> **[T7 补充自源 PRD §5.4.8]**

| 阶段 | 可取消性 | 取消行为 |
|------|----------|----------|
| `uploading` | 可立即取消 | 中断 XHR 上传，不完整文件自动丢弃 |
| `parsing` | 可取消 | 调用 cancel API，服务端终止解析 |
| `images` | 可取消 | 服务端停止剩余图片上传，已上传图片随任务清理 |
| `converting` | 可取消但不确定 | 服务端尽力终止，partial 文档自动删除 |
| `saving` | 不可取消 | 按钮禁用，提示"正在保存，请稍候…" |

### 6.10 导入进度百分比分配规则

> **[T7 补充自源 PRD §5.4.8]**

| 阶段 | 百分比 | stage |
|------|--------|-------|
| 上传文件到服务器 | 0-15% | `uploading`（前端 XHR 进度） |
| 解析 PPTX 结构 | 15-25% | `parsing` |
| 处理图片资源 | 25-80% | `images`（最耗时） |
| 转换文档格式 | 80-95% | `converting` |
| 保存文档 | 95-100% | `saving` |

### 6.11 SSE 事件类型定义

> **[T7 补充自源 PRD §5.4.8]**

```typescript
interface ImportProgressEvent {
  type: 'progress'
  stage: 'uploading' | 'parsing' | 'images' | 'converting' | 'saving'
  percent: number              // 0-100
  detail?: string              // 如 "图片 12/35"
}

interface ImportCompleteEvent {
  type: 'complete'
  presentationId: number
  slideCount: number
  warnings: string[]           // 如 ["2 张图片未能加载"]
}

interface ImportErrorEvent {
  type: 'error'
  message: string
  code?: string                // 'ENCRYPTED', 'CORRUPTED', 'TOO_LARGE', 'ZIP_BOMB'
}
```

### 6.12 导入超时防护规则

> **[T7 补充自源 PRD §5.4.7]**

| 场景 | 策略 |
|------|------|
| 文件上传超时 | 前端 XHR 带 progress 事件，超时设为 5 分钟 |
| SSE 连接断开 | 前端自动重连（EventSource 原生），服务端保存进度状态，重连后从上次继续 |
| 服务端处理超时 | maxDuration: 300，超时前保存已完成部分 |
| 图片上传部分失败 | 失败图片用占位符替代，不阻断整体 |
| 浏览器标签页关闭 | 任务执行与 SSE 生命周期解耦，重新打开时检查 status='importing' |

### 6.13 导入风险与应对规则

> **[T7 补充自源 PRD §5.4.5]**

| 风险项 | 应对方案 |
|--------|----------|
| pptxtojson 解析失败（文件损坏/加密） | try-catch，提示"无法解析此文件，请确认文件未损坏且未加密" |
| 部分样式丢失 | 导入完成后提示"部分高级效果可能简化显示，建议检查并调整" |
| 字体不可用 | 使用 theme.font 兜底：latin→Arial, cjk→Alibaba PuHuiTi |
| 图片上传失败 | 单张失败不阻断整体，失败图片 src 设为占位符，提示"N 张图片上传失败" |
| 中大文件（50-200MB） | 强制走异步导入 + SSE 进度，服务端解析避免浏览器 OOM |
| 动画/转场/音视频 | 静默忽略，不报错 |
| 密码保护 PPTX | pptxtojson 会抛异常，提示"此文件受密码保护，请解除保护后重试" |

### 6.14 图片处理流程规则

> **[T7 补充自源 PRD §5.4.2]**

1. 遍历所有元素，收集 base64 src
2. 对 base64 取 hash 去重（同图片只上传一次）
3. 并发上传到 Supabase Storage (ppt-files bucket)
   路径: `presentations/{presentationId}/images/{hash}.{ext}`
   并发度限制: 最多 5 个
4. 遍历 DSL，用 hash→URL 映射替换所有图片引用

### 6.15 导出功能规则

> **[T7 补充自源 PRD §5.5]**

#### .pptbt 导出（Botool 原生格式）

技术栈：`jszip`（浏览器端 ZIP 打包）

```
打包结构:
document.pptbt (ZIP)
├── manifest.json     # 元信息
├── content.json      # DSL（图片路径改为相对路径 media/xxx.png）
└── media/            # 所有图片资源
    ├── img_001.png
    └── ...
```

SSRF 防护基线 — 图片代理下载时：协议白名单(仅 https://)、DNS/IP 黑名单(拒绝私网)、最大响应体≤10MB、超时 3+10s、MIME 须为 image/*、审计日志。

#### PNG 图片导出

技术栈：`html2canvas`（复用 PDF 导出截图逻辑）

| 规则 | 说明 |
|------|------|
| 单页导出 | 当前页 DOM → canvas → `toBlob('image/png')` 直接下载 |
| 多页导出 | 按页渲染后写入 ZIP（`JSZip`），文件名 `slide_{index}.png` |
| 透明背景 | 导出前铺白底，避免深色主题下背景透明 |
| 大文档保护 | 页数 > 50 时提示，允许仅导出当前页/范围 |
| 缩放比例 | 1x / 2x / 3x |

### 6.16 AI 翻译运行时规则

> **[T7 补充自源 PRD §6.4.4]**

| ID | 规则 | 说明 |
|----|------|------|
| BR-029 | 共享翻译服务 | `source_type='version'`(Gallery) 与 `source_type='presentation'`(Editor) 共用 `@botool/ppt-core` 翻译服务层，避免双实现漂移 |
| BR-030 | 术语表降级 | 当源语言非 `zh` 时，术语表流程自动降级为"仅普通翻译，不做术语替换" |
| BR-031 | 统一翻译表 | 所有翻译任务写入统一 `ppt_translations`，前端仅按 `source_type` 区分来源 |
| BR-032 | 任务日志 | 日志写入 `logs JSONB`，前端 UI 只读展示，不在客户端拼接状态 |

### 6.17 审批与批注规则

> **[T7 补充自源 PRD §7]**

审批流程从 Present 迁移，包括审批配置、状态追踪、批注标注。

| 功能 | 说明 |
|------|------|
| 发起审批 | 审批配置对话框，选择审批人 |
| 审批详情 | 查看审批状态流转 |
| 新建批注 | 画框批注模式，标注到幻灯片 |
| 批注可见性 | 开关批注显隐 |
| 批注定位 | 列表点击跳转到对应批注位置 |

---

## 7. 开发计划

### 7.0 Phase 依赖图

```
Pre-Phase ──▶ Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3
[Gate安全]    [ppt-core]   [新建表]    [删代码]    [审阅Tab]
DT:4 (P0)    DT:7 (P0)    DT:5 (P0)   DT:8 (P0)   DT:2 (P1)
                                            │
                                            ├──▶ Phase 4
                                            │    [导入导出]
                                            │    DT:6 (P1)
                                            │
                                            └──▶ Phase 5
                                                 [翻译Tab]
                                                 DT:3 (P2)

依赖关系:
Pre-Phase → Phase 0 → Phase 1 → Phase 2（严格顺序）
Phase 3, Phase 4, Phase 5 可并行（均依赖 Phase 2）
```

### 7.1 Pre-Phase: Gallery 交接基线 (P0)

> **前置**: 无
> **产出**: Gallery 可复用代码基线 + 路径映射 + Env 合同；作为后续删除管理代码的硬门禁
> **对应设计**: Section 3.1, 6.4

- [ ] DT-001: 创建 Gallery baseline tag + 参考代码清单 (`文件: docs/migration/gallery-reference-inventory.md`)
  - 在删除管理代码前创建基线 tag `present-v5-gallery-seed-baseline`
  - 清单覆盖 `components/admin/*`, `components/library/*`, `app/(main)/library/admin/*`, `app/api/admin/*`, `app/api/version-groups/*`, `app/api/translations/*`
  - Typecheck passes

- [ ] DT-002: Gallery Seed 快照导出 + 路径映射 (`文件: docs/migration/gallery-seed/`, `docs/migration/gallery-path-mapping.md`)
  - 将可复用参考实现复制到 `docs/migration/gallery-seed/`
  - 生成"旧路径 → Gallery 目标路径"映射表
  - 对核心参考组件标注复用策略（A/B/C）
  - Typecheck passes

- [ ] DT-003: Env 合同输出 (`文件: docs/migration/gallery-env-contract.md`, `docs/migration/.env.example.gallery`)
  - 合同覆盖: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_DASHBOARD_URL, NEXT_PUBLIC_BASE_PATH, NEXT_PUBLIC_BOTOOL_ENV, QWEN_API_KEY
  - Typecheck passes

- [ ] DT-004: Gate-Delete-Admin 通过检查 (`文件: docs/migration/gate-check-result.md`)
  - 验证基线 tag 已创建且可追溯
  - 验证参考清单 + 路径映射文档已完成
  - 验证 Gallery Seed 快照已导出
  - 验证 Env 合同文档已确认
  - 记录 Gate 通过结果
  - Typecheck passes

### 7.2 Phase 0: 共享包提取 + DB 脚本 (P0)

> **前置**: Pre-Phase
> **产出**: `@botool/ppt-core` 共享包 + `ppt_*` 数据库 SQL 脚本（仅产出，不执行）
> **对应设计**: Section 3.9, 4.2

- [ ] DT-005: ppt-core 共享包骨架初始化 (`文件: libs/ppt-core/package.json`, `libs/ppt-core/tsconfig.json`, `libs/ppt-core/index.ts`)
  - 创建 `libs/ppt-core/` 目录
  - 设计 index.ts 导出面（types/services/converter/config/security）
  - 更新 `pnpm-workspace.yaml`
  - Typecheck passes

- [ ] DT-006: 类型定义提取到 ppt-core (`文件: libs/ppt-core/types/dsl.ts`, `types/document.ts`, `types/version.ts`, `types/translation.ts`)
  - 将 DSL 类型从 Present 提取到 `@botool/ppt-core`
  - 将版本/翻译/文档类型提取
  - Present 端改为 import `@botool/ppt-core`
  - Typecheck passes

- [ ] DT-007: 服务层提取到 ppt-core (`文件: libs/ppt-core/services/document.service.ts`, `dsl.service.ts`, `version.service.ts`, `translation.service.ts`, `collaborator.service.ts`, `review.service.ts`)
  - 将 translation/version/document service 层提取
  - Present API route handler 改为调用 `@botool/ppt-core`
  - 接口行为不变
  - Typecheck passes

- [ ] DT-008: Converter + Security 提取到 ppt-core (`文件: libs/ppt-core/converter/`, `libs/ppt-core/security/sanitize.ts`, `libs/ppt-core/config/languages.ts`, `libs/ppt-core/config/qwen.ts`)
  - 将 converter/security/config 工具提取
  - Present 端改为 import `@botool/ppt-core`
  - Typecheck passes

- [ ] DT-009: Present 端 import 路径全量切换 (`全局`)
  - 所有组件 import types/converter/security → `@botool/ppt-core`
  - 所有 API route handler 调用 service → `@botool/ppt-core`
  - 确认无 import 残留（引用提取前旧路径的 import 语句）
  - `pnpm build` 通过
  - Typecheck passes

- [ ] DT-010: ppt_* 前缀建表 SQL 脚本产出 (`文件: sql/create-ppt-tables.sql`)
  - 编写全部 13 张 ppt_* 表的 CREATE TABLE SQL（基于 Section 4.2）
  - 编写 RLS 策略脚本
  - 编写索引脚本
  - Typecheck passes

- [ ] DT-011: 数据回填 + 一致性校验脚本产出 (`文件: sql/backfill-present-to-ppt.sql`, `sql/verify-consistency.sql`)
  - 编写 `present_* → ppt_*` 历史数据回填脚本
  - 编写一致性校验脚本（行数/关键字段/抽样 DSL）
  - Typecheck passes

### 7.3 Phase 1: 数据库创建 + 回填校验 (P0)

> **前置**: Phase 0
> **产出**: 所有 `ppt_*` 表创建完成，历史数据回填并通过一致性校验
> **对应设计**: Section 4.2, 4.3

- [ ] DT-012: 执行核心表创建 SQL (`SQL: ppt_documents, ppt_dsl_snapshots`)
  - 执行 ppt_documents 主表创建
  - 执行 ppt_dsl_snapshots 快照表创建
  - 运行验证 SQL 确认表存在
  - Typecheck passes

- [ ] DT-013: 执行版本表创建 SQL (`SQL: ppt_version_groups, ppt_versions, ppt_translations`)
  - 执行版本组/版本/翻译表创建
  - 确认约束正确（CHECK, UNIQUE）
  - Typecheck passes

- [ ] DT-014: 执行访问/协作/审批表创建 SQL (`SQL: ppt_access_requests, ppt_visibility_groups, ppt_collaborators, ppt_comments, ppt_comment_replies, ppt_reviews, ppt_reviewers, ppt_access_history`)
  - 执行全部辅助表创建
  - 确认 RLS 策略正确
  - Typecheck passes

- [ ] DT-015: Storage Bucket 创建 + 数据回填 (`Storage: ppt-files`, `SQL: backfill`)
  - 创建 ppt-files Storage Bucket
  - 执行 `present_* → ppt_*` 回填脚本
  - 执行数据一致性校验
  - Typecheck passes

- [ ] DT-016: RLS 策略全量启用 + 验证 (`SQL: RLS policies`)
  - 为所有新表启用 RLS 策略
  - 运行验证确认 RLS 生效
  - 编辑器保存功能正常（写入 ppt_documents）
  - Typecheck passes

### 7.4 Phase 2: Present 清理 + 表名更新 (P0)

> **前置**: Phase 1
> **产出**: Present 成为纯 PPT 编辑器，管理代码已删除，所有运行时表引用更新为 `ppt_*`
> **对应设计**: Section 3.1, 6.4, 6.5

- [ ] DT-017: Gate-Delete-Admin 复核 (`文件: docs/migration/gate-check-result.md`)
  - 复核基线 tag 与参考清单可访问
  - 复核 Gallery Seed 快照与路径映射完整
  - 复核 Env 合同可直接用于 Gallery 初始化
  - Gate 通过后才继续
  - Typecheck passes

- [ ] DT-018: 删除 /upload 页面 (`删除: app/(main)/upload/page.tsx`, `修改: config/menu-items.ts`)
  - 删除上传页面
  - 删除侧边栏「上传文档」入口
  - Typecheck passes

- [ ] DT-019: 删除管理端组件 (`删除: components/admin/TranslateDialog.tsx`, `TranslationProgress.tsx`, `ManualCreateDialog.tsx`, `components/library/CategoryManager.tsx`)
  - 删除由 Gallery 全新实现的管理端组件
  - 确认无 import 残留
  - Typecheck passes

- [ ] DT-020: 简化版本状态模型 (`修改: @botool/ppt-core → services/version-status.service.ts`, `types/version.ts`)
  - 移除 editing 状态：三态 → 两态（draft/published）
  - 清理所有 `status: 'editing'` 引用
  - Typecheck passes

- [ ] DT-021: 删除管理端页面 + API 路由 (`删除: app/library/*`, `app/(admin)/*`, `app/api/admin/*`, `app/api/categories/*`, `app/api/glossary/*`)
  - 删除前台浏览/管理后台页面
  - 删除管理端 API
  - 确认无残留路由
  - Typecheck passes

- [ ] DT-022: 全局表名替换 present_* → ppt_* (`全局: ~162 处 .from() 调用`)
  - 全局替换 `.from('present_presentations')` → `.from('ppt_documents')`
  - 全局替换所有 `present_*` 表引用
  - service 层统一使用 `@botool/ppt-core`
  - [安全] 使用参数化查询防止 SQL 注入
  - [安全] 错误响应不泄露内部信息
  - Typecheck passes

- [ ] DT-023: API 路径 + import 更新 (`修改: app/api/presentations/`)
  - 编辑器 API 统一 `/api/presentations/` 前缀
  - 组件 import → `@botool/ppt-core`
  - API route handler → `@botool/ppt-core`
  - [安全] 添加权限检查
  - `pnpm build` 通过
  - Typecheck passes

- [ ] DT-024: 编辑器首页下拉菜单 (`修改: 编辑器首页组件`)
  - 合并 [+ 新建文档] + [导入] → [+ 新增 PPT ▼] 下拉
  - 选项：✏️ 创建空白 PPT / 📤 上传 .pptbt / 📤 上传 PPTX
  - Verify in browser
  - Typecheck passes

### 7.5 Phase 3: Ribbon 扩展 — 审阅 Tab (P1)

> **前置**: Phase 2
> **产出**: 编辑器中新增「审阅」Tab
> **对应设计**: Section 5.6

- [ ] DT-025: 审阅 Tab 注册 + ReviewTab 组件 (`组件: components/editor/EditorRibbon/ReviewTab.tsx`, `修改: RibbonContainer.tsx`)
  - 在 TABS 中注册 review Tab
  - 实现 ReviewTab.tsx 组件
  - 接入审批/批注组件
  - Verify in browser
  - Typecheck passes

- [ ] DT-026: 审阅/批注集成 + 状态栏扩展 (`修改: StatusBar`, `RibbonTabBar`)
  - 状态栏增加审批状态指示
  - 状态栏增加 [分享] 按钮
  - 顶栏标题区增加语言 Badge
  - Verify in browser
  - Typecheck passes

### 7.6 Phase 4: 导入导出完善 (P1)

> **前置**: Phase 2
> **产出**: PPTX 导入 + PDF/.pptbt 导出可用
> **对应设计**: Section 6.1, 6.2, 8.E

- [ ] DT-027: PPTX 核心转换器 (`文件: libs/ppt-core/converter/pptx-to-dsl.ts`, `pptx-types.ts`, `pptx-html-cleaner.ts`)
  - 实现主转换入口 + 元素路由
  - 实现 pptxtojson 输出类型定义
  - 实现 HTML 清洗器（normalizeHtml + XSS 防护）
  - [安全] 文件类型白名单校验
  - [安全] 字符串长度限制
  - Typecheck passes

- [ ] DT-028: PPTX 辅助转换器 (`文件: libs/ppt-core/converter/pptx-shape-map.ts`, `pptx-image-upload.ts`, `pptx-fill-converter.ts`)
  - 实现形状映射表（OOXML → DSL）
  - 实现图片批量上传（base64 → Storage，并发度 5）
  - 实现填充样式转换（color/image/gradient/pattern）
  - [安全] 文件大小限制（单张 ≤ 10MB）
  - [安全] 存储路径不可由用户控制
  - Typecheck passes

- [ ] DT-029: SSE 双阶段导入 API (`API: POST /api/presentations/import`, `GET /api/presentations/[id]/import-sse`, `POST /api/presentations/imports/[importId]/cancel`)
  - 实现文件上传 + 创建记录 API
  - 实现 SSE 进度推送 API（14 步流程）
  - 实现取消导入 API
  - runtime = 'nodejs', maxDuration = 300
  - [安全] ZIP 炸弹检测（解压后 ≤ 2GB，文件数 ≤ 10000）
  - [安全] 文件类型白名单校验
  - [安全] 文件大小限制（≤ 200MB）
  - [安全] 使用参数化查询防止 SQL 注入
  - [安全] 添加权限检查
  - Typecheck passes

- [ ] DT-030: ImportProgressDialog + ExportDialog 组件 (`组件: components/file/ImportProgressDialog.tsx`, `components/file/ExportDialog.tsx`)
  - 实现导入进度弹窗（SSE 连接 + 分阶段进度 + 取消）
  - 实现导出对话框（格式选择 + 范围选择 + 进度）
  - [安全] XSS 防护
  - Verify in browser
  - Typecheck passes

- [ ] DT-031: PDF + .pptbt 导出实现 (`文件: libs/ppt-core/converter/dsl-to-pdf.ts`, `dsl-to-pptbt.ts`, `pptbt-to-dsl.ts`)
  - 实现 PDF 导出（html2canvas + jspdf）
  - 实现 .pptbt 导出（jszip 打包）
  - 实现 .pptbt 导入（jszip 解包 + Storage 上传）
  - [安全] SSRF 防护（协议白名单、私网 IP 阻断、MIME 校验）
  - Typecheck passes

- [ ] DT-032: PPTX 导入验收测试 (`测试文件: 10 个 PPTX 样本`)
  - 纯文本 PPT（多种字号/颜色）
  - 图片为主 PPT（含裁剪）
  - 多种形状 PPT（含自定义形状）
  - 含表格 PPT（含合并单元格）
  - 含组合 PPT（含嵌套组合）
  - 深色主题 PPT
  - 含渐变背景/形状 PPT
  - 含母版 logo/装饰 PPT
  - 真实商务 PPT（综合）
  - 竖排文字 PPT
  - 验收: 文本 100% 保留, 样式 90%+, 图片 98%+, 整体视觉 ≥ 80%
  - Typecheck passes

### 7.7 Phase 5: Ribbon 扩展 — 翻译 Tab (P2)

> **前置**: Phase 2
> **产出**: 编辑器中新增「翻译」Tab + Editor AI 翻译功能
> **对应设计**: Section 5.6, 6.3

- [ ] DT-033: 翻译 Tab 注册 + 组件 (`组件: components/editor/EditorRibbon/TranslateTab.tsx`, `components/editor/TranslateMenu.tsx`, `components/dialogs/TranslateHistoryPopover.tsx`, `components/dialogs/GlossaryViewPanel.tsx`)
  - 在 TABS 中注册 translate Tab
  - 实现 TranslateTab.tsx + TranslateMenu
  - 实现翻译记录查看 + 术语表只读面板
  - [安全] 输入使用 schema 验证（zod）
  - [安全] XSS 防护
  - Verify in browser
  - Typecheck passes

- [ ] DT-034: Editor 翻译 API + 进度 API (`API: POST /api/presentations/[id]/translate`, `GET /api/presentations/translations/[id]/progress`)
  - 实现 Editor 翻译发起 API
  - 实现翻译进度查询 API（前端每 3 秒轮询）
  - 翻译产出：草稿库创建独立 draft PPT
  - 复用 `@botool/ppt-core` 翻译服务层
  - [安全] 使用参数化查询防止 SQL 注入
  - [安全] 错误响应不泄露内部信息
  - [安全] 添加权限检查
  - [安全] 速率限制（30s 幂等去重）
  - Typecheck passes

- [ ] DT-035: TranslateConfirmDialog + TranslateProgressDialog (`组件: components/dialogs/TranslateConfirmDialog.tsx`, `components/dialogs/TranslateProgressDialog.tsx`)
  - 实现翻译前确认弹窗
  - 实现翻译进度弹窗（含实时日志面板）
  - 实现翻译完成确认弹窗
  - [安全] XSS 防护
  - Verify in browser
  - Typecheck passes

---

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `docs/migration/gallery-reference-inventory.md` | 待开发 | Pre | DT-001 |
| `docs/migration/gallery-seed/` | 待开发 | Pre | DT-002 |
| `docs/migration/gallery-path-mapping.md` | 待开发 | Pre | DT-002 |
| `docs/migration/gallery-env-contract.md` | 待开发 | Pre | DT-003 |
| `libs/ppt-core/package.json` | 待开发 | 0 | DT-005 |
| `libs/ppt-core/index.ts` | 待开发 | 0 | DT-005 |
| `libs/ppt-core/types/dsl.ts` | 提取 | 0 | DT-006 |
| `libs/ppt-core/types/document.ts` | 提取 | 0 | DT-006 |
| `libs/ppt-core/types/version.ts` | 提取 | 0 | DT-006 |
| `libs/ppt-core/types/translation.ts` | 提取 | 0 | DT-006 |
| `libs/ppt-core/services/document.service.ts` | 提取 | 0 | DT-007 |
| `libs/ppt-core/services/dsl.service.ts` | 提取 | 0 | DT-007 |
| `libs/ppt-core/services/version.service.ts` | 提取 | 0 | DT-007 |
| `libs/ppt-core/services/translation.service.ts` | 提取 | 0 | DT-007 |
| `libs/ppt-core/converter/pptx-to-dsl.ts` | 待开发 | 4 | DT-027 |
| `libs/ppt-core/converter/pptx-types.ts` | 待开发 | 4 | DT-027 |
| `libs/ppt-core/converter/pptx-html-cleaner.ts` | 待开发 | 4 | DT-027 |
| `libs/ppt-core/converter/pptx-shape-map.ts` | 待开发 | 4 | DT-028 |
| `libs/ppt-core/converter/pptx-image-upload.ts` | 待开发 | 4 | DT-028 |
| `libs/ppt-core/converter/pptx-fill-converter.ts` | 待开发 | 4 | DT-028 |
| `libs/ppt-core/converter/dsl-to-pdf.ts` | 待开发 | 4 | DT-031 |
| `libs/ppt-core/converter/dsl-to-pptbt.ts` | 待开发 | 4 | DT-031 |
| `libs/ppt-core/converter/pptbt-to-dsl.ts` | 待开发 | 4 | DT-031 |
| `libs/ppt-core/security/sanitize.ts` | 提取 | 0 | DT-008 |
| `libs/ppt-core/config/languages.ts` | 提取 | 0 | DT-008 |
| `libs/ppt-core/config/qwen.ts` | 提取 | 0 | DT-008 |
| `sql/create-ppt-tables.sql` | 待开发 | 0 | DT-010 |
| `sql/backfill-present-to-ppt.sql` | 待开发 | 0 | DT-011 |
| `sql/verify-consistency.sql` | 待开发 | 0 | DT-011 |
| `components/editor/EditorRibbon/ReviewTab.tsx` | 待开发 | 3 | DT-025 |
| `components/editor/EditorRibbon/TranslateTab.tsx` | 待开发 | 5 | DT-033 |
| `components/editor/TranslateMenu.tsx` | 待开发 | 5 | DT-033 |
| `components/dialogs/TranslateConfirmDialog.tsx` | 待开发 | 5 | DT-035 |
| `components/dialogs/TranslateProgressDialog.tsx` | 待开发 | 5 | DT-035 |
| `components/file/ImportProgressDialog.tsx` | 待开发 | 4 | DT-030 |
| `components/file/ExportDialog.tsx` | 待开发 | 4 | DT-030 |
| `app/api/presentations/import/route.ts` | 改造 | 4 | DT-029 |
| `app/api/presentations/[id]/import-sse/route.ts` | 待开发 | 4 | DT-029 |
| `app/api/presentations/[id]/translate/route.ts` | 待开发 | 5 | DT-034 |
| `app/api/presentations/translations/[id]/progress/route.ts` | 待开发 | 5 | DT-034 |
| `app/(editor)/editor/[id]/page.tsx` | ✅ 已有 | 3/5 | DT-025,033 |
| `app/(present)/present/[id]/page.tsx` | ✅ 已有 | 3 | DT-026 |
| `components/editor/*` | ✅ 已有 | - | 保留 |
| `components/renderer/*` | ✅ 已有 | - | 保留 |
| `stores/presentation-store.ts` | ✅ 已有 | - | 保留 |

### B. API 端点汇总

#### Present 编辑器专属 API

| API | 方法 | 说明 | Phase |
|-----|------|------|-------|
| `/api/presentations/[id]/dsl` | GET/PUT | DSL 读写 | 2 |
| `/api/presentations` | POST | 创建新文档 | 2 |
| `/api/presentations/[id]/versions` | GET | 版本历史 | 2 |
| `/api/presentations/[id]/versions/[ver]` | GET/POST | 获取/恢复版本 | 2 |
| `/api/presentations/recent` | GET/DELETE | 最近文档 | 2 |
| `/api/presentations/[id]/access` | POST | 记录访问 | 2 |
| `/api/presentations/import` | POST | PPTX/.pptbt 导入 | 4 |
| `/api/presentations/[id]/import-sse` | GET(SSE) | 导入进度 | 4 |
| `/api/presentations/imports/[importId]/cancel` | POST | 取消导入 | 4 |
| `/api/presentations/[id]/translate` | POST | Editor AI 翻译 | 5 |
| `/api/presentations/translations/[id]/progress` | GET | 翻译进度 | 5 |
| `/api/presentations/[id]/collaborators` | GET/POST/DELETE | 协作者 | 2 |
| `/api/presentations/[id]/access-requests` | POST/GET/PATCH | 访问请求 | 2 |
| `/api/presentations/[id]/reviews` | GET/POST | 审批 | 3 |
| `/api/presentations/[id]/comments` | GET/POST | 评论/批注 | 3 |

### C. 风险与缓解措施

#### HIGH

- **表名全局替换 ~162 处**: 遗漏会导致运行时错误 → **缓解**: 使用 `grep -r` 全量扫描，构建替换脚本，替换后 `pnpm build` + 集成测试
- **Gate-Delete-Admin 遗漏检查**: 可能删除正在使用的代码 → **缓解**: 严格执行 Gate 通过条件，创建基线 tag 可回溯

#### MEDIUM

- **PPTX 导入扁平化逻辑复杂**: 边界情况多 → **缓解**: 10 个验收测试文件覆盖主要场景
- **ppt-core 提取后 import 路径需全量更新**: 遗漏会编译失败 → **缓解**: `pnpm build` 作为每步检查点

#### LOW

- **AI 翻译依赖外部 API（通义千问）**: 需处理超时 → **缓解**: 指数退避重试，失败后用户手动重试

### D. 非目标 (Out of Scope)

- **Gallery 应用开发** — 由独立的 Gallery PRD 负责
- **gallery_* 表创建** — 由 Gallery PRD 负责
- **PPTX 导出** — 当前仅支持导入
- **图表/SmartArt/音视频导入** — 后续迭代
- **断点续传翻译** — 当前为全量重试模式

### E. 安全检查项

#### PPTX 导入安全 (DT-027, DT-028, DT-029)

- [安全] ZIP 炸弹检测：解压后总大小 ≤ 2GB，单文件数 ≤ 10000，目录层级 ≤ 10
- [安全] SSRF 防护：协议白名单(https)、私网 IP 阻断、MIME 校验(image/*)、≤10MB
- [安全] HTML XSS 防护：href 协议白名单、on* 属性剥离、内联样式白名单
- [安全] 文件类型白名单校验
- [安全] 文件大小限制（≤ 200MB）
- [安全] 存储路径不可由用户控制

#### API 安全 (DT-022, DT-023, DT-029, DT-034)

- [安全] 使用参数化查询防止 SQL 注入
- [安全] 错误响应不泄露内部信息
- [安全] 添加权限检查
- [安全] 输入使用 schema 验证（zod）

#### AI 翻译安全 (DT-034)

- [安全] 速率限制（30s 幂等去重）
- [安全] 输入验证

#### 文件上传安全 (DT-028, DT-029, DT-031)

- [安全] 文件类型白名单校验
- [安全] 文件大小限制
- [安全] 存储路径不可由用户控制

### F. 技术实现详情

#### F.1 PDF 导出实现

**文件位置**: `@botool/ppt-core` → `converter/dsl-to-pdf.ts`
**依赖**: `html2canvas` + `jspdf`

```typescript
interface ExportPdfOptions {
  range?: 'all' | 'current' | [number, number]
  scale?: number  // 缩放比例，默认 2
  onProgress?: (current: number, total: number) => void
}

export async function exportToPdf(
  dsl: PresentationDSL,
  options: ExportPdfOptions = {}
): Promise<Blob> {
  const { range = 'all', scale = 2, onProgress } = options
  const slidesToExport = getSlidesToExport(dsl.slides, range)
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [dsl.size.width, dsl.size.height]
  })
  for (let i = 0; i < slidesToExport.length; i++) {
    const slide = slidesToExport[i]
    const container = createSlideContainer(dsl, slide)
    document.body.appendChild(container)
    try {
      const canvas = await html2canvas(container, {
        scale, useCORS: true, allowTaint: false, backgroundColor: null, logging: false
      })
      if (i > 0) pdf.addPage()
      const imgData = canvas.toDataURL('image/jpeg', 0.95)
      pdf.addImage(imgData, 'JPEG', 0, 0, dsl.size.width, dsl.size.height)
      onProgress?.(i + 1, slidesToExport.length)
    } finally { document.body.removeChild(container) }
  }
  return pdf.output('blob')
}
```

#### F.2 .pptbt 导出实现

**文件位置**: `@botool/ppt-core` → `converter/dsl-to-pptbt.ts`
**依赖**: `jszip`

```typescript
export async function exportToPptbt(
  dsl: PresentationDSL,
  options: ExportPptbtOptions = {}
): Promise<Blob> {
  const { onProgress } = options
  const zip = new JSZip()
  // 1. manifest.json
  zip.file('manifest.json', JSON.stringify({
    version: '1.0', generator: 'Botool Present', generatorVersion: '1.6.0',
    created: new Date().toISOString(), title: dsl.meta.title, slideCount: dsl.slides.length
  }, null, 2))
  // 2. 提取图片 URL → 下载 → 添加到 ZIP
  const imageUrls = extractImageUrls(dsl)
  const imageMap = new Map<string, string>()
  // ... (并发下载，SSRF 防护：协议白名单、私网 IP 阻断、MIME 校验)
  // 3. 替换 DSL 中图片路径 → content.json
  const processedDsl = replaceImagePaths(dsl, imageMap)
  zip.file('content.json', JSON.stringify(processedDsl, null, 2))
  // 4. 生成 ZIP
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
```

#### F.3 PPTX 导入关键类型定义

```typescript
// @botool/ppt-core/converter/pptx-types.ts
export interface PptxJsonOutput {
  slides: PptxJsonSlide[]
  themeColors: string[]
  size: { width: number; height: number }
}

export interface PptxJsonSlide {
  fill?: PptxFill
  elements: PptxJsonElement[]
  layoutElements?: PptxJsonElement[]
  note?: string
}

export interface PptxJsonElement {
  type: 'text' | 'image' | 'shape' | 'table' | 'chart'
       | 'group' | 'video' | 'audio' | 'math' | 'diagram'
  left: number; top: number; width: number; height: number
  rotate?: number; isFlipH?: boolean; isFlipV?: boolean; name?: string
  fill?: PptxFill
  borderColor?: string; borderWidth?: number; borderType?: string
  shadow?: PptxShadow
  content?: string; vAlign?: 'top' | 'mid' | 'bottom'; isVertical?: boolean
  src?: string
  rect?: { l?: number; t?: number; r?: number; b?: number }
  shapType?: string; path?: string; keypoints?: unknown[]
  data?: PptxTableCell[][]; colWidths?: number[]; rowHeights?: number[]
  elements?: PptxJsonElement[]
}

export interface PptxTableCell {
  text?: string; content?: string; fillColor?: string
  fontColor?: string; fontSize?: number; bold?: boolean; italic?: boolean
  colspan?: number; rowspan?: number
  borderBottom?: PptxBorderSide; borderTop?: PptxBorderSide
  borderLeft?: PptxBorderSide; borderRight?: PptxBorderSide
}
```

#### F.4 HTML 清洗器

```typescript
// @botool/ppt-core/converter/pptx-html-cleaner.ts
export function normalizeHtml(html: string): string {
  if (!html || html.trim() === '') return '<p></p>'
  let cleaned = html
  cleaned = cleaned.replace(/<font([^>]*)>/gi, '<span$1>')
  cleaned = cleaned.replace(/<\/font>/gi, '</span>')
  if (!cleaned.includes('<p>') && !cleaned.includes('<p ')) {
    cleaned = `<p>${cleaned}</p>`
  }
  cleaned = cleaned.replace(/<p><\/p>/g, '<p><br></p>')
  cleaned = cleaned.replace(/<p>\s*<\/p>/g, '<p><br></p>')
  return cleaned
}
```

#### F.5 形状映射表

```typescript
// @botool/ppt-core/converter/pptx-shape-map.ts
const SHAPE_MAP: Record<string, string> = {
  rect: 'rect', roundRect: 'roundRect',
  snip1Rect: 'roundRect', snip2SameRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle', rtTriangle: 'triangle',
  diamond: 'diamond', parallelogram: 'parallelogram',
  pentagon: 'pentagon', hexagon: 'hexagon',
  rightArrow: 'arrow', leftArrow: 'arrow', upArrow: 'arrow', downArrow: 'arrow',
  chevron: 'arrow', homePlate: 'arrow',
  star4: 'star', star5: 'star', star6: 'star', star8: 'star',
}

const LINE_TYPES = new Set([
  'line', 'straightConnector1',
  'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5',
  'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'curvedConnector5',
])

export function isLineShapeType(shapType: string): boolean { return LINE_TYPES.has(shapType) }
export function mapShapeType(shapType: string) {
  const mapped = SHAPE_MAP[shapType]
  return mapped ? { type: mapped } : { type: 'custom', fallbackPath: undefined }
}
```

#### F.6 SSE 事件类型

```typescript
interface ImportProgressEvent {
  type: 'progress'
  stage: 'uploading' | 'parsing' | 'images' | 'converting' | 'saving'
  percent: number              // 0-100
  detail?: string              // 如 "图片 12/35"
}

interface ImportCompleteEvent {
  type: 'complete'
  presentationId: number
  slideCount: number
  warnings: string[]           // 如 ["2 张图片未能加载"]
}

interface ImportErrorEvent {
  type: 'error'
  message: string
  code?: string                // 'ENCRYPTED', 'CORRUPTED', 'TOO_LARGE', 'ZIP_BOMB'
}
```

**进度百分比分配**:

| 阶段 | 百分比 | stage |
|------|--------|-------|
| 上传文件到服务器 | 0-15% | uploading |
| 解析 PPTX 结构 | 15-25% | parsing |
| 处理图片资源 | 25-80% | images（最耗时） |
| 转换文档格式 | 80-95% | converting |
| 保存文档 | 95-100% | saving |

#### F.7 大文件导入方案（50MB+ PPTX）

**瓶颈分析（60MB PPTX 实例推演）**:

| 步骤 | 耗时估算 | 内存峰值 |
|------|---------|---------|
| 用户上传文件到服务器 | 5-15s | 60MB |
| pptxtojson 解析 ZIP+XML | 3-8s | ~180MB |
| base64 编码图片 | 含在上步 | ~240MB |
| JSON → DSL 字段映射 | <1s | ~50MB |
| 35 张图片上传 Storage | 15-60s | ~10MB/张 |
| DSL 保存到数据库 | <1s | ~5MB |
| **总计** | **25-85s** | **峰值 ~300MB** |

**架构决策：服务端解析（Server-side）**

**超时防护策略**:

| 场景 | 策略 |
|------|------|
| 文件上传超时 | 前端 XHR 带 progress 事件，超时 5 分钟 |
| SSE 连接断开 | 前端自动重连，服务端保存进度状态 |
| 服务端处理超时 | maxDuration: 300 |
| 图片上传部分失败 | 失败图片用占位符替代 |
| 浏览器标签页关闭 | 任务与 SSE 解耦，重新打开时检查 status='importing' |

#### F.8 ExportDialog 组件示例

```typescript
// components/file/ExportDialog.tsx
'use client'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@botool/ui'
import { usePresentationStore } from '@/stores/presentation-store'
import { exportToPdf, exportToPptbt } from '@botool/ppt-core'

type ExportFormat = 'pdf' | 'pptbt' | 'png'

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { dsl, currentSlideIndex } = usePresentationStore()
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [range, setRange] = useState<'all' | 'current'>('all')
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' })

  const handleExport = async () => {
    if (!dsl) return
    setExporting(true)
    try {
      let blob: Blob, fileName: string
      const exportRange = range === 'current'
        ? [currentSlideIndex, currentSlideIndex] as [number, number] : 'all'
      switch (format) {
        case 'pdf':
          blob = await exportToPdf(dsl, { range: exportRange,
            onProgress: (c, t) => setProgress({ current: c, total: t, message: `导出 ${c}/${t} 页` }) })
          fileName = `${dsl.meta.title || '演示文稿'}.pdf`; break
        case 'pptbt':
          blob = await exportToPptbt(dsl, {
            onProgress: (msg, pct) => setProgress({ current: pct, total: 100, message: msg }) })
          fileName = `${dsl.meta.title || '演示文稿'}.pptbt`; break
        default: throw new Error('不支持的导出格式')
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = fileName; a.click()
      URL.revokeObjectURL(url)
      toast.success('导出成功'); onOpenChange(false)
    } catch { toast.error('导出失败，请重试') }
    finally { setExporting(false) }
  }
  // ... Dialog UI
}
```

### G. 测试策略

#### 单元测试

- PPTX 元素类型映射（6 种类型 × 基本场景）
- HTML 清洗器（XSS 用例、格式保真）
- 形状映射表（已覆盖/未覆盖/线条类型）
- 背景映射（color/image/gradient/pattern/null）

#### 集成测试

- PPTX 完整导入流程（文件 → DSL → 数据库）
- 翻译 API 端到端（发起 → 进度查询 → 完成）
- 表名迁移后 CRUD 正常

#### E2E 测试

- 编辑器打开 → 编辑 → 保存完整流程
- PPTX 导入 → SSE 进度 → 编辑器预览
- AI 翻译 → 进度 → 新文档创建

### H. PPTX 导入验证矩阵

| # | 测试文件 | 验证重点 |
|---|---------|---------|
| 1 | 纯文本 PPT（多种字号/颜色） | 文本 HTML 保真度、混合格式 |
| 2 | 图片为主的 PPT（含裁剪） | 图片提取+上传+裁剪还原 |
| 3 | 多种形状 PPT（含自定义形状） | 形状映射、path 兜底、填充/描边 |
| 4 | 含表格的 PPT（含合并单元格） | 表格结构、单元格样式 |
| 5 | 含组合的 PPT（含嵌套组合） | 组递归、子元素坐标 |
| 6 | 深色主题 PPT | 主题色展平、背景色 |
| 7 | 含渐变背景/形状的 PPT | 渐变填充还原 |
| 8 | 含母版 logo/装饰的 PPT | layoutElements 合并 |
| 9 | 真实商务 PPT（综合） | 全面覆盖度 |
| 10 | 竖排文字 PPT | writingMode: vertical |
