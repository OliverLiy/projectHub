import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSampleProjects, sampleSummary } from '../src/shared/sample.js'
import { MODULES, openTodos, projectRisk } from '../src/shared/analysis.js'
import { railModules, summarize } from '../src/shared/views.js'
import { sanitizeState } from '../dsh/store.js'

const TODAY = '2026-10-08'

test('每种项目模块都生成了至少 3 个示例项目', () => {
  const projects = buildSampleProjects(TODAY)
  assert.ok(projects.length >= 9, `示例项目数量偏少：${projects.length}`)
  for (const module of MODULES) {
    const count = projects.filter((project) => project.module === module).length
    assert.ok(count >= 3, `${module} 只有 ${count} 个示例`)
  }
  // 只使用规范里的三个模块
  assert.deepEqual([...new Set(projects.map((project) => project.module))].sort(), [...MODULES].sort())
})

test('示例项目字段完整、类型正确、id 唯一', () => {
  const projects = buildSampleProjects(TODAY)
  const ids = new Set()
  for (const project of projects) {
    assert.equal(typeof project.id, 'string')
    assert.ok(project.id.length > 0)
    assert.ok(!ids.has(project.id), `id 重复：${project.id}`)
    ids.add(project.id)
    assert.ok(project.name.length > 0)
    assert.match(project.dueDate, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(project.startedOn, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(project.progress >= 0 && project.progress <= 100)
    assert.ok(Array.isArray(project.updates))
    assert.ok(Array.isArray(project.todos))
    assert.ok(project.tags.includes('示例'), '示例项目应带「示例」标签')
    for (const todo of project.todos) {
      assert.equal(typeof todo.title, 'string')
      assert.equal(typeof todo.done, 'boolean')
      assert.match(todo.dueDate, /^\d{4}-\d{2}-\d{2}$/)
    }
    for (const item of project.updates) {
      assert.ok(['note', 'progress', 'blocker', 'decision'].includes(item.kind))
      assert.ok(item.text.length > 0)
    }
  }
})

test('日常工作里必须有技术分享准备与季度汇报', () => {
  const daily = buildSampleProjects(TODAY).filter((project) => project.module === '日常工作')
  assert.ok(daily.length >= 3)
  assert.ok(daily.some((project) => /分享/.test(project.name)), '缺少技术分享准备')
  assert.ok(daily.some((project) => /季度汇报/.test(project.name)), '缺少季度汇报')
  assert.ok(daily.every((project) => project.summary.length > 0), '每个示例都要有一句话说明')
})

test('示例内容都是研发工作语境', () => {
  const projects = buildSampleProjects(TODAY)
  const text = projects
    .map((project) => [project.name, project.summary, ...(project.tags ?? []), ...(project.todos ?? []).map((todo) => todo.title)].join(' '))
    .join(' ')
  for (const needle of ['服务', '接口', '依赖', '告警', '性能', '开源', '测试', '代码']) {
    assert.ok(text.includes(needle), `示例内容里应出现研发词汇：${needle}`)
  }
  // 不能残留和研发无关的旧案例
  for (const stale of ['报销', '供应商比价', '拜访材料', '内训课件']) {
    assert.ok(!text.includes(stale), `示例里不该再有旧案例：${stale}`)
  }
})

test('示例数据覆盖各种风险等级，第一眼就能看出差别', () => {
  const projects = buildSampleProjects(TODAY)
  const levels = new Set(projects.map((project) => projectRisk(project, TODAY).level))
  for (const level of ['overdue', 'urgent', 'slipping', 'blocked', 'done', 'normal']) {
    assert.ok(levels.has(level), `缺少 ${level} 的示例项目`)
  }
  const stats = summarize(projects, TODAY)
  assert.ok(stats.overdue >= 1)
  assert.ok(stats.openTodos >= 5, '示例的待跟进事项太少')
})

test('示例数据在给定日期上是相对生成的，换一天也成立', () => {
  const other = '2027-03-15'
  const projects = buildSampleProjects(other)
  const overdue = projects.filter((project) => projectRisk(project, other).level === 'overdue')
  assert.ok(overdue.length >= 1)
  for (const project of overdue) assert.ok(project.dueDate < other)
  const levels = new Set(projects.map((project) => projectRisk(project, other).level))
  assert.ok(levels.has('urgent') && levels.has('done'))
})

test('同样的日期生成同样的结果（可重复）', () => {
  assert.deepEqual(buildSampleProjects(TODAY), buildSampleProjects(TODAY))
})

test('示例数据能直接通过存储层的结构收敛', () => {
  const projects = buildSampleProjects(TODAY)
  const sanitized = sanitizeState({ version: 1, projects })
  assert.equal(sanitized.projects.length, projects.length, '不该有示例项目被 sanitize 丢掉')
  assert.deepEqual(sanitized.projects.map((project) => project.id), projects.map((project) => project.id))
  assert.ok(sanitized.projects.every((project) => project.tags.includes('示例')))
})

test('侧栏能按模块统计出示例数据', () => {
  const rail = railModules(buildSampleProjects(TODAY), TODAY)
  assert.deepEqual(rail.map((item) => item.name), MODULES)
  assert.ok(rail.every((item) => item.total >= 3))
})

test('sampleSummary 说明数量与模块分布', () => {
  const summary = sampleSummary(buildSampleProjects(TODAY))
  assert.match(summary, /^12 个示例项目/)
  for (const module of MODULES) assert.ok(summary.includes(module), `${module} 应出现在说明里`)
})
