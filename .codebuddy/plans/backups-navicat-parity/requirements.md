# 需求文档（Requirements）— 备份对标 Navicat

> 状态：已完成 2026-11-17
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Complex | 范围：MVP（延后项见 tasks.md 文末 Backlog）

## 1. 问题陈述（Problem Statement）

左树「备份」与顶栏「备份」目前进入 `PlaceholderPane`（`backups` 未列入 listable；`TopToolbar` 的 `backup` 带 `placeholder`）。无文件夹右键菜单、无对象列表、无「新建备份」对话框。本迭代要对齐 Navicat MySQL 备份交互：文件夹右键菜单、备份对象列表、新建备份四 Tab 对话框（常规 / 对象选择 / 高级 / 消息日志），并以本地 SQL 转储文件作为备份产物，支持从文件还原/提取 SQL 的基础能力。

## 2. 用户故事与验收标准（User Stories & EARS AC）

### US-1 导航与对象列表

作为开发者，我想要打开「备份」对象窗格，以便浏览本库已有备份。

- **AC-1.1**：When 用户在左树选择「备份」，the system shall 进入对象列表（非占位页），工具栏显示「对象 · 备份 N」。
- **AC-1.2**：The system shall 在对象列表展示列：名称、创建时间、大小、注释（缺省「—」）；数据来自本机备份目录索引。
- **AC-1.3**：When 顶栏点击「备份」且已选数据库，the system shall 进入备份对象列表，而非 PlaceholderPane。
- **AC-1.4**：When 点击列表工具栏「新建」或菜单「新建备份」，the system shall 打开「新建备份」对话框。

### US-2 备份文件夹右键菜单

作为用户，我想要右键「备份」文件夹得到与 Navicat 分区一致的菜单。

- **AC-2.1**：When 右键「备份」文件夹或列表空白处，the system shall 展示分区项：还原备份（禁用）、新建备份 ⌘N、删除备份（禁用）、复制备份（禁用，⇧⌘D）、分隔、还原备份从…、提取 SQL 从…、提取 SQL…（禁用）、分隔、管理组 ›、重命名（禁用）、分隔、在 Finder 中显示、分隔、刷新 ⌘R。
- **AC-2.2**：When 执行「新建备份」，the system shall 打开新建备份对话框（标题形如 `新建备份 @库名 (主机) - 备份`）。
- **AC-2.3**：When 执行「还原备份从…」或「提取 SQL 从…」，the system shall 打开系统文件选择器；还原则执行所选 SQL 文件，提取则另存/打开为可读 SQL。
- **AC-2.4**：When 执行「在 Finder 中显示」，the system shall 在系统文件管理器中打开本库备份目录。
- **AC-2.5**：When 执行「刷新」，the system shall 重新扫描备份目录并刷新列表。

### US-3 备份项右键与选择态

作为用户，我想要选中某个备份后执行删除/还原/提取。

- **AC-3.1**：While 已选中一个备份项，the system shall 启用：还原备份、删除备份、复制备份、提取 SQL…、重命名；文件夹级对应禁用项随之启用。
- **AC-3.2**：When 点击「删除备份」，the system shall 先弹出应用内确认框；确认后删除本地备份文件并刷新。
- **AC-3.3**：When 点击「还原备份」，the system shall 确认后执行该备份 SQL（按语句批跑）并提示结果。
- **AC-3.4**：When 点击「提取 SQL…」，the system shall 将备份文件另存为 `.sql`（或等价）到用户所选路径。
- **AC-3.5**：When 点击「复制备份」，the system shall 复制一份带 `_copy` 后缀的备份文件并刷新。
- **AC-3.6**：When 点击「重命名」，the system shall 允许改显示名/文件名（校验非法字符）并刷新。

### US-4 新建备份对话框

作为用户，我想要用四 Tab 对话框配置并执行备份，交互对齐 Navicat。

- **AC-4.1**：The system shall 提供 Tab：常规、对象选择、高级、消息日志；底栏左侧「保存配置文件」（含下拉），右侧「关闭」「备份」（运行中可变为「开始」语义一致的主操作）。
- **AC-4.2**：While 在「常规」Tab，the system shall 只读展示连接名称、主机、模式（数据库），并提供多行「注释」输入。
- **AC-4.3**：While 在「对象选择」Tab，the system shall 以勾选树展示表 / 视图 / 函数 / 事件（含子项与全选/取消全选/搜索）；父节点勾选联动子节点。
- **AC-4.4**：While 在「高级」Tab，the system shall 提供：锁定所有表、使用单一事务（只限 InnoDB）、使用指定的文件名称 + 文件名模板输入（默认 `备份_%Y%m%d%H%M%S`）及格式说明。
- **AC-4.5**：When 用户点击「备份」，the system shall 切换到「消息日志」Tab，按对象逐项转储，更新对象/已处理对象/已处理记录/时间统计、日志文本与进度条。
- **AC-4.6**：When 备份成功，the system shall 将 SQL 写入本库备份目录（按模板展开文件名），登记元数据（注释、时间、大小）并刷新列表；失败则在日志中显示错误且不关闭对话框。
- **AC-4.7**：When 用户「保存配置文件」，the system shall 持久化当前注释、对象勾选、高级选项，供下次新建时恢复。

### US-5 引擎范围

作为用户，我想要非 MySQL 有明确降级且不崩溃。

- **AC-5.1**：Where 引擎为 MySQL/MariaDB，the system shall 完整支持对象树勾选与表数据转储。
- **AC-5.2**：Where 引擎为 PostgreSQL 或 SQLite，the system shall 仍可打开对话框；表转储按现有 `dumpTableSql` 能力降级，不支持的例程类型显示为空或跳过并写日志，不崩溃。

## 3. 约束与非目标

**技术约束**

- 复用现有文件夹菜单 / `ObjectListGrid` / `dumpTableSql` / `downloadTextFile` / `danger-confirm-modal` / `tableGroups` 管理组子菜单模式。
- 备份产物为本机 `.sql` 文件 + 旁路 JSON 元数据（或同目录索引），不做专有二进制 `.nbak`。
- 「在 Finder 中显示」接入 `@tauri-apps/plugin-opener`（或等价 reveal）。
- 删除/还原危险操作必须应用内确认。

**明确不做（本迭代）**

- Navicat 专有 `.nbak` 格式读写
- 备份计划任务 / 自动定时备份
- 还原向导的对象级勾选还原（MVP：整文件执行 SQL）
- 压缩、加密、云存储
- 跨库/跨连接复制备份
- 管理组对备份项的真实分组归属 UI（菜单项保留，行为对齐现有「创建组」占位即可）
