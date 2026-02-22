# BotoolAgent 功能全景清单（FEATURES）

基线说明：
- 基于当前仓库目录代码状态整理（含 `viewer/`、`scripts/`、`skills/`、`tasks/` 相关实现）
- 以“当前目录对应最新 PR 代码”为准，不依赖历史文档假设

## 1. 产品级功能

1. 自主开发代理全流程。
2. Web Viewer 可视化编排与监控。
3. CLI Skill 驱动的命令式工作流。
4. 多项目并行（基于 `tasks/{projectId}` 隔离）。
5. PRD 驱动开发（`prd.md` + `prd.json`）。
6. Agent Teams + tmux 的长流程执行。
7. 自动化测试与合并发布闭环。

## 2. 运行模式与架构

1. 独立模式：BotoolAgent 仓库自身作为项目根。
2. 可移植模式：目标项目作为工作目录，BotoolAgent 作为工具层。
3. Worktree 模式：每个项目 `botool/{projectId}` 分支独立 `.worktrees/{projectId}`。
4. 双执行引擎：
5. 编码模式：`scripts/BotoolAgent.sh`（tmux + Claude Agent Teams）。
6. 测试模式：`claude -p /botoolagent-testing`（可选 teams/single）。
7. 数据落盘模型：文件系统状态机（而非 DB）。

## 3. 分阶段功能（Stage 0~5）

| 阶段 | 主要目标 | 核心功能 |
|---|---|---|
| Stage 0 | 想法澄清 | Brainstorm 轻量问答，产出 `DRAFT.md` |
| Stage 1 | PRD 生成/导入 | Pyramid Q&A、会话恢复、导入源文件、PRD 保存、模式切换（quick/feature/transform/full） |
| Stage 2 | 规范化与审查 | Rule Check、PRD 对抗审查、自动 enrich、enrich 对抗审查、合并回写 |
| Stage 3 | 自主开发 | 启停 Agent、迭代上限、实时状态/日志/文件变更/提交可视化、自动推进 |
| Stage 4 | 验收测试 | 6 层测试状态面板、测试日志增量流、自动重试与自动推进 |
| Stage 5 | PR 与合并 | PR 检测/创建、merge 检查、merge 执行、完成态回收与收尾 |

## 4. Viewer 功能模块

### 4.1 项目与标签管理
- `TabPanelManager`：常驻 Dashboard + 需求标签生命周期管理。
- `TabBar`：标签状态、关闭保护（运行中确认）、路由同步。
- `ProjectContext`：项目级 stage/status/autoMode 状态管理与持久化。
- `RequirementContext`：需求列表、归档、删除、刷新、导入态兼容。
- `TabContext`：标签缓存、活动标签、注意力标记、进度徽标。

### 4.2 需求创建/导入
- `CreateRequirementDialog`：
- 文本创建需求并自动生成标题（`/api/generate-title`）。
- 扫描 `tasks` 下 Markdown 进行导入（`/api/files/md`）。
- 导入冲突检测与继续/重开逻辑（`/api/prd/marker`）。

### 4.3 阶段路由与面板
- `StageRouter`：`0/1 -> stage1`，`2/3 -> stage3`，`4 -> stage4`，`5 -> stage5`。
- `Stage1Content`：CLI 对话、AskUserQuestion 工具响应、PRD 抽取、会话恢复、本地草稿恢复。
- `Stage2Content`：五步 pipeline 编排。
- `Stage3Content`：开发态控制台、流图、批次时间轴、Git 变化监控。
- `Stage4Content`：测试流程控制、日志流、层级完成映射。
- `Stage5Content`：PR/merge 全操作与守门。

### 4.4 规则与技能生成
- `RulesManager` + `CategoryTree` + `MarkdownEditor`：
- 规则分类 CRUD。
- 规则内容预览与维护。
- 规则转 Skill 预览/生成/删除（`rules-to-skill`）。

### 4.5 观测与报告组件
- `FlowChart`：任务依赖与执行路径可视化。
- `AgentActivityFeed` / `TerminalActivityFeed`：工具调用与终端流。
- `ClaudeStatus` / `ClaudeProcesses`：CLI 登录、额度窗口、进程列表与终止。
- `ReviewSummary` / `CodexReviewPanel` / `TestingReportSummary`：审查与测试报告聚合展示。

## 5. API 功能全量清单

### 5.1 Agent / CLI / Chat

| Endpoint | Methods | 功能 |
|---|---|---|
| `/api/agent/start` | `POST` | 启动开发或测试代理（detached），写 `agent-pid`/`agent-status`，同步 task-history |
| `/api/agent/status` | `GET`,`DELETE` | 查询状态（单项目/全项目/SSE），孤儿进程检测；停止代理并清理状态 |
| `/api/agent/log` | `GET` | 增量读取 `agent-testing.log`，stream-json 解析成人类可读文本 |
| `/api/agent/logs` | `GET` | 抓取 tmux pane 最近日志，格式化工具调用行 |
| `/api/cli/chat` | `POST` | Claude CLI 会话消息入口（支持 session resume 与 SSE） |
| `/api/cli/respond` | `POST` | 向 CLI 会话回传工具响应（AskUserQuestion 回答等） |
| `/api/cli/status` | `GET` | Claude CLI 版本/认证/订阅/估算额度窗口信息 |
| `/api/cli/health` | `GET` | 健康检查：`claude` 命令是否可用 |
| `/api/chat` | `POST` | 旧版 chat 兼容接口（内部仍走 CLIManager） |
| `/api/claude-processes` | `GET`,`POST` | 枚举 claude/codex 进程资源与来源；按 PID 安全终止 |

### 5.2 PRD 与对抗审查链路

| Endpoint | Methods | 功能 |
|---|---|---|
| `/api/prd` | `GET` | 扫描可用 PRD（新旧目录结构兼容）并推断状态 |
| `/api/prd/[id]` | `GET` | 读取指定项目 PRD（新格式优先，旧格式回退） |
| `/api/prd/save` | `POST` | 保存 `tasks/{id}/prd.md`，会话映射落盘，导入 marker 清理 |
| `/api/prd/update` | `POST` | 更新 `prd.json`（任务顺序重排优先级） |
| `/api/prd/convert` | `POST` | PRD.md -> slim prd.json（SSE 进度流、归档策略、registry 更新） |
| `/api/prd/enrich` | `POST` | 自动 enrich（代码示例/测试/evals/依赖/session） |
| `/api/prd/review` | `POST` | Codex 红队审查（PRD/enrich 两种目标，SSE 输出 findings） |
| `/api/prd/fix` | `POST` | Claude 按 findings 自动修正（PRD/enrich） |
| `/api/prd/merge` | `POST` | 基础 PRD + enrich + 规则融合，输出 enriched prd.json，并可注入 PRD §7 |
| `/api/prd/review-save` | `POST` | 审查结果落盘，PRD 修正版原子写入与备份 |
| `/api/prd/marker` | `POST`,`GET`,`DELETE` | 导入转换 marker 管理（冲突检测/查询/删除） |
| `/api/prd-sessions` | `GET`,`POST`,`DELETE` | PRD 会话映射管理（项目级 + 全局旧格式兼容） |

### 5.3 Git / PR / Merge

| Endpoint | Methods | 功能 |
|---|---|---|
| `/api/git/changes` | `GET` | 分支相对 `main` 文件变更与行数统计 |
| `/api/git/commits` | `GET` | 分支提交列表与 DT 号提取 |
| `/api/git/diff` | `GET` | 全量或单文件结构化 diff（hunk/line 级） |
| `/api/git/pr` | `GET`,`POST` | PR 查询/创建，自动标题与描述生成，分支推送 |
| `/api/git/merge` | `GET`,`POST` | merge 可行性检查与执行，含 worktree/分支清理和历史更新 |

### 5.4 需求、规则、会话与报告

| Endpoint | Methods | 功能 |
|---|---|---|
| `/api/requirements` | `GET` | 扫描 active + archived 需求，推断 stage/status/进度 |
| `/api/requirements/archive` | `POST` | 物理归档目录到 `tasks/archives` |
| `/api/requirements/delete` | `POST` | 永久删除 active/archived 需求目录（含重复归档目录） |
| `/api/registry` | `GET`,`PATCH` | 读取/更新 registry（当前 activeProject 等） |
| `/api/rules` | `GET`,`POST`,`DELETE` | 规则按分类管理 |
| `/api/rules/[id]` | `GET` | 读取单条规则内容 |
| `/api/rules/skill` | `GET`,`POST`,`DELETE` | 规则转 Skill（预览/路径/创建/删除） |
| `/api/sessions` | `GET` | 历史会话列表（支持 extended merge 状态） |
| `/api/sessions/[id]` | `GET`,`DELETE` | 会话详情与删除 |
| `/api/task-history` | `GET`,`POST`,`DELETE` | 任务历史记录 CRUD 与刷新 |
| `/api/review-summary` | `GET` | 交付审查摘要（任务、规范、安全、eval、代码变更） |
| `/api/codex-review` | `GET` | 读取 codex-review 与 adversarial-state |
| `/api/testing-report` | `GET` | 读取项目 testing-report.json |

### 5.5 文件监听、测试与辅助

| Endpoint | Methods | 功能 |
|---|---|---|
| `/api/watch` | `GET` | 轮询 `prd.json`/`progress.txt`/`teammates.json` 的 SSE 文件观察器 |
| `/api/test/run` | `GET`,`POST` | 自动检测可用测试命令并流式执行测试计划 |
| `/api/files/md` | `GET` | 扫描 `tasks` 下 Markdown 文件供导入 |
| `/api/generate-title` | `POST` | 需求描述标题生成（Anthropic 直连 + 本地回退） |

## 6. 脚本能力

### 6.1 `scripts/BotoolAgent.sh`
- 启动前置检查：`tmux`、`claude`、`prd.json`。
- 项目级 session 命名与状态文件隔离。
- worktree 自动创建/复用/安全校验。
- `node_modules` 与 `viewer/node_modules` symlink 到 worktree。
- tmux 会话自动确认与首条指令注入（加载 `CLAUDE.lead.md`）。
- Ralph 外循环：按轮次重启直到任务完成或达到上限。
- 卡住检测：无 commit 超时、context-limit 触发主动重启。
- 归档策略：分支变化时快照旧运行数据。

### 6.2 根脚本
- `BotoolAgent.sh`：根目录轻包装转发到 `scripts/BotoolAgent.sh`。
- `setup.sh`：
- 安装 `viewer` 依赖与可选 native 依赖修复。
- 设置可执行权限。
- 将 `skills/BotoolAgent/*/SKILL.md` 软链接安装到 `~/.claude/skills`。
- 检测 Codex CLI 与 codex-mcp-server 可用性。

## 7. Skills 功能清单

| Skill 名称 | 作用 |
|---|---|
| `botoolagent` | 启动 Viewer |
| `botoolagent-brainstorm` | Stage0 头脑风暴 -> DRAFT |
| `botoolagent-pyramidprd` | 金字塔问答生成 PRD |
| `botoolagent-prd2json` | PRD 转 slim prd.json |
| `botoolagent-coding` | 启动自动开发流水线 |
| `botoolagent-testing` | 6 层自动化测试与对抗审查 |
| `botoolagent-prdreview` | Codex PRD 红队审查 |
| `botoolagent-finalize` | Merge 收尾与发布 |
| `botoolagent-restart` | 重启 Viewer |
| `botoolagent-update` | 拉取/安装更新版本 |

## 8. 数据文件与状态模型

| 路径 | 用途 |
|---|---|
| `tasks/{projectId}/prd.md` | PRD 真相源文档 |
| `tasks/{projectId}/prd.json` | 自动化执行索引（任务、依赖、eval、session） |
| `tasks/{projectId}/progress.txt` | 开发与审查日志 |
| `tasks/{projectId}/agent-status` | 运行态状态机快照 |
| `tasks/{projectId}/agent-pid` | 代理进程 PID 锁 |
| `tasks/{projectId}/agent-testing.log` | 测试流程 stream-json 原始日志 |
| `tasks/{projectId}/testing-report.json` | 测试汇总报告 |
| `tasks/{projectId}/teammates.json` | teammates/批次执行信息 |
| `tasks/{projectId}/prd-session.json` | PRD 会话映射与 transform 来源 |
| `tasks/registry.json` | 项目注册表与活动项目 |
| `tasks/.task-history.json` | 跨项目任务历史 |
| `tasks/archives/*` | 归档需求目录 |
| `tasks/snapshots/*` | 运行快照/历史会话 |

## 9. 一致性 / 可靠性 / 安全机制（实现层）

### 9.1 一致性机制
- 项目路径统一由 `project-root.ts` 解析。
- `normalizeProjectId` + `ensureContainedPath` 防越界。
- 新旧数据结构兼容读取（flat legacy 与 per-project 双栈）。
- registry 更新通过 `withRegistry` 锁与原子写避免并发损坏。
- tab/project/session 本地存储支持迁移与容错。

### 9.2 可靠性机制
- 关键 API 大量采用 SSE 进度流（review/fix/enrich/test/watch/agent status/chat）。
- 心跳与轮询机制（status/watch）。
- detached 子进程 + PID 锁，服务重启后可做 orphan 检测。
- Botool 外循环具备 stall/context-limit 自动恢复。
- 审查流程 fail-closed（解析失败视为失败，不默认为通过）。
- 多处原子写入策略（临时文件 + rename）。

### 9.3 安全机制
- 多数写操作接口启用 CSRF 保护（Origin/Referer/Sec-Fetch-Site）。
- Git ref、file path、projectId 均有白名单校验。
- 关键命令使用 `execFile` 或安全参数拼接，避免 shell 注入。
- 路径穿越防护覆盖 rules/prd/review-save 等落盘路径。
- 错误响应普遍避免泄漏内部绝对路径与堆栈。

## 10. 外部集成能力

1. Claude CLI（核心执行）。
2. Codex CLI（对抗审查与红队分析）。
3. Git + GitHub CLI（PR/merge 生命周期）。
4. tmux（长会话承载）。
5. Anthropic HTTP API（标题生成 fallback 主链）。

## 11. 结论

BotoolAgent 当前实现已经覆盖：
- 从需求澄清到 PR 合并的完整自动化研发链路。
- 可视化与命令行双入口。
- 多项目隔离、可恢复执行、审查与测试闭环。
- 较完整的一致性/可靠性/安全防护基础设施。

