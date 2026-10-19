import type { Server } from "node:http";
export const stats: Record<string, number> & { authHeaders: Set<string> };
export function startMock(port?: number): Promise<{ server: Server; port: number }>;
