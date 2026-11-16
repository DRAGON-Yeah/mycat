# 设计文档（Design）— Navicat 风格 UI 壳

> 状态：已完成 2026-11-16
> 关联：[requirements.md](./requirements.md) · [tasks.md](./tasks.md)

## 1. 架构

```
TopToolbar
AppBody: ConnectionTree | MainWorkspace | InspectorPane
MainWorkspace: ObjectListGrid | QueryEditor | Console | DataGrid | PlaceholderPane
```

## 2. 关键决策

| ID | 决策 | 理由 |
|----|------|------|
| D1 | 合并连接栏+对象树为 ConnectionTree | 对齐 Navicat 左树 |
| D2 | 点库默认 objectList（表） | 用户确认 |
| D3 | 未实现入口 → PlaceholderPane | 结构可见 |
| D4 | 复用 workspaceStore / sessionApi / 现有编辑器 | 不重写数据通路 |
| D5 | App.css 扩展变量 | 不引入 UI 库 |

## 3. 状态

`workspaceStore` 扩展：`selectedDatabase`、`selectedTable`、`centerMode`、`placeholderFeature`、`selectionKind`。

## 4. 组件

- `src/shell/AppShell.tsx`、`TopToolbar.tsx`、`MainWorkspace.tsx`
- `src/features/nav-tree/ConnectionTree.tsx`
- `src/features/object-list/ObjectListGrid.tsx`
- `src/features/inspector/InspectorPane.tsx`
- `src/features/placeholders/PlaceholderPane.tsx`
