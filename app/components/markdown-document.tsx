"use client";

import { Fragment, type ReactNode, useMemo, useState } from "react";
import {
  ENTITY_KIND_LABELS,
  entityAliases,
  entityName,
  keeperEntityUri,
  parseKeeperEntityUri,
} from "@/lib/entities";
import type { EntityCard, EntityLinkBehavior } from "@/lib/types";
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
};

type MarkdownDocumentProps = {
  markdown: string;
  entities?: EntityCard[];
  onEntityAction?: (action: MarkdownEntityAction) => void;
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
  return (
    <span className={`entity-inline entity-${entity.kind}`}>
      <button type="button" onClick={() => setOpen((value) => !value)}>{children}</button>
      {open && (
        <span className="entity-inline-menu">
          <strong>{entityName(entity)}</strong>
          <small>{ENTITY_KIND_LABELS[entity.kind]}</small>
          {behavior.jump && <button type="button" onClick={() => {
            setOpen(false);
            onEntityAction?.({ entity, behavior, action: "jump" });
          }}>跳转到 {entityName(entity)}</button>}
          {behavior.preview && <button type="button" onClick={() => {
            setOpen(false);
            onEntityAction?.({ entity, behavior, action: "preview" });
          }}>打开资料窗口</button>}
        </span>
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

export function markdownToReactBlocks({ markdown, entities = [], onEntityAction }: MarkdownDocumentProps) {
  return parseMarkdownBlocks(markdown).flatMap((block, index) => {
    const content = block.text ? inlineMarkdown(block.text, entities, onEntityAction) : null;
    const common = { className: "markdown-block", "data-keep-with-next": block.kind === "heading" ? "true" : undefined };
    if (block.kind === "heading") {
      if (block.level === 1) return <h1 {...common} key={index}>{content}</h1>;
      if (block.level === 2) return <h2 {...common} key={index}>{content}</h2>;
      if (block.level === 3) return <h3 {...common} key={index}>{content}</h3>;
      return <h4 {...common} key={index}>{content}</h4>;
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
      return <div {...common} className="markdown-block character-card-placeholder" data-entity-ref={block.character.ref} key={index}>人物卡 · {block.character.ref}</div>;
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
  const { markdown, entities, onEntityAction } = props;
  const blocks = useMemo(
    () => markdownToReactBlocks({ markdown, entities, onEntityAction }),
    [markdown, entities, onEntityAction],
  );
  return <div className="markdown-document">{blocks}</div>;
}

export function addEntityLink(markdown: string, label: string, entity: EntityCard, behavior: EntityLinkBehavior) {
  return markdown.replace(label, `[${label}](${keeperEntityUri(entity.ref, behavior)})`);
}
