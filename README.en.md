# @zjj/dsh-prompt-optimizer

<p><strong>Adds an “Optimize” button to the DSH Web composer: one click rewrites a rough request into a structured prompt, using the model DSH is already connected to (<code>ctx.llm</code>), with a local rule-based engine as fallback.</strong></p>

A general-purpose plugin. It binds to no project, business domain or internal path — on any DSH instance it only depends on the host's public `webServer` service and the browser DOM.

## What it does

- Registers a button (wand icon + `优化`) into the host slot `conversation.input.left`, so it sits next to the Git branch chip and is ordered by the host (order `20` < Git panel's `30` → always on its left). Falls back to DOM injection when the slot service is unavailable.
- On click it reads the composer text, calls the server-side rewrite, and writes the result back into the composer.
- **Two engines**
  - `llm` — uses the model DSH is already connected to (`ctx.llm`). No extra key, no extra account.
  - `local` — pure rule engine (adds a role line and `# 任务` / `# 要求` / `# 输出` sections). No model required.
- **Shift+click** forces the `local` engine (no model spend, deterministic output).
- Rewrites add a role line, the three-section task/requirements/output structure, and constraints such as “conclusion first” and “flag uncertainty instead of inventing it”.
- **Stoppable mid-flight**: while a rewrite is running the button turns from “Optimize” into “Stop”; click it or press **Esc** to abort immediately, leaving the composer untouched. The server notices the closed connection and kills the model stream too — and it does **not** fall back to the local engine, because stopping means stopping.
- **Undo after write-back**: the success toast carries an “Undo” action (5 s window) that restores the original text together with its reference chips.
- **Never overwrites what you typed meanwhile**: the model can take up to 45 s; if the composer changed in the meantime the result is discarded and reported, not written.
- **Never writes back a truncated prompt**: when the model hits the token cap the local engine takes over instead of pasting half a sentence.

## Engine selection

| Situation | Engine |
| --- | --- |
| Host exposes `ctx.llm` and a provider/model can be resolved | `llm` |
| No `ctx.llm`, unresolvable route, stream failure, or empty result | `local` |
| Request carries `mode: "local"` | `local` |

The response carries a `mode` field (`llm` / `local` / `none`) and the client toast shows which engine ran.

## Install

```sh
# from npm (recommended)
dsh plugin --profile desktop add @zjj/dsh-prompt-optimizer

# or from a local source checkout (profile links to it)
dsh plugin --profile desktop add "D:/my-projects/plugins/dsh-prompt-optimizer"

# or from git
dsh plugin --profile desktop add "github:<owner>/dsh-prompt-optimizer#main"

dsh web
```

> Restart DSH after installing to load the node half; hard-refresh the browser (Ctrl+Shift+R) for client-half changes.

### Compatibility

`engines.dsh` is `>=0.2.0-rc.1 <0.3.0-0`. DSH compares the runtime version against this declaration before loading (when `engines.dsh` exists it is the only check — `peerDependencies` is ignored). A mismatch marks the plugin incompatible in the market and blocks installation.

## Develop

```sh
cd D:/my-projects/plugins/dsh-prompt-optimizer
pnpm install
pnpm run bundle          # builds lib/index.js + lib/client.js
pnpm run gates           # structural gate (also checks package.json version == PLUGIN_VERSION)
pnpm run test:llm        # simulates the host: llm / local / fallback paths
pnpm run test:hardening  # idempotency, 413, 403 (incl. Origin null), beacon allow-list, over-length downgrade, truncation fallback, cancel on disconnect (35 assertions)
pnpm run test:chips      # reference-chip read filtering, restore, button placement (18 assertions)
pnpm run test:slot       # host slot registration/render/cleanup, cancel exports + DOM fallback (28 assertions)
pnpm run test:market     # validate docs/market-index.json with the host validator (no write)
pnpm test                # gates + the four regression suites + market index check
```

- Node logic lives in `src/index.ts`: `optimizeWithLlm()` (reads `ctx.get('llm')` and `ctx.get('agentDefaultModel')`, assembles `text-delta` chunks by hand) and `optimizePrompt()` (local rule fallback).
- Client entry lives in `src/client/index.ts`: prefers `ctx.slots.inject('conversation.input.left', …)` + `ctx.slots.register({ name, id, order }, Component)`; the host sorts by `order`, so the position is stable across React re-renders. DOM injection + `MutationObserver` is only a fallback.
- Reference chips are handled by `readEditorText()` / `restoreChips()`: the DSH composer is a Lexical editor and skill (`/name`) / file / session references render as `<span data-composer-chip="<source>" contenteditable="false">`. Reads skip chips and writes re-insert them by relative offset, so labels are never rewritten as prompt text and references are not wiped on write-back.

## Publishing to the plugin market

The DSH plugin market is a **format 1 JSON index**, not a hosting platform: users point their profile at the index URL.

**Current route: git source** (works without an npm login; the `dsh` CLI installs straight from `git+https://…git#<commit>`):

```sh
npm test                      # green first
git add -A && git commit      # commit the code to ship — this commit goes into the index
npm run market-index          # → docs/market-index.json with source {type:'git', url, commit}
git add docs/market-index.json && git commit && git push
```

`source.commit` is `git rev-parse HEAD`, so the order **commit code → generate index → commit index** cannot be reversed. Override the target with:

```sh
MARKET_GIT_URL=https://github.com/<owner>/<repo>.git \
MARKET_GIT_COMMIT=<40-char sha> npm run market-index
```

**npm route** (needs `npm login` first) — pass `--npm`:

```sh
npm publish                   # publishConfig.access=public is already set (required for scoped packages)
npm run market-index -- --npm # source becomes {type:'npm'}
```

Host `docs/market-index.json` anywhere publicly reachable. Two verified options:

- **jsDelivr** (recommended, CDN-cached, addressable by `@main` or `@<tag>`):
  `https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/docs/market-index.json`
- **raw.githubusercontent.com** (**~5 min CDN lag** — a fetch right after pushing returns the previous version)

Then add that URL to `plugin-market.indexes` in the user's `cordis.patch.yml`.

- `scripts/market-index.mjs` builds the index from `package.json` + `icon.svg` and validates it with the host's own `parseMarketIndex` before writing. Override the validator path with `DSH_APP_DIR` or `DSH_MARKET_INDEX_PKG`.
- `publishTimestamp` must be **Unix seconds** (milliseconds are rejected). It currently uses generation time.
- Compatibility is decided solely by `engines.dsh` (see above).
- `docs/` is not published to npm (absent from the `files` whitelist): the index is hosted from the repo only, so no drifting stale copy ships inside the tarball.

## Architecture

See [docs/plan.md](docs/plan.md).

## HTTP API

All routes live under `/dsh-prompt-optimizer`:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/dsh-prompt-optimizer/health` | Smoke check: `{status, plugin, version, uptime, engine}` |
| POST | `/dsh-prompt-optimizer/optimize` | Rewrite: `{text, mode?}` → `{ok, text, reason, mode, note?}` |
| GET | `/dsh-prompt-optimizer/beacon` | Diagnostics: returns client-reported DOM probe records |
| POST | `/dsh-prompt-optimizer/beacon` | Diagnostics: client report (last 50 kept in memory) |

### Interface constraints

| Constraint | Behaviour |
| --- | --- |
| Body size | `256 KiB`; over-limit stops reading, replies `413`, and destroys the connection only after the response is flushed. Prevents a same-machine process from exhausting host memory with a huge body |
| Cross-origin | Every `POST` is origin-checked: `Sec-Fetch-Site: cross-site`, or `Origin` not matching `Host` → `403`; no `Origin` (non-browser client) is allowed; **`Origin: null` is rejected** (since 0.1.8 — it is what sandboxed iframes, `data:` pages and some cross-origin redirects send) |
| Idempotency | Input that already is a structured prompt returns `ok:false / mode:"none"` so repeated clicks do not nest structures. The predicate covers both engines: at least 2 Markdown headings, and **≥3** section keywords among them (role / task / goal / requirement / constraint / output / context / step / acceptance / example …). The threshold is 3 so a user's own two-section draft (`## Background` + `## Output`) is still optimised |
| Truncation guard | When the stream finishes with `length` / `max_tokens` / `max_output_tokens` / `content_filter`, the rewrite is treated as failed and falls back to the local engine. A half-sentence is never written back into the composer (since 0.1.8) |
| Over-length | Input over `8000` characters skips the model and uses the local engine; the response carries a `note` explaining why |
| Beacon fields | Only structural keys from an allow-list (`stage` / `cls` / `via` / `dotCount` …), strings truncated to 64 chars. Any page text is dropped |
| Response headers | Always `x-content-type-options: nosniff` |
| Reference chips | Skill (`/name`) / file / session references are `data-composer-chip` decorator nodes, not prompt text: skipped on read, restored by relative offset on write. When there is only a reference and no body text, the button says “只有引用，没有提示词可优化” and sends no request |
| Write-back stability | The composer is a Lexical editor: after setting the DOM selection programmatically you must wait for `selectionchange` so Lexical's internal `_selection` syncs before calling `execCommand`, otherwise Lexical decides the selection is inconsistent and takes over the input (symptom: “you have to select text first”). After writing, wait a tick and read back; retry once if a re-render reverted it, then fall back to direct DOM write. The wait is `rAF×2` **plus a 50 ms `setTimeout` backstop** — hidden tabs stop firing rAF entirely, and relying on rAF alone leaves the button permanently disabled (since 0.1.8) |
| Concurrent rewrite | Before writing back, the composer is re-read and compared with the snapshot taken at click time (trimmed text; chips excluded). On mismatch the result is discarded with a “content changed” notice, so work typed during the wait is never clobbered (since 0.1.8) |

> `/beacon` reports DOM structure only (selectors, class names, placement mode, counts) — never user input. The server re-filters through the allow-list, so even a mistaken client report cannot persist page text.

## DSH contract notes

- `llm` is an **optional** injected service. Do not put it in `export const inject`, or the plugin fails to start on a host without a model. Read it defensively at runtime via `ctx.get('llm')`.
- Third-party plugins must **not** `import ... from '@deepseek-ai/dsh-llm'`: that package is absent from the profile's `node_modules` and a static import fails to resolve. Build request messages and assemble chunks by hand.
- Request messages accept the shorthand form `{ role: 'user', content: [{ type: 'text', text }] }` (no `id` / `source` needed).
- Only accumulate chunks with `type === 'text-delta'`.
- Pick the **lowest** reasoning effort explicitly (the DeepSeek adapter defaults to `high` and burns short answers on thinking).
- Button placement **must** go through the host slot `conversation.input.left`. DSH's front-end class names are build-time hashes and React rebuilds that row on every render, so any “find an anchor, then insertBefore” approach drifts; keep it as fallback only.

## License

MIT
