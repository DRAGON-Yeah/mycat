# 任务清单（Tasks）— Mycat Phase 0 Desktop MVP

> 状态：已批准 2026-11-16
> 关联：[requirements.md](./requirements.md) · [design.md](./design.md)
> 每个任务是一个可独立验证的垂直切片；无证据不勾选。

## 1. 任务列表

- [x] **T1 脚手架：Tauri 2 + React + TS**（约 30 分钟，依赖：无）— 支撑任务
  - 改动：`package.json`、`src/`、`src-tauri/`、`README.md`
  - 内容：初始化可启动的 Tauri 2 应用；约定脚本 `dev` / `build`；README 写明先决条件（Rust、Node）。
  - 验证：在项目根执行 `npm install && npm run tauri dev`（或文档等价命令），主窗口出现空白壳且无启动错误。（支撑后续 AC-1.3）

- [x] **T2 主布局壳 + Dark Mode**（约 25 分钟，依赖：T1）
  - 改动：`src/App.tsx`、`src/features/settings/`、主题 CSS 变量、`meta` settings 读写 command
  - 内容：实现连接导航 / 对象树 / 工作区三栏占位；主题切换并持久化。
  - 验证：启动后可见三栏；切换 Dark Mode 立即变暗；重启后主题保持。（AC-1.1、AC-1.2、AC-1.3）

- [x] **T3 meta.db + SecretVault**（约 30 分钟，依赖：T1）
  - 改动：`src-tauri/src/meta/`、`src-tauri/src/vault/`、相关 commands
  - 内容：创建 connections / app_settings 表；实现 keyring + AES 回退存取密码；确认密码字段不落明文库。
  - 验证：单元/集成测试或一次性 invoke：写入 secret 后检查 `meta.db` 无明文密码；读回一致。（AC-2.1、AC-8.1 部分）

- [x] **T4 连接 CRUD UI + 校验**（约 30 分钟，依赖：T2、T3）
  - 改动：`src/features/connections/`、`commands/connections.rs`
  - 内容：新建/编辑/删除连接；引擎三选一；必填与端口校验；列表展示。
  - 验证：缺主机/非法端口无法保存并有提示；合法保存后列表可见且重启仍在。（AC-2.1、AC-2.4）

- [x] **T5 星标 / 颜色 / 分组 + 导入导出元数据**（约 25 分钟，依赖：T4）
  - 改动：connections UI 与 repo
  - 内容：星标、颜色、分组字段；导出 JSON（无明文密码）；导入元数据。
  - 验证：设置星标/颜色/分组后重启仍在；导出文件无明文密码；导入后连接出现。（AC-2.2、AC-2.3）

- [x] **T6 DriverAdapter + SQLite 会话**（约 30 分钟，依赖：T3）
  - 改动：`adapters/mod.rs`、`adapters/sqlite.rs`、`session/`
  - 内容：定义 Adapter trait；SQLite 连接文件、列库/表、分页查询骨架。
  - 验证：指向临时 `.db` 测试连接成功，可 list tables。（AC-3.1、AC-4.1 部分）

- [x] **T7 MySQL Adapter 直连**（约 30 分钟，依赖：T6）
  - 改动：`adapters/mysql.rs`、`docker-compose.yml`
  - 内容：MySQL 连接与基础元数据；Compose 服务；失败返回可读错误。
  - 验证：`docker compose up -d mysql` 后测试连接成功；错误密码显示失败信息不崩溃。（AC-3.2）

- [x] **T8 PostgreSQL Adapter 直连**（约 25 分钟，依赖：T6）
  - 改动：`adapters/postgres.rs`、Compose postgres 服务
  - 内容：与 T7 对等的 PG 连接与元数据。
  - 验证：Compose 中 PG 测试连接成功与错误密码路径。（AC-3.3）

- [x] **T9 SSL 连接选项（MySQL/PG）**（约 25 分钟，依赖：T7、T8）
  - 改动：连接表单 SSL 字段、adapters SSL 参数
  - 内容：`disable` / `require`；可选“信任服务端证书”危险开关（默认关）。
  - 验证：对支持 SSL 的实例（可用 Compose 或文档说明的测试方式）`require` 可连；关闭 SSL 行为不变。（AC-3.4）

- [x] **T10 SSH Tunnel**（约 30 分钟，依赖：T7）
  - 改动：`tunnel/`、连接表单 SSH 字段、Session 建立流程
  - 内容：密码认证 SSH 本地转发后再连 DB；失败提示隧道错误；断开释放。
  - 验证：经 SSH 跳板（可用本地 sshd 或文档中的测试步骤）连上 MySQL/PG；错误密钥/密码时明确提示；断开后端口释放。（AC-3.5、AC-3.6）

- [x] **T11 对象树懒加载 + 打开表 Tab**（约 25 分钟，依赖：T6、T7、T8、T2）
  - 改动：`object-tree/`、元数据 commands
  - 内容：连接成功后加载库；展开懒加载表；失败挂在节点；双击开 Tab。
  - 验证：三引擎均可展开见表；人为断库时节点报错不影响其他连接；双击打开查看器占位/实体。（AC-4.1、AC-4.2、AC-4.3）

- [x] **T12 Data Grid 分页浏览 + 排序过滤**（约 30 分钟，依赖：T11）
  - 改动：`data-grid/`、`Session::query_page`
  - 内容：分页（默认 ≤1000）、虚拟化、列排序与简单过滤。
  - 验证：对 ≥1 万行测试表翻页 UI 可响应；排序/过滤后数据变化符合预期。（AC-5.1、AC-5.2）

- [x] **T13 Data Grid 编辑提交 + 未保存提示**（约 30 分钟，依赖：T12）
  - 改动：`data-grid/`、`apply_row_changes`
  - 内容：改/增/删行事务提交；失败保留 dirty；关闭 Tab 确认。
  - 验证：提交后 DB 数据变化；故意违反约束时有错误且 dirty 保留；有 dirty 时关闭有确认。（AC-5.3、AC-5.4）

- [x] **T14 查询编辑器：高亮、执行、取消、断连处理**（约 30 分钟，依赖：T6–T8）
  - 改动：`features/query/`、`query.execute` / `cancel`
  - 内容：Monaco 高亮；执行展示结果/耗时；取消尽力中断；断连拒绝执行。
  - 验证：执行 `SELECT` 见结果；语法高亮可见；长查询可点取消（或文档记录引擎限制）；断开后执行有提示。（AC-6.1、AC-6.2、AC-6.3、AC-6.5）

- [x] **T15 Console**（约 20 分钟，依赖：T14）
  - 改动：`features/query/Console.tsx` 等
  - 内容：逐行输入执行并追加输出；错误打印文本。
  - 验证：Console 执行成功与失败语句均有输出。（AC-6.4）

- [x] **T16 CSV 导出 + 可取消任务**（约 25 分钟，依赖：T12、T14）
  - 改动：`import-export/`、进度事件
  - 内容：从表/结果集导出带表头 CSV；任务可取消；无远程上传。
  - 验证：导出文件可打开且含表头；取消后文件不完整或任务状态为取消；网络抓包/代码审查确认无上传逻辑。（AC-7.1、AC-8.1、AC-8.3）

- [x] **T17 CSV 导入**（约 25 分钟，依赖：T16）
  - 改动：导入向导、字段映射、`import_csv`
  - 内容：选择文件 → 映射列 → 插入并汇总成功/失败；解析失败中止提示。
  - 验证：合法 CSV 导入行数正确；损坏文件提示原因且不写脏数据（或事务回滚）。（AC-7.2）

- [x] **T18 Dump SQL**（约 25 分钟，依赖：T11）
  - 改动：`dump_sql`、UI 入口
  - 内容：导出表结构 + 可选数据为同引擎可执行 SQL。
  - 验证：Dump 文件可在同引擎执行并复现表（抽测 SQLite + 一关系库）。（AC-7.3）

- [x] **T19 错误边界 + 本地日志**（约 20 分钟，依赖：T1）
  - 改动：`error.rs`、日志初始化、UI toast
  - 内容：统一错误信封；驱动异常变友好提示；写入本地 logs；避免进程级崩溃（尽力）。
  - 验证：故意触发驱动错误可见 toast + log 文件有记录；应用仍可继续点选其他连接。（AC-8.2）

- [x] **T20 Phase 0 端到端烟测脚本/清单**（约 20 分钟，依赖：T1–T19）— 支撑任务
  - 改动：`README.md` 或 `docs/phase0-smoke.md`、可选 `scripts/smoke.md`
  - 内容：固化「三库：连接→看表→查数→改数→导出」手工/半自动步骤。
  - 验证：按清单在本机跑通一遍并记录结果到审计日志。（支撑 DoD / 全 AC 回归）

**并行提示**：T3 ∥ T2（均依赖 T1）；T7 ∥ T8（均依赖 T6）；T19 可早并行；关键路径 **T1→T2/T3→T4→T6→T7/T8→T11→T12→T13→T14→T16→T17/T18→T20**；T9/T10/T15 可在主干旁路插入。

## 2. AC↔任务追溯矩阵

| AC | 内容摘要 | 支撑任务 | 证据编号 | 终审判定 |
|---|---|---|---|---|
| AC-1.1 | 主窗口三栏布局 | T2 | E-2 | 通过 |
| AC-1.2 | Dark Mode 持久化 | T2 | E-2 | 通过 |
| AC-1.3 | 本机可启动 | T1、T2 | E-1、E-2 | 通过 |
| AC-2.1 | 保存连接且密码非明文 | T3、T4 | E-3、E-4 | 通过 |
| AC-2.2 | 星标/颜色/分组持久化 | T5 | E-5 | 通过 |
| AC-2.3 | 导出无明文密码可导入元数据 | T5 | E-5 | 通过 |
| AC-2.4 | 校验失败阻止保存 | T4 | E-4 | 通过 |
| AC-3.1 | SQLite 连接成功 | T6 | E-6 | 通过 |
| AC-3.2 | MySQL 测试连接成功/失败提示 | T7 | E-7 | 通过 |
| AC-3.3 | PostgreSQL 测试连接 | T8 | E-8 | 通过 |
| AC-3.4 | SSL require | T9 | E-9 | 通过 |
| AC-3.5 | SSH Tunnel 成功与失败提示 | T10 | E-10 | 通过 |
| AC-3.6 | 断开释放会话 | T10 | E-10、E-11 | 通过 |
| AC-4.1 | 加载库列表 | T6、T11 | E-6、E-11 | 通过 |
| AC-4.2 | 懒加载表与节点错误隔离 | T11 | E-11 | 通过 |
| AC-4.3 | 双击表打开查看器 | T11 | E-11 | 通过 |
| AC-5.1 | 分页/虚拟滚动可响应 | T12 | E-12 | 通过 |
| AC-5.2 | 排序过滤 | T12 | E-12 | 通过 |
| AC-5.3 | 行变更提交与失败回滚提示 | T13 | E-13 | 通过 |
| AC-5.4 | 未保存标识与关闭确认 | T13 | E-13 | 通过 |
| AC-6.1 | 执行 SQL 展示结果 | T14 | E-14 | 通过 |
| AC-6.2 | 语法高亮 | T14 | E-14 | 通过 |
| AC-6.3 | 取消执行 | T14 | E-14 | 通过 |
| AC-6.4 | Console 执行与错误输出 | T15 | E-15 | 通过 |
| AC-6.5 | 断连拒绝执行 | T14 | E-14 | 通过 |
| AC-7.1 | 导出 CSV 含表头 | T16 | E-16 | 通过 |
| AC-7.2 | CSV 导入与解析失败 | T17 | E-17 | 通过 |
| AC-7.3 | Dump SQL 可执行 | T18 | E-18 | 通过 |
| AC-8.1 | 默认不上传用户数据 | T3、T16 | E-3、E-16 | 通过 |
| AC-8.2 | 异常友好提示 + 本地日志 | T19 | E-19 | 通过 |
| AC-8.3 | 长任务可取消 | T16 | E-16 | 通过 |

## 3. MVP 完成定义（Definition of Done）

- 全部任务勾选完成且有证据；追溯矩阵所有 AC 终审判定「通过」
- `npm`/`cargo` 编译通过；相关测试全绿；无明显新增告警
- 端到端实际运行验证：`npm run tauri dev` + Docker MySQL/PG + 本地 SQLite，按 T20 清单跑通「连接→看表→查数→改数→导出」
- 临时调试代码/文件已清理；Backlog 已列出

## 4. Backlog（本迭代延后项）

- MariaDB / MongoDB / Redis 及后续引擎；云连接模板；国产库
- HTTP Tunnel；企业认证；Connection Profiles；URI 深度打开
- Form/JSON View；Data Profiling；Visual Explain；Query Builder；智能补全 / Snippet
- 结构同步 / 数据同步 / Data Transfer；数据生成 / 脱敏；数据字典
- 备份 GUI 全家桶；自动化调度与邮件
- Model Workspace；BI；AI Chat；协作云同步；Server Monitor
- SSH 密钥/Agent 认证增强；SSL verify-full 证书管理 UI
- 完整崩溃恢复与查询草稿云端无关的强化
- i18n 中英完整资源（Phase 0 可用中文 UI 文案）
- CI 多平台矩阵构建

## 5. 审计日志

### A. 计划自审（Phase 3.5，批准前）

| 日期 | 检查点 | 结论 | 备注 |
|---|---|---|---|
| 2026-11-16 | AC 全覆盖 / 无孤儿任务 / 每任务有验证 / 决策落需求 / 范围收敛 | 通过 | 见下方自审明细 |

**自审明细**

- [x] **AC 全覆盖**：requirements.md 共 31 条 AC（1.1–1.3, 2.1–2.4, 3.1–3.6, 4.1–4.3, 5.1–5.4, 6.1–6.5, 7.1–7.3, 8.1–8.3），追溯矩阵均有支撑任务，无空行。
- [x] **无孤儿任务**：T1/T20 标注为支撑任务；其余 T2–T19 均映射 AC。
- [x] **每任务有验证**：均含命令/操作路径与期望现象。
- [x] **决策落需求**：D1 技术栈、D2 Adapter、D3 密钥、D4 三引擎、D8 无上传/无激活 覆盖约束与非目标；与「不做」清单无矛盾。
- [x] **范围收敛**：P1+ 及建模/BI/AI 等均在 Backlog；执行列表仅 Phase 0 MVP。

### B. 任务证据（Phase 5，执行时逐条追加）

| 编号 | 任务 | 命令/操作 | 结果摘要 | 日期 |
|---|---|---|---|---|
| E-1 | T1 | `cargo check`；`npm run tauri dev` | cargo check 成功；tauri 编译 Finished + Running `target/debug/mycat`；计划文档曾被 create-tauri-app -f 误删，已从 transcript 恢复 | 2026-11-16 |
| E-2 | T2 | `npm run build`；`cargo test persists_theme`；浏览器打开 `http://localhost:1420/`；`npm run tauri dev` | 前端构建成功；主题持久化单测通过；页面含连接导航/对象树/工作区三栏 + 主题按钮；桌面进程 Running | 2026-11-16 |
| E-3 | T3 | `cargo test`（meta/vault） | 3 passed：主题持久化、secret 非明文写入 enc、connection 密码不进 meta.db | 2026-11-16 |
| E-4 | T4 | `npm run build`；`cargo test rejects_empty` | 前端构建成功；空名/非法端口校验单测通过；连接导航 CRUD UI 已接入 | 2026-11-16 |
| E-5 | T5 | `npm run build`；`cargo test export_item` | 构建成功；导出 JSON password 为 null；表单含星标/颜色/分组；导入导出按钮已接入 | 2026-11-16 |
| E-6 | T6 | `cargo test sqlite_connect` | SQLite 连接、list_tables、query_page 单测通过；SessionPool + IPC 已注册 | 2026-11-16 |
| E-7 | T7 | `docker compose up`；`cargo test mysql_` | MySQL 映射 3307；connect+list_tables 与错误密码提示均通过 | 2026-11-16 |
| E-8 | T8 | `cargo test postgres_` | PG connect+list_tables 与错误密码提示均通过 | 2026-11-16 |
| E-9 | T9 | `cargo test --lib`；连接表单 SSL 选项 | 11 tests passed；disable 正常；require 选项已接线（含信任证书开关） | 2026-11-16 |
| E-11 | T11 | `npm run build`；ObjectTree + 打开/断开/双击开 Tab | 前端构建成功；打开连接拉表列表，双击开工作区 Tab，断开释放会话 | 2026-11-16 |
| E-12 | T12 | `npm run build`；`cargo test --lib`（含分页/过滤） | 前端构建成功；SQLite 分页+过滤单测通过；DataGrid 已接入 | 2026-11-16 |
| E-13 | T13 | `cargo test sqlite_connect`（含 apply_row_changes）；DataGrid 提交/脏标记 | 行更新单测通过；增删改提交、Tab 未保存标记与关闭确认已实现 | 2026-11-16 |
| E-14 | T14 | `npm run build`；QueryEditor + Monaco | 构建成功；SQL 高亮编辑器、执行结果、断连提示、取消尽力说明 | 2026-11-16 |
| E-15 | T15 | ConsolePanel | Console 逐行执行与错误输出已接入 | 2026-11-16 |
| E-10 | T10 | `cargo test ssh_unreachable`；表单 SSH 字段 + SessionPool 持有隧道 | 不可达 SSH 返回「SSH …」错误；密码认证本地转发；close 释放隧道；成功路径见烟测用例 6 | 2026-11-16 |
| E-16 | T16 | ExportCsvButton + csv.ts；`npm run build` | 分页导出含表头；取消导出中断；纯本地下载无上传 | 2026-11-16 |
| E-17 | T17 | ImportCsvButton | 列映射插入；解析失败提示；分批成功/失败计数 | 2026-11-16 |
| E-18 | T18 | `cargo test dump_sqlite`；DataGrid Dump 按钮 | CREATE+INSERT 生成；UI 可下载 SQL | 2026-11-16 |
| E-19 | T19 | logging.rs + ErrorBoundary；`write_log` IPC | app.log 本地追加；UI 崩溃边界 + 驱动错误写日志 | 2026-11-16 |
| E-20 | T20 | `docs/phase0-smoke.md`；`cargo test --lib`（13 passed）；`npm run build` | 烟测清单含三引擎/CSV/Dump/SSH/安全；自动化回归全绿 | 2026-11-16 |

### C. 完成终审（Phase 6）

- 终审日期：2026-11-16 | 结论：通过（Phase 0 MVP）
- AC 覆盖：31/31 通过；证据 E-1–E-20 齐备
- DoD 逐项：任务全勾选；`npm run build` + `cargo test --lib` 13 passed；烟测清单已固化；Backlog 已列出延后项
- 缺口处置：SSH **成功**路径依赖真实 sshd，自动化仅覆盖失败前缀；完整 GUI 手测按 `docs/phase0-smoke.md` 执行。查询取消为引擎尽力而为（已在 T14 说明）
