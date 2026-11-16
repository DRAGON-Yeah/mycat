# My Navicat

跨平台桌面端多数据库管理工具（Phase 0 MVP）。技术栈：**Tauri 2 + React + TypeScript + Rust**。

对标能力与分期见 [navicat-prd.md](./navicat-prd.md)；本迭代执行计划见 [.codebuddy/plans/phase0-desktop-mvp/](./.codebuddy/plans/phase0-desktop-mvp/)。

## 先决条件

| 工具 | 版本建议 |
| --- | --- |
| Node.js | 20+（当前开发机已验证 24.x） |
| npm | 随 Node 附带 |
| Rust | stable（`rustup` 安装） |
| 系统 | macOS：Xcode Command Line Tools / Xcode；Windows：MSVC Build Tools；Linux：见 [Tauri 文档](https://v2.tauri.app/start/prerequisites/) |

可选：Docker（用于本地 MySQL / PostgreSQL 验证）：

```bash
docker compose up -d
```

| 服务 | 主机端口 | 账号 |
| --- | --- | --- |
| MySQL | **3307**（避免与本机 3306 冲突） | `navicat` / `navicat`，库 `demo` |
| PostgreSQL | 5432 | `navicat` / `navicat`，库 `demo` |

## 快速开始

```bash
npm install
npm run tauri dev
```

生产构建：

```bash
npm run tauri build
```

仅前端 Vite：

```bash
npm run dev
```

## 脚本说明

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 前端 |
| `npm run build` | 类型检查 + 前端构建 |
| `npm run tauri` | Tauri CLI 入口 |
| `npm run tauri dev` | 桌面开发模式（推荐） |
| `npm run tauri build` | 打包桌面应用 |

## 首发引擎（Phase 0）

MySQL、PostgreSQL、SQLite。支持 SSL、SSH Tunnel（密码）、CSV 导入导出、Dump SQL、本地日志。

端到端手工烟测见 [docs/phase0-smoke.md](./docs/phase0-smoke.md)。自动化回归：

```bash
cd src-tauri && cargo test --lib
npm run build
```
