"use client";

import { useMemo, useState } from "react";
import type { Person } from "@/lib/types";
import { PersonPortrait } from "./person-portrait";

type PersonGalleryProps = {
  people: Person[];
  onSelectPerson: (id: string) => void;
  onUploadPortrait: (id: string) => void;
};

type ImportanceFilter = "all" | Person["importance"];

const importanceLabels: Record<Person["importance"], string> = {
  core: "核心",
  important: "重要",
  minor: "次要",
};

export function PersonGallery({
  people,
  onSelectPerson,
  onUploadPortrait,
}: PersonGalleryProps) {
  const [query, setQuery] = useState("");
  const [importance, setImportance] = useState<ImportanceFilter>("all");
  const visiblePeople = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return people.filter((person) => {
      const searchable = [
        person.name,
        ...person.aliases,
        person.organization,
        person.role,
        person.publicIdentity,
        person.trueIdentity,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return (
        (!normalized || searchable.includes(normalized)) &&
        (importance === "all" || person.importance === importance)
      );
    });
  }, [importance, people, query]);

  return (
    <section className="person-gallery" aria-label="人物画廊">
      <div className="person-gallery-toolbar">
        <label>
          <span>搜索人物</span>
          <input
            className="dark-control"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="姓名、组织或身份"
            type="search"
          />
        </label>
        <label>
          <span>重要程度</span>
          <select
            className="dark-control"
            value={importance}
            onChange={(event) =>
              setImportance(event.target.value as ImportanceFilter)
            }
          >
            <option value="all">全部</option>
            <option value="core">核心</option>
            <option value="important">重要</option>
            <option value="minor">次要</option>
          </select>
        </label>
      </div>

      {visiblePeople.length > 0 ? (
        <div className="person-gallery-grid">
          {visiblePeople.map((person) => (
            <article
              className="person-gallery-card"
              key={person.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectPerson(person.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectPerson(person.id);
                }
              }}
            >
              <div onClick={(event) => event.stopPropagation()}>
                <PersonPortrait
                  person={person}
                  size="md"
                  onUpload={() => onUploadPortrait(person.id)}
                />
              </div>
              <h3>{person.name}</h3>
              <p>{person.role || person.publicIdentity || "身份待整理"}</p>
              <span className="person-importance">
                {importanceLabels[person.importance]}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">没有符合条件的人物。</div>
      )}
    </section>
  );
}
