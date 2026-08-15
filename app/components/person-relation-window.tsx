"use client";

import { useEffect, useMemo, useRef } from "react";
import { Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildProjectEntities, entityFields, entityName, getRelatedEntities } from "@/lib/entities";
import type { Project } from "@/lib/types";

type Props = {
  project: Project; entityRef: string; x: number; y: number; width: number; height: number; zIndex: number;
  onClose: () => void; onFocus: () => void; onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onOpenEntity: (entityRef: string) => void;
};

export function PersonRelationWindow({ project, entityRef, x, y, width, height, zIndex, onClose, onFocus, onMove, onResize, onOpenEntity }: Props) {
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; width: number; height: number } | null>(null);
  const entities = useMemo(() => buildProjectEntities(project), [project]);
  const person = entities.find((candidate) => candidate.ref === entityRef);
  const graph = useMemo(() => {
    if (!person) return { nodes: [] as Node[], edges: [] as Edge[] };
    const related = getRelatedEntities(entityRef, project).filter((item) => person.kind !== "person" || item.entity.kind === "person");
    const radius = Math.max(180, Math.min(255, 125 + related.length * 11));
    const nodes: Node[] = [{
      id: person.ref, position: { x: 300, y: 210 }, sourcePosition: Position.Right, targetPosition: Position.Left,
      className: "person-relation-flow-node is-focus",
      data: { label: <span><small>当前人物</small><strong>{entityName(person)}</strong><em>{String(entityFields(person).role || "身份待确认")}</em></span> },
    }];
    const edges: Edge[] = [];
    related.forEach((item, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, related.length) - Math.PI / 2;
      nodes.push({
        id: item.entity.ref, position: { x: 300 + Math.cos(angle) * radius, y: 210 + Math.sin(angle) * radius },
        sourcePosition: Position.Right, targetPosition: Position.Left, className: "person-relation-flow-node",
        data: { label: <span><strong>{entityName(item.entity)}</strong><em>{String(entityFields(item.entity).role || "身份待确认")}</em></span> },
      });
      edges.push({
        id: item.relation.id, source: person.ref, target: item.entity.ref, type: "straight",
        label: item.relation.sourceRef === entityRef
          ? (item.relation.label || "相关")
          : `← ${item.relation.label || "相关"}`,
        markerEnd: { type: MarkerType.ArrowClosed },
        className: item.relation.level === "inference" ? "is-inference" : "",
        labelBgPadding: [5, 3], labelBgBorderRadius: 3,
      });
    });
    return { nodes, edges };
  }, [entityRef, person, project]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.pointerId === event.pointerId) {
        onMove(Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - drag.offsetX)), Math.max(8, Math.min(window.innerHeight - height - 8, event.clientY - drag.offsetY)));
      }
      const resize = resizeRef.current;
      if (resize?.pointerId === event.pointerId) {
        onResize(
          Math.max(560, Math.min(window.innerWidth - x - 8, resize.width + event.clientX - resize.startX)),
          Math.max(420, Math.min(window.innerHeight - y - 8, resize.height + event.clientY - resize.startY)),
        );
      }
    };
    const up = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
    };
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true);
    return () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true); };
  }, [height, onMove, onResize, width, x, y]);
  if (!person) return null;

  return <article className="person-relation-window parchment-window" role="dialog" aria-modal="false" aria-label={`${entityName(person)}的关系`} onPointerDown={onFocus} style={{ left: x, top: y, width, height, zIndex }}>
    <header onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault(); onFocus();
      dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - x, offsetY: event.clientY - y };
    }}><div><small>{person.kind === "person" ? "人物关系" : "实体关系"}</small><h2>{entityName(person)}</h2></div><button type="button" aria-label="关闭关系窗口" onClick={onClose}>×</button></header>
    <div className="person-relation-flow">
      {graph.nodes.length > 1 ? <ReactFlow nodes={graph.nodes} edges={graph.edges} nodesDraggable={false} nodesConnectable={false} fitView fitViewOptions={{ padding: .22, maxZoom: 1.05 }} minZoom={.35} maxZoom={1.7} onNodeClick={(_, node) => onOpenEntity(node.id)}><Controls showInteractive={false} position="bottom-right" /></ReactFlow> : <p>当前分析结果中暂无与此实体直接相连的语义关系。</p>}
    </div>
    <button className="person-relation-resize-handle" type="button" aria-label="调整关系窗口大小" onPointerDown={(event) => {
      event.preventDefault(); event.stopPropagation(); onFocus();
      resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width, height };
    }} />
  </article>;
}
