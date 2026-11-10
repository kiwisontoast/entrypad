import { describe, expect, it } from "vitest";
import { diagnosticCodes } from "./diagnostics.js";
import {
  defaultSettings,
  fileSettingLines,
  getSetting,
  isValidSetting,
  parseSettingText,
  resolveSettings,
  setSetting,
  settingSpec,
  settingsSpec,
} from "./settings.js";

/** En dash and em dash, built from char codes so this file contains neither. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/** Every leaf of an object, as dotted paths. */
function leaves(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object" ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("settings registry", () => {
  it("lists every setting exactly once, so all of them can be changed", () => {
    const keys = settingsSpec.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(leaves(defaultSettings()).sort());
  });

  it("has a valid default for every setting", () => {
    const defaults = defaultSettings();
    for (const spec of settingsSpec) {
      expect(isValidSetting(spec, getSetting(defaults, spec.key)), spec.key).toBe(true);
    }
  });

  it("gives every setting a label and a scope", () => {
    for (const spec of settingsSpec) {
      expect(spec.label.length, spec.key).toBeGreaterThan(0);
      expect(["file", "app"]).toContain(spec.scope);
    }
  });

  it("covers every check", () => {
    for (const code of diagnosticCodes) expect(settingSpec(`diagnostics.${code}`)).toBeDefined();
  });

  it("uses no dashes that the project style rules out", () => {
    for (const spec of settingsSpec) {
      const text = [spec.label, spec.description, ...("choices" in spec ? spec.choices.map((c) => c.label) : [])];
      for (const t of text) expect(t).not.toMatch(DASHES);
    }
  });
});

describe("changing settings", () => {
  it("returns a new object and leaves the old one alone", () => {
    const before = defaultSettings();
    const after = setSetting(before, "parsing.tabWidth", 2);
    expect(after.parsing.tabWidth).toBe(2);
    expect(before.parsing.tabWidth).toBe(4);
    expect(after.accounts).toBe(before.accounts);
  });

  it("rejects unknown keys and bad values", () => {
    expect(() => setSetting(defaultSettings(), "parsing.nope", true)).toThrow(RangeError);
    expect(() => setSetting(defaultSettings(), "parsing.tabWidth", 0)).toThrow(RangeError);
    expect(() => setSetting(defaultSettings(), "parsing.dateOrder", "sideways")).toThrow(RangeError);
  });

  it("turns a check off", () => {
    const s = setSetting(defaultSettings(), "diagnostics.zero-amount", "off");
    expect(s.diagnostics["zero-amount"]).toBe("off");
  });
});

describe("resolveSettings", () => {
  it("layers overrides over the defaults and reports what it skipped", () => {
    const { settings, ignored } = resolveSettings(
      { parsing: { tabWidth: 2, dateOrder: "day-first" } },
      { "autofix.inferBlankAmount": false, "display.showDiagnostics": "yes", "made.up": 1 },
    );
    expect(settings.parsing.tabWidth).toBe(2);
    expect(settings.parsing.dateOrder).toBe("day-first");
    expect(settings.autofix.inferBlankAmount).toBe(false);
    expect(settings.display.showDiagnostics).toBe(true);
    expect(ignored.sort()).toEqual(["display.showDiagnostics", "made.up"]);
  });

  it("ignores junk without throwing", () => {
    expect(resolveSettings(null, 42, "text", [1, 2]).ignored).toEqual([]);
  });
});

describe("set lines in the shorthand", () => {
  it("reads values the way people write them", () => {
    expect(parseSettingText(settingSpec("autofix.inferBlankAmount")!, "off")).toBe(false);
    expect(parseSettingText(settingSpec("autofix.inferBlankAmount")!, "Yes")).toBe(true);
    expect(parseSettingText(settingSpec("parsing.dateOrder")!, "Day-First")).toBe("day-first");
    expect(parseSettingText(settingSpec("book.decimals")!, "2")).toBe(2);
    expect(parseSettingText(settingSpec("sharing.linkWarningLength")!, "12,000")).toBe(12000);
    expect(parseSettingText(settingSpec("parsing.tabWidth")!, "9")).toBeUndefined();
    expect(parseSettingText(settingSpec("parsing.dateOrder")!, "sideways")).toBeUndefined();
  });

  it("writes only file settings that differ from the defaults", () => {
    let s = defaultSettings();
    expect(fileSettingLines(s)).toEqual([]);
    s = setSetting(s, "parsing.tabWidth", 2);
    s = setSetting(s, "diagnostics.zero-amount", "off");
    s = setSetting(s, "display.showDiagnostics", false); // personal, not written
    expect(fileSettingLines(s)).toEqual(["set parsing.tabWidth 2", "set diagnostics.zero-amount off"]);
  });
});
