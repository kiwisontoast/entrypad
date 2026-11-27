/**
 * The repo's documentation is written in British English; the site is
 * American English (owner's decision, 27 November 2026). This turns the
 * prose of a Markdown document into American spelling and month-first
 * dates. Code blocks, inline code and link targets are left exactly as
 * they are, since they hold shorthand, setting keys and identifiers.
 */

/** Whole words that change. Matched case-insensitively; the first letter's case is kept. */
const WORDS: Record<string, string> = {
  behaviour: "behavior",
  behaviours: "behaviors",
  colour: "color",
  colours: "colors",
  favour: "favor",
  favourite: "favorite",
  honour: "honor",
  labour: "labor",
  neighbour: "neighbor",
  centre: "center",
  centres: "centers",
  licence: "license",
  licences: "licenses",
  catalogue: "catalog",
  cheque: "check",
  cheques: "checks",
  judgement: "judgment",
  defence: "defense",
  fulfil: "fulfill",
  fulfilment: "fulfillment",
  instalment: "installment",
  instalments: "installments",
  enquiry: "inquiry",
  enquiries: "inquiries",
  ageing: "aging",
  whilst: "while",
  amongst: "among",
  towards: "toward",
  programme: "program",
  grey: "gray",
};

/** Doubled l before -ed and -ing, single in American English. */
const DOUBLE_L = ["cancel", "label", "model", "total", "travel", "signal", "level", "fuel", "channel"];

/** Words ending in -ise that are spelled the same in American English. */
const ISE_SAME = new Set([
  "advertise", "advise", "apprise", "arise", "chastise", "comprise", "compromise", "concise", "demise", "despise",
  "devise", "disguise", "enterprise", "excise", "exercise", "expertise", "franchise", "improvise", "incise",
  "likewise", "merchandise", "noise", "otherwise", "paradise", "poise", "praise", "precise", "premise", "promise",
  "raise", "revise", "rise", "supervise", "surmise", "surprise", "televise", "wise", "clockwise", "cruise",
  "bruise", "chemise", "anise", "treatise", "reprise", "elise", "louise", "denise", "valise", "porpoise",
  "tortoise", "turquoise", "mortise", "concise", "precise",
]);

const keepCase = (from: string, to: string) => (from[0] === from[0]!.toUpperCase() ? to[0]!.toUpperCase() + to.slice(1) : to);

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

/** Converts one run of prose (no code in it). */
function convertProse(text: string): string {
  let out = text.replace(/\b[A-Za-z]+\b/g, (word) => {
    const lower = word.toLowerCase();
    const mapped = WORDS[lower];
    if (mapped) return keepCase(word, mapped);
    for (const stem of DOUBLE_L) {
      for (const [uk, us] of [
        [`${stem}led`, `${stem}ed`],
        [`${stem}ling`, `${stem}ing`],
      ]) {
        if (lower === uk) return keepCase(word, us!);
      }
    }
    // -isation, -ise, -ised, -ises, -ising: -iz- unless the word is the same in both.
    const ise = /^(.+?)is(e|es|ed|ing|ation|ations)$/.exec(lower);
    if (ise && lower.length > 5 && !ISE_SAME.has(`${ise[1]}ise`)) return keepCase(word, `${ise[1]}iz${ise[2]}`);
    // analyse, paralyse: -yze.
    const yse = /^(anal|paral|catal|dial|electrol|hydrol)ys(e|es|ed|ing)$/.exec(lower);
    if (yse) return keepCase(word, `${yse[1]}yz${yse[2]}`);
    return word;
  });
  // "9 November 2026" -> "November 9, 2026"; "9 November" -> "November 9".
  out = out.replace(new RegExp(`\\b(\\d{1,2}) (${MONTHS}) (\\d{4})\\b`, "g"), "$2 $1, $3");
  out = out.replace(new RegExp(`\\b(\\d{1,2}) (${MONTHS})\\b`, "g"), "$2 $1");
  return out;
}

/** Splits a line into prose and inline code (`...`), converting only the prose and keeping link targets. */
function convertLine(line: string): string {
  return line
    .split(/(`[^`]*`|\]\([^)]*\))/)
    .map((part, i) => (i % 2 === 1 ? part : convertProse(part)))
    .join("");
}

/** A Markdown document with its prose in American English. */
export function toAmerican(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let fence: string | null = null;
  return lines
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker && (fence === null || marker.startsWith(fence))) {
        fence = fence === null ? marker : null;
        return line;
      }
      return fence === null ? convertLine(line) : line;
    })
    .join("\n");
}

/** British spellings still in some text: the words a reviewer should look at. Empty when clean. */
export function britishLeft(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b[A-Za-z]+\b/g)) {
    const lower = m[0].toLowerCase();
    if (WORDS[lower]) found.add(lower);
    if (/^.+is(e|es|ed|ing|ation|ations)$/.test(lower) && lower.length > 5) {
      const stem = lower.replace(/is(e|es|ed|ing|ation|ations)$/, "ise");
      if (!ISE_SAME.has(stem)) found.add(lower);
    }
    if (/(our|ours)$/.test(lower) && /^(behaviour|colour|favour|honour|labour|neighbour|rumour|humour|vapour|harbour|savour|flavour)s?$/.test(lower)) found.add(lower);
    if (DOUBLE_L.some((s) => lower === `${s}led` || lower === `${s}ling`)) found.add(lower);
  }
  return [...found];
}
