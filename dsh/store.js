/**
 * 项目总控台的服务端数据存储。
 *
 * 一个 JSON 文档、一个版本号、一次原子写入：写入前做结构性收敛（sanitize），
 * 避免客户端把形状不对的数据写进磁盘；版本号用于并发写入检测（CAS）。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const STATE_VERSION = 1
export const STATE_FILE = 'state.json'
/** 一个工作台文档的上限，超过就拒绝，避免把磁盘写坏。 */
export const MAX_STATE_BYTES = 4 * 1024 * 1024

const MAX_TEXT = 4000
const MAX_SHORT = 200
const MAX_ID = 120
const MAX_ITEMS = 2000

export class StateError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'StateError'
    this.status = status
  }
}

export function emptyState() {
  return { version: STATE_VERSION, seededAt: '', projects: [] }
}

const text = (value, max = MAX_SHORT) => (typeof value === 'string' ? value.slice(0, max) : '')
const isoDate = (value) => {
  const raw = text(value, 40).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}
const isoStamp = (value) => {
  const raw = text(value, 40).trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}
const clampPercent = (value) => {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(100, Math.max(0, Math.round(number)))
}
const list = (value) => (Array.isArray(value) ? value : [])

function sanitizeUpdate(raw) {
  if (!raw || typeof raw !== 'object') return null
  const body = text(raw.text, MAX_TEXT).trim()
  if (!body) return null
  return {
    id: text(raw.id, MAX_ID) || randomUUID(),
    at: isoStamp(raw.at) || new Date().toISOString(),
    kind: ['note', 'progress', 'blocker', 'decision'].includes(raw.kind) ? raw.kind : 'note',
    text: body
  }
}

function sanitizeTodo(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = text(raw.title, MAX_SHORT).trim()
  if (!title) return null
  return {
    id: text(raw.id, MAX_ID) || randomUUID(),
    title,
    owner: text(raw.owner, MAX_SHORT),
    dueDate: isoDate(raw.dueDate),
    done: raw.done === true,
    doneAt: raw.done === true ? isoStamp(raw.doneAt) || new Date().toISOString() : ''
  }
}

function sanitizeProject(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = text(raw.name, MAX_SHORT).trim()
  if (!name) return null
  const now = new Date().toISOString()
  return {
    id: text(raw.id, MAX_ID) || randomUUID(),
    name,
    module: text(raw.module, MAX_SHORT).trim() || '其他项目',
    status: text(raw.status, MAX_SHORT).trim() || '进行中',
    owner: text(raw.owner, MAX_SHORT),
    dueDate: isoDate(raw.dueDate),
    startedOn: isoDate(raw.startedOn),
    progress: clampPercent(raw.progress),
    link: text(raw.link, 500),
    summary: text(raw.summary, MAX_TEXT),
    tags: list(raw.tags).map((tag) => text(tag, 40)).filter(Boolean).slice(0, 20),
    createdAt: isoStamp(raw.createdAt) || now,
    updatedAt: isoStamp(raw.updatedAt) || now,
    updates: list(raw.updates).map(sanitizeUpdate).filter(Boolean).slice(0, MAX_ITEMS),
    todos: list(raw.todos).map(sanitizeTodo).filter(Boolean).slice(0, MAX_ITEMS)
  }
}

/** 结构性收敛：形状不对的输入变成合法文档，而不是直接落盘。 */
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new StateError('项目数据必须是一个对象。')
  }
  const projects = list(raw.projects).map(sanitizeProject).filter(Boolean).slice(0, MAX_ITEMS)
  const seen = new Set()
  const unique = []
  for (const project of projects) {
    const id = seen.has(project.id) ? randomUUID() : project.id
    seen.add(id)
    unique.push({ ...project, id })
  }
  // seededAt 记录"示例数据是否已经自动生成过"，避免清空后被再次灌入。
  return { version: STATE_VERSION, seededAt: isoStamp(raw.seededAt), projects: unique }
}

function parseDocument(buffer) {
  let parsed
  try {
    parsed = JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new StateError('项目数据文件无法解析，请修复或移走该文件后重试。', 500)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('state' in parsed)) {
    throw new StateError('项目数据文件格式不正确。', 500)
  }
  const revision = Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0
  return { revision, state: sanitizeState(parsed.state) }
}

/**
 * 创建一个以 `root` 为数据目录的存储。
 * @param root - 绝对路径目录；不存在时会在首次写入前创建。
 */
export function createProjectStore(root) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('project-console: 数据目录未配置')
  const file = join(root, STATE_FILE)
  let cache
  let queue = Promise.resolve()

  const serialize = (task) => {
    const run = queue.then(task, task)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  async function load() {
    if (cache) return cache
    let buffer
    try {
      buffer = await readFile(file)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        cache = { revision: 0, state: emptyState() }
        return cache
      }
      throw new StateError('无法读取项目数据。', 500)
    }
    if (buffer.length > MAX_STATE_BYTES) throw new StateError('项目数据文件过大。', 500)
    cache = parseDocument(buffer)
    return cache
  }

  async function persist(document) {
    await mkdir(root, { recursive: true })
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    const payload = `${JSON.stringify(document, null, 2)}\n`
    if (Buffer.byteLength(payload) > MAX_STATE_BYTES) throw new StateError('项目数据过大，未保存。', 413)
    try {
      await writeFile(temporary, payload, 'utf8')
      await rename(temporary, file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error instanceof StateError ? error : new StateError('项目数据写入失败。', 500)
    }
    return document
  }

  return {
    /** 读取当前文档（含版本号）。 */
    read() {
      return serialize(async () => {
        const current = await load()
        return { revision: current.revision, state: current.state }
      })
    },
    /** 版本号一致时整体替换文档，返回新版本号。 */
    write(payload) {
      return serialize(async () => {
        const current = await load()
        const revision = Number.isSafeInteger(payload?.revision) ? payload.revision : -1
        if (revision !== current.revision) {
          throw new StateError('项目数据已在其他窗口更新，请重新加载后再保存。', 409)
        }
        const next = { revision: current.revision + 1, state: sanitizeState(payload?.state) }
        await persist(next)
        cache = next
        return { revision: next.revision, projectCount: next.state.projects.length }
      })
    },
    /** 只读摘要，便于外部核验（例如 curl 探活）。 */
    async meta() {
      const current = await load()
      return { root, file, revision: current.revision, projectCount: current.state.projects.length }
    }
  }
}
