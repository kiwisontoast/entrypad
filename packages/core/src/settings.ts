import { diagnosticCodes, diagnosticDefaults, diagnosticLabels } from "./diagnostics.js";
import type { DiagnosticCode, Severity } from "./diagnostics.js";

/**
 * Every choice Entrypad makes on the user's behalf is a setting with a
 * default. Nothing is hard-wired: the parser, the rules, the autofixes and
 * the visuals all read from here.
 */
export interface EntrypadSettings {
  book: {
    /** Show amounts in whole dollars or with cents. */
    decimals: 0 | 2;
  };
  parsing: {
    /** Columns a tab advances to (the next multiple of this). */
    tabWidth: number;
    /** How to read a date like 1/3. */
    dateOrder: "month-first" | "day-first";
    /** A date without a year takes the year that puts it inside the book's period. */
    yearFromPeriod: boolean;
    /** Otherwise it takes the year of the nearest dated entry above it. */
    yearFromPreviousEntry: boolean;
    /** Lines starting with # are comments. */
    hashComments: boolean;
    /** Lines starting with ; are comments, as in hledger. */
    semicolonComments: boolean;
    /** Allow a comment after the content on the same line. */
    endOfLineComments: boolean;
    /** Treat non-breaking spaces (common in text pasted from Word) as ordinary spaces. */
    normalizeSpaces: boolean;
    /** A blank line ends the entry above it. */
    blankLineEndsEntry: boolean;
    /** Accept 10k for 10,000. */
    thousandsSuffix: boolean;
    /** How to read an amount written as negative or in parentheses. */
    negativeAmounts: "same-side" | "other-side" | "invalid";
    /** In the one-line form, when a comma separates two postings. */
    oneLineCommas: "after-amount" | "always";
    /** Which book line counts when a file has several. */
    duplicateBook: "last-wins" | "first-wins";
  };
  accounts: {
    ignoreCase: boolean;
    /** Runs of spaces in a name count as one. */
    collapseSpaces: boolean;
    matchAliases: boolean;
    /** Match an account by its id, e.g. accounts-receivable. */
    matchIds: boolean;
  };
  autofix: {
    /** Fill in the one blank amount that balances an entry. */
    inferBlankAmount: boolean;
    /** Offer the nearest account name for an unknown one. */
    suggestNearestAccount: boolean;
  };
  diagnostics: Record<DiagnosticCode, Severity>;
  hledger: {
    /** How imported account names are matched to the chart. */
    importMatch: "last-segment" | "full-name";
    /** Keep directives Entrypad doesn't use as comments. */
    keepUnsupportedAsComments: boolean;
    /** How accounts are named in an exported journal. */
    exportAccountNames: "type-prefixed" | "plain";
    /** Write a $ before exported amounts. */
    exportCurrencySymbol: boolean;
  };
  display: {
    /** Draw squiggles in the editor. */
    showDiagnostics: boolean;
    /** Draw the unchanging parts of a visual as memoized components (faster drags). */
    staticPartsAsComponents: boolean;
    /** Make each drag follow one finger and abandon drags the browser cancels. */
    singlePointerDrags: boolean;
    /** A finger on an empty part of a visual scrolls and zooms the page. */
    touchScroll: boolean;
  };
  export: {
    /** Include squiggles in exported files. */
    includeDiagnostics: boolean;
    /** Pixel density of PNG exports. */
    pngScale: 1 | 2 | 3;
    /** Embed fonts in SVG exports so slides render them exactly. */
    embedFonts: boolean;
  };
  sharing: {
    /** Suggest a file instead of a link above this many characters. */
    linkWarningLength: number;
  };
}

/** Settings that change how a book is read travel with the file; the rest are personal. */
export type SettingScope = "file" | "app";

export type SettingValue = boolean | number | string;

interface SpecBase {
  /** Dotted path, e.g. "parsing.tabWidth". */
  key: string;
  group: string;
  label: string;
  description: string;
  scope: SettingScope;
}

export type SettingSpec = SpecBase &
  (
    | { type: "boolean" }
    | { type: "choice"; choices: readonly { value: string | number; label: string }[] }
    | { type: "number"; min: number; max: number; step: number }
  );

export function defaultSettings(): EntrypadSettings {
  return {
    book: { decimals: 0 },
    parsing: {
      tabWidth: 4,
      dateOrder: "month-first",
      yearFromPeriod: true,
      yearFromPreviousEntry: true,
      hashComments: true,
      semicolonComments: true,
      endOfLineComments: false,
      normalizeSpaces: true,
      blankLineEndsEntry: true,
      thousandsSuffix: true,
      negativeAmounts: "same-side",
      oneLineCommas: "after-amount",
      duplicateBook: "last-wins",
    },
    accounts: { ignoreCase: true, collapseSpaces: true, matchAliases: true, matchIds: true },
    autofix: { inferBlankAmount: true, suggestNearestAccount: true },
    diagnostics: { ...diagnosticDefaults },
    hledger: {
      importMatch: "last-segment",
      keepUnsupportedAsComments: true,
      exportAccountNames: "type-prefixed",
      exportCurrencySymbol: true,
    },
    display: { showDiagnostics: true, staticPartsAsComponents: true, singlePointerDrags: true, touchScroll: true },
    export: { includeDiagnostics: false, pngScale: 2, embedFonts: true },
    sharing: { linkWarningLength: 8000 },
  };
}

const onOff = { type: "boolean" } as const;
const severityChoices = [
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
  { value: "hint", label: "Hint" },
  { value: "off", label: "Off" },
] as const;

/** Every setting, in the order the settings screen shows them. */
export const settingsSpec: readonly SettingSpec[] = [
  {
    key: "book.decimals",
    group: "Book",
    label: "Amounts shown",
    description: "Whole dollars or dollars and cents. Amounts are always stored exactly.",
    scope: "file",
    type: "choice",
    choices: [
      { value: 0, label: "Whole dollars" },
      { value: 2, label: "Dollars and cents" },
    ],
  },
  {
    key: "parsing.tabWidth",
    group: "Reading the shorthand",
    label: "Tab width",
    description: "A tab advances to the next multiple of this many columns when lining up debits and credits.",
    scope: "file",
    type: "number",
    min: 1,
    max: 8,
    step: 1,
  },
  {
    key: "parsing.dateOrder",
    group: "Reading the shorthand",
    label: "Date order",
    description: "How a date like 1/3 is read.",
    scope: "file",
    type: "choice",
    choices: [
      { value: "month-first", label: "Month first (1/3 is January 3)" },
      { value: "day-first", label: "Day first (1/3 is 1 March)" },
    ],
  },
  {
    key: "parsing.yearFromPeriod",
    group: "Reading the shorthand",
    label: "Take a missing year from the book's period",
    description: "A date without a year gets the year that puts it inside the period.",
    scope: "file",
    ...onOff,
  },
  {
    key: "parsing.yearFromPreviousEntry",
    group: "Reading the shorthand",
    label: "Otherwise take it from the entry above",
    description: "Use the year of the nearest dated entry above. If neither applies, the current year is used.",
    scope: "file",
    ...onOff,
  },
  {
    key: "parsing.hashComments",
    group: "Reading the shorthand",
    label: "Lines starting with # are comments",
    description: "",
    scope: "file",
    ...onOff,
  },
  {
    key: "parsing.semicolonComments",
    group: "Reading the shorthand",
    label: "Lines starting with ; are comments",
    description: "As in hledger and ledger journals.",
    scope: "file",
    ...onOff,
  },
  {
    key: "parsing.endOfLineComments",
    group: "Reading the shorthand",
    label: "Allow comments at the end of a line",
    description: "When off, a memo such as Invoice #12 is read as written.",
    scope: "file",
    ...onOff,
  },
  {
    key: "parsing.normalizeSpaces",
    group: "Reading the shorthand",
    label: "Treat non-breaking spaces as spaces",
    description: "Text pasted from Word or a web page then lines up the way it looks.",
    scope: "file",
    ...onOff,
  },
  {
    key: "parsing.blankLineEndsEntry",
    group: "Reading the shorthand",
    label: "A blank line ends an entry",
    description: "When off, an entry runs until the next date line or directive.",
    scope: "file",
    ...onOff,
  },
  {
    key: "parsing.thousandsSuffix",
    group: "Reading the shorthand",
    label: "Accept k for thousands",
    description: "10k is read as 10,000.",
    scope: "file",
    ...onOff,
  },
  {
    key: "parsing.negativeAmounts",
    group: "Reading the shorthand",
    label: "Negative amounts",
    description: "How to read -500 or (500) on a posting line. Each case is flagged.",
    scope: "file",
    type: "choice",
    choices: [
      { value: "same-side", label: "Read as 500 on the line's own side" },
      { value: "other-side", label: "Read as 500 on the other side" },
      { value: "invalid", label: "Treat as an unreadable amount" },
    ],
  },
  {
    key: "parsing.oneLineCommas",
    group: "Reading the shorthand",
    label: "Commas in the one-line form",
    description: "When a comma separates two postings, e.g. Cash 4000, Notes Payable 4000.",
    scope: "file",
    type: "choice",
    choices: [
      { value: "after-amount", label: "Only after an amount (keeps names with commas whole)" },
      { value: "always", label: "Always" },
    ],
  },
  {
    key: "parsing.duplicateBook",
    group: "Reading the shorthand",
    label: "More than one book line",
    description: "Which one counts.",
    scope: "file",
    type: "choice",
    choices: [
      { value: "last-wins", label: "The last one" },
      { value: "first-wins", label: "The first one" },
    ],
  },
  {
    key: "accounts.ignoreCase",
    group: "Matching account names",
    label: "Ignore capitalization",
    description: "",
    scope: "file",
    ...onOff,
  },
  {
    key: "accounts.collapseSpaces",
    group: "Matching account names",
    label: "Ignore extra spaces",
    description: "",
    scope: "file",
    ...onOff,
  },
  {
    key: "accounts.matchAliases",
    group: "Matching account names",
    label: "Match aliases",
    description: "A/R matches Accounts Receivable.",
    scope: "file",
    ...onOff,
  },
  {
    key: "accounts.matchIds",
    group: "Matching account names",
    label: "Match account ids",
    description: "accounts-receivable matches Accounts Receivable.",
    scope: "file",
    ...onOff,
  },
  {
    key: "autofix.inferBlankAmount",
    group: "Automatic fixes",
    label: "Fill in a blank amount",
    description: "When one line of an entry has no amount, fill in the amount that balances it.",
    scope: "file",
    ...onOff,
  },
  {
    key: "autofix.suggestNearestAccount",
    group: "Automatic fixes",
    label: "Suggest the nearest account name",
    description: "Offer a fix for an account name that isn't in the chart.",
    scope: "app",
    ...onOff,
  },
  ...diagnosticCodes.map(
    (code): SettingSpec => ({
      key: `diagnostics.${code}`,
      group: "Checks",
      label: diagnosticLabels[code],
      description: `Code: ${code}`,
      scope: "file",
      type: "choice",
      choices: severityChoices,
    }),
  ),
  {
    key: "hledger.importMatch",
    group: "hledger and ledger",
    label: "Match imported accounts by",
    description: "",
    scope: "file",
    type: "choice",
    choices: [
      { value: "last-segment", label: "The last part (assets:cash matches Cash)" },
      { value: "full-name", label: "The full name" },
    ],
  },
  {
    key: "hledger.keepUnsupportedAsComments",
    group: "hledger and ledger",
    label: "Keep unused directives as comments",
    description: "When off, they are dropped on import.",
    scope: "file",
    ...onOff,
  },
  {
    key: "hledger.exportAccountNames",
    group: "hledger and ledger",
    label: "Exported account names",
    description: "",
    scope: "file",
    type: "choice",
    choices: [
      { value: "type-prefixed", label: "With the type (assets:cash)" },
      { value: "plain", label: "As in the chart (Cash)" },
    ],
  },
  {
    key: "hledger.exportCurrencySymbol",
    group: "hledger and ledger",
    label: "Write $ before exported amounts",
    description: "",
    scope: "file",
    ...onOff,
  },
  {
    key: "display.showDiagnostics",
    group: "Display",
    label: "Show squiggles",
    description: "Underline problems in the editor. Squiggles never appear in present mode or embeds.",
    scope: "app",
    ...onOff,
  },
  {
    key: "display.staticPartsAsComponents",
    group: "Display",
    label: "Faster dragging",
    description: "Draw the unchanging parts of each visual once instead of on every frame.",
    scope: "app",
    ...onOff,
  },
  {
    key: "display.singlePointerDrags",
    group: "Display",
    label: "One finger per drag",
    description: "Ignore other fingers during a drag, and drop a drag the browser cancels.",
    scope: "app",
    ...onOff,
  },
  {
    key: "display.touchScroll",
    group: "Display",
    label: "Scroll with a finger on visuals",
    description:
      "A finger on an empty part of a visual scrolls or zooms the page. A finger on something you can drag still drags it.",
    scope: "app",
    ...onOff,
  },
  {
    key: "export.includeDiagnostics",
    group: "Export",
    label: "Include squiggles in exports",
    description: "Off by default, so exported slides stay clean.",
    scope: "app",
    ...onOff,
  },
  {
    key: "export.pngScale",
    group: "Export",
    label: "PNG resolution",
    description: "",
    scope: "app",
    type: "choice",
    choices: [
      { value: 1, label: "1x" },
      { value: 2, label: "2x" },
      { value: 3, label: "3x" },
    ],
  },
  {
    key: "export.embedFonts",
    group: "Export",
    label: "Embed fonts in SVG files",
    description: "So PowerPoint and Keynote show the same lettering.",
    scope: "app",
    ...onOff,
  },
  {
    key: "sharing.linkWarningLength",
    group: "Sharing",
    label: "Suggest a file above this link length",
    description: "Very long links can break in some apps.",
    scope: "app",
    type: "number",
    min: 1000,
    max: 64000,
    step: 500,
  },
];

const specByKey = new Map(settingsSpec.map((s) => [s.key, s]));

export function settingSpec(key: string): SettingSpec | undefined {
  return specByKey.get(key);
}

export function getSetting(settings: EntrypadSettings, key: string): SettingValue | undefined {
  let node: unknown = settings;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "object" ? undefined : (node as SettingValue | undefined);
}

export function isValidSetting(spec: SettingSpec, value: unknown): value is SettingValue {
  switch (spec.type) {
    case "boolean":
      return typeof value === "boolean";
    case "choice":
      return spec.choices.some((c) => c.value === value);
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= spec.min &&
        value <= spec.max &&
        Number.isInteger((value - spec.min) / spec.step)
      );
  }
}

/** Returns a copy with one setting changed. Unknown keys and invalid values throw. */
export function setSetting(settings: EntrypadSettings, key: string, value: SettingValue): EntrypadSettings {
  const spec = specByKey.get(key);
  if (!spec) throw new RangeError(`Unknown setting: ${key}`);
  if (!isValidSetting(spec, value)) throw new RangeError(`Invalid value for ${key}: ${String(value)}`);
  const [group, name] = splitKey(key);
  const section = settings[group as keyof EntrypadSettings] as Record<string, SettingValue>;
  return { ...settings, [group]: { ...section, [name]: value } };
}

function splitKey(key: string): [string, string] {
  const dot = key.indexOf(".");
  return [key.slice(0, dot), key.slice(dot + 1)];
}

export interface ResolvedSettings {
  settings: EntrypadSettings;
  /** Keys that were unknown or held invalid values, and were ignored. */
  ignored: string[];
}

/**
 * Builds full settings from defaults plus overrides, e.g. saved preferences.
 * Accepts nested objects ({ parsing: { tabWidth: 2 } }) or flat dotted keys.
 * Bad entries are skipped and reported, never thrown: flag, don't block.
 */
export function resolveSettings(...layers: unknown[]): ResolvedSettings {
  let settings = defaultSettings();
  const ignored: string[] = [];
  for (const layer of layers) {
    for (const [key, value] of flatten(layer)) {
      const spec = specByKey.get(key);
      if (spec && isValidSetting(spec, value)) settings = setSetting(settings, key, value);
      else ignored.push(key);
    }
  }
  return { settings, ignored };
}

function flatten(layer: unknown, prefix = ""): [string, unknown][] {
  if (layer === null || typeof layer !== "object" || Array.isArray(layer)) return [];
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(layer)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) out.push(...flatten(v, key));
    else out.push([key, v]);
  }
  return out;
}

/**
 * Reads the value of a `set` line in the shorthand, e.g. `set parsing.tabWidth 2`
 * or `set autofix.inferBlankAmount off`. Returns undefined when the text isn't
 * a valid value for that setting.
 */
export function parseSettingText(spec: SettingSpec, text: string): SettingValue | undefined {
  const t = text.trim().toLowerCase();
  switch (spec.type) {
    case "boolean":
      if (["on", "true", "yes"].includes(t)) return true;
      if (["off", "false", "no"].includes(t)) return false;
      return undefined;
    case "choice": {
      const hit = spec.choices.find((c) => String(c.value).toLowerCase() === t);
      return hit?.value;
    }
    case "number": {
      const n = Number(t.replace(/,/g, ""));
      return isValidSetting(spec, n) ? n : undefined;
    }
  }
}

/** Writes a value the way a `set` line spells it. */
export function formatSettingText(value: SettingValue): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value);
}

/**
 * File settings that differ from the defaults, as `set` lines. Saving or
 * sharing a book writes these into it, so it reads the same for everyone.
 */
export function fileSettingLines(settings: EntrypadSettings): string[] {
  const defaults = defaultSettings();
  return settingsSpec
    .filter((s) => s.scope === "file")
    .filter((s) => getSetting(settings, s.key) !== getSetting(defaults, s.key))
    .map((s) => `set ${s.key} ${formatSettingText(getSetting(settings, s.key)!)}`);
}
