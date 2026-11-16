# Phase 0 端到端烟测清单

> 对应计划任务 T20。在本机执行并在 `tasks.md` 审计日志登记结果。

## 先决条件

```bash
npm install
docker compose up -d
npm run tauri dev
```

| 引擎 | 连接参数 |
| --- | --- |
| SQLite | 任意本地 `.db` 文件路径 |
| MySQL | `127.0.0.1:3307` / `navicat` / `navicat` / `demo` |
| PostgreSQL | `127.0.0.1:5432` / `navicat` / `navicat` / `demo` |

## 用例

1. **启动与主题**
   - [ ] 应用主窗口三栏可见
   - [ ] 切换深色主题，重启后保持

2. **连接管理**
   - [ ] 新建三引擎连接并可保存
   - [ ] 非法端口无法保存并提示
   - [ ] 星标/颜色/分组重启后仍在
   - [ ] 导出 JSON 无明文密码；可再导入元数据

3. **打开 → 看表 → 查数 → 改数**
   - [ ] 对每个引擎：打开连接，对象树出现表
   - [ ] 双击表打开 Grid，可翻页/排序/过滤
   - [ ] 修改单元格并提交，刷新后数据正确
   - [ ] 有未保存修改时关闭 Tab 会确认

4. **查询 / Console**
   - [ ] 查询页 SQL 高亮，执行 `SELECT` 有结果
   - [ ] 未打开连接时执行有提示
   - [ ] Console 执行错误语句有错误输出

5. **导入导出 / Dump**
   - [ ] 导出 CSV 含表头，可取消中途导出
   - [ ] 导入 CSV 报告成功/失败行数
   - [ ] Dump SQL 可下载，SQLite 下可再执行复现（抽测）

6. **SSH Tunnel（可选，需本机/跳板 sshd）**
   - [ ] 连接表单勾选 SSH，填写跳板机账号密码后「测试连接」成功
   - [ ] 错误 SSH 密码有明确「SSH 认证/连接失败」提示
   - [ ] 断开连接后本地转发端口释放（可再连）

7. **安全底线**
   - [ ] `~/Library/Application Support/mycat/meta.db` 无明文密码
   - [ ] `logs/app.log` 有错误日志（可故意触发一次失败）
   - [ ] 无远程上传逻辑（本地功能）

## 自动化回归

```bash
cd src-tauri && cargo test --lib
npm run build
```

自动化覆盖：三引擎直连、Dump SQL、SSH 不可达主机错误前缀、CSV/UI 构建。SSH 成功路径依赖真实 sshd，见上方用例 6。
