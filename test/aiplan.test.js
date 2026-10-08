import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_INTENTS, AI_OPS, applyPlan, matchProject, normalizePlan, planFromRules, planSchemaDoc,
  planSummary, previewPlan, projectSnapshot, resolveDate
} from '../src/shared/aiplan.js'

const TODAY = '2026-10-08' // 周四

const project = (over = {}) => ({
  id: over.id ?? 'p1',
  name: over.name ?? '订单结算服务重构',
  module: over.module ?? '公司项目',
  status: over.status ?? '进行中',
  owner: over.owner ?? '我',
  dueDate: over.dueDate ?? '2026-10-06',
  startedOn: over.startedOn ?? '2026-09-08',
  progress: over.progress ?? 55,
  summary: over.summary ?? '把结算逻辑拆成独立服务',
  tags: over.tags ?? ['后端'],
  updates: over.updates ?? [],
  todos: over.todos ?? [{ id: 't1', title: '补齐契约测试', dueDate: '2026-10-05', done: false, doneAt: '' }],
  ...over
})

const POOL = [
  project(),
  project({ id: 'p2', name: '数据中台订单域接入', module: '公司项目' }),
  project({ id: 'p3', name: 'Q3 技术季度汇报', module: '日常工作', status: '进行中', todos: [] })
]

const makeId = (() => { let n = 0; return (prefix) => `${prefix}-${++n}` })()

test('导出常量覆盖六种意图与六种动作', () => {
  assert.deepEqual(AI_INTENTS, ['add', 'update', 'delete', 'todo', 'log', 'query'])
  assert.deepEqual(AI_OPS, ['add', 'update', 'delete', 'addTodo', 'doneTodo', 'addLog'])
})

test('resolveDate 解析绝对日期与常见相对说法', () => {
  assert.equal(resolveDate('2026-11-03', TODAY), '2026-11-03')
  assert.equal(resolveDate('2026-3-5', TODAY), '2026-03-05')
  assert.equal(resolveDate('今天', TODAY), '2026-10-08')
  assert.equal(resolveDate('明天', TODAY), '2026-10-09')
  assert.equal(resolveDate('后天', TODAY), '2026-10-10')
  assert.equal(resolveDate('下周五', TODAY), '2026-10-16')
  assert.equal(resolveDate('本周五', TODAY), '2026-10-09')
  assert.equal(resolveDate('月底', TODAY), '2026-10-31')
  assert.equal(resolveDate('11月3号', TODAY), '2026-11-03')
  assert.equal(resolveDate('+3天', TODAY), '2026-10-11')
  assert.equal(resolveDate('随便写的', TODAY), '')
  assert.equal(resolveDate('', TODAY), '')
})

test('matchProject 支持 id、全名、包含与歧义检测', () => {
  assert.equal(matchProject('p2', POOL).project.name, '数据中台订单域接入')
  assert.equal(matchProject('订单结算服务重构', POOL).project.id, 'p1')
  assert.equal(matchProject('订单结算', POOL).project.id, 'p1')
  assert.match(matchProject('不存在的项目', POOL).reason, /找不到/)
  assert.match(matchProject('', POOL).reason, /没有指明/)
  assert.match(matchProject('订单', [POOL[0], project({ id: 'p9', name: '订单导出' })]).reason, /多个/)
})

test('normalizePlan 丢弃无法匹配的项目并记录原因', () => {
  const plan = normalizePlan({
    intent: 'update',
    reply: '改一下',
    actions: [
      { op: 'update', target: '订单结算服务重构', changes: { dueDate: '下周五', progress: 80 } },
      { op: 'delete', target: '压根不存在的项目' },
      { op: 'frobnicate', target: '订单结算服务重构' }
    ]
  }, POOL, TODAY)
  assert.equal(plan.actions.length, 1)
  assert.deepEqual(plan.actions[0].changes, { dueDate: '2026-10-16', progress: 80 })
  assert.equal(plan.issues.length, 2)
  assert.ok(plan.issues.some((issue) => /找不到项目/.test(issue)))
  assert.ok(plan.issues.some((issue) => /不认识的动作/.test(issue)))
})

test('normalizePlan 校验新增项目、状态与日期', () => {
  const plan = normalizePlan({
    intent: 'add',
    actions: [
      { op: 'add', name: '自研监控小工具', module: '其他项目', status: '瞎写', dueDate: '明天', progress: 130, tags: ['工具', ''] },
      { op: 'add', name: '   ' }
    ]
  }, POOL, TODAY)
  assert.equal(plan.actions.length, 1)
  const added = plan.actions[0].project
  assert.equal(added.status, '进行中', '非法状态回落到默认值')
  assert.equal(added.dueDate, '2026-10-09')
  assert.equal(added.progress, 100, '进度被夹到 0-100')
  assert.deepEqual(added.tags, ['工具'])
  assert.ok(plan.issues.some((issue) => /缺少项目名称/.test(issue)))
})

test('normalizePlan 从动作推断 intent，并原样接受 query', () => {
  const del = normalizePlan({ actions: [{ op: 'delete', target: 'p2' }] }, POOL, TODAY)
  assert.equal(del.intent, 'delete')
  const query = normalizePlan({ intent: 'query', reply: '本周没有到期的项目。', actions: [] }, POOL, TODAY)
  assert.equal(query.intent, 'query')
  assert.equal(query.reply, '本周没有到期的项目。')
})

test('normalizePlan 处理非法输入', () => {
  for (const bad of [null, undefined, 'x', []]) {
    const plan = normalizePlan(bad, POOL, TODAY)
    assert.deepEqual(plan.actions, [])
    assert.ok(plan.issues.length > 0)
  }
})

test('normalizePlan 还能处理待跟进、完成与进展三种动作', () => {
  const plan = normalizePlan({
    intent: 'todo',
    actions: [
      { op: 'addTodo', target: '订单结算', title: '写压测报告', dueDate: '后天' },
      { op: 'doneTodo', target: '订单结算', title: '契约测试' },
      { op: 'addLog', target: 'Q3 技术季度汇报', kind: 'progress', text: '指标收集完成' }
    ]
  }, POOL, TODAY)
  assert.equal(plan.actions.length, 3)
  assert.equal(plan.actions[0].dueDate, '2026-10-10')
  assert.equal(plan.actions[1].todoId, 't1')
  assert.equal(plan.actions[2].kind, 'progress')
})

test('previewPlan 生成分组的人类可读预览', () => {
  const plan = normalizePlan({
    intent: 'update',
    actions: [
      { op: 'add', name: '新项目', module: '日常工作', dueDate: '2026-10-20', summary: '一句话' },
      { op: 'update', target: '订单结算', changes: { dueDate: '2026-10-16', progress: 80, status: '阻塞' } },
      { op: 'delete', target: '数据中台订单域接入' },
      { op: 'addTodo', target: '订单结算', title: '写压测报告' },
      { op: 'addLog', target: 'Q3 技术季度汇报', kind: 'note', text: '和主管对了一次口径' }
    ]
  }, POOL, TODAY)
  const preview = previewPlan(plan, POOL, TODAY)
  assert.equal(preview.total, 5)
  assert.deepEqual(preview.groups.map((group) => group.key), ['add', 'update', 'delete', 'todo', 'log'])
  const updateLine = preview.groups.find((group) => group.key === 'update').lines[0]
  assert.match(updateLine, /截止 2026-10-06 → 2026-10-16/)
  assert.match(updateLine, /进度 55% → 80%/)
  assert.match(updateLine, /状态 进行中 → 阻塞/)
  assert.match(preview.groups.find((group) => group.key === 'todo').lines[0], /新增：写压测报告/)
  assert.equal(planSummary(plan), '新增 1 个，修改 1 个，删除 1 个，待跟进 1 项，进展 1 条')
})

test('applyPlan 一次把增删改查全部落到位', () => {
  const plan = normalizePlan({
    actions: [
      { op: 'add', name: '新项目', module: '日常工作', dueDate: '2026-10-20' },
      { op: 'update', target: '订单结算', changes: { dueDate: '2026-10-16', progress: 80 } },
      { op: 'delete', target: '数据中台订单域接入' },
      { op: 'addTodo', target: '订单结算', title: '写压测报告', dueDate: '2026-10-12' },
      { op: 'doneTodo', target: '订单结算', title: '契约测试' },
      { op: 'addLog', target: 'Q3 技术季度汇报', kind: 'progress', text: '指标收集完成' }
    ]
  }, POOL, TODAY)
  const state = { version: 1, seededAt: '', projects: POOL }
  const { next, applied } = applyPlan(state, plan, TODAY, makeId)
  assert.equal(applied, 6)
  assert.equal(next.projects.length, 3, '加 1 删 1，总数不变')
  assert.ok(next.projects.some((item) => item.name === '新项目'))
  assert.ok(!next.projects.some((item) => item.name === '数据中台订单域接入'))
  const order = next.projects.find((item) => item.id === 'p1')
  assert.equal(order.dueDate, '2026-10-16')
  assert.equal(order.progress, 80)
  assert.equal(order.todos.length, 2)
  assert.equal(order.todos.find((todo) => todo.id === 't1').done, true)
  assert.equal(next.projects.find((item) => item.id === 'p3').updates[0].text, '指标收集完成')
  assert.equal(state.projects.length, 3, '原状态不被修改')
  assert.ok(order.updatedAt)
})

test('applyPlan 对未知项目与空计划是安全的', () => {
  const state = { version: 1, projects: POOL }
  assert.deepEqual(applyPlan(state, { actions: [] }, TODAY, makeId).next.projects, POOL)
  const orphan = { actions: [{ op: 'update', projectId: 'nope', changes: { progress: 10 } }] }
  const result = applyPlan(state, orphan, TODAY, makeId)
  assert.equal(result.applied, 0)
  assert.deepEqual(result.next.projects, POOL)
})

test('planFromRules 能识别查询、新增、修改、删除、待跟进与记录', () => {
  const query = planFromRules('这周要交付什么？', POOL, TODAY)
  assert.equal(query.intent, 'query')
  assert.ok(query.reply.length > 0)

  const add = planFromRules('新增一个项目：自研监控小工具，放到其他项目', POOL, TODAY)
  assert.equal(add.intent, 'add')
  assert.equal(add.actions[0].project.name, '自研监控小工具')
  assert.equal(add.actions[0].project.module, '其他项目')

  const update = planFromRules('把订单结算服务重构的 DDL 改到下周五，进度调整到 80%', POOL, TODAY)
  assert.equal(update.intent, 'update')
  assert.deepEqual(update.actions[0].changes, { progress: 80, dueDate: '2026-10-16' })

  const del = planFromRules('删掉数据中台订单域接入', POOL, TODAY)
  assert.equal(del.intent, 'delete')
  assert.equal(del.actions[0].name, '数据中台订单域接入')

  const todoAdd = planFromRules('给订单结算服务重构加一条待跟进：写压测报告，明天截止', POOL, TODAY)
  assert.equal(todoAdd.intent, 'todo')
  assert.match(todoAdd.actions[0].title, /写压测报告/)
  assert.equal(todoAdd.actions[0].dueDate, '2026-10-09')
})

test('planFromRules 匹配不到项目时给出可读提示而不是乱改', () => {
  const result = planFromRules('把那个啥的 DDL 改到月底', POOL, TODAY)
  assert.equal(result.actions.length, 0)
  assert.match(result.issues[0], /没看懂|没听出/)
})

test('planSchemaDoc 与 projectSnapshot 给模型的上下文是稳定的', () => {
  const doc = planSchemaDoc(TODAY)
  assert.match(doc, /今天是 2026-10-08/)
  assert.match(doc, /"op":"add"/)
  assert.match(doc, /只能引用上面给出的真实项目名或 id/)
  const snapshot = projectSnapshot(POOL, TODAY, 2)
  assert.equal(snapshot.length, 2)
  assert.deepEqual(snapshot[0].todo, [{ title: '补齐契约测试', dueDate: '2026-10-05' }])
  assert.equal(snapshot[0].progress, 55)
})
