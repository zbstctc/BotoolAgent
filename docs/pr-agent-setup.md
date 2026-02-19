# PR-Agent SaaS 配置指南

本文档说明如何为 BotoolAgent 配置 PR-Agent SaaS，以启用 Testing Layer 6 的 PR-Agent 自动守门功能。

## 什么是 PR-Agent？

[PR-Agent](https://www.codium.ai/products/git-plugin/) (by CodiumAI) 是一个 AI 驱动的 PR 审查工具。BotoolAgent 在 Testing Layer 6 中利用 PR-Agent SaaS 对 Pull Request 进行自动审查，发现潜在问题后触发修复循环。

> PR-Agent 是**可选**的。如果未配置，Layer 6 中的 PR-Agent 守门步骤会被跳过，不影响其他层的执行。

## 配置步骤

### 1. 注册 CodiumAI 账号

1. 访问 [https://app.qodo.ai/](https://app.qodo.ai/)
2. 使用 GitHub 账号登录（推荐），或创建新账号
3. 完成邮箱验证

### 2. 安装 GitHub App

1. 登录后，进入 [PR-Agent GitHub App](https://github.com/apps/qodo-merge-pro) 页面
2. 点击 **Install**
3. 选择要启用的仓库：
   - **All repositories** — 所有仓库均启用
   - **Only select repositories** — 仅选择特定仓库（推荐）
4. 点击 **Install** 确认

### 3. 验证安装

安装完成后，在任意已启用仓库中创建一个 PR，PR-Agent 应自动在几分钟内添加审查评论。

评论格式通常为：
- `/review` — 代码审查摘要
- `/describe` — PR 描述增强
- `/improve` — 改进建议

## BotoolAgent 集成方式

### 自动等待和解析

BotoolAgent 的 Testing Layer 6 在创建 PR 后会执行以下流程：

1. **创建 PR** — 使用 `gh pr create` 创建 Pull Request
2. **等待 PR-Agent** — 每 10 秒轮询 PR 评论，最多等待 60 秒
3. **解析评论** — 从 PR-Agent 的 `/review` 评论中提取 HIGH severity 问题
4. **修复循环** — 如果存在 HIGH 问题：
   - 自动修复代码
   - 重新 push 到分支
   - 等待 PR-Agent 重新审查
   - 最多 2 轮修复循环
5. **收敛判断** — 无 HIGH 问题后标记层通过

### 评论解析逻辑

BotoolAgent 通过 `gh api` 读取 PR 评论，匹配以下模式：

- 评论作者包含 `pr-agent` 或 `qodo` 关键词
- 评论内容包含 severity 标记（如 `Major`、`Critical`）
- 提取文件路径和问题描述

### 超时和降级

| 场景 | 行为 |
|------|------|
| PR-Agent 未安装 | 跳过守门步骤，不阻塞 |
| 等待超时（60s） | 标记为 skipped，继续 |
| 评论无法解析 | 标记为 skipped，继续 |
| 修复 2 轮后仍有 HIGH | 停止循环，记录未解决问题 |

## 常见问题

### PR-Agent 没有自动评论？

1. 确认 GitHub App 已安装在目标仓库
2. 检查仓库的 Settings > Integrations > GitHub Apps 中是否有 PR-Agent
3. 确认 PR 是在安装 App **之后**创建的

### 可以使用自托管 PR-Agent 吗？

BotoolAgent 当前设计针对 SaaS 版本。自托管版本理论上兼容（评论格式相同），但未经测试。

### PR-Agent 评论格式变化怎么办？

BotoolAgent 使用正则匹配 + fallback 策略。如果评论格式无法解析，该层会被标记为 `skipped`，不会阻塞流水线。
