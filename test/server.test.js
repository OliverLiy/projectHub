import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Config, apply, inject, name } from '../dsh/server.js'

const PREFIX = '/api/project-console'

async function withServer(run) {
  const root = await mkdtemp(join(tmpdir(), 'project-console-api-'))
  const routes = []
  const ctx = { connection: { fetch: { register: (route) => routes.push(route) } } }
  try {
    apply(ctx, { root })
    await run({ routes, root })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const routeFor = (routes, path, method) => {
  const route = routes.find((item) => item.path === path && item.methods.includes(method))
  assert.ok(route, `缺少路由 ${method} ${path}`)
  return route
}

test('服务端入口的必须是规范要求的样子', () => {
  assert.equal(name, 'dsh-workbench-project-console')
  assert.deepEqual(inject, ['connection'])
  assert.equal(typeof Config, 'function', 'Config 必须是 Schemastery schema，不能是普通对象')
  assert.deepEqual(Config({ root: '/tmp/project-console' }), { root: '/tmp/project-console' })
  assert.throws(() => Config({}), /root/)
})

test('路由都挂在自己的前缀下，且每个路径只注册一次', async () => {
  await withServer(async ({ routes }) => {
    assert.equal(routes.length, 3)
    for (const route of routes) {
      assert.ok(route.path.startsWith(`${PREFIX}/`), `${route.path} 不在本工作台前缀下`)
      assert.equal(route.requestBody, 'buffered')
      assert.equal(typeof route.fetch, 'function')
      assert.ok(route.methods.length > 0)
    }
    // connection 的 exact Fetch 路由按路径唯一，重复注册会直接抛错（真实宿主里踩过）。
    assert.equal(new Set(routes.map((route) => route.path)).size, routes.length)
    assert.deepEqual(routeFor(routes, `${PREFIX}/state`, 'GET').methods, ['GET', 'POST'])
  })
})

test('GET /meta 报告插件名与数据目录', async () => {
  await withServer(async ({ routes, root }) => {
    const response = await routeFor(routes, `${PREFIX}/meta`, 'GET').fetch(new Request(`http://127.0.0.1${PREFIX}/meta`))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.plugin, 'dsh-workbench-project-console')
    assert.equal(payload.root, root)
    assert.equal(payload.revision, 0)
    assert.equal(payload.projectCount, 0)
  })
})

test('GET/POST /state 完成一次完整读写，并对旧版本号返回 409', async () => {
  await withServer(async ({ routes }) => {
    const stateRoute = routeFor(routes, `${PREFIX}/state`, 'GET')
    const initial = await (await stateRoute.fetch(new Request(`http://127.0.0.1${PREFIX}/state`))).json()
    assert.deepEqual(initial, { revision: 0, state: { version: 1, seededAt: '', projects: [] } })

    const body = {
      revision: 0,
      state: { version: 1, projects: [{ id: 'p1', name: '结算系统', module: '公司项目', dueDate: '2026-10-20', progress: 40 }] }
    }
    const write = routeFor(routes, `${PREFIX}/state`, 'POST')
    const written = await write.fetch(new Request(`http://127.0.0.1${PREFIX}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }))
    assert.equal(written.status, 200)
    assert.deepEqual(await written.json(), { revision: 1, projectCount: 1 })

    const reread = await (await stateRoute.fetch(new Request(`http://127.0.0.1${PREFIX}/state`))).json()
    assert.equal(reread.revision, 1)
    assert.equal(reread.state.projects[0].name, '结算系统')

    const stale = await write.fetch(new Request(`http://127.0.0.1${PREFIX}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }))
    assert.equal(stale.status, 409)
    assert.match((await stale.json()).error, /其他窗口/)
  })
})

const AI_PROJECT = { id: 'p1', name: '订单结算服务重构', module: '公司项目', status: '进行中', dueDate: '2026-10-06', startedOn: '2026-09-08', progress: 55, todos: [], updates: [] }

/** 用假的 llm 服务跑一遍服务端 AI 路径：prompt → 流 → 组装 → 解析 → 收敛。 */
async function withAiServer(services, run) {
  const root = await mkdtemp(join(tmpdir(), 'project-console-ai-'))
  const routes = []
  const ctx = {
    connection: { fetch: { register: (route) => routes.push(route) } },
    get: (name) => services[name]
  }
  try {
    apply(ctx, { root })
    await run({ routes })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const streamOf = (chunks) => async function* stream() { for (const chunk of chunks) yield chunk }
const delta = (text) => ({ type: 'text-delta', index: 0, text })
const stop = () => ({ type: 'finish', reason: { kind: 'stop' } })
const defaults = { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) }
const aiRoute = (routes) => routeFor(routes, `${PREFIX}/ai`, 'POST')
const postAi = (route, body) => route.fetch(new Request(`http://127.0.0.1${PREFIX}/ai`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
}))

test('模型可用时，/ai 走模型并把 JSON 收敛成计划', async () => {
  const calls = []
  await withAiServer({
    llm: { stream(options) { calls.push(options); return streamOf([
      delta('{"intent":"update","reply":"把进度调到 80%","actions":['),
      delta('{"op":"update","target":"订单结算服务重构","changes":{"progress":80,"dueDate":"下周五"}},{"op":"delete","target":"不存在的项目"}]}'),
      stop()
    ])() } },
    agentDefaultModel: defaults
  }, async ({ routes }) => {
    const response = await postAi(aiRoute(routes), { instruction: '进度调到 80%，DDL 改到下周五', projects: [AI_PROJECT], today: '2026-10-08' })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.source, 'llm')
    assert.equal(payload.model, 'deepseek-official/deepseek-flash')
    assert.equal(payload.today, '2026-10-08')
    assert.equal(payload.plan.intent, 'update')
    assert.equal(payload.plan.actions.length, 1, '找不到的项目要被丢掉')
    assert.deepEqual(payload.plan.actions[0].changes, { progress: 80, dueDate: '2026-10-16' })
    assert.ok(payload.plan.issues.some((issue) => /找不到项目/.test(issue)))
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].provider, 'deepseek-official')
  assert.equal(calls[0].model, 'deepseek-flash')
  assert.equal(calls[0].maxTokens, 1500)
  assert.ok(calls[0].system.includes('JSON'))
  assert.match(calls[0].messages[0].content[0].text, /订单结算服务重构/)
  assert.match(calls[0].messages[0].content[0].text, /进度调到 80%/)
})

test('模型输出带代码块和废话也能解析', async () => {
  await withAiServer({
    llm: { stream: () => streamOf([
      delta('好的，这是计划：\n```json\n{"intent":"add","reply":"新增一个项目","actions":[{"op":"add","name":"服务网格试点","module":"公司项目","dueDate":"月底"}]}\n```'),
      stop()
    ])() },
    agentDefaultModel: defaults
  }, async ({ routes }) => {
    const payload = await postAi(aiRoute(routes), { instruction: '新增服务网格试点', projects: [AI_PROJECT], today: '2026-10-08' }).then((r) => r.json())
    assert.equal(payload.source, 'llm')
    assert.equal(payload.plan.actions[0].project.name, '服务网格试点')
    assert.equal(payload.plan.actions[0].project.dueDate, '2026-10-31')
  })
})

test('模型只回 query 时用回复作答，没有回复则退回本地问答', async () => {
  await withAiServer({
    llm: { stream: () => streamOf([delta('{"intent":"query","reply":"本周只有官网改版要交付。","actions":[]}'), stop()])() },
    agentDefaultModel: defaults
  }, async ({ routes }) => {
    const payload = await postAi(aiRoute(routes), { instruction: '这周要交付什么', projects: [AI_PROJECT], today: '2026-10-08' }).then((r) => r.json())
    assert.equal(payload.plan.intent, 'query')
    assert.equal(payload.plan.reply, '本周只有官网改版要交付。')
  })

  await withAiServer({
    llm: { stream: () => streamOf([delta('{"intent":"query","actions":[]}'), stop()])() },
    agentDefaultModel: defaults
  }, async ({ routes }) => {
    const payload = await postAi(aiRoute(routes), { instruction: '这周要交付什么', projects: [AI_PROJECT], today: '2026-10-08' }).then((r) => r.json())
    assert.equal(payload.plan.intent, 'query')
    assert.ok(payload.plan.reply.length > 0, '模型没给回复时应由本地问答补上')
  })
})

test('模型报错、没有 JSON、没有服务时都退回本地规则', async () => {
  const cases = [
    { name: '流以 error 结束', services: { llm: { stream: () => streamOf([{ type: 'finish', reason: { kind: 'error', failure: { message: '配额不足' } } }])() }, agentDefaultModel: defaults }, match: /配额不足/ },
    { name: '输出没有 JSON', services: { llm: { stream: () => streamOf([delta('我不知道该怎么改'), stop()])() }, agentDefaultModel: defaults }, match: /没有返回 JSON/ },
    { name: '没有 llm 服务', services: { agentDefaultModel: defaults }, match: /llm/ },
    { name: '没有默认模型', services: { llm: { stream: () => streamOf([stop()])() } }, match: /默认模型/ },
    { name: 'stream 直接抛错', services: { llm: { stream() { throw new Error('适配器挂了') } }, agentDefaultModel: defaults }, match: /适配器挂了/ }
  ]
  for (const item of cases) {
    await withAiServer(item.services, async ({ routes }) => {
      const response = await postAi(aiRoute(routes), { instruction: '把订单结算服务重构的进度改成 90%', projects: [AI_PROJECT], today: '2026-10-08' })
      assert.equal(response.status, 200, item.name)
      const payload = await response.json()
      assert.equal(payload.source, 'rules', item.name)
      assert.match(payload.reason, item.match, item.name)
      assert.equal(payload.plan.actions[0].changes.progress, 90, item.name)
    })
  }
})

test('没有可用模型时，/ai 退回本地规则并说明原因', async () => {
  await withServer(async ({ routes }) => {
    const ai = routeFor(routes, `${PREFIX}/ai`, 'POST')
    const call = (body) => ai.fetch(new Request(`http://127.0.0.1${PREFIX}/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }))
    const projects = [{ id: 'p1', name: '订单结算服务重构', module: '公司项目', status: '进行中', dueDate: '2026-10-06', startedOn: '2026-09-08', progress: 55, todos: [], updates: [] }]

    const update = await call({ instruction: '把订单结算服务重构的 DDL 改到下周五，进度调整到 80%', projects, today: '2026-10-08' })
    assert.equal(update.status, 200)
    const payload = await update.json()
    assert.equal(payload.source, 'rules', '测试宿主没有 llm 服务，应退回规则解析')
    assert.match(payload.reason, /llm/)
    assert.equal(payload.plan.actions.length, 1)
    assert.deepEqual(payload.plan.actions[0].changes, { progress: 80, dueDate: '2026-10-16' })

    const query = await call({ instruction: '这周要交付什么？', projects, today: '2026-10-08' })
    const answered = await query.json()
    assert.equal(answered.plan.intent, 'query')
    assert.ok(answered.plan.reply.length > 0)
    assert.equal(answered.plan.actions.length, 0)
  })
})

test('/ai 对空指令返回 4xx', async () => {
  await withServer(async ({ routes }) => {
    const ai = routeFor(routes, `${PREFIX}/ai`, 'POST')
    const response = await ai.fetch(new Request(`http://127.0.0.1${PREFIX}/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction: '   ', projects: [] })
    }))
    assert.equal(response.status, 400)
  })
})

test('extractJson 容忍代码块与前后废话，assemblyText 只取文本块', async () => {
  const { extractJson, assemblyText } = await import('../dsh/server.js')
  assert.deepEqual(extractJson('```json\n{"intent":"query"}\n```'), { intent: 'query' })
  assert.deepEqual(extractJson('好的，这是计划：{"intent":"add","actions":[]} 完'), { intent: 'add', actions: [] })
  assert.throws(() => extractJson('没有 JSON'), /没有返回 JSON/)
  const assembler = {
    blocks: () => [
      { type: 'text', text: '{"a"' },
      { type: 'tool-call', text: 'ignored' },
      { type: 'text', text: ':1}' }
    ]
  }
  assert.equal(assemblyText(assembler), '{"a":1}')
})

test('POST /state 对非法 JSON 与超大请求体返回 4xx', async () => {
  await withServer(async ({ routes }) => {
    const write = routeFor(routes, `${PREFIX}/state`, 'POST')
    const broken = await write.fetch(new Request(`http://127.0.0.1${PREFIX}/state`, { method: 'POST', body: '{oops' }))
    assert.equal(broken.status, 400)

    const huge = await write.fetch(new Request(`http://127.0.0.1${PREFIX}/state`, {
      method: 'POST',
      headers: { 'content-length': String(9 * 1024 * 1024) },
      body: '{}'
    }))
    assert.equal(huge.status, 413)
  })
})
