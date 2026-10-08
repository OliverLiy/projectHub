import test from 'node:test'
import assert from 'node:assert/strict'
import { QUESTION_EXAMPLES, answerQuestion } from '../src/shared/query.js'

const TODAY = '2026-10-08'

const project = (over = {}) => ({
  id: over.id ?? 'p1',
  name: over.name ?? '客户结算系统',
  module: over.module ?? '公司项目',
  status: over.status ?? '进行中',
  dueDate: over.dueDate ?? '2026-10-30',
  startedOn: over.startedOn ?? '2026-10-01',
  progress: over.progress ?? 50,
  owner: over.owner ?? '我',
  summary: over.summary ?? '',
  tags: [],
  updates: over.updates ?? [],
  todos: over.todos ?? [],
  ...over
})

const POOL = [
  project({ id: 'a', name: '结算系统', dueDate: '2026-10-01', todos: [{ id: 't1', title: '对账', dueDate: '2026-10-06', done: false }] }),
  project({ id: 'b', name: '官网改版', module: '日常工作', dueDate: '2026-10-09' }),
  project({ id: 'c', name: '小程序', module: '其他项目', status: '阻塞', dueDate: '2026-11-20' }),
  project({ id: 'd', name: '内训课件', module: '日常工作', dueDate: '2026-12-31', status: '已完成' })
]

test('空问题与空数据都有可读的回答', () => {
  assert.match(answerQuestion('', POOL, TODAY).text, /问一句/)
  assert.match(answerQuestion('有什么风险', [], TODAY).text, /还没有项目/)
})

test('概览类问句给出整体分布', () => {
  const answer = answerQuestion('整体情况怎么样？', POOL, TODAY)
  assert.match(answer.text, /共 4 个项目/)
  assert.match(answer.text, /按模块/)
  assert.ok(answer.projectIds.length > 0)
})

test('风险类问句只列出需要关注的项目', () => {
  const answer = answerQuestion('有什么风险？', POOL, TODAY)
  assert.match(answer.text, /需要关注的项目/)
  assert.match(answer.text, /结算系统/)
  assert.ok(!answer.text.includes('内训课件'), '已完成项目不应出现在风险清单里')
  assert.ok(answer.projectIds.includes('a'))
})

test('时间窗口问句按 DDL 过滤', () => {
  assert.match(answerQuestion('哪些项目本周到期？', POOL, TODAY).text, /官网改版/)
  assert.match(answerQuestion('今天到期的项目', POOL, TODAY).text, /没有到期的项目/)
  assert.match(answerQuestion('哪些已经逾期了', POOL, TODAY).text, /结算系统/)
  assert.match(answerQuestion('这个月要交付什么', POOL, TODAY).text, /结算系统/)
})

test('待跟进问句列出未完成事项并可按逾期过滤', () => {
  const all = answerQuestion('我的待跟进还有哪些？', POOL, TODAY)
  assert.match(all.text, /对账/)
  assert.equal(all.projectIds[0], 'a')
  const overdue = answerQuestion('逾期的待跟进有哪些', POOL, TODAY)
  assert.match(overdue.text, /对账/)
})

test('提到项目名时聚焦该项目', () => {
  const answer = answerQuestion('小程序现在什么情况？', POOL, TODAY)
  assert.match(answer.text, /小程序/)
  assert.match(answer.text, /阻塞/)
  assert.deepEqual(answer.projectIds, ['c'])
})

test('无法识别的问题回退到需关注清单并给出问法提示', () => {
  const answer = answerQuestion('帮我看下那个啥', POOL, TODAY)
  assert.match(answer.text, /没看懂/)
  assert.match(answer.text, /本周到期/)
})

test('示例问句都能得到非空回答', () => {
  for (const example of QUESTION_EXAMPLES) {
    const answer = answerQuestion(example, POOL, TODAY)
    assert.ok(answer.text.length > 4, `${example} 的回答过短`)
  }
})
