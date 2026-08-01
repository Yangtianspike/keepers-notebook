import type { DocumentPage, SourceRef } from "./types";

export type QuoteIssue = { path: string; quote: string; page: number };

export function normalizeQuote(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    );
}

function similarity(left: string, right: string) {
  if (!left || !right) return 0;
  let matching = 0;
  for (const char of left) if (right.includes(char)) matching += 1;
  return matching / left.length;
}

function walk(
  value: unknown,
  path = "$",
): Array<{ path: string; source: SourceRef }> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value))
    return value.flatMap((item, index) => walk(item, `${path}[${index}]`));
  const record = value as Record<string, unknown>;
  const own = Array.isArray(record.sources)
    ? record.sources
        .filter((source): source is SourceRef =>
          Boolean(
            source &&
            typeof source === "object" &&
            "quote" in source &&
            "page" in source,
          ),
        )
        .map((source) => ({ path, source }))
    : [];
  return [
    ...own,
    ...Object.entries(record)
      .filter(([key]) => key !== "sources")
      .flatMap(([key, child]) => walk(child, `${path}.${key}`)),
  ];
}

export function verifySourceRefs(
  data: unknown,
  pages: DocumentPage[],
): QuoteIssue[] {
  return walk(data).flatMap(({ path, source }) => {
    const quote = normalizeQuote(source.quote ?? "");
    if (!quote) return [];
    const local = pages
      .filter((page) => Math.abs(page.pageNumber - source.page) <= 1)
      .map((page) => normalizeQuote(page.text))
      .join("");
    const all = pages.map((page) => normalizeQuote(page.text)).join("");
    return local.includes(quote) || similarity(quote, all) >= 0.85
      ? []
      : [{ path, quote: source.quote, page: source.page }];
  });
}
