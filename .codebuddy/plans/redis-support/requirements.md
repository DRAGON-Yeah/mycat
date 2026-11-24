# 需求文档（Requirements）— Mycat Redis 引擎支持（MVP）

> 状态：已完成 2026-11-24
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Complex | 范围：MVP（延后项见 tasks.md 文末 Backlog）
> 来源：用户需求「增加 redis 功能」+ [navicat-prd.md](../../../navicat-prd.md) Phase 1（`:298`）、C-01（`:109`）

## 1. 问题陈述（Problem Statement）

Mycat 目前只能连接 MySQL / PostgreSQL / SQLite：`src-tauri/src/adapters/mod.rs:157` 的 `connect()` 仅匹配三种引擎，`src/features/connections/ConnectionForm.tsx:21` 的 `defaultPort` 也只覆盖三种。PRD 已把 Redis 列入 Phase 1 与 P0 引擎清单，但用户当前无法连接 Redis、浏览键空间或执行 Redis 命令。

本迭代为 Mycat 增加 **Redis 独立部署（standalone）MVP**：连接 → 浏览键 → 查看/编辑常用类型 → 执行原生命令，复用现有连接档案、加密凭证、SSH 隧道与连接池生命周期。成功标准：本地 Redis 上可完成上述主路径，且不影响现有三种 SQL 引擎的任何行为。

## 2. 用户故事与验收标准（User Stories & EARS AC）

### US-1 建立 Redis 连接

作为开发者，我想要像管理 SQL 连接一样创建、测试并打开 Redis 连接，以便在同一个工具里访问缓存实例。

- **AC-1.1**：When 用户在新建连接中选择 Redis 并填写主机、端口（默认 6379）、可选 ACL 用户名/密码与 DB 编号后保存, the system shall 持久化连接档案，并在连接树中以 Redis 图标展示该连接。
- **AC-1.2**：When 用户点击「测试连接」或展开 Redis 连接, the system shall 在 5 秒内通过 `PING` 验证连通性，成功时提示成功/展示数据库列表，失败时展示可读错误且不崩溃。
- **AC-1.3**：If 主机为空、端口不在 1–65535、或 DB 编号不是 0–255 的整数, then the system shall 拒绝保存/测试并提示具体字段错误。
- **AC-1.4**：Where 连接启用 SSH Tunnel, the system shall 经本地端口转发连接远端 Redis（未显式指定端口时默认 6379）。
- **AC-1.5**：Where 连接 SSL 选择 `require`, the system shall 使用 TLS（`rediss://`）建立连接；勾选「信任服务端证书」时允许跳过证书校验（仅开发用途）。

### US-2 浏览键空间

作为开发者，我想要按数据库和 glob 模式浏览键，以便快速定位缓存数据。

- **AC-2.1**：When 用户展开 Redis 连接, the system shall 列出可用数据库（显示为 `db0`…`dbN`，N 由 `CONFIG GET databases` 决定，读取失败时回退 16 个）。
- **AC-2.2**：When 用户点击某个数据库节点, the system shall 打开 Redis 工作台，并以 `SCAN`（默认 pattern `*`、单页 200 个键）展示该库键列表。
- **AC-2.3**：While 键列表已加载, the system shall 为每个键显示 名称、类型、TTL 与内存占用（`MEMORY USAGE` 不可用时显示 `-`）。
- **AC-2.4**：When 用户修改 glob pattern 并刷新, the system shall 以新 pattern 从游标 0 重新扫描，并清空旧结果。
- **AC-2.5**：When 用户点击「加载更多」, the system shall 使用上次返回的游标继续 `SCAN`，且列表中不出现重复键。
- **AC-2.6**：If `SCAN` 返回错误, then the system shall 保留已加载的键并在面板内显示错误信息，不崩溃。

### US-3 查看与编辑键

作为开发者，我想要按类型查看键值并修改常用类型，以便完成日常排查与修正。

- **AC-3.1**：When 用户选中一个键, the system shall 按类型展示值：string 文本、hash 字段表、list/set 元素列表、zset 成员与 score、stream 条目（只读）。
- **AC-3.2**：When 用户编辑 string 值并保存, the system shall 写回该键并保留原 TTL（无 TTL 时保持无 TTL）。
- **AC-3.3**：When 用户新增或修改 hash 字段并保存, the system shall 写回对应字段并刷新展示。
- **AC-3.4**：When 用户删除单个或勾选的多个键, the system shall 二次确认后执行 `DEL`，并从列表移除已删除键。
- **AC-3.5**：When 用户为键设置 TTL（秒）或选择「永久」, the system shall 调用 `EXPIRE` / `PERSIST` 并更新 TTL 显示。
- **AC-3.6**：If 键在查看期间被删除或类型发生变化, then the system shall 提示「键不存在或类型已变化」并刷新键列表。
- **AC-3.7**：While 值超过 1000 个元素或 256KB, the system shall 截断展示并标注「已截断」，避免阻塞界面。

### US-4 执行 Redis 命令

作为开发者，我想要直接执行 Redis 原生命令，以便完成工作台未覆盖的操作。

- **AC-4.1**：When 用户在命令输入框输入合法命令（如 `SET k v`、`HGETALL k`）并执行, the system shall 先切换到当前数据库，再把命令原样发送到服务端并展示结果。
- **AC-4.2**：The system shall 支持展示 status / integer / bulk / array / nil / error 六类回复，嵌套数组以缩进或 JSON 呈现。
- **AC-4.3**：If 命令为空、引号未闭合或转义非法, then the system shall 在本地提示语法错误且不发送请求。
- **AC-4.4**：When 命令执行失败, the system shall 展示服务端错误原文（如 `WRONGTYPE Operation against a key holding the wrong kind of value`）。
- **AC-4.5**：When 用户在命令输入框按 ↑/↓, the system shall 在本次会话的命令历史中回退/前进。

### US-5 安全与生命周期

作为开发者，我想要 Redis 凭证与连接生命周期沿用现有安全约定，以便不引入新的泄露面。

- **AC-5.1**：The system shall 将 Redis 密码存入现有 vault（AES-256-GCM），连接列表与导出文件中不出现明文密码。
- **AC-5.2**：When 用户关闭连接或删除连接, the system shall 关闭 Redis 会话并释放 SSH 隧道。
- **AC-5.3**：While 当前连接为 Redis, the system shall 隐藏表/视图/函数/事件、新建数据库、运行 SQL 文件、转储 SQL 等 SQL 专属入口，避免误操作。

## 3. 约束与非目标

**技术约束**

- 技术栈不变：Tauri 2 + React 19 + TypeScript（`strict`）+ Rust（edition 2024）；前端不新增运行时依赖。
- 后端新增 `redis` crate 稳定版 `1.0`（`default-features = false, features = ["tls-native-tls"]`），复用现有 `native-tls 0.2`；同步阻塞 API，与现有适配器一致。
- 不修改 `meta.db` 表结构：Redis 的 DB 编号复用 `connections.database` 字段（存 `"0"`–`"255"` 字符串）。
- 复用 `vault`（密码）、`tunnel`（SSH）、`SessionPool`（会话生命周期与幂等复用）。
- 错误信封沿用现状：Tauri command 返回 `Result<T, String>`，前端按字符串展示。
- 目标服务端 Redis 6.0+（`SET ... KEEPTTL`、ACL 用户名可选）；仅 standalone，不含 Cluster / Sentinel。
- UI 文案为简体中文；CSS 使用现有 `features.css` 的 kebab-case 类名与主题变量。

**明确不做（本迭代）**

- Redis Cluster / Sentinel 拓扑发现与故障转移。
- Pub/Sub 管理、`MONITOR`、慢日志、内存分析、Lua 脚本管理。
- RDB/AOF 备份恢复、键导入导出、Dump 命令文件执行。
- 键重命名/复制/移动、stream 编辑、二进制安全编辑（非 UTF-8 内容按替换字符展示）。
- 多个可关闭的 Redis 文档页签（MVP 使用单个系统级 Redis 页签，按当前连接/库切换）。
- RedisJSON / RediSearch / RedisTimeSeries 等模块专属视图。
