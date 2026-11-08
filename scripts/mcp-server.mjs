#!/usr/bin/env node
/**
 * Sidekick Browser Bridge — Standalone MCP Server + Local WebSocket Bridge.
 *
 * Connects any MCP-compatible AI Agent (Claude Code, Claude Desktop, Cursor, Antigravity, Windsurf, etc.)
 * or HTTP client to the user's live Chrome browser via the Sidekick extension.
 *
 * Usage:
 *   node scripts/mcp-server.mjs [--port=17395] [--token=optional_secret]
 */
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const DEFAULT_PORT = 17395;

export const MCP_TOOLS = [
  {
    name: "browser_tabs_list",
    description: "List all open tabs in the user's Chrome browser with their tabId, title, URL, and active state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_tab_activate",
    description: "Switch focus to a specific browser tab by tabId.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "number", description: "Target tabId from browser_tabs_list" } },
      required: ["tabId"],
    },
  },
  {
    name: "browser_tab_open",
    description: "Open a new browser tab at the given http(s) URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full http(s) URL to open" },
        active: { type: "boolean", description: "Whether to focus the new tab (default true)" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_tab_close",
    description: "Close a browser tab by tabId.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "number", description: "Target tabId to close" } },
      required: ["tabId"],
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Inspect the current browser screen: returns the page URL, title, scroll viewport, and an indexed interactive DOM tree (e.g. [f0:12] <button>Submit</button>). Call this before clicking or typing.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional tabId; defaults to the currently active tab" },
      },
    },
  },
  {
    name: "browser_extract",
    description: "Extract the clean main article/content of the current webpage as Markdown (Readability).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional tabId; defaults to the currently active tab" },
      },
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a visual JPEG screenshot of the currently visible browser tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional tabId; defaults to the currently active tab" },
      },
    },
  },
  {
    name: "browser_click",
    description: 'Click an element on the page by its index from browser_snapshot (e.g. "f0:12"). Returns the updated DOM snapshot.',
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "string", description: 'Element id from browser_snapshot, e.g. "f0:12"' },
        tabId: { type: "number", description: "Optional tabId" },
      },
      required: ["index"],
    },
  },
  {
    name: "browser_input",
    description: 'Type text into an input, textarea, or rich-text editor by its index from browser_snapshot (e.g. "f0:15").',
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "string", description: 'Element id from browser_snapshot, e.g. "f0:15"' },
        text: { type: "string", description: "Text to type" },
        clear: { type: "boolean", description: "Clear existing value before typing (default true)" },
        tabId: { type: "number", description: "Optional tabId" },
      },
      required: ["index", "text"],
    },
  },
  {
    name: "browser_select_option",
    description: "Select an option in a <select> dropdown by element index and visible option text.",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "string", description: 'Element id from browser_snapshot, e.g. "f0:18"' },
        text: { type: "string", description: "Visible text of the option to select" },
        tabId: { type: "number", description: "Optional tabId" },
      },
      required: ["index", "text"],
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the webpage (or a specific scrollable container by index) up or down.",
    inputSchema: {
      type: "object",
      properties: {
        down: { type: "boolean", description: "true to scroll down, false to scroll up" },
        pages: { type: "number", description: "Number of viewport pages to scroll (0.5 to 3, default 1)" },
        index: { type: "string", description: "Optional element id of a scrollable container" },
        tabId: { type: "number", description: "Optional tabId" },
      },
      required: ["down"],
    },
  },
  {
    name: "browser_send_keys",
    description: "Press a keyboard key on the page (optionally focused on an element index).",
    inputSchema: {
      type: "object",
      properties: {
        keys: {
          type: "string",
          enum: ["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
          description: "Key name to press",
        },
        index: { type: "string", description: "Optional element id to focus before pressing the key" },
        tabId: { type: "number", description: "Optional tabId" },
      },
      required: ["keys"],
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate the current (or specified) tab to a new http(s) URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Destination http(s) URL" },
        tabId: { type: "number", description: "Optional tabId" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_go_back",
    description: "Go back one page in the tab's navigation history.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional tabId" },
      },
    },
  },
  {
    name: "browser_search_page",
    description: "Search for a text pattern on the current page and return matching excerpts.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text or keyword to find on the page" },
        tabId: { type: "number", description: "Optional tabId" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "browser_wait",
    description: "Wait for a given number of seconds (1-10) for dynamic page content to settle.",
    inputSchema: {
      type: "object",
      properties: {
        seconds: { type: "number", description: "Seconds to wait (1-10)" },
        tabId: { type: "number", description: "Optional tabId" },
      },
      required: ["seconds"],
    },
  },
  {
    name: "browser_run_task",
    description:
      "Delegate a multi-step natural language web task to Sidekick's built-in autonomous browser agent loop.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Natural language instruction to execute on the page" },
        tabId: { type: "number", description: "Optional tabId" },
      },
      required: ["task"],
    },
  },
];

/** Encode a UTF-8 string into an unmasked RFC 6455 WebSocket text frame (server -> client). */
export function encodeWsTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Decode one or more RFC 6455 WebSocket frames from an incoming byte buffer. */
export function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let hdrLen = 2;
    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      hdrLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      hdrLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    const totalLen = hdrLen + maskLen + payloadLen;
    if (offset + totalLen > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(offset + hdrLen + maskLen, offset + totalLen));
    if (masked) {
      const mask = buffer.subarray(offset + hdrLen, offset + hdrLen + 4);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    frames.push({ opcode, payload });
    offset += totalLen;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function formatSnapshotResult(res) {
  if (!res) return "OK";
  const snap = res.snapshot ?? (res.tree !== undefined ? res : undefined);
  const lines = [];
  if (res.message) lines.push(`Action result: ${res.message}`);
  if (snap) {
    const vp = snap.viewport
      ? ` (${snap.viewport.pixelsAbove ?? 0}px above, ${snap.viewport.pixelsBelow ?? 0}px below)`
      : "";
    lines.push(`Page: ${snap.title || "(untitled)"} — ${snap.url || ""}${vp}`);
    lines.push(snap.tree || "(no interactive elements)");
  }
  return lines.join("\n\n") || JSON.stringify(res, null, 2);
}

/** Map an MCP tool name + arguments to a Sidekick extension bridge call and format its MCP response. */
export async function executeMcpToolCall(name, args = {}, callExtension) {
  const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
  switch (name) {
    case "browser_tabs_list": {
      const r = await callExtension("tabs.list", {});
      return { content: [{ type: "text", text: JSON.stringify(r.tabs, null, 2) }] };
    }
    case "browser_tab_activate": {
      const r = await callExtension("tabs.activate", { tabId: args.tabId });
      return { content: [{ type: "text", text: `Activated tab ${r.tabId}: ${r.title} (${r.url})` }] };
    }
    case "browser_tab_open": {
      const r = await callExtension("tabs.open", { url: args.url, active: args.active });
      return { content: [{ type: "text", text: `Opened tab ${r.tabId}: ${r.url}` }] };
    }
    case "browser_tab_close": {
      const r = await callExtension("tabs.close", { tabId: args.tabId });
      return { content: [{ type: "text", text: `Closed tab ${r.tabId}` }] };
    }
    case "browser_snapshot": {
      const r = await callExtension("page.snapshot", { tabId });
      return { content: [{ type: "text", text: formatSnapshotResult(r) }] };
    }
    case "browser_extract": {
      const r = await callExtension("page.extract", { tabId });
      const header = `# ${r.title || "(untitled)"}\nURL: ${r.url || ""}\n\n`;
      return { content: [{ type: "text", text: header + (r.markdown || "") }] };
    }
    case "browser_screenshot": {
      const r = await callExtension("page.screenshot", { tabId });
      return {
        content: [
          { type: "text", text: `Screenshot of ${r.title || "tab"} (${r.url || ""})` },
          { type: "image", data: r.base64, mimeType: r.mimeType || "image/jpeg" },
        ],
      };
    }
    case "browser_click":
    case "browser_input":
    case "browser_select_option":
    case "browser_scroll":
    case "browser_send_keys":
    case "browser_navigate":
    case "browser_go_back":
    case "browser_search_page":
    case "browser_wait": {
      const actionName = name.replace(/^browser_/, "");
      const { tabId: _t, ...actionArgs } = args;
      const r = await callExtension("page.action", {
        tabId,
        action: { name: actionName, args: actionArgs },
        includeSnapshot: true,
      });
      return {
        isError: r.ok === false,
        content: [{ type: "text", text: formatSnapshotResult(r) }],
      };
    }
    case "browser_run_task": {
      const r = await callExtension("agent.run_task", { tabId, task: args.task }, 120_000);
      return {
        isError: r.outcome?.status === "error",
        content: [{ type: "text", text: JSON.stringify(r, null, 2) }],
      };
    }
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

export function createBridgeServer({ port = DEFAULT_PORT, token = "" } = {}) {
  let activeSocket = null;
  let reqSeq = 0;
  const pending = new Map();

  function callExtension(method, params = {}, timeoutMs = 30_000) {
    if (!activeSocket || activeSocket.destroyed) {
      return Promise.reject(
        new Error(
          `Sidekick Chrome extension is not connected to ws://127.0.0.1:${port}/ws. Enable "MCP Bridge" in Sidekick Settings -> Web Actions.`,
        ),
      );
    }
    const id = `req_${++reqSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Bridge call "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      activeSocket.write(encodeWsTextFrame(JSON.stringify({ id, method, params })));
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          extensionConnected: Boolean(activeSocket && !activeSocket.destroyed),
          port,
          tools: MCP_TOOLS.map((t) => t.name),
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/rpc") {
      if (token && req.headers["x-sidekick-token"] !== token && url.searchParams.get("token") !== token) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized token" }));
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (body.tool) {
          const out = await executeMcpToolCall(body.tool, body.arguments ?? {}, callExtension);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, data: out }));
        } else {
          const out = await callExtension(body.method, body.params ?? {});
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, data: out }));
        }
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }));
      }
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (token && url.searchParams.get("token") !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"),
    );

    if (activeSocket && activeSocket !== socket) {
      try {
        activeSocket.destroy();
      } catch {
        /* ignore */
      }
    }
    activeSocket = socket;
    let buf = Buffer.alloc(0);
    let textChunks = [];

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, remaining } = decodeWsFrames(buf);
      buf = remaining;
      for (const f of frames) {
        if (f.opcode === 0x08) {
          // Close frame
          socket.end();
          return;
        }
        if (f.opcode === 0x09) {
          // Ping -> Pong
          const pong = Buffer.concat([Buffer.from([0x8a, f.payload.length]), f.payload]);
          socket.write(pong);
          continue;
        }
        if (f.opcode === 0x01 || f.opcode === 0x00) {
          textChunks.push(f.payload);
          const raw = Buffer.concat(textChunks).toString("utf8");
          textChunks = [];
          try {
            const msg = JSON.parse(raw);
            if (msg.type === "ping") {
              socket.write(encodeWsTextFrame(JSON.stringify({ type: "pong", ts: Date.now() })));
              continue;
            }
            if (msg.id && pending.has(msg.id)) {
              const entry = pending.get(msg.id);
              pending.delete(msg.id);
              if (msg.ok) entry.resolve(msg.result);
              else entry.reject(new Error(msg.error || "Extension RPC error"));
            }
          } catch {
            /* ignore non-JSON frame */
          }
        }
      }
    });

    const cleanup = () => {
      if (activeSocket === socket) activeSocket = null;
      for (const [id, entry] of pending.entries()) {
        pending.delete(id);
        entry.reject(new Error("Extension WebSocket disconnected"));
      }
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  return {
    server,
    callExtension,
    isExtensionConnected: () => Boolean(activeSocket && !activeSocket.destroyed),
    async listen(listenPort = port) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, "127.0.0.1", () => resolve());
      });
      const addr = server.address();
      return typeof addr === "object" && addr ? addr.port : listenPort;
    },
    async close() {
      if (activeSocket) activeSocket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** Handle a single JSON-RPC 2.0 MCP message and return the response object (or null for notifications). */
export async function handleMcpJsonRpc(msg, callExtension) {
  if (!msg || typeof msg !== "object") return null;
  const { id, method, params } = msg;
  if (id === undefined) return null; // JSON-RPC notification

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: params?.protocolVersion || "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "sidekick-browser-bridge", version: "0.1.0" },
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments ?? {};
        try {
          const result = await executeMcpToolCall(name, args, callExtension);
          return { jsonrpc: "2.0", id, result };
        } catch (err) {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [{ type: "text", text: err?.message ?? String(err) }],
            },
          };
        }
      }
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: err?.message ?? String(err) },
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const portArg = args.find((a) => a.startsWith("--port="))?.split("=")[1];
  const tokenArg = args.find((a) => a.startsWith("--token="))?.split("=")[1];
  const port = Number(portArg || process.env.SIDEKICK_MCP_PORT || DEFAULT_PORT);
  const token = tokenArg ?? process.env.SIDEKICK_MCP_TOKEN ?? "";

  const bridge = createBridgeServer({ port, token });
  let callFn = bridge.callExtension;
  try {
    await bridge.listen(port);
    process.stderr.write(`[sidekick-mcp] Bridge listening on ws://127.0.0.1:${port}/ws (HTTP /status, /rpc)\n`);
  } catch (e) {
    process.stderr.write(`[sidekick-mcp] Port ${port} already active (${e.code || e.message}); proxying via http://127.0.0.1:${port}/rpc\n`);
    callFn = async (method, params = {}) => {
      const headers = { "content-type": "application/json" };
      if (token) headers["x-sidekick-token"] = token;
      const r = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({ method, params }),
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error || `HTTP ${r.status}`);
      return json.data;
    };
  }

  let stdinBuf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    stdinBuf += chunk;
    while (true) {
      const nl = stdinBuf.indexOf("\n");
      if (nl < 0) break;
      const line = stdinBuf.slice(0, nl).trim();
      stdinBuf = stdinBuf.slice(nl + 1);
      if (!line || line.startsWith("Content-Length:")) continue;
      try {
        const req = JSON.parse(line);
        const res = await handleMcpJsonRpc(req, callFn);
        if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
      } catch {
        /* ignore malformed line */
      }
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
