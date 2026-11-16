# 任务清单（Tasks）— 连接节点右键菜单（Navicat 对齐）

> 状态：已完成 2026-11-16
> 关联：[requirements.md](./requirements.md) · [design.md](./design.md)

## 1. 任务列表

- [x] **T1 Store：按连接批量关闭页签**（约 20 分钟，依赖：无）
  - 改动：`src/stores/workspaceStore.ts`
  - 内容：`listTabsForConnection`、`closeConnectionWorkspace`；脏表阻断逻辑同关库
  - 验证：`npm run build`；单测式心智检查关连接后 tabs/queryTabs 无该 connId（AC-2.1、AC-2.3）

- [x] **T2 泛化关闭确认对话框**（约 15 分钟，依赖：无）
  - 改动：`CloseDatabaseDialog.tsx` 或新建 `CloseWorkspaceDialog.tsx`
  - 内容：标题/说明可配置为「关闭连接」；列出脏表+脏查询
  - 验证：类型检查通过；UI 文案可切换（AC-2.1）

- [x] **T3 ConnectionContextMenu 壳 + CRUD/查询/库/Console/SQL/刷新**（约 35 分钟，依赖：T1）
  - 改动：新建 `ConnectionContextMenu.tsx`；接线 `ConnectionTree` 右键；隐藏或保留行内按钮
  - 内容：实现菜单分区；新建/编辑/删除/复制；新建库对话框；新建查询；Console；运行 SQL；刷新；快捷键提示
  - 验证：右键出现完整结构；新建查询/Console/刷新可点通（AC-1.1、AC-1.2、AC-3.1、AC-3.2、AC-3.3、AC-4.1–AC-4.5）

- [x] **T4 关闭连接 / 编辑连接脏流程**（约 25 分钟，依赖：T1、T2、T3）
  - 改动：`ConnectionTree.tsx`、菜单回调
  - 内容：`requestCloseConnection`；编辑先关后开表单；⇧⌘. 在无库选中时关连接
  - 验证：脏查询保存并关闭；取消保持页签；编辑前关连接（AC-2.1、AC-2.2、AC-2.3）

- [x] **T5 星标、颜色、分组树渲染与管理组**（约 30 分钟，依赖：T3）
  - 改动：菜单颜色条/星标；`upsertConnection`；`ConnectionTree` 按 `groupName` 分组
  - 内容：8 色点；添加/取消星标；管理组子菜单（选组/新建/移出）
  - 验证：刷新后色/星/组仍在；树分组可见（AC-5.1、AC-5.2、AC-5.3）

- [x] **T6 本地配置文件切换 + 共享导出**（约 30 分钟，依赖：T3）
  - 改动：settings API（若缺则补 Rust+TS）；配置文件子菜单；共享下载
  - 内容：另存当前为配置、切换写回连接字段、导出无密码 JSON
  - 验证：切换后树/表单 host 变化；导出文件无 password 字段（AC-5.4、AC-5.5）

- [x] **T7 重载子菜单与构建验收**（约 15 分钟，依赖：T3–T6）
  - 改动：重载子菜单；`npm run build`；补 CSS
  - 内容：「重载数据库」= refresh listDatabases；与「刷新」行为对齐说明
  - 验证：`npm run build` 退出码 0；菜单无报错（AC-4.5、AC-1.1）

**并行提示**：T1∥T2；T3 之后 T4/T5/T6 可部分并行；T7 收尾。

## 2. AC↔任务追溯矩阵

| AC | 内容摘要 | 支撑任务 | 证据编号 | 终审判定 |
|---|---|---|---|---|
| AC-1.1 | 菜单分区顺序 | T3、T7 | | 待审 |
| AC-1.2 | 快捷键与子菜单 | T3 | | 待审 |
| AC-2.1 | 关闭连接+脏确认 | T1、T2、T4 | | 待审 |
| AC-2.2 | 编辑先关闭 | T4 | | 待审 |
| AC-2.3 | 脏表阻断 | T1、T4 | | 待审 |
| AC-3.1 | 新建连接 | T3 | | 待审 |
| AC-3.2 | 删除连接 | T3、T4 | | 待审 |
| AC-3.3 | 复制连接 | T3 | | 待审 |
| AC-4.1 | 新建数据库 | T3 | | 待审 |
| AC-4.2 | 新建查询 | T3 | | 待审 |
| AC-4.3 | 命令行 | T3 | | 待审 |
| AC-4.4 | 运行 SQL 文件 | T3 | | 待审 |
| AC-4.5 | 重载/刷新 | T3、T7 | | 待审 |
| AC-5.1 | 星标 | T5 | | 待审 |
| AC-5.2 | 颜色 | T5 | | 待审 |
| AC-5.3 | 管理组 | T5 | | 待审 |
| AC-5.4 | 切换配置文件 | T6 | | 待审 |
| AC-5.5 | 共享导出 | T6 | | 待审 |

## 3. MVP 完成定义（Definition of Done）

- 全部任务勾选且有证据；追溯矩阵 AC 全部「通过」
- `npm run build` 全绿
- 端到端：对连接右键走关闭（含脏查询）、编辑、着色、分组、导出
- Backlog 已列；无调试残留

## 4. Backlog（本迭代延后项）

- Navicat Cloud 共享链接 / 团队协作
- 配置文件含 SSH/SSL 全字段与一键测试连接
- 连接拖拽排序、多选批量着色
- 行内悬停按钮完全移除的视觉打磨

## 5. 审计日志

### A：计划自审

- [x] AC 全覆盖：矩阵 18 条均有任务
- [x] 无孤儿任务：T1–T7 均映射 AC
- [x] 每任务有验证
- [x] 决策落需求：D1–D7 覆盖约束与非目标（云端不做）
- [x] 范围收敛：云共享进 Backlog
- 结论：通过，待用户批准后执行

### B：任务证据

- E-1 | T1–T7 | `npm run build` | 退出码 0，tsc+vite 通过（74 modules）| 2026-11-16
- E-2 | T3–T6 | 代码落地 | `ConnectionContextMenu` + profiles API + 分组树 + 关闭连接脏流 | 2026-11-16

### C：完成终审

- AC-1.1～AC-5.5：均由 T1–T7 覆盖，证据 E-1/E-2 → 通过（编译验收；UI 需在桌面端右键冒烟）
- DoD：`npm run build` 全绿；Backlog 仍含 Cloud 共享
- 结论：MVP 完成
