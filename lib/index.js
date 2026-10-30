// src/index.ts
var name = "@zjj/dsh-prompt-optimizer";
var inject = ["webServer"];
var ROUTE_PREFIX = "/dsh-prompt-optimizer";
var PLUGIN_VERSION = "0.1.7";
var MAX_BODY_BYTES = 256 * 1024;
var LLM_MAX_INPUT_CHARS = 8e3;
var BEACON_KEYS = [
  "stage",
  "build",
  "kind",
  "tag",
  "cls",
  "via",
  "anchorCls",
  "missCount",
  "wrote",
  "mode",
  "len",
  "err",
  "digitNodes",
  "dotCount",
  "note",
  "chips",
  "chipsRestored"
];
var DEFAULT_ROLE = "\u4F60\u662F\u4E00\u4F4D\u8D44\u6DF1\u52A9\u624B\uFF0C\u64C5\u957F\u628A\u6A21\u7CCA\u9700\u6C42\u8F6C\u5316\u4E3A\u6E05\u6670\u3001\u53EF\u6267\u884C\u7684\u6307\u4EE4\u3002";
var DEFAULT_REQ = [
  "- \u5148\u7406\u89E3\u6211\u7684\u771F\u5B9E\u610F\u56FE\uFF0C\u518D\u7ED9\u51FA\u53EF\u843D\u5730\u7684\u7ED3\u679C",
  "- \u8F93\u51FA\u7ED3\u6784\u6E05\u6670\uFF1A\u7ED3\u8BBA\u5148\u884C\uFF0C\u5173\u952E\u6B65\u9AA4\u5206\u70B9\u8BF4\u660E",
  "- \u5982\u6D89\u53CA\u4E0D\u786E\u5B9A\u4FE1\u606F\uFF0C\u660E\u786E\u6807\u6CE8\u800C\u975E\u7F16\u9020",
  "- \u7528\u7B80\u6D01\u7684\u4E2D\u6587\u8868\u8FBE\uFF0C\u907F\u514D\u7A7A\u6D1E\u5957\u8BDD"
];
var DEFAULT_OUT = "\u8BF7\u76F4\u63A5\u7ED9\u51FA\u7ED3\u679C\uFF1B\u5982\u9700\u89E3\u91CA\uFF0C\u9644\u5728\u7ED3\u679C\u4E4B\u540E\u3002";
var SECTION_WORDS = [
  "\u89D2\u8272",
  "\u4EFB\u52A1",
  "\u76EE\u6807",
  "\u8981\u6C42",
  "\u7EA6\u675F",
  "\u8F93\u51FA",
  "\u80CC\u666F",
  "\u6B65\u9AA4",
  "\u9A8C\u6536",
  "\u793A\u4F8B",
  "role",
  "task",
  "goal",
  "requirement",
  "constraint",
  "output",
  "context",
  "step"
];
function isStructuredPrompt(input) {
  const norm = input.replace(/\r\n/g, "\n");
  if (norm.includes(DEFAULT_ROLE) && /^\s*#\s*任务\s*$/m.test(norm)) return true;
  const headings = norm.match(/^\s*#{1,3}\s*(.+)$/gm) ?? [];
  if (headings.length < 2) return false;
  const hit = /* @__PURE__ */ new Set();
  for (const line of headings) {
    const lower = line.toLowerCase();
    for (const word of SECTION_WORDS) {
      if (lower.includes(word)) hit.add(word);
    }
  }
  return hit.size >= 2;
}
function optimizePrompt(raw) {
  const src = raw.trim();
  if (!src) return { ok: false, text: raw, reason: "\u8F93\u5165\u6846\u4E3A\u7A7A\uFF0C\u65E0\u9700\u4F18\u5316" };
  if (src.length < 6) return { ok: false, text: raw, reason: "\u6587\u672C\u8FC7\u77ED\uFF0C\u6682\u4E0D\u9700\u8981\u4F18\u5316" };
  if (isStructuredPrompt(src)) {
    return {
      ok: false,
      text: raw,
      reason: "\u5DF2\u662F\u7ED3\u6784\u5316\u63D0\u793A\u8BCD\uFF0C\u672C\u5730\u89C4\u5219\u4E0D\u518D\u91CD\u590D\u52A0\u5DE5"
    };
  }
  const lines = src.split(/\r?\n/);
  const firstLine = lines[0].trim();
  const out = [];
  let changed = false;
  const hasRole = /你(是|是一位|作为一个)|你是|act as|you are|作为/i.test(firstLine);
  if (!hasRole) {
    out.push(DEFAULT_ROLE);
    changed = true;
  }
  out.push(`# \u4EFB\u52A1`);
  out.push(src);
  changed = true;
  const hasStructure = /(^\s*[\d一二三四1-9][.、)）]|\n\s*[-*·])/m.test(src);
  if (!hasStructure) {
    out.push(``);
    out.push(`# \u8981\u6C42`);
    for (const item of DEFAULT_REQ) out.push(item);
    changed = true;
  }
  const hasFormat = /(以.*格式|输出为|markdown|json|表格|bullet|列表)/i.test(src);
  if (!hasFormat) {
    out.push(``);
    out.push(`# \u8F93\u51FA`);
    out.push(DEFAULT_OUT);
    changed = true;
  }
  const text = out.join("\n");
  return { ok: changed, text, reason: changed ? void 0 : "\u5DF2\u662F\u8F83\u89C4\u8303\u7684\u63D0\u793A\u8BCD\uFF0C\u672A\u505A\u6539\u52A8" };
}
var SYSTEM_PROMPT = [
  "\u4F60\u662F\u4E00\u540D\u63D0\u793A\u8BCD\u5DE5\u7A0B\u4E13\u5BB6\u3002\u7528\u6237\u4F1A\u7ED9\u4F60\u4E00\u6BB5\u60F3\u4EA4\u7ED9 AI \u7684\u539F\u59CB\u9700\u6C42\uFF0C\u4F60\u7684\u552F\u4E00\u4EFB\u52A1\u662F\u628A\u5B83\u6539\u5199\u6210\u4E00\u6761\u66F4\u6E05\u6670\u3001\u66F4\u53EF\u6267\u884C\u3001\u66F4\u5C11\u6B67\u4E49\u7684\u63D0\u793A\u8BCD\u3002",
  "",
  "\u6539\u5199\u89C4\u5219\uFF1A",
  "1. \u4FDD\u7559\u7528\u6237\u7684\u539F\u59CB\u610F\u56FE\u3001\u7EA6\u675F\u6761\u4EF6\u3001\u4E13\u6709\u540D\u8BCD\u3001\u6570\u636E\u4E0E\u4EE3\u7801\uFF0C\u4E0D\u8981\u81C6\u9020\u65B0\u9700\u6C42\u3002",
  "2. \u8865\u9F50\u7F3A\u5931\u7684\u8981\u7D20\uFF1A\u89D2\u8272\u3001\u4EFB\u52A1\u76EE\u6807\u3001\u4E0A\u4E0B\u6587\u3001\u7EA6\u675F\u3001\u671F\u671B\u8F93\u51FA\u5F62\u5F0F\u3002",
  '3. \u6D88\u89E3\u6B67\u4E49\uFF1A\u628A"\u597D\u4E00\u70B9/\u4E30\u5BCC\u4E00\u70B9"\u8FD9\u7C7B\u6A21\u7CCA\u8868\u8FF0\u6539\u5199\u6210\u53EF\u5224\u5B9A\u7684\u5177\u4F53\u8981\u6C42\u3002',
  "4. \u7ED3\u6784\u5316\uFF1A\u7528\u7B80\u77ED\u5C0F\u6807\u9898\u4E0E\u8981\u70B9\u7EC4\u7EC7\uFF0C\u957F\u4EFB\u52A1\u62C6\u6210\u5206\u6B65\u3002",
  "5. \u53EA\u8F93\u51FA\u6539\u5199\u540E\u7684\u63D0\u793A\u8BCD\u6B63\u6587\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u524D\u540E\u52A0\u5F15\u53F7\u3001\u4E0D\u8981\u7528\u4EE3\u7801\u5757\u5305\u88F9\u3002",
  "6. \u82E5\u539F\u63D0\u793A\u8BCD\u5DF2\u7ECF\u8DB3\u591F\u6E05\u6670\uFF0C\u8F93\u51FA\u4F18\u5316\u540E\u7684\u540C\u4E49\u7248\u672C\uFF08\u53EF\u66F4\u7D27\u51D1\uFF09\uFF0C\u4E0D\u8981\u62D2\u7EDD\u56DE\u7B54\u3002"
].join("\n");
var LLM_TIMEOUT_MS = 45e3;
var LLM_MAX_TOKENS = 2048;
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
async function resolveRoute(ctx, llm) {
  try {
    const selection = ctx.get?.("agentDefaultModel")?.currentSelection?.();
    if (selection && isNonEmptyString(selection.provider) && isNonEmptyString(selection.model)) {
      return { provider: selection.provider, model: selection.model };
    }
  } catch {
  }
  try {
    const providers = llm.listProviders?.() ?? [];
    for (const p of providers) {
      const provider = p?.id;
      if (!isNonEmptyString(provider)) continue;
      const models = await llm.listModels?.(provider);
      const first = Array.isArray(models) ? models[0] : void 0;
      if (first && isNonEmptyString(first.id)) {
        return { provider, model: first.id };
      }
    }
  } catch {
  }
  return null;
}
var EFFORT_ORDER = ["minimal", "none", "low", "medium", "high", "max"];
async function lowestEffort(llm, route) {
  try {
    if (typeof llm.resolveModelInfo !== "function") return void 0;
    const info = await Promise.resolve(llm.resolveModelInfo(route.provider, route.model)).catch(() => void 0);
    const efforts = info?.reasoning?.efforts;
    if (!Array.isArray(efforts) || efforts.length === 0) return void 0;
    const ids = efforts.map((e) => isNonEmptyString(e?.id) ? e.id : void 0).filter((x) => typeof x === "string");
    if (ids.length === 0) return void 0;
    const known = ids.filter((id) => EFFORT_ORDER.indexOf(id) !== -1);
    if (known.length > 0) {
      known.sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
      return known[0];
    }
    return ids[0];
  } catch {
    return void 0;
  }
}
async function collectText(chunks) {
  let out = "";
  for await (const c of chunks) {
    if (c && c.type === "text-delta" && typeof c.text === "string") out += c.text;
  }
  return out;
}
function sanitize(text) {
  let t = text.trim();
  t = t.replace(/^(优化后的提示词|改写后的提示词|优化结果|优化后|提示词)[:：]\s*/i, "").trim();
  const fence = /^```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(/^["“”']([\s\S]*)["“”']$/, "$1").trim();
  return t;
}
async function optimizeWithLlm(ctx, raw) {
  let llm;
  try {
    llm = ctx?.get?.("llm");
  } catch {
    return null;
  }
  if (!llm || typeof llm.stream !== "function") return null;
  const route = await resolveRoute(ctx, llm);
  if (!route) return null;
  const effort = await lowestEffort(llm, route);
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(LLM_TIMEOUT_MS) : void 0;
  let stream;
  try {
    stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: raw }] }],
      maxTokens: LLM_MAX_TOKENS,
      temperature: 0.3,
      ...effort ? { reasoningEffort: effort } : {},
      ...signal ? { signal } : {}
    });
  } catch {
    return null;
  }
  try {
    const text = sanitize(await collectText(stream));
    if (!text) return null;
    return { ok: true, text };
  } catch {
    return null;
  }
}
function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // 本地接口不该被任何页面嵌入
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}
var BODY_TOO_LARGE = /* @__PURE__ */ Symbol("body-too-large");
function rejectTooLarge(req, res) {
  sendJson(res, 413, { error: "payload too large", limit: MAX_BODY_BYTES });
  const close = () => {
    try {
      req.destroy?.();
    } catch {
    }
  };
  try {
    res.once("finish", close);
  } catch {
    close();
  }
}
function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      fn();
    };
    const onData = (chunk) => {
      if (done) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        chunks.length = 0;
        try {
          req.pause?.();
        } catch {
        }
        req.removeListener?.("data", onData);
        finish(() => reject(BODY_TOO_LARGE));
        return;
      }
      chunks.push(buf);
    };
    req.on("data", onData);
    req.on("end", () => finish(() => resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", (err) => finish(() => reject(err)));
  });
}
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function splitHostPort(host) {
  const idx = host.lastIndexOf(":");
  if (idx === -1) return { hostname: host.toLowerCase(), port: "" };
  return { hostname: host.slice(0, idx).toLowerCase(), port: host.slice(idx + 1) };
}
function isSameOrigin(req) {
  const headers = req?.headers ?? {};
  const site = headers["sec-fetch-site"];
  if (typeof site === "string" && site.toLowerCase() === "cross-site") return false;
  const origin = headers.origin;
  if (typeof origin !== "string" || origin === "" || origin === "null") return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  const host = typeof headers.host === "string" ? headers.host : "";
  if (!host) return false;
  if (parsed.host === host) return true;
  const a = splitHostPort(parsed.host);
  const b = splitHostPort(host);
  return LOOPBACK_HOSTS.has(a.hostname) && LOOPBACK_HOSTS.has(b.hostname) && a.port === b.port;
}
var beacons = [];
var MAX_BEACONS = 50;
function sanitizeBeacon(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const key of BEACON_KEYS) {
    const value = input[key];
    if (value === void 0 || value === null) continue;
    if (typeof value === "string") out[key] = value.slice(0, 64);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  out.ts = Date.now();
  return out;
}
function createHandler() {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://dsh.internal");
      const path = url.pathname;
      if (!path.startsWith(ROUTE_PREFIX)) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      const route = path.slice(ROUTE_PREFIX.length) || "/";
      const method = req.method ?? "GET";
      if (method === "GET" && route === "/health") {
        sendJson(res, 200, {
          status: "ok",
          plugin: "@zjj/dsh-prompt-optimizer",
          version: PLUGIN_VERSION,
          uptime: process.uptime(),
          engine: "llm-first"
        });
        return;
      }
      if (method === "POST" && !isSameOrigin(req)) {
        sendJson(res, 403, { error: "forbidden", detail: "cross-origin request rejected" });
        return;
      }
      if (method === "POST" && route === "/optimize") {
        let bodyText;
        try {
          bodyText = await readBody(req);
        } catch (err) {
          if (err === BODY_TOO_LARGE) {
            rejectTooLarge(req, res);
            return;
          }
          sendJson(res, 400, { error: "bad request" });
          return;
        }
        let parsed = {};
        try {
          parsed = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          parsed = {};
        }
        const raw = typeof parsed.text === "string" ? parsed.text : "";
        const wantMode = parsed.mode === "local" ? "local" : "auto";
        if (!raw.trim()) {
          sendJson(res, 200, { ok: false, text: raw, reason: "\u8F93\u5165\u6846\u4E3A\u7A7A\uFF0C\u65E0\u9700\u4F18\u5316", mode: "none" });
          return;
        }
        if (raw.trim().length < 6) {
          sendJson(res, 200, { ok: false, text: raw, reason: "\u6587\u672C\u8FC7\u77ED\uFF0C\u6682\u4E0D\u9700\u8981\u4F18\u5316", mode: "none" });
          return;
        }
        if (isStructuredPrompt(raw)) {
          sendJson(res, 200, {
            ok: false,
            text: raw,
            reason: "\u5DF2\u662F\u7ED3\u6784\u5316\u63D0\u793A\u8BCD\uFF0C\u672A\u505A\u6539\u52A8",
            mode: "none"
          });
          return;
        }
        let result = null;
        let mode = "local";
        let note;
        const tooLongForLlm = raw.length > LLM_MAX_INPUT_CHARS;
        if (wantMode !== "local" && tooLongForLlm) {
          note = `\u8F93\u5165\u8D85\u8FC7 ${LLM_MAX_INPUT_CHARS} \u5B57\u7B26\uFF0C\u5DF2\u8DF3\u8FC7\u6A21\u578B\u6539\u5199\u4EE5\u63A7\u5236\u5F00\u9500`;
        }
        if (wantMode !== "local" && !tooLongForLlm) {
          result = await optimizeWithLlm(ctxRef, raw);
          if (result) mode = "llm";
        }
        if (!result) {
          result = optimizePrompt(raw);
          mode = "local";
        }
        sendJson(res, 200, {
          ok: result.ok,
          text: result.text,
          reason: result.reason ?? null,
          mode,
          ...note ? { note } : {}
        });
        return;
      }
      if (route === "/beacon") {
        if (method === "GET") {
          sendJson(res, 200, { count: beacons.length, beacons });
          return;
        }
        if (method === "POST") {
          let bodyText;
          try {
            bodyText = await readBody(req);
          } catch (err) {
            if (err === BODY_TOO_LARGE) {
              rejectTooLarge(req, res);
              return;
            }
            sendJson(res, 400, { error: "bad request" });
            return;
          }
          let parsed = {};
          try {
            parsed = bodyText ? JSON.parse(bodyText) : {};
          } catch {
            parsed = {};
          }
          beacons.push(sanitizeBeacon(parsed));
          if (beacons.length > MAX_BEACONS) beacons.splice(0, beacons.length - MAX_BEACONS);
          sendJson(res, 200, { ok: true });
          return;
        }
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: "internal error", detail: String(err) });
    }
  };
}
var ctxRef = null;
function apply(ctx) {
  ctxRef = ctx;
  const webServer = ctx?.webServer;
  if (webServer === void 0 || typeof webServer.register !== "function") {
    ctx?.logger?.warn?.("[@zjj/dsh-prompt-optimizer] webServer \u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7\u8DEF\u7531\u6CE8\u518C");
    return;
  }
  webServer.register({
    kind: "prefix",
    path: ROUTE_PREFIX,
    handler: createHandler()
  });
  ctx?.logger?.info?.("[@zjj/dsh-prompt-optimizer] \u8DEF\u7531\u5DF2\u6CE8\u518C\uFF08\u5F15\u64CE\uFF1Allm \u4F18\u5148\uFF0C\u89C4\u5219\u56DE\u9000\uFF09");
}
export {
  apply,
  inject,
  name
};
