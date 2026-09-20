"use client";

import { useMemo } from "react";
import { Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import { buildEntityRelations, buildProjectEntities, entityFields, entityName } from "@/lib/entities";
import type { EntityRelation, Project } from "@/lib/types";

const CORE_WIDTH = 240;
const RELATED_WIDTH = 190;
const NODE_HEIGHT = 88;

function layoutRelations(project: Project) {
  const entities = buildProjectEntities(project);
  const people = entities.filter((entity) => entity.kind === "person");
  const peopleByRef = new Map(people.map((person) => [person.ref, person]));
  const coreIds = new Set(people.filter((person) => entityFields(person).importance === "core").map((person) => person.ref));
  const rank = (relation: EntityRelation) => (
    ({ keeper: 5, direct: 4, inference: 3, indirect: 2 }[relation.level] ?? 0) +
    (relation.importance === "primary" ? 1 : 0)
  );
  const bestByPair = new Map<string, EntityRelation>();
  buildEntityRelations(project, entities)
    .filter((relation) => peopleByRef.has(relation.sourceRef) && peopleByRef.has(relation.targetRef))
    .filter((relation) => coreIds.has(relation.sourceRef) || coreIds.has(relation.targetRef))
    .forEach((relation) => {
      const pair = [relation.sourceRef, relation.targetRef].sort().join(":");
      const current = bestByPair.get(pair);
      if (!current || rank(relation) > rank(current)) bestByPair.set(pair, relation);
    });
  const relations = [...bestByPair.values()].sort((left, right) => rank(right) - rank(left));
  const visibleIds = new Set(coreIds);
  relations.forEach((relation) => {
    visibleIds.add(relation.sourceRef);
    visibleIds.add(relation.targetRef);
  });
  const nodes: Node[] = people.filter((person) => visibleIds.has(person.ref)).map((person) => ({
    id: person.ref,
    position: { x: 0, y: 0 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    className: `core-relation-node ${coreIds.has(person.ref) ? "is-core" : "is-related"}`,
    data: { label: <span><small>{coreIds.has(person.ref) ? "核心人物" : "相关人物"}</small><strong>{entityName(person)}</strong><em>{String(entityFields(person).role || entityFields(person).publicIdentity || "身份待确认")}</em></span> },
  }));
  const edges: Edge[] = relations.map((relation) => {
    const label = relation.label || relation.summary || "相关";
    return {
      id: relation.id,
      source: relation.sourceRef,
      target: relation.targetRef,
      label: label.length > 14 ? `${label.slice(0, 14)}…` : label,
      markerEnd: { type: MarkerType.ArrowClosed },
      className: relation.provenance === "inference" || relation.level === "inference" ? "core-relation-edge is-inference" : "core-relation-edge",
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 4,
    };
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

export function CoreCharacterRelations({ project, onSelectPerson }: { project: Project; onSelectPerson: (entityRef: string) => void }) {
  const graph = useMemo(() => layoutRelations(project), [project]);
  if (graph.coreCount === 0) {
    return <div className="core-relations-empty">暂无核心人物关系数据。</div>;
  }

  return (
    <div className="core-relations-canvas">
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
  );
}
