import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const CODE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const PACKAGE_NAME = 'dsh-workbench-project-console'

/** 用与浏览器一致的协议加载构建产物：window.__ModuleLoader__.load({ id, factory })。 */
function loadBundle() {
  let registration
  const stubWindow = { __ModuleLoader__: { load: (value) => { registration = value } } }
  new Function('window', CODE)(stubWindow)
  assert.ok(registration, '构建产物必须调用 window.__ModuleLoader__.load')
  return registration
}

/** 客户端只允许 require 宿主共享基线里的模块。 */
const requireStub = (spec) => {
  if (spec === 'react') return React
  throw new Error(`构建产物引用了基线之外的模块：${spec}`)
}

const loadPlugin = () => loadBundle().factory(requireStub)

/** 按 Desktop 的方式调用 apply，取回注册信息。 */
function registerPlugin() {
  const plugin = loadPlugin()
  const registrations = []
  const effects = []
  const ctx = {
    effect: (callback) => { effects.push(callback()) },
    desktopWorkbenches: {
      register: (descriptor, Component) => {
        registrations.push({ descriptor, Component })
        return () => undefined
      }
    }
  }
  plugin.apply(ctx)
  return { plugin, registrations, effects }
}

const project = (over = {}) => ({
  id: over.id ?? 'p1',
  name: over.name ?? '结算系统',
  module: over.module ?? '公司项目',
  status: over.status ?? '进行中',
  dueDate: over.dueDate ?? '2026-10-30',
  startedOn: over.startedOn ?? '2026-10-01',
  progress: over.progress ?? 40,
  owner: over.owner ?? '我',
  summary: over.summary ?? '',
  tags: over.tags ?? [],
  updates: over.updates ?? [{ id: 'u1', at: '2026-10-07T09:00:00.000Z', kind: 'progress', text: '接口联调完成' }],
  todos: over.todos ?? [{ id: 't1', title: '补齐验收用例', dueDate: '2026-10-15', done: false }],
  ...over
})

const render = (plugin, portfolio) => renderToStaticMarkup(React.createElement(plugin.ConsoleView, { portfolio }))

const readyPortfolio = (projects) => ({
  status: 'ready', error: '', conflict: false, saving: false, revision: 3,
  state: { version: 1, projects }, reload: () => undefined, update: async () => true, setError: () => undefined
})

const SAMPLE = [
  project({ id: 'p2', name: '官网改版', module: '日常工作', dueDate: '2026-10-10', progress: 30 }),
  project({ id: 'p1', name: '结算系统二期', module: '公司项目', dueDate: '2026-10-01', progress: 55 }),
  project({ id: 'p3', name: '客户拜访材料', module: '其他项目', status: '阻塞', dueDate: '2026-11-20', progress: 15, todos: [] }),
  project({ id: 'p4', name: '内训课件', module: '日常工作', status: '已完成', dueDate: '2026-09-01', progress: 100, todos: [] })
]

test('构建产物用本包名注册，且只 require 共享基线', () => {
  const registration = loadBundle()
  assert.equal(registration.id, PACKAGE_NAME)
  const specs = [...CODE.matchAll(/__require\("([^"]+)"\)/g)].map((match) => match[1])
  const bare = [...new Set(specs.filter((spec) => !spec.includes('/')))]
  assert.deepEqual(bare, ['react'])
  assert.ok(!/^import\s/m.test(CODE), '产物里不应残留 ESM import')
  assert.ok(!/^export\s/m.test(CODE), '产物里不应残留 ESM export')
})

test('插件导出 apply 与 inject', () => {
  const plugin = loadPlugin()
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['desktopWorkbenches'])
})

test('注册描述符：左侧嵌入式面板、标题、GitHub 仓库、布局边界', () => {
  const { registrations, effects } = registerPlugin()
  assert.equal(registrations.length, 1)
  assert.equal(effects.length, 1)
  assert.equal(typeof effects[0], 'function', 'register 的返回值必须交给 ctx.effect 管理')
  const { descriptor, Component } = registrations[0]
  assert.equal(descriptor.title, '项目总控台')
  assert.match(descriptor.repository, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/)
  assert.equal(descriptor.id, undefined, '新包不填写旧的 register({ id })')
  assert.equal(descriptor.embedded, true, '左侧嵌入式面板需要 embedded')
  assert.equal(descriptor.layout.businessSide, 'left')
  assert.ok(descriptor.layout.businessWidth >= 0.25 && descriptor.layout.businessWidth <= 0.7)
  assert.equal(typeof Component, 'function')
})

test('注册的面板是接数据的 ProjectConsole', () => {
  const { plugin, registrations } = registerPlugin()
  assert.equal(registrations[0].Component, plugin.ProjectConsole)
  assert.equal(typeof plugin.ConsoleView, 'function')
  assert.notEqual(plugin.ProjectConsole, plugin.ConsoleView)
})

test('没有项目时：页签、模块导航、KPI 与问一句都在', () => {
  const { plugin } = registerPlugin()
  const html = render(plugin, readyPortfolio([]))
  assert.match(html, /项目总控台/)
  for (const label of ['概览', '模块看板', '状态看板', '列表', '日历', '时间线', '待跟进']) {
    assert.ok(html.includes(label), `缺少页签：${label}`)
  }
  assert.match(html, /role="tablist"/)
  assert.match(html, /智能视图/)
  assert.match(html, /全部项目/)
  assert.match(html, /项目总数/)
  assert.match(html, /问一句/)
  assert.match(html, /还没有项目/)
  assert.match(html, /新建项目/)
  assert.match(html, /AI 填充/)
  assert.match(html, /已保存 · 修订 3/)
})

test('有数据时：概览渲染 KPI 与四个维度的图表', () => {
  const { plugin } = registerPlugin()
  const html = render(plugin, readyPortfolio(SAMPLE))
  assert.match(html, /4 个项目 · 3 个模块/)
  assert.match(html, /项目总数/)
  assert.match(html, /需关注/)
  assert.match(html, /风险分布/)
  assert.match(html, /pc-donut/)
  assert.match(html, /pc-legend/)
  assert.match(html, /模块负载/)
  assert.match(html, /pc-stacked/)
  assert.match(html, /进度分布/)
  assert.match(html, /pc-hist/)
  assert.match(html, /负责人负载/)
  assert.match(html, /pc-rank/)
  assert.match(html, /需要马上处理/)
  assert.match(html, /本周到期/)
  assert.match(html, /结算系统二期/)
  assert.match(html, /公司项目/)
  assert.match(html, /pc-accent-indigo/)
})

test('侧栏按模块与会话维度给出计数，并带模块强调色', () => {
  const { plugin } = registerPlugin()
  const html = render(plugin, readyPortfolio(SAMPLE))
  assert.match(html, /pc-rail-item/)
  assert.match(html, /pc-rail-count/)
  assert.match(html, /需关注/)
  assert.match(html, /已逾期/)
  assert.match(html, /有待跟进/)
  assert.match(html, /已完成/)
})

test('读取失败时渲染错误提示与重试动作', () => {
  const { plugin } = registerPlugin()
  const html = render(plugin, {
    status: 'error', error: '无法读取项目数据。', conflict: false, saving: false, revision: 0,
    state: { version: 1, projects: [] }, reload: () => undefined, update: async () => true, setError: () => undefined
  })
  assert.match(html, /无法读取项目数据。/)
  assert.match(html, /读取失败/)
  assert.match(html, /重试/)
})

test('加载中渲染骨架屏而不是空白', () => {
  const { plugin } = registerPlugin()
  const html = render(plugin, {
    status: 'loading', error: '', conflict: false, saving: false, revision: 0,
    state: { version: 1, projects: [] }, reload: () => undefined, update: async () => true, setError: () => undefined
  })
  assert.match(html, /pc-skeleton/)
  assert.ok(!html.includes('还没有项目'))
})
