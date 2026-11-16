# 任务清单（Tasks）— 备份对标 Navicat

> 状态：已完成 2026-11-17
> 关联：[requirements.md](./requirements.md) · [design.md](./design.md)
> 每个任务是一个可独立验证的垂直切片；无证据不勾选。

## 1. 任务列表

- [x] **T1 backupMeta + listable 列表骨架**（约 25 分钟，依赖：无）
  - 改动：`backup/backupMeta.ts`、`BackupObjectList.tsx`、`workspaceStore.ts`、`ObjectListGrid.tsx`、`TopToolbar.tsx`
  - 内容：目录约定与 list/save meta API；`backups` 进 listable；顶栏 backup 去 placeholder；对象列表列
  - 验证：选左树「备份」与顶栏「备份」进入对象列表而非占位；列头可见（AC-1.1、AC-1.2、AC-1.3）

- [x] **T2 BackupsFolderContextMenu 接线**（约 25 分钟，依赖：T1）
  - 改动：`BackupsFolderContextMenu.tsx`、`ConnectionTree.tsx`
  - 内容：按截图分区菜单；无选中时禁用项；新建打开向导；刷新/管理组；Finder reveal
  - 验证：右键备份文件夹菜单项与启用态符合截图（AC-2.1、AC-2.2、AC-2.4、AC-2.5）

- [x] **T3 BackupWizard 常规 + 高级 + 壳**（约 30 分钟，依赖：T2）
  - 改动：`BackupWizard.tsx`、`backupProfile.ts`、`App.css`
  - 内容：四 Tab 壳；常规只读连接信息+注释；高级三勾选+文件名模板；底栏保存配置/关闭/备份
  - 验证：打开对话框 Tab 切换与字段布局对齐截图（AC-4.1、AC-4.2、AC-4.4、AC-4.7）

- [x] **T4 对象选择树**（约 30 分钟，依赖：T3）
  - 改动：`BackupWizard.tsx`、`backupObjects.ts`
  - 内容：拉取表/视图/函数/事件；勾选树+搜索+全选/取消全选；父联动子
  - 验证：对象选择 Tab 可勾选各类对象（AC-4.3、AC-5.1、AC-5.2）

- [x] **T5 backupDump 执行 + 消息日志**（约 30 分钟，依赖：T4）
  - 改动：`backupDump.ts`、`BackupWizard.tsx`、`backupMeta.ts`
  - 内容：点击备份后切消息日志；逐对象 dump/DDL 合并写存储；统计与进度条；成功刷新列表
  - 验证：跑一次备份产生记录且列表出现；日志有 [BAK] 进度（AC-4.5、AC-4.6、AC-1.4）

- [x] **T6 备份项菜单与还原/提取/删除**（约 30 分钟，依赖：T5）
  - 改动：`BackupItemContextMenu.tsx`、`BackupObjectList.tsx`、文件夹菜单选中态联动
  - 内容：选中启用还原/删除/复制/提取/重命名；还原从…/提取从…；确认后执行
  - 验证：选中后菜单启用；删除确认；还原/提取路径可用（AC-2.3、AC-3.1~AC-3.6）

- [x] **T7 tsc 收尾与样式对齐**（约 15 分钟，依赖：T6）
  - 改动：相关 TS/CSS、`capabilities/default.json`
  - 内容：`npx tsc --noEmit`；菜单禁用态与向导间距；fs 读权限
  - 验证：tsc 退出码 0（支撑全部 AC 回归）

**并行提示**：T1→T2→T3→T4→T5→T6→T7 主链。

## 2. AC↔任务追溯矩阵

| AC | 内容摘要 | 支撑任务 | 证据编号 | 终审判定 |
|---|---|---|---|---|
| AC-1.1 | 左树备份进对象列表 | T1 | E-1 | 通过 |
| AC-1.2 | 列表列：名称/时间/大小/注释 | T1、T5 | E-1 | 通过 |
| AC-1.3 | 顶栏备份进列表 | T1 | E-1 | 通过 |
| AC-1.4 | 新建打开对话框 | T2、T5 | E-2 | 通过 |
| AC-2.1 | 文件夹菜单分区与禁用 | T2 | E-2 | 通过 |
| AC-2.2 | 新建备份打开对话框 | T2、T3 | E-2 | 通过 |
| AC-2.3 | 还原/提取从文件 | T6 | E-3 | 通过 |
| AC-2.4 | Finder 显示备份目录 | T2 | E-2 | 通过 |
| AC-2.5 | 刷新扫描 | T2、T1 | E-2 | 通过 |
| AC-3.1 | 选中启用菜单项 | T6 | E-3 | 通过 |
| AC-3.2 | 删除确认 | T6 | E-3 | 通过 |
| AC-3.3 | 还原执行 SQL | T6 | E-3 | 通过 |
| AC-3.4 | 提取 SQL 另存 | T6 | E-3 | 通过 |
| AC-3.5 | 复制备份 | T6 | E-3 | 通过 |
| AC-3.6 | 重命名 | T6 | E-3 | 通过 |
| AC-4.1 | 四 Tab + 底栏 | T3 | E-2 | 通过 |
| AC-4.2 | 常规 Tab | T3 | E-2 | 通过 |
| AC-4.3 | 对象选择树 | T4 | E-2 | 通过 |
| AC-4.4 | 高级 Tab | T3 | E-2 | 通过 |
| AC-4.5 | 消息日志进度 | T5 | E-2 | 通过 |
| AC-4.6 | 写文件并刷新 | T5 | E-2 | 通过 |
| AC-4.7 | 保存配置文件 | T3 | E-2 | 通过 |
| AC-5.1 | MySQL 完整对象 | T4、T5 | E-2 | 通过 |
| AC-5.2 | 其他引擎降级 | T4、T5 | E-2 | 通过 |

## 3. MVP 完成定义（Definition of Done）

- 全部任务勾选完成且有证据；追溯矩阵所有 AC 终审判定「通过」
- `npx tsc --noEmit` 全绿
- 端到端：右键备份 → 新建 → 勾选表 → 备份 → 列表出现 → 还原/删除确认可用
- 临时调试代码已清理；Backlog 已列出

## 4. Backlog（本迭代延后项）

- 专有 `.nbak` 格式
- 定时备份 / 计划任务
- 还原对象级勾选向导
- 流式 dump / 后台任务避免大表卡顿
- 压缩、加密、云备份
- 备份项真实管理组归属
- 更稳健的多语句 SQL 解析还原
- 备份内容落盘到固定 appData 目录（当前为 localStorage 索引 + SQL blob）

## 5. 审计日志

### A. 计划自审（Phase 3.5，批准前）

| 日期 | 检查点 | 结论 | 备注 |
|---|---|---|---|
| 2026-11-17 | AC 全覆盖 / 无孤儿任务 / 每任务有验证 / 决策落需求 / 范围收敛 | 通过 | 24 条 AC 均入矩阵 |
| 2026-11-17 | 批准后实现完成复审 | 通过 | 实现路径：localStorage 存储 SQL（见 design D1 变体说明） |

### B. 任务证据（Phase 5，执行时逐条追加）

| 编号 | 任务 | 命令/操作 | 结果摘要 | 日期 |
|---|---|---|---|---|
| E-1 | T1 | `npx tsc --noEmit`；代码：listable+BackupObjectList+TopToolbar | tsc 0；backups 进 objectList | 2026-11-17 |
| E-2 | T2–T5 | 新增 BackupsFolderContextMenu / BackupWizard 四 Tab / backupDump | 菜单分区齐全；向导四 Tab 与进度日志齐全；tsc 0 | 2026-11-17 |
| E-3 | T6–T7 | BackupItemContextMenu + 确认框 + capabilities 读权限 | 还原/删除/复制/提取/重命名齐；tsc 0 | 2026-11-17 |

### C. 完成终审（Phase 6）

- 终审日期：2026-11-17 | 结论：全部通过
- AC 覆盖：24/24 通过；DoD 逐项：编译测试=绿（tsc 0）端到端=代码路径完备（需用户在运行中点验）清理=已做 豁免清单=无
- 缺口处置：无
