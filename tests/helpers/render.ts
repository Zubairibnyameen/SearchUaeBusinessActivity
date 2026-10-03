/**
 * Minimal React-tree walker for unit tests.
 *
 * Server components in this app are async functions that return element trees
 * whose children are ordinary function components. To assert on what a page or
 * a presentational component actually emits, the tree has to be walked and the
 * function components invoked — a plain `await Page()` only builds the root.
 *
 * This is deliberately NOT `react-dom/server`. That renderer needs a React
 * runtime plus a full Next environment, and these tests care about structure
 * (which tags, which props, which strings), not about markup escaping or
 * hydration. Keeping it hand-rolled also means no snapshot churn when Tailwind
 * class names change.
 */
export interface RenderedNode {
  /** Lowercase host tag name, e.g. "a", "form", "input". */
  type: string;
  props: Record<string, unknown>;
  /** Concatenated text of this element's own subtree. */
  text: string;
}

export interface Rendered {
  /** Concatenated text content, with tags and attributes omitted. */
  text: string;
  /** Every host element reached, in document order. */
  nodes: RenderedNode[];
  /** Convenience: the tag names only. */
  tags: string[];
  /** Every `href` found, in order. */
  hrefs: string[];
  /** All attributes of the first node matching `predicate`. */
  attrsOf(predicate: (node: RenderedNode) => boolean): Record<string, unknown> | undefined;
  /**
   * Text content of the element carrying the given `data-testid`, or
   * `undefined` when nothing carries it. Lets a test assert on one specific
   * figure instead of a substring that another number could also satisfy.
   */
  byTestId(testId: string): string | undefined;
}

export async function renderElement(element: unknown): Promise<Rendered> {
  const nodes: RenderedNode[] = [];
  const text = await walk(element);

  return {
    text,
    nodes,
    tags: nodes.map(node => node.type),
    hrefs: nodes
      .map(node => node.props.href)
      .filter((href): href is string => typeof href === "string"),
    attrsOf(predicate) {
      return nodes.find(predicate)?.props;
    },
    byTestId(testId) {
      return nodes.find(node => node.props["data-testid"] === testId)?.text;
    },
  };

  async function walk(node: unknown): Promise<string> {
    if (node === null || node === undefined || typeof node === "boolean") {
      return "";
    }
    if (typeof node === "string") return node;
    if (typeof node === "number" || typeof node === "bigint") {
      return String(node);
    }
    if (Array.isArray(node)) {
      const parts: string[] = [];
      for (const child of node) parts.push(await walk(child));
      return parts.join("");
    }
    if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
      const element = node as {
        type: unknown;
        props?: Record<string, unknown>;
        key?: unknown;
      };
      const props = element.props ?? {};

      // Function component: call it and keep walking its output.
      if (typeof element.type === "function") {
        const fn = element.type as (p: Record<string, unknown>) => unknown;
        return walk(await fn(props));
      }

      // Fragments and other exotic element types have no tag of their own.
      if (typeof element.type !== "string") {
        return walk(props.children);
      }

      // Recorded before the children are walked, so the node list stays in
      // document order; `text` is filled in once the subtree is known.
      const record: RenderedNode = { type: element.type, props, text: "" };
      nodes.push(record);
      const childrenText = await walk(props.children);
      record.text = childrenText;
      return childrenText;
    }
    return "";
  }
}
