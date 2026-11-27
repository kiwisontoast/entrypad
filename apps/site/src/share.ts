import { fileSettingLines } from "@entrypad/core";
import type { EntrypadSettings, ParseResult } from "@entrypad/core";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

/**
 * Share links carry the whole book in the URL's hash, compressed with
 * lz-string: `/editor/#v1:N4Ig...`. Nothing is sent to a server; the hash
 * never leaves the browser. The `v1:` prefix lets the format change later
 * without breaking old links.
 */

const PREFIX = "v1:";

/** The hash part of a share link for this text, without the `#`. */
export function encodeBook(text: string): string {
  return PREFIX + compressToEncodedURIComponent(text);
}

/** The text in a share link's hash, or undefined if the hash isn't one. */
export function decodeBook(hash: string): string | undefined {
  const body = hash.replace(/^#/, "");
  if (!body.startsWith(PREFIX)) return undefined;
  const text = decompressFromEncodedURIComponent(body.slice(PREFIX.length));
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

/**
 * The text to save or share: the book as written, with a `set` line in
 * front for each file setting the reader has changed from its default and
 * the book doesn't set itself, so the book reads the same for everyone.
 */
export function shareableText(text: string, parsed: Pick<ParseResult, "settings">, reader: EntrypadSettings): string {
  const own = new Set(Object.keys(parsed.settings));
  const lines = fileSettingLines(reader).filter((line) => !own.has(line.split(" ")[1]!));
  if (!lines.length) return text;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return lines.join(newline) + newline + text;
}

/** A full link to a page on this site with the book in its hash. */
export function bookUrl(path: string, text: string, query = ""): string {
  return `${location.origin}${path}${query}#${encodeBook(text)}`;
}
