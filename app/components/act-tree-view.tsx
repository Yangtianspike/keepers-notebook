"use client";

import type { Act } from "@/lib/types";

export function ActTreeView({
  acts,
  onSelectAct,
}: {
  acts: Act[];
  onSelectAct: (actId: string) => void;
}) {
  if (acts.length === 0) {
    return <p className="empty-copy">请先运行分析</p>;
  }

  return (
    <div className="act-tree-placeholder">
      {acts.map((act) => (
        <button key={act.id} onClick={() => onSelectAct(act.id)}>
          第 {act.sequence} 幕 · {act.title}
        </button>
      ))}
    </div>
  );
}
