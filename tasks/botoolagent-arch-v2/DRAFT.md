# Draft: BotoolAgent 文档架构 v2

> Stage 0 头脑风暴产出 | 日期: 2026-02-24

## 定位

重构 BotoolAgent 的文档输出架构，将当前的单一 `prd.md + prd.json（slim）` 改为三件套：`prd.md`（纯设计）+ `dev.md`（人读 DT）+ `dev.json`（机读胖 DT）。同时修复 PyramidPRD Transform Mode 在大型 PRD 中丢失细节的根本问题。

## 背景与动机

在对 `botool-present-v16`（8120 行 PRD）进行转换后发现严重细节丢失：

1. **T7 假阳性** — T7 只检查 `CREATE TABLE` 数量和总行数，不检查字段完整性。源 PRD 13 字段的表生成后只有 6 字段，T7 仍报 ✅
2. **UUID 漂移** — AI 把所有新表 PK 从 `SERIAL/INT` 改成 `UUID`，与源表 `botool_users.id INT` FK 链断裂
3. **字段丢失** — `present_versions` 缺 7 字段，`present_translations` 缺 9 个进度字段
4. **规则丢失** — 源 PRD 1165 行业务规则，生成 PRD 只有 ~70 行（覆盖率 6%）
5. **职责混乱** — prd.md 同时承担「设计文档」和「§7 开发计划（DTs）」，slim prd.json 只有 `prdSection` 指针，Lead Agent 执行 DT 时必须回读 prd.md §7 获取验收标准

## 核心功能

1. **Transform Mode 原文备份** — T1 阶段自动创建 `prd_original.md`（只读备份），PyramidPRD 对副本 `prd.md` 有完全自由的修改权
2. **prd.md 职责重划** — 只含 §1-§6+§8（纯设计），不含 §7（开发计划）
3. **dev.md 新文件** — 人读版 Phase/DT 开发计划（含验收标准，方便用户 review）
4. **dev.json 胖格式** — 机读版 DT，`acceptanceCriteria[]` 必填（字段级），`designRefs[]` 指向 prd.md 设计章节
5. **T7 重写** — 从数量检查升级为 DT 字段级覆盖验证：抽查 DT 涉及的关键字段是否出现在 prd.md 对应章节
6. **Lead Agent 升级** — 胖模式（`acceptanceCriteria[]`）升为主模式，slim 模式（`prdSection` 指针）降为 legacy fallback
7. **Testing Skill 适配** — 文件名从 `prd.json` → `dev.json`，加 legacy fallback

## 技术方向

- **技术栈**: 纯 Markdown Skill 文件修改（无代码变更）
- **修改范围**: 3 个文件
  - `skills/BotoolAgent/PyramidPRD/SKILL.md`（主要）
  - `skills/BotoolAgent/PRD2JSON/SKILL.md`（输出格式重写）
  - `CLAUDE.lead.md`（胖模式升为主模式）
  - `skills/BotoolAgent/Testing/SKILL.md`（文件名适配）
- **关键决策**:
  - Transform Mode 备份文件名：`prd_original.md`（小写下划线）
  - 输出文件改名：`prd.json` → `dev.json`，`§7 开发计划 MD` → `dev.md`
  - 向后兼容：Lead Agent / Testing 优先找 `dev.json`，fallback 到 `prd.json`

## 目标用户

- **主要用户**: BotoolAgent 开发者（boszan）
- **间接用户**: 所有使用 PyramidPRD Transform Mode 的业务用户
- **使用场景**: 导入大型用户 PRD（>5000 行），期望转换后不丢失任何设计细节

## 范围边界

### 要做的

**PyramidPRD SKILL.md:**
- Phase T1：新增备份步骤（`cp source → prd_original.md`），明确备份文件只读
- Phase 7：生成 `prd.md`（无 §7）+ `dev.md`（人读 DT）+ `dev.json`（胖格式）
- T7：重写为 DT 字段级覆盖验证，替代当前行数/数量统计
- T2.5：补充字段数校验（不只检查表名）

**PRD2JSON SKILL.md:**
- 输出目标文件改为 `dev.json`（胖格式）+ `dev.md`（人读版）
- 定义新 dev.json schema（见下方 §dev.json Schema）
- 更新 registry.json 写入路径

**CLAUDE.lead.md:**
- 胖模式升为主模式（优先读 `acceptanceCriteria[]`）
- slim 模式（`prdFile + prdSection` 指针）降为 legacy 向后兼容
- 路径查找：优先 `dev.json`，fallback 到 `prd.json`（旧项目）

**Testing SKILL.md:**
- `PRD_PATH` 变量：优先 `tasks/${PROJECT_ID}/dev.json`，fallback 到 `prd.json`
- 报错提示中文件名从 `prd.json` → `dev.json`
- 其余逻辑（testCases/branchName/project/description 字段）不变

### 不做的（YAGNI）

- 不修改 viewer 前端（dev.md/dev.json 的 UI 展示留后续）
- 不修改 botoolagent-coding / botoolagent-finalize skill（Lead Agent 逻辑在 CLAUDE.lead.md）
- 不拆分 prd.md 为多个 Phase 文件
- 不修改旧有已生成的 prd.json（旧项目保持，Lead Agent fallback 处理）
- 不改变 PyramidPRD 的问答流程（L0-L5 保持不变）

## dev.json Schema 定义

```json
{
  "project": "string",
  "branchName": "string",
  "description": "string",
  "prdFile": "tasks/<id>/prd.md",
  "devFile": "tasks/<id>/dev.md",
  "prerequisites": [],
  "sessions": [],
  "constitution": {
    "rules": [
      {
        "id": "rule-001",
        "name": "string",
        "category": "string",
        "file": "rules/xxx.md",
        "checklist": ["string"]
      }
    ],
    "ruleAuditSummary": ""
  },
  "devTasks": [
    {
      "id": "DT-001",
      "title": "string",
      "priority": 1,
      "passes": false,
      "dependsOn": [],
      "description": "string（必填，完整任务描述）",
      "acceptanceCriteria": [
        "关键字段 xxx 存在于 CREATE TABLE",
        "PK 类型为 SERIAL 不是 UUID",
        "Typecheck passes",
        "..."
      ],
      "designRefs": ["§4.2", "§3.3 状态机"],
      "files": ["sql/04_versions.sql", "src/components/Foo.tsx"],
      "evals": [
        {
          "type": "code-based",
          "blocking": true,
          "description": "Typecheck passes",
          "command": "npx tsc --noEmit",
          "expect": "exit-0"
        }
      ],
      "testCases": [
        { "type": "typecheck", "desc": "TypeScript 编译通过" },
        {
          "type": "e2e",
          "desc": "浏览器验收",
          "playwrightMcp": {
            "url": "/admin",
            "steps": []
          }
        }
      ],
      "steps": []
    }
  ]
}
```

### 与当前 prd.json 的字段对比

| 字段 | 当前 prd.json | 新 dev.json | 说明 |
|------|--------------|-------------|------|
| `project` | ✅ | ✅ 保留 | 同名 |
| `branchName` | ✅ | ✅ 保留 | coding + testing 依赖 |
| `description` | ✅ | ✅ 保留 | testing PR 描述 |
| `prdFile` | ✅ | ✅ 保留 | 降为设计上下文补充 |
| `devFile` | ❌ | 🆕 新增 | 指向 dev.md |
| `prerequisites[]` | ✅ | ✅ 保留 | 同名 |
| `sessions[]` | ✅ | ✅ 保留 | 容量规划 |
| `constitution` | ✅ | ✅ 保留 | 结构完全不变 |
| `DT.prdSection` | ✅ slim 指针 | ⛔ 删除 | §7 已从 prd.md 移除 |
| `DT.description` | 可选 fat legacy | 🔼 **必填** | Lead Agent 直接读 |
| `DT.acceptanceCriteria[]` | 可选 fat legacy | 🔼 **必填** | 字段级，T7 校验基础 |
| `DT.designRefs[]` | ❌ | 🆕 新增 | 替代 prdSection，指向 §1-§6,§8 |
| `DT.files[]` | ❌ | 🆕 新增（可选） | 预期产出文件 |
| `DT.evals[]` | ✅ | ✅ 保留 | 结构不变 |
| `DT.testCases[]` | ✅ | ✅ 保留 | testing Layer 3b 依赖 |
| `DT.steps[]` | ✅ | ✅ 保留 | 可选有序步骤 |

## 成功标准

- [ ] Transform Mode 处理 8000+ 行 PRD 后，自动生成 `prd_original.md`（只读备份）
- [ ] 生成的 `prd.md` 不含 §7 章节
- [ ] 运行 `/botoolagent-prd2json` 后生成 `dev.md` + `dev.json`（不再是 `prd.json`）
- [ ] `dev.json` 中每个 DT 有非空 `acceptanceCriteria[]`（≥3 条）和 `description`
- [ ] `dev.json` 中每个 DT 有 `designRefs[]` 字段（指向 prd.md 具体设计章节）
- [ ] CLAUDE.lead.md 优先读 `dev.json` 的 `acceptanceCriteria[]`，不再需要回读 prd.md §7
- [ ] Testing SKILL 优先找 `dev.json`，fallback 到旧 `prd.json`（无报错）
- [ ] 重新转换 botool-present-v16：UUID 问题消失，字段完整，T7 字段级校验通过

## 开放问题

- `designRefs[]` 格式：只写 section 编号（`"§4.2"`）还是需要含行号（`{ section: "§4.2", lines: "230-280" }`）？→ 建议先只写 section，行号可选
- Testing Skill 中的 registry.json 路径 `tasks/${PROJECT_ID}/prd.json` 需要同步更新，是否也需要支持混合（有些项目是 prd.json，有些是 dev.json）？→ 是，通过 fallback 逻辑处理

---

## 三件套文件结构

```
tasks/<projectId>/
  prd.md              ← §1-§6+§8 纯设计文档（无 §7）
  dev.md              ← 人读版 Phase/DT 开发计划
  dev.json            ← 机读版胖格式 DT（含字段级验收标准）
  prd_original.md     ← Transform Mode 专用：原始 PRD 完整备份（只读）
  SOURCE_PRD.ref      ← Transform Mode 专用：源文件路径引用
  progress.txt        ← 运行时进度（不变）
```

---

> 下一步: 使用 `/botoolagent-pyramidprd` 导入此 Draft，生成完整 PRD
