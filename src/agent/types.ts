/** Shared types for the v2 web-action agent (spec v2 §4–§7). */

export type RiskLevel = 0 | 1 | 2 | 3;

/** What the content-script observer reports about one interactive element. */
export interface ElementInfo {
  index: string; // opaque id like "f0:42"
  tag: string; // lower-case tag name
  text: string; // visible text / accessible name, already trimmed
  type?: string; // input type
  role?: string;
  inForm?: boolean;
  /** The element's form contains a password, payment or one-time-code field. */
  formSensitive?: boolean;
  isSubmit?: boolean; // button[type=submit] / input[type=submit] inside a form
  sensitive?: boolean; // password / card / otp field (spec §7.1)
  href?: string;
  occluded?: boolean;
  /** Text of the submit button(s) of the enclosing form, so Enter can be classified like a click on them. */
  formSubmitText?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Serialized element tree, already wrapped-safe text (no raw sensitive values). */
  tree: string;
  /** Ids that appeared since the previous snapshot. */
  newIds?: string[];
}

export interface ActionRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** The page side of the loop. In the extension this talks to the content script; in tests it is a fake. */
export interface PageDriver {
  snapshot(signal?: AbortSignal): Promise<PageSnapshot>;
  describe(index: string): Promise<ElementInfo | undefined>;
  execute(action: ActionRequest, signal?: AbortSignal): Promise<ActionResult>;
  currentUrl(): Promise<string>;
  /** Optional: true when the DOM changed substantially since the last snapshot (modal opened, SPA view swap). */
  domChanged?(): Promise<boolean>;
}

export interface ConfirmRequest {
  action: ActionRequest;
  target?: ElementInfo;
  reason: string;
  /** Present when the action has a scoped kind that "allow this kind / always on this site" can cover. */
  kind?: string;
}

export type ConfirmDecision = "allow-once" | "allow-kind" | "allow-site" | "deny";

/** UI callbacks. All may be async; the loop honours its abort signal while waiting. */
export interface AgentHooks {
  confirm(req: ConfirmRequest, signal?: AbortSignal): Promise<ConfirmDecision>;
  askUser(question: string, options: string[] | undefined, signal?: AbortSignal): Promise<string>;
  onStep?(step: StepRecord): void;
}

export interface StepRecord {
  n: number;
  url: string;
  actions: { name: string; args: unknown; ok: boolean; message: string; blocked?: boolean }[];
}
