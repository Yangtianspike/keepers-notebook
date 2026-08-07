import ELK from "elkjs/lib/elk.bundled.js";
import type { Clue, Person, Relation } from "./types";

export type ElkGraphInput = {
  nodes: Array<{
    id: string;
    width: number;
    height: number;
    parentId?: string;
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
};

export function partitionRelationsByPeople(
  relations: Relation[],
  peopleIds: Iterable<string>,
) {
  const validPeople = new Set(peopleIds);
  const accepted: Relation[] = [];
  const unresolved: Relation[] = [];
  relations.forEach((relation) => {
    const endpointsRecognized =
      validPeople.has(relation.sourceId) &&
      validPeople.has(relation.targetId);
    if (!endpointsRecognized) {
      unresolved.push(relation);
      return;
    }
    if (relation.sourceId !== relation.targetId) accepted.push(relation);
  });
  return { accepted, unresolved };
}

export async function layoutWithElk(
  input: ElkGraphInput,
): Promise<Map<string, { x: number; y: number }>> {
  const elk = new ELK();
  const nested = new Map<
    string,
    Array<{ id: string; width: number; height: number }>
  >();
  input.nodes.forEach((node) => {
    if (!node.parentId) return;
    nested.set(node.parentId, [
      ...(nested.get(node.parentId) ?? []),
      { id: node.id, width: node.width, height: node.height },
    ]);
  });
  const rootNodes = input.nodes
    .filter((node) => !node.parentId)
    .map((node) =>
      nested.has(node.id)
        ? {
            id: node.id,
            width: node.width,
            height: node.height,
            children: nested.get(node.id),
          }
        : node,
    );
  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "240",
      "elk.spacing.nodeNode": "130",
    },
    children: rootNodes,
    edges: input.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });
  const positions = new Map<string, { x: number; y: number }>();
  type PositionedNode = {
    id: string;
    x?: number;
    y?: number;
    children?: PositionedNode[];
  };
  const visit = (
    nodes: PositionedNode[] | undefined,
    offsetX = 0,
    offsetY = 0,
  ) =>
    nodes?.forEach((node) => {
      positions.set(node.id, {
        x: (node.x ?? 0) + offsetX,
        y: (node.y ?? 0) + offsetY,
      });
      visit(node.children, (node.x ?? 0) + offsetX, (node.y ?? 0) + offsetY);
    });
  visit(result.children as PositionedNode[] | undefined);
  return positions;
}

export function computeNeighborhood(
  focusId: string,
  edges: Array<{ source: string; target: string }>,
  depth: 1 | 2,
) {
  const visible = new Set([focusId]);
  let frontier = new Set([focusId]);
  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();
    edges.forEach((edge) => {
      if (frontier.has(edge.source)) next.add(edge.target);
      if (frontier.has(edge.target)) next.add(edge.source);
    });
    next.forEach((id) => visible.add(id));
    frontier = next;
  }
  return visible;
}

export function filterRelationshipView(
  people: Person[],
  relations: Relation[],
  options: {
    layers?: Relation["layer"][];
    provenance?: Relation["provenance"][];
    focusId?: string;
    depth?: 1 | 2;
  },
) {
  let visibleRelations = relations.filter(
    (relation) =>
      (!options.layers?.length || options.layers.includes(relation.layer)) &&
      (!options.provenance?.length ||
        options.provenance.includes(relation.provenance)),
  );
  let visibleIds = new Set(people.map((person) => person.id));
  if (options.focusId && options.depth)
    visibleIds = computeNeighborhood(
      options.focusId,
      visibleRelations.map((relation) => ({
        source: relation.sourceId,
        target: relation.targetId,
      })),
      options.depth,
    );
  visibleRelations = visibleRelations.filter(
    (relation) =>
      visibleIds.has(relation.sourceId) && visibleIds.has(relation.targetId),
  );
  return {
    visiblePeople: people.filter((person) => visibleIds.has(person.id)),
    visibleRelations,
  };
}

export function filterClueView(
  clues: Clue[],
  options: {
    importance?: Clue["importance"][];
    targetTypes?: Clue["targets"][number]["type"][];
    focusId?: string;
    depth?: 1 | 2;
  },
) {
  const filtered = clues.filter(
    (clue) =>
      (!options.importance?.length ||
        options.importance.includes(clue.importance)) &&
      (!options.targetTypes?.length ||
        clue.targets.some((target) =>
          options.targetTypes!.includes(target.type),
        )),
  );
  if (!options.focusId || !options.depth) return filtered;
  const edges = filtered.flatMap((clue) =>
    clue.targets.map((target) => ({
      source: clue.id,
      target: `${target.type}:${target.id || target.label}`,
    })),
  );
  const visible = computeNeighborhood(options.focusId, edges, options.depth);
  return filtered.filter((clue) => visible.has(clue.id));
}
