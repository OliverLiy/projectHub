/** 客户端访问本工作台服务端接口的薄封装。 */
const PREFIX = '/api/project-console'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function newId(prefix = 'p') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function parse(response) {
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    throw new ApiError((payload && payload.error) || `请求失败（HTTP ${response.status}）`, response.status)
  }
  return payload
}

/** 读取项目文档。 */
export async function readState() {
  const response = await fetch(`${PREFIX}/state`, { credentials: 'same-origin', cache: 'no-store' })
  const payload = await parse(response)
  if (!payload || typeof payload !== 'object') throw new ApiError('服务端返回了无法识别的数据。', 500)
  return { revision: Number(payload.revision) || 0, state: payload.state || { version: 1, projects: [] } }
}

/** 让 AI 把自然语言指令解析成变更计划（不落库）。 */
export async function askAi(instruction, projects, today) {
  const response = await fetch(`${PREFIX}/ai`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, projects, today })
  })
  if (response.status === 404) {
    throw new ApiError('服务端还没加载 AI 解析接口（重启 Harness 后可用）。', 404)
  }
  const payload = await parse(response)
  if (!payload || typeof payload !== 'object' || !payload.plan) {
    throw new ApiError('服务端没有返回可用的变更计划。', 500)
  }
  return payload
}

/** 整体替换项目文档；版本号不一致时抛 409。 */
export async function writeState(revision, state) {
  const response = await fetch(`${PREFIX}/state`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, state })
  })
  return parse(response)
}
