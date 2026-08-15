"use client";

import { useState } from "react";
import type { AnalysisStage, ReviewItem } from "@/lib/types";

export type AskUserCall = {
  callId: string;
  question: string;
  options: string[];
  context: string;
};

type ConfirmWizardProps = {
  item?: ReviewItem;
  askUserCall?: AskUserCall;
  totalPending: number;
  onAccept: (answer: string, keeperNote?: string) => void;
  onReject: (keeperNote?: string) => void;
};

const stageNames: Record<AnalysisStage, string> = {
  background: "故事背景",
  timeplace: "时间地点",
  characters: "人物",
  characterArcs: "人物经历与动机",
  clues: "关键线索安排",
  acts: "幕",
};

export function ConfirmWizard({
  item,
  askUserCall,
  totalPending,
  onAccept,
  onReject,
}: ConfirmWizardProps) {
  const [keeperNote, setKeeperNote] = useState("");
  const [answer, setAnswer] = useState(
    askUserCall?.options[0] ?? item?.description ?? "接受",
  );
  if (!item && !askUserCall) return null;

  const title = askUserCall?.question ?? item?.title ?? "需要 KP 确认";
  const context = askUserCall?.context ?? item?.description ?? "";
  const sources = item?.sources ?? [];

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
              {item?.stage ? stageNames[item.stage] : "实时分析"} · 待确认
            </p>
            <h2 id="confirm-wizard-title">{title}</h2>
          </div>
          <span className="confirm-wizard-progress">
            {totalPending > 1 ? `本阶段剩余 ${totalPending} 项` : "等待裁决"}
          </span>
        </header>

        <div className="confirm-wizard-content">
          <div className="confirm-wizard-context">
            <span>判断说明</span>
            <p>{context}</p>
          </div>
          {askUserCall?.options.length ? (
            <fieldset className="confirm-wizard-options">
              <legend>选择裁决</legend>
              {askUserCall.options.map((option) => (
                <label key={option}>
                  <input
                    checked={answer === option}
                    name={`ask-user-${askUserCall.callId}`}
                    onChange={() => setAnswer(option)}
                    type="radio"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <label className="field">
              <span>裁决结果</span>
              <textarea
                rows={4}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </label>
          )}
          {sources.length > 0 && (
            <div className="confirm-wizard-sources">
              <span>来源依据</span>
              {sources.map((source, index) => (
                <blockquote key={`${source.page}-${index}`}>
                  <strong>第 {source.page} 页</strong>
                  {source.chapter ? ` · ${source.chapter}` : ""}
                  <p>{source.quote || "未提供引文"}</p>
                </blockquote>
              ))}
            </div>
          )}
          <label className="field">
            <span>KP 备注</span>
            <textarea
              rows={3}
              value={keeperNote}
              onChange={(event) => setKeeperNote(event.target.value)}
              placeholder="可选：补充裁决依据"
            />
          </label>
        </div>

        <footer>
          <button
            className="ghost-button"
            onClick={() => onReject(keeperNote || undefined)}
          >
            拒绝并继续
          </button>
          <button
            className="primary-button"
            disabled={!answer.trim()}
            onClick={() => onAccept(answer.trim(), keeperNote || undefined)}
          >
            接受并继续
          </button>
        </footer>
      </section>
    </div>
  );
}
