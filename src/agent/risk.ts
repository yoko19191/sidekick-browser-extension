/** Risk grading R0–R3 (spec v2 §7.1, §7.2). Pure functions so they can be unit-tested without a browser. */
import { getDomain } from "tldts";
import type { ActionRequest, ElementInfo, RiskLevel } from "./types";

const CONSEQUENTIAL =
  /提交|发送|发布|购买|支付|付款|下单|删除|确认|授权|订阅|转账|注销|\b(submit|send|post|publish|buy|purchase|pay|checkout|order|delete|remove|confirm|authori[sz]e|subscribe|transfer)\b/i;

/** Sites the agent never acts on (built-in part of the "never" list; users can add more). */
export const BUILTIN_NEVER = [
  "paypal.com", "stripe.com", "alipay.com", "pay.weixin.qq.com",
  "icbc.com.cn", "ccb.com", "boc.cn", "abchina.com", "bankcomm.com", "cmbchina.com",
  "chase.com", "bankofamerica.com", "wellsfargo.com",
];

export function siteOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    return getDomain(host) ?? host;
  } catch {
    return "";
  }
}

function isForbiddenUrl(url: string, never: string[]): boolean {
  if (/^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url)) return true;
  if (/^https:\/\/chromewebstore\.google\.com\//i.test(url) || /^https:\/\/chrome\.google\.com\/webstore/i.test(url)) return true;
  const site = siteOf(url);
  return !!site && never.some((d) => site === d || site.endsWith("." + d));
}

export interface RiskContext {
  currentUrl: string;
  /** Site (eTLD+1) the task started on. */
  startSite: string;
  never?: string[];
  /** Kinds the user already allowed for this task ("allow-kind"). */
  allowedKinds?: Set<string>;
}

export interface RiskVerdict {
  level: RiskLevel;
  reason: string;
  /** Stable key for "allow this kind for the rest of the task". */
  kind?: string;
}

export function classify(action: ActionRequest, target: ElementInfo | undefined, ctx: RiskContext): RiskVerdict {
  const never = [...BUILTIN_NEVER, ...(ctx.never ?? [])];
  if (isForbiddenUrl(ctx.currentUrl, never)) return { level: 3, reason: "current site is on the never-act list" };
  const a = action.args as Record<string, string | undefined>;

  switch (action.name) {
    case "scroll":
    case "wait":
    case "extract":
    case "search_page":
      return { level: 0, reason: "read-only" };

    case "navigate": {
      const url = String(a.url ?? "");
      if (!/^https?:\/\//i.test(url)) return { level: 3, reason: "only http(s) URLs are allowed" };
      if (isForbiddenUrl(url, never)) return { level: 3, reason: "target site is on the never-act list" };
      if (siteOf(url) !== ctx.startSite) return { level: 2, reason: `navigates to another site: ${siteOf(url)}`, kind: `cross-site:${siteOf(url)}` };
      return { level: 1, reason: "same-site navigation" };
    }
    case "go_back":
      return { level: 1, reason: "go back" };
  }

  if (target?.sensitive) return { level: 3, reason: "password, payment or one-time-code fields must be filled by the user" };
  if (target?.type === "file") return { level: 3, reason: "file pickers must be operated by the user" };

  switch (action.name) {
    case "input":
    case "select_option":
      return { level: 1, reason: "fills a normal field" };
    case "send_keys": {
      const keys = String(a.keys ?? "");
      if (keys === "Enter" && target?.inForm) return { level: 2, reason: "Enter inside a form submits it", kind: "submit" };
      return { level: 1, reason: "key press" };
    }
    case "click": {
      if (target?.isSubmit) return { level: 2, reason: "submits a form", kind: "submit" };
      const label = `${target?.text ?? ""} ${target?.role ?? ""}`;
      if (CONSEQUENTIAL.test(label)) return { level: 2, reason: `button "${(target?.text ?? "").slice(0, 30)}" may have consequences`, kind: "consequential" };
      if (target?.href && /^https?:/i.test(target.href) && siteOf(target.href) !== ctx.startSite)
        return { level: 2, reason: `link leads to another site: ${siteOf(target.href)}`, kind: `cross-site:${siteOf(target.href)}` };
      return { level: 1, reason: "ordinary click" };
    }
  }
  return { level: 1, reason: "ordinary interaction" };
}

/** Apply per-task "allow this kind" decisions. Never downgrades R3. */
export function effectiveLevel(v: RiskVerdict, allowed: Set<string> | undefined): RiskLevel {
  if (v.level === 2 && v.kind && allowed?.has(v.kind)) return 1;
  return v.level;
}
