import type { Account } from "../types.js";

const asset = (id: string, name: string, group: string, extra: Partial<Account> = {}): Account => ({
  id,
  name,
  type: "asset",
  normal: "debit",
  group,
  ...extra,
});
const contraAsset = (id: string, name: string, group: string, contraOf: string): Account => ({
  id,
  name,
  type: "asset",
  normal: "credit",
  group,
  contraOf,
});
const liability = (id: string, name: string, group: string, extra: Partial<Account> = {}): Account => ({
  id,
  name,
  type: "liability",
  normal: "credit",
  group,
  ...extra,
});
const equity = (id: string, name: string, normal: Account["normal"] = "credit"): Account => ({
  id,
  name,
  type: "equity",
  normal,
  group: "equity",
});
const revenue = (id: string, name: string): Account => ({
  id,
  name,
  type: "revenue",
  normal: "credit",
  group: "revenue",
});
const expense = (id: string, name: string, group = "operating-expenses"): Account => ({
  id,
  name,
  type: "expense",
  normal: "debit",
  group,
});

/** The default chart of accounts for introductory financial accounting, US GAAP labels. */
export const usGaapIntroChart: readonly Account[] = [
  asset("cash", "Cash", "current-assets"),
  asset("petty-cash", "Petty Cash", "current-assets"),
  asset("accounts-receivable", "Accounts Receivable", "current-assets", {
    aliases: ["A/R", "AR", "Receivables"],
  }),
  contraAsset(
    "allowance-for-doubtful-accounts",
    "Allowance for Doubtful Accounts",
    "current-assets",
    "accounts-receivable",
  ),
  asset("notes-receivable", "Notes Receivable", "current-assets"),
  asset("interest-receivable", "Interest Receivable", "current-assets"),
  asset("inventory", "Inventory", "current-assets"),
  asset("supplies", "Supplies", "current-assets"),
  asset("prepaid-rent", "Prepaid Rent", "current-assets"),
  asset("prepaid-insurance", "Prepaid Insurance", "current-assets"),
  asset("land", "Land", "property-plant-equipment"),
  asset("buildings", "Buildings", "property-plant-equipment"),
  contraAsset(
    "accumulated-depreciation-buildings",
    "Accumulated Depreciation, Buildings",
    "property-plant-equipment",
    "buildings",
  ),
  asset("equipment", "Equipment", "property-plant-equipment"),
  contraAsset(
    "accumulated-depreciation-equipment",
    "Accumulated Depreciation, Equipment",
    "property-plant-equipment",
    "equipment",
  ),
  liability("accounts-payable", "Accounts Payable", "current-liabilities", {
    aliases: ["A/P", "AP", "Payables"],
  }),
  liability("notes-payable", "Notes Payable", "current-liabilities"),
  liability("wages-payable", "Wages Payable", "current-liabilities", { aliases: ["Salaries Payable"] }),
  liability("interest-payable", "Interest Payable", "current-liabilities"),
  liability("income-taxes-payable", "Income Taxes Payable", "current-liabilities"),
  liability("utilities-payable", "Utilities Payable", "current-liabilities"),
  liability("unearned-revenue", "Unearned Revenue", "current-liabilities", {
    aliases: ["Deferred Revenue"],
  }),
  equity("common-stock", "Common Stock"),
  equity("additional-paid-in-capital", "Additional Paid-in Capital"),
  equity("retained-earnings", "Retained Earnings"),
  equity("dividends", "Dividends", "debit"),
  revenue("service-revenue", "Service Revenue"),
  revenue("sales-revenue", "Sales Revenue"),
  revenue("interest-revenue", "Interest Revenue"),
  expense("cost-of-goods-sold", "Cost of Goods Sold", "cost-of-sales"),
  expense("wages-expense", "Wages Expense"),
  expense("rent-expense", "Rent Expense"),
  expense("supplies-expense", "Supplies Expense"),
  expense("insurance-expense", "Insurance Expense"),
  expense("utilities-expense", "Utilities Expense"),
  expense("depreciation-expense", "Depreciation Expense"),
  expense("advertising-expense", "Advertising Expense"),
  expense("bad-debt-expense", "Bad Debt Expense"),
  expense("interest-expense", "Interest Expense", "other-expenses"),
  expense("income-tax-expense", "Income Tax Expense", "income-taxes"),
];
