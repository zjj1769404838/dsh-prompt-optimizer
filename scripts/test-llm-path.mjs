// 用模拟 host 验证 node 半边的 LLM 路径与回退路径（不依赖真实 DSH 进程）
import { apply } from '../lib/index.js'

function makeCtx(llmPresent) {
  const handlers = []
  const ctx = {
    handlers,
    logger: { info: () => {}, warn: () => {} },
    webServer: {
      register(cfg) {
        handlers.push(cfg)
      },
    },
    get(name) {
      if (name === 'llm') {
        if (!llmPresent) return undefined
        return {
          listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
          listModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'V4 Flash' }],
          resolveModelInfo: async () => ({
            provider: 'deepseek-official',
            id: 'deepseek-v4-flash',
            name: 'V4 Flash',
            reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }] },
          }),
          stream(opts) {
            globalThis.__lastOpts = opts
            return (async function* () {
              yield { type: 'block-start', index: 0, blockType: 'text' }
              yield { type: 'text-delta', index: 0, text: '优化后的提示词：\n' }
              yield { type: 'text-delta', index: 0, text: '```\n请用 Python 写一个爬虫，\n目标站点 X，\n输出 CSV。\n```' }
              yield { type: 'usage', usage: { input: 10, output: 20 } }
              yield { type: 'finish', reason: 'stop' }
            })()
          },
        }
      }
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) }
      }
      return undefined
    },
  }
  return ctx
}

async function call(ctx, payload) {
  apply(ctx)
  const handler = ctx.handlers[0].handler
  let body = ''
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(buf) {
      body = Buffer.from(buf).toString('utf8')
    },
  }
  const req = {
    url: '/dsh-prompt-optimizer/optimize',
    method: 'POST',
    on(ev, cb) {
      if (ev === 'data') cb(Buffer.from(JSON.stringify(payload), 'utf8'))
      if (ev === 'end') cb()
    },
  }
  await handler(req, res)
  return JSON.parse(body)
}

const llmCtx = makeCtx(true)
const r1 = await call(llmCtx, { text: '帮我写个爬虫' })
console.log('[LLM ] mode =', r1.mode)
console.log('[LLM ] text =', JSON.stringify(r1.text))
console.log('[LLM ] opts =', JSON.stringify({
  provider: globalThis.__lastOpts?.provider,
  model: globalThis.__lastOpts?.model,
  reasoningEffort: globalThis.__lastOpts?.reasoningEffort,
  maxTokens: globalThis.__lastOpts?.maxTokens,
  temperature: globalThis.__lastOpts?.temperature,
  messages: globalThis.__lastOpts?.messages,
}))

const noLlmCtx = makeCtx(false)
const r2 = await call(noLlmCtx, { text: '帮我写个爬虫' })
console.log('[FB  ] mode =', r2.mode)
console.log('[FB  ] ok =', r2.ok, '| head =', JSON.stringify(r2.text.slice(0, 40)))

const r3 = await call(makeCtx(true), { text: '帮我写个爬虫', mode: 'local' })
console.log('[LOC ] mode =', r3.mode, '| head =', JSON.stringify(r3.text.slice(0, 40)))

const r4 = await call(makeCtx(true), { text: '' })
console.log('[EDGE] empty ->', JSON.stringify(r4))
