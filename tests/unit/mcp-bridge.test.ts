import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DEFAULT_MCP_PORT, normalizeBridgeConfig } from "@/src/agent/mcp-bridge";
import { createBridgeServer, decodeWsFrames, encodeWsTextFrame, executeMcpToolCall, handleMcpJsonRpc, MCP_TOOLS } from "../../scripts/mcp-server.mjs";

describe("MCP Browser Bridge", () => {
  it("normalizes bridge config with safe defaults", () => {
    expect(normalizeBridgeConfig(undefined)).toEqual({
      enabled: false,
      port: DEFAULT_MCP_PORT,
      token: "",
    });
    expect(normalizeBridgeConfig({ enabled: true, port: 18888, token: " secret " })).toEqual({
      enabled: true,
      port: 18888,
      token: "secret",
    });
    expect(normalizeBridgeConfig({ enabled: "yes", port: 80 })).toEqual({
      enabled: false,
      port: DEFAULT_MCP_PORT,
      token: "",
    });
  });

  it("encodes and decodes RFC 6455 WebSocket frames", () => {
    const sample = JSON.stringify({ id: "req_1", method: "page.snapshot", params: { tabId: 1 } });
    const frame = encodeWsTextFrame(sample);
    const { frames, remaining } = decodeWsFrames(frame);
    expect(remaining.length).toBe(0);
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(0x01);
    expect(frames[0].payload.toString("utf8")).toBe(sample);
  });

  it("handles MCP JSON-RPC initialize, tools/list, and tools/call", async () => {
    const initRes = await handleMcpJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, async () => ({}));
    expect(initRes?.result?.serverInfo?.name).toBe("sidekick-browser-bridge");

    const listRes = await handleMcpJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, async () => ({}));
    expect(listRes?.result?.tools).toHaveLength(MCP_TOOLS.length);
    expect(MCP_TOOLS.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining([
        "browser_snapshot",
        "browser_click",
        "browser_input",
        "browser_extract",
        "browser_screenshot",
        "browser_tabs_list",
        "browser_run_task",
      ]),
    );

    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const mockCallExt = async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "page.action") {
        return {
          ok: true,
          message: "clicked [f0:12]",
          snapshot: {
            url: "https://example.com",
            title: "Example Page",
            viewport: { pixelsAbove: 0, pixelsBelow: 200 },
            tree: "[f0:12] <button>Clicked</button>",
          },
        };
      }
      if (method === "page.screenshot") {
        return {
          tabId: 1,
          url: "https://example.com",
          title: "Example Page",
          mimeType: "image/jpeg",
          base64: "dGVzdC1pbWFnZQ==",
        };
      }
      return {};
    };

    const clickOut = await executeMcpToolCall("browser_click", { index: "f0:12" }, mockCallExt);
    expect(calls[0]).toEqual({
      method: "page.action",
      params: { tabId: undefined, action: { name: "click", args: { index: "f0:12" } }, includeSnapshot: true },
    });
    expect(clickOut.content[0].text).toContain("clicked [f0:12]");
    expect(clickOut.content[0].text).toContain("[f0:12] <button>Clicked</button>");

    const shotOut = await executeMcpToolCall("browser_screenshot", {}, mockCallExt);
    expect(shotOut.content[1]).toEqual({
      type: "image",
      data: "dGVzdC1pbWFnZQ==",
      mimeType: "image/jpeg",
    });
  });

  it("exposes HTTP /status on the local bridge server", async () => {
    const bridge = createBridgeServer({ port: 0 });
    const boundPort = await bridge.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${boundPort}/status`);
      const json = (await res.json()) as { ok: boolean; extensionConnected: boolean; tools: string[] };
      expect(json.ok).toBe(true);
      expect(json.extensionConnected).toBe(false);
      expect(json.tools).toContain("browser_snapshot");
    } finally {
      await bridge.close();
    }
  });
});
