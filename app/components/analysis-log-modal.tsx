"use client";

import type { AnalysisLogEntry } from "@/lib/types";

export function AnalysisLogModal({
  entries,
  onClose,
}: {
  entries: AnalysisLogEntry[];
  onClose: () => void;
}) {
  return (
    <div className="analysis-log-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="分析记录"
        aria-modal="true"
        className="analysis-log-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">ANALYSIS ACTIVITY</span>
            <h2>分析记录</h2>
          </div>
          <button aria-label="关闭分析记录" onClick={onClose}>×</button>
        </header>
        {entries.length === 0 ? (
          <p>尚未开始分析。</p>
        ) : (
          <ol>
            {entries.slice().reverse().map((entry) => (
              <li className={`log-${entry.kind}`} key={entry.id}>
                <time>{new Date(entry.createdAt).toLocaleString("zh-CN")}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
