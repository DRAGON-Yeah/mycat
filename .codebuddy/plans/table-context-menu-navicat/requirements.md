# 需求文档（Requirements）— 表右键菜单对齐 Navicat（MVP）

> 状态：已完成 2026-11-16
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Complex | 范围：MVP（用户确认 1-A + 2-A；延后项见 Backlog）

## 1. 问题陈述（Problem Statement）

对象列表表行右键菜单（[`TableContextMenu.tsx`](../../../src/features/nav-tree/TableContextMenu.tsx)）目前仅有打开、设计(只读 SQL)、清空/截断、重命名、删除，与 Navicat 参考图分区与能力差距大；转储/字典/逆向仅在库级菜单，表级无入口；无可视化设计表/新建表。成功标准：菜单分区与参考图一致；MVP 项均可本地执行；设计/新建表提供可视化列编辑器并可生成执行 DDL；AI/BI/权限等明确进 Backlog 且不伪装为已实现。

## 2. 用户故事与验收标准（User Stories & EARS AC）

### US-1 菜单壳与分区/快捷键

作为数据库用户，我想要表右键菜单分区与 Navicat 参考图一致，以便快速定位操作。

- **AC-1.1**：When 用户在对象列表表行上右键, the system shall 弹出菜单，分区顺序为：打开/配置打开/设计/新建/AI新建 → 删除/清空/截断/复制表/权限 → 导入/导出/字典/数据生成/脱敏 → 转储/维护/逆向/BI → 管理组/复制/粘贴/共享/重命名 → 刷新。
- **AC-1.2**：The system shall 展示快捷键 ⌘O（打开）、⌘D（设计）、⌘N（新建表）、⌘R（刷新）；带子菜单项用 `>`。
- **AC-1.3**：While 本迭代未实现的能力（AI 建表、通过配置打开、设置权限、数据生成、脱敏、BI、管理组、共享）, the system shall 菜单项可见但禁用并带「稍后」提示，不得假装成功。

### US-2 打开 / 刷新 / 危险运维

作为用户，我想要打开表、刷新列表并对表做清空/截断/删除/重命名，以便完成日常运维。

- **AC-2.1**：When 用户选择「打开表」或按 ⌘O（对象列表聚焦该表时）, the system shall 打开该表数据页签。
- **AC-2.2**：When 用户选择「刷新」或按 ⌘R, the system shall 重新加载当前库对象列表。
- **AC-2.3**：When 用户确认「清空表」, the system shall 按引擎执行等价清空（MySQL/PG: `DELETE FROM`；SQLite 同）并刷新。
- **AC-2.4**：When 用户确认「截断表」, the system shall 按引擎执行截断（MySQL/PG: `TRUNCATE`；SQLite: `DELETE` + 可选自增重置）并刷新。
- **AC-2.5**：When 用户确认「删除表」, the system shall `DROP`、关闭相关页签并刷新。
- **AC-2.6**：When 用户重命名并确认, the system shall 按引擎 `RENAME`/`ALTER … RENAME` 并刷新。

### US-3 新建表与可视化设计表

作为用户，我想要可视化新建/设计表（列、类型、可空、默认值、主键），以便对齐 Navicat「设计表」体验。

- **AC-3.1**：When 用户选择「新建表」或 ⌘N, the system shall 打开空白表设计器页签（可编辑表名与列）。
- **AC-3.2**：When 用户选择「设计表」或 ⌘D, the system shall 打开设计器并加载该表现有列元数据。
- **AC-3.3**：When 用户在设计器中增删改列并保存, the system shall 生成并执行对应 `CREATE TABLE` 或 `ALTER TABLE`（本迭代主路径：MySQL；Postgres/SQLite 提供可用等价 DDL），成功后刷新对象列表。
- **AC-3.4**：If DDL 执行失败, then the system shall 展示错误且不关闭设计器，不虚假刷新。

### US-4 复制表

作为用户，我想要复制表（仅结构 / 结构+数据），以便快速克隆。

- **AC-4.1**：When 用户在「复制表」子菜单选择「仅结构」或「结构与数据」, the system shall 弹出目标表名对话框并执行复制（MySQL: `CREATE TABLE … LIKE` + 可选 `INSERT INTO … SELECT`；其它引擎用 dump/重建等价路径）。
- **AC-4.2**：If 目标表名非法或已存在, then the system shall 拒绝并提示。

### US-5 导入/导出/字典/转储/逆向（表级入口）

作为用户，我想要在表右键直接导入导出、转储 SQL、看字典与逆向模型，而不必回到库菜单。

- **AC-5.1**：When 用户选择「导出向导…」, the system shall 导出当前表 CSV（复用既有导出逻辑，可简化为一步导出而非完整向导 UI）。
- **AC-5.2**：When 用户选择「导入向导…」, the system shall 触发当前表 CSV 导入（需先打开表或在菜单内完成选文件导入）。
- **AC-5.3**：When 用户选择「数据字典…」, the system shall 导出该单表 Markdown 字典。
- **AC-5.4**：When 用户在「转储 SQL 文件」选择结构+数据或仅结构, the system shall 下载该表 `.sql`（复用 `dumpTableSql`）。
- **AC-5.5**：When 用户选择「逆向表到模型…」, the system shall 生成该表 Mermaid ER 片段并进入模型占位视图。

### US-6 维护与剪贴板

作为用户，我想要对表做维护并复制表名/结构，以便运维与粘贴使用。

- **AC-6.1**：When 用户在「维护」子菜单选择 Analyze / Optimize / Check / Repair（仅 MySQL 显示可用项）, the system shall 执行对应语句并 toast 结果；非 MySQL 引擎禁用不适用项。
- **AC-6.2**：When 用户选择「复制」, the system shall 将表名写入剪贴板。
- **AC-6.3**：While 剪贴板中无可用的表结构 DDL, the system shall 禁用「粘贴」。

## 3. 约束与非目标

**技术约束**

- Tauri 2 + React；复用 `.dg-context-menu` / 子菜单样式与 `sessionApi`（`executeSql` / `dumpTableSql` / `fetchTablePage` / `listTables`）。
- 破坏性操作必须确认对话框；SQL 标识符按引擎正确引用（补齐 SQLite/Postgres，避免一律反引号）。
- 设计器优先前端生成 DDL + `executeSql`；若差异过大再补专用 IPC（默认不新增，除非保存路径无法安全完成）。

**明确不做（本迭代）**

- 通过配置文件打开表、AI 新建表、设置权限、数据生成、数据脱敏、创建 BI 工作区、管理组（表级）、云共享。
- 完整 Navicat 式多步导入/导出向导 UI（本迭代一步 CSV + Dump）。
- 外键/索引/触发器/分区等完整对象设计（列级 MVP；索引可进 Backlog）。
- 左树单表节点右键（仍以对象列表为准）。
