# BotoolAgent 全面审查报告（Consistency / Reliability / Security）

生成时间：2026-02-19

## 概览

- 总计：17 条
- HIGH：10
- MEDIUM：5
- LOW：2

## Findings

1. **[HIGH][security] owasp-command-injection**  
   文件：`viewer/src/app/api/requirements/route.ts:101`  
   问题：`branchName` 直接拼接进 `execSync` 命令，存在命令注入风险。  
   建议：改用 `execFileSync`（`shell: false`）并对白名单校验 `branchName`。

2. **[HIGH][security] path-traversal-destructive**  
   文件：`viewer/src/app/api/sessions/[id]/route.ts:138`  
   问题：未校验 `id` 即执行递归删除，可能路径穿越越界删除。  
   建议：`id` 严格白名单 + `resolve/realpath` 目录归属校验。

3. **[HIGH][security] path-traversal**  
   文件：`viewer/src/app/api/rules/route.ts:87`  
   问题：`category/name` 拼路径未做越界保护，可写删目录外文件。  
   建议：`category` 枚举化、`name` 白名单、最终路径归属校验。

4. **[HIGH][security] path-traversal**  
   文件：`viewer/src/app/api/rules/[id]/route.ts:28`  
   问题：`decodedId` 直接拼路径，存在越界读取风险。  
   建议：统一 ruleId 解析器（白名单 + realpath containment）。

5. **[HIGH][security] path-traversal**  
   文件：`viewer/src/lib/rules-to-skill.ts:110`  
   问题：`category` 未净化参与文件名，可能通过 `../` 逃逸目录。  
   建议：对 `category` 做固定白名单，写删前校验目标路径属于 `SKILLS_DIR`。

6. **[HIGH][security] path-traversal**  
   文件：`viewer/src/app/api/prd/[id]/route.ts:16`  
   问题：`id` 未校验即拼接读取文件，存在路径穿越。  
   建议：使用 `normalizeProjectId` + 严格字符白名单。

7. **[HIGH][security] xss-unsanitized-html**  
   文件：`viewer/src/components/rules/MarkdownEditor.tsx:227`  
   问题：`dangerouslySetInnerHTML` 渲染未 sanitize 的用户内容。  
   建议：引入 sanitizer（如 DOMPurify）或使用安全 markdown 渲染链。

8. **[HIGH][security] unauthenticated-sensitive-endpoint**  
   文件：`viewer/src/app/api/agent/start/route.ts:101`  
   问题：无鉴权即可启动 detached 代理进程。  
   建议：为执行类 API 增加认证、授权与 CSRF/origin 校验。

9. **[HIGH][security] unauthenticated-sensitive-endpoint**  
   文件：`viewer/src/app/api/git/merge/route.ts:151`  
   问题：无鉴权即可触发 PR 合并和分支删除。  
   建议：增加鉴权与高风险操作二次确认。

10. **[HIGH][security] unauthenticated-sensitive-endpoint**  
    文件：`viewer/src/app/api/claude-processes/route.ts:312`  
    问题：无鉴权即可终止本机 claude/codex 进程。  
    建议：仅允许授权用户、并限制可操作 PID 范围。

11. **[MEDIUM][reliability] wrong-working-directory-selection**  
    文件：`viewer/src/app/api/test/run/route.ts:127`  
    问题：循环中批量回写 cwd，可能把前面命令 cwd 覆盖成后一个包目录。  
    建议：创建命令时就绑定各自 cwd。

12. **[MEDIUM][reliability] invalid-projectid-fallback-write**  
    文件：`viewer/src/app/api/prd/update/route.ts:52`  
    问题：非法 `projectId` 会回退写入全局 `prd.json`，可能污染跨项目数据。  
    建议：携带 `projectId` 时若无效应直接 400。

13. **[MEDIUM][reliability] react-stale-closure**  
    文件：`viewer/src/hooks/useAgentStatus.ts:306`  
    问题：`stopAgent` 依赖缺少 `projectId`，切项目后可能用旧值停止错误任务。  
    建议：将 `projectId` 加入依赖或调用时取最新值。

14. **[MEDIUM][consistency] projectid-validation-missing**  
    文件：`viewer/src/app/api/watch/route.ts:41`  
    问题：未校验 `projectId`，非法值会静默回退到全局路径。  
    建议：路由层校验失败直接返回 400。

15. **[MEDIUM][test-coverage] security-regression-gaps**  
    文件：`viewer/tests/stages.spec.ts:136`  
    问题：缺少注入/路径穿越/未授权等负向安全回归测试。  
    建议：新增高风险路由负向用例与回归套件。

16. **[LOW][style] api-response-convention**  
    文件：`viewer/src/app/api/cli/chat/route.ts:17`  
    问题：大量使用 `new Response`，与项目 `NextResponse.json` 规范不一致。  
    建议：统一返回风格与错误结构。

17. **[LOW][style] ui-button-color-policy**  
    文件：`viewer/src/app/stage3/page.tsx:404`  
    问题：主操作按钮用红色，不符合“主按钮黑底白字、状态色仅用于指示器”的规范。  
    建议：主按钮改黑白，风险状态用 badge/文本提示表达。

