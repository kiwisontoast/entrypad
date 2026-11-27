import { readFileSync } from "node:fs";
import MarkdownIt from "markdown-it";
import type { Plugin } from "vite";
import { britishLeft, toAmerican } from "./american.js";

/** GitHub-style heading slugs, so the spec's own `#settings` links work. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Renders a Markdown reference page: heading anchors, and a contents list of its second-level headings. */
export function renderReference(markdown: string): { body: string; contents: string; title: string } {
  const md = new MarkdownIt({ html: false, linkify: false });
  const seen = new Map<string, number>();
  const sections: { id: string; text: string }[] = [];
  let title = "";
  md.core.ruler.push("entrypad_heading_ids", (state) => {
    state.tokens.forEach((token, i) => {
      if (token.type !== "heading_open") return;
      const text = state.tokens[i + 1]?.content ?? "";
      if (token.tag === "h1" && !title) title = text;
      let id = slug(text);
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      token.attrSet("id", id);
      if (token.tag === "h2") sections.push({ id, text });
    });
  });
  const body = md.render(markdown);
  const contents = sections.map((s) => `<li><a href="#${s.id}">${escapeHtml(s.text)}</a></li>`).join("");
  return { body, contents, title };
}

/** Prose only: what the dialect check should read. */
const prose = (markdown: string) => markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");

/**
 * Fills `<!--reference-->` and `<!--contents-->` in docs/index.html with
 * docs/shorthand.md, converted to American English for the site. The build
 * stops if a British spelling gets through, so the site never mixes the two.
 */
export function shorthandReference(specPath: string): Plugin {
  return {
    name: "entrypad-shorthand-reference",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!html.includes("<!--reference-->")) return html;
        const american = toAmerican(readFileSync(specPath, "utf8"));
        const left = britishLeft(prose(american));
        if (left.length) throw new Error(`British spellings left in the shorthand reference: ${left.join(", ")} (add them to src/docs/american.ts)`);
        const { body, contents } = renderReference(american);
        void ctx;
        return html.replace("<!--reference-->", body).replace("<!--contents-->", contents);
      },
    },
  };
}
