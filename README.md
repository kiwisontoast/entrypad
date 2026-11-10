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
```

Before the first `pnpm e2e`, install the test browser once with `pnpm --filter @entrypad/site exec playwright install chromium`.

`pnpm dev` also serves two development pages that aren't part of the published site: `/spike/`, a prototype of dragging entries onto T-accounts, and `/fonts/`, a typeface comparison. To try them on a phone, run `pnpm --filter @entrypad/site dev:phone` and open the network address it prints on a phone on the same Wi-Fi.

The repo is a pnpm workspace. `packages/core` holds the book model and has no React dependency. `packages/react` holds the visuals, `packages/export` handles exporting them (SVG first, with PNG and GIF to follow), and `apps/site` is the website.

## Credits

Entrypad builds its drag interactions on [Dragology](https://github.com/declarative-dragging/dragology), the declarative dragging library by Josh Horowitz and Andrew Blinn. Their project site, [Declarative Dragging](https://declarative-dragging.github.io/), inspired this one.

## License

MIT. Copyright (c) 2026 Dev Shroff. See [LICENSE](LICENSE).
