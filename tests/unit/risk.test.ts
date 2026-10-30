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
  it("Enter in a payment or delete form always asks, even when submit was allowed for the task", () => {
    const allowed = new Set(["submit:example.com"]);
    const enter = { name: "send_keys", args: { index: "1", keys: "Enter" } };
    const pay = classify(enter, { index: "1", tag: "input", text: "", inForm: true, formSubmitText: "Pay now" }, ctx);
    expect(pay.kind).toBeUndefined();
    expect(effectiveLevel(pay, allowed)).toBe(2);
    const del = classify(enter, { index: "1", tag: "input", text: "", inForm: true, formSubmitText: "Delete account" }, ctx);
    expect(effectiveLevel(del, allowed)).toBe(2);
    const plain = classify(enter, { index: "1", tag: "input", text: "", inForm: true, formSubmitText: "Search" }, ctx);
    expect(effectiveLevel(plain, allowed)).toBe(1);
  });
});

describe("forms with password or payment fields always confirm (no allow-kind)", () => {
  const t = { index: "1", tag: "input", text: "Name", inForm: true, formSubmitText: "Continue", formSensitive: true };
  it("Enter in a payment form whose button says Continue", () => {
    const v = classify({ name: "send_keys", args: { index: "1", keys: "Enter" } }, t, ctx);
    expect(v.level).toBe(2);
    expect(v.kind).toBeUndefined();
  });
  it("Enter in a payment form with a search-like input named q", () => {
    const v = classify({ name: "send_keys", args: { index: "1", keys: "Enter" } }, { ...t, type: "search", text: "q" }, ctx);
    expect(v.level).toBe(2);
    expect(v.kind).toBeUndefined();
  });
  it("clicking Continue in a payment form", () => {
    const v = classify({ name: "click", args: { index: "2" } }, { index: "2", tag: "button", text: "Continue", isSubmit: true, inForm: true, formSensitive: true }, ctx);
    expect(v.level).toBe(2);
    expect(v.kind).toBeUndefined();
  });
  it("a plain form still gets an allow-kind", () => {
    expect(classify({ name: "click", args: { index: "2" } }, { index: "2", tag: "button", text: "Go", isSubmit: true, inForm: true }, ctx).kind).toMatch(/^submit:/);
  });
});

describe("buttons that submit their form without being type=submit", () => {
  const click = { name: "click", args: { index: "1" } };
  it("a plain-form 提交 button (type=button, script handler) is a form submit with the site-wide submit kind", () => {
    const v = classify(click, { index: "1", tag: "button", text: "提交", inForm: true }, ctx);
    expect(v).toMatchObject({ level: 2, reason: "submits a form", kind: "submit:example.com" });
    expect(effectiveLevel(v, new Set(["submit:example.com"]))).toBe(1);
  });
  it("the same kind of button in a password/payment form asks every time and offers no allow-kind", () => {
    const v = classify(click, { index: "1", tag: "button", text: "Confirm", inForm: true, formSensitive: true }, ctx);
    expect(v.level).toBe(2);
    expect(v.kind).toBeUndefined();
    expect(effectiveLevel(v, new Set(["submit:example.com"]))).toBe(2);
  });
  it("payment wording still wins over the submit rule", () => {
    expect(classify(click, { index: "1", tag: "button", text: "Pay now", inForm: true }, ctx).kind).toBeUndefined();
  });
  it("outside any form a consequential button keeps its per-label kind", () => {
    expect(classify(click, { index: "1", tag: "div", role: "button", text: "Post" }, ctx).kind).toBe("consequential:example.com:post");
  });
  it("an ordinary in-form button is still an ordinary click", () => {
    expect(classify(click, { index: "1", tag: "button", text: "Show password rules", inForm: true }, ctx).level).toBe(1);
  });
});
