# BotoolAgent 项目指令

> **语言规定**: 所有与用户的交互必须使用**中文**，严禁使用韩文或其他语言。代码注释、commit message、PR 描述等技术内容可用英文。

BotoolAgent 是一个自主 AI 开发代理，通过 tmux + Agent Teams 模式循环执行开发任务。

> **审查规范**: See @AGENTS.md — 所有 AI 代理（Claude、Codex 等）的统一审查规范，包含构建命令、架构约定、代码风格、安全红线。

## 架构概要

- **`scripts/BotoolAgent.sh`** — Ralph 外循环 (tmux launcher)，驱动 Lead Agent 执行
- **`CLAUDE.lead.md`** — Lead Agent 运行时指令（被 BotoolAgent.sh 显式读取）
- **`viewer/`** — Next.js Web 界面（5 阶段工作流）
- **`skills/`** — 8 个 Claude Code Skill
- **`scripts/pack.sh`** — 分发打包脚本，生成 tar.gz 包含自动生成的 `setup.sh`

## 分发与安装流程

`scripts/pack.sh` 负责将 BotoolAgent 打包为可分发的 tar.gz。打包时会**自动生成 `setup.sh`** 嵌入包中。

**流程**：`pack.sh` 打包 → 用户解压到目标项目 → 运行 `./setup.sh` → 自动安装依赖 + 创建 `~/.claude/skills/` symlinks

**`setup.sh` 自动完成的事情**：
- `npm ci` 安装 viewer 依赖
- 遍历 `skills/BotoolAgent/*/SKILL.md`，在 `~/.claude/skills/` 下创建 symlink
- 修复 lightningcss 原生绑定（如缺失）

**修改 skill、viewer 端口、文件结构时需同步考虑**：
- 新增/删除 skill → `pack.sh` 会自动包含 `skills/` 目录，`setup.sh` 会自动遍历注册
- 修改 viewer 端口 → skills 中使用端口自动检测（`[ -d BotoolAgent/viewer ]` 判断运行环境）
- 修改核心文件列表 → 同步更新 `.botoolagent-manifest.json` 的 `core` 数组

## 质量要求

- 所有提交必须通过项目的质量检查（typecheck、lint、test）
- 不要提交有问题的代码
- 保持更改集中且精简
- 遵循现有的代码模式

## 前端代码规范

当编写 React / React Native / Expo / Next.js 代码时，**必须先执行相应的 Skill**：

### React Native / Expo 项目

在编写任何 React Native 代码之前，**使用 Skill 工具执行**：
```
Skill: vercel-react-native-skills
```

执行后会加载完整的 React Native 最佳实践规范。**严格按照 skill 的指引操作**。

**最关键的规则速记（必须牢记）：**

1. **CRITICAL - 违反会崩溃：**
   - 不要用 `{value && <Component />}` 当 value 可能是 0 或空字符串
   - 字符串必须包裹在 `<Text>` 组件中

2. **HIGH - 性能关键：**
   - 列表必须使用 FlashList 或 LegendList，禁止 `ScrollView + map`
   - 列表项必须使用 `memo()`
   - 动画只能用 `transform` 和 `opacity`
   - 使用 `Pressable`，禁止 `TouchableOpacity`

### Web UI 项目 (Next.js / React)

完成 UI 代码后，**使用 Skill 工具执行**：
```
Skill: web-design-guidelines
```

执行后会指导你获取最新的 Web UI 规范并审查代码。**严格按照 skill 的指引操作**。

### shadcn/ui 组件规范 (Viewer 项目)

Viewer 使用 **shadcn/ui (new-york 风格)** + **Tailwind v4** + **CSS 变量** 作为 UI 基础。

#### 组件使用优先级

1. **必须优先使用** `@/components/ui/` 下的 shadcn 组件
2. **禁止新建** 自定义 modal / dialog / dropdown（使用 shadcn 对应组件）
3. 如需新增 shadcn 组件，用 `npx shadcn@latest add <component>` 安装

#### 已安装的 shadcn 组件

`button` · `dialog` · `badge` · `input` · `textarea` · `label` · `tabs` · `popover`

需要更多组件时从 [shadcn/ui](https://ui.shadcn.com) 安装，不要手写。

#### Dialog 正确用法

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>标题</DialogTitle>
    </DialogHeader>
    {/* 内容 */}
    <DialogFooter>
      <Button variant="ghost" onClick={() => setIsOpen(false)}>取消</Button>
      <Button onClick={handleConfirm}>确认</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**禁止** 使用 `<div className="fixed inset-0 ...">` 手写 modal。

#### 样式规范

- **类名合并**：使用 `cn()` from `@/lib/utils`，不要手动拼接
- **颜色系统**：Rock 岩石色系（全 neutral，无蓝色 accent），通过 CSS 变量引用
  - 使用语义化变量：`bg-background`、`text-foreground`、`border-border` 等
  - 不要硬编码颜色值，使用 `--primary`、`--muted`、`--accent` 等变量
- **图标**：统一使用 `lucide-react`，不要引入其他图标库
- **圆角**：使用 `rounded-lg`（映射到 `--radius`），不要硬编码 `rounded-xl` 等

#### Badge 自定义变体

除 shadcn 默认变体外，项目额外定义了：
- `success` — 绿色（bg-green-100 text-green-700）
- `warning` — 琥珀色（bg-amber-100 text-amber-700）
- `error` — 红色（bg-red-100 text-red-700）
- `neutral` — 中性灰（bg-neutral-100 text-neutral-600）

### 如何应用

1. **开始写前端代码前**：执行对应的 Skill
2. **写代码时**：优先使用 shadcn 组件，遵循 Skill 输出的 Correct 模式
3. **提交前**：确保没有新增自定义 modal，代码符合 CRITICAL 和 HIGH 级别的规则

## BotoolAgent Viewer

### 产品定位

BotoolAgent Viewer 是一个 **Web 界面**，旨在让**非开发者**（业务员、项目经理、领域专家）能够使用自然语言来开发自己的工具。

### 目标用户

- **业务人员**：需要自动化工作流但没有编程经验
- **领域专家**：了解业务需求，希望将想法快速转化为工具
- **工程师（非软件）**：有技术背景但不熟悉现代软件开发

### 使用场景

1. **工具开发**：用户用自然语言描述想要的工具功能，系统引导完成 PRD 编写
2. **自动实现**：系统自动生成代码、运行测试、处理合并
3. **进度追踪**：可视化展示开发进度，用户可以随时查看和恢复项目

### 与 CLI Skills 的关系

BotoolAgent 提供两种使用方式：

| 方式 | 用户群体 | 使用方法 |
|------|----------|----------|
| **CLI Skills** | 开发者 | 在终端中使用 `/botoolagent` 等命令 |
| **Viewer Web UI** | 非开发者 | 通过浏览器访问图形界面 |

- **CLI Skills** 适合熟悉命令行的开发者，提供更灵活的控制
- **Viewer** 适合非技术用户，提供引导式的 5 阶段工作流

### Viewer 的 5 阶段工作流

1. **Stage 1 - PRD 编写**：通过问答对话生成 PRD
2. **Stage 2 - 任务规划**：将 PRD 转换为可执行的开发任务
3. **Stage 3 - 自动开发**：代理自动实现代码
4. **Stage 4 - 测试验证**：运行 4 层自动验证（手动验收由用户在 finalize 前自行执行）
5. **Stage 5 - 合并发布**：代码审查和合并
