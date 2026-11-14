/**
 * Writes the sample books in this folder: one month each for three invented
 * businesses. Run it with `node examples/generate.ts` from the repo root.
 *
 * Each book comes with `<name>.expected.json`: its account balances, trial
 * balance totals and accounting equation, worked out here with plain
 * arithmetic on integer cents. Nothing in this file uses Entrypad's own code,
 * so the golden tests compare the parser and the derived views against an
 * independent calculation. The figures are written as dollars so they can be
 * checked by hand.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Kind = "asset" | "liability" | "equity" | "revenue" | "expense";
type Normal = "debit" | "credit";

/** The accounts the samples use, with the type and normal balance an accountant would give them. */
const ACCOUNTS: Record<string, { kind: Kind; normal: Normal }> = {
  Cash: { kind: "asset", normal: "debit" },
  "Accounts Receivable": { kind: "asset", normal: "debit" },
  Inventory: { kind: "asset", normal: "debit" },
  Supplies: { kind: "asset", normal: "debit" },
  "Prepaid Rent": { kind: "asset", normal: "debit" },
  "Prepaid Insurance": { kind: "asset", normal: "debit" },
  Equipment: { kind: "asset", normal: "debit" },
  "Accumulated Depreciation, Equipment": { kind: "asset", normal: "credit" },
  "Accounts Payable": { kind: "liability", normal: "credit" },
  "Notes Payable": { kind: "liability", normal: "credit" },
  "Wages Payable": { kind: "liability", normal: "credit" },
  "Interest Payable": { kind: "liability", normal: "credit" },
  "Utilities Payable": { kind: "liability", normal: "credit" },
  "Income Taxes Payable": { kind: "liability", normal: "credit" },
  "Unearned Revenue": { kind: "liability", normal: "credit" },
  "Common Stock": { kind: "equity", normal: "credit" },
  "Retained Earnings": { kind: "equity", normal: "credit" },
  Dividends: { kind: "equity", normal: "debit" },
  "Sales Revenue": { kind: "revenue", normal: "credit" },
  "Service Revenue": { kind: "revenue", normal: "credit" },
  "Cost of Goods Sold": { kind: "expense", normal: "debit" },
  "Wages Expense": { kind: "expense", normal: "debit" },
  "Rent Expense": { kind: "expense", normal: "debit" },
  "Supplies Expense": { kind: "expense", normal: "debit" },
  "Insurance Expense": { kind: "expense", normal: "debit" },
  "Utilities Expense": { kind: "expense", normal: "debit" },
  "Depreciation Expense": { kind: "expense", normal: "debit" },
  "Advertising Expense": { kind: "expense", normal: "debit" },
  "Interest Expense": { kind: "expense", normal: "debit" },
  "Income Tax Expense": { kind: "expense", normal: "debit" },
};

/** Other names the shorthand may use for an account, to exercise aliases. */
const ALIASES: Record<string, string> = { "A/R": "Accounts Receivable", "A/P": "Accounts Payable" };

type Posting = [account: string, cents: number];

interface Txn {
  day: number;
  memo: string;
  tags?: string[];
  dr: Posting[];
  cr: Posting[];
  /** Write it in the one-line form. */
  oneLine?: boolean;
  /** Leave the last credit's amount blank for Entrypad to fill in. */
  blankLastCredit?: boolean;
}

interface Business {
  slug: string;
  name: string;
  year: number;
  month: number;
  intro: string;
  opening?: Posting[];
  txns: Txn[];
  shows: string[];
}

/** A small seeded generator, so the books come out the same every run. */
function seeded(seed: number) {
  let state = seed;
  return (min: number, max: number) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return min + (state % (max - min + 1));
  };
}

/** Dollars to cents, for figures typed below as whole dollars. */
const $ = (dollars: number) => dollars * 100;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function bakery(): Business {
  const sale = seeded(2026_01);
  const weekly = [7, 14, 21, 28].map((day) => ({ day, cents: sale(300_000, 450_000) }));
  return {
    slug: "sunrise-bakery",
    name: "Sunrise Bakery",
    year: 2026,
    month: 1,
    intro: "A bakery's first month: the owner's investment, ovens bought half on a note, weekly sales, a catering client and month-end adjustments.",
    txns: [
      { day: 1, memo: "Owner invests cash", tags: ["financing"], dr: [["Cash", $(25_000)]], cr: [["Common Stock", $(25_000)]] },
      { day: 2, memo: "Pay January rent", dr: [["Rent Expense", $(1_800)]], cr: [["Cash", $(1_800)]], oneLine: true },
      {
        day: 3,
        memo: "Buy ovens, half cash, half note",
        tags: ["investing"],
        dr: [["Equipment", $(12_000)]],
        cr: [
          ["Cash", $(6_000)],
          ["Notes Payable", $(6_000)],
        ],
      },
      { day: 4, memo: "Flour, sugar and boxes on account", dr: [["Supplies", $(2_350)]], cr: [["A/P", $(2_350)]] },
      { day: 5, memo: "Insure the shop for a year", dr: [["Prepaid Insurance", $(1_440)]], cr: [["Cash", $(1_440)]] },
      ...weekly.slice(0, 1).map((w) => ({ day: w.day, memo: "Counter sales, first week", dr: [["Cash", w.cents]] as Posting[], cr: [["Sales Revenue", w.cents]] as Posting[] })),
      {
        day: 10,
        memo: "Bill a catering order",
        dr: [["A/R", $(1_250)]],
        cr: [["Sales Revenue", $(1_250)]],
        blankLastCredit: true,
      },
      ...weekly.slice(1, 2).map((w) => ({ day: w.day, memo: "Counter sales, second week", dr: [["Cash", w.cents]] as Posting[], cr: [["Sales Revenue", w.cents]] as Posting[] })),
      { day: 15, memo: "Pay wages for the first half", dr: [["Wages Expense", $(3_200)]], cr: [["Cash", $(3_200)]] },
      { day: 18, memo: "Pay part of the supplier's bill", dr: [["Accounts Payable", $(1_500)]], cr: [["Cash", $(1_500)]] },
      ...weekly.slice(2, 3).map((w) => ({ day: w.day, memo: "Counter sales, third week", dr: [["Cash", w.cents]] as Posting[], cr: [["Sales Revenue", w.cents]] as Posting[] })),
      { day: 22, memo: "Collect the catering invoice", dr: [["Cash", $(1_250)]], cr: [["Accounts Receivable", $(1_250)]] },
      { day: 25, memo: "Flyers for the opening", dr: [["Advertising Expense", $(300)]], cr: [["Cash", $(300)]], oneLine: true },
      ...weekly.slice(3).map((w) => ({ day: w.day, memo: "Counter sales, fourth week", dr: [["Cash", w.cents]] as Posting[], cr: [["Sales Revenue", w.cents]] as Posting[] })),
      { day: 29, memo: "Pay wages for the second half", dr: [["Wages Expense", $(3_200)]], cr: [["Cash", $(3_200)]] },
      { day: 31, memo: "Supplies used in January", tags: ["adjusting"], dr: [["Supplies Expense", $(1_640)]], cr: [["Supplies", $(1_640)]] },
      { day: 31, memo: "One month of insurance", tags: ["adjusting"], dr: [["Insurance Expense", $(120)]], cr: [["Prepaid Insurance", $(120)]] },
      { day: 31, memo: "Depreciate the ovens", tags: ["adjusting"], dr: [["Depreciation Expense", $(200)]], cr: [["Accumulated Depreciation, Equipment", $(200)]] },
      { day: 31, memo: "Interest owed on the note", tags: ["adjusting"], dr: [["Interest Expense", $(30)]], cr: [["Interest Payable", $(30)]] },
      { day: 31, memo: "January electricity, billed in February", tags: ["adjusting"], dr: [["Utilities Expense", 41_075]], cr: [["Utilities Payable", 41_075]] },
    ],
    shows: ["show t-accounts: Cash, Supplies, Equipment, Accounts Payable, Sales Revenue", "show equation"],
  };
}

function bikeShop(): Business {
  const rand = seeded(2026_03);
  // Bikes sell at a markup: cost is 60% of the price, rounded to the cent.
  const sales = [7, 14, 21, 28].map((day) => {
    const price = rand(180_000, 420_000);
    return { day, price, cost: Math.round((price * 60) / 100) };
  });
  const sale = (s: (typeof sales)[number], memo: string): Txn => ({
    day: s.day,
    memo,
    dr: [
      ["Cash", s.price],
      ["Cost of Goods Sold", s.cost],
    ],
    cr: [
      ["Sales Revenue", s.price],
      ["Inventory", s.cost],
    ],
  });
  return {
    slug: "spoke-and-chain-bikes",
    name: "Spoke & Chain Bikes",
    year: 2026,
    month: 3,
    intro: "An established bike shop's March: opening balances, inventory bought on account, sales with their cost of goods sold, repairs, a customer deposit and a dividend.",
    opening: [
      ["Cash", $(8_000)],
      ["Inventory", $(22_000)],
      ["Equipment", $(6_000)],
      ["Accumulated Depreciation, Equipment", $(1_200)],
      ["Accounts Payable", $(4_800)],
      ["Common Stock", $(20_000)],
      ["Retained Earnings", $(10_000)],
    ],
    txns: [
      { day: 2, memo: "Spring stock on account", dr: [["Inventory", $(9_600)]], cr: [["Accounts Payable", $(9_600)]] },
      { day: 6, memo: "Repairs paid in cash", dr: [["Cash", $(640)]], cr: [["Service Revenue", $(640)]], oneLine: true },
      sale(sales[0]!, "Bike sales, first week"),
      {
        day: 10,
        memo: "Club order on account",
        dr: [
          ["A/R", $(3_800)],
          ["Cost of Goods Sold", $(2_280)],
        ],
        cr: [
          ["Sales Revenue", $(3_800)],
          ["Inventory", $(2_280)],
        ],
      },
      { day: 12, memo: "Pay the bike supplier", dr: [["Accounts Payable", $(7_000)]], cr: [["Cash", $(7_000)]] },
      sale(sales[1]!, "Bike sales, second week"),
      { day: 15, memo: "Pay March rent", dr: [["Rent Expense", $(2_200)]], cr: [["Cash", $(2_200)]], oneLine: true },
      { day: 15, memo: "Pay wages for the first half", dr: [["Wages Expense", $(2_600)]], cr: [["Cash", $(2_600)]] },
      { day: 20, memo: "Club pays part of its order", dr: [["Cash", $(2_000)]], cr: [["Accounts Receivable", $(2_000)]] },
      sale(sales[2]!, "Bike sales, third week"),
      { day: 24, memo: "Deposit on a custom build", tags: ["operating"], dr: [["Cash", $(1_500)]], cr: [["Unearned Revenue", $(1_500)]] },
      { day: 27, memo: "Pay a dividend", tags: ["financing"], dr: [["Dividends", $(1_000)]], cr: [["Cash", $(1_000)]] },
      sale(sales[3]!, "Bike sales, fourth week"),
      { day: 31, memo: "Pay the electricity bill", dr: [["Utilities Expense", 38_540]], cr: [["Cash", 38_540]], blankLastCredit: true },
      { day: 31, memo: "Pay wages for the second half", dr: [["Wages Expense", $(2_600)]], cr: [["Cash", $(2_600)]] },
      { day: 31, memo: "Depreciate the workshop tools", tags: ["adjusting"], dr: [["Depreciation Expense", $(100)]], cr: [["Accumulated Depreciation, Equipment", $(100)]] },
      { day: 31, memo: "Wages earned but not yet paid", tags: ["adjusting"], dr: [["Wages Expense", $(520)]], cr: [["Wages Payable", $(520)]] },
    ],
    shows: ["show t-accounts: Cash, Inventory, Accounts Receivable, Accounts Payable, Cost of Goods Sold", "show equation"],
  };
}

function consulting(): Business {
  const rand = seeded(2026_04);
  const firstBill = rand(650_000, 900_000);
  const secondBill = rand(650_000, 900_000);
  const collected = Math.round((firstBill * 75) / 100);
  // Month-end adjustments, worked out the way an accountant would.
  const retainerEarned = $(9_000) / 3; // a quarter's retainer, one month of three
  const depreciation = Math.round($(4_800) / 36); // laptops over three years
  const interest = Math.round(($(10_000) * 6 * 10) / (100 * 12 * 30)); // 6% a year, 10 days of April
  const unbilled = $(1_600);
  const revenue = firstBill + secondBill + retainerEarned + unbilled;
  const expenses = $(2_750) * 2 + $(1_200) + $(190) + depreciation + interest;
  const tax = Math.round(((revenue - expenses) * 21) / 100);
  return {
    slug: "northfield-advisory",
    name: "Northfield Advisory",
    year: 2026,
    month: 4,
    intro: "A consulting firm's first month: a quarterly retainer received in advance, client billing and collection, a bank loan, and accruals including income tax.",
    txns: [
      { day: 1, memo: "Founders invest cash", tags: ["financing"], dr: [["Cash", $(15_000)]], cr: [["Common Stock", $(15_000)]] },
      { day: 1, memo: "Second-quarter retainer received", tags: ["operating"], dr: [["Cash", $(9_000)]], cr: [["Unearned Revenue", $(9_000)]] },
      { day: 2, memo: "Buy laptops", tags: ["investing"], dr: [["Equipment", $(4_800)]], cr: [["Cash", $(4_800)]], oneLine: true },
      { day: 3, memo: "Prepay six months of rent", dr: [["Prepaid Rent", $(7_200)]], cr: [["Cash", $(7_200)]] },
      { day: 6, memo: "Office supplies on account", dr: [["Supplies", $(480)]], cr: [["Accounts Payable", $(480)]] },
      { day: 10, memo: "Bill clients for the first ten days", dr: [["A/R", firstBill]], cr: [["Service Revenue", firstBill]] },
      { day: 14, memo: "Pay the analyst", dr: [["Wages Expense", $(2_750)]], cr: [["Cash", $(2_750)]] },
      { day: 17, memo: "Clients pay most of the first bill", dr: [["Cash", collected]], cr: [["Accounts Receivable", collected]] },
      { day: 20, memo: "Bank loan at 6%", tags: ["financing"], dr: [["Cash", $(10_000)]], cr: [["Notes Payable", $(10_000)]] },
      { day: 22, memo: "Pay for the supplies", dr: [["Accounts Payable", $(480)]], cr: [["Cash", $(480)]], oneLine: true },
      { day: 24, memo: "Bill clients for the next two weeks", dr: [["Accounts Receivable", secondBill]], cr: [["Service Revenue", secondBill]], blankLastCredit: true },
      { day: 28, memo: "Pay the analyst", dr: [["Wages Expense", $(2_750)]], cr: [["Cash", $(2_750)]] },
      { day: 30, memo: "One month of the retainer earned", tags: ["adjusting"], dr: [["Unearned Revenue", retainerEarned]], cr: [["Service Revenue", retainerEarned]] },
      { day: 30, memo: "One month of rent used", tags: ["adjusting"], dr: [["Rent Expense", $(1_200)]], cr: [["Prepaid Rent", $(1_200)]] },
      { day: 30, memo: "Supplies used", tags: ["adjusting"], dr: [["Supplies Expense", $(190)]], cr: [["Supplies", $(190)]] },
      { day: 30, memo: "Depreciate the laptops", tags: ["adjusting"], dr: [["Depreciation Expense", depreciation]], cr: [["Accumulated Depreciation, Equipment", depreciation]] },
      { day: 30, memo: "Interest on the loan to date", tags: ["adjusting"], dr: [["Interest Expense", interest]], cr: [["Interest Payable", interest]] },
      { day: 30, memo: "Work done but not yet billed", tags: ["adjusting"], dr: [["Accounts Receivable", unbilled]], cr: [["Service Revenue", unbilled]] },
      { day: 30, memo: "Income tax on April's profit at 21%", tags: ["adjusting"], dr: [["Income Tax Expense", tax]], cr: [["Income Taxes Payable", tax]] },
    ],
    shows: ["show t-accounts: Cash, Accounts Receivable, Unearned Revenue, Service Revenue", "show equation"],
  };
}

/** Cents as the shorthand writes them: 10,000 or 1,234.56. */
function money(cents: number): string {
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = cents % 100;
  return frac ? `${whole}.${String(frac).padStart(2, "0")}` : whole;
}

/** Cents as the expected figures write them: always two decimals, a minus sign if negative. */
function dollars(cents: number): string {
  return (cents < 0 ? "-" : "") + money(Math.abs(cents)).replace(/^([\d,]+)$/, "$1.00");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function writeShorthand(b: Business): string {
  const last = DAYS_IN[b.month - 1]!;
  const monthName = new Date(Date.UTC(b.year, b.month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const out: string[] = [
    `# ${b.name}, ${monthName} ${b.year}`,
    `# ${b.intro}`,
    `book "${b.name}" period ${b.year}-${pad2(b.month)}-01..${b.year}-${pad2(b.month)}-${last}`,
    "",
  ];
  if (b.opening) {
    for (const [account, cents] of b.opening) out.push(`open ${account} ${money(cents)}`);
    out.push("");
  }
  for (const t of b.txns) {
    const date = `${MONTHS[b.month - 1]} ${t.day}`.padEnd(6);
    const tags = t.tags?.length ? `   [${t.tags.join(", ")}]` : "";
    if (t.oneLine) {
      const side = (ps: Posting[]) => ps.map(([a, c]) => `${a} ${money(c)}`).join(", ");
      out.push(`${date} ${t.memo}${tags}: ${side(t.dr)} / ${side(t.cr)}`, "");
      continue;
    }
    out.push(`${date} ${t.memo}${tags}`);
    const width = Math.max(...[...t.dr, ...t.cr].map(([a]) => a.length)) + 4;
    for (const [account, cents] of t.dr) out.push(`  ${account.padEnd(width)}${money(cents).padStart(10)}`);
    t.cr.forEach(([account, cents], i) => {
      const blank = t.blankLastCredit && i === t.cr.length - 1;
      out.push(blank ? `      ${account}` : `      ${account.padEnd(width)}${" ".repeat(10)}${money(cents).padStart(10)}`);
    });
    out.push("");
  }
  out.push(...b.shows);
  return out.join("\n") + "\n";
}

export interface Expected {
  book: string;
  period: { start: string; end: string };
  entries: number;
  /** Closing balance of every account used, on its normal side; a minus sign means an abnormal balance. */
  balances: Record<string, string>;
  trialBalance: { debits: string; credits: string };
  equation: { assets: string; liabilities: string; equity: string; netIncome: string };
}

/** Works out the figures with plain sums, independently of Entrypad. */
function expectedFor(b: Business): Expected {
  const debit = new Map<string, number>();
  const credit = new Map<string, number>();
  const name = (a: string) => ALIASES[a] ?? a;
  const post = (map: Map<string, number>, account: string, cents: number) => {
    const n = name(account);
    if (!ACCOUNTS[n]) throw new Error(`Unknown account in a sample: ${account}`);
    map.set(n, (map.get(n) ?? 0) + cents);
  };
  for (const [account, cents] of b.opening ?? []) {
    if (ACCOUNTS[name(account)]!.normal === "debit") post(debit, account, cents);
    else post(credit, account, cents);
  }
  for (const t of b.txns) {
    const dr = t.dr.reduce((s, [, c]) => s + c, 0);
    const cr = t.cr.reduce((s, [, c]) => s + c, 0);
    if (dr !== cr) throw new Error(`${b.name}, ${t.memo}: debits ${dr} don't equal credits ${cr}`);
    for (const [a, c] of t.dr) post(debit, a, c);
    for (const [a, c] of t.cr) post(credit, a, c);
  }

  const balances: Record<string, string> = {};
  const totals = { asset: 0, liability: 0, equity: 0, revenue: 0, expense: 0 };
  let tbDebits = 0;
  let tbCredits = 0;
  for (const account of Object.keys(ACCOUNTS)) {
    if (!debit.has(account) && !credit.has(account)) continue;
    const { kind, normal } = ACCOUNTS[account]!;
    const net = (debit.get(account) ?? 0) - (credit.get(account) ?? 0);
    balances[account] = dollars(normal === "debit" ? net : -net);
    if (net > 0) tbDebits += net;
    else tbCredits -= net;
    // Debit-minus-credit for assets and expenses, credit-minus-debit for the rest.
    totals[kind] += kind === "asset" || kind === "expense" ? net : -net;
  }
  const netIncome = totals.revenue - totals.expense;
  const last = DAYS_IN[b.month - 1]!;
  return {
    book: b.name,
    period: { start: `${b.year}-${pad2(b.month)}-01`, end: `${b.year}-${pad2(b.month)}-${last}` },
    entries: b.txns.length + (b.opening ? 1 : 0),
    balances,
    trialBalance: { debits: dollars(tbDebits), credits: dollars(tbCredits) },
    equation: {
      assets: dollars(totals.asset),
      liabilities: dollars(totals.liability),
      equity: dollars(totals.equity + netIncome),
      netIncome: dollars(netIncome),
    },
  };
}

export interface Sample {
  slug: string;
  text: string;
  expected: Expected;
}

export function samples(): Sample[] {
  return [bakery(), bikeShop(), consulting()].map((b) => ({ slug: b.slug, text: writeShorthand(b), expected: expectedFor(b) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = new URL(".", import.meta.url);
  for (const s of samples()) {
    writeFileSync(new URL(`${s.slug}.entrypad`, dir), s.text);
    writeFileSync(new URL(`${s.slug}.expected.json`, dir), JSON.stringify(s.expected, null, 2) + "\n");
    console.log(`Wrote ${s.slug}: ${s.expected.entries} entries`);
  }
}
