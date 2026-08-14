"use client";

import { Fragment, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ENTITY_KIND_LABELS,
  entityAliases,
  entityCoCStats,
  entityFields,
  entityImage,
  entityName,
  keeperEntityUri,
  parseKeeperEntityUri,
} from "@/lib/entities";
import type { EntityCard, EntityLinkBehavior, PersonCoCStatKey } from "@/lib/types";
import {
  isSafeLinkUrl,
  parseMarkdown,
  type MarkdownBlock,
} from "@/lib/markdown";

export { editableHtmlToMarkdown, markdownToEditableHtml } from "@/lib/markdown";

export type MarkdownEntityAction = {
  entity: EntityCard;
  behavior: EntityLinkBehavior;
  action: "jump" | "preview";
  anchorRect?: DOMRect;
};

type MarkdownDocumentProps = {
  markdown: string;
  entities?: EntityCard[];
  onEntityAction?: (action: MarkdownEntityAction) => void;
  onEntityImageChange?: (entity: EntityCard, image: string) => void;
  sectionKey?: string;
};

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  return parseMarkdown(markdown);
}

function uniqueEntityTerms(entities: EntityCard[]) {
  const occurrences = new Map<string, EntityCard[]>();
  entities.forEach((entity) => {
    [entityName(entity), ...entityAliases(entity)].filter((term) => term.length >= 2).forEach((term) => {
      occurrences.set(term, [...(occurrences.get(term) ?? []), entity]);
    });
  });
  return [...occurrences.entries()]
    .filter(([, matches]) => matches.length === 1)
    .sort(([left], [right]) => right.length - left.length)
    .map(([term, matches]) => ({ term, entity: matches[0] }));
}

function InlineEntityLink({
  entity,
  behavior,
  children,
  onEntityAction,
}: {
  entity: EntityCard;
  behavior: EntityLinkBehavior;
  children: ReactNode;
  onEntityAction?: MarkdownDocumentProps["onEntityAction"];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const gap = 7;
    const viewportPadding = 8;
    const left = anchor.left + menu.width <= window.innerWidth - viewportPadding
      ? anchor.left
      : Math.max(viewportPadding, anchor.right - menu.width);
    const top = anchor.bottom + gap + menu.height <= window.innerHeight - viewportPadding
      ? anchor.bottom + gap
      : Math.max(viewportPadding, anchor.top - menu.height - gap);
    setMenuPosition({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event?: Event) => {
      const target = event?.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const closeForViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", closeForViewportChange, true);
    window.addEventListener("resize", closeForViewportChange);
    window.addEventListener("pagehide", closeForViewportChange);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", closeForViewportChange, true);
      window.removeEventListener("resize", closeForViewportChange);
      window.removeEventListener("pagehide", closeForViewportChange);
    };
  }, [open]);

  const triggerRect = () => triggerRef.current?.getBoundingClientRect();
  return (
    <span className={`entity-inline entity-${entity.kind}`}>
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)}>{children}</button>
      {open && typeof document !== "undefined" && createPortal(
        <span
          className="entity-inline-menu entity-inline-menu-portal"
          ref={menuRef}
          style={menuPosition}
        >
          <strong>{entityName(entity)}</strong>
          <small>{ENTITY_KIND_LABELS[entity.kind]}</small>
          {behavior.jump && <button type="button" onClick={() => {
            setOpen(false);
            onEntityAction?.({ entity, behavior, action: "jump", anchorRect: triggerRect() });
          }}>跳转到 {entityName(entity)}</button>}
          {behavior.preview && <button type="button" onClick={() => {
            setOpen(false);
            onEntityAction?.({ entity, behavior, action: "preview", anchorRect: triggerRect() });
          }}>打开资料窗口</button>}
        </span>,
        document.body,
      )}
    </span>
  );
}

function inlineMarkdown(
  text: string,
  entities: EntityCard[],
  onEntityAction?: MarkdownDocumentProps["onEntityAction"],
): ReactNode[] {
  const byRef = new Map(entities.map((entity) => [entity.ref, entity]));
  const terms = uniqueEntityTerms(entities);
  const explicitPattern = /\[([^\]]+)]\((keeper:\/\/[^)]+)\)/g;
  const explicit: Array<{ start: number; end: number; label: string; uri: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = explicitPattern.exec(text))) {
    explicit.push({ start: match.index, end: match.index + match[0].length, label: match[1], uri: match[2] });
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  const renderPlain = (plain: string, baseKey: string) => {
    let remaining = plain;
    let key = 0;
    const used = new Set<string>();
    while (remaining) {
      let best: { index: number; term: string; entity: EntityCard } | null = null;
      terms.forEach(({ term, entity }) => {
        if (used.has(entity.ref)) return;
        const index = remaining.indexOf(term);
        if (index >= 0 && (!best || index < best.index || (index === best.index && term.length > best.term.length))) {
          best = { index, term, entity };
        }
      });
      if (!best) {
        nodes.push(...renderInlineFormatting(remaining, `${baseKey}-${key}`));
        break;
      }
      const found = best as { index: number; term: string; entity: EntityCard };
      if (found.index > 0) nodes.push(...renderInlineFormatting(remaining.slice(0, found.index), `${baseKey}-${key}`));
      used.add(found.entity.ref);
      nodes.push(
        <InlineEntityLink entity={found.entity} behavior={found.entity.linkBehavior} onEntityAction={onEntityAction} key={`${baseKey}-entity-${key}`}>
          {found.entity.kind === "person" ? <em>{found.term}</em> : found.term}
        </InlineEntityLink>,
      );
      remaining = remaining.slice(found.index + found.term.length);
      key += 1;
    }
  };
  explicit.forEach((link, index) => {
    renderPlain(text.slice(cursor, link.start), `pre-${index}`);
    const parsed = parseKeeperEntityUri(link.uri);
    const entity = parsed ? byRef.get(parsed.ref) : undefined;
    if (entity && parsed) {
      nodes.push(
        <InlineEntityLink entity={entity} behavior={parsed.behavior} onEntityAction={onEntityAction} key={`link-${index}`}>
          {entity.kind === "person" ? <em>{link.label}</em> : link.label}
        </InlineEntityLink>,
      );
    } else nodes.push(link.label);
    cursor = link.end;
  });
  renderPlain(text.slice(cursor), "tail");
  return nodes;
}

function renderInlineFormatting(text: string, key: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|~~[^~]+~~|(?<!\*)\*[^*]+\*(?!\*)|<u>[^<]*<\/u>|<span data-font="(?:serif|sans|kai)">[^<]*<\/span>|\[[^\]]+]\(https?:\/\/[^)]+\))/gi;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    const childKey = `${key}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={childKey}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("~~") && part.endsWith("~~")) return <del key={childKey}>{part.slice(2, -2)}</del>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={childKey}>{part.slice(1, -1)}</em>;
    const underline = part.match(/^<u>([^<]*)<\/u>$/i);
    if (underline) return <u key={childKey}>{underline[1]}</u>;
    const font = part.match(/^<span data-font="(serif|sans|kai)">([^<]*)<\/span>$/i);
    if (font) return <span data-font={font[1]} key={childKey}>{font[2]}</span>;
    const link = part.match(/^\[([^\]]+)]\((https?:\/\/[^)]+)\)$/i);
    if (link && isSafeLinkUrl(link[2])) return <a href={link[2]} rel="noreferrer" target="_blank" key={childKey}>{link[1]}</a>;
    return <Fragment key={childKey}>{part}</Fragment>;
  });
}

const COC_STAT_LABELS: Array<[PersonCoCStatKey, string]> = [
  ["str", "STR"], ["con", "CON"], ["siz", "SIZ"], ["dex", "DEX"],
  ["app", "APP"], ["int", "INT"], ["pow", "POW"], ["edu", "EDU"],
  ["hp", "HP"], ["mp", "MP"], ["san", "SAN"], ["luck", "幸运"],
  ["mov", "MOV"], ["build", "体格"], ["damageBonus", "伤害加值"], ["armor", "护甲"],
];

function resizeCharacterImage(file: File) {
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

function CharacterCardRenderer({
  entity,
  importance,
  onEntityAction,
  onEntityImageChange,
}: {
  entity: EntityCard;
  importance: "core" | "important" | "minor";
  onEntityAction?: MarkdownDocumentProps["onEntityAction"];
  onEntityImageChange?: MarkdownDocumentProps["onEntityImageChange"];
}) {
  const fields = entityFields(entity);
  const image = entityImage(entity);
  const stats = entityCoCStats(entity);
  const fieldRows = [
    ["summary", "摘要"], ["publicIdentity", "公开身份"], ["trueIdentity", "真实身份"],
    ["appearance", "外貌"], ["personality", "性格"], ["motivation", "动机"],
    ["secrets", "秘密"], ["state", "状态"], ["performanceHints", "扮演提示"],
  ].flatMap(([key, label]) => {
    const value = fields[key];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return [];
    return [{ label, value: Array.isArray(value) ? value.join("、") : String(value) }];
  });
  const visibleStats = COC_STAT_LABELS.flatMap(([key, label]) => {
    const value = stats?.[key];
    if (value === undefined || typeof value === "object") return [];
    const overridden = Boolean(entity.overrides?.cocStats && key in entity.overrides.cocStats);
    const provenance = overridden ? "keeper" : stats?.fieldProvenance?.[key]?.provenance;
    return [{ key, label, value: String(value), provenance }];
  });
  return (
    <article className={`character-card character-card-${importance}`}>
      {importance === "core" && (
        <div className="character-card-portrait">
          {image ? (
            // Entity images are locally stored data URLs selected by the KP.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={entityName(entity)} />
          ) : (
            <span aria-hidden="true">肖像</span>
          )}
          <label>
            {image ? "更换图片" : "添加图片"}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void resizeCharacterImage(file).then((dataUrl) => onEntityImageChange?.(entity, dataUrl));
              event.currentTarget.value = "";
            }} />
          </label>
        </div>
      )}
      <header>
        <div>
          <small>{importance === "core" ? "核心人物" : importance === "important" ? "重要人物" : "次要人物"}</small>
          <button type="button" onClick={(event) => onEntityAction?.({ entity, behavior: entity.linkBehavior, action: "preview", anchorRect: event.currentTarget.getBoundingClientRect() })}>
            <em>{entityName(entity)}</em>
          </button>
          {fields.role && <span>{String(fields.role)}</span>}
        </div>
        <span className={`entity-source-badge source-${entity.source}`}>
          {entity.source === "source" ? "剧本资料" : entity.source === "inference" ? "模型推断" : "KP 创建"}
        </span>
      </header>
      {importance !== "minor" && fieldRows.length > 0 && (
        <dl className="character-profile-grid">
          {fieldRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
        </dl>
      )}
      {importance !== "minor" && visibleStats.length > 0 && (
        <section className="character-coc-section">
          <h4>CoC 7版属性</h4>
          <div className="character-stat-grid">
            {visibleStats.map((stat) => <div key={stat.key} title={stat.provenance === "source" ? "剧本原文" : stat.provenance === "keeper" ? "KP 修改" : "模型推断"}>
              <small>{stat.label}</small><strong>{stat.value}</strong><i>{stat.provenance === "source" ? "原" : stat.provenance === "keeper" ? "KP" : "推"}</i>
            </div>)}
          </div>
          {importance === "core" && stats?.skills && stats.skills.length > 0 && (
            <div className="character-skill-list"><strong>技能</strong>{stats.skills.map((skill) => <span key={skill.name}>{skill.name} {skill.value}% <i>{skill.provenance === "source" ? "原" : skill.provenance === "keeper" ? "KP" : "推"}</i></span>)}</div>
          )}
          {importance === "core" && stats?.attacks && stats.attacks.length > 0 && (
            <div className="character-skill-list"><strong>攻击</strong>{stats.attacks.map((attack) => <span key={attack.name}>{attack.name} {attack.value !== undefined ? `${attack.value}%` : ""} · {attack.damage} <i>{attack.provenance === "source" ? "原" : attack.provenance === "keeper" ? "KP" : "推"}</i></span>)}</div>
          )}
        </section>
      )}
      {importance === "minor" && <p>{String(fields.summary || fields.publicIdentity || fields.role || "点击查看完整资料与 CoC 属性")}</p>}
    </article>
  );
}

export function markdownHeadingId(sectionKey: string, blockIndex: number) {
  return `${sectionKey}:heading:${blockIndex}`;
}

export function markdownToReactBlocks({ markdown, entities = [], onEntityAction, onEntityImageChange, sectionKey = "document" }: MarkdownDocumentProps) {
  return parseMarkdownBlocks(markdown).flatMap((block, index) => {
    const content = block.text ? inlineMarkdown(block.text, entities, onEntityAction) : null;
    const common = { className: "markdown-block", "data-keep-with-next": block.kind === "heading" ? "true" : undefined };
    if (block.kind === "heading") {
      const headingProps = {
        ...common,
        "data-heading-id": markdownHeadingId(sectionKey, index),
        "data-heading-level": block.level,
        "data-heading-title": block.text,
      };
      if (block.level === 1) return <h1 {...headingProps} key={index}>{content}</h1>;
      if (block.level === 2) return <h2 {...headingProps} key={index}>{content}</h2>;
      if (block.level === 3) return <h3 {...headingProps} key={index}>{content}</h3>;
      if (block.level === 4) return <h4 {...headingProps} key={index}>{content}</h4>;
      if (block.level === 5) return <h5 {...headingProps} key={index}>{content}</h5>;
      return <h6 {...headingProps} key={index}>{content}</h6>;
    }
    if (block.kind === "quote") return <blockquote {...common} key={index}>{content}</blockquote>;
    if (block.kind === "divider") return <hr {...common} key={index} />;
    if (block.kind === "image" && block.image) {
      return <figure {...common} className="markdown-block markdown-image" key={index}>
        {/* User-selected URLs are constrained by the shared Markdown allowlist. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={block.image.src} alt={block.image.alt} />
        {block.image.alt && <figcaption>{block.image.alt}</figcaption>}
      </figure>;
    }
    if (block.kind === "table" && block.table) {
      return <div {...common} className="markdown-block markdown-table-wrap" key={index}>
        <table>
          <thead><tr>{block.table.headers.map((cell, cellIndex) => <th key={cellIndex}>{inlineMarkdown(cell, entities, onEntityAction)}</th>)}</tr></thead>
          <tbody>{block.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineMarkdown(cell, entities, onEntityAction)}</td>)}</tr>)}</tbody>
        </table>
      </div>;
    }
    if (block.kind === "character-card" && block.character) {
      const entity = entities.find((candidate) => candidate.ref === block.character?.ref);
      if (!entity || entity.kind !== "person") return <div {...common} className="markdown-block character-card-placeholder" key={index}>人物资料不可用 · {block.character.ref}</div>;
      return <CharacterCardRenderer
        entity={entity}
        importance={block.character.importance ?? "minor"}
        onEntityAction={onEntityAction}
        onEntityImageChange={onEntityImageChange}
        key={index}
      />;
    }
    if (block.kind === "unordered-list" || block.kind === "ordered-list") {
      const Tag = block.kind === "ordered-list" ? "ol" : "ul";
      return (block.items ?? []).map((item, itemIndex) => (
        <Tag {...common} className="markdown-block markdown-list-continuation" start={block.kind === "ordered-list" ? itemIndex + 1 : undefined} key={`${index}-${itemIndex}`}>
          <li>{inlineMarkdown(item, entities, onEntityAction)}</li>
        </Tag>
      ));
    }
    return <p {...common} key={index}>{content}</p>;
  });
}

export function MarkdownDocument(props: MarkdownDocumentProps) {
  const { markdown, entities, onEntityAction, onEntityImageChange } = props;
  const blocks = useMemo(
    () => markdownToReactBlocks({ markdown, entities, onEntityAction, onEntityImageChange }),
    [markdown, entities, onEntityAction, onEntityImageChange],
  );
  return <div className="markdown-document">{blocks}</div>;
}

export function addEntityLink(markdown: string, label: string, entity: EntityCard, behavior: EntityLinkBehavior) {
  return markdown.replace(label, `[${label}](${keeperEntityUri(entity.ref, behavior)})`);
}
