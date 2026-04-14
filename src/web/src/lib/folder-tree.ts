import type { Folder } from "@preload/index.d";

export type FolderTreeNode = {
  folder: Folder;
  children: FolderTreeNode[];
};

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  // Sort by path depth (shallower first), stable sort preserves original order for same depth
  const sorted = [...folders].sort((a, b) => {
    const da = normalizePath(a.path).split("/").length;
    const db = normalizePath(b.path).split("/").length;
    return da - db;
  });

  const nodes = new Map<number, FolderTreeNode>();
  const roots: FolderTreeNode[] = [];

  for (const folder of sorted) {
    const node: FolderTreeNode = { folder, children: [] };
    const normalizedPath = normalizePath(folder.path);

    // Find the deepest ancestor among already-processed nodes
    let bestParent: FolderTreeNode | null = null;
    for (const [, candidate] of nodes) {
      const candidatePath = normalizePath(candidate.folder.path);
      if (normalizedPath.startsWith(candidatePath + "/")) {
        if (
          !bestParent ||
          candidatePath.length > normalizePath(bestParent.folder.path).length
        ) {
          bestParent = candidate;
        }
      }
    }

    nodes.set(folder.id, node);
    if (bestParent) {
      bestParent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function getAllDescendantIds(node: FolderTreeNode): number[] {
  const ids: number[] = [];
  for (const child of node.children) {
    ids.push(child.folder.id);
    ids.push(...getAllDescendantIds(child));
  }
  return ids;
}

export function findNodeById(
  nodes: FolderTreeNode[],
  id: number,
): FolderTreeNode | null {
  for (const node of nodes) {
    if (node.folder.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}
