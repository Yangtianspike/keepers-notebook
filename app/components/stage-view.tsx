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

  const pageBreaks = [0];
  let accumulatedHeight = 0;
  blocks.forEach((_, index) => {
    const blockHeight = measuredHeights[index] ?? pageHeight;
    if (index > 0 && accumulatedHeight + blockHeight > pageHeight) {
      pageBreaks.push(index);
      accumulatedHeight = blockHeight;
    } else {
      accumulatedHeight += blockHeight;
    }
  });

  const pages = pageBreaks.map((start, pageIndex) => {
    const end = pageBreaks[pageIndex + 1] ?? blocks.length;
    const pageBlocks = blocks.slice(start, end);
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
};

export function useTurnBook(content: ReactNode, options: TurnBookOptions = {}) {
  const flipbookRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<TurnCollection | null>(null);
  const [pages, setPages] = useState<ReactNode[]>([content]);
  const [currentPage, setCurrentPage] = useState(1);
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
    const pageWidth = Math.min(1100, measure.parentElement?.clientWidth ?? 1100);
    const singleWidth = window.innerWidth <= MOBILE_BREAKPOINT
      ? pageWidth
      : pageWidth / 2;
    const pageHeight = Math.max(360, window.innerHeight - heightOffset - 132);
    measure.style.width = `${singleWidth}px`;
    const root = measure.firstElementChild;
    const nodes = root ? Array.from(root.children) : Array.from(measure.children);
    const heights = nodes.map((node) => {
      const element = node as HTMLElement;
      const styles = window.getComputedStyle(element);
      return element.offsetHeight +
        Number.parseFloat(styles.marginTop || "0") +
        Number.parseFloat(styles.marginBottom || "0");
    });
    const result = measureAndSlice(content, pageHeight, singleWidth, heights);
    setPages(result.pages);
    setCurrentPage(1);
  }, [content, heightOffset, options.contentKey, resizeVersion]);

  useEffect(() => {
    const element = flipbookRef.current;
    if (!element || pages.length === 0) return;
    let disposed = false;
    void loadTurnJs().then(() => {
      if (disposed || !flipbookRef.current || !window.jQuery) return;
      const width = Math.min(1100, element.parentElement?.clientWidth ?? 1100);
      const height = Math.max(480, window.innerHeight - heightOffset);
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
    pages,
    currentPage,
    totalPages,
    previousPage,
    nextPage,
    hasPrevious: currentPage > 1,
    hasNext: currentPage < totalPages,
    isAnimating,
  };
}

export function StageView({
  stageIndex,
  stageName,
  onPrev,
  onNext,
  children,
}: {
  stageIndex: number;
  stageName: string;
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
  const content = isValidElement<{ children?: ReactNode }>(children)
    ? cloneElement(children, undefined, heading, children.props.children)
    : <article className="stage-document">{heading}{children}</article>;
  const {
    flipbookRef,
    measureRef,
    pages,
    currentPage,
    totalPages,
    previousPage,
    nextPage,
    hasPrevious,
    hasNext,
  } = useTurnBook(content, {
    contentKey: children,
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
          <div className="book-page" key={index}>{page}</div>
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
          {currentPage} / {totalPages}
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
