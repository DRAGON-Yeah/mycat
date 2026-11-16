# 技术设计（Design）— 表设计/查看体验补齐（Round 1）

> 状态：已批准 2026-11-16
> 关联：[requirements.md](./requirements.md) · [tasks.md](./tasks.md)

## 1. 总体方案

在现有 `workspaceStore` / `TableDesigner` / `DataGrid` / `ObjectListGrid` / `TableContextMenu` 上打补丁，不引入新架构。原则：关页确认、保存后状态机正确、主键可信、菜单诚实、列表可拖宽。

## 2. 关键决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | 设计器关闭：defer + confirm；`force` 仅危险运维后使用 | 修复 pointerdown+confirm 竞态，且不再「永远 force」 |
| D2 | 创建成功：`updateDesignerTab` 支持 `mode`/`id` 迁移为 alter，并 `openTable` | 避免二次 CREATE |
| D3 | 右键：document click 忽略 `.modal` / `.dg-context-menu` | 最小改动保住对话框 |
| D4 | 网格 PK：打开表时 `SHOW KEYS`/`information_schema`/`PRAGMA` 探测；无 PK 禁用 commit | 取代 `pickPkColumn` 猜测 |
| D5 | 整数输入：仅 `Number.isSafeInteger` 范围内转 number | 保护 bigint PK |
| D6 | 索引/FK 变更：内容 diff → DROP+ADD；字段用 `multi-check` | 修复「能改不能存」 |
| D7 | 假成功菜单：BI 禁用稍后；共享改「导出共享包」；逆向不跳占位 | AC-1.3 诚实 |
| D8 | 对象列表复用 `useColumnResize`；loading 保留旧表 | 体验对齐数据网格 |

## 3. 主要改动面

- `workspaceStore.ts`：closeDesignerTab 恢复 dirty confirm；listTabs* 含 designer；updateDesignerTab 扩字段
- `MainWorkspace.tsx`：关闭设计器勿无强制 force（脏时走 store confirm）
- `TableDesigner.tsx` + `ddl` 同步路径：create→alter；index/fk rebuild；multi-check
- `DataGrid.tsx`：真实 PK、安全 Number、底栏 SQL 按引擎 quote
- `ObjectListGrid.tsx`：modal 点击忽略、列宽、loading
- `TableContextMenu.tsx`：文案/禁用；操作后刷新信号
- 可选：`workspaceStore` 或自定义事件 `table-data-changed` 通知 DataGrid reload

## 4. 风险

- confirm 在 Tauri 仍可能偶发；必须 blur + setTimeout(0)
- 无主键表将无法在网格改删（正确行为，需明确 UI 提示）
