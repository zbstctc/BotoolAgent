# PRD: Botool_Present v1.6

> **来源**: Transform Mode 从 `v1.6_Botool_Present_v2PRD copy.md` 生成
> **生成日期**: 2026-02-23
> **模式**: 完整规划 (9 Phase × 31 DT)
> **目标用户**: 企业内部员工（管理员 + 普通用户）

---

## 1. 项目概述

### 1.1 背景与动机

Botool_Present 是企业内部的 PPT 文档管理平台，经历 Stage 1 (UI 框架)、Stage 2 (编辑器 DSL) 之后进入 v1.6。然而系统目前**无法实际使用**，核心原因：

1. **数据库从未初始化**：所有 12 张表（包含版本管理、分类槽位、术语表等）均未在生产 Supabase 中创建，功能无法持久化
2. **新旧架构混杂**：旧 `/upload` 页面、localStorage-based `CategoryManager`、已废弃的 `editing` 版本状态、`reviewing` 审批状态仍在代码中，与新架构形成死代码污染
3. **编辑器与管理功能耦合**：Botool_Present 单应用同时承担管理运营 + 编辑器功能，需要拆分为独立 `Botool_PPT` 编辑器应用（端口 3009）

### 1.2 核心目标

- **目标 1（P0）**: 完成全部 12 张数据库表初始化 + RLS 安全策略，让基础数据流通
- **目标 2（P0）**: 清理旧架构遗留代码，拆分 Botool_PPT 独立编辑器应用
- **目标 3（P0）**: 完成文档库管理（CRUD + 分享 + 访问控制）
- **目标 4（P1）**: 实现版本管理（大/小版本创建、发布/回退）+ 导入导出
- **目标 5（P1）**: 实现 2 级分类指派体系
- **目标 6（P2）**: 实现 AI 翻译全流程 + 术语表管理 + 下载 UI

### 1.3 成功指标

- 数据库 12 张表全部在 Supabase 验证通过（含 RLS 策略）
- `pnpm build` 两个 app（Botool_Present + Botool_PPT）均无编译错误
- 管理员可完整执行：创建文档 → 指派分类 → 发布版本 → 前台可见
- 翻译任务状态机（pending → processing → completed/failed）前后端一致

### 1.4 技术栈

- **前端**: Next.js 16 + TypeScript + Tailwind CSS + shadcn/ui
- **状态管理**: Zustand
- **数据库**: Supabase (PostgreSQL + RLS)
- **存储**: Supabase Storage (`present-files` bucket)
- **包管理**: pnpm workspace (monorepo)
- **AI 翻译**: 通义千问 qwen-max
- **文件转换**: jszip (.pptbt), html2canvas + jspdf (PDF), pptxtojson (PPTX)

---

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| DSL 编辑器 | ✅ 已实现 | components/editor/ ~44 个组件，Stage 2 完成 |
| 演示模式 | ✅ 已实现 | components/renderer/ ~11 个组件 |
| PPTX 导入（占位符） | ⚠️ 部分 | lib/converter/pptx-to-dsl.ts 存在但为占位符，Phase 5 实现 |
| 版本组管理服务 | ✅ 已实现 | services/version-group.service.ts |
| 翻译服务 | ✅ 已实现 | services/translation.service.ts, dsl-translation.service.ts |
| Supabase Auth | ✅ 已实现 | lib/supabase/client.ts, server.ts, middleware.ts |
| 语言配置 | ✅ 已实现 | config/languages.ts |

### 2.2 缺口分析

```
核心缺口（阻断系统可用）:
  ❌ 数据库表未创建 → 所有数据无法持久化
  ❌ Botool_PPT 未拆分 → 编辑器与管理耦合

架构缺口:
  ⚠️ 旧 /upload 页面 → 需删除，功能合并到新增PPT下拉菜单
  ⚠️ CategoryManager(localStorage) → 需替换为数据库驱动版本
  ⚠️ editing 版本状态 → 需简化为 draft/published 两态
  ⚠️ /library 前台bug → "全部"标签展示所有PPT（应按槽位展示）

功能缺口（数据库就绪后才能实现）:
  ❌ 分类/槽位系统 → 需 Phase 6
  ❌ 术语表 → 需 Phase 7
  ❌ 导入导出 converter → 需 Phase 5
  ❌ 完整翻译状态机 → 需 Phase 7
```

---

## 3. 架构设计

### 3.1 核心概念架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       Botool_Present (管理/运营)                │
│  端口: 3000 (dev)  basePath: /                                  │
│                                                                 │
│  /admin (3-Tab):                  /library (前台):              │
│  ├── Tab1: 📚 文档库管理           2级分类树展示                 │
│  ├── Tab2: 📁 分类管理             已指派且已发布内容             │
│  └── Tab3: 📖 术语表               用户只读视角                  │
└─────────────────────────────────────────────────────────────────┘
                          │
                   跨应用导航
            (从 Present 点击 [编辑/演示])
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Botool_PPT (编辑器)                       │
│  端口: 3009 (dev)  basePath: /ppt (staging/prod)                │
│                                                                 │
│  /editor/[id] — DSL 编辑器                                     │
│  /editor/new  — 创建空白 PPT                                    │
│  /present/[id] — 演示模式                                       │
│  /present/preview — 预览模式                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 实体关系

```
┌──────────────────────────┐
│   present_categories     │  2级分类树（大分类 → 子分类）
│   parent_id 自引用        │
└──────────────────────────┘
            │ 1:N
            ▼
┌──────────────────────────┐      ┌──────────────────────────┐
│  present_category_slots  │      │  present_presentations   │
│  (槽位，挂载文档)         │◀─────│  (文档主表)               │
│  category_id FK          │      │  owner_id, language_code │
│  presentation_id FK      │      │  translated_from_id FK   │
│  version_group_id FK     │      └──────────────────────────┘
└──────────────────────────┘                  │ 1:N
                                              ▼
                               ┌──────────────────────────┐
                               │  present_version_groups   │
                               │  (版本组: 1.0, 2.0, 2.1) │
                               │  is_published BOOL        │
                               └──────────────────────────┘
                                              │ 1:N
                                              ▼
                               ┌──────────────────────────┐
                               │  present_versions         │
                               │  (语言版本: zh/en/de/ja)  │
                               │  status: draft/published  │
                               │  source_version_id FK     │
                               │  source_presentation_id FK│
                               └──────────────────────────┘

present_translations ─(source_type='version')──▶ present_versions
present_translations ─(source_type='presentation')─▶ present_presentations
present_glossary ──1:N──▶ present_glossary_translations
```

### 3.3 版本状态机

```
版本状态（语言版本级别，BR-02/BR-03 约束）:

        新建
          │
          ▼
      ┌───────┐
      │ draft │ ←──── 可以编辑 DSL
      └───────┘
          │
   管理员发布
          │
          ▼
    ┌───────────┐
    │ published │ ──── 只读（前台可见）
    └───────────┘
          │
   管理员取消发布
          │
          ▼
      ┌───────┐
      │ draft │  (可再次编辑/发布)
      └───────┘

注意: 删除 'editing' 状态 (Phase 0 清理)
前台可见条件: version.status='published' AND version_group.is_published=TRUE
```

### 3.4 翻译状态机

```
触发翻译（管理员点击「翻译」）
      │
      ▼
┌──────────┐
│ pending  │  ←── 已创建翻译任务记录
└──────────┘
      │ 翻译服务处理
      ▼
┌────────────┐
│ processing │  ←── 通义千问 API 调用中, SSE 推送进度
└────────────┘
      │
   ┌──┴───────┐
   ▼          ▼
┌────────────┐ ┌────────┐
│ completed  │ │ failed │ ←── error_message 记录原因
└────────────┘ └────────┘
                   │
           用户可点击重试
                   │
                   ▼
              ┌──────────┐
              │ pending  │  (重新排队)
              └──────────┘
```

### 3.5 导入状态机

```
用户触发导入（上传文件）
      │
      ▼
┌────────────┐
│ importing  │  ←── SSE 连接推送分阶段进度
└────────────┘
   │         │
   ▼         ▼
┌──────┐  ┌───────────────┐
│ done │  │ import_failed │ ←── 提示原因 + 支持重试
└──────┘  └───────────────┘
  (=draft)
```

### 3.6 应用拆分架构

```
pnpm workspace monorepo:
  apps/
    Botool_Present/   端口 3000
    Botool_PPT/       端口 3009 (新增)

跨应用导航逻辑:
  Present [编辑] → {PPT_URL}/editor/{id}
  Present [演示] → {PPT_URL}/present/{id}
  Present [新建 PPT] → {PPT_URL}/editor/new

认证:
  开发环境: ATT 跨端口认证
  Staging/Production: Cookie (Supabase Session)

infrastructure (所有需更新):
  start-all-apps.sh, stop-all-apps.sh
  docker/compose.yml (添加 PPT 服务)
  nginx/botool.conf (/ppt 路径代理)
  pm2/ecosystem.*.js (添加 PPT 进程)
  @botool/config botool-urls.config.js (添加 PPT URL 配置)
```

---

## 4. 数据设计

### 4.1 数据表总览

| 表名 | 用途 | 状态 | 初始化步骤 |
|------|------|------|----------|
| present_presentations | 文档主表 | 已有 + 增强 | 步骤 1 创建, 步骤 7 ALTER |
| present_dsl_snapshots | DSL 快照 | 已有 (Stage2) | 步骤 2 |
| present_collaborators | 协作者 | 已有 (Stage1) | 步骤 1 |
| present_access_requests | 访问申请 | 新建 | 步骤 1 |
| present_visibility_groups | 可见性分组 | 新建 | 步骤 1 |
| present_version_groups | 版本组 | 新建 | 步骤 4 |
| present_versions | 语言版本 | 已有 + 增强 | 步骤 4 ALTER |
| present_translations | 翻译任务 | 已有 + 增强 | 步骤 5 创建, 步骤 7 ALTER |
| present_categories | 分类定义 | 新建 | 步骤 6 |
| present_category_slots | 分类槽位 | 新建 | 步骤 6 |
| present_glossary | 术语表主表 | 新建 | 步骤 6 |
| present_glossary_translations | 术语翻译 | 新建 | 步骤 6 |

### 4.2 SQL 建表语句（完整定义）

```sql
-- ====================================================================
-- 表 1: present_presentations (文档主表)
-- 草稿箱 vs 官方资料库: 通过 present_category_slots 引用关系区分
-- present_presentations.type 仅用于访问控制，不是区分依据
-- ====================================================================
CREATE TABLE present_presentations (
  id                      SERIAL PRIMARY KEY,
  title                   VARCHAR(255) NOT NULL,   -- 主标题（中文）: 公司简介
  title_en                VARCHAR(255),            -- 英文标题（可选）
  slug                    VARCHAR(100),            -- 英文标识（槽位指派后由系统生成）
  description             TEXT,
  thumbnail_url           VARCHAR(500),
  tags                    JSONB DEFAULT '[]',      -- ["产品", "2025Q1"] 用于搜索
  language_code           VARCHAR(10) DEFAULT 'zh',   -- zh/en/de/ja (v3.3 草稿库筛选)
  translated_from_id      INT REFERENCES present_presentations(id),  -- Editor翻译来源 (v3.3)
  type                    VARCHAR(20) DEFAULT 'private',  -- 'private'|'public' 访问控制
  original_path           VARCHAR(500),            -- 导入文件路径 (Storage)
  file_name               VARCHAR(255),
  file_size               BIGINT,
  status                  VARCHAR(20) DEFAULT 'draft',  -- draft/importing/import_failed
  review_status           VARCHAR(20) DEFAULT 'draft',  -- draft/reviewing/approved/rejected
  dsl_json                JSONB,                   -- 小型 DSL 直接存储
  dsl_storage_path        VARCHAR(500),            -- 大型 DSL Storage 路径
  current_version_group_id INT,                    -- 关联 version_groups
  owner_id                INT NOT NULL,
  dept_path               VARCHAR(100),
  is_deleted              BOOLEAN DEFAULT FALSE,
  deleted_at              TIMESTAMPTZ,
  deleted_by              INT,
  deleted_by_name         VARCHAR(255),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  created_by              INT,
  created_by_name         VARCHAR(255),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_by              INT,
  updated_by_name         VARCHAR(255)
);

-- 草稿箱查询（无槽位引用）:
-- SELECT p.* FROM present_presentations p
-- WHERE p.is_deleted = FALSE
--   AND NOT EXISTS (SELECT 1 FROM present_category_slots s WHERE s.presentation_id = p.id);

-- 前台可见查询（已指派 + 已发布）:
-- SELECT p.*, s.category_id, vg.version_number
-- FROM present_presentations p
-- INNER JOIN present_category_slots s ON s.presentation_id = p.id
-- INNER JOIN present_version_groups vg ON vg.id = s.version_group_id
-- WHERE p.is_deleted = FALSE AND vg.is_published = TRUE;


-- ====================================================================
-- 表 2: present_dsl_snapshots (DSL 快照表, Stage2 已创建)
-- ====================================================================
-- 已在 001_stage2_database_extension.sql 中创建
CREATE TABLE present_dsl_snapshots (
  id                SERIAL PRIMARY KEY,
  presentation_id   INT NOT NULL REFERENCES present_presentations(id),
  dsl_json          JSONB,
  dsl_storage_path  VARCHAR(500),
  snapshot_type     VARCHAR(20) DEFAULT 'auto',  -- auto / manual
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        INT
);


-- ====================================================================
-- 表 3: present_collaborators (协作者表, Stage1 已创建)
-- ====================================================================
-- 已在 001_create_tables.sql 中创建
CREATE TABLE present_collaborators (
  id                SERIAL PRIMARY KEY,
  presentation_id   INT NOT NULL REFERENCES present_presentations(id),
  user_id           INT NOT NULL,
  permission        VARCHAR(20) NOT NULL DEFAULT 'read',  -- read / write / admin
  invited_by        INT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 表 4: present_access_requests (访问申请表)
-- ====================================================================
CREATE TABLE present_access_requests (
  id                SERIAL PRIMARY KEY,
  presentation_id   INT NOT NULL REFERENCES present_presentations(id) ON DELETE CASCADE,
  user_id           INT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending/approved/rejected
  request_message   TEXT,
  admin_response    TEXT,
  reviewed_by       INT REFERENCES botool_users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  is_deleted        BOOLEAN DEFAULT FALSE,

  CONSTRAINT status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  -- 同一用户对同一文档只能有一条 pending 申请
  CONSTRAINT uq_pending_request UNIQUE NULLS NOT DISTINCT (presentation_id, user_id, status)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_access_requests_presentation ON present_access_requests(presentation_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_access_requests_user ON present_access_requests(user_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_access_requests_pending ON present_access_requests(presentation_id, status) WHERE status = 'pending' AND is_deleted = FALSE;

ALTER TABLE present_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE present_access_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY "access_requests_select_own" ON present_access_requests
  FOR SELECT TO authenticated
  USING (user_id = (SELECT id FROM botool_users WHERE auth_user_id = auth.uid() LIMIT 1)
         OR check_present_access(presentation_id, 'admin'));

CREATE POLICY "access_requests_insert" ON present_access_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT id FROM botool_users WHERE auth_user_id = auth.uid() LIMIT 1));

-- API层额外校验: ①无现有权限 ②无pending申请 ③24h冷却期已过
CREATE POLICY "access_requests_update_admin" ON present_access_requests
  FOR UPDATE TO authenticated
  USING (check_present_access(presentation_id, 'admin'));

CREATE POLICY "access_requests_delete_admin" ON present_access_requests
  FOR DELETE TO authenticated
  USING (check_present_access(presentation_id, 'admin'));


-- ====================================================================
-- 表 5: present_visibility_groups (可见性分组表)
-- 将文档可见性限定在特定部门/角色，无需逐人加入 collaborators
-- ====================================================================
CREATE TABLE present_visibility_groups (
  id                SERIAL PRIMARY KEY,
  presentation_id   INT NOT NULL REFERENCES present_presentations(id) ON DELETE CASCADE,
  group_type        VARCHAR(30) NOT NULL,   -- 'dept' | 'role' | 'org'
  group_value       VARCHAR(200) NOT NULL,  -- dept_path前缀 / role名 / org_id
  granted_by        INT REFERENCES botool_users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  is_deleted        BOOLEAN DEFAULT FALSE,

  UNIQUE(presentation_id, group_type, group_value)
);

CREATE INDEX idx_vis_groups_presentation ON present_visibility_groups(presentation_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_vis_groups_value ON present_visibility_groups(group_type, group_value) WHERE is_deleted = FALSE;

ALTER TABLE present_visibility_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE present_visibility_groups FORCE ROW LEVEL SECURITY;

CREATE POLICY "vis_groups_select" ON present_visibility_groups
  FOR SELECT TO authenticated USING (NOT is_deleted);

CREATE POLICY "vis_groups_manage" ON present_visibility_groups
  FOR ALL TO authenticated
  USING (check_present_access(presentation_id, 'admin'))
  WITH CHECK (check_present_access(presentation_id, 'admin'));


-- ====================================================================
-- 表 6: present_version_groups (版本组表)
-- 一个版本组 = 一个大/小版本号，包含多个语言版本
-- is_published 控制前台可见性（版本组级别，非语言版本级别）
-- ====================================================================
CREATE TABLE present_version_groups (
  id                SERIAL PRIMARY KEY,
  presentation_id   INT NOT NULL REFERENCES present_presentations(id),
  version_number    VARCHAR(20) NOT NULL,       -- "1.0", "2.0", "2.1"
  version_type      VARCHAR(10) NOT NULL,       -- major / minor
  sort_key          INT NOT NULL DEFAULT 0,     -- major*1000+minor (1.0→1000, 2.1→2001)
  publish_note      TEXT,

  is_published      BOOLEAN DEFAULT FALSE,      -- 是否发布到前台 (v3.5)
  published_at      TIMESTAMPTZ,
  published_by      INT REFERENCES botool_users(id),

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        INT,

  UNIQUE(presentation_id, version_number)
);


-- ====================================================================
-- 表 7: present_versions (语言版本表)
-- 语言版本状态: 仅 draft / published (已移除 editing 状态)
-- ====================================================================
CREATE TABLE present_versions (
  id                  SERIAL PRIMARY KEY,
  version_group_id    INT NOT NULL REFERENCES present_version_groups(id),
  language_code       VARCHAR(10) NOT NULL,     -- zh, en, de, ja

  status              VARCHAR(20) DEFAULT 'draft',  -- draft / published (仅两态)

  dsl_snapshot_id     INT,
  slide_count         INT,
  file_size           BIGINT,
  pdf_storage_path    VARCHAR(500),
  pptbt_storage_path  VARCHAR(500),

  source_version_id       INT REFERENCES present_versions(id),         -- 翻译/复制来源版本
  source_presentation_id  INT REFERENCES present_presentations(id),    -- 从库选择来源草稿 (v3.4)

  published_at        TIMESTAMPTZ,
  published_by        INT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  created_by          INT,

  CONSTRAINT status_check CHECK (status IN ('draft', 'published')),
  UNIQUE(version_group_id, language_code)
);


-- ====================================================================
-- 表 8: present_categories (分类定义表)
-- 支持 2 级树: parent_id=NULL 为大分类, parent_id=N 为子分类
-- ====================================================================
CREATE TABLE present_categories (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(50) UNIQUE NOT NULL,  -- 英文代码: group, factory
  name            VARCHAR(100) NOT NULL,        -- 中文名称: 集团资料, 工厂介绍
  name_en         VARCHAR(100),                 -- 英文名称（可选）
  description     TEXT,
  parent_id       INT REFERENCES present_categories(id),  -- NULL=大分类, N=子分类
  icon            VARCHAR(50),                  -- Lucide icon: Building2, Factory
  color           VARCHAR(20),                  -- blue, green, orange
  sort_order      INT DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- code 用于英文文件名, name 用于中文显示和中文文件名


-- ====================================================================
-- 表 9: present_category_slots (分类槽位表)
-- 槽位挂在二级分类下，同一二级分类可指派多个文档
-- version_group_id 必须属于同一 presentation_id（触发器保障）
-- ====================================================================
CREATE TABLE present_category_slots (
  id                SERIAL PRIMARY KEY,
  category_id       INT NOT NULL REFERENCES present_categories(id),
  presentation_id   INT REFERENCES present_presentations(id),
  version_group_id  INT REFERENCES present_version_groups(id),
  display_order     INT DEFAULT 0,
  is_active         BOOLEAN DEFAULT TRUE,
  assigned_at       TIMESTAMPTZ,
  assigned_by       INT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(category_id, presentation_id)  -- 同一分类下同一文档只能有一个槽位
);

-- 一致性约束: version_group 必须属于同一 presentation
CREATE OR REPLACE FUNCTION check_slot_version_group_consistency()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.version_group_id IS NOT NULL AND NEW.presentation_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM present_version_groups
      WHERE id = NEW.version_group_id AND presentation_id = NEW.presentation_id
    ) THEN
      RAISE EXCEPTION 'version_group_id % does not belong to presentation_id %',
        NEW.version_group_id, NEW.presentation_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_slot_version_group_consistency
  BEFORE INSERT OR UPDATE ON present_category_slots
  FOR EACH ROW EXECUTE FUNCTION check_slot_version_group_consistency();

-- API 层须同步校验: POST/PATCH /api/categories/[id]/slots 写库前验证
-- version_group.presentation_id === presentation_id，422 若不一致


-- ====================================================================
-- 表 10: present_translations (翻译任务表)
-- source_type 区分入口 A（Editor草稿库翻译）和 入口 B（后台版本组翻译）
-- 入口 A: source_type='presentation', 使用 source/result_presentation_id
-- 入口 B: source_type='version',      使用 source/result_version_id
-- ====================================================================
CREATE TABLE present_translations (
  id                      SERIAL PRIMARY KEY,
  source_type             VARCHAR(20) DEFAULT 'version',  -- 'version'|'presentation' (v3.4)
  source_version_id       INT REFERENCES present_versions(id),          -- 入口B: 源版本 (可空 v3.4)
  result_version_id       INT REFERENCES present_versions(id),          -- 入口B: 目标版本
  source_presentation_id  INT REFERENCES present_presentations(id),     -- 入口A: 源草稿 (v3.4)
  result_presentation_id  INT REFERENCES present_presentations(id),     -- 入口A: 目标草稿 (v3.4)
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
  logs                JSONB DEFAULT '[]',   -- 实时日志数组

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  created_by          INT NOT NULL,
  completed_at        TIMESTAMPTZ,

  CONSTRAINT translations_source_type_check CHECK (source_type IN ('version', 'presentation')),
  -- 入口B: source_type='version' 时，source_version_id 必填，presentation字段必须为空
  CONSTRAINT translations_version_fields CHECK (
    source_type != 'version' OR (
      source_version_id IS NOT NULL
      AND source_presentation_id IS NULL
      AND result_presentation_id IS NULL
    )
  ),
  -- 入口A: source_type='presentation' 时，source_presentation_id 必填，version字段必须为空
  CONSTRAINT translations_presentation_fields CHECK (
    source_type != 'presentation' OR (
      source_presentation_id IS NOT NULL
      AND source_version_id IS NULL
      AND result_version_id IS NULL
    )
  )
);

-- ⚠️ API DTO (zod schema) 须与上述 CHECK 约束保持一致（双重保障）


-- ====================================================================
-- 表 11: present_glossary (术语表主表)
-- 全局术语，独立于文档，仅 zh 源语言时加载
-- ====================================================================
CREATE TABLE present_glossary (
  id              SERIAL PRIMARY KEY,
  source_term     VARCHAR(500) NOT NULL,     -- 中文术语原文
  term_type       VARCHAR(20) NOT NULL DEFAULT 'no_translate',
                                             -- 'no_translate': 不翻译（保留原词）
                                             -- 'translate': 指定翻译词
  category        VARCHAR(100),             -- 分类标签
  description     TEXT,
  created_by      INT,
  updated_by      INT,
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 表 12: present_glossary_translations (术语翻译表)
-- 每条术语对应多语言翻译（en/de/ja）
-- ====================================================================
CREATE TABLE present_glossary_translations (
  id              SERIAL PRIMARY KEY,
  glossary_id     INT NOT NULL REFERENCES present_glossary(id) ON DELETE CASCADE,
  language_code   VARCHAR(10) NOT NULL,      -- en / de / ja
  translated_term VARCHAR(500) NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(glossary_id, language_code)
);
```

### 4.3 SQL 迁移执行顺序（不可跳步）

```
步骤 1: apps/Botool_Present/scripts/001_create_tables.sql
        → 创建 present_presentations, present_collaborators,
          present_visibility_groups, present_access_requests
        → 创建 RLS 策略 (4个), check_present_access 辅助函数
        → 创建 Storage Bucket 'present-files'
        ⚠️ 不可跳步：后续迁移依赖此步的表结构

步骤 2: apps/Botool_Present/scripts/migrations/001_stage2_database_extension.sql
        → 扩展 present_presentations: dsl_json, dsl_storage_path
        → 创建 present_dsl_snapshots, present_comments,
          present_reviews, present_reviewers

步骤 3: apps/Botool_Present/scripts/migrations/002_stage2_rls_policies.sql
        → 为 present_dsl_snapshots, present_comments,
          present_reviews, present_reviewers 启用 RLS
        ⚠️ 不可跳步：无此步这些表无权限控制

步骤 4: apps/Botool_Present/sql/v1.6_version_management_migration.sql
        → 创建 present_version_groups 表
        → ALTER present_presentations 添加 current_version_group_id
        → ALTER present_versions 添加 version_group_id/status/language_code

步骤 5: apps/Botool_Present/sql/create_translations_table.sql
        → 创建 present_translations 翻译任务基础表

步骤 6: 手动创建新增表（使用 §4.2 SQL）
        → CREATE TABLE present_categories (含自引用)
        → CREATE TABLE present_category_slots (含触发器)
        → CREATE TABLE present_glossary
        → CREATE TABLE present_glossary_translations

步骤 7: 表结构增量变更（须在步骤5后执行）
        → ALTER present_presentations: 添加 language_code, translated_from_id (v3.3)
        → ALTER present_translations: 添加 source_type, source_presentation_id,
          result_presentation_id (v3.4); source_version_id 改为可空
        → ALTER present_versions: 添加 source_presentation_id (v3.4)

步骤 8: 验证所有表存在（详见 2.1 验证清单）
        → 编辑器保存功能正常验证
```

### 4.4 ER 图（完整）

```
present_categories
  │ id, code, name, parent_id(自引用), icon, color, sort_order
  │
  │ 1:N
  ▼
present_category_slots ─────────────────▶ present_presentations
  category_id FK                            id, title, slug
  presentation_id FK                        language_code (v3.3)
  version_group_id FK ──────────────┐       translated_from_id (v3.3)
                                    │       is_deleted
                                    │       owner_id
                                    │
                                    │  FK
                                    ▼
                              present_version_groups
                                id, presentation_id FK
                                version_number (1.0/2.0/2.1)
                                version_type (major/minor)
                                sort_key (major*1000+minor)
                                is_published BOOL
                                    │
                                    │ 1:N
                                    ▼
                              present_versions
                                id, version_group_id FK
                                language_code (zh/en/de/ja)
                                status (draft/published)
                                source_version_id FK (自引用)
                                source_presentation_id FK (v3.4)

present_translations
  source_type ('version'|'presentation')
  source_version_id FK → present_versions
  result_version_id FK → present_versions
  source_presentation_id FK → present_presentations (v3.4)
  result_presentation_id FK → present_presentations (v3.4)
  status (pending/processing/completed/failed)
  logs JSONB

present_glossary
  id, source_term, term_type (no_translate/translate)
  │
  │ 1:N
  ▼
present_glossary_translations
  glossary_id FK, language_code, translated_term
  UNIQUE(glossary_id, language_code)
```

---

## 5. UI 设计

### 5.1 页面清单

| 页面 | 路由 | Phase | 说明 | 状态 |
|------|------|-------|------|------|
| 管理后台 | `/admin` | 0/3/6/7 | 3-Tab 骨架（文档库/分类/术语表） | 改造 |
| 文档库 Tab | `/admin#documents` | 3 | 文档 CRUD + 版本管理 | 新建 |
| 分类管理 Tab | `/admin#categories` | 6 | 2级分类树 + 槽位指派 | 新建 |
| 术语表 Tab | `/admin/glossary` | 7 | Excel 式内联编辑 | 新建 |
| 前台文档库 | `/library` | 6 | 2级分类树，用户只读 | 改造 |
| PPT 编辑器 | `/editor/[id]` | 2 | 迁移至 Botool_PPT | 迁移 |
| PPT 演示 | `/present/[id]` | 2 | 迁移至 Botool_PPT | 迁移 |
| 无权访问页 | `/present/[id]` | 3 | 渲染 AccessRequestView | 改造 |

### 5.2 组件接口（关键组件）

```typescript
// PPTDetailCard - 文档详情卡片（用户/管理员双模式）
interface PPTDetailCardProps {
  presentationId: number;
  versionGroupId?: number;    // 默认最新版本组
  mode: 'user' | 'admin';
  colorConfig?: ColorConfig;
  onPublish?: (versionId: number, langCode: string) => void;
  onUnpublish?: (versionId: number, langCode: string) => void;
  onEdit?: (versionId: number) => void;
}
// user 模式: [下载]按钮, 只显示 published 语言
// admin 模式: [发布/取消发布][编辑]按钮, 显示所有语言状态

// CreateVersionDialog - 版本创建弹窗
interface CreateVersionDialogProps {
  presentationId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (versionGroupId: number) => void;
}

// TranslateConfirmDialog - 翻译确认弹窗
interface TranslateConfirmDialogProps {
  sourceLanguage: string;
  targetLanguages: string[];
  glossaryTerms?: GlossaryTerm[];  // 仅 sourceLanguage='zh' 时传入
  open: boolean;
  onConfirm: (params: TranslationParams) => void;
  onCancel: () => void;
}

// DownloadDialog - 下载弹窗
interface DownloadDialogProps {
  presentationId: number;
  availableLanguages: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// CategoryManagementDialog - 分类管理弹窗
interface CategoryManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}
```

### 5.3 /admin 3-Tab 布局

```
┌──────────────────────────────────────────────────────────────────┐
│  PPT库管理  [侧边栏入口, roles: admin_role≥2]                    │
│  /admin                                                          │
│  ┌─────────────┬─────────────────┬─────────────────┐           │
│  │ 📚 文档库    │  📁 分类管理     │  📖 术语表       │           │
│  └─────────────┴─────────────────┴─────────────────┘           │
│                                                                  │
│  Tab 1 (Phase 3):              Tab 2 (Phase 6):                 │
│  ┌──────────────────────┐      ┌──────────────────────────┐    │
│  │ [搜索...] [+ 新增PPT▼]│      │ [+ 新增分类] [管理分类]    │    │
│  ├──────────────────────┤      ├──────────────────────────┤    │
│  │ PPT列表(卡片/表格)    │      │ 左栏: 2级分类树           │    │
│  │ 含版本状态/语言       │      │ 右栏: 选中分类的槽位列表   │    │
│  │ [编辑][分享][删除]    │      │       [指派文档] [回退版本]│    │
│  └──────────────────────┘      └──────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 5.4 关键弹窗布局

```
CategoryManagementDialog (白底 Modal, Phase 6):
┌─────────────────────────────────────────────────────┐
│  管理分类                                      [x]  │
│  ─────────────────────────────────────────────────  │
│  ┌─── 大分类 ──────────────────────────────────┐   │
│  │  🔵 集团资料       [+ 新增子分类] [编辑][删除]│   │
│  │    📘 公司简介     [编辑] [删除] [↑↓排序]   │   │
│  │    📘 年度报告                               │   │
│  │  🟢 工厂介绍                                 │   │
│  │    📗 华东工厂     [编辑] [删除]             │   │
│  └─────────────────────────────────────────────┘   │
│                                  [取消] [保存修改]   │
└─────────────────────────────────────────────────────┘

ShareDialog (Phase 3):
┌─────────────────────────────────────────────────────┐
│  分享文档                                      [x]  │
│  ─────────────────────────────────────────────────  │
│  链接: https://botool.com/present/abc...  [复制]    │
│  ─────────────────────────────────────────────────  │
│  添加协作者: [邮箱/用户名...] [权限 ▼] [+ 邀请]      │
│  ─────────────────────────────────────────────────  │
│  已共享:                                            │
│  张三 (write)  [移除]                               │
│  李四 (read)   [移除]                               │
└─────────────────────────────────────────────────────┘

ImportProgressDialog (SSE, Phase 5):
┌─────────────────────────────────────────────────────┐
│  导入进度                                      [x]  │
│  ─────────────────────────────────────────────────  │
│  [████████████░░░░░░░░] 60%                         │
│  阶段 2/4: 解析幻灯片元素...                         │
│  ─────────────────────────────────────────────────  │
│  ✅ 解析文件结构                                     │
│  ✅ 提取图片资源 (12/20)                             │
│  ▶ 转换幻灯片 DSL (3/8)                             │
│  ○ 上传图片到 Storage                               │
│  ─────────────────────────────────────────────────  │
│                              [取消导入]              │
└─────────────────────────────────────────────────────┘
```

### 5.5 组件清单

| 组件 | 文件路径 | Phase | 状态 |
|------|---------|-------|------|
| ShareDialog | `components/share/ShareDialog.tsx` | 3 | 待开发 |
| AccessRequestView | `components/library/AccessRequestView.tsx` | 3 | 待开发 |
| CreateVersionDialog | `components/admin/CreateVersionDialog.tsx` | 4 | 待开发 |
| ContentSourceSelector | `components/admin/ContentSourceSelector.tsx` | 4 | 待开发 |
| PPTDetailCard | `components/admin/PPTDetailCard.tsx` | 4 | 待开发 |
| LanguageVersionList | `components/admin/LanguageVersionList.tsx` | 4 | 已有/改造 |
| ImportProgressDialog | `components/file/ImportProgressDialog.tsx` | 5 | 待开发 |
| ExportDialog | `components/file/ExportDialog.tsx` | 5 | 待开发 |
| SlotActionBar | `components/admin/SlotActionBar.tsx` | 6 | 待开发 |
| CategoryManagementDialog | `components/admin/CategoryManagementDialog.tsx` | 6 | 待开发 |
| GlossaryTable | `components/admin/GlossaryTable.tsx` | 7 | 待开发 |
| TranslateConfirmDialog | `components/dialogs/TranslateConfirmDialog.tsx` | 7 | 待开发 |
| TranslateProgressDialog | `components/dialogs/TranslateProgressDialog.tsx` | 7 | 待开发 |
| TranslateMenu | `components/editor/TranslateMenu.tsx` | 7 | 待开发 |
| FileNameBuilder | `components/file/FileNameBuilder.tsx` | 8 | 待开发 |
| DownloadDialog | `components/file/DownloadDialog.tsx` | 8 | 待开发 |

---

## 6. 业务规则

### 6.1 版本管理规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-01 | 版本号单调递增 | major.minor 格式，sort_key = major*1000+minor | DT-015/016 |
| BR-02 | 语言版本状态只有 draft/published | 已删除 editing 状态（Phase 0 清理） | DT-001/016 |
| BR-03 | 已发布版本不可直接编辑，需新建版本 | published → 不可修改 DSL | DT-016 |
| BR-04 | 版本回退须用户确认（影响前台可见内容） | 有审计记录，须弹窗确认 | DT-024 |

### 6.2 分类与槽位规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-05 | 槽位绑定到二级分类（子分类），不绑定大分类 | 同一二级分类可有多个槽位 | DT-022/023 |
| BR-06 | 同一分类下同一文档只能有一个槽位 | UNIQUE(category_id, presentation_id) | DT-022 |
| BR-07 | version_group 必须属于同一 presentation | 触发器 + API 层双重保障 | DT-022/023 |
| BR-08 | 删除有槽位的分类须确认弹窗 | 提示影响 N 个已指派文档 | DT-022 |
| BR-09 | 前台仅展示"已指派 + version_group.is_published=TRUE" | 草稿和未发布不可见 | DT-024 |

### 6.3 翻译规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-10 | 术语表仅 zh 源语言时生效 | 非 zh 源自动降级，TranslateConfirmDialog 无术语区域 | DT-026/027 |
| BR-11 | source_type 区分翻译入口 | version=后台翻译，presentation=Editor翻译 | DT-026/029 |
| BR-12 | 术语预处理：占位符替换 → 翻译 → 还原 | 防止 AI 翻译术语 | DT-026 |

### 6.4 导入导出规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-13 | 导入文件大小限制 200MB | 超大文件服务端验证 | DT-020 |
| BR-14 | 文件类型白名单 | .pptbt/.pptx（导入），.pdf/.pptbt（导出） | DT-020 |
| BR-15 | 导入失败须有明确提示 + 可重试 | import_failed 状态 + 错误原因显示 | DT-020/021 |

### 6.5 翻译判断决策树

```
用户点击「翻译」
├── 入口类型？
│   ├── 后台（版本组页面）→ source_type='version'
│   │   └── 创建新语言版本（version_group 下新增 version）
│   └── Editor（Ribbon 翻译 Tab）→ source_type='presentation'
│       └── 创建独立草稿 PPT（带 language_code + translated_from_id）
│
└── 源语言 = zh？
    ├── 是 → 加载术语表 → TranslateConfirmDialog（含术语表预览区域）
    └── 否 → TranslateConfirmDialog（无术语表区域，直接确认目标语言）

确认后 → POST /api/translations（或 /api/presentations/[id]/translate）
       → 状态机: pending → processing → completed/failed
       → SSE 推送进度 → TranslateProgressDialog
       → 完成后: 显示完成提示 + "打开目标语言版" / "留在当前"
```

### 6.6 文件命名规则（下载时）

```
中文文件名: {category.name}-{title}-{version_number}-{language}.{ext}
            例: 集团资料-公司简介-1.0-zh.pdf

英文文件名: {category.code}-{slug}-{version_number}-{language}.{ext}
            例: group-company_intro-1.0-zh.pdf

自定义: 用户下载时输入任意名称
```

---

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3
(代码清理)   (数据库)    (PPT拆分)   (文档库管理)
(前置)       (P0)        (P0)        (P0)
                                       │
                     ┌─────────────────┤
                     │                 │
                     ▼                 ▼
                 Phase 5           Phase 4
                (导入导出)          (版本管理)
                 (P1)              (P1)
                     │                 │
                     │            ┌────┘
                     │            │
                     ▼            ▼
                 Phase 6       Phase 7
                (分类指派)     (多语言翻译)
                 (P1)           (P2)
                                   │
                               Phase 8
                             (下载导出UI)
                                (P2)

依赖规则：
  Phase 0 → 所有后续 Phase（清理旧代码避免混淆）
  Phase 1 → Phase 2/3（数据库就绪才能开发功能）
  Phase 3 → Phase 4/5/6（文档库是其他功能前置）
  Phase 4 → Phase 6/7（版本管理是分类/翻译前置）
  Phase 5 → Phase 8（导出引擎是下载UI前置）
  Phase 5 可与 Phase 4/6 并行
  Phase 7 可与 Phase 8 并行
```

### 7.1 Phase 0: 代码清理与迁移准备（前置）

> **前置**: 无
> **产出**: 清理旧架构遗留代码，3-Tab 管理后台骨架就绪
> **对应设计**: Section 2.2（缺口分析）

- [ ] DT-001: 删除废弃页面与组件
  - 删除 `app/(main)/upload/page.tsx` — 上传功能合并到 [+ 新增 PPT ▼] 下拉菜单
  - 删除 `config/menu-items.ts` 中「上传文档」侧边栏入口
  - 删除 `components/library/CategoryManager.tsx` — 将被数据库驱动版本替代（Phase 6）
  - 删除 `components/admin/TranslateDialog.tsx` → 将被 TranslateConfirmDialog 替代（Phase 7）
  - 删除 `components/admin/TranslationProgress.tsx` → 将被 TranslateProgressDialog 替代（Phase 7）
  - 删除 `components/admin/ManualCreateDialog.tsx` → 将被 CreateVersionDialog 替代（Phase 4）
  - 验收: 无 import 残留（引用已删除文件的 import 语句），`pnpm build` 通过
  - 验收: TypeCheck passes

- [ ] DT-002: 版本状态模型简化 + 废弃字段清理
  - `services/version-status.service.ts` — 移除 `editing` 状态流转逻辑
  - `components/admin/VersionStatusBadge.tsx` — 移除 `editing` 状态渲染
  - `types/version.ts` — 移除 `editing` 相关类型定义
  - 搜索所有 `status: 'editing'` 引用并修复
  - 标记 `presentations.category` 字段为 deprecated（代码中不再读写）
  - 标记 `presentations.status = 'reviewing'` 为 deprecated
  - 修正 `/library` 前台 bug：「全部」标签临时显示空状态（等 Phase 6 槽位系统）
  - 保留 `importing` / `import_failed` 状态（Phase 5 使用）
  - 验收: TypeCheck passes, 现有编辑器功能不受影响

- [ ] DT-003: 管理后台骨架 + 侧边栏重构 + 新增PPT入口整合
  - `/admin` 页面重构为 3-Tab 骨架布局（Tab1/2/3 容器，Phase 3/6/7 各自填充）
  - 现有 VersionGroupCard、LanguageVersionList 等组件移入 Tab1 容器内
  - `config/menu-items.ts` 新增 `{ name: 'PPT库管理', href: '/admin', icon: Shield, roles: ['admin'] }`
  - 删除 `library/page.tsx` 中的 `<AdminButton>` 组件（管理入口已移至侧边栏）
  - `app/(main)/library/page.tsx`: 合并 [+ 新建文档] + [导入] 为 [+ 新增 PPT ▼] 下拉
    - 选项: ✏️ 创建空白 PPT / 📤 上传 .pptbt / 📤 上传 PPTX
  - 验收: `/admin` 可打开并显示 3 个空 Tab，TypeCheck passes
  - [安全] 侧边栏角色过滤 `admin_role >= 2` 验证生效

### 7.2 Phase 1: 数据库初始化 (P0)

> **前置**: Phase 0
> **产出**: 全部 12 张数据库表创建完成，编辑器基础功能可用
> **对应设计**: Section 4.2（SQL 建表语句）, Section 4.3（迁移顺序）
> ⚠️ 以下步骤必须按序执行，不可跳步

- [ ] DT-004: SQL 迁移步骤 1-5（基础表 + 版本管理 + 翻译表基础）
  - 步骤1: 执行 `scripts/001_create_tables.sql`
    - 创建 present_presentations, present_collaborators, present_visibility_groups, present_access_requests
    - 创建 RLS 策略, check_present_access 辅助函数
    - 创建 Storage Bucket 'present-files'
  - 步骤2: 执行 `migrations/001_stage2_database_extension.sql`
  - 步骤3: 执行 `migrations/002_stage2_rls_policies.sql`
    - ⚠️ 不可跳步：无此步则 dsl_snapshots/comments/reviews 无权限控制
  - 步骤4: 执行 `sql/v1.6_version_management_migration.sql`
    - 创建 present_version_groups；ALTER present_presentations, present_versions
  - 步骤5: 执行 `sql/create_translations_table.sql`
    - 创建 present_translations 基础表
  - 验收: 上述表在 Supabase 中均可查询到
  - [安全] 使用参数化查询防止 SQL 注入
  - [安全] 敏感字段加密存储（owner_id 等不暴露到前端响应）
  - [安全] 迁移脚本使用 IF NOT EXISTS 防重复执行

- [ ] DT-005: 新增表创建 + 表结构增量变更 + 验证
  - 步骤6: 使用 §4.2 SQL 创建 4 张新表
    - `present_categories`（含 parent_id 自引用，不递归超过 2 级）
    - `present_category_slots`（含 trg_slot_version_group_consistency 触发器）
    - `present_glossary`
    - `present_glossary_translations`
  - 步骤7: 执行增量 ALTER
    - `present_presentations`: 添加 language_code, translated_from_id
    - `present_translations`: 添加 source_type, source_presentation_id, result_presentation_id; source_version_id 改为可空
    - `present_versions`: 添加 source_presentation_id
  - 步骤8: 验证
    - 查询 12 张表全部存在
    - 编辑器保存功能正常（DSL 保存到数据库）
    - 验证 RLS 策略对匿名用户拒绝访问
  - [安全] 迁移脚本使用 IF NOT EXISTS
  - [安全] 使用参数化查询

### 7.3 Phase 2: Botool_PPT 应用拆分 (P0)

> **前置**: Phase 1
> **产出**: 独立 Botool_PPT 编辑器应用（端口 3009），Present 仅保留管理运营
> **对应设计**: Section 3.6（应用拆分架构）

- [ ] DT-006: 创建 Botool_PPT 应用骨架
  - `apps/Botool_PPT/` 目录，初始化 Next.js 16 项目
  - 配置端口 3009，basePath `/ppt`（staging/production）
  - 配置 pnpm workspace（`pnpm-workspace.yaml` 添加）
  - 配置环境变量（`.env.development`, `.env.staging`, `.env.production`）
  - 配置 Supabase Auth 集成（`lib/supabase/client.ts`, `server.ts`, `middleware.ts`）
  - 配置 ATT 跨端口认证（开发环境）
  - 更新 `@botool/config`（`botool-urls.config.js`）添加 PPT URL 配置
  - 验收: `apps/Botool_PPT` 可独立启动，访问根路径返回 200
  - 验收: TypeCheck passes

- [ ] DT-007: 迁移编辑器组件 + 类型库 + 状态管理
  - 迁移 `components/editor/` 全部组件（~44 个文件）
  - 迁移 `components/renderer/` (~11 个文件)
  - 迁移 `components/file/` 文件管理组件 (~9 个文件)
  - 迁移 `components/table/` 表格编辑器
  - 迁移 `components/review/` 审批流组件
  - 迁移 `components/comments/` 批注组件
  - 迁移类型: `types/dsl.ts`（核心 DSL 类型）
  - 迁移状态: `stores/presentation-store.ts`, `stores/editor-context.tsx`
  - 迁移工具库: `lib/converter/`, `lib/textbox/`, `lib/clipboard/`, `lib/security/`
  - 验收: TypeCheck passes，编辑器组件在 PPT app 内可正确导入

- [ ] DT-008: 迁移编辑器路由 + DSL API
  - 迁移路由: `app/(editor)/editor/[id]/page.tsx` → Botool_PPT
  - 迁移路由: `app/(editor)/layout.tsx` → Botool_PPT
  - 迁移路由: `app/(present)/present/[id]/page.tsx` → Botool_PPT
  - 迁移路由: `app/(present)/present/preview/page.tsx` → Botool_PPT
  - 迁移 API: `app/api/presentations/[id]/dsl/` DSL 读写 API
  - 评估其他 API（审批/评论等）迁移或保留双份
  - 验收: 编辑器页面从 PPT app 可打开，DSL 保存正常
  - [安全] 添加权限检查（仅有 write/admin 权限可保存 DSL）

- [ ] DT-009: 跨应用导航更新 + 基础设施
  - 更新 Present 「编辑」按钮 → 跳转到 `{PPT_URL}/editor/{id}`
  - 更新 Present 「演示」按钮 → 跳转到 `{PPT_URL}/present/{id}`
  - 更新 Present 「新建文档」 → 跳转到 `{PPT_URL}/editor/new`
  - 删除 Present 中已迁移的编辑器相关代码和路由
  - 更新 `start-all-apps.sh` + `stop-all-apps.sh` 包含 Botool_PPT
  - 更新 `docker/compose.yml` 添加 PPT 服务
  - 更新 `nginx/botool.conf` 添加 `/ppt` 路径代理
  - 更新 `pm2/ecosystem.*.js` 添加 PPT 进程
  - 验收: 从 Present 点击跳转能正确打开 PPT app，`pnpm build` 两个 app 均通过

### 7.4 Phase 3: 文档库管理 (P0)

> **前置**: Phase 1, Phase 2
> **产出**: 管理员可在后台完整管理 PPT 文档（CRUD + 分享 + 访问控制）
> **对应设计**: Section 3.1（管理后台布局）, Section 5.3（/admin Tab 1）

- [ ] DT-010: 文档库 CRUD API
  - `GET /api/presentations` — 列表（支持 search/filter/pagination）
  - `POST /api/presentations` — 创建新文档（草稿箱）
  - `GET /api/presentations/[id]` — 读取单个文档
  - `PUT /api/presentations/[id]` — 更新文档基础信息
  - `DELETE /api/presentations/[id]` — 软删除（is_deleted=true）
  - 验收: Postman/集成测试覆盖 200/4xx/5xx 主路径
  - [安全] 使用参数化查询防止 SQL 注入
  - [安全] 错误响应不泄露内部信息
  - [安全] 添加权限检查（仅 admin 可写，owner 可删除自己的）

- [ ] DT-011: 文档库管理页面 + 新增 PPT 功能
  - `/admin` Tab 1 文档库管理页面（列表 + 搜索 + 筛选）
  - 现有 VersionGroupCard/LanguageVersionList 迁移到 Tab 1 容器内
  - [+ 新增 PPT ▼] 下拉菜单: 创建空白 → PPT app, 上传 .pptbt/.pptx 入口（连接 Phase 5）
  - 验收: 管理员可在 Tab 1 看到文档列表，可创建空白文档并跳转编辑器
  - 验收: Verify in browser

- [ ] DT-012: 分享功能 API + ShareDialog + 链接复制
  - `POST /api/presentations/[id]/collaborators` — 邀请协作者
  - `GET /api/presentations/[id]/collaborators` — 查看协作者列表
  - `DELETE /api/presentations/[id]/collaborators/[userId]` — 移除协作者
  - 组件: `components/share/ShareDialog.tsx`（含链接复制、权限级别选择）
  - 验收: 分享弹窗可打开，复制链接功能正常，协作者列表实时更新
  - [安全] CSRF 保护
  - [安全] 添加权限检查（仅 admin/owner 可管理协作者）

- [ ] DT-013: 访问请求 API + AccessRequestView + 审批通知
  - `POST /api/presentations/[id]/access-requests` — 提交访问申请
  - `GET /api/presentations/[id]/access-requests` — 管理员查看申请列表
  - `PATCH /api/presentations/[id]/access-requests/[reqId]` — 审批（approve/reject）
  - 组件: `components/library/AccessRequestView.tsx`（无权限时替换演示页面渲染）
  - Alert 通知: owner 收到申请后系统通知
  - API 层校验: ①申请人无现有权限; ②无 pending 申请; ③24h 冷却期
  - 验收: 无权限用户访问 /present/[id] 看到申请表单
  - [安全] 添加权限检查
  - [安全] 错误响应不泄露内部信息

- [ ] DT-014: Ribbon 审阅 Tab + 状态栏 + 编辑器保存验证
  - Botool_PPT: 在 Ribbon 现有 Tab 中新增「审阅」Tab
  - Ribbon 审阅 Tab: 接入审批流程 + 批注入口（组件来自已迁移的 components/review/ 等）
  - Botool_PPT 状态栏: 新增审批状态摘要 + 分享按钮入口
  - 集成验证: 编辑器 ↔ 文档库保存流程（从 PPT app 保存后，Present admin 列表可见更新）
  - 验收: 编辑后保存，文档库列表显示最新更新时间
  - 验收: Verify in browser, TypeCheck passes

### 7.5 Phase 4: 版本管理 (P1)

> **前置**: Phase 3
> **产出**: 大/小版本创建、语言版本状态管理（draft/published）、选择性发布
> **对应设计**: Section 3.3（版本状态机）, Section 6.1（版本管理规则）

- [ ] DT-015: 版本创建 API + CreateVersionDialog + ContentSourceSelector
  - `POST /api/presentations/[id]/versions` — 创建新版本组
  - `GET /api/version-groups/` — 列出版本组
  - 组件: `components/admin/CreateVersionDialog.tsx`（大版本/小版本选择，版本号预览）
  - 组件: `components/admin/ContentSourceSelector.tsx`（内容来源三选项: 上传/从库选择/Duplicate）
  - 版本号规则: major.minor, sort_key = major*1000+minor（BR-01）
  - 验收: 创建 major/minor 版本号规则正确，无跳号/逆序
  - [安全] 添加权限检查（仅 admin 可创建版本）

- [ ] DT-016: 语言版本状态简化 + 选择性发布 + 批量发布
  - 移除 `editing` 状态，仅保留 draft/published（BR-02, Phase 0 已做代码清理，此处做 API 层）
  - `PATCH /api/versions/[id]/publish` — 单个语言版本发布/取消发布
  - `PATCH /api/version-groups/[id]/publish-all` — 批量发布全部草稿语言版本
  - UI: [🚀 发布全部草稿] 批量发布按钮
  - UI: 单个语言版本 [发布/取消发布] 按钮（已发布版本不可直接编辑，BR-03）
  - 验收: 语言版本 draft/published 流转符合 BR-02/BR-03
  - 验收: Verify in browser, TypeCheck passes

- [ ] DT-017: PPTDetailCard + LanguageVersionList + 版本历史优化
  - 组件: `components/admin/PPTDetailCard.tsx`（Props 接口见 §5.2，双 mode 支持）
  - 改造: `components/admin/LanguageVersionList.tsx`（用户视角 + 管理员视角）
  - 版本历史展示优化（按 sort_key 倒序，标注当前发布版本）
  - 验收: user mode 只显示 published 语言，admin mode 显示所有语言状态
  - 验收: Verify in browser, TypeCheck passes

### 7.6 Phase 5: 文档导入导出 (P1)

> **前置**: Phase 3
> **可与 Phase 4/6 并行**
> **产出**: PDF/.pptbt 导出，.pptbt/PPTX 导入（含 SSE 进度）
> **对应设计**: Section 3.5（导入状态机）, §5.4（ImportProgressDialog）

- [ ] DT-018: .pptbt + PDF 导出导入 converter
  - `lib/converter/dsl-to-pptbt.ts` — DSL → .pptbt 格式（jszip）
  - `lib/converter/pptbt-to-dsl.ts` — .pptbt → DSL 格式（jszip）
  - `lib/converter/dsl-to-pdf.ts` — DSL → PDF（html2canvas + jspdf）
  - 验收: .pptbt 导入导出互通，资源路径可闭环
  - 验收: TypeCheck passes

- [ ] DT-019: PPTX 导入 converter 核心（6 个文件）
  - `lib/converter/pptx-types.ts` — pptxtojson 输出类型定义（见源 PRD E.4.1）
  - `lib/converter/pptx-to-dsl.ts` — 主转换入口 + 元素路由（见源 PRD E.4.2）
  - `lib/converter/pptx-html-cleaner.ts` — HTML 清洗 + TextStyle 提取（见源 PRD E.4.3）
  - `lib/converter/pptx-shape-map.ts` — 形状类型映射表（见源 PRD E.4.4）
  - `lib/converter/pptx-image-upload.ts` — 图片批量上传到 Storage（见源 PRD E.4.5）
  - `lib/converter/pptx-fill-converter.ts` — 填充样式转换（见源 PRD E.4.6）
  - 验收: PPTX 导入验收测试通过（10 个测试文件，覆盖主要元素类型）
  - 验收: .pptx 导入支持核心元素映射，失败场景有明确提示
  - 验收: TypeCheck passes

- [ ] DT-020: Import API 改造 + SSE API + DB 状态值
  - 改造 `app/api/presentations/import/route.ts`（支持 200MB 文件上传，`present_presentations.status='importing'`）
  - 新建 `app/api/presentations/[id]/import-sse/route.ts`（SSE 进度推送，分阶段：解析→转换→上传图片）
  - DB: 确认 `present_presentations.status` 支持 `'importing'` / `'import_failed'` 值（BR-08/13/14）
  - 验收: Postman 测试 200/4xx/5xx 覆盖
  - [安全] 文件类型白名单校验（仅 .pptbt/.pptx）
  - [安全] 文件大小限制（200MB）
  - [安全] 存储路径不可由用户控制

- [ ] DT-021: ImportProgressDialog + ExportDialog + 格式检测 + 入口整合
  - 组件: `components/file/ImportProgressDialog.tsx`（SSE 连接 + 分阶段进度 + 完成/失败状态，见 §5.4）
  - 组件: `components/file/ExportDialog.tsx`（格式选择 .pdf/.pptbt + 范围选择 + 进度展示）
  - PPT 格式检测逻辑: 上传 .ppt 时提示先转换为 .pptx
  - 在 [+ 新增 PPT ▼] 下拉菜单中添加上传 .pptbt/.pptx 入口（连接 DT-020 API）
  - 验收: 导入进度实时显示，失败后有重试入口
  - 验收: Verify in browser

### 7.7 Phase 6: 分类指派 (P1)

> **前置**: Phase 3, Phase 4
> **产出**: 管理员可配置 2 级分类，将文档指派到二级分类槽位
> **对应设计**: Section 6.2（分类规则）, Section 5.3（/admin Tab 2）

- [ ] DT-022: 分类 CRUD API + CategoryManagementDialog
  - `GET /api/categories` — 列出分类树（支持 parent_id 2 级结构）
  - `POST /api/categories` — 创建分类（大分类或子分类）
  - `PUT /api/categories/[id]` — 编辑分类（名称/图标/颜色/排序）
  - `DELETE /api/categories/[id]` — 删除分类（有槽位时须前端弹窗确认 BR-08）
  - 组件: `components/admin/CategoryManagementDialog.tsx`（见 §5.4: 白底 Modal, 2级树, 内联编辑, 颜色分组）
  - 验收: 2 级分类树可通过弹窗完整管理（增删改序）
  - [安全] 添加权限检查（仅 admin 可管理分类）
  - [安全] 使用参数化查询防止 SQL 注入

- [ ] DT-023: /admin Tab 2 + SlotActionBar + 槽位指派
  - `/admin` Tab 2 分类管理页面（左右布局: 左栏 2 级分类树 + 右上角「管理分类」按钮）
  - 组件: `components/admin/SlotActionBar.tsx`（槽位操作: 指派文档/更换版本组）
  - `POST /api/categories/[id]/slots` — 创建槽位（指派文档 + 版本组）
  - `PATCH /api/categories/[id]/slots/[slotId]` — 更新槽位（更换 version_group_id）
  - `DELETE /api/categories/[id]/slots/[slotId]` — 删除槽位
  - 触发器验证: version_group 必须属于同一 presentation（trg_slot_version_group_consistency）
  - 验收: 槽位挂在二级分类下，同一二级分类可指派多个不同文档（BR-05/06/07）
  - 验收: Verify in browser

- [ ] DT-024: 版本回退 + 前台 /library 分类展示
  - 版本回退功能（更换槽位的 version_group_id，须影响确认弹窗 BR-04）
  - 版本回退审计记录（记录旧/新 version_group_id + 操作人）
  - 前台 `/library` 分类展示（2 级分类树，用户只读视角）
  - 前台展示规则: 仅展示「已指派 AND is_published=TRUE」的内容（BR-09）
  - 验收: 分类树、槽位、文档三者关系在前台正确展示
  - 验收: Verify in browser, TypeCheck passes

### 7.8 Phase 7: 多语言翻译 (P2)

> **前置**: Phase 4
> **产出**: AI 翻译完整流程（术语表 + 后台翻译 + Editor 翻译）
> **对应设计**: Section 3.4（翻译状态机）, Section 6.3（翻译规则）, Section 6.5（翻译决策树）

- [ ] DT-025: 术语表 API + 管理页面（Phase 7a）
  - `GET /api/glossary` — 列出术语（支持分类筛选）
  - `POST /api/glossary` — 新增术语
  - `PUT /api/glossary/[id]` — 编辑术语（含 term_type 切换）
  - `DELETE /api/glossary/[id]` — 软删除术语
  - `PUT /api/glossary/[id]/translations/[lang]` — 创建/更新特定语言翻译
  - 页面: `/admin/glossary`（Tab 3 中打开，Excel 式内联编辑，见 §5.3）
  - 组件: `components/admin/GlossaryTable.tsx`（term_type 切换联动: 不翻译↔指定翻译，译文列灰色切换）
  - 验收: 术语表 CRUD 完整可用，类型切换联动正常
  - 验收: Verify in browser, TypeCheck passes

- [ ] DT-026: 后台翻译 API + 翻译状态机（Phase 7b backend）
  - `POST /api/translations` — 创建翻译任务（调用 qwen-max，source_type='version'）
  - 翻译状态机: pending → processing → completed/failed（BR-11，见 Section 3.4）
  - 术语表预处理（仅 zh 源语言 BR-10）: 占位符替换 → 翻译 → 还原
  - 翻译重试逻辑（failed → pending 重新排队）
  - 验收: 翻译任务可创建，状态机流转在 DB 和 API 层一致
  - [安全] API Key 安全存储（环境变量，不可硬编码）
  - [安全] 添加权限检查（仅 admin 可创建翻译任务）

- [ ] DT-027: TranslateConfirmDialog + TranslateProgressDialog + 实时日志（Phase 7b UI）
  - 组件: `components/dialogs/TranslateConfirmDialog.tsx`（见 §5.2 Props 接口，zh源时显示术语表预览区域，非zh源隐藏）
  - 组件: `components/dialogs/TranslateProgressDialog.tsx`（分阶段进度 + 实时日志面板）
  - 实时日志面板（SSE 或 polling `GET /api/translations/[id]/progress`）
  - 验收: TranslateProgressDialog 实时显示 total/completed_slides/texts
  - 验收: Verify in browser, TypeCheck passes

- [ ] DT-028: 语言版本三种创建方式 + 草稿库选择器（Phase 7b 完结）
  - 3 种语言版本创建方式（BR-11，从 CreateVersionDialog 中触发）:
    1. AI 翻译 → 触发 DT-026 翻译 API
    2. 从库选择 → DraftLibrarySelector，选择后记录 source_presentation_id
    3. 空白创建 → 直接创建空白 version
  - 组件: `DraftLibrarySelector`（支持语言标签筛选草稿库 PPT，记录 source_presentation_id）
  - 验收: 3 种方式均可完成语言版本创建，source_presentation_id 正确记录
  - 验收: TypeCheck passes

- [ ] DT-029: Editor 翻译 Tab + TranslateMenu + Editor 翻译 API（Phase 7c）
  - Botool_PPT: 在现有 4 Tab Ribbon 基础上注册第 5 个 `translate` Tab
  - 组件: `components/editor/TranslateMenu.tsx`（复用 TranslateConfirmDialog + TranslateProgressDialog）
  - `POST /api/presentations/[id]/translate` — Editor 翻译 API（source_type='presentation'）
  - 翻译产出: 在草稿库创建独立 Draft PPT（带 language_code + translated_from_id）
  - 翻译完成弹窗: 「打开目标语言版」/ 「留在当前」两个选项
  - 复用 7b 的翻译状态机（共用 present_translations 表，source_type 区分）
  - 验收: 后台翻译与 Editor 翻译共用同一任务表，source_type 区分明确
  - 验收: Verify in browser, TypeCheck passes

### 7.9 Phase 8: 下载导出 UI (P2)

> **前置**: Phase 4, Phase 5
> **可与 Phase 7 并行**
> **产出**: 用户下载体验完善
> **对应设计**: Section 6.6（文件命名规则）, Section 5.4（DownloadDialog）

- [ ] DT-030: FileNameBuilder + DownloadDialog
  - 组件: `components/file/FileNameBuilder.tsx`（3 种命名格式: 中文/英文/自定义，见 §6.6）
  - 组件: `components/file/DownloadDialog.tsx`（语言选择 + 文件名预览 + 确认下载）
  - 文件命名格式（BR-13 命名规则）:
    - 中文: `{category.name}-{title}-{version}-{lang}.pdf`
    - 英文: `{category.code}-{slug}-{version}-{lang}.pdf`
  - 验收: 下载弹窗可按语言与命名规则稳定产出文件
  - 验收: TypeCheck passes

- [ ] DT-031: 集成导出到下载流程 + DoD 验收
  - 集成 Phase 5 PDF 导出引擎（`dsl-to-pdf.ts`）到 DownloadDialog
  - 下载入口整合（/library 前台 + /admin 管理后台）
  - 文件名 vs 5.4/5.5 规则一致性验证
  - 验收: 下载入口与导出引擎联动，无重复实现
  - 验收: 文件名与 §6.6 规则一致，支持审计追溯
  - 验收: Verify in browser, TypeCheck passes

---

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `app/(main)/upload/page.tsx` | 删除 | Phase 0 | DT-001 |
| `components/library/CategoryManager.tsx` | 删除 | Phase 0 | DT-001 |
| `components/admin/TranslateDialog.tsx` | 删除 | Phase 0 | DT-001 |
| `components/admin/ManualCreateDialog.tsx` | 删除 | Phase 0 | DT-001 |
| `services/version-status.service.ts` | 修改 | Phase 0 | DT-002 |
| `types/version.ts` | 修改 | Phase 0 | DT-002 |
| `app/(main)/admin/page.tsx` | 改造 | Phase 0/3 | DT-003 |
| `config/menu-items.ts` | 修改 | Phase 0 | DT-003 |
| `scripts/001_create_tables.sql` | 执行 | Phase 1 | DT-004 |
| `sql/v1.6_version_management_migration.sql` | 执行 | Phase 1 | DT-004 |
| `apps/Botool_PPT/` | 新建 | Phase 2 | DT-006 |
| `app/api/presentations/route.ts` | 新建 | Phase 3 | DT-010 |
| `app/api/presentations/[id]/route.ts` | 新建/改造 | Phase 3 | DT-010 |
| `components/share/ShareDialog.tsx` | 新建 | Phase 3 | DT-012 |
| `components/library/AccessRequestView.tsx` | 新建 | Phase 3 | DT-013 |
| `app/api/presentations/[id]/access-requests/route.ts` | 新建 | Phase 3 | DT-013 |
| `components/admin/CreateVersionDialog.tsx` | 新建 | Phase 4 | DT-015 |
| `components/admin/ContentSourceSelector.tsx` | 新建 | Phase 4 | DT-015 |
| `components/admin/PPTDetailCard.tsx` | 新建 | Phase 4 | DT-017 |
| `components/admin/LanguageVersionList.tsx` | 改造 | Phase 4 | DT-017 |
| `lib/converter/dsl-to-pptbt.ts` | 新建 | Phase 5 | DT-018 |
| `lib/converter/pptbt-to-dsl.ts` | 新建 | Phase 5 | DT-018 |
| `lib/converter/dsl-to-pdf.ts` | 新建 | Phase 5 | DT-018 |
| `lib/converter/pptx-types.ts` | 新建 | Phase 5 | DT-019 |
| `lib/converter/pptx-to-dsl.ts` | 实现(现占位符) | Phase 5 | DT-019 |
| `lib/converter/pptx-html-cleaner.ts` | 新建 | Phase 5 | DT-019 |
| `lib/converter/pptx-shape-map.ts` | 新建 | Phase 5 | DT-019 |
| `lib/converter/pptx-image-upload.ts` | 新建 | Phase 5 | DT-019 |
| `lib/converter/pptx-fill-converter.ts` | 新建 | Phase 5 | DT-019 |
| `app/api/presentations/import/route.ts` | 改造 | Phase 5 | DT-020 |
| `app/api/presentations/[id]/import-sse/route.ts` | 新建 | Phase 5 | DT-020 |
| `components/file/ImportProgressDialog.tsx` | 新建 | Phase 5 | DT-021 |
| `components/file/ExportDialog.tsx` | 新建 | Phase 5 | DT-021 |
| `app/api/categories/route.ts` | 新建 | Phase 6 | DT-022 |
| `app/api/categories/[id]/slots/route.ts` | 新建 | Phase 6 | DT-023 |
| `components/admin/CategoryManagementDialog.tsx` | 新建 | Phase 6 | DT-022 |
| `components/admin/SlotActionBar.tsx` | 新建 | Phase 6 | DT-023 |
| `app/api/glossary/route.ts` | 新建 | Phase 7 | DT-025 |
| `app/api/glossary/[id]/translations/[lang]/route.ts` | 新建 | Phase 7 | DT-025 |
| `components/admin/GlossaryTable.tsx` | 新建 | Phase 7 | DT-025 |
| `app/api/translations/route.ts` | 改造 | Phase 7 | DT-026 |
| `components/dialogs/TranslateConfirmDialog.tsx` | 新建 | Phase 7 | DT-027 |
| `components/dialogs/TranslateProgressDialog.tsx` | 新建 | Phase 7 | DT-027 |
| `app/api/presentations/[id]/translate/route.ts` | 新建 | Phase 7 | DT-029 |
| `components/editor/TranslateMenu.tsx` | 新建 | Phase 7 | DT-029 |
| `components/file/FileNameBuilder.tsx` | 新建 | Phase 8 | DT-030 |
| `components/file/DownloadDialog.tsx` | 新建 | Phase 8 | DT-030 |

### B. 类型定义文件索引

| 文件 | 状态 | Phase |
|------|------|-------|
| `types/dsl.ts` | ✅ 已有（迁移至 PPT app） | Phase 2 |
| `types/version.ts` | ✅ 已有（修改删除 editing） | Phase 0 |
| `types/translation.ts` | ✅ 已有 | - |
| `types/glossary.ts` | 待开发 | Phase 7 |
| `lib/converter/pptx-types.ts` | 待开发 | Phase 5 |

### C. 服务层文件索引

| 文件 | 状态 | Phase |
|------|------|-------|
| `services/version-group.service.ts` | ✅ 已有 | - |
| `services/version-status.service.ts` | ✅ 已有（修改） | Phase 0 |
| `services/translation.service.ts` | ✅ 已有（扩展） | Phase 7 |
| `services/dsl-translation.service.ts` | ✅ 已有 | - |
| `services/version-creation.service.ts` | 待开发 | Phase 4 |
| `services/glossary.service.ts` | 待开发 | Phase 7 |

### D. 风险与缓解措施

#### HIGH

- **Phase 2 (PPT 应用拆分)**: 跨应用运行维护复杂度高（认证共享、URL 跳转、本地开发多端口、nginx 配置）
  - **缓解**: 参考 @botool/config 已有多 app URL 管理模式，先完成骨架再迁移内容

- **Phase 1 (SQL 迁移顺序)**: 8 步迁移顺序不可跳步，任一步出错需回滚
  - **缓解**: 每个 SQL 脚本使用 IF NOT EXISTS，在 dev/staging 先验证后再 production 执行

#### MEDIUM

- **Phase 5 (PPTX 导入元素映射)**: pptxtojson 输出格式与 DSL 差异大，形状/图片/文本样式映射复杂
  - **缓解**: 从 E.4.4 形状映射表开始，分批实现，10 个测试文件验证

- **Phase 7 (AI 翻译状态机)**: pending→processing→completed/failed 需前后端一致，SSE 连接稳定性
  - **缓解**: 状态机逻辑集中在 services/translation.service.ts，进度轮询作为 SSE 的降级方案

#### LOW

- **Phase 8 (下载 UI)**: 依赖 Phase 5 PDF 导出引擎，导出引擎性能在大文档场景下未知
  - **缓解**: 导出前显示进度，超时有 fallback 提示

### E. 安全检查项（自动注入）

以下 DT 已注入安全验收标准：

| DT | 触发类别 | 注入条目 |
|----|---------|---------|
| DT-004/005 | 数据库/SQL迁移 | SQL 参数化查询, IF NOT EXISTS, 敏感字段 |
| DT-008 | API/接口 | 权限检查, SQL 注入防护 |
| DT-010 | API/接口 + 数据库 | SQL 注入, 权限, 错误不泄露信息 |
| DT-012 | API/接口 | CSRF 保护, 权限检查 |
| DT-020 | 文件上传 | 文件类型白名单, 大小限制(200MB), 路径控制 |
| DT-026 | API + 认证 | API Key 安全存储(env var), 权限检查 |

### F. 测试策略

#### 数据库层（Phase 1 验收）
- 12 张表全部存在（含 RLS 策略）
- 匿名访问被 RLS 拒绝
- 触发器 `trg_slot_version_group_consistency` 约束生效

#### 集成测试（Phase 3/4/7）
- CRUD API 覆盖 200/400/401/403/404/422/500
- 翻译任务状态机完整流转（mock qwen-max API）
- SSE 连接正常推送进度

#### E2E 测试（Phase 2/3/5）
- Botool_Present → 跨应用跳转 → Botool_PPT 编辑器正常打开
- 完整用户流程: 创建文档 → 指派分类 → 发布 → 前台可见
- PPTX 导入验收：10 个测试文件，核心元素映射验证

#### 构建验证（所有 Phase）
- `pnpm build` 两个 app 均无编译错误
- `npx tsc --noEmit` TypeCheck passes

### G. 非目标（Out of Scope）

- **PNG 批量导出**: P2 后续迭代（Phase 8 DoD 内只有 PDF 导出）
- **评论/批注功能扩展**: 组件已有（Stage 2），本 PRD 不做新功能
- **对外部用户的访问控制**: 当前仅企业内部员工，无匿名/外部用户场景
- **多租户**: 单一企业内部使用，无多租户需求
- **移动端 App**: Web 端优先，不涉及 React Native
- **实时协同编辑**: 无 CRDT/OT 协同，仅单人编辑
- **版本 Diff 对比**: 超出 v1.6 范围

### H. 可执行迁移顺序（9.9 参考）

**Step 1: SQL 迁移（先结构，后策略）**
1. Stage1 + Stage2 基础脚本（DT-004 步骤1-3）
2. 版本管理脚本（DT-004 步骤4）
3. 翻译基础表脚本（DT-004 步骤5）
4. 新建分类/槽位/术语表（DT-005 步骤6）
5. v3.3/v3.4 增量 ALTER（DT-005 步骤7）
6. 为新增表补齐 RLS 策略并验证（DT-005 步骤8）

**Step 2: API 改造（按依赖顺序）**
1. `POST /api/presentations`、`PUT /api/presentations/[id]/dsl`（基础保存链路）
2. `/api/presentations/[id]/collaborators`、`/access-requests/*`（分享与审批前置）
3. `/api/presentations/[id]/versions`、`/api/version-groups/*`（版本管理）
4. `/api/presentations/import` + `/import-sse`（导入链路）
5. `/api/translations` + `/api/translations/[id]/progress`（后台翻译）
6. `/api/presentations/[id]/translate`（Editor 翻译，复用翻译服务层）

**Step 3: 联调检查点**
- Checkpoint A（SQL 完成）: 12 表验证 SQL 全通过
- Checkpoint B（API 完成）: 测试覆盖 200/4xx/5xx 主路径
- Checkpoint C（UI 完成）: 完整流程闭环（文档库 → 分类指派 → 翻译 → 前台展示）
