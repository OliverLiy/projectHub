import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STATE_FILE, StateError, createProjectStore, emptyState, sanitizeState } from '../dsh/store.js'

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), 'project-console-'))
  try {
    return await run(createProjectStore(root), root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const sample = {
  version: 1,
  projects: [{
    id: 'p1',
    name: '结算系统',
    module: '公司项目',
    status: '进行中',
    dueDate: '2026-10-20',
    startedOn: '2026-10-01',
    progress: 40,
    updates: [{ id: 'u1', at: '2026-10-07T09:00:00.000Z', kind: 'progress', text: '完成对账接口' }],
    todos: [{ id: 't1', title: '联调支付', dueDate: '2026-10-15', done: false }]
  }]
}

test('空目录读出空文档且版本号为 0', async () => {
  await withStore(async (store, root) => {
    const document = await store.read()
    assert.equal(document.revision, 0)
    assert.deepEqual(document.state.projects, [])
    const files = await readdir(root)
    assert.deepEqual(files, [], '读取不应创建任何文件')
  })
})

test('写入后版本号自增并可原样读回', async () => {
  await withStore(async (store, root) => {
    const first = await store.write({ revision: 0, state: sample })
    assert.equal(first.revision, 1)
    assert.equal(first.projectCount, 1)
    const document = await store.read()
    assert.equal(document.revision, 1)
    assert.equal(document.state.projects[0].name, '结算系统')
    assert.equal(document.state.projects[0].todos[0].title, '联调支付')
    const onDisk = JSON.parse(await readFile(join(root, STATE_FILE), 'utf8'))
    assert.equal(onDisk.revision, 1)
    assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])
  })
})

test('版本号过期时拒绝写入并给出 409', async () => {
  await withStore(async (store) => {
    await store.write({ revision: 0, state: sample })
    await assert.rejects(() => store.write({ revision: 0, state: sample }), (error) => {
      assert.ok(error instanceof StateError)
      assert.equal(error.status, 409)
      return true
    })
  })
})

test('写入会收敛脏数据：丢弃无名项目、夹紧进度、修掉重复 id', async () => {
  await withStore(async (store) => {
    await store.write({
      revision: 0,
      state: {
        projects: [
          { id: 'dup', name: 'A', progress: 180, todos: [{ title: '' }, { title: '有效', done: true }] },
          { id: 'dup', name: 'B', progress: -5 },
          { name: '   ' },
          null,
          'nope'
        ]
      }
    })
    const { state } = await store.read()
    assert.equal(state.projects.length, 2)
    assert.equal(state.projects[0].progress, 100)
    assert.equal(state.projects[0].todos.length, 1)
    assert.equal(state.projects[1].progress, 0)
    assert.notEqual(state.projects[0].id, state.projects[1].id)
    assert.equal(state.version, 1)
  })
})

test('seededAt 会被保留，但仍受结构收敛约束', async () => {
  await withStore(async (store) => {
    await store.write({ revision: 0, state: { seededAt: '2026-10-08T00:00:00.000Z', projects: [] } })
    const { state } = await store.read()
    assert.equal(state.seededAt, '2026-10-08T00:00:00.000Z')
    await store.write({ revision: 1, state: { seededAt: 'not-a-date', projects: [] } })
    assert.equal((await store.read()).state.seededAt, '', '非法时间戳应被清掉')
  })
})

test('sanitizeState 拒绝非对象输入', () => {
  for (const bad of [null, undefined, [], 'x', 3]) {
    assert.throws(() => sanitizeState(bad), StateError)
  }
  assert.deepEqual(sanitizeState(emptyState()), emptyState())
})

test('损坏的数据文件不会被静默覆盖', async () => {
  await withStore(async (store, root) => {
    await writeFile(join(root, STATE_FILE), '{ 这不是 JSON', 'utf8')
    await assert.rejects(() => store.read(), (error) => {
      assert.ok(error instanceof StateError)
      assert.equal(error.status, 500)
      return true
    })
    await assert.rejects(() => store.write({ revision: 0, state: sample }), StateError)
    assert.equal(await readFile(join(root, STATE_FILE), 'utf8'), '{ 这不是 JSON')
  })
})

test('meta 返回目录、文件与计数，便于探活', async () => {
  await withStore(async (store, root) => {
    await store.write({ revision: 0, state: sample })
    const meta = await store.meta()
    assert.equal(meta.root, root)
    assert.equal(meta.file, join(root, STATE_FILE))
    assert.equal(meta.projectCount, 1)
  })
})

test('并发写入被串行化，只有一个成功', async () => {
  await withStore(async (store) => {
    const results = await Promise.allSettled([
      store.write({ revision: 0, state: sample }),
      store.write({ revision: 0, state: sample })
    ])
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
    assert.equal(results.filter((item) => item.status === 'rejected').length, 1)
    assert.equal((await store.read()).revision, 1)
  })
})

test('没有数据目录时报错而不是写到别处', () => {
  assert.throws(() => createProjectStore(''), /数据目录未配置/)
})
