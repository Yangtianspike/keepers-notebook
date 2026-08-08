"use client";

import { useState } from "react";
import type { AnalysisStage, ReviewItem } from "@/lib/types";

type ConfirmWizardProps = {
  item: ReviewItem;
  totalPending: number;
  onAccept: (item: ReviewItem, keeperNote?: string) => void;
  onReject: (item: ReviewItem, keeperNote?: string) => void;
  onModify?: (item: ReviewItem, modifiedData: Partial<ReviewItem>) => void;
};

const stageNames: Record<AnalysisStage, string> = {
  overview: "故事概览",
  people: "人物识别",
  relations: "关系梳理",
  timeline: "时间线",
  clues: "线索与地点",
};

export function ConfirmWizard({
  item,
  totalPending,
  onAccept,
  onReject,
  onModify,
}: ConfirmWizardProps) {
  const [keeperNote, setKeeperNote] = useState("");
  const [description, setDescription] = useState(item.description);

  return (
    <div className="confirm-wizard-backdrop" role="presentation">
      <section
        className="confirm-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-wizard-title"
      >
        <header>
          <div>
            <p className="eyebrow">
              {item.stage ? stageNames[item.stage] : "分析"} · 待确认
            </p>
            <h2 id="confirm-wizard-title">{item.title}</h2>
          </div>
          <span className="confirm-wizard-progress">
            本阶段剩余 {totalPending} 项
          </span>
        </header>

        <div className="confirm-wizard-content">
          <label className="field">
            <span>判断说明</span>
            <textarea
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              readOnly={!onModify}
            />
          </label>
          <div className="confirm-wizard-sources">
            <span>来源依据</span>
            {item.sources.length > 0 ? (
              item.sources.map((source, index) => (
                <blockquote key={`${source.page}-${index}`}>
                  <strong>第 {source.page} 页</strong>
                  {source.chapter ? ` · ${source.chapter}` : ""}
                  <p>{source.quote || "未提供引文"}</p>
                </blockquote>
              ))
            ) : (
              <p className="muted-copy">没有提供可核对的原文引用。</p>
            )}
          </div>
          <label className="field">
            <span>KP 备注</span>
            <textarea
              rows={3}
              value={keeperNote}
              onChange={(event) => setKeeperNote(event.target.value)}
              placeholder="可选：记录接受或否决的原因"
            />
          </label>
        </div>

        <footer>
          <button
            className="ghost-button"
            onClick={() => onReject(item, keeperNote || undefined)}
          >
            拒绝并继续
          </button>
          {onModify && description !== item.description && (
            <button
              className="ghost-button"
              onClick={() =>
                onModify(item, {
                  description,
                  keeperNote: keeperNote || undefined,
                })
              }
            >
              修改后接受
            </button>
          )}
          <button
            className="primary-button"
            onClick={() => onAccept(item, keeperNote || undefined)}
          >
            接受并继续
          </button>
        </footer>
      </section>
    </div>
  );
}
