"use client";

import { useMemo, useState } from "react";
import {
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import type { Act } from "@/lib/types";

const ACT_WIDTH = 310;
const ACT_HEIGHT = 126;
const END_WIDTH = 220;
const END_HEIGHT = 76;

function shortCondition(value: string) {
  const text = value.trim() || "继续推进";
  return text.length > 18 ? `${text.slice(0, 18)}…` : text;
}

function layoutActs(acts: Act[], showAllBranches: boolean): { nodes: Node[]; edges: Edge[] } {
  const orderedActs = [...acts].sort((left, right) => left.sequence - right.sequence);
  const actIds = new Set(orderedActs.map((act) => act.id));
  const nodes: Node[] = orderedActs.map((act) => ({
    id: act.id,
    position: { x: 0, y: 0 },
    data: {
      label: (
        <span className="act-flow-label">
          <span className="act-flow-index">第 {act.sequence} 幕</span>
          <strong>{act.title}</strong>
          <span className="act-flow-meta">{act.placeText || "地点未定"} · {act.time || "时间未定"}</span>
          <span className="act-flow-counts">人物 {act.personIds.length} · 线索 {act.clueIds.length} · 分支 {act.branches.length}</span>
        </span>
      ),
    },
    className: "act-flow-node",
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  }));
  const edges: Edge[] = [];

  orderedActs.forEach((act, index) => {
    const nextAct = orderedActs[index + 1];
    const explicitBranches = act.branches.filter((branch) => branch.nextActId && actIds.has(branch.nextActId));
    if (showAllBranches) {
      explicitBranches.forEach((branch) => {
        const target = orderedActs.find((candidate) => candidate.id === branch.nextActId);
        const mainline = target?.id === nextAct?.id;
        edges.push({
          id: `${act.id}:${branch.id}`,
          source: act.id,
          target: branch.nextActId!,
          label: shortCondition(branch.condition),
          markerEnd: { type: MarkerType.ArrowClosed },
          className: mainline ? "act-flow-edge act-flow-mainline" : "act-flow-edge act-flow-branch",
          labelBgPadding: [7, 4],
          labelBgBorderRadius: 4,
        });
      });
      act.branches.filter((branch) => branch.isEnding).forEach((branch, branchIndex) => {
        const endingId = `ending:${act.id}:${branch.id || branchIndex}`;
        nodes.push({
          id: endingId,
          position: { x: 0, y: 0 },
          data: { label: <span className="act-flow-ending"><small>结局</small><strong>{shortCondition(branch.condition)}</strong></span> },
          className: `act-flow-ending-node ending-${branch.endingType ?? "neutral"}`,
          targetPosition: Position.Top,
        });
        edges.push({
          id: `${act.id}:${endingId}`,
          source: act.id,
          target: endingId,
          markerEnd: { type: MarkerType.ArrowClosed },
          className: "act-flow-edge act-flow-ending-edge",
        });
      });
    }
    if (nextAct && (!showAllBranches || !explicitBranches.some((branch) => branch.nextActId === nextAct.id))) {
      const explicitMain = explicitBranches.find((branch) => branch.nextActId === nextAct.id);
      edges.push({
        id: `main:${act.id}:${nextAct.id}`,
        source: act.id,
        target: nextAct.id,
        label: shortCondition(explicitMain?.condition ?? "主线推进"),
        markerEnd: { type: MarkerType.ArrowClosed },
        className: "act-flow-edge act-flow-mainline",
        labelBgPadding: [7, 4],
        labelBgBorderRadius: 4,
      });
    }
  });

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", ranksep: 100, nodesep: 70, marginx: 50, marginy: 55 });
  nodes.forEach((node) => {
    const ending = node.id.startsWith("ending:");
    graph.setNode(node.id, { width: ending ? END_WIDTH : ACT_WIDTH, height: ending ? END_HEIGHT : ACT_HEIGHT });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  nodes.forEach((node) => {
    const point = graph.node(node.id);
    const ending = node.id.startsWith("ending:");
    const width = ending ? END_WIDTH : ACT_WIDTH;
    const height = ending ? END_HEIGHT : ACT_HEIGHT;
    node.position = { x: point.x - width / 2, y: point.y - height / 2 };
  });
  return { nodes, edges };
}

export function ActTreeView({ acts, onSelectAct }: { acts: Act[]; onSelectAct: (actId: string) => void }) {
  const [showAllBranches, setShowAllBranches] = useState(false);
  const graph = useMemo(() => layoutActs(acts, showAllBranches), [acts, showAllBranches]);

  if (acts.length === 0) {
    return <div className="act-tree-empty"><strong>请先运行分析</strong><p>幕阶段完成后，这里会显示剧情分支树。</p></div>;
  }

  return (
    <div className="act-tree-canvas">
      <div className="act-tree-mode-switch">
        <button className={!showAllBranches ? "active" : ""} onClick={() => setShowAllBranches(false)}>只看主线</button>
        <button className={showAllBranches ? "active" : ""} onClick={() => setShowAllBranches(true)}>展开全部分支</button>
      </div>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        minZoom={0.35}
        maxZoom={1.35}
        onNodeClick={(_, node) => {
          if (!node.id.startsWith("ending:")) onSelectAct(node.id);
        }}
      >
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
