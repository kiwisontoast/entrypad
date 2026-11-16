import { HighlightStyle, indentService, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { theme } from "@entrypad/react";

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE = new RegExp(`^(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}/\\d{1,2}(?:/\\d{4})?|${MONTH}\\s+\\d{1,2}(?:,\\s*\\d{4})?|-)(?=\\s|$)`, "i");
const DIRECTIVE = /^(?:book|open|account|show|set)(?=[ \t])/i;
const AMOUNT = /^[($-]*\$?-?\(?[\d,]*\.?\d+[kK]?\)?(?=\s*$|,\s|\s+\/)/;

interface State {
  /** Only whitespace so far on this line. */
  lineStart: boolean;
}

/**
 * Highlighting for the shorthand: comments, dates, directives, dr and cr,
 * tags, quoted names and amounts. It only colours; parse() does the reading.
 */
const shorthand = StreamLanguage.define<State>({
  name: "entrypad",
  startState: () => ({ lineStart: true }),
  token(stream, state) {
    if (stream.sol()) state.lineStart = true;
    if (stream.sol()) {
      if (stream.match(/^\s*[#;].*/)) return "comment";
      if (stream.match(DATE)) {
        state.lineStart = false;
        return "atom";
      }
      if (stream.match(DIRECTIVE)) {
        state.lineStart = false;
        return "keyword";
      }
    }
    if (stream.eatSpace()) return null;
    if (state.lineStart && stream.match(/^(?:dr|cr)(?=\s)/i)) {
      state.lineStart = false;
      return "keyword";
    }
    state.lineStart = false;
    if (stream.match(/^\[[^\]]*\]/)) return "meta";
    if (stream.match(/^"[^"]*"?/)) return "string";
    if (stream.match(AMOUNT)) return "number";
    stream.match(/^[^\s"[]+/) || stream.next();
    return null;
  },
});

const style = HighlightStyle.define([
  { tag: tags.comment, color: theme.muted, fontStyle: "italic" },
  { tag: tags.atom, color: theme.ink, fontWeight: "600" },
  { tag: tags.keyword, color: theme.accent },
  { tag: tags.meta, color: theme.muted },
  { tag: tags.string, color: theme.ink },
  { tag: tags.number, color: theme.ink, fontWeight: "500" },
]);

/**
 * Where a new line starts when you press Enter: under a header, at the
 * debit indent; under a posting, level with it; after a blank line, a
 * comment or a directive, at the first column, ready for the next entry.
 */
const indentation = indentService.of((context, pos) => {
  const before = context.lineAt(pos, -1).text;
  if (!before.trim() || /^[#;]/.test(before) || DIRECTIVE.test(before)) return 0;
  if (DATE.test(before)) return 2;
  return /^[ \t]*/.exec(before)![0].replace(/\t/g, "    ").length;
});

export const shorthandLanguage: Extension = [shorthand, syntaxHighlighting(style), indentation];
