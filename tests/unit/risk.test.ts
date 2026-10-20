import { describe, expect, it } from "vitest";
import { classify, effectiveLevel } from "../../src/agent/risk";

const ctx = { currentUrl: "https://www.shop.example.com/a", startSite: "example.com" };

describe("risk classify", () => {
  it("read-only is R0", () => expect(classify({ name: "scroll", args: {} }, undefined, ctx).level).toBe(0));
  it("same-site navigate is R1, cross-site R2, non-http R3", () => {
    expect(classify({ name: "navigate", args: { url: "https://m.example.com/x" } }, undefined, ctx).level).toBe(1);
    expect(classify({ name: "navigate", args: { url: "https://other.org/" } }, undefined, ctx).level).toBe(2);
    expect(classify({ name: "navigate", args: { url: "javascript:alert(1)" } }, undefined, ctx).level).toBe(3);
  });
  it("submit and consequential buttons are R2", () => {
    expect(classify({ name: "click", args: { index: "1" } }, { index: "1", tag: "button", text: "Go", isSubmit: true }, ctx).level).toBe(2);
    expect(classify({ name: "click", args: { index: "1" } }, { index: "1", tag: "button", text: "删除订单" }, ctx).level).toBe(2);
    expect(classify({ name: "click", args: { index: "1" } }, { index: "1", tag: "a", text: "Next page" }, ctx).level).toBe(1);
  });
  it("sensitive fields and never-list sites are R3", () => {
    expect(classify({ name: "input", args: { index: "1" } }, { index: "1", tag: "input", text: "", sensitive: true }, ctx).level).toBe(3);
    expect(classify({ name: "scroll", args: {} }, undefined, { ...ctx, currentUrl: "https://www.paypal.com/" }).level).toBe(3);
    expect(classify({ name: "scroll", args: {} }, undefined, { ...ctx, currentUrl: "chrome://settings" }).level).toBe(3);
  });
  it("a link to a never-list site is R3 like navigate", () => {
    expect(classify({ name: "click", args: { index: "1" } }, { index: "1", tag: "a", text: "pay", href: "https://www.paypal.com/x" }, ctx).level).toBe(3);
  });
  it("allow-kind downgrades R2 but never R3", () => {
    const v = classify({ name: "click", args: { index: "1" } }, { index: "1", tag: "button", text: "x", isSubmit: true }, ctx);
    expect(effectiveLevel(v, new Set(["submit:example.com"]))).toBe(1);
    expect(effectiveLevel({ level: 3, reason: "", kind: "submit" }, new Set(["submit"]))).toBe(3);
  });
});
