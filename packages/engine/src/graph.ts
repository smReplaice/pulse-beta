import { DependencyInput, TaskInput } from './types';
import { CircularDependencyError, InvalidDependencyError } from './errors';

export interface HierarchyNode {
  task: TaskInput;
  id: string;
  parentId: string | null;
  childIds: string[];
  /** Computed WBS number, e.g. "1.2.3". */
  wbs: string;
  depth: number;
}

export interface ProgrammeGraph {
  nodes: Record<string, HierarchyNode>;
  /** Display order (rowOrder ascending). */
  orderedIds: string[];
  rootIds: string[];
  summaryIds: Set<string>;
  /** leaf = not a summary */
  leafIds: string[];
  parentsOf: (id: string) => string[];
}

export function buildHierarchy(tasks: TaskInput[]): ProgrammeGraph {
  const sorted = [...tasks].sort((a, b) => a.rowOrder - b.rowOrder);
  const nodes: Record<string, HierarchyNode> = {};
  const orderedIds: string[] = [];
  const stack: HierarchyNode[] = [];

  for (const task of sorted) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= task.outlineLevel) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const node: HierarchyNode = {
      task,
      id: task.id,
      parentId: parent ? parent.id : null,
      childIds: [],
      wbs: '',
      depth: task.outlineLevel,
    };
    nodes[task.id] = node;
    orderedIds.push(task.id);
    if (parent) parent.childIds.push(task.id);
    stack.push(node);
  }

  const rootIds = orderedIds.filter((id) => nodes[id].parentId === null);
  const summaryIds = new Set<string>(orderedIds.filter((id) => nodes[id].childIds.length > 0));
  const leafIds = orderedIds.filter((id) => !summaryIds.has(id));

  // WBS numbering
  const counters: number[] = [];
  for (const id of orderedIds) {
    const node = nodes[id];
    if (counters.length > node.depth + 1) counters.length = node.depth + 1;
    counters[node.depth] = (counters[node.depth] ?? 0) + 1;
    node.wbs = counters.slice(0, node.depth + 1).join('.');
  }

  return {
    nodes,
    orderedIds,
    rootIds,
    summaryIds,
    leafIds,
    parentsOf(id: string): string[] {
      const out: string[] = [];
      let cur = nodes[id]?.parentId ?? null;
      while (cur) {
        out.push(cur);
        cur = nodes[cur].parentId;
      }
      return out;
    },
  };
}

/** True when a links b or b links a where one is an ancestor of the other. */
export function isSummaryToChildLink(
  graph: ProgrammeGraph,
  aId: string,
  bId: string,
): boolean {
  const ancestorsA = new Set(graph.parentsOf(aId));
  if (ancestorsA.has(bId)) return true;
  const ancestorsB = new Set(graph.parentsOf(bId));
  if (ancestorsB.has(aId)) return true;
  return false;
}

/**
 * Topologically sort leaf tasks by dependencies (Kahn).
 * Dependencies involving summary tasks are redirected to boundary leaves:
 *  - predecessor summary → its first leaf (SS/SF) or last leaf (FS/FF)
 *  - successor summary  → its first leaf (FS/SS) or last leaf (FF/SF)
 * Throws CircularDependencyError with the offending cycle.
 */
export function topoSortLeaves(
  graph: ProgrammeGraph,
  deps: DependencyInput[],
): {
  order: string[];
  redirected: Map<string, { from: string; to: string; originalType: string }>;
} {
  const firstLeafCache = new Map<string, string>();
  const lastLeafCache = new Map<string, string>();
  const firstLeaf = (id: string): string => {
    if (firstLeafCache.has(id)) return firstLeafCache.get(id)!;
    let res = id;
    if (graph.summaryIds.has(id)) {
      const descendants = descendantsOf(graph, id);
      res = descendants.find((d) => !graph.summaryIds.has(d)) ?? id;
    }
    firstLeafCache.set(id, res);
    return res;
  };
  const lastLeaf = (id: string): string => {
    if (lastLeafCache.has(id)) return lastLeafCache.get(id)!;
    let res = id;
    if (graph.summaryIds.has(id)) {
      const descendants = descendantsOf(graph, id);
      res = [...descendants].reverse().find((d) => !graph.summaryIds.has(d)) ?? id;
    }
    lastLeafCache.set(id, res);
    return res;
  };

  const redirected = new Map<string, { from: string; to: string; originalType: string }>();
  const edges: { pred: string; succ: string; dep: DependencyInput }[] = [];
  const nameOf = (id: string) => graph.nodes[id]?.task.name ?? id;

  for (const dep of deps) {
    const predIsSummary = graph.summaryIds.has(dep.predecessorId);
    const succIsSummary = graph.summaryIds.has(dep.successorId);
    let pred = dep.predecessorId;
    let succ = dep.successorId;

    if (dep.predecessorId === dep.successorId) {
      throw new InvalidDependencyError('SELF_DEPENDENCY', `A task cannot depend on itself (${nameOf(dep.predecessorId)})`, {
        dependencyId: dep.id,
      });
    }
    if (isSummaryToChildLink(graph, dep.predecessorId, dep.successorId)) {
      throw new InvalidDependencyError(
        'SUMMARY_TO_CHILD_LINK',
        `Cannot link '${nameOf(dep.predecessorId)}' to '${nameOf(dep.successorId)}': one is a summary of the other`,
        { dependencyId: dep.id },
      );
    }

    if (predIsSummary) {
      pred = dep.type === 'SS' || dep.type === 'SF' ? firstLeaf(pred) : lastLeaf(pred);
      redirected.set(dep.id, { from: dep.predecessorId, to: pred, originalType: dep.type });
    }
    if (succIsSummary) {
      succ = dep.type === 'FS' || dep.type === 'SS' ? firstLeaf(succ) : lastLeaf(succ);
      redirected.set(dep.id, { from: dep.successorId, to: succ, originalType: dep.type });
    }
    if (pred === succ) continue; // collapsed onto the same leaf — nothing to order
    edges.push({ pred, succ, dep });
  }

  const indeg = new Map<string, number>();
  const outEdges = new Map<string, { succ: string; dep: DependencyInput }[]>();
  for (const id of graph.leafIds) {
    indeg.set(id, 0);
    outEdges.set(id, []);
  }
  for (const e of edges) {
    outEdges.get(e.pred)!.push({ succ: e.succ, dep: e.dep });
    indeg.set(e.succ, (indeg.get(e.succ) ?? 0) + 1);
  }

  // Deterministic queue: priority by row order so schedules are stable
  const queue = graph.leafIds.filter((id) => (indeg.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of outEdges.get(id)!) {
      const d = indeg.get(e.succ)! - 1;
      indeg.set(e.succ, d);
      if (d === 0) queue.push(e.succ);
    }
  }

  if (order.length !== graph.leafIds.length) {
    // Find the cycle for a helpful error
    const remaining = new Set(graph.leafIds.filter((id) => !order.includes(id)));
    const cycle = findCycle([...remaining], edges);
    throw new CircularDependencyError(
      cycle.map((id) => id),
      cycle.map((id) => nameOf(id)),
    );
  }

  return { order, redirected };
}

export function descendantsOf(graph: ProgrammeGraph, id: string): string[] {
  const out: string[] = [];
  const walk = (nid: string) => {
    for (const c of graph.nodes[nid]?.childIds ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

function findCycle(
  ids: string[],
  edges: { pred: string; succ: string; dep: DependencyInput }[],
): string[] {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.pred)) adj.set(e.pred, []);
    adj.get(e.pred)!.push(e.succ);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  let found: string[] | null = null;

  const dfs = (u: string): boolean => {
    state.set(u, 1);
    path.push(u);
    for (const v of adj.get(u) ?? []) {
      if (!ids.includes(v)) continue;
      const s = state.get(v) ?? 0;
      if (s === 1) {
        const idx = path.indexOf(v);
        found = [...path.slice(idx), v];
        return true;
      }
      if (s === 0 && dfs(v)) return true;
    }
    path.pop();
    state.set(u, 2);
    return false;
  };

  for (const id of ids) {
    if ((state.get(id) ?? 0) === 0) {
      if (dfs(id)) break;
    }
  }
  return found ?? ids;
}

/** Incoming edges for a leaf after summary redirection. */
export function incomingFor(
  leafId: string,
  deps: DependencyInput[],
  graph: ProgrammeGraph,
): { pred: string; dep: DependencyInput }[] {
  const map = effectiveEdges(deps, graph);
  return map.incoming.get(leafId) ?? [];
}

export function outgoingFor(
  leafId: string,
  deps: DependencyInput[],
  graph: ProgrammeGraph,
): { succ: string; dep: DependencyInput }[] {
  const map = effectiveEdges(deps, graph);
  return map.outgoing.get(leafId) ?? [];
}

export function effectiveEdges(deps: DependencyInput[], graph: ProgrammeGraph) {
  const firstLeaf = (id: string) => {
    if (!graph.summaryIds.has(id)) return id;
    const d = descendantsOf(graph, id).filter((x) => !graph.summaryIds.has(x));
    return d[0] ?? id;
  };
  const lastLeaf = (id: string) => {
    if (!graph.summaryIds.has(id)) return id;
    const d = descendantsOf(graph, id).filter((x) => !graph.summaryIds.has(x));
    return d[d.length - 1] ?? id;
  };
  const incoming = new Map<string, { pred: string; dep: DependencyInput }[]>();
  const outgoing = new Map<string, { succ: string; dep: DependencyInput }[]>();
  for (const dep of deps) {
    let pred = dep.predecessorId;
    let succ = dep.successorId;
    if (graph.summaryIds.has(pred)) pred = dep.type === 'SS' || dep.type === 'SF' ? firstLeaf(pred) : lastLeaf(pred);
    if (graph.summaryIds.has(succ)) succ = dep.type === 'FS' || dep.type === 'SS' ? firstLeaf(succ) : lastLeaf(succ);
    if (pred === succ) continue;
    if (!incoming.has(succ)) incoming.set(succ, []);
    incoming.get(succ)!.push({ pred, dep });
    if (!outgoing.has(pred)) outgoing.set(pred, []);
    outgoing.get(pred)!.push({ succ, dep });
  }
  return { incoming, outgoing };
}
