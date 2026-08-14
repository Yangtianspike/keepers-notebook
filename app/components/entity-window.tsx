"use client";

import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ENTITY_FIELD_LABELS,
  ENTITY_KIND_LABELS,
  entityAliases,
  entityCoCStats,
  entityFields,
  entityImage,
  entityName,
  getRelatedEntities,
} from "@/lib/entities";
import type {
  EntityCard,
  EntityKind,
  EntityOverrides,
  PersonCoCStatKey,
  PersonCoCStats,
  Project,
} from "@/lib/types";

const COC_FIELDS: Array<[PersonCoCStatKey, string]> = [
  ["str", "STR"], ["con", "CON"], ["siz", "SIZ"], ["dex", "DEX"],
  ["app", "APP"], ["int", "INT"], ["pow", "POW"], ["edu", "EDU"],
  ["hp", "HP"], ["mp", "MP"], ["san", "SAN"], ["luck", "幸运"],
  ["mov", "MOV"], ["build", "体格"], ["damageBonus", "伤害加值"], ["armor", "护甲"],
];

type EntityWindowProps = {
  entities: EntityCard[];
  project: Project;
  initialRef: string;
  x: number;
  y: number;
  width: number;
  zIndex: number;
  onClose: () => void;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onOpenRelated: (ref: string) => void;
  onJump: (entity: EntityCard) => void;
  onSave: (entity: EntityCard, override: EntityOverrides) => void;
  onCreate: (kind: EntityKind, name: string, relatedTo?: EntityCard) => EntityCard;
  onDelete: (entity: EntityCard) => void;
};

export function EntityWindow({
  entities,
  project,
  initialRef,
  x,
  y,
  width,
  zIndex,
  onClose,
  onFocus,
  onMove,
  onOpenRelated,
  onJump,
  onSave,
  onCreate,
  onDelete,
}: EntityWindowProps) {
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createKind, setCreateKind] = useState<EntityKind>("person");
  const [createName, setCreateName] = useState("");
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const entity = entities.find((candidate) => candidate.ref === initialRef);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const nextX = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - drag.offsetX));
      const nextY = Math.max(8, Math.min(window.innerHeight - 96, event.clientY - drag.offsetY));
      onMove(nextX, nextY);
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
  }, [onMove, width]);

  const related = useMemo(() => {
    if (!entity) return [];
    return getRelatedEntities(entity.ref, project);
  }, [entity, project]);

  if (!entity) return null;

  return (
    <article
      className="entity-window parchment-window floating-entity-window"
      role="dialog"
      aria-modal="false"
      aria-label={`${entityName(entity)}实体卡`}
      onPointerDown={onFocus}
      style={{ left: x, top: y, width, zIndex }}
    >
        <header onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button, input, select, textarea")) return;
          event.preventDefault();
          event.stopPropagation();
          onFocus();
          dragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - x,
            offsetY: event.clientY - y,
          };
        }}>
          <span aria-hidden="true" />
          <div>
            <small>{ENTITY_KIND_LABELS[entity.kind]} · {entity.source === "keeper" ? "KP 创建" : entity.source === "inference" ? "模型推断" : "剧本资料"}</small>
            <h2>{entityName(entity)}</h2>
          </div>
          <button className="entity-close" type="button" aria-label="关闭此窗口" onClick={onClose}>×</button>
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
                  const created = onCreate(createKind, createName.trim(), entity);
                  onOpenRelated(created.ref);
                  setCreateName("");
                  setCreating(false);
                }}>创建并关联</button>
              </div>
            )}
            <EntityPagedContent resetKey={`${entity.ref}:${entity.updatedAt}`}>
              <EntityReadView entity={entity} />
              {entity.kind === "person" && (
                <PersonTrajectory entity={entity} project={project} />
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
                            onOpenRelated(item.entity.ref);
                            setEditing(false);
                          }}>
                            <strong>{entityName(item.entity)}</strong>
                            <span>{
                              entity.kind === "person" && item.entity.kind === "person" && item.relation.label
                                ? item.relation.sourceRef === entity.ref
                                  ? `${item.relation.label} →`
                                  : `← ${item.relation.label}`
                                : item.relation.label || ENTITY_KIND_LABELS[item.entity.kind]
                            }</span>
                            {item.relation.summary && <em>{item.relation.summary}</em>}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {related.length === 0 && <div className="entity-empty-related"><p>暂无相关实体。</p><button type="button" onClick={() => setCreating(true)}>新建关联实体</button></div>}
              </section>
            </EntityPagedContent>
          </>
        )}
    </article>
  );
}

function EntityPagedContent({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageWidth, setPageWidth] = useState(1);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const update = () => {
      const width = viewport.clientWidth;
      if (!width) return;
      content.style.columnWidth = `${width}px`;
      setPageWidth(width);
      const count = Math.max(1, Math.ceil(content.scrollWidth / width));
      setPageCount(count);
      setPage((current) => Math.min(current, count - 1));
    };
    setPage(0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [resetKey]);

  return (
    <div className="entity-pager">
      <div className="entity-page-viewport" ref={viewportRef}>
        <div
          className="entity-page-flow"
          ref={contentRef}
          style={{ transform: `translateX(-${page * pageWidth}px)` }}
        >
          {children}
        </div>
      </div>
      <footer className="entity-page-controls">
        <button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>← 上一页</button>
        <span>{page + 1} / {pageCount}</span>
        <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>下一页 →</button>
      </footer>
    </div>
  );
}

function PersonTrajectory({ entity, project }: { entity: EntityCard; project: Project }) {
  const arc = project.analysis.characterArcs?.find(
    (candidate) => candidate.personId === entity.id,
  );
  const actions = [...project.analysis.acts]
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap((act) => {
      const action = act.personActions?.find(
        (candidate) => candidate.personId === entity.id,
      );
      if (!action || action.provenance === "none" || !action.summary.trim()) return [];
      return [{ act, action }];
    });
  if (!arc?.experience && actions.length === 0) return null;
  return (
    <section className="entity-person-trajectory">
      <h3>剧本行动轨迹</h3>
      {arc?.experience && (
        <p className="entity-trajectory-overview">{arc.experience}</p>
      )}
      {actions.length > 0 && (
        <ol>
          {actions.map(({ act, action }) => (
            <li key={act.id}>
              <strong>第 {act.sequence} 幕 · {act.title}</strong>
              <span>{action.summary}</span>
              <small>{action.provenance === "source" ? "剧本资料" : "模型归纳"}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EntityReadView({ entity }: { entity: EntityCard }) {
  const fields = entityFields(entity);
  const image = entityImage(entity);
  const aliases = entityAliases(entity);
  const playerVisible = entity.overrides?.playerVisible ?? entity.original.playerVisible;
  const keeperPrivate = entity.overrides?.keeperPrivate ?? entity.original.keeperPrivate;
  return (
    <div className="entity-read-view">
      {image && (
        <figure className="entity-card-image">
          {/* Entity images are local data URLs selected by the KP. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={entityName(entity)} />
        </figure>
      )}
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

function resizeEntityImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("图片格式无法识别。"));
      image.onload = () => {
        const maximum = 768;
        const scale = Math.min(1, maximum / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
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
  const [image, setImage] = useState(entityImage(entity) ?? "");
  const [imageTouched, setImageTouched] = useState(false);
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
  const [cocTouchedKeys, setCocTouchedKeys] = useState<PersonCoCStatKey[]>([]);
  const [skillsTouched, setSkillsTouched] = useState(false);
  const [attacksTouched, setAttacksTouched] = useState(false);
  return (
    <form className="entity-edit-form" onSubmit={(event) => {
      event.preventDefault();
      const nextCocStats: Partial<PersonCoCStats> = { ...(entity.overrides?.cocStats ?? {}) };
      cocTouchedKeys.forEach((key) => {
        const value = cocValues[key]?.trim();
        if (!value) {
          delete (nextCocStats as Record<string, unknown>)[key];
          return;
        }
        if (key === "damageBonus" || key === "armor") nextCocStats[key] = value;
        else {
          const number = Number(value);
          if (Number.isFinite(number)) (nextCocStats as Record<string, unknown>)[key] = number;
        }
      });
      if (skillsTouched) {
        nextCocStats.skills = skillsText.split(/\r?\n/).flatMap((line) => {
          const match = line.match(/^\s*(.+?)\s*[:：]\s*(\d+(?:\.\d+)?)\s*%?\s*$/);
          return match ? [{ name: match[1], value: Number(match[2]), provenance: "keeper" as const }] : [];
        });
      }
      if (attacksTouched) {
        nextCocStats.attacks = attacksText.split(/\r?\n/).flatMap((line) => {
          const [name = "", value = "", damage = ""] = line.split("|").map((part) => part.trim());
          if (!name || !damage) return [];
          const numericValue = value ? Number(value) : Number.NaN;
          return [{ name, value: Number.isFinite(numericValue) ? numericValue : undefined, damage, provenance: "keeper" as const }];
        });
      }
      const cocChanged = cocTouchedKeys.length > 0 || skillsTouched || attacksTouched;
      onSave({
        name: name.trim(), aliases: aliases.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
        fields, cocStats: cocChanged ? nextCocStats : entity.overrides?.cocStats,
        image: imageTouched ? image : entity.overrides?.image,
        imageSource: imageTouched && image ? "manual" : entity.overrides?.imageSource,
        playerVisible, keeperPrivate, linkBehavior: { jump, preview }, updatedAt: new Date().toISOString(),
      });
    }}>
      <div className="entity-image-editor">
        {image ? (
          <>
            {/* Entity images are local data URLs selected by the KP. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="实体主图预览" />
            <button type="button" onClick={() => { setImage(""); setImageTouched(true); }}>删除图片</button>
          </>
        ) : <span>尚未添加图片</span>}
        <label>
          {image ? "更换图片" : "添加图片"}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void resizeEntityImage(file).then((dataUrl) => {
              setImage(dataUrl);
              setImageTouched(true);
            });
            event.currentTarget.value = "";
          }} />
        </label>
      </div>
      <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label>别名<input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="用顿号分隔" /></label>
      {ENTITY_FIELD_LABELS[entity.kind].map(([key, label]) => (
        <label key={key}>{label}<textarea value={fields[key] ?? ""} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} /></label>
      ))}
      {entity.kind === "person" && <fieldset className="entity-coc-edit">
        <legend>CoC 7版属性（修改后作为 KP 覆盖值保存）</legend>
        <div className="entity-coc-edit-grid">
          {COC_FIELDS.map(([key, label]) => <label key={key}>{label}<input value={cocValues[key] ?? ""} onChange={(event) => { setCocTouchedKeys((current) => current.includes(key) ? current : [...current, key]); setCocValues((current) => ({ ...current, [key]: event.target.value })); }} /></label>)}
        </div>
        <label>技能（每行“名称: 数值”）<textarea value={skillsText} onChange={(event) => { setSkillsTouched(true); setSkillsText(event.target.value); }} /></label>
        <label>攻击（每行“名称 | 命中 | 伤害”）<textarea value={attacksText} onChange={(event) => { setAttacksTouched(true); setAttacksText(event.target.value); }} /></label>
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
