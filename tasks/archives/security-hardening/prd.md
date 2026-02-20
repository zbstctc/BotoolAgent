# PRD: BotoolAgent Viewer 安全加固

## 1. 项目概述

BotoolAgent Viewer 经 Codex 红队审查发现 17 条安全/可靠性/风格问题（10 HIGH、5 MEDIUM、2 LOW）。本项目以"基础设施先行"策略修复其中 16 条 findings（排除 #15 测试覆盖，属于独立项目）。核心思路：先建共享安全工具库（路径容器校验 + CSRF 防护 + Git 引用校验），再批量应用到受影响的 12+ 个 API 路由和组件，最后修复可靠性和风格问题。

**威胁模型**: BotoolAgent 是本地开发工具（localhost:3100）。主要威胁是外部恶意网站通过 CSRF/DNS-rebinding 调用本地 API。防护策略是多层 CSRF 检查（Origin/Referer/Sec-Fetch-Site），优先覆盖高风险状态变更端点（进程启动/终止、文件删除、Git 操作、规则写入）。低风险端点（PRD 保存、注册表更新等）的 CSRF 防护在 Section 8.F 中记录了风险接受理由，建议后续迭代加固。

## 3. 架构设计（概要）

```
───────── 安全加固架构 ─────────

   共享安全工具库 (viewer/src/lib/)
      │
      ├── project-root.ts (扩展)
      │    ├─ normalizeProjectId()   [已有，不改动]
      │    ├─ ensureContainedPath()  [NEW — 路径容器校验]
      │    └─ isSafeGitRef()        [从 git/merge 提取]
      │
      └── api-guard.ts (NEW)
           └─ verifyCsrfProtection() [NEW — 多层 CSRF 防护]
      │
      ▼ (被所有状态变更 API 路由引用)

   ┌────────────────┬──────────────────┬──────────────────┐
   │ 路径穿越修复   │ CSRF+注入修复      │ 可靠性+风格修复   │
   ├────────────────┼──────────────────┼──────────────────┤
   │ rules/         │ agent/start       │ test/run          │
   │ rules/[id]     │ git/merge         │ prd/update        │
   │ prd/[id]       │ claude-processes  │ useAgentStatus    │
   │ sessions/[id]  │ requirements      │ watch             │
   │ rules-to-skill │ rules/ (POST)     │ cli/chat          │
   │                │ sessions/ (DEL)   │ stage3/page       │
   │                │ prd/update (POST) │                   │
   │                │ MarkdownEditor    │                   │
   └────────────────┴──────────────────┴──────────────────┘
```

### 3.1 ensureContainedPath() 设计

```typescript
/**
 * Resolve a user-supplied path segment and verify it stays within baseDir.
 * Uses realpath (following symlinks) for robust containment check.
 * Throws if the resolved path escapes baseDir.
 *
 * Handles non-existent target paths by validating the nearest existing ancestor.
 */
export function ensureContainedPath(baseDir: string, ...segments: string[]): string {
  const resolved = path.resolve(baseDir, ...segments);

  // Ensure baseDir exists
  const realBase = fs.realpathSync(baseDir);

  // If target exists, validate directly
  if (fs.existsSync(resolved)) {
    const real = fs.realpathSync(resolved);
    if (!real.startsWith(realBase + path.sep) && real !== realBase) {
      throw new Error(`Path escapes base directory: ${resolved}`);
    }
    return real;
  }

  // Target doesn't exist: walk up to nearest existing ancestor and validate
  let ancestor = path.dirname(resolved);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break; // filesystem root
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  if (!realAncestor.startsWith(realBase + path.sep) && realAncestor !== realBase) {
    throw new Error(`Path escapes base directory: ${resolved}`);
  }

  // Return the resolved (not real) path since target doesn't exist yet
  return resolved;
}
```

### 3.2 verifyCsrfProtection() 设计

```typescript
/**
 * Multi-layer CSRF protection for state-changing API endpoints.
 *
 * Layer 1: If Origin header present → validate hostname + port against whitelist
 * Layer 2: If Referer header present → validate hostname + port against whitelist
 * Layer 3: If Sec-Fetch-Site header present → reject 'cross-site'
 * Fallback: No browser headers at all → allow (non-browser client: curl, IDE, etc.)
 *
 * This is CSRF protection, NOT authentication.
 * Threat model: external websites triggering requests to localhost.
 * Non-browser tools (curl, Postman) are legitimate local users.
 *
 * Returns null if valid, or a NextResponse 403 if invalid.
 */
export function verifyCsrfProtection(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const secFetchSite = request.headers.get('sec-fetch-site');
  const allowedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];
  const allowedPorts = ['3100', '3000']; // 3100=viewer, 3000=dev fallback; 不信任默认端口

  // Layer 1: Origin header check (most reliable for cross-origin requests)
  if (origin) {
    try {
      const url = new URL(origin);
      if (allowedHosts.includes(url.hostname) &&
          allowedPorts.includes(url.port)) {
        return null; // trusted origin
      }
    } catch { /* invalid URL */ }
    return NextResponse.json(
      { error: 'Forbidden: untrusted origin' },
      { status: 403 }
    );
  }

  // Layer 2: Referer header check (fallback for requests without Origin)
  if (referer) {
    try {
      const url = new URL(referer);
      if (allowedHosts.includes(url.hostname) &&
          allowedPorts.includes(url.port)) {
        return null; // trusted referer
      }
    } catch { /* invalid URL */ }
    return NextResponse.json(
      { error: 'Forbidden: untrusted referer' },
      { status: 403 }
    );
  }

  // Layer 3: Sec-Fetch-Site check (modern browsers send this automatically)
  if (secFetchSite === 'cross-site') {
    return NextResponse.json(
      { error: 'Forbidden: cross-site request' },
      { status: 403 }
    );
  }

  // No Origin, no Referer, no cross-site Sec-Fetch-Site → non-browser client
  // curl, Postman, IDE integrations, etc. are legitimate local users
  return null;
}
```

### 3.3 isSafeGitRef() 设计

```typescript
/**
 * Validate a git reference (branch name, tag, etc.) is safe.
 * Enforces git check-ref-format rules plus additional safety:
 * - Only allows [a-zA-Z0-9._/-] characters
 * - Rejects '..' sequences (path traversal)
 * - Rejects leading '-' (could be interpreted as CLI flag)
 * - Rejects '@{' sequences (git reflog syntax)
 * - Rejects '.lock' suffix (git reserved)
 * - Rejects leading/trailing '.' or '/' per segment
 */
export function isSafeGitRef(ref: string): boolean {
  if (!ref || ref.length > 255) return false;
  if (!/^[a-zA-Z0-9._\/-]+$/.test(ref)) return false;
  if (ref.includes('..')) return false;
  if (ref.startsWith('-')) return false;
  if (ref.includes('@{')) return false;
  if (ref.endsWith('.lock')) return false;
  if (ref.startsWith('/') || ref.endsWith('/')) return false;
  if (ref.includes('//')) return false;

  // Per-segment validation: each path segment between '/' separators
  const segments = ref.split('/');
  for (const seg of segments) {
    if (!seg) return false; // empty segment (caught by // check, but defensive)
    if (seg.startsWith('.') || seg.endsWith('.')) return false;
    if (seg.endsWith('.lock')) return false;
  }

  return true;
}
```

## 5. UI 设计（概要）

| 组件 | Props | 状态 |
|------|-------|------|
| MarkdownEditor | `{ content, onChange, onSave, isSaving?, ... }` | 修改 — 添加 DOMPurify sanitize |
| stage3/page Stop Button | N/A (内联样式) | 修改 — 红色改为 shadcn Button 或黑底白字 |

### 5.1 错误状态处理

新增的 400/403 拒绝路径会在前端产生错误响应。所有受影响的 API 调用点已有统一的错误处理（`response.ok` 检查 + error toast），约定如下：

| HTTP 状态码 | 错误消息模板 | 前端处理 |
|------------|-------------|---------|
| 400 | `{ error: "Invalid [param]: [detail]" }` | 显示 error toast，用户可修正输入后重试 |
| 403 | `{ error: "Forbidden: [reason]" }` | 显示 error toast，提示用户通过 Viewer UI 操作 |

**验收要求**: 前端现有的 fetch error handling 必须正确显示这些新增的 400/403 错误消息，不能静默吞掉。

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2
安全工具      安全修复
(P0)         (P0)

Phase 3 可与 Phase 2 并行
可靠性+风格
(P1)

依赖关系:
Phase 1 是 Phase 2 的前置（Phase 2 引用工具库）
Phase 3 大部分独立，但 DT-011 依赖 Phase 1（使用 verifyCsrfProtection）
```

### 7.1 Phase 1: 共享安全工具库 (P0)

> **前置**: 无
> **产出**: 路径容器校验、CSRF 防护、Git 引用校验三个共享工具函数
> **对应设计**: Section 3.1, 3.2, 3.3

- [ ] DT-001: 在 project-root.ts 中添加 `ensureContainedPath()` 函数 (`文件: viewer/src/lib/project-root.ts`)
  - 实现 resolve + realpathSync 容器校验逻辑
  - 目标路径存在时：直接 realpath 校验
  - 目标路径不存在时：向上查找最近的已存在祖先目录，校验其 realpath 归属
  - 基础目录不存在时抛出错误
  - 验收标准:
    - [ ] `ensureContainedPath('/a/b', 'c')` 且 `/a/b/c` 存在 → 返回 realpath
    - [ ] `ensureContainedPath('/a/b', 'newfile')` 且 `newfile` 不存在 → 校验 `/a/b` 归属，返回 resolved path
    - [ ] `ensureContainedPath('/a/b', '../c')` → 抛出 Error
    - [ ] `ensureContainedPath('/a/b', 'x/../../../c')` → 抛出 Error
    - [ ] 含 symlink 指向外部目录的路径 → 抛出 Error
    - [ ] [安全] 路径不可由用户控制 — symlink 被 realpath 解析
    - [ ] Typecheck passes

- [ ] DT-002: 新建 `lib/api-guard.ts`，实现 `verifyCsrfProtection()` 函数 (`文件: viewer/src/lib/api-guard.ts`)
  - 三层 CSRF 检查：Origin → Referer → Sec-Fetch-Site
  - Origin/Referer 校验包含 hostname + port 白名单
  - Sec-Fetch-Site: 'cross-site' 直接拒绝
  - 无任何浏览器头（非浏览器客户端）→ 放行
  - 验收标准:
    - [ ] Origin: `http://localhost:3100` → 放行 (null)
    - [ ] Origin: `http://[::1]:3100` → 放行（IPv6 loopback）
    - [ ] Origin: `http://evil.com` → 403 `{ error: "Forbidden: untrusted origin" }`
    - [ ] Origin: `http://localhost:9999`（非白名单端口）→ 403
    - [ ] 无 Origin，Referer: `http://localhost:3100/rules` → 放行
    - [ ] 无 Origin，Referer: `http://evil.com/page` → 403
    - [ ] 无 Origin，无 Referer，Sec-Fetch-Site: `cross-site` → 403
    - [ ] 无 Origin，无 Referer，Sec-Fetch-Site: `same-origin` → 放行
    - [ ] 无 Origin，无 Referer，无 Sec-Fetch-Site → 放行（非浏览器）
    - [ ] [安全] 多层 CSRF 防护校验通过
    - [ ] Typecheck passes

- [ ] DT-003: 从 `git/merge/route.ts` 提取 `isSafeGitRef()` 到 `project-root.ts` (`文件: viewer/src/lib/project-root.ts`, `修改: viewer/src/app/api/git/merge/route.ts`)
  - 在 project-root.ts 中导出 `isSafeGitRef(ref: string): boolean`
  - 只允许 `[a-zA-Z0-9._/-]`，禁止 `..`
  - 拒绝前导 `-`（防止被解释为 CLI flag）
  - 拒绝 `@{` 序列（git reflog 语法）
  - 拒绝 `.lock` 后缀（git 保留）
  - 拒绝前导/尾随 `.` 和 `/`，拒绝 `//`
  - 长度限制 255 字符
  - 修改 git/merge/route.ts 改为从 project-root 导入
  - 验收标准:
    - [ ] `isSafeGitRef('main')` → true
    - [ ] `isSafeGitRef('feat/foo-bar')` → true
    - [ ] `isSafeGitRef('v1.0.0')` → true
    - [ ] `isSafeGitRef('$(rm -rf /)')` → false
    - [ ] `isSafeGitRef('a..b')` → false
    - [ ] `isSafeGitRef('-flag')` → false
    - [ ] `isSafeGitRef('ref@{1}')` → false
    - [ ] `isSafeGitRef('branch.lock')` → false
    - [ ] `isSafeGitRef('.hidden')` → false
    - [ ] `isSafeGitRef('a//b')` → false
    - [ ] `isSafeGitRef('foo/.bar')` → false（段级 leading dot）
    - [ ] `isSafeGitRef('foo.lock/bar')` → false（段级 .lock 后缀）
    - [ ] git/merge/route.ts 改为 `import { isSafeGitRef } from '@/lib/project-root'`
    - [ ] Typecheck passes

### 7.2 Phase 2: HIGH 安全漏洞修复 (P0)

> **前置**: Phase 1
> **产出**: 消除所有 10 个 HIGH 级安全漏洞
> **对应设计**: Section 3, 审查报告 #1-#10

- [ ] DT-004: 修复 rules API 路径穿越 — finding #3, #4 (`文件: viewer/src/app/api/rules/route.ts`, `viewer/src/app/api/rules/[id]/route.ts`)
  - `rules/route.ts`: 对 `category` 参数做白名单校验，只允许 `['frontend', 'backend', 'testing', 'deployment', 'application', 'other']`
  - `rules/route.ts`: 对最终文件路径使用 `ensureContainedPath(RULES_DIR, ...)` 校验
  - `rules/[id]/route.ts`: 对 `decodedId` 拆分出的 category/name 做同样白名单校验
  - 使用 `ensureContainedPath(RULES_DIR, ...)` 确认最终路径归属
  - `rules/route.ts` POST 和 DELETE handler 开头均添加 `verifyCsrfProtection(request)` CSRF 检查
  - 验收标准:
    - [ ] category='../etc' → 400 `{ error: "Invalid category: ../etc" }`
    - [ ] category='frontend', name='test' → 正常读写
    - [ ] [安全] 存储路径不可由用户控制
    - [ ] [安全] POST 请求受 CSRF 保护（localhost 放行，evil.com 403）
    - [ ] [安全] DELETE 请求受 CSRF 保护（localhost 放行，evil.com 403）
    - [ ] Typecheck passes

- [ ] DT-005: 修复 prd/[id] 和 sessions/[id] 路径穿越 — finding #6, #2 (`文件: viewer/src/app/api/prd/[id]/route.ts`, `viewer/src/app/api/sessions/[id]/route.ts`)
  - `prd/[id]/route.ts`: 使用 `normalizeProjectId(id)` 校验 id，无效返回 400
  - `sessions/[id]/route.ts`: 使用 `normalizeProjectId(id)` 校验 id，无效返回 400
  - `sessions/[id]/route.ts`: 在 `rmSync` 前添加 `ensureContainedPath(ARCHIVE_DIR, id)` 校验
  - `sessions/[id]/route.ts` DELETE handler 开头添加 `verifyCsrfProtection(request)` CSRF 检查
  - 验收标准:
    - [ ] id='../../etc/passwd' → 400 `{ error: "Invalid project id" }`
    - [ ] id='valid-project' → 正常读取/删除
    - [ ] [安全] 路径穿越测试：resolve 后仍在目标目录内
    - [ ] [安全] DELETE 请求受 CSRF 保护
    - [ ] Typecheck passes

- [ ] DT-006: 修复 rules-to-skill.ts 路径穿越 — finding #5 (`文件: viewer/src/lib/rules-to-skill.ts`)
  - 在 `generateSkillFileName()` 调用前，对 `category` 做白名单校验
  - 在 skill 文件写入/删除前，使用 `ensureContainedPath(SKILLS_DIR, ...)` 校验目标路径
  - 验收标准:
    - [ ] category='../hack' → 抛出错误
    - [ ] category='frontend' → 正常生成 skill 文件
    - [ ] [安全] 写删操作前校验目标路径属于 SKILLS_DIR
    - [ ] Typecheck passes

- [ ] DT-007: 修复命令注入 — finding #1 (`文件: viewer/src/app/api/requirements/route.ts`)
  - 将 `execSync(\`git cat-file -e ${branchName}:${relativePath}\`)` 改为 `execFileSync('git', ['cat-file', '-e', \`${branchName}:${relativePath}\`])` 避免 shell 解释
  - 对 `branchName` 使用 `isSafeGitRef()` 校验，不合法返回 400
  - 对 `relativePath` 进行路径安全校验：仅允许相对路径、禁止 `..` 序列、禁止绝对路径（以 `/` 开头）、禁止 `:` 字符、禁止 null bytes
  - 检查同文件中其他 execSync 调用，统一改为 execFileSync
  - 验收标准:
    - [ ] branchName='$(rm -rf /)' → 400 `{ error: "Invalid branch name" }`
    - [ ] branchName='main' → 正常执行
    - [ ] relativePath='../../etc/passwd' → 400 `{ error: "Invalid file path" }`
    - [ ] relativePath='src/index.ts' → 正常执行
    - [ ] relativePath='/etc/passwd' → 400（绝对路径被拒绝）
    - [ ] [安全] 所有 execSync 改为 execFileSync
    - [ ] [安全] 错误响应不泄露内部路径信息（只返回 "Invalid branch name" 等通用消息）
    - [ ] Typecheck passes

- [ ] DT-008: 为高风险状态变更端点添加 CSRF 防护 — finding #8, #9, #10 + 扩展覆盖 (`文件: viewer/src/app/api/agent/start/route.ts`, `viewer/src/app/api/git/merge/route.ts`, `viewer/src/app/api/claude-processes/route.ts`, `viewer/src/app/api/requirements/delete/route.ts`, `viewer/src/app/api/rules/skill/route.ts`, `viewer/src/app/api/agent/status/route.ts`, `viewer/src/app/api/git/pr/route.ts`, `viewer/src/app/api/test/run/route.ts`)
  - 在以下端点的 POST/DELETE handler 开头添加 `verifyCsrfProtection(request)` 调用：
    - `agent/start/route.ts` POST — 启动代理进程
    - `git/merge/route.ts` POST — 合并 PR 和删除分支
    - `claude-processes/route.ts` POST — 终止进程（通过 PID）
    - `requirements/delete/route.ts` POST — 永久删除项目目录
    - `rules/skill/route.ts` POST/DELETE — 写入/删除 ~/.claude/skills 文件
    - `agent/status/route.ts` DELETE — 终止代理进程（SIGTERM/SIGKILL）
    - `git/pr/route.ts` POST — git push + gh pr create（远程仓库副作用）
    - `test/run/route.ts` POST — 执行 package.json 测试脚本
  - 如果返回非 null，直接返回 403 响应
  - （DT-004、DT-005 中已同步添加 rules POST/DELETE 和 sessions DELETE 的 CSRF 检查）
  - 验收标准:
    - [ ] 从 localhost:3100 请求 → 正常执行
    - [ ] 从外部 Origin (http://evil.com) 请求 → 403 `{ error: "Forbidden: untrusted origin" }`
    - [ ] Sec-Fetch-Site: cross-site → 403 `{ error: "Forbidden: cross-site request" }`
    - [ ] curl 无 Origin 请求 → 正常执行
    - [ ] [安全] 所有高风险状态变更端点受 CSRF 保护（见 Section 8.F 覆盖矩阵）
    - [ ] [安全] 错误响应不泄露内部信息
    - [ ] Verify in browser: 前端调用受保护端点时，403 错误正确显示 toast/提示（抽查 agent/start、claude-processes、git/merge）
    - [ ] Typecheck passes

- [ ] DT-009: 修复 MarkdownEditor XSS — finding #7 (`文件: viewer/src/components/rules/MarkdownEditor.tsx`)
  - 安装 `dompurify` 和 `@types/dompurify`（或 `isomorphic-dompurify`）
  - 在 `dangerouslySetInnerHTML` 使用前，用 `DOMPurify.sanitize(html)` 过滤 HTML
  - 验收标准:
    - [ ] 包含 `<script>alert(1)</script>` 的 markdown → script 标签被移除
    - [ ] 包含 `<img onerror="alert(1)">` 的 markdown → onerror 属性被移除
    - [ ] 正常 markdown（标题、列表、代码块）→ 正常渲染
    - [ ] [安全] XSS 防护
    - [ ] Verify in browser: MarkdownEditor 预览功能正常
    - [ ] Typecheck passes

### 7.3 Phase 3: MEDIUM + LOW 可靠性与风格修复 (P1)

> **前置**: Phase 1（DT-011 使用 verifyCsrfProtection）；其余 DT 可并行
> **产出**: 修复 4 个可靠性问题 + 2 个风格问题
> **对应设计**: 审查报告 #11-#14, #16, #17

- [ ] DT-010: 修复 test/run cwd 覆盖问题 — finding #11 (`文件: viewer/src/app/api/test/run/route.ts`)
  - 修改循环逻辑：创建命令时就绑定各自 cwd，不在循环末尾覆盖
  - 确保每个测试命令携带正确的 package 目录作为 cwd
  - 验收标准:
    - [ ] 多 package 项目中每个测试命令使用各自 cwd
    - [ ] Typecheck passes

- [ ] DT-011: 修复 prd/update 非法 projectId 回退写入 — finding #12 (`文件: viewer/src/app/api/prd/update/route.ts`)
  - 当请求携带 `projectId` 时，使用 `normalizeProjectId()` 校验
  - 校验失败返回 400 `{ error: 'Invalid projectId' }`，不回退到全局路径
  - 未携带 `projectId` 时保持向后兼容（写入全局 prd.json）
  - POST handler 开头添加 `verifyCsrfProtection(request)` CSRF 检查
  - 验收标准:
    - [ ] projectId='../hack' → 400 `{ error: "Invalid projectId" }`
    - [ ] projectId='valid-id' → 正常更新对应项目
    - [ ] projectId=undefined → 写入全局 prd.json（向后兼容）
    - [ ] [安全] POST 请求受 CSRF 保护
    - [ ] Typecheck passes

- [ ] DT-012: 修复 useAgentStatus stale closure — finding #13 (`文件: viewer/src/hooks/useAgentStatus.ts`)
  - 检查 `stopAgent` 回调的依赖数组，添加缺失的 `projectId`
  - 或改为在调用时从 state 取最新值（使用 ref 模式）
  - 验收标准:
    - [ ] 切换项目后调用 stopAgent 使用新项目的 projectId
    - [ ] Typecheck passes

- [ ] DT-013: 修复 watch 端点缺失 projectId 校验 — finding #14 (`文件: viewer/src/app/api/watch/route.ts`)
  - 对 `projectId` 使用 `normalizeProjectId()` 校验
  - 非法值返回 400 `{ error: "Invalid projectId" }`，不静默回退到全局路径
  - 验收标准:
    - [ ] projectId='../hack' → 400 `{ error: "Invalid projectId" }`
    - [ ] projectId='valid' → 正常监听
    - [ ] Typecheck passes

- [ ] DT-014: 修复 API 响应风格 + 按钮颜色 — finding #16, #17 (`文件: viewer/src/app/api/cli/chat/route.ts`, `viewer/src/app/stage3/page.tsx`)
  - `cli/chat/route.ts`: 将 `new Response(JSON.stringify(...))` 改为 `NextResponse.json()`
  - `stage3/page.tsx`: 将红色按钮 (`bg-red-500`) 改为 shadcn Button 组件或黑底白字 (`bg-neutral-900 text-white`)
  - 验收标准:
    - [ ] cli/chat API 返回格式使用 NextResponse.json
    - [ ] stage3 页面无红色主操作按钮
    - [ ] Verify in browser: stage3 按钮样式正确
    - [ ] Typecheck passes

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `viewer/src/lib/project-root.ts` | 扩展 | Phase 1 | DT-001, DT-003 |
| `viewer/src/lib/api-guard.ts` | 新建 | Phase 1 | DT-002 |
| `viewer/src/app/api/git/merge/route.ts` | 修改 | Phase 1 | DT-003, DT-008 |
| `viewer/src/app/api/rules/route.ts` | 修改 | Phase 2 | DT-004 |
| `viewer/src/app/api/rules/[id]/route.ts` | 修改 | Phase 2 | DT-004 |
| `viewer/src/app/api/prd/[id]/route.ts` | 修改 | Phase 2 | DT-005 |
| `viewer/src/app/api/sessions/[id]/route.ts` | 修改 | Phase 2 | DT-005 |
| `viewer/src/lib/rules-to-skill.ts` | 修改 | Phase 2 | DT-006 |
| `viewer/src/app/api/requirements/route.ts` | 修改 | Phase 2 | DT-007 |
| `viewer/src/app/api/agent/start/route.ts` | 修改 | Phase 2 | DT-008 |
| `viewer/src/app/api/claude-processes/route.ts` | 修改 | Phase 2 | DT-008 |
| `viewer/src/app/api/requirements/delete/route.ts` | 修改 | Phase 2 | DT-008 |
| `viewer/src/app/api/rules/skill/route.ts` | 修改 | Phase 2 | DT-008 |
| `viewer/src/app/api/agent/status/route.ts` | 修改 | Phase 2 | DT-008 |
| `viewer/src/app/api/git/pr/route.ts` | 修改 | Phase 2 | DT-008 |
| `viewer/src/app/api/test/run/route.ts` | 修改 | Phase 2 | DT-008, DT-010 |
| `viewer/src/components/rules/MarkdownEditor.tsx` | 修改 | Phase 2 | DT-009 |
| `viewer/src/app/api/test/run/route.ts` | 修改 | Phase 3 | DT-010 |
| `viewer/src/app/api/prd/update/route.ts` | 修改 | Phase 3 | DT-011 |
| `viewer/src/hooks/useAgentStatus.ts` | 修改 | Phase 3 | DT-012 |
| `viewer/src/app/api/watch/route.ts` | 修改 | Phase 3 | DT-013 |
| `viewer/src/app/api/cli/chat/route.ts` | 修改 | Phase 3 | DT-014 |
| `viewer/src/app/stage3/page.tsx` | 修改 | Phase 3 | DT-014 |

### B. 风险与缓解措施

#### MEDIUM
- **DOMPurify 包大小**: DOMPurify ~60KB gzipped，可能影响首屏加载 → **缓解**: 使用 `isomorphic-dompurify`（SSR 兼容）或动态 import
- **CSRF 防护非浏览器绕过**: 无 Origin/Referer/Sec-Fetch-Site 的非浏览器请求可绕过 → **缓解**: 这是设计选择，非浏览器本地进程已有文件系统访问权。已在 PRD 中明确记录为已知限制。
- **DNS rebinding 攻击**: 恶意网站可能通过 DNS rebinding 使 Origin 看似来自 localhost → **缓解**: Sec-Fetch-Site 检查可阻止现代浏览器中的 DNS rebinding CSRF；旧浏览器仍有风险，但影响有限（本地工具）。

#### LOW
- **ensureContainedPath 性能**: realpathSync 是同步 I/O → **缓解**: 仅在用户输入的路径上调用，不在热路径使用

### C. 审查报告映射

| Finding # | Severity | 类别 | DT | 状态 |
|-----------|----------|------|-----|------|
| #1 | HIGH | 命令注入 | DT-007 | 待修复 |
| #2 | HIGH | 路径穿越 | DT-005 | 待修复 |
| #3 | HIGH | 路径穿越 | DT-004 | 待修复 |
| #4 | HIGH | 路径穿越 | DT-004 | 待修复 |
| #5 | HIGH | 路径穿越 | DT-006 | 待修复 |
| #6 | HIGH | 路径穿越 | DT-005 | 待修复 |
| #7 | HIGH | XSS | DT-009 | 待修复 |
| #8 | HIGH | 未认证 | DT-008 | 待修复 |
| #9 | HIGH | 未认证 | DT-008 | 待修复 |
| #10 | HIGH | 未认证 | DT-008 | 待修复 |
| #11 | MEDIUM | 可靠性 | DT-010 | 待修复 |
| #12 | MEDIUM | 可靠性 | DT-011 | 待修复 |
| #13 | MEDIUM | 可靠性 | DT-012 | 待修复 |
| #14 | MEDIUM | 一致性 | DT-013 | 待修复 |
| #15 | MEDIUM | 测试覆盖 | — | 不在范围 |
| #16 | LOW | 风格 | DT-014 | 待修复 |
| #17 | LOW | 风格 | DT-014 | 待修复 |

### D. 非目标 (Out of Scope)

- 完整的认证系统（JWT/session） — BotoolAgent 是本地工具，CSRF 防护足够
- API 路由架构重构 — 只在现有结构上加防护
- 完整安全回归测试套件（finding #15 的全面覆盖）— 属于独立项目。注意：Section 8.G 定义的最小安全冒烟测试（~15 个用例）在本项目范围内，作为基本质量门槛
- 全局扫描修复 API 响应风格 — 只修报告中指出的文件
- 全局扫描修复按钮颜色 — 只修报告中指出的位置

### E. 安全检查项

以下安全验收标准已自动注入到对应 DT 中：

| DT | 安全项 |
|----|--------|
| DT-001 | 路径不可由用户控制（symlink 被 realpath 解析） |
| DT-002 | 多层 CSRF 防护校验通过（Origin + Referer + Sec-Fetch-Site） |
| DT-004 | 存储路径不可由用户控制；POST 请求受 CSRF 保护 |
| DT-005 | 路径穿越测试：resolve 后仍在目标目录内；DELETE 请求受 CSRF 保护 |
| DT-006 | 写删操作前校验目标路径属于 SKILLS_DIR |
| DT-007 | 所有 execSync 改为 execFileSync；错误响应不泄露内部路径 |
| DT-008 | 所有状态变更端点受 CSRF 保护；错误响应不泄露内部信息 |
| DT-009 | XSS 防护 |
| DT-011 | POST 请求受 CSRF 保护 |

### F. CSRF 防护覆盖矩阵

#### 受保护端点（本项目范围内添加 verifyCsrfProtection）

| 端点 | 方法 | DT | 风险等级 | 说明 |
|------|------|-----|---------|------|
| `agent/start` | POST | DT-008 | HIGH | 启动代理进程（执行命令） |
| `git/merge` | POST | DT-008 | HIGH | 合并 PR + 删除分支 |
| `claude-processes` | POST | DT-008 | HIGH | 终止进程（通过 PID） |
| `rules` | POST | DT-004 | MEDIUM | 创建/修改规则文件（写文件系统） |
| `rules` | DELETE | DT-004 | MEDIUM | 删除规则文件 |
| `sessions/[id]` | DELETE | DT-005 | HIGH | 递归删除会话目录（rmSync） |
| `prd/update` | POST | DT-011 | MEDIUM | 修改项目 PRD 数据 |
| `requirements/delete` | POST | DT-008 | HIGH | 永久删除项目目录（rmSync） |
| `rules/skill` | POST | DT-008 | MEDIUM | 写入 ~/.claude/skills 文件 |
| `rules/skill` | DELETE | DT-008 | MEDIUM | 删除 ~/.claude/skills 文件 |
| `agent/status` | DELETE | DT-008 | HIGH | 终止代理进程（SIGTERM/SIGKILL） |
| `git/pr` | POST | DT-008 | HIGH | git push + gh pr create（远程副作用） |
| `test/run` | POST | DT-008 | HIGH | 执行 package.json 脚本（命令执行） |

#### 豁免端点（不在本项目范围内，理由如下）

| 端点 | 方法 | 豁免理由 |
|------|------|---------|
| `chat` | POST | LLM 调用，无持久化副作用；CSRF 触发成本高（需完整 prompt） |
| `cli/chat` | POST | CLI 内部调用，非浏览器触发 |
| `cli/respond` | POST | CLI 内部调用，非浏览器触发 |
| `generate-title` | POST | 只读语义（LLM 生成标题），无文件写入 |
| `prd/convert` | POST | LLM 转换操作，结果需用户确认后另存 |
| `prd/enrich` | POST | LLM 充化操作，结果需用户确认后另存 |
| `prd/fix` | POST | LLM 修复操作，结果需用户确认后另存 |
| `prd/review` | POST | Codex 审查操作，只读分析 |
| `prd/review-save` | POST | 保存审查结果（低风险，非破坏性） |
| `prd/save` | POST | 保存 PRD（低风险，非破坏性） |
| `prd/merge` | POST | 合并 PRD 片段（低风险） |
| `prd/marker` | POST/DELETE | PRD 标记管理（低风险） |
| `prd-sessions` | POST/DELETE | PRD 会话管理（低风险） |
| `registry` | PATCH | 注册表更新（低风险，非破坏性） |
| `requirements/archive` | POST | 归档（非破坏性，可恢复） |
| `task-history` | POST/DELETE | 任务历史管理（写入本地 JSON，低风险） |

**注意**: `requirements/delete`、`rules/skill`、`agent/status`、`git/pr`、`test/run` 已在本轮审查中移入受保护端点。豁免表中的 `sessions` POST 在代码中不存在（仅有 `sessions/[id]` DELETE，已受保护），已从清单移除。

### G. 最小安全回归测试（自动化）

以下自动化测试作为 PR 合入门槛，确保安全控制不会在后续开发中回归。测试文件放在 `viewer/src/__tests__/security/` 目录下。

#### G.1 共享工具函数单测（必须）

| 函数 | 测试文件 | 必测场景 | 最少用例数 |
|------|---------|---------|-----------|
| `ensureContainedPath` | `ensureContainedPath.test.ts` | 正常路径返回、`../` 逃逸抛错、不存在的目标校验祖先、symlink 到外部抛错 | 4 |
| `verifyCsrfProtection` | `verifyCsrfProtection.test.ts` | localhost Origin 放行、外部 Origin 403、无 Origin + cross-site Sec-Fetch-Site 403、curl 无头放行、IPv6 `[::1]` 放行 | 5 |
| `isSafeGitRef` | `isSafeGitRef.test.ts` | 正常 ref true、shell 注入 false、前导 `-` false、`@{` 序列 false、`.lock` 后缀 false、段级校验 (`foo/.bar`) false | 6 |

#### G.2 路由级集成测试（必须）

至少 2 条路由级测试验证端到端 CSRF 拒绝和路径穿越拒绝：

| 测试场景 | 目标端点 | 验证点 |
|---------|---------|--------|
| CSRF 拒绝 | `POST /api/agent/start` | Origin: evil.com → 403 |
| 路径穿越拒绝 | `GET /api/rules?category=../etc` | → 400 |

#### G.3 运行方式

```bash
cd viewer && npx vitest run src/__tests__/security/
```

测试使用 vitest（项目已有 vitest 配置）。若项目无 vitest，使用 jest 替代。
