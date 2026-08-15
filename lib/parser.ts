"use client";

import type { Chapter, DocumentPage, Project } from "./types";

type ParsedDocument = Pick<Project, "documentText" | "pages" | "chapters" | "fileType">;

const headingPattern =
  /^(简介|守秘人须知|调查员导入|势力与组织|登场人物|主要人物|次要人物|时间轴(?:一览)?|参考资料(?:与后记)?|后记|附录|版权信息|序幕(?:\s*[·：:].*)?|终幕(?:\s*[·：:].*)?|第[一二三四五六七八九十百0-9]+[幕章节](?:\s*[·：:].*)?|[0-9]{1,2}[.、]\s*\S.{0,28})$/;

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function detectPrintedPage(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);
  const candidates = [lines[0], lines.at(-1)].filter(Boolean) as string[];
  const match = candidates
    .map((line) => line.match(/^-?\s*(\d{1,3})\s*-?$/))
    .find(Boolean);
  return match?.[1];
}

function buildChapters(pages: DocumentPage[]): Chapter[] {
  const discovered: Array<{ title: string; page: number }> = [];
  for (const page of pages) {
    const lines = page.text
      .split("\n")
      .map(cleanLine)
      .filter((line) => line.length >= 2 && line.length <= 42);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
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

  return discovered.map((item, index) => ({
    id: crypto.randomUUID(),
    title: item.title,
    startPage: item.page,
    endPage: Math.max(
      item.page,
      (discovered[index + 1]?.page ?? pages.length + 1) - 1,
    ),
    included: !/参考资料|后记|附录|版权/.test(item.title),
  }));
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
  const pages: DocumentPage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const positioned = content.items.flatMap((item) => {
      if (!("str" in item) || !item.str.trim()) return [];
      return [{
        text: item.str,
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
      }];
    }).sort((left, right) => {
      const rowDifference = right.y - left.y;
      return Math.abs(rowDifference) > 2 ? rowDifference : left.x - right.x;
    });
    const rows: Array<{ y: number; items: typeof positioned }> = [];
    positioned.forEach((item) => {
      const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
      if (row) row.items.push(item);
      else rows.push({ y: item.y, items: [item] });
    });
    const lines = rows
      .sort((left, right) => right.y - left.y)
      .map((row) => cleanLine(
        row.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(" "),
      ))
      .filter(Boolean);
    const text = lines.join("\n");
    pages.push({
      pageNumber,
      printedPage: detectPrintedPage(text),
      text,
      imageHeavy: text.length < 100,
    });
  }

  return {
    fileType: "pdf",
    pages,
    documentText: pages
      .map((page) => `[[PDF_PAGE:${page.pageNumber}]]\n${page.text}`)
      .join("\n\n"),
    chapters: buildChapters(pages),
  };
}

async function parseDocx(file: File): Promise<ParsedDocument> {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  const text = result.value.trim();
  const pages = [{ pageNumber: 1, text }];
  return {
    fileType: "docx",
    pages,
    documentText: text,
    chapters: buildChapters(pages),
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
