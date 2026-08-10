"use client";

import type { ChapterSummary } from "@/lib/types";

function statsText(stats: NonNullable<ChapterSummary["keyEvents"][number]["stats"]>) {
  return Object.entries(stats)
    .map(([key, value]) => `${key === "sanLoss" ? "SAN" : key.toUpperCase()} ${value}`)
    .join(" · ");
}

export function ChapterSummaryView({ summary }: { summary: ChapterSummary }) {
  return (
    <section className="chapter-summary">
      <article>
        <span>01</span>
        <h4>故事背景</h4>
        <p>{summary.background}</p>
      </article>
      <article>
        <span>02</span>
        <h4>时间地点</h4>
        <p>{summary.timeAndPlace}</p>
      </article>
      <article>
        <span>03</span>
        <h4>核心人物</h4>
        <p>{summary.coreCharacters}</p>
      </article>
      <article>
        <span>04</span>
        <h4>人物经历与动机</h4>
        <p>{summary.characterArcs}</p>
      </article>
      <article>
        <span>05</span>
        <h4>开篇钩子</h4>
        <p>{summary.openingHook}</p>
      </article>
      <article>
        <span>06</span>
        <h4>关键线索安排</h4>
        {summary.clueArrangements.length > 0 ? (
          summary.clueArrangements.map((clue, index) => (
            <details key={`${clue.name}-${index}`}>
              <summary>{clue.name}</summary>
              <p>获取方式：{clue.acquisition}</p>
              <p>指向：{clue.leadsTo}</p>
            </details>
          ))
        ) : (
          <p>本章暂无已归属线索。</p>
        )}
      </article>
      <article>
        <span>07</span>
        <h4>幕</h4>
        {summary.acts.length > 0 ? (
          summary.acts.map((act) => (
            <details key={act.actId}>
              <summary>{act.title}</summary>
              <p>{act.summary}</p>
            </details>
          ))
        ) : (
          <p>本章暂无已归属幕。</p>
        )}
      </article>
      <article>
        <span>08</span>
        <h4>阶段性重要事件点</h4>
        {summary.keyEvents.length > 0 ? (
          summary.keyEvents.map((event, index) => (
            <div className="chapter-key-event" key={`${event.title}-${index}`}>
              <strong>{event.title}</strong>
              <p>{event.description}</p>
              {event.stats && <code>{statsText(event.stats)}</code>}
            </div>
          ))
        ) : (
          <p>本章暂无关键事件。</p>
        )}
      </article>
    </section>
  );
}
