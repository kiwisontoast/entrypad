import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { settingsSpec } from "./settings.js";

const doc = readFileSync(new URL("../../../docs/shorthand.md", import.meta.url), "utf8");

describe("docs/shorthand.md", () => {
  it("documents every setting a book file can carry", () => {
    const fileKeys = settingsSpec
      .filter((s) => s.scope === "file" && !s.key.startsWith("diagnostics."))
      .map((s) => s.key);
    for (const key of fileKeys) expect(doc, key).toContain(`\`${key}\``);
    expect(doc).toContain("`diagnostics.<code>`");
  });

  it("documents no settings that don't exist or can't go in a file", () => {
    const documented = [...doc.matchAll(/^\| `([a-z]+\.[A-Za-z]+)` \|/gm)].map((m) => m[1]);
    const fileKeys = new Set(settingsSpec.filter((s) => s.scope === "file").map((s) => s.key));
    for (const key of documented) expect(fileKeys.has(key!), key).toBe(true);
  });

  it("lists every check's code", () => {
    for (const s of settingsSpec.filter((s) => s.key.startsWith("diagnostics."))) {
      expect(doc).toContain(`\`${s.key.slice("diagnostics.".length)}\``);
    }
  });
});
