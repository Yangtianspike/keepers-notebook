"use client";

import type { Person, Relation } from "@/lib/types";
import { PersonPortrait } from "./person-portrait";

export type RelatedPerson = {
  person: Person;
  relation: Relation;
  isSource: boolean;
};

type PersonEgoViewProps = {
  person: Person;
  relatedPeople: RelatedPerson[];
  onSelectRelated: (id: string) => void;
  onBack: () => void;
  onEditPerson: (person: Person) => void;
};

export function PersonEgoView({
  person,
  relatedPeople,
  onSelectRelated,
  onBack,
  onEditPerson,
}: PersonEgoViewProps) {
  return (
    <section className="person-ego-view">
      <header className="person-ego-toolbar">
        <button className="ghost-button" onClick={onBack}>
          ← 返回
        </button>
        <h2>{person.name}</h2>
        <button className="primary-button" onClick={() => onEditPerson(person)}>
          编辑人物
        </button>
      </header>

      <article className="person-ego-profile">
        <PersonPortrait person={person} size="lg" />
        <div>
          <p className="eyebrow">CHARACTER DOSSIER</p>
          <h3>{person.name}</h3>
          <p>{person.publicIdentity || person.role || "公开身份待整理"}</p>
          {person.trueIdentity && (
            <dl>
              <dt>真实身份</dt>
              <dd>{person.trueIdentity}</dd>
            </dl>
          )}
          {person.motivation && (
            <dl>
              <dt>动机</dt>
              <dd>{person.motivation}</dd>
            </dl>
          )}
          {person.secrets.length > 0 && (
            <dl>
              <dt>秘密</dt>
              <dd>{person.secrets.join("；")}</dd>
            </dl>
          )}
        </div>
      </article>

      <div className="person-ego-relations">
        <header>
          <p className="eyebrow">DIRECT RELATIONSHIPS</p>
          <h3>关联人物</h3>
        </header>
        {relatedPeople.length > 0 ? (
          <div className="person-related-grid">
            {relatedPeople.map(({ person: related, relation, isSource }) => (
              <button
                className={`person-related-card relation-${relation.type}`}
                key={relation.id}
                onClick={() => onSelectRelated(related.id)}
              >
                <PersonPortrait
                  person={related}
                  size="sm"
                  borderStyle={relation.type}
                />
                <span className="person-related-copy">
                  <strong>{related.name}</strong>
                  <small className={`relation-badge relation-${relation.type}`}>
                    {relation.type === "hidden" ? "隐藏" : "公开"}
                  </small>
                  <span>{relation.label}</span>
                  <small>{isSource ? "指向此人物" : "由此人物指向"}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">尚未整理该人物的直接关系。</div>
        )}
      </div>
    </section>
  );
}
