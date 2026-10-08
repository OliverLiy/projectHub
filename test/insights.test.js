import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MODULE_ACCENTS, calendarMonth, followUpBuckets, headline, kpis, moduleAccentMap, moduleWorkload,
  monthKeyOf, monthLabel, ownerWorkload, progressBuckets, riskBreakdown, shiftMonth, statusColumns,
  statusTone, timelineModel
} from '../src/shared/insights.js'

const TODAY = '2026-10-08' // 周四；本周日 = 2026-10-11

const project = (over = {}) => ({
  id: over.id ?? 'p1',
  name: over.name ?? '结算系统',
  module: over.module ?? '公司项目',
  status: over.status ?? '进行中',
  owner: over.owner ?? '我',
  dueDate: over.dueDate ?? '2026-10-30',
  startedOn: over.startedOn ?? '2026-10-01',
  progress: over.progress ?? 50,
  tags: over.tags ?? [],
  updates: over.updates ?? [],
  todos: over.todos ?? [],
  ...over
})

const todo = (id, dueDate, done = false) => ({ id, title: `事项 ${id}`, owner: '我', dueDate, done, doneAt: '' })

const POOL = [
  project({ id: 'a', name: '结算系统', dueDate: '2026-10-01', progress: 55, todos: [todo('t1', '2026-10-06'), todo('t2', '2026-10-09')] }),
  project({ id: 'b', name: '官网改版', module: '日常工作', owner: '小李', dueDate: '2026-10-09', progress: 30, todos: [todo('t3', '2026-10-20')] }),
  project({ id: 'c', name: '小程序', module: '其他项目', status: '阻塞', dueDate: '2026-11-20', progress: 15 }),
  project({ id: 'd', name: '内训课件', module: '日常工作', status: '已完成', dueDate: '2026-09-01', progress: 100 }),
  project({ id: 'e', name: '无期项目', module: '其他项目', status: '待启动', dueDate: '', progress: 0 }),
  project({ id: 'f', name: '落后项目', startedOn: '2026-09-01', dueDate: '2026-10-20', progress: 10 })
]

test('moduleAccentMap 给每个模块固定颜色，顺序稳定', () => {
  const map = moduleAccentMap(POOL)
  assert.deepEqual(Object.keys(map), ['公司项目', '日常工作', '其他项目'])
  assert.deepEqual(Object.values(map), MODULE_ACCENTS.slice(0, 3))
  assert.deepEqual(moduleAccentMap(POOL), map, '同样输入应得到同样映射')
})

test('statusTone 覆盖固定状态并给未知状态兜底', () => {
  assert.equal(statusTone('阻塞'), 'danger')
  assert.equal(statusTone('已完成'), 'ok')
  assert.equal(statusTone('进行中'), 'info')
  assert.equal(statusTone('随便'), 'muted')
})

test('kpis 一次算清各维度数字', () => {
  const data = kpis(POOL, TODAY)
  assert.equal(data.total, 6)
  assert.equal(data.overdue, 1)
  assert.equal(data.blocked, 1)
  assert.equal(data.slipping, 1)
  assert.equal(data.unscheduled, 1)
  assert.equal(data.done, 1)
  assert.equal(data.openTodos, 3)
  assert.equal(data.todoOverdue, 1)
  assert.equal(data.weekDue, 1, '官网改版 10-09 在本周内')
  assert.equal(data.attention, data.danger + data.watch)
  assert.equal(data.danger + data.watch + data.normal + data.done + data.unscheduled, data.total)
})

test('riskBreakdown 按风险从高到低且百分比合理', () => {
  const rows = riskBreakdown(POOL, TODAY)
  const ranks = rows.map((row) => row.rank)
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
  assert.ok(rows.every((row) => row.count > 0))
  assert.equal(rows.reduce((sum, row) => sum + row.count, 0), POOL.length)
  for (const row of rows) assert.ok(row.percent > 0 && row.percent <= 100)
  assert.equal(rows[0].level, 'overdue')
})

test('statusColumns 用固定状态顺序，列内按风险排序', () => {
  const columns = statusColumns(POOL, TODAY)
  assert.deepEqual(columns.map((column) => column.status), ['进行中', '待启动', '阻塞', '已完成', '暂停'])
  const doing = columns.find((column) => column.status === '进行中')
  assert.deepEqual(doing.projects.map((item) => item.project.id), ['a', 'b', 'f'])
  assert.equal(columns.find((column) => column.status === '阻塞').tone, 'danger')
  assert.equal(columns.find((column) => column.status === '已完成').stats.total, 1)
})

test('moduleWorkload 给出每个模块的构成与占比', () => {
  const rows = moduleWorkload(POOL, TODAY)
  assert.deepEqual(rows.map((row) => row.module), ['公司项目', '日常工作', '其他项目'])
  const daily = rows.find((row) => row.module === '日常工作')
  assert.equal(daily.total, 2)
  assert.equal(daily.normal + daily.watch + daily.danger, 2)
  assert.equal(daily.accent, MODULE_ACCENTS[1])
  assert.ok(!rows.some((row) => row.total === 0))
})

test('progressBuckets 覆盖 0 到 100 且总数守恒', () => {
  const buckets = progressBuckets([...POOL, project({ id: 'g', progress: 80 })])
  assert.deepEqual(buckets.map((bucket) => bucket.label), ['0%', '1-25%', '26-50%', '51-75%', '76-99%', '100%'])
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), 7)
  assert.equal(buckets.find((bucket) => bucket.label === '100%').count, 1)
  assert.equal(buckets.find((bucket) => bucket.label === '76-99%').count, 1)
})

test('ownerWorkload 按人聚合，未填负责人归到「未指定」', () => {
  const rows = ownerWorkload([...POOL, project({ id: 'h', owner: '' })], TODAY)
  assert.equal(rows[0].owner, '我')
  assert.ok(rows.some((row) => row.owner === '未指定'))
  const li = rows.find((row) => row.owner === '小李')
  assert.equal(li.total, 1)
  assert.equal(li.openTodos, 1)
  assert.ok(rows.every((row) => row.total > 0))
})

test('shiftMonth / monthLabel 跨年正确', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('坏值', 1), monthKeyOf())
  assert.equal(monthLabel('2026-10'), '2026 年 10 月')
  assert.equal(monthKeyOf('2026-10-08'), '2026-10')
})

test('calendarMonth 生成 6 周网格并标出今天与当月', () => {
  const model = calendarMonth(POOL, TODAY, '2026-10')
  assert.ok(model.weeks.length >= 5 && model.weeks.length <= 6, `周数异常：${model.weeks.length}`)
  assert.equal(model.cells.length % 7, 0)
  assert.ok(model.weeks.every((week) => week.length === 7))
  const today = model.cells.find((cell) => cell.isToday)
  assert.equal(today.day, 8)
  assert.equal(today.inMonth, true)
  const firstWeek = model.weeks[0]
  assert.ok(firstWeek.some((cell) => !cell.inMonth), '首周应包含上月补齐的日期')
  assert.equal(model.cells.filter((cell) => cell.inMonth).length, 31, '10 月 31 天')
})

test('calendarMonth 把 DDL 与待跟进放到正确的日期格', () => {
  const model = calendarMonth(POOL, TODAY, '2026-10')
  const dueCell = model.cells.find((cell) => cell.iso === '2026-10-09')
  assert.ok(dueCell.items.some((item) => item.kind === 'due' && item.title === '官网改版'))
  assert.ok(dueCell.items.some((item) => item.kind === 'todo' && item.title === '事项 t2'))
  assert.ok(dueCell.items.every((item, index, array) => array.findIndex((x) => x.key === item.key) === index), '同一格内不应重复')
  const overdueTodo = model.cells.find((cell) => cell.iso === '2026-10-06')
  assert.equal(overdueTodo.items[0].tone, 'danger', '逾期的待跟进要标红')
  assert.ok(model.monthItems >= 4)
  assert.ok(model.daysWithItems >= 3)
})

test('calendarMonth 对空数据与无日期项目安全', () => {
  const model = calendarMonth([project({ id: 'x', dueDate: '' })], TODAY, '2026-10')
  assert.equal(model.monthItems, 0)
  assert.equal(model.cells.length % 7, 0)
  assert.ok(model.cells.every((cell) => cell.items.length === 0))
})

test('timelineModel 给出每行的起止位置与今天标记', () => {
  const model = timelineModel(POOL, TODAY)
  assert.ok(model.totalDays >= 7)
  assert.equal(model.rows.length, POOL.length)
  assert.ok(model.ticks.length >= 1)
  for (const row of model.rows) {
    assert.ok(row.leftPercent >= 0 && row.leftPercent <= 100)
    assert.ok(row.widthPercent > 0 && row.widthPercent <= 100)
    assert.ok(row.leftPercent + row.widthPercent <= 100.0001, '条不能超出右边界')
    assert.ok(row.startIso <= row.endIso)
  }
  assert.ok(model.todayPercent > 0 && model.todayPercent < 100)
  assert.deepEqual(model.rows.map((row) => row.project.id), ['d', 'a', 'b', 'f', 'c', 'e'], '按截止日期排序，未排期排最后')
})

test('timelineModel 对空数据与超长跨度都安全', () => {
  const empty = timelineModel([], TODAY)
  assert.deepEqual(empty.rows, [])
  assert.equal(empty.totalDays, 0)
  const long = timelineModel([project({ id: 'long', startedOn: '2024-01-01', dueDate: '2027-01-01' })], TODAY)
  assert.equal(long.totalDays, 210)
  assert.equal(long.padded, true)
  assert.ok(long.rows[0].widthPercent <= 100)
})

test('followUpBuckets 按紧迫度分桶并排序', () => {
  const buckets = followUpBuckets(POOL, TODAY)
  assert.deepEqual(buckets.map((bucket) => bucket.key), ['overdue', 'today', 'week', 'later', 'none'])
  const byKey = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket]))
  assert.equal(byKey.overdue.total, 1)
  assert.equal(byKey.overdue.items[0].overdueDays, 2)
  assert.equal(byKey.week.total, 1, '10-09 在本周内')
  assert.equal(byKey.later.total, 1, '10-20 更晚')
  const flat = buckets.flatMap((bucket) => bucket.items)
  assert.equal(flat.length, kpis(POOL, TODAY).openTodos)
  assert.ok(flat.every((item) => item.projectId && item.title))
})

test('headline 随数据变化给出不同结论', () => {
  assert.match(headline([], TODAY), /还没有项目/)
  assert.match(headline(POOL, TODAY), /已逾期/)
  const calm = [project({ id: 'z', dueDate: '2026-12-01', progress: 50 })]
  assert.match(headline(calm, TODAY), /节奏正常/)
})
