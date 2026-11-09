# Doubling

Drag a transaction onto the books and watch the T-accounts, the accounting equation and the financial statements move with it.

Doubling is an open-source toolkit for making live, interactive accounting visuals for class presentations and slides. You describe the books in a few lines of plain text, written like the general journal you already know, and Doubling draws linked diagrams you can drag around.

> **Status:** early development. Nothing is published to npm yet. This repo will fill up as the first version comes together.

## What it will do

- Take entries written the way a textbook journal lays them out: debits flush left, credits indented.
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

## Credits

Doubling builds its drag interactions on [Dragology](https://github.com/declarative-dragging/dragology), the declarative dragging library by Josh Horowitz and Andrew Blinn. Their project site, [Declarative Dragging](https://declarative-dragging.github.io/), inspired this one.

## License

MIT. Copyright (c) 2026 Dev Shroff. See [LICENSE](LICENSE).
