/**
 * 看板数据层：把项目数据整理成各种"维度"的看板模型。
 * 纯函数、无 DOM，服务端与客户端测试都能直接调用。
 *
 * 维度：风险分布 / 状态列（看板）/ 模块负载 / 进度分布 / 负责人负载 /
 *       日历（按天）/ 时间线（按区间）/ 待跟进（按到期紧迫度）。
 */
import { DANGER_LEVELS, WATCH_LEVELS, RISK_META, STATUSES, clampProgress, dayStart, daysLeft, endOfWeek, moduleNames, openTodos, projectRisk, sortByRisk, todayISO } from './analysis.js'
import { summarize } from './views.js'
export const MODULE_ACCENTS = ['indigo', 'teal', 'amber', 'violet', 'rose', 'cyan']

const STATUS_TONE = { 进行中: 'info', 待启动: 'muted', 阻塞: 'danger', 暂停: 'warn', 已完成: 'ok' }

/** 每个模块一个固定强调色（顺序稳定，刷新不会变色）。 */
export function moduleAccentMap(projects) {
  const map = {}
  moduleNames(projects).forEach((name, index) => {
    map[name] = MODULE_ACCENTS[index % MODULE_ACCENTS.length]
  })
  return map
}

export function statusTone(status) {
  return STATUS_TONE[status] ?? 'muted'
}

/** 顶部 KPI 需要的全部数字，一次算完。 */
export function kpis(projects, today = todayISO()) {
  const stats = summarize(projects, today)
  const risks = projects.map((project) => projectRisk(project, today))
  const count = (level) => risks.filter((risk) => risk.level === level).length
  const open = projects.reduce((sum, project) => sum + openTodos(project).length, 0)
  const todoOverdue = projects.reduce((sum, project) => sum
    + openTodos(project).filter((todo) => (daysLeft(todo.dueDate, today) ?? 1) < 0).length, 0)
  const weekDue = projects.filter((project) => {
    const left = daysLeft(project.dueDate, today)
    return left !== null && left >= 0 && project.dueDate <= endOfWeek(today)
  }).length
  return {
    total: stats.total,
    active: stats.active,
    done: stats.done,
    avgProgress: stats.avgProgress,
    openTodos: open,
    todoOverdue,
    weekDue,
    attention: stats.danger + stats.watch,
    danger: stats.danger,
    watch: stats.watch,
    overdue: count('overdue'),
    blocked: count('blocked'),
    urgent: count('urgent'),
    slipping: count('slipping'),
    soon: count('soon'),
    normal: count('normal'),
    unscheduled: count('unscheduled')
  }
}

/** 风险分布（饼/环形图用），按风险从高到低，只保留有数量的等级。 */
export function riskBreakdown(projects, today = todayISO()) {
  const total = projects.length
  const counts = new Map()
  for (const project of projects) {
    const risk = projectRisk(project, today)
    counts.set(risk.level, (counts.get(risk.level) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([level, count]) => ({
      level, count,
      label: RISK_META[level].label,
      tone: RISK_META[level].tone,
      rank: RISK_META[level].rank,
      percent: total === 0 ? 0 : Math.round((count / total) * 100)
    }))
    .sort((a, b) => a.rank - b.rank)
}

/** 状态列（看板视图），列顺序固定，列内按风险排序。 */
export function statusColumns(projects, today = todayISO()) {
  const extra = [...new Set(projects.map((project) => project?.status || '进行中'))]
    .filter((status) => !STATUSES.includes(status))
  return [...STATUSES, ...extra].map((status) => {
    const items = sortByRisk(projects.filter((project) => (project?.status || '进行中') === status), today)
    return {
      status,
      tone: statusTone(status),
      projects: items.map((item) => ({ project: item.project, risk: item.risk })),
      stats: summarize(projects.filter((project) => (project?.status || '进行中') === status), today)
    }
  })
}

/** 模块负载：每个模块的项目数、危险/关注/正常构成与平均进度。 */
export function moduleWorkload(projects, today = todayISO()) {
  const accents = moduleAccentMap(projects)
  return moduleNames(projects)
    .map((module) => {
      const items = projects.filter((project) => (project?.module || '其他项目') === module)
      const risks = items.map((project) => projectRisk(project, today))
      return {
        module,
        accent: accents[module],
        total: items.length,
        danger: risks.filter((risk) => DANGER_LEVELS.includes(risk.level)).length,
        watch: risks.filter((risk) => WATCH_LEVELS.includes(risk.level)).length,
        normal: risks.filter((risk) => !DANGER_LEVELS.includes(risk.level) && !WATCH_LEVELS.includes(risk.level)).length,
        avgProgress: summarize(items, today).avgProgress,
        openTodos: items.reduce((sum, project) => sum + openTodos(project).length, 0)
      }
    })
    .filter((entry) => entry.total > 0)
}

/** 进度分布直方图。 */
export function progressBuckets(projects) {
  const buckets = [
    { label: '0%', test: (value) => value === 0 },
    { label: '1-25%', test: (value) => value > 0 && value <= 25 },
    { label: '26-50%', test: (value) => value > 25 && value <= 50 },
    { label: '51-75%', test: (value) => value > 50 && value <= 75 },
    { label: '76-99%', test: (value) => value > 75 && value < 100 },
    { label: '100%', test: (value) => value >= 100 }
  ]
  const values = projects.map((project) => clampProgress(project))
  return buckets.map((bucket) => ({ label: bucket.label, count: values.filter(bucket.test).length }))
}

/** 负责人负载。 */
export function ownerWorkload(projects, today = todayISO()) {
  const owners = new Map()
  for (const project of projects) {
    const owner = project?.owner?.trim() || '未指定'
    if (!owners.has(owner)) owners.set(owner, [])
    owners.get(owner).push(project)
  }
  return [...owners.entries()]
    .map(([owner, items]) => {
      const risks = items.map((project) => projectRisk(project, today))
      return {
        owner,
        total: items.length,
        danger: risks.filter((risk) => DANGER_LEVELS.includes(risk.level)).length,
        openTodos: items.reduce((sum, project) => sum + openTodos(project).length, 0),
        avgProgress: summarize(items, today).avgProgress,
        projects: items
      }
    })
    .sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner, 'zh-Hans-CN'))
}

/* ------------------------------------------------------------------ 日历 */

const pad = (value) => String(value).padStart(2, '0')

export const monthKeyOf = (today = todayISO()) => String(today).slice(0, 7)

/** 月份加减，返回 YYYY-MM。 */
export function shiftMonth(key, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key))
  if (!match) return monthKeyOf()
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

export function monthLabel(key) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key))
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : String(key)
}

/**
 * 一个月的日历模型：6 周网格，每格列出当天到期的项目与待跟进事项。
 */
export function calendarMonth(projects, today = todayISO(), key = monthKeyOf(today)) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key))
  const year = match ? Number(match[1]) : Number(today.slice(0, 4))
  const month = match ? Number(match[2]) : Number(today.slice(5, 7))
  const first = new Date(year, month - 1, 1)
  const lead = first.getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const total = Math.ceil((lead + daysInMonth) / 7) * 7

  const cells = []
  let monthItems = 0
  for (let index = 0; index < total; index += 1) {
    const date = new Date(year, month - 1, index - lead + 1)
    const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    const items = []
    for (const project of projects) {
      if (project?.dueDate === iso) {
        const risk = projectRisk(project, today)
        items.push({
          key: `${project.id}::due`,
          kind: 'due',
          tone: risk.tone,
          label: risk.label,
          title: project.name,
          projectId: project.id,
          module: project.module || '其他项目'
        })
      }
      for (const todo of openTodos(project)) {
        if (todo.dueDate !== iso) continue
        const overdue = (daysLeft(iso, today) ?? 1) < 0
        items.push({
          key: `${project.id}::${todo.id}`,
          kind: 'todo',
          todoId: todo.id,
          tone: overdue ? 'danger' : 'muted',
          label: '待跟进',
          title: todo.title,
          projectId: project.id,
          projectName: project.name,
          module: project.module || '其他项目'
        })
      }
    }
    items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'due' ? -1 : 1))
    if (index - lead + 1 >= 1 && index - lead + 1 <= daysInMonth) monthItems += items.length
    cells.push({
      iso,
      day: date.getDate(),
      inMonth: index - lead + 1 >= 1 && index - lead + 1 <= daysInMonth,
      isToday: iso === today,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      items
    })
  }

  const weeks = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7))
  const daysWithItems = cells.filter((cell) => cell.inMonth && cell.items.length > 0).length
  return { key, label: monthLabel(key), weeks, cells, monthItems, daysWithItems }
}

/* -------------------------------------------------------------- 时间线 */

/**
 * 时间线（甘特）模型：横轴是日期，每行一个项目。
 * 跨度按项目起止自动取，补齐到周，最长不超过 210 天。
 */
export function timelineModel(projects, today = todayISO()) {
  const rows = []
  if (projects.length === 0) return { from: today, to: today, totalDays: 0, ticks: [], rows, padded: false }

  const now = dayStart(today)
  const points = [now]
  for (const project of projects) {
    const start = dayStart(project?.startedOn) ?? now
    const due = dayStart(project?.dueDate) ?? now
    points.push(start, due)
  }
  const rawFrom = Math.min(...points)
  const rawTo = Math.max(...points)
  const DAY = 24 * 60 * 60 * 1000
  // 补齐到周一/周日，并给最小跨度，避免只有一两天时格子挤在一起
  const fromDate = new Date(Math.min(rawFrom, now - 3 * DAY))
  fromDate.setDate(fromDate.getDate() - fromDate.getDay())
  const toDate = new Date(Math.max(rawTo, now + 3 * DAY))
  toDate.setDate(toDate.getDate() + (6 - toDate.getDay()))
  let span = Math.round((toDate - fromDate) / DAY) + 1
  let padded = false
  if (span > 210) {
    padded = true
    const end = new Date(fromDate.getTime() + 209 * DAY)
    toDate.setTime(end.getTime())
    span = 210
  }
  const totalDays = span
  const offsetOf = (millis) => Math.max(0, Math.min(totalDays, (millis - fromDate.getTime()) / DAY))
  const percent = (value) => (totalDays === 0 ? 0 : (value / totalDays) * 100)
  const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

  const ticks = []
  for (let index = 0; index < totalDays; index += 7) {
    const date = new Date(fromDate.getTime() + index * DAY)
    ticks.push({ index, percent: percent(index), label: `${date.getMonth() + 1}/${date.getDate()}` })
  }

  for (const project of [...projects].sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))) {
    const startMillis = dayStart(project?.startedOn) ?? now
    const dueMillis = dayStart(project?.dueDate) ?? now
    const left = offsetOf(Math.min(startMillis, dueMillis))
    const right = offsetOf(Math.max(startMillis, dueMillis)) + 1
    rows.push({
      project,
      risk: projectRisk(project, today),
      startIso: isoOf(new Date(Math.min(startMillis, dueMillis))),
      endIso: isoOf(new Date(Math.max(startMillis, dueMillis))),
      leftPercent: percent(left),
      widthPercent: percent(Math.max(1, right - left))
    })
  }
  return {
    from: isoOf(fromDate),
    to: isoOf(toDate),
    totalDays,
    ticks,
    rows,
    todayPercent: percent(offsetOf(now)),
    padded
  }
}

/* ------------------------------------------------------------ 待跟进 */

const BUCKETS = [
  { key: 'overdue', label: '已逾期', tone: 'danger' },
  { key: 'today', label: '今天到期', tone: 'warn' },
  { key: 'week', label: '本周内', tone: 'warn' },
  { key: 'later', label: '更晚', tone: 'muted' },
  { key: 'none', label: '未排期', tone: 'muted' }
]

/** 待跟进按到期紧迫度分桶。 */
export function followUpBuckets(projects, today = todayISO()) {
  const weekEnd = endOfWeek(today)
  const buckets = BUCKETS.map((bucket) => ({ ...bucket, items: [] }))
  const byKey = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket]))
  for (const project of projects) {
    for (const todo of openTodos(project)) {
      const left = daysLeft(todo.dueDate, today)
      const key = left === null ? 'none' : left < 0 ? 'overdue' : left === 0 ? 'today' : todo.dueDate <= weekEnd ? 'week' : 'later'
      byKey[key].items.push({
        key: `${project.id}::${todo.id}`,
        todoId: todo.id,
        projectId: project.id,
        projectName: project.name,
        module: project.module || '其他项目',
        title: todo.title,
        owner: todo.owner || project.owner || '',
        dueDate: todo.dueDate,
        overdueDays: left === null || left >= 0 ? 0 : Math.abs(left)
      })
    }
  }
  for (const bucket of buckets) {
    bucket.items.sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))
    bucket.total = bucket.items.length
  }
  return buckets
}

/** 概览页顶部的一句话结论。 */
export function headline(projects, today = todayISO()) {
  const data = kpis(projects, today)
  if (data.total === 0) return '还没有项目，先登记几个再来看板。'
  if (data.overdue > 0) {
    return `${data.total} 个项目里 ${data.overdue} 个已逾期、${data.danger} 个需要马上处理，先看「需关注」这一列。`
  }
  if (data.attention > 0) return `${data.total} 个项目整体在跑，${data.attention} 个需要盯一下，本周到期 ${data.weekDue} 个。`
  return `${data.total} 个项目节奏正常，平均进度 ${data.avgProgress}%，没有逾期项。`
}
