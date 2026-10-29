import type { ConnectedGraph, ConnectedGraphNode } from "../annotationTypes";

export type GraphSort =
  "connections" | "recent" | "alphabetical" | "subject" | "type" | "relevance";
export type GraphSelection = {
  query?: string;
  keywords?: string[];
  keywordMode?: "any" | "all";
  nodeKinds?: ConnectedGraphNode["kind"][];
  linkKinds?: string[];
  includeSuggested?: boolean;
  sort?: GraphSort;
  focusId?: string;
  hops?: number;
  hideIsolated?: boolean;
  limit?: number;
};
const stopWords = new Set(
  "the and for with from that this into about what where when how are was were has have had not yet can will their its only than then each which source lesson concept note understanding learning study introduction general".split(
    " ",
  ),
);
export const graphTokens = (value: string) => [
  ...new Set(
    (
      value
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}_-]+/gu) || []
    ).filter((token) => token.length >= 2 && !stopWords.has(token)),
  ),
];
/** Facets describe topics. Keep numerical queries usable without promoting IDs
 * and numbered fixture/item labels into the suggested keyword list. */
export const graphKeywordTokens = (value: string) =>
  graphTokens(value).filter((token) => /\p{L}/u.test(token));

/** Fit declared dot geometry, including negative coordinates and unmeasured
 * offscreen nodes. React Flow's measured-only fit can otherwise miss them. */
export function connectedGraphViewport(
  positions: Record<string, { x: number; y: number }>,
  width: number,
  height: number,
  showLabels = false,
) {
  const points = Object.values(positions).filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (
    !points.length ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const left = Math.min(...points.map((point) => point.x)),
    top = Math.min(...points.map((point) => point.y)),
    right =
      Math.max(...points.map((point) => point.x)) + (showLabels ? 205 : 40),
    bottom = Math.max(...points.map((point) => point.y)) + 40,
    padding = Math.min(64, Math.max(24, Math.min(width, height) * 0.08)),
    zoom = Math.min(
      1.25,
      Math.max(1, width - padding * 2) / (right - left),
      Math.max(1, height - padding * 2) / (bottom - top),
    );
  return {
    x: width / 2 - ((left + right) / 2) * zoom,
    y: height / 2 - ((top + bottom) / 2) * zoom,
    zoom,
  };
}
const searchable = (node: ConnectedGraphNode) =>
  `${node.label} ${node.definition} ${node.evidence || ""} ${node.subjectName || ""}`
    .normalize("NFKC")
    .toLocaleLowerCase();
export function graphDegrees(graph: Pick<ConnectedGraph, "nodes" | "links">) {
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.links) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  return degree;
}
export function sortGraphNodes(
  nodes: ConnectedGraphNode[],
  graph: Pick<ConnectedGraph, "nodes" | "links">,
  sort: GraphSort = "connections",
  query = "",
) {
  const degree = graphDegrees(graph),
    terms = graphTokens(query);
  const relevance = (node: ConnectedGraphNode) =>
    terms.reduce(
      (score, term) =>
        score +
        (node.label.toLocaleLowerCase().includes(term)
          ? 8
          : searchable(node).includes(term)
            ? 1
            : 0),
      0,
    );
  return nodes.slice().sort((a, b) => {
    let order = 0;
    if (sort === "connections")
      order = (degree.get(b.id) || 0) - (degree.get(a.id) || 0);
    if (sort === "recent")
      order =
        (Date.parse(b.updatedAt || "") || 0) -
        (Date.parse(a.updatedAt || "") || 0);
    if (sort === "subject")
      order = (a.subjectName || a.subjectId || "").localeCompare(
        b.subjectName || b.subjectId || "",
      );
    if (sort === "type") order = a.kind.localeCompare(b.kind);
    if (sort === "relevance") order = relevance(b) - relevance(a);
    return order || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  });
}
/** Select a small, query-relevant connected view without changing source records. */
export function selectConnectedGraph(
  graph: ConnectedGraph,
  options: GraphSelection = {},
): ConnectedGraph {
  const limit = Math.min(600, Math.max(10, options.limit || 160));
  const nodes = graph.nodes.filter(
    (node) =>
      !options.nodeKinds?.length || options.nodeKinds.includes(node.kind),
  );
  const ids = new Set(nodes.map((node) => node.id));
  const sourceLinks = graph.links.filter(
    (edge) =>
      edge.state !== "rejected" &&
      (options.includeSuggested !== false || edge.state !== "suggested"),
  );
  const links = sourceLinks.filter(
    (edge) =>
      (!options.linkKinds?.length || options.linkKinds.includes(edge.kind)) &&
      ids.has(edge.source) &&
      ids.has(edge.target),
  );
  const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of links) {
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  const query = graphTokens(options.query || "");
  const keywords = (options.keywords || [])
    .map((word) => word.normalize("NFKC").trim().toLocaleLowerCase())
    .filter(Boolean)
    .slice(0, 12);
  const filtered = Boolean(query.length || keywords.length);
  const matches = nodes.filter((node) => {
    const content = searchable(node);
    const keywordMatch = keywords.map((term) => content.includes(term));
    return (
      query.every((term) => content.includes(term)) &&
      (!keywordMatch.length ||
        (options.keywordMode === "all"
          ? keywordMatch.every(Boolean)
          : keywordMatch.some(Boolean)))
    );
  });
  const matched = new Set(matches.map((node) => node.id));
  const wanted = new Set(matched);
  if (filtered)
    for (const id of matched)
      for (const neighbor of neighbors.get(id) || []) wanted.add(neighbor);
  if (options.focusId) {
    const neighborhood = new Set([options.focusId]);
    let frontier = [options.focusId];
    for (
      let hop = 0;
      hop < Math.min(2, Math.max(1, options.hops || 1));
      hop++
    ) {
      const next: string[] = [];
      for (const id of frontier)
        for (const neighbor of neighbors.get(id) || [])
          if (!neighborhood.has(neighbor)) {
            neighborhood.add(neighbor);
            next.push(neighbor);
          }
      frontier = next;
    }
    for (const id of [...wanted]) if (!neighborhood.has(id)) wanted.delete(id);
  }
  let candidates = nodes.filter(
    (node) =>
      wanted.has(node.id) &&
      (!options.hideIsolated || (neighbors.get(node.id)?.size || 0) > 0),
  );
  const totalNodes = candidates.length;
  const ranked = sortGraphNodes(
    candidates,
    { nodes, links },
    options.sort,
    options.query,
  );
  // Direct matches and the selected focus are never displaced by high-degree
  // sources when search has narrowed a large subject.
  ranked.sort(
    (a, b) =>
      Number(b.id === options.focusId) - Number(a.id === options.focusId) ||
      (filtered ? Number(matched.has(b.id)) - Number(matched.has(a.id)) : 0),
  );
  const chosen = new Set<string>();
  if (candidates.length > limit) {
    const available = new Set(candidates.map((node) => node.id));
    if (!filtered && !options.focusId) {
      const subjects = new Set<string>();
      for (const node of ranked) {
        const subject = node.subjectId || "general";
        if (!subjects.has(subject) && chosen.size < limit) {
          chosen.add(node.id);
          subjects.add(subject);
        }
      }
    }
    for (const node of ranked) {
      if (chosen.size >= limit) break;
      chosen.add(node.id);
      // Fill neighbors only after the direct matches have had a place.
      if (filtered && matched.has(node.id)) continue;
      for (const neighbor of neighbors.get(node.id) || []) {
        if (chosen.size >= limit) break;
        if (available.has(neighbor)) chosen.add(neighbor);
      }
    }
    candidates = ranked.filter((node) => chosen.has(node.id));
  } else candidates = ranked;
  const visible = new Set(candidates.map((node) => node.id));
  const words = new Map<string, number>();
  for (const node of graph.nodes)
    for (const word of graphKeywordTokens(node.label))
      words.set(word, (words.get(word) || 0) + 1);
  const clusters = new Map<
    string,
    { id: string; label: string; count: number }
  >();
  for (const node of graph.nodes) {
    const id = node.subjectId || "general";
    const item = clusters.get(id) || {
      id,
      label: node.subjectName || "General",
      count: 0,
    };
    item.count++;
    clusters.set(id, item);
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const backlinks: NonNullable<ConnectedGraph["backlinks"]> = {},
    backlinkCounts: Record<string, number> = {};
  for (const node of candidates) {
    const relevant = sourceLinks.filter(
      (link) => link.source === node.id || link.target === node.id,
    );
    backlinkCounts[node.id] = relevant.length;
    backlinks[node.id] = relevant
      .map((link) => ({
        link,
        node: byId.get(link.source === node.id ? link.target : link.source)!,
      }))
      .sort(
        (a, b) =>
          Number(b.node.kind !== "concept") -
            Number(a.node.kind !== "concept") ||
          a.node.label.localeCompare(b.node.label),
      )
      .slice(0, 40)
      .map(({ node, link }) => ({
        node: {
          ...node,
          definition: node.definition.slice(0, 600),
          evidence: node.evidence?.slice(0, 500),
        },
        link,
      }));
  }
  return {
    nodes: candidates,
    backlinks,
    backlinkCounts,
    links: links.filter(
      (edge) => visible.has(edge.source) && visible.has(edge.target),
    ),
    positions: Object.fromEntries(
      Object.entries(graph.positions).filter(([id]) => visible.has(id)),
    ),
    totalNodes,
    truncated: totalNodes > candidates.length,
    availableNodes: graph.nodes.length,
    matchedNodes: filtered ? matches.length : undefined,
    totalLinks: links.length,
    appliedLimit: limit,
    keywords: [...words]
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
      .slice(0, 36),
    relationTypes: [
      ...new Set(
        graph.links
          .filter((edge) => edge.state !== "rejected")
          .map((edge) => edge.kind),
      ),
    ]
      .sort()
      .map((kind) => ({
        kind,
        count: graph.links.filter(
          (edge) => edge.kind === kind && edge.state !== "rejected",
        ).length,
      })),
    clusters: [...clusters.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    ),
  };
}

/** Bounded deterministic force layout for dot nodes. Saved pins never move. */
export function layoutConnectedGraph(graph: ConnectedGraph) {
  const groups = [
    ...new Set(graph.nodes.map((node) => node.subjectId || "general")),
  ].sort();
  const dense = graph.nodes.length > 55,
    separation = dense ? 86 : 190;
  const groupNodes = new Map(
    groups.map((group) => [
      group,
      graph.nodes.filter((node) => (node.subjectId || "general") === group),
    ]),
  );
  const centers = new Map(
    groups.map((group, index) => [
      group,
      {
        x:
          (index % 3) *
          Math.max(
            850,
            separation * Math.sqrt(groupNodes.get(group)!.length) * 1.8,
          ),
        y: Math.floor(index / 3) * 1050,
      },
    ]),
  );
  const positions = new Map(
    graph.nodes.map((node) => {
      const saved = graph.positions[node.id],
        group = node.subjectId || "general",
        index = groupNodes.get(group)!.findIndex((item) => item.id === node.id),
        center = centers.get(group)!;
      const angle = index * 2.399963229728653,
        radius = separation * Math.sqrt(index + 1);
      return [
        node.id,
        {
          x: saved?.x ?? center.x + Math.cos(angle) * radius,
          y: saved?.y ?? center.y + Math.sin(angle) * radius,
          pinned: !!saved?.pinned,
        },
      ];
    }),
  );
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (let iteration = 0; iteration < 85; iteration++) {
    const force = new Map(graph.nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    // At most600 rendered nodes. A spatial hash keeps repulsion local and
    // avoids layout cost growing quadratically with the complete library.
    const cellSize = separation * 2.6,
      buckets = new Map<string, string[]>();
    for (const node of graph.nodes) {
      const p = positions.get(node.id)!,
        key = `${Math.floor(p.x / cellSize)},${Math.floor(p.y / cellSize)}`;
      buckets.set(key, [...(buckets.get(key) || []), node.id]);
    }
    for (const node of graph.nodes) {
      const p = positions.get(node.id)!,
        cellX = Math.floor(p.x / cellSize),
        cellY = Math.floor(p.y / cellSize),
        f = force.get(node.id)!;
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (const other of buckets.get(`${cellX + x},${cellY + y}`) || []) {
            if (other === node.id) continue;
            const q = positions.get(other)!,
              dx = p.x - q.x || 0.1,
              dy = p.y - q.y || 0.1,
              dist = Math.max(2, Math.hypot(dx, dy));
            const repulsion = Math.min(
              25,
              (separation * separation * 3) / (dist * dist),
            );
            f.x += (dx / dist) * repulsion;
            f.y += (dy / dist) * repulsion;
            if (!dense && Math.abs(dx) < 225 && Math.abs(dy) < 46) {
              const overlapX = 225 - Math.abs(dx),
                overlapY = 46 - Math.abs(dy);
              if (overlapY < overlapX)
                f.y += (dy < 0 ? -1 : 1) * overlapY * 0.35;
              else f.x += (dx < 0 ? -1 : 1) * overlapX * 0.35;
            }
          }
      const center = centers.get(node.subjectId || "general")!;
      f.x += (center.x - p.x) * 0.002;
      f.y += (center.y - p.y) * 0.002;
    }
    for (const edge of graph.links) {
      const a = positions.get(edge.source),
        b = positions.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        dist = Math.max(1, Math.hypot(dx, dy)),
        target =
          (nodeById.get(edge.source)?.subjectId ===
          nodeById.get(edge.target)?.subjectId
            ? 1
            : 2.3) *
          separation *
          1.8,
        weight = (dist - target) * 0.011;
      force.get(edge.source)!.x += (dx / dist) * weight;
      force.get(edge.source)!.y += (dy / dist) * weight;
      force.get(edge.target)!.x -= (dx / dist) * weight;
      force.get(edge.target)!.y -= (dy / dist) * weight;
    }
    for (const node of graph.nodes) {
      const p = positions.get(node.id)!;
      if (p.pinned) continue;
      const f = force.get(node.id)!;
      p.x += Math.max(-16, Math.min(16, f.x));
      p.y += Math.max(-16, Math.min(16, f.y));
    }
  }
  return Object.fromEntries(
    [...positions].map(([id, p]) => [id, { x: p.x, y: p.y }]),
  );
}
