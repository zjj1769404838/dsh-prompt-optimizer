# @zjj/dsh-prompt-optimizer 插件计划

> 本插件由 DSH 插件开发助手（dsh-plugin-studio）生成并手工落地。
> 每阶段决策确定后勾选对应项，未通过不得进入下一阶段。

## 阶段 ①：需求捕获

- [x] 插件名：`@zjj/dsh-prompt-optimizer`（0.1.7 起；此前为 `dsh-prompt-optimizer`）
- [x] 一句话目标：在 DSH Web 输入框旁加「优化提示词」按钮，把模糊需求改写成清晰可执行的提示词
- [x] 能力面清单：
  - [x] bundle-client 形态（Node 半端 + 浏览器 client 半端）
  - [x] HTTP 路由（webServer）：`/health` 冒烟、`/optimize` 改写接口、`/beacon` 排障通道
  - [x] 浏览器 DOM 注入（composer 按钮 + MutationObserver 防冲掉）
- [x] 目标 profile：web（桌面端 `desktop` 亦适用）

## 阶段 ②：形态与分发决策

- [x] 形态：`bundle-client`
- [x] 分发方式：npm（`publishConfig.access = public`，scoped 包必须显式声明）/ git 源 / 本地目录（结构均兼容）
- [x] 包管理器：pnpm / npm 皆可（devDeps: esbuild）
- [x] 引擎策略：`ctx.llm` 优先，本地规则回退（保证无模型环境也可用）

## 阶段 ③：配方装配

- [x] `src/index.ts` 已生成（optimizeWithLlm + optimizePrompt + 路由）
- [x] `src/client/index.ts` 已生成（DOM 注入按钮 + 写回）
- [x] `inject` 仅声明 `webServer`（`llm` 为可选服务，运行期 `ctx.get` 容错读取）
- [x] 冒烟功能就绪（/health + 可见按钮）
- [x] 未手改 `lib/`（lib/ 由 build 生成）

## 阶段 ④：本地验证

- [x] `pnpm install` 通过
- [x] `pnpm run bundle` 通过（0.1.1：lib/index.js 14.9kb + lib/client.js 16.3kb）
- [x] `pnpm run gates` 通过（新增 PLUGIN_VERSION ↔ package.json version 一致性校验）
- [x] `pnpm run test:llm` 通过（llm / local / 回退 / 空输入 四路径）
- [x] `pnpm run test:hardening` 通过（19/19：幂等 4 项 + 413 2 项 + 同源 4 项 + 信标 4 项 + 超长 2 项 + health 2 项 + nosniff 1 项）

## 阶段 ⑤：安装与浏览器冒烟

- [x] 安装成功（`dsh plugin --profile desktop add ...`）
- [x] 启动日志无 `plugin tree failed to load`
- [x] 浏览器无 `slot entry crashed`
- [x] 主输入框旁出现「✨ 优化提示词」按钮，点击写回有效（含无选区场景）
- [ ] 在第二个独立 DSH 实例上复验（验证跨环境可移植性）

## 阶段 ⑥：发布

- [ ] git 仓库与 remote 就绪
- [x] README 使用通用安装命令（本地目录 / npm / git 三种写法）
- [x] 构建产物已入库（`files` 字段含 `lib`）
- [x] 市场索引生成与校验脚本（`scripts/market-index.mjs` → `docs/market-index.json`，`npm test` 内 `--check`）
- [ ] npm 发布后从包名重装验证
- [ ] 索引托管到公网 URL，并在用户 profile 的 `plugin-market.indexes` 里验证可见

## 通用性审查结论（2026-10-29）

| 检查项 | 结论 |
| --- | --- |
| 项目/业务耦合 | 无。代码不 import 任何本项目模块，不读项目内文件 |
| 内部路径依赖 | 无。README 中的 `D:/my-projects/...` 仅为示例安装路径 |
| 硬编码类名/选择器 | 无。定位走文本特征（`完全权限`、`· 数字`）与几何关系，不依赖哈希类名 |
| 环境依赖 | 仅 Node ≥18（`AbortSignal.timeout`）与 DSH 公开服务 `webServer` |
| 密钥/账号 | 不需要。`ctx.llm` 复用宿主已连接的模型 |
| 数据外泄 | 无。`/beacon` 只报 DOM 结构，不含用户输入 |
| 发布形态 | `bundle-client`，符合市场主流形态 |

## 0.1.2 幂等判据修复（2026-10-29）

| 问题 | 证据（复现） | 修法 | 文件 |
| --- | --- | --- | --- |
| LLM 路径幂等失效，连点持续膨胀 | 重启后实测：`帮我写个爬虫` → 531 字符；把结果再喂一次 → **1618 字符**（`ok:true, mode:"llm"`）；第三次继续增长 | `isStructuredPrompt()` 判据从「只认本地引擎的角色行 + `^# 任务$`」改为两条路径通用：≥2 个 Markdown 标题行且命中 ≥2 个段落关键词（`SECTION_WORDS`）；本地快速路径保留 | `src/index.ts:34-73` |
| 回归测试只覆盖本地路径，漏掉 LLM 路径 | 原 19 条断言中幂等 4 条全走 `mode:'local'` | 新增 4 条：LLM 上下文首次改写、`## 角色/## 任务目标` 结构被判为已优化、原样返回不膨胀、单标题不误判 | `scripts/test-hardening.mjs:90-104` |

## 0.1.3 413 响应被连接重置吞掉（2026-10-29）

| 问题 | 证据（复现） | 修法 | 文件 |
| --- | --- | --- | --- |
| 超大 body 时客户端拿不到 413，只看到连接被重置 | 重启后实测：`POST /optimize` 带 300 KB body → Python 抛 `http.client.RemoteDisconnected: Remote end closed connection without response`，`status=0` | `readBody` 超限分支**不再 `req.destroy()`**，改为 `req.pause()` + `removeListener('data')` 后 reject；新增 `rejectTooLarge(req, res)`：先 `sendJson(413)`，再在 `res.once('finish')` 里销毁连接 | `src/index.ts:280-310`、`src/index.ts:278-289` |
| 同一缺陷被假 req 掩盖：23 条断言全绿 | 假 req 的 `destroy()` 只置 `req.destroyed = true`、不断 socket，所以「先 destroy 再回 413」照样 PASS | 新增 3 条**走真实 http server + 真实 socket** 的断言：真连接拿到响应而非连接重置、状态码 413、带 `limit`。已做失败验证：把旧写法打回 `lib/index.js` 后这 3 条立刻 `ECONNRESET` 失败（23/26） | `scripts/test-hardening.mjs:169-210` |

**教训**：模拟对象的假实现会把「真实世界必然失败」的写法测成通过。凡是依赖 socket/连接生命周期的行为（断开、超时、半关闭），必须至少有一条走真 socket 的断言。

**为什么原判据会漏**：本地引擎产出 `# 任务` + `DEFAULT_ROLE`，LLM 路径产出 `## 角色` / `## 任务目标` 这类二级标题，两种格式不重叠。原判据 `norm.includes(DEFAULT_ROLE) && /^\s*#\s*任务\s*$/m.test(norm)` 对 LLM 产物恒为 `false`，所以每次点击都被当成全新输入再包一层。

**判据为何不误伤**：要求 ≥2 个标题行 + ≥2 个关键词。用户手写一句 `## 背景` 加一段散文（单标题）不会被判为已优化，仍会正常改写（已加断言）。

## 0.1.1 质量与安全加固（2026-10-29）

| 问题 | 证据（复现） | 修法 | 文件 |
| --- | --- | --- | --- |
| 重复点击导致提示词无限膨胀 | 本地引擎连点 3 次长度 158→190→252，出现嵌套 `# 任务` 与重复 `# 输出` | `isStructuredPrompt()` 识别自家产物（角色行 + `^# 任务$`），`optimizePrompt()` 与 handler 双处早退 | `src/index.ts:38-56`、`src/index.ts:402-412` |
| `/optimize`、`/beacon` 无限缓冲请求体 | POST 8MB → 200 且 heap 增 15.9MB | `MAX_BODY_BYTES = 256 KiB`，超限清空累积、`req.destroy()`、返回 413 | `src/index.ts:15`、`src/index.ts:255-281` |
| 本地接口无同源校验 | 带 `Origin: https://evil.example` + `Sec-Fetch-Site: cross-site` 仍 200，任意网页可白嫖模型额度 | `isSameOrigin()`：拒 `cross-site`、http(s) 比对 host（loopback 按端口），失败 403 | `src/index.ts:283-323`、`src/index.ts:367-370` |
| 信标回传页面文本 | beacon 抓到 `"samples":["记忆199******99"]`，与 README「不采集用户输入」不符 | 客户端去掉文本字段只报计数；服务端 `BEACON_KEYS` 白名单 + 64 字符截断 | `src/index.ts:18-22`、`src/index.ts:330-341`、`src/client/index.ts` |
| 客户端请求无超时 | 模型长时间无响应时按钮永久 loading | `AbortController` + `REQUEST_TIMEOUT_MS = 60000`，超时文案与 beacon `err:'timeout'` | `src/client/index.ts` |
| 超长输入烧 token | 单次点击可把整篇文档送进模型 | `LLM_MAX_INPUT_CHARS = 8000`，超限走本地规则并回 `note` | `src/index.ts:17`、`src/index.ts:418-421` |
| 版本号双源易漂移 | `package.json` 与 `/health` 的版本可能不一致 | 抽出 `PLUGIN_VERSION` 并由 gates 校验两者相等 | `src/index.ts:11`、`scripts/gates/run.mjs` |

## 0.1.4 引用芯片过滤与复原（2026-10-29）

DSH 的输入框是 **Lexical 编辑器**（`@lexical/text` 0.49），技能（`/name`）、文件、会话引用都是 `ReferenceChipNode` 装饰节点，渲染成 `<span data-composer-chip="<source>" contenteditable="false">…标签…</span>`。这个节点的文本投影是 `/name` 形态，**不属于用户写的提示词**。

| 问题 | 证据 | 修法 | 文件 |
| --- | --- | --- | --- |
| 芯片标签被当成提示词一起送去改写 | `getText: () => el.innerText` 把 `<span data-composer-chip>` 内的标签文本读进正文，模型把 `/dsh-bundle-plugin` 当句子去润色 | `readEditorText()` 遍历 DOM 跳过芯片、块级元素补换行、剥 `\u200b`；`Found.read()` 同时返回芯片快照 | `src/client/index.ts` `CHIP_ATTR`/`ChipSnap`/`readEditorText` |
| 回填把引用芯片整段抹掉 | `setText` 走 `focusTarget.textContent = v`，芯片节点随之消失，技能引用丢失 | 直改前把芯片摘下暂存 → 写文本 → `restoreChips()` 按 `offset/textLength` 比例插回（`locateOffset` 换算到文本节点，插不进去退化为 appendChild） | `src/client/index.ts` `locateOffset`/`restoreChips` |
| 只有引用没有正文时仍发请求 | 芯片标签让 `original.trim()` 非空，白跑一次改写 | 点击时先 `read()`：正文为空但有芯片 → 提示「只有引用，没有提示词可优化」，不发请求 | `src/client/index.ts` click handler |
| 芯片是否保住不可观测 | 无控制台环境下无法确认回填后引用还在 | toast 拼「保留 N/M 个引用」；信标加 `chips`/`chipsRestored` 两键（服务端白名单同步） | `src/client/index.ts`、`src/index.ts:19-22` |

**为什么用相对位置而不是绝对偏移**：改写后的文本长度必然变化（本地引擎会加角色行与段落标题，LLM 更是重写整段），绝对偏移会错位；`offset/原文长度` 的比例位置在「长度变了但语义顺序没变」的前提下最稳。极端情况下比例会轻微偏移，但芯片本身不丢——这比精确位置更重要。

**回归测试**：`scripts/test-chips.mjs` 用最小 DOM 垫片（`Txt`/`El` 两个类实现 `splitText`/`insertBefore`/`contains`/`textContent`）直接驱动 `readEditorText`/`restoreChips`，12 条断言覆盖：芯片标签不进正文、芯片被收集、句中芯片两侧文本保留、块级元素换行不粘连、零宽字符剥除、写回后芯片仍在且保持在前、无芯片时纯文本直写、游离芯片不抛异常。

## 0.1.5 写回必须等 Lexical 选区同步（2026-10-29）

用户反馈「输入了文本，直接点击优化有时不行，必须得选中文本才行」。这是**写回路径**的时序缺陷，与 0.1.4 的芯片过滤无关。

| 问题 | 证据 | 修法 | 文件 |
| --- | --- | --- | --- |
| 不选中文本时写回失败或写错位置 | `setText` 用 `range.selectNodeContents()` 设完 DOM 选区后**立刻** `execCommand('insertText')`；`selectionchange` 是异步派发的，此刻 Lexical 内部 `_selection` 仍是旧值 | 新增 `nextSelectionTick()`（两个 `requestAnimationFrame`，无 rAF 环境退化 `setTimeout 0`），在设选区之后、`execCommand` 之前 `await` 它 | `src/client/index.ts:120` `nextSelectionTick`、`:318` |
| 同步过程中 Lexical 可能把 DOM 选区重置回旧位置 | Lexical `focus()` 里 `o.dirty \|\| ol(o.clone())` 会恢复内部 `_selection` 并覆盖 DOM | `selectionCovers()` 复核选区是否仍完整覆盖编辑器内部，被重置就再设一次，最多 3 轮 | `src/client/index.ts` `selectionCovers` |
| `execCommand` 当场成功但下一 tick 被重渲染回旧内容 | Lexical reconciler 在微/宏任务里按内部状态重渲染 DOM | 写入后 `await nextSelectionTick()` 再复读；回退了就重设选区重写一次，仍失败才退 DOM 直改 + `InputEvent` | `src/client/index.ts` `tryExec` / 3.5 段 |
| `setText` 是异步的但调用方没等 | 旧 click handler 写 `const wrote = setText(...)`，拿到的是 Promise（恒真值） | `Found.setText` 返回 `Promise<boolean>`；textarea 与 contenteditable 两个分支都改 `async`；调用方 `await` | `src/client/index.ts:271`、`:292`、click handler |

**为什么「手动选中文本就能行」**：手动选中这个动作本身已经触发过 `selectionchange`，Lexical 的内部选区同步完毕，`beforeinput` 处理器比对通过，于是输入被正常接收。根因与时序有关，与「有没有选中」无关。

**回归**：`npm test` 38/38（gates ok + test:llm 4 路径 + hardening 26 + chips 12）。写回路径依赖真实浏览器与 Lexical 运行时，node 侧无法断言，只能靠 beacon 的 `wrote` 字段与人工点击验证。

## 0.1.6 按钮改走宿主槽位 + 图标带文字（2026-10-29）

用户反馈「优化提示词按钮位置老是加载不对，一开始在添加文件按钮左边，重新进入就回到右边」，要求「参考 git 按钮的做法，放到 git 按钮左边；图标改成图标加优化两个字」。

| 问题 | 证据 | 修法 | 文件 |
| --- | --- | --- | --- |
| 位置不稳定，重新进入就漂移 | 旧实现靠 MutationObserver 找「模型芯片 / 工具栏」再 `insertBefore`；React 每次重渲染都重建那一行 DOM，锚点随之变化，`via` 在 `chip-left` / `toolbar-first` / `below` 之间跳 | 改为注册宿主槽位 `conversation.input.left`（与 `dsh-git-panel` 的 BranchChip 同一个列表槽位），位置由宿主按 `order` 从小到大排序 | `src/client/index.ts` `registerSlot` |
| 与 Git chip 的相对顺序不确定 | Git chip 用 `order: 30` | 本插件用 `order: 20`，稳定排在它左边 | `src/client/index.ts` `SLOT_ORDER` |
| 客户端没有 slots 能力 | `inject` 原为 `[]`，`package.json` 的 `dsh.client.inject` 也是 `[]` | 两边都补上 slots：`export const inject = ['slots']`、`dsh.client.inject = ['@deepseek-ai/dsh-client-ui-slots']` | `src/client/index.ts:8`、`package.json` |
| 只有图标，看不出用途 | 旧按钮只渲染 SVG | 按钮改为「魔法棒图标 + 优化」两段（`po-btn-label`），高度压到 24px、字号 12px 与相邻 chip 对齐 | `src/client/index.ts` `buildButton` |
| 槽位注册失败会没有按钮 | slot 能力缺失或 React 取不到时 | `registerSlot()` 返回 false 就退回原 DOM 注入路径，两条路都保留 | `src/client/index.ts` `apply` |

**为什么 DOM 定位一定会漂**：宿主 composer 是 React 受控结构，输入框、左侧 chips、右侧图标簇都是每次渲染重建的。任何「按类名/文本找锚点再 insertBefore」的方案都只能对上当前这一帧，重渲染后锚点换了位置或换了节点，注入点就跟着变。槽位方案把排序权交给宿主，位置是渲染期决定的常量。

**回归**：`scripts/test-slot.mjs` 用假 `ctx.slots` + 假 React + 最小 DOM 走通注册与渲染两条链路，21 条断言覆盖：注册到 `conversation.input.left`、`id` 带插件名、`order < 30`、组件可渲染、effect 挂载按钮、清理函数移除按钮、按钮含 SVG 与「优化」文字、`mousedown` 阻止默认（不抢焦点）、无 slots 时走 DOM 兜底。`npm test` 累计 65/65。

## 0.1.7 scoped 改名与市场发布准备（2026-10-30）

| 问题 | 证据 | 修法 |
| --- | --- | --- |
| 包名不带 scope，与他人包名易撞 | npm 全局名空间 | 改 `@zjj/dsh-prompt-optimizer`；`cordis.patch.yml` 的 `name` 加引号（`@` 开头 YAML 标量必须引号）；路由前缀保持不变 |
| scoped 包 `npm publish` 必失败 | npm 默认按 restricted 处理 | `publishConfig.access = "public"` |
| 宿主版本漂移后插件被静默跳过 | DSH 加载前比对 `engines.dsh`（有它就不看 `peerDependencies`），空值或非法 range 判为不兼容 | 声明 `engines.dsh = ">=0.2.0-rc.1 <0.3.0-0"`，`node` 收紧到 `>=20` |
| 市场索引手写必错 | `publishTimestamp` 要求 Unix 秒 `[0,1e11)`，`title` 必须含 `en`，`versions[].version` 必须精确 SemVer | 写 `scripts/market-index.mjs` 生成，并用宿主 `parseMarketIndex` 校验；`--check` 接入 `npm test` |
| 宿主专有代码可能随包外泄 | 排障期从 `app.asar` 提取的 `conversation.js` 等 773 KB | 移出工程、`.gitignore` 挡 `.tmp-probe/`、`.scratch/`、`package.json.bak-*`；`npm pack --dry-run` 复核 13 个文件 |

市场不是托管平台：索引是一份 format 1 JSON，用户在自己 profile 的 `plugin-market.indexes` 里配置它的 URL。`dsh` CLI 无 publish / market 子命令。

## 升级路线（后续可选）

- 增加「对比原稿 / 一键回滚」面板。
- 让改写模板与按钮位置可通过 settings-panel 配置。
- 支持多语言 UI 文案（当前仅中文）。
