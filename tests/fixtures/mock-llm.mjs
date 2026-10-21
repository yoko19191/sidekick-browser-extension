// Local OpenAI-compatible mock (no network, no paid API). Streams SSE like /v1/chat/completions.
//   model "mock-slow": first chunk, then ~32s of silence ("thinking"), then 13 chunks 1s apart (≈45s total)
//   translation requests (system prompt contains "professional translator"): returns realistic Chinese (see ZH / mockTranslate)
//   anything else: a Markdown summary streamed in small chunks
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const FIXTURE_DIR = new URL("./", import.meta.url);
export const stats = { translateRequests: 0, translatedItems: 0, chatRequests: 0, sectionRequests: 0, selectionRequests: 0, toolRequests: 0, pixelHits: 0, authHeaders: new Set() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SUMMARY = `**TL;DR**：这篇文章介绍了城市屋顶花园如何降低室温、吸收雨水并改善生物多样性。

### 关键要点
- **降温效果**：绿色屋顶可让顶层室温在夏季降低 **2–4 °C**。
- **雨水管理**：每平方米植被层可截留约 *60%* 的降雨。
- **生物多样性**：屋顶成为传粉昆虫的"踏脚石"栖息地。
- **成本**：初期投入较高，但 15 年内可通过节能收回。

### 为什么重要
城市热岛效应正在加剧，屋顶花园是少数能**同时**解决温度、排水与生态问题的低技术方案。[^1]

[^1]: it can hold back around sixty percent of the rain that falls on it`;


// Realistic (hand-written) translations for the fixture article, so screenshots look like real output.
// Unknown text gets a deterministic Chinese placeholder of similar length. No prefixes/markers.
const ZH = {
  "THE GREEN CITY JOURNAL": "绿色城市期刊",
  "How Rooftop Gardens Cool Our Cities": "屋顶花园如何为城市降温",
  "By Ada Fernández · 6 min read": "作者 Ada Fernández · 阅读约 6 分钟",
  "On a hot July afternoon, the asphalt roofs of a dense city can reach temperatures above 70 °C. Rooftop gardens replace that heat-absorbing surface with soil and plants, which shade the building and cool the air through evaporation.":
    "在炎热的七月午后，密集城区的沥青屋顶温度可超过 70 °C。屋顶花园用土壤和植物取代了这种吸热表面，既为建筑遮阴，又通过蒸发作用为空气降温。",
  "Researchers measured top-floor apartments under green roofs and found indoor temperatures two to four degrees lower than under conventional roofs during summer heat waves.":
    "研究人员测量了绿色屋顶下的顶层公寓，发现在夏季热浪期间，其室内温度比普通屋顶下低二到四度。",
  "Catching the rain": "留住雨水",
  "A vegetated roof works like a sponge. Depending on the depth of the growing layer, it can hold back around sixty percent of the rain that falls on it, easing pressure on overloaded storm drains.":
    "植被屋顶就像一块海绵。根据种植层的厚度，它能截留落在其上约六成的雨水，缓解不堪重负的雨水管网的压力。",
  "Shallow sedum roofs are light and need little maintenance.": "浅层景天屋顶重量轻，几乎不需要维护。",
  'Deeper "intensive" roofs can support shrubs and even small trees.': "更深的“密集型”屋顶可以种植灌木，甚至小型乔木。",
  "Stepping stones for wildlife": "野生动物的踏脚石",
  "Bees, butterflies and birds use rooftop gardens as stepping stones between parks, turning a grey skyline into a connected habitat network.":
    "蜜蜂、蝴蝶和鸟类把屋顶花园当作公园之间的踏脚石，让灰色的天际线变成相互连通的栖息地网络。",
  "The upfront cost is higher than a standard roof, but energy savings and a longer membrane life usually pay it back within fifteen years.":
    "前期成本高于普通屋顶，但节省的能源和更长的防水层寿命通常能在十五年内收回投入。",
  "Load more": "加载更多",
  "This paragraph was loaded dynamically after the page finished rendering.": "这一段是在页面渲染完成后动态加载的。",
};
const FILLER = "这是本地模拟服务返回的示例译文，用于测试双语对照的排版效果。";
export function mockTranslate(text) {
  const t = text.trim();
  if (ZH[t]) return ZH[t];
  const n = Math.max(6, Math.round(t.length / 2.2));
  return (FILLER.repeat(Math.ceil(n / FILLER.length) + 1)).slice(0, n).replace(/[，、]$/, "") + "。";
}

function longArticle(chapters = 70) {
  const paras = Array.from({ length: chapters }, (_, i) => `<h2>Chapter ${i + 1}</h2><p>${`Section ${i + 1} discusses urban heat, rainfall retention and pollinators in considerable detail. `.repeat(5)}</p>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A Very Long Report on Green Roofs</title></head><body><article><h1>A Very Long Report on Green Roofs</h1>${paras}</article></body></html>`;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sse(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  let i = 0;
  return {
    chunk(model, content) {
      res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: Date.now() / 1000 | 0, model, choices: [{ index: 0, delta: i++ === 0 ? { role: "assistant", content } : { content }, finish_reason: null }] })}\n\n`);
    },
    end(model) {
      res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: Date.now() / 1000 | 0, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    },
  };
}

function chunks(s, n) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

export function startMock(port = 0) {
  const server = createServer(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/fixtures/long.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(longArticle(Math.min(2000, Number(url.searchParams.get("chapters")) || 70)));
    }
    if (url.pathname.startsWith("/fixtures/")) {
      try {
        const body = readFileSync(new URL(url.pathname.slice("/fixtures/".length), FIXTURE_DIR));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(body);
      } catch {
        return res.writeHead(404).end();
      }
    }
    if (url.pathname === "/__pixel") {
      // exfiltration canary: model output embeds this as an image; it must never be fetched automatically
      stats.pixelHits++;
      res.writeHead(200, { "Content-Type": "image/gif", "Access-Control-Allow-Origin": "*" });
      return res.end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
    }
    if (url.pathname === "/__stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ...stats, authHeaders: [...stats.authHeaders] }));
    }
    if (url.pathname.startsWith("/v1/") && req.headers.authorization === "Bearer bad-key") {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }));
    }
    if (url.pathname === "/v1/models") {
      stats.authHeaders.add(req.headers.authorization ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "mock-fast" }, { id: "mock-slow" }] }));
    }
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      stats.authHeaders.add(req.headers.authorization ?? "");
      const model = body.model;
      const system = body.messages.find((m) => m.role === "system" || m.role === "developer")?.content ?? "";
      const sysText = typeof system === "string" ? system : JSON.stringify(system);
      const last = body.messages[body.messages.length - 1];
      const lastText = typeof last.content === "string" ? last.content : last.content.map((p) => p.text ?? "").join("");
      const out = sse(res);
      const toolNames = Array.isArray(body.tools) ? body.tools.map((t) => t.function?.name) : [];
      if (toolNames.includes("done")) {
        // scripted web-action agent: fill the name field, click submit, then finish
        stats.agentRequests = (stats.agentRequests ?? 0) + 1;
        const all = body.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).join("\n");
        const calls = body.messages.flatMap((m) => m.tool_calls ?? []).map((c) => c.function.name);
        const id = (re) => all.match(re)?.[1];
        let call;
        if (!calls.includes("input")) call = { name: "input", args: { index: id(/\[(f\d+:\d+)\][<‹]input type=text/), text: "Ada" } };
        else if (!calls.includes("click") && toolNames.includes("click")) call = { name: "click", args: { index: id(/\[(f\d+:\d+)\][<‹]button[^>›]*[>›]Submit/) } };
        else call = { name: "done", args: { success: true, text: "submitted" } };
        const a = JSON.stringify(call.args);
        res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${stats.agentRequests}`, type: "function", function: { name: call.name, arguments: a } }] }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      if (Array.isArray(body.tools) && body.tools.length) {
        stats.toolRequests++;
        const name = body.tools[0].function?.name ?? "tool";
        const args = JSON.stringify({ city: "Paris" });
        res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: "" } }] }, finish_reason: null }] })}\n\n`);
        for (const c of chunks(args, 5)) res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: c } }] }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      if (/This is section \d+ of \d+/.test(sysText)) {
        stats.sectionRequests++;
        out.chunk(model, `- Notes for ${sysText.match(/section (\d+) of (\d+)/)[0]}: heat, rain, pollinators. "urban heat, rainfall retention and pollinators"`);
        return out.end(model);
      }
      if (/Translate the user's text/.test(sysText)) {
        stats.selectionRequests++;
        out.chunk(model, mockTranslate(lastText));
        return out.end(model);
      }
      if (/professional translator/.test(sysText)) {
        stats.translateRequests++;
        const texts = JSON.parse(lastText);
        stats.translatedItems += texts.length;
        const reply = JSON.stringify(texts.map((t) => mockTranslate(t)));
        for (const c of chunks(reply, 40)) {
          out.chunk(model, c);
          await sleep(5);
        }
        return out.end(model);
      }
      stats.chatRequests++;
      if (model === "mock-slow") {
        out.chunk(model, "Start. ");
        await sleep(32000); // silent gap longer than the 30s SW idle timeout
        for (let i = 1; i <= 13; i++) {
          out.chunk(model, `chunk-${i} `);
          await sleep(1000);
        }
        out.chunk(model, "END-OF-SLOW-STREAM");
        return out.end(model);
      }
      if (/INJECT-IMAGE/.test(lastText)) {
        // simulates a prompt-injected model trying to exfiltrate via an auto-loading image (+ raw HTML)
        const host = `http://${req.headers.host}`;
        out.chunk(model, `Sure. ![status](${host}/__pixel?d=secret-from-page) and <img src="${host}/__pixel?d=html"> done.`);
        return out.end(model);
      }
      if (/Reply with: ok/.test(lastText)) {
        out.chunk(model, "ok");
        return out.end(model);
      }
      const text = /<notes /.test(sysText) ? `**长文总结**：共 ${(sysText.match(/## Section/g) ?? []).length} 段笔记已合并。` : /Summarize this page/.test(lastText) ? SUMMARY : `收到：${lastText.slice(0, 60)}\n\n这是来自本地 mock 服务的流式回复。`;
      for (const c of chunks(text, 6)) {
        out.chunk(model, c);
        await sleep(12);
      }
      return out.end(model);
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const { port } = await startMock(Number(process.env.PORT ?? 8787));
  console.log(`mock LLM on http://127.0.0.1:${port}/v1`);
}
