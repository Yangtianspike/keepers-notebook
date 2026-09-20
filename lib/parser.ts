"use client";

import type { Chapter, DocumentPage, Project } from "./types";

type ParsedDocument = Pick<Project, "documentText" | "pages" | "chapters" | "fileType"> & {
  skippedTocPages: number[];
};

const headingPattern =
  /^(简介|守秘人须知|调查员导入|势力与组织|登场人物|主要人物|次要人物|时间轴(?:一览)?|参考资料(?:与后记)?|后记|附录|版权信息|序幕(?:\s*[·：:].*)?|终幕(?:\s*[·：:].*)?|第[一二三四五六七八九十百0-9]+[幕章节](?:\s*[·：:].*)?|[一二三四五六七八九十]+[、.]\s*\S.{0,28}|[0-9]{1,2}[.、]\s*\S.{0,28})$/;

// 页码候选：整行只由一个 1-3 位数字（可含首尾短横）构成。
const printedPagePattern = /^-?\s*(\d{1,3})\s*-?$/;
// 目录页中的编号条目，例如 "01. 档案检索"。
const numberedHeadingPattern = /^(\d{1,2})[.、]\s*\S/;
// 单页命中这么多条标题即判定为目录页；没有连续编号时需要更多命中。
const TOC_MIN_HITS = 3;
const TOC_FALLBACK_HITS = 5;
// 行内相邻片段之间至少要有这么大空隙（页面宽度比例）才被视为分栏候选。
const COLUMN_MIN_GAP_RATIO = 0.02;
// 判断两处空隙是否落在同一条分栏线上（页面宽度比例）。
const COLUMN_CLUSTER_TOLERANCE = 0.03;
// 至少这么多比例的行出现同一条空隙时，才认定该页是分栏排版。
const COLUMN_MIN_ROW_SHARE = 0.25;
// 分栏线必须落在页面这个横向区间内，避免把居中标题误判成第二栏。
const COLUMN_ZONE_MIN = 0.3;
const COLUMN_ZONE_MAX = 0.7;
// 同一行的纵向容差（PDF 单位）。
const ROW_TOLERANCE = 2;
// 在超过这个比例页面的顶部重复出现的文本视为页眉噪声。
const HEADER_NOISE_RATIO = 0.4;

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** 用于章节去重的归一化标题：忽略空白、下同间隔号与大小写差异。 */
function normalizeHeadingKey(title: string): string {
  return title
    .replace(/\s+/g, "")
    .replace(/[·・•‧∙]/g, "·")
    .toLowerCase();
}

type PositionedItem = { text: string; x: number; y: number; width: number };
type TextRow = { y: number; items: PositionedItem[] };

/** 把文本片段按纵坐标聚成行，返回自上而下的顺序。 */
function groupRows(items: PositionedItem[]): TextRow[] {
  const rows: TextRow[] = [];
  for (const item of items) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= ROW_TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows.sort((left, right) => right.y - left.y);
}

/**
 * 定位分栏线。
 * 双栏排版中每一行的左右两栏之间都存在空隙，且位置几乎相同；
 * 单栏文档的空隙位置分散，不会在多数行里重复，因此返回 undefined。
 * 相比直接扫描全局 x 分布，这种方式可以避开「栏间距比栏内字距还小」的误判。
 */
function detectColumnSplitter(rows: TextRow[], pageWidth: number): number | undefined {
  if (rows.length < 4 || pageWidth <= 0) return undefined;
  const minimumGap = pageWidth * COLUMN_MIN_GAP_RATIO;
  const tolerance = pageWidth * COLUMN_CLUSTER_TOLERANCE;
  const centers: number[] = [];
  for (const row of rows) {
    const sorted = [...row.items].sort((left, right) => left.x - right.x);
    for (let index = 1; index < sorted.length; index += 1) {
      const previousEnd = sorted[index - 1].x + sorted[index - 1].width;
      const gap = sorted[index].x - previousEnd;
      if (gap >= minimumGap) centers.push((previousEnd + sorted[index].x) / 2);
    }
  }
  if (centers.length === 0) return undefined;
  let bestCount = 0;
  let bestCenter: number | undefined;
  for (const seed of centers) {
    const members = centers.filter((value) => Math.abs(value - seed) <= tolerance);
    if (members.length > bestCount) {
      bestCount = members.length;
      bestCenter = members.reduce((sum, value) => sum + value, 0) / members.length;
    }
  }
  if (bestCenter === undefined || bestCount < rows.length * COLUMN_MIN_ROW_SHARE) {
    return undefined;
  }
  const ratio = bestCenter / pageWidth;
  if (ratio < COLUMN_ZONE_MIN || ratio > COLUMN_ZONE_MAX) return undefined;
  return bestCenter;
}

/** 把一页的文本片段还原成阅读顺序的行：先左栏自上而下，再右栏自上而下。 */
export function buildPageLines(items: PositionedItem[], pageWidth: number): string[] {
  const splitter = detectColumnSplitter(groupRows(items), pageWidth);
  const columns: PositionedItem[][] = splitter === undefined
    ? [items]
    : [
        items.filter((item) => item.x + item.width / 2 < splitter),
        items.filter((item) => item.x + item.width / 2 >= splitter),
      ];
  const lines: string[] = [];
  for (const column of columns) {
    if (column.length === 0) continue;
    for (const row of groupRows(column)) {
      const line = cleanLine(
        row.items
          .sort((left, right) => left.x - right.x)
          .map((item) => item.text)
          .join(" "),
      );
      if (line) lines.push(line);
    }
  }
  return lines;
}

/** 收集一页中符合章节标题形态的行索引。 */
function collectHeadingHitIndexes(lines: string[]): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length >= 2 && line.length <= 42 && headingPattern.test(line)) {
      indexes.push(index);
    }
  }
  return indexes;
}

/**
 * 找出该页中属于目录条目的行索引。
 *
 * 目录把全部章节标题集中排列，表现为同一页里一组编号连续递增的标题。
 * 必须按行索引而不是行文本标记：目录条目与正文标题的文字常常完全相同
 * （例如同页的「01. 档案检索」既出现在目录里，也是第一章的正文标题）。
 *
 * 另外只排除这些行、而不是整页：有些 PDF 的目录排在同一页上半部分，
 * 下半部分紧接着第一章的正文，整页跳过会连正文标题一起丢掉。
 */
export function tocLineIndexesOfPage(lines: string[]): Set<number> {
  const hits = collectHeadingHitIndexes(lines);
  if (hits.length < TOC_MIN_HITS) return new Set();
  const numbered = hits
    .map((index) => ({ index, number: Number(numberedHeadingPattern.exec(lines[index])?.[1]) }))
    .filter((item) => Number.isFinite(item.number));
  let longest: Array<{ index: number; number: number }> = [];
  let current: Array<{ index: number; number: number }> = [];
  for (const item of numbered) {
    const previous = current.at(-1);
    current = previous && item.number === previous.number + 1 ? [...current, item] : [item];
    if (current.length > longest.length) longest = current;
  }
  if (longest.length >= TOC_MIN_HITS) {
    return new Set(longest.map((item) => item.index));
  }
  // 兜底：只认行号紧邻的密集标题区。目录条目是连续排列的，而正文里的标题
  // 之间夹着内容，不能只用「命中数量」判定，否则整页正文的标题会被一起排除。
  let best: number[] = [];
  let run: number[] = [];
  for (const index of hits) {
    run = run.length > 0 && index === run[run.length - 1] + 1 ? [...run, index] : [index];
    if (run.length > best.length) best = run;
  }
  return best.length >= TOC_FALLBACK_HITS ? new Set(best) : new Set();
}

/**
 * 识别印刷页码。
 * 页码通常在页面底部，因此优先取末行；页眉中重复出现的常量文本会被排除。
 */
export function detectPrintedPage(lines: string[], headerNoise: Set<string>): string | undefined {
  const bottom = lines.at(-1);
  const top = lines[0];
  const candidates = [bottom, top].filter(
    (line): line is string => Boolean(line) && !headerNoise.has(line as string),
  );
  const match = candidates
    .map((line) => line.match(printedPagePattern))
    .find(Boolean);
  return match?.[1];
}

/** 统计在多数页面顶部重复出现的文本，用于排除页眉噪声。 */
export function collectHeaderNoise(pages: Array<{ lines: string[] }>): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const top = page.lines[0];
    if (top) counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * HEADER_NOISE_RATIO));
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([text]) => text),
  );
}

function discoveredTextHeadings(pages: DocumentPage[]) {
  const discovered: Array<{ title: string; page: number }> = [];
  for (const page of pages) {
    const lines = page.text
      .split("\n")
      .map(cleanLine)
      .filter((line) => line.length >= 2 && line.length <= 42);
    const tocLines = tocLineIndexesOfPage(lines);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (tocLines.has(index)) continue;
      if (headingPattern.test(line)) {
        const continuation = lines[index + 1];
        const shouldJoinContinuation =
          /^(序幕|终幕|第.+幕)/.test(line) &&
          line.length >= 16 &&
          continuation &&
          continuation.length <= 12 &&
          !headingPattern.test(continuation);
        const title = shouldJoinContinuation
          ? `${line}${continuation}`
          : line;
        const duplicate = discovered.some(
          (item) => item.title === title && item.page === page.pageNumber,
        );
        if (!duplicate) {
          discovered.push({ title, page: page.pageNumber });
        }
      }
    }
  }

  return discovered;
}

export function buildChapters(
  pages: DocumentPage[],
  outline: Array<{ title: string; page: number }> = [],
  options: { useTextHeadings?: boolean } = {},
): Chapter[] {
  const collected = [...outline];
  // Word 提供目录时章节清单已经是权威结果，正文正则只会带来列表项之类的误命中。
  if (options.useTextHeadings !== false) {
    discoveredTextHeadings(pages).forEach((candidate) => {
      if (!collected.some((item) => item.page === candidate.page && item.title === candidate.title)) {
        collected.push(candidate);
      }
    });
  }
  collected.sort((left, right) => left.page - right.page);

  // 目录页已经被排除，这里再按归一化标题合并重复出现的标题（例如页眉重复），
  // 同名章节只保留页码最小的一次。
  const unique = new Map<string, { title: string; page: number }>();
  for (const item of collected) {
    const key = normalizeHeadingKey(item.title);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, item);
      continue;
    }
    if (item.page < existing.page) unique.set(key, item);
  }
  const discovered = [...unique.values()].sort((left, right) => left.page - right.page);

  if (discovered.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        title: "全文",
        startPage: 1,
        endPage: pages.length || 1,
        included: true,
      },
    ];
  }

  const chapters = discovered.map((item, index) => ({
    id: crypto.randomUUID(),
    title: item.title,
    startPage: item.page,
    endPage: Math.max(
      item.page,
      (discovered[index + 1]?.page ?? pages.length + 1) - 1,
    ),
    included: !/参考资料|后记|附录|版权/.test(item.title),
  }));

  // 第一个标题之前的内容（封面、故事背景、导入、展示材料等）不属于任何章节，
  // 而分析文本是按章节页范围收集的，不补齐就永远不会被送进分析。
  if (chapters[0] && chapters[0].startPage > 1) {
    chapters.unshift({
      id: crypto.randomUUID(),
      title: "开篇",
      startPage: 1,
      endPage: chapters[0].startPage - 1,
      included: true,
    });
  }

  return chapters;
}

async function parsePdf(file: File): Promise<ParsedDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc =
    typeof window === "undefined"
      ? new URL(
          "../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).href
      : "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const outlineEntries: Array<{ title: string; page: number }> = [];

  const outline = await document.getOutline();
  const visitOutline = async (items: NonNullable<typeof outline>) => {
    for (const item of items) {
      try {
        const destination = typeof item.dest === "string"
          ? await document.getDestination(item.dest)
          : item.dest;
        const reference = destination?.[0];
        if (reference) {
          const page = typeof reference === "number"
            ? reference + 1
            : await document.getPageIndex(reference) + 1;
          const title = cleanLine(item.title);
          if (title && !outlineEntries.some((entry) => entry.title === title && entry.page === page)) {
            outlineEntries.push({ title, page });
          }
        }
      } catch {
        // Broken destinations are common in edited PDFs; keep reading siblings.
      }
      if (item.items.length > 0) await visitOutline(item.items);
    }
  };
  if (outline) await visitOutline(outline);

  const rawPages: Array<{ pageNumber: number; lines: string[] }> = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageWidth = page.getViewport({ scale: 1 }).width;
    const positioned = content.items.flatMap((item) => {
      if (!("str" in item) || !item.str.trim()) return [];
      return [{
        text: item.str,
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: "width" in item ? Number(item.width) || 0 : 0,
      }];
    });
    rawPages.push({
      pageNumber,
      lines: buildPageLines(positioned, pageWidth),
    });
  }

  const headerNoise = collectHeaderNoise(rawPages);
  // 含有目录条目的页。仅用于在界面上说明，页面上的正文内容仍然保留。
  const tocPages = new Set(
    rawPages
      .filter((page) => {
        const lines = page.lines.filter((line) => line.length >= 2 && line.length <= 42);
        return tocLineIndexesOfPage(lines).size >= TOC_MIN_HITS;
      })
      .map((page) => page.pageNumber),
  );

  const pages: DocumentPage[] = rawPages.map((page) => {
    const text = page.lines.join("\n");
    return {
      pageNumber: page.pageNumber,
      printedPage: detectPrintedPage(page.lines, headerNoise),
      text,
      imageHeavy: text.length < 100,
    };
  });

  return {
    fileType: "pdf",
    pages,
    skippedTocPages: [...tocPages].sort((left, right) => left - right),
    documentText: pages
      .map((page) => `[[PDF_PAGE:${page.pageNumber}]]\n${page.text}`)
      .join("\n\n"),
    chapters: buildChapters(pages, outlineEntries),
  };
}

// Word 模组的章节标题多为手动排版（改字号加粗），没有使用 Word 的「标题」样式，
// 因此 convertToHtml 取不到 h1-h4。这类文档普遍带一个「章节名…………页码」的目录页，
// 用它反推章节清单比正文正则可靠得多。
const DOCX_TOC_ENTRY = /^(.{2,40}?)[\s·.．…‥⋯]{3,}\s*(\d{1,3})$/;
const DOCX_TOC_MIN_ENTRIES = 3;

type DocxTocEntry = { title: string; printedPage: number };
type DocxSection = { title: string; index: number; printedPage: number };

/** 找出连续成段的目录条目，返回条目清单与目录段结束位置。 */
function findDocxTocBlock(
  lines: string[],
): { entries: DocxTocEntry[]; end: number } | undefined {
  let bestStart = -1;
  let bestEnd = -1;
  let start = -1;
  for (let index = 0; index <= lines.length; index += 1) {
    const isEntry = index < lines.length && DOCX_TOC_ENTRY.test(lines[index]);
    if (isEntry) {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0) {
      if (index - start > bestEnd - bestStart) {
        bestStart = start;
        bestEnd = index;
      }
      start = -1;
    }
  }
  if (bestStart < 0 || bestEnd - bestStart < DOCX_TOC_MIN_ENTRIES) return undefined;
  const entries = lines
    .slice(bestStart, bestEnd)
    .map((line) => {
      const match = line.match(DOCX_TOC_ENTRY)!;
      return {
        title: match[1].replace(/[\s·.．…‥⋯]+$/, "").trim(),
        printedPage: Number(match[2]),
      };
    })
    .filter((entry) => entry.title.length >= 2);
  if (entries.length < DOCX_TOC_MIN_ENTRIES) return undefined;
  return { entries, end: bestEnd };
}

/**
 * 判断正文某行是否是目录条目的标题行。
 * 除完全一致外，还接受「附录：报纸合集」这类带极短限定前缀的写法。
 * 前缀必须以冒号结尾且不超过 6 个字符，否则「最终结局」会误匹配目录里的「结局」。
 */
function matchesDocxHeading(line: string, title: string) {
  if (line === title) return true;
  if (title.length < 2 || !line.endsWith(title)) return false;
  const prefix = line.slice(0, line.length - title.length);
  return prefix.length > 0 && prefix.length <= 6 && /[：:]\s*$/.test(prefix);
}

/** 在目录之后的正文中定位每个目录条目的标题行。 */
function locateDocxSections(
  lines: string[],
  entries: DocxTocEntry[],
  searchFrom: number,
): DocxSection[] {
  const sections: DocxSection[] = [];
  const claimed = new Set<number>();
  for (const entry of entries) {
    for (let index = searchFrom; index < lines.length; index += 1) {
      if (!claimed.has(index) && matchesDocxHeading(lines[index], entry.title)) {
        claimed.add(index);
        sections.push({ title: entry.title, index, printedPage: entry.printedPage });
        break;
      }
    }
  }
  return sections.sort((left, right) => left.index - right.index);
}

/**
 * 按章节把 Word 文本切成「节」，每节一页，页码即节号。
 * 第一节之前的内容（目录、版权声明等）单独成一页，由 buildChapters 补成「开篇」。
 * 找不到目录时回退成单页，交给正文正则处理，行为与改造前一致。
 */
export function buildDocxStructure(lines: string[]) {
  const toc = findDocxTocBlock(lines);
  const sections = toc ? locateDocxSections(lines, toc.entries, toc.end) : [];
  if (sections.length === 0) {
    return {
      pages: [{ pageNumber: 1, text: lines.join("\n") }] as DocumentPage[],
      outline: [] as Array<{ title: string; page: number }>,
      hasSections: false,
    };
  }

  const pages: DocumentPage[] = [];
  const outline: Array<{ title: string; page: number }> = [];
  const pushPage = (body: string, printedPage?: string) => {
    const text = body.trim();
    if (!text) return pages.length;
    pages.push({ pageNumber: pages.length + 1, printedPage, text });
    return pages.length;
  };

  if (sections[0].index > 0) {
    pushPage(lines.slice(0, sections[0].index).join("\n"));
  }
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const end = sections[index + 1]?.index ?? lines.length;
    const pageNumber = pages.length + 1;
    const text = lines.slice(section.index, end).join("\n").trim();
    if (!text) continue;
    pages.push({ pageNumber, printedPage: String(section.printedPage), text });
    outline.push({ title: section.title, page: pageNumber });
  }

  return { pages, outline, hasSections: true };
}

async function parseDocx(file: File): Promise<ParsedDocument> {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  const lines = result.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const { pages, outline, hasSections } = buildDocxStructure(lines);
  return {
    fileType: "docx",
    pages,
    skippedTocPages: [],
    documentText: pages
      .map((page) => `[[PDF_PAGE:${page.pageNumber}]]\n${page.text}`)
      .join("\n\n"),
    chapters: buildChapters(pages, outline, { useTextHeadings: !hasSections }),
  };
}

async function parseMarkdown(file: File): Promise<ParsedDocument> {
  const text = await file.text();
  const lines = text.split("\n");
  const headingPages: DocumentPage[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line) && current.length > 0) {
      headingPages.push({
        pageNumber: headingPages.length + 1,
        text: current.join("\n"),
      });
      current = [];
    }
    current.push(line.replace(/^#{1,4}\s+/, ""));
  }
  if (current.length) {
    headingPages.push({
      pageNumber: headingPages.length + 1,
      text: current.join("\n"),
    });
  }
  const pages = headingPages.length
    ? headingPages
    : [{ pageNumber: 1, text }];
  return {
    fileType: "markdown",
    pages,
    skippedTocPages: [],
    documentText: text,
    chapters: buildChapters(pages),
  };
}

export async function parseScenarioFile(file: File): Promise<ParsedDocument> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return parsePdf(file);
  if (extension === "docx") return parseDocx(file);
  if (extension === "md" || extension === "markdown") return parseMarkdown(file);
  throw new Error("目前仅支持 PDF、DOCX 和 Markdown 文件。");
}
