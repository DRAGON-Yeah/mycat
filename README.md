# Mycat

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
| `npm run tauri build` | 打包桌面应用（当前平台） |
| `npm run build:mac` | macOS 通用包（Apple Silicon + Intel） |
| `npm run build:mac:arm` | macOS Apple Silicon 包 |
| `npm run build:mac:intel` | macOS Intel 包 |
| `npm run build:win` | Windows x64 安装包（需在 Windows 上执行） |

## 打包发布

构建流程由 Tauri 驱动：`beforeBuildCommand` 会先执行 `npm run build`（`tsc` 类型检查 + Vite 构建到 `dist/`），随后编译 Rust 并生成安装包。配置见 [src-tauri/tauri.conf.json](./src-tauri/tauri.conf.json)，`bundle.targets` 为 `all`。

### 0. 一次性准备

```bash
npm install
rustup target add aarch64-apple-darwin x86_64-apple-darwin   # macOS 通用包所需
```

Windows 打包需在 Windows 机器上执行（MSVC 工具链 + WebView2 运行时），并安装对应 Rust target：

```bash
rustup target add x86_64-pc-windows-msvc
```

图标如需更新，准备 1024×1024 的 `app-icon.png` 后执行：

```bash
npm run tauri icon app-icon.png
```

### 1. macOS

```bash
npm run build:mac        # 通用包，推荐分发
npm run build:mac:arm    # 仅 Apple Silicon
npm run build:mac:intel  # 仅 Intel
```

产物（以通用包为例）：

```text
src-tauri/target/universal-apple-darwin/release/bundle/macos/Mycat.app
src-tauri/target/universal-apple-darwin/release/bundle/dmg/Mycat_0.2.0_universal.dmg
```

仅 Apple Silicon 时路径为 `src-tauri/target/aarch64-apple-darwin/release/bundle/`，Intel 为 `x86_64-apple-darwin`。

说明：

- 当前 `signingIdentity` 为 `-`（ad-hoc 签名），**未做 Apple 公证**。本机自用可直接打开；分发给他人时对方可能需要在「系统设置 → 隐私与安全性」中放行，或先执行 `xattr -dr com.apple.quarantine /Applications/Mycat.app`。
- 正式对外分发需替换为 Developer ID Application 证书，并配置公证（`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` 环境变量后由 Tauri 自动 notarize）。

### 2. Windows

在 Windows 上执行：

```bash
npm run build:win
```

产物：

```text
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\Mycat_0.2.0_x64-setup.exe
```

安装包为 NSIS、`currentUser` 安装模式，语言为简体中文 + English。

### 3. Linux

在对应发行版上执行（需先安装 Tauri 系统依赖）：

```bash
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/`（`appimage/`、`deb/`、`rpm/`）。

### 4. 只构建部分格式

```bash
npm run tauri build -- --bundles dmg              # 仅 macOS dmg
npm run tauri build -- --bundles app              # 仅 .app
npm run tauri build -- --bundles nsis             # 仅 Windows 安装器
npm run tauri build -- --bundles appimage,deb     # Linux
```

### 5. 发布前检查

```bash
cd src-tauri && cargo test --lib   # Rust 单元测试
npm run build                      # 类型检查 + 前端构建
```

再按 [docs/phase0-smoke.md](./docs/phase0-smoke.md) 对打包后的应用做一次手工烟测（连接 MySQL / PostgreSQL / SQLite、CSV 导入导出、Dump SQL）。

### 常见问题

| 现象 | 处理 |
| --- | --- |
| `can't find crate for core` / target 缺失 | 补装对应 `rustup target add <triple>` |
| 通用包构建报缺少 `lipo` | 安装 Xcode Command Line Tools：`xcode-select --install` |
| 打包后白屏 | 确认 `npm run build` 单独可成功，且 `dist/` 已生成 |
| 想缩短构建时间 | 只打当前平台：`npm run tauri build`（不加 `--target`） |

## 首发引擎（Phase 0）

MySQL、PostgreSQL、SQLite。支持 SSL、SSH Tunnel（密码）、CSV 导入导出、Dump SQL、本地日志。

端到端手工烟测见 [docs/phase0-smoke.md](./docs/phase0-smoke.md)。自动化回归：

```bash
cd src-tauri && cargo test --lib
npm run build
```
