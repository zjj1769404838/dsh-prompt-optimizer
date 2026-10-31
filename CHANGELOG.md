# 更新日志

本文件记录 `@zjj/dsh-prompt-optimizer` 的所有重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.10] — 2026-11-01

### 修复

- **上下文不再带入平台注入的伪用户消息（乱码根因）**。`user/message` + `append` 里混着宿主自己写进会话的块：运行环境快照（`runtime-context`）、时间快照（`time-context`）、技能目录（`skill-catalog`）、模型选择、回滚替身、记忆系统块、压缩检查点等。真机实测本会话 824 条 `user/message` 中只有 51 条是真人输入，其余 773 条全是注入。0.1.9 按 `type`/`surfaceOp` 取历史，把注入块当「用户历史」喂给模型；模型原样（或改写成「当前项目工作目录…」）抄进产物，再被 1200 字符预算拦腰截断——写回输入框就是乱码。现在按宿主的分类字段 `data.source.kind === 'user'` 做**允许列表**：证明不了是真人打的，一律不进上下文（宿主源码本身就这么判归属：`dsh-api-session-controller:3224` 真人输入带 `source:{kind:'user',rpcId}`）。
- **泄漏兜底 `detectLeak()`**。即使过滤被绕过，产物里出现我们的脚手架标题（`[当前对话的最近几轮…]` / `[当前要优化的提示词]`）或宿主结构标记（`Current runtime context`、`<memory_system>`、`<available_skills>`、`type:state`、`acp tokens=`、本插件路由名等）时，判定本次模型输出不可用，回退本地规则，绝不把宿主内部信息写回输入框。用户输入里本来就含同名词时不误判（那说明文字来自输入本身）。
- **信标抗挤出**。`/beacon` 环形缓冲满时优先淘汰 `boot` / `dom-ready` / `slot-registered` / `injected` 这类启动噪声，保留 `optimized` / `optimize-*` 证据。此前排障就是栽在「用户点击那次的信标被后续硬刷新的启动噪声冲掉」。

### 新增

- **响应与信标带上下文字段**：`diag.ctxTurns`（带入的真人轮数）、`diag.ctxSkipped`（被允许列表挡下的注入块数）、`diag.leak`（泄漏兜底命中的标记）。排障时一眼能看出「上下文取了几条、拦了几条、有没有漏网」，不用再猜。

### 测试

- `scripts/test-context.mjs` 从 35 条扩到 **89 条**：允许列表对真机实测到的全部 14 类注入 kind 逐类断言「拦得下、真人轮保留、计入 skipped」（`runtime-context` / `time-context` / `skill-catalog` / `model-selection` / `dsh-rewind` / `dsh-mnemon` / `user-approval` / `skill-invocation` / `tool-jobs` / `agent-message` / `subagent-settled` / `compact-checkpoint` / `tool-registry` / `memory`）；`source` 缺失的旧格式事件不用为上下文；泄漏回显三类断言各带「确实走了模型路径」前置（防空值恒真）；信标抗挤出 3 条。全量回归：gates + llm-path 4 路径 + hardening 35 + chips 18 + slot 28 + context 89 + market-index 全绿。
- **真机会话直接验证**（不是模拟数据）：逐帧解码另一个工作区的真实会话 `--D-my-projects-games-dnfm-arena--`，900 条 `user/message` + `append` 中真人只有 37 条，其余 863 条为注入；把这份真实事件流喂给插件自己的 handler，`diag` 报 `ctxTurns: 6 / ctxSkipped: 116`，模型请求文本里 **0 种注入 kind 的原文片段**，产物为干净的结构化提示词。取证脚本 `D:/my-projects/.scratch/dspo-probe/probe-real-context.mjs`。

## [0.1.9] — 2026-10-31

### 变更

- **本地规则引擎按场景分流**。此前无论输入什么，产物都是同一套三段模板（`# 任务` / 四条固定 `# 要求` / 一句固定 `# 输出`），写代码和写文案拿到的要求一字不差。现在 `detectScene(raw)` 按输入特征分六类——`code` / `writing` / `analysis` / `translate` / `image` / `general`（匹配顺序即优先级），角色行、约束条目、输出要求各自独立：写代码补「语言/框架/运行环境、可运行实现、边界与失败处理、验证步骤」，写文案补「读者渠道目的、篇幅语气风格、只用已给事实、必现要点与必避表达」，翻译补「源目标语言与读者、术语统一译法、语域与本地化、只输出译文」。
- **模型侧 system prompt 同步分流**。原来只有一份通用的六条规则，代码/写作/分析/翻译共用；现在 `BASE_RULES` 之外按场景追加 `SCENE_FOCUS`（例如 code 侧重「不要臆造不存在的 API」「区分示例与可直接运行的代码」，translate 侧重「术语一致、不擅自增删信息」），场景之间不再互相污染。
- **幂等判据跟着扩到六条角色行**。`isStructuredPrompt` 原先只认通用角色行，分流后另外五类产物会被判成「未结构化」，连点两下就套娃。现在 `ROLE_LINES` 收录全部六条角色行，任一条命中即视为已优化。

### 新增

- **带入当前会话的最近几轮上下文**。优化时只看到输入框里那一段，指代（「那个按钮」「再往左挪一点」）全靠猜。现在客户端通过宿主槽位的 `inject(sessionId)` 拿到当前会话 id 随请求带上，node 半边用 `ctx.get('sessionQuery').readSession(sessionId)` 读该会话历史，取最近 6 轮**用户发言**拼成消歧前缀，system prompt 同时追加三条上下文规则（用上下文补齐指代、不重复或改写已确定前提、不复述上文结论）。生效时响应带 `note: "已带入 N 轮对话上下文"`。
  - 只取 `user/message` 且 `surfaceOp === 'append'`：assistant 回复常含大段代码/表格，既烧 token 又把改写方向带偏；被替换（`replace`）的消息在模型可见面里已遮蔽，拿它当上下文会拿到用户没见过的内容。
  - 总预算 1200 字符、最多 6 轮；单条超预算时截断尾部保留开头（需求通常在前半句）。任何一步失败（服务缺失、读历史抛错、会话不存在）都静默降级为无上下文，不影响优化本身。
  - `sessionId` 只用来读历史，不做鉴权——同源校验已挡住跨站，且读到的历史只回给同一会话的请求方。

### 测试

- 新增 `scripts/test-context.mjs`（35 条断言，已接入 `npm test`）：7 个场景用例各两条（角色行命中 + 不混入其他场景角色行）、7 条幂等（每个场景的产物再点一次都 `ok:false` 且文本不变）、11 条上下文（走了模型路径 / 响应带 note / system 含上下文规则 / 历史轮进 userText / 不含 assistant 长回复 / 排除 replace 消息 / 当前提示词完整保留 / 无 sessionId 不注入 / 读历史抛错降级 / 无 sessionQuery 服务降级）、2 条预算（超长历史被截断到预算内、保留的是最近几轮）。
- 该套件连带暴露一个测试假绿：预算用例原来用 `'继续'` 作输入，两个字符没过 6 字符下限，被「文本过短」提前拒绝，`stream` 根本没被调用 —— 于是「userText ≤ 1400」对空字符串恒真。现改为断言「确实走了模型路径」且 `length > 0`。
- 全量：**gates ok · hardening 35/35 · chips 18/18 · slot 28/28 · context 35/35 · market-index ok**（共 116 条断言）。

## [0.1.8] — 2026-10-30

### 修复

- **等待期间用户新写的内容会被整段覆盖**。模型最慢要等 45 秒，这期间用户很可能已在同一输入框继续打字；原实现拿到结果后无条件 `setText`，把新内容冲掉。现在写回前重读输入框并与点击时的快照比对（`trim` 后纯文本，芯片不计入），不一致就丢弃结果并提示「输入内容已变化，本次优化结果已丢弃」。
- **切走窗口后按钮永久卡在加载态**。`nextSelectionTick` 用双层 `requestAnimationFrame`，而 Chrome 在不可见标签页会完全停发 rAF，Promise 永不 resolve → 写回卡死 → `btn.disabled = true` 再也回不来。现在加 50ms `setTimeout` 兜底，正常路径仍优先 rAF（选区同步语义不变）。
- **模型输出被 token 上限截断后仍写回**。`LLM_MAX_TOKENS = 2048`，长输入改写很容易超；原实现 `collectText` 只看 `text-delta`、丢掉 `finish` 分片，截断的半句被 `sanitize` 后当成品写回，用户会拿着断头提示词去问模型。现在识别 `finishReason ∈ {length, max_tokens, max-tokens, max_output_tokens, content_filter}` 判为失败，回退本地规则引擎。
- **`Origin: null` 被当成「无 Origin」放行**。`null` 是沙箱 iframe、`data:` 页面、部分跨源重定向会发的值，属跨站来源；早期与「非浏览器客户端」归成一类，等于任意被嵌入页面都能 `fetch` 本地 `/optimize` 白嫖模型额度。现在明确拒绝（真正的脚本客户端根本不发这个头）。
- **幂等判据误伤用户自己写的结构化稿**。原判据只要「≥2 个 Markdown 标题 + 命中 ≥2 个段落关键词」，用户写 `## 背景` + `## 输出` 就被判成「已是结构化提示词」直接拒绝润色。阈值提到 3（本插件两条路径的产物都稳定命中 3+）。

### 新增

- **可中途停止**：等待期间同一个按钮从「优化」切成「停止」（魔法棒转成旋转态），点击它或按 **Esc** 即中止本次优化，输入框保持原样。取消不是失败，提示用中性色且不记 `optimize-error` 信标。实现上前后端贯通：客户端 `abort` 掉 `fetch`，服务端监听 `req`/`res` 的 `close` 感知连接断开，随即 `AbortController.abort()` 掐断模型流，**并且不回退本地规则**——用户按了停止却看到输入框被改写，等于取消按钮骗人。运行期刻意不用 `btn.disabled`（disabled 收不到 click，就没法停止），改用 `data-po-running` 标记 + 文案切换表达状态。
- **写回后可撤销**：成功提示带「撤销」按钮（5 秒窗口），点击把点击时读到的原文连同芯片快照写回。此前只能靠编辑器自身的 Ctrl+Z。
- **错误提示分档**：超时（60s）/ 403 跨站 / 413 过长 / 404 接口缺失 / 5xx 内部错误 / 其他，各自独立文案，不再糊成一句「接口不可用」。`optimizeRequest` 的 `Error` 上带 `status` 供调用方判断。
- **toast 无障碍与主题适配**：加 `role="status"` + `aria-live="polite"`（读屏软件能播报结果）；背景/前景改用宿主主题变量 `--dsw-alias-bg-elevated` / `--dsw-alias-label-primary`，浅色主题下不再是突兀的深色块。
- 信标新增 `optimize-stale`（并发丢弃）与 `optimize-error` 的 `forbidden` / `too-large` / `not-found` / `server` 细分原因。

### 测试

- `test-hardening.mjs` 从 26 条加到 35 条：新增 `Origin: null` 拒绝、用户两段结构稿照常优化、截断回退 local、正常 `stop` 仍走 llm 四类断言，以及取消链路的 `连接断开触发中止` / `取消不回退本地规则` / `取消后原文未被改写` / `正常结束不误报取消` 四类断言。垫片补 `once`/`emit` 与 `closeAfterMs`——原垫片的 `res` 没有 `once`，服务端 `res.once('close')` 感知断开的链路在测试里根本不触发，会假绿。
- `test-slot.mjs` 从 21 条加到 28 条：新增 `hasActiveOptimize` / `cancelActiveOptimize` 导出、空闲态分别为 `false`/`false`、按钮绑定 `keydown`（Esc 停止）、初始文案含「优化」、初始不带 `data-po-running`。
- 修掉测试垫片的一个假通过：`makeCtx` 每次 `get('llm')` 都返回新对象，事后覆盖 `stream` 改的是丢弃的副本，导致截断用例读到的仍是默认 stream。改为构造时注入 `streamOverride`。
- 全量：**gates ok · hardening 35/35 · chips 18/18 · slot 28/28 · market-index ok**。

## [0.1.7] — 2026-10-30

### 变更

- **包名改为 `@zjj/dsh-prompt-optimizer`**（scoped）。`cordis.patch.yml` 里的 `name` 随之加引号（YAML 中 `@` 开头的标量必须引号包裹）；`export const name`、`/health` 返回的 `plugin` 字段、日志前缀同步更新。
- `engines` 由 `node: ">=18"` 收紧为 `node: ">=20"`，并新增 `engines.dsh: ">=0.2.0-rc.1 <0.3.0-0"`。DSH 加载前只比对 `engines.dsh`（声明了它就不再看 `peerDependencies`），声明缺失或非法 range 会被判为不兼容。
- 新增 `publishConfig.access = "public"`（scoped 包发布 npm 必须显式声明，否则默认按私有处理而失败）、`author`、`repository`、`homepage`、`bugs`。
- `files` 白名单补 `README.en.md`、`CHANGELOG.md`、`icon.svg`；**不再包含 `docs`**（索引由仓库托管，包内留副本只会漂移）。发布包 11 文件 / 45.0 kB packed。

### 新增

- `icon.svg`（魔法棒 + 星芒，64×64 圆角渐变底）。
- `README.en.md`（英文说明，供市场与非中文用户阅读）。
- `CHANGELOG.md`（本文件）。
- `scripts/market-index.mjs`：从 `package.json` + `icon.svg` 生成 **format 1** 市场索引到 `docs/market-index.json`，写盘前调用宿主自己的 `parseMarketIndex` 校验（`--check` 只验不写，已接入 `npm test`）。校验器路径可用 `DSH_APP_DIR` / `DSH_MARKET_INDEX_PKG` 覆盖，找不到时降级为 warn 不中断。
- README 中英双语新增「发布到插件市场」章节：索引是 format 1 JSON、用户侧配置 `plugin-market.indexes`、`publishTimestamp` 必须 Unix 秒、兼容性只看 `engines.dsh`。
- **市场索引默认走 git 源**：`source: {type:'git', url, commit}`，`commit` 取 `git rev-parse HEAD`，可用 `MARKET_GIT_URL` / `MARKET_GIT_COMMIT` 覆盖；`--npm` 切回 npm 源。本机无 npm 登录态（`npm whoami` → `ENEEDAUTH`）时也能发布。
- 索引托管实测两条路径：GitHub Pages（`https://zjj1769404838.github.io/dsh-prompt-optimizer/market-index.json`，推送后约 10 秒生效）与 jsDelivr（`@main` / `@v0.1.7`，改 tag 后需 `purge.jsdelivr.net` 清缓存）。**raw.githubusercontent.com 有约 5 分钟 CDN 延迟**，不要用它判断发布是否成功。

### 修复

- 移除仓库内 `.tmp-probe/` 目录。该目录是排障期从 DSH 桌面端 `app.asar` 提取的宿主产物（`conversation.js` 773 KB 等），属宿主专有代码，既不能进版本库也不能进发布包；已移至工程外的临时目录，并把 `.tmp-probe/`、`.scratch/`、`package.json.bak-*` 写进 `.gitignore`。
- README 的安装段与「已知的 DSH 契约要点」更新：按钮定位结论从「纯 DOM + MutationObserver」改为「必须走宿主槽位 `conversation.input.left`，DOM 只作兜底」，与实际实现一致。
- `package-lock.json` 重生成：改 `package.json` 的 `name` 后 `npm install --package-lock-only` **不会**同步 lock 里的 `name`/`version`，必须删掉 lock 重装。

## [0.1.6] — 2026-10-29

### 变更

- 按钮定位从「DOM 锚点 + insertBefore」改为注册宿主槽位 `conversation.input.left`（`order: 20`，小于 `dsh-git-panel` 的 `30`，因此稳定排在 Git 分支 chip 左侧）。旧做法依赖模型芯片 / 权限下拉做锚点，而 React 每次重渲染都会重建那一行 DOM，锚点在多个候选之间跳动，位置必然漂移。
- 客户端 `inject` 声明 `['slots']`，`package.json` 的 `dsh.client.inject` 补 `@deepseek-ai/dsh-client-ui-slots`。
- 按钮外观改为「魔法棒 SVG + `优化`」文字（此前只有图标）。
- 构建客户端产物时 `external: ['react']`，避免打进第二份 React 实例导致 slot 渲染崩溃。

### 新增

- `scripts/test-slot.mjs`：21 条断言，用假 `ctx.slots` + 假 React + 最小 DOM 覆盖槽位注册、组件渲染、effect 挂载按钮、清理函数移除按钮、`order` 与 git chip 的相对关系、无 slots 时走 DOM 兜底。

## [0.1.5] — 2026-10-29

### 修复

- 「必须先用鼠标选中文本，点优化才生效」。根因：`setText` 设完 DOM 选区后立刻 `execCommand('insertText')`，而 `selectionchange` 是异步派发的，此时 Lexical 编辑器内部的 `_selection` 仍是旧值；`beforeinput` 处理器比对发现不一致，判定为异常输入并自行接管，导致文字写错位置或写不进去。手动选中之所以有效，是因为选中动作已经触发过 `selectionchange`。
- 修法：新增 `nextSelectionTick()`（两个 `requestAnimationFrame`，无 rAF 环境退化 `setTimeout 0`），在设选区后 `await` 它再写入；`selectionCovers()` 复核选区被 `focus()` 重置就重设（≤3 轮）；写入后等一 tick 复读，被 reconciler 回滚则重试一次，仍失败退 DOM 直改 + `InputEvent`。

## [0.1.4] — 2026-10-29

### 新增

- 技能 / 文件 / 会话引用芯片的读取过滤与写回复原。DSH 输入框是 Lexical 编辑器，引用渲染为 `<span data-composer-chip="<source>" contenteditable="false">`。读时跳过芯片并把其字符偏移记下来，写回后按相对位置插回，避免标签被当作提示词正文改写、也避免整段覆盖把引用抹掉。
- `scripts/test-chips.mjs`：引用芯片的读取、偏移、换行、写回复原共 18 条断言。

## [0.1.3] — 2026-10-29

### 修复

- 请求体超限时不再 `req.destroy()`：连接一旦销毁，后续 413 响应写不出去，客户端只能看到连接被重置。改为先停止累积、让调用方把 413 发完，再在响应 `finish` 后销毁连接。

## [0.1.2] — 2026-10-29

### 修复

- 幂等判据只覆盖本地引擎产出、漏掉模型引擎产出：本地引擎产出 `# 任务` 一级标题，而模型产出 `## 角色` / `## 任务目标` 二级标题，两套格式不重叠，导致模型路径连点两次内容从 531 字符涨到 1618 字符。
- 新判据对两条引擎通用：至少 2 个 Markdown 标题行，且标题里命中 ≥2 个段落关键词（角色/任务/目标/要求/约束/输出/背景/步骤/验收/示例 等）；单标题纯散文不误判。

## [0.1.1] — 2026-10-29

### 新增

- 四项本地接口加固：请求体上限 256 KiB → 413；`POST` 同源校验 → 403；幂等（已是结构化提示词返回 `ok:false / mode:"none"`）；超长输入（>8000 字符）跳过模型直接走本地规则并带 `note`。
- `/beacon` 服务端白名单二次过滤 + 字符串截断 64 字符；`/health` 增加 `version` 字段；响应统一带 `x-content-type-options: nosniff`。
- `scripts/test-hardening.mjs`：26 条断言覆盖上述约束。

## [0.1.0] — 2026-10-27

### 新增

- 首个可用版本：DSH Web 输入框注入「优化」按钮，点击后优先走宿主 `ctx.llm` 改写、失败回退本地规则引擎，结果写回输入框。
- 路由 `/health`、`/optimize`、`/beacon`。
- 按住 Shift 点击可强制走本地引擎。
