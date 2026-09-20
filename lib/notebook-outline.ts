import { parseMarkdown } from "./markdown.ts";

export type NotebookOutlineSection = {
  key: string;
  markdown: string;
};

export type NotebookOutlineHeading = {
  id: string;
  title: string;
  level: number;
  sectionKey: string;
  blockIndex: number;
  headingIndex: number;
  parentId?: string;
  hasChildren: boolean;
};

function headingId(sectionKey: string, blockIndex: number) {
  return `${sectionKey}:heading:${blockIndex}`;
}

function headingsForSection(section: NotebookOutlineSection) {
  let headingIndex = 0;
  return parseMarkdown(section.markdown).flatMap((block, blockIndex) => {
    if (block.kind !== "heading" || !block.text?.trim()) return [];
    const heading = {
      id: headingId(section.key, blockIndex),
      title: block.text.trim(),
      level: Math.max(1, Math.min(6, Number(block.level ?? 1))),
      sectionKey: section.key,
      blockIndex,
      headingIndex,
    };
    headingIndex += 1;
    return [heading];
  });
}

function organize(headings: Array<Omit<NotebookOutlineHeading, "parentId" | "hasChildren">>) {
  const stack: Array<(typeof headings)[number]> = [];
  const organized = headings.map((heading) => {
    while (stack.length > 0 && stack.at(-1)!.level >= heading.level) stack.pop();
    const parentId = stack.at(-1)?.id;
    stack.push(heading);
    return { ...heading, parentId, hasChildren: false };
  });
  const parentIds = new Set(organized.flatMap((heading) => heading.parentId ? [heading.parentId] : []));
  return organized.map((heading) => ({ ...heading, hasChildren: parentIds.has(heading.id) }));
}

/** Build the single H1-H6 outline shared by editor and rendered book. */
export function buildNotebookOutline(sections: NotebookOutlineSection[]): NotebookOutlineHeading[] {
  const raw: Array<Omit<NotebookOutlineHeading, "parentId" | "hasChildren">> = [];
  const firstAct = sections.find((section) => section.key.startsWith("acts:"));
  let actsRootAdded = false;

  sections.forEach((section) => {
    const sectionHeadings = headingsForSection(section);
    if (!section.key.startsWith("acts:")) {
      raw.push(...sectionHeadings);
      return;
    }

    if (!actsRootAdded && firstAct) {
      const renderedRoot = headingsForSection(firstAct).find(
        (heading) => heading.level === 1 && heading.title === "幕",
      );
      raw.push(renderedRoot ?? {
        id: `${firstAct.key}:acts-root`,
        title: "幕",
        level: 1,
        sectionKey: firstAct.key,
        blockIndex: -1,
        headingIndex: -1,
      });
      actsRootAdded = true;
    }

    sectionHeadings.forEach((heading) => {
      if (heading.level === 1 && heading.title === "幕") return;
      raw.push({ ...heading, level: Math.max(2, heading.level) });
    });
  });

  return organize(raw);
}
