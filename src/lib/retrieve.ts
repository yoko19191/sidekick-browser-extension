/**
 * Excerpt selection for chat on documents longer than the model context budget (long web pages, PDFs).
 * Local BM25 over ~1.5k-char passages: no embedding API, so it works with every BYOK provider, and is deterministic.
 * Summaries do not use this; they read the whole document section by section (prompts.ts planLongSummary).
 */

/**
 * Most text a page or PDF hands to chat (~1M chars). Above the prompt budget chat sends retrieved excerpts, so a
 * larger cap costs only message size; summaries still read at most MAX_SECTIONS sections and report coverage.
 */
export const MAX_DOC_CHARS = 1_000_000;

export interface Passage {
  /** Position in the document, for restoring page order. */
  i: number;
  /** Nearest heading above the passage ("Page 12" in PDFs), shown to the model as its location. */
  label: string;
  text: string;
}

export const PASSAGE_CHARS = 1500;

/** Split Markdown on heading / paragraph boundaries into passages of at most ~`size` chars, each labelled. */
export function splitPassages(md: string, size = PASSAGE_CHARS): Passage[] {
  const out: Passage[] = [];
  let label = "";
  let cur = "";
  let curLabel = "";
  const flush = () => {
    if (cur.trim()) out.push({ i: out.length, label: curLabel, text: cur.trim() });
    cur = "";
  };
  for (const block of md.split(/\n{2,}/)) {
    const h = block.match(/^#{1,6}\s+(.+)$/m);
    if (h && block.trim().startsWith("#")) {
      // A heading starts a new passage, so a passage never mixes two sections (or two PDF pages).
      flush();
      label = h[1].trim().slice(0, 80);
    }
    if (!cur) curLabel = label;
    if (cur && cur.length + block.length + 2 > size) {
      flush();
      curLabel = label;
    }
    if (block.length > size) {
      for (let k = 0; k < block.length; k += size) {
        cur = block.slice(k, k + size);
        flush();
        curLabel = label;
      }
      continue;
    }
    cur += (cur ? "\n\n" : "") + block;
  }
  flush();
  return out;
}

const CJK_RUN = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g;
const STOP = new Set(
  "the a an and or of to in on for with is are was were be been it this that these those what which who how why when where do does did can could should would will about from by as at into than then there their its page please tell me explain".split(" "),
);

/** Lower-cased words (Latin, digits) plus character bigrams for CJK runs, which have no spaces to split on. */
export function tokenize(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  for (const w of t.replace(CJK_RUN, " ").match(/[\p{L}\p{N}]+/gu) ?? []) if ((w.length > 1 || /\d/.test(w)) && !STOP.has(w)) out.push(w);
  for (const run of t.match(CJK_RUN) ?? []) {
    if (run.length === 1) out.push(run);
    for (let k = 0; k + 1 < run.length; k++) out.push(run.slice(k, k + 2));
  }
  return out;
}

/** BM25 score of every passage for `query` (k1 = 1.2, b = 0.75). */
export function bm25(passages: Passage[], query: string): number[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !passages.length) return passages.map(() => 0);
  const docs = passages.map((p) => {
    const tf = new Map<string, number>();
    const toks = tokenize(p.label ? `${p.label}\n${p.text}` : p.text);
    for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { tf, len: toks.length };
  });
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length || 1;
  const df = new Map(q.map((w) => [w, docs.filter((d) => d.tf.has(w)).length]));
  return docs.map((d) =>
    q.reduce((s, w) => {
      const f = d.tf.get(w) ?? 0;
      if (!f) return s;
      const n = df.get(w)!;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      return s + (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / avg)));
    }, 0),
  );
}

export interface Selection {
  /** Chosen passages in document order. */
  passages: Passage[];
  /** Characters they add up to. */
  chars: number;
}

/**
 * Pick the passages that best match `query` within `budget` characters, always keeping the opening passage
 * (title, abstract, intro). Returns undefined when nothing matches, so the caller can fall back to the head.
 */
export function selectPassages(passages: Passage[], query: string, budget: number): Selection | undefined {
  const scores = bm25(passages, query);
  const ranked = passages.map((p, k) => ({ p, s: scores[k] })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (!ranked.length) return undefined;
  const chosen = new Map<number, Passage>();
  let used = 0;
  const take = (p: Passage) => {
    if (chosen.has(p.i) || used + p.text.length > budget) return;
    chosen.set(p.i, p);
    used += p.text.length;
  };
  if (passages[0]) take(passages[0]);
  for (const { p } of ranked) take(p);
  return { passages: [...chosen.values()].sort((a, b) => a.i - b.i), chars: used };
}

/** The excerpts as one block, with gaps marked so the model knows the text between them was left out. */
export function formatExcerpts(passages: Passage[]): string {
  let prev = -1;
  return passages
    .map((p) => {
      const gap = p.i !== prev + 1 ? "[…]\n\n" : "";
      prev = p.i;
      return `${gap}${p.label ? `[§ ${p.label}]\n` : ""}${p.text}`;
    })
    .join("\n\n");
}
