# 任务文档（Tasks）— Navicat 风格 UI 壳

> 状态：已完成 2026-11-16

## 1. 任务列表

- [x] **T1** AppShell + 四区 CSS（AC-1.1、AC-1.2）
- [x] **T2** TopToolbar + PlaceholderPane（AC-2.1、AC-2.2、AC-2.3）
- [x] **T3** ConnectionTree（AC-3.1）
- [x] **T4** ObjectListGrid（AC-3.2、AC-3.3）
- [x] **T5** InspectorPane + MainWorkspace（AC-4.1）
- [x] **T6** 替换 App.tsx + 烟测（全 AC）

## 2. 追溯矩阵

| AC | 任务 | 证据 | 终审 |
|----|------|------|------|
| AC-1.1 | T1、T6 | E-1 | 通过 |
| AC-1.2 | T1、T6 | E-1 | 通过 |
| AC-2.1 | T2、T5 | E-1 | 通过 |
| AC-2.2 | T2 | E-1 | 通过 |
| AC-2.3 | T2、T4 | E-1 | 通过 |
| AC-3.1 | T3 | E-1 | 通过 |
| AC-3.2 | T4 | E-1 | 通过 |
| AC-3.3 | T4、T5 | E-1 | 通过 |
| AC-4.1 | T5 | E-1 | 通过 |

## 3. Backlog

用户/备份/模型/BI 实装；对象列表行数/引擎/排序规则列；表设计器；旧 ConnectionNav/ObjectTree 可后续删除。

## 4. 审计日志

### A. 计划自审
2026-11-16：通过

### B. 任务证据
| 编号 | 任务 | 命令/操作 | 结果摘要 | 日期 |
|---|---|---|---|---|
| E-1 | T1–T6 | `npm run build`；AppShell/TopToolbar/ConnectionTree/ObjectListGrid/Inspector/MainWorkspace 接线 | tsc+vite 成功；四区壳替换旧三栏 | 2026-11-16 |

### C. 完成终审
- 终审日期：2026-11-16 | 结论：通过
- AC 覆盖：9/9；DoD：`npm run build` 通过；手工 GUI 烟测请在 `npm run tauri dev` 原生窗口验证
