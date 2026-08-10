"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { parseScenarioFile } from "@/lib/parser";
import { hybridSearch, stageQuery } from "@/lib/retrieval";
import { ensureVectorIndex, probeEmbedding } from "@/lib/embedding";
import {
  flagUnverifiedSourceRefs,
  verifySourceRefs,
} from "@/lib/quote-check";
import { ConfirmWizard } from "@/app/components/confirm-wizard";
import {
  deleteProject,
  listProjects,
  loadSourceFile,
  saveProject,
  saveSourceFile,
} from "@/lib/storage";
import {
  emptyAnalysis,
  type AnalysisStage,
  type Act,
  type CharacterArc,
  type Clue,
  type ModelConfig,
  type Person,
  type Project,
  type Provenance,
  type ReviewItem,
  type SourceRef,
  type TimePlace,
} from "@/lib/types";

type View =
  | "dashboard"
  | "structure"
  | "analysis"
  | "overview"
  | "acts"
  | "review"
  | "settings";

const stageLabels: Record<AnalysisStage, string> = {
  background: "故事背景",
  timeplace: "时间地点",
  characters: "核心人物",
  characterArcs: "人物经历与动机",
  openingHook: "开篇钩子",
  clues: "关键线索安排",
  acts: "幕",
};

const STAGE_ORDER: AnalysisStage[] = [
  "background",
  "timeplace",
  "characters",
  "characterArcs",
  "openingHook",
  "clues",
  "acts",
];
const PAUSE_STAGES: AnalysisStage[] = ["characters", "clues"];

function pausedStageFor(project: Project): AnalysisStage | null {
  return (
    STAGE_ORDER.find(
      (stage) =>
        project.analysis.stages[stage].status === "paused" &&
        (project.analysis.pendingAskUserCall?.stage === stage ||
          project.analysis.reviewItems.some(
            (item) => item.stage === stage && item.status === "pending",
          )),
    ) ?? null
  );
}

const provenanceLabels: Record<Provenance, string> = {
  source: "原作事实",
  inference: "AI 推断",
  keeper: "KP 设定",
  conflict: "原作矛盾",
};

const navigation: Array<{ view: View; label: string; short: string }> = [
  { view: "dashboard", label: "项目仪表盘", short: "总" },
  { view: "structure", label: "文档结构", short: "章" },
  { view: "analysis", label: "分析流程", short: "析" },
  { view: "overview", label: "幕后真相", short: "真" },
  { view: "acts", label: "幕", short: "幕" },
  { view: "review", label: "待确认", short: "核" },
];

function parseModelJson(content: string): Record<string, unknown> {
  const clean = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < start)
    throw new Error("模型流式输出未形成完整 JSON。请重试该阶段。");
  return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusLabel(status: Project["status"]) {
  return {
    imported: "等待确认结构",
    structured: "可以开始分析",
    analyzing: "分析进行中",
    ready: "备本已生成",
  }[status];
}

function sourcePageLabel(source: SourceRef) {
  return source.printedPage
    ? `PDF ${source.page} 页 · 书内 ${source.printedPage} 页`
    : `PDF ${source.page} 页`;
}

function Badge({ provenance }: { provenance: Provenance }) {
  return (
    <span className={`badge badge-${provenance}`}>
      {provenanceLabels[provenance]}
    </span>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">∴</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function SourceButton({
  source,
  onOpen,
}: {
  source: SourceRef;
  onOpen: (source: SourceRef) => void;
}) {
  return (
    <button className="source-link" onClick={() => onOpen(source)}>
      <span>
        {source.verified === false ? "待核实 · " : ""}
        {sourcePageLabel(source)}
      </span>
      <span aria-hidden>↗</span>
    </button>
  );
}

function ProjectHome({
  projects,
  importing,
  error,
  onImport,
  onOpen,
  onDelete,
  onOpenSettings,
}: {
  projects: Project[];
  importing: boolean;
  error: string;
  onImport: (file: File) => void;
  onOpen: (project: Project) => void;
  onDelete: (project: Project) => void;
  onOpenSettings: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <main className="home-shell">
      <header className="home-header">
        <div className="brand-lockup">
          <div className="brand-mark">KA</div>
          <div>
            <p className="eyebrow">KEEPER&apos;S LOCAL WORKBENCH</p>
            <h1>守秘人图谱</h1>
          </div>
        </div>
        <button className="ghost-button" onClick={onOpenSettings}>
          模型连接
        </button>
      </header>

      <section className="home-hero">
        <div>
          <p className="eyebrow accent">LOCAL FIRST · EVIDENCE LINKED</p>
          <h2>
            把剧本读成一张
            <br />
            可以主持的地图。
          </h2>
          <p className="hero-copy">
            从原文中梳理幕后真相、人物关系与分支时间线。每个关键结论都能回到出处，
            AI 推断永远不会冒充原作事实。
          </p>
        </div>
        <div className="import-panel">
          <div className="import-number">01</div>
          <h3>导入一个剧本</h3>
          <p>支持可复制文字的 PDF、DOCX 与 Markdown。</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.md,.markdown"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.target.value = "";
            }}
          />
          <button
            className="primary-button wide"
            disabled={importing}
            onClick={() => inputRef.current?.click()}
          >
            {importing ? "正在解析文档…" : "选择本地文件"}
          </button>
          <small>文件与分析结果保存在当前浏览器的本地项目库中。</small>
          {error && <p className="inline-error">{error}</p>}
        </div>
      </section>

      <section className="project-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RECENT CASES</p>
            <h2>最近的备本项目</h2>
          </div>
          <span>{projects.length} 个项目</span>
        </div>
        {projects.length === 0 ? (
          <div className="project-empty">
            <span>还没有项目</span>
            <p>导入第一个剧本后，它会出现在这里。</p>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <button className="card-main" onClick={() => onOpen(project)}>
                  <div className="card-topline">
                    <span className={`file-pill file-${project.fileType}`}>
                      {project.fileType.toUpperCase()}
                    </span>
                    <span>{statusLabel(project.status)}</span>
                  </div>
                  <h3>{project.name}</h3>
                  <p>
                    {project.pages.length} 页 · {project.chapters.length} 个章节
                    · {formatBytes(project.fileSize)}
                  </p>
                  <div className="card-progress">
                    <span
                      style={{
                        width: `${
                          Object.values(project.analysis.stages).filter(
                            (stage) => stage.status === "complete",
                          ).length * 25
                        }%`,
                      }}
                    />
                  </div>
                  <small>
                    更新于{" "}
                    {new Date(project.updatedAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </button>
                <button
                  className="delete-button"
                  aria-label={`删除 ${project.name}`}
                  onClick={() => onDelete(project)}
                >
                  ×
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function StructureView({
  project,
  onChange,
  onConfirm,
}: {
  project: Project;
  onChange: (project: Project) => void;
  onConfirm: () => void;
}) {
  const imagePages = project.pages.filter((page) => page.imageHeavy);
  const updateChapter = (
    id: string,
    patch: Partial<Project["chapters"][number]>,
  ) => {
    onChange({
      ...project,
      updatedAt: new Date().toISOString(),
      chapters: project.chapters.map((chapter) =>
        chapter.id === id ? { ...chapter, ...patch } : chapter,
      ),
    });
  };
  return (
    <div className="content-stack">
      <header className="content-header">
        <div>
          <p className="eyebrow">DOCUMENT STRUCTURE</p>
          <h2>确认章节结构</h2>
          <p>分析只会读取勾选的章节。标题和页码都可以在这里修正。</p>
        </div>
        <div className="document-stat">
          <strong>{project.pages.length}</strong>
          <span>PDF / 文档页</span>
        </div>
      </header>

      {imagePages.length > 0 && (
        <div className="notice warning">
          <strong>检测到 {imagePages.length} 个图片为主的页面</strong>
          <p>
            第 {imagePages.map((page) => page.pageNumber).join("、")}{" "}
            页文字很少，首版不会理解地图或图片内容，分析结果会保留这项限制。
          </p>
        </div>
      )}

      <div className="chapter-list">
        {project.chapters.map((chapter, index) => (
          <article className="chapter-row" key={chapter.id}>
            <label className="check-control">
              <input
                type="checkbox"
                checked={chapter.included}
                onChange={(event) =>
                  updateChapter(chapter.id, { included: event.target.checked })
                }
              />
              <span />
            </label>
            <span className="chapter-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <input
              className="chapter-title-input"
              value={chapter.title}
              onChange={(event) =>
                updateChapter(chapter.id, { title: event.target.value })
              }
            />
            <div className="page-range">
              <label>
                从
                <input
                  type="number"
                  min={1}
                  max={project.pages.length}
                  value={chapter.startPage}
                  onChange={(event) =>
                    updateChapter(chapter.id, {
                      startPage: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                至
                <input
                  type="number"
                  min={1}
                  max={project.pages.length}
                  value={chapter.endPage}
                  onChange={(event) =>
                    updateChapter(chapter.id, {
                      endPage: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
          </article>
        ))}
      </div>
      <div className="structure-actions">
        <div>
          <strong>
            已选择{" "}
            {project.chapters.filter((chapter) => chapter.included).length}{" "}
            个章节
          </strong>
          <span>确认后仍可回来调整；重新分析由你主动触发。</span>
        </div>
        <button className="primary-button" onClick={onConfirm}>
          确认结构并进入分析
        </button>
      </div>
    </div>
  );
}

function AnalysisView({
  project,
  configReady,
  activeStage,
  streamPreview,
  reviewItems,
  onResolveReview,
  onEditReview,
  onPause,
  onRun,
  onNavigate,
}: {
  project: Project;
  configReady: boolean;
  activeStage: AnalysisStage | null;
  streamPreview: string;
  reviewItems: ReviewItem[];
  onResolveReview: (item: ReviewItem, accepted: boolean) => void;
  onEditReview: (item: ReviewItem, changes: Partial<ReviewItem>) => void;
  onPause: () => void;
  onRun: (stage: AnalysisStage) => void;
  onNavigate: (view: View) => void;
}) {
  const stages: Record<
    AnalysisStage,
    {
      id: AnalysisStage;
      number: string;
      description: string;
      requires?: AnalysisStage;
      target: View;
    }
  > = {
    background: {
      id: "background",
      number: "01",
      description: "梳理起因、历史真相、开局状态与各方计划。",
      target: "overview",
    },
    timeplace: {
      id: "timeplace",
      number: "02",
      description: "汇总剧本的时间脉络、地点信息与区域提示。",
      requires: "background",
      target: "overview",
    },
    characters: {
      id: "characters",
      number: "03",
      description: "识别人名、组织、公开身份与真实动机。",
      requires: "timeplace",
      target: "overview",
    },
    characterArcs: {
      id: "characterArcs",
      number: "04",
      description: "梳理人物在故事中的经历、变化与深层动机。",
      requires: "characters",
      target: "overview",
    },
    openingHook: {
      id: "openingHook",
      number: "05",
      description: "提取促使调查员入局并制造紧迫感的开篇钩子。",
      requires: "characterArcs",
      target: "overview",
    },
    clues: {
      id: "clues",
      number: "06",
      description: "梳理调查线索、关键真相、替代入口与卡关风险。",
      requires: "openingHook",
      target: "overview",
    },
    acts: {
      id: "acts",
      number: "07",
      description: "基于前六阶段划分幕，并生成分支和关键事件。",
      requires: "clues",
      target: "overview",
    },
  };
  const stateLabel = (
    status: Project["analysis"]["stages"][AnalysisStage]["status"],
  ) =>
    status === "complete"
      ? "已完成"
      : status === "error"
        ? "需要处理"
        : status === "running"
          ? "分析中"
          : status === "paused"
            ? "等待确认"
            : "未开始";
  const renderStage = (
    stage: {
      id: AnalysisStage;
      number: string;
      description: string;
      requires?: AnalysisStage;
      target: View;
    },
    compact = false,
  ) => {
    const state = project.analysis.stages[stage.id] ?? {
      status: "idle" as const,
    };
    const blocked =
      !!stage.requires &&
      project.analysis.stages[stage.requires].status !== "complete";
    return (
      <section
        className={`${compact ? "pipeline-substage" : "pipeline-body"} pipeline-${state.status}`}
        key={stage.id}
      >
        <div className="pipeline-number">{stage.number}</div>
        <div className="pipeline-title">
          <h3>{stageLabels[stage.id]}</h3>
          <span>{stateLabel(state.status)}</span>
        </div>
        <p>{stage.description}</p>
        {state.error && <p className="inline-error">{state.error}</p>}
        <div className="pipeline-actions">
          <button
            className="primary-button compact"
            disabled={!configReady || blocked || activeStage !== null}
            onClick={() => onRun(stage.id)}
          >
            {activeStage === stage.id
              ? "正在分析…"
              : state.status === "complete"
                ? "重新分析"
                : "开始分析"}
          </button>
          {state.status === "complete" && (
            <button
              className="text-button"
              onClick={() => onNavigate(stage.target)}
            >
              查看结果
            </button>
          )}
        </div>
      </section>
    );
  };
  return (
    <div className="content-stack">
      <header className="content-header">
        <div>
          <p className="eyebrow">STAGED ANALYSIS</p>
          <h2>分阶段分析</h2>
          <p>每一步单独调用模型并立即保存。你可以先核对，再继续下一阶段。</p>
        </div>
        <div className="token-estimate">
          <span>预计输入</span>
          <strong>
            ≈ {Math.ceil(project.documentText.length / 2).toLocaleString()}{" "}
            tokens
          </strong>
          <small>实际用量以模型服务为准</small>
        </div>
      </header>

      {activeStage && (
        <button
          className="ghost-button compact pause-analysis"
          onClick={onPause}
        >
          暂停当前分析
        </button>
      )}

      {!configReady && (
        <div className="notice critical">
          <strong>尚未完成模型连接配置</strong>
          <p>请先填写接口地址、模型名称与 API Key，并测试连接。</p>
          <button
            className="text-button"
            onClick={() => onNavigate("settings")}
          >
            前往配置 →
          </button>
        </div>
      )}

      <div className="pipeline pipeline-major">
        {STAGE_ORDER.map((stage) => (
          <article
            className={`pipeline-card pipeline-${project.analysis.stages[stage]?.status ?? "idle"}`}
            key={stage}
          >
            {renderStage(stages[stage])}
          </article>
        ))}
      </div>
      {activeStage && streamPreview && (
        <section className="stream-preview">
          <div>
            <span className="eyebrow">LIVE MODEL OUTPUT</span>
            <strong>{stageLabels[activeStage]}正在生成</strong>
          </div>
          <pre>{streamPreview}</pre>
        </section>
      )}
      <section className="analysis-log">
        <div>
          <span className="eyebrow">ANALYSIS ACTIVITY</span>
          <h3>分析记录</h3>
        </div>
        {(project.analysis.activityLog ?? []).length === 0 ? (
          <p>尚未开始分析。这里会保留每个阶段的执行、暂停、确认与完成记录。</p>
        ) : (
          <ol>
            {(project.analysis.activityLog ?? [])
              .slice(-8)
              .reverse()
              .map((entry) => (
                <li key={entry.id} className={`log-${entry.kind}`}>
                  <time>
                    {new Date(entry.createdAt).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <span>{entry.message}</span>
                </li>
              ))}
          </ol>
        )}
      </section>
      {reviewItems.filter(
        (item) => item.status === "pending" && item.type !== "external",
      ).length > 0 && (
        <aside className="analysis-confirmation-rail">
          <div>
            <span className="eyebrow">KP CONFIRMATION</span>
            <h3>等待确认</h3>
          </div>
          {reviewItems
            .filter(
              (item) => item.status === "pending" && item.type !== "external",
            )
            .sort(
              (a, b) =>
                Number(b.severity === "critical") -
                Number(a.severity === "critical"),
            )
            .map((item) => (
              <article
                key={item.id}
                className={`rail-review severity-${item.severity}`}
              >
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <textarea
                  placeholder="KP 备注（会带入后续分析）"
                  value={item.keeperNote ?? ""}
                  onChange={(event) =>
                    onEditReview(item, { keeperNote: event.target.value })
                  }
                />
                <div>
                  <button
                    className="primary-button compact"
                    onClick={() => onResolveReview(item, true)}
                  >
                    接受
                  </button>
                  <button
                    className="ghost-button compact"
                    onClick={() => onResolveReview(item, false)}
                  >
                    拒绝
                  </button>
                </div>
              </article>
            ))}
        </aside>
      )}
    </div>
  );
}

function OverviewView({
  project,
  onOpenSource,
}: {
  project: Project;
  onOpenSource: (source: SourceRef) => void;
}) {
  const overview = project.analysis.overview;
  if (!overview) {
    return (
      <EmptyState
        title="尚未生成幕后真相"
        description="在“分析流程”中完成故事概览后，这里会按照起因、历史和当前状态重新组织剧本。"
      />
    );
  }
  return (
    <div className="content-stack">
      <header className="content-header">
        <div>
          <p className="eyebrow">THE TRUTH BEHIND THE CASE</p>
          <h2>幕后真相</h2>
        </div>
        <Badge provenance="source" />
      </header>
      <article className="truth-lead">
        <span>一句话核心</span>
        <p>{overview.oneLine}</p>
      </article>
      <div className="truth-grid">
        <article className="truth-card">
          <span>01 / 起因</span>
          <h3>一切从哪里开始</h3>
          <p>{overview.cause}</p>
        </article>
        <article className="truth-card">
          <span>02 / 经过</span>
          <h3>开团前的真实历史</h3>
          <p>{overview.history}</p>
        </article>
        <article className="truth-card">
          <span>03 / 现状</span>
          <h3>调查开始时的世界</h3>
          <p>{overview.currentState}</p>
        </article>
        <article className="truth-card">
          <span>04 / 计划</span>
          <h3>无人干预时</h3>
          <ul>
            {overview.plans.map((plan, index) => (
              <li key={`${plan.faction}-${index}`}>
                <strong>{plan.faction}</strong>
                <span>{plan.plan}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
      {(overview.externalDependencies.length > 0 ||
        overview.conflicts.length > 0) && (
        <section className="findings-section">
          <h3>需要 KP 注意</h3>
          {overview.externalDependencies.map((item, index) => (
            <div className="finding-row warning" key={`dependency-${index}`}>
              <span>外部资料</span>
              <p>{item}</p>
            </div>
          ))}
          {overview.conflicts.map((item, index) => (
            <div className="finding-row critical" key={`conflict-${index}`}>
              <span>原作矛盾</span>
              <div>
                <p>{item.summary}</p>
                {item.sources.map((source, sourceIndex) => (
                  <SourceButton
                    key={sourceIndex}
                    source={source}
                    onOpen={onOpenSource}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function ReviewView({
  items,
  onResolve,
  onEdit,
  onOpenSource,
}: {
  items: ReviewItem[];
  onResolve: (item: ReviewItem, accepted: boolean) => void;
  onEdit: (item: ReviewItem, changes: Partial<ReviewItem>) => void;
  onOpenSource: (source: SourceRef) => void;
}) {
  const pending = items.filter((item) => item.status === "pending");
  return (
    <div className="content-stack">
      <header className="content-header">
        <div>
          <p className="eyebrow">KEEPER REVIEW</p>
          <h2>待确认</h2>
          <p>
            这里会列出需要你判断的具体问题：原文冲突会标出两处说法，模型推断会标出推断内容与依据。
          </p>
        </div>
        <div className="review-counter">
          <strong>{pending.length}</strong>
          <span>项待处理</span>
        </div>
      </header>
      {items.length === 0 ? (
        <EmptyState
          title="目前没有待确认内容"
          description="完成分析后，疑似别名、模型推断和原作矛盾会集中出现在这里，并附上对应原文页码。"
        />
      ) : (
        <div className="review-list">
          {items.map((item) => (
            <article
              className={`review-card severity-${item.severity} status-${item.status}`}
              key={item.id}
            >
              <div className="review-icon">
                {item.severity === "critical" ? "!" : "?"}
              </div>
              <div className="review-body">
                <div className="review-title">
                  <div>
                    <span>
                      {item.type === "merge"
                        ? "人物合并建议"
                        : item.type === "conflict"
                          ? "原作矛盾"
                          : item.type === "external"
                            ? "外部资料"
                            : "模型推断（待核对）"}
                    </span>
                    <h3>{item.title}</h3>
                  </div>
                  {item.status !== "pending" && (
                    <span className={`decision decision-${item.status}`}>
                      {item.status === "accepted" ? "已接受" : "已拒绝"}
                    </span>
                  )}
                </div>
                {item.status === "pending" ? (
                  <div className="review-edit-fields">
                    <label>
                      <span>KP 采用的结论</span>
                      <input
                        value={item.title}
                        onChange={(event) =>
                          onEdit(item, { title: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>理由与处理说明</span>
                      <textarea
                        value={item.description}
                        onChange={(event) =>
                          onEdit(item, { description: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>KP 备注（会带入后续分析）</span>
                      <textarea
                        value={item.keeperNote ?? ""}
                        onChange={(event) =>
                          onEdit(item, { keeperNote: event.target.value })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <p>{item.description}</p>
                )}
                <div className="source-row">
                  {item.sources.slice(0, 3).map((source, index) => (
                    <SourceButton
                      key={index}
                      source={source}
                      onOpen={onOpenSource}
                    />
                  ))}
                </div>
                {item.status === "pending" && (
                  <div className="review-actions">
                    <button
                      className="primary-button compact"
                      onClick={() => onResolve(item, true)}
                    >
                      {item.type === "merge" ? "确认是同一对象" : "接受"}
                    </button>
                    <button
                      className="ghost-button compact"
                      onClick={() => onResolve(item, false)}
                    >
                      {item.type === "merge" ? "保持分开" : "拒绝"}
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsView({
  config,
  apiKey,
  testState,
  onConfig,
  onApiKey,
  onTest,
}: {
  config: ModelConfig;
  apiKey: string;
  testState: "idle" | "testing" | "success" | "error";
  onConfig: (config: ModelConfig) => void;
  onApiKey: (value: string) => void;
  onTest: () => void;
}) {
  return (
    <div className="settings-page">
      <header className="content-header">
        <div>
          <p className="eyebrow">MODEL CONNECTION</p>
          <h2>模型连接</h2>
          <p>当前支持 OpenAI Chat Completions 兼容协议，包括 Kimi 开放平台。</p>
        </div>
      </header>
      <div className="settings-grid">
        <section className="settings-card">
          <span className="settings-index">01</span>
          <h3>接口协议</h3>
          <label className="field">
            <span>API 协议</span>
            <select disabled value="openai-compatible">
              <option value="openai-compatible">OpenAI Compatible</option>
            </select>
          </label>
          <label className="field">
            <span>Base URL</span>
            <input
              value={config.baseUrl}
              placeholder="https://api.moonshot.cn/v1"
              onChange={(event) =>
                onConfig({ ...config, baseUrl: event.target.value })
              }
            />
            <small>填写到 `/v1`；应用会自动添加 `/chat/completions`。</small>
          </label>
          <p
            className={`capability-badge ${config.capabilities?.embedding ? "available" : "keyword"}`}
          >
            {config.capabilities?.embedding
              ? `✓ 向量检索可用（${config.capabilities.embedding.model}）`
              : "仅关键词检索"}
          </p>
        </section>
        <section className="settings-card">
          <span className="settings-index">02</span>
          <h3>模型与凭据</h3>
          <label className="field">
            <span>模型名称</span>
            <input
              value={config.model}
              placeholder="在服务商控制台复制模型 ID"
              onChange={(event) =>
                onConfig({ ...config, model: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              autoComplete="off"
              placeholder="sk-••••••••"
              onChange={(event) => onApiKey(event.target.value)}
            />
            <small>
              当前开发版仅保存在本次浏览器会话，不进入项目，也不会写入本地文件。
            </small>
          </label>
          <button
            className="primary-button"
            disabled={testState === "testing"}
            onClick={onTest}
          >
            {testState === "testing"
              ? "正在测试…"
              : testState === "success"
                ? "连接成功 ✓"
                : testState === "error"
                  ? "连接失败，重新测试"
                  : "测试连接"}
          </button>
        </section>
        <section className="settings-card">
          <span className="settings-index">03</span>
          <h3>确认模式</h3>
          <label className="field">
            <span>模型确认能力</span>
            <select
              value={config.confirmMode ?? "tier1"}
              onChange={(event) =>
                onConfig({
                  ...config,
                  confirmMode: event.target.value as NonNullable<
                    ModelConfig["confirmMode"]
                  >,
                })
              }
            >
              <option value="tier1">实时确认（推荐，Function Calling）</option>
              <option value="tier2">准实时确认（结构化标记）</option>
              <option value="tier3">阶段后确认（兼容模式）</option>
            </select>
            <small>
              DeepSeek、OpenAI 等选实时；Kimi、Qwen 可选准实时；旧模型或本地小模型选阶段后确认。
            </small>
          </label>
        </section>
      </div>
      <div className="notice neutral">
        <strong>隐私说明</strong>
        <p>
          项目与原文件保存在本地；执行分析时，勾选章节的文字会发送到你配置的模型服务商。
        </p>
      </div>
    </div>
  );
}

function DashboardView({
  project,
  onNavigate,
}: {
  project: Project;
  onNavigate: (view: View) => void;
}) {
  const completed = Object.values(project.analysis.stages).filter(
    (stage) => stage.status === "complete",
  ).length;
  const pending = project.analysis.reviewItems.filter(
    (item) => item.status === "pending",
  ).length;
  return (
    <div className="dashboard">
      <header className="dashboard-hero">
        <div>
          <p className="eyebrow accent">CASE FILE</p>
          <h2>{project.name}</h2>
          <p>
            {project.analysis.overview?.oneLine ||
              "剧本已导入，等待建立第一份结构化备本。"}
          </p>
        </div>
        <div className="case-status">
          <span>项目状态</span>
          <strong>{statusLabel(project.status)}</strong>
          <div className="case-progress">
            <i style={{ width: `${(completed / STAGE_ORDER.length) * 100}%` }} />
          </div>
          <small>{completed} / 7 个分析阶段</small>
        </div>
      </header>
      <div className="dashboard-stats">
        <button onClick={() => onNavigate("structure")}>
          <span>文档</span>
          <strong>{project.pages.length}</strong>
          <small>页 · {project.chapters.length} 个章节</small>
        </button>
        <button onClick={() => onNavigate("overview")}>
          <span>人物</span>
          <strong>{project.analysis.people.length}</strong>
          <small>核心人物</small>
        </button>
        <button onClick={() => onNavigate("acts")}>
          <span>幕</span>
          <strong>{project.analysis.acts.length}</strong>
          <small>剧情幕</small>
        </button>
        <button onClick={() => onNavigate("review")}>
          <span>核对</span>
          <strong className={pending > 0 ? "warning-text" : ""}>
            {pending}
          </strong>
          <small>项待确认</small>
        </button>
      </div>
      <section className="dashboard-actions">
        <div className="section-heading">
          <div>
            <p className="eyebrow">WORKSPACE</p>
            <h2>核心视图</h2>
          </div>
        </div>
        <div className="action-grid">
          <button
            className="action-card truth"
            onClick={() => onNavigate("overview")}
          >
            <span>01</span>
            <div>
              <h3>幕后真相</h3>
              <p>起因、真实历史与各方计划</p>
            </div>
            <i>→</i>
          </button>
          <button
            className="action-card relation"
            onClick={() => onNavigate("acts")}
          >
            <span>02</span>
            <div>
              <h3>幕</h3>
              <p>剧情分幕、关键事件与分支</p>
            </div>
            <i>→</i>
          </button>
        </div>
      </section>
    </div>
  );
}

function SourcePanel({
  project,
  source,
  sourceUrl,
  onClose,
}: {
  project: Project;
  source: SourceRef;
  sourceUrl: string;
  onClose: () => void;
}) {
  const page = project.pages.find((item) => item.pageNumber === source.page);
  return (
    <div className="source-overlay">
      <header>
        <div>
          <p className="eyebrow">SOURCE EVIDENCE</p>
          <h3>
            {sourcePageLabel(source)}
            {source.chapter ? ` · ${source.chapter}` : ""}
          </h3>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="关闭原文">
          ×
        </button>
      </header>
      <div className="source-body">
        {project.fileType === "pdf" && sourceUrl ? (
          <iframe
            title={`${project.fileName} 第 ${source.page} 页`}
            src={`${sourceUrl}#page=${source.page}&view=FitH`}
          />
        ) : (
          <pre>{page?.text || project.documentText}</pre>
        )}
        <aside>
          <span>分析引用</span>
          <blockquote>{source.quote || "该条目没有提供引用片段。"}</blockquote>
          <small>
            如果引用与原文不一致，请关闭此窗口并在节点详情中修改内容。
          </small>
        </aside>
      </div>
    </div>
  );
}

function hydrateProject(project: Project): Project {
  const defaults = emptyAnalysis();
  const stages = Object.fromEntries(
    STAGE_ORDER.map((stage) => {
      const saved = project.analysis.stages?.[stage] ?? defaults.stages[stage];
      return [stage, saved.status === "running" ? { status: "idle" } : saved];
    }),
  ) as Project["analysis"]["stages"];
  return {
    ...project,
    analysis: {
      ...defaults,
      ...project.analysis,
      clues: project.analysis.clues ?? [],
      acts: project.analysis.acts ?? [],
      chapterSummaries: project.analysis.chapterSummaries ?? [],
      characterArcs: project.analysis.characterArcs ?? [],
      openingHook: project.analysis.openingHook ?? "",
      activityLog: project.analysis.activityLog ?? [],
      unresolvedRelationCount:
        project.analysis.unresolvedRelationCount ?? 0,
      places: project.analysis.places ?? [],
      maps: project.analysis.maps ?? [],
      markers: project.analysis.markers ?? [],
      stages,
    },
  };
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [sourceRef, setSourceRef] = useState<SourceRef | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [activeStage, setActiveStage] = useState<AnalysisStage | null>(null);
  const [wizardStage, setWizardStage] = useState<AnalysisStage | null>(null);
  const [streamPreview, setStreamPreview] = useState("");
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => {
    if (typeof window === "undefined") {
      return {
        baseUrl: "https://api.moonshot.cn/v1",
        model: "",
        confirmMode: "tier1",
      };
    }
    const saved = localStorage.getItem("keeper-atlas:model-config");
    if (!saved)
      return {
        baseUrl: "https://api.moonshot.cn/v1",
        model: "",
        confirmMode: "tier1",
      };
    try {
      return {
        ...(JSON.parse(saved) as ModelConfig),
        confirmMode:
          (JSON.parse(saved) as ModelConfig).confirmMode ?? "tier1",
      };
    } catch {
      return {
        baseUrl: "https://api.moonshot.cn/v1",
        model: "",
        confirmMode: "tier1",
      };
    }
  });
  const [apiKey, setApiKey] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (sessionStorage.getItem("keeper-atlas:api-key") ?? ""),
  );
  const [testState, setTestState] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");

  useEffect(() => {
    listProjects()
      .then((saved) => setProjects(saved.map(hydrateProject)))
      .catch(() => setError("无法打开本地项目库。"));
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "keeper-atlas:model-config",
      JSON.stringify(modelConfig),
    );
  }, [modelConfig]);

  useEffect(() => {
    if (apiKey) sessionStorage.setItem("keeper-atlas:api-key", apiKey);
    else sessionStorage.removeItem("keeper-atlas:api-key");
  }, [apiKey]);

  const activeProjectId = activeProject?.id;
  useEffect(() => {
    let currentUrl = "";
    if (!activeProjectId) return;
    loadSourceFile(activeProjectId).then((blob) => {
      if (!blob) return;
      currentUrl = URL.createObjectURL(blob);
      setSourceUrl(currentUrl);
    });
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const persistProject = useCallback(async (project: Project) => {
    setActiveProject(project);
    setProjects((items) => {
      const without = items.filter((item) => item.id !== project.id);
      return [project, ...without].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
    });
    await saveProject(project);
  }, []);

  const handleImport = async (file: File) => {
    setImporting(true);
    setError("");
    try {
      const parsed = await parseScenarioFile(file);
      const now = new Date().toISOString();
      const project: Project = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.(pdf|docx|md|markdown)$/i, ""),
        fileName: file.name,
        fileType: parsed.fileType,
        fileSize: file.size,
        createdAt: now,
        updatedAt: now,
        status: "imported",
        documentText: parsed.documentText,
        pages: parsed.pages,
        chapters: parsed.chapters,
        analysis: emptyAnalysis(),
      };
      await Promise.all([
        saveProject(project),
        saveSourceFile(project.id, file),
      ]);
      setProjects((items) => [project, ...items]);
      setActiveProject(project);
      setView("structure");
      setToast("剧本已导入，请先确认章节结构。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文档解析失败。");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (project: Project) => {
    if (
      !window.confirm(`确定删除本地项目“${project.name}”吗？此操作不可撤销。`)
    ) {
      return;
    }
    await deleteProject(project.id);
    setProjects((items) => items.filter((item) => item.id !== project.id));
  };

  const includedText = (project: Project) => {
    const includedPages = new Set<number>();
    project.chapters
      .filter((chapter) => chapter.included)
      .forEach((chapter) => {
        for (let page = chapter.startPage; page <= chapter.endPage; page += 1) {
          includedPages.add(page);
        }
      });
    return project.pages
      .filter((page) => includedPages.has(page.pageNumber))
      .map(
        (page) =>
          `[[PDF_PAGE:${page.pageNumber}]]${
            page.printedPage ? `[[PRINTED_PAGE:${page.printedPage}]]` : ""
          }\n${page.text}`,
      )
      .join("\n\n");
  };

  const normalizeReviewItem = (
    item: Partial<ReviewItem>,
    fallbackType: ReviewItem["type"],
  ): ReviewItem => ({
    id: item.id || crypto.randomUUID(),
    type: item.type || fallbackType,
    severity: item.severity || "warning",
    title: item.title || "需要确认",
    description: item.description || "",
    candidateNames: item.candidateNames,
    status: item.status || "pending",
    sources: Array.isArray(item.sources) ? item.sources : [],
    proposal: item.proposal,
    stage: item.stage,
  });

  const runStage = async (
    stage: AnalysisStage,
    projectOverride?: Project,
    resumeData?: Record<string, unknown>,
  ) => {
    const stageProject = projectOverride ?? activeProject;
    if (!stageProject) return;
    setActiveStage(stage);
    setStreamPreview("");
    analysisAbortRef.current = new AbortController();
    setError("");
    const runningProject: Project = {
      ...stageProject,
      status: "analyzing",
      analysis: {
        ...stageProject.analysis,
        stages: {
          ...stageProject.analysis.stages,
          [stage]: { status: "running" },
        },
        activityLog: [
          ...(stageProject.analysis.activityLog ?? []),
          {
            id: crypto.randomUUID(),
            stage,
            kind: "started",
            message: `开始${stageLabels[stage]}分析。`,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    };
    await persistProject(runningProject);

    try {
      let runningAnalysis = runningProject.analysis;
      let scenarioText = includedText(runningProject);
      try {
        const chunks = await hybridSearch(
          runningProject,
          stageQuery(stage, runningProject.analysis),
          12,
          modelConfig,
          apiKey,
        );
        if (chunks.length) {
          scenarioText = chunks
            .sort((a, b) => a.chunk.startPage - b.chunk.startPage)
            .map(({ chunk }) => {
              const printedPage = runningProject.pages.find(
                (page) => page.pageNumber === chunk.startPage,
              )?.printedPage;
              return `[[PDF_PAGE:${chunk.startPage}]]${
                printedPage ? `[[PRINTED_PAGE:${printedPage}]]` : ""
              }\n${chunk.text}`;
            })
            .join("\n\n");
          runningAnalysis = {
            ...runningAnalysis,
            activityLog: [
              ...runningAnalysis.activityLog,
              {
                id: crypto.randomUUID(),
                stage,
                kind: "progress" as const,
                message: `检索注入 ${chunks.length} 个原文块，共 ${scenarioText.length} 字。`,
                createdAt: new Date().toISOString(),
              },
            ],
          };
          await persistProject({ ...runningProject, analysis: runningAnalysis });
        }
      } catch {
        runningAnalysis = {
          ...runningAnalysis,
          activityLog: [
            ...runningAnalysis.activityLog,
            {
              id: crypto.randomUUID(),
              stage,
              kind: "progress" as const,
              message: "检索降级为全文注入。",
              createdAt: new Date().toISOString(),
            },
          ],
        };
        await persistProject({
          ...runningProject,
          analysis: runningAnalysis,
        });
      }
      let responseOk = true;
      let payload: {
        type?: "ask_user" | "complete";
        data?: Record<string, unknown>;
        error?: string;
        callId?: string;
        question?: string;
        options?: string[];
        context?: string;
        previousMessages?: NonNullable<
          Project["analysis"]["pendingAskUserCall"]
        >["previousMessages"];
      };
      if (resumeData) {
        payload = { type: "complete", data: resumeData };
      } else {
      const response = await fetch("/api/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: analysisAbortRef.current.signal,
        body: JSON.stringify({
          action: "analyze",
          stream: true,
          apiKey,
          config: modelConfig,
          stage,
          phase: stage === "acts" ? "skeleton" : undefined,
          confirmMode: modelConfig.confirmMode ?? "tier1",
          document: {
            name: runningProject.name,
            text: scenarioText,
            chapters: runningProject.chapters
              .filter((chapter) => chapter.included)
              .map(({ title, startPage, endPage }) => ({
                title,
                startPage,
                endPage,
              })),
          },
          context: {
            people: runningProject.analysis.people.map(
              ({ id, name, aliases, role }) => ({ id, name, aliases, role }),
            ),
            keeperDecisions: runningProject.analysis.reviewItems
              .filter((item) => item.status === "accepted")
              .map(({ title, description, keeperNote }) => ({
                title,
                description,
                note: keeperNote,
              })),
            priorAnalysis:
              stage === "acts"
                ? {
                    overview: runningAnalysis.overview,
                    timePlace: runningAnalysis.timePlace,
                    people: runningAnalysis.people,
                    characterArcs: runningAnalysis.characterArcs,
                    openingHook: runningAnalysis.openingHook,
                    clues: runningAnalysis.clues,
                  }
                : undefined,
          },
        }),
      });
      if (
        response.headers.get("content-type")?.includes("text/event-stream") &&
        response.body
      ) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach((line) => {
            if (!line.startsWith("data: ") || line === "data: [DONE]") return;
            try {
              const event = JSON.parse(line.slice(6)) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              content += event.choices?.[0]?.delta?.content ?? "";
              setStreamPreview(content);
            } catch {
              /* wait for the next valid SSE event */
            }
          });
        }
        payload = { data: parseModelJson(content) };
      } else {
        payload = (await response.json()) as {
          type?: "ask_user" | "complete";
          data?: Record<string, unknown>;
          error?: string;
          callId?: string;
          question?: string;
          options?: string[];
          context?: string;
          previousMessages?: NonNullable<
            Project["analysis"]["pendingAskUserCall"]
          >["previousMessages"];
        };
      }
      responseOk = response.ok;
      if (
        response.ok &&
        payload.type === "ask_user" &&
        payload.callId &&
        payload.question &&
        payload.previousMessages
      ) {
        const pendingAskUserCall = {
          stage,
          callId: payload.callId,
          question: payload.question,
          options: payload.options ?? [],
          context: payload.context ?? "模型需要 KP 裁决后才能继续。",
          previousMessages: payload.previousMessages,
        };
        await persistProject({
          ...runningProject,
          status: "structured",
          analysis: {
            ...runningAnalysis,
            pendingAskUserCall,
            stages: {
              ...runningAnalysis.stages,
              [stage]: { status: "paused", updatedAt: new Date().toISOString() },
            },
            activityLog: [
              ...runningAnalysis.activityLog,
              {
                id: crypto.randomUUID(),
                stage,
                kind: "paused",
                message: `${stageLabels[stage]}实时暂停，等待 KP 裁决。`,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        });
        setWizardStage(stage);
        return;
      }
      }
      if (
        stage === "acts" &&
        responseOk &&
        payload.data &&
        Array.isArray(payload.data.acts)
      ) {
        const detailResponse = await fetch("/api/model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: analysisAbortRef.current.signal,
          body: JSON.stringify({
            action: "analyze",
            apiKey,
            config: modelConfig,
            stage,
            phase: "detail",
            confirmMode: modelConfig.confirmMode ?? "tier1",
            document: {
              name: runningProject.name,
              text: scenarioText,
              chapters: runningProject.chapters
                .filter((chapter) => chapter.included)
                .map(({ title, startPage, endPage }) => ({
                  title,
                  startPage,
                  endPage,
                })),
            },
            context: {
              people: runningAnalysis.people.map(
                ({ id, name, aliases, role }) => ({ id, name, aliases, role }),
              ),
              priorAnalysis: {
                overview: runningAnalysis.overview,
                timePlace: runningAnalysis.timePlace,
                characterArcs: runningAnalysis.characterArcs,
                openingHook: runningAnalysis.openingHook,
                clues: runningAnalysis.clues,
              },
              actSkeleton: payload.data.acts,
            },
          }),
        });
        const detailPayload = (await detailResponse.json()) as {
          type?: "complete";
          data?: Record<string, unknown>;
          error?: string;
        };
        if (!detailResponse.ok || !detailPayload.data) {
          throw new Error(detailPayload.error || "幕详情生成失败。");
        }
        payload = detailPayload;
      }
      if (!responseOk || !payload.data) {
        throw new Error(payload.error || "分析失败。");
      }

      const data = payload.data;
      let nextAnalysis = { ...runningAnalysis };
      const generatedReviews: ReviewItem[] = [];
      const quoteIssues = verifySourceRefs(data, runningProject.pages);
      flagUnverifiedSourceRefs(data, quoteIssues);
      quoteIssues.forEach((issue) =>
        generatedReviews.push({
          id: crypto.randomUUID(),
          type: "quote",
          severity: "warning",
          title: "引用未命中原文",
          description: `模型在 ${issue.path} 引用了第 ${issue.page} 页，但原文未能匹配：“${issue.quote}”。请核对或修订该结论。`,
          status: "pending",
          sources: [
            { page: issue.page, quote: issue.quote, verified: false },
          ],
          stage,
        }),
      );
      const returnedReviews = Array.isArray(data.reviewItems)
        ? (data.reviewItems as Partial<ReviewItem>[]).map((item) =>
            normalizeReviewItem(item, "event"),
          )
        : [];

      if (stage === "background" && data.overview) {
        const rawOverview = data.overview as Partial<
          NonNullable<Project["analysis"]["overview"]>
        >;
        const overview: NonNullable<Project["analysis"]["overview"]> = {
          oneLine: String(rawOverview.oneLine ?? ""),
          cause: String(rawOverview.cause ?? ""),
          history: String(rawOverview.history ?? ""),
          currentState: String(rawOverview.currentState ?? ""),
          plans: Array.isArray(rawOverview.plans) ? rawOverview.plans : [],
          endings: Array.isArray(rawOverview.endings)
            ? rawOverview.endings
            : [],
          externalDependencies: Array.isArray(rawOverview.externalDependencies)
            ? rawOverview.externalDependencies
            : [],
          conflicts: Array.isArray(rawOverview.conflicts)
            ? rawOverview.conflicts
            : [],
        };
        nextAnalysis = {
          ...nextAnalysis,
          overview,
        };
        overview.externalDependencies.forEach((description) => {
          generatedReviews.push({
            id: crypto.randomUUID(),
            type: "external",
            severity: "warning",
            title: "剧本引用了外部资料",
            description,
            status: "pending",
            sources: [],
          });
        });
        overview.conflicts.forEach((conflict) => {
          generatedReviews.push({
            id: crypto.randomUUID(),
            type: "conflict",
            severity: "critical",
            title: `原作存在矛盾：${conflict.summary}`,
            description: `原文中出现了上述不一致。可能的解释或处理方式：${conflict.options.join("；")}`,
            status: "pending",
            sources: conflict.sources,
          });
        });
      }
      if (stage === "characters" && Array.isArray(data.people)) {
        const people = (data.people as Person[]).map((person) => ({
          ...person,
          id: person.id || crypto.randomUUID(),
          name: String(person.name ?? "未命名对象"),
          aliases: Array.isArray(person.aliases) ? person.aliases : [],
          role: String(person.role ?? ""),
          organization: String(person.organization ?? ""),
          importance: person.importance || "minor",
          publicIdentity: String(person.publicIdentity ?? ""),
          trueIdentity: String(person.trueIdentity ?? ""),
          motivation: String(person.motivation ?? ""),
          secrets: Array.isArray(person.secrets) ? person.secrets : [],
          sources: Array.isArray(person.sources) ? person.sources : [],
          provenance: person.provenance || "source",
          confidence: Number(person.confidence ?? 0.5),
        }));
        nextAnalysis = { ...nextAnalysis, people };
        if (Array.isArray(data.mergeCandidates)) {
          (
            data.mergeCandidates as Array<{
              names?: string[];
              reason?: string;
              sources?: SourceRef[];
            }>
          ).forEach((candidate) => {
            generatedReviews.push({
              id: crypto.randomUUID(),
              type: "merge",
              severity: "critical",
              title: `确认“${candidate.names?.join(" / ") || "两个称呼"}”是否为同一对象`,
              description:
                candidate.reason || "模型认为这些称呼可能指向同一对象。",
              candidateNames: candidate.names,
              status: "pending",
              sources: candidate.sources || [],
            });
          });
        }
      }
      if (stage === "timeplace" && data.timePlace) {
        const raw = data.timePlace as Partial<TimePlace>;
        const timePlace: TimePlace = {
          timeline: String(raw.timeline ?? ""),
          places: Array.isArray(raw.places) ? raw.places : [],
        };
        nextAnalysis = {
          ...nextAnalysis,
          timePlace,
          places: timePlace.places,
        };
      }
      if (stage === "characterArcs" && Array.isArray(data.characterArcs)) {
        const characterArcs = (data.characterArcs as CharacterArc[]).map(
          (arc) => ({
            personId: String(arc.personId ?? ""),
            experience: String(arc.experience ?? ""),
            motivation: String(arc.motivation ?? ""),
          }),
        );
        nextAnalysis = { ...nextAnalysis, characterArcs };
      }
      if (stage === "openingHook" && data.openingHook !== undefined) {
        nextAnalysis = {
          ...nextAnalysis,
          openingHook: String(data.openingHook ?? ""),
        };
      }
      if (stage === "clues" && Array.isArray(data.clues)) {
        const clues = (data.clues as Clue[]).map((clue) => ({
          ...clue,
          id: clue.id || crypto.randomUUID(),
          name: String(clue.name ?? "未命名线索"),
          summary: String(clue.summary ?? ""),
          source: String(clue.source ?? "来源待确认"),
          importance:
            clue.importance === "key" ||
            clue.importance === "secondary" ||
            clue.importance === "other"
              ? clue.importance
              : "secondary",
          targets: Array.isArray(clue.targets)
            ? clue.targets.map((target) => ({
                id: String(target.id || crypto.randomUUID()),
                type: ["person", "place", "event", "truth"].includes(
                  target.type,
                )
                  ? target.type
                  : "event",
                label: String(target.label ?? "未命名目标"),
                priority: (target.priority === "secondary"
                  ? "secondary"
                  : "primary") as "primary" | "secondary",
                confirmed: target.type === "truth" ? false : true,
              }))
            : [],
          confidence: Number(clue.confidence ?? 0.5),
          provenance: clue.provenance || "source",
          sources: Array.isArray(clue.sources) ? clue.sources : [],
        }));
        const knownPlaces = [...(nextAnalysis.places ?? [])];
        clues
          .flatMap((clue) =>
            clue.targets
              .filter((target) => target.type === "place")
              .map((target) => ({ target, clue })),
          )
          .forEach(({ target, clue }) => {
            const targetName = target.label.trim().toLocaleLowerCase();
            const existing = knownPlaces.find((place) =>
              [place.name, ...place.aliases].some(
                (name) => name.trim().toLocaleLowerCase() === targetName,
              ),
            );
            if (existing) {
              if (existing.confirmed) target.id = existing.id;
              return;
            }
            const place = {
              id: crypto.randomUUID(),
              name: target.label,
              aliases: [],
              summary: `由线索“${clue.name}”提名的地点。`,
              confirmed: false,
              provenance: "inference" as const,
              sources: clue.sources,
            };
            knownPlaces.push(place);
            generatedReviews.push({
              id: crypto.randomUUID(),
              type: "place",
              severity: "warning",
              title: `确认地点：“${place.name}”`,
              description: `AI 从线索“${clue.name}”中提名了地点“${place.name}”。接受后将成为正式地点实体。`,
              status: "pending",
              sources: clue.sources,
              proposal: { kind: "placeConfirm", placeId: place.id },
            });
          });
        nextAnalysis = { ...nextAnalysis, clues, places: knownPlaces };
        clues.forEach((clue) => {
          clue.targets
            .filter((target) => target.type === "truth" && !target.confirmed)
            .forEach((target) => {
              generatedReviews.push({
                id: crypto.randomUUID(),
                type: "event",
                severity: "warning",
                title: `确认真相节点：“${target.label}”`,
                description: `AI 根据线索“${clue.name}”归纳出该真相节点。接受后，它才会进入正式线索网络；请核对线索来源与推理是否成立。`,
                status: "pending",
                sources: clue.sources,
                proposal: {
                  kind: "clueTruth",
                  clueId: clue.id,
                  targetId: target.id,
                },
              });
            });
        });
      }
      if (stage === "acts" && Array.isArray(data.acts)) {
        const acts = (data.acts as Act[])
          .map((act, index) => ({
            ...act,
            id: String(act.id || crypto.randomUUID()),
            title: String(act.title || `第 ${index + 1} 幕`),
            sequence: Number(act.sequence || index + 1),
            placeId: act.placeId ? String(act.placeId) : undefined,
            placeText: act.placeText ? String(act.placeText) : undefined,
            time: String(act.time || "时间不明"),
            personIds: Array.isArray(act.personIds)
              ? act.personIds.map(String)
              : [],
            clueIds: Array.isArray(act.clueIds) ? act.clueIds.map(String) : [],
            branches: Array.isArray(act.branches)
              ? act.branches.map((branch) => ({
                  ...branch,
                  id: String(branch.id || crypto.randomUUID()),
                  condition: String(branch.condition || "条件待补充"),
                }))
              : [],
            keyEvents: Array.isArray(act.keyEvents) ? act.keyEvents : [],
            description: String(act.description || ""),
          }))
          .sort((left, right) => left.sequence - right.sequence);
        nextAnalysis = { ...nextAnalysis, acts };
      }

      const stageReviews = [...returnedReviews, ...generatedReviews].map(
        (item) => ({
          ...item,
          stage,
        }),
      );
      const shouldPause =
        (modelConfig.confirmMode ?? "tier1") === "tier3" &&
        PAUSE_STAGES.includes(stage) &&
        stageReviews.some((item) => item.status === "pending");
      nextAnalysis = {
        ...nextAnalysis,
        pendingAskUserCall: undefined,
        reviewItems: [
          ...nextAnalysis.reviewItems.filter(
            (item) =>
              item.status !== "pending" ||
              !(
                (stage === "characters" && item.type === "merge") ||
                (stage === "clues" &&
                  (item.proposal?.kind === "clueTruth" ||
                    item.proposal?.kind === "placeConfirm"))
              ),
          ),
          ...stageReviews,
        ],
        stages: {
          ...nextAnalysis.stages,
          [stage]: {
            status: shouldPause ? "paused" : "complete",
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const allComplete = Object.values(nextAnalysis.stages).every(
        (state) => state.status === "complete",
      );
      const completedProject: Project = {
        ...runningProject,
        updatedAt: new Date().toISOString(),
        status: allComplete ? "ready" : "structured",
        analysis: {
          ...nextAnalysis,
          activityLog: [
            ...(nextAnalysis.activityLog ?? []),
            {
              id: crypto.randomUUID(),
              stage,
              kind: shouldPause ? "paused" : "completed",
              message: shouldPause
                ? `${stageLabels[stage]}完成，${stageReviews.length} 项待确认。`
                : `${stageLabels[stage]}分析完成。`,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      };
      await persistProject(completedProject);
      setStreamPreview("");
      setToast(`${stageLabels[stage]}分析完成。`);
      if (shouldPause) setWizardStage(stage);
      else window.setTimeout(() => void continueToNextStage(stage, completedProject), 0);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        const pausedProject: Project = {
          ...runningProject,
          status: "structured",
          analysis: {
            ...runningProject.analysis,
            stages: {
              ...runningProject.analysis.stages,
              [stage]: { status: "paused" },
            },
            activityLog: [
              ...(runningProject.analysis.activityLog ?? []),
              {
                id: crypto.randomUUID(),
                stage,
                kind: "paused",
                message: `${stageLabels[stage]}已由 KP 手动暂停。`,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        };
        await persistProject(pausedProject);
        setToast(`${stageLabels[stage]}已暂停。可重新开始该阶段。`);
        return;
      }
      const message = caught instanceof Error ? caught.message : "分析失败。";
      const failedProject: Project = {
        ...runningProject,
        status: "structured",
        analysis: {
          ...runningProject.analysis,
          stages: {
            ...runningProject.analysis.stages,
            [stage]: { status: "error", error: message },
          },
          activityLog: [
            ...(runningProject.analysis.activityLog ?? []),
            {
              id: crypto.randomUUID(),
              stage,
              kind: "error",
              message: `${stageLabels[stage]}分析失败：${message}`,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      };
      await persistProject(failedProject);
      setError(message);
    } finally {
      setActiveStage(null);
      setStreamPreview("");
      analysisAbortRef.current = null;
    }
  };

  const continueRealtimeAnalysis = async (
    answer: string,
    keeperNote?: string,
  ) => {
    const pending = activeProject?.analysis.pendingAskUserCall;
    if (!activeProject || !pending) return;
    if (
      analysisAbortRef.current &&
      !analysisAbortRef.current.signal.aborted
    ) {
      analysisAbortRef.current.abort();
    }
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setActiveStage(pending.stage);
    setError("");
    try {
      const response = await fetch("/api/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "continue",
          apiKey,
          config: modelConfig,
          stage: pending.stage,
          confirmMode: modelConfig.confirmMode ?? "tier1",
          callId: pending.callId,
          answer: keeperNote ? `${answer}\nKP 备注：${keeperNote}` : answer,
          previousMessages: pending.previousMessages,
        }),
      });
      const payload = (await response.json()) as {
        type?: "ask_user" | "complete";
        data?: Record<string, unknown>;
        error?: string;
        callId?: string;
        question?: string;
        options?: string[];
        context?: string;
        previousMessages?: typeof pending.previousMessages;
      };
      if (!response.ok) throw new Error(payload.error || "继续分析失败。");
      if (
        payload.type === "ask_user" &&
        payload.callId &&
        payload.question &&
        payload.previousMessages
      ) {
        await persistProject({
          ...activeProject,
          updatedAt: new Date().toISOString(),
          analysis: {
            ...activeProject.analysis,
            pendingAskUserCall: {
              stage: pending.stage,
              callId: payload.callId,
              question: payload.question,
              options: payload.options ?? [],
              context: payload.context ?? "模型需要进一步裁决。",
              previousMessages: payload.previousMessages,
            },
            activityLog: [
              ...activeProject.analysis.activityLog,
              {
                id: crypto.randomUUID(),
                stage: pending.stage,
                kind: "checkpoint",
                message: `${stageLabels[pending.stage]}继续后再次请求 KP 裁决。`,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        });
        setWizardStage(pending.stage);
        return;
      }
      if (payload.type !== "complete" || !payload.data) {
        throw new Error("模型继续响应中没有完整分析结果。");
      }
      const resumedProject: Project = {
        ...activeProject,
        analysis: {
          ...activeProject.analysis,
          pendingAskUserCall: undefined,
          stages: {
            ...activeProject.analysis.stages,
            [pending.stage]: { status: "running" },
          },
        },
      };
      setWizardStage(null);
      await runStage(pending.stage, resumedProject, payload.data);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        if (analysisAbortRef.current === controller) setActiveStage(null);
        return;
      }
      setError(caught instanceof Error ? caught.message : "继续分析失败。");
    } finally {
      if (
        analysisAbortRef.current === controller &&
        !controller.signal.aborted
      ) {
        analysisAbortRef.current = null;
        setActiveStage(null);
      }
    }
  };

  const continueToNextStage = async (
    currentStage: AnalysisStage,
    project: Project,
  ) => {
    const currentIndex = STAGE_ORDER.indexOf(currentStage);
    const nextStage = STAGE_ORDER.slice(currentIndex + 1).find(
      (candidate) => project.analysis.stages[candidate].status !== "complete",
    );
    if (!nextStage) {
      if (project.status !== "ready") {
        await persistProject({ ...project, status: "ready" });
      }
      setWizardStage(null);
      setToast("全部分析阶段已完成。");
      return;
    }
    setWizardStage(null);
    await runStage(nextStage, project);
  };

  const resolveReview = async (
    item: ReviewItem,
    accepted: boolean,
    keeperNote?: string,
  ) => {
    if (!activeProject) return;
    let people = [...activeProject.analysis.people];
    let acts = [...activeProject.analysis.acts];
    let clues = [...(activeProject.analysis.clues ?? [])];
    let places = [...(activeProject.analysis.places ?? [])];
    if (accepted && item.type === "merge" && item.candidateNames?.length) {
      const candidates = people.filter((person) =>
        item.candidateNames!.some(
          (name) =>
            person.name === name ||
            person.aliases.some((alias) => alias === name),
        ),
      );
      if (candidates.length >= 2) {
        const keeper = candidates[0];
        const removed = candidates.slice(1);
        const removedIds = new Set(removed.map((person) => person.id));
        const merged: Person = {
          ...keeper,
          aliases: Array.from(
            new Set([
              ...keeper.aliases,
              ...removed.flatMap((person) => [person.name, ...person.aliases]),
            ]),
          ),
          secrets: Array.from(
            new Set([
              ...keeper.secrets,
              ...removed.flatMap((person) => person.secrets),
            ]),
          ),
          sources: [
            ...keeper.sources,
            ...removed.flatMap((person) => person.sources),
          ],
          provenance: "keeper",
        };
        people = people
          .filter(
            (person) => !removedIds.has(person.id) && person.id !== keeper.id,
          )
          .concat(merged);
        acts = acts.map((act) => ({
          ...act,
          personIds: Array.from(
            new Set(
              act.personIds.map((personId) =>
                removedIds.has(personId) ? keeper.id : personId,
              ),
            ),
          ),
        }));
      }
    }
    if (accepted && item.proposal?.kind === "clueTruth") {
      const proposal = item.proposal;
      clues = clues.map((clue) =>
        clue.id === proposal.clueId
          ? {
              ...clue,
              targets: clue.targets.map((target) =>
                target.id === proposal.targetId
                  ? { ...target, confirmed: true }
                  : target,
              ),
            }
          : clue,
      );
    }
    if (item.proposal?.kind === "placeConfirm") {
      const proposal = item.proposal;
      const proposedPlace = places.find(
        (place) => place.id === proposal.placeId,
      );
      places = accepted
        ? places.map((place) =>
            place.id === proposal.placeId
              ? { ...place, confirmed: true }
              : place,
          )
        : places.filter((place) => place.id !== proposal.placeId);
      if (accepted && proposedPlace) {
        const names = new Set(
          [proposedPlace.name, ...proposedPlace.aliases].map((name) =>
            name.trim().toLocaleLowerCase(),
          ),
        );
        clues = clues.map((clue) => ({
          ...clue,
          targets: clue.targets.map((target) =>
            target.type === "place" &&
            names.has(target.label.trim().toLocaleLowerCase())
              ? { ...target, id: proposedPlace.id }
              : target,
          ),
        }));
      }
    }
    const reviewItems: ReviewItem[] = activeProject.analysis.reviewItems.map(
      (review) =>
        review.id === item.id
          ? {
              ...review,
              ...item,
              status: accepted ? ("accepted" as const) : ("rejected" as const),
              keeperNote: keeperNote ?? review.keeperNote,
            }
          : review,
    );
    const stageCleared =
      Boolean(item.stage) &&
      !reviewItems.some(
        (review) =>
          review.stage === item.stage &&
          review.status === "pending",
      );
    const remainingForStage = item.stage
      ? reviewItems.filter(
          (review) =>
            review.stage === item.stage && review.status === "pending",
        ).length
      : 0;
    const next: Project = {
      ...activeProject,
      updatedAt: new Date().toISOString(),
      analysis: {
        ...activeProject.analysis,
        people,
        acts,
        clues,
        places,
        reviewItems,
        stages:
          stageCleared && item.stage
            ? {
                ...activeProject.analysis.stages,
                [item.stage]: {
                  status: "complete",
                  updatedAt: new Date().toISOString(),
                },
              }
            : activeProject.analysis.stages,
        activityLog: item.stage
          ? [
              ...(activeProject.analysis.activityLog ?? []),
              {
                id: crypto.randomUUID(),
                stage: item.stage,
                kind: stageCleared ? "completed" : "checkpoint",
                message: stageCleared
                  ? `${stageLabels[item.stage]}的待确认事项已全部处理。`
                  : `${stageLabels[item.stage]}确认项已处理，剩余 ${remainingForStage} 项。`,
                createdAt: new Date().toISOString(),
              },
            ]
          : activeProject.analysis.activityLog,
      },
    };
    await persistProject(next);
    if (stageCleared && item.stage && wizardStage === item.stage) {
      window.setTimeout(
        () => void continueToNextStage(item.stage!, next),
        0,
      );
    }
  };

  const editReview = async (item: ReviewItem, changes: Partial<ReviewItem>) => {
    if (!activeProject) return;
    await persistProject({
      ...activeProject,
      updatedAt: new Date().toISOString(),
      analysis: {
        ...activeProject.analysis,
        reviewItems: activeProject.analysis.reviewItems.map((review) =>
          review.id === item.id ? { ...review, ...changes } : review,
        ),
      },
    });
  };

  const testConnection = async () => {
    setTestState("testing");
    try {
      const response = await fetch("/api/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          apiKey,
          config: modelConfig,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "连接失败。");
      setTestState("success");
      setToast("模型连接成功。");
      void probeEmbedding(modelConfig, apiKey).then((embedding) => {
        setModelConfig((current) => ({
          ...current,
          capabilities: {
            chat: { model: current.model },
            ...(embedding ? { embedding } : {}),
          },
        }));
        if (embedding && activeProject) {
          void ensureVectorIndex(
            activeProject,
            embedding,
            modelConfig,
            apiKey,
          ).catch(() => {
            // Vector retrieval is optional; keyword search remains available.
          });
        }
      });
    } catch (caught) {
      setTestState("error");
      setError(caught instanceof Error ? caught.message : "连接失败。");
    }
  };

  const pendingCount =
    activeProject?.analysis.reviewItems.filter(
      (item) => item.status === "pending",
    ).length ?? 0;
  const wizardItems =
    activeProject && wizardStage
      ? activeProject.analysis.reviewItems.filter(
          (item) => item.stage === wizardStage && item.status === "pending",
        )
      : [];
  const wizardItem = wizardItems[0];
  const realtimeAskUserCall = activeProject?.analysis.pendingAskUserCall;
  const configReady = Boolean(
    modelConfig.baseUrl.trim() && modelConfig.model.trim() && apiKey.trim(),
  );

  if (!activeProject) {
    if (view === "settings") {
      return (
        <div className="standalone-settings">
          <button className="back-button" onClick={() => setView("dashboard")}>
            ← 返回项目
          </button>
          <SettingsView
            config={modelConfig}
            apiKey={apiKey}
            testState={testState}
            onConfig={setModelConfig}
            onApiKey={setApiKey}
            onTest={testConnection}
          />
          {toast && <div className="toast">{toast}</div>}
          {error && <div className="error-toast">{error}</div>}
        </div>
      );
    }
    return (
      <>
        <ProjectHome
          projects={projects}
          importing={importing}
          error={error}
          onImport={handleImport}
          onOpen={(project) => {
            setActiveProject(project);
            setWizardStage(pausedStageFor(project));
            setView("dashboard");
          }}
          onDelete={handleDelete}
          onOpenSettings={() => setView("settings")}
        />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="sidebar-brand"
          onClick={() => {
            setActiveProject(null);
            setView("dashboard");
          }}
        >
          <span>KA</span>
          <div>
            <strong>守秘人图谱</strong>
            <small>LOCAL WORKBENCH</small>
          </div>
        </button>
        <nav>
          <span className="nav-label">项目</span>
          {navigation.map((item) => (
            <button
              key={item.view}
              className={view === item.view ? "active" : ""}
              onClick={() => {
                setView(item.view);
                setSelectedPersonId(null);
                setSelectedEventId(null);
              }}
            >
              <i>{item.short}</i>
              <span>{item.label}</span>
              {item.view === "review" && pendingCount > 0 && (
                <b>{pendingCount}</b>
              )}
            </button>
          ))}
          <span className="nav-label nav-second">系统</span>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
          >
            <i>设</i>
            <span>模型连接</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="local-dot" />
          <div>
            <strong>仅本机访问</strong>
            <small>127.0.0.1</small>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-topbar">
          <div className="breadcrumb">
            <button onClick={() => setActiveProject(null)}>项目</button>
            <span>/</span>
            <strong>{activeProject.name}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`project-status status-${activeProject.status}`}>
              {statusLabel(activeProject.status)}
            </span>
            <button
              className="primary-button compact"
              onClick={() => setView("analysis")}
            >
              {activeStage ? "分析进行中…" : "分析剧本"}
            </button>
          </div>
        </header>

        <main className="workspace-main">
          {view === "dashboard" && (
            <DashboardView project={activeProject} onNavigate={setView} />
          )}
          {view === "structure" && (
            <StructureView
              project={activeProject}
              onChange={persistProject}
              onConfirm={() => {
                void persistProject({
                  ...activeProject,
                  status: "structured",
                  updatedAt: new Date().toISOString(),
                });
                setView("analysis");
              }}
            />
          )}
          {view === "analysis" && (
            <AnalysisView
              project={activeProject}
              configReady={configReady}
              activeStage={activeStage}
              streamPreview={streamPreview}
              reviewItems={activeProject.analysis.reviewItems}
              onResolveReview={resolveReview}
              onEditReview={editReview}
              onPause={() => analysisAbortRef.current?.abort()}
              onRun={runStage}
              onNavigate={setView}
            />
          )}
          {view === "overview" && (
            <OverviewView project={activeProject} onOpenSource={setSourceRef} />
          )}
          {view === "acts" && (
            <EmptyState
              title="尚未生成幕"
              description="完成七阶段分析后，这里会显示幕列表与分支树状图。"
            />
          )}
          {view === "review" && (
            <ReviewView
              items={activeProject.analysis.reviewItems}
              onResolve={resolveReview}
              onEdit={editReview}
              onOpenSource={setSourceRef}
            />
          )}
          {view === "settings" && (
            <SettingsView
              config={modelConfig}
              apiKey={apiKey}
              testState={testState}
              onConfig={setModelConfig}
              onApiKey={setApiKey}
              onTest={testConnection}
            />
          )}
        </main>
      </section>

      {sourceRef && (
        <SourcePanel
          project={activeProject}
          source={sourceRef}
          sourceUrl={sourceUrl}
          onClose={() => setSourceRef(null)}
        />
      )}
      {realtimeAskUserCall ? (
        <ConfirmWizard
          key={realtimeAskUserCall.callId}
          askUserCall={realtimeAskUserCall}
          totalPending={1}
          onAccept={(answer, keeperNote) =>
            void continueRealtimeAnalysis(answer, keeperNote)
          }
          onReject={(keeperNote) =>
            void continueRealtimeAnalysis(
              "KP 拒绝当前建议；请依据原文继续，并且不要采用该假设。",
              keeperNote,
            )
          }
        />
      ) : wizardItem ? (
        <ConfirmWizard
          key={wizardItem.id}
          item={wizardItem}
          totalPending={wizardItems.length}
          onAccept={(_, keeperNote) =>
            void resolveReview(wizardItem, true, keeperNote)
          }
          onReject={(keeperNote) =>
            void resolveReview(wizardItem, false, keeperNote)
          }
        />
      ) : null}
      {toast && <div className="toast">{toast}</div>}
      {error && (
        <div className="error-toast">
          <span>{error}</span>
          <button onClick={() => setError("")}>×</button>
        </div>
      )}
    </div>
  );
}
