# PRD: Viewer CLI 集成

## Introduction

将 BotoolAgent Viewer 的 Stage 1 (PRD 生成) 和 Stage 2 (PRD 转 JSON) 从直接调用 Anthropic API 改为通过 Claude Code CLI 进行交互。这样做的好处是：

1. **免费使用** - 利用 Max 订阅，无需单独付费 API 调用
2. **能访问代码库** - CLI 可以读文件、搜索代码，生成更准确的 PRD
3. **支持所有 Skills** - 可以使用现有的 BotoolAgent skills
4. **统一架构** - 所有 Stage 都通过 CLI 运行，架构一致

## Goals

- 将 Stage 1/2 的 AI 对话改为通过 Claude CLI 实现
- 保持现有 UI 布局和用户体验不变
- 支持会话恢复（同一 PRD 可继续对话）
- 移除对 Anthropic API 的直接依赖

## Dev Tasks

### DT-001: 创建 CLI 进程管理服务
**Description:** 作为开发者，我需要一个后端服务来管理 Claude CLI 子进程的生命周期。

**Acceptance Criteria:**
- [ ] 创建 `viewer/src/lib/cli-manager.ts` 服务
- [ ] 能启动 `claude --print --output-format stream-json` 进程
- [ ] 能向进程 stdin 写入用户消息
- [ ] 能从进程 stdout 读取流式 JSON 响应
- [ ] 能使用 `--resume <session-id>` 恢复会话
- [ ] 能从 CLI 输出中提取 session ID
- [ ] 进程超时和错误处理
- [ ] Typecheck passes

### DT-002: 创建 CLI Chat API 端点
**Description:** 作为开发者，我需要创建 API 路由让前端能与 CLI 进程交互。

**Acceptance Criteria:**
- [ ] 创建 `/api/cli/chat/route.ts` API 端点
- [ ] POST 请求接收 `{ message: string, sessionId?: string, mode: 'prd' | 'convert' }`
- [ ] 返回 Server-Sent Events (SSE) 流式响应
- [ ] 响应格式：`{ type: 'text' | 'done' | 'error' | 'session', content?: string, sessionId?: string }`
- [ ] 新会话时返回新的 sessionId
- [ ] 恢复会话时使用传入的 sessionId
- [ ] 根据 mode 加载不同的 system prompt（PRD 生成 / PRD 转换）
- [ ] Typecheck passes

### DT-003: 创建 useCliChat Hook
**Description:** 作为开发者，我需要一个前端 Hook 来管理与 CLI API 的通信。

**Acceptance Criteria:**
- [ ] 创建 `viewer/src/hooks/useCliChat.ts`
- [ ] 提供 `sendMessage(content: string)` 方法
- [ ] 提供 `messages: Message[]` 状态
- [ ] 提供 `isLoading: boolean` 状态
- [ ] 提供 `sessionId: string | null` 状态
- [ ] 支持流式接收并更新消息
- [ ] 支持通过 `sessionId` 参数恢复会话
- [ ] Typecheck passes

### DT-004: 改造 Stage 1 使用 CLI
**Description:** 作为用户，我希望 Stage 1 的 PRD 生成对话通过 CLI 进行，这样 AI 能看到我的代码。

**Acceptance Criteria:**
- [ ] Stage 1 页面使用 useCliChat 替代 useChat
- [ ] Chat 对话通过 CLI 进行
- [ ] AI 回复能引用实际代码文件
- [ ] PRD 预览面板仍然实时更新
- [ ] 保存 PRD 时同时保存 sessionId
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-005: 改造 Stage 2 使用 CLI
**Description:** 作为用户，我希望 Stage 2 的 PRD 转 JSON 通过 CLI 进行。

**Acceptance Criteria:**
- [ ] 转换过程通过 CLI `/api/cli/chat` 进行（mode: 'convert'）
- [ ] 流式显示转换进度
- [ ] 从 CLI 输出中提取 JSON 并保存到 prd.json
- [ ] 支持用户在转换后继续对话调整
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-006: 会话持久化
**Description:** 作为用户，我希望重新打开一个 PRD 时能继续之前的对话。

**Acceptance Criteria:**
- [ ] 创建 `.prd-sessions.json` 存储 PRD 与 sessionId 的映射
- [ ] PRD 保存时自动记录 sessionId
- [ ] Stage 1/2 加载 PRD 时检查是否有关联的 sessionId
- [ ] 有 sessionId 时询问用户是否恢复会话
- [ ] 提供 API 端点查询/更新会话映射
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-007: 清理旧的 API 代码
**Description:** 作为开发者，我需要清理不再使用的直接 API 调用代码。

**Acceptance Criteria:**
- [ ] 修改 `/api/chat/route.ts` - 移除 Anthropic API 调用，改为调用 CLI
- [ ] 修改 `/api/prd/convert/route.ts` - 移除 Anthropic API 调用，改为调用 CLI
- [ ] 确保所有 Stage 功能正常
- [ ] 更新相关文档/注释
- [ ] Typecheck passes
- [ ] Verify in browser

## Functional Requirements

- FR-1: 系统必须能启动和管理 Claude CLI 子进程
- FR-2: 系统必须支持流式输出，用户能实时看到 AI 回复
- FR-3: 系统必须能恢复之前的 CLI 会话
- FR-4: 系统必须在 CLI 进程异常时进行错误处理和重试
- FR-5: 系统必须支持同时运行多个 CLI 会话（不同用户/PRD）

## Non-Goals (Out of Scope)

- 不改变现有 UI 布局
- 不改变 Stage 3 的实现（已经是 CLI）
- 不实现完整的终端模拟器
- 不支持 CLI 的所有命令（仅支持对话）

## Technical Considerations

- Claude CLI 使用 `--print --output-format stream-json` 模式
- 会话恢复使用 `--resume <session-id>` 参数
- 进程管理需要处理僵尸进程问题
- 需要设置合理的超时时间
- SSE 连接需要处理断开重连

## Success Metrics

- Stage 1/2 的 AI 对话能正确引用代码文件
- 不再需要 ANTHROPIC_API_KEY（可删除 .env.local）
- 会话恢复功能正常工作
- 响应速度与直接 API 调用相当

## Open Questions

- 是否需要限制同时运行的 CLI 进程数量？
- CLI 进程的日志是否需要保存？
- 是否需要添加"重置会话"按钮？
