# Draft: BotoolAgent 文档架构 v2

> Stage 0 头脑风暴产出 | 日期: 2026-02-24

## 定位

重构 BotoolAgent 的文档输出架构，将当前的单一 `prd.md + prd.json（slim）` 改为三件套 `prd.md（纯设计）+ dev.md（人读 DT）+ dev.json（机读胖 DT）`，从根本上解决 PyramidPRD Transform Mode 在大型 PRD 中丢失细节的问题。

## 背景与动机

### 现状问题

在对 `botool-present-v16` PRD 进行完整比对后，发现 PyramidPRD Transform Mode 存在严重的细节丢失：

1. **UUID vs INT 类型漂移** — AI 在生成 PRD 时将所有新表的 PK 从 `SERIAL/INT`「现代化」为 `UUID`，与源表 `botool_users.id INT` 的外键链断裂
2. **字段丢失** — `present_versions` 缺失 7 个字段，`present_translations` 缺失 9 个进度字段
3. **约束丢失** — 3 个互斥 CHECK 约束全部缺失，关键触发器 `check_slot_version_group_consistency()` 缺失
4. **RLS 逻辑错误** — 生成的 RLS 使用 `status = 'published'`（错误），源 PRD 使用 `is_published = TRUE`

### 为什么 T7 给出假通过

T7 的检查是**数量级检查**（CREATE TABLE 数量、总行数），不是**质量检查**（字段数量、约束完整性）。12/12 表存在，2031 行 ≥ 2000 行阈值 → 全部 ✅，但字段错误完全检测不到。

### 根本原因

当前架构中 `prd.md` 同时承担「设计文档」和「开发计划（§7 DT）」两种职责，且 `prd.json` 是 slim 格式（只有 `prdSection` 指针，无实际验收标准），导致：
- AI 重写 §7 时顺带「优化」了 SQL（UUID 漂移）
- Lead Agent 需要回读 prd.md 获取验收标准（上下文消耗大）
- T7 无法校验 DT 的字段级覆盖率

## 核心功能

1. **PRD_User_Original.md 备份** — Transform Mode 下，将用户原始 PRD 复制为不可修改的备份
2. **prd.md 职责重新划定** — 只含 §1-§6+§8（纯设计），不含 §7（开发计划）；PyramidPRD 对其有完全修改权
3. **dev.md 新文件** — 人读版开发计划，含 Phase 结构、DT 列表、依赖关系
4. **dev.json 胖格式** — 机读版 DT，含字段级验收标准（`acceptanceCriteria`）、`designRefs` 指针、`dependsOn` 依赖链
5. **T7 重写** — 从数量检查升级为 DT 字段级覆盖验证：对每个 DT 抽查其涉及的关键字段是否出现在 prd.md 对应章节
6. **Lead Agent 升级** — 以胖模式（`dev.json` 中的 `acceptanceCriteria`）为主，slim 模式（`prdSection` 指针）为向后兼容 legacy

## 技术方向

- **技术栈**: Markdown + JSON（无代码）
- **修改范围**:
  - `skills/BotoolAgent/PyramidPRD/SKILL.md` — 主要修改
  - `skills/BotoolAgent/PRD2JSON/SKILL.md` — 输出格式重写
  - `CLAUDE.lead.md` — 胖模式升为主模式
- **关键决策**:
  - Transform Mode：原始 PRD → `PRD_User_Original.md`（完整备份，不动），PyramidPRD 在此基础上生成/修改 `prd.md`，完全自由
  - `prd.json` 彻底废弃，改为 `dev.json`（胖格式）
  - `dev.md` 独立文件，不是 prd.md 的一部分

## 目标用户

- **主要用户**: BotoolAgent 开发者（boszan）+ 所有使用 PyramidPRD Skill 的用户
- **使用场景**: 导入大型用户 PRD（>5000 行），期望转换后不丢失任何设计细节

## 范围边界

### 要做的

- **PyramidPRD SKILL.md**:
  - Phase T1：新增备份步骤（cp source → PRD_User_Original.md）
  - Phase 7：生成 prd.md（无 §7）+ dev.md + dev.json（胖格式）
  - T7：重写为 DT 字段级覆盖验证（抽查关键字段是否出现在 prd.md）
  - T2.5：补充字段数校验（不只检查表名）

- **PRD2JSON SKILL.md**:
  - 输出目标文件改为 `dev.json`（胖格式）+ `dev.md`（人读版）
  - `dev.json` schema 定义：`id, title, phase, description, acceptanceCriteria[], designRefs[], dependsOn[], files[]`
  - 更新 registry.json 写入路径

- **CLAUDE.lead.md**:
  - 胖模式升为主模式（优先读 `dev.json` 的 `acceptanceCriteria`）
  - slim 模式（prdFile + prdSection 指针）降为 legacy 向后兼容
  - 路径查找：优先 `dev.json`，fallback 到 `prd.json`（兼容旧项目）

### 不做的（YAGNI）

- 不修改 viewer 前端显示（dev.md/dev.json 的可视化留后续）
- 不修改 botoolagent-coding skill（Lead Agent 逻辑在 CLAUDE.lead.md）
- 不拆分 prd.md 为多个 Phase 文件（单文件管理更简单）
- 不修改 testing / finalize skill（它们不依赖文件名）

## 成功标准

- [ ] Transform Mode 处理 8000+ 行 PRD 后，生成的 prd.md 中 CREATE TABLE 字段数 ≥ 源 PRD 的 95%（T7 可验证）
- [ ] dev.json 中每个 DT 有 ≥ 3 条 `acceptanceCriteria`，Lead Agent 无需回读 prd.md 即可执行
- [ ] CLAUDE.lead.md 优先读 `dev.json`，兼容旧 `prd.json`（有 fallback）
- [ ] 重新转换 botool-present-v16：UUID 问题消失，字段完整
- [ ] `prd.json` 这个文件名在新项目中不再出现（全部改为 `dev.json`）

## 开放问题

- `dev.json` 中 `designRefs` 的格式：`{ section: "§4.2", lines: "230-280" }` 还是只需要 section？
- `dev.md` 是否需要 frontmatter 让 viewer 可以解析？（暂时先纯 Markdown）
- T7 DT 字段级抽查：抽多少个字段算充分？（建议 3-5 个关键字段/DT）

---

## 三件套文件结构（新架构）

```
tasks/<projectId>/
  prd.md                  ← §1-§6+§8 纯设计文档（无 §7）
  dev.md                  ← 人读版 Phase/DT 开发计划
  dev.json                ← 机读版胖格式 DT（含字段级验收标准）
  PRD_User_Original.md    ← Transform Mode 专用：原始 PRD 完整备份（只读）
  SOURCE_PRD.ref          ← Transform Mode 专用：源文件路径引用
  progress.txt            ← 运行时进度（不变）
```

---

> 下一步: 使用 `/botoolagent-pyramidprd` 导入此 Draft，生成完整 PRD
