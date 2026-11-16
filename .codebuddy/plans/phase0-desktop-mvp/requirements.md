# 需求文档（Requirements）— My Navicat Phase 0 Desktop MVP

> 状态：已批准 2026-11-16
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Complex | 范围：MVP（延后项见 tasks.md 文末 Backlog）
> 来源：[navicat-prd.md](../../../navicat-prd.md) Phase 0 + 用户确认默认假设（2026-11-16）

## 1. 问题陈述（Problem Statement）

开发者与 DBA 需要在桌面端统一管理多种关系型数据库，完成连接、浏览、查询与简单导入导出。仓库目前仅有产品 PRD、无代码实现。本迭代交付 **My Navicat Phase 0 骨架**：基于 Tauri 2 + React + TypeScript + Rust，打通 **MySQL / PostgreSQL / SQLite** 的「连上 → 看表 → 查数 → 改数 → 导出」闭环，凭证本地加密，支持 SSH Tunnel 与 SSL，并提供 Dark Mode。成功标准：三引擎均可完成上述主路径；UI 在万级行分页浏览下保持可交互。

## 2. 用户故事与验收标准（User Stories & EARS AC）

### US-1 启动应用壳与主题

作为开发者，我想要打开跨平台桌面应用并使用暗色主题，以便有可用的工作台承载后续功能。

- **AC-1.1**：When 用户启动应用, the system shall 显示主窗口，含连接导航区、对象树区与工作区 Tabs 占位布局。
- **AC-1.2**：When 用户切换 Dark Mode, the system shall 立即应用暗色主题并在下次启动时恢复该偏好。
- **AC-1.3**：The system shall 在 macOS / Windows / Linux 目标平台上可通过官方开发命令启动（本机至少验证当前开发机平台）。

### US-2 管理连接与加密凭证

作为开发者，我想要创建、编辑、删除、分组与着色数据库连接，并安全保存密码，以便复用多环境连接且不泄露明文凭证。

- **AC-2.1**：When 用户新建连接并填写引擎类型、主机、端口、用户名、密码与显示名后保存, the system shall 持久化连接元数据，且密码不以明文写入磁盘配置。
- **AC-2.2**：When 用户为连接设置星标、颜色或分组, the system shall 在连接导航中按规则展示，并在重启后保留。
- **AC-2.3**：When 用户导出连接配置, the system shall 导出不含明文密码的连接清单（或密码字段占位），并可再导入元数据。
- **AC-2.4**：If 连接必填字段缺失或端口非法, then the system shall 阻止保存并提示具体校验错误。

### US-3 安全连接到 MySQL / PostgreSQL / SQLite

作为开发者，我想要通过直连、SSL 或 SSH Tunnel 连上目标库，以便在受限网络下安全访问开发/测试数据。

- **AC-3.1**：When 用户对 SQLite 连接选择本地文件路径并测试/打开连接, the system shall 成功建立会话并在对象树展示该库。
- **AC-3.2**：When 用户对可达的 MySQL 实例使用用户名密码测试连接, the system shall 在成功时提示成功，失败时展示可读错误信息且不崩溃。
- **AC-3.3**：When 用户对可达的 PostgreSQL 实例使用用户名密码测试连接, the system shall 行为与 AC-3.2 等价。
- **AC-3.4**：Where 用户启用 SSL（MySQL/PostgreSQL）, the system shall 使用 TLS 建立连接（允许开发环境“信任服务端证书”开关，默认关闭）。
- **AC-3.5**：Where 用户配置 SSH Tunnel（主机、端口、用户、认证方式）, the system shall 经隧道转发后再连接目标数据库；If SSH 认证失败, then the system shall 明确提示隧道错误。
- **AC-3.6**：When 用户断开连接, the system shall 释放会话资源并更新导航状态。

### US-4 浏览数据库对象树

作为开发者，我想要展开连接后看到库 / Schema / 表（及基础视图列表）, 以便定位要操作的对象。

- **AC-4.1**：When 连接成功建立, the system shall 在对象树加载该连接下的数据库（或 SQLite 单库）列表。
- **AC-4.2**：When 用户展开数据库/Schema, the system shall 懒加载表列表（至少含表名）；If 元数据查询失败, then the system shall 在该节点显示错误且不影响其他连接。
- **AC-4.3**：When 用户双击表节点, the system shall 在工作区打开该表的数据查看器 Tab。

### US-5 表格数据浏览与编辑

作为开发者，我想要在 Grid 中分页浏览、筛选排序并编辑提交行数据，以便快速查改业务数据。

- **AC-5.1**：When 打开表数据查看器, the system shall 以分页或虚拟滚动加载行数据，默认页大小可配置（默认 ≤ 1000），UI 主线程保持可响应。
- **AC-5.2**：When 用户对列应用排序或简单过滤并刷新, the system shall 按条件重新查询并展示结果。
- **AC-5.3**：When 用户编辑单元格或新增/删除行并提交, the system shall 将变更写入数据库并刷新受影响行；If 语句执行失败, then the system shall 回滚本批提交（或按引擎尽力回滚）并展示错误，不静默丢变更标记。
- **AC-5.4**：While 存在未提交变更, the system shall 在 Tab 上给出未保存标识，并在关闭前提示确认。

### US-6 查询编辑器与 Console

作为开发者，我想要编写并执行 SQL、在 Console 中交互执行语句，以便完成即席查询与管理操作。

- **AC-6.1**：When 用户在查询编辑器中针对当前连接执行选中或全部 SQL, the system shall 展示结果集（多语句时至少展示最后成功结果或分 Tab 结果）及影响行数/耗时。
- **AC-6.2**：The system shall 为 SQL 编辑器提供语法高亮。
- **AC-6.3**：When 用户点击取消执行（若查询仍在进行）, the system shall 尝试中断查询并恢复编辑器可编辑状态。
- **AC-6.4**：When 用户在 Console 输入语句并回车, the system shall 执行并追加输出；If 执行失败, then the system shall 打印错误文本。
- **AC-6.5**：If 执行期间连接已断开, then the system shall 提示连接不可用并拒绝执行。

### US-7 CSV 导入导出与 Dump SQL

作为开发者，我想要将查询或表数据导出为 CSV、从 CSV 导入表，以及导出表结构/数据的 SQL 文件，以便迁移与备份小规模数据。

- **AC-7.1**：When 用户从结果集或表数据查看器选择导出 CSV, the system shall 生成包含表头的 CSV 文件到用户选定路径。
- **AC-7.2**：When 用户选择 CSV 文件导入到目标表并完成字段映射, the system shall 插入数据并报告成功/失败行数；If 文件无法解析, then the system shall 中止并提示原因。
- **AC-7.3**：When 用户对表执行 Dump SQL（结构 + 可选数据）, the system shall 生成可在同引擎执行的 SQL 文件。

### US-8 基础可靠性与安全底线

作为使用者，我想要应用在错误场景下保持稳定且不上传我的数据，以便放心连接本地与远程库。

- **AC-8.1**：The system shall 默认不向任何远程服务上传连接信息、查询内容或结果集。
- **AC-8.2**：If 驱动或隧道发生未捕获异常, then the system shall 将错误记录到本地日志并在 UI 展示友好提示，应用进程不因此整体退出（尽最大努力）。
- **AC-8.3**：The system shall 支持取消长时间运行的导入/导出任务（启动后可见进度或可取消状态）。

## 3. 约束与非目标

**技术约束**

- 桌面栈固定：**Tauri 2 + React + TypeScript + Rust**
- 首发引擎仅：**MySQL、PostgreSQL、SQLite**
- 连接适配器插件化：统一 Object Model，引擎差异下沉到 Adapter（与 PRD §6 一致）
- 连接元数据本地持久化；**密码经 OS 钥匙串 / 等价安全存储或加密仓**，禁止明文
- 无在线激活服务器；产品闭源可商用骨架（本迭代不引入开源许可证决策阻塞）
- 大结果集必须分页或流式，避免一次性加载导致 UI 卡死
- 本机开发验证至少覆盖当前开发机 OS；跨平台以 Tauri 目标为准，CI 可选

**明确不做（本迭代）**

- MariaDB / MongoDB / Redis / Oracle / SQL Server / Snowflake / 国产库
- HTTP Tunnel、PAM/LDAP/Kerberos、Connection Profiles、URI 深度集成
- Form/JSON View、Data Profiling、Visual Explain、Query Builder、代码补全（可仅语法高亮）
- 结构/数据同步、Data Transfer、数据生成/脱敏、数据字典
- 建模、BI、AI Chat、协作云同步、服务器监控、自动化调度
- 浏览器版 / 移动端 / Navicat 官方文件格式 100% 兼容
