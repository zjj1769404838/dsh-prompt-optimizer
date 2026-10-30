// 引用芯片回归：技能/文件引用（data-composer-chip）必须被「读时过滤、写后复原」
//
// 为什么需要这个测试：DSH composer 是 Lexical 编辑器，技能引用渲染成
// <span data-composer-chip="skill" contenteditable="false">…标签…</span>。
// 插件早期用 innerText 读、用 textContent 整段覆盖写，结果是
//   ① 芯片标签被当成提示词一起送去改写；
//   ② 回填把芯片节点抹掉，技能引用直接丢失。
// 这两条都只在真实浏览器里才看得见，所以在 node 里用最小 DOM 垫片把
// readEditorText / restoreChips 的语义钉住。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

// ─── 最小 DOM 垫片：只实现 readEditorText / restoreChips 用到的接口 ───
const TEXT = 3
const ELEMENT = 1

class Txt {
  constructor(value) {
    this.nodeType = TEXT
    this.nodeValue = value
    this.parentNode = null
  }
  get length() {
    return this.nodeValue.length
  }
  splitText(offset) {
    const rest = this.nodeValue.slice(offset)
    this.nodeValue = this.nodeValue.slice(0, offset)
    const tail = new Txt(rest)
    tail.parentNode = this.parentNode
    const idx = this.parentNode.childNodes.indexOf(this)
    this.parentNode.childNodes.splice(idx + 1, 0, tail)
    return tail
  }
}

class El {
  constructor(tagName) {
    this.nodeType = ELEMENT
    this.tagName = tagName.toUpperCase()
    this.childNodes = []
    this.parentNode = null
    this.attrs = new Map()
  }
  hasAttribute(name) {
    return this.attrs.has(name)
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null
  }
  setAttribute(name, value) {
    this.attrs.set(name, value)
  }
  appendChild(child) {
    if (child.parentNode) child.remove()
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }
  insertBefore(child, ref) {
    if (child.parentNode) child.remove()
    child.parentNode = this
    const idx = ref ? this.childNodes.indexOf(ref) : -1
    if (idx < 0) this.childNodes.push(child)
    else this.childNodes.splice(idx, 0, child)
    return child
  }
  remove() {
    if (!this.parentNode) return
    const i = this.parentNode.childNodes.indexOf(this)
    if (i >= 0) this.parentNode.childNodes.splice(i, 1)
    this.parentNode = null
  }
  contains(node) {
    if (node === this) return true
    return this.childNodes.some((c) => (c.nodeType === ELEMENT ? c.contains(node) : c === node))
  }
  get textContent() {
    return this.childNodes.map((c) => (c.nodeType === TEXT ? c.nodeValue : c.textContent)).join('')
  }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null
    this.childNodes = []
    if (v !== '') this.appendChild(new Txt(String(v)))
  }
}

/** 造一个芯片：<span data-composer-chip="skill">@dsh-bundle-plugin</span> */
function chip(source, label) {
  const el = new El('span')
  el.setAttribute('data-composer-chip', source)
  el.setAttribute('contenteditable', 'false')
  el.appendChild(new Txt(label))
  return el
}

// ─── 载入客户端产物（browser bundle 需要 window.__ModuleLoader__ 垫片）──
let client = null
globalThis.window = {
  __ModuleLoader__: {
    load({ factory }) {
      client = factory(() => ({}))
    },
  },
}
const require = createRequire(import.meta.url)
require('../lib/client.js')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
}

if (!client || typeof client.readEditorText !== 'function') {
  console.log('FAIL  客户端产物未导出 readEditorText / restoreChips，无法回归')
  process.exit(1)
}

const { readEditorText, restoreChips } = client

// ─── 用例 1：芯片文本不计入读出的提示词 ───
{
  const root = new El('div')
  root.appendChild(chip('skill', '/dsh-bundle-plugin'))
  root.appendChild(new Txt(' 帮我把这个技能改成通用插件'))
  const { text, chips } = readEditorText(root)
  check('读取/芯片标签不进正文', text === '帮我把这个技能改成通用插件', JSON.stringify(text))
  check('读取/芯片被收集', chips.length === 1 && chips[0].source === 'skill', `n=${chips.length}`)
}

// ─── 用例 2：芯片在句中，前后文本都保留 ───
{
  const root = new El('div')
  const c = chip('file', 'README.md')
  root.appendChild(new Txt('请修改 '))
  root.appendChild(c)
  root.appendChild(new Txt(' 的安装章节'))
  const { text, chips } = readEditorText(root)
  check('读取/句中芯片两侧文本保留', text === '请修改  的安装章节', JSON.stringify(text))
  check('读取/句中芯片 offset 正确', chips[0].offset === '请修改 '.length, `offset=${chips[0].offset}`)
}

// ─── 用例 3：块级元素之间补换行，不粘连 ───
{
  const root = new El('div')
  const p1 = new El('p')
  p1.appendChild(new Txt('第一段'))
  const p2 = new El('p')
  p2.appendChild(new Txt('第二段'))
  root.appendChild(p1)
  root.appendChild(p2)
  const { text } = readEditorText(root)
  check('读取/块级元素换行不粘连', text === '第一段\n第二段', JSON.stringify(text))
}

// ─── 用例 4：零宽字符被剥掉 ───
{
  const root = new El('div')
  root.appendChild(new Txt('优化\u200b提示词'))
  const { text } = readEditorText(root)
  check('读取/剥除零宽字符', text === '优化提示词', JSON.stringify(text))
}

// ─── 用例 5：写回后芯片仍在文档里，且位置按比例保持 ───
{
  const root = new El('div')
  const c = chip('skill', '/dsh-bundle-plugin')
  root.appendChild(c)
  root.appendChild(new Txt('写个爬虫'))
  const { chips } = readEditorText(root)

  // 模拟 setText 的直改路径：先摘下芯片、再整段写新文本
  for (const s of chips) if (root.contains(s.el)) s.el.remove()
  const newText = '你是一位资深工程师。\n\n# 任务\n写一个网页爬虫。'
  root.textContent = newText

  const restored = restoreChips(root, chips, newText.length)
  check('写回/芯片被插回', restored === 1, `restored=${restored}`)
  check('写回/芯片仍在编辑器内', root.contains(c), 'contains=false')
  check('写回/芯片标签没混进正文', !readEditorText(root).text.includes('/dsh-bundle-plugin'),
    JSON.stringify(readEditorText(root).text))

  // 芯片原本在文本最前面（ratio≈0），插回后也应仍在最前
  const flat = []
  const walk = (n) => {
    if (n.nodeType === TEXT) flat.push(n.nodeValue)
    else if (n.hasAttribute && n.hasAttribute('data-composer-chip')) flat.push('[[CHIP]]')
    else n.childNodes.forEach(walk)
  }
  walk(root)
  const order = flat.join('')
  check('写回/芯片保持在前', order.startsWith('[[CHIP]]'), order.slice(0, 40))
}

// ─── 用例 6：没有芯片时是纯文本直写，不报错 ───
{
  const root = new El('div')
  root.appendChild(new Txt('原文'))
  const { chips } = readEditorText(root)
  root.textContent = '新文'
  const restored = restoreChips(root, chips, 2)
  check('无芯片/不插入任何节点', restored === 0 && root.textContent === '新文', `restored=${restored}`)
}

// ─── 用例 7：芯片已脱离文档时不抛异常 ───
{
  const root = new El('div')
  root.appendChild(new Txt('正文'))
  const orphan = chip('skill', '/x')
  const restored = restoreChips(root, [{ el: orphan, source: 'skill', offset: 0, ratio: 0 }], 2)
  check('游离芯片/不抛异常且能插回', restored === 1, `restored=${restored}`)
}

// ─── 用例 8：按钮位置走宿主 slot，而不是 DOM 里挑锚点 ───
// 早期实现靠「找模型芯片 / 工具栏」插 DOM，React 每次重渲染都可能换锚点，
// 表现为「一开始在左边，重新进入又跑到右边」。改为注册 conversation.input.left
// 槽位后位置由宿主按 order 排序决定，不再依赖 DOM 结构。
{
  const src = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  check('定位/客户端声明 slots 能力', src.includes("export const inject: string[] = ['slots']"),
    'inject 未声明 slots')
  check('定位/package.json 声明 ui-slots 依赖',
    (pkg.dsh?.client?.inject ?? []).includes('@deepseek-ai/dsh-client-ui-slots'),
    JSON.stringify(pkg.dsh?.client?.inject))
  check('定位/注册到 conversation.input.left', src.includes("'conversation.input.left'"), '未使用该槽位')
  const gitOrder = 30
  const mine = /const SLOT_ORDER = ([0-9]+)/.exec(src)
  check('定位/order 小于 git chip（30），落在它左边',
    !!mine && Number(mine[1]) < gitOrder, mine ? `SLOT_ORDER=${mine[1]}` : '未定义 SLOT_ORDER')
  check('定位/保留 DOM 兜底', src.includes('injectComposerButton()'), '缺少兜底路径')
  check('按钮/图标加「优化」文字', src.includes('po-btn-label') && src.includes('优化</span>'), '缺少文字标签')
}

const failed = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  ← ${r.detail}`}`)
console.log(`\n[chips] ${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exit(1)
