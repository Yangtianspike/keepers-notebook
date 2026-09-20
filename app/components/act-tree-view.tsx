"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import type { Act, ActGraphPositions } from "@/lib/types";

const ACT_WIDTH = 310;
const ACT_HEIGHT = 126;
const END_WIDTH = 220;
const END_HEIGHT = 76;
// 层间距要为边标签留出纵向空间，太窄时标签会压到上下两幕的卡片上。
const RANK_SEPARATION = 150;
// 标签会自动换行，这里只对极端长的条件做兜底截断，避免标签高过一整个节点。
const LABEL_MAX_CHARS = 30;

type GraphMode = "mainline" | "allBranches";

function shortCondition(value: string) {
  const text = value.trim() || "继续推进";
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS)}…` : text;
}

/**
 * 用 HTML 渲染边标签。
 * 内置标签走 SVG <text>，既不能限宽也不会自动换行，长条件会横向铺开并压到
 * 两侧的幕卡片上。挂到 EdgeLabelRenderer 之后就能用 CSS 限宽换行，
 * 并通过 z-index 浮到节点之上，不再被幕实体遮住。
 */
function ActEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="act-edge-condition nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = { act: ActEdge };

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
          type: "act",
          source: act.id,
          target: branch.nextActId!,
          label: shortCondition(branch.condition),
          markerEnd: { type: MarkerType.ArrowClosed },
          className: mainline ? "act-flow-edge act-flow-mainline" : "act-flow-edge act-flow-branch",
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
          type: "act",
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
        type: "act",
        source: act.id,
        target: nextAct.id,
        label: shortCondition(explicitMain?.condition ?? "主线推进"),
        markerEnd: { type: MarkerType.ArrowClosed },
        className: "act-flow-edge act-flow-mainline",
      });
    }
  });

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", ranksep: RANK_SEPARATION, nodesep: 70, marginx: 50, marginy: 55 });
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

export function ActTreeView({
  acts,
  onSelectAct,
  positions,
  onPositionsChange,
}: {
  acts: Act[];
  onSelectAct: (actId: string) => void;
  positions?: ActGraphPositions;
  onPositionsChange: (next: ActGraphPositions) => void;
}) {
  const [showAllBranches, setShowAllBranches] = useState(false);
  const mode: GraphMode = showAllBranches ? "allBranches" : "mainline";
  const graph = useMemo(() => layoutActs(acts, showAllBranches), [acts, showAllBranches]);
  const savedPositions = positions?.[mode];

  // 手动拖动过的节点用保存坐标覆盖 dagre 的结果；其余节点继续跟随自动布局。
  const positionedNodes = useMemo(() => {
    if (!savedPositions) return graph.nodes;
    return graph.nodes.map((node) => {
      const saved = savedPositions[node.id];
      return saved ? { ...node, position: saved } : node;
    });
  }, [graph, savedPositions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(positionedNodes);

  useEffect(() => {
    setNodes(positionedNodes);
  }, [positionedNodes, setNodes]);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      onPositionsChange({
        ...positions,
        [mode]: {
          ...(positions?.[mode] ?? {}),
          [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        },
      });
    },
    [mode, onPositionsChange, positions],
  );

  const hasCustomLayout = Boolean(positions?.mainline || positions?.allBranches);

  if (acts.length === 0) {
    return <div className="act-tree-empty"><strong>请先运行分析</strong><p>幕阶段完成后，这里会显示剧情分支树。</p></div>;
  }

  return (
    <div className="act-tree-canvas">
      <div className="act-tree-mode-switch">
        <button className={!showAllBranches ? "active" : ""} onClick={() => setShowAllBranches(false)}>只看主线</button>
        <button className={showAllBranches ? "active" : ""} onClick={() => setShowAllBranches(true)}>展开全部分支</button>
      </div>
      {hasCustomLayout && (
        <button className="act-tree-reset" onClick={() => onPositionsChange({})}>
          恢复默认布局
        </button>
      )}
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={handleNodeDragStop}
        nodesDraggable
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
