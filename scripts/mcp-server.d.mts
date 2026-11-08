export const DEFAULT_PORT: number;
export const MCP_TOOLS: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}[];
export function encodeWsTextFrame(text: string): Buffer;
export function decodeWsFrames(buffer: Buffer): {
  frames: { opcode: number; payload: Buffer }[];
  remaining: Buffer;
};
export function executeMcpToolCall(
  name: string,
  args: Record<string, unknown>,
  callExtension: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>,
): Promise<{
  isError?: boolean;
  content: { type: "text" | "image"; text?: string; data?: string; mimeType?: string }[];
}>;
export function createBridgeServer(opts?: { port?: number; token?: string }): {
  server: import("node:http").Server;
  callExtension: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
  isExtensionConnected: () => boolean;
  listen: (listenPort?: number) => Promise<number>;
  close: () => Promise<void>;
};
export function handleMcpJsonRpc(
  msg: Record<string, unknown>,
  callExtension: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>,
): Promise<Record<string, any> | null>;
