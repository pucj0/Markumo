import type { WorkspaceInfo, WorkspaceNode } from './contracts'

export const treeRowHeight = 26

export function treeWindow(total: number, scrollTop: number, height: number, rowHeight = treeRowHeight) {
  const visible = Math.max(1, Math.ceil(height / rowHeight) + 1)
  const overscan = Math.max(4, Math.ceil(visible * .2))
  const count = Math.min(total, visible + overscan * 2)
  const start = Math.max(0, Math.min(Math.floor(scrollTop / rowHeight) - overscan, total - count))
  return { start, count, before: start * rowHeight, after: Math.max(0, total - start - count) * rowHeight }
}

export interface TreeRow {
  node: WorkspaceNode
  depth: number
  root?: WorkspaceInfo
  compactChain?: WorkspaceNode[]
}

export function getCompactChain(node: WorkspaceNode, maxDepth = 64): WorkspaceNode[] {
  const chain: WorkspaceNode[] = [node]
  let current = node
  while (
    current.children &&
    current.children.length === 1 &&
    current.children[0].isDirectory &&
    !current.children[0].isSymlink &&
    chain.length < maxDepth
  ) {
    current = current.children[0]
    chain.push(current)
  }
  return chain
}

export function buildFlatTree(
  roots: WorkspaceInfo[],
  collapsedRoots: string[],
  compactFolders: boolean,
): TreeRow[] {
  const rows: TreeRow[] = []

  const visit = (nodes: WorkspaceNode[], depth: number) => {
    for (const node of nodes) {
      if (!compactFolders || !node.isDirectory || node.isSymlink) {
        rows.push({ node, depth })
        if (node.isDirectory && node.isExpanded && node.children) {
          visit(node.children, depth + 1)
        }
        continue
      }

      const chain = getCompactChain(node)
      if (chain.length > 1) {
        const tail = chain[chain.length - 1]
        const isExpanded = chain.some(item => item.isExpanded)
        rows.push({ node, depth, compactChain: chain })
        if (isExpanded && tail.isExpanded && tail.children) {
          visit(tail.children, depth + 1)
        }
      } else {
        rows.push({ node, depth })
        if (node.isExpanded && node.children) {
          visit(node.children, depth + 1)
        }
      }
    }
  }

  for (const root of roots) {
    rows.push({
      root,
      depth: 0,
      node: {
        id: root.rootPath,
        name: root.name,
        path: root.rootPath,
        relativePath: '',
        isDirectory: true,
        isSymlink: false,
        isReadOnly: false,
        size: 0,
        mtime: null,
        hasChildren: true,
      },
    })
    if (!collapsedRoots.includes(root.rootPath)) {
      visit(root.entries, 1)
    }
  }

  return rows
}
