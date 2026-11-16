# 需求文档（Requirements）— 事件对标 Navicat

> 状态：已完成 2026-11-17
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Complex | 范围：MVP（延后项见 tasks.md 文末 Backlog）

## 1. 问题陈述（Problem Statement）

左树「事件」与顶栏「自动化」目前进入 `PlaceholderPane`（`selectObjectFolder` 未把 `events` 列入 listable）。函数/视图已按 Navicat 打通列表、树、菜单、设计器链路。本迭代要对齐 Navicat MySQL Event：对象窗格、工具栏（设计/新建/删除）、计划设计器、启用/禁用、复制/重命名/DDL，使调度事件可完整管理。

## 2. 用户故事与验收标准（User Stories & EARS AC）

### US-1 对象列表与导航

作为开发者，我想要打开「事件」对象窗格并展开左树子节点，以便浏览本库全部事件。

- **AC-1.1**：When 用户在左树选择「事件」，the system shall 进入对象列表（非占位页），工具栏显示「对象 · 事件 N」。
- **AC-1.2**：When 左树「事件」文件夹展开，the system shall 列出该库事件（badge 如 Ev）。
- **AC-1.3**：The system shall 在对象列表展示列：名称、状态、类型（ONE TIME / RECURRENT）、执行时间/间隔、定义者、创建日期、修改日期、注释、上次执行（缺省「—」）。
- **AC-1.4**：When 选中某一事件，the system shall 在右侧检查器展示状态、计划、定义者、ON COMPLETION、注释等元数据。
- **AC-1.5**：When 顶栏点击「自动化」（或等价事件入口），the system shall 进入事件对象列表（若已选数据库），而非占位页。

### US-2 工具栏与危险确认

作为用户，我想要通过工具栏完成设计/新建/删除，以便与函数列表一致。

- **AC-2.1**：While 已选中事件，工具栏「设计」「删除」可用；「新建」始终可用；未选中时设计/删除禁用。
- **AC-2.2**：When 点击「新建」，the system shall 打开事件设计器（创建模式）。
- **AC-2.3**：When 双击事件或点击「设计」，the system shall 打开事件设计器（编辑模式）并加载定义与计划。
- **AC-2.4**：When 点击「删除」，the system shall 先弹出应用内确认框；仅确认后执行 `DROP EVENT` 并刷新。

### US-3 文件夹与节点右键菜单

作为用户，我想要右键菜单与 Navicat 分区一致。

- **AC-3.1**：When 右键「事件」文件夹或列表空白处，the system shall 展示：设计（禁用）、新建事件、删除（禁用）、复制（禁用）、启用/禁用（禁用）、粘贴、数据字典…、刷新；风格对齐函数菜单。
- **AC-3.2**：When 右键某一事件节点或列表行，the system shall 展示：设计、新建、删除、复制、启用、禁用、复制 DDL / 共享…、重命名、刷新；危险项走确认框。
- **AC-3.3**：When 执行「复制」，the system shall 以 `原名_copy` 为目标创建同定义事件（允许改名）。
- **AC-3.4**：When 执行「重命名」，the system shall 校验标识符后完成改名（MySQL：DROP+CREATE 或等价）。
- **AC-3.5**：When 粘贴剪贴板中的 `CREATE EVENT`，the system shall 弹出 DDL 对话框并可改名后执行。
- **AC-3.6**：When 执行「启用」或「禁用」，the system shall 执行 `ALTER EVENT … ENABLE|DISABLE` 并刷新列表状态。

### US-4 事件设计器

作为开发者，我想要在设计器中编辑定义与计划并保存，以便完整管理调度事件。

- **AC-4.1**：The system shall 提供设计器：名称、状态（ENABLE/DISABLE）、ON COMPLETION（PRESERVE/NOT PRESERVE）、定义者（可选）、注释、计划（一次性 AT 或循环 EVERY + STARTS/ENDS）、事件体（DO 语句/BEGIN…END）、SQL 预览。
- **AC-4.2**：When 保存成功，the system shall 执行生成的 DDL（新建 CREATE；修改 DROP+CREATE 或 ALTER），清除脏标记并刷新列表。
- **AC-4.3**：If DDL 执行失败，then the system shall 在设计器内显示错误且不关闭页签。

### US-5 引擎范围

作为用户，我想要非 MySQL 有明确降级且不崩溃。

- **AC-5.1**：Where 引擎为 MySQL/MariaDB，the system shall 完整支持列举与 CRUD。
- **AC-5.2**：Where 引擎为 PostgreSQL 或 SQLite，the system shall 显示空列表与友好提示（不支持 Event Scheduler），不崩溃。

## 3. 约束与非目标

**技术约束**

- 复用函数同构模式：listable、`ObjectListGrid`、ContextMenu、DesignerTab、`executeSql`；前端 `information_schema.EVENTS` / `SHOW CREATE EVENT`。
- 删除必须用应用内 `danger-confirm-modal`。
- 导出字典/DDL 走原生 Save As。
- 标识符校验复用 `identOk`。

**明确不做（本迭代）**

- 拖放跨库复制 / 数据传输
- 全局 `event_scheduler` ON/OFF 服务器配置向导（可在 Backlog；设计器可提示需开启）
- 顶栏改名为「事件」（保留「自动化」文案，行为进事件列表即可）
- PG cron / 其他非 MySQL 调度器
- 权限菜单真实实现（禁用占位）
