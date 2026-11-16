# 需求文档 — 表右键菜单全部可用（MySQL 优先）

> 状态：已批准 2026-11-16（用户「需要全部实现」）
> 关联：[design.md](./design.md) · [tasks.md](./tasks.md)
> 复杂度：Complex | 范围：MVP=P0+P1；真 BI 工作区进 Backlog

## 1. 问题陈述

对象列表表右键菜单项大多「看起来有、实际半残」：配置打开被重置、复制只拷表名、转储 INSERT 双引号无法导入、字典/生成用假类型、维护看不到结果、BI 假入口。成功标准：菜单每一项对 MySQL 都能完成其名义职责；不能做的改为诚实可用的等价能力。

## 2. 用户故事与 AC

### US-1 打开与配置
- **AC-1.1**：When 用配置打开表, the system shall 应用并保持 sort/filter/pageSize。
- **AC-1.2**：When 另存为配置, the system shall 保存网格当前状态并可命名/删除。

### US-2 复制粘贴与转储
- **AC-2.1**：When 复制, the system shall 写入 SHOW CREATE TABLE DDL。
- **AC-2.2**：When 粘贴 DDL, the system shall 可改名后执行创建。
- **AC-2.3**：When 转储结构+数据, the system shall 生成可被 MySQL 直接导入的反引号 SQL。

### US-3 字典/生成/维护
- **AC-3.1**：数据字典 shall 含真实类型、可空、PK、默认、注释。
- **AC-3.2**：数据生成 shall 按真实列类型取值并跳过自增。
- **AC-3.3**：维护 shall 展示服务器返回的 Msg_text。

### US-4 向导/权限/组/共享/脱敏/逆向
- **AC-4.1**：导入 shall 支持预览、列映射、可选清空、去 BOM。
- **AC-4.2**：导出 shall 支持列选择与 UTF-8 BOM。
- **AC-4.3**：权限 shall 列出表级授权并可 GRANT/REVOKE。
- **AC-4.4**：组 shall 支持改名/删除；共享包为可恢复的单 SQL；脱敏为「导出脱敏 CSV」+预览；逆向含真类型与 FK。

### US-5 BI
- **AC-5.1**：原「创建 BI 工作区」改为「生成简易图表」本地报告，或保持禁用并写明原因；不得假装打开工作区。

## 3. 非目标
完整 BI 工作区、Excel 导入、原地脱敏 UPDATE、用户账号管理器、左树表节点。
