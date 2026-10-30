import { build, context } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

await rm(resolve(root, 'lib'), { recursive: true, force: true })
await mkdir(resolve(root, 'lib'), { recursive: true })

const nodeConfig = {
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(root, 'lib/index.js'),
  platform: 'node',
  format: 'esm',
  target: ['es2022'],
  bundle: true,
  logLevel: 'info',
}

const clientConfig = {
  entryPoints: [resolve(root, 'src/client/index.ts')],
  outfile: resolve(root, 'lib/client.js'),
  platform: 'browser',
  format: 'cjs',
  target: ['es2020'],
  bundle: true,
  logLevel: 'info',
  // React 由宿主模块加载器提供（slot 组件要用），不能打进产物，否则会出现两份 React 实例。
  external: ['react'],
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
}

const configs = [nodeConfig, clientConfig]

if (watch) {
  const contexts = await Promise.all(configs.map((cfg) => context(cfg)))
  await Promise.all(contexts.map((item) => item.watch()))
  console.log('[build] watching src/**/*.ts')
} else {
  await Promise.all(configs.map((cfg) => build(cfg)))
  console.log('[build] lib generated')
}
