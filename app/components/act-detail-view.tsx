"use client";

import { useState } from "react";
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

export function ActDetailView({
  act,
  acts,
  people,
  clues,
  places,
  onBack,
  onSelectAct,
  onSelectPerson,
  onUpdateAct,
  onUpdatePerson,
}: ActDetailViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(act);
  const actPeople = people.filter((person) => act.personIds.includes(person.id));
  const actClues = clues.filter((clue) => act.clueIds.includes(clue.id));
  const place = places.find((item) => item.id === act.placeId);

  const beginEdit = () => {
    setDraft(act);
    setEditing(true);
  };

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

  return (
    <div className="content-stack act-detail act-detail-view">
      <div className="act-detail-toolbar">
        <button className="ghost-button compact" onClick={onBack}>
          ← 返回幕树
        </button>
        {!editing && (
          <button className="primary-button compact" onClick={beginEdit}>
            编辑幕
          </button>
        )}
      </div>

      {editing ? (
        <section className="act-editor">
          <label className="field">
            <span>幕标题</span>
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
          </label>
          <div className="act-editor-grid">
            <label className="field">
              <span>地点</span>
              <input
                value={draft.placeText ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    placeId: undefined,
                    placeText: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>时间</span>
              <input
                value={draft.time}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, time: event.target.value }))
                }
              />
            </label>
          </div>
          <label className="field">
            <span>本幕剧情</span>
            <textarea
              rows={8}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <div className="act-editor-branches">
            <strong>分支</strong>
            {draft.branches.map((branch) => (
              <div className="act-branch-editor" key={branch.id}>
                <input
                  aria-label="分支条件"
                  value={branch.condition}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      branches: current.branches.map((item) =>
                        item.id === branch.id
                          ? { ...item, condition: event.target.value }
                          : item,
                      ),
                    }))
                  }
                />
                <select
                  aria-label="下一幕"
                  value={branch.nextActId ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      branches: current.branches.map((item) =>
                        item.id === branch.id
                          ? {
                              ...item,
                              nextActId: event.target.value || undefined,
                              isEnding: !event.target.value,
                            }
                          : item,
                      ),
                    }))
                  }
                >
                  <option value="">结局</option>
                  {acts
                    .filter((item) => item.id !== act.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        第 {item.sequence} 幕 · {item.title}
                      </option>
                    ))}
                </select>
                <button
                  className="ghost-button compact"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      branches: current.branches.filter(
                        (item) => item.id !== branch.id,
                      ),
                    }))
                  }
                >
                  删除
                </button>
              </div>
            ))}
            <button
              className="ghost-button compact"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  branches: [
                    ...current.branches,
                    {
                      id: crypto.randomUUID(),
                      condition: "新分支条件",
                      isEnding: true,
                    },
                  ],
                }))
              }
            >
              + 添加分支
            </button>
          </div>
          <div className="act-editor-actions">
            <button className="ghost-button" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              className="primary-button"
              onClick={() => {
                onUpdateAct(draft);
                setEditing(false);
              }}
            >
              保存修改
            </button>
          </div>
        </section>
      ) : (
        <>
          <header className="act-detail-header">
            <span>第 {act.sequence} 幕</span>
            <h2>{act.title}</h2>
            <p>
              {place?.name || act.placeText || "地点未定"} · {act.time || "时间未定"}
            </p>
          </header>

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
              const items = actClues.filter((clue) => clue.importance === group.key);
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
                const next = acts.find((item) => item.id === branch.nextActId);
                return (
                  <button
                    key={branch.id}
                    disabled={!next}
                    onClick={() => next && onSelectAct(next.id)}
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
              {act.keyEvents.map((event, index) => (
                <article key={`${event.title}-${index}`}>
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
            <h3>本幕剧情</h3>
            <p className="act-description">{act.description || "尚无本幕剧情。"}</p>
          </section>
        </>
      )}
    </div>
  );
}
