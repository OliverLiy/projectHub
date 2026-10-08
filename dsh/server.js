/**
 * 多项目总控台的服务端入口。
 *
 * 两件事：
 * 1. 把工作台的项目数据持久化到 DSH 数据目录（`/api/project-console/state`）；
 * 2. 「AI 填充」：把自然语言指令交给宿主注册的 LLM 翻译成一份变更计划
 *    （`/api/project-console/ai`）。模型只负责产出 JSON，
 *    校验/匹配/应用都在客户端与服务端的纯函数里做，模型不可用时退回本地规则。
 */
import Schema from '@deepseek-ai/schemastery'
import { createProjectStore, MAX_STATE_BYTES, StateError } from './store.js'
import { normalizePlan, planFromRules, planSchemaDoc, projectSnapshot } from '../src/shared/aiplan.js'
import { todayISO } from '../src/shared/analysis.js'
import { answerQuestion } from '../src/shared/query.js'

export const name = 'dsh-workbench-project-console'
export const inject = ['connection']
export const Config = Schema.object({
  root: Schema.string().required()
})

const PREFIX = '/api/project-console'
const AI_TIMEOUT_MS = 40_000
const MAX_INSTRUCTION = 2000

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_STATE_BYTES) {
    throw new StateError('请求体过大。', 413)
  }
  const reader = request.body?.getReader()
  if (!reader) throw new StateError('请求需要一个 JSON 请求体。')
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > MAX_STATE_BYTES) {
        await reader.cancel()
        throw new StateError('请求体过大。', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new StateError('请求体不是合法 JSON。')
  }
}

/** 从模型输出里抠出 JSON（容忍 ```json 代码块和前后废话）。 */
export function extractJson(text) {
  const raw = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON 计划')
  return JSON.parse(body.slice(start, end + 1))
}

/** 把一批模型输出块拼成纯文本。 */
export function assemblyText(assembler) {
  return assembler.blocks()
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('')
}

/**
 * 调宿主注册的 LLM 解析指令。任何一步不可用都抛错，由调用方退回本地规则。
 */
async function askModel(ctx, { instruction, projects, today }) {
  const get = (service) => (typeof ctx.get === 'function' ? ctx.get(service) : undefined)
  const llm = get('llm')
  if (!llm || typeof llm.stream !== 'function') throw new Error('宿主没有提供可用的 llm 服务')
  const defaults = get('agentDefaultModel')
  const route = typeof defaults?.currentSelection === 'function' ? defaults.currentSelection() : undefined
  if (!route?.provider || !route?.model) throw new Error('没有解析到默认模型')

  const { BlockAssembler, createUserMessage } = await import('@deepseek-ai/dsh-llm')
  const system = [
    '你是一个项目管理助手，把用户的中文指令翻译成对工作台项目数据的操作计划。',
    '只输出一个 JSON 对象，不要解释，不要输出代码块以外的内容。',
    planSchemaDoc(today)
  ].join('\n\n')
  const userText = [
    '当前项目快照（JSON，只能引用这里出现过的项目名或 id）：',
    JSON.stringify(projectSnapshot(projects, today)),
    '',
    `用户指令：${instruction}`
  ].join('\n')

  const assembler = new BlockAssembler()
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS)
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({ content: [{ type: 'text', text: userText }], source: { kind: 'dsh-workbench-project-console' } })],
    system,
    maxTokens: 1500,
    purpose: 'project-console-ai',
    signal
  })) {
    assembler.push(chunk)
  }
  const finish = assembler.finish
  if (finish && finish.kind !== 'stop') {
    const detail = finish.failure?.message ?? finish.reason?.kind ?? finish.kind
    throw new Error(`模型调用没有正常结束：${detail}`)
  }
  return { raw: extractJson(assemblyText(assembler)), model: `${route.provider}/${route.model}` }
}

export function apply(ctx, config) {
  const store = createProjectStore(config.root)
  const noStore = { 'cache-control': 'no-store' }
  const json = (payload, status = 200) => Response.json(payload, { status, headers: noStore })
  const fail = (error, fallback) =>
    json({ error: error instanceof StateError ? error.message : fallback },
      error instanceof StateError ? error.status : 500)

  ctx.connection.fetch.register({
    path: `${PREFIX}/meta`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        return json({ plugin: name, ...(await store.meta()) })
      } catch (error) {
        return fail(error, '无法读取项目数据。')
      }
    }
  })

  // 一个路径只能注册一条路由，所以读写共用一个路径、按方法分发。
  ctx.connection.fetch.register({
    path: `${PREFIX}/state`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request?.method === 'POST') {
          return json(await store.write(await readJsonBody(request)))
        }
        const { revision, state } = await store.read()
        return json({ revision, state })
      } catch (error) {
        return fail(error, '无法处理项目数据请求。')
      }
    }
  })

  // AI 填充：自然语言 → 变更计划（不落库，落库由客户端确认后走 /state）。
  ctx.connection.fetch.register({
    path: `${PREFIX}/ai`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const payload = await readJsonBody(request)
        const instruction = String(payload?.instruction ?? '').trim().slice(0, MAX_INSTRUCTION)
        if (!instruction) throw new StateError('请先输入一句指令。')
        const projects = Array.isArray(payload?.projects) ? payload.projects : []
        const today = /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.today ?? '')) ? String(payload.today) : todayISO()

        try {
          const { raw, model } = await askModel(ctx, { instruction, projects, today })
          const plan = normalizePlan(raw, projects, today)
          if (plan.intent === 'query' && !plan.reply) plan.reply = answerQuestion(instruction, projects, today).text
          return json({ source: 'llm', model, today, plan })
        } catch (error) {
          const plan = planFromRules(instruction, projects, today)
          return json({
            source: 'rules',
            reason: error instanceof Error ? error.message : String(error),
            today,
            plan
          })
        }
      } catch (error) {
        return fail(error, '无法解析这句话。')
      }
    }
  })
}
