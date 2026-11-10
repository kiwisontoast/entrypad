# The Entrypad shorthand

Status: draft. This describes the format the Phase 1 parser will read. Details may change before the first release.

An Entrypad book is a plain-text file with the `.entrypad` extension. It is laid out like a general journal on paper: a date and a memo, the debit lines, then the credit lines indented beneath them. Anyone who can journalize can write it with very little to learn.

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

| Line | How it is recognized |
| --- | --- |
| Blank | Nothing but spaces or tabs |
| Comment | First non-space character is `#` or `;` |
| Entry header | Starts at the first column with a date or `-` |
| Directive | Starts at the first column with `book`, `open`, `account`, `show` or `set` followed by a space |
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

When a date has no year, the year comes from the book's period: the parser uses the year that places the date inside the period. Without a period, it uses the year of the nearest dated entry above. If there is none, it uses the current year.

The memo is the rest of the line after the date. It can be empty.

Tags go at the end of the header line in square brackets. You can write one tag per bracket pair (`[adjusting] [operating]`) or several separated by commas (`[adjusting, operating]`). The recognized tags are `adjusting`, `closing`, `operating`, `investing` and `financing`, matched without regard to case.

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
- Amounts are always positive. The side comes from indentation or `dr`/`cr`, never from a sign. A negative or parenthesized amount, such as `-500` or `(500)`, is read as 500 on the side the line already has, and the line is flagged.
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

Without `contra` or `normal`, assets and expenses have a normal debit balance and the other types a normal credit balance. An `account` line can come anywhere in the file, and postings above it can use the account.

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

## Settings

Every rule on this page that involves a choice has a setting, and the default is the behavior described above. You can change any of them in the editor's settings, or for one book with a `set` line.

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
| `hledger.importMatch` | `last-segment` | Imported account names match by their last part, or by the `full-name`. |
| `hledger.keepUnsupportedAsComments` | `on` | Unused imported directives are kept as comments rather than dropped. |
| `hledger.exportAccountNames` | `type-prefixed` | Exported names look like `assets:cash`, or `plain` like `Cash`. |
| `hledger.exportCurrencySymbol` | `on` | Exported amounts carry a `$`. |

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
directive      = book | open | account-decl | show | set ;
book           = "book" , ws1 , quoted , [ ws1 , "period" , ws1 , full-date , ".." , full-date ] ;
open           = "open" , ws1 , account , ws1 , [ side , ws1 ] , amount ;
account-decl   = "account" , ws1 , quoted , ws1 , type , { ws1 , account-option } ;
type           = "asset" | "liability" | "equity" | "revenue" | "expense" ;
account-option = "contra" , ws1 , quoted
               | "alias" , ws1 , quoted
               | "normal" , ws1 , ( "debit" | "credit" ) ;
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

Diagnostics from the parser itself:

| Code | Severity | Raised when |
| --- | --- | --- |
| `unreadable-line` | error | A line fits none of the line types, e.g. a posting line before the first entry header |
| `invalid-amount` | error | An amount has more than two decimal places or misplaced commas |
| `invalid-date` | error | A date doesn't exist (`Feb 30`) or can't be read |
| `negative-amount` | warning | An amount is written as negative or in parentheses |
| `unknown-tag` | warning | A tag isn't one of the five recognized tags |
| `unknown-visual` | warning | A `show` line names a visual that doesn't exist |
| `duplicate-book` | warning | A file has more than one `book` line |
| `unknown-setting` | warning | A `set` line names a setting or value Entrypad doesn't know |

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

- Dates in `2026-01-03` or `2026/01/03` form become entry dates. Status marks (`*`, `!`) and codes in parentheses are dropped.
- A positive amount becomes a debit and a negative amount a credit. A posting with no amount is filled in by the same rule as the shorthand's blank amount.
- Colon-separated account names are matched to the chart by their last part, so `assets:cash` matches Cash. When that part matches more than one account, or none, the posting is flagged `unknown-account` with suggestions.
- `;` comments become `#` comments.
- Directives Entrypad doesn't use, such as `commodity`, `include`, price lines, and automated or periodic transactions, are kept as comments and flagged with an `unsupported-directive` hint.

### Export

- Each entry is written as a dated hledger transaction. Debits are positive and credits negative, and amounts carry a `$`.
- Accounts are written as `<type>:<name>`, using hledger's top-level names: `assets`, `liabilities`, `equity`, `revenues`, `expenses`. The name is lowercased with spaces kept, e.g. `assets:accounts receivable`.
- Opening balances are exported as an ordinary entry dated the first day of the period.
- hledger requires a date on every transaction. An undated entry takes the date of the nearest dated entry above it. If there is none, it takes the period start, and if the book has no period, the date of the export, with a comment noting the substitution.
