// @vitest-environment jsdom
import { expect, it } from "vitest";
import { PageObserver } from "../../src/agent/page/observer";
import { classify, effectiveLevel } from "../../src/agent/risk";

it("Enter in a real payment form asks even after submit was allowed for the task", () => {
  document.body.innerHTML = `<form><input type="text" name="coupon"><button type="submit">Pay now</button></form>`;
  const o = new PageObserver(document);
  const snap = o.snapshot();
  const id = snap.tree.match(/\[(f\d+:\d+)\]<input/)![1];
  const info = o.describe(id)!;
  expect(info.formSubmitText).toBe("Pay now");
  const v = classify({ name: "send_keys", args: { index: id, keys: "Enter" } }, info, { currentUrl: "https://shop.example.com/", startSite: "example.com" });
  expect(effectiveLevel(v, new Set(["submit:example.com"]))).toBe(2);
});
