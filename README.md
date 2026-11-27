# Entrypad

Drag a transaction onto the books and watch the T-accounts, the accounting equation and the financial statements move with it.

Entrypad is an open-source toolkit for accountants. It turns plain-text journal entries into live accounting visuals for presentations and reports. You write the books the way you would write a general journal, and Entrypad draws linked diagrams you can drag to change.

> **Status:** early development. The `entrypad` package on npm is a placeholder for now. This repo will fill up as the first version comes together.

## What it will do

- Take entries written the way a general journal lays them out: debits flush left, credits indented.
- Draw T-accounts, A = L + E, the income statement, retained earnings, the balance sheet, the cash flow statement (direct and indirect) and depreciation schedules from the same entries, so they always agree.
- Post a transaction by dropping its card on the books, reverse it by pulling the card off, and reclassify a line by dragging it onto another account.
- Underline unbalanced entries and unknown accounts the way a spell checker underlines typos. You can keep working, and the underlines never show up in exports.
- Present live in the browser, export PNG, SVG or an animated GIF, or embed a visual in any page that accepts iframes.
- Accept rows pasted from Excel or Google Sheets, and open hledger and ledger journals.

## A quick look at the format

```
Jan 1  Owner invests cash
  Cash                    10,000
      Common Stock                 10,000

Jan 3  Buy oven, half cash, half note
  Equipment                8,000
      Cash                          4,000
      Notes Payable                 4,000

show t-accounts: Cash, Equipment, Notes Payable
show equation
```

## Roadmap

1. Core: the parser, the ledger model, T-accounts, the accounting equation, and an editor that flags mistakes as you type.
2. First release: the full set of statements, schedules, export, embedding, and a website with live demos.
3. Corporate finance: a DCF template where you drag the discount rate and growth assumptions and watch the valuation change, tied back to the cash flow statement.
4. Intermediate accounting: leases, bonds, deferred taxes and revenue recognition.
5. Managerial accounting: cost-volume-profit, budgets, job costing and variances.

## Development

You need Node 24 or later and pnpm 10. With Corepack, `corepack enable` picks up the pnpm version pinned in `package.json`. Without it, install pnpm with `npm install -g pnpm@10`.

```
pnpm install     # install dependencies
pnpm dev         # run the site locally at http://localhost:5173
pnpm test        # unit tests
pnpm typecheck   # TypeScript checks across every package
pnpm build       # build the packages and the site
pnpm e2e         # browser tests
pnpm examples    # regenerate the sample books in examples/
```

Before the first `pnpm e2e`, install the test browser once with `pnpm --filter @entrypad/site exec playwright install chromium`.

`pnpm dev` also serves five development pages that aren't part of the published site:

- `/editor/`, the shorthand editor. Type entries on the left and the T-accounts, entry cards and accounting equation update on the right, with mistakes underlined as you type. Dragging in a visual rewrites the matching entry in the text. You can export each visual as SVG, PNG or a GIF of the month, and save a book as a file or share it as a link.
- `/embed/`, which shows one visual from a link at full size, for putting in other tools through an iframe. The arrow keys, a swipe or the on-screen buttons step through the entries.
- `/visuals/`, the same three visuals on a sample book, with step-through.
- `/spike/`, the original prototype of dragging entries onto T-accounts.
- `/fonts/`, a typeface comparison.

To try them on a phone, run `pnpm --filter @entrypad/site dev:phone` and open the network address it prints on a phone on the same Wi-Fi.

`examples/` holds three sample books for invented businesses: a bakery, a bike shop and a consulting firm, one month each. Each has an `.expected.json` with its balances, trial balance totals and accounting equation. `examples/generate.ts` works those figures out with plain arithmetic and none of Entrypad's code, and the tests check Entrypad against them. Run `pnpm examples` to regenerate the books.

The repo is a pnpm workspace. `packages/core` has no React dependency. It holds the book model, the shorthand parser, the checks behind the underlines, hledger import and export, and the ledger and equation views. `packages/react` holds the visuals, `packages/export` exports them as SVG, PNG and GIF, and `apps/site` is the website.

## Credits

Entrypad builds its drag interactions on [Dragology](https://github.com/declarative-dragging/dragology), the declarative dragging library by Josh Horowitz and Andrew Blinn. Their project site, [Declarative Dragging](https://declarative-dragging.github.io/), inspired this one.

## Licence

MIT. Copyright (c) 2026 Dev Shroff. See [LICENSE](LICENSE).
