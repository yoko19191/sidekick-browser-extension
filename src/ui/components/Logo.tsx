import { useEffect, useState } from "react";
import type { McpBridgeStatus, McpIndicatorState } from "@/src/agent/mcp-bridge";
import { Mascot } from "../mascot/Mascot";
import { bg } from "../messaging";
import { cn } from "./ui";

const DOT_CLASS: Record<Exclude<McpIndicatorState, "off">, string> = {
  active: "bg-emerald-500",
  idle: "bg-blue-500",
  error: "bg-red-500",
};

/** 翻翻 Sidekick mark: the mascot, static (onboarding / options headers), with bottom-right MCP status dot when enabled. */
export function Logo({ size = 26 }: { size?: number }) {
  const [indicator, setIndicator] = useState<McpIndicatorState>("off");

  useEffect(() => {
    if (!globalThis.chrome?.runtime?.sendMessage) return;
    let alive = true;
    const poll = () => {
      bg<McpBridgeStatus>({ type: "mcp:status" })
        .then((s) => {
          if (alive && s) setIndicator(s.indicator ?? (!s.enabled ? "off" : s.connected ? "idle" : "error"));
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <Mascot state="idle" still size={size} />
      {indicator !== "off" && (
        <span
          data-testid="logo-mcp-dot"
          data-indicator={indicator}
          className={cn(
            "pointer-events-none absolute right-0 bottom-0 rounded-full ring-2 ring-background",
            DOT_CLASS[indicator],
            indicator === "active" && "animate-pulse",
          )}
          style={{ width: Math.max(7, Math.round(size * 0.3)), height: Math.max(7, Math.round(size * 0.3)) }}
        />
      )}
    </span>
  );
}
