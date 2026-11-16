# 技术设计 — 表右键菜单全部可用

> 状态：已批准 2026-11-16

## 关键决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | 字典/生成/逆向统一走 `loadDesignerColumns` + indexes/FKs | 已有正确元数据 |
| D2 | MySQL dump 标识符用反引号；INSERT 分批 | 可 round-trip |
| D3 | 复制=SHOW CREATE；粘贴可改表名后执行 | 打通复制→粘贴 |
| D4 | DataGrid：去掉无条件 reset；sort/filter 写回 openOptions | 配置打开可用 |
| D5 | 维护类 SQL 用查询路径返回结果集 | 用户能看到 Msg_text |
| D6 | BI 菜单改为本地简易图表（柱/饼），不做工作区 | 诚实交付 |
| D7 | 权限用 information_schema.TABLE_PRIVILEGES | 看的是表上授权 |

## 主要改动文件
`dump.rs`, `DataGrid.tsx`, `workspaceStore.ts`, `TableContextMenu.tsx`, `tableMenuActions.ts`, `tableDataTools.ts`, `tableProfiles.ts`, `TableIoWizard.tsx`, 新建 `SimpleChartDialog.tsx`
