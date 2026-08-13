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

type Block = {
  kind: "heading" | "paragraph" | "unordered-list" | "ordered-list" | "quote" | "divider";
  level?: number;
  text?: string;
  items?: string[];
};

function splitLongText(text: string, limit = 520) {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let boundary = Math.max(
      rest.lastIndexOf("。", limit), rest.lastIndexOf("；", limit),
      rest.lastIndexOf("！", limit), rest.lastIndexOf("？", limit), rest.lastIndexOf(" ", limit),
    );
    if (boundary < Math.floor(limit * 0.55)) boundary = limit;
    chunks.push(rest.slice(0, boundary + 1).trim());
    rest = rest.slice(boundary + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function parseMarkdownBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let list: string[] = [];
  let listKind: Block["kind"] = "unordered-list";
  const flushList = () => {
    if (list.length > 0) blocks.push({ kind: listKind, items: list });
    list = [];
  };
  markdown.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const nextKind = unordered ? "unordered-list" : "ordered-list";
      if (list.length > 0 && nextKind !== listKind) flushList();
      listKind = nextKind;
      list.push((unordered ?? ordered)![1]);
      return;
    }
    flushList();
    if (!line.trim()) return;
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ kind: "divider" });
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      return;
    }
    if (line.startsWith("> ")) {
      blocks.push({ kind: "quote", text: line.slice(2) });
      return;
    }
    splitLongText(line).forEach((text) => blocks.push({ kind: "paragraph", text }));
  });
  flushList();
  return blocks;
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
        nodes.push(...renderBold(remaining, `${baseKey}-${key}`));
        break;
      }
      const found = best as { index: number; term: string; entity: EntityCard };
      if (found.index > 0) nodes.push(...renderBold(remaining.slice(0, found.index), `${baseKey}-${key}`));
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

function renderBold(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${key}-${index}`}>{part.slice(2, -2)}</strong>
      : <Fragment key={`${key}-${index}`}>{part}</Fragment>,
  );
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

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineToHtml(text: string) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)]\((keeper:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToEditableHtml(markdown: string) {
  return parseMarkdownBlocks(markdown).map((block) => {
    if (block.kind === "heading") return `<h${block.level}>${inlineToHtml(block.text ?? "")}</h${block.level}>`;
    if (block.kind === "quote") return `<blockquote>${inlineToHtml(block.text ?? "")}</blockquote>`;
    if (block.kind === "divider") return "<hr>";
    if (block.kind === "unordered-list" || block.kind === "ordered-list") {
      const tag = block.kind === "ordered-list" ? "ol" : "ul";
      return `<${tag}>${block.items?.map((item) => `<li>${inlineToHtml(item)}</li>`).join("")}</${tag}>`;
    }
    return `<p>${inlineToHtml(block.text ?? "")}</p>`;
  }).join("");
}

function inlineHtmlToMarkdown(element: Element) {
  return Array.from(element.childNodes).map((node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const content = inlineHtmlToMarkdown(node);
    if (node.tagName === "STRONG" || node.tagName === "B") return `**${content}**`;
    if (node.tagName === "A") return `[${content}](${node.getAttribute("href") ?? ""})`;
    if (node.tagName === "BR") return "\n";
    return content;
  }).join("");
}

export function editableHtmlToMarkdown(root: HTMLElement) {
  return Array.from(root.children).map((element) => {
    const content = inlineHtmlToMarkdown(element).trim();
    const heading = element.tagName.match(/^H([1-4])$/);
    if (heading) return `${"#".repeat(Number(heading[1]))} ${content}`;
    if (element.tagName === "BLOCKQUOTE") return `> ${content}`;
    if (element.tagName === "HR") return "---";
    if (element.tagName === "UL" || element.tagName === "OL") {
      return Array.from(element.children).map((item, index) => `${element.tagName === "OL" ? `${index + 1}.` : "-"} ${inlineHtmlToMarkdown(item)}`).join("\n");
    }
    return content;
  }).filter(Boolean).join("\n\n");
}

export function addEntityLink(markdown: string, label: string, entity: EntityCard, behavior: EntityLinkBehavior) {
  return markdown.replace(label, `[${label}](${keeperEntityUri(entity.ref, behavior)})`);
}
