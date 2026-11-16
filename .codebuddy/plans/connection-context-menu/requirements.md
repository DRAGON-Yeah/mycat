# 需求文档（Requirements）— 连接节点右键菜单（Navicat 对齐）

> 状态：已完成 2026-11-16
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Complex | 范围：MVP（云同步/Navicat Cloud 共享见 Backlog）

## 1. 问题陈述（Problem Statement）

左侧「我的连接」中，连接节点目前仅有行内「编辑/删除」与底栏「断开」，缺少 Navicat 式完整右键菜单。用户无法在连接级一键关闭并收拢相关页签、复制连接、建库/查询、跑 SQL、着色/星标/分组等。成功标准：右键菜单结构与参考图一致，列出的每一项均可本地可用（非灰掉占位）。

## 2. 用户故事与验收标准（User Stories & EARS AC）

### US-1 连接右键菜单壳与分区

作为数据库用户，我想要在连接上右键看到与 Navicat 相同分区的菜单，以便快速找到操作。

- **AC-1.1**：When 用户在连接行上右键, the system shall 弹出菜单，分区顺序为：关闭/配置文件 → 编辑/新建/删除/复制 → 新建库/查询 → 命令行/SQL 文件/重载 → 星标/颜色 → 组/共享 → 刷新。
- **AC-1.2**：The system shall 在菜单项右侧展示与参考图一致的快捷键提示（关闭 ⇧⌘.、新建查询 ⌘Y、刷新 ⌘R）；带 `>` 的项提供子菜单。

### US-2 关闭连接与编辑连接（含脏页签）

作为用户，我想要关闭或编辑连接前处理未保存页签，以免丢数据。

- **AC-2.1**：When 用户选择「关闭连接」, the system shall 关闭该连接下全部表/查询页签并断开会话、折叠树；若有 dirty，则弹出与关库相同的三按钮确认。
- **AC-2.2**：When 用户选择「编辑连接…」, the system shall 先走关闭连接流程（含脏检查），成功后再打开既有 `ConnectionForm`。
- **AC-2.3**：If 「保存并关闭」时仍存在脏表页签, then the system shall 中止关闭并聚焦该表，提示先保存。

### US-3 连接 CRUD 与复制

作为用户，我想要新建/删除/复制连接，以便管理多个环境。

- **AC-3.1**：When 用户选择「新建连接」, the system shall 打开空白 `ConnectionForm`。
- **AC-3.2**：When 用户确认「删除连接」, the system shall 先强制收拢相关页签并 `closeConnection`，再删除元数据并刷新树。
- **AC-3.3**：When 用户选择「复制连接…」, the system shall 打开预填表单（名称加后缀、不带出明文密码需用户重填或保留 secret），保存后生成新连接。

### US-4 库与查询、命令行、SQL 文件、重载、刷新

作为用户，我想要在连接级创建库/查询、打开 Console、执行 SQL 文件并刷新对象。

- **AC-4.1**：When 用户选择「新建数据库…」, the system shall 弹出应用内对话框输入库名，执行 `CREATE DATABASE` 并刷新该连接库列表。
- **AC-4.2**：When 用户选择「新建查询」或按 ⌘Y（连接已选中）, the system shall 打开查询页签并绑定该连接。
- **AC-4.3**：When 用户选择「命令行界面」, the system shall 激活该连接并进入 Console 中心模式。
- **AC-4.4**：When 用户选择「运行 SQL 文件…」并选中 `.sql`, the system shall 在该连接上执行文件内容并 toast 结果。
- **AC-4.5**：When 用户在「重载」子菜单选择「重载数据库」或选择「刷新」, the system shall 重新 `listDatabases` 并更新树（⌘R 同刷新）。

### US-5 星标、颜色、组、配置文件、共享

作为用户，我想要用星标/颜色/分组整理连接，并切换本地配置、导出共享。

- **AC-5.1**：When 用户点击「添加星标」/「取消星标」, the system shall 持久化 `starred` 并即时更新树显示。
- **AC-5.2**：When 用户点击颜色圆点, the system shall 持久化 `color` 并更新树色点。
- **AC-5.3**：When 用户在「管理组」子菜单选择或新建组名, the system shall 更新 `groupName`；树按组聚类展示。
- **AC-5.4**：When 用户在「切换连接配置文件」中选择某配置, the system shall 将该配置的 host/port/database/user 写回当前连接（密码不变）并可选自动重连。
- **AC-5.5**：When 用户选择「共享…」, the system shall 导出该连接的 JSON（不含密码明文）供文件分享。

## 3. 约束与非目标

**技术约束**

- Tauri 2 + React；复用现有 `.dg-context-menu` / 关库对话框模式；禁止依赖 `window.prompt` 做主路径。
- 连接字段已有 `color` / `starred` / `groupName`（`meta.db` + `ConnectionDto`），优先 upsert，不重复造表除非配置文件需要。

**明确不做（本迭代）**

- Navicat Cloud 账号同步、云端共享链接、团队权限。
- 真正的多环境「配置文件」云端下发；本迭代仅为**本地**配置文件列表。
- 连接行内悬停「编辑/删除」可保留或弱化，不以参考图为准。
