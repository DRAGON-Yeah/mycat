# Redis MVP 手工烟测

> 适用版本：Mycat 0.2.3+（Redis Phase 1 MVP）
> 前置：Docker 可用；已完成 `npm install` 与 Rust 工具链安装。

## 0. 启动本地 Redis

```bash
docker compose up -d redis
docker exec mycat-redis redis-cli -a navicat ping
# 期望输出：PONG
```

连接参数：

| 项 | 值 |
| --- | --- |
| 主机 | `127.0.0.1` |
| 端口 | `6380` |
| 密码 | `navicat` |
| DB 编号 | `0` |

## 1. 连接

1. `npm run tauri dev` 启动应用。
2. 点击「连接」→「新建连接」。
3. 引擎选择 **Redis**；显示名 `local-redis`；主机 `127.0.0.1`；端口 `6380`；DB 编号 `0`；密码 `navicat`。
4. 点击「测试连接」→ 期望提示「连接成功」。
5. 保存后，左侧连接树出现 Redis 图标。
6. 反向用例：端口填 `0`、DB 编号填 `abc` 或 `300`，期望被拦截并提示具体字段错误；密码改错后测试连接，期望展示可读错误且应用不崩溃。

## 2. 浏览键空间

先写入测试数据：

```bash
R="docker exec mycat-redis redis-cli -a navicat -n 0"
$R SET user:1 alice
$R HSET user:2 name bob age 30
$R LPUSH list:demo a b c
$R SADD set:demo x y z
$R ZADD zset:demo 1 one 2 two
$R XADD stream:demo '*' field value
$R SET exp:demo v EX 120
```

1. 展开 `local-redis` 连接 → 期望显示 `db0`…`db15`。
2. 点击 `db0` → 期望打开「Redis」页签，键列表显示上述键。
3. 检查列：键名、类型、TTL（`exp:demo` 显示约 `2m`，其余「永久」）、大小（`MEMORY USAGE` 不可用时为 `-`）。
4. pattern 输入 `user:*` 后回车/刷新 → 期望只显示 `user:1`、`user:2`。
5. 批量造 300 个键后点击「加载更多」：

   ```bash
   for i in $(seq 1 300); do docker exec mycat-redis redis-cli -a navicat -n 0 SET "bulk:$i" "$i" >/dev/null; done
   ```

   期望列表追加且无重复键；底部游标归零后「加载更多」消失。

## 3. 查看与编辑

1. 选中 `user:1` → 期望 string 值 `alice`，TTL「永久」。
2. 修改为 `alice2` 并保存 → 用 `redis-cli GET user:1` 验证为 `alice2`。
3. 选中 `exp:demo`，修改值并保存 → `redis-cli TTL exp:demo` 仍为正数（TTL 保留）。
4. 选中 `user:2` → hash 字段表；修改 `age` 为 `31` 并失焦保存；新增字段 `city`=`shanghai`；删除 `name` 字段 → 用 `HGETALL user:2` 验证。
5. 选中 `exp:demo`，TTL 输入 `60` 点击「设置 TTL」→ TTL 约 60；点击「永久」→ `TTL` 返回 `-1`。
6. 勾选 `bulk:1`、`bulk:2` → 点击「删除选中」→ 二次确认后列表移除；`redis-cli EXISTS bulk:1` 返回 `0`。
7. 选中 `list:demo`/`set:demo`/`zset:demo`/`stream:demo` → 期望只读展示，内容与 `redis-cli` 一致。
8. 在另一个终端 `DEL user:1`，回到应用点击刷新/重新选中 → 期望提示「键不存在或类型已变化」并刷新列表。

## 4. 命令控制台

1. 输入 `SET cmd:demo "hello world"` 回车 → 期望 `OK`。
2. 输入 `GET cmd:demo` → 期望 `hello world`。
3. 输入 `HGETALL cmd:demo` → 期望红色错误原文包含 `WRONGTYPE`。
4. 输入空命令 → 期望本地提示「命令不能为空」，不发送请求。
5. 输入 `SET k "unclosed` → 期望本地提示「命令引号未闭合」。
6. 按 ↑/↓ → 期望在历史命令间回退/前进。
7. 输入 `KEYS *` → 期望数组结果以缩进 JSON 展示。

## 5. 安全与生命周期

1. 连接右键 →「导出连接」→ 打开导出的 JSON，搜索 `navicat`，期望不存在明文密码。
2. 关闭 Redis 连接 → `docker exec mycat-redis redis-cli -a navicat CLIENT LIST` 连接数下降。
3. 删除 Redis 连接 → 重启应用后连接列表无残留。
4. 切换到 MySQL / PostgreSQL / SQLite 连接 → 期望原有表/视图/查询/Console 功能不受影响；Redis 页签显示「请选择 Redis 连接」占位。
5. Redis 连接下检查顶栏与右键菜单：不应出现「表/视图/函数/查询/备份/Console/新建数据库/运行 SQL 文件/转储 SQL」等 SQL 专属入口。

## 6. 自动化回归

```bash
cd src-tauri
MYCAT_REDIS_TEST=1 MYCAT_REDIS_PORT=6380 MYCAT_REDIS_PASSWORD=navicat cargo test --lib redis_
cd ..
npm run build
```

期望：Redis 相关测试全部通过；前端构建成功。
