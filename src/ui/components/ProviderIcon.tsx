import { Globe2 } from "lucide-react";
import { useId, useMemo } from "react";
import anthropicSvg from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import deepseekSvg from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import doubaoSvg from "@lobehub/icons-static-svg/icons/doubao-color.svg?raw";
import geminiSvg from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import githubCopilotSvg from "@lobehub/icons-static-svg/icons/githubcopilot.svg?raw";
import groqSvg from "@lobehub/icons-static-svg/icons/groq.svg?raw";
import kimiSvg from "@lobehub/icons-static-svg/icons/kimi-color.svg?raw";
import metaSvg from "@lobehub/icons-static-svg/icons/meta-color.svg?raw";
import mistralSvg from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import ollamaSvg from "@lobehub/icons-static-svg/icons/ollama.svg?raw";
import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import openrouterSvg from "@lobehub/icons-static-svg/icons/openrouter.svg?raw";
import qwenSvg from "@lobehub/icons-static-svg/icons/qwen-color.svg?raw";
import siliconcloudSvg from "@lobehub/icons-static-svg/icons/siliconcloud-color.svg?raw";
import xaiSvg from "@lobehub/icons-static-svg/icons/grok.svg?raw";
import zhipuSvg from "@lobehub/icons-static-svg/icons/zhipu-color.svg?raw";
import { cn } from "./ui";

const PROVIDER_SVGS: Record<string, string> = {
  deepseek: deepseekSvg,
  openai: openaiSvg,
  moonshot: kimiSvg,
  "kimi-coding": kimiSvg,
  qwen: qwenSvg,
  zhipu: zhipuSvg,
  openrouter: openrouterSvg,
  anthropic: anthropicSvg,
  gemini: geminiSvg,
  ollama: ollamaSvg,
  "github-copilot": githubCopilotSvg,
  xai: xaiSvg,
  siliconflow: siliconcloudSvg,
  volcengine: doubaoSvg,
  groq: groqSvg,
  mistral: mistralSvg,
  meta: metaSvg,
};

function namespaceSvgIds(svg: string, prefix: string): string {
  return svg
    .replace(/\bid="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
}

export const hasProviderIcon = (presetId: string): boolean => Boolean(PROVIDER_SVGS[presetId]);

export function ProviderIcon({ presetId, className, size = 18 }: { presetId: string; className?: string; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const raw = PROVIDER_SVGS[presetId];
  const html = useMemo(() => (raw ? namespaceSvgIds(raw, `lobe-${uid}`) : ""), [raw, uid]);

  if (!html) {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center leading-none text-muted-foreground", className)} style={{ width: size, height: size }}>
        <Globe2 style={{ width: size * 0.9, height: size * 0.9 }} />
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center leading-none [&>svg]:block [&>svg]:size-full", className)}
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
