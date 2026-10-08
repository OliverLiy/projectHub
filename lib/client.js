// 本文件由 scripts/build-client.mjs 从 src/ 生成，请勿直接修改。
window.__ModuleLoader__.load({
  id: "dsh-workbench-project-console",
  factory: (require) => {
    const __factories = Object.create(null)
    const __cache = Object.create(null)
    function __require(id) {
      if (__factories[id] === undefined) return require(id)
      if (__cache[id] !== undefined) return __cache[id].exports
      const module = { exports: {} }
      __cache[id] = module
      __factories[id](module.exports, module, __require)
      return module.exports
    }
  __factories["client/index.js"] = function (exports, module, __require) {
    /** 工作台客户端入口：向 Desktop 注册业务面板。 */
    const React = __require("react")
    const { ConsoleView, ProjectConsole } = __require("client/panel.js")
    const REPOSITORY = 'https://github.com/OliverLiy/projectHub'

    function apply(ctx) {
      ctx.effect(() => ctx.desktopWorkbenches.register({
        title: '项目总控台',
        repository: REPOSITORY,
        description: '按模块管理全部项目：状态、进度、待跟进与 DDL 风险一屏看完，可问询、可生成汇报文档。',
        panelTitle: '项目总控台',
        category: '项目管理',
        icon: '📋',
        // embedded + businessSide: left 是宿主支持的"左侧嵌入式业务面板"结构：
        // 顶栏作为根节点首个子元素，macOS 收起侧栏时宿主会为窗口按钮预留宽度。
        embedded: true,
        layout: { businessSide: 'left', businessWidth: 0.68 }
      }, ProjectConsole), 'project-console: register workbench')
    }

    const inject = ['desktopWorkbenches']

    // 额外导出便于不启动 Desktop 也能渲染面板做自测；模块加载器只读取 apply/inject。

    module.exports = { apply, inject, ConsoleView, ProjectConsole }
  }
  __factories["client/panel.js"] = function (exports, module, __require) {
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
    const React = __require("react")
    const { ApiError, askAi, newId, readState, writeState } = __require("client/api.js")
    const { CSS, STYLE_ID } = __require("client/styles.js")
    const { Badge, Btn, Empty, Field, Icon, IconBtn, Modal, Notice, Progress, RiskBadge, SearchBox, Sheet, Toast, useToast } = __require("client/ui.js")
    const { BoardScreen, CalendarScreen, FollowUpsScreen, KanbanScreen, ListScreen, OverviewScreen, TimelineScreen } = __require("client/screens.js")
    const { MODULES, STATUSES, clampProgress, daysLeft, formatRemaining, moduleNames, openTodos, projectRisk, sortByRisk, todayISO } = __require("shared/analysis.js")
    const { QUESTION_EXAMPLES, answerQuestion } = __require("shared/query.js")
    const { buildAnalysisPrompt, buildDocDraft, docKinds, deliveryHint } = __require("shared/prompt.js")
    const { groupByModule, railModules, railViews, selectProjects, smartView, summarize } = __require("shared/views.js")
    const { buildSampleProjects, sampleSummary } = __require("shared/sample.js")
    const { applyPlan, planSummary, previewPlan, revalidatePlan } = __require("shared/aiplan.js")
    const { calendarMonth, followUpBuckets, kpis, moduleAccentMap, moduleWorkload, monthKeyOf, ownerWorkload, progressBuckets, riskBreakdown, shiftMonth, statusColumns, timelineModel } = __require("shared/insights.js")
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

    function ProjectForm({ draft, existing, moduleOptions, onSubmit, onCancel }) {
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

    function ConsoleView({ portfolio }) {
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
    function ProjectConsole() {
      const portfolio = usePortfolio()
      return h(ConsoleView, { portfolio })
    }

    module.exports = { ProjectForm, ConsoleView, ProjectConsole }
  }
  __factories["client/api.js"] = function (exports, module, __require) {
    /** 客户端访问本工作台服务端接口的薄封装。 */
    const PREFIX = '/api/project-console'

    class ApiError extends Error {
      constructor(message, status) {
        super(message)
        this.name = 'ApiError'
        this.status = status
      }
    }

    function newId(prefix = 'p') {
      return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    }

    async function parse(response) {
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        throw new ApiError((payload && payload.error) || `请求失败（HTTP ${response.status}）`, response.status)
      }
      return payload
    }

    /** 读取项目文档。 */
    async function readState() {
      const response = await fetch(`${PREFIX}/state`, { credentials: 'same-origin', cache: 'no-store' })
      const payload = await parse(response)
      if (!payload || typeof payload !== 'object') throw new ApiError('服务端返回了无法识别的数据。', 500)
      return { revision: Number(payload.revision) || 0, state: payload.state || { version: 1, projects: [] } }
    }

    /** 让 AI 把自然语言指令解析成变更计划（不落库）。 */
    async function askAi(instruction, projects, today) {
      const response = await fetch(`${PREFIX}/ai`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, projects, today })
      })
      if (response.status === 404) {
        throw new ApiError('服务端还没加载 AI 解析接口（重启 Harness 后可用）。', 404)
      }
      const payload = await parse(response)
      if (!payload || typeof payload !== 'object' || !payload.plan) {
        throw new ApiError('服务端没有返回可用的变更计划。', 500)
      }
      return payload
    }

    /** 整体替换项目文档；版本号不一致时抛 409。 */
    async function writeState(revision, state) {
      const response = await fetch(`${PREFIX}/state`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision, state })
      })
      return parse(response)
    }

    module.exports = { ApiError, newId, readState, askAi, writeState }
  }
  __factories["client/styles.js"] = function (exports, module, __require) {
    /**
     * 面板样式：优先复用宿主的设计令牌（--dsw-*），拿不到时退回自己的回退值，
     * 这样在 Desktop 里跟主题一致，在 Node 里做渲染测试也能跑。
     *
     * 布局用容器查询而不是媒体查询：面板宽度由宿主分配，跟视口宽度无关。
     * 模块强调色用 --pc-accent-h 一个色相变量驱动，卡条、圆点、页签都跟着它走。
     */
    const STYLE_ID = 'dsh-project-console-style'

    const CSS = `
    .pc-root{
      --pc-bg:var(--dsw-alias-bg-base,#ffffff);
      --pc-panel:var(--dsw-alias-bg-layer-2,#ffffff);
      --pc-sunken:color-mix(in srgb,var(--pc-text) 5%,var(--pc-panel));
      --pc-hover:color-mix(in srgb,var(--pc-text) 6%,transparent);
      --pc-text:var(--dsw-alias-label-primary,#16181d);
      --pc-text-2:var(--dsw-alias-label-secondary,#596171);
      --pc-text-3:var(--dsw-alias-label-tertiary,#7b8496);
      --pc-text-4:var(--dsw-alias-label-caption,#9aa2b1);
      --pc-line:var(--dsw-alias-border-l1,rgba(0,0,0,.06));
      --pc-line-2:var(--dsw-alias-border-l2,rgba(0,0,0,.10));
      --pc-line-3:var(--dsw-alias-border-l3,rgba(0,0,0,.16));
      --pc-brand:var(--dsw-alias-brand-primary,#16181d);
      --pc-brand-fill:var(--dsw-alias-button-primary-fill,#16181d);
      --pc-brand-hover:var(--dsw-alias-button-primary-hover,#2b303b);
      --pc-on-brand:var(--dsw-alias-label-primary-foreground,#ffffff);
      --pc-danger:var(--dsw-alias-state-error-primary,#d92d20);
      --pc-warn:var(--dsw-alias-state-warn-primary,#b54708);
      --pc-ok:var(--dsw-alias-state-success-primary,#067647);
      --pc-info:var(--dsw-alias-state-business-primary,#2f6bff);
      --pc-danger-soft:color-mix(in srgb,var(--pc-danger) 13%,transparent);
      --pc-warn-soft:color-mix(in srgb,var(--pc-warn) 15%,transparent);
      --pc-ok-soft:color-mix(in srgb,var(--pc-ok) 13%,transparent);
      --pc-info-soft:color-mix(in srgb,var(--pc-info) 13%,transparent);
      --pc-r-xs:var(--dsw-radius-xs,4px);
      --pc-r-sm:var(--dsw-radius-sm,8px);
      --pc-r-md:var(--dsw-radius-md,12px);
      --pc-r-lg:var(--dsw-radius-lg,16px);
      --pc-shadow-1:0 1px 2px rgba(16,24,40,.05);
      --pc-shadow-2:0 8px 22px rgba(16,24,40,.10);
      --pc-shadow-3:0 20px 48px rgba(16,24,40,.20);
      --pc-accent-h:239;

      position:relative;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;
      container-type:inline-size;container-name:pc-app;
      background:var(--pc-bg);color:var(--pc-text);
      font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif);
      font-size:13px;line-height:1.55;-webkit-font-smoothing:antialiased;box-sizing:border-box;
    }
    .pc-root *,.pc-root *::before,.pc-root *::after{box-sizing:border-box}
    .pc-root :where(button,input,select,textarea){font:inherit;color:inherit}
    .pc-root ::-webkit-scrollbar{width:10px;height:10px}
    .pc-root ::-webkit-scrollbar-thumb{background:var(--pc-line-3);border:3px solid transparent;background-clip:content-box;border-radius:999px}
    .pc-root ::-webkit-scrollbar-thumb:hover{background:var(--pc-text-4);background-clip:content-box}
    .pc-root ::-webkit-scrollbar-track{background:transparent}
    .pc-root :focus-visible{outline:2px solid var(--pc-info);outline-offset:2px;border-radius:var(--pc-r-xs)}
    @media (prefers-reduced-motion:reduce){.pc-root *{transition:none!important;animation:none!important}}

    /* 模块强调色 */
    .pc-accent-indigo{--pc-accent-h:239}
    .pc-accent-teal{--pc-accent-h:173}
    .pc-accent-amber{--pc-accent-h:32}
    .pc-accent-violet{--pc-accent-h:271}
    .pc-accent-rose{--pc-accent-h:346}
    .pc-accent-cyan{--pc-accent-h:189}
    .pc-root .pc-accent{--pc-accent:hsl(var(--pc-accent-h) 72% 56%)}
    .pc-card,.pc-rail-item,.pc-mini,.pc-module{--pc-accent:hsl(var(--pc-accent-h) 72% 56%)}

    /* 语义色（SVG 里用 currentColor） */
    .pc-c-danger{color:var(--pc-danger)}
    .pc-c-warn{color:var(--pc-warn)}
    .pc-c-ok{color:var(--pc-ok)}
    .pc-c-info{color:var(--pc-info)}
    .pc-c-muted{color:var(--pc-text-4)}
    .pc-dot{width:7px;height:7px;border-radius:999px;background:currentColor;flex:0 0 auto;display:inline-block}
    .pc-accent-dot{width:7px;height:7px;border-radius:2px;background:hsl(var(--pc-accent-h) 72% 56%);flex:0 0 auto;display:inline-block}
    .pc-root .pc-link{border:0;background:transparent;padding:0;cursor:pointer;color:var(--pc-text);text-align:left;text-decoration:underline;text-decoration-color:var(--pc-line-3);text-underline-offset:3px}
    .pc-root .pc-link:hover{text-decoration-color:var(--pc-info);color:var(--pc-info)}

    /* ---------------------------------------------------------------- 顶栏 */
    .pc-header{
      display:flex;align-items:center;gap:12px;flex:0 0 auto;height:58px;padding:0 16px;
      border-bottom:1px solid var(--pc-line);background:var(--pc-panel);
    }
    .pc-brand{display:flex;align-items:center;gap:10px;min-width:0}
    .pc-brand-mark{
      display:grid;place-items:center;width:32px;height:32px;border-radius:10px;flex:0 0 auto;
      background:linear-gradient(150deg,var(--pc-brand-fill),color-mix(in srgb,var(--pc-brand-fill) 62%,var(--pc-info)));
      color:var(--pc-on-brand);box-shadow:var(--pc-shadow-1)
    }
    .pc-brand-text{display:flex;flex-direction:column;min-width:0}
    .pc-brand-title{font-size:14px;font-weight:600;letter-spacing:.01em;white-space:nowrap}
    .pc-brand-sub{font-size:11px;color:var(--pc-text-3);white-space:nowrap}
    .pc-header-spacer{flex:1 1 auto;min-width:8px}
    .pc-search{position:relative;display:flex;align-items:center;flex:0 1 300px;min-width:120px}
    .pc-search .pc-icon{position:absolute;left:9px;color:var(--pc-text-4);pointer-events:none}
    .pc-search input{
      width:100%;height:32px;padding:0 28px 0 30px;border:1px solid var(--pc-line-2);border-radius:999px;
      background:var(--pc-sunken);transition:border-color .15s,background .15s,box-shadow .15s;
    }
    .pc-search input:hover{border-color:var(--pc-line-3)}
    .pc-search input:focus{outline:none;border-color:var(--pc-info);background:var(--pc-panel);box-shadow:0 0 0 3px var(--pc-info-soft)}
    .pc-search-clear{position:absolute;right:7px;display:grid;place-items:center;width:20px;height:20px;border:0;border-radius:999px;background:transparent;color:var(--pc-text-3);cursor:pointer}
    .pc-search-clear:hover{background:var(--pc-hover);color:var(--pc-text)}

    /* ------------------------------------------------------------ 视图页签 */
    .pc-viewtabs{
      display:flex;align-items:center;gap:2px;flex:0 0 auto;padding:6px 14px;min-height:44px;
      border-bottom:1px solid var(--pc-line);background:var(--pc-panel);overflow-x:auto;
    }
    .pc-viewtab{
      display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:0;border-radius:var(--pc-r-sm);
      background:transparent;color:var(--pc-text-2);cursor:pointer;white-space:nowrap;
      transition:background .15s,color .15s;
    }
    .pc-viewtab:hover{background:var(--pc-hover);color:var(--pc-text)}
    .pc-viewtab[aria-selected=true]{background:color-mix(in srgb,var(--pc-info) 14%,transparent);color:var(--pc-info);font-weight:600}
    .pc-viewtabs-spacer{flex:1 1 auto;min-width:12px}
    .pc-scope{font-size:11px;color:var(--pc-text-3);white-space:nowrap;font-variant-numeric:tabular-nums}

    /* ---------------------------------------------------------------- 按钮 */
    .pc-btn{
      display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;
      border:1px solid transparent;border-radius:var(--pc-r-sm);background:transparent;color:var(--pc-text);
      cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
    }
    .pc-btn:hover:not(:disabled){background:var(--pc-hover)}
    .pc-btn:disabled{opacity:.45;cursor:not-allowed}
    .pc-btn-primary{background:var(--pc-brand-fill);color:var(--pc-on-brand);box-shadow:var(--pc-shadow-1)}
    .pc-btn-primary:hover:not(:disabled){background:var(--pc-brand-hover)}
    .pc-btn-outline{border-color:var(--pc-line-2);background:var(--pc-panel)}
    .pc-btn-outline:hover:not(:disabled){border-color:var(--pc-line-3);background:var(--pc-sunken)}
    .pc-btn-danger{color:var(--pc-danger)}
    .pc-btn-danger:hover:not(:disabled){background:var(--pc-danger-soft)}
    .pc-btn-sm{height:26px;padding:0 9px;font-size:12px;border-radius:var(--pc-r-xs)}
    .pc-iconbtn{
      display:inline-grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid transparent;
      border-radius:var(--pc-r-sm);background:transparent;color:var(--pc-text-2);cursor:pointer;transition:background .15s,color .15s;
    }
    .pc-iconbtn:hover:not(:disabled){background:var(--pc-hover);color:var(--pc-text)}
    .pc-iconbtn:disabled{opacity:.45;cursor:not-allowed}
    .pc-iconbtn-sm{width:26px;height:26px;border-radius:var(--pc-r-xs)}
    .pc-iconbtn-danger:hover:not(:disabled){background:var(--pc-danger-soft);color:var(--pc-danger)}
    .pc-seg{display:inline-flex;gap:2px;padding:2px;border-radius:var(--pc-r-sm);background:var(--pc-sunken)}
    .pc-seg button{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border:0;border-radius:var(--pc-r-xs);background:transparent;color:var(--pc-text-2);cursor:pointer}
    .pc-seg button[aria-pressed=true]{background:var(--pc-panel);color:var(--pc-text);box-shadow:var(--pc-shadow-1)}

    /* ---------------------------------------------------------------- 主体 */
    .pc-main{display:flex;flex:1 1 auto;min-height:0;min-width:0}
    .pc-rail{
      display:flex;flex-direction:column;gap:14px;flex:0 0 208px;min-width:0;padding:14px 10px;
      border-right:1px solid var(--pc-line);background:var(--pc-panel);overflow:auto;
    }
    .pc-rail-group{display:flex;flex-direction:column;gap:2px;min-width:0}
    .pc-rail-label{padding:0 8px 4px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--pc-text-4)}
    .pc-rail-item{
      position:relative;display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;
      border-radius:var(--pc-r-sm);background:transparent;color:var(--pc-text-2);cursor:pointer;text-align:left;
      transition:background .15s,color .15s;
    }
    .pc-rail-item:hover{background:var(--pc-hover);color:var(--pc-text)}
    .pc-rail-item[aria-current=true]{background:color-mix(in srgb,var(--pc-accent) 13%,transparent);color:var(--pc-text);font-weight:600}
    .pc-rail-item[aria-current=true]::before{
      content:'';position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:999px;background:var(--pc-accent);
    }
    .pc-rail-item-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pc-rail-count{flex:0 0 auto;font-size:11px;color:var(--pc-text-4);font-variant-numeric:tabular-nums}
    .pc-rail-item[aria-current=true] .pc-rail-count{color:var(--pc-text-2)}
    .pc-rail-foot{margin-top:auto;display:flex;flex-direction:column;gap:7px;padding:9px 8px 4px;border-top:1px solid var(--pc-line)}
    .pc-rail-state{font-size:10.5px;color:var(--pc-text-3)}
    .pc-rail-actions{display:flex;gap:6px;flex-wrap:wrap}
    .pc-rail-note{font-size:10px;line-height:1.5;color:var(--pc-text-4)}

    .pc-content{flex:1 1 auto;min-width:0;min-height:0;overflow:auto;padding:16px 18px 30px;display:flex;flex-direction:column;gap:16px}

    /* ------------------------------------------------------------------ KPI */
    .pc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px}
    .pc-kpi{
      position:relative;display:flex;flex-direction:column;gap:2px;padding:11px 13px;border:1px solid var(--pc-line-2);
      border-radius:var(--pc-r-md);background:var(--pc-panel);transition:border-color .15s,box-shadow .15s,transform .15s;
    }
    .pc-kpi:hover{border-color:var(--pc-line-3);box-shadow:var(--pc-shadow-1);transform:translateY(-1px)}
    .pc-kpi-top{display:flex;align-items:center;gap:6px;color:var(--pc-text-3);font-size:11.5px}
    .pc-kpi-value{font-size:25px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
    .pc-kpi-foot{font-size:11px;color:var(--pc-text-4)}
    .pc-kpi-danger .pc-kpi-value{color:var(--pc-danger)}
    .pc-kpi-warn .pc-kpi-value{color:var(--pc-warn)}
    .pc-kpi-ok .pc-kpi-value{color:var(--pc-ok)}

    /* -------------------------------------------------------------- 面板块 */
    .pc-panel-block{
      display:flex;flex-direction:column;gap:12px;padding:14px 15px;border:1px solid var(--pc-line-2);
      border-radius:var(--pc-r-md);background:var(--pc-panel);min-width:0;
    }
    .pc-panel-head{display:flex;align-items:center;gap:8px;color:var(--pc-text-3)}
    .pc-panel-head h3{margin:0;font-size:12.5px;font-weight:600;color:var(--pc-text);letter-spacing:.01em}
    .pc-panel-head .pc-spacer{flex:1 1 auto}
    .pc-dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(242px,1fr));gap:14px;align-items:start}
    .pc-hero{flex-direction:row;align-items:center;gap:12px}
    .pc-hero-mark{
      display:grid;place-items:center;width:34px;height:34px;border-radius:10px;flex:0 0 auto;
      background:var(--pc-info-soft);color:var(--pc-info)
    }
    .pc-hero-title{font-size:12.5px;color:var(--pc-text-3)}
    .pc-hero-sub{font-size:14px;font-weight:600;letter-spacing:-.01em}

    /* -------------------------------------------------------------- 图与表 */
    .pc-donut{position:relative;flex:0 0 auto}
    .pc-donut-track{stroke:var(--pc-sunken)}
    .pc-donut-slice{stroke:currentColor;transition:stroke-dasharray .3s ease}
    .pc-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
    .pc-donut-center b{font-size:22px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}
    .pc-donut-center span{font-size:10.5px;color:var(--pc-text-4)}
    .pc-donut-wrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
    .pc-legend{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none;min-width:120px;flex:1 1 auto}
    .pc-legend li{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--pc-text-2)}
    .pc-legend i{width:9px;height:9px;border-radius:3px;background:currentColor;flex:0 0 auto}
    .pc-legend b{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--pc-text)}

    .pc-stacked{display:flex;flex-direction:column;gap:10px}
    .pc-stacked-head{display:flex;align-items:baseline;gap:8px;font-size:12px}
    .pc-stacked-label{color:var(--pc-text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pc-stacked-meta{margin-left:auto;font-size:11px;color:var(--pc-text-4);white-space:nowrap}
    .pc-stacked-track{display:flex;height:9px;border-radius:999px;background:var(--pc-sunken);overflow:hidden;margin-top:5px}
    .pc-stacked-seg{display:block;height:100%;background:currentColor;transition:width .3s ease}
    .pc-stacked-seg+.pc-stacked-seg{margin-left:1px}

    .pc-hist{display:flex;align-items:flex-end;gap:8px;height:150px;padding-top:6px}
    .pc-hist-col{flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;min-width:0}
    .pc-hist-track{flex:1 1 auto;width:100%;display:flex;align-items:flex-end;justify-content:center}
    .pc-hist-bar{width:70%;max-width:34px;border-radius:6px 6px 3px 3px;background:linear-gradient(180deg,var(--pc-info),color-mix(in srgb,var(--pc-info) 55%,transparent));transition:height .3s ease}
    .pc-hist-empty{background:var(--pc-sunken)}
    .pc-hist-col b{font-size:12px;font-variant-numeric:tabular-nums}
    .pc-hist-col span{font-size:10px;color:var(--pc-text-4);white-space:nowrap}

    .pc-rank{display:flex;flex-direction:column;gap:9px}
    .pc-rank-row{display:grid;grid-template-columns:76px 1fr 26px auto;align-items:center;gap:8px;font-size:12px}
    .pc-rank-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pc-text-2)}
    .pc-rank-track{position:relative;display:flex;height:9px;border-radius:999px;background:var(--pc-sunken);overflow:hidden}
    .pc-rank-fill{display:block;height:100%;background:hsl(var(--pc-accent-h) 72% 56%);opacity:.75}
    .pc-rank-danger{display:block;height:100%;background:var(--pc-danger)}
    .pc-rank-row b{font-variant-numeric:tabular-nums;text-align:right}
    .pc-rank-row small{color:var(--pc-text-4);font-size:10.5px;white-space:nowrap}

    .pc-attn-list{display:flex;flex-direction:column}
    .pc-attn{display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:9px;padding:7px 4px;border:0;border-bottom:1px solid var(--pc-line);background:transparent;cursor:pointer;text-align:left;width:100%;border-radius:var(--pc-r-xs)}
    .pc-attn:last-child{border-bottom:0}
    .pc-attn:hover{background:var(--pc-hover)}
    .pc-attn-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}

    /* ---------------------------------------------------------------- 卡片 */
    .pc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:10px}
    .pc-card{
      position:relative;display:flex;flex-direction:column;gap:9px;padding:12px 13px 12px 15px;
      border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel);
      cursor:pointer;text-align:left;overflow:hidden;
      transition:border-color .15s,box-shadow .18s,transform .18s;
    }
    .pc-card:hover{border-color:var(--pc-accent);box-shadow:var(--pc-shadow-2);transform:translateY(-2px)}
    .pc-card-accent{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--pc-accent);opacity:.85}
    .pc-card-top{display:flex;align-items:flex-start;gap:8px;min-width:0}
    .pc-card-name{flex:1 1 auto;font-size:13.5px;font-weight:600;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
    .pc-card-sum{font-size:11.5px;color:var(--pc-text-3);overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
    .pc-card-tags{display:flex;gap:5px;flex-wrap:wrap}
    .pc-tag{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:var(--pc-r-xs);background:var(--pc-sunken);color:var(--pc-text-3);font-size:10.5px;white-space:nowrap}
    .pc-card-foot{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--pc-text-3);flex-wrap:wrap}
    .pc-card-foot b{color:var(--pc-text-2);font-weight:600;font-variant-numeric:tabular-nums}
    .pc-progress{height:4px;border-radius:999px;background:var(--pc-sunken);overflow:hidden}
    .pc-progress>i{display:block;height:100%;border-radius:999px;background:var(--pc-brand-fill);transition:width .25s}
    .pc-progress-danger>i{background:var(--pc-danger)}
    .pc-progress-warn>i{background:var(--pc-warn)}
    .pc-progress-ok>i{background:var(--pc-ok)}
    .pc-badge{display:inline-flex;align-items:center;gap:5px;height:21px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:500;white-space:nowrap;border:1px solid transparent}
    .pc-badge i{width:5px;height:5px;border-radius:999px;background:currentColor}
    .pc-tone-danger{background:var(--pc-danger-soft);color:var(--pc-danger);border-color:color-mix(in srgb,var(--pc-danger) 26%,transparent)}
    .pc-tone-warn{background:var(--pc-warn-soft);color:var(--pc-warn);border-color:color-mix(in srgb,var(--pc-warn) 26%,transparent)}
    .pc-tone-ok{background:var(--pc-ok-soft);color:var(--pc-ok);border-color:color-mix(in srgb,var(--pc-ok) 24%,transparent)}
    .pc-tone-info{background:var(--pc-info-soft);color:var(--pc-info);border-color:color-mix(in srgb,var(--pc-info) 24%,transparent)}
    .pc-tone-muted{background:var(--pc-sunken);color:var(--pc-text-3);border-color:var(--pc-line-2)}
    .pc-pill{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;background:var(--pc-sunken);color:var(--pc-text-3);font-size:11px;font-variant-numeric:tabular-nums}

    /* -------------------------------------------------------------- 模块分组 */
    .pc-module{display:flex;flex-direction:column;gap:10px}
    .pc-module-head{display:flex;align-items:center;gap:9px;padding:0 2px}
    .pc-module-title{font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:8px}
    .pc-module-bar{width:3px;height:15px;border-radius:999px;background:var(--pc-accent)}
    .pc-module-meta{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--pc-text-3);flex-wrap:wrap}

    /* ---------------------------------------------------------------- 看板 */
    .pc-kanban{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:6px}
    .pc-kanban-col{
      flex:1 1 0;min-width:188px;display:flex;flex-direction:column;gap:9px;padding:11px;
      border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-sunken);
    }
    .pc-kanban-head{display:flex;align-items:center;gap:7px;font-size:12.5px}
    .pc-kanban-head b{font-weight:600}
    .pc-kanban-body{display:flex;flex-direction:column;gap:7px}
    .pc-mini{
      position:relative;display:flex;flex-direction:column;gap:5px;padding:9px 10px 9px 12px;border:1px solid var(--pc-line-2);
      border-radius:var(--pc-r-sm);background:var(--pc-panel);cursor:pointer;text-align:left;overflow:hidden;
      transition:border-color .15s,box-shadow .15s,transform .15s;
    }
    .pc-mini::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--pc-accent)}
    .pc-mini:hover{border-color:var(--pc-accent);box-shadow:var(--pc-shadow-1);transform:translateY(-1px)}
    .pc-mini-name{font-size:12.5px;font-weight:600;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .pc-mini-meta{display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--pc-text-3);flex-wrap:wrap}

    /* ---------------------------------------------------------------- 列表 */
    .pc-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
    .pc-table th{position:sticky;top:0;z-index:1;padding:9px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--pc-text-3);background:var(--pc-panel);border-bottom:1px solid var(--pc-line-2);white-space:nowrap}
    .pc-table td{padding:10px;border-bottom:1px solid var(--pc-line);vertical-align:middle}
    .pc-table tbody tr{cursor:pointer}
    .pc-table tbody tr:hover td{background:var(--pc-hover)}
    .pc-table .pc-num{font-variant-numeric:tabular-nums;white-space:nowrap}
    .pc-table .pc-name{font-weight:600;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pc-table .pc-name .pc-accent-dot{margin-right:7px;vertical-align:middle}
    .pc-table-wrap{border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel);overflow:hidden}

    /* ---------------------------------------------------------------- 日历 */
    .pc-cal{display:flex;flex-direction:column;gap:12px}
    .pc-cal-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .pc-cal-title{display:flex;align-items:baseline;gap:9px}
    .pc-cal-title b{font-size:15px;font-weight:600}
    .pc-cal-actions{margin-left:auto;display:flex;align-items:center;gap:6px}
    .pc-cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
    .pc-cal-weekdays span{padding:2px 0;text-align:center;font-size:10.5px;color:var(--pc-text-4)}
    .pc-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
    .pc-cal-cell{
      display:flex;flex-direction:column;gap:4px;min-height:84px;padding:6px 7px;border:1px solid var(--pc-line);
      border-radius:var(--pc-r-sm);background:var(--pc-panel);cursor:pointer;text-align:left;overflow:hidden;
      transition:border-color .15s,box-shadow .15s,background .15s;
    }
    .pc-cal-cell:hover{border-color:var(--pc-line-3);box-shadow:var(--pc-shadow-1)}
    .pc-cal-weekend{background:color-mix(in srgb,var(--pc-text) 3%,var(--pc-panel))}
    .pc-cal-out{opacity:.42}
    .pc-cal-today{border-color:var(--pc-info);box-shadow:0 0 0 1px var(--pc-info-soft) inset}
    .pc-cal-selected{border-color:var(--pc-accent);background:color-mix(in srgb,var(--pc-info) 7%,var(--pc-panel))}
    .pc-cal-day{font-size:11px;color:var(--pc-text-2);font-variant-numeric:tabular-nums}
    .pc-cal-today .pc-cal-day{display:inline-grid;place-items:center;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:var(--pc-info);color:var(--pc-on-brand);font-weight:600}
    .pc-cal-items{display:flex;flex-direction:column;gap:3px;min-width:0}
    .pc-cal-chip{
      display:block;padding:2px 6px;border-radius:var(--pc-r-xs);font-size:10.5px;line-height:1.45;
      background:color-mix(in srgb,currentColor 14%,transparent);
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    }
    .pc-cal-more{font-size:10px;color:var(--pc-text-4)}
    .pc-cal-detail{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel)}
    .pc-cal-list{display:flex;flex-direction:column}
    .pc-cal-row{display:grid;grid-template-columns:auto auto 1fr auto auto;align-items:center;gap:9px;padding:7px 2px;border-bottom:1px solid var(--pc-line);font-size:12px}
    .pc-cal-row:last-child{border-bottom:0}

    /* -------------------------------------------------------------- 时间线 */
    .pc-tl{display:flex;flex-direction:column;gap:8px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel);padding:12px 14px;overflow:hidden}
    .pc-tl-note{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--pc-text-3)}
    .pc-tl-head{display:grid;grid-template-columns:186px 1fr;gap:10px;padding-bottom:6px;border-bottom:1px solid var(--pc-line)}
    .pc-tl-head-name{font-size:11px;color:var(--pc-text-4)}
    .pc-tl-axis{position:relative;height:18px}
    .pc-tl-axis span{position:absolute;top:0;transform:translateX(-50%);font-size:10.5px;color:var(--pc-text-4);white-space:nowrap}
    .pc-tl-body{position:relative;display:flex;flex-direction:column}
    .pc-tl-todayline{position:absolute;top:0;bottom:0;width:1px;background:var(--pc-info);opacity:.55;pointer-events:none}
    .pc-tl-todayline::after{content:'';position:absolute;top:-3px;left:-2.5px;width:6px;height:6px;border-radius:999px;background:var(--pc-info)}
    .pc-tl-row{display:grid;grid-template-columns:186px 1fr;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--pc-line)}
    .pc-tl-row:last-child{border-bottom:0}
    .pc-tl-name{display:flex;align-items:center;gap:7px;border:0;background:transparent;padding:0 4px 0 0;cursor:pointer;text-align:left;min-width:0;color:var(--pc-text)}
    .pc-tl-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
    .pc-tl-name:hover{color:var(--pc-info)}
    .pc-tl-track{position:relative;height:26px;border-radius:var(--pc-r-xs);background:var(--pc-sunken)}
    .pc-tl-bar{
      position:absolute;top:4px;height:18px;display:flex;align-items:center;gap:6px;padding:0 8px;border:0;border-radius:999px;
      background:color-mix(in srgb,currentColor 30%,transparent);cursor:pointer;min-width:26px;overflow:hidden;
      transition:filter .15s;
    }
    .pc-tl-bar:hover{filter:brightness(1.06) saturate(1.15)}
    .pc-tl-bar em{font-style:normal;font-size:10px;white-space:nowrap;color:currentColor}
    .pc-tl-bar i{font-style:normal;font-size:10px;color:var(--pc-text-3);white-space:nowrap}

    /* -------------------------------------------------------------- 待跟进 */
    .pc-follow{display:flex;flex-direction:column;gap:14px}
    .pc-follow-group{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel)}
    .pc-follow-row{display:grid;grid-template-columns:auto 1fr auto auto auto auto;align-items:center;gap:9px;padding:7px 2px;border-bottom:1px solid var(--pc-line);font-size:12.5px}
    .pc-follow-row:last-child{border-bottom:0}
    .pc-follow-row input[type=checkbox]{width:15px;height:15px;accent-color:var(--pc-brand-fill);cursor:pointer}
    .pc-follow-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pc-follow-due{font-size:11px;color:var(--pc-text-4);white-space:nowrap;font-variant-numeric:tabular-nums}

    /* ------------------------------------------------------------------ 空态 */
    .pc-empty{display:flex;flex-direction:column;align-items:center;gap:9px;padding:46px 20px;border:1px dashed var(--pc-line-3);border-radius:var(--pc-r-md);color:var(--pc-text-3);text-align:center}
    .pc-empty-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:999px;background:var(--pc-sunken);color:var(--pc-text-3)}
    .pc-empty-title{font-size:13.5px;font-weight:600;color:var(--pc-text)}
    .pc-empty .pc-btn{margin-top:2px}
    .pc-skeleton{border-radius:var(--pc-r-md);background:var(--pc-sunken);animation:pc-pulse 1.4s ease-in-out infinite}
    .pc-skeleton-line{height:10px;border-radius:999px;background:var(--pc-sunken);animation:pc-pulse 1.4s ease-in-out infinite}
    @keyframes pc-pulse{0%,100%{opacity:1}50%{opacity:.55}}

    /* ---------------------------------------------------------------- AI */
    .pc-ai{display:flex;flex-direction:column;gap:10px}
    .pc-ai-actions{display:flex;align-items:center;gap:10px}
    .pc-ai-result{display:flex;flex-direction:column;gap:10px;padding-top:4px;border-top:1px solid var(--pc-line)}
    .pc-ai-source{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--pc-text-3);flex-wrap:wrap}
    .pc-plan{display:flex;flex-direction:column;gap:10px;padding:11px 12px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-sm);background:var(--pc-sunken)}
    .pc-plan-group{display:flex;flex-direction:column;gap:5px}
    .pc-plan-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--pc-text)}
    .pc-plan-lines{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px}
    .pc-plan-lines li{font-size:12.5px;color:var(--pc-text-2);word-break:break-word}
    .pc-undobar{
      display:flex;align-items:center;gap:9px;padding:9px 12px;border:1px solid color-mix(in srgb,var(--pc-ok) 30%,transparent);
      border-left:3px solid var(--pc-ok);border-radius:var(--pc-r-sm);background:var(--pc-ok-soft);font-size:12.5px;
    }
    .pc-undobar .pc-spacer{flex:1 1 auto}

    /* --------------------------------------------------------- 抽屉 / 弹窗 */
    .pc-scrim{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-2,rgba(16,24,40,.28));z-index:40;animation:pc-fade .16s ease-out}
    @keyframes pc-fade{from{opacity:0}to{opacity:1}}
    .pc-sheet{
      position:absolute;top:0;right:0;bottom:0;z-index:41;display:flex;flex-direction:column;width:min(480px,92%);
      border-left:1px solid var(--pc-line-2);background:var(--pc-panel);box-shadow:var(--pc-shadow-3);
      animation:pc-slide .2s cubic-bezier(.22,.61,.36,1);
    }
    @keyframes pc-slide{from{transform:translateX(18px);opacity:.4}to{transform:none;opacity:1}}
    .pc-sheet-head{display:flex;align-items:flex-start;gap:10px;padding:15px 16px;border-bottom:1px solid var(--pc-line-2)}
    .pc-sheet-title{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:6px}
    .pc-sheet-title h2{margin:0;font-size:16px;font-weight:600;line-height:1.3;word-break:break-word}
    .pc-sheet-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:16px}
    .pc-sheet-foot{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--pc-line-2);background:var(--pc-panel)}
    .pc-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}
    .pc-fact{display:flex;flex-direction:column;gap:1px;padding:9px 11px;border:1px solid var(--pc-line);border-radius:var(--pc-r-sm);background:var(--pc-sunken)}
    .pc-fact span{font-size:10.5px;color:var(--pc-text-4)}
    .pc-fact strong{font-size:12.5px;font-weight:600;word-break:break-word}
    .pc-block{display:flex;flex-direction:column;gap:9px}
    .pc-block-head{display:flex;align-items:center;gap:8px}
    .pc-block-head h3{margin:0;font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--pc-text-3)}
    .pc-block-head .pc-spacer{flex:1 1 auto}

    .pc-composer{display:flex;gap:7px;align-items:center}
    .pc-input,.pc-select,.pc-textarea{width:100%;height:32px;padding:0 10px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-sm);background:var(--pc-panel);transition:border-color .15s,box-shadow .15s}
    .pc-select{appearance:none;padding-right:26px;background-image:linear-gradient(45deg,transparent 50%,var(--pc-text-4) 50%),linear-gradient(135deg,var(--pc-text-4) 50%,transparent 50%);background-position:calc(100% - 14px) 14px,calc(100% - 9px) 14px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
    .pc-textarea{height:auto;min-height:78px;padding:9px 10px;resize:vertical;line-height:1.6}
    .pc-input:hover,.pc-select:hover,.pc-textarea:hover{border-color:var(--pc-line-3)}
    .pc-input:focus,.pc-select:focus,.pc-textarea:focus{outline:none;border-color:var(--pc-info);box-shadow:0 0 0 3px var(--pc-info-soft)}

    .pc-timeline{display:flex;flex-direction:column;gap:2px}
    .pc-timeline-item{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--pc-line)}
    .pc-timeline-item:last-child{border-bottom:0}
    .pc-timeline-rail{display:flex;flex-direction:column;align-items:center;gap:4px;flex:0 0 auto;padding-top:4px}
    .pc-timeline-dot{width:7px;height:7px;border-radius:999px;background:var(--pc-text-4)}
    .pc-timeline-dot-blocker{background:var(--pc-danger)}
    .pc-timeline-dot-progress{background:var(--pc-ok)}
    .pc-timeline-dot-decision{background:var(--pc-info)}
    .pc-timeline-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
    .pc-timeline-meta{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--pc-text-4)}
    .pc-timeline-text{word-break:break-word;font-size:12.5px}

    .pc-todo{display:flex;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid var(--pc-line)}
    .pc-todo:last-child{border-bottom:0}
    .pc-todo input[type=checkbox]{width:15px;height:15px;accent-color:var(--pc-brand-fill);flex:0 0 auto;cursor:pointer}
    .pc-todo-title{flex:1 1 auto;min-width:0;word-break:break-word}
    .pc-todo-done .pc-todo-title{color:var(--pc-text-4);text-decoration:line-through}
    .pc-todo-due{font-size:11px;color:var(--pc-text-4);white-space:nowrap}
    .pc-todo-due-over{color:var(--pc-danger)}

    .pc-ask{display:flex;flex-direction:column;gap:10px}
    .pc-ask-row{display:flex;align-items:center;gap:8px}
    .pc-ask-row .pc-search{flex:1 1 auto;max-width:none}
    .pc-chips{display:flex;gap:6px;flex-wrap:wrap}
    .pc-chips-center{justify-content:center}
    .pc-chip-btn{height:26px;padding:0 10px;border:1px solid var(--pc-line-2);border-radius:999px;background:var(--pc-panel);color:var(--pc-text-2);cursor:pointer;font-size:12px;transition:background .15s,border-color .15s,color .15s}
    .pc-chip-btn:hover{background:var(--pc-sunken);border-color:var(--pc-line-3);color:var(--pc-text)}
    .pc-answer{padding:11px 13px;border:1px solid var(--pc-line-2);border-left:3px solid var(--pc-info);border-radius:var(--pc-r-sm);background:var(--pc-sunken);white-space:pre-wrap;word-break:break-word}
    .pc-doc{width:100%;min-height:190px;padding:12px 13px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-sm);background:var(--pc-sunken);resize:vertical;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:1.7}
    .pc-doc:focus{outline:none;border-color:var(--pc-info);box-shadow:0 0 0 3px var(--pc-info-soft)}

    .pc-modal{
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:41;display:flex;flex-direction:column;
      width:min(560px,94%);max-height:88%;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-lg);
      background:var(--pc-panel);box-shadow:var(--pc-shadow-3);animation:pc-pop .18s cubic-bezier(.22,.61,.36,1);
    }
    @keyframes pc-pop{from{opacity:.3;transform:translate(-50%,-48%) scale(.98)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
    .pc-modal-head{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--pc-line-2)}
    .pc-modal-head h2{margin:0;font-size:15px;font-weight:600;flex:1 1 auto}
    .pc-modal-body{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px}
    .pc-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:13px 18px;border-top:1px solid var(--pc-line-2)}
    .pc-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .pc-field{display:flex;flex-direction:column;gap:5px;min-width:0}
    .pc-field>span{font-size:11.5px;font-weight:500;color:var(--pc-text-2)}
    .pc-field>small{font-size:10.5px;color:var(--pc-text-4)}
    .pc-field-span{grid-column:1 / -1}
    .pc-range{display:flex;align-items:center;gap:10px}
    .pc-range input[type=range]{flex:1 1 auto;accent-color:var(--pc-brand-fill)}
    .pc-range b{min-width:38px;text-align:right;font-variant-numeric:tabular-nums}

    .pc-toast{
      position:absolute;left:50%;bottom:20px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:8px;
      max-width:80%;padding:9px 14px;border-radius:999px;background:var(--dsw-alias-toast-bg,rgba(22,24,29,.94));
      color:var(--dsw-alias-toast-label,#fff);box-shadow:var(--pc-shadow-2);font-size:12.5px;animation:pc-rise .2s ease-out;
    }
    @keyframes pc-rise{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
    .pc-toast-danger{background:var(--pc-danger)}
    .pc-notice{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--pc-warn) 30%,transparent);border-left:3px solid var(--pc-warn);border-radius:var(--pc-r-sm);background:var(--pc-warn-soft)}
    .pc-notice-danger{border-color:color-mix(in srgb,var(--pc-danger) 30%,transparent);border-left-color:var(--pc-danger);background:var(--pc-danger-soft)}
    .pc-notice-body{flex:1 1 auto;display:flex;flex-direction:column;gap:6px}
    .pc-muted{color:var(--pc-text-3);font-size:11.5px}
    .pc-mono{font-family:var(--dsw-font-family-mono,ui-monospace,Menlo,monospace);font-size:11.5px}

    /* --------------------------------------------------------- 窄面板适配 */
    @container pc-app (max-width:900px){
      .pc-rail{flex-basis:172px}
      .pc-cards{grid-template-columns:repeat(auto-fill,minmax(224px,1fr))}
      .pc-viewtab{padding:0 9px}
    }
    @container pc-app (max-width:760px){
      .pc-main{flex-direction:column}
      .pc-rail{flex:0 0 auto;flex-direction:row;gap:6px;padding:8px 10px;border-right:0;border-bottom:1px solid var(--pc-line);overflow-x:auto;overflow-y:hidden}
      .pc-rail-group{flex-direction:row;gap:6px;align-items:center}
      .pc-rail-label,.pc-rail-foot{display:none}
      .pc-rail-item{width:auto;height:28px;padding:0 10px;border:1px solid var(--pc-line-2);border-radius:999px}
      .pc-rail-item[aria-current=true]{border-color:transparent}
      .pc-rail-item[aria-current=true]::before{display:none}
      .pc-search{flex-basis:150px}
      .pc-brand-sub,.pc-scope{display:none}
      .pc-content{padding:12px}
      .pc-form{grid-template-columns:1fr}
      .pc-cal-cell{min-height:64px}
      .pc-cal-chip{display:none}
      .pc-tl-head,.pc-tl-row{grid-template-columns:120px 1fr}
      .pc-tl-todayline{left:calc(120px + (100% - 120px) * .5)}
    }
    @container pc-app (max-width:560px){
      .pc-search{display:none}
      .pc-kpis{grid-template-columns:repeat(auto-fit,minmax(104px,1fr))}
      .pc-cards{grid-template-columns:1fr}
      .pc-viewtab span{display:none}
    }
    `

    module.exports = { STYLE_ID, CSS }
  }
  __factories["client/ui.js"] = function (exports, module, __require) {
    /** 面板基础组件：图标、按钮、徽标、进度、弹窗、抽屉、提示。 */
    const React = __require("react")
    const { RISK_META, clampProgress } = __require("shared/analysis.js")
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /* ------------------------------------------------------------------ 图标 */

    const PATHS = {
      grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
      list: 'M4 6h16M4 12h16M4 18h16',
      plus: 'M12 5v14M5 12h14',
      refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
      search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
      close: 'M6 6l12 12M18 6L6 18',
      alert: 'M12 3l9 16H3zM12 9v5M12 17h.01',
      clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
      check: 'M4 12l5 5L20 6',
      users: 'M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 6.5a3 3 0 1 0 0 5 3 3 0 0 0 0-5zM21 20v-2a4 4 0 0 0-3-3.9',
      link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
      calendar: 'M4 6h16v14H4zM8 3v4M16 3v4M4 10h16',
      sparkle: 'M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
      chevron: 'M9 6l6 6-6 6',
      arrowLeft: 'M15 6l-6 6 6 6',
      trash: 'M4 7h16M9 7V5h6v2M6 7l1 14h10l1-14M10 11v6M14 11v6',
      edit: 'M4 20h4l11-11-4-4L4 16zM14 5l4 4',
      copy: 'M9 9h10v10H9zM5 15V5h10',
      download: 'M12 4v11M7 12l5 5 5-5M5 20h14',
      note: 'M6 3h9l5 5v13H6zM15 3v5h5M9 13h6M9 17h4',
      filter: 'M4 5h16l-6 7v7l-4-2v-5z',
      inbox: 'M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z',
      target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h.01'
    }

    function Icon({ name, size = 16, className = 'pc-icon', strokeWidth = 1.7 }) {
      const path = PATHS[name] ?? PATHS.grid
      return h('svg', {
        className, width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false'
      }, h('path', { d: path }))
    }

    /* ---------------------------------------------------------------- 按钮 */

    function Btn({ children, onClick, variant = 'ghost', size = '', icon, disabled = false, title, type = 'button' }) {
      return h('button', {
        type,
        className: `pc-btn${variant === 'ghost' ? '' : ` pc-btn-${variant}`}${size ? ` pc-btn-${size}` : ''}`,
        onClick,
        disabled,
        title: title || undefined
      }, icon ? h(Icon, { name: icon, size: size === 'sm' ? 13 : 15 }) : null, children)
    }

    function IconBtn({ icon, title, onClick, disabled = false, variant = '', size = '' }) {
      return h('button', {
        type: 'button',
        className: `pc-iconbtn${variant ? ` pc-iconbtn-${variant}` : ''}${size ? ` pc-iconbtn-${size}` : ''}`,
        onClick,
        disabled,
        title,
        'aria-label': title
      }, h(Icon, { name: icon, size: size === 'sm' ? 14 : 16 }))
    }

    function Segmented({ value, options, onChange, ariaLabel }) {
      return h('div', { className: 'pc-seg', role: 'group', 'aria-label': ariaLabel },
        options.map((option) => h('button', {
          key: option.value,
          type: 'button',
          'aria-pressed': value === option.value,
          onClick: () => onChange(option.value),
          title: option.title || undefined
        }, option.icon ? h(Icon, { name: option.icon, size: 14 }) : null, option.label)))
    }

    /* ---------------------------------------------------------------- 展示 */

    function Badge({ children, tone = 'muted', dot = false }) {
      return h('span', { className: `pc-badge pc-tone-${tone}` }, dot ? h('i') : null, children)
    }

    function RiskBadge({ risk, showDot = true }) {
      const meta = risk || RISK_META.normal
      return h('span', { className: `pc-badge pc-tone-${meta.tone}`, title: meta.detail || meta.label },
        showDot ? h('i') : null, meta.label)
    }

    function Progress({ value, tone = '' }) {
      const percent = clampProgress({ progress: value })
      return h('div', {
        className: `pc-progress${tone ? ` pc-progress-${tone}` : ''}`,
        role: 'progressbar', 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100,
        'aria-label': `进度 ${percent}%`
      }, h('i', { style: { width: `${percent}%` } }))
    }

    function Stat({ label, value, hint, tone = '', icon }) {
      return h('div', { className: `pc-kpi${tone ? ` pc-kpi-${tone}` : ''}` },
        h('div', { className: 'pc-kpi-top' }, icon ? h(Icon, { name: icon, size: 13 }) : null, label),
        h('div', { className: 'pc-kpi-value' }, String(value)),
        hint ? h('div', { className: 'pc-kpi-foot' }, hint) : null)
    }

    function Empty({ icon = 'inbox', title, hint, action }) {
      return h('div', { className: 'pc-empty' },
        h('div', { className: 'pc-empty-icon' }, h(Icon, { name: icon, size: 18 })),
        h('div', { className: 'pc-empty-title' }, title),
        hint ? h('div', { className: 'pc-muted' }, hint) : null,
        action || null)
    }

    function Notice({ children, tone = 'warn', action }) {
      return h('div', { className: `pc-notice${tone === 'danger' ? ' pc-notice-danger' : ''}`, role: 'status' },
        h(Icon, { name: tone === 'danger' ? 'alert' : 'clock', size: 15 }),
        h('div', { className: 'pc-notice-body' }, h('div', null, children), action || null))
    }

    function Field({ label, hint, span = false, children }) {
      return h('label', { className: `pc-field${span ? ' pc-field-span' : ''}` },
        h('span', null, label), children, hint ? h('small', null, hint) : null)
    }

    /* ------------------------------------------------------- 弹窗 / 抽屉 / 提示 */

    function useEscape(active, onEscape) {
      useEffect(() => {
        if (!active) return undefined
        const handler = (event) => { if (event.key === 'Escape') onEscape() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
      }, [active, onEscape])
    }

    function Modal({ open, title, icon = 'plus', children, footer, onClose, labelledBy = 'pc-modal-title' }) {
      useEscape(open, onClose)
      const bodyRef = useRef(null)
      useEffect(() => {
        if (!open || !bodyRef.current) return
        const focusable = bodyRef.current.querySelector('input, select, textarea, button')
        if (focusable) focusable.focus()
      }, [open])
      if (!open) return null
      return h(React.Fragment, null,
        h('div', { className: 'pc-scrim', onClick: onClose, 'aria-hidden': 'true' }),
        h('div', { className: 'pc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy },
          h('div', { className: 'pc-modal-head' },
            h(Icon, { name: icon, size: 17 }),
            h('h2', { id: labelledBy }, title),
            h(IconBtn, { icon: 'close', title: '关闭', onClick: onClose })),
          h('div', { className: 'pc-modal-body', ref: bodyRef }, children),
          footer ? h('div', { className: 'pc-modal-foot' }, footer) : null))
    }

    function Sheet({ open, title, icon = 'note', badge, actions, children, footer, onClose }) {
      useEscape(open, onClose)
      if (!open) return null
      return h(React.Fragment, null,
        h('div', { className: 'pc-scrim', onClick: onClose, 'aria-hidden': 'true' }),
        h('div', { className: 'pc-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { className: 'pc-sheet-head' },
            h('div', { className: 'pc-sheet-title' },
              h('h2', null, title),
              h('div', { className: 'pc-chips' }, badge)),
            h('div', { className: 'pc-chips' }, actions),
            h(IconBtn, { icon: 'close', title: '关闭详情', onClick: onClose })),
          h('div', { className: 'pc-sheet-body' }, children),
          footer ? h('div', { className: 'pc-sheet-foot' }, footer) : null))
    }

    function Toast({ message, tone = '', onDone, duration = 2600 }) {
      useEffect(() => {
        if (!message) return undefined
        const timer = setTimeout(onDone, duration)
        return () => clearTimeout(timer)
      }, [message, duration, onDone])
      if (!message) return null
      return h('div', { className: `pc-toast${tone === 'danger' ? ' pc-toast-danger' : ''}`, role: 'status', 'aria-live': 'polite' },
        h(Icon, { name: tone === 'danger' ? 'alert' : 'check', size: 14 }), message)
    }

    /** 受控的搜索输入。 */
    function SearchBox({ value, onChange, placeholder, label }) {
      return h('div', { className: 'pc-search' },
        h(Icon, { name: 'search', size: 15 }),
        h('input', {
          value,
          placeholder,
          'aria-label': label || placeholder,
          onChange: (event) => onChange(event.target.value)
        }),
        value ? h('button', { type: 'button', className: 'pc-search-clear', 'aria-label': '清空搜索', onClick: () => onChange('') },
          h(Icon, { name: 'close', size: 12 })) : null)
    }

    /** 简单的挂载后自动消失的提示状态。 */
    function useToast() {
      const [toast, setToast] = useState(null)
      return {
        toast,
        show(message, tone = '') { setToast({ message, tone }) },
        clear() { setToast(null) }
      }
    }

    module.exports = { Icon, Btn, IconBtn, Segmented, Badge, RiskBadge, Progress, Stat, Empty, Notice, Field, Modal, Sheet, Toast, SearchBox, useToast }
  }
  __factories["shared/analysis.js"] = function (exports, module, __require) {
    /**
     * 项目组合分析：纯函数，无 DOM、无 React，服务端测试与客户端面板共用一份。
     * 时间一律用本地日历日（YYYY-MM-DD）比较，避免时区把「还剩几天」算错。
     */

    const MODULES = ['公司项目', '日常工作', '其他项目']
    const STATUSES = ['进行中', '待启动', '阻塞', '已完成', '暂停']
    const RISK_LEVELS = ['overdue', 'blocked', 'urgent', 'slipping', 'soon', 'unscheduled', 'normal', 'done']

    const RISK_META = {
      overdue: { label: '已逾期', tone: 'danger', rank: 0 },
      blocked: { label: '阻塞', tone: 'danger', rank: 1 },
      urgent: { label: '紧急', tone: 'danger', rank: 2 },
      slipping: { label: '进度风险', tone: 'warn', rank: 3 },
      soon: { label: '临近', tone: 'warn', rank: 4 },
      unscheduled: { label: '未排期', tone: 'muted', rank: 5 },
      normal: { label: '正常', tone: 'ok', rank: 6 },
      done: { label: '已完成', tone: 'muted', rank: 7 }
    }

    const RISK_ORDER = RISK_LEVELS
    const DANGER_LEVELS = ['overdue', 'blocked', 'urgent']
    const WATCH_LEVELS = ['slipping', 'soon']

    const DAY_MS = 24 * 60 * 60 * 1000

    /** 本地日历日的 ISO 文本。 */
    function todayISO(now) {
      const date = now instanceof Date ? now : new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    /** 把 YYYY-MM-DD 解析为本地零点的毫秒数；无法解析时返回 null。 */
    function dayStart(value) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
      if (!match) return null
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      return Number.isNaN(date.getTime()) ? null : date.getTime()
    }

    /** a 到 b 的整日差（b 晚于 a 为正）。 */
    function daysBetween(a, b) {
      const from = dayStart(a)
      const to = dayStart(b)
      if (from === null || to === null) return null
      return Math.round((to - from) / DAY_MS)
    }

    /** 剩余天数：负数表示已逾期。 */
    function daysLeft(dueDate, today = todayISO()) {
      const left = daysBetween(today, dueDate)
      return left
    }

    function formatRemaining(dueDate, today = todayISO()) {
      const left = daysLeft(dueDate, today)
      if (left === null) return '未排期'
      if (left < 0) return `已逾期 ${Math.abs(left)} 天`
      if (left === 0) return '今天到期'
      if (left === 1) return '明天到期'
      return `还剩 ${left} 天`
    }

    /** 本周最后一天（周日）。 */
    function endOfWeek(today = todayISO()) {
      const start = dayStart(today)
      if (start === null) return today
      const date = new Date(start)
      const weekday = date.getDay()
      date.setDate(date.getDate() + (weekday === 0 ? 0 : 7 - weekday))
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function openTodos(project) {
      return (Array.isArray(project?.todos) ? project.todos : []).filter((todo) => todo && todo.done !== true)
    }

    function latestUpdate(project) {
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
    function projectRisk(project, today = todayISO()) {
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

    function clampProgress(project) {
      const value = Number(project?.progress)
      if (!Number.isFinite(value)) return 0
      return Math.min(100, Math.max(0, Math.round(value)))
    }

    /** 时间进度减实际进度；缺少开始日期或周期为零时返回 null。 */
    function slippage(project, today = todayISO()) {
      const start = dayStart(project?.startedOn)
      const due = dayStart(project?.dueDate)
      const now = dayStart(today)
      if (start === null || due === null || now === null || due <= start) return null
      const elapsed = Math.min(1, Math.max(0, (now - start) / (due - start)))
      return elapsed - clampProgress(project) / 100
    }

    /** 把项目按风险排序：危险在前，同级按剩余天数（少的在前），再按名称。 */
    function sortByRisk(projects, today = todayISO()) {
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
    function moduleRollup(projects, module, today = todayISO()) {
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
    function moduleNames(projects) {
      const extra = []
      for (const project of projects) {
        const module = project?.module || '其他项目'
        if (!MODULES.includes(module) && !extra.includes(module)) extra.push(module)
      }
      return [...MODULES, ...extra]
    }

    /** 整个工作台的概览：总数、状态分布、风险分布、模块小结、待跟进清单。 */
    function overview(projects, today = todayISO()) {
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
    function findProject(projects, id) {
      return (Array.isArray(projects) ? projects : []).find((project) => project?.id === id) ?? null
    }

    module.exports = { MODULES, STATUSES, RISK_LEVELS, RISK_META, RISK_ORDER, DANGER_LEVELS, WATCH_LEVELS, todayISO, dayStart, daysBetween, daysLeft, formatRemaining, endOfWeek, openTodos, latestUpdate, projectRisk, clampProgress, slippage, sortByRisk, moduleRollup, moduleNames, overview, findProject }
  }
  __factories["client/screens.js"] = function (exports, module, __require) {
    /** 各个维度的看板视图组件。 */
    const React = __require("react")
    const { Donut, Histogram, Legend, RankBars, StackedBars } = __require("client/charts.js")
    const { Badge, Btn, Empty, Icon, IconBtn, Progress, RiskBadge, Stat } = __require("client/ui.js")
    const { clampProgress, formatRemaining, latestUpdate, openTodos, projectRisk } = __require("shared/analysis.js")
    const h = React.createElement
    const PROGRESS_TONE = { overdue: 'danger', blocked: 'danger', urgent: 'danger', slipping: 'warn', soon: 'warn', done: 'ok' }
    const accentOf = (accents, module) => accents?.[module] ?? 'indigo'

    /* ---------------------------------------------------------------- 项目卡 */

    function ProjectCard({ project, risk, today, accents, onOpen }) {
      const todos = openTodos(project)
      const latest = latestUpdate(project)
      const accent = accentOf(accents, project.module || '其他项目')
      return h('button', {
        type: 'button', className: `pc-card pc-accent-${accent}`, onClick: onOpen,
        title: `${project.name}｜${risk.label}`
      },
      h('span', { className: 'pc-card-accent', 'aria-hidden': 'true' }),
      h('div', { className: 'pc-card-top' },
        h('span', { className: 'pc-card-name' }, project.name),
        h(RiskBadge, { risk })),
      project.summary
        ? h('div', { className: 'pc-card-sum' }, project.summary)
        : latest ? h('div', { className: 'pc-card-sum' }, latest.text) : null,
      h(Progress, { value: project.progress, tone: PROGRESS_TONE[risk.level] ?? '' }),
      h('div', { className: 'pc-card-foot' },
        h('span', null, '进度 ', h('b', null, `${clampProgress(project)}%`)),
        h('span', null, formatRemaining(project.dueDate, today)),
        todos.length > 0 ? h('span', null, '待跟进 ', h('b', null, String(todos.length))) : null,
        project.owner ? h('span', null, project.owner) : null),
      project.tags?.length
        ? h('div', { className: 'pc-card-tags' }, project.tags.slice(0, 4).map((tag) => h('span', { key: tag, className: 'pc-tag' }, tag)))
        : null)
    }

    /** 紧凑行卡（看板列里用）。 */
    function MiniCard({ project, risk, accents, onOpen }) {
      const accent = accentOf(accents, project.module || '其他项目')
      return h('button', { type: 'button', className: `pc-mini pc-accent-${accent}`, onClick: onOpen },
        h('span', { className: 'pc-mini-name' }, project.name),
        h('div', { className: 'pc-mini-meta' },
          h('span', { className: `pc-dot pc-c-${risk.tone}` }),
          h('span', null, risk.label),
          h('span', null, `${clampProgress(project)}%`),
          project.dueDate ? h('span', null, project.dueDate.slice(5)) : null))
    }

    /* -------------------------------------------------------------- 模块看板 */

    function BoardScreen({ groups, today, accents, onOpen }) {
      return groups.map((group) => {
        const accent = accentOf(accents, group.module)
        return h('section', { className: `pc-module pc-accent-${accent}`, key: group.module },
          h('div', { className: 'pc-module-head' },
            h('div', { className: 'pc-module-title' },
              h('span', { className: 'pc-module-bar' }),
              group.module,
              h('span', { className: 'pc-pill' }, `${group.stats.total} 个`)),
            h('div', { className: 'pc-module-meta' },
              group.stats.danger + group.stats.watch > 0
                ? h(Badge, { tone: 'warn', dot: true }, `${group.stats.danger + group.stats.watch} 个需关注`)
                : h(Badge, { tone: 'ok', dot: true }, '节奏正常'),
              h('span', null, `待跟进 ${group.stats.openTodos}`),
              h('span', null, `平均进度 ${group.stats.avgProgress}%`))),
          h('div', { className: 'pc-cards' }, group.projects.map((project) => h(ProjectCard, {
            key: project.id,
            project,
            risk: projectRisk(project, today),
            today,
            accents,
            onOpen: () => onOpen(project.id)
          }))))
      })
    }

    /* ------------------------------------------------------------------ 列表 */

    function ListScreen({ rows, today, accents, onOpen }) {
      return h('div', { className: 'pc-table-wrap' },
        h('table', { className: 'pc-table' },
          h('thead', null, h('tr', null,
            ['项目', '模块', '状态', '进度', '截止', '剩余', '风险', '待跟进'].map((label) => h('th', { key: label }, label)))),
          h('tbody', null, rows.map(({ project, risk }) => h('tr', {
            key: project.id,
            tabIndex: 0,
            onClick: () => onOpen(project.id),
            onKeyDown: (event) => { if (event.key === 'Enter') onOpen(project.id) }
          },
          h('td', { className: 'pc-name', title: project.name },
            h('i', { className: `pc-accent-dot pc-accent-${accentOf(accents, project.module || '其他项目')}` }),
            project.name),
          h('td', null, h('span', { className: 'pc-tag' }, project.module || '其他项目')),
          h('td', null, project.status || '进行中'),
          h('td', { className: 'pc-num' }, `${clampProgress(project)}%`),
          h('td', { className: 'pc-num' }, project.dueDate || '未排期'),
          h('td', { className: 'pc-num' }, formatRemaining(project.dueDate, today)),
          h('td', null, h(RiskBadge, { risk })),
          h('td', { className: 'pc-num' }, openTodos(project).length > 0 ? String(openTodos(project).length) : '—'))))))
    }

    /* ------------------------------------------------------------------ 看板 */

    function KanbanScreen({ columns, accents, onOpen }) {
      const visible = columns.filter((column) => column.projects.length > 0)
      if (visible.length === 0) return h(Empty, { icon: 'grid', title: '没有可展示的项目', hint: '当前筛选下没有项目。' })
      return h('div', { className: 'pc-kanban' }, visible.map((column) => h('section', { className: 'pc-kanban-col', key: column.status },
        h('header', { className: 'pc-kanban-head' },
          h('span', { className: `pc-dot pc-c-${column.tone}` }),
          h('b', null, column.status),
          h('span', { className: 'pc-pill' }, String(column.stats.total)),
          column.stats.danger > 0 ? h(Badge, { tone: 'danger' }, `${column.stats.danger} 危险`) : null),
        h('div', { className: 'pc-kanban-body' },
          column.projects.map((item) => h(MiniCard, {
            key: item.project.id, project: item.project, risk: item.risk, accents, onOpen: () => onOpen(item.project.id)
          }))))))
    }

    /* ------------------------------------------------------------------ 日历 */

    const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

    function CalendarScreen({ model, today, selectedIso, onSelect, onShift, onToday, onOpen, onToggleTodo }) {
      const selected = model.cells.find((cell) => cell.iso === selectedIso)
        ?? model.cells.find((cell) => cell.isToday)
        ?? model.cells.find((cell) => cell.inMonth && cell.items.length > 0)
        ?? model.cells[0]
      return h('div', { className: 'pc-cal' },
        h('div', { className: 'pc-cal-head' },
          h('div', { className: 'pc-cal-title' },
            h('b', null, model.label),
            h('span', { className: 'pc-muted' }, `本月 ${model.monthItems} 个节点 · ${model.daysWithItems} 天有安排`)),
          h('div', { className: 'pc-cal-actions' },
            h(IconBtn, { icon: 'arrowLeft', title: '上个月', onClick: () => onShift(-1) }),
            h(Btn, { size: 'sm', onClick: onToday }, '今天'),
            h(IconBtn, { icon: 'chevron', title: '下个月', onClick: () => onShift(1) }))),
        h('div', { className: 'pc-cal-weekdays' }, WEEKDAYS.map((day) => h('span', { key: day }, day))),
        h('div', { className: 'pc-cal-grid' }, model.cells.map((cell) => h('button', {
          key: cell.iso,
          type: 'button',
          className: `pc-cal-cell${cell.inMonth ? '' : ' pc-cal-out'}${cell.isToday ? ' pc-cal-today' : ''}${cell.iso === selected.iso ? ' pc-cal-selected' : ''}${cell.isWeekend ? ' pc-cal-weekend' : ''}`,
          onClick: () => onSelect(cell.iso)
        },
        h('span', { className: 'pc-cal-day' }, String(cell.day)),
        h('div', { className: 'pc-cal-items' }, cell.items.slice(0, 3).map((item) => h('span', {
          key: item.key,
          className: `pc-cal-chip pc-c-${item.tone}`,
          title: `${item.label}：${item.title}`
        }, item.title))),
        cell.items.length > 3 ? h('span', { className: 'pc-cal-more' }, `+${cell.items.length - 3}`) : null))),
        h('div', { className: 'pc-cal-detail' },
          h('div', { className: 'pc-block-head' },
            h(Icon, { name: 'calendar', size: 14 }),
            h('h3', { style: { textTransform: 'none', letterSpacing: 0, fontSize: '12.5px', color: 'var(--pc-text)' } }, selected.iso),
            h('span', { className: 'pc-spacer' }),
            h('span', { className: 'pc-muted' }, selected.items.length > 0 ? `${selected.items.length} 项` : '当天没有安排')),
          selected.items.length === 0
            ? h('div', { className: 'pc-muted' }, '这一天没有 DDL，也没有待跟进事项。')
            : h('div', { className: 'pc-cal-list' }, selected.items.map((item) => h('div', { key: item.key, className: 'pc-cal-row' },
              h('span', { className: `pc-dot pc-c-${item.tone}` }),
              h(Badge, { tone: item.kind === 'due' ? item.tone : 'muted' }, item.kind === 'due' ? item.label : '待跟进'),
              h('button', { type: 'button', className: 'pc-link', onClick: () => onOpen(item.projectId) }, item.title),
              h('span', { className: 'pc-muted' }, item.kind === 'due' ? item.module : item.projectName),
              item.kind === 'todo' && onToggleTodo
                ? h(Btn, { size: 'sm', onClick: () => onToggleTodo(item.projectId, item.todoId) }, '完成')
                : null)))))
    }

    /* ---------------------------------------------------------------- 时间线 */

    function TimelineScreen({ model, today, accents, onOpen }) {
      if (model.rows.length === 0) return h(Empty, { icon: 'clock', title: '没有可排期的项目', hint: '给项目填上开始与截止日期，就能在这里看到时间线。' })
      return h('div', { className: 'pc-tl' },
        h('div', { className: 'pc-tl-note' },
          h(Icon, { name: 'clock', size: 13 }),
          h('span', null, `${model.from} → ${model.to}（${model.totalDays} 天）`),
          model.padded ? h('span', { className: 'pc-muted' }, '跨度较长，只显示前 210 天') : null),
        h('div', { className: 'pc-tl-head' },
          h('span', { className: 'pc-tl-head-name' }, '项目'),
          h('div', { className: 'pc-tl-axis' }, model.ticks.map((tick) => h('span', {
            key: tick.index, style: { left: `${tick.percent}%` }
          }, tick.label)))),
        h('div', { className: 'pc-tl-body' },
          h('span', {
            className: 'pc-tl-todayline',
            style: { left: `calc(186px + (100% - 186px) * ${(model.todayPercent / 100).toFixed(4)})` },
            title: `今天 ${today}`,
            'aria-hidden': 'true'
          }),
          model.rows.map((row) => h('div', { className: 'pc-tl-row', key: row.project.id },
            h('button', { type: 'button', className: 'pc-tl-name', onClick: () => onOpen(row.project.id), title: row.project.name },
              h('i', { className: `pc-accent-dot pc-accent-${accentOf(accents, row.project.module || '其他项目')}` }),
              h('span', null, row.project.name)),
            h('div', { className: 'pc-tl-track' },
              h('button', {
                type: 'button',
                className: `pc-tl-bar pc-c-${row.risk.tone}`,
                style: { left: `${row.leftPercent}%`, width: `${Math.max(row.widthPercent, 1.5)}%` },
                onClick: () => onOpen(row.project.id),
                title: `${row.project.name}｜${row.startIso} → ${row.endIso}｜${row.risk.label}`
              },
              h('em', null, row.risk.label),
              h('i', null, `${clampProgress(row.project)}%`)))))))
    }

    /* -------------------------------------------------------------- 待跟进 */

    function FollowUpsScreen({ buckets, today, onToggle, onOpen }) {
      const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0)
      if (total === 0) return h(Empty, { icon: 'check', title: '待跟进清单是空的', hint: '所有事项都完成了。' })
      return h('div', { className: 'pc-follow' }, buckets.filter((bucket) => bucket.total > 0).map((bucket) => h('section', {
        className: 'pc-follow-group', key: bucket.key
      },
      h('div', { className: 'pc-block-head' },
        h('span', { className: `pc-dot pc-c-${bucket.tone}` }),
        h('h3', { style: { textTransform: 'none', letterSpacing: 0, fontSize: '12.5px', color: 'var(--pc-text)' } }, bucket.label),
        h('span', { className: 'pc-pill' }, String(bucket.total)),
        h('span', { className: 'pc-spacer' })),
      h('div', null, bucket.items.map((item) => h('div', { className: 'pc-follow-row', key: item.key },
        h('input', {
          type: 'checkbox', checked: false, 'aria-label': `完成：${item.title}`,
          onChange: () => onToggle(item.projectId, item.todoId)
        }),
        h('span', { className: 'pc-follow-title' }, item.title),
        h('button', { type: 'button', className: 'pc-link', onClick: () => onOpen(item.projectId) }, item.projectName),
        h('span', { className: 'pc-tag' }, item.module),
        item.owner ? h('span', { className: 'pc-muted' }, item.owner) : null,
        h('span', { className: `pc-follow-due${item.overdueDays > 0 ? ' pc-c-danger' : ''}` },
          item.dueDate ? (item.overdueDays > 0 ? `逾期 ${item.overdueDays} 天` : item.dueDate) : '未排期')))))))
    }

    /* ------------------------------------------------------------------ 概览 */

    function Panel({ title, icon, extra, children, className = '' }) {
      return h('section', { className: `pc-panel-block ${className}` },
        h('div', { className: 'pc-panel-head' },
          icon ? h(Icon, { name: icon, size: 14 }) : null,
          h('h3', null, title),
          h('span', { className: 'pc-spacer' }),
          extra || null),
        children)
    }

    function OverviewScreen({
      today, accents, kpis, risks, modules, progress, owners, attention, dueSoon, onOpen, ask
    }) {
      const riskSlices = risks.map((item) => ({ key: item.level, label: item.label, count: item.count, tone: item.tone }))
      const moduleRows = modules.map((row) => ({
        key: row.module,
        label: row.module,
        meta: `${row.total} 个 · 平均 ${row.avgProgress}%`,
        total: row.total,
        segments: [
          { label: '危险', value: row.danger, tone: 'danger' },
          { label: '关注', value: row.watch, tone: 'warn' },
          { label: '正常', value: row.normal, tone: 'ok' }
        ]
      }))
      const ownerRows = owners.map((row) => ({
        key: row.owner,
        label: row.owner,
        total: row.total,
        danger: row.danger,
        meta: `${row.openTodos} 待跟进`
      }))

      const listRow = (item) => h('button', { type: 'button', className: 'pc-attn', key: item.project.id, onClick: () => onOpen(item.project.id) },
        h('span', { className: `pc-accent-dot pc-accent-${accentOf(accents, item.project.module || '其他项目')}` }),
        h('span', { className: 'pc-attn-name' }, item.project.name),
        h('span', { className: 'pc-muted' }, item.project.module || '其他项目'),
        h(RiskBadge, { risk: item.risk }),
        h('span', { className: 'pc-muted' }, formatRemaining(item.project.dueDate, today)))

      return h(React.Fragment, null,
        h('div', { className: 'pc-kpis' },
          h(Stat, { label: '项目总数', value: kpis.total, hint: `${kpis.active} 个进行中`, icon: 'grid' }),
          h(Stat, { label: '需关注', value: kpis.attention, hint: `逾期 ${kpis.overdue} · 阻塞 ${kpis.blocked}`, tone: 'danger', icon: 'alert' }),
          h(Stat, { label: '待跟进', value: kpis.openTodos, hint: kpis.todoOverdue > 0 ? `${kpis.todoOverdue} 项已逾期` : '暂无逾期事项', tone: kpis.todoOverdue > 0 ? 'warn' : '', icon: 'check' }),
          h(Stat, { label: '本周到期', value: kpis.weekDue, hint: '本周日之前', icon: 'calendar' }),
          h(Stat, { label: '平均进度', value: `${kpis.avgProgress}%`, hint: `已完成 ${kpis.done} 个`, tone: 'ok', icon: 'target' }),
          h(Stat, { label: '未排期', value: kpis.unscheduled, hint: '还没填 DDL', tone: kpis.unscheduled > 0 ? 'warn' : '', icon: 'clock' })),

        h('div', { className: 'pc-panel-block pc-hero' },
          h('div', { className: 'pc-hero-mark' }, h(Icon, { name: 'sparkle', size: 16 })),
          h('div', null,
            h('div', { className: 'pc-hero-title' }, '今天该盯什么'),
            h('div', { className: 'pc-hero-sub' }, kpis.total === 0
              ? '还没有项目，先登记几个再来看板。'
              : `${kpis.attention} 个需关注 · ${kpis.overdue} 个逾期 · ${kpis.danger} 个危险 · 本周到期 ${kpis.weekDue} 个`))),

        ask,

        h('div', { className: 'pc-dash-grid' },
          h(Panel, { title: '风险分布', icon: 'alert' },
            h('div', { className: 'pc-donut-wrap' },
              h(Donut, { slices: riskSlices, centerValue: kpis.total, centerLabel: '项目', label: '风险分布' }),
              h(Legend, { items: risks.map((item) => ({ key: item.level, label: item.label, count: item.count, tone: item.tone })) }))),
          h(Panel, { title: '模块负载', icon: 'grid' },
            h(StackedBars, { rows: moduleRows, empty: '还没有项目' })),

          h(Panel, { title: '进度分布', icon: 'target' },
            h(Histogram, { buckets: progress })),
          h(Panel, { title: '负责人负载', icon: 'users' },
            h(RankBars, { rows: ownerRows, empty: '还没有项目' })),

          h(Panel, {
            title: '需要马上处理',
            icon: 'alert',
            extra: h('span', { className: 'pc-muted' }, `${attention.length} 个`)
          }, attention.length === 0
            ? h('div', { className: 'pc-muted' }, '当前没有需要升级处理的项目。')
            : h('div', { className: 'pc-attn-list' }, attention.slice(0, 6).map(listRow))),

          h(Panel, {
            title: '本周到期',
            icon: 'calendar',
            extra: h('span', { className: 'pc-muted' }, `${dueSoon.length} 个`)
          }, dueSoon.length === 0
            ? h('div', { className: 'pc-muted' }, '本周没有到期的项目。')
            : h('div', { className: 'pc-attn-list' }, dueSoon.slice(0, 6).map(listRow)))))
    }

    module.exports = { ProjectCard, BoardScreen, ListScreen, KanbanScreen, CalendarScreen, TimelineScreen, FollowUpsScreen, OverviewScreen }
  }
  __factories["client/charts.js"] = function (exports, module, __require) {
    /** 手写的轻量图表：不引第三方库，全部用 SVG / CSS 变量，跟着宿主主题走。 */
    const React = __require("react")

    const h = React.createElement

    const toneClass = (tone) => `pc-c-${tone || 'muted'}`

    /**
     * 环形图。
     * @param slices - [{ key, count, tone }]
     * @param centerValue / centerLabel - 圆心文字。
     */
    function Donut({ slices, centerValue, centerLabel, size = 136, thickness = 15, label = '分布' }) {
      const total = slices.reduce((sum, slice) => sum + slice.count, 0)
      const radius = (size - thickness) / 2
      const circumference = 2 * Math.PI * radius
      let offset = 0
      return h('div', { className: 'pc-donut', style: { width: `${size}px`, height: `${size}px` } },
        h('svg', {
          width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img',
          'aria-label': `${label}：${slices.map((slice) => `${slice.label ?? slice.key} ${slice.count}`).join('，') || '无数据'}`
        },
        h('circle', {
          cx: size / 2, cy: size / 2, r: radius, fill: 'none',
          className: 'pc-donut-track', strokeWidth: thickness
        }),
        total > 0
          ? slices.map((slice) => {
            const length = (slice.count / total) * circumference
            const gap = circumference - length
            const node = h('circle', {
              key: slice.key,
              cx: size / 2, cy: size / 2, r: radius, fill: 'none',
              className: `pc-donut-slice ${toneClass(slice.tone)}`,
              strokeWidth: thickness,
              strokeDasharray: `${length} ${gap}`,
              strokeDashoffset: -offset,
              transform: `rotate(-90 ${size / 2} ${size / 2})`
            })
            offset += length
            return node
          })
          : null),
        h('div', { className: 'pc-donut-center' },
          h('b', null, String(centerValue ?? total)),
          h('span', null, centerLabel ?? '项目')))
    }

    /** 图例。 */
    function Legend({ items }) {
      return h('ul', { className: 'pc-legend' }, items.map((item) => h('li', { key: item.key },
        h('i', { className: toneClass(item.tone) }),
        h('span', null, item.label),
        h('b', null, String(item.count)))))
    }

    /**
     * 堆叠条形：一行一个维度，条内按构成分段。
     * @param rows - [{ key, label, meta, segments: [{ value, tone, label }], total }]
     */
    function StackedBars({ rows, max, empty = '暂无数据' }) {
      if (!rows || rows.length === 0) return h('div', { className: 'pc-muted' }, empty)
      const ceiling = max ?? Math.max(...rows.map((row) => row.total), 1)
      return h('div', { className: 'pc-stacked' }, rows.map((row) => h('div', { className: 'pc-stacked-row', key: row.key },
        h('div', { className: 'pc-stacked-head' },
          h('span', { className: 'pc-stacked-label', title: row.label }, row.label),
          h('span', { className: 'pc-stacked-meta' }, row.meta ?? String(row.total))),
        h('div', {
          className: 'pc-stacked-track',
          role: 'img',
          'aria-label': `${row.label}：${row.segments.map((segment) => `${segment.label} ${segment.value}`).join('，')}`
        },
        row.segments.filter((segment) => segment.value > 0).map((segment) => h('span', {
          key: segment.label,
          className: `pc-stacked-seg ${toneClass(segment.tone)}`,
          style: { width: `${(segment.value / ceiling) * 100}%` },
          title: `${segment.label} ${segment.value}`
        }))))))
    }

    /** 竖向直方图。 */
    function Histogram({ buckets }) {
      const max = Math.max(...buckets.map((bucket) => bucket.count), 1)
      return h('div', { className: 'pc-hist' }, buckets.map((bucket) => h('div', { className: 'pc-hist-col', key: bucket.label },
        h('div', { className: 'pc-hist-track' },
          h('div', {
            className: `pc-hist-bar${bucket.count === 0 ? ' pc-hist-empty' : ''}`,
            style: { height: `${Math.max(3, (bucket.count / max) * 100)}%` },
            title: `${bucket.label}：${bucket.count} 个`
          })),
        h('b', null, String(bucket.count)),
        h('span', null, bucket.label))))
    }

    /** 单行排行条（负责人负载等）。 */
    function RankBars({ rows, empty = '暂无数据' }) {
      if (!rows || rows.length === 0) return h('div', { className: 'pc-muted' }, empty)
      const max = Math.max(...rows.map((row) => row.total), 1)
      return h('div', { className: 'pc-rank' }, rows.map((row) => h('div', { className: 'pc-rank-row', key: row.key },
        h('span', { className: 'pc-rank-label', title: row.label }, row.label),
        h('div', { className: 'pc-rank-track' },
          h('span', { className: 'pc-rank-fill', style: { width: `${(row.total / max) * 100}%` } }),
          row.danger > 0
            ? h('span', { className: 'pc-rank-danger', style: { width: `${(row.danger / max) * 100}%` }, title: `其中 ${row.danger} 个需关注` })
            : null),
        h('b', null, String(row.total)),
        h('small', null, row.meta ?? ''))))
    }

    module.exports = { Donut, Legend, StackedBars, Histogram, RankBars }
  }
  __factories["shared/query.js"] = function (exports, module, __require) {
    /**
     * 「问一句」：在本地已存的项目数据上做规则化问答。
     * 不依赖会话或模型，打开工作台即可用；需要更深的分析时由面板生成提示词交给 Agent。
     */
    const { DANGER_LEVELS, WATCH_LEVELS, clampProgress, daysLeft, endOfWeek, formatRemaining, latestUpdate, openTodos, overview, projectRisk, sortByRisk, todayISO } = __require("shared/analysis.js")
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
    function answerQuestion(question, projects, today = todayISO()) {
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
    const QUESTION_EXAMPLES = ['哪些项目这周到期？', '有什么风险？', '我的待跟进还有哪些？', '整体情况怎么样？']

    module.exports = { answerQuestion, QUESTION_EXAMPLES }
  }
  __factories["shared/prompt.js"] = function (exports, module, __require) {
    /**
     * 把项目数据变成可交给 Agent 的提示词，以及常用文档草稿。
     * 面板只负责生成文本、复制与导出；发送由用户在旁边的原生会话里完成。
     */
    const { clampProgress, formatRemaining, latestUpdate, openTodos, overview, projectRisk, sortByRisk } = __require("shared/analysis.js")
    const KIND_LABELS = { note: '记录', progress: '进展', blocker: '阻塞', decision: '决策' }

    function bullets(items, empty = '（暂无）') {
      if (!items || items.length === 0) return empty
      return items.map((item) => `- ${item}`).join('\n')
    }

    /** 单个项目的 Markdown 摘要，提示词和文档草稿共用。 */
    function projectBrief(project, today) {
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
    function portfolioBrief(projects, today) {
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
    function buildAnalysisPrompt({ projects = [], project = null, today }) {
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

    function docKinds() {
      return Object.entries(DOC_KINDS).map(([value, label]) => ({ value, label }))
    }

    /**
     * 生成一份文档草稿（Markdown）。
     * @param kind - weekly | status | risk | meeting。
     * @param options - projects、project（可选）、today。
     */
    function buildDocDraft(kind, { projects = [], project = null, today }) {
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
    function deliveryHint(kind) {
      return `已生成「${DOC_KINDS[kind] ?? '文档'}」草稿：可以直接复制到旁边的会话里让 Agent 补全，也可以下载成 Markdown。`
    }

    module.exports = { projectBrief, portfolioBrief, buildAnalysisPrompt, docKinds, buildDocDraft, deliveryHint }
  }
  __factories["shared/views.js"] = function (exports, module, __require) {
    /**
     * 面板上的「模块化」视图逻辑：按模块分组、智能视图筛选、关键字搜索。
     * 纯函数，测试里直接调用。
     */
    const { DANGER_LEVELS, WATCH_LEVELS, clampProgress, daysLeft, endOfWeek, latestUpdate, moduleNames, openTodos, projectRisk, sortByRisk, todayISO } = __require("shared/analysis.js")
    const ATTENTION_LEVELS = [...DANGER_LEVELS, ...WATCH_LEVELS]

    /** 左侧栏的智能视图。`view` 用于筛选；「全部项目」是模块轴，不是筛选。 */
    const SMART_VIEWS = [
      { id: 'attention', label: '需关注', hint: '逾期、阻塞、紧急或进度落后的项目' },
      { id: 'overdue', label: '已逾期', hint: '已超过截止日期' },
      { id: 'week', label: '本周到期', hint: '本周日之前到期' },
      { id: 'todos', label: '有待跟进', hint: '还有未完成的待跟进事项' },
      { id: 'done', label: '已完成', hint: '已交付的项目' }
    ]

    function smartView(id) {
      return SMART_VIEWS.find((view) => view.id === id) ?? null
    }

    /** 单个项目是否命中某个智能视图。 */
    function matchesSmartView(project, viewId, today = todayISO()) {
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
    function searchText(project) {
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
    function selectProjects(projects, state = {}, today = todayISO()) {
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
    function summarize(projects, today = todayISO()) {
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
    function railModules(projects, today = todayISO()) {
      const names = moduleNames(projects)
      return names.map((name) => {
        const items = projects.filter((project) => (project?.module || '其他项目') === name)
        const stats = summarize(items, today)
        return { name, total: stats.total, danger: stats.danger + stats.watch, overdue: stats.overdue }
      })
    }

    /** 智能视图的计数，用于侧栏。 */
    function railViews(projects, today = todayISO()) {
      return SMART_VIEWS.map((view) => ({
        ...view,
        total: projects.filter((project) => matchesSmartView(project, view.id, today)).length
      }))
    }

    /**
     * 按模块分组，用于「全部项目」下的分区展示。
     * 空模块不返回；自定义模块排在固定模块之后。
     */
    function groupByModule(projects, today = todayISO()) {
      return railModules(projects, today)
        .filter((entry) => entry.total > 0)
        .map((entry) => ({
          module: entry.name,
          projects: sortByRisk(projects.filter((project) => (project?.module || '其他项目') === entry.name), today)
            .map((item) => item.project),
          stats: summarize(projects.filter((project) => (project?.module || '其他项目') === entry.name), today)
        }))
    }

    module.exports = { ATTENTION_LEVELS, SMART_VIEWS, smartView, matchesSmartView, searchText, selectProjects, summarize, railModules, railViews, groupByModule }
  }
  __factories["shared/sample.js"] = function (exports, module, __require) {
    /**
     * 示例项目：一个后端/全栈工程师手上常见的工作，每种项目模块各 4 个。
     * 覆盖逾期、紧急、进度风险、阻塞、待启动与已完成，日期都相对"今天"计算，
     * 任何一天生成都成立。这些记录带 `示例` 标签，方便识别与清理。
     */
    const { todayISO } = __require("shared/analysis.js")
    const pad = (value) => String(value).padStart(2, '0')

    /** 相对今天偏移若干天的本地日历日。 */
    function shift(today, days) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today))
      if (!match) return today
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      date.setDate(date.getDate() + days)
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    /** 相对今天偏移若干天的 ISO 时间戳。 */
    function stamp(today, days) {
      return `${shift(today, days)}T09:00:00.000Z`
    }

    const update = (id, today, days, kind, text) => ({ id, at: stamp(today, days), kind, text })
    const todo = (id, title, owner, today, days, done = false) => ({
      id, title, owner, dueDate: shift(today, days), done, doneAt: done ? stamp(today, days) : ''
    })

    function make(today, spec) {
      return {
        id: spec.id,
        name: spec.name,
        module: spec.module,
        status: spec.status ?? '进行中',
        owner: spec.owner ?? '我',
        dueDate: shift(today, spec.due),
        startedOn: shift(today, spec.start),
        progress: spec.progress ?? 0,
        link: spec.link ?? '',
        summary: spec.summary ?? '',
        tags: ['示例', ...(spec.tags ?? [])],
        createdAt: stamp(today, spec.start),
        updatedAt: stamp(today, spec.last ?? -1),
        updates: spec.updates ?? [],
        todos: spec.todos ?? []
      }
    }

    /**
     * 生成示例项目：公司项目 4 个、日常工作 4 个、其他项目 4 个。
     * @param today - 本地日历日 YYYY-MM-DD，默认今天。
     */
    function buildSampleProjects(today = todayISO()) {
      const specs = [
        // ---------------------------------------------------------- 公司项目
        {
          id: 'demo-company-1', name: '订单结算服务重构', module: '公司项目', progress: 55, start: -30, due: -2, last: -2,
          summary: '把结算逻辑从单体拆成独立服务，接口按领域重划，历史数据要能对得上。', tags: ['后端', '重构'],
          updates: [
            update('demo-company-1-u1', today, -12, 'progress', '结算链路拆出独立服务，主干联调通过'),
            update('demo-company-1-u2', today, -4, 'blocker', '旧系统遗留的优惠券口径没确认，验收用例写不下去')
          ],
          todos: [
            todo('demo-company-1-t1', '补齐结算接口的契约测试', '我', today, -3),
            todo('demo-company-1-t2', '和财务确认历史订单的结算口径', '我', today, 1)
          ]
        },
        {
          id: 'demo-company-2', name: '数据中台订单域接入', module: '公司项目', progress: 40, start: -20, due: 2, last: -1,
          summary: '把订单库的增量变更实时打进数据中台，先跑通订单域的一张宽表。', tags: ['数据', 'CDC'],
          updates: [update('demo-company-2-u1', today, -5, 'progress', '订单域字段映射表确认，CDC 链路本地跑通')],
          todos: [todo('demo-company-2-t1', '联调订单域增量同步，核对 24 小时延迟', '我', today, 2)]
        },
        {
          id: 'demo-company-3', name: '移动端首屏性能优化', module: '公司项目', progress: 20, start: -25, due: 8, last: -6,
          summary: '首屏从 1.8s 压到 1s 以内：拆包、图片按需、接口并行。', tags: ['前端', '性能'],
          updates: [update('demo-company-3-u1', today, -6, 'note', '首屏耗时采样完成，定位到主包过大和串行请求')],
          todos: [todo('demo-company-3-t1', '拆首屏 JS 分包，砍掉未用依赖', '我', today, 3)]
        },
        {
          id: 'demo-company-4', name: '灰度发布平台上线', module: '公司项目', status: '已完成', progress: 100, start: -45, due: -12, last: -12,
          summary: '按用户维度灰度的发布平台，已接入全部核心服务。', tags: ['平台', 'CI/CD'],
          updates: [update('demo-company-4-u1', today, -12, 'decision', '全量发布完成，回滚预案与值班流程已归档')],
          todos: []
        },

        // ---------------------------------------------------------- 日常工作
        {
          id: 'demo-daily-1', name: '内部分享《线上问题定位实战》准备', module: '日常工作', progress: 45, start: -8, due: 2, last: -1,
          summary: '下周四内部分享，用三个真实 case 讲排查思路：从火焰图到链路日志。', tags: ['技术分享', '可观测'],
          updates: [update('demo-daily-1-u1', today, -1, 'progress', '大纲和两个 case 定了，还差一个内存泄漏的分析过程')],
          todos: [
            todo('demo-daily-1-t1', '补第三个 case 的火焰图与结论', '我', today, 0),
            todo('demo-daily-1-t2', '对着同事预讲一遍，控制在 40 分钟', '我', today, 1)
          ]
        },
        {
          id: 'demo-daily-2', name: 'Q3 技术季度汇报', module: '日常工作', progress: 35, start: -14, due: 9, last: -3,
          summary: '向主管汇报本季度技术产出：稳定性、性能、效率三块指标与下季规划。', tags: ['汇报', 'OKR'],
          updates: [update('demo-daily-2-u1', today, -3, 'progress', '稳定性与性能两块指标已收集完，等效率部分的埋点数据')],
          todos: [todo('demo-daily-2-t1', '补性能优化前后的对比数据与图表', '我', today, 5)]
        },
        {
          id: 'demo-daily-3', name: '线上告警值班与故障复盘', module: '日常工作', progress: 70, start: -9, due: -3, last: -3,
          summary: '本周告警值班：处理 P2 告警、写复盘、把结论沉淀进值班手册。', tags: ['值班', '稳定性'],
          updates: [update('demo-daily-3-u1', today, -3, 'note', '两次 P2 告警的复盘初稿写完，等负责人确认根因')],
          todos: [todo('demo-daily-3-t1', '把复盘结论同步进值班手册和监控规则', '我', today, -2)]
        },
        {
          id: 'demo-daily-4', name: '依赖升级与技术债清理', module: '日常工作', progress: 15, start: -10, due: 5, last: -2,
          summary: '把几个高危依赖升到安全版本，顺手删掉两次迭代前留下的兼容代码。', tags: ['技术债', '依赖'],
          updates: [update('demo-daily-4-u1', today, -2, 'note', '扫出 3 个高危依赖和 1 处废弃兼容层，升级分支已建')],
          todos: [todo('demo-daily-4-t1', '升级并跑通全量回归', '我', today, -1)]
        },

        // ---------------------------------------------------------- 其他项目
        {
          id: 'demo-other-1', name: '自研服务监控小工具', module: '其他项目', status: '阻塞', progress: 15, start: -8, due: 20, last: -2,
          summary: '自己写个小工具盯接口 P99 与慢 SQL，异常时推到企业微信。', tags: ['工具', '可观测'],
          updates: [update('demo-other-1-u1', today, -2, 'blocker', '等运维开采集端的只读权限，本地只能用假数据跑')],
          todos: [todo('demo-other-1-t1', '确认采集端权限范围与账号', '运维', today, 2)]
        },
        {
          id: 'demo-other-2', name: '开源项目 issue 与 PR 维护', module: '其他项目', progress: 50, start: -8, due: 3, last: -1,
          summary: '维护自己那个小开源库：回 issue、审 PR、发一个小版本。', tags: ['开源', '社区'],
          updates: [update('demo-other-2-u1', today, -1, 'progress', '合并了两个社区 PR，CI 全绿')],
          todos: [todo('demo-other-2-t1', '回复剩下的 6 个 issue 并打标签', '我', today, 2)]
        },
        {
          id: 'demo-other-3', name: '技术笔记与博客整理', module: '其他项目', progress: 25, start: -5, due: 14, last: -4,
          summary: '把散在各处的排查笔记和源码阅读记录整理成可检索的博客。', tags: ['学习', '写作'],
          updates: [update('demo-other-3-u1', today, -4, 'note', '先按主题分了 6 类：并发、存储、网络、JVM、框架源码、排查')],
          todos: [todo('demo-other-3-t1', '整理「分布式事务」一节并画流程图', '我', today, 7)]
        },
        {
          id: 'demo-other-4', name: '副业小程序原型', module: '其他项目', status: '待启动', progress: 0, start: 0, due: 25, last: 0,
          summary: '先用两周做个能跑通的最小闭环，验证一下这个想法值不值得继续。', tags: ['副业', '原型'],
          updates: [],
          todos: [todo('demo-other-4-t1', '写一页验证目标与技术选型', '我', today, 3)]
        }
      ]
      return specs.map((spec) => make(today, spec))
    }

    /** 生成示例数据时的提示语。 */
    function sampleSummary(projects) {
      const byModule = {}
      for (const project of projects) byModule[project.module] = (byModule[project.module] ?? 0) + 1
      const detail = Object.entries(byModule).map(([name, count]) => `${name} ${count} 个`).join('、')
      return `${projects.length} 个示例项目（${detail}）`
    }

    module.exports = { buildSampleProjects, sampleSummary }
  }
  __factories["shared/aiplan.js"] = function (exports, module, __require) {
    /**
     * AI 填充：把自然语言指令变成一份"变更计划"，先给用户确认，再一次性落库。
     *
     * 这一层是纯函数：模型只负责产出 JSON 计划，**校验、匹配、预览、应用**都在这里做，
     * 所以模型说错话不会直接改数据；模型不可用时还能退回本地规则解析。
     */
    const { MODULES, STATUSES, clampProgress, todayISO } = __require("shared/analysis.js")
    const { answerQuestion } = __require("shared/query.js")
    const AI_INTENTS = ['add', 'update', 'delete', 'todo', 'log', 'query']
    const AI_OPS = ['add', 'update', 'delete', 'addTodo', 'doneTodo', 'addLog']
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
    function resolveDate(value, today = todayISO()) {
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
    function matchProject(target, projects) {
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
    function normalizePlan(raw, projects, today = todayISO()) {
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
    function revalidatePlan(plan, projects) {
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
    function previewPlan(plan, projects = [], today = todayISO()) {
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
    function planSummary(plan) {
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
    function applyPlan(state, plan, today = todayISO(), makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`) {
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
    function planFromRules(instruction, projects = [], today = todayISO()) {
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
    function planSchemaDoc(today = todayISO()) {
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
    function projectSnapshot(projects, today = todayISO(), limit = 40) {
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

    module.exports = { AI_INTENTS, AI_OPS, resolveDate, matchProject, normalizePlan, revalidatePlan, previewPlan, planSummary, applyPlan, planFromRules, planSchemaDoc, projectSnapshot }
  }
  __factories["shared/insights.js"] = function (exports, module, __require) {
    /**
     * 看板数据层：把项目数据整理成各种"维度"的看板模型。
     * 纯函数、无 DOM，服务端与客户端测试都能直接调用。
     *
     * 维度：风险分布 / 状态列（看板）/ 模块负载 / 进度分布 / 负责人负载 /
     *       日历（按天）/ 时间线（按区间）/ 待跟进（按到期紧迫度）。
     */
    const { DANGER_LEVELS, WATCH_LEVELS, RISK_META, STATUSES, clampProgress, dayStart, daysLeft, endOfWeek, moduleNames, openTodos, projectRisk, sortByRisk, todayISO } = __require("shared/analysis.js")
    const { summarize } = __require("shared/views.js")
    const MODULE_ACCENTS = ['indigo', 'teal', 'amber', 'violet', 'rose', 'cyan']

    const STATUS_TONE = { 进行中: 'info', 待启动: 'muted', 阻塞: 'danger', 暂停: 'warn', 已完成: 'ok' }

    /** 每个模块一个固定强调色（顺序稳定，刷新不会变色）。 */
    function moduleAccentMap(projects) {
      const map = {}
      moduleNames(projects).forEach((name, index) => {
        map[name] = MODULE_ACCENTS[index % MODULE_ACCENTS.length]
      })
      return map
    }

    function statusTone(status) {
      return STATUS_TONE[status] ?? 'muted'
    }

    /** 顶部 KPI 需要的全部数字，一次算完。 */
    function kpis(projects, today = todayISO()) {
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
    function riskBreakdown(projects, today = todayISO()) {
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
    function statusColumns(projects, today = todayISO()) {
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
    function moduleWorkload(projects, today = todayISO()) {
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
    function progressBuckets(projects) {
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
    function ownerWorkload(projects, today = todayISO()) {
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

    const monthKeyOf = (today = todayISO()) => String(today).slice(0, 7)

    /** 月份加减，返回 YYYY-MM。 */
    function shiftMonth(key, delta) {
      const match = /^(\d{4})-(\d{2})$/.exec(String(key))
      if (!match) return monthKeyOf()
      const date = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1)
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
    }

    function monthLabel(key) {
      const match = /^(\d{4})-(\d{2})$/.exec(String(key))
      return match ? `${match[1]} 年 ${Number(match[2])} 月` : String(key)
    }

    /**
     * 一个月的日历模型：6 周网格，每格列出当天到期的项目与待跟进事项。
     */
    function calendarMonth(projects, today = todayISO(), key = monthKeyOf(today)) {
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
    function timelineModel(projects, today = todayISO()) {
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
    function followUpBuckets(projects, today = todayISO()) {
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
    function headline(projects, today = todayISO()) {
      const data = kpis(projects, today)
      if (data.total === 0) return '还没有项目，先登记几个再来看板。'
      if (data.overdue > 0) {
        return `${data.total} 个项目里 ${data.overdue} 个已逾期、${data.danger} 个需要马上处理，先看「需关注」这一列。`
      }
      if (data.attention > 0) return `${data.total} 个项目整体在跑，${data.attention} 个需要盯一下，本周到期 ${data.weekDue} 个。`
      return `${data.total} 个项目节奏正常，平均进度 ${data.avgProgress}%，没有逾期项。`
    }

    module.exports = { MODULE_ACCENTS, moduleAccentMap, statusTone, kpis, riskBreakdown, statusColumns, moduleWorkload, progressBuckets, ownerWorkload, monthKeyOf, shiftMonth, monthLabel, calendarMonth, timelineModel, followUpBuckets, headline }
  }
    return __require("client/index.js")
  }
})
