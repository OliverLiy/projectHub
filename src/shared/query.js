/**
 * 「问一句」：在本地已存的项目数据上做规则化问答。
 * 不依赖会话或模型，打开工作台即可用；需要更深的分析时由面板生成提示词交给 Agent。
 */
import { DANGER_LEVELS, WATCH_LEVELS, clampProgress, daysLeft, endOfWeek, formatRemaining, latestUpdate, openTodos, overview, projectRisk, sortByRisk, todayISO } from './analysis.js'
const RISKY = [...DANGER_LEVELS, ...WATCH_LEVELS]

const line = (project, risk) => `· ${project.name}（${project.module || '其他项目'}｜${project.status || '进行中'}｜${formatRemaining(project.dueDate, risk.today)}）${risk.detail ? ` — ${risk.detail}` : ''}`

function projectLine(project, today) {
  const risk = projectRisk(project, today)
  return { text: line(project, { ...risk, today }), id: project.id }
}

function header(title, count) {
  return count === 0 ? `${title}：没有符合条件的项目。` : `${title}（${count} 个）`
}

function answerRisky(projects, today) {
  const risky = sortByRisk(projects, today).filter((item) => RISKY.includes(item.risk.level))
  if (risky.length === 0) return { text: '当前没有需要重点关注的项目，所有项目的 DDL 和进度都正常。', projectIds: [] }
  const body = risky.map((item) => line(item.project, { ...item.risk, today })).join('\n')
  return {
    text: `${header('需要关注的项目', risky.length)}\n${body}`,
    projectIds: risky.map((item) => item.project.id)
  }
}

function answerDueWithin(projects, today, label, predicate) {
  const hits = sortByRisk(projects, today).filter((item) => predicate(item.project, today))
  if (hits.length === 0) return { text: `${label}：没有到期的项目。`, projectIds: [] }
  return {
    text: `${header(label, hits.length)}\n${hits.map((item) => line(item.project, { ...item.risk, today })).join('\n')}`,
    projectIds: hits.map((item) => item.project.id)
  }
}

function answerFollowUps(projects, today, filter) {
  const items = []
  for (const project of projects) {
    for (const todo of openTodos(project)) {
      if (filter && !filter(todo, today)) continue
      items.push({ project, todo })
    }
  }
  if (items.length === 0) return { text: '待跟进清单是空的。', projectIds: [] }
  items.sort((a, b) => String(a.todo.dueDate || '9999').localeCompare(String(b.todo.dueDate || '9999')))
  const body = items.slice(0, 30).map(({ project, todo }) =>
    `· [${todo.done ? 'x' : ' '}] ${todo.title}｜${project.name}${todo.dueDate ? `｜截止 ${todo.dueDate}` : ''}${todo.owner ? `｜${todo.owner}` : ''}`).join('\n')
  return {
    text: `${header('待跟进事项', items.length)}\n${body}`,
    projectIds: [...new Set(items.map(({ project }) => project.id))]
  }
}

function answerProject(project, today) {
  const risk = projectRisk(project, today)
  const latest = latestUpdate(project)
  const todos = openTodos(project)
  const lines = [
    `${project.name}（${project.module || '其他项目'}）`,
    `状态：${project.status || '进行中'}｜进度：${clampProgress(project)}%｜${formatRemaining(project.dueDate, today)}`,
    `风险：${risk.label} — ${risk.detail}`,
    project.owner ? `负责人：${project.owner}` : '',
    project.summary ? `说明：${project.summary}` : '',
    latest ? `最近进展（${String(latest.at).slice(0, 10)}）：${latest.text}` : '还没有进展记录',
    todos.length > 0 ? `待跟进 ${todos.length} 项：${todos.slice(0, 5).map((todo) => todo.title).join('、')}` : '没有未完成的待跟进事项'
  ]
  return { text: lines.filter(Boolean).join('\n'), projectIds: [project.id] }
}

function answerOverview(projects, today) {
  const data = overview(projects, today)
  if (data.total === 0) return { text: '工作台里还没有项目。点右上角「新建项目」开始登记。', projectIds: [] }
  const moduleLines = data.modules.filter((item) => item.total > 0)
    .map((item) => `· ${item.module}：${item.total} 个｜进行中 ${item.active}｜危险 ${item.danger}｜待跟进 ${item.openTodos}`).join('\n')
  const danger = data.attention.filter((item) => RISKY.includes(item.risk.level)).slice(0, 5)
  return {
    text: [
      `共 ${data.total} 个项目：${Object.entries(data.byStatus).map(([key, value]) => `${key} ${value}`).join('、')}`,
      moduleLines ? `\n按模块：\n${moduleLines}` : '',
      `\n需关注 ${data.attention.filter((item) => RISKY.includes(item.risk.level)).length} 个，逾期 ${data.byRisk.overdue ?? 0} 个。`,
      danger.length > 0 ? `\n最优先：\n${danger.map((item) => line(item.project, { ...item.risk, today })).join('\n')}` : ''
    ].filter(Boolean).join('\n'),
    projectIds: danger.map((item) => item.project.id)
  }
}

/** 回答一句自然语言提问，返回文本与相关项目 id。 */
export function answerQuestion(question, projects, today = todayISO()) {
  const raw = String(question ?? '').trim()
  const items = Array.isArray(projects) ? projects : []
  if (!raw) return { text: '问一句比如：哪些项目这周到期？有什么风险？我的待跟进还有哪些？', projectIds: [] }
  if (items.length === 0) return { text: '工作台里还没有项目，先登记几个项目我再帮你盯。', projectIds: [] }

  const named = items.find((project) => project?.name && raw.includes(project.name))
  if (named) return answerProject(named, today)

  if (/风险|危险|要炸|出问题|异常|告急|延期/.test(raw)) return answerRisky(items, today)
  // 待跟进要排在「逾期」之前：像「逾期的待跟进」这种问法问的是事项，不是项目。
  if (/待跟进|待办|跟进|要做|还没做|行动项/.test(raw)) {
    if (/逾期|超期/.test(raw)) return answerFollowUps(items, today, (todo, now) => (daysLeft(todo.dueDate, now) ?? 1) < 0)
    return answerFollowUps(items, today)
  }
  if (/逾期|超期|过期|误期/.test(raw)) return answerDueWithin(items, today, '已逾期的项目', (project, now) => (daysLeft(project.dueDate, now) ?? 1) < 0)
  if (/今天|今日/.test(raw)) return answerDueWithin(items, today, '今天到期的项目', (project, now) => daysLeft(project.dueDate, now) === 0)
  if (/明天/.test(raw)) return answerDueWithin(items, today, '明天到期的项目', (project, now) => daysLeft(project.dueDate, now) === 1)
  if (/本周|这周|周内|周末前/.test(raw)) {
    const end = endOfWeek(today)
    return answerDueWithin(items, today, `本周（到 ${end}）到期的项目`, (project, now) => {
      const left = daysLeft(project.dueDate, now)
      return left !== null && left >= 0 && project.dueDate <= end
    })
  }
  if (/本月|这个月|当月/.test(raw)) {
    const month = today.slice(0, 7)
    return answerDueWithin(items, today, `${month} 内到期的项目`, (project) => String(project.dueDate || '').startsWith(month))
  }
  if (/阻塞/.test(raw)) {
    const blocked = items.filter((project) => project?.status === '阻塞')
    if (blocked.length === 0) return { text: '没有处于阻塞状态的项目。', projectIds: [] }
    return { text: `${header('阻塞的项目', blocked.length)}\n${blocked.map((project) => projectLine(project, today).text).join('\n')}`, projectIds: blocked.map((project) => project.id) }
  }
  if (/概览|总览|整体|情况|怎么样|如何|汇报|状态/.test(raw)) return answerOverview(items, today)

  const risk = answerRisky(items, today)
  return {
    text: `没看懂「${raw}」，先给你当前最需要关注的项目。也可以直接说项目名，或问：本周到期、逾期、待跟进、阻塞、概览。\n${risk.text}`,
    projectIds: risk.projectIds
  }
}

/** 供面板显示的问句示例。 */
export const QUESTION_EXAMPLES = ['哪些项目这周到期？', '有什么风险？', '我的待跟进还有哪些？', '整体情况怎么样？']
