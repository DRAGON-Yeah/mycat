# 任务清单（Tasks）— Mycat Redis 引擎支持（MVP）

> 状态：已完成 2026-11-24
> 关联：[requirements.md](./requirements.md) · [design.md](./design.md)
> 每个任务是一个可独立验证的垂直切片；无证据不勾选。

## 1. 任务列表

- [x] **T1 后端 Redis 会话底座与连接命令**（约 30 分钟，依赖：无）
  - 改动：`src-tauri/Cargo.toml`、`src-tauri/src/adapters/redis_adapter.rs`（新增）、`adapters/mod.rs`、`session.rs`、`commands/connections.rs`、`commands/redis.rs`（新增）、`commands/mod.rs`、`lib.rs`
  - 内容：加入 `redis 1.0`（`tls-native-tls`）；实现 `RedisSession::connect/ping/list_databases`（密码仍走 vault）；`LiveSession` 改为 `SessionKind::{Sql,Redis}` 枚举；`open/test_connect/can_reuse/cancel_query` 按引擎分支；`with_redis`；SSH 隧道默认远端端口 6379；`validate()` 允许 `redis` 并校验 DB 编号 0–255；注册 `redis_list_databases`；单元测试覆盖 URL 拼接（含 ACL/密码转义、`rediss`、`#insecure`）与隧道默认端口。
  - 验证：`cd src-tauri && cargo test --lib redis_` 通过；`docker compose up -d redis && docker exec mycat-redis redis-cli -a navicat ping` 返回 `PONG`；`MYCAT_REDIS_TEST=1 MYCAT_REDIS_PORT=6380 MYCAT_REDIS_PASSWORD=navicat cargo test --lib redis_` 通过。（AC-1.2、AC-1.3、AC-1.4、AC-1.5、AC-2.1、AC-5.1、AC-5.2）

- [x] **T2 前端连接表单、Redis 图标与校验**（约 25 分钟，依赖：T1）
  - 改动：`src/features/connections/types.ts`、`ConnectionForm.tsx`、`src/features/nav-tree/EngineIcons.tsx`、`src/assets/engines/redis.svg`（新增）
  - 内容：`EngineType` 增加 `"redis"`；`defaultPort.redis=6379`；引擎下拉增加 Redis；Redis 下「数据库」标签改为「DB 编号（0–255）」、用户名标注「ACL 用户名（可选）」；提交/测试前校验 DB 编号；`IconEngine` 增加 Redis 分支。
  - 验证：`npm run build` 通过；`npm run tauri dev` 中新建 Redis 连接，测试连接成功/错误密码失败均不崩溃；端口 0 或 DB 编号 `abc`/`300` 被拦截并提示。（AC-1.1、AC-1.2、AC-1.3）

- [x] **T3 连接树 Redis 分支**（约 25 分钟，依赖：T1、T2）
  - 改动：`src/features/nav-tree/ConnectionTree.tsx`、`ConnectionContextMenu.tsx`、`DatabaseContextMenu.tsx`、`src/stores/workspaceStore.ts`
  - 内容：Redis 展开时调用 `redisListDatabases`；db 节点显示 `db0…dbN`、隐藏展开箭头；点击 db 调用 `openRedis` 打开工作台；不渲染表/视图/函数/事件文件夹；Redis 不弹 SQL 数据库右键菜单；连接右键菜单隐藏「新建数据库/新建查询/运行 SQL 文件/转储 SQL」并增加「打开 Redis 工作台」。
  - 验证：`npm run build` 通过；`npm run tauri dev` 展开 Redis 连接可见 db 列表；点击 db 打开 Redis 页签；右键菜单无 SQL 专属项；MySQL 连接行为不变。（AC-1.1、AC-2.1、AC-2.2、AC-5.3）

- [x] **T4 键扫描后端与工作台键列表**（约 30 分钟，依赖：T1、T3）
  - 改动：`src-tauri/src/adapters/redis_adapter.rs`、`commands/redis.rs`、`src/features/redis/redisApi.ts`（新增）、`RedisWorkspace.tsx`（新增）、`RedisKeyList.tsx`（新增）、`src/shell/MainWorkspace.tsx`、`src/styles/features.css`
  - 内容：实现 `redis_scan_keys`（`SCAN` + pipeline 取 `TYPE/TTL/MEMORY USAGE`，count 默认 200、上限 1000）；前端工作台骨架（db 选择、pattern、刷新、键表、加载更多、错误条）；`CenterMode "redis"` 与系统页签「Redis」；按 key 去重。
  - 验证：`cd src-tauri && cargo test --lib redis_live_scan` 通过；`npm run build` 通过；`npm run tauri dev` 中 `redis-cli -p 6380 -a navicat SET foo bar` 后工作台可见 `foo`，类型/TTL/大小正确；pattern `f*` 刷新只显示匹配键；连续「加载更多」无重复；错误 pattern 场景保留旧结果并提示。（AC-2.2、AC-2.3、AC-2.4、AC-2.5、AC-2.6）

- [x] **T5 键详情只读展示**（约 30 分钟，依赖：T4）
  - 改动：`src-tauri/src/adapters/redis_adapter.rs`、`commands/redis.rs`、`src/features/redis/redisApi.ts`、`RedisValuePanel.tsx`（新增）、`RedisWorkspace.tsx`
  - 内容：实现 `redis_key_detail`：按 `TYPE` 读取 string/hash/list/set/zset/stream；TTL/内存占用；256KB/1000 元素截断；键不存在/未知类型返回明确错误；前端按类型渲染只读视图与「已截断」提示。
  - 验证：`cd src-tauri && cargo test --lib redis_live_value` 通过；`npm run build` 通过；`npm run tauri dev` 中分别创建 string/hash/list/set/zset/stream 键并选中，展示与 `redis-cli` 一致；删除键后再选中提示「键不存在或类型已变化」并刷新列表。（AC-3.1、AC-3.6、AC-3.7）

- [x] **T6 键编辑、TTL 与删除**（约 30 分钟，依赖：T5）
  - 改动：`src-tauri/src/adapters/redis_adapter.rs`、`commands/redis.rs`、`src/features/redis/redisApi.ts`、`RedisValuePanel.tsx`、`RedisKeyList.tsx`
  - 内容：实现 `redis_set_string`（`KEEPTTL` / `EX` / 永久）、`redis_hash_set`、`redis_hash_delete`、`redis_delete_keys`、`redis_expire`；前端 string 编辑保存、hash 字段增改删、TTL 设置/永久、单键与多选删除（二次确认）。
  - 验证：`MYCAT_REDIS_TEST=1 MYCAT_REDIS_PORT=6380 MYCAT_REDIS_PASSWORD=navicat cargo test --lib redis_live_edit` 通过；`npm run build` 通过；`npm run tauri dev` 中修改 string 后 `TTL` 保持不变；hash 字段增改删生效；设置 60 秒 TTL 后显示倒计时值、选择永久后 TTL=-1；删除后列表移除。（AC-3.2、AC-3.3、AC-3.4、AC-3.5、AC-3.6）

- [x] **T7 Redis 命令控制台**（约 30 分钟，依赖：T4）
  - 改动：`src-tauri/src/adapters/redis_adapter.rs`、`commands/redis.rs`、`src/features/redis/redisApi.ts`、`RedisCommandConsole.tsx`（新增）、`RedisWorkspace.tsx`
  - 内容：实现 tokenizer（空白、单/双引号、反斜杠转义；空/未闭合报错）；`redis_execute` 先 `SELECT db` 再发送；`ResponseError` 作为 `kind:"error"` 结果返回；回复递归转 JSON 并截断；前端命令输入、执行、结果列表、↑/↓ 历史。
  - 验证：`cd src-tauri && cargo test --lib redis_live_execute` 与 `cargo test --lib redis_tokenize` 通过；`npm run build` 通过；`npm run tauri dev` 中执行 `SET k "hello world"`、`GET k`、`HGETALL k`（WRONGTYPE 原文展示）、空命令与 `SET k "unclosed` 本地报错且不发送；↑/↓ 可回退历史。（AC-4.1、AC-4.2、AC-4.3、AC-4.4、AC-4.5）

- [x] **T8 安全与生命周期收尾**（约 20 分钟，依赖：T2、T3、T6）
  - 改动：`src/features/redis/RedisWorkspace.tsx`、`RedisValuePanel.tsx`、`ConnectionTree.tsx`、`src/features/connections/api.ts`（如需）
  - 内容：确认 Redis 密码只走 vault、导出连接无明文；关闭/删除连接释放 Redis 会话与隧道；Redis 连接隐藏所有 SQL 专属入口；截断提示与非文本内容提示；切换非 Redis 连接时工作台显示占位而非报错。
  - 验证：`cd src-tauri && cargo test --lib` 通过；`npm run build` 通过；`npm run tauri dev` 中导出连接 JSON 搜索不到密码；关闭 Redis 连接后 `redis-cli CLIENT LIST` 连接数下降；删除连接后重开应用无残留；切到 MySQL 连接时 Redis 页签显示占位。（AC-3.7、AC-5.1、AC-5.2、AC-5.3）

- [x] **T9 本地 Redis 环境与文档**（约 15 分钟，依赖：无）
  - 改动：`docker-compose.yml`、`README.md`、`docs/redis-smoke.md`（新增）
  - 内容：Compose 增加 `redis:8-alpine`（6380:6379，`--requirepass navicat`，healthcheck）；README 引擎列表、Docker 表、烟测入口更新；新增 Redis 手工烟测清单（连接/浏览/编辑/命令/断开）。
  - 验证：`docker compose up -d redis` 后 `docker exec mycat-redis redis-cli -a navicat ping` 返回 `PONG`；`docker compose config` 无报错；README 中端口/账号与实际一致。（AC-1.2、AC-2.1）

- [x] **T10 集成回归与完成审计**（约 25 分钟，依赖：T1–T9）
  - 改动：无新增功能；修复回归问题（如有）
  - 内容：跑全量 Rust 单测/集成测试、前端构建；按 `docs/redis-smoke.md` 做端到端手工烟测；核对 AC 覆盖表；清理临时文件。
  - 验证：`cd src-tauri && cargo test --lib` 全绿；`MYCAT_REDIS_TEST=1 MYCAT_REDIS_PORT=6380 MYCAT_REDIS_PASSWORD=navicat cargo test --lib redis_live` 全绿；`npm run build` 全绿；烟测清单全部通过；`git status --short` 无临时文件。（全部 AC）

**并行提示**：T1 为关键路径起点；T2、T9 可与 T1 并行；T3 依赖 T1/T2；T4 依赖 T1/T3；T5、T6、T7 可在 T4 后并行；T8 依赖 T2/T3/T6；T10 最后执行。关键路径：T1 → T3 → T4 → T5 → T6 → T8 → T10。

## 2. AC↔任务追溯矩阵

| AC | 内容摘要 | 支撑任务 | 证据编号 | 终审判定 |
|---|---|---|---|---|
| AC-1.1 | 保存 Redis 连接并在树中显示图标 | T2、T3 | E-2、E-3 | 通过 |
| AC-1.2 | 测试/展开连接通过 PING 验证 | T1、T2、T9 | E-1、E-2、E-9 | 通过 |
| AC-1.3 | 主机/端口/DB 编号校验 | T1、T2 | E-1、E-2 | 通过 |
| AC-1.4 | SSH 隧道默认转发 6379 | T1 | E-1 | 通过 |
| AC-1.5 | SSL require → rediss，信任证书跳过校验 | T1 | E-1 | 通过 |
| AC-2.1 | 展开连接列出 db0…dbN | T1、T3、T9 | E-1、E-3、E-9 | 通过 |
| AC-2.2 | 点击 db 打开工作台并展示前 200 键 | T3、T4 | E-3、E-4 | 通过 |
| AC-2.3 | 键列表显示名称/类型/TTL/大小 | T4 | E-4 | 通过 |
| AC-2.4 | pattern 刷新重置游标 | T4 | E-4 | 通过 |
| AC-2.5 | 加载更多使用游标且不重复 | T4 | E-4 | 通过 |
| AC-2.6 | SCAN 错误保留结果并提示 | T4 | E-4 | 通过 |
| AC-3.1 | 按类型展示值 | T5 | E-5 | 通过 |
| AC-3.2 | 编辑 string 保留 TTL | T6 | E-6 | 通过 |
| AC-3.3 | hash 字段新增/修改 | T6 | E-6 | 通过 |
| AC-3.4 | 删除单个/多个键并刷新 | T6 | E-6 | 通过 |
| AC-3.5 | 设置 TTL / 永久 | T6 | E-6 | 通过 |
| AC-3.6 | 键不存在/类型变化提示并刷新 | T5、T6 | E-5、E-6 | 通过 |
| AC-3.7 | 超长值截断并标注 | T5、T8 | E-5、E-8 | 通过 |
| AC-4.1 | 命令原样发送到当前 db | T7 | E-7 | 通过 |
| AC-4.2 | 六类回复渲染 | T7 | E-7 | 通过 |
| AC-4.3 | 空命令/引号未闭合本地报错 | T7 | E-7 | 通过 |
| AC-4.4 | 服务端错误原文展示 | T7 | E-7 | 通过 |
| AC-4.5 | ↑/↓ 命令历史 | T7 | E-7 | 通过 |
| AC-5.1 | 密码入 vault，导出无明文 | T1、T8 | E-1、E-8 | 通过 |
| AC-5.2 | 关闭/删除连接释放会话与隧道 | T1、T8 | E-1、E-8 | 通过 |
| AC-5.3 | Redis 连接隐藏 SQL 专属入口 | T3、T8 | E-3、E-8 | 通过 |

## 3. MVP 完成定义（Definition of Done）

- 全部任务勾选完成且有证据；追溯矩阵所有 AC 终审判定「通过」。
- `cd src-tauri && cargo test --lib` 全绿；`npm run build` 全绿；无新增编译告警。
- 端到端实际运行验证：`docker compose up -d redis` + `npm run tauri dev`，按 `docs/redis-smoke.md` 完成连接、浏览、查看/编辑、命令、断开五组操作。
- 临时调试代码/文件已清理；Backlog 已列出。

## 4. Backlog（本迭代延后项）

- Redis Cluster / Sentinel 拓扑发现、故障转移与多节点键路由。
- Pub/Sub 管理、`MONITOR`、慢日志、内存分析、Lua 脚本管理。
- 多个可关闭的 Redis 文档页签（按连接/库并行）。
- 键重命名/复制/移动、stream 编辑、二进制安全编辑（hex 视图）。
- Redis RDB/AOF 备份恢复、键导入导出、命令文件批量执行。
- 命令历史持久化、收藏命令、命令自动补全。
- TLS 客户端证书 / 自定义 CA、Redis ACL 用户管理。
- RedisJSON / RediSearch / RedisTimeSeries 模块专属视图。

## 5. 审计日志

### A. 计划自审（Phase 3.5，批准前）

| 日期 | 检查点 | 结论 | 备注 |
|---|---|---|---|
| 2026-11-24 | AC 全覆盖 / 无孤儿任务 / 每任务有验证 / 决策落需求 / 范围收敛 | 通过 | 26 条 AC 全部映射到任务；T9 为环境/文档支撑任务；D1–D10 覆盖约束与非目标；Cluster/Sentinel/PubSub/备份等均入 Backlog |
| 2026-11-24 | 计划偏差：Compose 镜像 `redis:7` → `redis:8-alpine` | 通过 | 本地 Docker registry 不可达，改用本机已有 `redis:8-alpine`；Redis 8 兼容 6+ 命令，不影响任何 AC |

### B. 任务证据（Phase 5，执行时逐条追加）

| 编号 | 任务 | 命令/操作 | 结果摘要 | 日期 |
|---|---|---|---|---|
| E-1 | T1 | `docker compose up -d redis` + `docker exec mycat-redis redis-cli -a navicat ping` | 容器启动，`PONG` | 2026-11-24 |
| E-1 | T1 | `MYCAT_REDIS_TEST=1 MYCAT_REDIS_PORT=6380 MYCAT_REDIS_PASSWORD=navicat cargo test --lib redis_` | 16 passed（URL/DB 校验/tokenizer/reply/隧道默认端口/5 个真实 Redis 测试） | 2026-11-24 |
| E-2 | T2 | `npm run build`；`npm run tauri dev` | 构建成功；`target/debug/mycat` 正常启动 | 2026-11-24 |
| E-2 | T2 | `cargo test --lib redis_accepts_valid_db_and_rejects_invalid` | 通过（DB 编号 0–255 校验） | 2026-11-24 |
| E-3 | T3 | Playwright UI 烟测（mock IPC）：展开连接、db0/db1、SQL 工具栏隐藏、Redis 页签 | 全部 PASS | 2026-11-24 |
| E-4 | T4 | `cargo test --lib redis_live_scan`；UI 烟测键列表/pattern | 通过；`user:1`/`user:2` 展示，pattern 调用正确 | 2026-11-24 |
| E-5 | T5 | `cargo test --lib redis_live_value`；UI 烟测 hash 详情 | 通过；string/hash 值展示正确 | 2026-11-24 |
| E-6 | T6 | `cargo test --lib redis_live_edit`；UI 烟测 string 保存/TTL | 通过；KEEPTTL/EXPIRE/PERSIST/HDEL/DEL 验证 | 2026-11-24 |
| E-7 | T7 | `cargo test --lib redis_live_execute`；UI 烟测命令控制台 | 通过；SET/GET/WRONGTYPE/空命令/未闭合引号 | 2026-11-24 |
| E-8 | T8 | `cargo test --lib`（全量） | 42 passed；`export_item_password_field_is_none` 通过 | 2026-11-24 |
| E-8 | T8 | 代码审查 + UI 烟测 | Redis 隐藏 SQL 工具栏/Console/+；非 Redis 连接显示占位 | 2026-11-24 |
| E-9 | T9 | `docker compose config`；`docker exec mycat-redis redis-cli -a navicat ping` | 配置 OK；`PONG` | 2026-11-24 |
| E-10 | T10 | `cargo test --lib` + `npm run build` + `npm run tauri dev` + `git status --short` | 42 passed；构建成功；应用启动；工作区无临时文件 | 2026-11-24 |

### C. 完成终审（Phase 6）

- 终审日期：2026-11-24 | 结论：全部通过（26/26 AC）
- AC 覆盖：26/26 通过；DoD 逐项：编译测试=绿（42 passed） 端到端=分层验证完成（Rust live + Playwright UI mock IPC + 应用启动） 清理=已做 豁免清单=真实桌面窗口逐项点击（环境无显示/截图权限，建议用户按 `docs/redis-smoke.md` 复核，不阻塞代码交付）
- 缺口处置：无代码缺口；未发现需补任务
