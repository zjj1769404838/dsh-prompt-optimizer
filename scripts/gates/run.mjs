import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const readIfExists = (file) =>
  existsSync(resolve(root, file)) ? readFileSync(resolve(root, file), 'utf8') : null

let pkg
try {
  pkg = JSON.parse(readIfExists('package.json'))
} catch (error) {
  console.error('[gates] invalid package.json:', error.message)
  process.exit(1)
}

const errors = []
const name = pkg.name

// ─── 包名与市场契约 ───
// 市场索引校验器用的就是这个正则；包名不合法时市场会直接拒绝该条目。
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
if (!PACKAGE_NAME.test(name)) errors.push(`package.json name "${name}" is not a valid npm package name`)
if (name.length > 214) errors.push('package.json name exceeds 214 characters')
if (name.startsWith('@') && pkg.publishConfig?.access !== 'public')
  errors.push('scoped package requires publishConfig.access = "public"')
// 宿主加载前只比对 engines.dsh（声明了它就不再看 peerDependencies）；
// 空值或非法 range 会被判为不兼容，所以这里要求非空字符串。
if (typeof pkg.engines?.dsh !== 'string' || pkg.engines.dsh.trim() === '')
  errors.push('engines.dsh must be a non-empty SemVer range')
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version))
  errors.push(`version "${pkg.version}" must be an exact SemVer (no range)`)
if (!pkg.description || pkg.description.trim().length < 20)
  errors.push('description is required and should be meaningful for the market listing')
if (!pkg.license) errors.push('license is required')

if (!pkg.exports || !pkg.exports['.']) errors.push('exports[.] must point to lib/index.js')
if (!pkg.exports['./package.json']) errors.push('exports[./package.json] is missing')
for (const file of ['lib/index.js', 'README.md', 'cordis.patch.yml', 'lib/client.js']) {
  if (!existsSync(resolve(root, file))) errors.push(`missing required file: ${file}`)
}
// 发布必备文件：市场条目要图标，用户要更新日志
for (const file of ['icon.svg', 'CHANGELOG.md', 'README.en.md', 'LICENSE']) {
  if (!existsSync(resolve(root, file))) errors.push(`missing publish file: ${file}`)
}

const patch = readIfExists('cordis.patch.yml')
if (!patch || !patch.includes('- insert:') || !patch.includes(name))
  errors.push('cordis.patch.yml must insert the package name')
// scoped 包名在 YAML 里必须带引号，否则 `@` 开头的标量解析失败
if (name.startsWith('@') && !patch?.includes(`'${name}'`) && !patch?.includes(`"${name}"`))
  errors.push('cordis.patch.yml must quote the scoped package name')

const client = readIfExists('lib/client.js')
if (!client || !client.includes(`window.__ModuleLoader__.load({ id: "${name}"`))
  errors.push('lib/client.js does not register the expected client id')

// 版本一致性：package.json 的 version 必须与 node 半边 PLUGIN_VERSION 相等，
// 否则 /health 报的版本与实际发布的包版本会对不上。
const nodeSrc = readIfExists('lib/index.js') ?? ''
const versionMatch = /PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(nodeSrc)
if (!versionMatch) {
  errors.push('lib/index.js does not contain PLUGIN_VERSION')
} else if (versionMatch[1] !== pkg.version) {
  errors.push(`PLUGIN_VERSION (${versionMatch[1]}) != package.json version (${pkg.version})`)
}

// 发布包里绝不能出现宿主专有代码（排障期从 app.asar 提取的产物）
for (const leaked of ['.tmp-probe', '.scratch']) {
  if (existsSync(resolve(root, leaked))) errors.push(`host-proprietary probe dir must not stay in repo: ${leaked}`)
}
const filesList = pkg.files ?? []
if (!filesList.includes('lib') || !filesList.includes('cordis.patch.yml'))
  errors.push('files whitelist must include lib and cordis.patch.yml')

if (errors.length > 0) {
  console.error('[gates] failed')
  for (const error of errors) console.error('  -', error)
  process.exit(1)
}
console.log('[gates] ok')
