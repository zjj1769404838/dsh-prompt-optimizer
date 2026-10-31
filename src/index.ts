// @zjj/dsh-prompt-optimizer node half
// 优先调用 DSH 已连接模型（ctx.llm）做语义级提示词改写；
// 不可用时回退本地规则引擎（optimizePrompt），保证零配置也能用。
export const name = '@zjj/dsh-prompt-optimizer'
// 注意：不把 'llm' 写进 inject —— 该服务是可选的，缺失时插件仍需能启动。
// 运行期用 ctx.get('llm') 容错读取（与官方 dsh-better-sidebar 同一模式）。
export const inject = ['webServer']

const ROUTE_PREFIX = '/dsh-prompt-optimizer'
// 与 package.json 的 version 保持一致（scripts/gates/run.mjs 会校验两者相等）
const PLUGIN_VERSION = '0.1.9'

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

// ─── 场景分流 ───
// 「古板」的根源是一套通用模板套所有需求：写代码和写文案要的约束根本不是一回事，
// 用同一份「结论先行、分点说明」去润色一段代码需求，产出必然空洞。
// 这里按输入特征判定场景，每个场景带自己的角色、约束与输出要求；
// 判不出来才退回通用模板。
export type Scene = 'code' | 'writing' | 'analysis' | 'translate' | 'image' | 'general'

const SCENE_MATCHERS: Array<{ scene: Scene; re: RegExp }> = [
  // 代码优先：技术需求里常夹「写」「说明」这类词，先判技术再判写作，避免被写作规则吃掉。
  // 「爬虫/抓取/数据库/服务端」这类词必须在内：实测「帮我写个爬虫」曾被判成写作场景，
  // 因为「写个」命中了写作正则而技术词表里没有「爬虫」。
  {
    scene: 'code',
    re: /(代码|函数|报错|异常|编译|脚本|接口|依赖|单测|测试用例|重构|正则|sql|html|css|react|vue|python|java|typescript|node|json|yaml|git|部署|性能|bug|debug|api|爬虫|抓取|爬取|数据库|服务端|客户端|算法|中间件|微服务|docker|nginx|redis|mysql|shell|bash|命令行)/i,
  },
  { scene: 'translate', re: /(翻译|译成|英译|中译|笔译|translate|locali[sz]e|i18n)/i },
  {
    scene: 'image',
    re: /(画(一|个|张|幅|成|出)|绘制|插画|海报|配图|出图|生图|文生图|logo|icon|svg|构图|配色|midjourney|stable diffusion|seedream|即梦|dall-?e)/i,
  },
  {
    scene: 'writing',
    re: /(写一|写个|写份|文案|文章|故事|小说|脚本|标题|邮件|回复|润色|改写|语气|风格|小红书|公众号|周报|总结|readme|readme)/i,
  },
  {
    scene: 'analysis',
    re: /(分析|对比|评估|诊断|原因|为什么|数据|统计|趋势|方案|策略|利弊|选型|风险|优化建议)/i,
  },
]

function detectScene(raw: string): Scene {
  for (const m of SCENE_MATCHERS) {
    if (m.re.test(raw)) return m.scene
  }
  return 'general'
}

const SCENE_ROLE: Record<Scene, string> = {
  general: DEFAULT_ROLE,
  code: '你是一位资深软件工程师，擅长把模糊的技术需求转化为可直接落地的实现要求。',
  writing: '你是一位资深内容编辑，擅长把粗略的写作意图转化为风格明确、可直接落笔的写作要求。',
  analysis: '你是一位资深分析师，擅长把笼统的分析诉求转化为口径清晰、可验证的分析要求。',
  translate: '你是一位资深译者与本地化专家，擅长把翻译需求转化为语域明确、术语一致的翻译要求。',
  image: '你是一位资深视觉提示词工程师，擅长把画面想法转化为构图、光线、风格都明确的生成提示词。',
}

const SCENE_REQ: Record<Scene, string[]> = {
  general: DEFAULT_REQ,
  code: [
    '- 明确语言/框架/运行环境；缺省时按最通用的方案，并在文中标注这个假设',
    '- 给出可运行的完整实现或明确的改动点，不用伪代码占位',
    '- 交代边界与失败处理（空值、异常、并发、超时）',
    '- 需要验证时给出可执行的验证步骤或断言',
  ],
  writing: [
    '- 明确读者、发布渠道与写作目的',
    '- 明确篇幅、语气与风格（正式/口语、克制/煽动）',
    '- 只使用已给出的事实与数据，不新增未提供的细节',
    '- 列出必须出现的要点与必须避免的表达',
  ],
  analysis: [
    '- 明确分析对象、口径与时间范围',
    '- 先给结论，再给支撑依据与推理链',
    '- 事实、推断、假设三者分别标注',
    '- 数据不足时说明缺口，不虚构数字',
  ],
  translate: [
    '- 明确源语言、目标语言与目标读者',
    '- 专有名词与术语给统一译法，必要时保留原文以便核对',
    '- 说明语域（技术文档/营销文案/法律文本）与本地化要求',
    '- 只输出译文，取舍说明单独附在译文之后',
  ],
  image: [
    '- 主体、动作、场景、镜头景别与视角',
    '- 光线、色调、风格与质感',
    '- 画幅比例，以及画面内文字/必须不出现的元素',
    '- 用可被模型理解的具体名词，避免抽象形容词堆砌',
  ],
}

const SCENE_OUT: Record<Scene, string> = {
  general: DEFAULT_OUT,
  code: '直接给出代码与必要的运行说明；不要用省略号跳过关键实现。',
  writing: '直接给出成稿；若给多个版本，按版本分别标注差异。',
  analysis: '结论先行，随后给依据；每条结论都要能被数据或原文支撑。',
  translate: '只输出译文；术语与取舍说明放在译文之后。',
  image: '输出一段可直接粘贴进生成模型的提示词，不要附加解释。',
}

/** 本地引擎可能写出的全部角色行，用于幂等判据识别自己人。 */
const ROLE_LINES = Object.values(SCENE_ROLE)

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
  // 必须是「任一场景角色行」——按场景分流后角色行有六种，只认 DEFAULT_ROLE
  // 会漏掉代码/写作/分析/翻译/图像五类产物，导致连点把产物再包一层。
  if (/^\s*#\s*任务\s*$/m.test(norm) && ROLE_LINES.some((line) => norm.includes(line))) return true

  // 阈值取 3 而不是 2：用户自己写的结构化稿常常只有 `## 背景` + `## 输出`
  // 两个标题（命中 2 个关键词），判据太松会把它们当成插件产物直接拒绝润色。
  // 本插件两条路径的产物稳定命中 3 个以上（本地：# 任务 + 角色；LLM：角色/任务目标/输出要求）。
  const headings = norm.match(/^\s*#{1,3}\s*(.+)$/gm) ?? []
  if (headings.length < 2) return false
  const hit = new Set<string>()
  for (const line of headings) {
    const lower = line.toLowerCase()
    for (const word of SECTION_WORDS) {
      if (lower.includes(word)) hit.add(word)
    }
  }
  return hit.size >= 3
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
  // 按输入特征判场景：代码 / 写作 / 分析 / 翻译 / 图像 / 通用。
  // 场景决定角色行、约束清单与输出要求，这是「不再古板」的核心改动。
  const scene = detectScene(src)

  const out: string[] = []
  let changed = false

  // 1) 角色设定：若首行未声明角色，补该场景的角色行（不是一套通用话术）
  const hasRole = /你(是|是一位|作为一个)|你是|act as|you are|作为/i.test(firstLine)
  if (!hasRole) {
    out.push(SCENE_ROLE[scene])
    changed = true
  }

  // 2) 任务复述
  out.push(`# 任务`)
  out.push(src)
  changed = true

  // 3) 场景约束（除非原文已存在明显的编号/分点）
  const hasStructure = /(^\s*[\d一二三四1-9][.、)）]|\n\s*[-*·])/m.test(src)
  if (!hasStructure) {
    out.push(``)
    out.push(`# 要求`)
    for (const item of SCENE_REQ[scene]) out.push(item)
    changed = true
  }

  // 4) 输出格式提示（场景专属）
  const hasFormat = /(以.*格式|输出为|markdown|json|表格|bullet|列表)/i.test(src)
  if (!hasFormat) {
    out.push(``)
    out.push(`# 输出`)
    out.push(SCENE_OUT[scene])
    changed = true
  }

  const text = out.join('\n')
  return { ok: changed, text, reason: changed ? undefined : '已是较规范的提示词，未做改动' }
}

// ─── LLM 路径：系统提示词 ───
// 单一 system prompt 是「古板」的另一半根源：代码、写作、分析、翻译共用一套规则，
// 模型只能给出通用腔。这里按场景给不同的改写侧重，并在有会话上下文时明确要求
// 「沿用上文已确定的前提」，避免每条提示词都像凭空冒出来的。
const BASE_RULES = [
  '1. 保留用户的原始意图、约束条件、专有名词、数据与代码，不要臆造新需求。',
  '2. 补齐缺失的要素：角色、任务目标、上下文、约束、期望输出形式。',
  '3. 消解歧义：把"好一点/丰富一点"这类模糊表述改写成可判定的具体要求。',
  '4. 结构化：用简短小标题与要点组织，长任务拆成分步。',
  '5. 只输出改写后的提示词正文，不要解释、不要前后加引号、不要用代码块包裹。',
  '6. 若原提示词已经足够清晰，输出优化后的同义版本（可更紧凑），不要拒绝回答。',
]

const SCENE_FOCUS: Record<Scene, string[]> = {
  general: [],
  code: [
    '- 这是技术需求：补齐语言/框架/运行环境、输入输出契约、边界与失败处理；',
    '  要求可运行而非伪代码，并给出可执行的验证方式。',
  ],
  writing: [
    '- 这是写作需求：补齐读者、渠道、目的、篇幅、语气与风格；',
    '  只允许使用用户已给出的事实，明确禁止编造未提供的细节。',
  ],
  analysis: [
    '- 这是分析需求：补齐分析对象、口径、时间范围；要求结论先行并区分事实/推断/假设。',
  ],
  translate: [
    '- 这是翻译需求：补齐源语言、目标语言、语域与本地化要求；术语给统一译法并保留原文以便核对。',
  ],
  image: [
    '- 这是图像生成需求：补齐主体、动作、场景、景别、光线、色调、风格、画幅比例；',
    '  用具体名词而非抽象形容词，并明确画面内文字要求。',
  ],
}

function buildSystemPrompt(scene: Scene, hasContext: boolean): string {
  const focus = SCENE_FOCUS[scene] ?? []
  const lines = [
    '你是一名提示词工程专家。用户会给你一段想交给 AI 的原始需求，'
    + '你的唯一任务是把它改写成一条更清晰、更可执行、更少歧义的提示词。',
    '',
    '改写规则：',
    ...BASE_RULES,
  ]
  if (focus.length > 0) {
    lines.push('', '本场景的额外侧重：', ...focus)
  }
  if (hasContext) {
    lines.push(
      '',
      '关于对话上下文：',
      '7. 下面会附上「当前对话的最近几轮」。当原始需求是接着上文说的（省略了主语、'
      + '引用了"上面那个/刚才的/继续"），用上下文补齐它指代的对象。',
      '8. 上文已确定的前提（技术栈、口径、风格、已否决的方案）不要改写、不要重复要求，'
      + '也不要引入与上文冲突的新约束。',
      '9. 上下文只用来消歧，不要把上文的结论复述进改写结果——输出仍只针对当前这条需求。',
    )
  }
  return lines.join('\n')
}

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

// 结束原因里这几种代表「话没说完就断了」：token 上限、内容过滤。
// 截断的半句写回输入框比不改还糟（用户会拿着断头提示词去问模型），
// 遇到一律判本次改写失败，交给本地规则引擎兜底。
const TRUNCATED_FINISH = new Set([
  'length', 'max_tokens', 'max-tokens', 'max_output_tokens', 'content_filter',
])

// 拼接流式分片：累加 text-delta，同时记下 finish 的结束原因。
async function collectText(
  chunks: AsyncIterable<LlmChunk>,
): Promise<{ text: string; truncated: boolean }> {
  let out = ''
  let truncated = false
  for await (const c of chunks) {
    if (!c) continue
    if (c.type === 'text-delta' && typeof c.text === 'string') {
      out += c.text
    } else if (c.type === 'finish' && typeof c.reason === 'string') {
      if (TRUNCATED_FINISH.has(c.reason.toLowerCase())) truncated = true
    }
  }
  return { text: out, truncated }
}

/**
 * 「用户点了停止」的专用标记。
 * 必须与「模型不可用」区分开：不可用要回退本地规则，用户主动停止则连本地规则也不该跑
 * —— 他已经改主意了，再花算力算一份没人要的结果没有意义，写回更是会被他讨厌。
 */
const LLM_ABORTED = Symbol('llm-aborted')

/** 判断这个异常是不是「信号被 abort」（超时或用户停止都会走这条路）。 */
function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  const name = (err as { name?: string } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
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

/**
 * 从会话历史里挑出最近几轮「人说的话」，供改写时消歧用。
 *
 * 只用 user/message：assistant 的回复往往很长（含大段代码/表格），塞进上下文
 * 既烧 token 又会把改写方向带偏——我们要的是「用户在聊什么」，不是「模型上次答了什么」。
 * 取 append-origin 事件（isAppendSurfaceEvent）：被替换过的消息在模型可见面里被遮蔽，
 * 但人看到的对话记录里它仍在，拿替换副本会拿到用户没见过的内容。
 */
const CONTEXT_MAX_TURNS = 6
const CONTEXT_MAX_CHARS = 1200

type ContextTurn = { role: 'user' | 'assistant'; text: string }

/** 把消息 content 压成纯文本（content 可能是字符串或 [{type:'text',text}] 数组）。 */
function flattenContent(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (typeof (block as any).text === 'string') parts.push((block as any).text)
  }
  return parts.join('\n')
}

async function readSessionContext(ctx: any, sessionId: string): Promise<ContextTurn[]> {
  if (!isNonEmptyString(sessionId)) return []
  let query: any
  try {
    query = ctx?.get?.('sessionQuery')
  } catch {
    return []
  }
  if (!query || typeof query.readSession !== 'function') return []

  let loaded: any
  try {
    loaded = await query.readSession(sessionId)
  } catch {
    return []
  }
  const events: any[] = Array.isArray(loaded?.events) ? loaded.events : []
  if (events.length === 0) return []

  // 从尾部往前取，凑够 CONTEXT_MAX_TURNS 轮就停——长会话不必扫全量。
  const turns: ContextTurn[] = []
  for (let i = events.length - 1; i >= 0 && turns.length < CONTEXT_MAX_TURNS; i -= 1) {
    const ev = events[i]
    if (!ev || ev.type !== 'user/message') continue
    if (ev.surfaceOp !== 'append') continue
    const text = flattenContent(ev.data?.content ?? ev.data?.message?.content).trim()
    if (!text) continue
    turns.push({ role: 'user', text })
  }
  turns.reverse()

  // 总长兜底：上下文只是消歧辅助，不该把主输入挤到模型窗口外。
  let budget = CONTEXT_MAX_CHARS
  const kept: ContextTurn[] = []
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i]
    if (t.text.length > budget) {
      // 单条就超预算：截断尾部保留开头（用户的需求通常在前半句）
      kept.unshift({ role: t.role, text: t.text.slice(0, Math.max(0, budget)) })
      break
    }
    budget -= t.text.length
    kept.unshift(t)
  }
  return kept
}

/** 把上下文渲染成给模型看的一段前缀文本。 */
function renderContext(turns: ContextTurn[]): string {
  if (turns.length === 0) return ''
  const lines = ['[当前对话的最近几轮，仅用于消歧]']
  for (const t of turns) lines.push(`用户：${t.text}`)
  return lines.join('\n')
}

async function optimizeWithLlm(
  ctx: any,
  raw: string,
  clientSignal?: AbortSignal,
  contextTurns: ContextTurn[] = [],
): Promise<{ ok: boolean; text: string; reason?: string } | null | typeof LLM_ABORTED> {
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

  // 两条中止来源合并：①45s 模型超时；②浏览器断开连接（用户点了「停止」）。
  // 用自建 controller 而不是 AbortSignal.any，避免依赖较新的 Node 版本。
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timedOut = false
  let clientGone = false
  const onClientAbort = () => {
    clientGone = true
    try { controller?.abort() } catch { /* 忽略 */ }
  }
  if (clientSignal) {
    if (clientSignal.aborted) onClientAbort()
    else clientSignal.addEventListener('abort', onClientAbort, { once: true })
  }
  const timeoutTimer = controller
    ? setTimeout(() => { timedOut = true; try { controller?.abort() } catch { /* 忽略 */ } }, LLM_TIMEOUT_MS)
    : null
  const cleanup = () => {
    if (timeoutTimer) clearTimeout(timeoutTimer)
    try { clientSignal?.removeEventListener('abort', onClientAbort) } catch { /* 忽略 */ }
  }

  // 已经断开了就别再起一次模型调用
  if (clientGone) {
    cleanup()
    return LLM_ABORTED
  }

  // 场景分流 + 上下文：system 按输入特征选侧重，有历史时把最近几轮人说的话
  // 拼在用户消息前面（不用多轮 messages：这里要的是「消歧材料」，不是继续对话）。
  const scene = detectScene(raw)
  const contextBlock = renderContext(contextTurns)
  const userText = contextBlock ? `${contextBlock}\n\n[当前要优化的提示词]\n${raw}` : raw

  let stream: AsyncIterable<LlmChunk>
  try {
    stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: buildSystemPrompt(scene, contextBlock !== ''),
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      maxTokens: LLM_MAX_TOKENS,
      temperature: 0.3,
      ...(effort ? { reasoningEffort: effort } : {}),
      ...(controller ? { signal: controller.signal } : {}),
    })
  } catch {
    cleanup()
    return null
  }

  try {
    const { text: rawText, truncated } = await collectText(stream)
    // 用户主动停止：不回退本地规则，直接告诉上层「别写了」
    if (clientGone) return LLM_ABORTED
    // 被截断的产物绝不写回：宁可回退本地规则，也不要把半句话盖到用户输入上。
    if (truncated) return null
    const text = sanitize(rawText)
    if (!text) return null
    return { ok: true, text }
  } catch (err) {
    // 用户停止优先于超时判定（两者都会 abort，顺序反了会把「我按了停止」说成超时）
    if (clientGone) return LLM_ABORTED
    if (timedOut || isAbortError(err, controller?.signal)) return null
    return null
  } finally {
    cleanup()
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
  if (typeof origin !== 'string' || origin === '') return true
  // `Origin: null` 不是「没有来源」：沙箱 iframe、data: 页面、部分跨源重定向都会发它。
  // 把它与「无 Origin」归成一类等于放行任意被嵌入页面，可白嫖本地模型额度。
  // 真正的非浏览器客户端（curl / 脚本）根本不发这个头，拒绝它不影响任何正常调用。
  if (origin === 'null') return false

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
        // 客户端从槽位 standardProps 拿到的会话 id；拿不到就是空串（DOM 兜底路径）。
        // 只用来读历史做消歧，不做鉴权——同源校验已经挡掉跨站调用。
        const sessionId: string = typeof parsed.sessionId === 'string' ? parsed.sessionId : ''

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
        let aborted = false

        // 客户端断开（用户点「停止」/ 关标签页）时把 abort 传进模型流，
        // 否则服务端会一直跑满 45s 才收手，白烧 token。
        const clientAbort = typeof AbortController !== 'undefined' ? new AbortController() : null
        const onClose = () => { try { clientAbort?.abort() } catch { /* 忽略 */ } }
        if (clientAbort) {
          try { req.once?.('close', onClose) } catch { /* 忽略 */ }
          try { res.once?.('close', onClose) } catch { /* 忽略 */ }
        }
        const clientSignal = clientAbort?.signal

        const tooLongForLlm = raw.length > LLM_MAX_INPUT_CHARS
        if (wantMode !== 'local' && tooLongForLlm) {
          note = `输入超过 ${LLM_MAX_INPUT_CHARS} 字符，已跳过模型改写以控制开销`
        }
        if (wantMode !== 'local' && !tooLongForLlm) {
          // 会话上下文：只在客户端给了 sessionId 且宿主有 sessionQuery 时才有。
          // 读不到就静默降级——上下文是增强，不是前置条件。
          const contextTurns = await readSessionContext(ctxRef, sessionId)
          if (contextTurns.length > 0) {
            note = `已带入 ${contextTurns.length} 轮对话上下文`
          }
          const llmResult = await optimizeWithLlm(ctxRef, raw, clientSignal, contextTurns)
          if (llmResult === LLM_ABORTED) {
            // 用户主动停止：连本地规则也不跑，直接结束（连接多半已断，写不回去也无所谓）
            aborted = true
          } else if (llmResult) {
            result = llmResult
            mode = 'llm'
          }
        }
        if (aborted) {
          // 客户端已断开时 res 通常不可写，容错即可
          try { sendJson(res, 200, { ok: false, text: raw, reason: '已停止优化', mode: 'none', aborted: true }) } catch { /* 忽略 */ }
          return
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
