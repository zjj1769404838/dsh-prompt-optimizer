# 更新日志

本文件记录 `@zjj/dsh-prompt-optimizer` 的所有重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.7] — 2026-10-30

### 变更

- **包名改为 `@zjj/dsh-prompt-optimizer`**（scoped）。`cordis.patch.yml` 里的 `name` 随之加引号（YAML 中 `@` 开头的标量必须引号包裹）；`export const name`、`/health` 返回的 `plugin` 字段、日志前缀同步更新。
- `engines` 由 `node: ">=18"` 收紧为 `node: ">=20"`，并新增 `engines.dsh: ">=0.2.0-rc.1 <0.3.0-0"`。DSH 加载前只比对 `engines.dsh`（声明了它就不再看 `peerDependencies`），声明缺失或非法 range 会被判为不兼容。
- 新增 `publishConfig.access = "public"`（scoped 包发布 npm 必须显式声明，否则默认按私有处理而失败）、`author`。
- `files` 白名单补 `README.en.md`、`CHANGELOG.md`、`icon.svg`。

### 新增

- `icon.svg`（魔法棒 + 星芒，64×64 圆角渐变底）。
- `README.en.md`（英文说明，供市场与非中文用户阅读）。
- `CHANGELOG.md`（本文件）。
- `scripts/market-index.mjs`：从 `package.json` + `icon.svg` 生成 **format 1** 市场索引到 `docs/market-index.json`，写盘前调用宿主自己的 `parseMarketIndex` 校验（`--check` 只验不写，已接入 `npm test`）。校验器路径可用 `DSH_APP_DIR` / `DSH_MARKET_INDEX_PKG` 覆盖，找不到时降级为 warn 不中断。
- README 中英双语新增「发布到插件市场」章节：索引是 format 1 JSON、用户侧配置 `plugin-market.indexes`、`publishTimestamp` 必须 Unix 秒、兼容性只看 `engines.dsh`。

### 修复

- 移除仓库内 `.tmp-probe/` 目录。该目录是排障期从 DSH 桌面端 `app.asar` 提取的宿主产物（`conversation.js` 773 KB 等），属宿主专有代码，既不能进版本库也不能进发布包；已移至工程外的临时目录，并把 `.tmp-probe/`、`.scratch/`、`package.json.bak-*` 写进 `.gitignore`。
- README 的安装段与「已知的 DSH 契约要点」更新：按钮定位结论从「纯 DOM + MutationObserver」改为「必须走宿主槽位 `conversation.input.left`，DOM 只作兜底」，与实际实现一致。

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
