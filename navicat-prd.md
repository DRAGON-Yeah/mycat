# My Navicat — 产品需求文档（PRD）

> **产品定位**：跨平台桌面端多数据库管理与开发工具，功能对标 **Navicat Premium 17+（Enterprise 能力集）**。  
> **文档版本**：v0.1  
> **状态**：草案  
> **对标参考**：[Navicat Premium Feature Matrix](https://www.navicat.com/en/products/navicat-premium-feature-matrix)、Navicat 17 / 17.3 发布说明

---

## 1. 背景与目标

### 1.1 背景

开发者、DBA、数据分析师日常需要同时连接多种关系型 / NoSQL / 云数据库，完成查询、建模、迁移、备份与可视化。Navicat Premium 17+ 是该领域的成熟标杆产品；本项目目标是实现与之能力对等的桌面端产品（以下简称 **My Navicat**）。

### 1.2 产品目标

| 目标 | 说明 |
| --- | --- |
| 功能对等 | 覆盖 Navicat Premium 17+ Enterprise 核心能力（连接、对象管理、查询、同步、建模、BI、自动化、AI 辅助等） |
| 统一体验 | 一套应用管理 MySQL / PostgreSQL / SQL Server / Oracle / SQLite / MariaDB / MongoDB / Redis / Snowflake 等 |
| 跨平台桌面 | Windows / macOS / Linux 原生桌面体验 |
| 可迭代交付 | 以分阶段里程碑逼近完整对等，避免一次性大爆炸 |

### 1.3 成功标准（验收口径）

- **能力覆盖**：PRD 功能清单中 P0/P1 项达到「可用且行为与对标产品一致或等价」  
- **多库一致**：至少 5 种主流引擎（建议：MySQL、PostgreSQL、SQLite、MongoDB、Redis）打通「连接 → 浏览 → 查询 → 导入导出」主路径  
- **性能**：万级行表浏览可交互；百万级结果集支持分页 / 流式加载，不卡死 UI  
- **稳定**：日常连接 / 查询 / 编辑场景无阻塞性崩溃；敏感凭证本地加密存储  

---

## 2. 目标用户与场景

### 2.1 用户画像

| 角色 | 诉求 |
| --- | --- |
| 后端 / 全栈开发 | 快速查库、改数据、写 SQL、对比环境结构 |
| DBA / 运维 | 用户权限、备份恢复、监控、批量作业、结构同步 |
| 数据工程师 | 跨库迁移、导入导出、数据生成 / 脱敏、调度 |
| 数据分析师 | 可视化查询、BI Dashboard、数据剖析 |
| 架构师 | 建模（概念 / 逻辑 / 物理）、正逆向工程、数据字典 |

### 2.2 核心场景

1. 通过 SSH / SSL 安全连接生产只读库，浏览表结构与数据  
2. 可视化构建 / 手写 SQL，查看执行计划并优化  
3. 开发库 ↔ 测试库结构同步、数据同步  
4. 从 Excel / CSV / JSON 导入，或导出报表数据  
5. 定时备份 + 邮件通知  
6. ER / 数据模型设计并同步到真实库  
7. AI 解释 / 改写 / 优化 SQL，并一键送入查询编辑器  

---

## 3. 产品范围

### 3.1 In Scope（对标 Premium 17+ Enterprise）

- 多数据库连接与对象管理  
- 数据查看 / 编辑 / 剖析  
- 查询处理（编辑器、智能补全、可视化构建、Explain）  
- 对象设计器、视图构建、调试器（按引擎能力）  
- 导入导出、数据传输 / 结构同步 / 数据同步  
- 数据生成、数据脱敏、数据字典  
- 备份恢复与自动化作业  
- 数据库建模（Model Workspace）  
- BI Dashboard  
- AI Chat / Ask AI  
- 协作同步（连接、查询、片段、工作区等）  
- 服务器安全（用户管理、监控）  
- MongoDB Aggregation Pipeline、Schema 分析；Redis Pub/Sub、Sentinel / Cluster  

### 3.2 Out of Scope（首期明确不做或延后）

| 项 | 说明 |
| --- | --- |
| 浏览器版 / 纯 Web SaaS | 本期聚焦桌面端 |
| 完全复刻 Navicat Cloud 商业账号体系 | 可自建轻量协作后端，不绑定官方 Cloud |
| 移动端 App | 不在本期 |
| 与官方 Navicat 文件格式 100% 二进制兼容 | 提供自有项目格式；可考虑后续导入 `.ncx` 等连接导出 |

### 3.3 平台支持

| 平台 | 目标版本 |
| --- | --- |
| Windows | Windows 10 / 11；Server 2016+ |
| macOS | macOS 14+（Apple Silicon + Intel） |
| Linux | Ubuntu 22.04+ / 等价发行版（x64） |

---

## 4. 功能需求详述

功能优先级：

- **P0**：MVP 必须，阻塞发布  
- **P1**：对等 Premium 的核心差异化能力  
- **P2**：完整 Enterprise 体验 / 小众引擎增强  
- **P3**：体验增强、边缘场景  

### 4.1 连接与安全（Connection）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| C-01 | 支持引擎：MySQL、MariaDB、PostgreSQL、SQLite、SQL Server、Oracle、MongoDB、Redis（含 Cluster / Sentinel）、Snowflake | P0（前 4 + Mongo/Redis）；其余 P1 |
| C-02 | 云数据库连接模板：AWS / Azure / GCP / Oracle Cloud / MongoDB Atlas / Redis Enterprise Cloud / 阿里云 / 腾讯云 / 华为云等 | P1 |
| C-03 | 国产 / 兼容引擎：OceanBase、TiDB、GaussDB、达梦、人大金仓、IvorySQL、openGauss、PolarDB 等 | P2 |
| C-04 | 安全连接：SSH Tunnel、HTTP/HTTPS Tunnel、SSL/TLS | P0（SSH+SSL）；HTTP Tunnel P1 |
| C-05 | 认证：用户名密码；PAM / LDAP；Kerberos；SQL Server Windows Auth（Windows） | 基础认证 P0；企业认证 P2 |
| C-06 | 连接管理：星标、颜色、分组、显示/隐藏、批量操作、导入/导出连接配置 | P0 |
| C-07 | Connection Profiles：同一连接多套网络/凭证配置快速切换 | P1 |
| C-08 | 连接 URI / 对象 URI：粘贴连接串自动解析；通过 URI 打开对象 | P1 |
| C-09 | 凭证本地加密存储（系统钥匙串 / DPAPI / 自有加密仓） | P0 |

### 4.2 数据查看与编辑（Data Viewer / Editor）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| D-01 | Grid View：分页 / 虚拟滚动浏览、原地编辑、增删行、提交 / 回滚 | P0 |
| D-02 | Form View | P1 |
| D-03 | Tree View / JSON View（文档型 / JSON 字段） | P1 |
| D-04 | 过滤器、排序、查找替换 | P0 |
| D-05 | Table Profile：保存筛选 / 排序 / 列显示组合 | P1 |
| D-06 | 外键数据选择器 | P1 |
| D-07 | 特殊类型查看编辑：Text / Hex / Image / Web / BFile | P1 |
| D-08 | Data Profiling：列类型、分布、统计图表，可交互下钻/过滤 | P1 |
| D-09 | 数据类型着色、会话历史 | P2 |

### 4.3 查询处理（Query）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| Q-01 | 查询编辑器：语法高亮、多 Tab、美化 / 压缩 | P0 |
| Q-02 | 代码智能：补全、实时错误检查、Hover、跳转定义、用量追踪 | P0（补全）；其余 P1 |
| Q-03 | Code Snippet | P1 |
| Q-04 | Query Builder（可视化拼 SQL） | P1 |
| Q-05 | Find Builder / Aggregate Builder（按引擎） | P2 |
| Q-06 | Visual Explain（可视化 / JSON / Text / 统计计划） | P1 |
| Q-07 | Pin Query Result（钉住结果集对比） | P1 |
| Q-08 | 参数化查询 | P1 |
| Q-09 | Console（交互式命令行） | P0 |
| Q-10 | 结果集：导出、复制、只读/可编辑模式 | P0 |
| Q-11 | Refactoring（安全重构引用） | P2 |

### 4.4 对象设计器（Object Designer）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| O-01 | 表 / 集合 / 视图 / 函数 / 存储过程 / 触发器 / 索引 / 事件等对象的可视化设计 | P0（表/视图/索引）；其余按引擎 P1 |
| O-02 | SQL Preview（设计变更预览 DDL） | P0 |
| O-03 | View Builder | P1 |
| O-04 | PL/SQL、PL/pgSQL Debugger（断点、单步、变量、调用栈） | P2 |
| O-05 | ER Diagram View（库内 ER 浏览） | P1 |

### 4.5 导入 / 导出

| ID | 需求 | 优先级 |
| --- | --- | --- |
| IE-01 | TXT / CSV / XML / JSON 导入导出 | P0 |
| IE-02 | Excel / Access / DBF / Parquet / ODBC 导入；Excel / DBF / Parquet 导出 | P1 |
| IE-03 | MongoImport / MongoExport | P1 |
| IE-04 | 向导式字段映射、编码、分隔符、错误行处理 | P0 |

### 4.6 结构与数据操作

| ID | 需求 | 优先级 |
| --- | --- | --- |
| M-01 | Data Transfer：同构 / 异构库表数据迁移，分步向导 | P1 |
| M-02 | Structure Synchronization：结构对比与同步脚本生成/执行 | P1 |
| M-03 | Data Synchronization：数据对比与同步 | P1 |
| M-04 | Data Generation：按规则 / 约束生成测试数据（含参照完整性） | P1 |
| M-05 | Data Masking：敏感字段脱敏 | P2 |
| M-06 | Data Dictionary：库文档模板、导出 PDF、可调度 | P1 |
| M-07 | 跨库复制粘贴数据 | P1 |

### 4.7 备份与恢复

| ID | 需求 | 优先级 |
| --- | --- | --- |
| B-01 | MySQL / MariaDB / PostgreSQL / SQLite / Redis 备份恢复 GUI | P1 |
| B-02 | Dump / Execute SQL 文件 | P0 |
| B-03 | MongoDump / MongoRestore | P1 |
| B-04 | Oracle Data Pump、SQL Server Backup/Restore 封装 | P2 |
| B-05 | 备份转 SQL 脚本 | P2 |
| B-06 | 执行 Redis 命令文件 | P1 |

### 4.8 自动化（Automation）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| A-01 | 批处理作业：串联查询 / 备份 / 传输 / 同步 / 导入导出等 Profile | P1 |
| A-02 | 调度（本地 cron / 系统计划任务） | P1 |
| A-03 | 完成后邮件通知（可带附件） | P2 |
| A-04 | 单作业跨多服务器 Profile | P2 |

### 4.9 建模（Model）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| MD-01 | Model Workspace：概念 / 逻辑 / 物理 / 混合模型 | P1 |
| MD-02 | 方法学：Relational、Dimensional、Data Vault 2.0 | P2 |
| MD-03 | 逆向：库 → 模型；SQL 文件 → 模型；库与模型同步 | P1 |
| MD-04 | 正向：模型 → 库；导出 SQL/脚本 | P1 |
| MD-05 | 命名规范、术语表、批量改 Schema、图层/注释/形状 | P2 |
| MD-06 | 工作区对比、模型转换、导出 PDF/图片 | P2 |

### 4.10 BI

| ID | 需求 | 优先级 |
| --- | --- | --- |
| BI-01 | 20+ 图表类型，连接实时数据源 | P1 |
| BI-02 | 计算字段、多页 Dashboard、布局辅助 | P1 |
| BI-03 | 图表联动、交互控件、全局参数 | P1 |
| BI-04 | 自动刷新、演示模式 | P2 |

### 4.11 AI 能力

| ID | 需求 | 优先级 |
| --- | --- | --- |
| AI-01 | AI Chat：附加库结构上下文；多会话 / Fork；结果送入查询编辑器 | P1 |
| AI-02 | Ask AI 动作：解释 / 优化 / 美化 / 跨库转换 SQL；修错；生成表注释；按上下文填数；设计表/模型 | P1 |
| AI-03 | 多模型对比回答；自定义并固定 AI Actions | P2 |
| AI-04 | 用户自备 API Key（OpenAI / 兼容接口等），不强制绑定单一供应商 | P0（相对商业封闭方案的差异化） |

### 4.12 协作（Collaboration）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| CL-01 | 项目 / 成员；同步连接、查询、Snippet、虚拟分组 | P2 |
| CL-02 | 同步 BI / Model Workspace、Aggregation Pipeline、个人配置 | P2 |

> 协作可先做「导出包 / Git 友好文本格式共享」，云端实时同步作为后续。

### 4.13 服务器安全与监控

| ID | 需求 | 优先级 |
| --- | --- | --- |
| S-01 | 用户 / 权限管理 GUI（按引擎） | P1 |
| S-02 | Server Monitor / Command Monitor | P2 |

### 4.14 引擎专属与其他

| ID | 需求 | 优先级 |
| --- | --- | --- |
| X-01 | MongoDB Visual Aggregation Pipeline | P1 |
| X-02 | MongoDB Schema Analyzer | P1 |
| X-03 | Redis Pub/Sub 管理 | P2 |
| X-04 | 虚拟分组、全局库内搜索、收藏夹 | P1 |
| X-05 | Focus Mode、Dark Mode | P1（Dark P0 体验） |
| X-06 | MapReduce 作业调度入口（Mongo） | P3 |

---

## 5. 非功能需求

| 类别 | 要求 |
| --- | --- |
| 性能 | UI 主线程不因大结果集卡死；连接池 / 取消查询；Explain 与 Profiling 可中断 |
| 安全 | 凭证加密；可选锁屏；审计日志（本地）；不默认上传用户数据 |
| 可靠性 | 崩溃恢复（未保存查询草稿）；长任务进度与可取消 |
| 国际化 | 至少中文、英文；日期/数字本地化 |
| 无障碍 | 基础键盘导航、高对比主题 |
| 可观测 | 本地诊断日志级别可调；匿名崩溃上报可选开启 |
| 合规 | 脱敏工具支持；用户数据本地优先 |

---

## 6. 技术约束与建议（产品侧）

> 详细技术选型可另附 ADR；此处仅约束产品形态。

| 项 | 建议 |
| --- | --- |
| 形态 | 桌面客户端（如 Electron / Tauri / Qt / Flutter Desktop 等，需支持多引擎原生驱动或成熟驱动绑定） |
| 架构 | 连接适配器插件化：每种 DBMS 一个 Driver Adapter，统一元数据 / 查询 / 对象模型 |
| 元数据 | 统一 Object Model（Server → Database/Schema → Object），引擎差异下沉到 Adapter |
| 存储 | 本地项目库（SQLite）存连接元数据、Snippet、作业定义；密钥走 OS 安全存储 |
| 扩展 | 导入导出、AI Provider、协作后端可插拔 |

---

## 7. 里程碑与交付计划

### Phase 0 — 骨架（约 4–6 周）

- 应用壳、连接管理（MySQL / PostgreSQL / SQLite）  
- SSH + SSL、凭证加密  
- 对象树浏览、表数据 Grid、SQL 编辑器 + Console、CSV 导入导出、Dump SQL  

**里程碑验收**：三库完成「连上 → 看表 → 查数 → 改数 → 导出」闭环。

### Phase 1 — 多引擎 MVP（约 8–10 周）

- 增加 MariaDB、MongoDB、Redis  
- Query 补全增强、结果钉住、基础 Explain  
- 用户权限基础 GUI、Dark Mode、虚拟分组  

**里程碑验收**：五引擎以上日常开发可用，可替代轻量场景下的官方工具。

### Phase 2 — 专业数据工作流（约 10–12 周）

- 结构同步、数据同步、Data Transfer  
- 完整导入导出（Excel/JSON/Parquet 等）  
- 备份恢复 GUI、自动化作业 + 调度  
- Data Profiling、Data Dictionary、Data Generation  

### Phase 3 — 建模 / BI / AI（约 10–12 周）

- Model Workspace 正逆向  
- BI Dashboard 联动  
- AI Chat + Ask AI 动作集  
- Aggregation Pipeline、Schema Analyzer  

### Phase 4 — Enterprise 补齐（持续）

- Oracle / SQL Server / Snowflake 与云模板深化  
- 调试器、企业认证、协作云同步、监控、国产库、Data Masking  

---

## 8. 信息架构（桌面 UI）

```
主窗口
├── 连接导航（星标 / 颜色 / 分组 / 搜索）
├── 对象树（库 / Schema / 表 / 视图 / 例程 / …）
├── 工作区 Tabs
│   ├── 数据查看器（Grid / Form / JSON + Profiling）
│   ├── 查询编辑器 / Console
│   ├── 对象设计器
│   ├── 模型工作区
│   ├── BI Dashboard
│   ├── 同步 / 传输向导
│   └── AI Chat
├── 底部：任务中心（导入导出 / 备份 / 作业进度）
└── 全局：设置 / 主题 / 快捷键 / 许可证（若有）
```

---

## 9. 风险与依赖

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 引擎方言与权限模型差异大 | 对象设计 / 同步正确性 | Adapter 单测 + 真实库集成测试矩阵 |
| Oracle / SQL Server 驱动与授权 | 发布合规、包体积 | 可选组件安装；文档标明依赖 |
| 异构同步语义复杂 | 数据丢失风险 | 默认生成预览脚本；执行前 diff 确认；干跑模式 |
| AI 幻觉导致错误 DDL/DML | 生产事故 | 默认只读建议；写操作需用户确认；可附加 Schema 上下文 |
| 对标范围过大 | 交付延期 | 严格按 Phase；P2/P3 不阻塞前序发布 |

---

## 10. 开放问题（待产品确认）

1. **技术栈**：Electron / Tauri / Qt / 其他？是否必须原生观感优先于开发效率？  
2. **商业模式**：个人免费 + 团队订阅？是否需要在线激活？  
3. **协作**：自建同步服务，还是仅「文件 / Git」协作？  
4. **AI**：默认接入哪些模型？是否提供托管代理？  
5. **首发引擎清单**：Phase 0/1 最终锁定哪几个？  
6. **品牌与命名**：产品正式名称、是否强调「兼容 Navicat 工作流」？  
7. **许可与合规**：开源（AGPL/MIT）还是闭源商业？第三方驱动许可证审查责任人？  

---

## 11. 附录：对标能力速查（Premium 17+）

| 模块 | 对标要点 |
| --- | --- |
| General | 多引擎 + 云厂商 + 部分国产库 |
| Connection | SSH / HTTP Tunnel / SSL；企业认证；连接着色与 Profiles |
| Collaboration | 项目成员；连接/查询/模型/BI 同步 |
| Data Viewer | Grid/Form/Tree/JSON；Profiling；Table Profile |
| Query | 智能编辑器、Builder、Visual Explain、Pin Result |
| Object Designer | 可视化设计、View Builder、调试器 |
| AI | Chat、多模型、Explain/Tune/Convert/Fix SQL |
| BI | 多图表、联动 Dashboard、计算字段 |
| Model | 概念/逻辑/物理；正逆向；Data Vault 等 |
| Import/Export | 文本 + Excel/ODBC/Parquet/Mongo 工具 |
| Manipulation | Transfer / Struct Sync / Data Sync / Generate / Mask / Dictionary |
| Backup | 各引擎备份封装 + Dump SQL |
| Automation | 调度批处理 + 邮件 |
| Security | 用户管理、Server/Command Monitor |
| Others | ER、URI、Aggregation、Schema 分析、Pub/Sub、Focus/Dark |

---

## 12. 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v0.1 | 2026-11-16 | 首版：基于 Navicat Premium 17+ Feature Matrix 整理完整范围、优先级与分期 |

---

**下一步建议**：确认第 10 节开放问题（尤其是技术栈、首发引擎、商业模式），然后将 Phase 0 拆为可执行的技术任务与验收用例。
