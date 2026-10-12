## 类型

- [x] 新工作台 / 安装来源变更
- [ ] 展示信息修改
- [ ] 下架
- [ ] 仓库规范 / 工具 / 工作流维护

## 变更

只给 `data/workbenches/OliverLiy__projectHub.yml` 增加一行 `tarball:`，把安装来源从「GitHub 源码」改为「GitHub Release 预构建包」。名称、分类、双语简介、截图都不变。

**原因**：源码来源要求客户端下载 `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/package.json`。在 `raw.githubusercontent.com` 不可达的网络环境里（DNS 可正常解析到 185.199.109.133，但 443 连接被阻断），市场安装会在第一步就失败，用户看到的是 `Could not download package.json from the repository: fetch failed`（出自 `dsh-desktop-workbenches/market-install.mjs` 的 github-source 分支）。同一个 URL 的内容通过 `api.github.com` 可以正常读取，说明仓库与 commit 都没问题，纯粹是该主机的可达性问题。

改用预构建包后，客户端从 `github.com/.../releases/latest/download/...` 下载 `.tgz`，`package.json` 直接从包内读取，不再依赖该主机。仓库里已包含构建产物（`lib/client.js`），所以源码来源本身仍是完整可安装的，这次只是把默认来源换成更稳的预构建包。

## 投稿验证（维护类 PR 可标注不适用）

- 工作台仓库 / 本次实际安装版本或 commit：https://github.com/OliverLiy/projectHub ，安装包来自 Release [v1.0.0](https://github.com/OliverLiy/projectHub/releases/tag/v1.0.0)
- 实测 Desktop 版本、系统与架构：DSH Desktop **0.11.0**，macOS **27.0**，**arm64**
- 安装、打开、切换及卸载的步骤与结果：本机用同一个 `.tgz` 通过 `dsh plugin --profile web add` 安装（退出码 0），安装后的副本与包内文件逐项 SHA-256 一致；打开后七个页签与 AI 填充均正常，页面无 console 错误。卸载未在本机实测。
- 权限、外部服务、费用、源码与资源授权：除 AI 填充可选调用宿主已配置的模型外，不使用外部服务与额外密钥；数据只写本机 DSH 数据目录；截图与代码为作者自有，截图仅含内置示例数据。
- 安装包及构建来源证据（如有）：`dsh-workbench-project-console.tgz`，**87811 字节**，SHA-256 `fae83c8c6cc4d5f1ec76031d37ab60a34f4c6f04900d0b670d325d9d79da55af`，包内 `package.json` 版本 **1.0.0**、`repository` 指回本仓库。固定地址实测：`https://github.com/OliverLiy/projectHub/releases/latest/download/dsh-workbench-project-console.tgz` 返回 HTTP 200，下载内容 SHA-256 与本地构包一致。包体积 0.084 MiB（上限 8 MiB）。
- 未验证平台、已知限制与升级影响：Windows / Linux 未验证。另外记录一个环境现象：本机访问 GitHub release 资产的速度偶发很慢（同一个资产实测 1.8s 与 71s 各出现过，对比其他工作台的 Release 资产同样如此），客户端下载超时为 60s，因此个别情况下安装需要重试；这不是本次条目变更引入的。改用 Release 来源后，后续每个版本需要创建一次 Release。

## 检查

- [x] 已运行 `npm ci --ignore-scripts && npm run check`，以下写明实际结果。
- [x] YAML 与精简 example/Schema 一致，截图 HTTPS 地址与工作台信息在同一个文件。
- [x] 未提交生成目录、安装包、凭据、个人邮箱或真实业务数据。
- [x] 理解 CI、人工审核、合并、上线是不同状态，不自行声明审核通过。

实际检查结果：

- `npm run validate`：`目录数据有效：13 个工作台`，example 与 Schema 一致。
- `node scripts/validate-pr.mjs 9416b9e HEAD`：`PR 类型：maintenance`，改动范围只有一份工作台 YAML、1 行新增。
- `npm run check` 的测试套件与本次改动无关（只改 YAML），如需以 CI 结果为准。

维护者审核结论由维护者在 PR review 中记录，不由投稿者代填。
