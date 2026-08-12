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

const MOBILE_BREAKPOINT = 760;
const TURN_DURATION = 800;
const BOOK_WIDTH = 1750;
const BOOK_HEIGHT = 1200;
const PAGE_WIDTH = 680;
const PAGE_HEIGHT = 1150;

type TurnCommand =
  | "destroy"
  | "display"
  | "next"
  | "page"
  | "pages"
  | "previous"
  | "size";

type TurnCollection = {
  off: (event?: string) => TurnCollection;
  on: (
    event: string,
    handler: (event: Event, page: number) => void,
  ) => TurnCollection;
  turn: (commandOrOptions: TurnCommand | Record<string, unknown>, ...args: unknown[]) => unknown;
};

type JQueryFactory = (element: HTMLElement) => TurnCollection;

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
  measuredHeights: number[] = [],
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
    const blockHeight = measuredHeights[index] ?? pageHeight;
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
      const sliceCount = Math.ceil(blockHeight / pageHeight);
      for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
        const offset = sliceIndex * pageHeight;
        const sliceHeight = Math.min(pageHeight, blockHeight - offset);
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
};

export function useTurnBook(content: ReactNode, options: TurnBookOptions = {}) {
  const flipbookRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<TurnCollection | null>(null);
  const [pages, setPages] = useState<ReactNode[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [resizeVersion, setResizeVersion] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const totalPages = pages.length;
  const enabled = options.enabled ?? true;

  const destroyTurnBook = useCallback(() => {
    const book = turnRef.current;
    turnRef.current = null;
    if (!book) return;
    book.off(".keeperAtlas");
    try {
      book.turn("destroy");
    } catch {
      // The plugin may already have removed its generated wrappers.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const resize = () => setResizeVersion((version) => version + 1);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const measure = measureRef.current;
    if (!measure || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setResizeVersion((version) => version + 1);
      });
    });
    observer.observe(measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
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
    const heights = nodes.map((node) => {
      const element = node as HTMLElement;
      const styles = window.getComputedStyle(element);
      return element.offsetHeight +
        Number.parseFloat(styles.marginTop || "0") +
        Number.parseFloat(styles.marginBottom || "0");
    });
    const result = measureAndSlice(content, PAGE_HEIGHT, PAGE_WIDTH, heights);
    destroyTurnBook();
    setPages(result.pages);
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
    void loadTurnJs().then(() => {
      if (disposed || !flipbookRef.current || !window.jQuery) return;
      const containerWidth = element.parentElement?.clientWidth ?? BOOK_WIDTH;
      const scale = Math.min(1, containerWidth / BOOK_WIDTH);
      const width = BOOK_WIDTH * scale;
      const height = BOOK_HEIGHT * scale;
      const display = window.innerWidth <= MOBILE_BREAKPOINT ? "single" : "double";
      const book = window.jQuery(element);
      turnRef.current = book;
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
      book.on("turning.keeperAtlas", () => setIsAnimating(true));
      book.on("turned.keeperAtlas", (_event, page) => {
        setCurrentPage(page);
        setIsAnimating(false);
      });
    }).catch((error: unknown) => console.error(error));

    return () => {
      disposed = true;
      destroyTurnBook();
    };
  }, [destroyTurnBook, enabled, pages]);

  useEffect(() => {
    if (!enabled) return;
    const book = turnRef.current;
    if (!book) return;
    const containerWidth =
      flipbookRef.current?.parentElement?.clientWidth ?? BOOK_WIDTH;
    const scale = Math.min(1, containerWidth / BOOK_WIDTH);
    const width = BOOK_WIDTH * scale;
    const height = BOOK_HEIGHT * scale;
    const display = window.innerWidth <= MOBILE_BREAKPOINT ? "single" : "double";
    book.turn("size", width, height);
    book.turn("display", display);
    book.turn("page", 1);
    setCurrentPage(1);
  }, [enabled, resizeVersion]);

  const previousPage = useCallback(() => {
    if (isAnimating) return;
    if (currentPage <= 1) {
      options.onBoundaryPrev?.();
      return;
    }
    turnRef.current?.turn("previous");
  }, [currentPage, isAnimating, options]);

  const nextPage = useCallback(() => {
    if (isAnimating) return;
    if (currentPage >= totalPages) {
      options.onBoundaryNext?.();
      return;
    }
    turnRef.current?.turn("next");
  }, [currentPage, isAnimating, options, totalPages]);

  return {
    flipbookRef,
    measureRef,
    turnRef,
    pages,
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
}: {
  sections: StageBookSection[];
  activeSectionKey: string;
  contentKey?: unknown;
  onActiveSectionChange: (sectionKey: string) => void;
}) {
  const activeSectionChangeRef = useRef(onActiveSectionChange);
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
        </section>
      ))}
    </div>
  );
  const {
    flipbookRef,
    measureRef,
    turnRef,
    pages,
    currentPage,
    previousPage,
    nextPage,
    hasPrevious,
    hasNext,
    displayCurrentPage,
    displayTotalPages,
  } = useTurnBook(content, {
    contentKey,
  });

  const pageSections = pages.map((page) => {
    if (!isValidElement(page)) return "";
    return String(
      (page.props as { "data-stage-key"?: string })["data-stage-key"] ?? "",
    );
  });
  const pageSectionsKey = pageSections.join("|");
  const lastRequestedSectionRef = useRef(activeSectionKey);
  const pageNavigationSections = pageSections.map(sectionNavigationKey);

  const activeSectionIndex = sections.findIndex(
    (section) =>
      section.key === activeSectionKey ||
      sectionNavigationKey(section.key) === activeSectionKey,
  );
  const exactTargetPage = pageSections.indexOf(activeSectionKey);
  const targetPage = Math.max(1, (
    exactTargetPage >= 0
      ? exactTargetPage
      : pageNavigationSections.indexOf(activeSectionKey)
  ) + 1);

  useEffect(() => {
    if (
      lastRequestedSectionRef.current === activeSectionKey ||
      !turnRef.current ||
      targetPage < 1
    ) {
      return;
    }
    lastRequestedSectionRef.current = activeSectionKey;
    turnRef.current.turn("page", targetPage);
  }, [activeSectionKey, targetPage, turnRef]);

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
      <div className="book-measure" ref={measureRef}>{content}</div>
      <TurnBookPages
        className="stage-view flipbook"
        flipbookRef={flipbookRef}
        pages={pages}
      />
      <nav className="stage-pagination" aria-label="书页翻页">
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
      </nav>
    </div>
  );
}
