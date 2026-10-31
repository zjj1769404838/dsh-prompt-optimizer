// 场景分流 + 会话上下文回归。
// 覆盖两件本轮新增的事：
//   ① 本地规则引擎按输入特征选场景（不再是一套通用模板套所有需求）；
//   ② node 半边用 sessionQuery 读最近几轮用户消息，拼进模型输入做消歧。
// 用模拟 host 驱动 handler，不依赖真实 DSH 进程。
import { apply } from '../lib/index.js'

let failures = 0
function check(name, ok, detail) {
  if (ok) {
    console.log(`PASS  ${name}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// 各场景在本地引擎产物里应出现的角色行片段（用片段而不是整句，避免措辞微调就红）
const ROLE_HINTS = {
  code: '资深软件工程师',
  writing: '资深内容编辑',
  analysis: '资深分析师',
  translate: '资深译者',
  image: '资深视觉提示词工程师',
  general: '资深助手',
}

function makeCtx({ llmPresent = true, streamOverride = null, sessionQuery = null } = {}) {
  const handlers = []
  const ctx = {
    handlers,
    logger: { info: () => {}, warn: () => {} },
    webServer: { register(cfg) { handlers.push(cfg) } },
    get(name) {
      if (name === 'llm') {
        if (!llmPresent) return undefined
        return {
          listProviders: () => [{ id: 'deepseek-official' }],
          listModels: async () => [{ id: 'deepseek-v4-flash' }],
          resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }] } }),
          stream(opts) {
            if (typeof streamOverride === 'function') return streamOverride(opts)
            return (async function* () {
              yield { type: 'text-delta', text: 'LLM 结果' }
              yield { type: 'finish', reason: 'stop' }
            })()
          },
        }
      }
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) }
      }
      if (name === 'sessionQuery') return sessionQuery ?? undefined
      return undefined
    },
  }
  return ctx
}

async function call(ctx, { payload } = {}) {
  apply(ctx)
  const handler = ctx.handlers[0].handler
  let body = ''
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(status, h) { this.statusCode = status; this.headers = h },
    end(buf) { body = Buffer.from(buf ?? '').toString('utf8') },
    once() {},
    emit() {},
  }
  const buf = Buffer.from(JSON.stringify(payload ?? {}), 'utf8')
  const req = {
    url: '/dsh-prompt-optimizer/optimize',
    method: 'POST',
    headers: { host: '127.0.0.1:1' },
    on(ev, cb) {
      if (ev === 'data') cb(buf)
      if (ev === 'end') cb()
    },
    removeListener() {},
    pause() {},
    once() {},
    destroy() {},
  }
  await handler(req, res)
  try {
    return { status: res.statusCode, json: JSON.parse(body) }
  } catch {
    return { status: res.statusCode, json: null, raw: body }
  }
}

// ─── ① 场景分流 ───
const SCENE_CASES = [
  ['帮我写个爬虫', 'code'],
  ['这段 Python 报错了，怎么改', 'code'],
  ['帮我把这段英文翻译成中文，面向技术读者', 'translate'],
  ['画一张赛博朋克风格的城市夜景插画', 'image'],
  ['帮我写一篇小红书种草文案，语气活泼', 'writing'],
  ['分析一下这两个方案哪个更适合我们，给出理由', 'analysis'],
  ['帮我安排一下明天的行程', 'general'],
]

for (const [input, expect] of SCENE_CASES) {
  const ctx = makeCtx({ llmPresent: false })
  const { json } = await call(ctx, { payload: { text: input, mode: 'local' } })
  const text = json?.text ?? ''
  const role = ROLE_HINTS[expect]
  check(`场景/${expect} ← 「${input.slice(0, 14)}」`, text.includes(role), `产物首行：${text.split('\n')[0]}`)
  // 场景角色行必须替代通用角色行，不能两个都在
  const others = Object.entries(ROLE_HINTS)
    .filter(([scene]) => scene !== expect)
    .map(([, hint]) => hint)
  check(`场景/${expect} 不混入其他角色行`, !others.some((hint) => text.includes(hint)))
}

// ─── ② 幂等：任一场景的产物再点一次都不该二次加工 ───
for (const [input, expect] of SCENE_CASES) {
  const ctx = makeCtx({ llmPresent: false })
  const first = await call(ctx, { payload: { text: input, mode: 'local' } })
  const once = first.json?.text ?? ''
  const second = await call(makeCtx({ llmPresent: false }), { payload: { text: once, mode: 'local' } })
  check(`幂等/${expect} 产物不再加工`, second.json?.ok === false && second.json?.text === once)
}

// ─── ③ 会话上下文 ───
function makeSessionQuery(events) {
  return {
    async readSession() {
      return { session: { id: 's1' }, inheritedEventCount: 0, events }
    },
  }
}

function userEvent(text, surfaceOp = 'append') {
  return { type: 'user/message', seq: 1, surfaceOp, data: { role: 'user', content: [{ type: 'text', text }] } }
}

let capturedOpts = null
const ctxWithContext = makeCtx({
  sessionQuery: makeSessionQuery([
    userEvent('我在做一个 DSH 插件，跑在桌面端'),
    { type: 'assistant/message', seq: 2, surfaceOp: 'append', data: { message: { role: 'assistant', content: [{ type: 'text', text: '很长的一大段回复' }] } } },
    userEvent('那个按钮位置还是不对'),
    // 被替换过的消息不该进上下文（用户没见过的内容）
    userEvent('这条是被替换掉的', 'replace'),
  ]),
  streamOverride: (opts) => {
    capturedOpts = opts
    return (async function* () {
      yield { type: 'text-delta', text: '优化结果' }
      yield { type: 'finish', reason: 'stop' }
    })()
  },
})

const withCtx = await call(ctxWithContext, { payload: { text: '那个再往左挪一点', mode: 'auto', sessionId: 's1' } })
check('上下文/走了模型路径', withCtx.json?.mode === 'llm', JSON.stringify(withCtx.json))
check('上下文/响应带 note', typeof withCtx.json?.note === 'string' && withCtx.json.note.includes('上下文'), withCtx.json?.note)

const sys = capturedOpts?.system ?? ''
const userText = capturedOpts?.messages?.[0]?.content?.[0]?.text ?? ''
check('上下文/system 含上下文规则', sys.includes('关于对话上下文'))
check('上下文/用户消息含历史轮', userText.includes('我在做一个 DSH 插件') && userText.includes('那个按钮位置还是不对'))
check('上下文/只取 user 消息（不含 assistant 长回复）', !userText.includes('很长的一大段回复'))
check('上下文/排除被替换的消息', !userText.includes('这条是被替换掉的'))
check('上下文/当前提示词仍完整保留', userText.includes('那个再往左挪一点'))

// 没有 sessionId：不该带上下文，也不该崩
capturedOpts = null
const noSession = await call(makeCtx({
  streamOverride: (opts) => {
    capturedOpts = opts
    return (async function* () {
      yield { type: 'text-delta', text: '优化结果' }
      yield { type: 'finish', reason: 'stop' }
    })()
  },
}), { payload: { text: '帮我写个爬虫', mode: 'auto' } })
check('上下文/无 sessionId 时正常返回', noSession.json?.mode === 'llm', JSON.stringify(noSession.json))
check('上下文/无 sessionId 时不注入上下文块', !(capturedOpts?.system ?? '').includes('关于对话上下文'))

// sessionQuery 抛错：静默降级，不 500
const boomCtx = makeCtx({
  sessionQuery: { async readSession() { throw new Error('session not found') } },
})
const boom = await call(boomCtx, { payload: { text: '帮我写个爬虫', mode: 'auto', sessionId: 'missing' } })
check('上下文/读历史失败时静默降级', boom.status === 200 && boom.json?.ok === true, JSON.stringify(boom.json))

// 宿主没有 sessionQuery 服务：同样降级
const noQuery = await call(makeCtx(), { payload: { text: '帮我写个爬虫', mode: 'auto', sessionId: 's1' } })
check('上下文/无 sessionQuery 服务时降级', noQuery.status === 200 && noQuery.json?.ok === true, JSON.stringify(noQuery.json))

// ─── ④ 上下文预算：超长历史必须被截断 ───
const longEvents = []
for (let i = 0; i < 20; i += 1) longEvents.push(userEvent(`第 ${i} 轮：${'很长的历史内容'.repeat(60)}`))
let longOpts = null
const longCtx = makeCtx({
  sessionQuery: makeSessionQuery(longEvents),
  streamOverride: (opts) => {
    longOpts = opts
    return (async function* () {
      yield { type: 'text-delta', text: '优化结果' }
      yield { type: 'finish', reason: 'stop' }
    })()
  },
})
// 注意：输入必须过 6 字符下限，否则会被「文本过短」提前拒绝 —— 那样 stream 根本不被调用，
// 下面两条断言会变成「空字符串也满足预算」的假绿。
await call(longCtx, { payload: { text: '继续把上面那个按钮位置调整一下', mode: 'auto', sessionId: 's1' } })
const longUserText = longOpts?.messages?.[0]?.content?.[0]?.text ?? ''
check('上下文/超长历史确实走了模型路径', longOpts !== null)
check('上下文/历史被截断到预算内', longUserText.length > 0 && longUserText.length <= 1200 + 200, `实际 ${longUserText.length}`)
check('上下文/保留的是最近几轮', longUserText.includes('第 19 轮') || longUserText.includes('第 18 轮'))

console.log(`\n[context] ${failures === 0 ? 'all passed' : `${failures} failed`}`)
if (failures > 0) process.exitCode = 1
