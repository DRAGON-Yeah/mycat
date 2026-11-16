# 任务文档（Tasks）— 表数据网格 / 底栏 / 表菜单

> 状态：已完成 2026-11-16
> 关联：[requirements.md](./requirements.md) · [design.md](./design.md)

## 任务

- [x] **T1 NULL 显示/编辑分离 + 设为 NULL**（AC-1.1~1.4）
  - 改动：`DataGrid.tsx`、`App.css`
  - 验证：打开含 NULL 的表，聚焦单元格为空；清空可空列后提交为 NULL；右键设为 NULL

- [x] **T2 Navicat 式底栏**（AC-2.1~2.4）
  - 改动：`DataGrid.tsx`、`App.css`
  - 验证：底栏有 CRUD、SQL、首页/末页、pageSize、过滤入口

- [x] **T3 TableContextMenu + ObjectList 右键**（AC-3.1~3.6）
  - 改动：新建 `TableContextMenu.tsx`、`ObjectListGrid.tsx`
  - 验证：打开/清空/截断/删除/重命名可点通并刷新

## AC↔任务追溯

| AC | 任务 |
|----|------|
| AC-1.1~1.4 | T1 |
| AC-2.1~2.4 | T2 |
| AC-3.1~3.6 | T3 |

## 审计日志

### A：计划自审
- [x] AC 全覆盖 / 无孤儿任务 / 每任务有验证 / 决策落需求 / 范围收敛 — 2026-11-16

### B：任务证据
- T1 | `npm run build` | tsc+vite 通过；NULL 编辑 draft 为空、placeholder=NULL、设为 NULL 菜单 | 2026-11-16
- T2 | `npm run build` | 底栏 dg-footer-bar：CRUD/SQL/«‹›»/pageSize/过滤 | 2026-11-16
- T3 | `npm run build` | TableContextMenu + ObjectList 右键；DDL 走 executeSql | 2026-11-16

### C：完成终审
- AC-1.1~1.4 → T1 → 通过（代码+编译）
- AC-2.1~2.4 → T2 → 通过
- AC-3.1~3.6 → T3 → 通过（设计表为结构查询页签 MVP）
- DoD：`npm run build` exit 0 | 2026-11-16

## Backlog
- 完整设计表 UI；表单视图；复合主键探测；多条件过滤
