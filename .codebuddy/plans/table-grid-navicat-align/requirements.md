# 需求文档（Requirements）— 表数据网格 / 底栏 / 表菜单对齐 Navicat

> 状态：已完成 2026-11-16
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Standard | 范围：MVP（延后项见 tasks.md Backlog）

## 1. 问题陈述

打开表浏览时，NULL 单元格以字面量 `"NULL"` 进入编辑，易误改；底栏缺少 Navicat 式 CRUD + 分页 + SQL 预览；对象列表「表」无右键菜单（清空/截断/删除等）。成功标准：NULL 编辑为空并可设回 NULL；底栏对齐参考图；表菜单覆盖常用运维动作。

## 2. 用户故事与验收标准

### US-1 NULL 编辑体验

作为用户，我想要正确编辑 NULL 单元格，以便不把 `"NULL"` 字符串写进数据库。

- **AC-1.1**：When 单元格值为 null 且未聚焦, the system shall 以灰色斜体显示 `NULL`（非可编辑字面量）。
- **AC-1.2**：When 用户开始编辑 null 单元格, the system shall 展示空输入框（非字符串 `"NULL"`）。
- **AC-1.3**：When 可空列输入被清空并失焦/提交, the system shall 写回 SQL NULL。
- **AC-1.4**：When 用户右键选择「设为 NULL」, the system shall 将该单元格设为 null。

### US-2 Navicat 式底栏

作为用户，我想要在表数据区底部完成增删改、分页与过滤入口，以便贴近 Navicat 操作习惯。

- **AC-2.1**：The system shall 在底栏左侧提供 + / − / 应用 / 放弃 / 刷新。
- **AC-2.2**：The system shall 在底栏中部显示当前 SELECT…LIMIT SQL 预览。
- **AC-2.3**：The system shall 提供首页/上一页/页码/下一页/末页及 pageSize 选择（100/500/1000）。
- **AC-2.4**：The system shall 在底栏提供过滤入口（切换过滤条）。

### US-3 表对象菜单对齐

作为用户，我想要在对象列表右键对表执行打开/清空/截断/删除/重命名，以便完成常见表运维。

- **AC-3.1**：When 用户在对象列表表行上右键, the system shall 弹出表菜单。
- **AC-3.2**：When 用户选择打开表, the system shall 打开数据页签。
- **AC-3.3**：When 用户确认清空表, the system shall 执行 `DELETE FROM`（或等价）并刷新列表。
- **AC-3.4**：When 用户确认截断表, the system shall 执行 `TRUNCATE TABLE` 并刷新。
- **AC-3.5**：When 用户确认删除表, the system shall 执行 `DROP TABLE`、关闭相关页签并刷新。
- **AC-3.6**：When 用户重命名表并确认, the system shall 执行 `RENAME TABLE` 并刷新。

## 3. 约束与非目标

**技术约束**

- 复用现有 `DataGrid` / `sessionApi.executeSql` / `applyRowChanges`；不新增后端表设计 IPC。

**非目标（Backlog）**

- 可视化「设计表」完整列编辑器；表单视图；多条件过滤；复合主键自动探测增强。
