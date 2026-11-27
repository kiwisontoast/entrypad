import { markdownItEntrypad } from "@entrypad/markdown";
import { hydrateEntrypad } from "@entrypad/markdown/client";
import MarkdownIt from "markdown-it";
import "../typography.js";
import "./markdown.css";

/**
 * A development page: a plain docs page written in Markdown, rendered with
 * markdown-it and the Entrypad plugin, then made live by the client script.
 * `?static` skips the client script, to see what readers without
 * JavaScript get.
 */

const page = `# Recording the purchase of equipment

When a business buys equipment with part cash and part credit, one entry
records the asset at its full cost and splits the payment between cash
and a note payable.

\`\`\`entrypad
book "Sunrise Bakery" period 2026-01-01..2026-01-31

Jan 1  Owner invests cash
  Cash                    25,000
      Common Stock                 25,000

Jan 3  Buy ovens, half cash, half note   [investing]
  Equipment               12,000
      Cash                          6,000
      Notes Payable                 6,000

show t-accounts: Cash, Equipment, Notes Payable, Common Stock
show equation
\`\`\`

Assets rise by 6,000 overall: equipment up 12,000, cash down 6,000. The
note adds 6,000 to liabilities, so the equation still balances.

\`\`\`text
An ordinary code block stays as it is.
\`\`\`
`;

const md = new MarkdownIt().use(markdownItEntrypad, { width: 680 });
document.getElementById("doc")!.innerHTML = md.render(page);

declare global {
  interface Window {
    __markdown: { live: number };
  }
}

window.__markdown = { live: new URLSearchParams(location.search).has("static") ? 0 : hydrateEntrypad() };
