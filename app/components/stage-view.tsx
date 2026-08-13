"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { KPNoteBlock } from "@/lib/types";

const MOBILE_BREAKPOINT = 760;
const TURN_DURATION = 800;
const BOOK_WIDTH = 1750;
const BOOK_HEIGHT = 1200;
const PAGE_WIDTH = 680;
const PAGE_HEIGHT = 1150;

type TurnCommand =
  | "display"
  | "next"
  | "page"
  | "pages"
  | "previous"
  | "size"
  | "stop";

type TurnCollection = {
  data: () => {
    pages?: Record<number, TurnCollection>;
  };
  flip: (command: "hideFoldedPage", immediate?: boolean) => TurnCollection;
  off: (event?: string) => TurnCollection;
  on: (
    event: string,
    handler: (event: Event, page: number) => void,
  ) => TurnCollection;
  turn: (commandOrOptions: TurnCommand | Record<string, unknown>, ...args: unknown[]) => unknown;
};

type JQueryFactory = (element: HTMLElement | Document) => TurnCollection;

type TurnBookPagesProps = {
  className: string;
  flipbookRef: RefObject<HTMLDivElement | null>;
  pages: ReactNode[];
};

export const TurnBookPages = memo(function TurnBookPages({
  className,
  flipbookRef,
  pages,
}: TurnBookPagesProps) {
  return (
    <div className={className} ref={flipbookRef}>
      {pages.map((page, index) => (
        <div className="book-page" key={index}>
          {page}
        </div>
      ))}
    </div>
  );
}, (previous, next) => (
  previous.className === next.className &&
  previous.flipbookRef === next.flipbookRef &&
  previous.pages === next.pages
));

declare global {
  interface Window {
    jQuery?: JQueryFactory & { fn?: { turn?: unknown } };
    $?: JQueryFactory;
  }
}

export type PageSliceResult = {
  pages: ReactNode[];
  pageBreaks: number[];
};

type BlockMeasurement = {
  height: number;
  protectedRanges: Array<{ top: number; bottom: number; splittable: boolean }>;
};

type ElementWithChildren = ReactElement<{ children?: ReactNode }>;

function contentBlocks(content: ReactNode) {
  if (isValidElement<{ children?: ReactNode }>(content)) {
    return {
      root: content,
      blocks: Children.toArray(content.props.children),
    };
  }
  return { root: null, blocks: Children.toArray(content) };
}

export function measureAndSlice(
  content: ReactNode,
  pageHeight: number,
  pageWidth: number,
  measuredHeights: Array<number | BlockMeasurement> = [],
): PageSliceResult {
  void pageWidth;
  const { root, blocks } = contentBlocks(content);
  if (blocks.length === 0) return { pages: [content], pageBreaks: [0] };

  const pageBreaks: number[] = [];
  const pageGroups: ReactNode[][] = [];
  let currentBlocks: ReactNode[] = [];
  let accumulatedHeight = 0;
  let currentStart = 0;

  const finishPage = () => {
    if (currentBlocks.length === 0) return;
    pageBreaks.push(currentStart);
    pageGroups.push(currentBlocks);
    currentBlocks = [];
    accumulatedHeight = 0;
  };

  const stageKeyFor = (block: ReactNode) =>
    isValidElement(block)
      ? (block.props as { "data-stage-key"?: string })["data-stage-key"]
      : undefined;

  blocks.forEach((block, index) => {
    const measurement = measuredHeights[index] ?? pageHeight;
    const blockHeight = typeof measurement === "number"
      ? measurement
      : measurement.height;
    const protectedRanges = typeof measurement === "number"
      ? []
      : measurement.protectedRanges;
    const blockStageKey = stageKeyFor(block);
    const previousStageKey = stageKeyFor(currentBlocks[0]);

    if (
      currentBlocks.length > 0 &&
      blockStageKey &&
      previousStageKey &&
      blockStageKey !== previousStageKey
    ) {
      finishPage();
      currentStart = index;
    }

    if (blockHeight > pageHeight) {
      finishPage();
      let offset = 0;
      let sliceIndex = 0;
      while (offset < blockHeight) {
        const naturalEnd = Math.min(blockHeight, offset + pageHeight);
        const crossingRange = protectedRanges.find(
          (range) => range.top > offset && range.top < naturalEnd && range.bottom > naturalEnd,
        );
        const containingRange = protectedRanges.find(
          (range) => range.top <= offset && range.bottom > naturalEnd,
        );
        const sliceEnd = crossingRange && crossingRange.top - offset >= 80
          ? crossingRange.top
          : containingRange && !containingRange.splittable
            ? containingRange.bottom
            : naturalEnd;
        const sliceHeight = sliceEnd - offset;
        pageBreaks.push(index);
        pageGroups.push([
          <div
            className="book-block-slice"
            data-stage-key={blockStageKey}
            key={`${index}-${sliceIndex}`}
            style={{ height: sliceHeight }}
          >
            <div style={{ transform: `translateY(-${offset}px)` }}>{block}</div>
          </div>,
        ]);
        offset = sliceEnd;
        sliceIndex += 1;
      }
      currentStart = index + 1;
      return;
    }

    if (
      currentBlocks.length > 0 &&
      accumulatedHeight + blockHeight > pageHeight
    ) {
      finishPage();
      currentStart = index;
    }
    currentBlocks.push(block);
    accumulatedHeight += blockHeight;
  });
  finishPage();

  const pages = pageGroups.map((pageBlocks, pageIndex) => {
    const stageKey = pageBlocks.reduce<string | undefined>((found, block) => {
      if (found || !isValidElement(block)) return found;
      return String(
        (block.props as { "data-stage-key"?: string })["data-stage-key"] ?? "",
      ) || undefined;
    }, undefined);
    const sliced = root
      ? cloneElement(root as ElementWithChildren, { key: pageIndex }, pageBlocks)
      : pageBlocks;
    return (
      <div className="book-page-inner" data-stage-key={stageKey} key={pageIndex}>
        {sliced}
      </div>
    );
  });

  return { pages, pageBreaks };
}

let scriptPromise: Promise<void> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.src = src;
    script.async = false;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`无法加载 ${src}`)), {
      once: true,
    });
    if (!existing) document.head.appendChild(script);
  });
}

function loadTurnJs() {
  if (window.jQuery?.fn?.turn) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = (async () => {
      if (!window.jQuery) await loadScript("/jquery-3.7.1.min.js");
      await loadScript("/turn.min.js");
      if (!window.jQuery?.fn?.turn) throw new Error("turn.js 初始化失败");
    })();
  }
  return scriptPromise;
}

type TurnBookOptions = {
  contentKey?: unknown;
  enabled?: boolean;
  onBoundaryPrev?: () => void;
  onBoundaryNext?: () => void;
  onPageChange?: (page: number) => void;
};

export function useTurnBook(content: ReactNode, options: TurnBookOptions = {}) {
  const flipbookRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<TurnCollection | null>(null);
  const lifecycleRef = useRef<"idle" | "initializing" | "ready" | "turning" | "destroying">("idle");
  const generationRef = useRef(0);
  const pendingPageRef = useRef<number | null>(null);
  const pageChangeRef = useRef(options.onPageChange);
  const [pages, setPages] = useState<ReactNode[]>([]);
  const [bookRevision, setBookRevision] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [resizeVersion, setResizeVersion] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const totalPages = pages.length;
  const enabled = options.enabled ?? true;

  useEffect(() => {
    pageChangeRef.current = options.onPageChange;
  }, [options.onPageChange]);

  const destroyTurnBook = useCallback(() => {
    generationRef.current += 1;
    lifecycleRef.current = "destroying";
    pendingPageRef.current = null;
    const book = turnRef.current;
    turnRef.current = null;
    if (!book) {
      lifecycleRef.current = "idle";
      return;
    }
    book.off(".keeperAtlas");
    const pluginPages = book.data().pages ?? {};
    Object.values(pluginPages).forEach((page) => {
      try {
        page.flip("hideFoldedPage", false);
      } catch {
        // The page may already have been detached by a completed turn.
      }
    });
    try {
      book.turn("stop");
    } catch {
      // A stale folding frame may already have detached its page wrapper.
    }
    book.off(".turn");
    window.jQuery?.(document).off(".turn");
    lifecycleRef.current = "idle";
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return;
    return () => destroyTurnBook();
  }, [destroyTurnBook, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const resize = () => setResizeVersion((version) => version + 1);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [enabled]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const measure = measureRef.current;
    if (!measure) return;
    measure.style.width = `${PAGE_WIDTH}px`;
    measure.style.height = `${PAGE_HEIGHT}px`;
    measure.style.padding = "0";
    measure.style.overflow = "hidden";
    const root = measure.firstElementChild;
    const nodes = root ? Array.from(root.children) : Array.from(measure.children);
    const heights = nodes.map((node): BlockMeasurement => {
      const element = node as HTMLElement;
      const styles = window.getComputedStyle(element);
      const height = element.offsetHeight +
        Number.parseFloat(styles.marginTop || "0") +
        Number.parseFloat(styles.marginBottom || "0");
      const rootRect = element.getBoundingClientRect();
      const protectedElements = Array.from(element.querySelectorAll<HTMLElement>(
        ".stage-inset-card, .act-person-card, .act-clue-card, .act-event-list article, .act-branch-list button",
      ));
      const headings = Array.from(element.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
      const protectedRanges = protectedElements.map((protectedElement) => {
        const rect = protectedElement.getBoundingClientRect();
        let top = rect.top - rootRect.top;
        const precedingHeading = headings
          .filter((heading) => heading.getBoundingClientRect().bottom <= rect.top)
          .at(-1);
        if (precedingHeading) {
          const headingRect = precedingHeading.getBoundingClientRect();
          if (rect.top - headingRect.bottom < 80) {
            top = headingRect.top - rootRect.top;
          }
        }
        return {
          top: Math.max(0, top),
          bottom: Math.min(height, rect.bottom - rootRect.top),
          splittable: rect.height > PAGE_HEIGHT,
        };
      });
      return { height, protectedRanges };
    });
    const result = measureAndSlice(content, PAGE_HEIGHT, PAGE_WIDTH, heights);
    destroyTurnBook();
    setPages(result.pages);
    setBookRevision((revision) => revision + 1);
    setCurrentPage(1);
    // contentKey is the explicit invalidation signal. Depending on `content`
    // itself would loop because callers construct a fresh ReactNode per render,
    // while this effect updates pagination state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destroyTurnBook, enabled, options.contentKey, resizeVersion]);

  useEffect(() => {
    if (!enabled) return;
    const element = flipbookRef.current;
    if (!element || pages.length === 0) return;
    let disposed = false;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    lifecycleRef.current = "initializing";
    void loadTurnJs().then(() => {
      if (
        disposed ||
        generation !== generationRef.current ||
        flipbookRef.current !== element ||
        !window.jQuery
      ) {
        return;
      }
      const containerWidth = element.parentElement?.clientWidth ?? BOOK_WIDTH;
      const scale = Math.min(1, containerWidth / BOOK_WIDTH);
      const width = BOOK_WIDTH * scale;
      const height = BOOK_HEIGHT * scale;
      const display = window.innerWidth <= MOBILE_BREAKPOINT ? "single" : "double";
      const book = window.jQuery(element);
      book.turn({
        width,
        height,
        autoCenter: false,
        gradients: true,
        elevation: 50,
        acceleration: true,
        duration: TURN_DURATION,
        display,
        page: 1,
      });
      turnRef.current = book;
      lifecycleRef.current = "ready";
      setCurrentPage(1);
      setIsAnimating(false);
      book.on("turning.keeperAtlas", () => {
        if (generation !== generationRef.current) return;
        lifecycleRef.current = "turning";
        setIsAnimating(true);
      });
      book.on("turned.keeperAtlas", (_event, page) => {
        if (generation !== generationRef.current) return;
        setCurrentPage(page);
        pageChangeRef.current?.(page);
        setIsAnimating(false);
        lifecycleRef.current = "ready";
        const pendingPage = pendingPageRef.current;
        pendingPageRef.current = null;
        if (pendingPage && pendingPage !== page) {
          window.requestAnimationFrame(() => {
            if (
              generation === generationRef.current &&
              lifecycleRef.current === "ready" &&
              turnRef.current === book
            ) {
              book.turn("page", pendingPage);
            }
          });
        }
      });
      const pendingPage = pendingPageRef.current;
      pendingPageRef.current = null;
      if (pendingPage && pendingPage !== 1) {
        window.requestAnimationFrame(() => {
          if (
            generation === generationRef.current &&
            lifecycleRef.current === "ready" &&
            turnRef.current === book
          ) {
            book.turn("page", pendingPage);
          }
        });
      }
    }).catch((error: unknown) => console.error(error));

    return () => {
      disposed = true;
      destroyTurnBook();
    };
  }, [destroyTurnBook, enabled, pages]);

  const requestPage = useCallback((page: number) => {
    const book = turnRef.current;
    if (!book || lifecycleRef.current !== "ready") {
      pendingPageRef.current = page;
      return;
    }
    book.turn("page", page);
  }, []);

  const previousPage = useCallback(() => {
    if (isAnimating) return;
    if (currentPage <= 1) {
      options.onBoundaryPrev?.();
      return;
    }
    requestPage(currentPage - 1);
  }, [currentPage, isAnimating, options, requestPage]);

  const nextPage = useCallback(() => {
    if (isAnimating) return;
    if (currentPage >= totalPages) {
      options.onBoundaryNext?.();
      return;
    }
    requestPage(currentPage + 1);
  }, [currentPage, isAnimating, options, requestPage, totalPages]);

  return {
    flipbookRef,
    measureRef,
    requestPage,
    pages,
    bookRevision,
    currentPage,
    totalPages,
    previousPage,
    nextPage,
    hasPrevious: currentPage > 1,
    hasNext: currentPage < totalPages,
    isAnimating,
    displayCurrentPage: currentPage,
    displayTotalPages: totalPages,
  };
}

export type StageBookSection = {
  key: string;
  name: string;
  content: ReactNode;
};

function sectionNavigationKey(sectionKey: string) {
  return sectionKey.startsWith("acts:") ? "acts" : sectionKey;
}

export function StageView({
  sections,
  activeSectionKey,
  contentKey,
  onActiveSectionChange,
  editing = false,
  onEditingChange,
  onPageChange,
  notes = {},
  initialPage,
}: {
  sections: StageBookSection[];
  activeSectionKey: string;
  contentKey?: unknown;
  onActiveSectionChange: (sectionKey: string) => void;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onPageChange?: (sectionKey: string, page: number) => void;
  notes?: Record<string, KPNoteBlock[]>;
  initialPage?: number;
}) {
  const activeSectionChangeRef = useRef(onActiveSectionChange);
  const pageSectionsRef = useRef<string[]>([]);
  useEffect(() => {
    activeSectionChangeRef.current = onActiveSectionChange;
  }, [onActiveSectionChange]);
  const content = (
    <div className="stage-book-document">
      {sections.map((section, index) => (
        <section
          className="stage-document stage-book-section"
          data-stage-key={section.key}
          key={section.key}
        >
          <header className="stage-page-heading">
            <small>{String(index + 1).padStart(2, "0")} / {sections.length}</small>
            <strong>{section.name}</strong>
          </header>
          {section.content}
          {(notes[section.key] ?? []).map((note) => (
            <aside className="kp-note-read" key={note.id}>
              <strong>{note.title}</strong>
              <p>{note.body}</p>
            </aside>
          ))}
        </section>
      ))}
    </div>
  );
  const {
    flipbookRef,
    measureRef,
    requestPage,
    pages,
    bookRevision,
    currentPage,
    previousPage,
    nextPage,
    hasPrevious,
    hasNext,
    displayCurrentPage,
    displayTotalPages,
  } = useTurnBook(content, {
    contentKey,
    enabled: !editing,
    onPageChange: (page) => {
      const sectionKey = pageSectionsRef.current[Math.max(0, page - 1)];
      if (sectionKey) onPageChange?.(sectionKey, page);
    },
  });
  const pageSections = pages.map((page) => {
    if (!isValidElement(page)) return "";
    return String(
      (page.props as { "data-stage-key"?: string })["data-stage-key"] ?? "",
    );
  });
  const pageSectionsKey = pageSections.join("|");
  useEffect(() => {
    pageSectionsRef.current = pageSections;
    // pageSectionsKey is the stable representation of the generated page map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSectionsKey]);
  const lastRequestedSectionRef = useRef("");
  const restoredPageRef = useRef(false);
  const pageNavigationSections = pageSections.map(sectionNavigationKey);

  const activeSectionIndex = sections.findIndex(
    (section) =>
      section.key === activeSectionKey ||
      sectionNavigationKey(section.key) === activeSectionKey,
  );
  const exactTargetPage = pageSections.indexOf(activeSectionKey);
  const targetPageIndex = (
    exactTargetPage >= 0
      ? exactTargetPage
      : pageNavigationSections.indexOf(activeSectionKey)
  );
  const targetPage = targetPageIndex >= 0 ? targetPageIndex + 1 : 0;

  useEffect(() => {
    if (
      lastRequestedSectionRef.current === activeSectionKey ||
      targetPage < 1
    ) {
      return;
    }
    lastRequestedSectionRef.current = activeSectionKey;
    requestPage(targetPage);
  }, [activeSectionKey, requestPage, targetPage]);

  useEffect(() => {
    if (restoredPageRef.current || !initialPage || pages.length === 0) return;
    restoredPageRef.current = true;
    requestPage(Math.min(initialPage, pages.length));
  }, [initialPage, pages.length, requestPage]);

  useEffect(() => {
    const pageSection = pageNavigationSections[Math.max(0, currentPage - 1)];
    const exactPageSection = pageSections[Math.max(0, currentPage - 1)];
    if (pageSection && exactPageSection !== activeSectionKey) {
      lastRequestedSectionRef.current = exactPageSection;
      activeSectionChangeRef.current(exactPageSection);
    }
    // pageSectionsKey is the stable representation of the generated page map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionKey, currentPage, pageSectionsKey]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "ArrowLeft") previousPage();
      if (event.key === "ArrowRight") nextPage();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [nextPage, previousPage]);

  return (
    <div className="book-reader">
      {onEditingChange && (
        <div className="book-edit-toggle">
          <button
            className={editing ? "active" : ""}
            type="button"
            onClick={() => {
              if (editing && document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              onEditingChange(!editing);
            }}
          >
            {editing ? "完成编辑" : "编辑书页"}
          </button>
          {editing && <span>点击虚线文字进行修改，失焦保存，Esc 取消。</span>}
        </div>
      )}
      {!editing && <div className="book-measure" ref={measureRef}>{content}</div>}
      {!editing && (
        <TurnBookPages
          key={bookRevision}
          className="stage-view flipbook"
          flipbookRef={flipbookRef}
          pages={pages}
        />
      )}
      {!editing && <nav className="stage-pagination" aria-label="书页翻页">
        <button
          type="button"
          onClick={previousPage}
          disabled={!hasPrevious && activeSectionIndex === 0}
        >
          ← 上一页
        </button>
        <span className="stage-page-number">
          {displayCurrentPage} / {displayTotalPages}
        </span>
        <button
          type="button"
          onClick={nextPage}
          disabled={!hasNext && activeSectionIndex === sections.length - 1}
        >
          下一页 →
        </button>
      </nav>}
    </div>
  );
}
