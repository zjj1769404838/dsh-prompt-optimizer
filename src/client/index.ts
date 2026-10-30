// @zjj/dsh-prompt-optimizer client half
// 在 DSH Web 输入框左侧工具区注入「魔法棒 + 优化」按钮。
// 定位走宿主 slot `conversation.input.left`（与 git 分支 chip 同一个槽位），
// 由宿主按 order 排序渲染 —— 位置稳定，不会随 React 重渲染漂移。
// slot 不可用时退回纯 DOM 注入（MutationObserver）作为兼容兜底。
// 带 /beacon 自报：把客户端实际看到的 DOM 情况回传服务端，便于无控制台环境下排障。
export const inject: string[] = ['slots']

// 构建标记：出现在每个信标里，用于判断浏览器跑的是不是最新产物
// （客户端代码改动必须用户硬刷新才生效，普通刷新命中模块缓存）
const BUILD = 'dspo-v11'

const ROUTE = 'dsh-prompt-optimizer'

// ─── baseURI-aware 路由解析（与官方插件一致，避免子路径下 404）───
function directoryBase(value: string): string {
  let url: URL
  try {
    url = new URL(
      value === '' || value === undefined ? 'http://dsh.internal/' : value,
      'http://dsh.internal/',
    )
  } catch {
    url = new URL('http://dsh.internal/')
  }
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
  return url.href
}

function routeUrl(path: string): string {
  const base =
    typeof document !== 'undefined' && typeof document.baseURI === 'string'
      ? document.baseURI
      : ''
  return new URL(path.replace(/^\/+/, ''), directoryBase(base)).href
}

// ─── 自报：客户端是否执行、看到了什么（排障用，失败静默）───
let beaconSent = false
function beacon(stage: string, detail: Record<string, unknown> = {}) {
  try {
    const payload = JSON.stringify({ stage, build: BUILD, ...detail, ts: Date.now() })
    // 只报一次「已启动」，其余阶段每次都报（数据量极小）
    if (stage === 'boot' && beaconSent) return
    if (stage === 'boot') beaconSent = true
    void fetch(routeUrl(`${ROUTE}/beacon`), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: payload,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* 排障通道，绝不能影响主流程 */
  }
}

// 客户端超时要比服务端的模型超时（45s）更宽，留出网络与规则回退的余量；
// 没有超时的话，服务端一旦卡住，按钮会永久停在加载态。
const REQUEST_TIMEOUT_MS = 60_000

// ─── 可取消的当前运行 ───
// 一次优化最长要等 45s，用户常常中途改主意（写错了、想换个问法）。
// 这里保存当前这次运行的 AbortController：按钮在运行期切成「停止」，
// 点击 / 按 Esc 都会 abort 掉 fetch，服务端也会在连接关闭时中止模型流。
interface ActiveRun {
  controller: AbortController | null
  /** 是否是用户主动停止（用来区分「超时」与「我按了停止」） */
  cancelled: boolean
}

let activeRun: ActiveRun | null = null

/** 是否有正在进行的优化（供按钮切换停止态、供回归测试断言） */
export function hasActiveOptimize(): boolean {
  return activeRun !== null
}

/** 主动停止当前优化。返回是否真的停掉了一次运行。 */
export function cancelActiveOptimize(): boolean {
  const run = activeRun
  if (!run) return false
  run.cancelled = true
  try {
    run.controller?.abort()
  } catch {
    /* abort 失败不影响后续收尾 */
  }
  return true
}

async function optimizeRequest(
  text: string,
  mode: 'auto' | 'local' = 'auto',
  external?: AbortController | null,
): Promise<{ ok: boolean; text: string; reason?: string; mode?: string; note?: string }> {
  // 优先用外部（可被「停止」按钮 abort 的）controller；拿不到时退回内部超时用的一次性 controller
  const controller = external ?? (typeof AbortController !== 'undefined' ? new AbortController() : null)
  const timer = controller
    ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    : 0
  try {
    const res = await fetch(routeUrl(`${ROUTE}/optimize`), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({ text, mode }),
    })
    if (!res.ok) {
      // 带上状态码，让调用方能给出分档提示（403 跨站 / 413 过长 / 5xx 内部错误）
      const err = new Error(`HTTP ${res.status}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    return (await res.json()) as { ok: boolean; text: string; reason?: string; mode?: string; note?: string }
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

// ─── 技能/引用芯片：识别 → 过滤 → 回填后复原 ───
// DSH composer 是 Lexical 编辑器（@lexical/text 0.49），技能（/name）、文件、会话引用
// 都渲染成 ReferenceChipNode 这个装饰节点：
//   <span data-composer-chip="<source>" contenteditable="false">…标签…</span>
// 它的可见文本是芯片标签，不是用户写的提示词。不处理会有两个后果：
//   ① 读：标签混进正文一起被改写，模型把「/dsh-bundle-plugin」当句子去润色；
//   ② 写：整段覆盖式回填把芯片节点一起抹掉，技能引用直接丢失。
// 所以读时跳过芯片、写后按相对位置把芯片插回去。
const CHIP_ATTR = 'data-composer-chip'

// 供回归测试直接驱动（test-chips.mjs 用最小 DOM 垫片调用）
export const CHIP_SELECTOR = `[${CHIP_ATTR}]`

export interface ChipSnap {
  el: HTMLElement
  source: string
  offset: number
  ratio: number
}

/** 最近一次写入的芯片复原结果，供信标与 toast 使用 */
let lastChipRestore: { total: number; restored: number } = { total: 0, restored: 0 }

/**
 * 等一帧，让 selectionchange 先跑完。
 *
 * 程序化设置 DOM 选区后，浏览器会异步派发 selectionchange。Lexical 靠它把
 * DOM 选区同步进内部 _selection；在那之前调用 execCommand，Lexical 的
 * beforeinput 处理器会发现「DOM 选区 ≠ 内部选区」，判定为异常输入并自行接管，
 * 导致写错位置或写不进去。两个 rAF 比单个 setTimeout(0) 更稳：第一个 rAF 之后
 * selectionchange 已派发，第二个 rAF 保证 Lexical 的同步更新已提交。
 */
export function nextSelectionTick(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const fin = () => { if (!done) { done = true; resolve() } }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(fin))
    }
    // 关键兜底：Chrome 在不可见标签页会完全停发 rAF，只靠它的话这个 Promise
    // 永不 resolve → 写回卡死 → 按钮永久 disabled（点完切走窗口就复现）。
    // 50ms 的定时器保证最坏情况也能收尾；正常路径 rAF 早已先到，这次调用是空操作。
    setTimeout(fin, 50)
  })
}

function isChip(node: Node): node is HTMLElement {
  return node.nodeType === 1 && (node as HTMLElement).hasAttribute(CHIP_ATTR)
}

/**
 * 读出「纯提示词文本」+ 芯片位置快照。芯片内部文本一律不计入。
 * 块级元素之间补换行，与 contenteditable 的视觉行保持一致。
 */
export function readEditorText(el: HTMLElement): { text: string; chips: ChipSnap[] } {  const chips: ChipSnap[] = []
  let buf = ''
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      buf += node.nodeValue ?? ''
      return
    }
    if (node.nodeType !== 1) return
    const e = node as HTMLElement
    if (isChip(e)) {
      chips.push({ el: e, source: e.getAttribute(CHIP_ATTR) ?? '', offset: buf.length, ratio: 0 })
      return
    }
    if (e.tagName === 'BR') {
      buf += '\n'
      return
    }
    const block = /^(P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE)$/.test(e.tagName)
    for (const child of Array.from(e.childNodes)) walk(child)
    if (block && !buf.endsWith('\n')) buf += '\n'
  }
  walk(el)
  const text = buf.replace(/\u200b/g, '')
  const total = text.length || 1
  for (const c of chips) c.ratio = Math.min(1, Math.max(0, c.offset / total))
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), chips }
}

/** 把字符偏移换算成「文本节点 + 节点内偏移」；芯片自身的标签文本不计入。 */
function locateOffset(root: HTMLElement, index: number): { node: Text; offset: number } | null {
  let seen = 0
  const hits: { node: Text; offset: number }[] = []
  const walk = (node: Node): void => {
    if (hits.length > 0) return
    if (node.nodeType === 3) {
      const len = (node.nodeValue ?? '').length
      if (index <= seen + len) {
        hits.push({ node: node as Text, offset: Math.max(0, Math.min(len, index - seen)) })
        return
      }
      seen += len
      return
    }
    if (node.nodeType !== 1) return
    const e = node as HTMLElement
    if (isChip(e)) return
    for (const child of Array.from(e.childNodes)) walk(child)
  }
  walk(root)
  return hits[0] ?? null
}

/**
 * 回填后把芯片按相对位置插回正文。
 * 相对位置（而不是绝对偏移）是因为改写后的文本长度已变，比例位置更稳。
 * @returns 成功插回的芯片数量；插不回去的退化为追加到末尾。
 */
export function restoreChips(el: HTMLElement, chips: ChipSnap[], newLength: number): number {
  if (chips.length === 0) return 0
  let ok = 0
  const ordered = [...chips].sort((a, b) => a.ratio - b.ratio)
  for (const chip of ordered) {
    const target = Math.round(chip.ratio * newLength)
    try {
      const at = locateOffset(el, target)
      if (at) {
        const tail = at.node.splitText(at.offset)
        at.node.parentNode?.insertBefore(chip.el, tail)
      } else {
        el.appendChild(chip.el)
      }
      ok++
    } catch {
      try {
        el.appendChild(chip.el)
        ok++
      } catch {
        /* 芯片已脱离文档，放弃这一个，不能影响主流程 */
      }
    }
  }
  return ok
}

// ─── 编辑器发现：优先官方 data-* 锚点，其次 textarea，最后 contenteditable ───
interface Found {
  el: HTMLElement
  kind: string
  getText: () => string
  /** 读出纯文本 + 引用芯片快照（textarea 没有芯片，恒为空） */
  read: () => { text: string; chips: ChipSnap[] }
  /** 写入；写成功后按快照把芯片插回。异步：需要等 Lexical 同步内部选区 */
  setText: (v: string, chips?: ChipSnap[]) => Promise<boolean>
}

function findComposer(): Found | null {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.height >= 24
  }

  // 1) 官方锚点：data-composer-input / data-composer-seat
  const anchors = [
    '[data-composer-input]',
    '[data-composer-seat] textarea',
    '[data-composer-seat] [contenteditable="true"]',
    'textarea',
    '[contenteditable="true"]',
  ]
  const seen: HTMLElement[] = []
  for (const sel of anchors) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const h = el as HTMLElement
      if (!visible(h)) continue
      if (seen.indexOf(h) !== -1) continue
      seen.push(h)
    }
  }
  if (seen.length === 0) return null

  // 取最高的那个作为主 composer
  const el = seen.reduce((a, b) =>
    b.getBoundingClientRect().height > a.getBoundingClientRect().height ? b : a,
  )

  const tag = el.tagName.toLowerCase()
  if (tag === 'textarea' || tag === 'input') {
    const box = el as HTMLTextAreaElement
    return {
      el,
      kind: tag,
      getText: () => box.value,
      read: () => ({ text: box.value, chips: [] }),
      setText: async (v: string) => {
        const proto = Object.getPrototypeOf(box)
        const desc =
          Object.getOwnPropertyDescriptor(proto, 'value') ||
          Object.getOwnPropertyDescriptor(box, 'value')
        if (desc && desc.set) desc.set.call(box, v)
        else box.value = v
        box.dispatchEvent(new Event('input', { bubbles: true }))
        box.dispatchEvent(new Event('change', { bubbles: true }))
        return box.value === v
      },
    }
  }
  // contenteditable
  return {
    el,
    kind: 'contenteditable',
    // 注意：必须用 readEditorText 而不是 innerText —— innerText 会把技能/文件
    // 引用芯片的标签文本一起读进来，那些标签不属于用户写的提示词。
    getText: () => readEditorText(el).text,
    read: () => readEditorText(el),
    setText: async (v: string, chips: ChipSnap[] = []) => {
      // 0) 写入目标可能是外层 host，真正的编辑元素是它内部的 contenteditable
      const inner = (el.querySelector('[contenteditable="true"]') as HTMLElement | null) || el

      // 1) 先把焦点和选区放回编辑器内部——这是 execCommand 生效的前提。
      //    按钮在编辑器外部，点击会抢走焦点；不 restore 就写不进去。
      const focusTarget = inner.isContentEditable ? inner : el
      focusTarget.focus()

      const sel = window.getSelection()
      const selectAllInside = (node: HTMLElement) => {
        const range = document.createRange()
        range.selectNodeContents(node)
        if (sel) {
          sel.removeAllRanges()
          sel.addRange(range)
        }
      }
      selectAllInside(focusTarget)

      // 2) 关键：等 Lexical 把 DOM 选区同步进它自己的 _selection。
      //    Lexical 在 document 上监听 selectionchange，而 selectionchange 是异步派发的。
      //    设完选区立刻 execCommand 的话，Lexical 的 beforeinput 处理器会拿 DOM 选区
      //    与它内部的旧 _selection 比对，判定「不一致」→ 自己接管这次输入，
      //    结果就是文字写错位置或根本写不进去。
      //    这正是「必须先手动选中文本才生效」的根因：手动选中时 selectionchange 早已同步过。
      //    另一个坑：同步过程中 Lexical 可能反过来把 DOM 选区重置回它内部的旧位置，
      //    所以每轮都复核一次，被重置就再设一次（最多 3 轮），确认稳定后才写入。
      const selectionCovers = () => {
        if (!sel || sel.rangeCount === 0) return false
        if (sel.isCollapsed) return false
        const a = sel.anchorNode
        const f = sel.focusNode
        return !!a && !!f && focusTarget.contains(a) && focusTarget.contains(f)
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        await nextSelectionTick()
        if (selectionCovers()) break
        selectAllInside(focusTarget)
      }

      // 3) execCommand 是 React/ProseMirror/Lexical 等富文本编辑器最兼容的写入方式
      const norm = (s: string) => s.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
      const readBack = () => norm(readEditorText(el).text)
      const tryExec = (): boolean => {
        try {
          return document.execCommand('insertText', false, v)
        } catch {
          return false
        }
      }
      let cmdOk = tryExec()
      let written = readBack() === norm(v)

      // 3.5) 「有时行有时不行」的另一半原因：execCommand 当场成功，但 Lexical 的
      //      reconciler 在下一个微/宏任务里把 DOM 重渲染回旧内容。
      //      所以等一个 tick 再复读；回退了就把选区重设好再写一次（只重试一次）。
      if (written) {
        await nextSelectionTick()
        if (readBack() !== norm(v)) {
          focusTarget.focus()
          selectAllInside(focusTarget)
          await nextSelectionTick()
          cmdOk = tryExec()
          written = readBack() === norm(v)
        }
      }

      // 4) 回读校验：没写进去（或写成了旧值）就退回 DOM 直改 + InputEvent
      if (!cmdOk || !written) {
        // 直改前先把芯片摘下来暂存，否则 textContent 会把它们一起抹掉
        for (const c of chips) if (el.contains(c.el)) c.el.remove()
        focusTarget.textContent = v
        const r2 = document.createRange()
        r2.selectNodeContents(focusTarget)
        r2.collapse(false)
        const s2 = window.getSelection()
        if (s2) {
          s2.removeAllRanges()
          s2.addRange(r2)
        }
        written = readBack() === norm(v)
      }

      // 4) 把引用芯片按相对位置插回正文——技能/文件引用不能因为「优化提示词」而丢失
      const restored = restoreChips(el, chips, v.length)
      lastChipRestore = { total: chips.length, restored }

      // 5) 无论走哪条路，都要通知框架「内容变了」，否则受控组件会把 DOM 改回去
      try {
        focusTarget.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: v }),
        )
      } catch {
        focusTarget.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return written
    },
  }
}

// ─── 找到 composer 旁边那一行「按钮工具栏」（含发送/视频等按钮）───
function findToolbar(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el
  for (let depth = 0; depth < 6 && node; depth++) {
    const parent = node.parentElement
    if (!parent) break
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      if (child.contains(el)) continue // 跳过包含输入框自身的子树
      if (child.querySelectorAll('button').length >= 1) return child
    }
    node = parent
  }
  return null
}

// ─── 找到左侧区域的锚点：优先「模型芯片」（名称 · 数字），其次「完全权限」下拉 ───
// 左侧区域 = [+ 按钮] [完全权限 下拉] [WB CN · NNN 模型芯片] 这一组。
// 从输入框向上回溯，找文本最短的命中节点，把按钮插到它左侧/相邻处，即与左侧区域同组。
function findLeftAnchor(el: HTMLElement): { el: HTMLElement; kind: 'chip' | 'permission' } | null {
  // 模型芯片：分隔符可能是 · ・ • ‧
  const chipRe = /[·・•‧]\s*[\d,]+$/
  // 权限下拉：文案可能是「完全权限」/「Full Access」/「全部权限」
  const permRe = /(完全权限|全部权限|Full Access|All Access)/i
  // 只统计「候选节点个数」，绝不把页面文本回传 —— 页面里可能含用户隐私内容。
  let digitNodes = 0

  const collect = (root: HTMLElement, skipComposer: boolean) => {
    const chips: HTMLElement[] = []
    const perms: HTMLElement[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let cur: Node | null = walker.nextNode()
    while (cur) {
      const e = cur as HTMLElement
      if (skipComposer && e.contains(el)) {
        cur = walker.nextNode()
        continue
      }
      const txt = (e.textContent || '').trim()
      if (txt.length > 0 && txt.length <= 40) {
        if (chipRe.test(txt)) chips.push(e)
        else if (permRe.test(txt)) perms.push(e)
        else if (/\d/.test(txt) && txt.length <= 24) digitNodes += 1
      }
      cur = walker.nextNode()
    }
    return { chips, perms }
  }

  const shortest = (list: HTMLElement[]) =>
    list.sort((a, b) => a.textContent!.trim().length - b.textContent!.trim().length)[0]

  // 第 1 步：沿输入框向上回溯（左侧区域通常在同一子树里）
  let node: HTMLElement | null = el.parentElement
  for (let depth = 0; depth < 8 && node; depth++) {
    const { chips, perms } = collect(node, true)
    if (chips.length) return { el: shortest(chips), kind: 'chip' }
    if (perms.length) return { el: shortest(perms), kind: 'permission' }
    node = node.parentElement
  }

  // 第 2 步：左侧区域不在输入框的祖先子树里（常见）→ 全文档扫描 + 几何最近
  const rect = el.getBoundingClientRect()
  const visible = (e: HTMLElement) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const all = collect(document.body as HTMLElement, true)
  const score = (e: HTMLElement) => {
    const r = e.getBoundingClientRect()
    const dy = Math.abs(r.bottom - rect.bottom)
    const dx = Math.abs(r.left - rect.left)
    return dy * 3 + dx
  }
  const pool = [...all.chips.map((e) => ({ e, kind: 'chip' as const })), ...all.perms.map((e) => ({ e, kind: 'permission' as const }))]
    .filter((x) => visible(x.e))
    .sort((a, b) => score(a.e) - score(b.e))
  if (pool.length) {
    const best = pool[0]
    return { el: best.e, kind: best.kind }
  }
  if (digitNodes > 0) {
    beacon('chip-miss', { digitNodes })
  }
  beacon('left-probe', probeComposer(el))
  return null
}

/** 采集输入框周边 DOM 结构，用于定位左侧区域。只回报标签/类名与计数，绝不回报页面文本。 */
function probeComposer(el: HTMLElement) {
  const label = (e: Element) =>
    `${e.tagName}.${(e.className || '').toString().split(' ')[0] || '-'}`
  const chain: string[] = []
  let node: Element | null = el
  for (let i = 0; i < 8 && node; i++) {
    chain.push(label(node))
    node = node.parentElement
  }
  const kids = (p: Element | null) => {
    if (!p) return []
    return Array.from(p.children).map((c) => label(c))
  }
  const parent = el.parentElement
  const grand = parent ? parent.parentElement : null
  // 统计带中点分隔符的短文本节点个数（模型芯片候选），只报计数不报内容
  let dotCount = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n: Node | null = walker.nextNode()
  while (n) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim()
    if (t && t.length <= 30 && /[·・•‧]/.test(t)) dotCount += 1
    n = walker.nextNode()
  }
  return {
    chain,
    parentKids: kids(parent),
    grandKids: kids(grand),
    dotCount,
  }
}

// ─── 按钮本体：魔法棒图标 + 「优化」两个字 ───
// 两个入口（slot 渲染 / DOM 兜底）共用同一个构造函数，避免出现两套行为。
const BTN_ID = 'po-optimize-btn'

function buildButton(): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.id = BTN_ID
  btn.dataset.poBtn = '1'
  btn.title = '优化提示词（按住 Shift 点击则只做本地规则整理）'
  btn.setAttribute('aria-label', '优化提示词')
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M4 20L13.5 10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M13.5 10.5L16 5L19 8L13.5 10.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M18.5 3v2.5M21.5 6H19M17.5 14.5l.8 2 2.2.8-2.2.8-.8 2-.8-2-2.2-.8 2.2-.8.8-2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>' +
    '<span class="po-btn-label">优化</span>'
  Object.assign(btn.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    height: '24px',
    padding: '0 7px',
    margin: '0',
    borderRadius: '6px',
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--dsw-alias-label-tertiary, #8b949e)',
    cursor: 'pointer',
    flexShrink: '0',
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
    opacity: '0.8',
    transition: 'opacity 0.15s, background 0.15s, color 0.15s',
  } as CSSStyleDeclaration)

  // 关键：按下时不抢焦点。否则点击瞬间编辑器的焦点与选区就丢了，
  // 后续 execCommand('insertText') 无处可写 —— 这正是「必须先手动选中文本才生效」的根因。
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()
  })
  btn.addEventListener('mouseenter', () => {
    btn.style.opacity = '1'
    btn.style.background = 'var(--dsw-alias-fill-hover, rgba(255,255,255,0.08))'
    btn.style.color = 'var(--dsw-alias-state-business-primary, #58a6ff)'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.opacity = '0.8'
    btn.style.background = 'transparent'
    btn.style.color = 'var(--dsw-alias-label-tertiary, #8b949e)'
  })
  btn.addEventListener('click', (e) => {
    // 运行期按钮就是「停止」：同一个按钮两种语义，不额外多塞一个控件
    if (hasActiveOptimize()) {
      cancelActiveOptimize()
      beacon('optimize-cancel', { kind: 'click' })
      return
    }
    void runOptimize(btn, e.shiftKey)
  })
  // Esc 也能停：运行期用户手还留在键盘上，按键比挪鼠标去点更快
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !hasActiveOptimize()) return
    e.preventDefault()
    cancelActiveOptimize()
    beacon('optimize-cancel', { kind: 'esc' })
  })
  return btn
}

/** 运行态 ↔ 空闲态。运行中显示「停止」+ 静止图标，空闲显示「优化」+ 魔法棒。 */
function setButtonRunning(btn: HTMLButtonElement, running: boolean): void {
  const label = btn.querySelector('.po-btn-label') as HTMLElement | null
  const svg = btn.querySelector('svg') as SVGElement | null
  if (label) label.textContent = running ? '停止' : '优化'
  btn.setAttribute('aria-label', running ? '停止优化' : '优化提示词')
  btn.title = running
    ? '正在优化，点击或按 Esc 停止'
    : '优化提示词（按住 Shift 点击则只做本地规则整理）'
  btn.dataset.poRunning = running ? '1' : '0'
  if (svg) {
    if (running) {
      svg.style.transition = 'transform 0.2s'
      svg.style.animation = 'po-spin 0.9s linear infinite'
    } else {
      svg.style.animation = ''
    }
  }
}

/** 优化主流程。composer 在点击时才查找——slot 渲染时机早于输入框挂载。 */
async function runOptimize(btn: HTMLButtonElement, forceLocal: boolean): Promise<void> {
  const found = findComposer()
  if (!found) {
    toast('没找到输入框，请先点一下输入框再试', '#f85149')
    return
  }
  const { el, kind } = found
  // read() 会跳过技能/文件引用芯片，只取用户真正写的提示词
  const snap = found.read()
  const original = snap.text
  const chips = snap.chips
  if (!original.trim()) {
    toast(chips.length > 0 ? '只有引用，没有提示词可优化' : '输入框为空，无需优化', '#f85149')
    return
  }

  // 运行期不能 disabled —— disabled 的按钮收不到 click，用户就没法中途停止。
  // 改用 data-po-running 标记 + 文案切换来表达状态。
  const run: ActiveRun = {
    controller: typeof AbortController !== 'undefined' ? new AbortController() : null,
    cancelled: false,
  }
  activeRun = run
  setButtonRunning(btn, true)
  try {
    const mode: 'auto' | 'local' = forceLocal ? 'local' : 'auto'
    const data = await optimizeRequest(original, mode, run.controller)

    // 并发保护：模型最慢要等 45s，这期间用户很可能已经在同一输入框继续写。
    // 无条件覆盖会把他新打的内容整段冲掉，所以写回前必须重读并比对快照。
    // 比对用 trim 后的纯文本：芯片不计入，光标位置变化也不算改动。
    const latest = found.read().text
    if (latest.trim() !== original.trim()) {
      toast('输入内容已变化，本次优化结果已丢弃', '#d29922')
      beacon('optimize-stale', { kind, len: original.length })
      return
    }

    if (data && data.ok && typeof data.text === 'string') {
      const wrote = await found.setText(data.text, chips)
      const via = data.mode === 'llm' ? '模型优化' : '本地规则'
      const chipNote = chips.length > 0 ? `，保留 ${lastChipRestore.restored}/${chips.length} 个引用` : ''
      if (wrote) {
        const msg = data.note
          ? `已优化并写回（${via}）· ${data.note}`
          : `已优化并写回输入框（${via}）${chipNote}`
        // 撤销：把点击时读到的原文连同芯片快照写回去。
        // 芯片位置按新文本长度的比例重算，可能略有偏移，但内容一定救得回来。
        toast(msg, '#3fb950', {
          label: '撤销',
          run: () => { void found.setText(original, chips) },
        })
      } else {
        toast('已优化，但写回输入框失败', '#d29922')
      }
      beacon('optimized', {
        kind,
        len: data.text.length,
        mode: data.mode ?? 'unknown',
        wrote,
        chips: chips.length,
        chipsRestored: lastChipRestore.restored,
      })
    } else {
      // ok=false 是「无需改动」的正常分支，文案直接取服务端原因
      toast(data?.reason || '无需改动', '#d29922')
    }
  } catch (err) {
    // 错误分档：403/413/404/5xx/超时各有各的原因，糊成一句「接口不可用」没法排障
    const e = err as { name?: string; status?: number }
    if (run.cancelled) {
      // 用户主动停止：不是失败，用中性色提示，且不记 error 信标
      toast('已停止优化，输入内容未改动', '#d29922')
      beacon('optimize-stopped', { kind, len: original.length })
    } else if (e?.name === 'AbortError') {
      toast('优化超时（60s），请稍后重试', '#f85149')
      beacon('optimize-error', { kind, err: 'timeout' })
    } else if (e?.status === 403) {
      toast('本地接口拒绝了跨站请求', '#f85149')
      beacon('optimize-error', { kind, err: 'forbidden' })
    } else if (e?.status === 413) {
      toast('输入过长，请精简后再试', '#f85149')
      beacon('optimize-error', { kind, err: 'too-large' })
    } else if (e?.status === 404) {
      toast('接口不存在，插件可能未正确加载', '#f85149')
      beacon('optimize-error', { kind, err: 'not-found' })
    } else if (typeof e?.status === 'number' && e.status >= 500) {
      toast(`插件内部错误（HTTP ${e.status}）`, '#f85149')
      beacon('optimize-error', { kind, err: 'server' })
    } else {
      toast('优化失败：接口不可用', '#f85149')
      beacon('optimize-error', { kind, err: String(err).slice(0, 64) })
    }
  } finally {
    activeRun = null
    setButtonRunning(btn, false)
  }
}

// ─── 轻提示 ───
// 支持一个可选操作按钮（撤销）。带操作时延长到 5s 并开启 pointer-events，
// 否则用户还没看清就消失了；纯提示仍保持 1.8s 且不拦截鼠标。
type ToastAction = { label: string; run: () => void }
let pendingToastAction: (() => void) | null = null

function hideToast() {
  const t = document.getElementById('po-toast') as HTMLDivElement | null
  if (t) {
    t.style.opacity = '0'
    t.style.pointerEvents = 'none'
  }
  pendingToastAction = null
}

function toast(msg: string, color: string, action?: ToastAction) {
  let t = document.getElementById('po-toast') as HTMLDivElement | null
  if (!t) {
    t = document.createElement('div')
    t.id = 'po-toast'
    // 读屏软件要能播报结果，否则「点一下没反应」对无障碍用户等于静默失败
    t.setAttribute('role', 'status')
    t.setAttribute('aria-live', 'polite')
    Object.assign(t.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 14px',
      borderRadius: '8px',
      // 跟随宿主主题变量：写死 #161b22 在浅色主题下是一块突兀的深色
      background: 'var(--dsw-alias-bg-elevated, #161b22)',
      color: 'var(--dsw-alias-label-primary, #e6edf3)',
      fontSize: '13px',
      zIndex: '2147483647',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      transition: 'opacity 0.2s',
      pointerEvents: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      maxWidth: '78vw',
    } as CSSStyleDeclaration)
    document.body.appendChild(t)
  }
  pendingToastAction = action ? action.run : null
  t.style.pointerEvents = action ? 'auto' : 'none'
  t.innerHTML = ''

  const label = document.createElement('span')
  label.textContent = msg
  t.appendChild(label)

  if (action) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = action.label
    btn.setAttribute('aria-label', action.label)
    Object.assign(btn.style, {
      border: 'none',
      background: 'transparent',
      padding: '0 2px',
      color: 'var(--dsw-alias-state-business-primary, #58a6ff)',
      cursor: 'pointer',
      font: 'inherit',
      textDecoration: 'underline',
      whiteSpace: 'nowrap',
    } as CSSStyleDeclaration)
    btn.addEventListener('click', () => {
      const run = pendingToastAction
      hideToast()
      if (run) run()
    })
    t.appendChild(btn)
  }

  t.style.color = color
  t.style.opacity = '1'
  window.clearTimeout((t as any)._timer)
  ;(t as any)._timer = window.setTimeout(hideToast, action ? 5000 : 1800)
}

// 旋转关键帧（一次性注入全局样式）
function ensureSpinStyle() {
  if (document.getElementById('po-spin-style') !== null) return
  const st = document.createElement('style')
  st.id = 'po-spin-style'
  st.textContent = '@keyframes po-spin { to { transform: rotate(360deg); } }'
  document.head.appendChild(st)
}

// ─── 路径一：slot 渲染（首选，位置由宿主 order 排序决定）───
// 宿主把 `conversation.input.left` 当作列表槽位，按 order 从小到大从左往右排。
// git 分支 chip 用 order=30，这里用 20 —— 稳定落在它左边。
const SLOT_NAME = 'conversation.input.left'
const SLOT_ID = 'dsh-prompt-optimizer-button'
const SLOT_ORDER = 20

type ReactLike = {
  createElement: (type: any, props: any, ...children: any[]) => any
  useRef: <T>(initial: T) => { current: T }
  useEffect: (fn: () => void | (() => void), deps?: any[]) => void
}

function loadReact(): ReactLike | null {
  try {
    const req = typeof require === 'function' ? (require as any) : null
    if (!req) return null
    const mod = req('react')
    const React = mod && (mod.createElement ? mod : mod.default)
    if (!React || typeof React.createElement !== 'function') return null
    if (typeof React.useRef !== 'function' || typeof React.useEffect !== 'function') return null
    return React as ReactLike
  } catch {
    return null
  }
}

/**
 * 注册到宿主 slot。返回是否注册成功。
 * 组件本身只渲染一个空 span 作为挂载点，真正的按钮用原生 DOM 建，
 * 这样「读/写 composer」那套逻辑不需要为了 React 重写一遍。
 */
function registerSlot(ctx: any): boolean {
  const slots = ctx && ctx.slots
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return false
  const React = loadReact()
  if (!React) {
    beacon('slot-no-react')
    return false
  }
  let ok = false
  try {
    slots.inject(SLOT_NAME, () => {
      try {
        return slots.register(
          { name: SLOT_NAME, id: SLOT_ID, order: SLOT_ORDER },
          function OptimizeButton() {
            const ref = React.useRef<any>(null)
            React.useEffect(() => {
              const host = ref.current as HTMLElement | null
              if (!host) return undefined
              ensureSpinStyle()
              // 同一会话里 React 可能重复挂载，先清掉旧节点避免出现两个按钮
              host.innerHTML = ''
              host.appendChild(buildButton())
              beacon('injected', { kind: 'slot', via: 'slot-left', anchorCls: SLOT_NAME })
              return () => {
                host.innerHTML = ''
              }
            }, [])
            return React.createElement('span', {
              ref,
              style: { display: 'inline-flex', alignItems: 'center' },
            })
          },
        )
      } catch (error) {
        beacon('slot-error', { err: String(error) })
        return undefined
      }
    })
    ok = true
  } catch (error) {
    beacon('slot-error', { err: String(error) })
    return false
  }
  beacon('slot-registered', { name: SLOT_NAME, order: SLOT_ORDER })
  return ok
}

// ─── 路径二：DOM 兜底（slot 不可用时才启用）───
function injectComposerButton() {
  let reported = false
  let missCount = 0

  const tryInject = () => {
    const found = findComposer()
    if (!found) {
      missCount += 1
      if (missCount === 1 || missCount === 20) beacon('no-composer', { missCount })
      return false
    }
    const { el, kind } = found
    if (!reported) {
      reported = true
      beacon('found-composer', { kind, tag: el.tagName, cls: el.className })
    }
    // slot 已经渲染过按钮就不再插第二个
    if (document.getElementById(BTN_ID)) return true
    if (el.dataset.poInjected === '1') return true

    ensureSpinStyle()
    const btn = buildButton()

    // 目标位置：优先与左侧区域同组（模型芯片「WB CN · NNN」/「完全权限」左侧），
    // 其次退回右侧图标簇最左端，最后兜底插到输入框下方。
    const left = findLeftAnchor(el)
    let via: string
    let anchorCls: string | null = null
    if (left) {
      via = left.kind === 'chip' ? 'chip-left' : 'perm-left'
      anchorCls = left.el.className
      const anchor = left.el
      const anchorParent = anchor.parentElement
      if (anchorParent) {
        btn.style.marginRight = '6px'
        anchorParent.insertBefore(btn, anchor)
      } else {
        anchor.insertAdjacentElement('beforebegin', btn)
      }
    } else {
      const toolbar = findToolbar(el)
      via = toolbar ? 'toolbar-first' : 'below'
      anchorCls = toolbar ? toolbar.className : null
      if (toolbar) {
        btn.style.marginLeft = '6px'
        toolbar.insertBefore(btn, toolbar.firstChild)
      } else {
        const host = el.parentElement
        if (host) {
          const row = document.createElement('div')
          row.dataset.poRow = '1'
          Object.assign(row.style, {
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '6px',
            marginTop: '4px',
            width: '100%',
          } as CSSStyleDeclaration)
          row.appendChild(btn)
          host.appendChild(row)
        } else {
          el.insertAdjacentElement('afterend', btn)
        }
      }
    }
    el.dataset.poInjected = '1'
    beacon('injected', { kind, via, anchorCls })
    return true
  }

  // 立即尝试 + 持续观察（React 重渲染会重建 DOM，需要重新注入）
  tryInject()
  const observer = new MutationObserver(() => {
    tryInject()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

export function apply(ctx: any) {
  beacon('boot', { href: typeof location !== 'undefined' ? location.href : '' })
  if (typeof document === 'undefined') return
  const start = () => {
    beacon('dom-ready')
    // 首选 slot；拿不到 slots 能力时退回 DOM 注入，两条路都不至于没有按钮。
    if (registerSlot(ctx)) return
    injectComposerButton()
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
}
