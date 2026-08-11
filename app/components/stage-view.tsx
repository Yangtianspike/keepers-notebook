"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const STAGE_COUNT = 7;
const MOBILE_BREAKPOINT = 760;
let enterPreviousStageAtEnd = false;

type PaginationState = {
  currentPage: number;
  pagesPerSpread: 1 | 2;
  totalPages: number;
};

export function useBookPagination(
  contentKey: unknown,
  consumePreviousStageEntry = false,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const [resizeVersion, setResizeVersion] = useState(0);
  const [pagination, setPagination] = useState<PaginationState>({
    currentPage: 0,
    pagesPerSpread: 2,
    totalPages: 1,
  });

  useEffect(() => {
    const handleResize = () => setResizeVersion((version) => version + 1);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const flow = flowRef.current;
    if (!viewport || !flow) return;

    const pagesPerSpread: 1 | 2 =
      window.innerWidth <= MOBILE_BREAKPOINT ? 1 : 2;
    const pageWidth = viewport.clientWidth / pagesPerSpread;
    const totalPages = Math.max(1, Math.ceil(flow.scrollWidth / pageWidth));

    // DOM measurement is the source of truth for dynamic stage content.
    const shouldOpenAtEnd =
      consumePreviousStageEntry && enterPreviousStageAtEnd;
    if (shouldOpenAtEnd) enterPreviousStageAtEnd = false;
    const currentPage = shouldOpenAtEnd
      ? Math.floor((totalPages - 1) / pagesPerSpread) * pagesPerSpread
      : 0;
    setPagination({ currentPage, pagesPerSpread, totalPages });
    viewport.scrollLeft = currentPage * pageWidth;
  }, [consumePreviousStageEntry, contentKey, resizeVersion]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const pageWidth = viewport.clientWidth / pagination.pagesPerSpread;
    viewport.scrollLeft = pagination.currentPage * pageWidth;
  }, [pagination]);

  const hasPrevious = pagination.currentPage > 0;
  const hasNext =
    pagination.currentPage + pagination.pagesPerSpread < pagination.totalPages;

  const previousSpread = useCallback(() => {
    if (!hasPrevious) return false;
    setPagination((current) => ({
      ...current,
      currentPage: Math.max(0, current.currentPage - current.pagesPerSpread),
    }));
    return true;
  }, [hasPrevious]);

  const nextSpread = useCallback(() => {
    if (!hasNext) return false;
    setPagination((current) => ({
      ...current,
      currentPage: current.currentPage + current.pagesPerSpread,
    }));
    return true;
  }, [hasNext]);

  const preparePreviousStageEntry = useCallback(() => {
    enterPreviousStageAtEnd = true;
  }, []);

  return {
    viewportRef,
    flowRef,
    previousSpread,
    nextSpread,
    hasPrevious,
    hasNext,
    preparePreviousStageEntry,
    currentSpread:
      Math.floor(pagination.currentPage / pagination.pagesPerSpread) + 1,
    totalSpreads: Math.ceil(
      pagination.totalPages / pagination.pagesPerSpread,
    ),
  };
}

export function BookPages() {
  return (
    <div className="book-leaves" aria-hidden="true">
      <div className="book-page even" />
      <div className="book-page odd" />
    </div>
  );
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
  const {
    viewportRef,
    flowRef,
    previousSpread,
    nextSpread,
    hasPrevious,
    hasNext,
    preparePreviousStageEntry,
    currentSpread,
    totalSpreads,
  } = useBookPagination(children, true);

  const goPrevious = useCallback(() => {
    if (!previousSpread() && stageIndex > 0) {
      preparePreviousStageEntry();
      onPrev();
    }
  }, [onPrev, preparePreviousStageEntry, previousSpread, stageIndex]);

  const goNext = useCallback(() => {
    if (!nextSpread() && stageIndex < STAGE_COUNT - 1) onNext();
  }, [nextSpread, onNext, stageIndex]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "ArrowLeft") goPrevious();
      if (event.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [goNext, goPrevious]);

  return (
    <section className="stage-view flipbook">
      <BookPages />
      <div className="book-spread-content">
        <header className="stage-page-heading">
          <small>
            {String(stageIndex + 1).padStart(2, "0")} / {STAGE_COUNT}
          </small>
          <strong>{stageName}</strong>
        </header>
        <div className="stage-view-content" ref={viewportRef}>
          <div className="paginated-flow" ref={flowRef}>
            {children}
          </div>
        </div>
        <nav className="stage-pagination" aria-label="书页翻页">
          <button
            onClick={goPrevious}
            disabled={!hasPrevious && stageIndex === 0}
          >
            ← 上一页
          </button>
          <span className="stage-page-number">
            {currentSpread} / {totalSpreads}
          </span>
          <button
            onClick={goNext}
            disabled={!hasNext && stageIndex === STAGE_COUNT - 1}
          >
            下一页 →
          </button>
        </nav>
      </div>
    </section>
  );
}
