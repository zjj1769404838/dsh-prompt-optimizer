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

function userEvent(text, surfaceOp = 'append', kind = 'user') {
  // 0.1.10：宿主用 data.source.kind 区分真人输入与平台注入。
  // 测试夹具必须带上这个字段，否则会被允许列表全部拦下（那等于测试没覆盖真实形状）。
  return {
    type: 'user/message',
    seq: 1,
    surfaceOp,
    data: { role: 'user', source: { kind }, content: [{ type: 'text', text }] },
  }
}

// 平台注入的伪用户消息：type/surfaceOp 与真人输入完全相同，只有 source.kind 不同。
// 前 7 个是真机实测到的（本会话磁盘逐帧解码），后 3 个来自宿主源码（compact-checkpoint
// dsh-compaction:109、tool-registry dsh-agent-loop:1271、memory 记忆块注入路径）。
const INJECTED_KINDS = [
  'runtime-context', 'time-context', 'skill-catalog', 'model-selection',
  'dsh-rewind', 'dsh-mnemon', 'user-approval',
  'compact-checkpoint', 'tool-registry', 'memory',
]

let capturedOpts = null
const ctxWithContext = makeCtx({
  sessionQuery: makeSessionQuery([
    userEvent('我在做一个 DSH 插件，跑在桌面端'),
    { type: 'assistant/message', seq: 2, surfaceOp: 'append', data: { message: { role: 'assistant', content: [{ type: 'text', text: '很长的一大段回复' }] } } },
    // 平台注入的伪用户消息：type/surfaceOp 与真人输入一模一样，必须被允许列表挡掉
    userEvent('Current runtime context. This snapshot supersedes earlier runtime-context snapshots. Current working directory: "D:\\\\my-projects".', 'append', 'runtime-context'),
    userEvent('<memory_system> 记忆系统纪律全文，含白板 PLAN.md 与交接账本路径', 'append', 'memory'),
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
// ★ 0.1.10 乱码根因回归：注入块绝不能进上下文（0.1.9 就是栽在这里）
check('污染/排除 runtime-context 注入块', !userText.includes('Current runtime context'), userText.slice(0, 200))
check('污染/排除 memory 注入块', !userText.includes('<memory_system>'))
check('污染/注入文本不出现在任何写回内容里', !String(withCtx.json?.text ?? '').includes('Current working directory'))
// diag：真人 2 轮 + 拦下 2 段注入
check('diag/scene 有值', typeof withCtx.json?.diag?.scene === 'string' && withCtx.json.diag.scene.length > 0, JSON.stringify(withCtx.json?.diag))
check('diag/ctxTurns 只数真人轮', withCtx.json?.diag?.ctxTurns === 2, `实际 ${withCtx.json?.diag?.ctxTurns}`)
check('diag/ctxSkipped 记下被拦的注入', withCtx.json?.diag?.ctxSkipped === 2, `实际 ${withCtx.json?.diag?.ctxSkipped}`)
check('diag/未命中泄漏兜底时不带 leakGuarded', !('leakGuarded' in (withCtx.json?.diag ?? {})), JSON.stringify(withCtx.json?.diag))

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

// ─── ⑤ 泄漏兜底：即使过滤漏了，宿主内部文本也不能写回 ───
// 前两条断言必须先确认「确实走了模型路径」，否则被前置校验提前拒绝时
// 「产物里没有 X」会对空串恒真 —— 那是假绿。
async function leakCase(name, modelOutput, payloadText) {
  let opts = null
  const c = makeCtx({
    streamOverride: (o) => {
      opts = o
      return (async function* () {
        yield { type: 'text-delta', text: modelOutput }
        yield { type: 'finish', reason: 'stop' }
      })()
    },
  })
  const r = await call(c, { payload: { text: payloadText, mode: 'auto' } })
  check(`${name}/确实走了模型路径`, opts !== null)
  check(`${name}/回退本地规则`, r.json?.mode === 'local', JSON.stringify(r.json)?.slice(0, 120))
  check(`${name}/产物不含宿主文本`, !String(r.json?.text ?? '').includes(modelOutput.slice(0, 24)))
  check(`${name}/diag 记下泄漏标记`, typeof r.json?.diag?.leakGuarded === 'string' && r.json.diag.leakGuarded.length > 0, JSON.stringify(r.json?.diag))
}

await leakCase(
  '泄漏/回显上下文标题',
  '# 任务\n[当前对话的最近几轮，仅用于消歧]\n用户：某段历史\n# 要求\n- 结构清晰',
  '帮我写个登录页面',
)
await leakCase(
  '泄漏/抄了运行环境快照',
  '你是一位资深软件工程师。\n# 任务\nCurrent runtime context. Current working directory: "D:\\\\my-projects".\n# 要求\n- 可运行',
  '帮我写个登录页面',
)
await leakCase(
  '泄漏/抄了记忆系统块',
  '你是一位资深软件工程师。\n# 任务\n<memory_system> 自动记忆已启用，白板 PLAN.md 需要重写\n# 要求\n- 可运行',
  '帮我写个登录页面',
)

// 反例：用户自己的提示词里本来就含这些词时不该误判（否则正常输入被无端降级）
const benign = await call(makeCtx({
  streamOverride: () => (async function* () {
    yield { type: 'text-delta', text: '你是一位资深软件工程师。\n# 任务\n把 dsh-prompt-optimizer 的按钮挪到左边' }
    yield { type: 'finish', reason: 'stop' }
  })(),
}), { payload: { text: '帮我优化 dsh-prompt-optimizer 的按钮位置说明', mode: 'auto' } })
check('泄漏/用户自带同名词时不误判', benign.json?.mode === 'llm', JSON.stringify(benign.json)?.slice(0, 160))

// ─── ⑥ 允许列表必须挡住真机里出现过的全部注入 kind ───
// kind 清单来自本会话磁盘事件实测（session.v4.jsonl.zstd 逐帧解码）：
// 824 条 user/message 里只有 51 条是 kind:'user'，其余为 runtime-context 629 /
// time-context 82 / skill-catalog 36 / model-selection 14 / dsh-rewind 8 /
// dsh-mnemon 3 / user-approval 1 —— 逐类都要证明进不了上下文。
for (const kind of INJECTED_KINDS) {
  let o = null
  const c = makeCtx({
    sessionQuery: makeSessionQuery([
      userEvent('真实的一句需求', 'append', 'user'),
      userEvent(`${kind} 注入的宿主内部文本`, 'append', kind),
    ]),
    streamOverride: (opts) => {
      o = opts
      return (async function* () {
        yield { type: 'text-delta', text: '优化结果' }
        yield { type: 'finish', reason: 'stop' }
      })()
    },
  })
  const r = await call(c, { payload: { text: '帮我把按钮挪到左边', mode: 'auto', sessionId: 's1' } })
  const ut = o?.messages?.[0]?.content?.[0]?.text ?? ''
  check(`允许列表/${kind} 被拦下`, o !== null && !ut.includes(`${kind} 注入的宿主内部文本`), ut.slice(0, 120))
  check(`允许列表/${kind} 仍保留真人轮`, r.json?.diag?.ctxTurns === 1 && r.json?.diag?.ctxSkipped === 1, JSON.stringify(r.json?.diag))
}
// kind 缺失（历史格式/未知来源）也不允许进上下文：证明不了是真人打的就不用
{
  let o = null
  const c = makeCtx({
    sessionQuery: makeSessionQuery([
      { type: 'user/message', seq: 1, surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: '没有 source 字段的旧格式事件' }] } },
    ]),
    streamOverride: (opts) => {
      o = opts
      return (async function* () {
        yield { type: 'text-delta', text: '优化结果' }
        yield { type: 'finish', reason: 'stop' }
      })()
    },
  })
  const r = await call(c, { payload: { text: '帮我把按钮挪到左边', mode: 'auto', sessionId: 's1' } })
  check('允许列表/source 缺失时不用为上下文', o !== null && !((o.messages?.[0]?.content?.[0]?.text ?? '').includes('没有 source 字段的旧格式事件')))
  check('允许列表/source 缺失计入 skipped', r.json?.diag?.ctxTurns === 0 && r.json?.diag?.ctxSkipped === 1, JSON.stringify(r.json?.diag))
  check('允许列表/source 缺失时不注入上下文规则', !(o?.system ?? '').includes('关于对话上下文'))
}

// ─── ⑦ 信标抗挤出：启动噪声不能把 optimize 证据挤掉 ───
// 0.1.9 排障时就是栽在这：用户点击那次的信标被后续硬刷新的 boot 噪声冲掉了。
async function postBeacon(payload) {
  const c = makeCtx()
  apply(c)
  const handler = c.handlers[0].handler
  const res = { statusCode: 0, writeHead(s) { this.statusCode = s }, end() {}, once() {} }
  const buf = Buffer.from(JSON.stringify(payload), 'utf8')
  await handler({
    url: '/dsh-prompt-optimizer/beacon',
    method: 'POST',
    headers: { host: '127.0.0.1:1' },
    on(ev, cb) { if (ev === 'data') cb(buf); if (ev === 'end') cb() },
    removeListener() {}, pause() {}, once() {}, destroy() {},
  }, res)
  return res.statusCode
}

async function getBeacons() {
  const c = makeCtx()
  apply(c)
  const handler = c.handlers[0].handler
  let body = ''
  const res = { statusCode: 0, writeHead(s) { this.statusCode = s }, end(b) { body = Buffer.from(b ?? '').toString('utf8') }, once() {} }
  await handler({ url: '/dsh-prompt-optimizer/beacon', method: 'GET', headers: { host: '127.0.0.1:1' }, on() {}, destroy() {} }, res)
  try { return JSON.parse(body) } catch { return { count: 0, beacons: [] } }
}

// 先灌 40 条启动噪声，再放一条真正有价值的 optimize 证据，然后再灌 30 条噪声
for (let i = 0; i < 40; i += 1) await postBeacon({ stage: 'boot', build: 'dspo-v13' })
await postBeacon({ stage: 'optimized', mode: 'llm', ctxTurns: 2, ctxSkipped: 7, scene: 'code' })
for (let i = 0; i < 30; i += 1) await postBeacon({ stage: 'dom-ready', build: 'dspo-v13' })
const snap = await getBeacons()
const keep = (snap.beacons ?? []).find((b) => b.stage === 'optimized')
check('信标/总数受上限约束', snap.count <= 50, `count=${snap.count}`)
check('信标/optimize 证据未被启动噪声挤掉', Boolean(keep))
check('信标/optimize 证据带上排障计数', keep?.ctxSkipped === 7 && keep?.ctxTurns === 2)

console.log(`\n[context] ${failures === 0 ? 'all passed' : `${failures} failed`}`)
if (failures > 0) process.exitCode = 1
