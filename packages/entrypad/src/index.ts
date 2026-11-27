// The one-line install: everything in @entrypad/core, @entrypad/react and
// @entrypad/export. Where a name exists in more than one, the component
// from @entrypad/react wins; the others stay available from their own
// package.
export * from "@entrypad/core";
export * from "@entrypad/export";
export * from "@entrypad/react";

// Names both core and react use: the component comes from react, and core's
// type travels under a longer name.
export { Equation } from "@entrypad/react";
export type { Equation as EquationTotals } from "@entrypad/core";
