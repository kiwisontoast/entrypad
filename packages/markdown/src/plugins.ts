import { renderBlock } from "./render.js";
import type { BlockOptions } from "./render.js";

/** The fence language that marks an Entrypad block. */
export const LANGUAGE = "entrypad";

const isEntrypad = (info: string | null | undefined) => (info ?? "").trim().split(/\s+/)[0] === LANGUAGE;

// The few shapes of markdown-it and mdast the plugins touch, so neither
// library is a dependency. Both plugins work with any recent version.

interface FenceToken {
  info: string;
  content: string;
}
type FenceRule = (tokens: FenceToken[], idx: number, options: unknown, env: unknown, self: unknown) => string;
interface MarkdownItLike {
  renderer: { rules: { fence?: FenceRule } };
}

/**
 * A markdown-it plugin: ` ```entrypad ` blocks become Entrypad visuals.
 * Works in Marp and anywhere else built on markdown-it.
 *
 *     md.use(markdownItEntrypad, { width: 720 })
 */
export function markdownItEntrypad(md: MarkdownItLike, options: BlockOptions = {}): void {
  const fallback = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]!;
    if (isEntrypad(token.info)) return renderBlock(token.content, options);
    return fallback ? fallback(tokens, idx, opts, env, self) : `<pre><code>${token.content}</code></pre>\n`;
  };
}

interface MdNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MdNode[];
}

/**
 * A remark plugin: ` ```entrypad ` blocks become Entrypad visuals, as raw
 * HTML nodes. With remark-rehype, pass `allowDangerousHtml: true` (and use
 * rehype-raw or rehype-stringify's `allowDangerousHtml`) so they survive.
 *
 *     unified().use(remarkParse).use(remarkEntrypad).use(remarkHtml, { sanitize: false })
 */
export function remarkEntrypad(options: BlockOptions = {}) {
  return (tree: MdNode): void => {
    const visit = (node: MdNode) => {
      if (node.type === "code" && isEntrypad(node.lang)) {
        const html = renderBlock(node.value ?? "", options);
        node.type = "html";
        node.value = html;
        delete node.lang;
        return;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
