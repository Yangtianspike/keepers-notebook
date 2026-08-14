export type MarkdownFont = "serif" | "sans" | "kai";

export type MarkdownTable = {
  headers: string[];
  rows: string[][];
};

export type CharacterCardDirective = {
  ref: string;
  importance?: "core" | "important" | "minor";
};

export type MarkdownBlock = {
  kind:
    | "heading"
    | "paragraph"
    | "unordered-list"
    | "ordered-list"
    | "quote"
    | "divider"
    | "table"
    | "image"
    | "character-card";
  level?: number;
  text?: string;
  items?: string[];
  table?: MarkdownTable;
  image?: { alt: string; src: string };
  character?: CharacterCardDirective;
};

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

export function isSafeImageUrl(value: string) {
  try {
    const url = new URL(value, "https://keeper-atlas.local");
    return url.protocol === "https:" || url.protocol === "http:" || SAFE_DATA_IMAGE.test(value);
  } catch {
    return false;
  }
}

export function isSafeLinkUrl(value: string) {
  if (value.startsWith("keeper://")) return true;
  try {
    const url = new URL(value, "https://keeper-atlas.local");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizeFontToken(value: string | null | undefined): MarkdownFont | null {
  return value === "serif" || value === "sans" || value === "kai" ? value : null;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableDivider(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseCharacterDirective(line: string): CharacterCardDirective | null {
  const match = line.trim().match(/^:::character-card(\{.*\})$/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as Record<string, unknown>;
    const ref = typeof value.ref === "string" ? value.ref : "";
    if (!/^person:[^\s]+$/.test(ref)) return null;
    const importance = value.importance === "core" || value.importance === "important" || value.importance === "minor"
      ? value.importance
      : undefined;
    return { ref, importance };
  } catch {
    return null;
  }
}

export function splitLongText(text: string, limit = 520) {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let boundary = Math.max(
      rest.lastIndexOf("。", limit),
      rest.lastIndexOf("；", limit),
      rest.lastIndexOf("！", limit),
      rest.lastIndexOf("？", limit),
      rest.lastIndexOf(" ", limit),
    );
    if (boundary < Math.floor(limit * 0.55)) boundary = limit;
    chunks.push(rest.slice(0, boundary + 1).trim());
    rest = rest.slice(boundary + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let list: string[] = [];
  let listKind: MarkdownBlock["kind"] = "unordered-list";
  const flushList = () => {
    if (list.length > 0) blocks.push({ kind: listKind, items: list });
    list = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const nextKind = unordered ? "unordered-list" : "ordered-list";
      if (list.length > 0 && nextKind !== listKind) flushList();
      listKind = nextKind;
      list.push((unordered ?? ordered)![1]);
      continue;
    }
    flushList();
    if (!line.trim() || line.trim() === ":::") continue;

    const character = parseCharacterDirective(line);
    if (character) {
      blocks.push({ kind: "character-card", character });
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = splitTableRow(lines[index]);
        rows.push(headers.map((_, cellIndex) => row[cellIndex] ?? ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "table", table: { headers, rows } });
      continue;
    }

    const image = line.trim().match(/^!\[([^\]]*)]\(([^)]+)\)$/);
    if (image && isSafeImageUrl(image[2])) {
      blocks.push({ kind: "image", image: { alt: image[1], src: image[2] } });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ kind: "divider" });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({ kind: "quote", text: line.slice(2) });
      continue;
    }
    splitLongText(line).forEach((text) => blocks.push({ kind: "paragraph", text }));
  }
  flushList();
  return blocks;
}

function inlineMarkdownToHtml(text: string) {
  const tokens: string[] = [];
  const hold = (html: string) => {
    const key = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return key;
  };
  let safe = escapeHtml(text);
  safe = safe.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/gi, (_, value: string) => hold(`<u>${value}</u>`));
  safe = safe.replace(
    /&lt;span\s+data-font=&quot;(serif|sans|kai)&quot;&gt;([\s\S]*?)&lt;\/span&gt;/gi,
    (_, font: string, value: string) => hold(`<span data-font="${font}">${value}</span>`),
  );
  safe = safe.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_, label: string, href: string) => (
    isSafeLinkUrl(href) ? hold(`<a href="${escapeHtml(href)}">${label}</a>`) : label
  ));
  safe = safe
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return safe.replace(/\u0000(\d+)\u0000/g, (_, index: string) => tokens[Number(index)] ?? "");
}

export function markdownToEditableHtml(markdown: string) {
  return parseMarkdown(markdown).map((block) => {
    if (block.kind === "heading") return `<h${block.level}>${inlineMarkdownToHtml(block.text ?? "")}</h${block.level}>`;
    if (block.kind === "quote") return `<blockquote>${inlineMarkdownToHtml(block.text ?? "")}</blockquote>`;
    if (block.kind === "divider") return "<hr>";
    if (block.kind === "unordered-list" || block.kind === "ordered-list") {
      const tag = block.kind === "ordered-list" ? "ol" : "ul";
      return `<${tag}>${block.items?.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</${tag}>`;
    }
    if (block.kind === "table" && block.table) {
      const head = block.table.headers.map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`).join("");
      const rows = block.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdownToHtml(cell)}</td>`).join("")}</tr>`).join("");
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    if (block.kind === "image" && block.image) {
      return `<figure><img src="${escapeHtml(block.image.src)}" alt="${escapeHtml(block.image.alt)}"><figcaption>${escapeHtml(block.image.alt)}</figcaption></figure>`;
    }
    if (block.kind === "character-card" && block.character) {
      return `<div data-keeper-block="character-card" data-ref="${escapeHtml(block.character.ref)}" data-importance="${block.character.importance ?? ""}" contenteditable="false">人物卡 · ${escapeHtml(block.character.ref)}</div>`;
    }
    return `<p>${inlineMarkdownToHtml(block.text ?? "")}</p>`;
  }).join("");
}

function inlineHtmlToMarkdown(element: Element): string {
  return Array.from(element.childNodes).map((node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const content = inlineHtmlToMarkdown(node);
    if (node.tagName === "STRONG" || node.tagName === "B") return `**${content}**`;
    if (node.tagName === "EM" || node.tagName === "I") return `*${content}*`;
    if (node.tagName === "DEL" || node.tagName === "S" || node.tagName === "STRIKE") return `~~${content}~~`;
    if (node.tagName === "U") return `<u>${content}</u>`;
    if (node.tagName === "SPAN") {
      const font = normalizeFontToken(node.dataset.font);
      return font ? `<span data-font="${font}">${content}</span>` : content;
    }
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      return isSafeLinkUrl(href) ? `[${content}](${href})` : content;
    }
    if (node.tagName === "BR") return "\n";
    return content;
  }).join("");
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

export function editableHtmlToMarkdown(root: HTMLElement) {
  return Array.from(root.children).map((element) => {
    if (element instanceof HTMLElement && element.dataset.keeperBlock === "character-card") {
      const ref = element.dataset.ref ?? "";
      if (!/^person:[^\s]+$/.test(ref)) return "";
      const importance = element.dataset.importance;
      return `:::character-card${JSON.stringify({ ref, ...(importance ? { importance } : {}) })}`;
    }
    const heading = element.tagName.match(/^H([1-6])$/);
    const content = inlineHtmlToMarkdown(element).trim();
    if (heading) return `${"#".repeat(Number(heading[1]))} ${content}`;
    if (element.tagName === "BLOCKQUOTE") return `> ${content}`;
    if (element.tagName === "HR") return "---";
    if (element.tagName === "UL" || element.tagName === "OL") {
      return Array.from(element.children).map((item, index) => `${element.tagName === "OL" ? `${index + 1}.` : "-"} ${inlineHtmlToMarkdown(item)}`).join("\n");
    }
    if (element.tagName === "TABLE") {
      const rows = Array.from(element.querySelectorAll("tr")).map((row) =>
        Array.from(row.children).map((cell) => escapeTableCell(inlineHtmlToMarkdown(cell))),
      );
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const normalize = (row: string[]) => Array.from({ length: width }, (_, index) => row[index] ?? "");
      const [header, ...body] = rows.map(normalize);
      return [
        `| ${header.join(" | ")} |`,
        `| ${header.map(() => "---").join(" | ")} |`,
        ...body.map((row) => `| ${row.join(" | ")} |`),
      ].join("\n");
    }
    if (element.tagName === "FIGURE") {
      const image = element.querySelector("img");
      const src = image?.getAttribute("src") ?? "";
      const alt = image?.getAttribute("alt") ?? "";
      return isSafeImageUrl(src) ? `![${alt.replace(/]/g, "")}](${src})` : "";
    }
    if (element.tagName === "IMG") {
      const src = element.getAttribute("src") ?? "";
      const alt = element.getAttribute("alt") ?? "";
      return isSafeImageUrl(src) ? `![${alt.replace(/]/g, "")}](${src})` : "";
    }
    return content;
  }).filter(Boolean).join("\n\n");
}
