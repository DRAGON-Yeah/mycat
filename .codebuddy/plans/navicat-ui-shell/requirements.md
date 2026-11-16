# 需求文档（Requirements）— Navicat 风格 UI 壳

> 状态：已完成 2026-11-16
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Standard | 范围：MVP（延后项见 tasks.md Backlog）

## 1. 问题陈述

当前 My Navicat 为「连接栏 | 对象树 | 工作区」三栏，与 Navicat Premium 的顶栏图标菜单 + 左连接树 + 中间对象列表 + 右信息面板不一致，学习与操作路径割裂。本迭代将壳与导航对齐 Navicat 结构，复用既有表浏览/查询能力。

## 2. 用户故事与验收标准

### US-1 四区壳布局

作为用户，我想要看到与 Navicat 类似的四区布局，以便按熟悉方式导航。

- **AC-1.1**：When 应用启动, the system shall 显示顶栏、左树、中间主区、右侧信息面板。
- **AC-1.2**：The system shall 在明/暗主题下保持四区可读。

### US-2 顶栏菜单

作为用户，我想要通过顶栏切换主要功能入口。

- **AC-2.1**：When 点击「查询」, the system shall 打开查询工作区。
- **AC-2.2**：When 点击尚未实现的入口（用户/备份/模型/BI 等）, the system shall 显示「尚未实现」占位，不崩溃。
- **AC-2.3**：When 有选中库且点击「表」, the system shall 显示该库表对象列表。

### US-3 左连接树与表清单

作为用户，我想要在左树展开连接→数据库→表，并在中间看到表清单。

- **AC-3.1**：When 打开连接, the system shall 列出数据库。
- **AC-3.2**：When 点击某数据库, the system shall 默认进入「表」上下文并在中间显示表清单。
- **AC-3.3**：When 双击表清单中的表, the system shall 打开既有 DataGrid。

### US-4 右侧信息面板

作为用户，我想要在右侧看到当前选中对象的基本信息。

- **AC-4.1**：When 选中连接/库/表, the system shall 在右侧展示名称与关键元数据（可用字段即可）。

## 3. 约束与非目标

**约束**：Tauri 2 + React + TS；复用 sessionApi / DataGrid / Query / Console；不新增后端 IPC（表名列表足够）。

**非目标**：用户管理、备份、自动化、模型、BI、表设计器、对象列表完整元数据列、像素级皮肤。
