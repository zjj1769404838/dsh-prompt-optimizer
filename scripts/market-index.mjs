// 从 package.json 生成 DSH 插件市场索引（format 1），并做一次本地校验。
//
// 用法：
//   node scripts/market-index.mjs                 # 生成 docs/market-index.json
//   node scripts/market-index.mjs --check         # 只校验已存在的文件，不写盘
//   node scripts/market-index.mjs --out path.json # 指定输出路径
//
// 索引格式由宿主包 `@deepseek-ai/dsh-plugin-market-index` 定义：这里只负责拼装，
// 校验交给宿主自己的 parseMarketIndex —— 避免手写规则与宿主实现漂移。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const outIdx = args.indexOf('--out')
const outFile = outIdx === -1 ? resolve(root, 'docs/market-index.json') : resolve(args[outIdx + 1])

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

// 宿主校验器所在位置：优先本机 DSH 运行时，可用 DSH_MARKET_INDEX_PKG 覆盖。
const candidates = [
  process.env.DSH_MARKET_INDEX_PKG,
  'D:/apps/dsh-desktop/resources/app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
  resolve(root, 'node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js'),
].filter(Boolean)

async function loadValidator() {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      return await import(pathToFileURL(candidate).href)
    } catch {
      /* 试下一个 */
    }
  }
  return null
}

function buildIndex() {
  const iconPath = resolve(root, 'icon.svg')
  const icon = existsSync(iconPath)
    ? `data:image/svg+xml;base64,${readFileSync(iconPath).toString('base64')}`
    : undefined

  return {
    format: 1,
    title: { en: 'zjj plugins', zh: 'zjj 插件' },
    description: {
      en: 'Plugins by zjj for DeepSeek Harness.',
      zh: 'zjj 为 DeepSeek Harness 维护的插件。',
    },
    metadata: {
      categories: { productivity: { title: { en: 'Productivity', zh: '效率' } } },
      labels: { prompt: { title: { en: 'Prompt', zh: '提示词' } } },
    },
    plugins: [
      {
        name: pkg.name,
        title: { en: 'Prompt Optimizer', zh: '提示词优化' },
        description: {
          en: 'One-click rewrite of a rough composer request into a structured prompt, using the model DSH is already connected to, with a local rule engine as fallback.',
          zh: '一键把输入框里的口语化需求改写成结构化提示词，优先复用 DSH 已连接模型，不可用时回退本地规则引擎。',
        },
        ...(icon ? { icon } : {}),
        ...(pkg.author?.name ? { author: pkg.author.name } : {}),
        ...(pkg.homepage ? { homepage: pkg.homepage } : {}),
        ...(pkg.repository ? { repository: { url: pkg.repository } } : {}),
        metadata: {
          category: 'productivity',
          keywords: ['prompt', 'optimize', 'composer'],
          labels: ['prompt'],
        },
        versions: [
          {
            version: pkg.version,
            publishTimestamp: Math.floor(Date.now() / 1000),
            source: { type: 'npm' },
            ...(pkg.engines?.dsh ? { engines: { dsh: pkg.engines.dsh } } : {}),
          },
        ],
      },
    ],
  }
}

const validator = await loadValidator()
if (!validator) {
  console.error('[market-index] 找不到宿主校验器；设置 DSH_MARKET_INDEX_PKG 指向 dsh-plugin-market-index/lib/index.js')
  process.exit(1)
}

const index = checkOnly ? JSON.parse(readFileSync(outFile, 'utf8')) : buildIndex()

let parsed
try {
  parsed = validator.parseMarketIndex(index, 'https://example.com/index.json')
} catch (error) {
  console.error('[market-index] invalid:', error.path, error.reason)
  process.exit(1)
}

const plugin = parsed.plugins[0]
const target = validator.marketInstallTarget(plugin.name, plugin.versions[0])
console.log('[market-index] ok')
console.log('  name       :', plugin.name)
console.log('  version    :', plugin.versions[0].version)
console.log('  engines.dsh:', plugin.versions[0].engines?.dsh ?? '(未声明 = 无约束)')
console.log('  install    :', target.spec + (target.registry ? ` (registry: ${target.registry})` : ''))
console.log('  icon       :', plugin.icon ? `${plugin.icon.slice(0, 26)}… (${plugin.icon.length} chars)` : '(无)')

if (!checkOnly) {
  writeFileSync(outFile, `${JSON.stringify(index, null, 2)}\n`)
  console.log('  written    :', outFile)
}
