# PRD: Botool_Present v1.6

> **生成方式**: Transform Mode (PRD 导入)
> **源文件**: `v1.6_Botool_Present_v2PRD copy.md` (8120 行, v4.1, 2026-02-21)
> **生成日期**: 2026-02-23

---

## 1. 项目概述

### 1.1 背景与动机

Botool_Present 是一个基于 Web 的 PPT 演示文稿管理与协作平台。现有版本功能简单，仅支持基础的演示文稿创建和编辑，缺少企业级文档库管理、多版本控制、精细化权限体系和多语言 AI 翻译能力。

v1.6 是一次全面升级，引入文档库分类管理体系、版本管理（主/次版本 + 选择性发布）、协作权限（read/write/admin）、多语言 AI 翻译（通义千问 qwen-max）、以及完整的导入/导出功能（PDF/PNG/.pptbt/PPTX）。

同时，v1.6 将编辑器拆分为独立的 Botool_PPT 应用（port 3009），Botool_Present（port 3005）专注于文档库管理。

### 1.2 核心目标

1. **文档库管理体系**: 建立两级分类（大类/子类）+ 槽位分配机制，让文档可被组织化管理
2. **版本控制**: 支持主版本（major）和次版本（minor）管理，支持选择性发布各语言版本
3. **协作权限**: 精细化 read/write/admin 三级权限，支持访问请求工作流（含 24h 冷却期）
4. **多语言 AI 翻译**: 集成通义千问 qwen-max，支持专有词汇库，SSE 实时进度推送
5. **导入/导出**: PDF（html2canvas + jspdf）、PNG、.pptbt（JSZip 格式）、PPTX 导入（pptxtojson）
6. **应用拆分**: 将编辑器迁移到 Botool_PPT (port 3009)，解耦管理与编辑职责

### 1.3 成功指标

- 文档可通过分类树被检索，检索时间 < 500ms
- AI 翻译成功率 ≥ 95%（不含网络故障）
- PDF 导出还原率 ≥ 90%（相对于浏览器渲染效果）
- PPTX 导入元素映射覆盖率 ≥ 85%（文本/图片/形状/表格）

---

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| PPT 编辑器 | ✅ 已实现 | Canvas 渲染 + DSL 存储，Ribbon 工具栏 4 个 Tab |
| 基础文档管理 | ⚠️ 部分实现 | 创建/编辑可用，无分类、无版本、无权限 |
| /library 页面 | ⚠️ 部分实现 | 列表展示可用，缺分类筛选和协作功能 |
| /admin 页面 | ⚠️ 部分实现 | 单页布局，缺 3-Tab 结构 |
| /upload 页面 | ❌ 待删除 | 独立上传页面，v1.6 改为统一入口 |
| 'editing' 状态 | ❌ 待删除 | status 枚举中的 editing 状态，逻辑已废弃 |
| 版本管理 | ❌ 未实现 | 无 present_version_groups/present_versions 表 |
| 分类管理 | ❌ 未实现 | 无 present_categories/present_category_slots 表 |
| 协作权限 | ❌ 未实现 | 无 present_collaborators/present_access_requests 表 |
| AI 翻译 | ❌ 未实现 | 无翻译任务队列，无术语库 |
| 导入/导出 | ❌ 未实现 | 无 PDF/PNG/.pptbt/PPTX 转换器 |

### 2.2 缺口分析

**核心缺口**（阻塞 P0 功能）:
- 数据库层完全缺失：12 张新表均未创建，无 RLS 策略
- /admin 页面结构需重构为 3-Tab
- 编辑器与管理应用混杂在同一 Next.js 项目中

**待实现缺口**（P1/P2 功能）:
- 版本管理的状态机和 UI 组件
- 分类树组件（CategoryManagementDialog）
- 翻译流水线（qwen-max API 集成 + SSE）
- 所有格式转换器（PDF/PNG/.pptbt/PPTX）

---

## 3. 架构设计

### 3.1 核心概念

```
┌─────────────────────────────────────────────────────────────┐
│  双应用架构                                                   │
│                                                             │
│  Botool_Present (port 3005)    Botool_PPT (port 3009)      │
│  ┌─────────────────────────┐   ┌──────────────────────────┐ │
│  │ 文档库管理               │   │ PPT 编辑器               │ │
│  │ - 分类浏览/搜索          │   │ - Canvas 渲染            │ │
│  │ - 版本管理               │   │ - DSL 编辑               │ │
│  │ - 协作权限               │←─→│ - Ribbon 工具栏          │ │
│  │ - AI 翻译管理            │   │ - 导入/导出转换器        │ │
│  │ - 导入/导出 UI           │   │                          │ │
│  └─────────────────────────┘   └──────────────────────────┘ │
│                 │                                            │
│                 ↓                                            │
│       Supabase PostgreSQL + Storage                          │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 用户角色

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  访客 (Guest)    │   │  协作者           │   │  管理员 (Admin)  │
│                  │   │  (Collaborator)   │   │                  │
│  - 查看已发布    │   │                  │   │  - 全部权限      │
│  - 申请访问      │   │  read: 只读      │   │  - 管理分类      │
│                  │   │  write: 可编辑   │   │  - 审批请求      │
│  入口: /library  │   │  admin: 可共享   │   │  - 发布版本      │
│                  │   │                  │   │  - 启动翻译      │
│                  │   │  入口: /library  │   │  入口: /admin    │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

### 3.3 核心工作流

```
───────── 文档库工作流 ─────────

[管理员创建草稿] → [编辑内容] → [创建版本组] → [翻译语言版本]
       │                              │
       ↓                              ↓
[分配分类槽位] → [文档库可见] ← [选择性发布各语言版本]

───────── 访问控制工作流 ─────────

[访客申请访问] → [管理员审批/拒绝]
                    │           │
                    ↓           ↓
              [添加协作者]   [24h 冷却]
                    │
                    ↓
             [协作者可读写]

───────── AI 翻译工作流 ─────────

[管理员选择翻译] → [确认术语库] → [创建翻译任务]
                                       │
                    ┌──────────────────┘
                    ↓
             [SSE 推送进度] → [completed/failed]
                                    │
                               [创建新语言版本]
```

### 3.4 版本状态机

```
───────── 版本组状态 ─────────

  [创建版本组]
       │
       ▼
  version_groups.is_published = false
  versions[lang].status = 'draft'
       │
       ├── [选择某语言版本发布] ──▶ versions[lang].status = 'published'
       │                              (已发布 = 只读)
       │
       └── [撤销发布] ──▶ versions[lang].status = 'draft'
                          (可再次编辑)

───────── 翻译任务状态机 ─────────

  pending ──▶ processing ──▶ completed
                    │
                    └──▶ failed ──▶ [重试] ──▶ pending
```

---

## 4. 数据设计

### 4.1 数据模型概览

| 模型 | 用途 | 状态 |
|------|------|------|
| present_presentations | 主文档（含DSL内容） | 新建 |
| present_dsl_snapshots | DSL 历史快照 | 新建 |
| present_collaborators | 协作者权限记录 | 新建 |
| present_access_requests | 访问申请 + 冷却期 | 新建 |
| present_visibility_groups | 可见分组（部门/角色） | 新建 |
| present_version_groups | 版本组（major/minor） | 新建 |
| present_versions | 按语言的版本实例 | 新建 |
| present_categories | 分类定义（2层树） | 新建 |
| present_category_slots | 分类槽位（复制体） | 新建 |
| present_translations | AI 翻译任务队列 | 新建 |
| present_glossary | 专有词汇库 | 新建 |
| present_glossary_translations | 词汇翻译映射 | 新建 |

### 4.2 Schema 定义

```sql
-- ═══════════════════════════════════════════════════════
-- Script 1: 核心文档表
-- ═══════════════════════════════════════════════════════

-- present_presentations: 主文档表
CREATE TABLE present_presentations (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title               TEXT        NOT NULL,
  slug                TEXT        UNIQUE,
  type                TEXT        NOT NULL DEFAULT 'ppt',
  status              TEXT        NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'published', 'archived')),
  dsl_json            JSONB,                               -- 小文档内联存储
  dsl_storage_path    TEXT,                                -- 大文档 Supabase Storage 路径
  owner_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_deleted          BOOLEAN     NOT NULL DEFAULT FALSE,  -- 软删除
  language_code       TEXT        NOT NULL DEFAULT 'zh',   -- 文档语言
  translated_from_id  UUID        REFERENCES present_presentations(id), -- 翻译来源
  thumbnail_url       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_presentations_owner    ON present_presentations(owner_id);
CREATE INDEX idx_presentations_status   ON present_presentations(status);
CREATE INDEX idx_presentations_language ON present_presentations(language_code);
CREATE INDEX idx_presentations_deleted  ON present_presentations(is_deleted);

-- ═══════════════════════════════════════════════════════
-- Script 2: DSL 快照表
-- ═══════════════════════════════════════════════════════

-- present_dsl_snapshots: DSL 历史版本快照
CREATE TABLE present_dsl_snapshots (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  presentation_id   UUID        NOT NULL REFERENCES present_presentations(id) ON DELETE CASCADE,
  dsl_json          JSONB       NOT NULL,
  snapshot_label    TEXT,                                  -- 可选快照标签
  created_by        UUID        REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dsl_snapshots_presentation ON present_dsl_snapshots(presentation_id);

-- ═══════════════════════════════════════════════════════
-- Script 3: 协作与访问控制表
-- ═══════════════════════════════════════════════════════

-- present_collaborators: 协作者权限表
CREATE TABLE present_collaborators (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  presentation_id   UUID        NOT NULL REFERENCES present_presentations(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission        TEXT        NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  granted_by        UUID        REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (presentation_id, user_id)
);

CREATE INDEX idx_collaborators_user ON present_collaborators(user_id);
CREATE INDEX idx_collaborators_presentation ON present_collaborators(presentation_id);

-- present_access_requests: 访问申请表（含冷却期）
CREATE TABLE present_access_requests (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  presentation_id   UUID        NOT NULL REFERENCES present_presentations(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'approved', 'rejected')),
  message           TEXT,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at      TIMESTAMPTZ,
  responded_by      UUID        REFERENCES auth.users(id),
  cooldown_until    TIMESTAMPTZ                             -- 拒绝后 24h 冷却截止时间
);

CREATE INDEX idx_access_requests_presentation ON present_access_requests(presentation_id);
CREATE INDEX idx_access_requests_user ON present_access_requests(user_id, status);

-- ═══════════════════════════════════════════════════════
-- Script 4: 可见性分组表
-- ═══════════════════════════════════════════════════════

-- present_visibility_groups: 可见性分组（部门/角色/组织）
CREATE TABLE present_visibility_groups (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  presentation_id   UUID        NOT NULL REFERENCES present_presentations(id) ON DELETE CASCADE,
  group_type        TEXT        NOT NULL CHECK (group_type IN ('dept', 'role', 'org')),
  group_value       TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_visibility_groups_presentation ON present_visibility_groups(presentation_id);

-- ═══════════════════════════════════════════════════════
-- Script 5: 版本管理表
-- ═══════════════════════════════════════════════════════

-- present_version_groups: 版本组（一个 version_group 对应一次版本）
CREATE TABLE present_version_groups (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  presentation_id   UUID        NOT NULL REFERENCES present_presentations(id) ON DELETE CASCADE,
  version_number    TEXT        NOT NULL,                   -- "1.0", "1.1", "2.0"
  version_type      TEXT        NOT NULL CHECK (version_type IN ('major', 'minor')),
  sort_key          DECIMAL     NOT NULL,                   -- 排序键（版本号的数值形式）
  is_published      BOOLEAN     NOT NULL DEFAULT FALSE,
  label             TEXT,                                   -- 可选版本说明
  created_by        UUID        REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_version_groups_presentation ON present_version_groups(presentation_id);
CREATE INDEX idx_version_groups_sort ON present_version_groups(presentation_id, sort_key);

-- present_versions: 按语言的版本实例
CREATE TABLE present_versions (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  version_group_id        UUID        NOT NULL REFERENCES present_version_groups(id) ON DELETE CASCADE,
  presentation_id         UUID        NOT NULL REFERENCES present_presentations(id) ON DELETE CASCADE,
  language_code           TEXT        NOT NULL,             -- 'zh', 'en', 'ja', etc.
  status                  TEXT        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft', 'published')),
  source_version_id       UUID        REFERENCES present_versions(id), -- 翻译来源版本
  source_presentation_id  UUID        REFERENCES present_presentations(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (version_group_id, language_code)
);

CREATE INDEX idx_versions_group ON present_versions(version_group_id);
CREATE INDEX idx_versions_presentation ON present_versions(presentation_id);
CREATE INDEX idx_versions_status ON present_versions(status);

-- ═══════════════════════════════════════════════════════
-- Script 6: 分类管理表
-- ═══════════════════════════════════════════════════════

-- present_categories: 分类定义（两级树，parent_id=NULL 为根分类）
CREATE TABLE present_categories (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id   UUID        REFERENCES present_categories(id) ON DELETE CASCADE, -- 自引用，NULL=大类
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  icon        TEXT,
  color       TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_categories_parent ON present_categories(parent_id);

-- present_category_slots: 分类槽位（复制体，非引用）
-- 挂载时创建 presentation 的副本，写入此表
CREATE TABLE present_category_slots (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id       UUID        NOT NULL REFERENCES present_categories(id) ON DELETE CASCADE,
  presentation_id   UUID        NOT NULL REFERENCES present_presentations(id) ON DELETE CASCADE,
  version_group_id  UUID        REFERENCES present_version_groups(id),
  assigned_by       UUID        REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, presentation_id)
);

CREATE INDEX idx_category_slots_category ON present_category_slots(category_id);
CREATE INDEX idx_category_slots_presentation ON present_category_slots(presentation_id);

-- 触发函数：确保槽位和文档状态一致性
CREATE OR REPLACE FUNCTION sync_category_slot_status()
RETURNS TRIGGER AS $$
BEGIN
  -- 当文档被软删除时，同步删除其槽位记录
  IF NEW.is_deleted = TRUE AND OLD.is_deleted = FALSE THEN
    DELETE FROM present_category_slots
    WHERE presentation_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_category_slot
AFTER UPDATE OF is_deleted ON present_presentations
FOR EACH ROW EXECUTE FUNCTION sync_category_slot_status();

-- ═══════════════════════════════════════════════════════
-- Script 7: 翻译与术语库表
-- ═══════════════════════════════════════════════════════

-- present_translations: AI 翻译任务队列
CREATE TABLE present_translations (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type             TEXT        NOT NULL CHECK (source_type IN ('version', 'presentation')),
  -- source_type='version': Admin 后台翻译版本
  -- source_type='presentation': 编辑器内翻译当前文档
  source_version_id       UUID        REFERENCES present_versions(id),
  source_presentation_id  UUID        REFERENCES present_presentations(id),
  result_version_id       UUID        REFERENCES present_versions(id),
  result_presentation_id  UUID        REFERENCES present_presentations(id),
  target_language         TEXT        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress                DECIMAL     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message           TEXT,
  logs                    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_by              UUID        REFERENCES auth.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_translations_source_version ON present_translations(source_version_id);
CREATE INDEX idx_translations_status ON present_translations(status);

-- present_glossary: 专有词汇库（仅当源语言为 zh 时生效）
CREATE TABLE present_glossary (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  source_term   TEXT        NOT NULL,
  term_type     TEXT        NOT NULL CHECK (term_type IN ('no_translate', 'translate')),
  -- no_translate: 该词保持原样不翻译（如品牌名）
  -- translate: 该词使用指定翻译（替换 AI 默认翻译）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_term)
);

-- present_glossary_translations: 词汇翻译映射
CREATE TABLE present_glossary_translations (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  glossary_id     UUID        NOT NULL REFERENCES present_glossary(id) ON DELETE CASCADE,
  language_code   TEXT        NOT NULL,
  translated_term TEXT        NOT NULL,
  UNIQUE (glossary_id, language_code)
);

CREATE INDEX idx_glossary_translations_glossary ON present_glossary_translations(glossary_id);
```

### 4.3 模型关系（ER 图）

```
present_presentations ──1:N──▶ present_dsl_snapshots
present_presentations ──1:N──▶ present_collaborators
present_presentations ──1:N──▶ present_access_requests
present_presentations ──1:N──▶ present_visibility_groups
present_presentations ──1:N──▶ present_version_groups
                                       │
                                       └──1:N──▶ present_versions
                                                        │
                                                        └──1:N──▶ present_translations
present_presentations ──0:1──▶ present_category_slots
                                       │
                                       └──N:1──▶ present_categories (self-ref)

present_glossary ──1:N──▶ present_glossary_translations
```

### 4.4 RLS 策略

```sql
-- 启用 RLS
ALTER TABLE present_presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE present_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE present_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE present_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE present_category_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE present_translations ENABLE ROW LEVEL SECURITY;

-- 文档访问策略：已发布文档所有人可读；协作者按权限读写
CREATE POLICY "presentations_select" ON present_presentations
  FOR SELECT USING (
    status = 'published'
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM present_collaborators
      WHERE presentation_id = id AND user_id = auth.uid()
    )
  );

CREATE POLICY "presentations_insert" ON present_presentations
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "presentations_update" ON present_presentations
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM present_collaborators
      WHERE presentation_id = id AND user_id = auth.uid()
      AND permission IN ('write', 'admin')
    )
  );
```

---

## 5. UI 设计

### 5.1 页面清单

| 页面 | 路由 | 说明 | 状态 |
|------|------|------|------|
| 文档库 | `/library` | 公共文档浏览，分类筛选 | 已有（需改造） |
| 管理后台 | `/admin` | 3-Tab 布局管理页 | 已有（需重构） |
| 编辑器 | 跳转至 Botool_PPT | port 3009 独立应用 | 迁移 |

**删除页面**: `/upload`（功能合并到管理后台）

### 5.2 组件清单

| 组件 | 说明 | 状态 |
|------|------|------|
| `<ShareDialog>` | 共享文档 + 管理协作者 + 审批访问请求 | 新建 |
| `<CategoryManagementDialog>` | 两级分类树 + 槽位分配 | 新建 |
| `<CreateVersionDialog>` | 创建主/次版本（含规则校验） | 新建 |
| `<AccessRequestView>` | 访问请求列表 + 一键审批/拒绝 | 新建 |
| `<TranslateConfirmDialog>` | 翻译语言选择 + 术语库预览 | 新建 |
| `<TranslateProgressDialog>` | SSE 实时翻译进度 | 新建 |
| `<GlossaryPanel>` | 术语库管理面板（仅 zh 源语言激活） | 新建 |
| `<DownloadDialog>` | 格式选择 + 导出设置 | 新建 |
| `<FileNameBuilder>` | 文件名生成工具函数 | 新建 |
| `<VersionListPanel>` | 版本组列表 + 各语言版本状态 | 新建 |
| `<AdminLayout>` | 管理后台 3-Tab 布局 | 重构 |

### 5.3 关键页面布局

```
───────── /admin 页面 (3-Tab 布局) ─────────

┌─────────────────────────────────────────────────┐
│  Botool_Present 管理后台                         │
│  ──────────────────────────────────────────────  │
│  [我的 PPT] [PPT 库管理] [设置]                  │
│  ═══════════════════════════════                 │
│  ┌───────────────────────────────────────────┐  │
│  │ [搜索...] [分类▼] [状态▼] [+新建文档]     │  │
│  │                                           │  │
│  │  标题             状态    操作             │  │
│  │  ─────────────────────────────────────    │  │
│  │  公司介绍 2024    ● 已发布  [Share][分类][版本]│  │
│  │  产品路线图 Q1    ○ 草稿   [Share][分类][版本]│  │
│  │  技术架构图       ● 已发布  [Share][分类][版本]│  │
│  │                                           │  │
│  │  [分类管理]  [访问请求 (3)]               │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘

───────── /library 页面 ─────────

┌─────────────────────────────────────────────────┐
│  PPT 文档库          [登录]                      │
│  ──────────────────────────────────────────────  │
│  ┌──────────┬────────────────────────────────┐  │
│  │ 分类树   │ 文档网格/列表                  │  │
│  │          │                               │  │
│  │ 全部     │ [缩略图] 标题           状态   │  │
│  │ ▶ 大类A  │ [缩略图] 公司介绍 2024  ● 已发布│  │
│  │   子类A1 │ [缩略图] 产品路线图     ● 已发布│  │
│  │   子类A2 │                               │  │
│  │ ▶ 大类B  │ [申请访问]（未登录时显示）     │  │
│  │   子类B1 │                               │  │
│  └──────────┴────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 5.4 关键弹窗布局

```
───────── ShareDialog ─────────

┌─────────────────────────────────┐
│  共享文档                  [x]  │
│  ─────────────────────────────  │
│  添加协作者:                    │
│  [邮箱搜索...]  [查看▼]  [添加] │
│                                 │
│  已共享 (2):                   │
│  alice@..  write   [权限▼][移除]│
│  bob@..    read    [权限▼][移除]│
│                                 │
│  访问请求 (1):                  │
│  carol@..  2分钟前  [批准][拒绝]│
│                                 │
│                        [完成]   │
└─────────────────────────────────┘

───────── CategoryManagementDialog ─────────

┌─────────────────────────────────┐
│  分类管理                  [x]  │
│  ─────────────────────────────  │
│  文档: 公司介绍 2024            │
│  ─────────────────────────────  │
│  选择槽位:                      │
│  ▼ 大类 A                      │
│    ○ 子类 A1  (已有 3 个文档)  │
│    ○ 子类 A2  (已有 1 个文档)  │
│  ▼ 大类 B                      │
│    ● 子类 B1  (当前槽位)       │
│                                 │
│  [重新分配]   [移出槽位]        │
│              [取消]  [确认]     │
└─────────────────────────────────┘

───────── CreateVersionDialog ─────────

┌─────────────────────────────────┐
│  创建新版本                [x]  │
│  ─────────────────────────────  │
│  版本类型:                      │
│  ○ 主版本 (3.0)  重大更新      │
│  ● 次版本 (2.1)  小幅修订      │
│                                 │
│  版本说明 (可选):               │
│  [Q1 路线图更新...]             │
│                                 │
│  ⚠ 创建后将从当前版本复制内容   │
│                                 │
│              [取消]  [创建]     │
└─────────────────────────────────┘

───────── TranslateProgressDialog ─────────

┌─────────────────────────────────┐
│  正在翻译...               [x]  │
│  ─────────────────────────────  │
│  源: 中文  →  目标: 英文        │
│                                 │
│  [████████████░░░░] 68%        │
│                                 │
│  正在处理第 17/25 张幻灯片      │
│  估计剩余: 约 30 秒             │
│                                 │
│  ✅ 已处理:                     │
│  - 第1-16张: 文本元素翻译完成   │
│                                 │
│              [后台运行] [取消]  │
└─────────────────────────────────┘
```

---

## 6. 业务规则

### 6.1 文档库与分类规则

| ID | 规则 | 影响任务 |
|----|------|---------|
| BR-001 | **槽位分配 = 复制体**: 挂载时创建文档副本（新 present_presentations 记录），不引用原文档 | DT-035 |
| BR-002 | **草稿箱定义**: 无对应 present_category_slots 记录的文档属于草稿箱，不在公共库中显示 | DT-020, DT-036 |
| BR-003 | **软删除**: 文档 is_deleted=TRUE 时，触发函数自动删除其所有 category_slots 记录 | DT-015 |
| BR-004 | **分类两级**: categories 表仅支持 parent_id=NULL（大类）和 parent_id IS NOT NULL（子类）两级，不支持更深层级 | DT-034, DT-037 |

### 6.2 版本管理规则

| ID | 规则 | 影响任务 |
|----|------|---------|
| BR-005 | **主版本号**: 新主版本 = max(existing major) + 1.0（如现有最高 2.0，新建 3.0） | DT-023 |
| BR-006 | **次版本号**: 新次版本 = 当前主版本下 max(minor) + 0.1（如 2.0 下有 2.1，新建 2.2） | DT-023 |
| BR-007 | **已发布只读**: status='published' 的版本不可编辑，必须先撤销（→ draft）才能修改 | DT-024 |
| BR-008 | **选择性发布**: 每个语言版本（present_versions）独立发布/撤销，不影响其他语言版本 | DT-024 |
| BR-009 | **版本复制**: 创建新版本时，从最新已发布版本（或最新草稿）复制 DSL 内容 | DT-023 |

### 6.3 翻译规则

| ID | 规则 | 影响任务 |
|----|------|---------|
| BR-010 | **source_type 区分**: Admin 后台触发翻译 → source_type='version'；编辑器内触发 → source_type='presentation' | DT-038 |
| BR-011 | **术语库激活条件**: 仅当翻译源语言为 'zh' 时，GlossaryPanel 可用，且翻译 prompt 中注入术语表 | DT-042, DT-043 |
| BR-012 | **no_translate 词汇**: term_type='no_translate' 的词汇在翻译 prompt 中指示 AI 保持原文不翻译 | DT-038, DT-039 |
| BR-013 | **翻译结果存储**: 翻译完成后创建新的 present_presentations 记录（language_code=target_lang，translated_from_id=source_id）| DT-039, DT-040 |
| BR-014 | **失败重试**: status='failed' 的翻译任务可重新提交，状态回到 pending | DT-040 |

### 6.4 协作与访问控制规则

| ID | 规则 | 影响任务 |
|----|------|---------|
| BR-015 | **访问申请冷却期**: 被拒绝的访问请求，24 小时内用户不可再次申请（cooldown_until = NOW() + 24h） | DT-019 |
| BR-016 | **协作者权限优先级**: admin > write > read，同一用户只保留最高权限记录 | DT-018 |
| BR-017 | **owner 永久访问**: 文档 owner_id 的用户始终有全部权限，不受 collaborators 表约束 | DT-015 |

### 6.5 文件安全规则

| ID | 规则 | 影响任务 |
|----|------|---------|
| BR-018 | **ZIP 炸弹防护**: PPTX 导入时校验：解压缩比 > 100x / 解压后 > 2GB / 文件数 > 10000 / 嵌套层数 > 10，任一触发拒绝 | DT-031 |
| BR-019 | **SSRF 防护**: 图片代理接口必须校验目标 URL 不指向内网地址（127.0.0.1、10.x、172.16.x、192.168.x、localhost 等） | DT-031 |
| BR-020 | **文件类型白名单**: PPTX 导入仅接受 .pptx 扩展名 + MIME application/vnd.openxmlformats-officedocument.presentationml.presentation | DT-031 |

### 6.6 决策树：翻译触发流程

```
管理员点击"翻译"按钮
├── 源语言是否为 zh?
│   ├── 是 → 展示 TranslateConfirmDialog（含术语库预览）
│   │         │
│   │         └── 用户确认 → 创建翻译任务 (source_type='version')
│   │                        → 展示 TranslateProgressDialog (SSE)
│   └── 否 → 展示 TranslateConfirmDialog（无术语库预览）
│             │
│             └── 用户确认 → 创建翻译任务 (source_type='version')
│                            → 展示 TranslateProgressDialog (SSE)
└── 翻译完成/失败?
    ├── completed → 关闭进度弹窗，刷新版本列表，显示新语言版本
    └── failed    → 显示错误信息 + [重试] 按钮
```

---

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶┐
 清理        DB建库       App拆分      文档库        │
 (P0)        (P0)         (P0)        (P0)          │
                                                    │
                                              ┌─────┘
                                              ├──▶ Phase 4 (P1) 版本管理
                                              ├──▶ Phase 5 (P1) 导入导出
                                              ├──▶ Phase 6 (P1) 分类管理
                                              │
                                              └──▶ Phase 7 (P2) AI翻译
                                                         │
                                                         └──▶ Phase 8 (P2) 下载UI

依赖关系:
Phase 0 → 必须先清理旧代码，避免后续冲突
Phase 1 → 所有后续 Phase 的基础（数据库必须先建好）
Phase 2 → Phase 3 的前置（编辑器独立后才能做文档库联动）
Phase 3 → Phase 4/5/6 可并行
Phase 4+5 → Phase 7 的前置（翻译需要版本系统）
Phase 7 → Phase 8（下载 UI 依赖导出格式已实现）
```

### 7.1 Phase 0: 代码清理 (P0)

> **前置**: 无
> **产出**: 删除废弃页面/状态，/admin 重构为 3-Tab 布局
> **对应设计**: Section 5.1, 5.3

- [ ] **DT-001**: 删除 `/upload` 页面及其相关路由 (`文件: app/upload/page.tsx`)
  - 验收: 访问 /upload 返回 404；侧边栏不再出现"上传文档"入口
  - [ ] 从 status CHECK 约束中移除 'editing' 状态值
  - [ ] Typecheck passes

- [ ] **DT-002**: 重构 `/admin` 为 3-Tab 布局 (`文件: app/admin/page.tsx`, `组件: <AdminLayout>`)
  - Tab 1: 我的 PPT（当前用户所有草稿）
  - Tab 2: PPT 库管理（文档列表 + 筛选 + 操作按钮）
  - Tab 3: 设置（预留空 Tab）
  - 验收: 3 Tab 可切换，Tab 2 展示文档列表；Verify in browser
  - [ ] [安全] 错误响应不泄露内部信息
  - [ ] Typecheck passes

### 7.2 Phase 1: 数据库初始化 (P0)

> **前置**: Phase 0
> **产出**: 12 张表 + RLS 策略 + 索引全部就绪
> **对应设计**: Section 4.2

- [ ] **DT-003**: SQL Script 1 — 创建 present_presentations 表 (`文件: sql/01_presentations.sql`)
  - 含 title/slug/type/status/dsl_json/dsl_storage_path/owner_id/is_deleted/language_code/translated_from_id 字段
  - 含所有索引（owner, status, language, deleted）
  - [ ] [安全] 使用参数化查询
  - [ ] [安全] 迁移脚本使用 IF NOT EXISTS
  - [ ] 执行后确认表存在，索引已建

- [ ] **DT-004**: SQL Script 2 — 创建 present_dsl_snapshots 表 (`文件: sql/02_dsl_snapshots.sql`)
  - 验收: 表存在，外键约束正确

- [ ] **DT-005**: SQL Script 3 — 创建 present_collaborators 和 present_access_requests 表 (`文件: sql/03_collaboration.sql`)
  - collaborators UNIQUE(presentation_id, user_id)
  - access_requests 含 cooldown_until 字段
  - 验收: 两表存在，约束正确

- [ ] **DT-006**: SQL Script 4 — 创建 present_visibility_groups 表 (`文件: sql/04_visibility.sql`)

- [ ] **DT-007**: SQL Script 5 — 创建 present_version_groups 和 present_versions 表 (`文件: sql/05_versions.sql`)
  - version_groups: version_number/version_type/sort_key/is_published
  - versions: UNIQUE(version_group_id, language_code)
  - 验收: 两表存在，外键和唯一约束正确

- [ ] **DT-008**: SQL Script 6 — 创建 present_categories 和 present_category_slots 表 + 触发函数 (`文件: sql/06_categories.sql`)
  - categories: parent_id 自引用外键（2级树）
  - category_slots: UNIQUE(category_id, presentation_id)
  - 触发函数: sync_category_slot_status（软删除级联清理槽位）
  - [ ] [安全] 迁移脚本使用 IF NOT EXISTS
  - 验收: 两表存在，触发函数已创建，测试软删除级联

- [ ] **DT-009**: SQL Script 7 — 创建翻译和术语库表 (`文件: sql/07_translations.sql`)
  - present_translations: source_type/status/progress/logs JSONB
  - present_glossary + present_glossary_translations
  - 验收: 三表存在，CHECK 约束正确

- [ ] **DT-010**: RLS 策略和索引脚本 (`文件: sql/08_rls_policies.sql`)
  - 为 6 张核心表启用 RLS
  - 实现 presentations_select/insert/update 策略
  - [ ] [安全] 添加权限检查
  - 验收: RLS 已启用；未认证用户只能读已发布文档；owner 可全量访问

### 7.3 Phase 2: 应用拆分 — Botool_PPT (P0)

> **前置**: Phase 1
> **产出**: 编辑器迁移到独立 Next.js 应用 (port 3009)
> **对应设计**: Section 3.1

- [ ] **DT-011**: 创建 Botool_PPT Next.js 应用结构 (`文件: botool-ppt/package.json`, `botool-ppt/next.config.ts`)
  - port: 3009
  - 复用 Supabase 配置
  - 验收: `npm run dev` 在 3009 端口启动；Verify in browser

- [ ] **DT-012**: 迁移编辑器核心组件到 Botool_PPT (`目录: botool-ppt/components/editor/`)
  - 迁移 44+ 编辑器组件（Canvas、SlideList、Ribbon、元素工具等）
  - 迁移 DSL 类型定义
  - 验收: Botool_PPT 可独立运行编辑器；Typecheck passes

- [ ] **DT-013**: 配置跨应用导航 (`文件: botool-ppt/app/editor/[id]/page.tsx`)
  - Botool_Present 中"编辑"按钮跳转到 `http://localhost:3009/editor/[id]`
  - 编辑完成后跳转回 Botool_Present
  - 验收: 跨应用导航正常，文档数据共用 Supabase

- [ ] **DT-014**: 更新 Botool_Present 路由，删除原编辑器入口 (`文件: app/editor/page.tsx`)
  - Botool_Present 中不再承载编辑器代码
  - 验收: Botool_Present typecheck 无编辑器相关错误

### 7.4 Phase 3: 文档库管理 (P0)

> **前置**: Phase 2
> **产出**: 完整的文档库 CRUD + 协作权限 + 访问请求
> **对应设计**: Section 5.3, 5.4, 6.4

- [ ] **DT-015**: 文档 CRUD API (`API: GET/POST/DELETE /api/presentations`, `文件: app/api/presentations/route.ts`)
  - GET: 分页+筛选（status/owner/category）
  - POST: 创建新文档（owner=当前用户）
  - DELETE: 软删除（is_deleted=TRUE）
  - [ ] [安全] 使用参数化查询防止 SQL 注入
  - [ ] [安全] 错误响应不泄露内部信息
  - [ ] [安全] 添加权限检查（仅 owner 可删除）
  - [ ] Typecheck passes

- [ ] **DT-016**: 文档库公共浏览页 (`页面: /library`, `文件: app/library/page.tsx`)
  - 展示所有已发布文档（无 category_slot = 草稿箱，不显示）
  - 分类树侧边栏筛选
  - 未登录用户可申请访问
  - [ ] [安全] 输入使用 schema 验证（如 zod）
  - 验收: 已发布文档可见；草稿箱文档不可见；Verify in browser

- [ ] **DT-017**: 管理后台文档列表 Tab (`组件: <AdminLibraryTab>`, `文件: components/AdminLibraryTab.tsx`)
  - 搜索框 + 分类/状态筛选
  - 每行操作按钮：Share、分类、版本
  - 展示草稿箱和已发布文档
  - 验收: 筛选功能正常；Verify in browser

- [ ] **DT-018**: ShareDialog 组件 + 协作者 API (`组件: <ShareDialog>`, `API: /api/presentations/[id]/collaborators`)
  - GET/POST/PATCH/DELETE collaborators
  - 弹窗：添加协作者（邮箱搜索）+ 权限选择 + 访问请求审批
  - [ ] [安全] 添加权限检查（仅 admin 权限可管理协作者）
  - [ ] [安全] 输入使用 schema 验证（如 zod）
  - 验收: 可添加/修改/删除协作者；权限变更立即生效；Verify in browser

- [ ] **DT-019**: 访问申请 API + AccessRequestView (`API: /api/presentations/[id]/access-requests`, `组件: <AccessRequestView>`)
  - GET: 获取待审批列表
  - POST: 用户申请访问（含冷却期校验 BR-015）
  - PATCH: 批准/拒绝（拒绝时设置 cooldown_until = NOW() + 24h）
  - [ ] [安全] 添加权限检查
  - [ ] [安全] 输入使用 schema 验证（如 zod）
  - 验收: 申请工作流完整；拒绝后 24h 内不可再申请；Verify in browser

- [ ] **DT-020**: 草稿箱集成 (`文件: app/admin/page.tsx` — 我的PPT Tab)
  - 展示当前用户无 category_slot 的文档（= 草稿箱）
  - 提供"移入分类"入口（触发 CategoryManagementDialog）
  - 验收: 草稿箱文档正确展示；Verify in browser

### 7.5 Phase 4: 版本管理 (P1)

> **前置**: Phase 3
> **产出**: 版本组管理 + 选择性发布
> **对应设计**: Section 3.4, 6.2

- [ ] **DT-021**: 版本组 API (`API: GET/POST /api/presentations/[id]/version-groups`, `文件: app/api/presentations/[id]/version-groups/route.ts`)
  - GET: 获取文档所有版本组（含各语言版本状态）
  - POST: 创建新版本组（含 BR-005/BR-006 版本号规则校验）
  - [ ] [安全] 添加权限检查（仅 admin 可创建版本）
  - [ ] [安全] 输入使用 schema 验证（如 zod）
  - [ ] Typecheck passes

- [ ] **DT-022**: 版本列表面板 (`组件: <VersionListPanel>`, `文件: components/VersionListPanel.tsx`)
  - 展示版本组树状结构（major/minor）
  - 每个语言版本展示状态（draft/published）+ 操作按钮
  - 验收: 版本列表正确展示层级关系；Verify in browser

- [ ] **DT-023**: CreateVersionDialog (`组件: <CreateVersionDialog>`, `文件: components/CreateVersionDialog.tsx`)
  - 主版本/次版本选择（显示将生成的版本号）
  - 校验 BR-005/BR-006 版本号规则
  - 创建后从最新版本复制 DSL（BR-009）
  - [ ] [安全] 输入使用 schema 验证（如 zod）
  - 验收: 版本号自动计算正确；Verify in browser

- [ ] **DT-024**: 发布/撤销版本 API + UI (`API: POST/DELETE /api/versions/[id]/publish`)
  - 发布：versions.status → 'published'（仅影响当前语言版本）
  - 撤销：versions.status → 'draft'
  - 已发布版本 UI 显示只读状态徽章
  - [ ] [安全] 添加权限检查（仅 admin 可发布/撤销）
  - 验收: 选择性发布正常；发布后版本只读；Verify in browser

- [ ] **DT-025**: 版本回滚 (`API: POST /api/versions/[id]/rollback`)
  - 将指定旧版本的 DSL 复制到当前草稿版本
  - 操作前弹窗确认（不可逆警告）
  - [ ] [安全] 添加权限检查
  - 验收: 回滚后内容与目标版本一致；Verify in browser

### 7.6 Phase 5: 导入/导出 (P1)

> **前置**: Phase 3
> **产出**: PDF/PNG/.pptbt 导出 + .pptbt/PPTX 导入
> **对应设计**: Section 6.5, §8.E

- [ ] **DT-026**: PDF 导出实现 (`文件: lib/converter/dsl-to-pdf.ts`)
  - 依赖: `pnpm add html2canvas jspdf`
  - 逐张幻灯片创建临时 DOM → html2canvas 截图 → jsPDF 合并
  - 支持 range 参数（all/current/[start,end]）
  - 支持 scale 参数（默认 2x）
  - onProgress 回调报告进度
  - [ ] [安全] 文件大小限制
  - 验收: PDF 多页正确；还原率 ≥ 90%；Typecheck passes

- [ ] **DT-027**: PNG 导出实现 (`文件: lib/converter/dsl-to-png.ts`)
  - 单张幻灯片 html2canvas → canvas.toBlob('image/png')
  - 验收: PNG 导出正确；Typecheck passes

- [ ] **DT-028**: .pptbt 导出实现 (`文件: lib/converter/dsl-to-pptbt.ts`)
  - 依赖: `pnpm add jszip`
  - ZIP 包含: manifest.json + content.json（图片路径替换为相对路径）+ media/ 目录
  - 提取所有图片 URL → 下载 → 添加到 ZIP → 替换路径
  - manifest 格式: version/"1.0"/generator/"Botool Present"/generatorVersion/"1.6.0"
  - [ ] [安全] 文件大小限制
  - 验收: .pptbt 文件结构正确；重新导入后内容一致；Typecheck passes

- [ ] **DT-029**: .pptbt 导入实现 (`文件: lib/converter/pptbt-to-dsl.ts`)
  - JSZip 解压 → 验证 manifest 版本 → 读取 content.json → 上传 media/ 图片到 Supabase Storage → 替换图片路径
  - 验收: 导入后 DSL 内容与原始一致；图片可显示；Typecheck passes

- [ ] **DT-030**: PPTX 导入实现 — 5 文件转换器结构 (`目录: lib/converter/`)
  - `pptx-to-dsl.ts` — 主转换入口
  - `pptx-html-cleaner.ts` — HTML 清洗（pptxtojson HTML → Tiptap 兼容）
  - `pptx-shape-map.ts` — 形状类型映射（OOXML preset → DSL ShapeType）
  - `pptx-image-upload.ts` — 图片批量上传（base64 → Storage URL）
  - `pptx-fill-converter.ts` — 填充样式转换（color/gradient/image/pattern）
  - 依赖: `pnpm add pptxtojson`（版本 ≥ 1.9.0）
  - 元素类型映射: text/image/shape/table/line/group（video/audio/math → 占位符）
  - 验收: 常规 PPTX 文本/图片/形状元素正确转换；Typecheck passes

- [ ] **DT-031**: PPTX 导入安全验证 (`文件: lib/converter/pptx-to-dsl.ts`)
  - 文件类型白名单校验: .pptx 扩展名 + MIME 类型（BR-020）
  - ZIP 炸弹防护（BR-018）: 解压缩比 > 100x / > 2GB / > 10000 文件 / 嵌套 > 10 层 → 拒绝
  - 图片代理 SSRF 防护（BR-019）: 校验 URL 不指向内网
  - [ ] [安全] 文件类型白名单校验
  - [ ] [安全] 文件大小限制
  - [ ] [安全] 存储路径不可由用户控制
  - [ ] [安全] 输入使用 schema 验证（如 zod）
  - 验收: 恶意 PPTX 文件被拒绝；SSRF 攻击被阻止；Typecheck passes

- [ ] **DT-032**: 导入 UI — 文件拖放区 + 进度 (`组件: <ImportButton>`, `文件: components/ImportButton.tsx`)
  - 支持拖放和点击选择
  - 接受 .pptbt 和 .pptx 格式
  - 显示导入进度（解析/上传/处理）
  - 错误友好展示
  - [ ] [安全] 文件类型白名单校验
  - 验收: 两种格式导入均正常；错误有清晰提示；Verify in browser

### 7.7 Phase 6: 分类管理 (P1)

> **前置**: Phase 3
> **产出**: 两级分类树管理 + 槽位分配
> **对应设计**: Section 5.4, 6.1

- [ ] **DT-033**: 分类 CRUD API (`API: GET/POST/PUT/DELETE /api/categories`, `文件: app/api/categories/route.ts`)
  - 支持 parent_id 参数（NULL=大类，有值=子类）
  - 删除大类时级联删除子类（数据库外键）
  - [ ] [安全] 添加权限检查（仅 admin 可管理分类）
  - [ ] [安全] 使用参数化查询防止 SQL 注入
  - [ ] Typecheck passes

- [ ] **DT-034**: CategoryManagementDialog — 2 级分类树 UI (`组件: <CategoryManagementDialog>`, `文件: components/CategoryManagementDialog.tsx`)
  - 左侧分类树（大类 + 展开子类）
  - 右侧或内嵌"分配到此槽位"操作
  - 支持创建/编辑/删除分类（inline 编辑）
  - [ ] [安全] 输入使用 schema 验证（如 zod）
  - 验收: 分类树正确展示；创建/编辑/删除正常；Verify in browser

- [ ] **DT-035**: 槽位分配 API (`API: POST/DELETE /api/presentations/[id]/slots`, `文件: app/api/presentations/[id]/slots/route.ts`)
  - POST: 复制文档（创建新 present_presentations 记录），写入 present_category_slots
  - DELETE: 从槽位移除（删除 category_slot 记录，不删除副本）
  - 实现 BR-001（复制体语义）
  - [ ] [安全] 添加权限检查（仅 admin 可分配槽位）
  - [ ] [安全] 使用参数化查询防止 SQL 注入
  - 验收: 分配后槽位有独立文档副本；原文档不受影响；Typecheck passes

- [ ] **DT-036**: 分类筛选集成 (`文件: app/library/page.tsx`, `app/admin/page.tsx`)
  - /library 分类树侧边栏：按分类/子类过滤文档
  - /admin 分类下拉筛选：快速过滤当前分类的文档
  - 验收: 分类筛选正确过滤文档列表；Verify in browser

- [ ] **DT-037**: 管理员分类管理入口 (`文件: app/admin/page.tsx` — 设置 Tab 或库管理 Tab)
  - 独立的分类管理区域（大类列表 + 子类展开）
  - 支持拖拽排序（sort_order 字段）
  - 验收: 分类增删改正常；排序持久化；Verify in browser

### 7.8 Phase 7: 多语言 AI 翻译 (P2)

> **前置**: Phase 4 + Phase 5
> **产出**: 通义千问 AI 翻译 + 术语库 + SSE 进度
> **对应设计**: Section 3.3, 6.3

- [ ] **DT-038**: 翻译任务 API (`API: POST /api/translations`, `文件: app/api/translations/route.ts`)
  - POST 参数: source_type/source_id/target_language
  - 创建 present_translations 记录（status=pending）
  - 校验 BR-010（source_type 区分 version vs presentation）
  - [ ] [安全] 添加权限检查（仅 admin 可创建翻译任务）
  - [ ] [安全] 输入使用 schema 验证（如 zod）
  - [ ] [安全] XSS 防护
  - [ ] Typecheck passes

- [ ] **DT-039**: 翻译 Worker — 通义千问集成 (`文件: lib/translation/qwen-worker.ts`)
  - 调用 qwen-max API 逐张幻灯片翻译 DSL 文本内容
  - 更新 translations.progress + translations.logs（进度追踪）
  - 注入术语库（当源语言='zh' 时，BR-011/BR-012）
  - 完成后创建新 present_presentations 记录（BR-013）
  - [ ] [安全] 硬编码密钥检查（API Key 必须通过环境变量）
  - [ ] Typecheck passes

- [ ] **DT-040**: 翻译状态机 + SSE 推送 (`API: GET /api/translations/[id]/progress`, `文件: app/api/translations/[id]/progress/route.ts`)
  - SSE 实时推送 translations.status 和 progress 变化
  - 实现 BR-014（failed 状态可重试，状态回到 pending）
  - [ ] [安全] 添加权限检查（仅相关用户可订阅）
  - 验收: SSE 连接正常；进度实时更新；Typecheck passes

- [ ] **DT-041**: 术语库 CRUD API (`API: GET/POST/PUT/DELETE /api/glossary`, `文件: app/api/glossary/route.ts`)
  - 含 glossary_translations（每个词条 + 各语言翻译）
  - [ ] [安全] 添加权限检查（仅 admin 可管理术语库）
  - [ ] [安全] 使用参数化查询防止 SQL 注入
  - [ ] Typecheck passes

- [ ] **DT-042**: GlossaryPanel 组件 (`组件: <GlossaryPanel>`, `文件: components/GlossaryPanel.tsx`)
  - 仅当源语言=zh 时激活（BR-011）
  - 术语列表：source_term + term_type（保留/翻译）+ 各语言翻译
  - 支持批量导入（CSV 格式）
  - 验收: zh 源语言时可见，其他语言时隐藏；Verify in browser

- [ ] **DT-043**: TranslateConfirmDialog (`组件: <TranslateConfirmDialog>`, `文件: components/TranslateConfirmDialog.tsx`)
  - 语言选择（目标语言列表）
  - 术语库预览（仅 zh 源语言，BR-011）
  - 翻译模式选择（version 还是 presentation）
  - [ ] [安全] 输入使用 schema 验证（如 zod）
  - 验收: 语言选择正常；术语库预览正确展示；Verify in browser

- [ ] **DT-044**: TranslateProgressDialog (`组件: <TranslateProgressDialog>`, `文件: components/TranslateProgressDialog.tsx`)
  - SSE 连接实时接收翻译进度
  - 进度条 + 当前处理幻灯片提示
  - 完成/失败状态处理（[重试] 按钮）
  - [后台运行] 选项（关闭弹窗但继续翻译）
  - 验收: 进度实时更新；失败可重试；Verify in browser

- [ ] **DT-045**: 编辑器 Ribbon 扩展（4→6 Tab）(`文件: botool-ppt/components/editor/Ribbon.tsx`)
  - 新增 Tab 5: 翻译（触发 TranslateConfirmDialog，source_type='presentation'）
  - 新增 Tab 6: 语言信息（展示当前版本语言 + 版本号）
  - 验收: 新 Tab 可用；翻译功能通过 source_type='presentation' 调用；Verify in browser

- [ ] **DT-046**: 语言信息面板 (`组件: <LanguageInfoPanel>`, `文件: botool-ppt/components/editor/LanguageInfoPanel.tsx`)
  - 展示当前版本: 语言/版本组/版本号/发布状态
  - 验收: 语言信息正确展示；Verify in browser

### 7.9 Phase 8: 下载/导出 UI 完善 (P2)

> **前置**: Phase 7
> **产出**: 统一的下载对话框 + 文件名生成
> **对应设计**: Section 5.4

- [ ] **DT-047**: FileNameBuilder 工具 (`文件: lib/utils/file-name-builder.ts`)
  - 生成格式: `{title}_{YYYY-MM-DD}_{language}.{ext}`
  - 特殊字符替换为下划线
  - 验收: 各种标题和语言组合均生成合法文件名；Typecheck passes

- [ ] **DT-048**: DownloadDialog — 格式选择 + 导出设置 (`组件: <DownloadDialog>`, `文件: components/DownloadDialog.tsx`)
  - 格式选项: PDF / PNG（当前页/全部页）/ .pptbt / (PPTX 导出 — Phase 5 不含，标记为"敬请期待")
  - PDF 选项: 分辨率（1x/2x/3x）
  - PNG 选项: 单张/全部（全部时生成 ZIP）
  - 下载进度展示
  - 使用 FileNameBuilder 生成文件名
  - 验收: 三种格式导出均正常；文件名正确；Verify in browser

- [ ] **DT-049**: 导出进度 + 错误处理 UI (`组件: <ExportProgressBar>`, `文件: components/ExportProgressBar.tsx`)
  - 内联进度条（嵌入 DownloadDialog）
  - 错误时显示具体原因 + [重试] 按钮
  - 大文件时显示预估时间
  - 验收: 进度展示正确；错误提示清晰；Verify in browser

---

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `sql/01_presentations.sql` | 待创建 | Phase 1 | DT-003 |
| `sql/02_dsl_snapshots.sql` | 待创建 | Phase 1 | DT-004 |
| `sql/03_collaboration.sql` | 待创建 | Phase 1 | DT-005 |
| `sql/04_visibility.sql` | 待创建 | Phase 1 | DT-006 |
| `sql/05_versions.sql` | 待创建 | Phase 1 | DT-007 |
| `sql/06_categories.sql` | 待创建 | Phase 1 | DT-008 |
| `sql/07_translations.sql` | 待创建 | Phase 1 | DT-009 |
| `sql/08_rls_policies.sql` | 待创建 | Phase 1 | DT-010 |
| `app/upload/page.tsx` | 待删除 | Phase 0 | DT-001 |
| `app/admin/page.tsx` | 重构 | Phase 0, 3, 6 | DT-002 |
| `app/library/page.tsx` | 改造 | Phase 3, 6 | DT-016 |
| `app/api/presentations/route.ts` | 新建 | Phase 3 | DT-015 |
| `app/api/presentations/[id]/collaborators/route.ts` | 新建 | Phase 3 | DT-018 |
| `app/api/presentations/[id]/access-requests/route.ts` | 新建 | Phase 3 | DT-019 |
| `app/api/presentations/[id]/version-groups/route.ts` | 新建 | Phase 4 | DT-021 |
| `app/api/versions/[id]/publish/route.ts` | 新建 | Phase 4 | DT-024 |
| `app/api/versions/[id]/rollback/route.ts` | 新建 | Phase 4 | DT-025 |
| `app/api/categories/route.ts` | 新建 | Phase 6 | DT-033 |
| `app/api/presentations/[id]/slots/route.ts` | 新建 | Phase 6 | DT-035 |
| `app/api/translations/route.ts` | 新建 | Phase 7 | DT-038 |
| `app/api/translations/[id]/progress/route.ts` | 新建 | Phase 7 | DT-040 |
| `app/api/glossary/route.ts` | 新建 | Phase 7 | DT-041 |
| `lib/converter/dsl-to-pdf.ts` | 新建 | Phase 5 | DT-026 |
| `lib/converter/dsl-to-png.ts` | 新建 | Phase 5 | DT-027 |
| `lib/converter/dsl-to-pptbt.ts` | 新建 | Phase 5 | DT-028 |
| `lib/converter/pptbt-to-dsl.ts` | 新建 | Phase 5 | DT-029 |
| `lib/converter/pptx-to-dsl.ts` | 新建 | Phase 5 | DT-030 |
| `lib/converter/pptx-html-cleaner.ts` | 新建 | Phase 5 | DT-030 |
| `lib/converter/pptx-shape-map.ts` | 新建 | Phase 5 | DT-030 |
| `lib/converter/pptx-image-upload.ts` | 新建 | Phase 5 | DT-030 |
| `lib/converter/pptx-fill-converter.ts` | 新建 | Phase 5 | DT-030 |
| `lib/converter/pptx-types.ts` | 新建 | Phase 5 | DT-030 |
| `lib/translation/qwen-worker.ts` | 新建 | Phase 7 | DT-039 |
| `lib/utils/file-name-builder.ts` | 新建 | Phase 8 | DT-047 |
| `components/AdminLayout.tsx` | 重构 | Phase 0 | DT-002 |
| `components/AdminLibraryTab.tsx` | 新建 | Phase 3 | DT-017 |
| `components/ShareDialog.tsx` | 新建 | Phase 3 | DT-018 |
| `components/AccessRequestView.tsx` | 新建 | Phase 3 | DT-019 |
| `components/VersionListPanel.tsx` | 新建 | Phase 4 | DT-022 |
| `components/CreateVersionDialog.tsx` | 新建 | Phase 4 | DT-023 |
| `components/CategoryManagementDialog.tsx` | 新建 | Phase 6 | DT-034 |
| `components/ImportButton.tsx` | 新建 | Phase 5 | DT-032 |
| `components/GlossaryPanel.tsx` | 新建 | Phase 7 | DT-042 |
| `components/TranslateConfirmDialog.tsx` | 新建 | Phase 7 | DT-043 |
| `components/TranslateProgressDialog.tsx` | 新建 | Phase 7 | DT-044 |
| `components/LanguageInfoPanel.tsx` | 新建 | Phase 7 | DT-046 |
| `components/DownloadDialog.tsx` | 新建 | Phase 8 | DT-048 |
| `components/ExportProgressBar.tsx` | 新建 | Phase 8 | DT-049 |
| `botool-ppt/` (整个目录) | 新建 | Phase 2 | DT-011~014 |

### B. 风险与缓解措施

#### HIGH

- **Phase 2 App 拆分复杂度**: 44+ 编辑器组件迁移可能引入难以预测的依赖问题
  → **缓解**: 先建立最小可运行的 Botool_PPT（仅主编辑器组件），逐步迁移，每步 typecheck 验证

- **PPTX 导入兼容性**: pptxtojson 库对各种 PPTX 格式的支持不一致，可能出现解析错误
  → **缓解**: 建立元素类型降级策略（不支持的元素类型 → 占位符），避免整体导入失败

#### MEDIUM

- **AI 翻译 API 速率限制**: 通义千问 qwen-max 有并发限制，大型 PPT（50+ 张幻灯片）可能超时
  → **缓解**: 实现指数退避重试，按幻灯片分批调用，进度状态持久化支持断点续传

- **DSL 存储双模式**: dsl_json（内联）vs dsl_storage_path（Storage）切换逻辑
  → **缓解**: 统一封装 `getDsl()` 函数，对调用方透明；阈值设为 1MB

#### LOW

- **分类树拖拽排序**: 两级树拖拽交互实现复杂
  → **缓解**: Phase 6 可先实现 sort_order 手动排序（上移/下移按钮），拖拽作为后续优化

### C. 测试策略

#### 单元测试

- `FileNameBuilder` 各种边界输入的文件名生成
- 版本号规则（BR-005/BR-006）计算逻辑
- 访问请求冷却期计算
- ZIP 炸弹检测算法

#### 集成测试

- 翻译任务完整流水线（pending → processing → completed）
- 协作者权限矩阵（各权限级别的 API 访问控制）
- 槽位分配复制语义（修改副本不影响原文档）

#### E2E 测试

- 文档创建 → 版本管理 → 分类分配 → 发布 完整流程
- AI 翻译 → 进度推送 → 新语言版本创建
- PPTX 导入 → DSL 转换 → 编辑器打开

### D. 非目标 (Out of Scope)

- **PPTX 导出**: 仅实现 PPTX 导入；PDF/PNG/.pptbt 导出已覆盖，PPTX 导出复杂度高留后续版本
- **实时协同编辑**: 多用户同时编辑同一 PPT（需 OT/CRDT 算法，超出 v1.6 范围）
- **三级及以上分类**: 仅支持大类/子类两级树（数据库设计支持，但 UI 不实现三级）
- **批量翻译**: 一次翻译多个文档（单文档翻译是 v1.6 功能，批量作为后续优化）
- **视频/音频元素支持**: PPTX 导入时 video/audio 元素降级为占位符

### E. 安全检查项汇总

| 关联 DT | 安全检查项 | 级别 |
|---------|-----------|------|
| DT-010 | RLS 策略未认证用户只能读已发布文档 | HIGH |
| DT-015, 018, 019 | 协作者 API 权限校验（仅 admin 可管理） | HIGH |
| DT-031 | PPTX 导入 ZIP 炸弹防护（压缩比/大小/文件数/层数） | HIGH |
| DT-031 | 图片代理 SSRF 防护（内网地址黑名单） | HIGH |
| DT-031 | 文件类型白名单（.pptx + MIME 验证） | HIGH |
| DT-039 | qwen-max API Key 通过环境变量注入，禁止硬编码 | HIGH |
| 全部 API | 参数化查询防 SQL 注入 | HIGH |
| 全部 API | 错误响应不暴露内部实现细节 | MEDIUM |
| 全部表单 | zod schema 输入验证 + XSS 防护 | MEDIUM |

### F. 技术实现详情（摘录自源 PRD §10 附录 E）

#### F.1 PDF 导出核心实现

**文件**: `lib/converter/dsl-to-pdf.ts`
**依赖**: `pnpm add html2canvas jspdf`

**数据流**:
```
DSL → 创建临时DOM渲染幻灯片 → html2canvas截图 → Canvas图片 → jsPDF合并 → Blob下载
```

**关键配置**:
```typescript
const pdf = new jsPDF({
  orientation: 'landscape',
  unit: 'pt',
  format: [dsl.size.width, dsl.size.height]
})

const canvas = await html2canvas(container, {
  scale: 2,          // 2x 分辨率
  useCORS: true,     // 允许跨域图片
  allowTaint: false,
  backgroundColor: null,
  logging: false
})
```

**错误处理**:
| 场景 | 处理 |
|------|------|
| 跨域图片加载失败 | 通过代理下载，或提示用户 |
| 内存溢出（大文件） | 分批处理，显示进度 |
| 渲染超时 | 超时限制 + 提示用户 |
| 字体渲染不一致 | 使用 Web 安全字体 |

#### F.2 .pptbt 文件格式

**.pptbt 文件结构**（ZIP 包）:
```
document.pptbt (ZIP)
├── manifest.json          # 元信息
│   { version, generator, generatorVersion, created, title, slideCount }
├── content.json           # DSL 内容（图片路径已替换为相对路径）
│   { docId, meta, slides: [{ elements: [{ type: "image", src: "media/img_001.png" }] }] }
└── media/                 # 图片资源目录
    ├── img_001.png
    ├── img_002.jpg
    └── ...
```

#### F.3 PPTX 导入转换器结构

**文件结构**:
```
lib/converter/
├── pptx-to-dsl.ts           ← 主转换入口
├── pptx-html-cleaner.ts     ← HTML清洗（pptxtojson HTML → Tiptap兼容）
├── pptx-shape-map.ts        ← 形状类型映射（OOXML preset → DSL ShapeType）
├── pptx-image-upload.ts     ← 图片批量上传（base64 → Storage URL）
├── pptx-fill-converter.ts   ← 填充样式转换（color/gradient/image/pattern）
└── pptx-types.ts            ← pptxtojson输出的TypeScript类型定义
```

**元素类型映射**:
| pptxtojson 类型 | DSL 类型 | 备注 |
|-----------------|---------|------|
| text | TextElement | HTML → Tiptap 清洗 |
| image | ImageElement | base64 → Storage URL |
| shape | ShapeElement | OOXML preset → ShapeType |
| table | TableElement | 格子数据映射 |
| group | GroupElement | 递归处理 |
| video/audio/math/diagram | PlaceholderElement | 不支持，降级为占位符 |

**安全检查**（ZIP 炸弹防护阈值）:
- 解压缩比 > 100x → 拒绝
- 解压后总大小 > 2GB → 拒绝
- ZIP 内文件数 > 10000 → 拒绝
- 嵌套层数 > 10 → 拒绝

#### F.4 通义千问翻译 API 集成

**模型**: qwen-max
**调用方式**: 逐张幻灯片翻译 DSL 文本节点
**术语库注入格式**（source_type='version' 且 source_lang='zh' 时）:

```
系统提示词（含术语表）:
以下词汇不翻译，保持原文：[no_translate 词汇列表]
以下词汇固定翻译为指定译文：[translate 词汇 → 目标语言译文]

请将以下 JSON 中的所有文本内容从[source_lang]翻译为[target_lang]，
保持 JSON 结构不变，只翻译文本字段值...
```

**进度追踪**: translations.progress 字段（0-100），每张幻灯片完成后更新

**翻译速率限制规则**:
- 每用户每小时最多 10 个翻译任务
- 同时处于 processing 状态的任务最多 3 个（per user）
- 超出限制返回 429，前端提示"翻译任务过多，请等待当前任务完成"

**翻译失败恢复规则**:
```
API 级别重试（自动）:
  - HTTP 429 / 5xx → 指数退避重试，最多 3 次（1s, 2s, 4s）
  - 超时（60s）→ 中断，标记该幻灯片失败

任务级别（用户操作）:
  - translations.status = 'failed' → 前端显示"翻译失败"+ "重试"按钮
  - 点击重试 → PATCH /api/translations/:id/retry → 重新触发翻译流程
  - 重试时继承原始 prompt 设置（术语库 + 目标语言）
```

**翻译批次策略（SSE 解耦架构）**:
```
POST /api/translations → 创建 translations 记录（status=pending）
                       → 立即返回 translation_id（202 Accepted）
                       ↓
SSE /api/translations/:id/stream → 前端订阅实时进度
                       ↓
后台 Worker → 逐张幻灯片调用 qwen-max → 更新 progress(0-100)
           → 完成 → status=completed → SSE 推送 done 事件
           → 失败 → status=failed → SSE 推送 error 事件
```

#### F.5 槽位分配详细工作流

**核心设计：槽位分配 = 复制语义（非引用）**

```
挂载前（文档库已有 presentation A）:

  [present_presentations 表]
  id=A: slug="q3-report", name="Q3报告", owner=category_C1

  挂载到槽位时（不是引用，而是创建新记录）:

  ┌─────────────────────────────────────────────────────┐
  │ 槽位分配 = COPY 操作                                 │
  │                                                     │
  │ 用户: 将文档库中的 "Q3报告(A)" 挂载到 slot_id=S1    │
  │                           ↓                         │
  │ 系统操作:                                            │
  │   1. 从文档库 A 的 presentations 记录中              │
  │      复制所有 versions 记录（新建 B_v1, B_v2）       │
  │   2. 新建 present_presentations 记录 B               │
  │      - B.slot_id = S1                               │
  │      - B.source_id = A （追溯来源）                  │
  │      - B.name = A.name                              │
  │   3. A 保留在文档库，不受影响                        │
  │                                                     │
  │ 挂载后状态:                                          │
  │   文档库: [A] (原始，独立)                           │
  │   槽位 S1: [B] (复制自 A，独立演化)                  │
  └─────────────────────────────────────────────────────┘
```

**四步槽位分配流程**:
```
Step 1: 创建槽位
  POST /api/categories/:id/slots
  Body: { name, sort_order, max_versions?, allowed_langs? }
  → 创建 present_slots 记录

Step 2: 触发分配
  用户在槽位页面点击"+ 挂载文档"
  → 打开文档库选择器（SearchableModal）

Step 3: 选择来源（3 种）
  ├─ (a) 上传新文件 → 直接上传 .pptbt 到该槽位
  ├─ (b) 从文档库选择 → 复制现有文档到该槽位
  └─ (c) 复制当前槽位 → 同槽位内版本复制

Step 4: 自动命名
  挂载完成后，系统自动根据 4 段式命名规则生成:
  格式: {category}.{code}-{slug}-{version}-{lang}.pdf
  例如: market.p001-q3-report-v1.0-zh.pdf
```

#### F.6 版本号算法

**主版本 (Major)** = 当前 presentation 下最大 major_version + 1
**次版本 (Minor)** = 当前 major 下最大 minor_version + 0.1（四舍五入至1位小数）

```
场景: 槽位下已有版本 v1.0, v1.1, v2.0

新建主版本:
  major = max(1, 2) + 1 = 3
  minor = 0
  → 新建 v3.0

新建次版本（基于 v2.0）:
  major = 2
  minor = max(0) + 0.1 = 0.1
  → 新建 v2.1

SQL 实现:
  SELECT COALESCE(MAX(major_version), 0) + 1 AS next_major
  FROM present_versions
  WHERE presentation_id = $1;

  SELECT COALESCE(MAX(minor_version), 0) + 0.1 AS next_minor
  FROM present_versions
  WHERE presentation_id = $1 AND major_version = $2;
```

#### F.7 语言版本创建三种来源

```
┌─────────────────────────────────────────────┐
│  创建语言版本                          [x]  │
│  ─────────────────────────────────────────  │
│  目标语言: [English ▾]                      │
│                                             │
│  来源选择:                                  │
│  ○ AI 翻译  [推荐]                          │
│    基于现有中文版本自动翻译                  │
│    预计耗时: ~2-5分钟                        │
│                                             │
│  ○ 从文档库选择                             │
│    选择已有的英文演示文档                    │
│                                             │
│  ○ 空白新建                                 │
│    创建空白演示文稿从头制作                  │
│  ─────────────────────────────────────────  │
│                      [取消]  [创建语言版本]  │
└─────────────────────────────────────────────┘

选择 "AI 翻译" 后的源版本选择器:
┌─────────────────────────────────────────────┐
│  选择翻译源版本                        [x]  │
│                                             │
│  ○ v3.0（最新）  2026-02-20 ★             │
│  ○ v2.1          2026-02-15               │
│  ○ v1.0          2026-01-10               │
│  ─────────────────────────────────────────  │
│                      [取消]  [开始翻译]      │
└─────────────────────────────────────────────┘
```

#### F.8 选择性发布时间线示例

```
场景: 演示文稿有中文和英文两个语言版本

时间线（以 slug=q3-report 为例）:

  2026-02-01: zh v1.0 发布 → status=published
    状态: zh[v1.0 published] / en[无]

  2026-02-05: zh v1.1 发布 → zh v1.0 自动撤销
    状态: zh[v1.1 published] / en[无]

  2026-02-10: en v1.0 发布 → 仅 en 发布，zh 不受影响
    状态: zh[v1.1 published] / en[v1.0 published]

  2026-02-15: zh v2.0 发布 → 仅 zh v1.1 撤销，en 不受影响
    状态: zh[v2.0 published] / en[v1.0 published]

规则: 每语言版本各自独立管理 published 状态
  - 发布操作: 同语言下只保留1个已发布版本（自动撤销旧版）
  - 跨语言操作: 相互独立，互不影响
  - 通用链接: /p/{presentation_id} → 展示所有已发布语言版本供用户切换
```

#### F.9 文件命名 4 段式规范

**格式**: `{分类}.{编号}-{slug}-{版本}-{语言}.{格式}`

```
段 1: 分类缩写  (1-8字符)
  market → 市场类   product → 产品类
  finance → 财务类  tech → 技术类

段 2: 文档编号  (p + 3-4位数字)
  p001, p002, p0123

段 3: slug      (kebab-case, 无特殊字符)
  q3-report, annual-review, product-launch

段 4: 版本      (v + 数字.数字)
  v1.0, v2.1, v3.0

语言标签:
  zh → [中文版]    en → [英文版]
  de → [德文版]    ja → [日文版]
  fr → [法文版]    es → [西班牙文版]

示例文件名:
  market.p001-q3-report-v2.1-zh.pdf     ← PDF 导出
  product.p023-launch-v1.0-en.pptbt     ← .pptbt 导出
  finance.p015-annual-v3.0-ja.png       ← PNG 导出（首页缩略图）

验证正则: /^[a-z]{1,8}\.[a-z]\d{3,4}-[a-z0-9-]+-v\d+\.\d+-[a-z]{2}\.(pdf|pptbt|png|pptx)$/
```

#### F.10 词汇表管理 Excel 风格 UI

**设计原则**: 直接在表格单元格内编辑，无需打开侧边弹窗

```
词汇表管理页面 /categories/:id/glossary

┌──────────────────────────────────────────────────────────────────────────────┐
│  词汇表管理                                                    [+ 新增词汇]   │
│                                                                              │
│  搜索: [搜索词汇...          ]                                               │
│                                                                              │
│  ┌─────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐ │
│  │ 原文 (必填)      │ 不翻译   │ 中文     │ English  │ 日本語   │ Deutsch  │ │
│  ├─────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤ │
│  │ Botool          │ [☑ 开]   │          │          │          │          │ │
│  │ 战略合作伙伴     │ [☐ 关]   │ 战略合作 │ Strategic│ 戦略パー │ Strate-  │ │
│  │                 │          │ 伙伴      │ Partner  │ トナー   │ gische   │ │
│  │ Q3              │ [☑ 开]   │          │          │          │          │ │
│  │ [新词汇输入...]  │ [☐ 关]   │          │          │          │          │ │
│  └─────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘ │
│                                                                              │
│  单元格点击即可编辑 (inline edit)                                             │
│  Tab 键跳转下一单元格 / Enter 确认 / Esc 取消                                 │
│  拖拽行首调整顺序                                                             │
│  最后一行空行: 直接输入原文即可新增                                            │
└──────────────────────────────────────────────────────────────────────────────┘

数据结构 (present_glossary_entries):
  source_text: "战略合作伙伴"
  no_translate: false
  translations: {
    zh: "战略合作伙伴",
    en: "Strategic Partner",
    ja: "戦略パートナー",
    de: "Strategischer Partner"
  }
```

**批量操作**:
- 勾选多行 → 右键菜单 → "批量删除" / "批量设为不翻译"
- Excel 粘贴：支持从 Excel 复制多行粘贴到词汇表

---

### G. 分享与访问控制详细规格

#### G.1 ShareDialog 详细规格

```
┌────────────────────────────────────────────────────────────┐
│  分享设置                                            [x]   │
│  ────────────────────────────────────────────────────────  │
│                                                            │
│  当前访问权限:                                             │
│  ○ 私有（仅受邀成员可访问）                                │
│  ● 组织内公开（所有登录用户可查看）                        │
│  ○ 公开链接（任何人可访问，无需登录）                      │
│                                                            │
│  ────────────────────────────────────────────────────────  │
│  邀请成员                                                  │
│  [搜索用户名或邮箱...                        ] [邀请]      │
│                                                            │
│  已邀请成员:                                               │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 👤 张三 (zhang@company.com)        [编辑者 ▾] [移除] │ │
│  │ 👤 李四 (li@company.com)           [查看者 ▾] [移除] │ │
│  │ 👤 王五 (wang@company.com)         [查看者 ▾] [移除] │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  分享链接:                                                 │
│  https://botool.ai/p/abc123  [复制链接] [重置链接]        │
│                                                            │
│  链接有效期: [永久 ▾]  密码保护: [不启用 ▾]               │
│                                                            │
│                                        [关闭] [保存设置]  │
└────────────────────────────────────────────────────────────┘
```

**权限级别**:
| 权限 | 查看演示 | 下载文件 | 编辑内容 | 管理成员 |
|------|---------|---------|---------|---------|
| 查看者 | ✅ | ❌ | ❌ | ❌ |
| 编辑者 | ✅ | ✅ | ✅ | ❌ |
| 管理员 | ✅ | ✅ | ✅ | ✅ |

#### G.2 访问请求视图

```
状态 A: 锁定视图（未登录或无权限）
┌─────────────────────────────────────────┐
│                 🔒                       │
│                                         │
│  此演示文稿需要申请访问权限              │
│                                         │
│  [申请访问]                             │
└─────────────────────────────────────────┘

状态 B: 申请已提交
┌─────────────────────────────────────────┐
│                 ⏳                       │
│                                         │
│  访问申请已提交，等待管理员审批          │
│                                         │
│  申请时间: 2026-02-23 14:30             │
│                                         │
│  [联系管理员]                           │
└─────────────────────────────────────────┘
```

**API 端点**:
```
POST /api/presentations/:id/access-requests   ← 提交申请
GET  /api/presentations/:id/access-requests   ← 管理员查看申请列表
PATCH /api/access-requests/:id                ← 审批/拒绝
```

---

### H. 版本状态机完整定义

```
                  ┌─────────────────────────────────────────────┐
                  │          版本 (present_versions) 状态机      │
                  └─────────────────────────────────────────────┘

  ┌─────────┐   用户点击"发布"    ┌───────────┐
  │  draft  │ ──────────────────▶ │ published │
  │（草稿）  │                    │（已发布）  │
  └─────────┘ ◀─────────────────  └───────────┘
       │          用户点击"撤销"          │
       │                                  │ 发布新版本时，
       │ (默认状态)                       │ 同语言旧版本
       │                                  │ 自动撤销
       │                         ┌────────┘
       ▼                         ▼
  ┌─────────────────────────────────────────────┐
  │  状态转换 API:                               │
  │  PATCH /api/versions/:id                    │
  │  Body: { status: 'published' | 'draft' }    │
  │                                             │
  │  触发副作用（发布时）:                        │
  │  1. 查询同 presentation + 同 language 下    │
  │     其他 published 版本                      │
  │  2. 批量更新 status = 'draft'               │
  │  3. 更新 presentations.published_at         │
  └─────────────────────────────────────────────┘
```

**翻译状态机**:
```
  ┌─────────┐  触发翻译   ┌────────────┐  翻译进行中  ┌───────────┐
  │ pending │ ──────────▶ │ processing │ ────────────▶ │ completed │
  └─────────┘             └────────────┘               └───────────┘
                                │                            │
                                │ API/网络错误               │
                                ▼                            │
                          ┌──────────┐                       │
                          │  failed  │ ◀─────────────────────┘
                          └──────────┘     (不可能，completed 不回退)
                                │
                                │ 用户点击"重试"
                                ▼
                          ┌─────────┐
                          │ pending │（重新入队）
                          └─────────┘
```

---

### I. API 端点完整清单

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | /api/categories | 获取分类树 | 需要 |
| POST | /api/categories | 创建分类 | 需要（管理员） |
| PATCH | /api/categories/:id | 更新分类 | 需要（管理员） |
| DELETE | /api/categories/:id | 删除分类 | 需要（管理员） |
| GET | /api/categories/:id/slots | 获取槽位列表 | 需要 |
| POST | /api/categories/:id/slots | 创建槽位 | 需要（管理员） |
| GET | /api/presentations | 获取演示文稿列表（含筛选） | 需要 |
| POST | /api/presentations | 创建演示文稿 | 需要 |
| GET | /api/presentations/:id | 获取演示文稿详情 | 按权限 |
| PATCH | /api/presentations/:id | 更新演示文稿元数据 | 需要（所有者） |
| DELETE | /api/presentations/:id | 删除演示文稿 | 需要（管理员） |
| POST | /api/presentations/:id/assign-slot | 挂载到槽位 | 需要 |
| GET | /api/presentations/:id/versions | 获取版本列表 | 需要 |
| POST | /api/presentations/:id/versions | 创建新版本 | 需要 |
| PATCH | /api/versions/:id | 更新版本（含状态切换） | 需要 |
| DELETE | /api/versions/:id | 删除版本 | 需要（管理员） |
| GET | /api/versions/:id/download | 下载版本文件（.pptbt/.pdf） | 按权限 |
| POST | /api/versions/:id/export-pdf | 导出 PDF（异步） | 需要 |
| POST | /api/versions/:id/export-png | 导出 PNG（异步） | 需要 |
| POST | /api/versions/:id/export-pptbt | 导出 .pptbt（异步） | 需要 |
| GET | /api/translations/:id/stream | SSE 翻译进度流 | 需要 |
| POST | /api/translations | 创建翻译任务 | 需要 |
| PATCH | /api/translations/:id/retry | 重试翻译任务 | 需要 |
| GET | /api/categories/:id/glossary | 获取词汇表 | 需要 |
| POST | /api/categories/:id/glossary | 创建词汇条目 | 需要 |
| PATCH | /api/glossary-entries/:id | 更新词汇条目 | 需要 |
| DELETE | /api/glossary-entries/:id | 删除词汇条目 | 需要 |
| POST | /api/presentations/:id/access-requests | 申请访问 | 需要（登录） |
| GET | /api/presentations/:id/access-requests | 查看申请列表 | 需要（管理员） |
| PATCH | /api/access-requests/:id | 审批/拒绝申请 | 需要（管理员） |
| GET | /api/presentations/:id/collaborators | 获取协作者列表 | 需要 |
| POST | /api/presentations/:id/collaborators | 邀请协作者 | 需要（管理员） |
| PATCH | /api/collaborators/:id | 更新协作者权限 | 需要（管理员） |
| DELETE | /api/collaborators/:id | 移除协作者 | 需要（管理员） |
| GET | /p/:id | 公开演示页面（SSR） | 按权限 |

---

### J. 环境变量清单

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=         # Supabase 项目 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Supabase 匿名密钥（客户端）
SUPABASE_SERVICE_ROLE_KEY=        # Supabase 服务角色密钥（服务端）

# AI 翻译
QWEN_API_KEY=                     # 通义千问 API Key

# 应用配置
NEXT_PUBLIC_APP_URL=              # 应用公开 URL（用于生成分享链接）
NEXT_PUBLIC_EDITOR_URL=           # Botool_PPT 编辑器 URL（port 3009）

# 文件存储
SUPABASE_STORAGE_BUCKET=present-files  # Supabase Storage Bucket 名称

# 可选
MAX_UPLOAD_SIZE_MB=50             # 最大上传文件大小（默认50MB）
TRANSLATION_RATE_LIMIT_PER_HOUR=10  # 每用户每小时翻译任务数限制
TRANSLATION_MAX_CONCURRENT=3        # 最大并发翻译任务数
```

---

### K. 组件 Props 接口详细定义

```typescript
// SlotCard 组件
interface SlotCardProps {
  slot: PresentSlot;
  presentation?: PresentPresentation;
  onAssign: (slotId: string) => void;
  onUnassign: (slotId: string) => void;
  onViewPresentation: (presentationId: string) => void;
  canManage: boolean;
}

// VersionTimeline 组件
interface VersionTimelineProps {
  versions: PresentVersion[];
  currentVersionId: string;
  onVersionSelect: (versionId: string) => void;
  onPublish: (versionId: string) => void;
  onUnpublish: (versionId: string) => void;
  onCreateVersion: () => void;
}

// TranslationJobCard 组件
interface TranslationJobCardProps {
  job: PresentTranslation;
  onRetry: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}

// GlossaryTable 组件（Excel 风格）
interface GlossaryTableProps {
  categoryId: string;
  entries: GlossaryEntry[];
  supportedLanguages: string[];
  onEntryUpdate: (entryId: string, updates: Partial<GlossaryEntry>) => void;
  onEntryCreate: (entry: Omit<GlossaryEntry, 'id'>) => void;
  onEntryDelete: (entryId: string) => void;
}

// ShareDialog 组件
interface ShareDialogProps {
  presentationId: string;
  isOpen: boolean;
  onClose: () => void;
  currentPermission: 'private' | 'org' | 'public';
  collaborators: Collaborator[];
}

// PresentationViewer 组件（Botool_PPT port 3009）
interface PresentationViewerProps {
  presentationId: string;
  versionId: string;
  language: string;
  mode: 'view' | 'edit' | 'present';
  onSlideChange?: (slideIndex: number) => void;
}

// 核心数据类型
interface PresentSlot {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
  max_versions?: number;
  allowed_langs?: string[];
  created_at: string;
}

interface PresentVersion {
  id: string;
  presentation_id: string;
  version_number: string;  // "1.0", "2.1" etc.
  major_version: number;
  minor_version: number;
  language: string;
  status: 'draft' | 'published';
  file_url?: string;
  slide_count?: number;
  created_at: string;
  published_at?: string;
}

interface GlossaryEntry {
  id: string;
  category_id: string;
  source_text: string;
  no_translate: boolean;
  translations: Record<string, string>;  // { zh: "...", en: "...", ... }
}

interface PresentTranslation {
  id: string;
  version_id: string;
  target_language: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;  // 0-100
  error_message?: string;
  created_at: string;
  completed_at?: string;
}
```

---

### L. 数据库 RLS 策略详细定义

```sql
-- ============================================================
-- RLS 策略: present_categories
-- ============================================================
ALTER TABLE present_categories ENABLE ROW LEVEL SECURITY;

-- 所有登录用户可查看
CREATE POLICY "categories_select_logged_in"
  ON present_categories FOR SELECT
  TO authenticated
  USING (true);

-- 仅管理员可写
CREATE POLICY "categories_insert_admin"
  ON present_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM present_org_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "categories_update_admin"
  ON present_categories FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM present_org_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================
-- RLS 策略: present_presentations
-- ============================================================
ALTER TABLE present_presentations ENABLE ROW LEVEL SECURITY;

-- 查看权限：公开 OR 组织内 OR 协作者
CREATE POLICY "presentations_select"
  ON present_presentations FOR SELECT
  TO authenticated
  USING (
    visibility = 'public'
    OR visibility = 'org'
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM present_collaborators
      WHERE presentation_id = present_presentations.id
        AND user_id = auth.uid()
    )
  );

-- 写入权限：所有者或管理员
CREATE POLICY "presentations_update_owner"
  ON present_presentations FOR UPDATE
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM present_collaborators
      WHERE presentation_id = present_presentations.id
        AND user_id = auth.uid()
        AND permission = 'admin'
    )
  );

-- ============================================================
-- Storage RLS: present-files bucket
-- ============================================================
-- 上传权限：认证用户
CREATE POLICY "storage_upload_authenticated"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'present-files');

-- 下载权限：按演示文稿可见性
CREATE POLICY "storage_download"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'present-files'
    AND (
      -- 从路径解析 presentation_id 进行权限验证
      EXISTS (
        SELECT 1 FROM present_presentations p
        JOIN present_versions v ON v.presentation_id = p.id
        WHERE v.file_url LIKE '%' || storage.objects.name
          AND (
            p.visibility IN ('public', 'org')
            OR p.owner_user_id = auth.uid()
          )
      )
    )
  );
```

---

### M. 测试策略详细规格

#### M.1 单元测试重点

```typescript
// 版本号算法测试
describe('VersionNumberAlgorithm', () => {
  test('新建主版本时，major = max + 1', () => {
    // 已有 v1.0, v1.1, v2.0 → 新建主版本 = v3.0
  });
  test('新建次版本时，minor = max_under_major + 0.1', () => {
    // 已有 v2.0, v2.1 → 基于 v2 新建次版本 = v2.2
  });
  test('空演示文稿新建第一个版本 = v1.0', () => {});
});

// 翻译术语注入测试
describe('GlossaryInjection', () => {
  test('no_translate 词汇注入为"不翻译"指令', () => {});
  test('translate 词汇注入为"固定翻译"指令', () => {});
  test('词汇表为空时不影响翻译提示词', () => {});
});

// 槽位分配 Copy 语义测试
describe('SlotAssignment', () => {
  test('挂载文档库文档后，原文档不受影响', () => {});
  test('槽位 presentation 修改不影响文档库原始记录', () => {});
  test('source_id 正确记录来源', () => {});
});

// 文件命名验证
describe('FileNamingConvention', () => {
  test('4段式命名验证正则', () => {
    expect(validateFileName('market.p001-q3-report-v2.1-zh.pdf')).toBe(true);
    expect(validateFileName('invalid-name.pdf')).toBe(false);
  });
});
```

#### M.2 E2E 测试场景

```
场景 1: 完整槽位分配流程
  前置: 已有分类 C1，已有文档库文档 A
  步骤:
    1. 管理员在 C1 下创建槽位 S1
    2. 在 S1 页面点击"挂载文档"
    3. 从文档库选择文档 A
    4. 系统自动创建 presentation B，slot_id=S1，source_id=A
  验证: B 存在，A 不受影响，B.slot_id=S1

场景 2: AI 翻译全流程
  前置: 已有中文版本 v1.0（slides 5张）
  步骤:
    1. 创建英文语言版本（选择 AI 翻译）
    2. 选择源版本 v1.0
    3. 点击"开始翻译"
    4. 订阅 SSE 流，观察 progress 0→100
    5. 翻译完成后打开英文版本
  验证: 英文版本内容与中文版本结构相同，文本已翻译

场景 3: 选择性发布
  步骤:
    1. 发布 zh v1.0 → zh 已发布
    2. 发布 en v1.0 → en 已发布，zh 不受影响
    3. 发布 zh v2.0 → zh v1.0 自动撤销，en v1.0 不受影响
  验证: 每语言只有一个 published 版本

场景 4: ZIP 炸弹防护
  步骤:
    1. 上传解压比 > 100x 的 .pptbt 文件
  验证: 返回 400，提示"文件格式异常"，不触发解压
```

---

> **[T7 补充自源 PRD 关键章节]** 以上 F-M 节为 T7 自动补充内容，摘录自源 PRD v4.1 §3.6（槽位工作流）、§4.7（版本算法）、§5.3-5.5（词汇表/分享UI）、§6.4（文件命名）、§7.3（翻译技术配置）及附录章节。

---

*此 PRD 由 BotoolAgent PyramidPRD Transform Mode 生成，基于源文件 v1.6_Botool_Present_v2PRD copy.md (v4.1) 转换。*
*生成日期: 2026-02-23*
