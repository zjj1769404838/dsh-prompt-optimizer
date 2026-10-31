window.__ModuleLoader__.load({ id: "@zjj/dsh-prompt-optimizer", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  CHIP_SELECTOR: () => CHIP_SELECTOR,
  apply: () => apply,
  cancelActiveOptimize: () => cancelActiveOptimize,
  getSessionId: () => getSessionId,
  hasActiveOptimize: () => hasActiveOptimize,
  inject: () => inject,
  nextSelectionTick: () => nextSelectionTick,
  readEditorText: () => readEditorText,
  restoreChips: () => restoreChips
});
module.exports = __toCommonJS(index_exports);
var inject = ["slots"];
var BUILD = "dspo-v13";
var ROUTE = "dsh-prompt-optimizer";
function directoryBase(value) {
  let url;
  try {
    url = new URL(
      value === "" || value === void 0 ? "http://dsh.internal/" : value,
      "http://dsh.internal/"
    );
  } catch {
    url = new URL("http://dsh.internal/");
  }
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url.href;
}
function routeUrl(path) {
  const base = typeof document !== "undefined" && typeof document.baseURI === "string" ? document.baseURI : "";
  return new URL(path.replace(/^\/+/, ""), directoryBase(base)).href;
}
var beaconSent = false;
function beacon(stage, detail = {}) {
  try {
    const payload = JSON.stringify({ stage, build: BUILD, ...detail, ts: Date.now() });
    if (stage === "boot" && beaconSent) return;
    if (stage === "boot") beaconSent = true;
    void fetch(routeUrl(`${ROUTE}/beacon`), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: payload,
      keepalive: true
    }).catch(() => {
    });
  } catch {
  }
}
var REQUEST_TIMEOUT_MS = 6e4;
var activeRun = null;
function hasActiveOptimize() {
  return activeRun !== null;
}
function cancelActiveOptimize() {
  const run = activeRun;
  if (!run) return false;
  run.cancelled = true;
  try {
    run.controller?.abort();
  } catch {
  }
  return true;
}
var currentSessionId = "";
function getSessionId() {
  return currentSessionId;
}
async function optimizeRequest(text, mode = "auto", external) {
  const controller = external ?? (typeof AbortController !== "undefined" ? new AbortController() : null);
  const timer = controller ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0;
  try {
    const res = await fetch(routeUrl(`${ROUTE}/optimize`), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      cache: "no-store",
      signal: controller ? controller.signal : void 0,
      body: JSON.stringify({ text, mode, ...currentSessionId ? { sessionId: currentSessionId } : {} })
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}
var CHIP_ATTR = "data-composer-chip";
var CHIP_SELECTOR = `[${CHIP_ATTR}]`;
var lastChipRestore = { total: 0, restored: 0 };
function nextSelectionTick() {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(fin));
    }
    setTimeout(fin, 50);
  });
}
function isChip(node) {
  return node.nodeType === 1 && node.hasAttribute(CHIP_ATTR);
}
function readEditorText(el) {
  const chips = [];
  let buf = "";
  const walk = (node) => {
    if (node.nodeType === 3) {
      buf += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const e = node;
    if (isChip(e)) {
      chips.push({ el: e, source: e.getAttribute(CHIP_ATTR) ?? "", offset: buf.length, ratio: 0 });
      return;
    }
    if (e.tagName === "BR") {
      buf += "\n";
      return;
    }
    const block = /^(P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE)$/.test(e.tagName);
    for (const child of Array.from(e.childNodes)) walk(child);
    if (block && !buf.endsWith("\n")) buf += "\n";
  };
  walk(el);
  const text = buf.replace(/\u200b/g, "");
  const total = text.length || 1;
  for (const c of chips) c.ratio = Math.min(1, Math.max(0, c.offset / total));
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), chips };
}
function locateOffset(root, index) {
  let seen = 0;
  const hits = [];
  const walk = (node) => {
    if (hits.length > 0) return;
    if (node.nodeType === 3) {
      const len = (node.nodeValue ?? "").length;
      if (index <= seen + len) {
        hits.push({ node, offset: Math.max(0, Math.min(len, index - seen)) });
        return;
      }
      seen += len;
      return;
    }
    if (node.nodeType !== 1) return;
    const e = node;
    if (isChip(e)) return;
    for (const child of Array.from(e.childNodes)) walk(child);
  };
  walk(root);
  return hits[0] ?? null;
}
function restoreChips(el, chips, newLength) {
  if (chips.length === 0) return 0;
  let ok = 0;
  const ordered = [...chips].sort((a, b) => a.ratio - b.ratio);
  for (const chip of ordered) {
    const target = Math.round(chip.ratio * newLength);
    try {
      const at = locateOffset(el, target);
      if (at) {
        const tail = at.node.splitText(at.offset);
        at.node.parentNode?.insertBefore(chip.el, tail);
      } else {
        el.appendChild(chip.el);
      }
      ok++;
    } catch {
      try {
        el.appendChild(chip.el);
        ok++;
      } catch {
      }
    }
  }
  return ok;
}
function findComposer() {
  const visible = (el2) => {
    const r = el2.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.height >= 24;
  };
  const anchors = [
    "[data-composer-input]",
    "[data-composer-seat] textarea",
    '[data-composer-seat] [contenteditable="true"]',
    "textarea",
    '[contenteditable="true"]'
  ];
  const seen = [];
  for (const sel of anchors) {
    for (const el2 of Array.from(document.querySelectorAll(sel))) {
      const h = el2;
      if (!visible(h)) continue;
      if (seen.indexOf(h) !== -1) continue;
      seen.push(h);
    }
  }
  if (seen.length === 0) return null;
  const el = seen.reduce(
    (a, b) => b.getBoundingClientRect().height > a.getBoundingClientRect().height ? b : a
  );
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "input") {
    const box = el;
    return {
      el,
      kind: tag,
      getText: () => box.value,
      read: () => ({ text: box.value, chips: [] }),
      setText: async (v) => {
        const proto = Object.getPrototypeOf(box);
        const desc = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(box, "value");
        if (desc && desc.set) desc.set.call(box, v);
        else box.value = v;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
        return box.value === v;
      }
    };
  }
  return {
    el,
    kind: "contenteditable",
    // 注意：必须用 readEditorText 而不是 innerText —— innerText 会把技能/文件
    // 引用芯片的标签文本一起读进来，那些标签不属于用户写的提示词。
    getText: () => readEditorText(el).text,
    read: () => readEditorText(el),
    setText: async (v, chips = []) => {
      const inner = el.querySelector('[contenteditable="true"]') || el;
      const focusTarget = inner.isContentEditable ? inner : el;
      focusTarget.focus();
      const sel = window.getSelection();
      const selectAllInside = (node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      };
      selectAllInside(focusTarget);
      const selectionCovers = () => {
        if (!sel || sel.rangeCount === 0) return false;
        if (sel.isCollapsed) return false;
        const a = sel.anchorNode;
        const f = sel.focusNode;
        return !!a && !!f && focusTarget.contains(a) && focusTarget.contains(f);
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        await nextSelectionTick();
        if (selectionCovers()) break;
        selectAllInside(focusTarget);
      }
      const norm = (s) => s.replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
      const readBack = () => norm(readEditorText(el).text);
      const tryExec = () => {
        try {
          return document.execCommand("insertText", false, v);
        } catch {
          return false;
        }
      };
      let cmdOk = tryExec();
      let written = readBack() === norm(v);
      if (written) {
        await nextSelectionTick();
        if (readBack() !== norm(v)) {
          focusTarget.focus();
          selectAllInside(focusTarget);
          await nextSelectionTick();
          cmdOk = tryExec();
          written = readBack() === norm(v);
        }
      }
      if (!cmdOk || !written) {
        for (const c of chips) if (el.contains(c.el)) c.el.remove();
        focusTarget.textContent = v;
        const r2 = document.createRange();
        r2.selectNodeContents(focusTarget);
        r2.collapse(false);
        const s2 = window.getSelection();
        if (s2) {
          s2.removeAllRanges();
          s2.addRange(r2);
        }
        written = readBack() === norm(v);
      }
      const restored = restoreChips(el, chips, v.length);
      lastChipRestore = { total: chips.length, restored };
      try {
        focusTarget.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: v })
        );
      } catch {
        focusTarget.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return written;
    }
  };
}
function findToolbar(el) {
  let node = el;
  for (let depth = 0; depth < 6 && node; depth++) {
    const parent = node.parentElement;
    if (!parent) break;
    for (const child of Array.from(parent.children)) {
      if (child.contains(el)) continue;
      if (child.querySelectorAll("button").length >= 1) return child;
    }
    node = parent;
  }
  return null;
}
function findLeftAnchor(el) {
  const chipRe = /[·・•‧]\s*[\d,]+$/;
  const permRe = /(完全权限|全部权限|Full Access|All Access)/i;
  let digitNodes = 0;
  const collect = (root, skipComposer) => {
    const chips = [];
    const perms = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let cur = walker.nextNode();
    while (cur) {
      const e = cur;
      if (skipComposer && e.contains(el)) {
        cur = walker.nextNode();
        continue;
      }
      const txt = (e.textContent || "").trim();
      if (txt.length > 0 && txt.length <= 40) {
        if (chipRe.test(txt)) chips.push(e);
        else if (permRe.test(txt)) perms.push(e);
        else if (/\d/.test(txt) && txt.length <= 24) digitNodes += 1;
      }
      cur = walker.nextNode();
    }
    return { chips, perms };
  };
  const shortest = (list) => list.sort((a, b) => a.textContent.trim().length - b.textContent.trim().length)[0];
  let node = el.parentElement;
  for (let depth = 0; depth < 8 && node; depth++) {
    const { chips, perms } = collect(node, true);
    if (chips.length) return { el: shortest(chips), kind: "chip" };
    if (perms.length) return { el: shortest(perms), kind: "permission" };
    node = node.parentElement;
  }
  const rect = el.getBoundingClientRect();
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const all = collect(document.body, true);
  const score = (e) => {
    const r = e.getBoundingClientRect();
    const dy = Math.abs(r.bottom - rect.bottom);
    const dx = Math.abs(r.left - rect.left);
    return dy * 3 + dx;
  };
  const pool = [...all.chips.map((e) => ({ e, kind: "chip" })), ...all.perms.map((e) => ({ e, kind: "permission" }))].filter((x) => visible(x.e)).sort((a, b) => score(a.e) - score(b.e));
  if (pool.length) {
    const best = pool[0];
    return { el: best.e, kind: best.kind };
  }
  if (digitNodes > 0) {
    beacon("chip-miss", { digitNodes });
  }
  beacon("left-probe", probeComposer(el));
  return null;
}
function probeComposer(el) {
  const label = (e) => `${e.tagName}.${(e.className || "").toString().split(" ")[0] || "-"}`;
  const chain = [];
  let node = el;
  for (let i = 0; i < 8 && node; i++) {
    chain.push(label(node));
    node = node.parentElement;
  }
  const kids = (p) => {
    if (!p) return [];
    return Array.from(p.children).map((c) => label(c));
  };
  const parent = el.parentElement;
  const grand = parent ? parent.parentElement : null;
  let dotCount = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    const t = (n.textContent || "").replace(/\s+/g, " ").trim();
    if (t && t.length <= 30 && /[·・•‧]/.test(t)) dotCount += 1;
    n = walker.nextNode();
  }
  return {
    chain,
    parentKids: kids(parent),
    grandKids: kids(grand),
    dotCount
  };
}
var BTN_ID = "po-optimize-btn";
function buildButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = BTN_ID;
  btn.dataset.poBtn = "1";
  btn.title = "\u4F18\u5316\u63D0\u793A\u8BCD\uFF08\u6309\u4F4F Shift \u70B9\u51FB\u5219\u53EA\u505A\u672C\u5730\u89C4\u5219\u6574\u7406\uFF09";
  btn.setAttribute("aria-label", "\u4F18\u5316\u63D0\u793A\u8BCD");
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20L13.5 10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M13.5 10.5L16 5L19 8L13.5 10.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M18.5 3v2.5M21.5 6H19M17.5 14.5l.8 2 2.2.8-2.2.8-.8 2-.8-2-2.2-.8 2.2-.8.8-2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="po-btn-label">\u4F18\u5316</span>';
  Object.assign(btn.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    height: "24px",
    padding: "0 7px",
    margin: "0",
    borderRadius: "6px",
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--dsw-alias-label-tertiary, #8b949e)",
    cursor: "pointer",
    flexShrink: "0",
    font: "inherit",
    fontSize: "12px",
    lineHeight: "16px",
    whiteSpace: "nowrap",
    opacity: "0.8",
    transition: "opacity 0.15s, background 0.15s, color 0.15s"
  });
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.opacity = "1";
    btn.style.background = "var(--dsw-alias-fill-hover, rgba(255,255,255,0.08))";
    btn.style.color = "var(--dsw-alias-state-business-primary, #58a6ff)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.opacity = "0.8";
    btn.style.background = "transparent";
    btn.style.color = "var(--dsw-alias-label-tertiary, #8b949e)";
  });
  btn.addEventListener("click", (e) => {
    if (hasActiveOptimize()) {
      cancelActiveOptimize();
      beacon("optimize-cancel", { kind: "click" });
      return;
    }
    void runOptimize(btn, e.shiftKey);
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !hasActiveOptimize()) return;
    e.preventDefault();
    cancelActiveOptimize();
    beacon("optimize-cancel", { kind: "esc" });
  });
  return btn;
}
function setButtonRunning(btn, running) {
  const label = btn.querySelector(".po-btn-label");
  const svg = btn.querySelector("svg");
  if (label) label.textContent = running ? "\u505C\u6B62" : "\u4F18\u5316";
  btn.setAttribute("aria-label", running ? "\u505C\u6B62\u4F18\u5316" : "\u4F18\u5316\u63D0\u793A\u8BCD");
  btn.title = running ? "\u6B63\u5728\u4F18\u5316\uFF0C\u70B9\u51FB\u6216\u6309 Esc \u505C\u6B62" : "\u4F18\u5316\u63D0\u793A\u8BCD\uFF08\u6309\u4F4F Shift \u70B9\u51FB\u5219\u53EA\u505A\u672C\u5730\u89C4\u5219\u6574\u7406\uFF09";
  btn.dataset.poRunning = running ? "1" : "0";
  if (svg) {
    if (running) {
      svg.style.transition = "transform 0.2s";
      svg.style.animation = "po-spin 0.9s linear infinite";
    } else {
      svg.style.animation = "";
    }
  }
}
async function runOptimize(btn, forceLocal) {
  const found = findComposer();
  if (!found) {
    toast("\u6CA1\u627E\u5230\u8F93\u5165\u6846\uFF0C\u8BF7\u5148\u70B9\u4E00\u4E0B\u8F93\u5165\u6846\u518D\u8BD5", "#f85149");
    return;
  }
  const { el, kind } = found;
  const snap = found.read();
  const original = snap.text;
  const chips = snap.chips;
  if (!original.trim()) {
    toast(chips.length > 0 ? "\u53EA\u6709\u5F15\u7528\uFF0C\u6CA1\u6709\u63D0\u793A\u8BCD\u53EF\u4F18\u5316" : "\u8F93\u5165\u6846\u4E3A\u7A7A\uFF0C\u65E0\u9700\u4F18\u5316", "#f85149");
    return;
  }
  const run = {
    controller: typeof AbortController !== "undefined" ? new AbortController() : null,
    cancelled: false
  };
  activeRun = run;
  setButtonRunning(btn, true);
  try {
    const mode = forceLocal ? "local" : "auto";
    const data = await optimizeRequest(original, mode, run.controller);
    const latest = found.read().text;
    if (latest.trim() !== original.trim()) {
      toast("\u8F93\u5165\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u672C\u6B21\u4F18\u5316\u7ED3\u679C\u5DF2\u4E22\u5F03", "#d29922");
      beacon("optimize-stale", { kind, len: original.length });
      return;
    }
    if (data && data.ok && typeof data.text === "string") {
      const wrote = await found.setText(data.text, chips);
      const via = data.mode === "llm" ? "\u6A21\u578B\u4F18\u5316" : "\u672C\u5730\u89C4\u5219";
      const chipNote = chips.length > 0 ? `\uFF0C\u4FDD\u7559 ${lastChipRestore.restored}/${chips.length} \u4E2A\u5F15\u7528` : "";
      if (wrote) {
        const msg = data.note ? `\u5DF2\u4F18\u5316\u5E76\u5199\u56DE\uFF08${via}\uFF09\xB7 ${data.note}` : `\u5DF2\u4F18\u5316\u5E76\u5199\u56DE\u8F93\u5165\u6846\uFF08${via}\uFF09${chipNote}`;
        toast(msg, "#3fb950", {
          label: "\u64A4\u9500",
          run: () => {
            void found.setText(original, chips);
          }
        });
      } else {
        toast("\u5DF2\u4F18\u5316\uFF0C\u4F46\u5199\u56DE\u8F93\u5165\u6846\u5931\u8D25", "#d29922");
      }
      beacon("optimized", {
        kind,
        len: data.text.length,
        mode: data.mode ?? "unknown",
        wrote,
        chips: chips.length,
        chipsRestored: lastChipRestore.restored,
        // 乱码排障（0.1.10）：把服务端的结构性计数带进信标。只有数字与标记，没有文本。
        // ctxSkipped > 0 说明平台注入被拦下了；leakGuarded 非空说明泄漏兜底触发并已回退本地规则。
        scene: data.diag?.scene,
        ctxTurns: data.diag?.ctxTurns,
        ctxSkipped: data.diag?.ctxSkipped,
        leakGuarded: data.diag?.leakGuarded
      });
    } else {
      toast(data?.reason || "\u65E0\u9700\u6539\u52A8", "#d29922");
    }
  } catch (err) {
    const e = err;
    if (run.cancelled) {
      toast("\u5DF2\u505C\u6B62\u4F18\u5316\uFF0C\u8F93\u5165\u5185\u5BB9\u672A\u6539\u52A8", "#d29922");
      beacon("optimize-stopped", { kind, len: original.length });
    } else if (e?.name === "AbortError") {
      toast("\u4F18\u5316\u8D85\u65F6\uFF0860s\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", "#f85149");
      beacon("optimize-error", { kind, err: "timeout" });
    } else if (e?.status === 403) {
      toast("\u672C\u5730\u63A5\u53E3\u62D2\u7EDD\u4E86\u8DE8\u7AD9\u8BF7\u6C42", "#f85149");
      beacon("optimize-error", { kind, err: "forbidden" });
    } else if (e?.status === 413) {
      toast("\u8F93\u5165\u8FC7\u957F\uFF0C\u8BF7\u7CBE\u7B80\u540E\u518D\u8BD5", "#f85149");
      beacon("optimize-error", { kind, err: "too-large" });
    } else if (e?.status === 404) {
      toast("\u63A5\u53E3\u4E0D\u5B58\u5728\uFF0C\u63D2\u4EF6\u53EF\u80FD\u672A\u6B63\u786E\u52A0\u8F7D", "#f85149");
      beacon("optimize-error", { kind, err: "not-found" });
    } else if (typeof e?.status === "number" && e.status >= 500) {
      toast(`\u63D2\u4EF6\u5185\u90E8\u9519\u8BEF\uFF08HTTP ${e.status}\uFF09`, "#f85149");
      beacon("optimize-error", { kind, err: "server" });
    } else {
      toast("\u4F18\u5316\u5931\u8D25\uFF1A\u63A5\u53E3\u4E0D\u53EF\u7528", "#f85149");
      beacon("optimize-error", { kind, err: String(err).slice(0, 64) });
    }
  } finally {
    activeRun = null;
    setButtonRunning(btn, false);
  }
}
var pendingToastAction = null;
function hideToast() {
  const t = document.getElementById("po-toast");
  if (t) {
    t.style.opacity = "0";
    t.style.pointerEvents = "none";
  }
  pendingToastAction = null;
}
function toast(msg, color, action) {
  let t = document.getElementById("po-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "po-toast";
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    Object.assign(t.style, {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "8px 14px",
      borderRadius: "8px",
      // 跟随宿主主题变量：写死 #161b22 在浅色主题下是一块突兀的深色
      background: "var(--dsw-alias-bg-elevated, #161b22)",
      color: "var(--dsw-alias-label-primary, #e6edf3)",
      fontSize: "13px",
      zIndex: "2147483647",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      transition: "opacity 0.2s",
      pointerEvents: "none",
      display: "inline-flex",
      alignItems: "center",
      gap: "10px",
      maxWidth: "78vw"
    });
    document.body.appendChild(t);
  }
  pendingToastAction = action ? action.run : null;
  t.style.pointerEvents = action ? "auto" : "none";
  t.innerHTML = "";
  const label = document.createElement("span");
  label.textContent = msg;
  t.appendChild(label);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.setAttribute("aria-label", action.label);
    Object.assign(btn.style, {
      border: "none",
      background: "transparent",
      padding: "0 2px",
      color: "var(--dsw-alias-state-business-primary, #58a6ff)",
      cursor: "pointer",
      font: "inherit",
      textDecoration: "underline",
      whiteSpace: "nowrap"
    });
    btn.addEventListener("click", () => {
      const run = pendingToastAction;
      hideToast();
      if (run) run();
    });
    t.appendChild(btn);
  }
  t.style.color = color;
  t.style.opacity = "1";
  window.clearTimeout(t._timer);
  t._timer = window.setTimeout(hideToast, action ? 5e3 : 1800);
}
function ensureSpinStyle() {
  if (document.getElementById("po-spin-style") !== null) return;
  const st = document.createElement("style");
  st.id = "po-spin-style";
  st.textContent = "@keyframes po-spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(st);
}
var SLOT_NAME = "conversation.input.left";
var SLOT_ID = "dsh-prompt-optimizer-button";
var SLOT_ORDER = 20;
function loadReact() {
  try {
    const req = typeof require === "function" ? require : null;
    if (!req) return null;
    const mod = req("react");
    const React = mod && (mod.createElement ? mod : mod.default);
    if (!React || typeof React.createElement !== "function") return null;
    if (typeof React.useRef !== "function" || typeof React.useEffect !== "function") return null;
    return React;
  } catch {
    return null;
  }
}
function registerSlot(ctx) {
  const slots = ctx && ctx.slots;
  if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") return false;
  const React = loadReact();
  if (!React) {
    beacon("slot-no-react");
    return false;
  }
  let ok = false;
  try {
    slots.inject(SLOT_NAME, () => {
      try {
        return slots.register(
          {
            name: SLOT_NAME,
            id: SLOT_ID,
            order: SLOT_ORDER,
            // 宿主调用 inject(sessionId) 并把返回值（除 hooks 键外）原样并入组件 props。
            // 这样组件就能拿到当前会话身份，POST 时带上去读历史。
            inject: (sessionId) => ({ sessionId: sessionId ?? "" })
          },
          function OptimizeButton(props) {
            const ref = React.useRef(null);
            React.useEffect(() => {
              const sid = typeof props?.sessionId === "string" ? props.sessionId : "";
              if (sid) currentSessionId = sid;
              const host = ref.current;
              if (!host) return void 0;
              ensureSpinStyle();
              host.innerHTML = "";
              host.appendChild(buildButton());
              beacon("injected", {
                kind: "slot",
                via: "slot-left",
                anchorCls: SLOT_NAME,
                // 只上报「有没有拿到会话身份」，不上报 id 本身
                note: sid ? "session-bound" : "session-none"
              });
              return () => {
                host.innerHTML = "";
              };
            }, [props?.sessionId]);
            return React.createElement("span", {
              ref,
              style: { display: "inline-flex", alignItems: "center" }
            });
          }
        );
      } catch (error) {
        beacon("slot-error", { err: String(error) });
        return void 0;
      }
    });
    ok = true;
  } catch (error) {
    beacon("slot-error", { err: String(error) });
    return false;
  }
  beacon("slot-registered", { name: SLOT_NAME, order: SLOT_ORDER });
  return ok;
}
function injectComposerButton() {
  let reported = false;
  let missCount = 0;
  const tryInject = () => {
    const found = findComposer();
    if (!found) {
      missCount += 1;
      if (missCount === 1 || missCount === 20) beacon("no-composer", { missCount });
      return false;
    }
    const { el, kind } = found;
    if (!reported) {
      reported = true;
      beacon("found-composer", { kind, tag: el.tagName, cls: el.className });
    }
    if (document.getElementById(BTN_ID)) return true;
    if (el.dataset.poInjected === "1") return true;
    ensureSpinStyle();
    const btn = buildButton();
    const left = findLeftAnchor(el);
    let via;
    let anchorCls = null;
    if (left) {
      via = left.kind === "chip" ? "chip-left" : "perm-left";
      anchorCls = left.el.className;
      const anchor = left.el;
      const anchorParent = anchor.parentElement;
      if (anchorParent) {
        btn.style.marginRight = "6px";
        anchorParent.insertBefore(btn, anchor);
      } else {
        anchor.insertAdjacentElement("beforebegin", btn);
      }
    } else {
      const toolbar = findToolbar(el);
      via = toolbar ? "toolbar-first" : "below";
      anchorCls = toolbar ? toolbar.className : null;
      if (toolbar) {
        btn.style.marginLeft = "6px";
        toolbar.insertBefore(btn, toolbar.firstChild);
      } else {
        const host = el.parentElement;
        if (host) {
          const row = document.createElement("div");
          row.dataset.poRow = "1";
          Object.assign(row.style, {
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "6px",
            marginTop: "4px",
            width: "100%"
          });
          row.appendChild(btn);
          host.appendChild(row);
        } else {
          el.insertAdjacentElement("afterend", btn);
        }
      }
    }
    el.dataset.poInjected = "1";
    beacon("injected", { kind, via, anchorCls });
    return true;
  };
  tryInject();
  const observer = new MutationObserver(() => {
    tryInject();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
function apply(ctx) {
  beacon("boot", { href: typeof location !== "undefined" ? location.href : "" });
  if (typeof document === "undefined") return;
  const start = () => {
    beacon("dom-ready");
    if (registerSlot(ctx)) return;
    injectComposerButton();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
}
return module.exports; } });
