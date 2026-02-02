# Botool 开发代理指令

你是一个在 Botool 项目上工作的自主编程代理。

## 你的任务

1. 读取本目录下的 `prd.json` 文件
2. 读取 `progress.txt` 中的进度日志（先查看 Codebase Patterns 部分）
3. 检查你是否在 PRD 中指定的 `branchName` 分支上。如果不是，切换到该分支或从 main 创建
4. 选择优先级最高且 `passes: false` 的开发任务
5. 实现该单个开发任务
6. 运行质量检查（如 typecheck、lint、test - 使用项目所需的检查工具）
7. 如果发现可复用的模式，更新 CLAUDE.md 文件（见下文）
8. 如果检查通过，提交所有更改，提交信息格式：`feat: [任务ID] - [任务标题]`
9. **推送到远程**：`git push origin <branchName>` - 确保进度同步到 GitHub
10. 更新 PRD，将已完成任务的 `passes` 设为 `true`
11. 将进度追加到 `progress.txt`

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

## 整合模式

如果你发现了未来迭代应该知道的**可复用模式**，将其添加到 progress.txt 顶部的 `## Codebase Patterns` 部分（如果不存在则创建）。这个部分应该整合最重要的经验：

```
## Codebase Patterns
- 示例：聚合查询使用 `sql<number>` 模板
- 示例：迁移脚本始终使用 `IF NOT EXISTS`
- 示例：从 actions.ts 导出类型供 UI 组件使用
```

只添加**通用且可复用**的模式，不要添加特定任务的细节。

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

当编写 React / React Native / Expo / Next.js 代码时，**必须先读取并遵循相应的规范文件**：

### React Native / Expo 项目

在编写任何 React Native 代码之前，使用 Read 工具读取：
```
~/.claude/commands/vercel-react-native-skills/AGENTS.md
```

**必须严格遵守的关键规则：**

1. **CRITICAL - 违反会崩溃：**
   - 不要用 `{value && <Component />}` 当 value 可能是 0 或空字符串，用三元表达式
   - 字符串必须包裹在 `<Text>` 组件中

2. **HIGH - 性能关键：**
   - 列表必须使用 FlashList 或 LegendList，禁止 `ScrollView + map`
   - 列表项必须使用 `memo()`
   - 动画只能用 `transform` 和 `opacity`，禁止动画 width/height/margin
   - 使用 `createNativeStackNavigator`，禁止 JS stack
   - 使用 `Pressable`，禁止 `TouchableOpacity`
   - 使用 `expo-image` 而非 `react-native` 的 Image

3. **MEDIUM - 推荐：**
   - 使用 `gap` 而非 margin 来控制间距
   - 使用 `borderCurve: 'continuous'` 配合 borderRadius
   - 列表项只传递原始值（primitives），不传对象

### Web UI 项目 (Next.js / React)

完成 UI 代码后，使用 Read 工具读取：
```
~/.claude/commands/web-design-guidelines/SKILL.md
```

然后按照其中的说明获取最新规则并审查你的代码。

### 如何应用规范

1. **开始写前端代码前**：先读取对应的规范文件
2. **写代码时**：遵循规范中的 Correct 模式，避免 Incorrect 模式
3. **提交前**：检查代码是否符合 CRITICAL 和 HIGH 级别的规则
