export interface Font {
  id: string;
  /** CSS font-family value, with fallbacks. */
  stack: string;
  label: string;
}

const serifFallback = 'Georgia, "Times New Roman", serif';
const sansFallback = '"Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif';
const monoFallback = 'ui-monospace, Consolas, "SF Mono", Menlo, monospace';

export const headingFonts: Font[] = [
  { id: "newsreader", label: "Newsreader", stack: `Newsreader, ${serifFallback}` },
  { id: "source-serif", label: "Source Serif 4", stack: `"Source Serif 4", ${serifFallback}` },
  { id: "plex-serif", label: "IBM Plex Serif", stack: `"IBM Plex Serif", ${serifFallback}` },
  { id: "literata", label: "Literata", stack: `Literata, ${serifFallback}` },
  { id: "spectral", label: "Spectral", stack: `Spectral, ${serifFallback}` },
  { id: "system-serif", label: "System serif", stack: `"Iowan Old Style", Charter, ${serifFallback}` },
];

export const textFonts: Font[] = [
  { id: "inter", label: "Inter", stack: `Inter, ${sansFallback}` },
  { id: "source-sans", label: "Source Sans 3", stack: `"Source Sans 3", ${sansFallback}` },
  { id: "plex-sans", label: "IBM Plex Sans", stack: `"IBM Plex Sans", ${sansFallback}` },
  { id: "public-sans", label: "Public Sans", stack: `"Public Sans", ${sansFallback}` },
  { id: "system-sans", label: "System sans", stack: sansFallback },
];

export const monoFonts: Font[] = [
  { id: "jetbrains", label: "JetBrains Mono", stack: `"JetBrains Mono", ${monoFallback}` },
  { id: "source-code", label: "Source Code Pro", stack: `"Source Code Pro", ${monoFallback}` },
  { id: "plex-mono", label: "IBM Plex Mono", stack: `"IBM Plex Mono", ${monoFallback}` },
  { id: "system-mono", label: "System mono", stack: monoFallback },
];

export interface Pairing {
  id: string;
  name: string;
  heading: string;
  text: string;
  mono: string;
  why: string;
  pick?: boolean;
}

export const pairings: Pairing[] = [
  {
    id: "newsreader-inter",
    name: "Newsreader and Inter",
    heading: "newsreader",
    text: "inter",
    mono: "jetbrains",
    why: "A quiet editorial serif for headings. Inter was drawn for screens, and its figures stay clear at the small sizes T-accounts use.",
    pick: true,
  },
  {
    id: "source",
    name: "Source Serif and Source Sans",
    heading: "source-serif",
    text: "source-sans",
    mono: "source-code",
    why: "Adobe's Source family: serif, sans and code fonts designed to work together. Calm and easy to read at length.",
  },
  {
    id: "plex",
    name: "IBM Plex",
    heading: "plex-serif",
    text: "plex-sans",
    mono: "plex-mono",
    why: "IBM's corporate family. Precise and businesslike, with a matching mono for the shorthand.",
  },
  {
    id: "literata-public",
    name: "Literata and Public Sans",
    heading: "literata",
    text: "public-sans",
    mono: "jetbrains",
    why: "Literata is a warm book serif made for reading on screens. Public Sans is the plain, neutral sans of the US government's design system.",
  },
  {
    id: "spectral-source",
    name: "Spectral and Source Sans",
    heading: "spectral",
    text: "source-sans",
    mono: "source-code",
    why: "Spectral is lighter and more elegant. It suits large headings but looks thin at small sizes.",
  },
  {
    id: "system",
    name: "System fonts (current)",
    heading: "system-serif",
    text: "system-sans",
    mono: "system-mono",
    why: "What the site uses today. Nothing to download, but it looks different on Windows, Mac and phones.",
  },
];

export function find(list: Font[], id: string): Font {
  return list.find((f) => f.id === id) ?? list[0]!;
}
