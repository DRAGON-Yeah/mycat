# 设计文档（Design）— 事件对标 Navicat

> 状态：已完成 2026-11-17
> 关联：[requirements.md](./requirements.md) · [tasks.md](./tasks.md)

## 1. 总体架构

```
左树「事件」/ 顶栏 automation
        │
        ▼
 workspaceStore.selectObjectFolder(..., "events")
        │  listable → centerMode: objectList
        ▼
 ObjectListGrid (wantEvents)
   ├─ listEventMeta() → information_schema.EVENTS
   ├─ toolbar: 刷新 / 设计 / 新建 / 删除(+confirm)
   └─ context: EventsFolderContextMenu | EventContextMenu
        │
        ├─ openEventDesigner → DesignerTab.kind: "event"
        │         ▼
        │   EventDesigner + eventDdl.ts
        │         ▼
        │   CREATE / DROP EVENT / ALTER EVENT ENABLE|DISABLE
        │
        └─ enable/disable → ALTER EVENT … ENABLE|DISABLE
```

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 仅 MySQL/MariaDB 完整实现；PG/SQLite 空列表+提示 | Event Scheduler 为 MySQL 特性；与函数迭代引擎策略一致 |
| D2 | 前端 `executeSql` + `information_schema.EVENTS`，不改 Rust 适配器 | 与 `routineMeta`/`viewMeta` 一致，交付最快 |
| D3 | `DesignerTab.kind` 扩 `"event"`；`openEventDesigner` | 复用页签栈与 MainWorkspace |
| D4 | 修改事件 = 解析 SHOW CREATE → 编辑 → DROP + CREATE（或优先 ALTER 字段） | MySQL 无完整 OR REPLACE EVENT；复杂 plan 用 DROP+CREATE 更稳 |
| D5 | 启用/禁用用 `ALTER EVENT name ENABLE\|DISABLE`，不打开设计器 | Navicat 菜单常见快捷操作；列表状态列即时刷新 |
| D6 | 顶栏「自动化」映射到 events 列表（去掉 placeholder） | AC-1.5；文案暂不改，避免大改品牌栏 |
| D7 | 删除确认复用 danger-confirm-modal | 与视图/函数一致 |

## 3. 模块与组件

**新增**

- `src/features/object-list/eventMeta.ts`
- `src/features/nav-tree/EventsFolderContextMenu.tsx`
- `src/features/nav-tree/EventContextMenu.tsx`
- `src/features/nav-tree/eventMenuActions.ts`
- `src/features/event-designer/EventDesigner.tsx`
- `src/features/event-designer/eventDdl.ts`

**修改**

- `workspaceStore.ts` — listable + openEventDesigner + toolbar automation
- `ConnectionTree.tsx` / `TreeObjectFolder.tsx` — folder `"events"`
- `ObjectListGrid.tsx` — EVENT_COLS、工具栏、菜单
- `InspectorPane.tsx` — events 元数据
- `MainWorkspace.tsx` — kind===event
- `TopToolbar.tsx` — automation 去 placeholder
- `App.css` — Ev 徽章样式

## 4. 数据模型与配置

```ts
type EventMeta = {
  name: string;
  status: string;          // ENABLED | DISABLED | SLAVESIDE_DISABLED
  eventType: string;       // ONE TIME | RECURRENT
  executeAt: string;       // for ONE TIME
  intervalValue: string;
  intervalField: string;
  starts: string;
  ends: string;
  definer: string;
  onCompletion: string;    // PRESERVE | NOT PRESERVE
  created: string;
  lastAltered: string;
  lastExecuted: string;
  comment: string;
};
```

**列举 SQL（MySQL）**

```sql
SELECT EVENT_NAME, STATUS, EVENT_TYPE, EXECUTE_AT,
       INTERVAL_VALUE, INTERVAL_FIELD, STARTS, ENDS,
       DEFINER, ON_COMPLETION, CREATED, LAST_ALTERED,
       LAST_EXECUTED, EVENT_COMMENT
FROM information_schema.EVENTS
WHERE EVENT_SCHEMA = ?
ORDER BY EVENT_NAME;
```

**DDL**：`SHOW CREATE EVENT \`name\``

**设计器计划模型（MVP 表单）**

- `scheduleKind: "AT" | "EVERY"`
- AT：`atDatetime`（字符串，原样写入）
- EVERY：`everyExpr`（如 `1 HOUR`）+ 可选 `starts` / `ends`

## 5. 数据流（关键场景）

### 5.1 新建并保存

1. 「新建」→ `openEventDesigner({ mode:"create" })`
2. 填名称、EVERY 1 DAY、ENABLE、body
3. 预览 → `CREATE EVENT … ON SCHEDULE EVERY 1 DAY DO …`
4. 保存 → executeSql；成功 promote + 刷新

### 5.2 禁用

1. 右键「禁用」→ `ALTER EVENT db.ev DISABLE` → 列表状态变 DISABLED

### 5.3 删除

1. 「删除」→ danger modal → `DROP EVENT` → 刷新

## 6. 安全考量

- 标识符 `identOk`；schema 名 escape。
- body/schedule 用户输入按字面拼入 DDL；预览只读展示；失败信息不吞掉。
- DROP / 禁用需确认或明确菜单动作（禁用可不二次确认，与 Navicat 一致；删除必须确认）。

## 7. 与现有约定的对齐点

- 菜单 class、danger-confirm-modal、emitTableDataChanged、`mycat:object-list-refresh`
- 字典导出同 `exportAllRoutinesDictionary` 结构
- 快捷键：⌘D 设计、⌘N 新建、⌘R 刷新（事件无「运行函数」主路径；可选不做 ⌘O）

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| SHOW CREATE EVENT 解析复杂 | 提取 DO 之后 body；计划区支持「高级：原始 ON SCHEDULE 子句」兜底 |
| event_scheduler=OFF 时事件不跑 | 保存成功 toast 可附提示；完整开关进 Backlog |
| MariaDB 细微差异 | 以 information_schema 为准；失败展示服务端错误 |
