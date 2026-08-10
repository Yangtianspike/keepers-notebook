"use client";

import type { Act, Clue, Person, Place } from "@/lib/types";

export type ActDetailViewProps = {
  act: Act;
  acts: Act[];
  people: Person[];
  clues: Clue[];
  places: Place[];
  onBack: () => void;
  onSelectAct: (actId: string) => void;
  onSelectPerson: (personId: string) => void;
  onUpdateAct: (act: Act) => void;
  onUpdatePerson: (person: Person) => void;
};

export function ActDetailView({ act, onBack }: ActDetailViewProps) {
  return (
    <div className="content-stack">
      <button className="ghost-button compact" onClick={onBack}>
        ← 返回幕树
      </button>
      <article className="truth-card">
        <span>第 {act.sequence} 幕</span>
        <h2>{act.title}</h2>
        <p>{act.description || "尚无幕描述。"}</p>
      </article>
    </div>
  );
}
