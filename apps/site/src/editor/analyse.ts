import { bookChanges, diagnose, parse } from "@entrypad/core";
import type { Book, Diagnostic, EntrypadSettings, ParseResult, TextChange } from "@entrypad/core";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

export interface Analysis extends ParseResult {
  text: string;
  /** What the parser found, then what the book rules found, in text order. */
  findings: Diagnostic[];
}

let last: { text: string; settings: EntrypadSettings; analysis: Analysis } | undefined;

/**
 * Reads and checks the text. The page and the linter both ask for the same
 * text in quick succession, so the last result is kept.
 */
export function analyse(text: string, settings: EntrypadSettings): Analysis {
  if (last && last.text === text && last.settings === settings) return last.analysis;
  const result = parse(text, settings);
  const findings = [...result.diagnostics, ...diagnose(result.book, result.resolved)].sort(
    (a, b) => (a.target.source?.from ?? Infinity) - (b.target.source?.from ?? Infinity),
  );
  const analysis = { ...result, text, findings };
  last = { text, settings, analysis };
  return analysis;
}

/** Writes a changed book back into the editor, rewriting only the entries that changed. */
export function writeBook(view: EditorView, analysis: Analysis, next: Book, settings: EntrypadSettings): void {
  if (view.state.doc.toString() !== analysis.text) return;
  const changes: TextChange[] = bookChanges(analysis.text, analysis.book, next, settings);
  if (changes.length) view.dispatch({ changes, userEvent: "input.entrypad" });
}

/** A finding about a whole entry underlines only its first line, not every posting. */
function range(text: string, from: number, to: number): { from: number; to: number } {
  const nl = text.indexOf("\n", from);
  if (nl !== -1 && nl < to) to = text[nl - 1] === "\r" ? nl - 1 : nl;
  return { from, to: Math.max(to, from) };
}

/** The findings as CodeMirror squiggles, with each fix as a quick action. */
export function lintDiagnostics(analysis: Analysis, settings: EntrypadSettings): CmDiagnostic[] {
  const out: CmDiagnostic[] = [];
  for (const d of analysis.findings) {
    if (!d.target.source) continue;
    out.push({
      ...range(analysis.text, d.target.source.from, d.target.source.to),
      severity: d.severity,
      source: d.code,
      message: d.message,
      ...(d.fixes?.length && {
        actions: d.fixes.map((fix) => ({
          name: fix.label,
          apply: (view: EditorView) => writeBook(view, analysis, fix.apply(analysis.book), settings),
        })),
      }),
    });
  }
  return out;
}
