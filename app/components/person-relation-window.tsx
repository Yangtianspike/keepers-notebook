"use client";

import { useEffect, useMemo, useRef } from "react";
import { buildProjectEntities, entityFields, entityName, getRelatedEntities } from "@/lib/entities";
import type { Project } from "@/lib/types";

type PersonRelationWindowProps = {
  project: Project;
  entityRef: string;
  x: number;
  y: number;
  zIndex: number;
  onClose: () => void;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onOpenPerson: (entityRef: string) => void;
};

const WINDOW_WIDTH = 720;
const WINDOW_HEIGHT = 560;

export function PersonRelationWindow({
  project,
  entityRef,
  x,
  y,
  zIndex,
  onClose,
  onFocus,
  onMove,
  onOpenPerson,
}: PersonRelationWindowProps) {
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const person = buildProjectEntities(project).find((candidate) => candidate.ref === entityRef && candidate.kind === "person");
  const relations = useMemo(() => {
    return getRelatedEntities(entityRef, project)
      .filter((item) => item.entity.kind === "person")
      .map((item) => ({
        ...item,
        outgoing: item.relation.sourceRef === entityRef,
      }));
  }, [entityRef, project]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      onMove(
        Math.max(8, Math.min(window.innerWidth - WINDOW_WIDTH - 8, event.clientX - drag.offsetX)),
        Math.max(8, Math.min(window.innerHeight - WINDOW_HEIGHT - 8, event.clientY - drag.offsetY)),
      );
    };
    const handleUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };
    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", handleUp, true);
    return () => {
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", handleUp, true);
      window.removeEventListener("pointercancel", handleUp, true);
    };
  }, [onMove]);

  if (!person) return null;
  const fields = entityFields(person);

  return (
    <article
      className="person-relation-window parchment-window"
      role="dialog"
      aria-modal="false"
      aria-label={`${entityName(person)}的人物关系`}
      onPointerDown={onFocus}
      style={{ left: x, top: y, zIndex }}
    >
      <header
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          event.preventDefault();
          onFocus();
          dragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - x,
            offsetY: event.clientY - y,
          };
        }}
      >
        <div>
          <small>人物关系</small>
          <h2>{entityName(person)}</h2>
        </div>
        <button type="button" aria-label="关闭人物关系窗口" onClick={onClose}>×</button>
      </header>

      <div className="person-relation-static-map">
        <button className="person-relation-focus" type="button" onClick={() => onOpenPerson(person.ref)}>
          <small>{fields.importance === "core" ? "核心人物" : "当前人物"}</small>
          <strong>{entityName(person)}</strong>
          <span>{String(fields.role || fields.publicIdentity || "身份待确认")}</span>
        </button>
        {relations.length > 0 ? (
          <div className="person-relation-spokes">
            {relations.map(({ relation, entity: related, outgoing }) => (
              <button type="button" key={relation.id} onClick={() => onOpenPerson(related.ref)}>
                <span>{outgoing ? `${relation.label || "相关"} →` : `← ${relation.label || "相关"}`}</span>
                <strong>{entityName(related)}</strong>
                <small>{String(entityFields(related).role || entityFields(related).publicIdentity || "身份待确认")}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="person-relation-empty">当前分析结果中暂无与此人物直接相连的语义关系。</p>
        )}
      </div>
    </article>
  );
}
