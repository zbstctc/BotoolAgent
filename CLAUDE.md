# BotoolAgent 项目指令

BotoolAgent 是一个自主 AI 开发代理，通过 tmux + Agent Teams 模式循环执行开发任务。

## 架构概要

- **`scripts/BotoolAgent.sh`** — Ralph 外循环 (tmux launcher)，驱动 Lead Agent 执行
- **`CLAUDE.lead.md`** — Lead Agent 运行时指令（被 BotoolAgent.sh 显式读取）
- **`viewer/`** — Next.js Web 界面（5 阶段工作流）
- **`skills/`** — 6 个 Claude Code Skill

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

### 如何应用

1. **开始写前端代码前**：执行对应的 Skill
2. **写代码时**：遵循 Skill 输出的 Correct 模式
3. **提交前**：确保代码符合 CRITICAL 和 HIGH 级别的规则

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
