# 本机自测记录（规范第 8 节）

- 环境：macOS 26（arm64）· DSH Desktop **0.11.0** · Harness `web` profile · `$DSH_HOME=$DSH_HOME`
- 包：`dsh-workbench-project-console@1.0.0`，产物 `dsh-workbench-project-console-1.0.0.tgz`
- 界面：左侧嵌入式业务面板（`embedded: true` + `businessSide: 'left'` + 宽度 0.68），顶栏 / 模块导航 / KPI / 按模块分区的看板 / 详情抽屉
- 工作台身份：`OliverLiy/projectHub`（`register({ repository })` 解析而来，公开仓库 https://github.com/OliverLiy/projectHub）

## 包与加载

| 项 | 结果 | 证据 |
|---|---|---|
| 第 3 节全部「必须」项 | ✅ 通过 | `pnpm verify` → `scripts/check-workbench-package.mjs` 结论「通过（必须项全部满足，建议项 0 条）」 |
| `pnpm pack` 后用 `tar -tzf` 核对内容 | ✅ | 产物含 `package/package.json`、`package/dsh/server.js`、`package/dsh/store.js`、`package/lib/client.js`、`package/cordis.patch.yml`、`README.md`、`LICENSE`（24 KB，无敏感文件） |
| 从该产物安装（而非源码启动） | ✅ | `dsh plugin --profile web add <abs>/dsh-workbench-project-console-1.0.0.tgz` → exit 0；文件落在 `profiles/web/node_modules/dsh-workbench-project-console/` |
| 配置层：`--dump-config` 找到本包插件层 | ✅ | `# == dsh-workbench-project-console` / `- id: project-console` / `name: dsh-workbench-project-console` / `config.root: !!js dshHomePath('project-console')` / `__dshPluginOwner.workbench: true` |
| 已安装列表：Desktop「工作台管理／已安装的工作台」找到条目 | ✅ | 真实 Harness 页面截图 `.verify/installed-list.png`：卡片「项目总控台」+「本地」徽标 + 分类「项目管理」+ v1.0.0 + 启用开关 + 卸载 |
| 左侧入口 + 实际打开业务面板 | ✅（面板已挂载、可打开、可操作） | `.verify/ui-01-mode-menu.png`（模式切换器菜单里有「📋 项目总控台」）、`.verify/ui-02-overview.png`（面板停靠右侧并渲染总览） |

## 第 4 节：界面边界

| 项 | 结果 | 证据 |
|---|---|---|
| 面板不遮挡侧栏、市场和管理入口 | ✅ | 截图里 `工作台／插件／工作区／设置／新会话` 都在原位；面板注册为 `businessSide: 'right'`、`businessWidth: 0.5`，只占宿主分配的主内容区右侧 |
| 缩放窗口与切换模式 | ✅ | 视口 1512×950 与 1440×900 两次运行均正常渲染，无溢出/裁切（`.verify/ui-02`、`ui-03`） |
| 键盘可到达业务操作 | ✅（结构性核对） | 全部操作是原生 `button`/`input`/`select`/`textarea`，有 `aria-label`/`aria-pressed`/`role=status`；按钮用 `:focus-visible` 显示焦点轮廓。未做逐键 Tab 走查 |
| `customFrame` 相关项 | 不适用 | 未使用 `customFrame`，业务面板作为右侧嵌入式面板由宿主布局 |

## 第 5–6 节：工作区与会话

| 项 | 结果 | 说明 |
|---|---|---|
| 从业务入口触发宿主目录选择器、取消/确认后的核对 | 不适用 | 本工作台不创建文件或工作区；项目记录存在 `$DSH_HOME/project-console/state.json` |
| 依赖会话时创建/恢复本工作台会话、草稿由用户发送 | 不适用 | 本工作台不创建会话、不写会话草稿。「分析进展／生成文档」产出提示词或 Markdown 草稿，由用户复制到旁边原生会话发送（面板内有一键复制与下载 `.md`） |
| 同一工作区里原生会话与两个工作台会话的归属核对 | 未执行 | 需要手工在 Desktop 里建会话核对；本工作台不参与会话归属 |

## 第 7 节：模式切换与保留

| 项 | 结果 | 证据 |
|---|---|---|
| 模式切换器里出现本工作台入口 | ✅ | `.verify/ui-01-mode-menu.png` |
| 切到本工作台后业务面板立即可用 | ✅ | `.verify/ui-02-overview.png`；无会话状态下打开即用（宿主显示「暂无可用的会话」占位，业务面板照常渲染） |
| 关闭重开/卸载后数据保留 | ✅（结构核对） | 数据在 `$DSH_HOME/project-console/state.json`，代码不删除该目录；卸载工作台不会动它。未做真实卸载后再装的往返 |
| 记录版本、系统、架构、包版本、UI 路径与未验证项 | ✅ | 本文件 |

## 交互与数据往返实测（真实 Harness 页面 + 真实 `dsh/store.js`）

浏览器：Chromium（Playwright），加载 `http://127.0.0.1:43129`，`dsh-workbench-enabled=true`；
客户端模块、注册、身份解析、模式切换、「已安装的工作台」都走真实宿主，只把
`/api/project-console/*` 的 HTTP 传输换成本进程直连真实 store。

| 动作 | 结果 |
|---|---|
| 打开工作台总览 | ✅ 4 个项目按风险排序：已逾期 → 阻塞 → 紧急 → 已完成；模块页签计数正确；汇总条 4/2/3/3/1 |
| 点开项目详情 | ✅ 风险判定理由、进展时间线、待跟进清单、AI 按钮齐全（`.verify/ui-03-detail.png`） |
| 追加一条进展 | ✅ 写入真实 store：`state.json` revision 1 → 2，`p1.updates` 从 1 条变 2 条，最后一条为「联调通过，进入验收阶段」 |
| 生成 AI 提示词 | ✅ 生成「进展分析提示词」并带复制/下载 `.md`（`.verify/ui-05-ai-prompt.png`） |
| 自然语言问询 | ✅ 问「哪些项目这周到期？」→「本周（到 2026-10-11）到期的项目（1 个）· 官网改版（日常工作｜进行中｜还剩 2 天）」（`.verify/ui-06-query.png`） |
| 页面错误 | ✅ 无 `pageerror`、无 console error |

## 重启后的加载实测（已完成）

我原先认为需要你手动重启 Harness；实际上你随后从市场装了另一个工作台，Desktop 自己重启了 Harness
（日志里 14:17 / 14:19 / 14:21 各有一次 `launch requested` + `Harness is ready`）。重启后：

| 项 | 结果 | 证据 |
|---|---|---|
| 服务端入口加载成功 | ✅ | `GET /api/project-console/meta` → 200，`{"plugin":"dsh-workbench-project-console","root":".../harness/project-console","revision":0,"projectCount":0}` |
| 读写接口可用 | ✅ | `POST /api/project-console/state` → `{"revision":1,"projectCount":5}`，`GET` 原样读回；`state.json` 落在 `$DSH_HOME/project-console/` |
| 左侧入口 + 实际打开 | ✅ | 模式切换器选择「项目总控台」后面板可见（`aside.dshWbBusiness` 可见、`data-side=left`、`data-embedded=true`） |
| 工作台已被添加/固定 | ✅ | Desktop 状态 `added`/`pinned` 含 `OliverLiy/projectHub`；宿主状态里已有绑定到本工作台的会话 |
| 面板已挂载 | ✅ | 面板 DOM 常驻，切到本工作台即显示（不再出现「读取失败」） |

## 新版界面实测（真实 Harness 页面 + 真实接口 + 真实数据）

浏览器加载 `http://127.0.0.1:43129`（`dsh-workbench-enabled=true`），全程**不打桩**：
客户端模块、注册、身份解析、模式切换、`/api/project-console/*` 与 `state.json` 都是真的。

| 项 | 结果 | 证据 |
|---|---|---|
| 模块化布局结构 | ✅ | `data-side=left`、`data-embedded=true`、根节点首个子元素是 `<header>`；侧栏 9 项（1 个全部 + 3 个模块 + 5 个智能视图）、5 个 KPI、按模块 3 个分区、5 张卡片（`.verify/ui2-01-overview.png`） |
| 模块分区与计数 | ✅ | 「公司项目 2 个 · 1 个需关注 · 待跟进 2 · 平均进度 78%」等分段表头；侧栏模块与智能视图计数与数据一致 |
| 详情抽屉 | ✅ | 关键信息网格、时间风险条与判定理由、彩色进展时间线、待跟进清单、AI 助手按钮（`.verify/ui2-02-detail.png`） |
| 列表视图 | ✅ | 表头 项目/模块/状态/进度/截止/剩余/风险/待跟进，5 行数据（`.verify/ui2-03-list.png`） |
| 追加进展（真实写入） | ✅ | 输入后点「追加」→ 无报错；随后 `GET` 能看到新记录 |
| 「问一句」 | ✅ | 问「哪些项目这周到期？」→「本周（到 2026-10-11）到期的项目（1 个）· 官网改版（日常工作｜进行中｜还剩 2 天）」（`.verify/ui2-04-ask.png`） |
| 新建项目（真实写入） | ✅ | 弹窗表单填写 → 创建后卡片数 5→6，`GET /state` revision 递增（`.verify/ui2-05-form.png`、`.verify/ui2-06-created.png`） |
| 窄窗口（容器查询） | ✅ | 视口 1120px：面板 571px、侧栏自动变为横向滚动（`flex-direction: row`）、卡片 2 列（`.verify/ui2-07-narrow.png`） |
| macOS 收起侧栏的窗口按钮避让 | ✅ | 折叠侧栏后 `--dsh-frame-leading-clearance` 生效，顶栏 `padding-inline-start` 由 16px 变为 **160px**；模拟 `[data-platform=darwin]` 时同样命中（宿主规则命中的正是「左侧嵌入式面板 > :first-child > header」） |
| 公共入口不被遮挡 | ✅ | 截图里 `新会话 / 工作台 / 插件 / 工作区 / 设置` 与右侧原生会话都在原位 |
| 页面错误 | ✅ | 无 `pageerror`、无 console error |

空状态：`.verify/ui2-10-empty.png`（图标 + 「还没有项目」+ 新建按钮）。

## AI 填充（自然语言增删改查）实测

实现：顶栏「AI 填充」→ 自然语言 → 计划 → **确认弹窗** → 一次性写入。

| 层 | 做法 |
|---|---|
| 服务端 | `/api/project-console/ai`：用宿主注册的 `llm` 服务 + `agentDefaultModel` 解析出的路由调模型（`purpose: project-console-ai`，40s 超时），把返回的 JSON 收敛成计划；任何一步失败都退回 `planFromRules` |
| 纯函数层 | `src/shared/aiplan.js`：`normalizePlan`（校验动作、按 id/全名/包含匹配项目、解析「下周五/月底/明天」这类日期、夹紧进度）、`previewPlan`（生成给用户看的 before → after）、`applyPlan`（一次写入）、`revalidatePlan`（应用前再核对）、`planFromRules`（本地兜底） |
| 客户端 | 弹窗：输入 → 解析 → **变更清单 + 来源标注 + 跳过原因** → 「确认执行 N 项变更」；执行后顶部出现可撤销的一步 |

自动化测试（`pnpm verify` 共 103 个）新增：

- `test/aiplan.test.js` 14 个：日期解析（含下周五/月底/+3天）、项目匹配与歧义、动作校验与丢弃、
  计划推断、预览文案（`截止 2026-10-06 → 2026-10-31；进度 55% → 80%`）、`applyPlan` 的一次性应用与不可变性、
  本地规则识别查询/新增/修改/删除/待跟进、模型上下文快照。
- `test/server.test.js` 新增 5 个：用**假的 llm 服务**跑通完整模型路径
  （prompt → 流 → BlockAssembler → 抠 JSON → 收敛），验证 provider/model/maxTokens/system/用户消息内容；
  代码块+废话也能解析；query 无回复时用本地问答补；以及 5 种降级（流以 error 结束、没有 JSON、
  没有 llm 服务、没有默认模型、stream 直接抛错）。

真实页面全流程（真实 `/state` 读写，只有 `/ai` 的响应是桩）：

| 检查 | 结果 |
|---|---|
| 解析阶段不写库 | ✅ 起始 revision 32 → 解析后仍是 32 |
| 确认弹窗内容 | ✅ 5 组：新增项目 1 / 修改项目 1 / 删除项目 1 / 待跟进 1 / 进展记录 1，含 `截止 2026-10-06 → 2026-10-31；进度 55% → 80%` |
| 来源与跳过原因 | ✅ 「模型解析 deepseek-official/deepseek-flash」；警告列出「「副业小程序原型」匹配到多个项目，请说全一点」 |
| 确认后写入 | ✅ revision 32 → 33；目标项目 DDL/进度/待跟进/进展都变了，新项目出现，被删项目消失 |
| 撤销 | ✅ revision → 34，新项目消失、数据回到执行前 |
| 查询类不弹确认 | ✅ 只显示答案与「关闭」按钮，revision 不变 |
| 页面错误 | ✅ 无 |

截图：`.verify/ui5-01-ai-open.png`、`ui5-03-ai-preview.png`、`ui5-04-ai-applied.png`、`ui5-05-ai-undone.png`、`ui5-06-ai-query.png`

### 真实模型调用（已实测）

Harness 重启后 `/api/project-console/ai` 加载成功，用真实模型跑通：

| 输入 | 结果 |
|---|---|
| 空项目列表 + 「这周要交付什么？」 | `source: llm`、`model: deepseek-official/deepseek-flash`、1.63s、`intent: query`，回答正确指出列表为空 |
| 13 个真实项目 + 「把订单结算服务重构的 DDL 改到下周五，进度调到 80%，再加一条待跟进：补压测报告」 | `source: llm`、2.41s、`intent: update`；`下周五` → `2026-10-16`；按名字匹配到 `demo-company-1`；产出 2 条规范化动作（update + addTodo），`issues` 为空 |

未在真实模型上验证的部分：模型返回非法 JSON、超时、配额不足这些降级路径（由 `test/server.test.js` 的桩覆盖）。

## 多维度看板与日历看板实测（同一 Harness、真实接口、12 个示例项目）

浏览器 1600×1000，全程不打桩。逐页签点开并用 DOM 计数核对：

| 页签 | 实测结果 | 截图 |
|---|---|---|
| 概览 | 6 个 KPI；环形图 6 个扇区；模块负载 3 行；进度分布 6 列；负责人负载 1 行；需关注清单 11 行；两列栅格（337px×2） | `.verify/ui4-01-overview.png` |
| 模块看板 | 12 张卡片，按模块分 3 段 | `.verify/ui4-02-board.png` |
| 状态看板 | 4 列（进行中 9 / 待启动 1 / 阻塞 1 / 已完成 1），12 张迷你卡 | `.verify/ui4-03-kanban.png` |
| 列表 | 12 行，8 列 | `.verify/ui4-04-list.png` |
| 日历 | 35 格（5 周）· 22 个日期条 · 14 天有安排 | `.verify/ui4-05-calendar.png` |
| 时间线 | 12 行横条 + 今天竖线，按周刻度，risk 着色 | `.verify/ui4-06-timeline.png` |
| 待跟进 | 4 个分桶（已逾期 3 / 今天到期 1 / 本周内 7 / 更晚 1），12 行 | `.verify/ui4-07-followups.png` |

交互实测：

- 日历翻月：2026 年 10 月 → 9 月 → 点「今天」回到 10 月；点 10-05 显示当天 1 项并带「完成」按钮（`.verify/ui4-08-calendar-today.png`、`ui4-09-calendar-day.png`）。
- 点时间线横条打开详情抽屉（`.verify/ui4-10-timeline-sheet.png`）。
- 左侧选「日常工作」后日历联动：范围显示「日常工作 · 4 个」，日期条从 22 降到 8（`.verify/ui4-11-calendar-filtered.png`）。
- 页面错误：无 `pageerror`、无 console error。

### 本轮修掉的界面问题

1. **概览塌成一列**：我自己写的 `@container (max-width:1080px){.pc-dash-grid{grid-template-columns:1fr}}`
   按面板宽度（约 898px）命中了，把两列栅格压成一列。删掉这条，交给 `auto-fit` 自己判断——
   实测栅格恢复成 `337px 337px`。
2. **时间线色条全变灰**：`.pc-tl-bar{color:inherit}` 和语义色类 `.pc-c-danger` 同特异性、但写在后面，
   把风险色覆盖掉了。去掉 `color:inherit` 后恢复红/橙/绿着色。
3. **日历翻月箭头方向反了**：图标本身就是左箭头，又叠了一层 `rotate(180deg)`。
4. 顺带把 KPI 调到一屏 6 个、看板列窄一点。

## 首次进入生成示例数据（按你的要求）

实现：`src/shared/sample.js` 的 `buildSampleProjects(today)` 每次按当天日期相对生成
**公司项目 4 个 / 日常工作 4 个 / 其他项目 4 个**，共 12 个，覆盖已逾期 2、紧急 3、进度风险 2、
阻塞 1、已完成 1、正常 3，并带 13 条未完成待跟进与多条进展记录；每条都带「示例」标签便于识别。

内容按你的要求全部换成程序员的真实工作：公司项目是订单结算服务重构、数据中台订单域接入、
移动端首屏性能优化、灰度发布平台上线；日常工作是**内部分享《线上问题定位实战》准备**、
**Q3 技术季度汇报**、线上告警值班与故障复盘、依赖升级与技术债清理；其他项目是自研服务监控小工具、
开源项目 issue 与 PR 维护、技术笔记与博客整理、副业小程序原型。测试里加了断言，保证「日常工作」
一定包含技术分享准备与季度汇报，且内容里不会再出现旧的非研发案例（报销／供应商比价／拜访材料／内训课件）。

触发规则：
- **首次进入自动生成**：文档为空、且从来没生成过（服务端 `seededAt` 标记或浏览器本地标记都没有）时，
  自动按模块生成一次，并弹出提示；生成过一次就不再灌回，所以「清空」之后刷新不会又冒出来。
- **手动**：侧栏底部「示例数据」按钮（追加，可重复）、空状态里的「生成示例项目」。
- **清空**：侧栏底部「清空」（带确认弹窗），只删除工作台里的记录。

真实页面实测（同一 Harness、真实接口，全程不打桩）：

| 步骤 | 结果 | 证据 |
|---|---|---|
| 清空文档后首次进入（全新浏览器会话） | ✅ 自动生成 12 个：公司项目 4 / 日常工作 4 / 其他项目 4；KPI 需关注 8、待跟进 12、本周到期 4；侧栏与模块分区计数一致 | `.verify/ui3-01-first-entry.png` |
| 点「清空」 | ✅ 12 → 0，提示「已清空全部项目」，本地标记置 1 | `.verify/ui3-04-empty-after-clear.png` |
| 同一会话刷新页面 | ✅ 仍是 0，没有被自动灌回（空状态 + 两个入口） | 同上 |
| 空状态点「生成示例项目」 | ✅ 12 个回来，提示「已生成 12 个示例项目（公司项目 4 个、日常工作 4 个、其他项目 4 个）」 | `.verify/ui3-05-manual-samples.png` |
| 逐模块查看 | ✅ 公司项目 / 日常工作 / 其他项目 各 4 张卡片 | `.verify/ui3-06-module-daily.png` |
| 页面错误 | ✅ 无 `pageerror`、无 console error | — |

### 顺带修掉的两个问题

1. **首次进入的判定不能只看 revision**：服务端把文档缓存在内存里，删掉文件后仍在报旧 revision，
   所以改成持久标记 `seededAt`（写入文档）+ 浏览器本地标记双保险——运行中的服务端还是旧代码时也不会失效。
2. **写入没有串行化**：连续操作（刚自动生成就又点清空）会拿同一个版本号各写一次，第二次 409 回滚。
   现在 `update()` 用一个 promise 队列串行执行，实测不再出现 409。

> 注：运行中的 Harness 仍是本轮之前加载的服务端模块（Node 的 ESM 缓存 + 本版本没有模块级热替换），
> 所以 `seededAt` 目前还没写进文档；下次重启 Harness 后这一条会开始生效。浏览器本地标记已经生效，
> 实际行为（清空后不再灌回）本轮已实测通过。

## 自测中修掉的两个真问题

1. **服务端路由重复注册**：`connection.fetch` 的 exact 路由按路径唯一，最初把
   `/api/project-console/state` 注册了两次（GET/POST 各一条），Harness 日志报
   `exact Fetch route ... is already registered`。已改为一条路由 + `methods: ['GET','POST']` 按方法分发，
   并在测试里加了「同路径只能注册一次」的断言。
2. **主按钮白字变黑字**：样式里 `.pc-root button{color:inherit}`（0,1,1）盖过了 `.pc-btn-primary`（0,1,0），
   深色按钮上的文字与背景同色。已改成零特异性的 `.pc-root :where(button,input,select,textarea)`，
   实测计算样式 `color: #fff` / `background: #0f1115`。

## 未验证 / 需要你自己确认的项

- **Desktop 主窗口**：以上 UI 实测是在同一台 Harness 的浏览器会话里完成的（同一 URL、同一数据），
  我没有操作 Desktop 的 Electron 窗口。窗口本身只需刷新或重启一次即可加载新界面。
- 第 5–6 节依赖会话/工作区的项：**不适用**（本工作台不创建会话、不写会话草稿、不建工作区）。
- 同一工作区里原生会话与多个工作台会话的归属核对（第 8 节「宿主负责」项）：未执行。
- 真实卸载后重装的数据保留往返：未执行（数据文件位置与代码已核对，卸载不会删除）。

## 数据说明

自测期间我用真实接口写入过 5 个示例项目（并顺手验证了新建项目），**结束后已清空**，
当前 `state.json` 为 `{"version":1,"projects":[]}`（revision 7）。你打开工作台看到的是空状态，
点「新建项目」登记你自己的项目即可。

## 复现命令

```bash
cd <repo>
pnpm verify                                   # build + 59 个测试 + 包格式校验
pnpm pack                                     # 产出 tarball
node scripts/check-workbench-package.mjs --tarball dsh-workbench-project-console-1.0.0.tgz

# 服务端接口探活（需要 Harness 的认证 cookie）
curl -s -b <harness cookie> http://127.0.0.1:43129/api/project-console/meta
```
