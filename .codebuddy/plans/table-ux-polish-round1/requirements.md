# 需求文档（Requirements）— 表设计/查看体验补齐（Round 1）

> 状态：已批准 2026-11-16（用户「帮我都优化好」视为直接执行）
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Standard | 范围：MVP（延后项见 tasks.md Backlog）

## 1. 问题陈述（Problem Statement）

表右键菜单与设计器 MVP 已勾选完成，但审计发现多条「看起来可用、实际半残或会丢数据」的路径：设计器关页丢稿、新建表保存后仍 CREATE、右键对话框一点就关、网格主键猜测错误、索引/外键改了不落库、菜单假成功等。本轮只修 P0 + 关键 P1，让「设计表 / 查看表 / 右键操作」主路径可信、可退出、不假成功。

## 2. 用户故事与验收标准（User Stories & EARS AC）

### US-1 不丢未保存设计

作为用户，我想安全关闭设计器，以便不误丢未保存结构。

- **AC-1.1**：When 设计器有未保存更改且用户点 ×，the system shall 延迟弹出确认，取消则保持打开。
- **AC-1.2**：When 关闭数据库/连接时存在脏设计器页签，the system shall 将其列入确认列表或阻止静默丢弃。

### US-2 新建表保存后可继续改

作为用户，我想创建表成功后继续改结构，以便不用重新打开设计器。

- **AC-2.1**：When 新建表保存成功，the system shall 将该设计器页签切为 alter 模式（或关闭创建页仅留数据页），再次保存不得再执行 CREATE TABLE。

### US-3 右键对话框可用

作为用户，我想在重命名/复制等对话框中输入，以便完成操作。

- **AC-3.1**：When 表右键对话框打开且用户点击输入框，the system shall 不卸载对话框。

### US-4 网格按真实主键保存

作为用户，我想安全编辑表数据，以便不会改错行或弄坏 bigint。

- **AC-4.1**：When 提交行更改，the system shall 使用真实主键列；若无主键则禁止改删并提示。
- **AC-4.2**：When 解析单元格输入，the system shall 不对超出安全整数范围的值做 Number()。

### US-5 设计器索引/外键可真正保存

作为用户，我想修改索引与外键后保存生效，以便结构与 UI 一致。

- **AC-5.1**：When 已有索引/外键内容变更后保存，the system shall DROP+重建（或等价 ALTER），reload 后与编辑一致。
- **AC-5.2**：When 选择索引/外键字段，the system shall 支持多列勾选。

### US-6 菜单诚实、列表与网格体验

作为用户，我想菜单与列表行为诚实、可用，以便不被假成功误导。

- **AC-6.1**：When 点击尚未实现或仅本地导出的菜单项，the system shall 使用诚实文案（禁用「稍后」或标明导出/占位）。
- **AC-6.2**：When 在对象列表，the system shall 支持拖拽列宽；刷新时不整表闪空。
- **AC-6.3**：When 清空/截断/生成数据或创建表成功，the system shall 刷新相关对象列表与已打开数据网格（或提示）。
- **AC-6.4**：If 未选择数据库就打开表/设计器，then the system shall 明确提示，不得静默失败。

## 3. 约束与非目标

**技术约束**

- Tauri 2 + React/TS；沿用 `executeSql(..., database)`、`useColumnResize`、`quoteTable`
- 原生 `window.confirm` 必须 defer，避免 pointerdown 误取消

**非目标（本轮不做）**

- 左树表节点右键、云 LLM 建表、表单视图、多条件过滤、PG 切库重连、完整 GRANT 管理、enum 值编辑器完整化
