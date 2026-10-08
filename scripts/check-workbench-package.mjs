#!/usr/bin/env node
/**
 * 按《工作台开发规范》第 3 节的「必须」项校验本工作台包。
 *
 * 用法：
 *   node scripts/check-workbench-package.mjs [包目录或 .tgz]
 *   node scripts/check-workbench-package.mjs --tarball dsh-workbench-project-console-1.0.0.tgz
 *
 * 退出码 0 表示所有「必须」项通过；1 表示有必须项不满足。建议项只提示。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(HERE, '..')
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const failures = []
const warnings = []
const notes = []
const pass = (message) => notes.push(`  ✓ ${message}`)
const fail = (message) => failures.push(message)
const warn = (message) => warnings.push(message)

const args = process.argv.slice(2)
let tarball = ''
let rootArg = ''
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--tarball') tarball = args[index + 1] ?? ''
  else rootArg = args[index]
}

/* ------------------------------------------------------------ 读取包内容 */

let manifest
let readPackageFile
let listFiles
let sourceLabel

if (tarball) {
  const tarballPath = isAbsolute(tarball) ? tarball : resolve(process.cwd(), tarball)
  if (!existsSync(tarballPath)) {
    console.error(`check-workbench-package: 找不到 ${tarballPath}`)
    process.exit(2)
  }
  sourceLabel = tarballPath
  const entries = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' }).split('\n').filter(Boolean)
  const packageEntry = entries.find((name) => name.endsWith('/package.json') && name.split('/').length === 2)
  if (!packageEntry) {
    console.error('check-workbench-package: tarball 里没有 package.json')
    process.exit(2)
  }
  const prefix = packageEntry.slice(0, -'package.json'.length)
  manifest = JSON.parse(execFileSync('tar', ['-xzOf', tarballPath, packageEntry], { encoding: 'utf8' }))
  const readEntry = (relative) => execFileSync('tar', ['-xzOf', tarballPath, `${prefix}${relative}`], { encoding: 'utf8' })
  readPackageFile = readEntry
  listFiles = () => entries.filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length)).filter(Boolean)
} else {
  const root = resolve(rootArg || DEFAULT_ROOT)
  sourceLabel = root
  const manifestPath = join(root, 'package.json')
  if (!existsSync(manifestPath)) {
    console.error(`check-workbench-package: ${root} 不是工作台包（缺少 package.json）`)
    process.exit(2)
  }
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  readPackageFile = (relative) => readFileSync(join(root, relative), 'utf8')
  const walk = (dir, prefix) => {
    const out = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const next = join(dir, entry.name)
      const relative = prefix ? `${prefix}${entry.name}` : entry.name
      if (entry.isDirectory()) out.push(...walk(next, `${relative}/`))
      else out.push(relative)
    }
    return out
  }
  listFiles = () => walk(root, '')
}

const files = listFiles()
const hasFile = (relative) => files.some((name) => name === relative || name === relative.replace(/^\.\//, ''))
const readIfPresent = (relative) => {
  if (!hasFile(relative)) return undefined
  try {
    return readPackageFile(relative)
  } catch {
    return undefined
  }
}

/* -------------------------------------------------------------- 3.2 清单 */

if (typeof manifest.name === 'string' && manifest.name.trim()) pass(`package.json name = ${manifest.name}`)
else fail('package.json 缺少 name')

if (typeof manifest.version === 'string' && SEMVER.test(manifest.version)) pass(`version = ${manifest.version}（完整 SemVer）`)
else fail(`version 不是完整 SemVer：${JSON.stringify(manifest.version)}`)

if (manifest.type === 'module') pass('type = module')
else warn('建议设置 "type": "module"')

const mainEntry = manifest.main ?? manifest.exports?.['.']
const mainPath = typeof mainEntry === 'string' ? mainEntry.replace(/^\.\//, '') : ''
if (mainPath && hasFile(mainPath)) pass(`服务端入口存在：${mainPath}`)
else fail(`main / exports["."] 未指向包内存在的文件：${JSON.stringify(mainEntry)}`)
if (manifest.exports?.['.'] === undefined) fail('exports["."] 必须指向服务端入口')
for (const key of ['./package.json', './cordis.patch.yml']) {
  if (manifest.exports?.[key] === undefined) warn(`建议声明 exports["${key}"]`)
}

/* --------------------------------------------------------- 3.3 补丁文件 */

const patchPath = manifest.dsh?.bundle?.patch
if (typeof patchPath !== 'string') {
  fail('缺少 dsh.bundle.patch，包不会作为插件层激活')
} else {
  const relative = patchPath.replace(/^\.\//, '')
  const text = readIfPresent(relative)
  if (text === undefined) {
    fail(`dsh.bundle.patch 指向的文件不在包里：${patchPath}`)
  } else {
    const withoutComments = text.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n').trim()
    if (withoutComments === '') fail(`补丁文件是空的（或只有注释）：${patchPath}`)
    else {
      pass(`补丁文件存在且非空：${patchPath}`)
      if (!/^\s*-\s*insert\s*:/m.test(text)) fail('补丁文件里没有 insert 行')
      const nameMatch = /^\s*name\s*:\s*['"]?([^'"\n#]+?)['"]?\s*$/m.exec(text)
      if (!nameMatch) fail('insert 行没有写 name（必须是 npm 包名）')
      else if (nameMatch[1].trim() !== manifest.name) fail(`insert 的 name 必须是包名：期望 ${manifest.name}，实际 ${nameMatch[1].trim()}`)
      else pass(`insert.name = ${manifest.name}`)
      if (/^\s*name\s*:\s*[.\/]/m.test(text)) fail('insert.name 不能写相对或绝对路径')
    }
  }
}

/* --------------------------------------------------------- 3.5 客户端声明 */

const client = manifest.dsh?.client
if (!client || typeof client !== 'object') {
  fail('缺少 dsh.client 声明，客户端模块不会被加载')
} else {
  if (client.platform === 'web') pass('dsh.client.platform = web')
  else fail(`dsh.client.platform 必须是 "web"，实际 ${JSON.stringify(client.platform)}`)

  const inject = client.inject
  if (!Array.isArray(inject) || inject.some((item) => typeof item !== 'string')) {
    fail('dsh.client.inject 必须是字符串数组')
  } else if (!inject.includes('dsh-desktop-workbenches')) {
    fail('dsh.client.inject 必须包含 "dsh-desktop-workbenches"，否则工作台能力不会先就绪')
  } else {
    pass(`dsh.client.inject 含 dsh-desktop-workbenches（${inject.length} 项）`)
  }

  const clientEntry = manifest.exports?.['./client']
  if (typeof clientEntry !== 'string') {
    fail('声明了 dsh.client 就必须导出 exports["./client"]')
  } else {
    const relative = clientEntry.replace(/^\.\//, '')
    if (!hasFile(relative)) fail(`exports["./client"] 指向的文件不在包里：${clientEntry}`)
    else {
      const code = readIfPresent(relative) ?? ''
      pass(`客户端产物存在：${clientEntry}`)
      if (!code.includes('__ModuleLoader__')) fail('客户端产物没有调用 window.__ModuleLoader__.load')
      else {
        const idMatch = /__ModuleLoader__\s*\.\s*load\s*\(\s*\{\s*id\s*:\s*['"]([^'"]+)['"]/.exec(code)
        if (!idMatch) fail('无法从客户端产物里读出 load({ id })')
        else if (idMatch[1] !== manifest.name) fail(`客户端模块 id 必须等于包名：期望 ${manifest.name}，实际 ${idMatch[1]}`)
        else pass(`客户端模块 id = ${manifest.name}`)
      }
      // 打进来的模块用 __require("<模块 id>")；剩下的 __require("<裸包名>") 才会落到宿主基线上。
      const internalIds = new Set([...code.matchAll(/__factories\[\s*['"]([^'"]+)['"]\s*\]/g)].map((match) => match[1]))
      const bare = [...new Set([...code.matchAll(/__require\(\s*['"]([^'"]+)['"]\s*\)/g)]
        .map((match) => match[1])
        .filter((spec) => !internalIds.has(spec) && !spec.startsWith('.') && !spec.includes('/')))]
      if (bare.length > 0) {
        // React 家族是模块加载器的共享基线，不算 dsh.client.external。
        const baseline = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client']
        const external = [...(Array.isArray(client.external) ? client.external : []), ...baseline]
        const missing = bare.filter((spec) => !external.some((item) => spec === item || spec.startsWith(`${item}/`)))
        if (missing.length > 0) warn(`客户端 require 了未在 dsh.client.external 声明的模块：${missing.join('、')}`)
      }
    }
  }
}

/* ---------------------------------------------------------------- 依赖 */

const dependencies = { ...(manifest.dependencies ?? {}), ...(manifest.peerDependencies ?? {}) }
if ('@deepseek-ai/schemastery' in dependencies) pass('声明了 @deepseek-ai/schemastery')
else warn('建议声明 @deepseek-ai/schemastery（服务端 Config 需要它）')

const dshPeers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
if (dshPeers.length > 0) {
  warn(`声明了 Harness peer：${dshPeers.map(([name, range]) => `${name}@${range}`).join('、')}；范围必须显式包含预发布分支，否则安装时报 ERESOLVE`)
}

/* ------------------------------------------------------ files 与敏感文件 */

if (Array.isArray(manifest.files) && manifest.files.length > 0) {
  const required = [patchPath, mainEntry, manifest.exports?.['./client']]
    .filter((value) => typeof value === 'string')
    .map((value) => value.replace(/^\.\//, ''))
  const missing = required.filter((relative) => !manifest.files.some((pattern) => {
    const clean = pattern.replace(/^\.\//, '')
    return clean === relative || (clean.endsWith('/') && relative.startsWith(clean))
  }))
  if (missing.length > 0) fail(`files 未包含必需文件：${missing.join('、')}`)
  else pass('files 覆盖补丁、服务端入口与客户端产物')
} else {
  warn('建议用 files 显式限定打包内容')
}

const suspicious = files.filter((name) => /(^|\/)(\.env|\.npmrc|credentials[^/]*|\.git\/|id_rsa|.*\.pem|.*\.key)$/i.test(name))
if (suspicious.length > 0) fail(`包里疑似有敏感文件：${suspicious.join('、')}`)
else pass('未发现常见敏感文件')

/* ------------------------------------------------ 服务端入口的运行时检查 */

const server = mainPath && !tarball
  ? await import(pathToFileURL(join(resolve(rootArg || DEFAULT_ROOT), mainPath)).href).catch((error) => error)
  : undefined
if (server instanceof Error) {
  warn(`无法导入服务端入口做运行时检查：${server.message}`)
} else if (server) {
  if (server.name !== manifest.name) fail(`服务端 name 必须等于包名：期望 ${manifest.name}，实际 ${server.name}`)
  else pass(`服务端 name = ${manifest.name}`)
  if (!Array.isArray(server.inject) || !server.inject.includes('connection')) fail('服务端 inject 必须包含 "connection"')
  else pass(`服务端 inject = ${JSON.stringify(server.inject)}`)
  if (typeof server.Config !== 'function') fail('服务端 Config 必须是 Schemastery schema（不能是普通对象）')
  else {
    try {
      server.Config({ root: '/tmp/check' })
      server.Config({})
      fail('Config 没有校验 root 必填')
    } catch {
      pass('Config 是 Schemastery schema 且校验必填项')
    }
  }
  if (typeof server.apply !== 'function') fail('服务端没有导出 apply')
  else pass('服务端导出 apply')
} else if (tarball) {
  notes.push('  · tarball 模式跳过服务端入口的运行时检查（需要可解析的依赖）')
}

/* ------------------------------------------------------------------ 输出 */

const title = `工作台包校验：${sourceLabel}`
console.log(title)
console.log(`包名 ${manifest.name}@${manifest.version}，共 ${files.length} 个文件`)
for (const line of notes) console.log(line)
if (warnings.length > 0) {
  console.log('\n建议项：')
  for (const message of warnings) console.log(`  ! ${message}`)
}
if (failures.length > 0) {
  console.log('\n必须项未通过：')
  for (const message of failures) console.log(`  ✗ ${message}`)
  console.log(`\n结论：不通过（${failures.length} 项必须项）`)
  process.exit(1)
}
console.log(`\n结论：通过（必须项全部满足，建议项 ${warnings.length} 条）`)
