# 需求文档（Requirements）— 函数/过程对标 Navicat

> 状态：已完成 2026-11-17
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Complex | 范围：MVP（延后项见 tasks.md 文末 Backlog）

## 1. 问题陈述（Problem Statement）

Mycat 左树与顶栏已有「函数」入口，但点击后仍是 `PlaceholderPane`（`workspaceStore.selectObjectFolder` 未把 `functions` 列入 listable），无对象列表、无树子节点、无右键菜单、无设计器、无运行/删除。视图已按 Navicat 打通同构链路（`TreeObjectFolder` / `ViewsFolderContextMenu` / `ViewDesigner` / `ObjectListGrid` views 分支）。本迭代要对齐 Navicat「函数」对象窗格与菜单交互，使 MySQL 函数与存储过程可列表、设计、运行、删除、复制、重命名与 DDL 操作。

## 2. 用户故事与验收标准（User Stories & EARS AC）

### US-1 对象列表与导航

作为数据库开发者，我想要像 Navicat 一样打开「函数」对象窗格并展开左树子节点，以便浏览本库全部函数与过程。

- **AC-1.1**：When 用户在左树或顶栏选择「函数」，the system shall 进入对象列表（非占位页），工具栏显示「对象 · 函数 N」。
- **AC-1.2**：When 左树「函数」文件夹展开，the system shall 列出该库 FUNCTION 与 PROCEDURE，图标区分（fx / Px）。
- **AC-1.3**：The system shall 在对象列表展示列：名称、类型、返回类型、定义者、SQL 安全性、创建日期、修改日期、注释（MySQL；缺省列显示「—」）。
- **AC-1.4**：When 选中某一例程，the system shall 在右侧检查器展示对应元数据（类型、返回类型、定义者、安全性、确定性、注释等）。

### US-2 工具栏与危险确认

作为用户，我想要通过工具栏完成运行/设计/新建/删除，以便与视图/表一致的操作路径。

- **AC-2.1**：While 已选中例程，工具栏「运行」「设计」「删除」可用；未选中时禁用（新建始终可用）。
- **AC-2.2**：When 点击「新建」，the system shall 打开函数设计器（创建模式）。
- **AC-2.3**：When 双击例程或点击「设计」，the system shall 打开函数设计器（编辑模式）并加载 DDL。
- **AC-2.4**：When 点击「删除」，the system shall 先弹出应用内确认框；仅确认后执行 `DROP FUNCTION|PROCEDURE` 并刷新列表。
- **AC-2.5**：When 点击「运行」，the system shall 弹出参数输入对话框（无参可直接执行），执行后展示结果或错误。

### US-3 文件夹与节点右键菜单

作为用户，我想要文件夹/节点右键菜单与 Navicat 分区一致，以便发现全部能力。

- **AC-3.1**：When 右键「函数」文件夹（或对象列表空白处），the system shall 展示：运行（无选中禁用）、设计（禁用）、新建函数、删除（禁用）、复制（禁用）、设置权限（禁用占位）、数据字典…、粘贴、刷新、管理组；快捷键提示与视图菜单同风格。
- **AC-3.2**：When 右键某一函数/过程节点或列表行，the system shall 展示：运行、设计、新建、删除、复制、设置权限（禁用占位）、复制 DDL / 共享…、重命名、刷新；危险项走确认框。
- **AC-3.3**：When 执行「复制」，the system shall 以 `原名_copy` 为目标创建同定义例程（允许用户改名）。
- **AC-3.4**：When 执行「重命名」，the system shall 以合法标识符校验后完成改名（MySQL：DROP+CREATE 或等价安全路径）。
- **AC-3.5**：When 粘贴剪贴板中的 `CREATE FUNCTION|PROCEDURE`，the system shall 弹出 DDL 对话框并可改名后执行。

### US-4 函数/过程设计器

作为开发者，我想要在设计器中编辑定义并保存/运行，以便完整管理例程。

- **AC-4.1**：The system shall 提供设计器页签：名称、类型（FUNCTION/PROCEDURE）、参数表（名/模式 IN|OUT|INOUT/类型）、返回类型（仅 FUNCTION）、例程体编辑器、高级属性（DEFINER、SECURITY、DETERMINISTIC、注释）、SQL 预览。
- **AC-4.2**：When 保存成功，the system shall 执行生成的 DDL（新建用 CREATE；修改用 DROP+CREATE 或等价），脏标记清除，列表刷新。
- **AC-4.3**：If DDL 执行失败，then the system shall 在设计器内显示错误且不关闭页签。
- **AC-4.4**：When 在设计器点击「运行」，the system shall 走与工具栏相同的参数对话框与结果展示（未保存变更可提示先保存或按当前定义预览运行——MVP：要求已保存名称存在于库中，或对 create 模式提示先保存）。

### US-5 引擎范围与顶栏一致

作为用户，我想要点顶栏「函数」也进入真实列表，且非 MySQL 有明确降级。

- **AC-5.1**：When 顶栏点击「函数」，the system shall 与左树选择「函数」相同，进入对象列表而非占位页。
- **AC-5.2**：Where 引擎为 PostgreSQL，the system shall 尽量列举可调用函数（`pg_proc`）并支持查看定义；完整设计器能力可降级为只读 DDL + 提示。
- **AC-5.3**：Where 引擎为 SQLite，the system shall 显示空列表与友好提示（不支持存储过程），不崩溃。

## 3. 约束与非目标

**技术约束**

- 复用视图同构模式：`selectObjectFolder` listable、`ObjectListGrid`、ContextMenu、DesignerTab、`executeSql`；不新起后端 RPC（除非现有 dump 需顺带支持 ROUTINE）。
- MySQL 优先完整交互；标识符校验复用 `identOk` / `sqlIdent`。
- 删除/破坏性操作必须用应用内 `danger-confirm-modal`，禁止依赖 `window.confirm`。
- 导出字典/DDL 文件走原生 Save As（与现有 csv/字典一致）。

**明确不做（本迭代）**

- 拖放跨库复制 / 数据传输工具
- 调试器、断点、单步
- 权限/用户授权真实实现（菜单项禁用占位即可）
- 事件调度器、触发器（另属「事件/触发器」对象）
- AI 生成例程
- 完整 PG 可视化参数设计器（可只读 DDL）
- Navicat Cloud 协作
