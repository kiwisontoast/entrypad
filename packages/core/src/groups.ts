import type { Account, AccountType } from "./types.js";

/**
 * The statement groups an account can belong to, in the order the
 * statements show them. Each group belongs to one account type.
 */
export const accountGroups = [
  { id: "cash", type: "asset", label: "Cash and cash equivalents" },
  { id: "current-assets", type: "asset", label: "Current assets" },
  { id: "investments", type: "asset", label: "Investments" },
  { id: "property-plant-equipment", type: "asset", label: "Property, plant, and equipment" },
  { id: "intangible-assets", type: "asset", label: "Intangible assets" },
  { id: "other-assets", type: "asset", label: "Other assets" },
  { id: "current-liabilities", type: "liability", label: "Current liabilities" },
  { id: "short-term-debt", type: "liability", label: "Short-term debt" },
  { id: "long-term-liabilities", type: "liability", label: "Long-term liabilities" },
  { id: "contributed-capital", type: "equity", label: "Contributed capital" },
  { id: "retained-earnings", type: "equity", label: "Retained earnings" },
  { id: "dividends", type: "equity", label: "Dividends" },
  { id: "revenue", type: "revenue", label: "Revenue" },
  { id: "other-revenue", type: "revenue", label: "Other revenue" },
  { id: "cost-of-sales", type: "expense", label: "Cost of sales" },
  { id: "operating-expenses", type: "expense", label: "Operating expenses" },
  { id: "other-expenses", type: "expense", label: "Other expenses" },
  { id: "income-taxes", type: "expense", label: "Income taxes" },
] as const satisfies readonly { id: string; type: AccountType; label: string }[];

export type AccountGroup = (typeof accountGroups)[number]["id"];

/** The group an account of each type gets when its `account` line names none. */
export const defaultGroups: Record<AccountType, AccountGroup> = {
  asset: "current-assets",
  liability: "current-liabilities",
  equity: "contributed-capital",
  revenue: "revenue",
  expense: "operating-expenses",
};

export const groupLabels = Object.fromEntries(accountGroups.map((g) => [g.id, g.label])) as Record<AccountGroup, string>;

/** The groups an account of this type can belong to. */
export function groupsFor(type: AccountType): AccountGroup[] {
  return accountGroups.filter((g) => g.type === type).map((g) => g.id);
}

export function isGroupFor(type: AccountType, group: string | undefined): group is AccountGroup {
  return group !== undefined && accountGroups.some((g) => g.id === group && g.type === type);
}

/**
 * The group the statements put an account in: its own when that suits its
 * type; otherwise, for a contra account, the group of the account it
 * offsets; otherwise the default for its type.
 */
export function effectiveGroup(account: Account, chart: readonly Account[], depth = 0): AccountGroup {
  if (isGroupFor(account.type, account.group)) return account.group;
  const base = account.contraOf && depth < 4 ? chart.find((a) => a.id === account.contraOf) : undefined;
  if (base && base.type === account.type) return effectiveGroup(base, chart, depth + 1);
  return defaultGroups[account.type];
}
