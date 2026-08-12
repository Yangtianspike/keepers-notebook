"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const STAGE_COUNT = 7;
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

export type PageNumberOffset = {
  current: number;
  total: number;
};

export type BookPageCountRecord = Record<string, number>;

export function pageNumberOffsetFor(
  orderedKeys: string[],
  pageCounts: BookPageCountRecord,
  currentKey: string,
): PageNumberOffset {
  const currentIndex = orderedKeys.indexOf(currentKey);
  const fallbackIndex = Math.max(0, currentIndex);
  const allMeasured = orderedKeys.every((key) => pageCounts[key] !== undefined);
  if (!allMeasured) {
    return {
      current: orderedKeys.slice(0, fallbackIndex).reduce(
        (total, key) => total + (pageCounts[key] ?? 1),
        0,
      ),
      total: orderedKeys.reduce(
        (total, key) => total + (pageCounts[key] ?? 1),
        0,
      ),
    };
  }
  return {
    current: orderedKeys.slice(0, fallbackIndex).reduce(
      (total, key) => total + pageCounts[key],
      0,
    ),
    total: orderedKeys.reduce((total, key) => total + pageCounts[key], 0),
  };
}

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

  blocks.forEach((block, index) => {
    const blockHeight = measuredHeights[index] ?? pageHeight;

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
    const sliced = root
      ? cloneElement(root as ElementWithChildren, { key: pageIndex }, pageBlocks)
      : pageBlocks;
    return <div className="book-page-inner" key={pageIndex}>{sliced}</div>;
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
  heightOffset?: number;
  onBoundaryPrev?: () => void;
  onBoundaryNext?: () => void;
  onPageCount?: (pageCount: number) => void;
  pageNumberOffset?: PageNumberOffset;
};

export function useTurnBook(content: ReactNode, options: TurnBookOptions = {}) {
  const flipbookRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<TurnCollection | null>(null);
  const [pages, setPages] = useState<ReactNode[]>([]);
  const [currentPage, setCurrentPage] = useState(2);
  const [resizeVersion, setResizeVersion] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const totalPages = pages.length;
  const heightOffset = options.heightOffset ?? 132;

  useEffect(() => {
    const resize = () => setResizeVersion((version) => version + 1);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useLayoutEffect(() => {
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
    const coverPage = (
      <div className="book-page-inner book-cover-blank" key="blank-cover" />
    );
    setPages([coverPage, ...result.pages]);
    setCurrentPage(2);
    // contentKey is the explicit invalidation signal. Depending on `content`
    // itself would loop because callers construct a fresh ReactNode per render,
    // while this effect updates pagination state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.contentKey, resizeVersion]);

  const onPageCount = options.onPageCount;
  useEffect(() => {
    onPageCount?.(Math.max(1, totalPages - 1));
  }, [onPageCount, totalPages]);

  useEffect(() => {
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
        page: 2,
      });
      book.on("turning.keeperAtlas", () => setIsAnimating(true));
      book.on("turned.keeperAtlas", (_event, page) => {
        setCurrentPage(page);
        setIsAnimating(false);
      });
    }).catch((error: unknown) => console.error(error));

    return () => {
      disposed = true;
      const book = turnRef.current;
      turnRef.current = null;
      if (!book) return;
      book.off(".keeperAtlas");
      try {
        book.turn("destroy");
      } catch {
        // The plugin may already have removed its generated wrappers.
      }
    };
  }, [heightOffset, pages]);

  useEffect(() => {
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
    book.turn("page", 2);
    setCurrentPage(2);
  }, [resizeVersion]);

  const previousPage = useCallback(() => {
    if (isAnimating) return;
    if (currentPage <= 2) {
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
    pages,
    currentPage,
    totalPages,
    previousPage,
    nextPage,
    hasPrevious: currentPage > 2,
    hasNext: currentPage < totalPages,
    isAnimating,
    displayCurrentPage:
      (options.pageNumberOffset?.current ?? 0) + Math.max(1, currentPage - 1),
    displayTotalPages:
      options.pageNumberOffset?.total ?? Math.max(1, totalPages - 1),
  };
}

export function StageView({
  stageIndex,
  stageName,
  contentKey,
  onPageCount,
  pageNumberOffset,
  onPrev,
  onNext,
  children,
}: {
  stageIndex: number;
  stageName: string;
  contentKey?: unknown;
  onPageCount?: (pageCount: number) => void;
  pageNumberOffset?: PageNumberOffset;
  onPrev: () => void;
  onNext: () => void;
  children: ReactNode;
}) {
  const heading = (
    <header className="stage-page-heading">
      <small>{String(stageIndex + 1).padStart(2, "0")} / {STAGE_COUNT}</small>
      <strong>{stageName}</strong>
    </header>
  );
  const content = (
    <article className="stage-document">
      {heading}
      {children}
    </article>
  );
  const {
    flipbookRef,
    measureRef,
    pages,
    previousPage,
    nextPage,
    hasPrevious,
    hasNext,
    displayCurrentPage,
    displayTotalPages,
  } = useTurnBook(content, {
    contentKey,
    onPageCount,
    pageNumberOffset,
    onBoundaryPrev: stageIndex > 0 ? onPrev : undefined,
    onBoundaryNext: stageIndex < STAGE_COUNT - 1 ? onNext : undefined,
  });

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
      <section className="stage-view flipbook" ref={flipbookRef}>
        {pages.map((page, index) => (
          <div
            className={`book-page${index === 0 ? " book-cover-page" : ""}`}
            key={index}
          >
            {page}
          </div>
        ))}
      </section>
      <nav className="stage-pagination" aria-label="书页翻页">
        <button
          onClick={previousPage}
          disabled={!hasPrevious && stageIndex === 0}
        >
          ← 上一页
        </button>
        <span className="stage-page-number">
          {displayCurrentPage} / {displayTotalPages}
        </span>
        <button
          onClick={nextPage}
          disabled={!hasNext && stageIndex === STAGE_COUNT - 1}
        >
          下一页 →
        </button>
      </nav>
    </div>
  );
}
