// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BLINK_SELECTOR, DRAWING, MASCOT_STATES, Mascot, showDrawing } from "../../src/ui/mascot/Mascot";
import raw from "../../assets/mascot/fanfan-layered.svg?raw";

describe("Mascot art contract", () => {
  it("the designer SVG has the required layers", () => {
    const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
    expect(doc.getElementById("ff-body")).not.toBeNull();
    expect(doc.getElementById("ff-face") ?? doc.getElementById("ff-eyes")).not.toBeNull();
    expect(doc.querySelector('[data-state="idle"]')).not.toBeNull();
  });

  it("every state resolves to exactly one visible drawing per data-state group", () => {
    const host = document.createElement("div");
    host.innerHTML = raw;
    const drawings = new Set([...host.querySelectorAll("[data-state]")].map((e) => e.getAttribute("data-state")));
    for (const st of MASCOT_STATES) {
      const shown = showDrawing(host, DRAWING[st]);
      expect(shown).toHaveLength(1);
      const want = DRAWING[st].find((k) => drawings.has(k)) ?? "idle"; // missing drawing → idle + in-code motion
      expect(shown[0].getAttribute("data-state")).toBe(want);
      expect(host.querySelectorAll('[data-state][display="inline"]')).toHaveLength(1);
    }
  });

  it("ids are namespaced per instance (two mascots never share gradient ids)", () => {
    const html = renderToStaticMarkup(createElement("div", null, createElement(Mascot, { size: 40 }), createElement(Mascot, { size: 20, still: true })));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(m[1]);
    expect(html).not.toMatch(/<svg[^>]*\swidth=/);
  });

  it("blink only targets the idle eye shapes, never the <svg> itself", () => {
    const host = document.createElement("span");
    host.setAttribute("data-state", "idle"); // the component host carries data-state too
    host.innerHTML = raw;
    const hits = [...host.querySelectorAll(BLINK_SELECTOR)];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((el) => el.tagName.toLowerCase() === "svg")).toBe(false);
    for (const el of hits) expect(el.closest('[data-state="idle"]')).not.toBe(host);
  });
});
