# BotoolAgent

BotoolAgent 是一个自主 AI 开发代理，通过循环运行 Claude Code 来完成 PRD 中定义的所有开发任务。每次迭代是一个全新的 Claude 实例，通过 git 历史、`progress.txt` 和 `prd.json` 保持记忆。

提供两种使用方式：
- **Web Viewer** — 5 阶段可视化工作流，适合非技术用户
- **CLI Skills** — 在终端通过 `/botoolagent` 命令使用，适合开发者

## 快速开始

### 前置条件

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- Node.js 18+
- Git

### 安装到你的项目

**方式 1：使用分发包（推荐）**

```bash
# 生成分发包
cd BotoolAgent && ./pack.sh

# 将分发包给团队成员，他们在自己的项目中：
tar -xzf BotoolAgent.tar.gz
cd BotoolAgent && ./setup.sh
```

**方式 2：手动复制**

```bash
# 将 BotoolAgent 目录复制到你的项目中
cp -r /path/to/BotoolAgent your-project/BotoolAgent

# 安装 Viewer 依赖
cd your-project/BotoolAgent/viewer && npm install
```

### 安装 Skills

Skills 让你在任何项目中通过 Claude Code 调用 BotoolAgent：

```bash
# 复制 skills 到 Claude Code 用户目录
cp -r BotoolAgent/skills/BotoolAgent/* ~/.claude/skills/
```

安装后，在任何项目的 Claude Code 中都可以使用：
- `/botoolagent` — 启动 Web Viewer
- `/botoolagent-generateprd` — 生成 PRD
- `/botoolagent-prd2json` — PRD 转 JSON
- `/botoolagent-coding` — 启动自动开发监控

## 两种使用模式

### 独立模式

BotoolAgent 本身就是一个 git 仓库，直接在其中开发：

```
BotoolAgent/          ← 就是项目本身
├── viewer/
├── prd.json
├── progress.txt
└── .git/
```

### 可移植模式（推荐）

BotoolAgent 作为子目录放在你的项目中：

```
my-project/           ← 你的项目（git 仓库）
├── BotoolAgent/      ← 工具包
│   ├── viewer/       ← Web 界面
│   ├── tasks/        ← PRD 文档存放
│   ├── rules/        ← 编码规范
│   ├── BotoolAgent.sh
│   └── setup.sh
├── src/              ← 你的代码
├── prd.json          ← 自动生成到项目根目录
├── progress.txt      ← 自动生成到项目根目录
└── .git/
```

BotoolAgent 会自动检测所处模式（通过 `.git` 目录位置判断），无需手动配置。

## 工作流

### 方式 A：Web Viewer（5 阶段）

```bash
# 在你的项目中启动 Claude Code
cd my-project
claude

# 输入
/botoolagent
```

浏览器会打开 `http://localhost:3000`，进入 5 阶段工作流：

| 阶段 | 功能 | 说明 |
|------|------|------|
| Stage 1 | PRD 编写 | 通过 4 层金字塔问答收集需求，生成 PRD |
| Stage 2 | 任务规划 | 规则检查 → 代码示例 → 测试用例 → JSON 转换 |
| Stage 3 | 自动开发 | 实时监控代理执行、任务进度、文件变更 |
| Stage 4 | 测试验证 | 自动化测试 + 手动验收清单 |
| Stage 5 | 合并发布 | 创建 PR、代码审查、Squash Merge |

### 方式 B：CLI Skills

```bash
# 1. 生成 PRD
/botoolagent-generateprd 做一个用户登录功能

# 2. 转换为 JSON
/botoolagent-prd2json

# 3. 运行自动开发
./BotoolAgent/BotoolAgent.sh 10
```

### 方式 C：纯命令行

```bash
# 直接运行代理（需要先手动创建 prd.json）
./BotoolAgent/BotoolAgent.sh [最大迭代次数]

# 指定项目目录（可选）
./BotoolAgent/BotoolAgent.sh 10 --project-dir /path/to/project
```

## 关键文件

| 文件 | 位置 | 说明 |
|------|------|------|
| `prd.json` | 项目根目录 | 开发任务列表，含 `passes` 状态 |
| `progress.txt` | 项目根目录 | 迭代学习日志（只追加） |
| `BotoolAgent.sh` | BotoolAgent/ | 代理循环脚本 |
| `CLAUDE.md` | BotoolAgent/ | 代理指令（每次迭代读取） |
| `tasks/` | BotoolAgent/ | PRD 文档存放目录 |
| `rules/` | BotoolAgent/ | 编码规范文档 |
| `archive/` | BotoolAgent/ | 历史运行存档 |
| `viewer/` | BotoolAgent/ | Next.js Web 界面 |
| `skills/` | BotoolAgent/ | Claude Code Skill 定义 |

## 核心概念

### 每次迭代 = 全新上下文

每次迭代启动一个**全新的 Claude 实例**，没有上一次的记忆。迭代之间的记忆靠：
- Git 历史（已提交的代码）
- `progress.txt`（发现的模式和教训）
- `prd.json`（任务完成状态）

### 任务要小

每个 PRD 任务必须能在一次迭代中完成。如果任务太大，Claude 会在完成前耗尽上下文。

合适的任务大小：
- 添加一个数据库表和迁移
- 在现有页面添加一个 UI 组件
- 更新一个 Server Action 的逻辑
- 添加一个过滤下拉框

太大的任务（需要拆分）：
- "构建整个仪表盘"
- "添加用户认证"
- "重构 API"

### 反馈循环

代理依赖反馈循环来保证质量：
- TypeCheck 捕获类型错误
- 测试验证行为
- CI 必须保持绿色

### 停止条件

当所有任务的 `passes` 都为 `true` 时，代理输出 `<promise>COMPLETE</promise>` 并退出。

## 配置

### .botoolrc

在 BotoolAgent 目录创建 `.botoolrc` 自定义配置：

```bash
cp BotoolAgent/.botoolrc.example BotoolAgent/.botoolrc
```

可配置项：超时时间、重试次数、Rate Limiting、Circuit Breaker、通知等。

### 环境变量

| 变量 | 说明 |
|------|------|
| `BOTOOL_PROJECT_ROOT` | 覆盖自动检测的项目根目录 |
| `BOTOOL_MAX_ITERATIONS` | 最大迭代次数 |
| `BOTOOL_TIMEOUT` | 每次迭代超时（秒） |

## 调试

```bash
# 查看任务状态
cat prd.json | jq '.devTasks[] | {id, title, passes}'

# 查看学习日志
cat progress.txt

# 查看最近提交
git log --oneline -10

# 查看代理状态
cat BotoolAgent/.agent-status | jq .
```

## 打包分发

```bash
cd BotoolAgent
./pack.sh                    # 生成 BotoolAgent.tar.gz (~3MB)
./pack.sh my-custom-name     # 自定义输出名
```

分发包不含 `node_modules` 和构建缓存，接收者解压后运行 `./setup.sh` 一次即可。

## 参考

- [Geoffrey Huntley's Ralph pattern](https://ghuntley.com/ralph/)
- [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code)
