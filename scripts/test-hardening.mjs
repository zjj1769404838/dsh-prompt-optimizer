// 安全/健壮性回归：幂等、请求体上限、同源校验、信标字段白名单、超长输入降级
// 不依赖真实 DSH 进程，用模拟 host 直接驱动 handler。
import { apply } from '../lib/index.js'

function makeCtx(llmPresent = false) {
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
          stream() {
            return (async function* () {
              yield { type: 'text-delta', text: 'LLM 结果' }
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

let seq = 0
async function call(ctx, { path = '/optimize', method = 'POST', payload, headers = {}, rawBody, chunkSize } = {}) {
  // 每次调用前重新 apply：同时把模块级 ctxRef 指向当前 ctx（llm 读取走 ctxRef）
  apply(ctx)
  const handler = ctx.handlers[0].handler
  let body = ''
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(status, h) { this.statusCode = status; this.headers = h },
    end(buf) { body = Buffer.from(buf ?? '').toString('utf8') },
  }
  const buf = rawBody !== undefined
    ? Buffer.from(rawBody, 'utf8')
    : Buffer.from(JSON.stringify(payload ?? {}), 'utf8')
  const listeners = {}
  const req = {
    url: `/dsh-prompt-optimizer${path}`,
    method,
    headers: { host: '127.0.0.1:58421', ...headers },
    on(ev, cb) { (listeners[ev] ??= []).push(cb) },
    destroy() { req.destroyed = true },
  }
  const p = handler(req, res)
  // 按块投喂，便于验证「超限后立即停止累积」
  const size = chunkSize ?? (buf.length || 1)
  for (let i = 0; i < buf.length; i += size) {
    for (const cb of listeners.data ?? []) cb(buf.subarray(i, i + size))
    if (req.destroyed) break
  }
  if (!req.destroyed) for (const cb of listeners.end ?? []) cb()
  await p
  let json = null
  try { json = JSON.parse(body) } catch { /* 非 JSON 响应 */ }
  return { status: res.statusCode, headers: res.headers, body, json }
}

const results = []
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail })
  if (!cond) console.log(`[FAIL] ${name} :: ${detail ?? ''}`)
}

const ctx = makeCtx(false)

// ── 1. 幂等：连点三次，长度必须稳定 ──
const c1 = makeCtx(false)
const a = await call(c1, { payload: { text: '帮我写个爬虫', mode: 'local' } })
const b = await call(c1, { payload: { text: a.json.text, mode: 'local' } })
const c = await call(c1, { payload: { text: b.json.text, mode: 'local' } })
check('幂等/第1次有改写', a.json.ok === true, JSON.stringify(a.json).slice(0, 120))
check('幂等/第2次不改动', b.json.ok === false && b.json.mode === 'none', JSON.stringify(b.json).slice(0, 120))
check('幂等/长度不膨胀', a.json.text.length === b.json.text.length && b.json.text.length === c.json.text.length,
  `${a.json.text.length}/${b.json.text.length}/${c.json.text.length}`)
check('幂等/无嵌套 # 任务', (b.json.text.match(/#\s*任务/g) ?? []).length === 1, String((b.json.text.match(/#\s*任务/g) ?? []).length))

// ── 1b. 幂等（LLM 路径）：LLM 产物用 ## 角色 / ## 任务目标，与本地格式不同，
//        早期判据只认本地格式，导致 LLM 模式下连点持续膨胀。这里用 LLM 上下文回归。
const cLlm = makeCtx(true)
const la = await call(cLlm, { payload: { text: '帮我写个爬虫' } })
check('幂等LLM/第1次有改写', la.json.ok === true && la.json.mode === 'llm', JSON.stringify(la.json).slice(0, 120))
// 构造典型 LLM 产物：多个 ## 小标题
const llmShaped = '## 角色\n你是一名爬虫工程师。\n\n## 任务目标\n编写一个可运行的网页爬虫。\n\n## 输出要求\n- 输出 CSV'
const lb = await call(cLlm, { payload: { text: llmShaped } })
check('幂等LLM/## 结构被判为已优化', lb.json.ok === false && lb.json.mode === 'none', JSON.stringify(lb.json).slice(0, 160))
check('幂等LLM/原样返回不膨胀', lb.json.text === llmShaped, `${lb.json.text.length} vs ${llmShaped.length}`)

// 单标题、纯散文不应被误判
const plain = '## 背景\n我在做一个爬虫项目，需要抓取公开数据，希望得到一些建议和实现思路。'
const lp = await call(makeCtx(false), { payload: { text: plain, mode: 'local' } })
check('幂等LLM/单标题不误判', lp.json.ok === true, JSON.stringify(lp.json).slice(0, 120))

// ── 2. 请求体上限 413 ──
const big = 'x'.repeat(300 * 1024)
const bigRes = await call(ctx, { payload: { text: big }, chunkSize: 64 * 1024 })
check('413/超限被拒', bigRes.status === 413, `status=${bigRes.status}`)
check('413/带 limit', bigRes.json?.limit === 256 * 1024, JSON.stringify(bigRes.json))

// ── 3. 同源校验 403 ──
const evil = await call(ctx, {
  payload: { text: '帮我写个爬虫' },
  headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
})
check('403/跨站被拒', evil.status === 403, `status=${evil.status}`)

const same = await call(ctx, {
  payload: { text: '帮我写个爬虫', mode: 'local' },
  headers: { origin: 'http://127.0.0.1:58421', 'sec-fetch-site': 'same-origin' },
})
check('同源/放行', same.status === 200, `status=${same.status}`)

const noOrigin = await call(ctx, { payload: { text: '帮我写个爬虫', mode: 'local' } })
check('无 Origin/放行(非浏览器客户端)', noOrigin.status === 200, `status=${noOrigin.status}`)

const crossSiteOnly = await call(ctx, {
  payload: { text: '帮我写个爬虫' },
  headers: { 'sec-fetch-site': 'cross-site' },
})
check('403/仅 Sec-Fetch-Site 跨站也拒', crossSiteOnly.status === 403, `status=${crossSiteOnly.status}`)

// ── 4. 信标字段白名单：文本内容必须被丢弃 ──
const beaconCtx = makeCtx(false)
await call(beaconCtx, {
  path: '/beacon',
  payload: {
    stage: 'probe',
    cls: 'RlGAzG_row',
    dotCount: 3,
    // 下面这些是必须被丢弃的：非白名单键 / 超长字符串
    samples: ['记忆199******99'],
    text: '用户的私密输入',
    tag: 'y'.repeat(200),
  },
})
const got = await call(beaconCtx, { path: '/beacon', method: 'GET' })
const stored = got.json?.beacons?.[0] ?? {}
check('信标/丢弃 samples', !('samples' in stored), JSON.stringify(stored))
check('信标/丢弃 text', !('text' in stored), JSON.stringify(stored))
check('信标/保留白名单键', stored.stage === 'probe' && stored.cls === 'RlGAzG_row' && stored.dotCount === 3, JSON.stringify(stored))
check('信标/字符串截断 64', typeof stored.tag === 'string' && stored.tag.length === 64, String(stored.tag?.length))

// ── 5. 超长输入降级到本地规则，且带 note ──
const longCtx = makeCtx(true)
const longRes = await call(longCtx, { payload: { text: '请帮我写一个爬虫。'.repeat(1200) } })
check('超长/降级 local', longRes.json?.mode === 'local', `mode=${longRes.json?.mode}`)
check('超长/带 note', typeof longRes.json?.note === 'string' && longRes.json.note.includes('8000'), String(longRes.json?.note))

// ── 6. health 带版本号 ──
const health = await call(ctx, { path: '/health', method: 'GET' })
check('health/200', health.status === 200, `status=${health.status}`)
check('health/带 version', typeof health.json?.version === 'string' && health.json.version.length > 0, JSON.stringify(health.json))

// ── 7. nosniff 头 ──
check('安全头/nosniff', health.headers['x-content-type-options'] === 'nosniff', JSON.stringify(health.headers))

// ── 8. 413 必须是「收到响应」而不是「连接被重置」──
// 上面 1-7 全用假 req：req.destroy() 只置标志位、不断 socket，
// 所以「先 destroy 再发 413」这种真实世界必然失败的写法在假 req 下照样 PASS。
// 这一条走真 http server + 真 socket，专门堵这个盲区。
{
  const http = await import('node:http')
  const realCtx = makeCtx(false)
  apply(realCtx)
  const realHandler = realCtx.handlers[0].handler
  const server = http.createServer((req, res) => {
    Promise.resolve(realHandler(req, res)).catch(() => { try { res.destroy() } catch { /* 忽略 */ } })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    const bigBody = JSON.stringify({ text: 'x'.repeat(300000) })
    const out = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port, path: '/dsh-prompt-optimizer/optimize', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bigBody) },
      }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { body += c })
        res.on('end', () => resolve({ status: res.statusCode, body, err: null }))
      })
      req.on('error', (err) => resolve({ status: 0, body: '', err: err.code || err.message }))
      req.end(bigBody)
    })
    check('413/真连接拿到响应而非连接重置', out.err === null, `err=${out.err}`)
    check('413/状态码 413', out.status === 413, `status=${out.status}`)
    let j = null
    try { j = JSON.parse(out.body) } catch { /* 非 JSON */ }
    check('413/带 limit', j?.limit === 256 * 1024, out.body.slice(0, 120))
  } finally {
    await new Promise((r) => server.close(r))
  }
}

const failed = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`)
console.log(`\n[hardening] ${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exit(1)
