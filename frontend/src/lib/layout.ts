export type SplitDir = "row" | "col";

export type Leaf =
  | { type: "leaf"; kind: "term"; id: string }
  | { type: "leaf"; kind: "web"; id: string; url: string }
  | { type: "leaf"; kind: "file"; id: string; path: string };

export type PaneNode =
  | Leaf
  | {
      type: "split";
      id: string;
      dir: SplitDir;
      ratio: number;
      a: PaneNode;
      b: PaneNode;
    };

export const termLeaf = (id: string): Leaf => ({ type: "leaf", kind: "term", id });

export const webLeaf = (id: string, url: string): Leaf => ({
  type: "leaf",
  kind: "web",
  id,
  url,
});

export const fileLeaf = (id: string, path: string): Leaf => ({
  type: "leaf",
  kind: "file",
  id,
  path,
});

export function splitLeaf(
  node: PaneNode,
  targetId: string,
  dir: SplitDir,
  newNode: Leaf,
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== targetId) return node;
    return {
      type: "split",
      id: crypto.randomUUID(),
      dir,
      ratio: 0.5,
      a: node,
      b: newNode,
    };
  }
  return {
    ...node,
    a: splitLeaf(node.a, targetId, dir, newNode),
    b: splitLeaf(node.b, targetId, dir, newNode),
  };
}

/** Insert `subtree` as a sibling of the leaf with `targetId`, wrapping that
 *  leaf in a fresh split. `placeBefore` puts the new subtree as the `a` child
 *  (left/top); false puts it as `b` (right/bottom). Used by drag-a-tab-onto-a-
 *  pane to merge two tabs into one split — the dragged tab's whole subtree
 *  moves in, so nothing orphans. */
export function insertSibling(
  node: PaneNode,
  targetId: string,
  dir: SplitDir,
  subtree: PaneNode,
  placeBefore: boolean,
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== targetId) return node;
    return {
      type: "split",
      id: crypto.randomUUID(),
      dir,
      ratio: 0.5,
      a: placeBefore ? subtree : node,
      b: placeBefore ? node : subtree,
    };
  }
  return {
    ...node,
    a: insertSibling(node.a, targetId, dir, subtree, placeBefore),
    b: insertSibling(node.b, targetId, dir, subtree, placeBefore),
  };
}

/** Remove a leaf; a split with one child collapses into that child. */
export function removeLeaf(node: PaneNode, targetId: string): PaneNode | null {
  if (node.type === "leaf") return node.id === targetId ? null : node;
  const a = removeLeaf(node.a, targetId);
  const b = removeLeaf(node.b, targetId);
  if (a && b) return { ...node, a, b };
  return a ?? b;
}

export function leaves(node: PaneNode): Leaf[] {
  // single accumulator — the naive spread version allocated an intermediate
  // array per split node, and this is called all over the sidebar per render
  const out: Leaf[] = [];
  const walk = (n: PaneNode) => {
    if (n.type === "leaf") out.push(n);
    else {
      walk(n.a);
      walk(n.b);
    }
  };
  walk(node);
  return out;
}

export function leafIds(node: PaneNode): string[] {
  return leaves(node).map((l) => l.id);
}

export function firstLeaf(node: PaneNode): string {
  return node.type === "leaf" ? node.id : firstLeaf(node.a);
}

export function setLeafUrl(
  node: PaneNode,
  targetId: string,
  url: string,
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== targetId || node.kind !== "web") return node;
    return { ...node, url };
  }
  return {
    ...node,
    a: setLeafUrl(node.a, targetId, url),
    b: setLeafUrl(node.b, targetId, url),
  };
}

export function setSplitRatio(
  node: PaneNode,
  splitId: string,
  ratio: number,
): PaneNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) return { ...node, ratio };
  return {
    ...node,
    a: setSplitRatio(node.a, splitId, ratio),
    b: setSplitRatio(node.b, splitId, ratio),
  };
}
