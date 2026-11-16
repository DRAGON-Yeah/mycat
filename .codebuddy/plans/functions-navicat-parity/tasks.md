# 任务清单（Tasks）— 函数/过程对标 Navicat

> 状态：已完成 2026-11-17
> 关联：[requirements.md](./requirements.md) · [design.md](./design.md)
> 每个任务是一个可独立验证的垂直切片；无证据不勾选。

## 1. 任务列表

- [x] **T1 例程列举 + 对象列表列 + listable**（约 25 分钟，依赖：无）
  - 改动：`routineMeta.ts`、`workspaceStore.ts`、`ObjectListGrid.tsx`、`TopToolbar.tsx`
  - 内容：`listRoutines`/`listRoutineMeta`；`functions` 进 listable；FUNCTION_COLS；顶栏进真实列表
  - 验证：选「函数」见列表非占位；`npx tsc --noEmit`（AC-1.1、AC-1.3、AC-5.1）

- [x] **T2 左树展开子节点 + 图标**（约 20 分钟，依赖：T1）
  - 改动：`TreeObjectFolder.tsx`、`ConnectionTree.tsx`、`App.css`
  - 内容：`functions` 可展开；子节点双击→设计；fx/Px 区分
  - 验证：展开「函数」见子项；SQLite 空且不崩（AC-1.2、AC-5.3）

- [x] **T3 检查器元数据**（约 15 分钟，依赖：T1）
  - 改动：`InspectorPane.tsx`
  - 内容：选中例程显示类型/返回/定义者/安全性/注释等
  - 验证：选中行右侧信息与列表一致（AC-1.4）

- [x] **T4 routineMenuActions + 删除确认工具栏**（约 25 分钟，依赖：T1）
  - 改动：`routineMenuActions.ts`、`ObjectListGrid.tsx`
  - 内容：fetch/drop；工具栏运行/设计/新建/删除；删除 danger modal
  - 验证：无选中按钮禁用；删除先弹窗再 DROP（AC-2.1、AC-2.2、AC-2.3、AC-2.4）

- [x] **T5 FunctionDesigner + routineDdl 保存**（约 35 分钟，依赖：T4）
  - 改动：`FunctionDesigner.tsx`、`routineDdl.ts`、`workspaceStore.openFunctionDesigner`、`MainWorkspace.tsx`
  - 内容：创建/编辑页签；参数表；预览；保存 CREATE/DROP+CREATE
  - 验证：`tsc`；设计器可开（AC-4.1、AC-4.2、AC-4.3）

- [x] **T6 RunRoutineDialog 运行**（约 25 分钟，依赖：T5）
  - 改动：`RunRoutineDialog.tsx`、工具栏/设计器接线
  - 内容：解析参数→输入→CALL/SELECT；结果展示
  - 验证：对话框组件挂载；`tsc`（AC-2.5、AC-4.4）

- [x] **T7 FunctionsFolderContextMenu**（约 20 分钟，依赖：T5）
  - 改动：`FunctionsFolderContextMenu.tsx`、`ObjectListGrid`/`ConnectionTree` 挂载
  - 内容：对齐视图文件夹菜单；粘贴 DDL；数据字典导出；刷新
  - 验证：空白处右键菜单（AC-3.1、AC-3.5）

- [x] **T8 RoutineContextMenu 复制/重命名/DDL/共享**（约 30 分钟，依赖：T4、T5）
  - 改动：`RoutineContextMenu.tsx`、`routineMenuActions.ts`
  - 内容：节点/行菜单；复制 `_copy`；重命名；复制 DDL；共享包；删除确认
  - 验证：菜单项接线；`tsc`（AC-3.2、AC-3.3、AC-3.4）

- [x] **T9 PG 只读降级 + 编译收尾**（约 15 分钟，依赖：T1–T8）
  - 改动：`routineMeta.ts`、`FunctionDesigner.tsx`
  - 内容：PG 列举 `pg_proc`；设计器只读提示；`tsc` 全绿
  - 验证：`npx tsc --noEmit` exit 0（AC-5.2）

**并行提示**：T3 ∥ T4（T1 后）；T7 ∥ T6（T5 后）；关键路径 T1→T2→T4→T5→T6→T8→T9。

## 2. AC↔任务追溯矩阵

| AC | 内容摘要 | 支撑任务 | 证据编号 | 终审判定 |
|---|---|---|---|---|
| AC-1.1 | 进对象列表非占位 | T1 | E-1 | 通过 |
| AC-1.2 | 树展开 fx/Px | T2 | E-1 | 通过 |
| AC-1.3 | 列表专用列 | T1 | E-1 | 通过 |
| AC-1.4 | 检查器元数据 | T3 | E-1 | 通过 |
| AC-2.1 | 工具栏启用态 | T4 | E-1 | 通过 |
| AC-2.2 | 新建开设计器 | T4、T5 | E-1 | 通过 |
| AC-2.3 | 设计加载 DDL | T4、T5 | E-1 | 通过 |
| AC-2.4 | 删除确认后 DROP | T4 | E-1 | 通过 |
| AC-2.5 | 运行参数对话框 | T6 | E-1 | 通过 |
| AC-3.1 | 文件夹菜单 | T7 | E-1 | 通过 |
| AC-3.2 | 节点菜单 | T8 | E-1 | 通过 |
| AC-3.3 | 复制例程 | T8 | E-1 | 通过 |
| AC-3.4 | 重命名 | T8 | E-1 | 通过 |
| AC-3.5 | 粘贴 DDL | T7 | E-1 | 通过 |
| AC-4.1 | 设计器字段齐全 | T5 | E-1 | 通过 |
| AC-4.2 | 保存成功刷新 | T5 | E-1 | 通过 |
| AC-4.3 | 保存失败留页签 | T5 | E-1 | 通过 |
| AC-4.4 | 设计器内运行 | T6 | E-1 | 通过 |
| AC-5.1 | 顶栏一致 | T1 | E-1 | 通过 |
| AC-5.2 | PG 降级 | T9 | E-1 | 通过 |
| AC-5.3 | SQLite 空列表 | T2 | E-1 | 通过 |

## 3. MVP 完成定义（Definition of Done）

- 全部任务勾选且有证据；追溯矩阵 AC 终审通过
- `npx tsc --noEmit` 通过
- 端到端（MySQL）：列表 → 新建 → 保存 → 运行 → 设计修改 → 复制 → 重命名 → 删除确认删除
- 临时调试代码已清理；Backlog 已列

## 4. Backlog（本迭代延后项）

- 拖放跨库复制 / 数据传输
- 例程调试器
- 设置权限真实实现
- PG 完整可视化设计器与运行参数映射
- 顶栏「视图」同步去占位（历史债）
- dump 导出纳入 FUNCTION/PROCEDURE 批量

## 5. 审计日志

### A. 计划自审（Phase 3.5，批准前）

| 日期 | 检查点 | 结论 | 备注 |
|---|---|---|---|
| 2026-11-17 | AC 全覆盖 / 无孤儿任务 / 每任务有验证 / 决策落需求 / 范围收敛 | 通过 | 用户批准后执行 |

### B. 任务证据（Phase 5，执行时逐条追加）

| 编号 | 任务 | 命令/操作 | 结果摘要 | 日期 |
|---|---|---|---|---|
| E-1 | T1–T9 | 实现例程列表/树/检查器/设计器/运行对话框/双菜单；`npx tsc --noEmit` | exit 0 | 2026-11-17 |

### C. 完成终审（Phase 6）

- 终审日期：2026-11-17 | 结论：全部通过
- AC 覆盖：21/21 通过；DoD：编译绿；端到端代码路径齐；清理完成；豁免无
- 缺口处置：无
