/**
 * 项目组合分析：纯函数，无 DOM、无 React，服务端测试与客户端面板共用一份。
 * 时间一律用本地日历日（YYYY-MM-DD）比较，避免时区把「还剩几天」算错。
 */

export const MODULES = ['公司项目', '日常工作', '其他项目']
export const STATUSES = ['进行中', '待启动', '阻塞', '已完成', '暂停']
export const RISK_LEVELS = ['overdue', 'blocked', 'urgent', 'slipping', 'soon', 'unscheduled', 'normal', 'done']

export const RISK_META = {
  overdue: { label: '已逾期', tone: 'danger', rank: 0 },
  blocked: { label: '阻塞', tone: 'danger', rank: 1 },
  urgent: { label: '紧急', tone: 'danger', rank: 2 },
  slipping: { label: '进度风险', tone: 'warn', rank: 3 },
  soon: { label: '临近', tone: 'warn', rank: 4 },
  unscheduled: { label: '未排期', tone: 'muted', rank: 5 },
  normal: { label: '正常', tone: 'ok', rank: 6 },
  done: { label: '已完成', tone: 'muted', rank: 7 }
}

export const RISK_ORDER = RISK_LEVELS
export const DANGER_LEVELS = ['overdue', 'blocked', 'urgent']
export const WATCH_LEVELS = ['slipping', 'soon']

const DAY_MS = 24 * 60 * 60 * 1000

/** 本地日历日的 ISO 文本。 */
export function todayISO(now) {
  const date = now instanceof Date ? now : new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 把 YYYY-MM-DD 解析为本地零点的毫秒数；无法解析时返回 null。 */
export function dayStart(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

/** a 到 b 的整日差（b 晚于 a 为正）。 */
export function daysBetween(a, b) {
  const from = dayStart(a)
  const to = dayStart(b)
  if (from === null || to === null) return null
  return Math.round((to - from) / DAY_MS)
}

/** 剩余天数：负数表示已逾期。 */
export function daysLeft(dueDate, today = todayISO()) {
  const left = daysBetween(today, dueDate)
  return left
}

export function formatRemaining(dueDate, today = todayISO()) {
  const left = daysLeft(dueDate, today)
  if (left === null) return '未排期'
  if (left < 0) return `已逾期 ${Math.abs(left)} 天`
  if (left === 0) return '今天到期'
  if (left === 1) return '明天到期'
  return `还剩 ${left} 天`
}

/** 本周最后一天（周日）。 */
export function endOfWeek(today = todayISO()) {
  const start = dayStart(today)
  if (start === null) return today
  const date = new Date(start)
  const weekday = date.getDay()
  date.setDate(date.getDate() + (weekday === 0 ? 0 : 7 - weekday))
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function openTodos(project) {
  return (Array.isArray(project?.todos) ? project.todos : []).filter((todo) => todo && todo.done !== true)
}

export function latestUpdate(project) {
  const updates = Array.isArray(project?.updates) ? project.updates : []
  if (updates.length === 0) return null
  return updates.reduce((latest, item) => {
    if (!latest) return item
    return String(item?.at ?? '') > String(latest?.at ?? '') ? item : latest
  }, null)
}

/**
 * 单个项目的时间风险。
 * 顺序：已完成 → 已逾期 → 阻塞 → 未排期 → 紧急(≤3 天) → 进度落后 → 临近(≤7 天) → 正常。
 */
export function projectRisk(project, today = todayISO()) {
  const status = String(project?.status ?? '')
  if (status === '已完成') {
    return { level: 'done', ...RISK_META.done, detail: '已交付', remainingDays: daysLeft(project?.dueDate, today) }
  }
  if (status === '阻塞') {
    return { level: 'blocked', ...RISK_META.blocked, detail: '处于阻塞状态，需要推动', remainingDays: daysLeft(project?.dueDate, today) }
  }
  const left = daysLeft(project?.dueDate, today)
  if (left === null) {
    return { level: 'unscheduled', ...RISK_META.unscheduled, detail: '未设置截止日期', remainingDays: null }
  }
  if (left < 0) {
    return { level: 'overdue', ...RISK_META.overdue, detail: `已超过截止日期 ${Math.abs(left)} 天`, remainingDays: left }
  }
  if (left <= 3) {
    return { level: 'urgent', ...RISK_META.urgent, detail: left === 0 ? '今天到期' : `只剩 ${left} 天`, remainingDays: left }
  }
  const slip = slippage(project, today)
  if (slip !== null && slip >= 0.3) {
    const percent = Math.round(slip * 100)
    return { level: 'slipping', ...RISK_META.slipping, detail: `时间已过 ${percent}% 但进度只有 ${clampProgress(project)}%`, remainingDays: left }
  }
  if (left <= 7) {
    return { level: 'soon', ...RISK_META.soon, detail: `还剩 ${left} 天`, remainingDays: left }
  }
  return { level: 'normal', ...RISK_META.normal, detail: `还剩 ${left} 天，节奏正常`, remainingDays: left }
}

export function clampProgress(project) {
  const value = Number(project?.progress)
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** 时间进度减实际进度；缺少开始日期或周期为零时返回 null。 */
export function slippage(project, today = todayISO()) {
  const start = dayStart(project?.startedOn)
  const due = dayStart(project?.dueDate)
  const now = dayStart(today)
  if (start === null || due === null || now === null || due <= start) return null
  const elapsed = Math.min(1, Math.max(0, (now - start) / (due - start)))
  return elapsed - clampProgress(project) / 100
}

/** 把项目按风险排序：危险在前，同级按剩余天数（少的在前），再按名称。 */
export function sortByRisk(projects, today = todayISO()) {
  return [...projects].map((project) => ({ project, risk: projectRisk(project, today) }))
    .sort((a, b) => {
      if (a.risk.rank !== b.risk.rank) return a.risk.rank - b.risk.rank
      const leftA = a.risk.remainingDays
      const leftB = b.risk.remainingDays
      if (leftA !== null && leftB !== null && leftA !== leftB) return leftA - leftB
      if (leftA === null && leftB !== null) return 1
      if (leftA !== null && leftB === null) return -1
      return String(a.project.name).localeCompare(String(b.project.name), 'zh-Hans-CN')
    })
}

/** 一个模块的小结。 */
export function moduleRollup(projects, module, today = todayISO()) {
  const items = module === '全部' ? projects : projects.filter((project) => (project?.module || '其他项目') === module)
  const risks = items.map((project) => projectRisk(project, today))
  return {
    module,
    total: items.length,
    active: items.filter((project) => project?.status === '进行中').length,
    done: items.filter((project) => project?.status === '已完成').length,
    danger: risks.filter((risk) => DANGER_LEVELS.includes(risk.level)).length,
    watch: risks.filter((risk) => WATCH_LEVELS.includes(risk.level)).length,
    openTodos: items.reduce((sum, project) => sum + openTodos(project).length, 0)
  }
}

/** 模块清单：固定三个模块在前，自定义模块按出现顺序补在后面。 */
export function moduleNames(projects) {
  const extra = []
  for (const project of projects) {
    const module = project?.module || '其他项目'
    if (!MODULES.includes(module) && !extra.includes(module)) extra.push(module)
  }
  return [...MODULES, ...extra]
}

/** 整个工作台的概览：总数、状态分布、风险分布、模块小结、待跟进清单。 */
export function overview(projects, today = todayISO()) {
  const items = Array.isArray(projects) ? projects : []
  const sorted = sortByRisk(items, today)
  const risks = sorted.map((item) => item.risk)
  const byStatus = {}
  for (const project of items) {
    const status = project?.status || '进行中'
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }
  const byRisk = {}
  for (const risk of risks) byRisk[risk.level] = (byRisk[risk.level] ?? 0) + 1
  const followUps = []
  for (const project of sorted) {
    for (const todo of openTodos(project.project)) {
      followUps.push({ projectId: project.project.id, projectName: project.project.name, module: project.project.module, ...todo })
    }
  }
  followUps.sort((a, b) => {
    const left = dayStart(a.dueDate)
    const right = dayStart(b.dueDate)
    if (left === null && right === null) return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN')
    if (left === null) return 1
    if (right === null) return -1
    return left - right
  })
  return {
    today,
    total: items.length,
    byStatus,
    byRisk,
    attention: sorted.map((item) => ({ project: item.project, risk: item.risk })),
    modules: moduleNames(items).map((module) => moduleRollup(items, module, today)),
    followUps,
    dueSoon: sorted.filter((item) => ['overdue', 'urgent', 'soon'].includes(item.risk.level))
      .map((item) => ({ project: item.project, risk: item.risk }))
  }
}

/** 按 id 找项目。 */
export function findProject(projects, id) {
  return (Array.isArray(projects) ? projects : []).find((project) => project?.id === id) ?? null
}
