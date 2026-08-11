"use client";

import type { ReactNode } from "react";

const STAGE_COUNT = 7;

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
  return (
    <section className="stage-view">
      <nav className="stage-pagination" aria-label="分析阶段翻页">
        {stageIndex > 0 ? (
          <button onClick={onPrev}>← 上一页</button>
        ) : (
          <span />
        )}
        <div>
          <small>
            {String(stageIndex + 1).padStart(2, "0")} / {STAGE_COUNT}
          </small>
          <strong>{stageName}</strong>
        </div>
        {stageIndex < STAGE_COUNT - 1 ? (
          <button onClick={onNext}>下一页 →</button>
        ) : (
          <span />
        )}
      </nav>
      <div className="stage-view-content">{children}</div>
    </section>
  );
}
