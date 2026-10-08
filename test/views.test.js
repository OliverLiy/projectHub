import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTENTION_LEVELS, SMART_VIEWS, groupByModule, matchesSmartView, railModules, railViews,
  searchText, selectProjects, smartView, summarize
} from '../src/shared/views.js'

const TODAY = '2026-10-08' // 周四，本周日 = 2026-10-11

const project = (over = {}) => ({
  id: over.id ?? 'p1',
  name: over.name ?? '结算系统',
  module: over.module ?? '公司项目',
  status: over.status ?? '进行中',
  dueDate: over.dueDate ?? '2026-10-30',
  startedOn: over.startedOn ?? '2026-10-01',
  progress: over.progress ?? 50,
  owner: over.owner ?? '我',
  summary: over.summary ?? '',
  tags: over.tags ?? [],
  updates: over.updates ?? [],
  todos: over.todos ?? [],
  ...over
})

const POOL = [
  project({ id: 'a', name: '结算系统', dueDate: '2026-10-01', todos: [{ id: 't1', title: '对账', dueDate: '2026-10-06', done: false }] }),
  project({ id: 'b', name: '官网改版', module: '日常工作', dueDate: '2026-10-09', tags: ['设计'] }),
  project({ id: 'c', name: '小程序', module: '其他项目', status: '阻塞', dueDate: '2026-11-20' }),
  project({ id: 'd', name: '内训课件', module: '日常工作', status: '已完成', dueDate: '2026-09-01', todos: [] }),
  project({ id: 'e', name: '副业原型', module: '副业试验', dueDate: '2026-12-31' })
]

test('智能视图覆盖需关注/逾期/本周/待跟进/已完成', () => {
  assert.deepEqual(SMART_VIEWS.map((view) => view.id), ['attention', 'overdue', 'week', 'todos', 'done'])
  assert.equal(smartView('week').label, '本周到期')
  assert.equal(smartView('nope'), null)
})

test('matchesSmartView 按条件筛选', () => {
  const overdue = POOL[0]
  const thisWeek = POOL[1]
  const blocked = POOL[2]
  const done = POOL[3]

  assert.equal(matchesSmartView(overdue, 'overdue', TODAY), true)
  assert.equal(matchesSmartView(overdue, 'attention', TODAY), true)
  assert.equal(matchesSmartView(thisWeek, 'week', TODAY), true)
  assert.equal(matchesSmartView(blocked, 'attention', TODAY), true)
  assert.equal(matchesSmartView(blocked, 'overdue', TODAY), false)
  assert.equal(matchesSmartView(done, 'done', TODAY), true)
  assert.equal(matchesSmartView(done, 'attention', TODAY), false)
  assert.equal(matchesSmartView(overdue, 'todos', TODAY), true)
  assert.equal(matchesSmartView(thisWeek, 'todos', TODAY), false)
  assert.equal(matchesSmartView(POOL[4], '', TODAY), true, '空视图表示不过滤')
})

test('ATTENTION_LEVELS 只含危险与观察等级', () => {
  assert.deepEqual(ATTENTION_LEVELS, ['overdue', 'blocked', 'urgent', 'slipping', 'soon'])
})

test('searchText 覆盖名称、负责人、标签、待跟进与最近进展', () => {
  const rich = project({
    name: '结算系统', owner: '张三', tags: ['财务'],
    updates: [{ id: 'u', at: '2026-10-07T00:00:00.000Z', kind: 'note', text: '联调完成' }],
    todos: [{ id: 't', title: '补齐用例', done: false }]
  })
  const text = searchText(rich)
  for (const needle of ['结算系统', '张三', '财务', '联调完成', '补齐用例']) {
    assert.ok(text.includes(needle.toLowerCase()), `${needle} 应可被搜到`)
  }
})

test('selectProjects 同时应用模块、智能视图与关键字', () => {
  const byModule = selectProjects(POOL, { module: '日常工作' }, TODAY).map((item) => item.id)
  assert.deepEqual(byModule, ['b', 'd'])

  const byView = selectProjects(POOL, { view: 'attention' }, TODAY).map((item) => item.id)
  assert.deepEqual(byView, ['a', 'c', 'b'])

  const byKeyword = selectProjects(POOL, { keyword: '小程序' }, TODAY).map((item) => item.id)
  assert.deepEqual(byKeyword, ['c'])

  const combined = selectProjects(POOL, { module: '日常工作', view: 'done' }, TODAY).map((item) => item.id)
  assert.deepEqual(combined, ['d'])

  assert.deepEqual(selectProjects(POOL, { keyword: '不存在的词' }, TODAY), [])
})

test('selectProjects 结果始终按风险排序', () => {
  const ids = selectProjects(POOL, {}, TODAY).map((item) => item.id)
  assert.deepEqual(ids, ['a', 'c', 'b', 'e', 'd'])
})

test('summarize 汇总计数与平均进度', () => {
  const stats = summarize(POOL, TODAY)
  assert.equal(stats.total, 5)
  assert.equal(stats.done, 1)
  assert.equal(stats.overdue, 1)
  assert.equal(stats.openTodos, 1)
  assert.equal(stats.avgProgress, 50)
  assert.deepEqual(summarize([], TODAY), {
    total: 0, active: 0, done: 0, danger: 0, watch: 0, overdue: 0, openTodos: 0, avgProgress: 0
  })
})

test('railModules 固定模块在前，自定义模块在后并带计数', () => {
  const rail = railModules(POOL, TODAY)
  assert.deepEqual(rail.map((item) => item.name), ['公司项目', '日常工作', '其他项目', '副业试验'])
  assert.equal(rail[0].total, 1)
  assert.equal(rail[1].total, 2)
  assert.equal(rail[0].overdue, 1, '公司项目里有一个逾期')
  assert.equal(rail[2].danger, 1, '其他项目下的阻塞计入需关注')
})

test('railViews 给出每个智能视图的计数', () => {
  const rail = railViews(POOL, TODAY)
  const byId = Object.fromEntries(rail.map((item) => [item.id, item.total]))
  assert.equal(byId.attention, 3)
  assert.equal(byId.overdue, 1)
  assert.equal(byId.week, 1)
  assert.equal(byId.todos, 1)
  assert.equal(byId.done, 1)
})

test('groupByModule 丢掉空模块并按风险排序组内项目', () => {
  const groups = groupByModule(POOL, TODAY)
  assert.deepEqual(groups.map((group) => group.module), ['公司项目', '日常工作', '其他项目', '副业试验'])
  const daily = groups.find((group) => group.module === '日常工作')
  assert.deepEqual(daily.projects.map((item) => item.id), ['b', 'd'], '组内也按风险排序')
  assert.equal(daily.stats.total, 2)
  assert.ok(!groups.some((group) => group.module === '空的模块'))
})

test('groupByModule 对空列表返回空数组', () => {
  assert.deepEqual(groupByModule([], TODAY), [])
})
