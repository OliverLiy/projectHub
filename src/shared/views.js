/**
 * 面板上的「模块化」视图逻辑：按模块分组、智能视图筛选、关键字搜索。
 * 纯函数，测试里直接调用。
 */
import { DANGER_LEVELS, WATCH_LEVELS, clampProgress, daysLeft, endOfWeek, latestUpdate, moduleNames, openTodos, projectRisk, sortByRisk, todayISO } from './analysis.js'
export const ATTENTION_LEVELS = [...DANGER_LEVELS, ...WATCH_LEVELS]

/** 左侧栏的智能视图。`view` 用于筛选；「全部项目」是模块轴，不是筛选。 */
export const SMART_VIEWS = [
  { id: 'attention', label: '需关注', hint: '逾期、阻塞、紧急或进度落后的项目' },
  { id: 'overdue', label: '已逾期', hint: '已超过截止日期' },
  { id: 'week', label: '本周到期', hint: '本周日之前到期' },
  { id: 'todos', label: '有待跟进', hint: '还有未完成的待跟进事项' },
  { id: 'done', label: '已完成', hint: '已交付的项目' }
]

export function smartView(id) {
  return SMART_VIEWS.find((view) => view.id === id) ?? null
}

/** 单个项目是否命中某个智能视图。 */
export function matchesSmartView(project, viewId, today = todayISO()) {
  const risk = projectRisk(project, today)
  if (viewId === 'attention') return ATTENTION_LEVELS.includes(risk.level)
  if (viewId === 'overdue') return risk.level === 'overdue'
  if (viewId === 'done') return (project?.status || '') === '已完成'
  if (viewId === 'todos') return openTodos(project).length > 0
  if (viewId === 'week') {
    const left = daysLeft(project?.dueDate, today)
    return left !== null && left >= 0 && project.dueDate <= endOfWeek(today)
  }
  return true
}

/** 可供搜索的项目文本：名称、模块、负责人、说明、标签与最近进展。 */
export function searchText(project) {
  const latest = latestUpdate(project)
  return [
    project?.name, project?.module, project?.owner, project?.summary, project?.status,
    ...(Array.isArray(project?.tags) ? project.tags : []),
    latest?.text,
    ...openTodos(project).map((todo) => todo.title)
  ].filter(Boolean).join(' ').toLowerCase()
}

/**
 * 按「模块 + 智能视图 + 关键字」筛选并排序。
 * @param state - { module: '全部'|模块名, view: SmartView.id|'', keyword }。
 */
export function selectProjects(projects, state = {}, today = todayISO()) {
  const module = state.module ?? '全部'
  const view = state.view ?? ''
  const keyword = String(state.keyword ?? '').trim().toLowerCase()
  return sortByRisk(projects, today)
    .map((item) => item.project)
    .filter((project) => module === '全部' || (project?.module || '其他项目') === module)
    .filter((project) => !view || matchesSmartView(project, view, today))
    .filter((project) => !keyword || searchText(project).includes(keyword))
}

/** 一个模块（或「全部」）的小结，用于分组表头与侧栏计数。 */
export function summarize(projects, today = todayISO()) {
  const risks = projects.map((project) => projectRisk(project, today))
  return {
    total: projects.length,
    active: projects.filter((project) => (project?.status || '进行中') === '进行中').length,
    done: projects.filter((project) => (project?.status || '') === '已完成').length,
    danger: risks.filter((risk) => DANGER_LEVELS.includes(risk.level)).length,
    watch: risks.filter((risk) => WATCH_LEVELS.includes(risk.level)).length,
    overdue: risks.filter((risk) => risk.level === 'overdue').length,
    openTodos: projects.reduce((sum, project) => sum + openTodos(project).length, 0),
    avgProgress: projects.length === 0
      ? 0
      : Math.round(projects.reduce((sum, project) => sum + clampProgress(project), 0) / projects.length)
  }
}

/** 侧栏模块清单：固定三个模块 + 出现过的自定义模块，带计数与风险点。 */
export function railModules(projects, today = todayISO()) {
  const names = moduleNames(projects)
  return names.map((name) => {
    const items = projects.filter((project) => (project?.module || '其他项目') === name)
    const stats = summarize(items, today)
    return { name, total: stats.total, danger: stats.danger + stats.watch, overdue: stats.overdue }
  })
}

/** 智能视图的计数，用于侧栏。 */
export function railViews(projects, today = todayISO()) {
  return SMART_VIEWS.map((view) => ({
    ...view,
    total: projects.filter((project) => matchesSmartView(project, view.id, today)).length
  }))
}

/**
 * 按模块分组，用于「全部项目」下的分区展示。
 * 空模块不返回；自定义模块排在固定模块之后。
 */
export function groupByModule(projects, today = todayISO()) {
  return railModules(projects, today)
    .filter((entry) => entry.total > 0)
    .map((entry) => ({
      module: entry.name,
      projects: sortByRisk(projects.filter((project) => (project?.module || '其他项目') === entry.name), today)
        .map((item) => item.project),
      stats: summarize(projects.filter((project) => (project?.module || '其他项目') === entry.name), today)
    }))
}
