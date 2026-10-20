/** The 10 + 2 agent tools (spec v2 §5.2), one pi-agent-core tool per action. */
import { Type, type TSchema } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AgentHooks, PageDriver } from "./types";

const Index = Type.String({ description: 'Element id from <browser_state>, e.g. "f0:42"' });

export const ACTION_SCHEMAS = {
  click: Type.Object({ index: Index }),
  input: Type.Object({ index: Index, text: Type.String(), clear: Type.Optional(Type.Boolean()) }),
  select_option: Type.Object({ index: Index, text: Type.String() }),
  scroll: Type.Object({ down: Type.Boolean(), pages: Type.Optional(Type.Number({ minimum: 0.5, maximum: 3 })), index: Type.Optional(Index) }),
  send_keys: Type.Object({ keys: Type.Union(["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map((k) => Type.Literal(k))), index: Type.Optional(Index) }),
  navigate: Type.Object({ url: Type.String() }),
  go_back: Type.Object({}),
  wait: Type.Object({ seconds: Type.Number({ minimum: 0, maximum: 10 }) }),
  extract: Type.Object({ query: Type.String() }),
  search_page: Type.Object({ pattern: Type.String() }),
} satisfies Record<string, TSchema>;

const DESCRIPTIONS: Record<keyof typeof ACTION_SCHEMAS, string> = {
  click: "Click an element by its id.",
  input: "Type text into an input/textarea/contenteditable by id. clear=true replaces existing text.",
  select_option: "Choose an option of a <select> by its visible text.",
  scroll: "Scroll the page (or the element with the given id) up or down by up to 3 pages.",
  send_keys: "Press a single key, optionally focused on an element.",
  navigate: "Open an http(s) URL in the current tab. Ends the current step.",
  go_back: "Go back in history. Ends the current step.",
  wait: "Wait up to 10 seconds for the page to settle.",
  extract: "Read the main content of the page and answer the query from it.",
  search_page: "Find text matching a pattern on the page and report where it is.",
};

/** Actions that change the document; anything queued after them in the same step is dropped. */
export const TERMINATES = new Set(["navigate", "go_back", "done"]);

function text(t: string, isError = false): AgentToolResult<undefined> {
  return { content: [{ type: "text", text: t }], details: undefined, isError };
}

export function buildTools(driver: PageDriver, hooks: AgentHooks): AgentTool<any>[] {
  const actions = (Object.keys(ACTION_SCHEMAS) as (keyof typeof ACTION_SCHEMAS)[]).map(
    (name): AgentTool<any> => ({
      name,
      label: name,
      description: DESCRIPTIONS[name],
      parameters: ACTION_SCHEMAS[name],
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const r = await driver.execute({ name, args: params as Record<string, unknown> }, signal);
        return text(r.message, !r.ok);
      },
    }),
  );
  const askUser: AgentTool<any> = {
    name: "ask_user",
    label: "ask_user",
    description: "Pause and ask the user a question. Use when you need information only they have, or when they must act themselves.",
    parameters: Type.Object({ question: Type.String(), options: Type.Optional(Type.Array(Type.String(), { maxItems: 6 })) }),
    executionMode: "sequential",
    async execute(_id, params, signal) {
      const p = params as { question: string; options?: string[] };
      const answer = await hooks.askUser(p.question, p.options, signal);
      return text(`<user_reply>${answer}</user_reply>`);
    },
  };
  const done: AgentTool<any> = {
    name: "done",
    label: "done",
    description: "Finish the task. Must be the only action in its step.",
    parameters: Type.Object({ text: Type.String(), success: Type.Boolean() }),
    executionMode: "sequential",
    async execute(_id, params) {
      const p = params as { text: string; success: boolean };
      return { ...text(p.text), details: { success: p.success }, terminate: true };
    },
  };
  return [...actions, askUser, done];
}
