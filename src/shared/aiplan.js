/**
 * AI 填充：把自然语言指令变成一份"变更计划"，先给用户确认，再一次性落库。
 *
 * 这一层是纯函数：模型只负责产出 JSON 计划，**校验、匹配、预览、应用**都在这里做，
 * 所以模型说错话不会直接改数据；模型不可用时还能退回本地规则解析。
 */
import { MODULES, STATUSES, clampProgress, todayISO } from './analysis.js'
import { answerQuestion } from './query.js'
export const AI_INTENTS = ['add', 'update', 'delete', 'todo', 'log', 'query']
export const AI_OPS = ['add', 'update', 'delete', 'addTodo', 'doneTodo', 'addLog']
const LOG_KINDS = ['note', 'progress', 'blocker', 'decision']
const EDITABLE = ['name', 'module', 'status', 'owner', 'dueDate', 'startedOn', 'progress', 'summary', 'link']
const FIELD_LABELS = {
  name: '名称', module: '模块', status: '状态', owner: '负责人', dueDate: '截止', startedOn: '开始',
  progress: '进度', summary: '说明', link: '链接'
}
const KIND_LABELS = { note: '记录', progress: '进展', blocker: '阻塞', decision: '决策' }

const pad = (value) => String(value).padStart(2, '0')
const dayOf = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const shift = (today, days) => {
  const date = dayOf(today) ?? new Date()
  date.setDate(date.getDate() + days)
  return iso(date)
}

/** 把模型/用户给的日期说法解析成 YYYY-MM-DD；解析不了返回空串。 */
export function resolveDate(value, today = todayISO()) {
  const raw = String(value ?? '').trim()
  if (raw === '') return ''
  const absolute = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw)
  if (absolute) return `${absolute[1]}-${pad(absolute[2])}-${pad(absolute[3])}`
  const monthDay = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(raw)
  if (monthDay) {
    const year = Number(today.slice(0, 4))
    return `${year}-${pad(monthDay[1])}-${pad(monthDay[2])}`
  }
  if (/今天|今日/.test(raw)) return today
  if (/明天|次日/.test(raw)) return shift(today, 1)
  if (/后天/.test(raw)) return shift(today, 2)
  if (/大后天/.test(raw)) return shift(today, 3)
  const weekday = /(下{0,1})周([一二三四五六日天])/.exec(raw)
  if (weekday) {
    const base = dayOf(today) ?? new Date()
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }
    const target = map[weekday[2]]
    const current = base.getDay() === 0 ? 7 : base.getDay()
    let delta = target - current
    if (weekday[1] === '下') delta += 7
    else if (delta < 0) delta += 7
    return shift(today, delta)
  }
  if (/月底|月末/.test(raw)) {
    const date = dayOf(today) ?? new Date()
    return iso(new Date(date.getFullYear(), date.getMonth() + 1, 0))
  }
  if (/下个?月/.test(raw)) {
    const date = dayOf(today) ?? new Date()
    return iso(new Date(date.getFullYear(), date.getMonth() + 1, 1))
  }
  if (/\+?\s*(\d+)\s*天/.test(raw)) return shift(today, Number(/(\d+)\s*天/.exec(raw)[1]))
  if (/\+?\s*(\d+)\s*周/.test(raw)) return shift(today, Number(/(\d+)\s*周/.exec(raw)[1]) * 7)
  return ''
}

const normalizeName = (value) => String(value ?? '').replace(/[\s「」『』"'《》()（）\[\]【】]/g, '').toLowerCase()

/** 按 id → 完全同名 → 包含 的顺序找项目；歧义或找不到都返回原因。 */
export function matchProject(target, projects) {
  const raw = String(target ?? '').trim()
  if (raw === '') return { reason: '没有指明是哪个项目' }
  const list = Array.isArray(projects) ? projects : []
  const byId = list.find((project) => project.id === raw)
  if (byId) return { project: byId }
  const wanted = normalizeName(raw)
  const exact = list.filter((project) => normalizeName(project.name) === wanted)
  if (exact.length === 1) return { project: exact[0] }
  if (exact.length > 1) return { reason: `「${raw}」对应多个项目，请说全一点` }
  const partial = list.filter((project) => normalizeName(project.name).includes(wanted) || wanted.includes(normalizeName(project.name)))
  if (partial.length === 1) return { project: partial[0] }
  if (partial.length > 1) return { reason: `「${raw}」匹配到多个项目（${partial.slice(0, 3).map((p) => p.name).join('、')}），请说全一点` }
  return { reason: `找不到项目「${raw}」` }
}

function cleanTags(value) {
  if (!Array.isArray(value)) return []
  return value.map((tag) => String(tag ?? '').trim()).filter(Boolean).slice(0, 8)
}

function cleanProgress(value) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace('%', '').trim())
  if (!Number.isFinite(number)) return null
  return clampProgress({ progress: number })
}

function normalizeAdd(raw, today, issues) {
  const name = String(raw?.name ?? raw?.title ?? '').trim()
  if (!name) {
    issues.push('新增动作缺少项目名称，已跳过')
    return null
  }
  const status = STATUSES.includes(raw?.status) ? raw.status : '进行中'
  const progress = cleanProgress(raw?.progress)
  return {
    op: 'add',
    project: {
      name,
      module: String(raw?.module ?? '').trim() || '其他项目',
      status,
      owner: String(raw?.owner ?? '').trim(),
      startedOn: resolveDate(raw?.startedOn, today),
      dueDate: resolveDate(raw?.dueDate, today),
      progress: progress === null ? 0 : progress,
      summary: String(raw?.summary ?? '').trim(),
      link: String(raw?.link ?? '').trim(),
      tags: cleanTags(raw?.tags)
    }
  }
}

function normalizeUpdate(raw, projects, today, issues) {
  const found = matchProject(raw?.target ?? raw?.name, projects)
  if (!found.project) {
    issues.push(`${found.reason}，修改已跳过`)
    return null
  }
  const source = raw?.changes && typeof raw.changes === 'object' ? raw.changes : raw
  const changes = {}
  for (const key of EDITABLE) {
    if (source?.[key] === undefined || source?.[key] === null || source?.[key] === '') continue
    if (key === 'progress') {
      const progress = cleanProgress(source[key])
      if (progress === null) { issues.push(`进度值无法识别，已忽略`); continue }
      changes.progress = progress
      continue
    }
    if (key === 'status') {
      if (!STATUSES.includes(source[key])) { issues.push(`状态「${source[key]}」不在可选范围，已忽略`); continue }
      changes.status = source[key]
      continue
    }
    if (key === 'dueDate' || key === 'startedOn') {
      const date = resolveDate(source[key], today)
      if (!date) { issues.push(`日期「${source[key]}」无法识别，已忽略`); continue }
      changes[key] = date
      continue
    }
    changes[key] = String(source[key]).trim()
  }
  if (Object.keys(changes).length === 0) {
    issues.push(`没有识别出「${found.project.name}」要改什么，已跳过`)
    return null
  }
  return { op: 'update', projectId: found.project.id, name: found.project.name, changes }
}

function normalizeSimple(op, raw, projects, today, issues) {
  const found = matchProject(raw?.target ?? raw?.project ?? raw?.name, projects)
  if (!found.project) {
    issues.push(`${found.reason}，${op === 'delete' ? '删除' : op === 'addTodo' ? '新增待跟进' : op === 'doneTodo' ? '完成待跟进' : '追加进展'}已跳过`)
    return null
  }
  const project = found.project
  if (op === 'delete') return { op, projectId: project.id, name: project.name }
  if (op === 'addTodo') {
    const title = String(raw?.title ?? raw?.todo ?? raw?.text ?? '').trim()
    if (!title) { issues.push('待跟进缺少内容，已跳过'); return null }
    return { op, projectId: project.id, name: project.name, title, owner: String(raw?.owner ?? '').trim(), dueDate: resolveDate(raw?.dueDate, today) }
  }
  if (op === 'doneTodo') {
    const wanted = normalizeName(raw?.title ?? raw?.todo ?? raw?.text ?? '')
    const open = (project.todos ?? []).filter((todo) => todo.done !== true)
    let todo = null
    if (wanted) todo = open.find((item) => normalizeName(item.title).includes(wanted)) ?? null
    else if (open.length === 1) todo = open[0]
    if (!todo) { issues.push(`在「${project.name}」里找不到要完成的待跟进，已跳过`); return null }
    return { op, projectId: project.id, name: project.name, todoId: todo.id, title: todo.title }
  }
  const text = String(raw?.text ?? raw?.content ?? raw?.summary ?? '').trim()
  if (!text) { issues.push('进展内容为空，已跳过'); return null }
  const kind = LOG_KINDS.includes(raw?.kind) ? raw.kind : 'note'
  return { op, projectId: project.id, name: project.name, kind, text }
}

/**
 * 校验并收敛模型给的原始计划。
 * @returns { intent, reply, actions, issues }
 */
export function normalizePlan(raw, projects, today = todayISO()) {
  const issues = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { intent: 'query', reply: '', actions: [], issues: ['模型没有返回可用的计划'] }
  }
  const actions = []
  for (const action of Array.isArray(raw.actions) ? raw.actions.slice(0, 20) : []) {
    const op = String(action?.op ?? '').trim()
    if (!AI_OPS.includes(op)) {
      if (op) issues.push(`不认识的动作「${op}」，已跳过`)
      continue
    }
    const normalized = op === 'add' ? normalizeAdd(action, today, issues)
      : op === 'update' ? normalizeUpdate(action, projects, today, issues)
        : normalizeSimple(op, action, projects, today, issues)
    if (normalized) actions.push(normalized)
  }
  const intent = AI_INTENTS.includes(raw.intent) ? raw.intent : ''
  const inferred = actions.length === 0
    ? (intent || 'query')
    : actions.some((action) => action.op === 'add') ? 'add'
      : actions.some((action) => action.op === 'delete') ? 'delete'
        : actions.some((action) => action.op === 'update') ? 'update'
          : actions.some((action) => action.op === 'addTodo' || action.op === 'doneTodo') ? 'todo' : 'log'
  return {
    intent: intent && actions.length > 0 && intent !== 'query' ? intent : inferred,
    reply: String(raw.reply ?? '').trim(),
    actions,
    issues
  }
}

/** 客户端应用前再核对一次：解析期间项目可能已经变了。 */
export function revalidatePlan(plan, projects) {
  const ids = new Set((Array.isArray(projects) ? projects : []).map((project) => project.id))
  const actions = []
  const issues = [...(plan?.issues ?? [])]
  let dropped = 0
  for (const action of plan?.actions ?? []) {
    if (action.op === 'add' || ids.has(action.projectId)) actions.push(action)
    else dropped += 1
  }
  if (dropped > 0) issues.push(`有 ${dropped} 项因为项目已变化被跳过`)
  return { ...plan, actions, issues }
}

/** 人类可读的变更预览：确认弹窗就是按这个渲染的。 */
export function previewPlan(plan, projects = [], today = todayISO()) {
  const find = (id) => projects.find((project) => project.id === id)
  const groups = []
  const push = (key, title, lines) => { if (lines.length > 0) groups.push({ key, title, lines }) }

  push('add', '新增项目', (plan.actions ?? []).filter((action) => action.op === 'add').map((action) => {
    const project = action.project
    const bits = [project.module, project.status, project.dueDate ? `DDL ${project.dueDate}` : '未排期']
    if (project.owner) bits.push(project.owner)
    return `「${project.name}」（${bits.join(' · ')}）${project.summary ? ` — ${project.summary}` : ''}`
  }))

  push('update', '修改项目', (plan.actions ?? []).filter((action) => action.op === 'update').map((action) => {
    const project = find(action.projectId)
    const changes = Object.entries(action.changes).map(([key, value]) => {
      const before = key === 'progress' ? `${clampProgress(project ?? {})}%` : String(project?.[key] ?? '空') || '空'
      const after = key === 'progress' ? `${value}%` : String(value)
      return `${FIELD_LABELS[key] ?? key} ${before} → ${after}`
    })
    return `「${action.name}」：${changes.join('；')}`
  }))

  push('delete', '删除项目', (plan.actions ?? []).filter((action) => action.op === 'delete').map((action) => {
    const project = find(action.projectId)
    return `「${action.name}」${project ? `（${project.module || '其他项目'} · ${project.status || '进行中'} · ${clampProgress(project)}%）` : ''}`
  }))

  push('todo', '待跟进', (plan.actions ?? []).filter((action) => action.op === 'addTodo' || action.op === 'doneTodo').map((action) => (action.op === 'addTodo'
    ? `给「${action.name}」新增：${action.title}${action.dueDate ? `（截止 ${action.dueDate}）` : ''}`
    : `把「${action.name}」的「${action.title}」标记完成`)))

  push('log', '进展记录', (plan.actions ?? []).filter((action) => action.op === 'addLog').map((action) =>
    `给「${action.name}」追加${KIND_LABELS[action.kind] ?? '记录'}：${action.text}`))

  const total = (plan.actions ?? []).length
  return { groups, total, issues: plan.issues ?? [] }
}

/** 预览里各项变更的一句话摘要，用于执行后的提示。 */
export function planSummary(plan) {
  const count = (op) => (plan.actions ?? []).filter((action) => action.op === op).length
  const parts = []
  if (count('add')) parts.push(`新增 ${count('add')} 个`)
  if (count('update')) parts.push(`修改 ${count('update')} 个`)
  if (count('delete')) parts.push(`删除 ${count('delete')} 个`)
  const todos = count('addTodo') + count('doneTodo')
  if (todos) parts.push(`待跟进 ${todos} 项`)
  if (count('addLog')) parts.push(`进展 ${count('addLog')} 条`)
  return parts.join('，') || '没有变更'
}

/**
 * 把计划应用到状态上，返回新状态。一次写入，失败不留半成品。
 * @param makeId - 生成 id 的函数，测试里可以注入固定值。
 */
export function applyPlan(state, plan, today = todayISO(), makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`) {
  let projects = Array.isArray(state?.projects) ? [...state.projects] : []
  let applied = 0
  const now = new Date().toISOString()
  const touch = (project) => ({ ...project, updatedAt: now })

  for (const action of plan?.actions ?? []) {
    if (action.op === 'add') {
      projects = [{
        id: makeId('proj'),
        name: action.project.name,
        module: action.project.module,
        status: action.project.status,
        owner: action.project.owner,
        dueDate: action.project.dueDate,
        startedOn: action.project.startedOn,
        progress: action.project.progress,
        link: action.project.link,
        summary: action.project.summary,
        tags: action.project.tags,
        createdAt: now,
        updatedAt: now,
        updates: [],
        todos: []
      }, ...projects]
      applied += 1
      continue
    }
    const index = projects.findIndex((project) => project.id === action.projectId)
    if (index < 0) continue
    const project = projects[index]
    if (action.op === 'update') {
      projects[index] = touch({ ...project, ...action.changes })
    } else if (action.op === 'delete') {
      projects = projects.filter((item) => item.id !== action.projectId)
    } else if (action.op === 'addTodo') {
      projects[index] = touch({
        ...project,
        todos: [...(project.todos ?? []), {
          id: makeId('todo'), title: action.title, owner: action.owner, dueDate: action.dueDate, done: false, doneAt: ''
        }]
      })
    } else if (action.op === 'doneTodo') {
      projects[index] = touch({
        ...project,
        todos: (project.todos ?? []).map((todo) => (todo.id === action.todoId
          ? { ...todo, done: true, doneAt: now }
          : todo))
      })
    } else if (action.op === 'addLog') {
      projects[index] = touch({
        ...project,
        updates: [...(project.updates ?? []), { id: makeId('upd'), at: now, kind: action.kind, text: action.text }]
      })
    }
    applied += 1
  }
  return { next: { ...state, projects }, applied }
}

/* --------------------------------------------------------- 本地规则兜底 */

const has = (text, pattern) => pattern.test(text)

function pickProjectName(instruction, projects) {
  const normalized = normalizeName(instruction)
  const candidates = (projects ?? [])
    .map((project) => ({ project, key: normalizeName(project.name) }))
    .filter((item) => item.key.length >= 2 && normalized.includes(item.key))
    .sort((a, b) => b.key.length - a.key.length)
  return candidates[0]?.project ?? null
}

function detectStatus(text) {
  if (/已完成|做完了|交付了/.test(text)) return '已完成'
  if (/阻塞|卡住|卡在/.test(text)) return '阻塞'
  if (/暂停|搁置/.test(text)) return '暂停'
  if (/待启动|还没开始|未开始/.test(text)) return '待启动'
  if (/进行中|在做/.test(text)) return '进行中'
  return ''
}

/**
 * 不依赖模型的规则解析：识别常见说法，产出的计划结构与模型一致。
 * 模型不可用时用它兜底，UI 会标注来源。
 */
export function planFromRules(instruction, projects = [], today = todayISO()) {
  const text = String(instruction ?? '').trim()
  const issues = []
  if (!text) return { intent: 'query', reply: '先说一句要做什么，比如「把订单结算服务重构的 DDL 改到下周五」。', actions: [], issues }

  if (has(text, /哪些|多少|列出|查一下|查询|有没有|怎么样|如何|情况|吗[?？]?$|[?？]$/)) {
    return { intent: 'query', reply: answerQuestion(text, projects, today).text, actions: [], issues }
  }

  const target = pickProjectName(text, projects)

  if (has(text, /删除|删掉|移除|去掉|不要了/)) {
    if (!target) {
      issues.push('没听出要删哪个项目，请把项目名说清楚')
      return { intent: 'delete', reply: '', actions: [], issues }
    }
    return { intent: 'delete', reply: `删除「${target.name}」`, actions: [{ op: 'delete', projectId: target.id, name: target.name }], issues }
  }

  if (has(text, /待跟进|待办|提醒|跟进事项/)) {
    if (!target) {
      issues.push('没听出是哪个项目的待跟进，请把项目名说清楚')
      return { intent: 'todo', reply: '', actions: [], issues }
    }
    const title = text
      .replace(/^(给|帮我把|帮我|在)?\s*/, '')
      .split(/待跟进|待办|提醒我?|跟进事项/)[1] ?? ''
    const cleaned = title.replace(/^[:：,，、\s]+/, '').replace(/[。.\s]+$/, '').trim()
    if (!cleaned) {
      issues.push('没说清待跟进的内容')
      return { intent: 'todo', reply: '', actions: [], issues }
    }
    return {
      intent: 'todo',
      reply: `给「${target.name}」加一条待跟进`,
      actions: [{ op: 'addTodo', projectId: target.id, name: target.name, title: cleaned, owner: '', dueDate: resolveDate(text, today) }],
      issues
    }
  }

  if (has(text, /完成|勾掉|做完了|搞定了/) && target) {
    const open = (target.todos ?? []).filter((todo) => todo.done !== true)
    if (open.length === 1) {
      return { intent: 'todo', reply: `把「${target.name}」的待跟进标记完成`, actions: [{ op: 'doneTodo', projectId: target.id, name: target.name, todoId: open[0].id, title: open[0].title }], issues }
    }
    if (open.length === 0) issues.push(`「${target.name}」没有未完成的待跟进`)
    else issues.push(`「${target.name}」有 ${open.length} 条未完成待跟进，请说清是哪一条`)
    return { intent: 'todo', reply: '', actions: [], issues }
  }

  if (has(text, /进展|记录一条|追加|记一下|备注/)) {
    if (!target) {
      issues.push('没听出是哪个项目，请把项目名说清楚')
      return { intent: 'log', reply: '', actions: [], issues }
    }
    const body = text.split(/进展|记录一条|追加|记一下|备注/)[1] ?? ''
    const cleaned = body.replace(/^[:：,，、\s]+/, '').replace(/[。.\s]+$/, '').trim()
    if (!cleaned) {
      issues.push('没说清要记什么')
      return { intent: 'log', reply: '', actions: [], issues }
    }
    const kind = /阻塞|卡住/.test(cleaned) ? 'blocker' : /决定|拍板/.test(cleaned) ? 'decision' : /完成|搞定/.test(cleaned) ? 'progress' : 'note'
    return { intent: 'log', reply: `给「${target.name}」追加一条记录`, actions: [{ op: 'addLog', projectId: target.id, name: target.name, kind, text: cleaned }], issues }
  }

  const progress = /(\d{1,3})\s*%/.exec(text)
  const status = detectStatus(text)
  const dueDate = has(text, /ddl|截止|到期|交付|deadline|推迟|提前|延后|改到|改为.*[日号天周]/i) || /月.*[日号]/.test(text)
    ? resolveDate(text, today)
    : ''
  const owner = /负责人\s*[:：]?\s*([^\s,，。；;]{1,12})/.exec(text)?.[1] ?? ''

  if (target && (progress || status || dueDate || owner)) {
    const changes = {}
    if (progress) changes.progress = clampProgress({ progress: Number(progress[1]) })
    if (status) changes.status = status
    if (dueDate) changes.dueDate = dueDate
    if (owner) changes.owner = owner
    return { intent: 'update', reply: `修改「${target.name}」`, actions: [{ op: 'update', projectId: target.id, name: target.name, changes }], issues }
  }

  if (has(text, /新增|添加|加一个|建一个|创建一个|录入|记一个新项目/)) {
    const module = MODULES.find((name) => text.includes(name)) ?? '其他项目'
    const name = text
      .replace(/^(帮我|请|麻烦)?\s*(新增|添加|新建|创建|录入)?\s*(一个|一条|个)?\s*(项目)?\s*[:：]?\s*/, '')
      .split(/[，,。；;]|（|\(/)[0]
      .replace(new RegExp(module, 'g'), '')
      .replace(/放到|归到|属于|在/g, '')
      .trim()
    if (!name) {
      issues.push('没听出项目名称')
      return { intent: 'add', reply: '', actions: [], issues }
    }
    return {
      intent: 'add',
      reply: `新增项目「${name}」`,
      actions: [{
        op: 'add',
        project: {
          name, module, status: status || '进行中', owner,
          startedOn: today, dueDate, progress: progress ? clampProgress({ progress: Number(progress[1]) }) : 0,
          summary: '', link: '', tags: []
        }
      }],
      issues
    }
  }

  issues.push('没看懂这句话。可以说「新增一个项目叫 X」「把 X 的 DDL 改到下周五」「删掉 X」「给 X 加一条待跟进：Y」，或者直接问「这周要交付什么」。')
  return { intent: 'query', reply: answerQuestion(text, projects, today).text, actions: [], issues }
}

/** 给模型的 JSON 约定说明（也用于界面上的能力提示）。 */
export function planSchemaDoc(today = todayISO()) {
  return [
    `今天是 ${today}。把用户的指令翻译成一个 JSON 对象，不要输出任何解释或 Markdown 代码块之外的文字。`,
    'JSON 结构：{ "intent": "add|update|delete|todo|log|query", "reply": "给用户看的一句话", "actions": [...] }',
    'actions 里每一项是下列之一：',
    '- 新增项目：{ "op":"add", "name":"项目名", "module":"公司项目|日常工作|其他项目", "status":"进行中|待启动|阻塞|暂停|已完成", "owner":"", "startedOn":"YYYY-MM-DD", "dueDate":"YYYY-MM-DD", "progress":0, "summary":"一句话", "tags":["标签"] }',
    '- 修改项目：{ "op":"update", "target":"项目名或 id", "changes":{ 只写要改的字段，字段名同上 } }',
    '- 删除项目：{ "op":"delete", "target":"项目名或 id" }',
    '- 新增待跟进：{ "op":"addTodo", "target":"项目名或 id", "title":"事项", "dueDate":"YYYY-MM-DD", "owner":"" }',
    '- 完成待跟进：{ "op":"doneTodo", "target":"项目名或 id", "title":"事项关键词" }',
    '- 追加进展：{ "op":"addLog", "target":"项目名或 id", "kind":"note|progress|blocker|decision", "text":"内容" }',
    '规则：只能引用上面给出的真实项目名或 id；只问不做时 intent 用 "query"、actions 留空、reply 给答案；',
    '日期一律换成 YYYY-MM-DD；不确定的字段不要编造，宁可少写一个 action。'
  ].join('\n')
}

/** 给模型看的项目快照（限长，避免把上下文撑爆）。 */
export function projectSnapshot(projects, today = todayISO(), limit = 40) {
  return (Array.isArray(projects) ? projects : []).slice(0, limit).map((project) => ({
    id: project.id,
    name: project.name,
    module: project.module || '其他项目',
    status: project.status || '进行中',
    owner: project.owner || '',
    dueDate: project.dueDate || '',
    progress: clampProgress(project),
    todo: (project.todos ?? []).filter((todo) => todo.done !== true).slice(0, 8).map((todo) => ({ title: todo.title, dueDate: todo.dueDate || '' })),
    lastUpdate: (project.updates ?? []).slice(-2).map((item) => item.text)
  }))
}
