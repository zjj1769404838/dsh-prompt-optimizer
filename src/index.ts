// @zjj/dsh-prompt-optimizer node half
// 优先调用 DSH 已连接模型（ctx.llm）做语义级提示词改写；
// 不可用时回退本地规则引擎（optimizePrompt），保证零配置也能用。
export const name = '@zjj/dsh-prompt-optimizer'
// 注意：不把 'llm' 写进 inject —— 该服务是可选的，缺失时插件仍需能启动。
// 运行期用 ctx.get('llm') 容错读取（与官方 dsh-better-sidebar 同一模式）。
export const inject = ['webServer']

const ROUTE_PREFIX = '/dsh-prompt-optimizer'
// 与 package.json 的 version 保持一致（scripts/gates/run.mjs 会校验两者相等）
const PLUGIN_VERSION = '0.1.7'

// 请求体上限：/optimize 与 /beacon 都是本地小载荷，超过一律 413，
// 避免任何同机进程用超大 body 把宿主进程的内存吃满。
const MAX_BODY_BYTES = 256 * 1024
// 送模型的输入上限：超长输入不进模型，直接走本地规则，防止单次点击烧掉大量 token。
const LLM_MAX_INPUT_CHARS = 8000
// 信标字段白名单：只留结构性字段，绝不接收页面文本内容。
const BEACON_KEYS = [
  'stage', 'build', 'kind', 'tag', 'cls', 'via', 'anchorCls',
  'missCount', 'wrote', 'mode', 'len', 'err', 'digitNodes', 'dotCount', 'note',
  'chips', 'chipsRestored',
]

// ─── 本地规则引擎（回退路径，纯函数，不联网、不依赖密钥）───
const DEFAULT_ROLE = '你是一位资深助手，擅长把模糊需求转化为清晰、可执行的指令。'
const DEFAULT_REQ = [
  '- 先理解我的真实意图，再给出可落地的结果',
  '- 输出结构清晰：结论先行，关键步骤分点说明',
  '- 如涉及不确定信息，明确标注而非编造',
  '- 用简洁的中文表达，避免空洞套话',
]
const DEFAULT_OUT = '请直接给出结果；如需解释，附在结果之后。'

// 结构化提示词的段落关键词：本地引擎与 LLM 路径的产物都覆盖。
const SECTION_WORDS = [
  '角色', '任务', '目标', '要求', '约束', '输出', '背景', '步骤', '验收', '示例',
  'role', 'task', 'goal', 'requirement', 'constraint', 'output', 'context', 'step',
]

/**
 * 判断输入是否已经是一条结构化提示词（本引擎任一路径的产物，或用户自带的结构化稿）。
 *
 * 幂等判据不能只认本地引擎的格式：本地路径产出 `# 任务` + DEFAULT_ROLE，
 * 而 LLM 路径产出的是 `## 角色` / `## 任务目标` 这类小标题，两者格式不同。
 * 早期版本只匹配前者，导致 LLM 模式下连点会不断把上一次的产物再包一层
 * （实测 531 → 1618 字符持续膨胀）。
 *
 * 现在的判据对两条路径通用：至少 2 个 Markdown 标题行，且这些标题里
 * 命中至少 2 个段落关键词。
 */
function isStructuredPrompt(input: string): boolean {
  const norm = input.replace(/\r\n/g, '\n')
  // 本地引擎产物：固定角色行 + `# 任务`，命中即判定（保留原有快速路径）。
  if (norm.includes(DEFAULT_ROLE) && /^\s*#\s*任务\s*$/m.test(norm)) return true

  const headings = norm.match(/^\s*#{1,3}\s*(.+)$/gm) ?? []
  if (headings.length < 2) return false
  const hit = new Set<string>()
  for (const line of headings) {
    const lower = line.toLowerCase()
    for (const word of SECTION_WORDS) {
      if (lower.includes(word)) hit.add(word)
    }
  }
  return hit.size >= 2
}

function optimizePrompt(raw: string): { ok: boolean; text: string; reason?: string } {
  const src = raw.trim()
  if (!src) return { ok: false, text: raw, reason: '输入框为空，无需优化' }
  if (src.length < 6) return { ok: false, text: raw, reason: '文本过短，暂不需要优化' }

  // 幂等保护：已经结构化过的内容原样返回。
  // 否则第二次点击会把上一次的产物当成新任务再包一层，长度无限膨胀。
  if (isStructuredPrompt(src)) {
    return {
      ok: false,
      text: raw,
      reason: '已是结构化提示词，本地规则不再重复加工',
    }
  }

  const lines = src.split(/\r?\n/)
  const firstLine = lines[0].trim()

  const out: string[] = []
  let changed = false

  // 1) 角色设定：若首行未声明角色，补一个通用"你是一位资深助手"
  const hasRole = /你(是|是一位|作为一个)|你是|act as|you are|作为/i.test(firstLine)
  if (!hasRole) {
    out.push(DEFAULT_ROLE)
    changed = true
  }

  // 2) 任务复述
  out.push(`# 任务`)
  out.push(src)
  changed = true

  // 3) 结构化约束（除非原文已存在明显的编号/分点）
  const hasStructure = /(^\s*[\d一二三四1-9][.、)）]|\n\s*[-*·])/m.test(src)
  if (!hasStructure) {
    out.push(``)
    out.push(`# 要求`)
    for (const item of DEFAULT_REQ) out.push(item)
    changed = true
  }

  // 4) 输出格式提示
  const hasFormat = /(以.*格式|输出为|markdown|json|表格|bullet|列表)/i.test(src)
  if (!hasFormat) {
    out.push(``)
    out.push(`# 输出`)
    out.push(DEFAULT_OUT)
    changed = true
  }

  const text = out.join('\n')
  return { ok: changed, text, reason: changed ? undefined : '已是较规范的提示词，未做改动' }
}

// ─── LLM 路径：系统提示词 ───
const SYSTEM_PROMPT = [
  '你是一名提示词工程专家。用户会给你一段想交给 AI 的原始需求，'
  + '你的唯一任务是把它改写成一条更清晰、更可执行、更少歧义的提示词。',
  '',
  '改写规则：',
  '1. 保留用户的原始意图、约束条件、专有名词、数据与代码，不要臆造新需求。',
  '2. 补齐缺失的要素：角色、任务目标、上下文、约束、期望输出形式。',
  '3. 消解歧义：把"好一点/丰富一点"这类模糊表述改写成可判定的具体要求。',
  '4. 结构化：用简短小标题与要点组织，长任务拆成分步。',
  '5. 只输出改写后的提示词正文，不要解释、不要前后加引号、不要用代码块包裹。',
  '6. 若原提示词已经足够清晰，输出优化后的同义版本（可更紧凑），不要拒绝回答。',
].join('\n')

const LLM_TIMEOUT_MS = 45_000
const LLM_MAX_TOKENS = 2048

type LlmChunk = {
  type: string
  index?: number
  text?: string
  reason?: string
}

type Route = { provider: string; model: string }

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

// 从 agentDefaultModel 拿当前默认模型；拿不到再退回 llm 目录里的第一个可用模型。
async function resolveRoute(ctx: any, llm: any): Promise<Route | null> {
  try {
    const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.()
    if (selection && isNonEmptyString(selection.provider) && isNonEmptyString(selection.model)) {
      return { provider: selection.provider, model: selection.model }
    }
  } catch {
    /* 忽略，走下面的目录回退 */
  }
  try {
    const providers = llm.listProviders?.() ?? []
    for (const p of providers) {
      const provider = (p as any)?.id
      if (!isNonEmptyString(provider)) continue
      const models = await llm.listModels?.(provider)
      const first = Array.isArray(models) ? models[0] : undefined
      if (first && isNonEmptyString((first as any).id)) {
        return { provider, model: (first as any).id }
      }
    }
  } catch {
    /* 无可用模型 */
  }
  return null
}

// 选最低推理强度：DeepSeek 适配器默认 high，会把短答案全烧在思考里。
// 适配器返回的 efforts 顺序不保证，故按已知档位排序取最低（未知档位按原序兜底）。
const EFFORT_ORDER = ['minimal', 'none', 'low', 'medium', 'high', 'max']

async function lowestEffort(llm: any, route: Route): Promise<string | undefined> {
  try {
    if (typeof llm.resolveModelInfo !== 'function') return undefined
    const info = await Promise.resolve(llm.resolveModelInfo(route.provider, route.model)).catch(() => undefined)
    const efforts = info?.reasoning?.efforts
    if (!Array.isArray(efforts) || efforts.length === 0) return undefined
    const ids = efforts
      .map((e: any) => (isNonEmptyString(e?.id) ? e.id : undefined))
      .filter((x: any): x is string => typeof x === 'string')
    if (ids.length === 0) return undefined
    const known = ids.filter((id) => EFFORT_ORDER.indexOf(id) !== -1)
    if (known.length > 0) {
      known.sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b))
      return known[0]
    }
    return ids[0]
  } catch {
    return undefined
  }
}

// 拼接流式分片：只用 text-delta（其它分片类型对文本结果无贡献）
async function collectText(chunks: AsyncIterable<LlmChunk>): Promise<string> {
  let out = ''
  for await (const c of chunks) {
    if (c && c.type === 'text-delta' && typeof c.text === 'string') out += c.text
  }
  return out
}

// 清掉模型爱加的外壳：前缀说明、代码块围栏、包裹引号
// 顺序要紧：先剥掉「优化后的提示词：」这类前缀，再识别代码块围栏。
function sanitize(text: string): string {
  let t = text.trim()
  t = t.replace(/^(优化后的提示词|改写后的提示词|优化结果|优化后|提示词)[:：]\s*/i, '').trim()
  const fence = /^```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(t)
  if (fence) t = fence[1].trim()
  t = t.replace(/^["“”']([\s\S]*)["“”']$/, '$1').trim()
  return t
}

async function optimizeWithLlm(ctx: any, raw: string): Promise<{ ok: boolean; text: string; reason?: string } | null> {
  let llm: any
  try {
    llm = ctx?.get?.('llm')
  } catch {
    return null
  }
  if (!llm || typeof llm.stream !== 'function') return null

  const route = await resolveRoute(ctx, llm)
  if (!route) return null

  const effort = await lowestEffort(llm, route)
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(LLM_TIMEOUT_MS)
    : undefined

  let stream: AsyncIterable<LlmChunk>
  try {
    stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: raw }] }],
      maxTokens: LLM_MAX_TOKENS,
      temperature: 0.3,
      ...(effort ? { reasoningEffort: effort } : {}),
      ...(signal ? { signal } : {}),
    })
  } catch {
    return null
  }

  try {
    const text = sanitize(await collectText(stream))
    if (!text) return null
    return { ok: true, text }
  } catch {
    return null
  }
}

function sendJson(res: any, status: number, data: any) {
  const body = Buffer.from(JSON.stringify(data), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // 本地接口不该被任何页面嵌入
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

const BODY_TOO_LARGE = Symbol('body-too-large')

/**
 * 回 413 并**等响应真正写完**再销毁连接。
 * 顺序反了就会变成「连接被重置」而不是 413——readBody 里已不再 destroy，
 * 这里负责收尾，避免超限请求把剩余字节继续灌进来。
 */
function rejectTooLarge(req: any, res: any) {
  sendJson(res, 413, { error: 'payload too large', limit: MAX_BODY_BYTES })
  const close = () => { try { req.destroy?.() } catch { /* 忽略 */ } }
  try { res.once('finish', close) } catch { close() }
}

function readBody(req: any, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      fn()
    }
    const onData = (chunk: Buffer) => {
      if (done) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > maxBytes) {
        // 超限立即停止累积，避免内存被大 body 撑爆。
        // 注意：这里**不能** req.destroy()——连接一旦销毁，后续 413 响应就写不出去，
        // 客户端只能看到连接被重置（实测报 RemoteDisconnected）。正确做法是先停读、让
        // 调用方把 413 发完，再由调用方在响应 finish 后销毁连接。
        chunks.length = 0
        try { req.pause?.() } catch { /* 忽略 */ }
        req.removeListener?.('data', onData)
        finish(() => reject(BODY_TOO_LARGE))
        return
      }
      chunks.push(buf)
    }
    req.on('data', onData)
    req.on('end', () => finish(() => resolve(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', (err: unknown) => finish(() => reject(err)))
  })
}

// ─── 同源校验：阻止任意网页跨站调用本地接口 ───
// 浏览器发起跨站请求会带 Origin / Sec-Fetch-Site；同源或非浏览器客户端不带或带本机源。
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function splitHostPort(host: string): { hostname: string; port: string } {
  const idx = host.lastIndexOf(':')
  if (idx === -1) return { hostname: host.toLowerCase(), port: '' }
  return { hostname: host.slice(0, idx).toLowerCase(), port: host.slice(idx + 1) }
}

/**
 * 只接受「同源」或「无 Origin（非浏览器 / 自定义 app scheme）」的请求。
 * 明确拒绝：Sec-Fetch-Site: cross-site，以及 http(s) 下 host 与 Origin 不匹配的请求。
 * 这样任意网页都无法用 fetch 打到本地 /optimize 白嫖模型额度或读取 /beacon。
 */
function isSameOrigin(req: any): boolean {
  const headers = req?.headers ?? {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') return false

  const origin = headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  // 自定义 app scheme（如 dsh-app://app）说明是宿主自己的页面
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true

  const host = typeof headers.host === 'string' ? headers.host : ''
  if (!host) return false
  if (parsed.host === host) return true

  // 127.0.0.1 / localhost 混用时按端口放行，避免本机别名把正常请求挡掉
  const a = splitHostPort(parsed.host)
  const b = splitHostPort(host)
  return LOOPBACK_HOSTS.has(a.hostname) && LOOPBACK_HOSTS.has(b.hostname) && a.port === b.port
}

// ─── 排障信标：客户端把看到的 DOM 结构回传，存内存供 /beacon 读取 ───
const beacons: any[] = []
const MAX_BEACONS = 50

/** 只保留白名单里的结构性字段，且字符串截断——信标绝不能承载页面文本或用户输入。 */
function sanitizeBeacon(input: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!input || typeof input !== 'object') return out
  for (const key of BEACON_KEYS) {
    const value = (input as Record<string, unknown>)[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string') out[key] = value.slice(0, 64)
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  out.ts = Date.now()
  return out
}

function createHandler() {
  return async (req: any, res: any) => {
    try {
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const path = url.pathname
      if (!path.startsWith(ROUTE_PREFIX)) {
        sendJson(res, 404, { error: 'not found' })
        return
      }
      const route = path.slice(ROUTE_PREFIX.length) || '/'
      const method = req.method ?? 'GET'

      if (method === 'GET' && route === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          plugin: '@zjj/dsh-prompt-optimizer',
          version: PLUGIN_VERSION,
          uptime: process.uptime(),
          engine: 'llm-first',
        })
        return
      }

      // 写操作一律先过同源校验
      if (method === 'POST' && !isSameOrigin(req)) {
        sendJson(res, 403, { error: 'forbidden', detail: 'cross-origin request rejected' })
        return
      }

      if (method === 'POST' && route === '/optimize') {
        let bodyText: string
        try {
          bodyText = await readBody(req)
        } catch (err) {
          if (err === BODY_TOO_LARGE) {
            rejectTooLarge(req, res)
            return
          }
          sendJson(res, 400, { error: 'bad request' })
          return
        }
        let parsed: any = {}
        try {
          parsed = bodyText ? JSON.parse(bodyText) : {}
        } catch {
          parsed = {}
        }
        const raw: string = typeof parsed.text === 'string' ? parsed.text : ''
        const wantMode: string = parsed.mode === 'local' ? 'local' : 'auto'

        if (!raw.trim()) {
          sendJson(res, 200, { ok: false, text: raw, reason: '输入框为空，无需优化', mode: 'none' })
          return
        }
        if (raw.trim().length < 6) {
          sendJson(res, 200, { ok: false, text: raw, reason: '文本过短，暂不需要优化', mode: 'none' })
          return
        }

        // 幂等保护（两条引擎共用）：已经是本插件产出的结构化提示词，
        // 再点一次不应该二次加工，否则内容会一层层套起来无限膨胀。
        if (isStructuredPrompt(raw)) {
          sendJson(res, 200, {
            ok: false,
            text: raw,
            reason: '已是结构化提示词，未做改动',
            mode: 'none',
          })
          return
        }

        let result: { ok: boolean; text: string; reason?: string } | null = null
        let mode = 'local'
        let note: string | undefined

        const tooLongForLlm = raw.length > LLM_MAX_INPUT_CHARS
        if (wantMode !== 'local' && tooLongForLlm) {
          note = `输入超过 ${LLM_MAX_INPUT_CHARS} 字符，已跳过模型改写以控制开销`
        }
        if (wantMode !== 'local' && !tooLongForLlm) {
          result = await optimizeWithLlm(ctxRef, raw)
          if (result) mode = 'llm'
        }
        if (!result) {
          result = optimizePrompt(raw)
          mode = 'local'
        }
        sendJson(res, 200, {
          ok: result.ok,
          text: result.text,
          reason: result.reason ?? null,
          mode,
          ...(note ? { note } : {}),
        })
        return
      }

      if (route === '/beacon') {
        if (method === 'GET') {
          sendJson(res, 200, { count: beacons.length, beacons })
          return
        }
        if (method === 'POST') {
          let bodyText: string
          try {
            bodyText = await readBody(req)
          } catch (err) {
            if (err === BODY_TOO_LARGE) {
              rejectTooLarge(req, res)
              return
            }
            sendJson(res, 400, { error: 'bad request' })
            return
          }
          let parsed: any = {}
          try {
            parsed = bodyText ? JSON.parse(bodyText) : {}
          } catch {
            parsed = {}
          }
          beacons.push(sanitizeBeacon(parsed))
          if (beacons.length > MAX_BEACONS) beacons.splice(0, beacons.length - MAX_BEACONS)
          sendJson(res, 200, { ok: true })
          return
        }
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (err) {
      sendJson(res, 500, { error: 'internal error', detail: String(err) })
    }
  }
}

// apply 时抓一份 ctx 引用，供请求处理期读取 ctx.get('llm')
let ctxRef: any = null

export function apply(ctx: any) {
  ctxRef = ctx
  const webServer = ctx?.webServer
  if (webServer === undefined || typeof webServer.register !== 'function') {
    ctx?.logger?.warn?.('[@zjj/dsh-prompt-optimizer] webServer 不可用，跳过路由注册')
    return
  }
  webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: createHandler(),
  })
  ctx?.logger?.info?.('[@zjj/dsh-prompt-optimizer] 路由已注册（引擎：llm 优先，规则回退）')
}
