"use client";

import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import type { Act } from "@/lib/types";

const NODE_WIDTH = 190;
const NODE_HEIGHT = 72;

function layoutActs(acts: Act[]): { nodes: Node[]; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: 90,
    nodesep: 45,
    marginx: 30,
    marginy: 30,
  });

  acts.forEach((act) =>
    graph.setNode(act.id, { width: NODE_WIDTH, height: NODE_HEIGHT }),
  );
  acts.forEach((act) =>
    act.branches.forEach((branch) => {
      if (branch.nextActId && acts.some((item) => item.id === branch.nextActId)) {
        graph.setEdge(act.id, branch.nextActId);
      }
    }),
  );
  dagre.layout(graph);

  const nodes: Node[] = acts.map((act) => {
    const point = graph.node(act.id);
    return {
      id: act.id,
      position: {
        x: point.x - NODE_WIDTH / 2,
        y: point.y - NODE_HEIGHT / 2,
      },
      data: {
        label: (
          <span className="act-flow-label">
            <small>第 {act.sequence} 幕</small>
            <strong>{act.title}</strong>
          </span>
        ),
      },
      className: "act-flow-node",
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
  const edges: Edge[] = acts.flatMap((act) =>
    act.branches.flatMap((branch) =>
      branch.nextActId && acts.some((item) => item.id === branch.nextActId)
        ? [
            {
              id: `${act.id}:${branch.id}`,
              source: act.id,
              target: branch.nextActId,
              label: branch.condition,
              markerEnd: { type: MarkerType.ArrowClosed },
              className: "act-flow-edge",
              labelBgPadding: [8, 4] as [number, number],
              labelBgBorderRadius: 4,
            },
          ]
        : [],
    ),
  );
  return { nodes, edges };
}

export function ActTreeView({
  acts,
  onSelectAct,
}: {
  acts: Act[];
  onSelectAct: (actId: string) => void;
}) {
  const graph = useMemo(() => layoutActs(acts), [acts]);

  if (acts.length === 0) {
    return (
      <div className="act-tree-empty">
        <strong>请先运行分析</strong>
        <p>幕阶段完成后，这里会显示剧情分支树。</p>
      </div>
    );
  }

  return (
    <div className="act-tree-canvas">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.25}
        maxZoom={1.8}
        onNodeClick={(_, node) => onSelectAct(node.id)}
      >
        <Background color="var(--line)" gap={24} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
