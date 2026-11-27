# The Entrypad shorthand

Status: draft. This describes the format the parser reads. Details may change before the first release.

An Entrypad book is a plain-text file with the `.entrypad` extension. It is laid out like a general journal on paper: a date and a memo, the debit lines, then the credit lines indented beneath them. Anyone who can journalise can write it with very little to learn.

The text is the single source of truth. Spreadsheet rows pasted into the editor and imported hledger journals are converted to this format, and every visual is drawn from it.

## A complete example

```
# Sunrise Bakery, January
book "Sunrise Bakery" period 2026-01-01..2026-01-31

Jan 1  Owner invests cash
  Cash                    10,000
      Common Stock                 10,000

Jan 3  Buy oven, half cash, half note   [investing]
  Equipment                8,000
      Cash                          4,000
      Notes Payable                 4,000

Jan 9  Pay January rent: Rent Expense 1,200 / Cash 1,200

Jan 15 Bill a catering client
  Accounts Receivable      3,000
      Service Revenue

Jan 31 Record depreciation   [adjusting]
  Depreciation Expense       200
      Accumulated Depreciation, Equipment   200

show t-accounts: Cash, Equipment, Notes Payable
show equation
```

The Jan 15 entry leaves the Service Revenue amount blank, so Entrypad fills in 3,000 to balance the entry and shows a hint with the value it used.

## Lines

The parser reads the file one line at a time. Every line is one of these:

| Line | How it is recognised |
| --- | --- |
| Blank | Nothing but spaces or tabs |
| Comment | First non-space character is `#` or `;` |
| Entry header | Starts at the first column with a date or `-` |
| Directive | Starts at the first column with `book`, `open`, `account`, `asset`, `show` or `set` followed by a space |
| Posting | Any other line that follows an entry header |

Comments take up a whole line. There are no end-of-line comments, so a memo such as `Invoice #12` is read as written.

Before parsing, tabs advance to the next multiple of 4 columns and non-breaking spaces become ordinary spaces. Text pasted from Word or a web page therefore lines up the same way it looks. Line endings can be LF or CRLF.

## Entries

### The header line

An entry starts with a header line at the first column:

```
<date> <memo> [<tag>] ...
```

The date can be written in any of these forms:

| Form | Example | Notes |
| --- | --- | --- |
| Month name and day | `Jan 3`, `January 3`, `Jan 3, 2026` | Case-insensitive; three-letter or full month names |
| Month/day | `1/3`, `1/3/2026` | Always month first, then day |
| ISO | `2026-01-03` | |
| No date | `-` | For entries where the date doesn't matter |

When a date has no year, the year comes from the book's period: the parser uses the year that places the date inside the period. Without a period, or when no year puts the date inside it, it uses the year of the nearest dated entry above. Failing that it uses the period's first year, and if there is no period either, the current year. A date that doesn't exist in the year chosen, such as `Feb 29` in 2026, is flagged `invalid-date`.

The memo is the rest of the line after the date. It can be empty.

Tags go at the end of the header line in square brackets. You can write one tag per bracket pair (`[adjusting] [operating]`) or several separated by commas (`[adjusting, operating]`). The recognised tags are `adjusting`, `closing`, `operating`, `investing` and `financing`, matched without regard to case.

An entry ends at the next blank line, entry header or directive, or at the end of the file. Comment lines inside an entry don't end it.

### Posting lines

Each line after the header is one posting:

```
[dr | cr] <account> [<amount>]
```

The amount is the last word on the line, provided it reads as an amount. Everything before it is the account name. How far right the amount sits doesn't matter, so the debit and credit amount columns are only there to help people read.

Indentation decides the side. The column where the first posting line's text begins is the reference column. A later line whose text begins further right is a credit, and every other line is a debit. Debits can start at the first column or be indented under the header, as in the example.

A line that starts with `dr` or `cr` (any case) followed by a space takes that side whatever its indentation. Use this in editors and email clients that strip leading spaces:

```
Jan 3 Buy oven
dr Equipment 8,000
cr Cash 4,000
cr Notes Payable 4,000
```

### Amounts

| Written | Value |
| --- | --- |
| `10000` | 10,000.00 |
| `10,000` | 10,000.00 |
| `$10,000` | 10,000.00 |
| `1,200.50` | 1,200.50 |
| `10k` | 10,000.00 |
| `2.5k` | 2,500.00 |

- Commas group thousands, and a period marks the decimal point. At most two decimal places are allowed.
- A `$` before the number and a `k` or `K` after it are optional. A `k` amount still allows at most two decimal places after the multiplication.
- Amounts are always positive. The side comes from indentation or `dr`/`cr`, never from a sign. A negative or parenthesised amount, such as `-500` or `(500)`, is read as 500 on the side the line already has, and the line is flagged.
- Entrypad stores every amount as an integer number of cents, so totals never pick up rounding errors.

### Leaving one amount blank

One posting line in an entry can leave out its amount. Entrypad fills in the amount that balances the entry, as hledger and ledger do, and marks the line with an `inferred-amount` hint that shows the value. The rules:

- Only one blank line per entry. With two or more, none of them can be filled in, and the entry is flagged `ambiguous-blank`.
- The filled-in amount has to be positive. If balancing the entry would need zero or a negative amount on that line's side, the line is set to 0 and the entry is flagged `unbalanced-entry`.

### The one-line form

A quick entry fits on its header line. Put a colon after the memo, the debits before a slash, and the credits after it:

```
Jan 1 Owner invests: Cash 10000 / Common Stock 10000
Jan 3 Buy oven [investing]: Equipment 8000 / Cash 4000, Notes Payable 4000
```

- The memo runs up to the last colon before the slash. Tags go between the memo and that colon.
- Commas separate the postings on one side. A comma only separates postings when the word before it is an amount, so `Accumulated Depreciation, Equipment 200` stays one account name.
- One posting can leave out its amount, under the same rule as above. It must be the last posting on its side.

## Accounts

A posting's account name is matched against the book's chart of accounts. Case doesn't matter, runs of spaces count as one, and an account's aliases match too, so `A/R`, `AR` and `accounts receivable` all reach Accounts Receivable. The account's id (`accounts-receivable`) also works.

A name that matches nothing is kept as written and flagged `unknown-account`, with a "did you mean" fix offering the nearest name in the chart.

Put an account name in double quotes when it would otherwise be misread: when it ends in a number (`"Series 2027 Notes" 5,000`) or starts with a directive word at the first column.

Phase 1 ships a default US GAAP chart of about 40 accounts. Use the `account` directive to add your own.

## Directives

Directives start at the first column. A directive line also ends any entry above it.

### `book`

```
book "Sunrise Bakery" period 2026-01-01..2026-01-31
```

This names the book and sets its reporting period. Both period dates are included in the period, and both must be complete dates with a year. The period is optional. A file should have at most one `book` line; if it has more, the last one wins and the earlier ones are flagged.

### `open`

```
open Cash 5,000
open Accumulated Depreciation, Equipment 1,200
open Cash cr 300
```

This sets an opening balance. The amount goes on the account's normal side unless `dr` or `cr` comes before it, which allows an abnormal opening balance such as an overdraft. All `open` lines in a file together form one entry, "Opening balances", dated the first day of the period (or undated if there is no period). That entry is checked like any other, so opening balances that don't balance are flagged `unbalanced-entry`.

### `account`

```
account "Delivery Vans" asset
account "Accumulated Depreciation, Vans" asset contra "Delivery Vans"
account "Catering Revenue" revenue alias "Catering"
```

This adds an account to the chart. The name is in quotes, followed by its type: `asset`, `liability`, `equity`, `revenue` or `expense`. Options can follow in any order:

| Option | Effect |
| --- | --- |
| `contra "<Account>"` | Marks it as a contra account. Its normal side is the opposite of the account it offsets. |
| `alias "<Name>"` | Another name that matches it. Can repeat. |
| `normal debit` or `normal credit` | Overrides the normal side, e.g. for Dividends |
| `group <group>` | The section of the financial statements it appears in, e.g. `group property-plant-equipment`. See [Statement groups](#statement-groups). |

Without `contra` or `normal`, assets and expenses have a normal debit balance and the other types a normal credit balance. An `account` line can come anywhere in the file, and postings above it can use the account.

Declaring an account whose name is already in the chart replaces that account's type and options rather than adding a second one, so `account "Cash" asset alias "Bank"` lets `Bank` reach Cash. The account keeps its group unless the line names another one or the new type doesn't allow it. A `contra` account that isn't in the chart is flagged `unknown-account`.

### `asset`

```
asset "Ovens" account Equipment cost 12,000 salvage 0 life 5 years method straight-line from 2026-01-03
asset "Delivery van" account Equipment cost 30,000 salvage 3,000 life 5 years method double-declining from 2026-01-01
asset "Packaging line" account Equipment cost 50,000 salvage 2,000 units 400,000 from 2026-01-01 used 9,000 in Jan 2026
```

This records a depreciable asset, so that Entrypad can work out its depreciation schedule (see [Depreciation schedules](#depreciation-schedules)). The name is in quotes. The parts after it can come in any order:

| Part | Meaning |
| --- | --- |
| `account <Account>` | The asset account it is carried in, e.g. Equipment. Required. |
| `cost <amount>` | Its cost. Required. |
| `salvage <amount>` | Its estimated salvage value. Optional; 0 if left out. |
| `life <n> years` or `life <n> months` | Its useful life. Required for straight-line and double-declining. A fraction such as `2.5 years` is accepted when it comes to a whole number of months. |
| `method <method>` | `straight-line`, `double-declining` or `units`. Optional: the method is straight-line unless `units` is given. |
| `units <n>` | Units of production: the total units the asset is expected to produce (miles, machine hours, items). Giving it selects the `units` method. |
| `used <n> in <month>` | Units of production: the units used in one month, with the month written `Jan 2026` or `2026-01`. Repeat it for each month. Without `in <month>`, the units count for the last month of the book's period. |
| `from <date>` | The date it was placed in service, a complete date with a year. Required. |

An account name runs up to the next part. Put it in double quotes if it contains one of the words `account`, `cost`, `salvage`, `life`, `method`, `units`, `used` or `from`. The account must be an asset account and not a contra account.

An `asset` line posts nothing to the book. Depreciation entries are written as usual, and the `depreciation-mismatch` hint compares them with the schedule. The accumulated depreciation account is the contra account the chart gives the asset's account, so an asset carried in Equipment uses Accumulated Depreciation, Equipment. For an account you declare yourself, declare its accumulated depreciation account with `contra`.

An `asset` line with a part that can't be read is flagged and left out of the book, so no schedule is drawn from a guess. An account name that isn't in the chart is kept as written and flagged `unknown-account`.

### `show`

```
show t-accounts: Cash, Equipment, Notes Payable
show equation
show cash-flow: indirect
```

This picks the visuals a slide displays, in order. The Phase 1 visuals are `entry-cards`, `t-accounts`, `equation`, `statement-flow`, `cash-flow`, `trial-balance` and `schedule`. Options follow a colon. For `t-accounts` they are the accounts to draw; for `cash-flow` they are `direct` or `indirect`. Without any `show` lines, the editor chooses a default view.

### `set`

```
set parsing.dateOrder day-first
set autofix.inferBlankAmount off
set diagnostics.zero-amount off
```

This changes one setting for this book. The line applies to the whole file, wherever it sits. On-off settings take `on` or `off` (`yes`, `no`, `true` and `false` work too). A setting or value Entrypad doesn't know is ignored and flagged `unknown-setting`.

Only settings that affect how a book is read or checked can go in a file. They are listed under [Settings](#settings). Display and export preferences belong to the person viewing the book, so they live in each person's own settings.

A `set` line in the file overrides your own settings for that book. When you save or share a book, the editor writes a `set` line for each of these settings you have changed from its default, so the book reads the same for everyone who opens it.

## Statements

Entrypad works out the trial balance and the financial statements from the entries. Each one can cover the whole book or only the entries up to a given point, as a step-through shows them. Amounts are integer cents throughout, so every subtotal is exact.

### Statement groups

Every account belongs to a statement group, which decides where the statements show it. The group comes from the `group` option on the `account` line. A contra account without one takes the group of the account it offsets, so accumulated depreciation sits under property, plant and equipment. Any other account without one takes the default for its type.

| Type | Groups (default first) |
| --- | --- |
| `asset` | `current-assets`, `cash`, `investments`, `property-plant-equipment`, `intangible-assets`, `other-assets` |
| `liability` | `current-liabilities`, `short-term-debt`, `long-term-liabilities` |
| `equity` | `contributed-capital`, `retained-earnings`, `dividends` |
| `revenue` | `revenue`, `other-revenue` |
| `expense` | `operating-expenses`, `cost-of-sales`, `other-expenses`, `income-taxes` |

A group that doesn't belong to the account's type makes the line unreadable, and the line is flagged `unreadable-line`.

The built-in chart puts Cash and Petty Cash in `cash`, land, buildings and equipment (with their accumulated depreciation) in `property-plant-equipment`, Notes Payable in `short-term-debt`, Bonds Payable in `long-term-liabilities`, Common Stock and Additional Paid-in Capital in `contributed-capital`, Retained Earnings and Income Summary in `retained-earnings`, Dividends in `dividends`, Interest Revenue in `other-revenue`, Cost of Goods Sold in `cost-of-sales`, Interest Expense in `other-expenses` and Income Tax Expense in `income-taxes`. Every other asset is a current asset, every other liability a current liability, and every other expense an operating expense.

```
account "Delivery Vans" asset group property-plant-equipment
account "Accumulated Depreciation, Vans" asset contra "Delivery Vans"
account "Term Loan" liability group long-term-liabilities
account "Owner Drawings" equity normal debit group dividends
```

### Closing entries

Revenue, expenses and dividends count towards retained earnings until an entry tagged `[closing]` moves them there, as in the accounting equation. The statements leave closing entries out, so they show the same figures before and after the books are closed. Closing can go straight to Retained Earnings or through Income Summary.

### Trial balance

Every account with a balance, in chart order, with the balance in the debit or the credit column, and the two column totals. Accounts that net to zero are left out. Closing entries count here, so after closing it is the post-closing trial balance.

### Income statement

A multi-step statement:

| Line | Worked out as |
| --- | --- |
| Revenue | The `revenue` accounts. A contra revenue account, such as sales returns, reduces it. |
| Gross profit | Revenue less the `cost-of-sales` accounts |
| Operating income | Gross profit less the `operating-expenses` accounts |
| Income before income taxes | Operating income plus `other-revenue`, less `other-expenses` |
| Net income | Income before income taxes less the `income-taxes` accounts |

### Statement of retained earnings

Beginning retained earnings, plus net income, less dividends, gives ending retained earnings. Beginning retained earnings is the balance of the `retained-earnings` accounts outside closing entries, usually from an `open` line. Dividends are the activity in the `dividends` accounts outside closing entries.

### Balance sheet

A classified balance sheet. Assets are shown as current assets (the `cash` accounts first), investments, property, plant and equipment, intangible assets and other assets. Liabilities are shown as current liabilities (short-term debt included) and long-term liabilities. Equity is the `contributed-capital` accounts plus ending retained earnings from the statement above, so income not yet closed is included and the balance sheet balances whenever the entries do. Contra accounts are shown as negative lines within their section.

### Cash flow statement

The statement of cash flows covers every entry that moves cash, meaning one whose lines on `cash` accounts don't net to zero. Cash from the opening balances is the beginning cash, and beginning cash plus the net change is the ending cash. Closing entries are left out.

Each entry that moves cash falls in one section: operating, investing or financing. The `operating`, `investing` or `financing` tag on the entry decides it. An entry without one of these tags is placed by the accounts on its other side:

| Other side includes | Section |
| --- | --- |
| A `property-plant-equipment`, `investments` or `intangible-assets` account | Investing |
| A `short-term-debt`, `long-term-liabilities`, `contributed-capital` or `dividends` account | Financing |
| Anything else | Operating |

Investing is checked first, so a purchase of equipment paid partly with a note is investing. Each untagged entry gets an `inferred-cash-section` hint, with fixes that add the tag. With `cashFlow.inferSections` off, untagged entries are operating.

```
Mar 4  Buy a delivery van, part on a note
  Equipment               30,000
      Cash                        6,000
      Notes Payable              24,000

Mar 9  Customer deposits for spring orders   [operating]
  Cash                     2,500
      Unearned Revenue            2,500
```

The Mar 4 entry has no tag, so it is shown under investing activities because of Equipment. The Mar 9 entry is operating because its tag says so.

The direct method lists each entry's cash under its section. The indirect method builds the operating section from net income instead:

- Net income, from the income statement.
- Adjustments for items in net income that didn't move cash. A non-cash charge such as depreciation is added back under its expense account. Income from entries shown under investing or financing, such as a gain on the sale of equipment, is taken off.
- Changes in current assets other than cash, and in current liabilities other than short-term debt. These come from the operating entries and from entries that don't move cash, so a liability taken on to buy equipment isn't counted as an operating change.

Both methods give the same operating total, and so the same net change in cash. An entry that doesn't move cash and doesn't affect net income, but involves an investing or financing account, such as land bought by issuing stock, is listed separately as a non-cash investing and financing activity.

## Depreciation schedules

Each asset's schedule has a row for every month of its useful life. A row gives the book value at the start of the month, the depreciation for the month, the accumulated depreciation and the book value at the end. The yearly view adds up each twelve months from the first month of depreciation, so year 1 of an asset placed in service in April 2026 runs from April 2026 to March 2027.

The month the asset is placed in service is depreciated as a full month, whatever the day. With `schedules.firstMonth` set to `next-month`, depreciation starts the month after instead. This applies to straight-line and double-declining schedules; units of production follow the units used.

### Methods

- **Straight-line.** Cost less salvage, divided evenly over the months of the life.
- **Double-declining balance.** Each year's depreciation is the book value at the start of that year times twice the straight-line rate (2 divided by the life in years), spread evenly over the year's months. Depreciation never takes the book value below salvage, and the final year takes it down to salvage exactly.
- **Units of production.** Each month's depreciation is the units used that month times cost less salvage, divided by the total units expected. Once the units used reach the total, the asset is fully depreciated, and further use adds no depreciation. The schedule runs up to the last month with units used.

The delivery van in the example above (cost 30,000, salvage 3,000, five years, double-declining) has a rate of 40% a year:

| Year | Book value at start | Depreciation | Accumulated | Book value at end |
| --- | --- | --- | --- | --- |
| 1 | 30,000.00 | 12,000.00 | 12,000.00 | 18,000.00 |
| 2 | 18,000.00 | 7,200.00 | 19,200.00 | 10,800.00 |
| 3 | 10,800.00 | 4,320.00 | 23,520.00 | 6,480.00 |
| 4 | 6,480.00 | 2,592.00 | 26,112.00 | 3,888.00 |
| 5 | 3,888.00 | 888.00 | 27,000.00 | 3,000.00 |

The packaging line depreciates 0.12 a unit (48,000 over 400,000 units), so January's 9,000 units come to 1,080.

### Rounding

Schedules are worked out in whole cents with integer arithmetic, and every schedule adds up to exactly cost less salvage over the asset's life.

- Straight-line: each month takes the monthly amount rounded down to the cent, and the last month of the life takes what is left. Laptops costing 4,800 over three years depreciate 133.33 a month for 35 months and 133.45 in the last.
- Double-declining balance: each year's amount is rounded to the nearest cent, with half a cent rounding up, then spread over its months the same way.
- Units of production: each month's amount is rounded to the nearest cent, with half a cent rounding up. The month in which the units used reach the total takes whatever is left.

### Checking depreciation entries

The `depreciation-mismatch` hint compares the credits to each accumulated depreciation account with the schedules of the assets that use it. It works through the book's period month by month, up to the month of the latest entry. A month with an entry crediting the account is compared with the scheduled depreciation for that month and for any earlier months since the previous such entry, so monthly, quarterly and yearly depreciation entries can all be checked. Opening balances and entries tagged `[closing]` are left out. Scheduled depreciation after the last such entry is reported as not recorded.

When the entry has one debit and one credit, the hint offers to change it to the scheduled amount. When nothing is recorded, it offers to add an adjusting entry debiting Depreciation Expense. The opening balance of an accumulated depreciation account isn't compared with the schedule.

## Settings

Every rule on this page that involves a choice has a setting, and the default is the behaviour described above. You can change any of them in the editor's settings, or for one book with a `set` line.

| Setting | Default | What it controls |
| --- | --- | --- |
| `book.decimals` | `0` | Show whole dollars (`0`) or dollars and cents (`2`). Amounts are always stored exactly. |
| `parsing.tabWidth` | `4` | A tab advances to the next multiple of this many columns. |
| `parsing.dateOrder` | `month-first` | Whether `1/3` is January 3 or 1 March (`day-first`). |
| `parsing.yearFromPeriod` | `on` | A date without a year takes the year that puts it inside the period. |
| `parsing.yearFromPreviousEntry` | `on` | Otherwise it takes the year of the nearest dated entry above. |
| `parsing.hashComments` | `on` | Lines starting with `#` are comments. |
| `parsing.semicolonComments` | `on` | Lines starting with `;` are comments. |
| `parsing.endOfLineComments` | `off` | A comment can follow content on the same line. |
| `parsing.normalizeSpaces` | `on` | Non-breaking spaces count as ordinary spaces. |
| `parsing.blankLineEndsEntry` | `on` | A blank line ends an entry. |
| `parsing.thousandsSuffix` | `on` | `10k` means 10,000. |
| `parsing.negativeAmounts` | `same-side` | A negative amount is read on the line's own side, on the other side (`other-side`), or as unreadable (`invalid`). |
| `parsing.oneLineCommas` | `after-amount` | In the one-line form, a comma splits postings only after an amount, or `always`. |
| `parsing.duplicateBook` | `last-wins` | Which `book` line counts when there are several (`first-wins` is the other choice). |
| `accounts.ignoreCase` | `on` | Account names match without regard to case. |
| `accounts.collapseSpaces` | `on` | Runs of spaces in a name count as one. |
| `accounts.matchAliases` | `on` | Aliases such as `A/R` match. |
| `accounts.matchIds` | `on` | Ids such as `accounts-receivable` match. |
| `autofix.inferBlankAmount` | `on` | The one blank amount in an entry is filled in. When off, it stays blank and the entry is flagged as unbalanced. |
| `diagnostics.<code>` | as listed under [Errors](#errors-and-how-the-parser-recovers) | The severity of each check: `error`, `warning`, `hint` or `off`. |
| `cashFlow.inferSections` | `on` | An untagged entry that moves cash is placed in a cash flow section by the accounts on its other side. When off, it is operating. |
| `schedules.firstMonth` | `full-month` | The month an asset is placed in service is depreciated in full, or depreciation starts the month after (`next-month`). |
| `hledger.importMatch` | `last-segment` | Imported account names match by their last part, or by the `full-name`. |
| `hledger.keepUnsupportedAsComments` | `on` | Unused imported directives are kept as comments rather than dropped. |
| `hledger.exportAccountNames` | `type-prefixed` | Exported names look like `assets:cash`, or `plain` like `Cash`. |
| `hledger.exportCurrencySymbol` | `on` | Exported amounts carry a `$`. |
| `spreadsheet.groupRows` | `auto` | Pasted rows are grouped into entries by the Ref column, then by blank rows, then by a change in date or memo. `blank-rows` and `date-and-memo` use only that rule. |
| `spreadsheet.amountSigns` | `negative-credit` | In a single Amount column with no Dr/Cr column, negative amounts are credits, or debits (`negative-debit`). |

## Grammar

The grammar below is consistent with the rules above. Each production describes a single line; how lines group into entries is described under [Entries](#entries). Keywords, month names, `dr`/`cr` and tags are case-insensitive.

```ebnf
file           = { line } ;
line           = ( blank | comment | directive | header | posting ) , eol ;

blank          = { ws } ;
comment        = { ws } , ( "#" | ";" ) , { char } ;

(* Entry headers start at the first column. *)
header         = date-mark , [ ws1 , header-text ] ;
header-text    = memo , { ws1 , tag-group }
               | memo , { ws1 , tag-group } , { ws } , ":" , ws1 , side-items , ws1 , "/" , ws1 , side-items ;
memo           = { char } ;                    (* up to the tags, or the last ":" before "/" *)
tag-group      = "[" , tag , { "," , { ws } , tag } , "]" ;
tag            = "adjusting" | "closing" | "operating" | "investing" | "financing" ;

side-items     = item , { "," , ws1 , item } ;  (* split only after an amount *)
item           = account , [ ws1 , amount ] ;

(* Any other line inside an entry, at any indentation. *)
posting        = { ws } , [ side , ws1 ] , account , [ ws1 , amount ] , { ws } ;
side           = "dr" | "cr" ;

account        = quoted | name ;
name           = word , { ws1 , word } ;       (* the last word is not an amount *)
quoted         = '"' , { char - '"' } , '"' ;

amount         = [ "$" ] , number , [ "k" ] ;
number         = digit , { digit | "," } , [ "." , digit , [ digit ] ] ;

date-mark      = date | "-" ;
date           = iso-date | slash-date | named-date ;
full-date      = iso-date | slash-date-year | named-date-year ;
iso-date       = year , "-" , month-num , "-" , day ;
slash-date     = month-num , "/" , day , [ "/" , year ] ;
slash-date-year = month-num , "/" , day , "/" , year ;
named-date     = month-name , ws1 , day , [ "," , ws1 , year ] ;
named-date-year = month-name , ws1 , day , "," , ws1 , year ;
month-name     = "Jan" | "January" | "Feb" | "February" | "Mar" | "March"
               | "Apr" | "April" | "May" | "Jun" | "June" | "Jul" | "July"
               | "Aug" | "August" | "Sep" | "Sept" | "September"
               | "Oct" | "October" | "Nov" | "November" | "Dec" | "December" ;
year           = digit , digit , digit , digit ;
month-num      = digit , [ digit ] ;
day            = digit , [ digit ] ;

(* Directives start at the first column. *)
directive      = book | open | account-decl | asset-decl | show | set ;
book           = "book" , ws1 , quoted , [ ws1 , "period" , ws1 , full-date , ".." , full-date ] ;
open           = "open" , ws1 , account , ws1 , [ side , ws1 ] , amount ;
account-decl   = "account" , ws1 , quoted , ws1 , type , { ws1 , account-option } ;
type           = "asset" | "liability" | "equity" | "revenue" | "expense" ;
account-option = "contra" , ws1 , quoted
               | "alias" , ws1 , quoted
               | "normal" , ws1 , ( "debit" | "credit" )
               | "group" , ws1 , group-name ;
group-name     = "cash" | "current-assets" | "investments" | "property-plant-equipment"
               | "intangible-assets" | "other-assets"
               | "current-liabilities" | "short-term-debt" | "long-term-liabilities"
               | "contributed-capital" | "retained-earnings" | "dividends"
               | "revenue" | "other-revenue"
               | "cost-of-sales" | "operating-expenses" | "other-expenses" | "income-taxes" ;
asset-decl     = "asset" , ws1 , quoted , { ws1 , asset-part } ;
asset-part     = "account" , ws1 , account        (* a plain name runs up to the next part *)
               | "cost" , ws1 , amount
               | "salvage" , ws1 , amount
               | "life" , ws1 , life-count , ws1 , ( "year" | "years" | "month" | "months" )
               | "method" , ws1 , ( "straight-line" | "double-declining" | "units" )
               | "units" , ws1 , count
               | "used" , ws1 , count , [ ws1 , "in" , ws1 , month ]
               | "from" , ws1 , full-date ;
life-count     = digit , { digit } , [ "." , digit , { digit } ] ;
count          = digit , { digit | "," } , [ "k" ] ;
month          = year , "-" , month-num | month-name , ws1 , year ;
show           = "show" , ws1 , visual , [ { ws } , ":" , { ws } , option , { "," , { ws } , option } ] ;
visual         = "entry-cards" | "t-accounts" | "equation" | "statement-flow"
               | "cash-flow" | "trial-balance" | "schedule" ;
option         = account | word ;
set            = "set" , ws1 , setting-key , ws1 , word ;
setting-key    = word ;                         (* a key from the Settings table *)

word           = char - ws , { char - ws } ;
ws             = " " ;                          (* tabs are expanded before parsing *)
ws1            = ws , { ws } ;
eol            = "\n" | "\r\n" | end of file ;
```

## Errors and how the parser recovers

The parser never stops at a bad line. It reads what it can, keeps going, and records a diagnostic with the exact range of text involved, so the editor can underline the line the same way the visual does. Diagnostics never change the book and never block anything, and they never appear in exports.

Recovery works one line at a time:

- A line the parser can't read at all is kept as an error and skipped. The entry it sits in is still parsed.
- A posting line with a bad amount keeps its account, and its amount is treated as blank.
- A header line with a bad date keeps its memo and postings, and the entry is treated as undated.
- An unknown account, tag or visual is kept as written.

Diagnostics from the book rules (see `diagnose()`):

| Code | Severity | Raised when |
| --- | --- | --- |
| `unbalanced-entry` | error | An entry's debits and credits differ, including after a blank amount is filled in |
| `unknown-account` | error | A posting names an account that is in neither the chart nor its aliases |
| `single-line-entry` | error | An entry has fewer than two posting lines |
| `ambiguous-blank` | error | More than one posting in an entry has no amount |
| `abnormal-balance` | warning | An account's balance has the wrong sign for its type, e.g. negative Cash |
| `odd-side` | warning | A side is unusual for the account type, e.g. revenue debited outside closing |
| `zero-amount` | warning | A posting's amount is 0 |
| `inferred-amount` | hint | A blank amount was filled in; the hint shows the value |
| `outside-period` | hint | An entry's date falls outside the book's period |
| `inferred-cash-section` | hint | An entry moves cash but has no `operating`, `investing` or `financing` tag, so its cash flow section was inferred |
| `depreciation-mismatch` | hint | The depreciation credited to an accumulated depreciation account differs from the schedules of its assets, or scheduled depreciation isn't recorded (see [Checking depreciation entries](#checking-depreciation-entries)) |

An entry with fewer than two lines, or with more than one blank amount, is reported only under its own code, not as unbalanced as well. `odd-side` looks at revenue and expense accounts posted against their normal side, and accepts them in an entry tagged `[closing]`.

Diagnostics from the parser itself:

| Code | Severity | Raised when |
| --- | --- | --- |
| `unreadable-line` | error | A line fits none of the line types, e.g. a posting line before the first entry header |
| `invalid-amount` | error | An amount has more than two decimal places or misplaced commas |
| `invalid-date` | error | A date doesn't exist (`Feb 30`) or can't be read |
| `negative-amount` | warning | An amount is written as negative or in parentheses |
| `unknown-tag` | warning | A tag isn't one of the five recognised tags |
| `unknown-visual` | warning | A `show` line names a visual that doesn't exist |
| `duplicate-book` | warning | A file has more than one `book` line |
| `unknown-setting` | warning | A `set` line names a setting or value Entrypad doesn't know |

## Spreadsheet paste

Rows copied from Excel or Google Sheets can be pasted into the editor, and a `.csv` or `.tsv` file can be dropped on it. The rows are turned into entries written in the shorthand, laid out as the formatter writes them. The spreadsheet is only an input: once the rows are imported, the shorthand text is the book.

The examples in this section are pasted into a book whose period is the 2026 calendar year. These rows, copied from Excel:

```tsv
Date	Ref	Account	Description	Debit	Credit
1/1	1	Cash	Owner invests	10,000	
1/1	1	Common Stock			10,000
1/3	2	Equipment	Buy oven	8,000	
1/3	2	Cash			4,000
1/3	2	Notes Payable			4,000
```

become:

```
Jan 1  Owner invests
  Cash              10,000
      Common Stock          10,000

Jan 3  Buy oven
  Equipment          8,000
      Cash                  4,000
      Notes Payable         4,000
```

### Reading the rows

- Cells can be separated by tabs, which is what Excel and Google Sheets copy, or by commas or semicolons. The separator is taken from the first line that has one: a tab if there is one, otherwise whichever of comma and semicolon appears more often.
- Quoting follows RFC 4180. A cell in double quotes can hold the separator, line breaks, and double quotes written twice (`""`). Spaces before the opening quote are allowed.
- A byte order mark at the start of a file, CRLF line endings, and empty cells at the end of a row are accepted.
- Runs of spaces inside a cell, non-breaking spaces and line breaks included, count as one space, and spaces at either end are dropped.

### Columns

The first row is the header when at least one of its cells is a column name from the table below and none of its cells reads as a date or an amount. Entrypad looks for the header among the first 10 rows that aren't blank, so a title above it is skipped. Names are matched without regard to case, spaces or punctuation: `Dr.`, `DR` and `dr` are the same, `#` reads as "no" (so `JE #` matches `JE No`), and a trailing `USD` is ignored.

| Column | Names it is found by |
| --- | --- |
| Date | Date, Entry Date, Posting Date, Post Date, Transaction Date, Trans Date, Txn Date, Journal Date, GL Date, Effective Date |
| Ref | Ref, Ref No, Reference, Reference No, Reference Number, Entry, Entry No, Entry Number, Entry ID, JE, JE No, JE Number, JE ID, Journal Entry, Journal Entry No, Journal Entry Number, Journal No, Journal Number, Transaction No, Transaction Number, Transaction ID, Txn No, Txn ID, Voucher, Voucher No, No, Number, ID |
| Account | Account, Accounts, Account Name, Account Title, Account Titles, Acct, Acct Name, GL Account, GL Account Name, Ledger Account |
| Memo | Memo, Description, Desc, Explanation, Narration, Narrative, Details, Line Memo, Line Description, Comment, Comments, Note, Notes |
| Debit | Debit, Debits, Dr, Debit Amount, Debit Amt, Dr Amount |
| Credit | Credit, Credits, Cr, Credit Amount, Credit Amt, Cr Amount |
| Amount | Amount, Amt, Value, Net Amount |
| Dr/Cr | Dr/Cr, Cr/Dr, Debit/Credit, Credit/Debit, Debit or Credit, Dr or Cr, DrCr, DC, D/C, Side |

The rows need an Account column and either a Debit and Credit pair or an Amount column. Date, Ref, Memo and Dr/Cr are optional.

Without a header, the columns are guessed from what they hold. A column of dates is the Date column and a column of `Dr` and `Cr` the Dr/Cr column. A column of whole numbers to the left of the account is the Ref column. The other columns of amounts are Debit and Credit, in that order, or the Amount column when there is one of them or a Dr/Cr column. Of the columns of text, the one with the most names from the chart is the Account column, and the first of the others is the Memo column.

Before importing, the editor shows how it has read each column whenever the header is missing or unclear, and the columns can be reassigned there. That happens when:

- there is no header, so the columns were guessed;
- a column's name isn't in the table above (the column is left out);
- two columns have names for the same column (the first is used);
- the Account column is missing, or there are no amount columns, or only one of Debit and Credit;
- there are Debit and Credit columns and also an Amount or Dr/Cr column (the Debit and Credit columns are used).

### Amounts and sides

- Amounts are read as in the shorthand, so `10,000`, `$10,000`, `10,000.00` and `1,200.50` all work. Spaces inside an amount and `USD` before or after it are ignored. A cell holding only `-`, which is how Excel's accounting format shows zero, counts as empty.
- With Debit and Credit columns, the column gives the side. A row with an amount in both is left out and flagged, unless one of the two is 0.
- With an Amount column and a Dr/Cr column, the Dr/Cr cell gives the side. It can be `Dr`, `Debit`, `D`, `Cr`, `Credit` or `C`, in any case.
- With an Amount column alone, or where a row's Dr/Cr cell is empty, the sign gives the side: positive amounts are debits and negative ones, written `-450` or `(450)`, are credits (`spreadsheet.amountSigns`).
- A negative amount in a Debit or Credit column, or beside a Dr or Cr, follows `parsing.negativeAmounts` as in the shorthand. By default it is read as positive on the side it is on, and flagged `negative-amount`.
- A row with an account and no amount becomes a posting with a blank amount. If it is the only one in its entry and nothing gives its side, it takes the side that balances the entry, and the amount is then filled in as described under [Leaving one amount blank](#leaving-one-amount-blank).

```csv
Date,Account,Memo,Amount
1/9,Rent Expense,Pay January rent,"$1,200"
1/9,Cash,,"(1,200)"
1/15,Accounts Receivable,Bill a catering client,3000.00
1/15,Service Revenue,,-3000
```

becomes:

```
Jan 9  Pay January rent
  Rent Expense  1,200
      Cash             1,200

Jan 15 Bill a catering client
  Accounts Receivable  3,000
      Service Revenue         3,000
```

### Dates

A Date cell is read as an entry header's date is in the shorthand: `1/3` is January 3 (`parsing.dateOrder`), and `Jan 3`, `1/3/2026` and `2026-01-03` work too. A date without a year takes its year from the book's period, as in the shorthand. A blank Date cell means the same date as the row above, so a date written only on the first row of each entry is enough.

### Grouping rows into entries

Rows are grouped into entries by the first of these rules that applies (`spreadsheet.groupRows`):

1. By the Ref column, when it has any values. Rows with the same ref form one entry, in the order the refs first appear. A row with an empty Ref cell belongs to the entry above it.
2. By blank rows, when there are any between the rows. The rows between two blank rows form one entry.
3. By a change in the date or the memo. A row starts a new entry when its date differs from the entry's, or when it has a memo and the entry already has a different one.

Under the third rule, two entries in a row with the same date and no memos are read as one. Separate them with a blank row or give them a Ref.

An entry's date and memo come from its first row that has one. The shorthand has one memo per entry, so memos on the entry's later rows are kept as comments above it.

These rows are grouped by the blank row between them, and the title above the header is skipped:

```csv
Sunrise Bakery, adjusting entries
Date,Account,Dr/Cr,Amount
1/31,Depreciation Expense,Dr,200
,"Accumulated Depreciation, Equipment",Cr,200

1/31,Interest Expense,Dr,20
,Interest Payable,Cr,20
```

become:

```
Jan 31
  Depreciation Expense                     200
      Accumulated Depreciation, Equipment       200

Jan 31
  Interest Expense      20
      Interest Payable      20
```

### Rows that can't be read

The import never stops at a bad row. A row that can't be read is reported with its row number, counting the first row of the paste (usually the header) as row 1, and the other rows are imported as usual. A quoted cell with line breaks is still one row. The findings use the shorthand's codes:

| Code | Raised when |
| --- | --- |
| `unreadable-line` | A row has an amount but no account, has both a debit and a credit, or has neither an account nor an amount (the row is left out); a Dr/Cr cell isn't one of the words above (the sign is used instead); or a quote isn't closed (the rest of the text is read as one cell) |
| `invalid-amount` | An amount can't be read. The posting keeps its account and its amount is treated as blank. |
| `invalid-date` | A date can't be read or doesn't exist. The row's entry is undated. |
| `negative-amount` | A Debit or Credit amount, or one beside a Dr or Cr, is negative |

## hledger and ledger

Entrypad reads and writes the plain-text journal format used by [hledger](https://hledger.org) and [ledger](https://ledger-cli.org). The two formats differ in one main way: those tools mark debits and credits with a sign, and Entrypad uses indentation.

```
; hledger / ledger                      ; Entrypad shorthand
2026-01-03 Buy oven                     Jan 3  Buy oven
    assets:equipment     $8,000           Equipment          8,000
    assets:cash         $-4,000               Cash                  4,000
    liabilities:notes   $-4,000               Notes Payable         4,000
```

### Import

The journal is converted to shorthand text, which from then on is the book.

- Dates in `2026-01-03`, `2026/01/03` or `2026.01.03` form become entry dates. Status marks (`*`, `!`), codes in parentheses and secondary dates are dropped.
- A positive amount becomes a debit and a negative amount a credit. Amounts can be written `$8,000`, `$-4,000`, `-$4,000` or `100 USD`; other commodities are flagged `invalid-amount`. A posting with no amount is filled in by the same rule as the shorthand's blank amount, on whichever side balances the transaction.
- Colon-separated account names are matched to the chart by their last part, so `assets:cash` matches Cash. When that part matches nothing, the one account of the right type whose name contains it is used, so `liabilities:notes` matches Notes Payable and `expenses:rent` matches Rent Expense. When it matches more than one account, or none, the last part is kept as written and flagged `unknown-account` with suggestions.
- `;` comments become `#` comments and stay with the transaction they sit in or above. Tags in a transaction's comment that name an Entrypad tag, such as `; adjusting:`, become tags.
- Directives Entrypad doesn't use, such as `commodity`, `include`, price lines, and automated or periodic transactions, are kept as comments and flagged with an `unsupported-directive` hint. So are balance assertions, prices on postings and virtual postings, which are dropped from the posting.

### Export

- Each entry is written as a dated hledger transaction. Debits are positive and credits negative, and amounts carry a `$` and always two decimal places (`$8,000.00`), so a reader can't mistake the comma for a decimal mark. Tags are written as hledger tags, e.g. `; adjusting:`.
- Accounts are written as `<type>:<name>`, using hledger's top-level names: `assets`, `liabilities`, `equity`, `revenues`, `expenses`. The name is lowercased with spaces kept, e.g. `assets:accounts receivable`.
- Opening balances are exported as an ordinary entry dated the first day of the period.
- hledger requires a date on every transaction. An undated entry takes the date of the nearest dated entry above it. If there is none, it takes the period start, and if the book has no period, the date of the export, with a comment noting the substitution.
