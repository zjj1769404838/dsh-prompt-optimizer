// slot 注册回归：按钮必须走宿主 `conversation.input.left` 槽位，而不是在 DOM 里挑锚点。
//
// 为什么需要这个测试：早期实现靠 MutationObserver 找「模型芯片 / 工具栏」再 insertBefore。
// React 每次重渲染都会重建那一行 DOM，锚点随之变化，表现为
//   「一开始在添加文件按钮左边，重新进入就跑到右边」。
// 槽位方案把排序交给宿主（按 order 从小到大从左往右），位置就固定了。
//
// 这里用假的 ctx + 假 React + 最小 DOM，把注册与渲染两条链路都走一遍。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
}

// ─── 最小 DOM：只实现 buildButton / ensureSpinStyle 用到的接口 ───
const created = []
class El {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.childNodes = []
    this.parentNode = null
    this.style = {}
    this.dataset = {}
    this.attrs = new Map()
    this.id = ''
    this._innerHTML = ''
    this.listeners = {}
    this.textContent = ''
  }
  // 真实 DOM 里 innerHTML='' 会清空子节点，垫片必须同样处理，
  // 否则「清理后按钮被移除」这类断言测不出问题。
  get innerHTML() {
    return this._innerHTML
  }
  set innerHTML(value) {
    this._innerHTML = value
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes = []
  }
  setAttribute(name, value) {
    this.attrs.set(name, value)
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null
  }
  hasAttribute(name) {
    return this.attrs.has(name)
  }
  addEventListener(type, fn) {
    ;(this.listeners[type] ||= []).push(fn)
  }
  appendChild(child) {
    if (child.parentNode) child.remove()
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }
  remove() {
    if (!this.parentNode) return
    const i = this.parentNode.childNodes.indexOf(this)
    if (i >= 0) this.parentNode.childNodes.splice(i, 1)
    this.parentNode = null
  }
  contains(node) {
    let cur = node
    while (cur) {
      if (cur === this) return true
      cur = cur.parentNode
    }
    return false
  }
  querySelector() {
    return null
  }
  querySelectorAll() {
    return []
  }
  getBoundingClientRect() {
    return { width: 100, height: 30, left: 0, bottom: 0, top: 0, right: 0 }
  }
}

const head = new El('head')
const body = new El('body')
globalThis.document = {
  readyState: 'complete',
  head,
  body,
  baseURI: 'http://dsh.internal/',
  createElement(tag) {
    const el = new El(tag)
    created.push(el)
    return el
  },
  getElementById(id) {
    const walk = (n) => {
      if (n.id === id) return n
      for (const c of n.childNodes) {
        const hit = walk(c)
        if (hit) return hit
      }
      return null
    }
    return walk(head) ?? walk(body)
  },
  querySelectorAll() {
    return []
  },
  addEventListener() {},
}
globalThis.window = { setTimeout, clearTimeout, __ModuleLoader__: null }
globalThis.location = { href: 'http://dsh.internal/' }
// DOM 兜底路径会建 MutationObserver；这里只需要它存在且不抛错。
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}

// ─── 假 React：只实现 createElement / useRef / useEffect ───
// useRef 必须返回同一个对象，否则 effect 里拿到的 ref.current 永远是初始值。
const effects = []
let lastRef = null
const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props: { ...props, children } }
  },
  useRef(initial) {
    lastRef = { current: initial }
    return lastRef
  },
  useEffect(fn) {
    effects.push(fn)
  },
}

// ─── 载入客户端产物，拿到 factory ───
let factory = null
window.__ModuleLoader__ = {
  load({ factory: f }) {
    factory = f
  },
}
require('../lib/client.js')
check('产物/注册到模块加载器', typeof factory === 'function', typeof factory)

const mod = factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require: ${name}`)
})

// ─── 假 ctx.slots：记录注册参数 ───
const registered = []
const ctx = {
  slots: {
    inject(name, cb) {
      check('槽位/inject 到 conversation.input.left', name === 'conversation.input.left', name)
      return cb()
    },
    register(config, Component) {
      registered.push({ config, Component })
      return { dispose() {} }
    },
  },
}

mod.apply(ctx)

check('槽位/已注册一个组件', registered.length === 1, `n=${registered.length}`)
const entry = registered[0]
if (entry) {
  check('槽位/name 正确', entry.config.name === 'conversation.input.left', entry.config.name)
  check('槽位/id 唯一且带插件名', /^dsh-prompt-optimizer/.test(entry.config.id), entry.config.id)
  check('槽位/order 是数字', Number.isFinite(entry.config.order), String(entry.config.order))
  // git 分支 chip 用 order=30；小于它才能落在它左边
  check('槽位/order 小于 30（排在 git chip 左侧）', entry.config.order < 30, String(entry.config.order))
  check('槽位/组件是函数', typeof entry.Component === 'function', typeof entry.Component)

  // 渲染一次，跑 effect，确认按钮真的被建出来并挂到宿主节点上
  const tree = entry.Component({})
  check('渲染/返回挂载点', !!tree && typeof tree === 'object', JSON.stringify(tree && tree.type))
  const host = new El('span')
  effects.length = 0
  entry.Component({}) // 再渲染一次以收集 effect
  if (lastRef) lastRef.current = host // 模拟 React 把 ref 接到 DOM 节点
  check('渲染/注册了 effect', effects.length === 1, `n=${effects.length}`)
  if (effects[0]) {
    const cleanup = effects[0]()
    check('渲染/挂载点拿到按钮', host.childNodes.length === 1, `n=${host.childNodes.length}`)
    check('渲染/effect 返回清理函数', typeof cleanup === 'function', typeof cleanup)
    if (typeof cleanup === 'function') {
      cleanup()
      check('渲染/清理后按钮被移除', host.childNodes.length === 0, `n=${host.childNodes.length}`)
    }
  }
}

// ─── 按钮外观：图标 + 「优化」两个字 ───
const btn = created.find((el) => el.id === 'po-optimize-btn')
check('按钮/已创建', !!btn, btn ? btn.id : 'not found')
if (btn) {
  check('按钮/type=button', btn.type === 'button', btn.type)
  check('按钮/含 svg 图标', btn.innerHTML.includes('<svg'), 'no svg')
  check('按钮/含「优化」文字', btn.innerHTML.includes('优化'), 'no label')
  check('按钮/aria-label', btn.getAttribute('aria-label') === '优化提示词', String(btn.getAttribute('aria-label')))
  check('按钮/mousedown 阻止默认（不抢焦点）', (btn.listeners.mousedown ?? []).length === 1, 'no handler')
  check('按钮/click 已绑定', (btn.listeners.click ?? []).length === 1, 'no handler')
}

// ─── 取消能力：按钮在运行期要能变成「停止」 ───
// 一次优化最长 45s，中途改主意必须有出口。这里钉住三条不变量：
//   ① 客户端导出 hasActiveOptimize / cancelActiveOptimize（状态可查、可停）；
//   ② 按钮上绑了 keydown（Esc 也能停，不用挪鼠标）；
//   ③ 按钮初始文案是「优化」，运行期由 setButtonRunning 切成「停止」。
check('取消/导出 hasActiveOptimize', typeof mod.hasActiveOptimize === 'function', typeof mod.hasActiveOptimize)
check('取消/导出 cancelActiveOptimize', typeof mod.cancelActiveOptimize === 'function', typeof mod.cancelActiveOptimize)
check('取消/空闲时无活动运行', mod.hasActiveOptimize() === false, String(mod.hasActiveOptimize()))
check('取消/空闲时取消返回 false', mod.cancelActiveOptimize() === false, String(mod.cancelActiveOptimize()))
if (btn) {
  check('取消/按钮绑了 keydown（Esc 停止）', (btn.listeners.keydown ?? []).length === 1, 'no handler')
  const label = btn.childNodes.find((n) => (n.attrs?.get('class') ?? '') === 'po-btn-label')
  // innerHTML 建的是字符串，垫片里拿不到子节点；退而校验文案在 html 里且可被 querySelector 替换
  check('取消/按钮初始文案是「优化」', btn.innerHTML.includes('>优化<'), btn.innerHTML.slice(-40))
  check('取消/初始不处于运行态', btn.dataset.poRunning === undefined, String(btn.dataset.poRunning))
  if (label) check('取消/label 节点存在', label.textContent === '优化', label.textContent)
}

// ─── 没有 slots 能力时必须退回 DOM 兜底，而不是静默没有按钮 ───
{
  let fellBack = false
  const spyDocument = globalThis.document
  const origQuery = spyDocument.querySelectorAll
  spyDocument.querySelectorAll = () => {
    fellBack = true
    return []
  }
  effects.length = 0
  const mod2 = factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(name)
  })
  mod2.apply({}) // 空 ctx：没有 slots
  spyDocument.querySelectorAll = origQuery
  check('兜底/无 slots 时走 DOM 注入', fellBack, '未触发 DOM 查找')
}

const failed = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  ← ${r.detail}`}`)
console.log(`\n[slot] ${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exit(1)
