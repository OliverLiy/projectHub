import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAnalysisPrompt, buildDocDraft, deliveryHint, docKinds, portfolioBrief, projectBrief } from '../src/shared/prompt.js'

const TODAY = '2026-10-08'

const project = (over = {}) => ({
  id: 'p1',
  name: '结算系统',
  module: '公司项目',
  status: '进行中',
  dueDate: '2026-10-20',
  startedOn: '2026-10-01',
  progress: 40,
  owner: '我',
  summary: '把结算流程搬到线上',
  tags: ['后端', '财务'],
  updates: [
    { id: 'u1', at: '2026-10-07T09:00:00.000Z', kind: 'progress', text: '完成对账接口' },
    { id: 'u2', at: '2026-10-02T09:00:00.000Z', kind: 'blocker', text: '等财务确认口径' }
  ],
  todos: [
    { id: 't1', title: '联调支付', dueDate: '2026-10-15', done: false, owner: '我' },
    { id: 't2', title: '写验收用例', dueDate: '2026-10-01', done: true, doneAt: '2026-10-01T00:00:00.000Z' }
  ],
  ...over
})

test('projectBrief 输出关键字段、进展与待跟进', () => {
  const text = projectBrief(project(), TODAY)
  assert.match(text, /### 结算系统/)
  assert.match(text, /进度：40%/)
  assert.match(text, /完成对账接口/)
  assert.match(text, /联调支付/)
  assert.match(text, /等财务确认口径/)
  assert.match(text, /写验收用例/)
})

test('projectBrief 对空项目也不抛错', () => {
  const text = projectBrief({ name: '空项目' }, TODAY)
  assert.match(text, /### 空项目/)
  assert.match(text, /进展记录（新→旧，共 0 条）/)
})

test('portfolioBrief 按风险排序拼接多个项目', () => {
  const text = portfolioBrief([
    project({ id: 'n', name: '正常项目', dueDate: '2026-12-01' }),
    project({ id: 'o', name: '逾期项目', dueDate: '2026-10-01' })
  ], TODAY)
  assert.ok(text.indexOf('逾期项目') < text.indexOf('正常项目'))
  assert.match(portfolioBrief([], TODAY), /还没有项目/)
})

test('buildAnalysisPrompt 带上日期、范围与输出结构', () => {
  const text = buildAnalysisPrompt({ projects: [project()], today: TODAY })
  assert.match(text, /今天是 2026-10-08/)
  assert.match(text, /不要编造数据里没有的事实/)
  assert.match(text, /时间风险/)
  assert.match(text, /下一步动作/)
  assert.match(text, /结算系统/)
  const single = buildAnalysisPrompt({ projects: [project()], project: project({ name: '单项目' }), today: TODAY })
  assert.match(single, /下面这一个项目/)
  assert.match(single, /单项目/)
})

test('docKinds 暴露四类文档，deliveryHint 给出交付说明', () => {
  const kinds = docKinds().map((item) => item.value)
  assert.deepEqual(kinds, ['weekly', 'status', 'risk', 'meeting'])
  assert.match(deliveryHint('risk'), /风险清单/)
})

test('buildDocDraft 生成四类文档草稿', () => {
  const options = { projects: [project()], today: TODAY }
  const weekly = buildDocDraft('weekly', options)
  assert.match(weekly, /# 周报/)
  assert.match(weekly, /本周进展/)
  assert.match(weekly, /下周计划/)

  const risk = buildDocDraft('risk', options)
  assert.match(risk, /# 风险清单/)
  assert.match(risk, /\| 项目 \| 模块 \| 状态 \| 进度 \| 截止 \| 风险 \| 待跟进 \|/)
  assert.match(risk, /结算系统/)

  const meeting = buildDocDraft('meeting', options)
  assert.match(meeting, /# 会议纪要/)
  assert.match(meeting, /行动项/)

  const status = buildDocDraft('status', options)
  assert.match(status, /# 项目状态汇报/)
  assert.match(status, /最近进展：/)
})

test('单项目文档草稿只包含该项目', () => {
  const text = buildDocDraft('risk', {
    projects: [project({ id: 'x', name: '别的项目' }), project()],
    project: project(),
    today: TODAY
  })
  assert.match(text, /结算系统/)
  assert.ok(!text.includes('别的项目'))
})
