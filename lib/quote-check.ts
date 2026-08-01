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

function bigrams(value: string) {
  if (value.length < 2) return [value];
  return Array.from({ length: value.length - 1 }, (_, index) =>
    value.slice(index, index + 2),
  );
}

function diceSimilarity(left: string, right: string) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const counts = new Map<string, number>();
  bigrams(left).forEach((gram) =>
    counts.set(gram, (counts.get(gram) ?? 0) + 1),
  );
  let matches = 0;
  const rightGrams = bigrams(right);
  rightGrams.forEach((gram) => {
    const remaining = counts.get(gram) ?? 0;
    if (!remaining) return;
    matches += 1;
    counts.set(gram, remaining - 1);
  });
  return (2 * matches) / (bigrams(left).length + rightGrams.length);
}

function fuzzyIncludes(text: string, quote: string, threshold = 0.85) {
  if (text.includes(quote)) return true;
  const minimumLength = Math.max(1, Math.floor(quote.length * 0.85));
  const maximumLength = Math.min(text.length, Math.ceil(quote.length * 1.15));
  for (let size = minimumLength; size <= maximumLength; size += 1) {
    for (let start = 0; start + size <= text.length; start += 1) {
      if (diceSimilarity(quote, text.slice(start, start + size)) >= threshold)
        return true;
    }
  }
  return false;
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
    return local.includes(quote) || fuzzyIncludes(all, quote)
      ? []
      : [{ path, quote: source.quote, page: source.page }];
  });
}

export function flagUnverifiedSourceRefs(
  data: unknown,
  issues: QuoteIssue[],
): void {
  const unmatched = new Set(
    issues.map((issue) => `${issue.page}\u0000${issue.quote}`),
  );
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.sources)) {
      record.sources.forEach((candidate) => {
        if (!candidate || typeof candidate !== "object") return;
        const source = candidate as SourceRef;
        if (unmatched.has(`${source.page}\u0000${source.quote}`)) {
          source.verified = false;
        }
      });
    }
    Object.entries(record)
      .filter(([key]) => key !== "sources")
      .forEach(([, child]) => visit(child));
  };
  visit(data);
}
