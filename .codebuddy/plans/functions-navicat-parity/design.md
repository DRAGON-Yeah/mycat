# 设计文档（Design）— 函数/过程对标 Navicat

> 状态：已完成 2026-11-17
> 关联：[requirements.md](./requirements.md) · [tasks.md](./tasks.md)

## 1. 总体架构

```
左树「函数」/ 顶栏 function
        │
        ▼
 workspaceStore.selectObjectFolder(..., "functions")
        │  listable → centerMode: objectList
        ▼
 ObjectListGrid (wantFunctions)
   ├─ listRoutines() → DbObject[] { name, kind: function|procedure }
   ├─ listRoutineMeta() → information_schema.ROUTINES
   ├─ toolbar: 刷新 / 运行 / 设计 / 新建 / 删除(+confirm)
   └─ context: FunctionsFolderContextMenu | RoutineContextMenu
        │
        ├─ openFunctionDesigner → DesignerTab.kind: "function"
        │         ▼
        │   FunctionDesigner + routineDdl.ts
        │         ▼
        │   executeSql(CREATE|DROP … FUNCTION/PROCEDURE)
        │
        └─ RunRoutineDialog → CALL / SELECT fn(…) → 结果区或 toast+查询页
```

失败分支：连接/库缺失 → alert；SQL 失败 → 菜单/设计器/运行框内 message；Save As 取消 → 静默关闭。

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | MySQL 完整实现；PG 只读列举+定义；SQLite 空列表提示 | 与视图迭代策略一致；PRD O-01 函数为 P1，MySQL 为当前主力 |
| D2 | 扩展 `TreeObjectFolder` / `listTables` 同构，或新增 `listRoutines` 前端 SQL | 现有 adapters 无 ROUTINES；前端 `executeSql` + `information_schema` 最快且与 `viewMeta.ts` 一致，避免本迭代改 Rust 适配器 |
| D3 | `DesignerTab.kind` 扩为 `"table" \| "view" \| "function"`，并加 `routineType?: "FUNCTION" \| "PROCEDURE"` | 复用页签栈与 MainWorkspace 挂载，少造 centerMode |
| D4 | 修改例程 = 解析 SHOW CREATE → 编辑 → `DROP` + `CREATE`（同事务不可跨；顺序执行） | MySQL 无 CREATE OR REPLACE PROCEDURE；与常见 GUI 工具一致 |
| D5 | 「打开」语义改为「运行」而非打开数据网格 | Navicat 文档：对象窗格用「运行函数」；函数无表数据可开 |
| D6 | 节点菜单独立 `RoutineContextMenu`（或 TableContextMenu 增 `isRoutine`） | 视图已把 TableContextMenu 撑得很重；独立菜单更清晰，复用 actions 模块 |
| D7 | 删除确认复用视图的 danger-confirm-modal 模式 | 刚修好的工具栏删除确认；禁止 window.confirm |

## 3. 模块与组件

**新增**

- `src/features/object-list/routineMeta.ts` — `listRoutines` / `listRoutineMeta` / 类型
- `src/features/nav-tree/FunctionsFolderContextMenu.tsx` — 文件夹/空白处菜单
- `src/features/nav-tree/RoutineContextMenu.tsx` — 节点/行菜单 + 确认/复制/重命名/粘贴态
- `src/features/nav-tree/routineMenuActions.ts` — fetchRoutineDdl / dropRoutine / copyRoutine / renameRoutine / exportAllRoutinesDictionary / runRoutineSql
- `src/features/function-designer/FunctionDesigner.tsx` — 设计器 UI
- `src/features/function-designer/routineDdl.ts` — 解析/生成 CREATE、改名 rewrite
- `src/features/function-designer/RunRoutineDialog.tsx` — 参数输入与执行

**修改**

- `workspaceStore.ts` — listable 含 functions；`openFunctionDesigner`；顶栏 function → objectList
- `ConnectionTree.tsx` / `TreeObjectFolder.tsx` — folder id `"functions"` 可展开
- `ObjectListGrid.tsx` — FUNCTION_COLS、工具栏、删除确认、菜单挂载
- `InspectorPane.tsx` — functions 元数据块
- `MainWorkspace.tsx` — kind===function → FunctionDesigner
- `TopToolbar.tsx` — 若仍走 placeholder，改为 `selectObjectFolder(..., "functions")`
- `App.css` — fx/Px 图标样式（可复用 object-kind）

## 4. 数据模型与配置

**Routine 列表行（前端）**

```ts
type RoutineRow = {
  name: string;
  routineType: "FUNCTION" | "PROCEDURE";
  returns: string;      // DTD_IDENTIFIER or ""
  definer: string;
  securityType: string; // DEFINER | INVOKER
  created?: string;
  lastAltered?: string;
  comment?: string;
  isDeterministic?: string;
};
```

**MySQL 列举 SQL（示意）**

```sql
SELECT ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER, DEFINER,
       SECURITY_TYPE, CREATED, LAST_ALTERED, ROUTINE_COMMENT, IS_DETERMINISTIC
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = ?
ORDER BY ROUTINE_NAME;
```

**DDL**

- `SHOW CREATE FUNCTION \`name\``
- `SHOW CREATE PROCEDURE \`name\``

**DesignerTab 扩展字段**

- `kind: "function"`
- `routineType?: "FUNCTION" | "PROCEDURE"`（create 默认 PROCEDURE 或由新建向导选择；alter 从 meta 推断）

## 5. 数据流（关键场景走查）

### 5.1 新建并保存 FUNCTION

1. 工具栏「新建」→ `openFunctionDesigner({ mode:"create", routine:"new_func" })`
2. 用户选类型 FUNCTION、填参数/返回类型/函数体
3. 预览生成 `CREATE FUNCTION ... RETURNS ... BEGIN ... END`
4. 保存 → `executeSql`；成功则 `promote` 为 alter、emit 刷新、toast

### 5.2 运行带参 PROCEDURE

1. 选中 →「运行」→ `RunRoutineDialog` 根据 PARAMETERS 或解析 DDL 填表
2. 确认 → `CALL db.proc(?,?,?)`；有结果集则开查询结果或内嵌结果表；错误展示 message

### 5.3 删除

1. 「删除」→ danger modal「确定删除函数/过程 `name`？」
2. 确认 → `DROP FUNCTION|PROCEDURE` → 刷新树与列表

## 6. 安全考量

- 标识符白名单 `identOk`，库名/名拼接防注入；meta SQL 对 schema 做 `'` escape。
- DEFINER 高级属性仅写入用户显式填写内容，默认不伪造高权限 definer。
- DROP 必须二次确认；运行参数按字面量转义（字符串引号加倍）。

## 7. 与现有约定的对齐点

- 菜单 class：`dg-context-menu` / `conn-context-menu` / `danger-confirm-modal`
- 字典导出：原生 Save As + 与 `exportAllViewsDictionary` 同结构
- 刷新：`emitTableDataChanged` 或本地 `tick`/`onRefresh`（树已有 refresh 回调）
- 快捷键：⌘O 映射为运行（或保留设计；**对齐 Navicat：工具栏主操作为运行/设计/新建/删除**；快捷键 ⌘O=运行、⌘D=设计、⌘N=新建、⌘R=刷新）

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| SHOW CREATE 含 DEFINER/`sql security` 难解析 | 保守解析：提取参数括号与 BEGIN…END / RETURN 体；高级区可整段 DDL 编辑兜底 |
| DELIMITER 客户端语义 | 通过 `executeSql` 单语句发送完整 CREATE，不依赖客户端 delimiter |
| PG 差异大 | AC-5.2 降级只读；完整设计进 Backlog |
