#!/usr/bin/env node
// Fails (exit 1) if the built manifest's permission set differs from scripts/permissions.allowlist.json.
// Usage: npm run build && npm run check:permissions [path/to/manifest.json]
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.argv[2] ?? ".output/chrome-mv3/manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`✗ manifest not found: ${manifestPath} (run \`npm run build\` first)`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const allow = JSON.parse(readFileSync(new URL("./permissions.allowlist.json", import.meta.url), "utf8"));
const keys = ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions"];
let failed = false;
for (const k of keys) {
  const actual = new Set(manifest[k] ?? []);
  const expected = new Set(allow[k] ?? []);
  const added = [...actual].filter((p) => !expected.has(p));
  const removed = [...expected].filter((p) => !actual.has(p));
  if (added.length || removed.length) {
    failed = true;
    if (added.length) console.error(`✗ ${k}: not in allowlist → ${added.join(", ")}`);
    if (removed.length) console.error(`✗ ${k}: in allowlist but missing → ${removed.join(", ")}`);
  }
}
// content_scripts declared in the manifest would silently imply host access; v1 injects on demand only.
if ((manifest.content_scripts ?? []).length) {
  failed = true;
  console.error("✗ content_scripts: manifest-declared content scripts are not allowed (inject on demand via scripting)");
}
if (failed) {
  console.error("\nPermission set changed. If intended, update scripts/permissions.allowlist.json and PERMISSIONS.md in the same PR.");
  process.exit(1);
}
console.log(`✓ permissions match allowlist (${manifestPath})`);
