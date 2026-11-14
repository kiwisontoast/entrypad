import type { Diagnostic, DiagnosticCode, Severity } from "./diagnostics.js";
import { defaultSettings } from "./settings.js";
import type { EntrypadSettings } from "./settings.js";

/** What a rule reports; the code and severity are added for it. */
export type RuleFinding = Omit<Diagnostic, "severity" | "code">;

export interface RuleContext {
  settings: EntrypadSettings;
}

/**
 * One check. Rules are plain values in an array, so a pack can add its own
 * by passing a longer array. Nothing here assumes the subject is a book, so
 * the same machinery can check other models.
 */
export interface Rule<T> {
  code: string;
  /** Used when the settings have no `diagnostics.<code>` entry, as for a pack's own rules. */
  severity: Exclude<Severity, "off">;
  check: (subject: T, context: RuleContext) => RuleFinding[];
}

/**
 * Runs every rule, taking each one's severity from the `diagnostics.*`
 * settings and leaving out rules set to off. Findings come back in text
 * order, with those that have no source range last.
 */
export function runRules<T>(subject: T, rules: readonly Rule<T>[], settings: EntrypadSettings = defaultSettings()): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const rule of rules) {
    const severity = settings.diagnostics[rule.code as DiagnosticCode] ?? rule.severity;
    if (severity === "off") continue;
    for (const finding of rule.check(subject, { settings })) out.push({ severity, code: rule.code, ...finding });
  }
  const at = (d: Diagnostic) => d.target.source?.from ?? Infinity;
  return out.map((d, i) => [d, i] as const).sort(([a, i], [b, j]) => at(a) - at(b) || i - j).map(([d]) => d);
}
