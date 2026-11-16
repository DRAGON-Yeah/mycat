# 设计文档（Design）— 备份对标 Navicat

> 状态：已完成 2026-11-17

> 实现注记：受现有 fs 权限约束，备份 SQL 与索引落在 localStorage（`mycat_backups:*` / `mycat_backup_sql:*`）；「提取 SQL…」可另存到磁盘；「在 Finder 中显示」通过导出标记文件 + `revealItemInDir` 达成。
> 关联：[requirements.md](./requirements.md) · [tasks.md](./tasks.md)

## 1. 总体架构

```
左树 backups / 顶栏 backup
        │
        ▼
 workspaceStore.selectObjectFolder(..., "backups")  → centerMode: objectList
        │
        ├── ObjectListGrid (folder=backups) ← backupMeta.listBackups(conn, db)
        ├── BackupsFolderContextMenu / BackupItemContextMenu
        └── BackupWizard (modal)
                 │  Tab: 常规 | 对象选择 | 高级 | 消息日志
                 │
                 ├── 列举对象: listTables + information_schema (views/routines/events)
                 ├── 执行: 逐对象 dumpTableSql / SHOW CREATE …
                 └── 写入: appData/backups/{connId}/{db}/{filename}.sql + .meta.json
```

失败分支：dump/执行 SQL 异常 → 消息日志追加错误 → toast/`onMessage`；文件对话框取消 → 静默关闭（`isSaveCancelled`）。

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 备份为本地 `.sql` + `.meta.json`，非 `.nbak` | 复用 `dumpTableSql`/现有 DDL 拉取；MVP 可验证，对齐「提取 SQL」语义 |
| D2 | 「新建备份」用大模态四 Tab，不进 DesignerTab | 对齐 Navicat 对话框；参考 `FunctionWizard`/`TableIoWizard` + `EventDesigner` 的 tab 条样式 |
| D3 | `backups` 加入 listable；顶栏去掉 placeholder | 与 functions/events 一致，结束 PlaceholderPane |
| D4 | 进度与统计仅在前端编排 | 现有 dump 为同步 invoke；逐对象 await 即可驱动日志/进度，避免本迭代改 Rust 流式协议 |
| D5 | 危险操作走 `danger-confirm-modal` | 与表/函数/事件删除一致 |
| D6 | 「在 Finder 中显示」用 opener reveal 备份根目录 | 依赖已在 package/capabilities，源码首次接线 |
| D7 | 配置文件存 localStorage（按 conn+db） | 与 `tableGroups` 同类轻量持久化，足够 MVP |

## 3. 模块与组件

```
src/features/backup/
  backupMeta.ts          # 路径约定、list/save/delete/rename/duplicate、meta 类型
  backupDump.ts          # 编排：选中对象 → SQL 片段 → 合并文件；进度回调
  backupProfile.ts       # 保存/加载配置文件
  BackupWizard.tsx       # 四 Tab 对话框 UI
  BackupItemContextMenu.tsx
src/features/nav-tree/
  BackupsFolderContextMenu.tsx
  ConnectionTree.tsx     # backups 右键接线
src/features/object-list/
  ObjectListGrid.tsx     # backups 列与菜单
src/stores/workspaceStore.ts  # listable + toolbar
src/shell/TopToolbar.tsx      # backup 去 placeholder
src/App.css              # .bak-wizard* 样式
```

可选：`src-tauri` 增加 `reveal_path` 若 opener API 不便；优先前端 plugin。

## 4. 数据模型与配置

**BackupMeta**

| 字段 | 说明 |
|---|---|
| id / fileName | 文件名（展开模板后） |
| displayName | 列表显示名（默认同文件名去扩展名） |
| comment | 常规 Tab 注释 |
| createdAt | ISO 时间 |
| sizeBytes | 文件大小 |
| connectionId / database | 归属 |
| objectCounts | 可选：表/视图/函数/事件数量 |

**目录**：`{appDataDir}/mycat-backups/{connectionId}/{database}/`

**文件名模板**：`备份_%Y%m%d%H%M%S` → 本地时间替换 `%Y/%m/%d/%H/%M/%S`。

**Profile key**：`backup_profile:{connId}:{database}` → `{ comment, selectedKeys, advanced }`。

## 5. 数据流（关键场景走查）

1. **新建并备份**：菜单 → `BackupWizard` → 勾选对象 → 高级文件名 →「备份」→ `backupDump.run` 循环对象 → 写 `.sql`+meta → 刷新列表 → 日志「Finished successfully」。
2. **还原备份从…**：文件选择器 → 确认 → 读文本 → 按 `;`/分隔启发式拆分 `executeSql`（失败停止并提示）。
3. **删除选中备份**：确认 → 删 sql+meta → 刷新。

异常：无选对象点备份 → 日志提示并中止；磁盘写失败 → 日志错误。

## 6. 安全考量

- 还原执行任意 SQL：必须确认框，明确「将在当前库执行文件内容」。
- 备份目录限制在 appData 子路径，避免任意写；「提取 SQL」另存走用户选定路径。
- 不在日志中打印连接密码。

## 7. 与现有约定的对齐点

- 菜单 class：`dg-context-menu conn-context-menu`；快捷键 `menu-shortcut`。
- 列表刷新：`mycat:object-list-refresh` + `emitTableDataChanged`。
- Dump：`sessionApi.dumpTableSql`；视图/函数/事件用现有 `SHOW CREATE` / information_schema 模式（对齐 function/event meta）。
- 确认框：现有 danger modal 组件/模式。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 大表 dump 阻塞 UI | 逐表 await + 日志刷新；Backlog 流式/worker |
| SQL 拆分还原不完美 | MVP 文档说明；复杂脚本可「提取后手工在查询窗执行」 |
| opener 权限 | capabilities 已有则直接用；缺则补配置 |
