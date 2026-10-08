#!/usr/bin/env node
/**
 * 把 src/ 下的多文件源码打成 Desktop 需要的单文件客户端模块 lib/client.js。
 *
 * 只处理位于第 0 列的 `import` / `export` 行，其余内容（含 CSS 模板字符串）
 * 原样保留。相对路径的模块被内联进同一文件；裸包名（如 react）交给模块
 * 加载器的 require，因为它们是宿主的共享基线。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(ROOT, 'src')
const ENTRY = 'client/index.js'
const OUT = resolve(ROOT, 'lib/client.js')
const PACKAGE_NAME = 'dsh-workbench-project-console'

const IMPORT_DEFAULT = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+)'\s*;?$/
const IMPORT_NAMED = /^import\s*\{([^}]*)\}\s*from\s+'([^']+)'\s*;?$/
const IMPORT_SIDE = /^import\s+'([^']+)'\s*;?$/
const EXPORT_DECL = /^export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)\b(.*)$/
const EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?$/
const BARE = /^[A-Za-z@][\w./@-]*$/

const modules = new Map()

const toModuleId = (absPath) => {
  const relative = absPath.slice(SRC.length + 1).split('\\').join('/')
  if (relative.startsWith('..')) throw new Error(`build-client: ${absPath} 位于 src/ 之外`)
  return relative
}

const namedBindings = (list) => list.split(',').map((entry) => entry.trim()).filter(Boolean)
  .map((entry) => {
    const alias = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(entry)
    return alias ? `${alias[1]}: ${alias[2]}` : entry
  }).join(', ')

/** 把一条 import 行解析成 `__require(...)`；相对模块先递归收集。 */
async function resolveImport(spec, fromAbs, id) {
  if (!spec.startsWith('.')) {
    if (!BARE.test(spec)) throw new Error(`build-client: ${id} 引用了不支持的模块标识 ${spec}`)
    return spec
  }
  const base = resolve(dirname(fromAbs), spec)
  const absolute = base.endsWith('.js') ? base : `${base}.js`
  return collect(absolute)
}

async function collect(absPath) {
  const id = toModuleId(absPath)
  const existing = modules.get(id)
  if (existing) return id

  let source
  try {
    source = await readFile(absPath, 'utf8')
  } catch {
    throw new Error(`build-client: 找不到 ${absPath}`)
  }

  const pending = { id, body: [], exports: [] }
  modules.set(id, pending) // 先登记，允许模块之间互相引用

  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (line !== trimmed) {
      pending.body.push(line)
      continue
    }
    if (trimmed.startsWith('import ')) {
      let match = IMPORT_DEFAULT.exec(trimmed)
      if (match) {
        pending.body.push(`const ${match[1]} = __require(${JSON.stringify(await resolveImport(match[2], absPath, id))})`)
        continue
      }
      match = IMPORT_NAMED.exec(trimmed)
      if (match) {
        pending.body.push(`const { ${namedBindings(match[1])} } = __require(${JSON.stringify(await resolveImport(match[2], absPath, id))})`)
        continue
      }
      match = IMPORT_SIDE.exec(trimmed)
      if (match) {
        pending.body.push(`__require(${JSON.stringify(await resolveImport(match[1], absPath, id))})`)
        continue
      }
      throw new Error(`build-client: ${id} 有一行无法识别的 import：${trimmed}`)
    }
    if (trimmed.startsWith('export ')) {
      const reexport = EXPORT_LIST.exec(trimmed)
      if (reexport) {
        for (const name of namedBindings(reexport[1]).split(',').map((entry) => entry.trim()).filter(Boolean)) {
          const alias = /^([A-Za-z_$][\w$]*):\s*([A-Za-z_$][\w$]*)$/.exec(name)
          pending.exports.push(alias ? alias[1] : name)
        }
        continue
      }
      const match = EXPORT_DECL.exec(trimmed)
      if (!match) throw new Error(`build-client: ${id} 只支持 export function/class/const/let/var 或 export { a, b }：${trimmed}`)
      pending.exports.push(match[2])
      pending.body.push(`${match[1]} ${match[2]}${match[3]}`)
      continue
    }
    pending.body.push(line)
  }
  return id
}

const entryId = await collect(resolve(SRC, ENTRY))

const indent = (line) => (line === '' ? '' : `    ${line}`)
const rendered = [...modules.values()].map((pending) => {
  const body = pending.body.map(indent)
  if (pending.exports.length > 0) body.push(`    module.exports = { ${pending.exports.join(', ')} }`)
  return `  __factories[${JSON.stringify(pending.id)}] = function (exports, module, __require) {\n${body.join('\n')}\n  }`
})

const output = `// 本文件由 scripts/build-client.mjs 从 src/ 生成，请勿直接修改。
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_NAME)},
  factory: (require) => {
    const __factories = Object.create(null)
    const __cache = Object.create(null)
    function __require(id) {
      if (__factories[id] === undefined) return require(id)
      if (__cache[id] !== undefined) return __cache[id].exports
      const module = { exports: {} }
      __cache[id] = module
      __factories[id](module.exports, module, __require)
      return module.exports
    }
${rendered.join('\n')}
    return __require(${JSON.stringify(entryId)})
  }
})
`

await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, output, 'utf8')
process.stdout.write(`build-client: ${modules.size} 个模块 -> ${OUT}（${Buffer.byteLength(output)} 字节）\n`)
