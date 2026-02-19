# AGENTS.md — BotoolAgent 统一审查规范

本文件供所有 AI 代理（Claude、Codex 等）在审查和开发时参考。

## 1. 项目概要

BotoolAgent 是一个自主 AI 开发代理系统，包含：
- **viewer/** — Next.js 14 Web 界面（TypeScript + Tailwind v4 + shadcn/ui）
- **skills/** — Claude Code Skill 集合（Markdown 指令文件）
- **scripts/** — Shell 工具脚本（BotoolAgent.sh 外循环、pack.sh 打包）
- **rules/** — 项目规范文件（后端、前端、测试等）

## 2. 构建命令

```bash
# TypeScript 类型检查（必须在 viewer/ 目录下运行）
cd viewer && npx tsc --noEmit

# 开发服务器
cd viewer && npm run dev    # 端口 3100

# 生产构建
cd viewer && npm run build

# Lint
cd viewer && npm run lint
```

## 3. 架构约定

### 3.1 文件组织

| 类型 | 位置 | 命名 |
|------|------|------|
| 页面 | `viewer/src/app/{route}/page.tsx` | 小写路由名 |
| API 路由 | `viewer/src/app/api/{feature}/route.ts` | RESTful 命名 |
| 组件 | `viewer/src/components/{Name}.tsx` | PascalCase |
| Hook | `viewer/src/hooks/use{Name}.ts` | camelCase, `use` 前缀 |
| 工具函数 | `viewer/src/lib/{name}.ts` | camelCase |
| UI 基础 | `viewer/src/components/ui/{name}.tsx` | shadcn 组件，不要手动修改 |

### 3.2 API 路由规范

- handler 用 `try/catch` 包裹，catch 中 `console.error`
- 响应使用 `NextResponse.json` 格式
- 错误返回 `{ error: string }` + 对应 HTTP 状态码
- 使用 `@/lib/project-root` 获取项目绝对路径

### 3.3 状态与数据流

- 项目数据存储在 `tasks/{projectId}/` 目录
- agent-status、prd.json、progress.txt 均为文件系统 JSON/文本
- API 端点通过 `projectId` 查询参数定位项目数据

## 4. 代码风格

### 4.1 TypeScript

- 严格模式（`strict: true`）
- 组件 Props 接口使用 `{ComponentName}Props` 格式
- 布尔变量使用 `is/has/should` 前缀
- 禁止 `any` 类型，使用 `unknown` 或具体类型

### 4.2 React / Next.js

- 函数组件 + hooks，不使用 class 组件
- 使用 shadcn/ui 组件（button, dialog, badge, tabs 等），不手写 modal/dialog
- Dialog 背景必须为白色 `bg-white`，禁止透明
- 按钮使用黑底白字 `bg-neutral-900`，禁止彩色按钮
- 状态色（success/warning/error）仅用于 badge/圆点指示器
- 使用 `cn()` from `@/lib/utils` 合并类名
- 图标统一使用 `lucide-react`

### 4.3 Tailwind CSS

- 使用语义化 CSS 变量：`bg-background`、`text-foreground`、`border-border`
- 圆角使用 `rounded-lg`（映射到 `--radius`）
- 禁止硬编码颜色值，使用设计系统变量

## 5. 安全红线

以下问题在审查中必须标记为 **HIGH severity**：

1. **SQL 注入** — 禁止字符串拼接 SQL，必须使用参数化查询
2. **命令注入** — 禁止将用户输入直接传入 `exec()` / `spawn()`
3. **XSS** — 禁止 `dangerouslySetInnerHTML`，除非内容已过 sanitizer
4. **硬编码密钥** — 禁止在代码中写入 API key、token、password
5. **路径穿越** — 文件路径操作必须验证不越界
6. **未认证端点** — 涉及数据修改的 API 端点应有合适的权限检查
7. **敏感信息泄露** — 错误响应不应暴露内部实现细节

## 6. Codex 审查规范

本章节专门为 Codex 红队对抗审查提供指引。

### 6.1 审查范围

当以红队角色审查代码时，请关注：

1. **安全漏洞** — OWASP Top 10，特别是注入类漏洞
2. **逻辑 bug** — 边界条件、off-by-one、null/undefined 处理
3. **缺失错误处理** — 未捕获的异常、缺少 fallback
4. **测试覆盖缺口** — 关键路径未被测试覆盖
5. **代码风格** — 违反本文档第 4 节的风格规范

### 6.2 输出格式

审查结果应以结构化 JSON 格式输出（类 ESLint 格式）：

```json
{
  "findings": [
    {
      "severity": "HIGH",
      "category": "security",
      "rule": "owasp-injection",
      "file": "src/app/api/example/route.ts",
      "line": 42,
      "message": "问题描述",
      "suggestion": "修复建议"
    }
  ]
}
```

### 6.3 严重度分级

| 级别 | 标准 | 处理方式 |
|------|------|---------|
| HIGH | 安全漏洞、数据丢失风险、崩溃 bug | 必须修复 |
| MEDIUM | 逻辑错误、缺失错误处理、性能问题 | 应该修复 |
| LOW | 风格问题、命名不规范、建议优化 | 记录为 advisory |

### 6.4 审查原则

- 审查应客观、可验证，避免主观偏好
- 每条 finding 必须包含具体的文件路径和行号
- 建议必须可操作（给出修复方案，而非只指出问题）
- 允许开发者以书面论证拒绝修复，拒绝理由需合理

## 7. 数据库操作

- **禁止** `npx prisma db push`（所有数据库变更使用 SQL 脚本）
- **禁止** `--force-reset`（会删除所有数据）
- 所有 schema 变更必须编写迁移 SQL
