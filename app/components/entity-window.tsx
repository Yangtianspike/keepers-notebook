"use client";

import { useMemo, useState } from "react";
import {
  ENTITY_FIELD_LABELS,
  ENTITY_KIND_LABELS,
  entityAliases,
  entityCoCStats,
  entityFields,
  entityName,
} from "@/lib/entities";
import type {
  EntityCard,
  EntityKind,
  EntityOverrides,
  EntityRelation,
  PersonCoCStatKey,
  PersonCoCStats,
} from "@/lib/types";

const COC_FIELDS: Array<[PersonCoCStatKey, string]> = [
  ["str", "STR"], ["con", "CON"], ["siz", "SIZ"], ["dex", "DEX"],
  ["app", "APP"], ["int", "INT"], ["pow", "POW"], ["edu", "EDU"],
  ["hp", "HP"], ["mp", "MP"], ["san", "SAN"], ["luck", "幸运"],
  ["mov", "MOV"], ["build", "体格"], ["damageBonus", "伤害加值"], ["armor", "护甲"],
];

type EntityWindowProps = {
  entities: EntityCard[];
  relations: EntityRelation[];
  initialRef: string;
  onClose: () => void;
  onJump: (entity: EntityCard) => void;
  onSave: (entity: EntityCard, override: EntityOverrides) => void;
  onCreate: (kind: EntityKind, name: string, relatedTo?: EntityCard) => void;
  onDelete: (entity: EntityCard) => void;
};

export function EntityWindow({
  entities,
  relations,
  initialRef,
  onClose,
  onJump,
  onSave,
  onCreate,
  onDelete,
}: EntityWindowProps) {
  const [history, setHistory] = useState([initialRef]);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createKind, setCreateKind] = useState<EntityKind>("person");
  const [createName, setCreateName] = useState("");
  const currentRef = history.at(-1) ?? initialRef;
  const entity = entities.find((candidate) => candidate.ref === currentRef);

  const related = useMemo(() => {
    if (!entity) return [];
    return relations
      .filter((relation) => relation.sourceRef === entity.ref || relation.targetRef === entity.ref)
      .map((relation) => ({
        relation,
        entity: entities.find((candidate) => candidate.ref === (
          relation.sourceRef === entity.ref ? relation.targetRef : relation.sourceRef
        )),
      }))
      .filter((item): item is { relation: EntityRelation; entity: EntityCard } => Boolean(item.entity));
  }, [entities, entity, relations]);

  if (!entity) return null;

  return (
    <div className="entity-window-layer" role="dialog" aria-modal="true" aria-label={`${entityName(entity)}实体卡`}>
      <article className="entity-window parchment-window">
        <header>
          <button
            className="entity-back"
            type="button"
            disabled={history.length === 1}
            onClick={() => setHistory((current) => current.slice(0, -1))}
          >
            ← 返回
          </button>
          <div>
            <small>{ENTITY_KIND_LABELS[entity.kind]} · {entity.source === "keeper" ? "KP 创建" : entity.source === "inference" ? "模型推断" : "剧本资料"}</small>
            <h2>{entityName(entity)}</h2>
          </div>
          <button className="entity-close" type="button" aria-label="关闭全部" onClick={onClose}>×</button>
        </header>

        {editing ? (
          <EntityEditForm
            entity={entity}
            onCancel={() => setEditing(false)}
            onSave={(override) => {
              onSave(entity, override);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <div className="entity-window-actions">
              <button type="button" onClick={() => onJump(entity)}>跳转到书页</button>
              <button type="button" onClick={() => setEditing(true)}>编辑资料</button>
              <button type="button" onClick={() => setCreating((value) => !value)}>新建关联实体</button>
              {entity.source === "keeper" && (
                <button className="danger" type="button" onClick={() => onDelete(entity)}>删除</button>
              )}
            </div>
            {creating && (
              <div className="entity-create-row">
                <select value={createKind} onChange={(event) => setCreateKind(event.target.value as EntityKind)}>
                  {Object.entries(ENTITY_KIND_LABELS).map(([kind, label]) => (
                    <option value={kind} key={kind}>{label}</option>
                  ))}
                </select>
                <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="实体名称" />
                <button type="button" disabled={!createName.trim()} onClick={() => {
                  onCreate(createKind, createName.trim(), entity);
                  setCreateName("");
                  setCreating(false);
                }}>创建并关联</button>
              </div>
            )}
            <EntityReadView entity={entity} />
          </>
        )}

        <section className="entity-relations">
          <h3>关联资料</h3>
          {(["direct", "indirect", "inference", "keeper"] as const).map((level) => {
            const items = related.filter((item) => item.relation.level === level);
            if (items.length === 0) return null;
            return (
              <div key={level}>
                <small>{({ direct: "直接关联", indirect: "间接关联", inference: "模型推断", keeper: "KP 关联" })[level]}</small>
                <div className="entity-related-list">
                  {items.map((item) => (
                    <button type="button" key={item.relation.id} onClick={() => {
                      setHistory((current) => [...current, item.entity.ref]);
                      setEditing(false);
                    }}>
                      <strong>{entityName(item.entity)}</strong>
                      <span>{item.relation.label || ENTITY_KIND_LABELS[item.entity.kind]}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {related.length === 0 && <p>尚无关联资料。</p>}
        </section>
      </article>
    </div>
  );
}

function EntityReadView({ entity }: { entity: EntityCard }) {
  const fields = entityFields(entity);
  const aliases = entityAliases(entity);
  const playerVisible = entity.overrides?.playerVisible ?? entity.original.playerVisible;
  const keeperPrivate = entity.overrides?.keeperPrivate ?? entity.original.keeperPrivate;
  return (
    <div className="entity-read-view">
      {aliases.length > 0 && <p><strong>别名</strong><span>{aliases.join("、")}</span></p>}
      {ENTITY_FIELD_LABELS[entity.kind].map(([key, label]) => {
        const value = fields[key];
        if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
        return <p key={key}><strong>{label}</strong><span>{Array.isArray(value) ? value.join("、") : String(value)}</span></p>;
      })}
      {playerVisible && <p><strong>玩家可见</strong><span>{playerVisible}</span></p>}
      {keeperPrivate && <p className="keeper-private"><strong>KP 私密</strong><span>{keeperPrivate}</span></p>}
      {entity.kind === "person" && <CoCStatsReadView entity={entity} />}
    </div>
  );
}

function CoCStatsReadView({ entity }: { entity: EntityCard }) {
  const stats = entityCoCStats(entity);
  if (!stats) return <section className="entity-coc-stats"><h3>CoC 7版属性</h3><p>暂无属性，点击“编辑资料”补充。</p></section>;
  const values = COC_FIELDS.flatMap(([key, label]) => {
    const value = stats[key];
    if (value === undefined || typeof value === "object") return [];
    const keeper = Boolean(entity.overrides?.cocStats && key in entity.overrides.cocStats);
    const provenance = keeper ? "keeper" : stats.fieldProvenance?.[key]?.provenance;
    return [{ key, label, value: String(value), provenance }];
  });
  return (
    <section className="entity-coc-stats">
      <h3>CoC 7版属性</h3>
      <div className="entity-coc-grid">
        {values.map((item) => <div key={item.key}><small>{item.label}</small><strong>{item.value}</strong><i>{item.provenance === "source" ? "原文" : item.provenance === "keeper" ? "KP" : "推断"}</i></div>)}
      </div>
      {stats.skills && stats.skills.length > 0 && <div className="entity-coc-list"><strong>技能</strong>{stats.skills.map((skill) => <span key={skill.name}>{skill.name} {skill.value}% <i>{skill.provenance === "source" ? "原文" : skill.provenance === "keeper" ? "KP" : "推断"}</i></span>)}</div>}
      {stats.attacks && stats.attacks.length > 0 && <div className="entity-coc-list"><strong>攻击</strong>{stats.attacks.map((attack) => <span key={attack.name}>{attack.name} {attack.value !== undefined ? `${attack.value}%` : ""} · {attack.damage} <i>{attack.provenance === "source" ? "原文" : attack.provenance === "keeper" ? "KP" : "推断"}</i></span>)}</div>}
    </section>
  );
}

function EntityEditForm({ entity, onCancel, onSave }: {
  entity: EntityCard;
  onCancel: () => void;
  onSave: (override: EntityOverrides) => void;
}) {
  const [name, setName] = useState(entityName(entity));
  const [aliases, setAliases] = useState(entityAliases(entity).join("、"));
  const [fields, setFields] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(entityFields(entity)).map(([key, value]) => [key, Array.isArray(value) ? value.join("、") : String(value)]),
  ));
  const [playerVisible, setPlayerVisible] = useState(entity.overrides?.playerVisible ?? entity.original.playerVisible);
  const [keeperPrivate, setKeeperPrivate] = useState(entity.overrides?.keeperPrivate ?? entity.original.keeperPrivate);
  const [jump, setJump] = useState(entity.linkBehavior.jump);
  const [preview, setPreview] = useState(entity.linkBehavior.preview);
  const mergedCocStats = entityCoCStats(entity);
  const [cocValues, setCocValues] = useState<Record<string, string>>(() => Object.fromEntries(
    COC_FIELDS.map(([key]) => [key, mergedCocStats?.[key] === undefined ? "" : String(mergedCocStats[key])]),
  ));
  const [skillsText, setSkillsText] = useState(() => (mergedCocStats?.skills ?? [])
    .map((skill) => `${skill.name}: ${skill.value}`).join("\n"));
  const [attacksText, setAttacksText] = useState(() => (mergedCocStats?.attacks ?? [])
    .map((attack) => `${attack.name} | ${attack.value ?? ""} | ${attack.damage}`).join("\n"));
  const [cocTouched, setCocTouched] = useState(false);
  return (
    <form className="entity-edit-form" onSubmit={(event) => {
      event.preventDefault();
      const nextCocStats: Partial<PersonCoCStats> = {};
      COC_FIELDS.forEach(([key]) => {
        const value = cocValues[key]?.trim();
        if (!value) return;
        if (key === "damageBonus" || key === "armor") nextCocStats[key] = value;
        else {
          const number = Number(value);
          if (Number.isFinite(number)) (nextCocStats as Record<string, unknown>)[key] = number;
        }
      });
      nextCocStats.skills = skillsText.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\s*(.+?)\s*[:：]\s*(\d+(?:\.\d+)?)\s*%?\s*$/);
        return match ? [{ name: match[1], value: Number(match[2]), provenance: "keeper" as const }] : [];
      });
      nextCocStats.attacks = attacksText.split(/\r?\n/).flatMap((line) => {
        const [name = "", value = "", damage = ""] = line.split("|").map((part) => part.trim());
        if (!name || !damage) return [];
        const numericValue = Number(value);
        return [{ name, value: Number.isFinite(numericValue) ? numericValue : undefined, damage, provenance: "keeper" as const }];
      });
      onSave({
        name: name.trim(), aliases: aliases.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
        fields, cocStats: cocTouched ? nextCocStats : entity.overrides?.cocStats,
        playerVisible, keeperPrivate, linkBehavior: { jump, preview }, updatedAt: new Date().toISOString(),
      });
    }}>
      <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label>别名<input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="用顿号分隔" /></label>
      {ENTITY_FIELD_LABELS[entity.kind].map(([key, label]) => (
        <label key={key}>{label}<textarea value={fields[key] ?? ""} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} /></label>
      ))}
      {entity.kind === "person" && <fieldset className="entity-coc-edit">
        <legend>CoC 7版属性（修改后作为 KP 覆盖值保存）</legend>
        <div className="entity-coc-edit-grid">
          {COC_FIELDS.map(([key, label]) => <label key={key}>{label}<input value={cocValues[key] ?? ""} onChange={(event) => { setCocTouched(true); setCocValues((current) => ({ ...current, [key]: event.target.value })); }} /></label>)}
        </div>
        <label>技能（每行“名称: 数值”）<textarea value={skillsText} onChange={(event) => { setCocTouched(true); setSkillsText(event.target.value); }} /></label>
        <label>攻击（每行“名称 | 命中 | 伤害”）<textarea value={attacksText} onChange={(event) => { setCocTouched(true); setAttacksText(event.target.value); }} /></label>
      </fieldset>}
      <label>玩家可见<textarea value={playerVisible} onChange={(event) => setPlayerVisible(event.target.value)} /></label>
      <label>KP 私密<textarea value={keeperPrivate} onChange={(event) => setKeeperPrivate(event.target.value)} /></label>
      <fieldset>
        <legend>默认点击行为</legend>
        <label><input type="checkbox" checked={jump} onChange={(event) => setJump(event.target.checked)} />跳转到书页</label>
        <label><input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} />打开资料窗口</label>
      </fieldset>
      <div className="entity-form-actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button type="submit">保存修改</button>
      </div>
    </form>
  );
}
