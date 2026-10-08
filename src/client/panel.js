/**
 * 项目总控台面板。
 *
 * 顶栏（品牌 / 搜索 / 刷新 / 新建）＋ 视图页签（概览 · 模块看板 · 状态看板 · 列表 · 日历 ·
 * 时间线 · 待跟进）＋ 左侧模块导航（模块轴 + 智能视图）＋ 主内容区 ＋ 右侧详情抽屉。
 * 所有弹层都在宿主分配的主内容区内，不覆盖 Desktop 的侧栏、模式切换器与「工作台管理」入口。
 *
 * 依赖会话的动作（把提示词交给 Agent）由用户复制到旁边的原生会话完成：本面板不创建会话、
 * 不改写会话归属，也不动工作区。
 */
import React from 'react'
import { ApiError, askAi, newId, readState, writeState } from './api.js'
import { CSS, STYLE_ID } from './styles.js'
import { Badge, Btn, Empty, Field, Icon, IconBtn, Modal, Notice, Progress, RiskBadge, SearchBox, Sheet, Toast, useToast } from './ui.js'
import { BoardScreen, CalendarScreen, FollowUpsScreen, KanbanScreen, ListScreen, OverviewScreen, TimelineScreen } from './screens.js'
import { MODULES, STATUSES, clampProgress, daysLeft, formatRemaining, moduleNames, openTodos, projectRisk, sortByRisk, todayISO } from '../shared/analysis.js'
import { QUESTION_EXAMPLES, answerQuestion } from '../shared/query.js'
import { buildAnalysisPrompt, buildDocDraft, docKinds, deliveryHint } from '../shared/prompt.js'
import { groupByModule, railModules, railViews, selectProjects, smartView, summarize } from '../shared/views.js'
import { buildSampleProjects, sampleSummary } from '../shared/sample.js'
import { applyPlan, planSummary, previewPlan, revalidatePlan } from '../shared/aiplan.js'
import { calendarMonth, followUpBuckets, kpis, moduleAccentMap, moduleWorkload, monthKeyOf, ownerWorkload, progressBuckets, riskBreakdown, shiftMonth, statusColumns, timelineModel } from '../shared/insights.js'
const h = React.createElement
const { useCallback, useEffect, useMemo, useRef, useState } = React
const DOCS = docKinds()
const KIND_LABELS = { note: '记录', progress: '进展', blocker: '阻塞', decision: '决策' }
const PROGRESS_TONE = { overdue: 'danger', blocked: 'danger', urgent: 'danger', slipping: 'warn', soon: 'warn', done: 'ok' }
const ATTENTION = ['overdue', 'blocked', 'urgent', 'slipping', 'soon']

const AI_EXAMPLES = [
  '把订单结算服务重构的 DDL 改到下周五，进度调到 80%',
  '新增项目：服务网格试点，放到公司项目，截止月底',
  '给内部分享《线上问题定位实战》准备加一条待跟进：周五前做一次预讲',
  '删掉副业小程序原型',
  '这周要交付什么？'
]

const TABS = [
  { id: 'overview', label: '概览', icon: 'target' },
  { id: 'board', label: '模块看板', icon: 'grid' },
  { id: 'kanban', label: '状态看板', icon: 'inbox' },
  { id: 'list', label: '列表', icon: 'list' },
  { id: 'calendar', label: '日历', icon: 'calendar' },
  { id: 'timeline', label: '时间线', icon: 'clock' },
  { id: 'todos', label: '待跟进', icon: 'check' }
]

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
ensureStyles()

/* ------------------------------------------------------------------ 数据层 */

function usePortfolio() {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({ version: 1, projects: [] })
  const stateRef = useRef(state)
  const revisionRef = useRef(0)
  const queue = useRef(Promise.resolve())

  const load = useCallback(async () => {
    setStatus('loading')
    setError('')
    setConflict(false)
    try {
      const data = await readState()
      stateRef.current = data.state
      revisionRef.current = data.revision
      setState(data.state)
      setRevision(data.revision)
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取项目数据失败。')
      setStatus('error')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 写入串行化：连续操作不会拿同一个版本号各写一次。
  const update = useCallback((mutator) => {
    const run = async () => {
      const previous = stateRef.current
      let next
      try {
        next = mutator(previous)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '操作失败。')
        return false
      }
      if (!next || next === previous) return true
      stateRef.current = next
      setState(next)
      setSaving(true)
      try {
        const result = await writeState(revisionRef.current, next)
        revisionRef.current = Number(result?.revision) || revisionRef.current + 1
        setRevision(revisionRef.current)
        setConflict(false)
        setError('')
        return true
      } catch (cause) {
        stateRef.current = previous
        setState(previous)
        if (cause instanceof ApiError && cause.status === 409) {
          setConflict(true)
          setError(cause.message)
        } else {
          setError(cause instanceof Error ? cause.message : '保存失败。')
        }
        return false
      } finally {
        setSaving(false)
      }
    }
    const task = queue.current.then(run, run)
    queue.current = task.then(() => undefined, () => undefined)
    return task
  }, [])

  return { status, error, conflict, saving, revision, state, reload: load, update, setError }
}

/* ------------------------------------------------------------- 复制与下载 */

async function copyText(value) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch { /* 回退到 execCommand */ }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', 'readonly')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

function downloadMarkdown(filename, value) {
  try {
    const blob = new Blob([value], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

/* --------------------------------------------------------------- 表单模型 */

function dateAfter(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return todayISO(date)
}

function blankDraft() {
  return {
    id: '', name: '', module: MODULES[0], status: '进行中', owner: '',
    startedOn: todayISO(), dueDate: dateAfter(14), progress: 0, link: '', summary: '', tagText: ''
  }
}

function draftFromProject(project) {
  return {
    id: project.id,
    name: project.name ?? '',
    module: project.module || MODULES[0],
    status: project.status || '进行中',
    owner: project.owner ?? '',
    startedOn: project.startedOn ?? '',
    dueDate: project.dueDate ?? '',
    progress: clampProgress(project),
    link: project.link ?? '',
    summary: project.summary ?? '',
    tagText: Array.isArray(project.tags) ? project.tags.join('、') : ''
  }
}

function projectFromDraft(draft, existing) {
  const now = new Date().toISOString()
  const base = existing || { id: newId('proj'), createdAt: now, updates: [], todos: [] }
  return {
    ...base,
    name: draft.name.trim(),
    module: draft.module.trim() || '其他项目',
    status: draft.status,
    owner: draft.owner.trim(),
    startedOn: draft.startedOn,
    dueDate: draft.dueDate,
    progress: clampProgress({ progress: Number(draft.progress) }),
    link: draft.link.trim(),
    summary: draft.summary.trim(),
    tags: draft.tagText.split(/[、,，\s]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
    updatedAt: now
  }
}

const touch = (project) => ({ ...project, updatedAt: new Date().toISOString() })

/* 示例数据只在"第一次进入且文档为空"时自动生成一次。 */
const SEED_FLAG = 'dsh-project-console-seeded'
function seedFlagSet() {
  try { return window.localStorage?.getItem(SEED_FLAG) === '1' } catch { return false }
}
function markSeedFlag() {
  try { window.localStorage?.setItem(SEED_FLAG, '1') } catch { /* 存不了就算了 */ }
}

/* ------------------------------------------------------------------ 问一句 */

function AskCard({ projects, today }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)
  const ask = (value) => {
    const asked = typeof value === 'string' ? value : question
    setQuestion(asked)
    setAnswer(answerQuestion(asked, projects, today))
  }
  return h('section', { className: 'pc-panel-block' },
    h('div', { className: 'pc-panel-head' },
      h(Icon, { name: 'sparkle', size: 14 }),
      h('h3', null, '问一句'),
      h('span', { className: 'pc-spacer' }),
      h('span', { className: 'pc-muted' }, '在本机数据上直接回答')),
    h('div', { className: 'pc-ask' },
      h('div', { className: 'pc-ask-row' },
        h(SearchBox, {
          value: question, onChange: setQuestion, label: '询问项目情况',
          placeholder: '问一句：哪些项目这周到期？有什么风险？'
        }),
        h(Btn, { variant: 'primary', onClick: () => ask() }, '提问')),
      h('div', { className: 'pc-chips' }, QUESTION_EXAMPLES.map((example) => h('button', {
        key: example, type: 'button', className: 'pc-chip-btn', onClick: () => ask(example)
      }, example))),
      answer ? h('div', { className: 'pc-answer' }, h('div', null, answer.text)) : null))
}

/* --------------------------------------------------------------- AI 填充 */

const AI_SOURCE_LABEL = { llm: '模型解析', rules: '本地规则解析' }

/** 自然语言 → 变更计划 → 确认后一次性落库。 */
function AiFillModal({ projects, today, onClose, onApplied }) {
  const [text, setText] = useState('')
  const [state, setState] = useState({ status: 'idle' })
  const plan = state.plan
  const preview = state.preview
  const pending = state.status === 'loading'
  const changeCount = plan?.actions?.length ?? 0

  const analyze = async (value) => {
    const instruction = (typeof value === 'string' ? value : text).trim()
    if (!instruction || pending) return
    setText(instruction)
    setState({ status: 'loading' })
    try {
      const payload = await askAi(instruction, projects, today)
      const next = revalidatePlan(payload.plan, projects)
      setState({
        status: 'ready',
        source: payload.source,
        model: payload.model,
        reason: payload.reason,
        plan: next,
        preview: previewPlan(next, projects, today)
      })
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error.message : '解析失败。' })
    }
  }

  const confirm = () => {
    if (!plan || changeCount === 0) return
    onApplied(plan)
    onClose()
  }

  const footer = plan && changeCount > 0 && state.status === 'ready'
    ? [
      h(Btn, { key: 'cancel', onClick: onClose }, '取消'),
      h(Btn, { key: 'ok', variant: 'primary', icon: 'check', onClick: confirm }, `确认执行 ${changeCount} 项变更`)
    ]
    : [h(Btn, { key: 'close', onClick: onClose }, '关闭')]

  return h(Modal, {
    open: true,
    title: 'AI 填充',
    icon: 'sparkle',
    onClose,
    footer
  },
  h('div', { className: 'pc-ai' },
    h('div', { className: 'pc-muted' },
      '用一句话说明要做什么，AI 会判断是新增、修改、删除还是查询；增删改都要你确认后才会写入。'),
    h('textarea', {
      className: 'pc-textarea', value: text, 'aria-label': 'AI 填充指令',
      placeholder: '例如：把订单结算服务重构的 DDL 改到下周五，进度调到 80%',
      onChange: (event) => setText(event.target.value),
      onKeyDown: (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) analyze()
      }
    }),
    h('div', { className: 'pc-chips' }, AI_EXAMPLES.map((example) => h('button', {
      key: example, type: 'button', className: 'pc-chip-btn', onClick: () => analyze(example)
    }, example))),
    h('div', { className: 'pc-ai-actions' },
      h(Btn, { variant: 'primary', icon: 'sparkle', onClick: () => analyze(), disabled: pending || !text.trim() },
        pending ? '解析中…' : '解析'),
      h('span', { className: 'pc-muted' }, '⌘/Ctrl + Enter')),

    state.status === 'loading' ? h('div', { className: 'pc-skeleton', style: { height: 96 } }) : null,
    state.status === 'error' ? h(Notice, { tone: 'danger' }, state.error) : null,

    state.status === 'ready'
      ? h('div', { className: 'pc-ai-result' },
        h('div', { className: 'pc-ai-source' },
          h(Icon, { name: state.source === 'llm' ? 'sparkle' : 'note', size: 13 }),
          h('span', null, AI_SOURCE_LABEL[state.source] ?? '解析结果'),
          state.model ? h('span', { className: 'pc-mono' }, state.model) : null,
          state.source === 'rules' && state.reason
            ? h('span', { className: 'pc-muted', title: state.reason }, `（${String(state.reason).slice(0, 60)}）`)
            : null),
        plan.reply ? h('div', { className: 'pc-answer' }, h('div', null, plan.reply)) : null,
        changeCount > 0 && preview
          ? h('div', { className: 'pc-plan' }, preview.groups.map((group) => h('div', { className: 'pc-plan-group', key: group.key },
            h('div', { className: 'pc-plan-title' }, group.title, h('span', { className: 'pc-pill' }, String(group.lines.length))),
            h('ul', { className: 'pc-plan-lines' }, group.lines.map((line, index) => h('li', { key: `${group.key}-${index}` }, line))))))
          : null,
        changeCount > 0
          ? h('div', { className: 'pc-muted' }, '以上变更会在你点「确认执行」后一次性写入。')
          : null,
        plan.issues?.length
          ? h(Notice, { tone: 'warn' }, h('div', null, plan.issues.map((issue, index) => h('div', { key: index }, `· ${issue}`))))
          : null)
      : null))
}

/* ------------------------------------------------------------------ 详情 */

function DetailBody({ project, risk, today, onChange, ai, onEdit, onDelete }) {
  const [kind, setKind] = useState('progress')
  const [text, setText] = useState('')
  const [todoTitle, setTodoTitle] = useState('')
  const [todoDue, setTodoDue] = useState('')
  const todos = Array.isArray(project.todos) ? project.todos : []
  const updates = (Array.isArray(project.updates) ? project.updates : [])
    .slice()
    .sort((a, b) => String(b?.at ?? '').localeCompare(String(a?.at ?? '')))
  const open = openTodos(project)

  const addUpdate = () => {
    const body = text.trim()
    if (!body) return
    onChange(touch({
      ...project,
      updates: [...(project.updates || []), { id: newId('upd'), at: new Date().toISOString(), kind, text: body }]
    }))
    setText('')
  }

  const addTodo = () => {
    const title = todoTitle.trim()
    if (!title) return
    onChange(touch({
      ...project,
      todos: [...todos, { id: newId('todo'), title, owner: '', dueDate: todoDue, done: false, doneAt: '' }]
    }))
    setTodoTitle('')
    setTodoDue('')
  }

  const facts = [
    ['模块', project.module || '其他项目'],
    ['状态', project.status || '进行中'],
    ['负责人', project.owner || '未指定'],
    ['进度', `${clampProgress(project)}%`],
    ['开始', project.startedOn || '未填'],
    ['截止', project.dueDate || '未排期'],
    ['剩余', formatRemaining(project.dueDate, today)],
    ['最近更新', String(project.updatedAt || '').slice(0, 10) || '—']
  ]

  return h(React.Fragment, null,
    h('div', { className: 'pc-grid2' }, facts.map(([label, value]) => h('div', { className: 'pc-fact', key: label },
      h('span', null, label), h('strong', null, value)))),

    h('div', { className: 'pc-block' },
      h('div', { className: 'pc-block-head' }, h('h3', null, '时间风险')),
      h(Progress, { value: project.progress, tone: PROGRESS_TONE[risk.level] ?? '' }),
      h('div', { className: 'pc-chips' }, h(Badge, { tone: risk.tone, dot: true }, risk.label), h('span', { className: 'pc-muted' }, risk.detail))),

    project.summary || project.link || project.tags?.length
      ? h('div', { className: 'pc-block' },
        h('div', { className: 'pc-block-head' }, h('h3', null, '说明')),
        project.summary ? h('div', null, project.summary) : null,
        project.link
          ? h('div', null, h('a', { className: 'pc-mono', href: project.link, target: '_blank', rel: 'noreferrer noopener' }, project.link))
          : null,
        project.tags?.length
          ? h('div', { className: 'pc-card-tags' }, project.tags.map((tag) => h('span', { key: tag, className: 'pc-tag' }, tag)))
          : null)
      : null,

    h('div', { className: 'pc-block' },
      h('div', { className: 'pc-block-head' }, h('h3', null, `进展记录 · ${updates.length}`)),
      h('div', { className: 'pc-composer' },
        h('select', {
          className: 'pc-select', style: { maxWidth: '92px' }, value: kind, 'aria-label': '记录类型',
          onChange: (event) => setKind(event.target.value)
        }, Object.keys(KIND_LABELS).map((key) => h('option', { key, value: key }, KIND_LABELS[key]))),
        h('input', {
          className: 'pc-input', value: text, placeholder: '今天推进了什么 / 卡在哪 / 决定了什么',
          'aria-label': '新增进展记录',
          onChange: (event) => setText(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter') addUpdate() }
        }),
        h(Btn, { variant: 'primary', icon: 'plus', onClick: addUpdate, disabled: !text.trim() }, '追加')),
      updates.length > 0
        ? h('div', { className: 'pc-timeline' }, updates.slice(0, 40).map((item, index) =>
          h('div', { key: item.id || `${item.at}-${index}`, className: 'pc-timeline-item' },
            h('div', { className: 'pc-timeline-rail' }, h('span', { className: `pc-timeline-dot pc-timeline-dot-${item.kind}` })),
            h('div', { className: 'pc-timeline-body' },
              h('div', { className: 'pc-timeline-meta' },
                h('span', null, String(item.at).slice(0, 10)),
                h(Badge, { tone: item.kind === 'blocker' ? 'danger' : item.kind === 'progress' ? 'ok' : 'muted' }, KIND_LABELS[item.kind] || '记录')),
              h('div', { className: 'pc-timeline-text' }, item.text)))))
        : h('div', { className: 'pc-muted' }, '还没有进展记录。')),

    h('div', { className: 'pc-block' },
      h('div', { className: 'pc-block-head' }, h('h3', null, `待跟进 · 未完成 ${open.length} / 共 ${todos.length}`)),
      h('div', { className: 'pc-composer' },
        h('input', {
          className: 'pc-input', value: todoTitle, placeholder: '新增待跟进事项', 'aria-label': '新增待跟进事项',
          onChange: (event) => setTodoTitle(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter') addTodo() }
        }),
        h('input', {
          className: 'pc-input', style: { maxWidth: '136px' }, type: 'date', value: todoDue,
          'aria-label': '待跟进截止日期', onChange: (event) => setTodoDue(event.target.value)
        }),
        h(Btn, { icon: 'plus', onClick: addTodo, disabled: !todoTitle.trim() }, '添加')),
      todos.length > 0
        ? h('div', null, todos.map((todo) => h('div', { key: todo.id, className: `pc-todo${todo.done === true ? ' pc-todo-done' : ''}` },
          h('input', {
            type: 'checkbox', checked: todo.done === true, 'aria-label': `标记完成：${todo.title}`,
            onChange: () => onChange(touch({
              ...project,
              todos: todos.map((item) => item.id === todo.id
                ? { ...item, done: item.done !== true, doneAt: item.done !== true ? new Date().toISOString() : '' }
                : item)
            }))
          }),
          h('span', { className: 'pc-todo-title' }, todo.title),
          todo.dueDate
            ? h('span', { className: `pc-todo-due${todo.done !== true && (daysLeft(todo.dueDate, today) ?? 1) < 0 ? ' pc-todo-due-over' : ''}` }, `截止 ${todo.dueDate}`)
            : null,
          h(IconBtn, {
            icon: 'trash', size: 'sm', title: '删除事项', variant: 'danger',
            onClick: () => onChange(touch({ ...project, todos: todos.filter((item) => item.id !== todo.id) }))
          }))))
        : h('div', { className: 'pc-muted' }, '没有待跟进事项。')),

    h('div', { className: 'pc-block' },
      h('div', { className: 'pc-block-head' },
        h('h3', null, 'AI 助手'),
        h('span', { className: 'pc-spacer' }),
        h('span', { className: 'pc-muted' }, '生成后复制到旁边的会话发送')),
      h('div', { className: 'pc-chips' },
        h(Btn, { size: 'sm', icon: 'sparkle', onClick: () => ai.analysis(project) }, '分析这个项目的进展'),
        DOCS.map((doc) => h(Btn, { key: doc.value, size: 'sm', onClick: () => ai.doc(doc.value, project) }, `生成${doc.label}`)))),

    h('div', { className: 'pc-chips' },
      h(Btn, { size: 'sm', icon: 'edit', onClick: onEdit }, '编辑项目'),
      h(Btn, { size: 'sm', icon: 'trash', variant: 'danger', onClick: onDelete }, '删除项目')))
}

/* ------------------------------------------------------------------ 表单 */

export function ProjectForm({ draft, existing, moduleOptions, onSubmit, onCancel }) {
  const [form, setForm] = useState(draft)
  const [invalid, setInvalid] = useState('')
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = (event) => {
    if (event) event.preventDefault()
    if (!form.name.trim()) {
      setInvalid('项目名称不能为空。')
      return
    }
    onSubmit(projectFromDraft(form, existing))
  }

  return h(Modal, {
    open: true,
    title: existing ? '编辑项目' : '新建项目',
    icon: existing ? 'edit' : 'plus',
    onClose: onCancel,
    footer: [
      h(Btn, { key: 'cancel', onClick: onCancel }, '取消'),
      h(Btn, { key: 'ok', variant: 'primary', icon: 'check', onClick: submit }, existing ? '保存修改' : '创建项目')
    ]
  },
  h('form', { className: 'pc-form', onSubmit: submit },
    h(Field, { label: '项目名称 *', span: true, hint: invalid || undefined },
      h('input', { className: 'pc-input', value: form.name, onChange: set('name'), placeholder: '例如：订单结算服务重构', 'aria-label': '项目名称' })),
    h(Field, { label: '所属模块', hint: '可直接输入新的模块名' },
      h('input', { className: 'pc-input', list: 'pc-module-options', value: form.module, onChange: set('module'), 'aria-label': '所属模块' })),
    h('datalist', { id: 'pc-module-options' }, moduleOptions.map((name) => h('option', { key: name, value: name }))),
    h(Field, { label: '状态' },
      h('select', { className: 'pc-select', value: form.status, onChange: set('status'), 'aria-label': '状态' },
        STATUSES.map((name) => h('option', { key: name, value: name }, name)))),
    h(Field, { label: '负责人' },
      h('input', { className: 'pc-input', value: form.owner, onChange: set('owner'), placeholder: '我 / 谁', 'aria-label': '负责人' })),
    h(Field, { label: '开始日期' },
      h('input', { className: 'pc-input', type: 'date', value: form.startedOn, onChange: set('startedOn'), 'aria-label': '开始日期' })),
    h(Field, { label: '截止日期（DDL）' },
      h('input', { className: 'pc-input', type: 'date', value: form.dueDate, onChange: set('dueDate'), 'aria-label': '截止日期' })),
    h(Field, { label: `进度 ${clampProgress({ progress: Number(form.progress) })}%`, span: true },
      h('div', { className: 'pc-range' },
        h('input', { type: 'range', min: 0, max: 100, step: 5, value: form.progress, onChange: set('progress'), 'aria-label': '进度' }),
        h('b', null, `${clampProgress({ progress: Number(form.progress) })}%`))),
    h(Field, { label: '相关链接', span: true },
      h('input', { className: 'pc-input', value: form.link, onChange: set('link'), placeholder: '需求文档 / 仓库 / 看板地址', 'aria-label': '相关链接' })),
    h(Field, { label: '标签', span: true, hint: '用、或逗号分隔' },
      h('input', { className: 'pc-input', value: form.tagText, onChange: set('tagText'), placeholder: '后端、财务', 'aria-label': '标签' })),
    h(Field, { label: '一句话说明', span: true },
      h('textarea', { className: 'pc-textarea', value: form.summary, onChange: set('summary'), placeholder: '这个项目要交付什么', 'aria-label': '一句话说明' }))))
}

/* ------------------------------------------------------------------ 外壳 */

export function ConsoleView({ portfolio }) {
  const { status, error, conflict, saving, revision, state, reload, update, setError } = portfolio
  const projects = Array.isArray(state?.projects) ? state.projects : []
  const today = todayISO()
  const toast = useToast()
  const showToast = useRef(() => {})
  showToast.current = toast.show

  const [tab, setTab] = useState('overview')
  const [module, setModule] = useState('全部')
  const [view, setView] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiApplied, setAiApplied] = useState(null)
  const [aiOutput, setAiOutput] = useState(null)
  const [month, setMonth] = useState(() => monthKeyOf(today))
  const [day, setDay] = useState(today)

  const totals = useMemo(() => summarize(projects, today), [projects, today])
  const dashboard = useMemo(() => kpis(projects, today), [projects, today])
  const accents = useMemo(() => moduleAccentMap(projects), [projects])
  const rail = useMemo(() => railModules(projects, today), [projects, today])
  const views = useMemo(() => railViews(projects, today), [projects, today])
  const moduleOptions = useMemo(() => moduleNames(projects), [projects])

  const selection = useMemo(
    () => selectProjects(projects, { module, view, keyword }, today),
    [projects, module, view, keyword, today]
  )
  const grouped = module === '全部' && !view && keyword.trim() === ''
  const groups = useMemo(() => (grouped
    ? groupByModule(selection, today)
    : [{ module: view ? (smartView(view)?.label ?? '筛选结果') : module, projects: selection, stats: summarize(selection, today) }]),
  [grouped, selection, module, view, today])

  const overviewData = useMemo(() => {
    const sorted = sortByRisk(selection, today)
    return {
      kpis: kpis(selection, today),
      risks: riskBreakdown(selection, today),
      modules: moduleWorkload(selection, today),
      progress: progressBuckets(selection),
      owners: ownerWorkload(selection, today),
      attention: sorted.filter((item) => ATTENTION.includes(item.risk.level)),
      dueSoon: sorted.filter((item) => ['overdue', 'urgent', 'soon'].includes(item.risk.level))
    }
  }, [selection, today])

  const columns = useMemo(() => statusColumns(selection, today), [selection, today])
  const calendar = useMemo(() => calendarMonth(selection, today, month), [selection, today, month])
  const timeline = useMemo(() => timelineModel(selection, today), [selection, today])
  const followUps = useMemo(() => followUpBuckets(selection, today), [selection, today])
  const rows = useMemo(() => sortByRisk(selection, today), [selection, today])

  const selected = selectedId ? projects.find((project) => project.id === selectedId) ?? null : null

  const replaceProject = useCallback((project) => update((current) => ({
    ...current,
    projects: current.projects.map((item) => (item.id === project.id ? project : item))
  })), [update])

  const toggleTodo = useCallback((projectId, todoId) => update((current) => ({
    ...current,
    projects: current.projects.map((project) => (project.id !== projectId ? project : touch({
      ...project,
      todos: (project.todos || []).map((todo) => (todo.id === todoId
        ? { ...todo, done: todo.done !== true, doneAt: todo.done !== true ? new Date().toISOString() : '' }
        : todo))
    })))
  })), [update])

  const ai = useMemo(() => ({
    analysis(project) {
      setAiOutput({
        title: project ? `进展分析提示词 · ${project.name}` : '进展分析提示词 · 全部项目',
        filename: `进展分析-${project ? project.name : '全部项目'}-${today}.md`,
        kind: 'prompt',
        text: buildAnalysisPrompt({ projects, project: project ?? null, today })
      })
    },
    doc(kind, project) {
      const label = (DOCS.find((doc) => doc.value === kind) || { label: '文档' }).label
      setAiOutput({
        title: `${label} · ${project ? project.name : '全部项目'}`,
        filename: `${label}-${project ? project.name : '全部项目'}-${today}.md`,
        kind,
        text: buildDocDraft(kind, { projects, project: project ?? null, today })
      })
    }
  }), [projects, today])

  const seedSamples = useCallback(async (mode = 'append') => {
    markSeedFlag()
    const samples = buildSampleProjects(today)
    const ok = await update((current) => ({
      ...current,
      seededAt: current.seededAt || new Date().toISOString(),
      projects: mode === 'replace' ? samples : [...samples, ...current.projects]
    }))
    if (ok) showToast.current(`已生成 ${sampleSummary(samples)}，可随时删除或清空`)
    return ok
  }, [today, update])

  // 首次进入：文档为空且从来没自动生成过示例时，按模块生成一批。
  const autoSeeded = useRef(false)
  useEffect(() => {
    if (autoSeeded.current || status !== 'ready') return
    if (projects.length !== 0 || state?.seededAt || seedFlagSet()) return
    autoSeeded.current = true
    markSeedFlag()
    const samples = buildSampleProjects(today)
    update(() => ({ version: 1, seededAt: new Date().toISOString(), projects: samples }))
      .then((ok) => {
        if (ok) showToast.current(`首次进入，已生成 ${sampleSummary(samples)}；可随时删除或清空`)
      })
  }, [status, projects.length, state?.seededAt, today, update])

  const openCreate = () => setEditing(blankDraft())
  const openEdit = (project) => setEditing(draftFromProject(project))

  /** 用户在 AI 弹窗里确认后：一次写入，并留下可撤销的一步。 */
  const applyAiPlan = useCallback(async (plan) => {
    let before = null
    const ok = await update((current) => {
      before = current
      return applyPlan(current, plan, today).next
    })
    if (!ok) return
    setAiApplied({ summary: planSummary(plan), undo: before })
    showToast.current(`AI 填充已执行：${planSummary(plan)}`)
  }, [today, update])

  const undoAiPlan = useCallback(() => {
    if (!aiApplied) return
    update(() => aiApplied.undo)
    setAiApplied(null)
    showToast.current('已撤销上一次 AI 填充')
  }, [aiApplied, update])

  const copyOutput = async () => {
    if (!aiOutput) return
    const ok = await copyText(aiOutput.text)
    showToast.current(ok ? '已复制，粘贴到旁边的会话发送即可' : '复制失败，请手动全选复制', ok ? '' : 'danger')
  }

  if (status === 'loading') {
    return h('div', { className: 'pc-root' },
      h('header', { className: 'pc-header' },
        h('div', { className: 'pc-brand' },
          h('div', { className: 'pc-skeleton', style: { width: 32, height: 32, borderRadius: 9 } }),
          h('div', { className: 'pc-brand-text' }, h('div', { className: 'pc-skeleton-line', style: { width: 132 } })))),
      h('nav', { className: 'pc-viewtabs' }, [0, 1, 2, 3, 4].map((index) => h('div', {
        key: index, className: 'pc-skeleton-line', style: { width: 72, height: 26 }
      }))),
      h('div', { className: 'pc-main' },
        h('div', { className: 'pc-content' },
          h('div', { className: 'pc-kpis' }, [0, 1, 2, 3, 4, 5].map((index) => h('div', { key: index, className: 'pc-skeleton', style: { height: 84 } }))),
          h('div', { className: 'pc-dash-grid' }, [0, 1, 2, 3].map((index) => h('div', { key: index, className: 'pc-skeleton', style: { height: 216 } }))))))
  }

  const scopeLabel = [
    module !== '全部' ? module : '全部项目',
    view ? smartView(view)?.label : '',
    keyword.trim() ? `搜索「${keyword.trim()}」` : ''
  ].filter(Boolean).join(' · ')

  const header = h('header', { className: 'pc-header' },
    h('div', { className: 'pc-brand' },
      h('div', { className: 'pc-brand-mark' }, h(Icon, { name: 'target', size: 17 })),
      h('div', { className: 'pc-brand-text' },
        h('div', { className: 'pc-brand-title' }, '项目总控台'),
        h('div', { className: 'pc-brand-sub' },
          `${dashboard.total} 个项目 · ${rail.filter((item) => item.total > 0).length} 个模块 · ${dashboard.attention} 个需关注`))),
    h('span', { className: 'pc-header-spacer' }),
    h(SearchBox, { value: keyword, onChange: setKeyword, placeholder: '搜索项目、负责人、标签或待跟进…', label: '搜索项目' }),
    h(IconBtn, { icon: 'refresh', title: '刷新数据', onClick: reload, disabled: saving }),
    h(Btn, { icon: 'sparkle', onClick: () => setAiOpen(true), title: '用自然语言增删改查项目' }, 'AI 填充'),
    h(Btn, { variant: 'primary', icon: 'plus', onClick: openCreate }, '新建项目'))

  const tabs = h('nav', { className: 'pc-viewtabs', role: 'tablist', 'aria-label': '看板维度' },
    TABS.map((entry) => h('button', {
      key: entry.id, type: 'button', role: 'tab', className: 'pc-viewtab',
      'aria-selected': tab === entry.id,
      onClick: () => setTab(entry.id)
    }, h(Icon, { name: entry.icon, size: 14 }), h('span', null, entry.label))),
    h('span', { className: 'pc-viewtabs-spacer' }),
    h('span', { className: 'pc-scope' }, `${scopeLabel} · ${selection.length} 个`))

  const content = (() => {
    if (error) return null
    if (tab === 'overview') {
      return h(OverviewScreen, {
        today,
        accents,
        onOpen: setSelectedId,
        ask: h(AskCard, { projects, today }),
        ...overviewData
      })
    }
    if (selection.length === 0) {
      return h(Empty, {
        icon: keyword.trim() ? 'search' : view ? 'filter' : 'inbox',
        title: '没有符合条件的项目',
        hint: '试试换个模块、清掉智能视图，或者改一下搜索词。'
      })
    }
    if (tab === 'board') return h(BoardScreen, { groups, today, accents, onOpen: setSelectedId })
    if (tab === 'kanban') return h(KanbanScreen, { columns, accents, onOpen: setSelectedId })
    if (tab === 'list') return h(ListScreen, { rows, today, accents, onOpen: setSelectedId })
    if (tab === 'calendar') {
      return h(CalendarScreen, {
        model: calendar,
        today,
        selectedIso: day,
        onSelect: setDay,
        onShift: (delta) => setMonth((current) => shiftMonth(current, delta)),
        onToday: () => { setMonth(monthKeyOf(today)); setDay(today) },
        onOpen: setSelectedId,
        onToggleTodo: toggleTodo
      })
    }
    if (tab === 'timeline') return h(TimelineScreen, { model: timeline, today, accents, onOpen: setSelectedId })
    return h(FollowUpsScreen, { buckets: followUps, today, onToggle: toggleTodo, onOpen: setSelectedId })
  })()

  return h('div', { className: 'pc-root' },
    header,
    tabs,
    h('div', { className: 'pc-main' },
      h('nav', { className: 'pc-rail', 'aria-label': '模块与智能视图' },
        h('div', { className: 'pc-rail-group' },
          h('div', { className: 'pc-rail-label' }, '模块'),
          h('button', {
            type: 'button', className: 'pc-rail-item', 'aria-current': module === '全部' && !view,
            onClick: () => { setModule('全部'); setView('') }
          },
          h(Icon, { name: 'grid', size: 14 }),
          h('span', { className: 'pc-rail-item-name' }, '全部项目'),
          h('span', { className: 'pc-rail-count' }, String(dashboard.total))),
          rail.map((entry) => h('button', {
            key: entry.name, type: 'button',
            className: `pc-rail-item pc-accent-${accents[entry.name] ?? 'indigo'}`,
            'aria-current': module === entry.name && !view,
            title: `${entry.name} · ${entry.total} 个项目`,
            onClick: () => { setModule(entry.name); setView('') }
          },
          h('span', {
            className: 'pc-dot',
            style: { background: entry.overdue > 0 ? 'var(--pc-danger)' : entry.danger > 0 ? 'var(--pc-warn)' : 'var(--pc-line-3)' }
          }),
          h('span', { className: 'pc-rail-item-name' }, entry.name),
          h('span', { className: 'pc-rail-count' }, String(entry.total))))),
        h('div', { className: 'pc-rail-group' },
          h('div', { className: 'pc-rail-label' }, '智能视图'),
          views.map((entry) => h('button', {
            key: entry.id, type: 'button', className: 'pc-rail-item',
            'aria-current': view === entry.id, title: entry.hint,
            onClick: () => { setView(view === entry.id ? '' : entry.id); setModule('全部') }
          },
          h(Icon, { name: entry.id === 'attention' ? 'alert' : entry.id === 'overdue' ? 'clock' : entry.id === 'week' ? 'calendar' : entry.id === 'todos' ? 'check' : 'inbox', size: 14 }),
          h('span', { className: 'pc-rail-item-name' }, entry.label),
          h('span', { className: 'pc-rail-count' }, String(entry.total))))),
        h('div', { className: 'pc-rail-foot' },
          h('div', { className: 'pc-rail-state' },
            saving ? '保存中…' : status === 'error' ? '读取失败' : `已保存 · 修订 ${revision}`),
          h('div', { className: 'pc-rail-actions' },
            h(Btn, { size: 'sm', icon: 'sparkle', disabled: saving, title: '按模块生成示例项目', onClick: () => seedSamples('append') }, '示例数据'),
            projects.length > 0
              ? h(Btn, { size: 'sm', icon: 'trash', variant: 'danger', disabled: saving, onClick: () => setConfirmClear(true) }, '清空')
              : null),
          h('div', { className: 'pc-rail-note' }, '数据存于 DSH 数据目录，卸载工作台不会删除'))),

      h('main', { className: 'pc-content' },
        error
          ? h(Notice, {
            tone: 'danger',
            action: h('div', { className: 'pc-chips' },
              h(Btn, { size: 'sm', onClick: () => { setError(''); if (conflict) reload() } }, conflict ? '重新加载' : '重试'))
          }, error)
          : null,

        aiApplied
          ? h('div', { className: 'pc-undobar' },
            h(Icon, { name: 'check', size: 14 }),
            h('span', null, `AI 填充已执行：${aiApplied.summary}`),
            h('span', { className: 'pc-spacer' }),
            h(Btn, { size: 'sm', onClick: undoAiPlan }, '撤销'),
            h(IconBtn, { icon: 'close', size: 'sm', title: '关闭', onClick: () => setAiApplied(null) }))
          : null,

        content,

        aiOutput
          ? h('section', { className: 'pc-panel-block' },
            h('div', { className: 'pc-panel-head' },
              h(Icon, { name: 'sparkle', size: 14 }),
              h('h3', null, aiOutput.title),
              h('span', { className: 'pc-spacer' }),
              h(Btn, { size: 'sm', icon: 'copy', variant: 'primary', onClick: copyOutput }, '复制'),
              h(Btn, {
                size: 'sm', icon: 'download',
                onClick: () => showToast.current(downloadMarkdown(aiOutput.filename, aiOutput.text) ? `已下载 ${aiOutput.filename}` : '下载失败', 'danger')
              }, '下载 .md'),
              h(IconBtn, { icon: 'close', size: 'sm', title: '收起', onClick: () => setAiOutput(null) })),
            h('div', { className: 'pc-muted' }, aiOutput.kind === 'prompt'
              ? '这是给 Agent 的提示词：复制后粘贴到旁边的原生会话发送，Agent 会基于这些登记数据做分析。'
              : deliveryHint(aiOutput.kind)),
            h('textarea', {
              className: 'pc-doc', value: aiOutput.text, 'aria-label': aiOutput.title,
              onChange: (event) => setAiOutput({ ...aiOutput, text: event.target.value })
            }))
          : null)),

    selected
      ? h(Sheet, {
        open: true,
        title: selected.name,
        badge: [
          h(Badge, { key: 'module', tone: 'muted' }, selected.module || '其他项目'),
          h(Badge, { key: 'status', tone: 'muted' }, selected.status || '进行中'),
          h(RiskBadge, { key: 'risk', risk: projectRisk(selected, today) })
        ],
        onClose: () => setSelectedId(''),
        children: h(DetailBody, {
          project: selected,
          risk: projectRisk(selected, today),
          today,
          onChange: replaceProject,
          ai,
          onEdit: () => openEdit(selected),
          onDelete: () => setConfirmDelete(selected)
        })
      })
      : null,

    editing
      ? h(ProjectForm, {
        draft: editing,
        existing: editing.id ? projects.find((project) => project.id === editing.id) ?? null : null,
        moduleOptions,
        onCancel: () => setEditing(null),
        onSubmit: (project) => {
          const isNew = !editing.id
          update((current) => ({
            ...current,
            projects: isNew
              ? [project, ...current.projects]
              : current.projects.map((item) => (item.id === project.id ? project : item))
          }))
          setEditing(null)
          setSelectedId(project.id)
          showToast.current(isNew ? '已创建项目' : '已保存修改')
        }
      })
      : null,

    aiOpen
      ? h(AiFillModal, {
        projects,
        today,
        onClose: () => setAiOpen(false),
        onApplied: applyAiPlan
      })
      : null,

    confirmClear
      ? h(Modal, {
        open: true,
        title: '清空全部项目？',
        icon: 'alert',
        onClose: () => setConfirmClear(false),
        footer: [
          h(Btn, { key: 'cancel', onClick: () => setConfirmClear(false) }, '取消'),
          h(Btn, {
            key: 'ok', variant: 'primary', icon: 'trash',
            onClick: () => {
              update((current) => ({
                ...current,
                seededAt: current.seededAt || new Date().toISOString(),
                projects: []
              }))
              setSelectedId('')
              setConfirmClear(false)
              showToast.current('已清空全部项目')
            }
          }, '确认清空')
        ]
      }, h('div', null, `将删除工作台里的 ${projects.length} 条项目记录（含示例数据）。不会动任何文件或工作区。`))
      : null,

    confirmDelete
      ? h(Modal, {
        open: true,
        title: `删除「${confirmDelete.name}」？`,
        icon: 'alert',
        onClose: () => setConfirmDelete(null),
        footer: [
          h(Btn, { key: 'cancel', onClick: () => setConfirmDelete(null) }, '取消'),
          h(Btn, {
            key: 'ok', variant: 'primary', icon: 'trash',
            onClick: () => {
              update((current) => ({ ...current, projects: current.projects.filter((item) => item.id !== confirmDelete.id) }))
              setSelectedId('')
              setConfirmDelete(null)
              showToast.current('已删除项目')
            }
          }, '确认删除')
        ]
      }, h('div', null, '删除只影响本工作台里的这条记录，不会动任何文件或工作区。'))
      : null,

    h(Toast, { message: toast.toast?.message, tone: toast.toast?.tone, onDone: toast.clear }))
}

/** 接数据的外壳：宿主挂载的就是它。 */
export function ProjectConsole() {
  const portfolio = usePortfolio()
  return h(ConsoleView, { portfolio })
}
