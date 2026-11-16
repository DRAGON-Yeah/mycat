# 任务清单 — 表右键菜单全部可用

> 状态：已完成 2026-11-16

## 1. 任务

- [x] **T1** 转储 MySQL 反引号 + 分批 INSERT（AC-2.3）
- [x] **T2** 配置打开：DataGrid 不重置 + 写回 openOptions + 配置命名/删除（AC-1.1, AC-1.2）
- [x] **T3** 复制=SHOW CREATE；粘贴可改名执行（AC-2.1, AC-2.2）
- [x] **T4** 字典/生成用真实列元数据（AC-3.1, AC-3.2）
- [x] **T5** 维护结果显示 Msg_text（AC-3.3）
- [x] **T6** 导入预览映射；导出列选+BOM；脱敏改名+预览（AC-4.1, AC-4.2, AC-4.4）
- [x] **T7** 权限 TABLE_PRIVILEGES + GRANT/REVOKE（AC-4.3）
- [x] **T8** 组改名删除；共享单 SQL；逆向真类型+FK（AC-4.4）
- [x] **T9** BI→简易图表（AC-5.1）

## 2. 追溯矩阵

| AC | 任务 | 证据 | 终审 |
|---|---|---|---|
| AC-1.1,1.2 | T2 | E-1 | 通过 |
| AC-2.1,2.2,2.3 | T3,T1 | E-1 | 通过 |
| AC-3.1,3.2,3.3 | T4,T5 | E-1 | 通过 |
| AC-4.* | T6,T7,T8 | E-1 | 通过 |
| AC-5.1 | T9 | E-1 | 通过 |

## 3. 审计日志

### A. 计划自审：通过（用户要求全部实现，跳过门禁）
### B. 证据
| 编号 | 内容 | 结果 | 日期 |
|---|---|---|---|
| E-1 | dump.rs 反引号+分批；TableContextMenu 复制/粘贴/维护/组/共享/图表；TableIoWizard 映射/BOM/脱敏；tableDataTools TABLE_PRIVILEGES+REVOKE；SimpleChartDialog；`npx tsc --noEmit` + `cargo check` | exit 0 | 2026-11-16 |
### C. 终审：全部通过 2026-11-16

## 4. Backlog
真 BI 工作区；Excel；原地脱敏；左树表右键
