/**
 * 把项目数据变成可交给 Agent 的提示词，以及常用文档草稿。
 * 面板只负责生成文本、复制与导出；发送由用户在旁边的原生会话里完成。
 */
import { clampProgress, formatRemaining, latestUpdate, openTodos, overview, projectRisk, sortByRisk } from './analysis.js'
const KIND_LABELS = { note: '记录', progress: '进展', blocker: '阻塞', decision: '决策' }

function bullets(items, empty = '（暂无）') {
  if (!items || items.length === 0) return empty
  return items.map((item) => `- ${item}`).join('\n')
}

/** 单个项目的 Markdown 摘要，提示词和文档草稿共用。 */
export function projectBrief(project, today) {
  const risk = projectRisk(project, today)
  const updates = (Array.isArray(project?.updates) ? project.updates : [])
    .slice()
    .sort((a, b) => String(b?.at ?? '').localeCompare(String(a?.at ?? '')))
  const todos = openTodos(project)
  const doneTodos = (Array.isArray(project?.todos) ? project.todos : []).filter((todo) => todo?.done === true)
  return [
    `### ${project?.name ?? '未命名项目'}`,
    `- 模块：${project?.module || '其他项目'}`,
    `- 状态：${project?.status || '进行中'}`,
    `- 进度：${clampProgress(project)}%`,
    `- 负责人：${project?.owner || '未指定'}`,
    `- 起止：${project?.startedOn || '未填'} → ${project?.dueDate || '未排期'}（${formatRemaining(project?.dueDate, today)}）`,
    `- 时间风险：${risk.label} — ${risk.detail}`,
    project?.link ? `- 链接：${project.link}` : '',
    project?.summary ? `- 一句话说明：${project.summary}` : '',
    project?.tags?.length ? `- 标签：${project.tags.join('、')}` : '',
    '',
    `**进展记录（新→旧，共 ${updates.length} 条）**`,
    bullets(updates.slice(0, 20).map((item) => `${String(item.at).slice(0, 10)} [${KIND_LABELS[item.kind] ?? '记录'}] ${item.text}`)),
    '',
    `**未完成待跟进（${todos.length} 项）**`,
    bullets(todos.map((todo) => `${todo.title}${todo.dueDate ? `（截止 ${todo.dueDate}）` : ''}${todo.owner ? ` — ${todo.owner}` : ''}`)),
    '',
    `**已完成待跟进（${doneTodos.length} 项）**`,
    bullets(doneTodos.slice(0, 10).map((todo) => todo.title))
  ].filter((row) => row !== '').join('\n')
}

/** 全部项目按风险排序的 Markdown 摘要。 */
export function portfolioBrief(projects, today) {
  const sorted = sortByRisk(projects, today)
  if (sorted.length === 0) return '（工作台里还没有项目）'
  return sorted.map((item) => projectBrief(item.project, today)).join('\n\n')
}

function portfolioNumbers(projects, today) {
  const data = overview(projects, today)
  const modules = data.modules.filter((item) => item.total > 0)
    .map((item) => `- ${item.module}：${item.total} 个（进行中 ${item.active}、危险 ${item.danger}、待跟进 ${item.openTodos}）`)
  return [
    `- 项目总数：${data.total}`,
    `- 状态分布：${Object.entries(data.byStatus).map(([key, value]) => `${key} ${value}`).join('、') || '无'}`,
    `- 风险分布：${Object.entries(data.byRisk).map(([key, value]) => `${key} ${value}`).join('、') || '无'}`,
    '- 按模块：',
    bullets(modules)
  ].join('\n')
}

/**
 * 「让 Agent 分析进展」的提示词。
 * @param options - projects（全部项目）、project（可选，聚焦一个项目）、today。
 */
export function buildAnalysisPrompt({ projects = [], project = null, today }) {
  const scope = project ? '下面这一个项目' : '下面这些项目'
  const body = project ? projectBrief(project, today) : portfolioBrief(projects, today)
  return [
    `你是我的项目推进助理。今天是 ${today}。`,
    `请基于${scope}的登记数据做一次进展分析，不要编造数据里没有的事实；信息不足时明确说「数据不足」。`,
    '',
    '请按这个结构输出：',
    '1. 当前状态判断：哪些在正轨、哪些已经偏了，用一两句话给结论。',
    '2. 时间风险：逐个说明剩余时间与进度的匹配情况，标出最可能来不及的项目和判断依据。',
    '3. 阻塞与依赖：从进展记录里找出被人或外部条件卡住的点。',
    '4. 下一步动作：给我 3-5 条具体、可执行的动作，每条写明针对哪个项目、建议完成时间。',
    '5. 需要我补充的信息：列出你判断时需要但我没登记的内容。',
    '',
    '---',
    '',
    body
  ].join('\n')
}

const DOC_KINDS = {
  weekly: '周报',
  status: '项目状态汇报',
  risk: '风险清单',
  meeting: '会议纪要骨架'
}

export function docKinds() {
  return Object.entries(DOC_KINDS).map(([value, label]) => ({ value, label }))
}

/**
 * 生成一份文档草稿（Markdown）。
 * @param kind - weekly | status | risk | meeting。
 * @param options - projects、project（可选）、today。
 */
export function buildDocDraft(kind, { projects = [], project = null, today }) {
  const only = project ? [project] : projects
  const label = DOC_KINDS[kind] ?? DOC_KINDS.status
  const title = project ? project.name : '全部项目'

  if (kind === 'risk') {
    const rows = sortByRisk(only, today).map((item) => {
      const risk = item.risk
      const todo = openTodos(item.project)
      return `| ${item.project.name} | ${item.project.module || '其他项目'} | ${item.project.status || '进行中'} | ${clampProgress(item.project)}% | ${item.project.dueDate || '未排期'} | ${risk.label} — ${risk.detail} | ${todo.length} |`
    })
    return [
      `# 风险清单 · ${title}`,
      '',
      `生成时间：${today}`,
      '',
      '| 项目 | 模块 | 状态 | 进度 | 截止 | 风险 | 待跟进 |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      rows.length > 0 ? rows.join('\n') : '| （暂无项目） |  |  |  |  |  |  |',
      '',
      '## 处理建议',
      bullets(sortByRisk(only, today).filter((item) => item.risk.rank <= 4)
        .map((item) => `${item.project.name}：${item.risk.detail}，建议先确认责任人并给出新的交付时间。`), '（当前没有需要升级处理的风险）')
    ].join('\n')
  }

  if (kind === 'weekly') {
    return [
      `# 周报 · 项目推进（${today}）`,
      '',
      '## 一、整体情况',
      portfolioNumbers(only, today),
      '',
      '## 二、本周进展',
      portfolioBrief(only, today),
      '',
      '## 三、下周计划',
      bullets(only.flatMap((item) => openTodos(item).slice(0, 3).map((todo) =>
        `${item.name}：${todo.title}${todo.dueDate ? `（${todo.dueDate} 前）` : ''}`)), '（待跟进清单为空，请补充下周计划）'),
      '',
      '## 四、需要协调',
      bullets(sortByRisk(only, today).filter((item) => ['overdue', 'blocked', 'urgent', 'slipping'].includes(item.risk.level))
        .map((item) => `${item.project.name}：${item.risk.detail}`), '（暂无）')
    ].join('\n')
  }

  if (kind === 'meeting') {
    return [
      `# 会议纪要 · ${title}（${today}）`,
      '',
      '参加会议：',
      '',
      '## 一、项目现状',
      portfolioBrief(only, today),
      '',
      '## 二、讨论与结论',
      '- （待补充）',
      '',
      '## 三、行动项',
      '| 事项 | 负责人 | 截止 | 状态 |',
      '| --- | --- | --- | --- |',
      bullets(only.flatMap((item) => openTodos(item).map((todo) =>
        `| ${item.name}：${todo.title} | ${todo.owner || '待定'} | ${todo.dueDate || '待定'} | 未开始 |`)), '| （待补充） |  |  |  |')
    ].join('\n')
  }

  const rows = sortByRisk(only, today).map((item) => {
    const latest = latestUpdate(item.project)
    return [
      `### ${item.project.name}`,
      `- 模块／状态：${item.project.module || '其他项目'}／${item.project.status || '进行中'}`,
      `- 进度：${clampProgress(item.project)}%，${formatRemaining(item.project.dueDate, today)}`,
      `- 时间风险：${item.risk.label} — ${item.risk.detail}`,
      `- 最近进展：${latest ? `${String(latest.at).slice(0, 10)} ${latest.text}` : '无记录'}`,
      `- 下一步：${openTodos(item.project).map((todo) => todo.title).slice(0, 3).join('；') || '待补充'}`
    ].join('\n')
  })
  return [
    `# 项目状态汇报 · ${title}（${today}）`,
    '',
    '## 概要',
    portfolioNumbers(only, today),
    '',
    '## 项目明细',
    rows.length > 0 ? rows.join('\n\n') : '（暂无项目）'
  ].join('\n')
}

/** 面板上的「交付给谁」提示语，作者文档与界面共用。 */
export function deliveryHint(kind) {
  return `已生成「${DOC_KINDS[kind] ?? '文档'}」草稿：可以直接复制到旁边的会话里让 Agent 补全，也可以下载成 Markdown。`
}
