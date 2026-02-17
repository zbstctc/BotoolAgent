# BotoolAgent

BotoolAgent 是一个自主 AI 开发代理，基于 [Ralph 模式](https://ghuntley.com/ralph/)，通过 tmux + Agent Teams 循环执行开发任务。Lead Agent 读取 `CLAUDE.lead.md` 指令，编排多任务并行执行。每次迭代通过 git 历史、`progress.txt` 和 `prd.json` 保持跨迭代记忆。

提供两种使用方式：
- **Web Viewer** — 5 阶段可视化工作流，适合非技术用户
- **CLI Skills** — 在终端通过 `/botoolagent` 命令使用，适合开发者

```
用户想法
  ↓
Stage 1: 金字塔问答 → PRD.md（需求文档）
  ↓
Stage 2: 规则选择 + Enrichment → prd.json（自动化索引）
  ↓
Stage 3: 自动开发（Agent Teams 模式循环执行）
  ↓
Stage 4: 4 层自动验证（TypeCheck → Unit → E2E → Code Review）
  ↓
Stage 5: 推送 → PR → 审查 → 合并
```

## 快速开始

### 前置条件

在目标机器上需要安装以下工具：

| 工具 | 安装方式 | 用途 |
|------|----------|------|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | AI 代理运行时 |
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) | Viewer Web 界面 |
| **Git** | `brew install git` 或系统自带 | 版本管理 |
| **tmux** | `brew install tmux` | Agent Teams 并行执行 |

**首次使用前必须完成：**

```bash
# 登录 Claude Code（需要 Anthropic API key 或 Claude Pro/Team 订阅）
claude auth login
```

> `/botoolagent-update` 自动更新只需 `curl`（macOS/Linux 自带），无需 GitHub 账号。

### 安装到你的项目（一键安装）

在你的项目根目录执行以下命令：

```bash
cd my-project

# 自动下载最新版并安装
VERSION=$(curl -s https://api.github.com/repos/zbstctc/BotoolAgent/releases/latest | grep '"tag_name"' | sed 's/.*: "//;s/".*//')
curl -L -O "https://github.com/zbstctc/BotoolAgent/releases/download/${VERSION}/BotoolAgent-${VERSION}.tar.gz"
tar -xzf "BotoolAgent-${VERSION}.tar.gz"
cd BotoolAgent && ./setup.sh
```

`setup.sh` 会自动完成：
1. 安装 Viewer 的 npm 依赖
2. 设置脚本可执行权限
3. 将 7 个 Skills 以符号链接安装到 `~/.claude/skills/`

> **其他安装方式**：也可以手动从 [Releases](https://github.com/zbstctc/BotoolAgent/releases) 页面下载 tar.gz，或使用 `scripts/pack.sh` 生成分发包。

### 安装后验证

```bash
cd my-project
claude
# 在 Claude Code 中输入:
/botoolagent
```

浏览器会打开 Viewer 界面（`http://localhost:3100`），即表示安装成功。

### 后续更新

```bash
cd my-project
claude
# 在 Claude Code 中输入:
/botoolagent-update
```

自动从 GitHub 下载最新版，替换核心文件，保留你的项目数据（tasks/、rules/、logs/）。

## 两种运行模式

BotoolAgent 会自动检测所处模式（通过 `.git` 目录位置判断），无需手动配置。

### 独立模式

BotoolAgent 本身就是一个 git 仓库，直接在其中开发：

```
BotoolAgent/          <-- 就是项目本身
├── viewer/
├── prd.json
├── progress.txt
└── .git/
```

### 可移植模式（推荐）

BotoolAgent 作为子目录放在你的项目中：

```
my-project/           <-- 你的项目（git 仓库）
├── BotoolAgent/      <-- 工具包
│   ├── scripts/      <-- BotoolAgent.sh
│   ├── skills/       <-- 6 个 Claude Code Skill
│   ├── viewer/       <-- Next.js Web 界面
│   ├── tasks/        <-- PRD 文档存放
│   ├── rules/        <-- 编码规范文档
│   ├── .state/       <-- 运行时状态（agent-status, botoolrc 等）
│   ├── archive/      <-- 历史运行存档
│   ├── CLAUDE.md     <-- 项目级指令（auto-loaded）
│   └── CLAUDE.lead.md <-- Lead Agent 运行时指令
├── src/              <-- 你的代码
├── prd.json          <-- 自动生成到项目根目录
├── progress.txt      <-- 自动生成到项目根目录
└── .git/
```

## 完整工作流

### 5 阶段概览

| 阶段 | Skill | 功能 | 说明 |
|------|-------|------|------|
| Stage 1 | `/botoolagent-pyramidprd` | PRD 编写 | 5 层金字塔问答 + ASCII 可视化确认门控 |
| Stage 2 | `/botoolagent-prd2json` | 任务规划 | 规则选择 → Enrichment → testCases/evals/sessions → prd.json |
| Stage 3 | `/botoolagent-coding` | 自动开发 | Agent Teams 模式循环执行，实时监控 |
| Stage 4 | `/botoolagent-testing` | 测试验证 | 4 层自动验证 + Ralph 自动修复（默认 Agent Teams） |
| Stage 5 | `/botoolagent-finalize` | 合并发布 | 推送 → 创建 PR → Claude 代码审查 → Merge |

### 方式 A：Web Viewer

```bash
cd my-project && claude
# 输入:
/botoolagent
```

浏览器打开 `http://localhost:3100`，按 5 阶段引导操作。

### 方式 B：CLI Skills

```bash
cd my-project && claude

# Stage 1: 生成 PRD
/botoolagent-pyramidprd 做一个文档管理系统    # 支持 Quick Fix / 功能开发 / 完整规划 / PRD 导入

# Stage 2: PRD 转 JSON
/botoolagent-prd2json

# Stage 3: 启动自动开发
/botoolagent-coding

# Stage 4: 运行测试
/botoolagent-testing             # 从第 1 层开始
/botoolagent-testing 3           # 从第 3 层（E2E）开始

# Stage 5: 合并发布
/botoolagent-finalize
```

### 方式 C：纯命令行（跳过 Claude Code Skills）

```bash
./BotoolAgent/scripts/BotoolAgent.sh [--project-dir /path]
```

### 使用已有 PRD 的流程

如果你已经有一份写好的 PRD 文档（如 `v1.6_feature_PRD.md`），可以跳过 Stage 1：

```bash
# 1. 将 PRD 放入 tasks/ 目录
cp your-prd.md BotoolAgent/tasks/

# 2. 用 PRD2JSON 转换
/botoolagent-prd2json
# 选择你的 PRD 文件，转换为 prd.json

# 3. 启动自动开发
/botoolagent-coding
```

> PRD2JSON 会从 PRD 的开发计划章节提取任务，生成 `prdSection` 引用指回 PRD 原文。
> 编码代理在实现每个任务时，通过 `prdSection` 跳读 PRD 对应章节获取完整设计上下文。

## 核心概念

### PRD.md 是唯一真相源

```
PRD.md（完整设计文档）              prd.json（自动化索引）
========================           ========================
§ 1-8 完整设计内容                   project, branchName
§ 9 开发计划                         devTasks: [
  ## 9.1 Phase 1                       { id: "DT-001",
    - [ ] 创建数据库表                     prdSection: "9.1",  <-- 引用回 PRD
    - [ ] 验证 RLS 策略                    passes: false }
  ## 9.2 Phase 2                       { id: "DT-002",
    - [ ] 实现 CRUD API                    prdSection: "9.2",
    ...                                    dependsOn: ["DT-001"] }
                                       ]
                                     sessions: [...]
                                     constitution: { rules: [...] }
```

- **PRD.md** 保存完整设计（架构图、数据模型、UI 布局、业务规则）
- **prd.json** 只保存自动化所需字段（任务列表、依赖关系、通过状态）
- 编码代理通过 `prdSection` 字段跳读 PRD 对应章节获取实现细节

### 每次迭代 = 全新上下文

每次迭代启动一个**全新的 Claude 实例**，没有上一次的记忆。迭代之间的记忆靠：
- Git 历史（已提交的代码）
- `progress.txt`（发现的模式和教训，只追加）
- `prd.json`（任务完成状态 `passes: true/false`）
- `patterns.json`（可复用模式，按置信度加权）

### 执行架构

```
BotoolAgent.sh (Ralph 外循环, tmux)
  └─ Lead Agent (读取 CLAUDE.lead.md)
       ├─ 单任务 → Lead 直接执行
       └─ 多任务 → spawn teammates 并行
```

1. Lead Agent 读取 `prd.json` 中的 `sessions` 分组
2. 找到第一个有未完成任务的 session
3. 单任务 → Lead 直接执行；多任务 → 用 Task 工具 spawn teammates 并行
4. 外层 Ralph 循环（最多 5 轮）驱动 session 间切换

### Sessions：并行执行分组

PRD2JSON 会将任务按依赖关系和可并行性分成 sessions：

```json
{
  "sessions": [
    { "id": "S1", "tasks": ["DT-001"], "reason": "数据库初始化，必须先行" },
    { "id": "S2", "tasks": ["DT-002", "DT-003"], "reason": "文档库 + 版本管理，可并行" },
    { "id": "S3", "tasks": ["DT-004", "DT-005"], "reason": "导入导出 + 分类，可并行" }
  ]
}
```

同一 session 内的任务并行执行，session 间按顺序执行。

### 任务粒度要求

每个任务必须能在一次迭代中完成。太大的任务需要拆分。

| 合适 | 太大（需拆分） |
|------|---------------|
| 添加一个数据库表 | "构建整个仪表盘" |
| 实现一个 API 路由 | "添加用户认证" |
| 添加一个 UI 组件 | "重构 API 层" |
| 更新一个 Server Action | "实现完整翻译系统" |

### 停止条件

当所有任务的 `passes` 都为 `true` 时，代理输出 `<promise>COMPLETE</promise>` 并退出。

## 7 个 Skills

| Skill | 命令 | 用途 |
|-------|------|------|
| **Main** | `/botoolagent` | 启动 Web Viewer（localhost:3100） |
| **PyramidPRD** | `/botoolagent-pyramidprd` | 生成 PRD（Quick Fix / 功能开发 / 完整规划 / PRD 导入） |
| **PRD2JSON** | `/botoolagent-prd2json` | PRD → prd.json 转换 + Enrichment |
| **Coding** | `/botoolagent-coding` | 启动自动开发（Agent Teams + tmux） |
| **Testing** | `/botoolagent-testing` | 4 层自动验证 + Ralph 自动修复 |
| **Finalize** | `/botoolagent-finalize` | 推送 → PR → 审查 → 合并 → 清理 |
| **Update** | `/botoolagent-update` | 从 GitHub 拉取最新版本并自动更新 |

## 关键文件

| 文件 | 位置 | 说明 |
|------|------|------|
| `prd.json` | 项目根目录 | 自动化任务索引（passes 状态、依赖、sessions） |
| `progress.txt` | 项目根目录 | 迭代学习日志（只追加，含 Codebase Patterns） |
| `patterns.json` | BotoolAgent/ | 可复用模式库（置信度加权，自动淘汰） |
| `CLAUDE.md` | BotoolAgent/ | 项目级指令（Claude Code auto-loaded） |
| `CLAUDE.lead.md` | BotoolAgent/ | Lead Agent 运行时指令 |
| `BotoolAgent.sh` | scripts/ | Ralph 外循环 + tmux launcher |
| `pack.sh` | scripts/ | 打包分发脚本（生成 tar.gz + setup.sh） |
| `.botool-version` | BotoolAgent/ | 当前版本号标记 |
| `.botool-manifest.json` | BotoolAgent/ | 更新清单（核心文件 vs 用户数据） |
| `tasks/` | BotoolAgent/ | PRD 文档存放目录 |
| `rules/` | BotoolAgent/ | 编码规范文档（backend/frontend/testing） |
| `.state/` | BotoolAgent/ | 运行时状态（agent-status, botoolrc, 限流/熔断） |
| `archive/` | BotoolAgent/ | 历史运行存档（按日期 + 分支名） |
| `viewer/` | BotoolAgent/ | Next.js Web 界面（5 阶段 + 16 组 API） |
| `skills/` | BotoolAgent/ | 6 个 Claude Code Skill 定义 |

## 配置

### botoolrc

在 `.state/botoolrc` 自定义运行配置：

```bash
cp BotoolAgent/docs/examples/botoolrc.example BotoolAgent/.state/botoolrc
```

可配置项：

| 类别 | 配置项 | 默认值 |
|------|--------|--------|
| 轮次 | `BOTOOL_MAX_ROUNDS` | 5 |
| 冷却 | `BOTOOL_ROUND_COOLDOWN` | 10s |
| 卡住检测 | `BOTOOL_STALL_TIMEOUT` | 900s (15min) |
| 模型 | `CLAUDE_MODEL` / `CLAUDE_EFFORT` | opus / high |
| Teams 模式 | `BOTOOL_TEAMMATE_MODE` | in-process |

### 环境变量

| 变量 | 说明 |
|------|------|
| `BOTOOL_PROJECT_ROOT` | 覆盖自动检测的项目根目录 |
| `BOTOOL_MAX_ROUNDS` | 最大轮次（默认 5） |
| `BOTOOL_TEAMMATE_MODE` | Teams 模式: `in-process`（默认） |

## 韧性机制

| 机制 | 说明 |
|------|------|
| Ralph 外循环 | 最多 5 轮自动重启 session |
| Commit 监控 | 15 分钟无新 commit → kill session，启动下一轮 |
| Lead AI 接管 | Teammate 失败 → Lead Agent 直接完成该任务 |
| Rate limit 恢复 | Claude CLI 内部处理 + Lead Agent 等待重试 |
| 上下文管理 | Lead Agent 在批次间执行 /compact 释放上下文 |

测试阶段额外的 Ralph 自动修复：
- TypeCheck/Lint 失败 → 自动修复循环
- 单元测试失败 → 分析错误 + 修复 + 重跑
- Code Review 发现 HIGH 问题 → 自动修复
- 3 次修复无进展 → 触发熔断，询问用户

## 调试

```bash
# 查看任务状态
cat prd.json | jq '.devTasks[] | {id, title, passes}'

# 查看 sessions 分组
cat prd.json | jq '.sessions'

# 查看学习日志
cat progress.txt

# 查看最近提交
git log --oneline -10

# 查看代理实时状态
cat BotoolAgent/.state/agent-status | jq .

# 查看模式库
cat BotoolAgent/patterns.json | jq '.[] | select(.status=="active") | {trigger, action, confidence}'
```

## 打包分发

```bash
cd BotoolAgent
./scripts/pack.sh                    # 生成 BotoolAgent.tar.gz (~3MB)
./scripts/pack.sh my-custom-name     # 自定义输出名
```

分发包内容：
- scripts/（BotoolAgent.sh）
- skills/（7 个 SKILL.md）
- viewer/（源码，不含 node_modules/.next）
- rules/（编码规范模板）
- CLAUDE.md, CLAUDE.lead.md, README.md
- .botool-version, .botool-manifest.json（自动更新支持）
- setup.sh（自动生成，一键安装）

接收者解压后运行 `cd BotoolAgent && ./setup.sh` 一次即可。

## 版本管理与自动更新

BotoolAgent 使用 [Semantic Versioning](https://semver.org/)（`MAJOR.MINOR.PATCH`）。

### 版本号规则

版本号根据 Git commit 消息自动计算：

| Commit 前缀 | 版本变化 | 示例 |
|---|---|---|
| `fix:` | PATCH (1.0.0 -> 1.0.1) | bug 修复 |
| `feat:` | MINOR (1.0.0 -> 1.1.0) | 新功能 |
| `feat!:` / `BREAKING CHANGE:` | MAJOR (1.0.0 -> 2.0.0) | 破坏性变更 |

每次代码推送到 main 分支，GitHub Actions 自动：
1. 扫描 commit 消息，计算版本号
2. 创建 Git tag + GitHub Release
3. 打包分发包（`BotoolAgent-vX.Y.Z.tar.gz`）附在 Release 中

### 在目标项目中更新

```bash
cd my-project && claude
# 输入:
/botoolagent-update
```

更新流程：
1. 检查当前版本（`.botool-version`）
2. 查询 GitHub 最新 Release
3. 下载并替换核心文件（scripts/、skills/、viewer/ 等）
4. **保留**项目数据（tasks/、rules/、logs/、CLAUDE.md 等）
5. 重新安装依赖

> 只需 `curl` 和网络连接，无需 GitHub 账号（公开仓库）

### 查看当前版本

```bash
cat .botool-version      # 文件中的版本号
# 或查看 Viewer 左上角显示的版本号
```

## 参考

- [Geoffrey Huntley's Ralph pattern](https://ghuntley.com/ralph/)
- [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code)
