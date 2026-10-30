# @zjj/dsh-prompt-optimizer

<p><strong>在 DSH Web 输入框旁注入「✨ 优化提示词」按钮：优先复用 DSH 已连接模型（<code>ctx.llm</code>）做语义级改写，不可用时自动回退本地规则引擎。</strong></p>

一个通用插件：不绑定任何项目、业务或内部路径，装到任何 DSH 实例上都只依赖宿主公开的 `webServer` 服务与浏览器 DOM。

## 功能

- 在 DSH Web 主输入框（composer）左侧工具区注入一个「魔法棒图标 + 优化」按钮，注册在宿主槽位 `conversation.input.left` 上（与 Git 分支 chip 同一排，order 更小 → 固定在它左边）。槽位不可用时自动退回 DOM 注入兜底。
- 点击后读取当前输入框文本，调用服务端改写，把模糊需求变成清晰可执行的提示词，并写回输入框。
- **两条引擎**：
  - `llm` —— 走 DSH 宿主已连接的模型（`ctx.llm`），零额外密钥、零额外账号，复用用户自己的模型额度。
  - `local` —— 纯规则引擎（补角色行、拆 `# 任务` / `# 要求` / `# 输出`），不需要任何模型。
- **按住 Shift 点击**可强制走 `local` 引擎（不消耗模型额度、结果可预期）。
- 改写默认补全：角色设定、任务 / 要求 / 输出三段结构、结论先行与避免编造等约束。

## 引擎切换规则

| 情况 | 实际引擎 |
| --- | --- |
| 宿主暴露 `ctx.llm` 且能取到 provider/model | `llm` |
| 宿主无 `ctx.llm`（或取不到路由 / 流式失败 / 结果为空） | `local` |
| 请求带 `mode: "local"` | `local` |

响应体会带 `mode` 字段（`llm` / `local` / `none`），客户端 toast 会显示本次用的是哪种引擎。

## 安装

```sh
# 从 npm 安装（推荐）
dsh plugin --profile desktop add @zjj/dsh-prompt-optimizer

# 或装本地源码目录（开发时用，profile 会以 link: 方式指向它）
dsh plugin --profile desktop add "D:/my-projects/plugins/dsh-prompt-optimizer"

# 或从 git 源
dsh plugin --profile desktop add "github:<owner>/dsh-prompt-optimizer#main"

dsh web
```

> 安装后需**重启 DSH** 才会加载新的 node 半边代码；客户端半边改动需**硬刷新**（Ctrl+Shift+R）。

### 兼容性

`engines.dsh` 声明为 `>=0.2.0-rc.1 <0.3.0-0`：DSH 加载前会用运行时版本比对这条声明（声明了 `engines.dsh` 就只看它，不再看 `peerDependencies`），不匹配时市场会标为不兼容并拒绝安装。

## 开发

```sh
cd D:/my-projects/plugins/dsh-prompt-optimizer
pnpm install             # 或 npm install
pnpm run bundle          # 生成 lib/index.js + lib/client.js
pnpm run gates           # 结构门禁检查（含 package.json 与 PLUGIN_VERSION 一致性）
pnpm run test:llm        # 模拟宿主验证 llm / local / 回退三条路径
pnpm run test:hardening  # 幂等 / 413 / 403 / 信标白名单 / 超长降级 共 26 项断言
pnpm run test:chips      # 引用芯片读取过滤、写回复原、按钮定位 共 18 项断言
pnpm run test:slot       # 宿主槽位注册/渲染/清理 + DOM 兜底 共 21 项断言
pnpm run test:market     # 用宿主校验器校验 docs/market-index.json（不写盘）
pnpm test                # 依次跑 gates + 四个回归 + 市场索引校验
```

- Node 逻辑在 `src/index.ts`：`optimizeWithLlm()`（读 `ctx.get('llm')`、`ctx.get('agentDefaultModel')` 取当前模型、手工拼 `text-delta` 分片）与 `optimizePrompt()`（本地规则回退）。
- 客户端入口在 `src/client/index.ts`：首选 `ctx.slots.inject('conversation.input.left', …)` + `ctx.slots.register({ name, id, order }, Component)`，位置由宿主按 `order` 排序决定（稳定，不随 React 重渲染漂移）；拿不到 `slots` 能力时退回 DOM 注入 + MutationObserver。
- 引用芯片处理在 `src/client/index.ts` 的 `readEditorText()` / `restoreChips()`：DSH 输入框是 Lexical 编辑器，技能（`/name`）、文件、会话引用都渲染成 `<span data-composer-chip="<source>" contenteditable="false">`。读时跳过芯片、写后按相对位置插回，避免标签被当成提示词改写、回填把引用抹掉。

## 发布到插件市场

DSH 插件市场是一份 **format 1 的 JSON 索引**，用户在自己的 profile 里配置这个 JSON 的 URL，不是托管平台。

**当前发布方式：git 源**（本机无 npm 登录态也能发，`dsh` CLI 会直接 `git+https://…git#<commit>` 安装）：

```sh
npm test                      # 全绿后再发
git add -A && git commit      # 先把要发的代码提交（commit 会被写进索引）
npm run market-index          # → docs/market-index.json，source 为 {type:'git', url, commit}
git add docs/market-index.json && git commit && git push
```

索引里 `source.commit` 就是 `git rev-parse HEAD` 的结果，所以**先提交代码、再生成索引、再提交索引**这个顺序不能反。要改发布点可覆盖：

```sh
MARKET_GIT_URL=https://github.com/<owner>/<repo>.git \
MARKET_GIT_COMMIT=<40位sha> npm run market-index
```

**走 npm 源**（需要先 `npm login`）时加 `--npm`：

```sh
npm publish                   # publishConfig.access=public 已写好，scoped 包必须它
npm run market-index -- --npm # source 变成 {type:'npm'}
```

把 `docs/market-index.json` 托管到任意可公网访问的静态地址。实测可用的两种：

- **jsDelivr**（推荐，带 CDN 缓存，按 `@main` 或 `@<tag>` 取）：
  `https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/docs/market-index.json`
- **raw.githubusercontent.com**（**有约 5 分钟 CDN 延迟**，刚推完立刻取会拿到上一版）

用户在 `cordis.patch.yml` 的 `plugin-market.indexes` 里追加该 URL 即可看到。

- `scripts/market-index.mjs` 从 `package.json` + `icon.svg` 生成索引，并在写盘前用宿主自己的 `parseMarketIndex` 校验；校验器路径可用 `DSH_APP_DIR` 或 `DSH_MARKET_INDEX_PKG` 覆盖。
- 索引里的 `publishTimestamp` 必须是 **Unix 秒**（写毫秒会被拒），当前取生成时刻。
- 兼容性只由 `engines.dsh` 决定，见上一节。
- `docs/` 不进 npm 包（`files` 白名单里没有它），索引只从仓库托管；避免包内留一份会漂移的旧副本。

## 架构

见 [docs/plan.md](docs/plan.md)。

## 接口

所有路由挂在 `/dsh-prompt-optimizer` 前缀下：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-prompt-optimizer/health` | 冒烟：`{status, plugin, version, uptime, engine}` |
| POST | `/dsh-prompt-optimizer/optimize` | 改写：入参 `{text, mode?}`，返回 `{ok, text, reason, mode, note?}` |
| GET | `/dsh-prompt-optimizer/beacon` | 排障：取回客户端自报的 DOM 探测记录 |
| POST | `/dsh-prompt-optimizer/beacon` | 排障：客户端上报（内存保留最近 50 条） |

### 接口约束（0.1.1 起）

| 约束 | 行为 |
| --- | --- |
| 请求体上限 | `256 KiB`，超限先停读、回 `413`，响应写完后才销毁连接（0.1.3 起；早期版本直接 `destroy()`，客户端只能看到连接被重置）。防止同机进程用大 body 撑爆宿主内存 |
| 跨站请求 | `POST` 一律校验同源：`Sec-Fetch-Site: cross-site` 或 `Origin` 与 `Host` 不匹配 → `403`；无 `Origin`（非浏览器客户端）放行 |
| 幂等 | 输入已是一条结构化提示词时返回 `ok:false / mode:"none"`，重复点击不会把结构一层层套起来。判据（0.1.2 起）对两条引擎通用：至少 2 个 Markdown 标题行，且标题里命中 ≥2 个段落关键词（角色/任务/目标/要求/约束/输出/背景/步骤/验收/示例 等） |
| 超长输入 | 超过 `8000` 字符跳过模型改写、直接走本地规则，响应带 `note` 说明原因 |
| 信标字段 | 只接受白名单里的结构性键（`stage`/`cls`/`via`/`dotCount` 等），字符串截断 64 字符；任何页面文本一律丢弃 |
| 响应头 | 统一带 `x-content-type-options: nosniff` |
| 引用芯片 | 技能（`/name`）/文件/会话引用在输入框里是 `data-composer-chip` 装饰节点，**不属于提示词正文**：读时跳过、写回后按相对位置复原（0.1.4 起）。只有引用没有正文时按钮直接提示「只有引用，没有提示词可优化」，不发请求 |
| 写回稳定性 | DSH 输入框是 Lexical 编辑器，程序化设完 DOM 选区要**等 `selectionchange` 派发**让内部 `_selection` 同步后才 `execCommand`，否则 Lexical 判定选区不一致会自行接管输入（表现为「必须先手动选中文本才生效」）。写入后再等一个 tick 复读，被 reconciler 重渲染回旧内容则重试一次，仍失败退 DOM 直改（0.1.5 起） |

> `/beacon` 只回报 DOM 结构信息（选择器、类名、定位方式与计数），**不采集用户输入内容**；服务端还会按白名单二次过滤，即使客户端误传文本也不会落库。

## 已知的 DSH 契约要点

- `llm` 是**可选**的注入服务，不要写进 `export const inject`，否则宿主没装模型时插件直接起不来。运行期用 `ctx.get('llm')` 容错读取。
- 第三方插件**不要** `import ... from '@deepseek-ai/dsh-llm'`：该包在 profile 的 node_modules 里不存在，静态 import 会解析失败。请求消息与分片拼装必须手写。
- 请求消息可以用简写形式：`{ role: 'user', content: [{ type: 'text', text }] }`（`RequestUserInput`，不需要 `id` / `source`）。
- 流式结果只累加 `type === 'text-delta'` 的分片。
- 推理强度要显式选**最低档**（DeepSeek 适配器默认 `high`，会把短答案全烧在思考里）。
- 按钮位置**必须**走宿主槽位 `conversation.input.left`；DSH 前端类名是构建期哈希、且 React 重渲染会重建那一行 DOM，任何「找锚点再 insertBefore」的定位方式都必然漂移，只作兜底。

## License

MIT
