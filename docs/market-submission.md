## 类型

- [x] 新工作台 / 安装来源变更
- [ ] 展示信息修改
- [ ] 下架
- [ ] 仓库规范 / 工具 / 工作流维护

## 变更

新增一份工作台条目 `data/workbenches/OliverLiy__projectHub.yml`，对应仓库 https://github.com/OliverLiy/projectHub （工作台名称「项目总控台」，分类 `productivity`）。本 PR 只新增这一个 YAML 文件。

工作台用途：把同时在跑的多个项目按模块集中管理，一屏看完状态、进度、待跟进与 DDL 风险；内置概览、模块看板、状态看板、列表、日历、时间线、待跟进七个页签；并支持用自然语言增删改查项目——增删改会先生成可读的变更清单，用户确认后才一次性写入，且可一步撤销。数据存放在 DSH 数据目录，卸载不删除。

## 投稿验证（维护类 PR 可标注不适用）

- 工作台仓库 / 本次实际安装版本或 commit：https://github.com/OliverLiy/projectHub @ `785202d`；实际安装用的是本仓库 `pnpm pack` 产出的 `dsh-workbench-project-console-1.0.0.tgz`（SHA-256 `fae83c8c6cc4d5f1ec76031d37ab60a34f4c6f04900d0b670d325d9d79da55af`），源码安装路径可用（仓库默认分支已包含构建产物 `lib/client.js` 与 `cordis.patch.yml`）。未发布 npm 包（registry 查询该包名返回 404），未声明 `tarball`，因此目录应走 GitHub 源码来源。
- 实测 Desktop 版本、系统与架构：DSH Desktop **0.11.0**，macOS **27.0**，**arm64**。
- 安装、打开、切换及卸载的步骤与结果：通过 `dsh plugin --profile web add <本仓库 .tgz>` 安装，退出码 0；安装到 profile 的副本与 tarball 逐文件 SHA-256 一致。打开后工作台以左侧业务面板嵌入宿主窗口（不改宿主框架、不创建会话），七个页签逐个点开验证：概览 6 KPI + 环形图/堆叠条/直方图/排行，模块看板 12 卡，状态看板 4 列 12 迷你卡，列表 12 行，日历 35 格 22 条，时间线 12 行 + 今天线，待跟进 4 分组；左侧模块/智能视图筛选对所有页签联动；页面无 console 错误。卸载未在本机执行（会移除包与入口，保留会话与数据）。
- 权限、外部服务、费用、源码与资源授权：除 AI 填充可选调用宿主已配置的模型外，不使用任何外部服务、不需要额外密钥或付费；数据只写本机 DSH 数据目录下的一个 JSON，不联网、不写会话、不写工作区文件。代码与截图为作者自有，截图已排除任何真实业务数据（仅用内置示例数据拍摄）。
- 安装包及构建来源证据（如有）：`pnpm verify` = 107 个测试 + 包格式校验脚本全部通过；包体积 0.084 MiB（上限 8 MiB）；包内不含密钥、绝对路径或用户数据。
- 未验证平台、已知限制与升级影响：只在 macOS arm64 + Desktop 0.11.0 验证，未验证 Windows/Linux；AI 填充依赖宿主默认模型，模型不可用时自动退回本地规则解析并在界面标注来源；条目身份为 `OliverLiy/projectHub`，若日后转移仓库需要按迁移规则处理。

## 检查

- [x] 已运行 `npm ci --ignore-scripts && npm run check`，以下写明实际结果。
- [x] YAML 与精简 example/Schema 一致，截图 HTTPS 地址与工作台信息在同一个文件。
- [x] 未提交生成目录、安装包、凭据、个人邮箱或真实业务数据。
- [x] 理解 CI、人工审核、合并、上线是不同状态，不自行声明审核通过。

实际检查结果：

- 在本机对 market 仓库 `5805c46`（提交时的 main HEAD）执行 `npm run validate`：`目录数据有效：10 个工作台`（含本条目），example 与 Schema 一致。
- `npm run check`：58 个测试全部通过（0 fail）。
- `node scripts/validate-pr.mjs 5805c46 HEAD`：`PR 类型：submission`（改动范围只新增一份工作台 YAML）。
- 用 market 仓库自己的 `validatePackage()` 校验本工作台 `package.json`：通过，客户端入口 `./lib/client.js`、bundle patch `./cordis.patch.yml`。
- 5 张截图为 2882×1960 的合法 PNG（248–400 KiB，均在 2 MiB 与 16 MiPixel 限制内），已放在源仓库 `docs/images/`。
- 本机网络无法访问 `raw.githubusercontent.com`，因此**没有在本地跑通联网探针**；截图与三个关键文件的存在性与内容已通过 GitHub API 逐项核对（`package.json`、`cordis.patch.yml`、`lib/client.js`、`docs/images/*.png` 均在默认分支 `master` 上可读取）。真正的来源与图片探测以本仓库 CI 结果为准。

维护者审核结论由维护者在 PR review 中记录，不由投稿者代填。
