// src/index.ts
var name = "@zjj/dsh-prompt-optimizer";
var inject = ["webServer"];
var ROUTE_PREFIX = "/dsh-prompt-optimizer";
var PLUGIN_VERSION = "0.1.9";
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
var SCENE_MATCHERS = [
  // 代码优先：技术需求里常夹「写」「说明」这类词，先判技术再判写作，避免被写作规则吃掉。
  // 「爬虫/抓取/数据库/服务端」这类词必须在内：实测「帮我写个爬虫」曾被判成写作场景，
  // 因为「写个」命中了写作正则而技术词表里没有「爬虫」。
  {
    scene: "code",
    re: /(代码|函数|报错|异常|编译|脚本|接口|依赖|单测|测试用例|重构|正则|sql|html|css|react|vue|python|java|typescript|node|json|yaml|git|部署|性能|bug|debug|api|爬虫|抓取|爬取|数据库|服务端|客户端|算法|中间件|微服务|docker|nginx|redis|mysql|shell|bash|命令行)/i
  },
  { scene: "translate", re: /(翻译|译成|英译|中译|笔译|translate|locali[sz]e|i18n)/i },
  {
    scene: "image",
    re: /(画(一|个|张|幅|成|出)|绘制|插画|海报|配图|出图|生图|文生图|logo|icon|svg|构图|配色|midjourney|stable diffusion|seedream|即梦|dall-?e)/i
  },
  {
    scene: "writing",
    re: /(写一|写个|写份|文案|文章|故事|小说|脚本|标题|邮件|回复|润色|改写|语气|风格|小红书|公众号|周报|总结|readme|readme)/i
  },
  {
    scene: "analysis",
    re: /(分析|对比|评估|诊断|原因|为什么|数据|统计|趋势|方案|策略|利弊|选型|风险|优化建议)/i
  }
];
function detectScene(raw) {
  for (const m of SCENE_MATCHERS) {
    if (m.re.test(raw)) return m.scene;
  }
  return "general";
}
var SCENE_ROLE = {
  general: DEFAULT_ROLE,
  code: "\u4F60\u662F\u4E00\u4F4D\u8D44\u6DF1\u8F6F\u4EF6\u5DE5\u7A0B\u5E08\uFF0C\u64C5\u957F\u628A\u6A21\u7CCA\u7684\u6280\u672F\u9700\u6C42\u8F6C\u5316\u4E3A\u53EF\u76F4\u63A5\u843D\u5730\u7684\u5B9E\u73B0\u8981\u6C42\u3002",
  writing: "\u4F60\u662F\u4E00\u4F4D\u8D44\u6DF1\u5185\u5BB9\u7F16\u8F91\uFF0C\u64C5\u957F\u628A\u7C97\u7565\u7684\u5199\u4F5C\u610F\u56FE\u8F6C\u5316\u4E3A\u98CE\u683C\u660E\u786E\u3001\u53EF\u76F4\u63A5\u843D\u7B14\u7684\u5199\u4F5C\u8981\u6C42\u3002",
  analysis: "\u4F60\u662F\u4E00\u4F4D\u8D44\u6DF1\u5206\u6790\u5E08\uFF0C\u64C5\u957F\u628A\u7B3C\u7EDF\u7684\u5206\u6790\u8BC9\u6C42\u8F6C\u5316\u4E3A\u53E3\u5F84\u6E05\u6670\u3001\u53EF\u9A8C\u8BC1\u7684\u5206\u6790\u8981\u6C42\u3002",
  translate: "\u4F60\u662F\u4E00\u4F4D\u8D44\u6DF1\u8BD1\u8005\u4E0E\u672C\u5730\u5316\u4E13\u5BB6\uFF0C\u64C5\u957F\u628A\u7FFB\u8BD1\u9700\u6C42\u8F6C\u5316\u4E3A\u8BED\u57DF\u660E\u786E\u3001\u672F\u8BED\u4E00\u81F4\u7684\u7FFB\u8BD1\u8981\u6C42\u3002",
  image: "\u4F60\u662F\u4E00\u4F4D\u8D44\u6DF1\u89C6\u89C9\u63D0\u793A\u8BCD\u5DE5\u7A0B\u5E08\uFF0C\u64C5\u957F\u628A\u753B\u9762\u60F3\u6CD5\u8F6C\u5316\u4E3A\u6784\u56FE\u3001\u5149\u7EBF\u3001\u98CE\u683C\u90FD\u660E\u786E\u7684\u751F\u6210\u63D0\u793A\u8BCD\u3002"
};
var SCENE_REQ = {
  general: DEFAULT_REQ,
  code: [
    "- \u660E\u786E\u8BED\u8A00/\u6846\u67B6/\u8FD0\u884C\u73AF\u5883\uFF1B\u7F3A\u7701\u65F6\u6309\u6700\u901A\u7528\u7684\u65B9\u6848\uFF0C\u5E76\u5728\u6587\u4E2D\u6807\u6CE8\u8FD9\u4E2A\u5047\u8BBE",
    "- \u7ED9\u51FA\u53EF\u8FD0\u884C\u7684\u5B8C\u6574\u5B9E\u73B0\u6216\u660E\u786E\u7684\u6539\u52A8\u70B9\uFF0C\u4E0D\u7528\u4F2A\u4EE3\u7801\u5360\u4F4D",
    "- \u4EA4\u4EE3\u8FB9\u754C\u4E0E\u5931\u8D25\u5904\u7406\uFF08\u7A7A\u503C\u3001\u5F02\u5E38\u3001\u5E76\u53D1\u3001\u8D85\u65F6\uFF09",
    "- \u9700\u8981\u9A8C\u8BC1\u65F6\u7ED9\u51FA\u53EF\u6267\u884C\u7684\u9A8C\u8BC1\u6B65\u9AA4\u6216\u65AD\u8A00"
  ],
  writing: [
    "- \u660E\u786E\u8BFB\u8005\u3001\u53D1\u5E03\u6E20\u9053\u4E0E\u5199\u4F5C\u76EE\u7684",
    "- \u660E\u786E\u7BC7\u5E45\u3001\u8BED\u6C14\u4E0E\u98CE\u683C\uFF08\u6B63\u5F0F/\u53E3\u8BED\u3001\u514B\u5236/\u717D\u52A8\uFF09",
    "- \u53EA\u4F7F\u7528\u5DF2\u7ED9\u51FA\u7684\u4E8B\u5B9E\u4E0E\u6570\u636E\uFF0C\u4E0D\u65B0\u589E\u672A\u63D0\u4F9B\u7684\u7EC6\u8282",
    "- \u5217\u51FA\u5FC5\u987B\u51FA\u73B0\u7684\u8981\u70B9\u4E0E\u5FC5\u987B\u907F\u514D\u7684\u8868\u8FBE"
  ],
  analysis: [
    "- \u660E\u786E\u5206\u6790\u5BF9\u8C61\u3001\u53E3\u5F84\u4E0E\u65F6\u95F4\u8303\u56F4",
    "- \u5148\u7ED9\u7ED3\u8BBA\uFF0C\u518D\u7ED9\u652F\u6491\u4F9D\u636E\u4E0E\u63A8\u7406\u94FE",
    "- \u4E8B\u5B9E\u3001\u63A8\u65AD\u3001\u5047\u8BBE\u4E09\u8005\u5206\u522B\u6807\u6CE8",
    "- \u6570\u636E\u4E0D\u8DB3\u65F6\u8BF4\u660E\u7F3A\u53E3\uFF0C\u4E0D\u865A\u6784\u6570\u5B57"
  ],
  translate: [
    "- \u660E\u786E\u6E90\u8BED\u8A00\u3001\u76EE\u6807\u8BED\u8A00\u4E0E\u76EE\u6807\u8BFB\u8005",
    "- \u4E13\u6709\u540D\u8BCD\u4E0E\u672F\u8BED\u7ED9\u7EDF\u4E00\u8BD1\u6CD5\uFF0C\u5FC5\u8981\u65F6\u4FDD\u7559\u539F\u6587\u4EE5\u4FBF\u6838\u5BF9",
    "- \u8BF4\u660E\u8BED\u57DF\uFF08\u6280\u672F\u6587\u6863/\u8425\u9500\u6587\u6848/\u6CD5\u5F8B\u6587\u672C\uFF09\u4E0E\u672C\u5730\u5316\u8981\u6C42",
    "- \u53EA\u8F93\u51FA\u8BD1\u6587\uFF0C\u53D6\u820D\u8BF4\u660E\u5355\u72EC\u9644\u5728\u8BD1\u6587\u4E4B\u540E"
  ],
  image: [
    "- \u4E3B\u4F53\u3001\u52A8\u4F5C\u3001\u573A\u666F\u3001\u955C\u5934\u666F\u522B\u4E0E\u89C6\u89D2",
    "- \u5149\u7EBF\u3001\u8272\u8C03\u3001\u98CE\u683C\u4E0E\u8D28\u611F",
    "- \u753B\u5E45\u6BD4\u4F8B\uFF0C\u4EE5\u53CA\u753B\u9762\u5185\u6587\u5B57/\u5FC5\u987B\u4E0D\u51FA\u73B0\u7684\u5143\u7D20",
    "- \u7528\u53EF\u88AB\u6A21\u578B\u7406\u89E3\u7684\u5177\u4F53\u540D\u8BCD\uFF0C\u907F\u514D\u62BD\u8C61\u5F62\u5BB9\u8BCD\u5806\u780C"
  ]
};
var SCENE_OUT = {
  general: DEFAULT_OUT,
  code: "\u76F4\u63A5\u7ED9\u51FA\u4EE3\u7801\u4E0E\u5FC5\u8981\u7684\u8FD0\u884C\u8BF4\u660E\uFF1B\u4E0D\u8981\u7528\u7701\u7565\u53F7\u8DF3\u8FC7\u5173\u952E\u5B9E\u73B0\u3002",
  writing: "\u76F4\u63A5\u7ED9\u51FA\u6210\u7A3F\uFF1B\u82E5\u7ED9\u591A\u4E2A\u7248\u672C\uFF0C\u6309\u7248\u672C\u5206\u522B\u6807\u6CE8\u5DEE\u5F02\u3002",
  analysis: "\u7ED3\u8BBA\u5148\u884C\uFF0C\u968F\u540E\u7ED9\u4F9D\u636E\uFF1B\u6BCF\u6761\u7ED3\u8BBA\u90FD\u8981\u80FD\u88AB\u6570\u636E\u6216\u539F\u6587\u652F\u6491\u3002",
  translate: "\u53EA\u8F93\u51FA\u8BD1\u6587\uFF1B\u672F\u8BED\u4E0E\u53D6\u820D\u8BF4\u660E\u653E\u5728\u8BD1\u6587\u4E4B\u540E\u3002",
  image: "\u8F93\u51FA\u4E00\u6BB5\u53EF\u76F4\u63A5\u7C98\u8D34\u8FDB\u751F\u6210\u6A21\u578B\u7684\u63D0\u793A\u8BCD\uFF0C\u4E0D\u8981\u9644\u52A0\u89E3\u91CA\u3002"
};
var ROLE_LINES = Object.values(SCENE_ROLE);
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
  if (/^\s*#\s*任务\s*$/m.test(norm) && ROLE_LINES.some((line) => norm.includes(line))) return true;
  const headings = norm.match(/^\s*#{1,3}\s*(.+)$/gm) ?? [];
  if (headings.length < 2) return false;
  const hit = /* @__PURE__ */ new Set();
  for (const line of headings) {
    const lower = line.toLowerCase();
    for (const word of SECTION_WORDS) {
      if (lower.includes(word)) hit.add(word);
    }
  }
  return hit.size >= 3;
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
  const scene = detectScene(src);
  const out = [];
  let changed = false;
  const hasRole = /你(是|是一位|作为一个)|你是|act as|you are|作为/i.test(firstLine);
  if (!hasRole) {
    out.push(SCENE_ROLE[scene]);
    changed = true;
  }
  out.push(`# \u4EFB\u52A1`);
  out.push(src);
  changed = true;
  const hasStructure = /(^\s*[\d一二三四1-9][.、)）]|\n\s*[-*·])/m.test(src);
  if (!hasStructure) {
    out.push(``);
    out.push(`# \u8981\u6C42`);
    for (const item of SCENE_REQ[scene]) out.push(item);
    changed = true;
  }
  const hasFormat = /(以.*格式|输出为|markdown|json|表格|bullet|列表)/i.test(src);
  if (!hasFormat) {
    out.push(``);
    out.push(`# \u8F93\u51FA`);
    out.push(SCENE_OUT[scene]);
    changed = true;
  }
  const text = out.join("\n");
  return { ok: changed, text, reason: changed ? void 0 : "\u5DF2\u662F\u8F83\u89C4\u8303\u7684\u63D0\u793A\u8BCD\uFF0C\u672A\u505A\u6539\u52A8" };
}
var BASE_RULES = [
  "1. \u4FDD\u7559\u7528\u6237\u7684\u539F\u59CB\u610F\u56FE\u3001\u7EA6\u675F\u6761\u4EF6\u3001\u4E13\u6709\u540D\u8BCD\u3001\u6570\u636E\u4E0E\u4EE3\u7801\uFF0C\u4E0D\u8981\u81C6\u9020\u65B0\u9700\u6C42\u3002",
  "2. \u8865\u9F50\u7F3A\u5931\u7684\u8981\u7D20\uFF1A\u89D2\u8272\u3001\u4EFB\u52A1\u76EE\u6807\u3001\u4E0A\u4E0B\u6587\u3001\u7EA6\u675F\u3001\u671F\u671B\u8F93\u51FA\u5F62\u5F0F\u3002",
  '3. \u6D88\u89E3\u6B67\u4E49\uFF1A\u628A"\u597D\u4E00\u70B9/\u4E30\u5BCC\u4E00\u70B9"\u8FD9\u7C7B\u6A21\u7CCA\u8868\u8FF0\u6539\u5199\u6210\u53EF\u5224\u5B9A\u7684\u5177\u4F53\u8981\u6C42\u3002',
  "4. \u7ED3\u6784\u5316\uFF1A\u7528\u7B80\u77ED\u5C0F\u6807\u9898\u4E0E\u8981\u70B9\u7EC4\u7EC7\uFF0C\u957F\u4EFB\u52A1\u62C6\u6210\u5206\u6B65\u3002",
  "5. \u53EA\u8F93\u51FA\u6539\u5199\u540E\u7684\u63D0\u793A\u8BCD\u6B63\u6587\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u524D\u540E\u52A0\u5F15\u53F7\u3001\u4E0D\u8981\u7528\u4EE3\u7801\u5757\u5305\u88F9\u3002",
  "6. \u82E5\u539F\u63D0\u793A\u8BCD\u5DF2\u7ECF\u8DB3\u591F\u6E05\u6670\uFF0C\u8F93\u51FA\u4F18\u5316\u540E\u7684\u540C\u4E49\u7248\u672C\uFF08\u53EF\u66F4\u7D27\u51D1\uFF09\uFF0C\u4E0D\u8981\u62D2\u7EDD\u56DE\u7B54\u3002"
];
var SCENE_FOCUS = {
  general: [],
  code: [
    "- \u8FD9\u662F\u6280\u672F\u9700\u6C42\uFF1A\u8865\u9F50\u8BED\u8A00/\u6846\u67B6/\u8FD0\u884C\u73AF\u5883\u3001\u8F93\u5165\u8F93\u51FA\u5951\u7EA6\u3001\u8FB9\u754C\u4E0E\u5931\u8D25\u5904\u7406\uFF1B",
    "  \u8981\u6C42\u53EF\u8FD0\u884C\u800C\u975E\u4F2A\u4EE3\u7801\uFF0C\u5E76\u7ED9\u51FA\u53EF\u6267\u884C\u7684\u9A8C\u8BC1\u65B9\u5F0F\u3002"
  ],
  writing: [
    "- \u8FD9\u662F\u5199\u4F5C\u9700\u6C42\uFF1A\u8865\u9F50\u8BFB\u8005\u3001\u6E20\u9053\u3001\u76EE\u7684\u3001\u7BC7\u5E45\u3001\u8BED\u6C14\u4E0E\u98CE\u683C\uFF1B",
    "  \u53EA\u5141\u8BB8\u4F7F\u7528\u7528\u6237\u5DF2\u7ED9\u51FA\u7684\u4E8B\u5B9E\uFF0C\u660E\u786E\u7981\u6B62\u7F16\u9020\u672A\u63D0\u4F9B\u7684\u7EC6\u8282\u3002"
  ],
  analysis: [
    "- \u8FD9\u662F\u5206\u6790\u9700\u6C42\uFF1A\u8865\u9F50\u5206\u6790\u5BF9\u8C61\u3001\u53E3\u5F84\u3001\u65F6\u95F4\u8303\u56F4\uFF1B\u8981\u6C42\u7ED3\u8BBA\u5148\u884C\u5E76\u533A\u5206\u4E8B\u5B9E/\u63A8\u65AD/\u5047\u8BBE\u3002"
  ],
  translate: [
    "- \u8FD9\u662F\u7FFB\u8BD1\u9700\u6C42\uFF1A\u8865\u9F50\u6E90\u8BED\u8A00\u3001\u76EE\u6807\u8BED\u8A00\u3001\u8BED\u57DF\u4E0E\u672C\u5730\u5316\u8981\u6C42\uFF1B\u672F\u8BED\u7ED9\u7EDF\u4E00\u8BD1\u6CD5\u5E76\u4FDD\u7559\u539F\u6587\u4EE5\u4FBF\u6838\u5BF9\u3002"
  ],
  image: [
    "- \u8FD9\u662F\u56FE\u50CF\u751F\u6210\u9700\u6C42\uFF1A\u8865\u9F50\u4E3B\u4F53\u3001\u52A8\u4F5C\u3001\u573A\u666F\u3001\u666F\u522B\u3001\u5149\u7EBF\u3001\u8272\u8C03\u3001\u98CE\u683C\u3001\u753B\u5E45\u6BD4\u4F8B\uFF1B",
    "  \u7528\u5177\u4F53\u540D\u8BCD\u800C\u975E\u62BD\u8C61\u5F62\u5BB9\u8BCD\uFF0C\u5E76\u660E\u786E\u753B\u9762\u5185\u6587\u5B57\u8981\u6C42\u3002"
  ]
};
function buildSystemPrompt(scene, hasContext) {
  const focus = SCENE_FOCUS[scene] ?? [];
  const lines = [
    "\u4F60\u662F\u4E00\u540D\u63D0\u793A\u8BCD\u5DE5\u7A0B\u4E13\u5BB6\u3002\u7528\u6237\u4F1A\u7ED9\u4F60\u4E00\u6BB5\u60F3\u4EA4\u7ED9 AI \u7684\u539F\u59CB\u9700\u6C42\uFF0C\u4F60\u7684\u552F\u4E00\u4EFB\u52A1\u662F\u628A\u5B83\u6539\u5199\u6210\u4E00\u6761\u66F4\u6E05\u6670\u3001\u66F4\u53EF\u6267\u884C\u3001\u66F4\u5C11\u6B67\u4E49\u7684\u63D0\u793A\u8BCD\u3002",
    "",
    "\u6539\u5199\u89C4\u5219\uFF1A",
    ...BASE_RULES
  ];
  if (focus.length > 0) {
    lines.push("", "\u672C\u573A\u666F\u7684\u989D\u5916\u4FA7\u91CD\uFF1A", ...focus);
  }
  if (hasContext) {
    lines.push(
      "",
      "\u5173\u4E8E\u5BF9\u8BDD\u4E0A\u4E0B\u6587\uFF1A",
      '7. \u4E0B\u9762\u4F1A\u9644\u4E0A\u300C\u5F53\u524D\u5BF9\u8BDD\u7684\u6700\u8FD1\u51E0\u8F6E\u300D\u3002\u5F53\u539F\u59CB\u9700\u6C42\u662F\u63A5\u7740\u4E0A\u6587\u8BF4\u7684\uFF08\u7701\u7565\u4E86\u4E3B\u8BED\u3001\u5F15\u7528\u4E86"\u4E0A\u9762\u90A3\u4E2A/\u521A\u624D\u7684/\u7EE7\u7EED"\uFF09\uFF0C\u7528\u4E0A\u4E0B\u6587\u8865\u9F50\u5B83\u6307\u4EE3\u7684\u5BF9\u8C61\u3002',
      "8. \u4E0A\u6587\u5DF2\u786E\u5B9A\u7684\u524D\u63D0\uFF08\u6280\u672F\u6808\u3001\u53E3\u5F84\u3001\u98CE\u683C\u3001\u5DF2\u5426\u51B3\u7684\u65B9\u6848\uFF09\u4E0D\u8981\u6539\u5199\u3001\u4E0D\u8981\u91CD\u590D\u8981\u6C42\uFF0C\u4E5F\u4E0D\u8981\u5F15\u5165\u4E0E\u4E0A\u6587\u51B2\u7A81\u7684\u65B0\u7EA6\u675F\u3002",
      "9. \u4E0A\u4E0B\u6587\u53EA\u7528\u6765\u6D88\u6B67\uFF0C\u4E0D\u8981\u628A\u4E0A\u6587\u7684\u7ED3\u8BBA\u590D\u8FF0\u8FDB\u6539\u5199\u7ED3\u679C\u2014\u2014\u8F93\u51FA\u4ECD\u53EA\u9488\u5BF9\u5F53\u524D\u8FD9\u6761\u9700\u6C42\u3002"
    );
  }
  return lines.join("\n");
}
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
var TRUNCATED_FINISH = /* @__PURE__ */ new Set([
  "length",
  "max_tokens",
  "max-tokens",
  "max_output_tokens",
  "content_filter"
]);
async function collectText(chunks) {
  let out = "";
  let truncated = false;
  for await (const c of chunks) {
    if (!c) continue;
    if (c.type === "text-delta" && typeof c.text === "string") {
      out += c.text;
    } else if (c.type === "finish" && typeof c.reason === "string") {
      if (TRUNCATED_FINISH.has(c.reason.toLowerCase())) truncated = true;
    }
  }
  return { text: out, truncated };
}
var LLM_ABORTED = /* @__PURE__ */ Symbol("llm-aborted");
function isAbortError(err, signal) {
  if (signal?.aborted) return true;
  const name2 = err?.name;
  return name2 === "AbortError" || name2 === "TimeoutError";
}
function sanitize(text) {
  let t = text.trim();
  t = t.replace(/^(优化后的提示词|改写后的提示词|优化结果|优化后|提示词)[:：]\s*/i, "").trim();
  const fence = /^```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(/^["“”']([\s\S]*)["“”']$/, "$1").trim();
  return t;
}
var CONTEXT_MAX_TURNS = 6;
var CONTEXT_MAX_CHARS = 1200;
function flattenContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}
async function readSessionContext(ctx, sessionId) {
  if (!isNonEmptyString(sessionId)) return [];
  let query;
  try {
    query = ctx?.get?.("sessionQuery");
  } catch {
    return [];
  }
  if (!query || typeof query.readSession !== "function") return [];
  let loaded;
  try {
    loaded = await query.readSession(sessionId);
  } catch {
    return [];
  }
  const events = Array.isArray(loaded?.events) ? loaded.events : [];
  if (events.length === 0) return [];
  const turns = [];
  for (let i = events.length - 1; i >= 0 && turns.length < CONTEXT_MAX_TURNS; i -= 1) {
    const ev = events[i];
    if (!ev || ev.type !== "user/message") continue;
    if (ev.surfaceOp !== "append") continue;
    const text = flattenContent(ev.data?.content ?? ev.data?.message?.content).trim();
    if (!text) continue;
    turns.push({ role: "user", text });
  }
  turns.reverse();
  let budget = CONTEXT_MAX_CHARS;
  const kept = [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i];
    if (t.text.length > budget) {
      kept.unshift({ role: t.role, text: t.text.slice(0, Math.max(0, budget)) });
      break;
    }
    budget -= t.text.length;
    kept.unshift(t);
  }
  return kept;
}
function renderContext(turns) {
  if (turns.length === 0) return "";
  const lines = ["[\u5F53\u524D\u5BF9\u8BDD\u7684\u6700\u8FD1\u51E0\u8F6E\uFF0C\u4EC5\u7528\u4E8E\u6D88\u6B67]"];
  for (const t of turns) lines.push(`\u7528\u6237\uFF1A${t.text}`);
  return lines.join("\n");
}
async function optimizeWithLlm(ctx, raw, clientSignal, contextTurns = []) {
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
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timedOut = false;
  let clientGone = false;
  const onClientAbort = () => {
    clientGone = true;
    try {
      controller?.abort();
    } catch {
    }
  };
  if (clientSignal) {
    if (clientSignal.aborted) onClientAbort();
    else clientSignal.addEventListener("abort", onClientAbort, { once: true });
  }
  const timeoutTimer = controller ? setTimeout(() => {
    timedOut = true;
    try {
      controller?.abort();
    } catch {
    }
  }, LLM_TIMEOUT_MS) : null;
  const cleanup = () => {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    try {
      clientSignal?.removeEventListener("abort", onClientAbort);
    } catch {
    }
  };
  if (clientGone) {
    cleanup();
    return LLM_ABORTED;
  }
  const scene = detectScene(raw);
  const contextBlock = renderContext(contextTurns);
  const userText = contextBlock ? `${contextBlock}

[\u5F53\u524D\u8981\u4F18\u5316\u7684\u63D0\u793A\u8BCD]
${raw}` : raw;
  let stream;
  try {
    stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: buildSystemPrompt(scene, contextBlock !== ""),
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
      maxTokens: LLM_MAX_TOKENS,
      temperature: 0.3,
      ...effort ? { reasoningEffort: effort } : {},
      ...controller ? { signal: controller.signal } : {}
    });
  } catch {
    cleanup();
    return null;
  }
  try {
    const { text: rawText, truncated } = await collectText(stream);
    if (clientGone) return LLM_ABORTED;
    if (truncated) return null;
    const text = sanitize(rawText);
    if (!text) return null;
    return { ok: true, text };
  } catch (err) {
    if (clientGone) return LLM_ABORTED;
    if (timedOut || isAbortError(err, controller?.signal)) return null;
    return null;
  } finally {
    cleanup();
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
  if (typeof origin !== "string" || origin === "") return true;
  if (origin === "null") return false;
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
        const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : "";
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
        let aborted = false;
        const clientAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
        const onClose = () => {
          try {
            clientAbort?.abort();
          } catch {
          }
        };
        if (clientAbort) {
          try {
            req.once?.("close", onClose);
          } catch {
          }
          try {
            res.once?.("close", onClose);
          } catch {
          }
        }
        const clientSignal = clientAbort?.signal;
        const tooLongForLlm = raw.length > LLM_MAX_INPUT_CHARS;
        if (wantMode !== "local" && tooLongForLlm) {
          note = `\u8F93\u5165\u8D85\u8FC7 ${LLM_MAX_INPUT_CHARS} \u5B57\u7B26\uFF0C\u5DF2\u8DF3\u8FC7\u6A21\u578B\u6539\u5199\u4EE5\u63A7\u5236\u5F00\u9500`;
        }
        if (wantMode !== "local" && !tooLongForLlm) {
          const contextTurns = await readSessionContext(ctxRef, sessionId);
          if (contextTurns.length > 0) {
            note = `\u5DF2\u5E26\u5165 ${contextTurns.length} \u8F6E\u5BF9\u8BDD\u4E0A\u4E0B\u6587`;
          }
          const llmResult = await optimizeWithLlm(ctxRef, raw, clientSignal, contextTurns);
          if (llmResult === LLM_ABORTED) {
            aborted = true;
          } else if (llmResult) {
            result = llmResult;
            mode = "llm";
          }
        }
        if (aborted) {
          try {
            sendJson(res, 200, { ok: false, text: raw, reason: "\u5DF2\u505C\u6B62\u4F18\u5316", mode: "none", aborted: true });
          } catch {
          }
          return;
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
