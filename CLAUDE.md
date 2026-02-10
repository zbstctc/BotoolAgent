# Botool 开发代理指令

你是一个在 Botool 项目上工作的自主编程代理。

## 你的任务

1. 读取 `PROJECT.md`（如果存在）— 了解项目全局
2. 读取 `.project-status`（如果存在）— 了解当前状态
3. 读取 `patterns.json`（如果存在）— 了解累积经验，按 confidence 降序，只读 `status: "active"`
4. 读取本目录下的 `prd.json` 文件：
   a. 读取 `constitution.rules`（如果存在）— 了解项目编码规范（Constitution 层）
   b. 读取 `progress.txt` 中的 Codebase Patterns（fallback，如果 patterns.json 不存在）
5. 检查你是否在 PRD 中指定的 `branchName` 分支上。如果不是，切换到该分支或从 main 创建
6. 选择优先级最高且 `passes: false` 的开发任务
7. 读取该任务的 `spec` 字段（如果存在）：
   - `spec.codeExamples` → 期望的代码结构
   - `spec.testCases` → 需要通过的测试场景
8. 读取该任务的 `evals` 字段（如果存在）
9. 执行上下文检索（见下文"上下文检索"部分）
10. 实现该单个开发任务
11. 运行 evals（见下文"Eval 执行"部分）
12. 执行 Spec 对照检查（见下文"Spec 对照检查"部分）
13. 运行质量检查（如 typecheck、lint、test - 使用项目所需的检查工具）
14. 如果发现可复用的模式，更新 `patterns.json`（优先）或 CLAUDE.md 文件（见下文）
15. 如果检查通过，提交所有更改，提交信息格式：`feat: [任务ID] - [任务标题]`
16. **推送到远程**：`git push origin <branchName>` - 确保进度同步到 GitHub
17. 更新 prd.json（将已完成任务的 `passes` 设为 `true`）+ 更新 `.project-status`
18. 将进度追加到 `progress.txt`

## 进度报告格式

追加到 progress.txt（永远不要替换，只能追加）：
```
## [日期/时间] - [任务ID]
- 实现了什么
- 修改了哪些文件
- **未来迭代的经验教训：**
  - 发现的模式（例如："这个代码库使用 X 来做 Y"）
  - 遇到的坑（例如："修改 W 时不要忘记更新 Z"）
  - 有用的上下文（例如："评估面板在组件 X 中"）
---
```

经验教训部分非常关键 - 它帮助未来的迭代避免重复错误并更好地理解代码库。

## 上下文检索（实现前）

1. 读取当前任务的 `spec.filesToModify` 和 `spec.relatedFiles`
2. 如果存在，直接读取这些文件
3. 如果为空或不存在，执行搜索：
   a. 用任务关键词搜索相关文件
   b. 只深度阅读高相关性文件（最多 5 个）
4. 如果有 `dependsOn`，读取依赖任务在 progress.txt 中的日志
5. 如果有 `contextHint`，按提示重点关注特定上下文

## Eval 执行（提交前）

如果当前任务有 `evals` 字段：
1. 运行所有 eval
2. code-based eval（`blocking: true`）：失败 → 必须修复，不可提交
3. model-based eval（`blocking: false`）：不满足 → 记录警告，不阻塞
4. 将 eval 结果写入 progress.txt

## Spec 对照检查（提交前）

1. typecheck 通过
2. lint 通过
3. test 通过
4. evals 通过（blocking 类型必须全部通过）
5. 逐条核对 acceptanceCriteria：
   - 每条标注：✅ 已满足 / ❌ 未满足（附原因）/ ⬚ 不适用
   - 检查 `spec.testCases` 覆盖情况
   - 检查 `spec.codeExamples` 符合度
   - 检查 `constitution.rules` 遵循情况
   - 将结果写入 progress.txt

## 整合模式

如果你发现了未来迭代应该知道的**可复用模式**：

**优先写入 `patterns.json`**（如果存在）— 详见下文"更新 patterns.json"部分。

**Fallback**：如果 `patterns.json` 不存在，将模式添加到 progress.txt 顶部的 `## Codebase Patterns` 部分（如果不存在则创建）：

```
## Codebase Patterns
- 示例：聚合查询使用 `sql<number>` 模板
- 示例：迁移脚本始终使用 `IF NOT EXISTS`
- 示例：从 actions.ts 导出类型供 UI 组件使用
```

只添加**通用且可复用**的模式，不要添加特定任务的细节。

## 更新 patterns.json

完成任务后，如果发现了可复用的模式：

1. 读取 patterns.json
2. 检查是否已有相似 pattern（同 trigger）：
   - 有 → 增加 evidence，更新 confidence 和 lastValidated
   - 无 → 创建新 pattern，confidence: 0.3
3. 置信度规则：
   - 0.3 — 首次发现
   - 0.6 — 2+ 条证据
   - 0.9 — 3+ 条证据且近期验证
   - >= 0.8 → 硬性规则（必须遵循）
   - < 0.8 → 建议
4. 淘汰：总条目 > 30 时，confidence < 0.4 且 30 天未验证 → status: "deprecated"
5. 领域分类（domain）：database, frontend, backend, security, testing, general
6. 每领域最多 10 条 active

Pattern 结构：
```json
{
  "id": "pat-NNN",
  "trigger": "触发条件",
  "action": "应该做什么",
  "confidence": 0.3,
  "domain": "general",
  "evidence": ["来源"],
  "status": "active",
  "createdAt": "YYYY-MM-DD",
  "lastValidated": "YYYY-MM-DD"
}
```

## 更新 CLAUDE.md 文件

提交前，检查修改的文件是否有值得保存到附近 CLAUDE.md 文件中的经验：

1. **识别有修改文件的目录** - 查看你修改了哪些目录
2. **检查是否有现有的 CLAUDE.md** - 在这些目录或父目录中查找
3. **添加有价值的经验** - 如果你发现了未来开发者/代理应该知道的内容：
   - 该模块特有的 API 模式或约定
   - 坑或非显而易见的要求
   - 文件之间的依赖关系
   - 该区域的测试方法
   - 配置或环境要求

**好的 CLAUDE.md 添加示例：**
- "修改 X 时，也要更新 Y 以保持同步"
- "这个模块的所有 API 调用都使用模式 Z"
- "测试需要开发服务器在 PORT 3000 上运行"
- "字段名必须与模板完全匹配"

**不要添加：**
- 特定任务的实现细节
- 临时调试笔记
- progress.txt 中已有的信息

只有当你有**真正可复用的知识**能帮助该目录未来的工作时，才更新 CLAUDE.md。

## 质量要求

- 所有提交必须通过项目的质量检查（typecheck、lint、test）
- 不要提交有问题的代码
- 保持更改集中且精简
- 遵循现有的代码模式

## 浏览器测试（如果可用）

对于任何更改 UI 的任务，如果配置了浏览器测试工具（如 Playwright MCP），请在浏览器中验证：

1. 导航到相关页面
2. 验证 UI 更改按预期工作
3. 如果对进度日志有帮助，截个图

如果没有浏览器工具，在进度报告中注明需要手动浏览器验证。

## 停止条件

完成开发任务后，检查是否所有任务的 `passes` 都为 `true`。

如果所有任务都已完成并通过，回复：
<promise>COMPLETE</promise>

如果还有 `passes: false` 的任务，正常结束你的回复（另一次迭代会处理下一个任务）。

## 重要提醒

- 每次迭代只处理一个任务
- 频繁提交
- 保持 CI 绿色
- 开始前先阅读 progress.txt 中的 Codebase Patterns 部分

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
4. **Stage 4 - 测试验证**：运行测试并进行手动验证
5. **Stage 5 - 合并发布**：代码审查和合并
