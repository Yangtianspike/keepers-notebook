"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Act, Clue, Person, Place } from "@/lib/types";
import {
  TurnBookPages,
  useTurnBook,
} from "@/app/components/stage-view";

export type ActTextViewProps = {
  acts: Act[];
  embedded?: boolean;
  initialActId?: string;
  people: Person[];
  clues: Clue[];
  places: Place[];
  onOpenTree: () => void;
  onSelectPerson: (personId: string) => void;
  onUpdatePerson: (person: Person) => void;
  onUpdateAct: (act: Act) => void;
};

export type ActBookContentProps = Omit<ActTextViewProps, "embedded"> & {
  act: Act;
};

const personGroups: Array<{ key: Person["importance"]; label: string }> = [
  { key: "core", label: "核心人物" },
  { key: "important", label: "重要人物" },
  { key: "minor", label: "次要人物" },
];

const clueGroups: Array<{ key: Clue["importance"]; label: string }> = [
  { key: "key", label: "关键线索" },
  { key: "secondary", label: "次要线索" },
  { key: "other", label: "其他线索" },
];

function statsText(stats: NonNullable<Act["keyEvents"][number]["stats"]>) {
  const labels: Array<[keyof typeof stats, string]> = [
    ["str", "STR"],
    ["con", "CON"],
    ["dex", "DEX"],
    ["int", "INT"],
    ["pow", "POW"],
    ["hp", "HP"],
    ["mp", "MP"],
    ["sanLoss", "SAN 损失"],
  ];
  return labels
    .filter(([key]) => stats[key] !== undefined)
    .map(([key, label]) => `${label} ${stats[key]}`)
    .join(" · ");
}

function NetworkIcon() {
  return (
    <svg
      aria-hidden="true"
      className="network-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
    >
      <path d="M12 6 6 17M12 6l6 11M6 17h12" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="5" r="2.5" fill="currentColor" />
      <circle cx="5" cy="18" r="2.5" fill="currentColor" />
      <circle cx="19" cy="18" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function ActTextView({
  acts,
  embedded = false,
  initialActId,
  people,
  clues,
  places,
  onOpenTree,
  onSelectPerson,
  onUpdatePerson,
  onUpdateAct,
}: ActTextViewProps) {
  if (embedded) {
    return (
      <ActBookContent
        acts={acts}
        initialActId={initialActId}
        people={people}
        clues={clues}
        places={places}
        onOpenTree={onOpenTree}
        onSelectPerson={onSelectPerson}
        onUpdatePerson={onUpdatePerson}
        onUpdateAct={onUpdateAct}
      />
    );
  }
  return (
    <StandaloneActTextView
      acts={acts}
      initialActId={initialActId}
      people={people}
      clues={clues}
      places={places}
      onOpenTree={onOpenTree}
      onSelectPerson={onSelectPerson}
      onUpdatePerson={onUpdatePerson}
      onUpdateAct={onUpdateAct}
    />
  );
}

function ActBookContent(props: Omit<ActTextViewProps, "embedded">) {
  return <ActTextViewContent {...props} embeddedContentOnly />;
}

export function ActBookContentView({
  act,
  acts,
  ...props
}: ActBookContentProps) {
  return (
    <ActTextViewContent
      {...props}
      acts={acts}
      initialActId={act.id}
      embeddedContentOnly
    />
  );
}

function StandaloneActTextView(props: Omit<ActTextViewProps, "embedded">) {
  return <ActTextViewContent {...props} embeddedContentOnly={false} />;
}

function ActTextViewContent({
  acts,
  initialActId,
  people,
  clues,
  places,
  onOpenTree,
  onSelectPerson,
  onUpdatePerson,
  embeddedContentOnly = false,
}: Omit<ActTextViewProps, "embedded"> & { embeddedContentOnly: boolean }) {
  const orderedActs = useMemo(
    () => [...acts].sort((a, b) => a.sequence - b.sequence),
    [acts],
  );
  const initialIndex = Math.max(
    0,
    orderedActs.findIndex((act) => act.id === initialActId),
  );
  const [index, setIndex] = useState(initialIndex);
  const act = orderedActs[index] ?? orderedActs[0];

  const actPeople = act
    ? people.filter((person) => act.personIds.includes(person.id))
    : [];
  const actClues = act
    ? clues.filter((clue) => act.clueIds.includes(clue.id))
    : [];
  const place = act
    ? places.find((item) => item.id === act.placeId)
    : undefined;

  const goPreviousAct = useCallback(() => {
    if (index > 0) {
      setIndex(index - 1);
    }
  }, [index]);

  const goNextAct = useCallback(() => {
    if (index < orderedActs.length - 1) {
      setIndex(index + 1);
    }
  }, [index, orderedActs.length]);

  const bookContent = act ? (
    <article className="act-book-document">
      <header className="book-page-header">
        <div className="book-page-meta">
          <span>第 {act.sequence} 幕</span>
          <h2>{act.title}</h2>
          <p>
            {place?.name || act.placeText || "地点未定"} ·{" "}
            {act.time || "时间未定"}
          </p>
        </div>
        <div className="book-page-actions">
          <button
            className="icon-button tree-button"
            onClick={onOpenTree}
            title="幕结构树"
          >
            <NetworkIcon />
            <span>幕树</span>
          </button>
        </div>
      </header>
      <>
            <section className="act-detail-section">
              <h3>人物</h3>
              {personGroups.map((group) => {
                const members = actPeople.filter(
                  (person) => person.importance === group.key,
                );
                if (members.length === 0) return null;
                return (
                  <div className="act-tier" key={group.key}>
                    <h4>{group.label}</h4>
                    <div className="act-card-grid">
                      {members.map((person) => (
                        <article className="act-person-card" key={person.id}>
                          <button
                            className="act-portrait"
                            onClick={() => uploadPortrait(person)}
                            title="上传或更换肖像"
                          >
                            {person.portrait ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={person.portrait} alt={person.name} />
                            ) : (
                              <span>{person.name.slice(0, 1)}</span>
                            )}
                          </button>
                          <button
                            className="act-card-copy"
                            onClick={() => onSelectPerson(person.id)}
                          >
                            <strong>{person.name}</strong>
                            <span>{person.role || "该幕角色待补充"}</span>
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
            <section className="act-detail-section">
              <h3>线索</h3>
              {clueGroups.map((group) => {
                const items = actClues.filter(
                  (clue) => clue.importance === group.key,
                );
                if (items.length === 0) return null;
                return (
                  <div className="act-tier" key={group.key}>
                    <h4>{group.label}</h4>
                    <div className="act-card-grid">
                      {items.map((clue) => (
                        <article className="act-clue-card" key={clue.id}>
                          <strong>{clue.name}</strong>
                          <span>{clue.acquisition || clue.source}</span>
                          <p>{clue.summary}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
            <section className="act-detail-section">
              <h3>分支结局</h3>
              <div className="act-branch-list">
                {act.branches.map((branch) => {
                  const next = orderedActs.find(
                    (candidate) => candidate.id === branch.nextActId,
                  );
                  return (
                    <button
                      key={branch.id}
                      disabled={!next}
                      onClick={() => next && setIndex(orderedActs.indexOf(next))}
                    >
                      <span>{branch.condition}</span>
                      <strong>{next ? `→ ${next.title}` : "→ 结局"}</strong>
                    </button>
                  );
                })}
                {act.branches.length === 0 && <p>本幕尚无分支。</p>}
              </div>
            </section>
            <section className="act-detail-section">
              <h3>阶段性重要事件点</h3>
              <div className="act-event-list">
                {act.keyEvents.map((event, eventIndex) => (
                  <article key={`${event.title}-${eventIndex}`}>
                    <span>{event.type.toUpperCase()}</span>
                    <h4>{event.title}</h4>
                    <p>{event.description}</p>
                    {event.stats && <code>{statsText(event.stats)}</code>}
                  </article>
                ))}
                {act.keyEvents.length === 0 && <p>本幕尚无关键事件。</p>}
              </div>
            </section>
            <section className="act-detail-section">
              <h3>幕描述</h3>
              <p className="act-description">
                {act.description || "尚无幕描述。"}
              </p>
            </section>
      </>
    </article>
  ) : null;

  const {
    flipbookRef,
    measureRef,
    pages,
    previousPage,
    nextPage,
    hasPrevious,
    hasNext,
    displayCurrentPage,
    displayTotalPages,
  } = useTurnBook(bookContent, {
    contentKey: JSON.stringify({ act, people, clues, places }),
    enabled: !embeddedContentOnly,
    onBoundaryPrev: index > 0 ? goPreviousAct : undefined,
    onBoundaryNext:
      index < orderedActs.length - 1 ? goNextAct : undefined,
  });

  useEffect(() => {
    if (embeddedContentOnly) return;
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const canHandle = event.key === "ArrowLeft"
        ? hasPrevious || index > 0
        : hasNext || index < orderedActs.length - 1;
      if (!canHandle) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "ArrowLeft") previousPage();
      if (event.key === "ArrowRight") nextPage();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [
    embeddedContentOnly,
    hasNext,
    hasPrevious,
    nextPage,
    previousPage,
    index,
    orderedActs.length,
  ]);

  if (!act) {
    return (
      <div className="book-page-content act-text-view empty">
        <button className="tree-button" onClick={onOpenTree}>
          <NetworkIcon />
          幕树
        </button>
        <p>暂无幕内容，请先运行幕阶段分析。</p>
      </div>
    );
  }

  const uploadPortrait = (person: Person) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const scale = Math.min(1, 256 / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          if (!context) return;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          onUpdatePerson({
            ...person,
            portrait: canvas.toDataURL("image/jpeg", 0.72),
            portraitSource: "manual",
          });
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  if (embeddedContentOnly) {
    return <div className="act-text-view embedded-act-content">{bookContent}</div>;
  }

  return (
    <div className="book-reader act-text-view">
      <div className="book-measure" ref={measureRef}>{bookContent}</div>
      <TurnBookPages
        className="book-page-content flipbook"
        flipbookRef={flipbookRef}
        pages={pages}
      />
      <div className="book-page-footer">
        <button
          className="page-turn"
          onClick={previousPage}
          disabled={!hasPrevious && index === 0}
          aria-label="上一页"
        >
          ‹
        </button>
        <span className="page-number">
          {displayCurrentPage} / {displayTotalPages}
        </span>
        <button
          className="page-turn"
          onClick={nextPage}
          disabled={!hasNext && index === orderedActs.length - 1}
          aria-label="下一页"
        >
          ›
        </button>
      </div>
    </div>
  );
}
