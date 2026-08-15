"use client";

import { useMemo } from "react";
import { Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import type { Project } from "@/lib/types";

const CORE_WIDTH = 240;
const RELATED_WIDTH = 190;
const NODE_HEIGHT = 88;

function layoutRelations(project: Project) {
  const people = project.analysis.people;
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const coreIds = new Set(people.filter((person) => person.importance === "core").map((person) => person.id));
  const relations = [...(project.analysis.personRelations ?? [])]
    .filter((relation) => peopleById.has(relation.sourcePersonId) && peopleById.has(relation.targetPersonId))
    .filter((relation) => coreIds.has(relation.sourcePersonId) || coreIds.has(relation.targetPersonId))
    .sort((left, right) => Number(right.importance === "primary") - Number(left.importance === "primary"));
  const visibleIds = new Set(coreIds);
  relations.forEach((relation) => {
    visibleIds.add(relation.sourcePersonId);
    visibleIds.add(relation.targetPersonId);
  });
  const nodes: Node[] = people.filter((person) => visibleIds.has(person.id)).map((person) => ({
    id: person.id,
    position: { x: 0, y: 0 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    className: `core-relation-node ${coreIds.has(person.id) ? "is-core" : "is-related"}`,
    data: { label: <span><small>{coreIds.has(person.id) ? "核心人物" : "相关人物"}</small><strong>{person.name}</strong><em>{person.role || person.publicIdentity || "身份待确认"}</em></span> },
  }));
  const seenPairs = new Set<string>();
  const edges: Edge[] = relations.flatMap((relation) => {
    const pair = [relation.sourcePersonId, relation.targetPersonId].sort().join(":");
    if (seenPairs.has(pair)) return [];
    seenPairs.add(pair);
    const label = relation.label || relation.summary || "相关";
    return [{
      id: relation.id,
      source: relation.sourcePersonId,
      target: relation.targetPersonId,
      label: label.length > 14 ? `${label.slice(0, 14)}…` : label,
      markerEnd: { type: MarkerType.ArrowClosed },
      className: relation.provenance === "inference" ? "core-relation-edge is-inference" : "core-relation-edge",
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 4,
    }];
  });

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: 105, nodesep: 45, marginx: 45, marginy: 55 });
  nodes.forEach((node) => graph.setNode(node.id, { width: coreIds.has(node.id) ? CORE_WIDTH : RELATED_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  nodes.forEach((node) => {
    const point = graph.node(node.id);
    const width = coreIds.has(node.id) ? CORE_WIDTH : RELATED_WIDTH;
    node.position = { x: point.x - width / 2, y: point.y - NODE_HEIGHT / 2 };
  });
  return { nodes, edges, coreCount: coreIds.size };
}

export function CoreCharacterRelations({ project, onSelectPerson }: { project: Project; onSelectPerson: (personId: string) => void }) {
  const graph = useMemo(() => layoutRelations(project), [project]);
  return (
    <section className="core-relations-book-page" data-keep-with-next="false">
      <header><div><small>人物关系</small><h2>核心人物关系图</h2></div><p>滚轮缩放或使用右下角按钮；点击人物可打开资料卡。</p></header>
      {graph.coreCount === 0 ? (
        <div className="core-relations-empty">暂无核心人物关系数据。</div>
      ) : (
        <div className="core-relations-canvas" onPointerDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
            minZoom={0.35}
            maxZoom={1.8}
            onNodeClick={(_, node) => onSelectPerson(node.id)}
          >
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      )}
    </section>
  );
}
