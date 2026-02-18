# PRD: Viewer PRD 导入功能

## 1. 项目概述

为 BotoolAgent Viewer 的 Dashboard 添加「导入」入口，让用户可以选择项目根目录中已有的 `.md` 文件，自动进入 Stage 1 Transform 模式进行 PRD 规范化。

当前 CLI 已通过 `/botoolagent-pyramidprd [模式:导入]` 支持导入现有文档；但 Viewer 界面仅支持从零新建 PRD。本次改动补齐这个缺口。

同时清理 Dashboard 空状态中多余的 action 按钮（PRD 区域的「创建需求文档」和任务历史的「创建新任务」），统一入口为右上角的「导入」和「+ 新建」。

技术栈：Next.js App Router + TypeScript + Tailwind CSS

## 7. 开发计划

### 7.1 Phase 1: API + 组件 + 集成 (P0)

> **前置**: 无
> **产出**: Dashboard 可导入已有 .md 文件，进入 Stage 1 Transform 模式

- [ ] DT-001: 新建 GET /api/files/md 端点 (`文件: viewer/src/app/api/files/md/route.ts`)
  - [ ] 使用 getProjectRoot() 获取项目根路径
  - [ ] 递归扫描 .md 文件，排除 node_modules/.git/.next/dist/build/.turbo/.state/archive/.cache/coverage/__pycache__
  - [ ] 扫描深度不超过 4 层
  - [ ] 返回 { files: [{ path, name, directory, preview, size, modifiedAt }] }
  - [ ] tasks/ 目录文件优先排序，其余按修改时间倒序
  - [ ] 每文件预览为前 5 行非空内容
  - [ ] Typecheck passes

- [ ] DT-002: 新建 ImportPrdDialog 组件 (`组件: <ImportPrdDialog>`, `文件: viewer/src/components/ImportPrdDialog.tsx`, `viewer/src/components/index.ts`)
  - [ ] fetch /api/files/md 获取文件列表
  - [ ] 按目录分组显示，搜索过滤
  - [ ] 选中文件显示预览（前 5 行）
  - [ ] 确认后 createSession + createProject
  - [ ] 导航到 /stage1?session=xxx&mode=transform&file=相对路径
  - [ ] 对话框白色背景，violet 主题色（与 Transform 模式一致）
  - [ ] 在 components/index.ts 中导出
  - [ ] Typecheck passes

- [ ] DT-003: Dashboard 集成 + 空状态清理 + Stage1 URL 参数 (`文件: viewer/src/app/page.tsx`, `viewer/src/components/TaskHistory.tsx`, `viewer/src/app/stage1/page.tsx`)
  - [ ] page.tsx: PRD 区域 header 添加「导入」按钮（在「+ 新建」左侧）
  - [ ] page.tsx: PRD 空状态删除黑色 action 按钮，只保留说明文字
  - [ ] page.tsx: 引入 ImportPrdDialog 并渲染
  - [ ] TaskHistory.tsx: 删除空状态中的「创建新任务」Link
  - [ ] stage1/page.tsx: 读取 URL 中 mode 和 file 参数
  - [ ] stage1/page.tsx: 当 mode=transform & file 存在时，自动设 selectedMode + transformFilePath + initialDescription，跳过模式选择器和文件路径手动输入
  - [ ] Typecheck passes
  - [ ] Verify in browser
