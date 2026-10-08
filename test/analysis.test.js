import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DANGER_LEVELS, RISK_ORDER, clampProgress, daysLeft, formatRemaining, moduleNames,
  moduleRollup, openTodos, overview, projectRisk, slippage, sortByRisk, todayISO
} from '../src/shared/analysis.js'

const TODAY = '2026-10-10'

const project = (over = {}) => ({
  id: over.id ?? 'p1',
  name: over.name ?? '项目一',
  module: over.module ?? '公司项目',
  status: over.status ?? '进行中',
  dueDate: over.dueDate ?? '2026-10-30',
  startedOn: over.startedOn ?? '2026-10-01',
  progress: over.progress ?? 50,
  owner: over.owner ?? '我',
  summary: '',
  tags: [],
  updates: over.updates ?? [],
  todos: over.todos ?? [],
  ...over
})

test('todayISO 使用本地日历日', () => {
  assert.equal(todayISO(new Date(2026, 0, 5)), '2026-01-05')
})

test('daysLeft / formatRemaining 覆盖逾期、当天、明天与未来', () => {
  assert.equal(daysLeft('2026-10-10', TODAY), 0)
  assert.equal(daysLeft('2026-10-13', TODAY), 3)
  assert.equal(daysLeft('2026-10-07', TODAY), -3)
  assert.equal(formatRemaining('2026-10-07', TODAY), '已逾期 3 天')
  assert.equal(formatRemaining('2026-10-10', TODAY), '今天到期')
  assert.equal(formatRemaining('2026-10-11', TODAY), '明天到期')
  assert.equal(formatRemaining('2026-10-20', TODAY), '还剩 10 天')
  assert.equal(formatRemaining('', TODAY), '未排期')
})

test('projectRisk 按优先级判定风险等级', () => {
  assert.equal(projectRisk(project({ status: '已完成', dueDate: '2026-01-01' }), TODAY).level, 'done')
  assert.equal(projectRisk(project({ dueDate: '2026-10-09' }), TODAY).level, 'overdue')
  assert.equal(projectRisk(project({ status: '阻塞' }), TODAY).level, 'blocked')
  assert.equal(projectRisk(project({ dueDate: '' }), TODAY).level, 'unscheduled')
  assert.equal(projectRisk(project({ dueDate: '2026-10-12' }), TODAY).level, 'urgent')
  assert.equal(projectRisk(project({ dueDate: '2026-10-16' }), TODAY).level, 'soon')
  assert.equal(projectRisk(project({ dueDate: '2026-11-30', progress: 60 }), TODAY).level, 'normal')
})

test('projectRisk 能识别时间已过但进度落后的项目', () => {
  const slipping = project({ startedOn: '2026-10-01', dueDate: '2026-10-20', progress: 10 })
  assert.ok(slippage(slipping, TODAY) > 0.3)
  const risk = projectRisk(slipping, TODAY)
  assert.equal(risk.level, 'slipping')
  assert.match(risk.detail, /时间已过/)
})

test('projectRisk 的每个等级都带 label / tone / rank / detail', () => {
  const cases = [
    ['done', { status: '已完成' }],
    ['overdue', { dueDate: '2026-10-01' }],
    ['blocked', { status: '阻塞' }],
    ['unscheduled', { dueDate: '' }],
    ['urgent', { dueDate: '2026-10-12' }],
    ['slipping', { startedOn: '2026-10-01', dueDate: '2026-10-20', progress: 5 }],
    ['soon', { dueDate: '2026-10-16' }],
    ['normal', { dueDate: '2026-11-30' }]
  ]
  for (const [level, over] of cases) {
    const risk = projectRisk(project(over), TODAY)
    assert.equal(risk.level, level, `期望 ${level}，实际 ${risk.level}`)
    assert.ok(['danger', 'warn', 'ok', 'muted'].includes(risk.tone))
    assert.ok(typeof risk.label === 'string' && risk.label.length > 0)
    assert.ok(typeof risk.detail === 'string' && risk.detail.length > 0)
    assert.ok(Number.isSafeInteger(risk.rank))
  }
  assert.deepEqual(RISK_ORDER.map((level) => RISK_ORDER.indexOf(level)), [0, 1, 2, 3, 4, 5, 6, 7])
})

test('sortByRisk 把危险项目排在最前，同级按剩余天数', () => {
  const list = [
    project({ id: 'normal', name: '正常', dueDate: '2026-12-01' }),
    project({ id: 'overdue', name: '逾期', dueDate: '2026-10-01' }),
    project({ id: 'urgent2', name: '紧急后', dueDate: '2026-10-13' }),
    project({ id: 'urgent1', name: '紧急前', dueDate: '2026-10-11' })
  ]
  const sorted = sortByRisk(list, TODAY).map((item) => item.project.id)
  assert.deepEqual(sorted, ['overdue', 'urgent1', 'urgent2', 'normal'])
})

test('clampProgress 与 openTodos 处理脏数据', () => {
  assert.equal(clampProgress({ progress: 150 }), 100)
  assert.equal(clampProgress({ progress: -3 }), 0)
  assert.equal(clampProgress({}), 0)
  assert.equal(openTodos({ todos: [{ done: true }, { done: false }, null] }).length, 1)
})

test('moduleRollup 与 moduleNames 覆盖固定模块和自定义模块', () => {
  const list = [
    project({ id: 'a', module: '公司项目', dueDate: '2026-10-01' }),
    project({ id: 'b', module: '日常工作' }),
    project({ id: 'c', module: '副业试验', todos: [{ id: 't', title: 'x', done: false }] })
  ]
  assert.deepEqual(moduleNames(list).slice(0, 4), ['公司项目', '日常工作', '其他项目', '副业试验'])
  const rollup = moduleRollup(list, '公司项目', TODAY)
  assert.equal(rollup.total, 1)
  assert.equal(rollup.danger, 1)
  assert.equal(moduleRollup(list, '全部', TODAY).total, 3)
  assert.equal(moduleRollup(list, '副业试验', TODAY).openTodos, 1)
})

test('overview 汇总状态、风险、待跟进与需关注清单', () => {
  const list = [
    project({ id: 'a', name: 'A', dueDate: '2026-10-01' }),
    project({ id: 'b', name: 'B', status: '已完成' }),
    project({ id: 'c', name: 'C', dueDate: '2026-10-12', todos: [{ id: 't1', title: '找设计', dueDate: '2026-10-11', done: false }] })
  ]
  const data = overview(list, TODAY)
  assert.equal(data.total, 3)
  assert.equal(data.byStatus['已完成'], 1)
  assert.equal(data.byRisk.overdue, 1)
  assert.equal(data.byRisk.urgent, 1)
  assert.equal(data.followUps.length, 1)
  assert.equal(data.followUps[0].projectName, 'C')
  assert.deepEqual(data.attention.map((item) => item.project.id), ['a', 'c', 'b'])
  assert.ok(data.dueSoon.every((item) => ['overdue', 'urgent', 'soon'].includes(item.risk.level)))
  assert.ok(DANGER_LEVELS.includes(data.attention[0].risk.level))
})

test('overview 在空列表下不抛错', () => {
  const data = overview([], TODAY)
  assert.equal(data.total, 0)
  assert.deepEqual(data.followUps, [])
  assert.equal(data.modules.length >= 3, true)
})
