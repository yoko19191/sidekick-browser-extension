import type { Server } from "node:http";
export const stats: { translateRequests: number; translatedItems: number; chatRequests: number; authHeaders: Set<string> };
export function startMock(port?: number): Promise<{ server: Server; port: number }>;
