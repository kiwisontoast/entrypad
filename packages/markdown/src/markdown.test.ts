import { Marp } from "@marp-team/marp-core";
import MarkdownIt from "markdown-it";
import { remark } from "remark";
import remarkHtml from "remark-html";
import { describe, expect, it } from "vitest";
import { markdownItEntrypad, remarkEntrypad } from "./plugins.js";
import { renderBlock } from "./render.js";

const block = `Jan 1  Owner invests cash
  Cash                    10,000
      Common Stock                 10,000

Jan 3  Buy equipment for cash
  Equipment                4,000
      Cash                          4,000

show t-accounts: Cash, Equipment
show equation
`;

const doc = `# Opening entries

Some prose first.

\`\`\`entrypad
${block}\`\`\`

\`\`\`js
const notTouched = 1 < 2;
\`\`\`
`;

/** Text drawn in the figure's SVG, without the markup. */
const drawn = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("renderBlock", () => {
  const html = renderBlock(block);

  it("draws each visual the show lines name, in order, as plain SVG", () => {
    expect([...html.matchAll(/data-visual="([a-z-]+)"/g)].map((m) => m[1])).toEqual(["t-accounts", "equation"]);
    expect(html).toContain("<svg");
    // Only the accounts named: Cash and Equipment, not Common Stock.
    expect(drawn(html)).toContain("Cash");
    expect(drawn(html)).toContain("Equipment");
    expect(html).not.toContain('id="t-common-stock"');
    // Cash 10,000 less 4,000.
    expect(drawn(html)).toContain("6,000");
  });

  it("leaves no trace of the drag engine and no squiggles", () => {
    expect(html).not.toMatch(/dragology/i);
    expect(html).not.toContain("data-entrypad-drag");
    expect(html).not.toMatch(/id="dx-/);
  });

  it("carries the block's text, escaped, for the client script", () => {
    const attr = /data-entrypad-source="([^"]*)"/.exec(html)![1]!;
    const text = attr.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    expect(text).toBe(block);
    expect(renderBlock('Jan 1 "Quoted" & <odd>: Cash 1 / Common Stock 1\n')).toContain("&quot;Quoted&quot; &amp; &lt;odd&gt;");
  });

  it("shows T-accounts when no show line names a visual it can draw", () => {
    expect([...renderBlock("Jan 1 Invest: Cash 100 / Common Stock 100\n").matchAll(/data-visual="([a-z-]+)"/g)].map((m) => m[1])).toEqual([
      "t-accounts",
    ]);
  });

  it("still draws a book with mistakes in it", () => {
    const html = renderBlock("Jan 1  Owner invests\n  Cash  10,000\n      Common Stock  9,000\n");
    expect(drawn(html)).toContain("10,000");
  });
});

describe("markdownItEntrypad", () => {
  it("turns entrypad fences into figures and leaves other fences alone", () => {
    const md = new MarkdownIt().use(markdownItEntrypad);
    const html = md.render(doc);
    expect(html).toContain("<h1>Opening entries</h1>");
    expect(html.match(/<figure class="entrypad"/g)).toHaveLength(1);
    expect(html).toContain('<code class="language-js">const notTouched = 1 &lt; 2;');
  });

  it("works in a Marp deck", () => {
    const marp = new Marp().use(markdownItEntrypad, { width: 640 });
    const { html } = marp.render(`---\nmarp: true\n---\n\n# Slide one\n\n\`\`\`entrypad\n${block}\`\`\`\n\n---\n\n# Slide two\n`);
    expect(html.match(/<section/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('<figure class="entrypad"');
    expect(html).toContain('data-entrypad-width="640"');
  });
});

describe("remarkEntrypad", () => {
  it("turns entrypad code blocks into figures", async () => {
    const file = await remark().use(remarkEntrypad).use(remarkHtml, { sanitize: false }).process(doc);
    const html = String(file);
    expect(html).toContain("<h1>Opening entries</h1>");
    expect(html.match(/<figure class="entrypad"/g)).toHaveLength(1);
    expect(html).toContain('<code class="language-js">');
  });
});
