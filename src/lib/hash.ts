export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Normalise whitespace so trivial re-renders of the same paragraph hit the cache. */
export const normalizeText = (t: string) => t.replace(/\s+/g, " ").trim();

/** Cache key = hash(paragraph) + target language + model (+ prompt variant). */
export async function translationCacheKey(text: string, targetLang: string, model: string, variant = ""): Promise<string> {
  const h = await sha256Hex(normalizeText(text));
  return `${h}|${targetLang}|${model}${variant ? `|${variant}` : ""}`;
}

/** Cache-key variant for a custom translation prompt: a hash of the FULL trimmed prompt ("" when none). */
export async function promptVariant(extraPrompt: string): Promise<string> {
  const t = extraPrompt.trim();
  return t ? (await sha256Hex(t)).slice(0, 32) : "";
}
