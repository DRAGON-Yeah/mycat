# 设计文档（Design）— 表数据网格 / 底栏 / 表菜单

> 状态：已批准 2026-11-16
> 关联：[requirements.md](./requirements.md) · [tasks.md](./tasks.md)

## 1. 关键决策

| ID | 决策 | 理由 |
|----|------|------|
| D1 | NULL 显示与编辑分离：展示 `NULL`，编辑 draft 为空串 | 对齐 Navicat，避免字面量污染 |
| D2 | 可空列：空串提交为 `null`；不可空列保持空串并依赖后端报错 | 简单可预期 |
| D3 | 底栏合并 SQL 条 + 状态条为 Navicat 式 footer；顶栏保留导入导出 | 参考图 2 |
| D4 | 新建 `TableContextMenu`，ObjectListGrid 右键接入；DDL 走 `executeSql` | 无新 IPC |
| D5 | 「设计表」MVP 打开只读结构查询页签（SHOW COLUMNS / 信息提示） | 完整设计器进 Backlog |

## 2. 组件

- `DataGrid.tsx`：editingCell 状态、底栏重排、设为 NULL
- `TableContextMenu.tsx`：打开/清空/截断/删除/重命名
- `ObjectListGrid.tsx`：右键接线 + 刷新回调
- `App.css`：底栏与 null 编辑样式

## 3. 安全

- DDL 操作必须 `window.confirm`；标识符用反引号转义。
