"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  getSmoothStepPath,
  useNodesState,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import { parseScenarioFile } from "@/lib/parser";
import { hybridSearch, stageQuery } from "@/lib/retrieval";
import { ensureVectorIndex, probeEmbedding } from "@/lib/embedding";
import {
  flagUnverifiedSourceRefs,
  verifySourceRefs,
} from "@/lib/quote-check";
import {
  filterClueView,
  filterRelationshipView,
  hasGraphPosition,
  layoutWithElk,
  partitionRelationsByPeople,
  savedGraphPosition,
  selectRelationshipPeople,
} from "@/lib/graph-layout";
import { AtlasMapView } from "@/app/components/atlas-map";
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
  type Clue,
  type ModelConfig,
  type Person,
  type Project,
  type Provenance,
  type Relation,
  type ReviewItem,
  type SourceRef,
  type TimelineEvent,
} from "@/lib/types";

type View =
  | "dashboard"
  | "structure"
  | "analysis"
  | "overview"
  | "relations"
  | "timeline"
  | "clues"
  | "map"
  | "review"
  | "settings";

const stageLabels: Record<AnalysisStage, string> = {
  overview: "故事概览",
  people: "人物识别",
  relations: "关系梳理",
  timeline: "分支时间线",
  clues: "线索网络",
};

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
  { view: "relations", label: "人物关系", short: "人" },
  { view: "timeline", label: "分支时间线", short: "时" },
  { view: "clues", label: "线索网络", short: "线" },
  { view: "map", label: "地图", short: "图" },
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
    overview: {
      id: "overview",
      number: "01",
      description: "梳理起因、历史真相、开局状态与各方计划。",
      target: "overview",
    },
    people: {
      id: "people",
      number: "02",
      description: "识别人名、组织、公开身份与真实动机。",
      target: "relations",
    },
    relations: {
      id: "relations",
      number: "02",
      description: "在已识别人物的基础上，梳理真实、公开与主观关系。",
      requires: "people",
      target: "relations",
    },
    timeline: {
      id: "timeline",
      number: "03",
      description: "建立固定历史、默认走向和关键干预分支。",
      target: "timeline",
    },
    clues: {
      id: "clues",
      number: "04",
      description: "梳理调查线索、关键真相、替代入口与卡关风险。",
      target: "clues",
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
  const peopleStatus = project.analysis.stages.people.status;
  const relationsStatus = project.analysis.stages.relations.status;
  const characterGroupStatus =
    peopleStatus === "running" || relationsStatus === "running"
      ? "running"
      : peopleStatus === "error" || relationsStatus === "error"
        ? "error"
        : peopleStatus === "complete" && relationsStatus === "complete"
          ? "complete"
          : "idle";
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
        <article
          className={`pipeline-card pipeline-${project.analysis.stages.overview.status}`}
        >
          {renderStage(stages.overview)}
        </article>
        <article
          className={`pipeline-card pipeline-character-group pipeline-${characterGroupStatus}`}
        >
          <header className="pipeline-group-header">
            <div>
              <span>02</span>
              <h3>人物与关系</h3>
            </div>
            <div className="pipeline-group-meta">
              <span
                className={`pipeline-status status-${characterGroupStatus}`}
              >
                {characterGroupStatus === "complete"
                  ? "已完成"
                  : characterGroupStatus === "running"
                    ? "分析中"
                    : characterGroupStatus === "error"
                      ? "需要处理"
                      : peopleStatus === "complete"
                        ? "人物已完成，关系待生成"
                        : "未开始"}
              </span>
              <p>先确认人物，再依据同一份人物表建立关系图。</p>
            </div>
          </header>
          <div className="pipeline-character-content">
            <p>识别人名、身份与动机，然后基于确认的人物生成关系图。</p>
            <div className="pipeline-actions">
              <button
                className="primary-button compact"
                disabled={!configReady || activeStage !== null}
                onClick={() => onRun("people")}
              >
                {activeStage === "people" || activeStage === "relations"
                  ? "正在分析人物与关系…"
                  : peopleStatus === "complete" &&
                      relationsStatus === "complete"
                    ? "重新分析人物与关系"
                    : "分析人物与关系"}
              </button>
              {relationsStatus === "complete" && (
                <button
                  className="text-button"
                  onClick={() => onNavigate("relations")}
                >
                  查看关系图
                </button>
              )}
            </div>
          </div>
        </article>
        <article
          className={`pipeline-card pipeline-${project.analysis.stages.timeline.status}`}
        >
          {renderStage(stages.timeline)}
        </article>
        <article
          className={`pipeline-card pipeline-${project.analysis.stages.clues?.status ?? "idle"}`}
        >
          {renderStage(stages.clues)}
        </article>
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

type RelationshipNodeData = {
  person: Person;
  onSelect: (id: string) => void;
};

function RelationshipNode({
  data,
  selected,
}: NodeProps<Node<RelationshipNodeData>>) {
  const { person, onSelect } = data;
  return (
    <button
      className={`flow-person-node importance-${person.importance} ${selected ? "is-selected" : ""}`}
      onClick={() => onSelect(person.id)}
    >
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <span className="node-sigil">
        {person.name.trim().slice(0, 1).toUpperCase()}
      </span>
      <strong>{person.name}</strong>
      <small>{person.role || "身份待确认"}</small>
      {person.provenance !== "source" && (
        <i className={`node-alert alert-${person.provenance}`} />
      )}
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </button>
  );
}

type OrganizationNodeData = {
  organization: string;
  collapsed: boolean;
};

function OrganizationNode({ data }: NodeProps<Node<OrganizationNodeData>>) {
  return (
    <section
      className={`flow-organization-node ${data.collapsed ? "is-collapsed" : ""}`}
    >
      {data.collapsed && (
        <Handle type="target" position={Position.Left} className="flow-handle" />
      )}
      <strong>{data.organization}</strong>
      {data.collapsed && <small>组织（已折叠）</small>}
      {data.collapsed && (
        <Handle type="source" position={Position.Right} className="flow-handle" />
      )}
    </section>
  );
}

const relationshipNodeTypes = {
  person: RelationshipNode,
  organization: OrganizationNode,
};

type ClueFlowNodeData = {
  clue: Clue;
  onOpenSource: (source: SourceRef) => void;
  onEdit: (clue: Clue) => void;
};

type ClueTargetFlowNodeData = {
  label: string;
  type: "person" | "place" | "event" | "truth";
};

function ClueFlowNode({ data }: NodeProps<Node<ClueFlowNodeData>>) {
  const { clue, onOpenSource, onEdit } = data;
  return (
    <article className={`flow-clue-node clue-${clue.importance}`}>
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <span className="flow-node-kicker">
        {clue.importance === "key"
          ? "关键线索"
          : clue.importance === "secondary"
            ? "次要线索"
            : "其他线索"}
      </span>
      <strong>{clue.name}</strong>
      <small>{clue.source}</small>
      {clue.risk && <i className="flow-clue-risk">!</i>}
      {clue.sources[0] && (
        <button
          className="flow-source-button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenSource(clue.sources[0]);
          }}
        >
          原文依据 ↗
        </button>
      )}
      <button
        className="flow-edit-button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit(clue);
        }}
      >
        编辑
      </button>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </article>
  );
}

function ClueTargetFlowNode({ data }: NodeProps<Node<ClueTargetFlowNodeData>>) {
  const labels = {
    person: "人物",
    place: "地点",
    event: "事件",
    truth: "真相",
  };
  return (
    <article className={`flow-clue-target target-${data.type}`}>
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <span>{labels[data.type]}</span>
      <strong>{data.label}</strong>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </article>
  );
}

const clueNodeTypes = { clue: ClueFlowNode, clueTarget: ClueTargetFlowNode };

function layoutRelationshipNodes(
  people: Person[],
  relations: Relation[],
  onSelect: (id: string) => void,
  savedLayout: Record<string, { x: number; y: number }>,
): Node<RelationshipNodeData>[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: 320,
    nodesep: 165,
    edgesep: 90,
    marginx: 110,
    marginy: 100,
  });
  people.forEach((person) =>
    graph.setNode(person.id, { width: 240, height: 116 }),
  );
  relations.forEach((relation) =>
    graph.setEdge(relation.sourceId, relation.targetId),
  );
  dagre.layout(graph);
  return people.map((person, index) => {
    const position = graph.node(person.id);
    return {
      id: person.id,
      type: "person",
      position: savedGraphPosition(
        savedLayout,
        person.id,
        position
          ? { x: position.x - 120, y: position.y - 58 }
          : {
              x: 100 + (index % 4) * 390,
              y: 100 + Math.floor(index / 4) * 260,
            },
      ),
      data: { person, onSelect },
    };
  });
}

type RelationshipFlowEdge = Edge<
  { label?: string; edgeClass: string },
  "relation"
>;

function RelationshipEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<RelationshipFlowEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });
  return (
    <>
      <path
        d={edgePath}
        markerEnd={markerEnd}
        style={style}
        className={`react-flow__edge-path ${data?.edgeClass ?? ""}`}
        fill="none"
      />
      {data?.label && (
        <text
          x={labelX}
          y={labelY + 4}
          className="relation-edge-svg-label"
          textAnchor="middle"
        >
          {data.label}
        </text>
      )}
    </>
  );
}

const relationshipEdgeTypes = { relation: RelationshipEdge };

function RelationshipGraph({
  people,
  relations,
  selectedId,
  onSelect,
  layout,
  onSaveLayout,
  onOpenSource,
}: {
  people: Person[];
  relations: Relation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  layout: Record<string, { x: number; y: number }>;
  onSaveLayout: (layout: Record<string, { x: number; y: number }>) => void;
  onOpenSource: (source: SourceRef) => void;
}) {
  const [organizationView, setOrganizationView] = useState(false);
  const [collapsedOrganizations, setCollapsedOrganizations] = useState<
    string[]
  >([]);
  const [focusDepth, setFocusDepth] = useState<"all" | 1 | 2>("all");
  const [enabledTypes, setEnabledTypes] = useState<Relation["type"][]>([
    "real",
    "hidden",
  ]);
  const { visible: basePeople, hiddenCount: hiddenPeopleCount } = useMemo(
    () => selectRelationshipPeople(people, relations),
    [people, relations],
  );
  const { visiblePeople, visibleRelations } = useMemo(
    () =>
      filterRelationshipView(basePeople, relations, {
        types: enabledTypes,
        focusId: focusDepth === "all" ? undefined : (selectedId ?? undefined),
        depth: focusDepth === "all" ? undefined : focusDepth,
      }),
    [
      basePeople,
      enabledTypes,
      focusDepth,
      relations,
      selectedId,
    ],
  );
  const groupedPeople = useMemo(
    () =>
      organizationView
        ? visiblePeople.filter(
            (person) =>
              !person.organization ||
              !collapsedOrganizations.includes(person.organization),
          )
        : visiblePeople,
    [collapsedOrganizations, organizationView, visiblePeople],
  );
  const initialNodes = useMemo(() => {
    const personNodes: Node[] = layoutRelationshipNodes(
        groupedPeople,
        visibleRelations.filter(
          (relation) =>
            groupedPeople.some((person) => person.id === relation.sourceId) &&
            groupedPeople.some((person) => person.id === relation.targetId),
        ),
        onSelect,
        layout,
      );
    if (!organizationView) return personNodes;
    const organizations = [
      ...new Set(
        visiblePeople.map((person) => person.organization).filter(Boolean),
      ),
    ] as string[];
    const organizationNodes: Node[] = [];
    organizations.forEach((organization, organizationIndex) => {
      const groupId = `org:${organization}`;
      const collapsed = collapsedOrganizations.includes(organization);
      const members = personNodes.filter(
        (node) =>
          visiblePeople.find((person) => person.id === node.id)?.organization ===
          organization,
      );
      if (collapsed) {
        organizationNodes.push({
          id: groupId,
          type: "organization",
          position: layout[groupId] ?? {
            x: 80 + organizationIndex * 320,
            y: 80,
          },
          data: { organization, collapsed: true },
          style: { width: 240, height: 82 },
        });
        return;
      }
      const minX = Math.min(...members.map((node) => node.position.x), 0);
      const minY = Math.min(...members.map((node) => node.position.y), 0);
      const maxX = Math.max(...members.map((node) => node.position.x), 240);
      const maxY = Math.max(...members.map((node) => node.position.y), 116);
      const groupPosition = layout[groupId] ?? { x: minX - 42, y: minY - 58 };
      organizationNodes.push({
        id: groupId,
        type: "organization",
        position: groupPosition,
        data: { organization, collapsed: false },
        style: {
          width: Math.max(340, maxX - minX + 324),
          height: Math.max(230, maxY - minY + 232),
        },
      });
      members.forEach((node) => {
        node.parentId = groupId;
        node.extent = "parent";
        node.position = {
          x: node.position.x - groupPosition.x,
          y: node.position.y - groupPosition.y,
        };
      });
    });
    return [...organizationNodes, ...personNodes];
  }, [
    collapsedOrganizations,
    groupedPeople,
    layout,
    onSelect,
    organizationView,
    visiblePeople,
    visibleRelations,
  ]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const relationshipPositions = useRef(
    new Map(
      initialNodes.map((node) => [
        `${organizationView ? "grouped" : "flat"}:${node.id}`,
        node.position,
      ]),
    ),
  );
  const relationshipInitialized = useRef(false);
  const applyRelationshipLayout = useCallback(async () => {
    try {
      const positions = await layoutWithElk({
        nodes: initialNodes.map((node) => ({
          id: node.id,
          width: Number(node.style?.width ?? (node.type === "person" ? 240 : 340)),
          height: Number(node.style?.height ?? (node.type === "person" ? 116 : 230)),
          parentId: node.parentId,
        })),
        edges: visibleRelations
          .map((relation) => ({
            id: relation.id,
            source: relation.sourceId,
            target: relation.targetId,
          }))
          .filter((edge) =>
            initialNodes.some((node) => node.id === edge.source) &&
            initialNodes.some((node) => node.id === edge.target),
          ),
      });
      const laidOut = initialNodes.map((node) => {
        const absolute = positions.get(node.id);
        const parent = node.parentId ? positions.get(node.parentId) : undefined;
        const position = absolute
          ? {
              x: absolute.x - (parent?.x ?? 0),
              y: absolute.y - (parent?.y ?? 0),
            }
          : node.position;
        relationshipPositions.current.set(
          `${organizationView ? "grouped" : "flat"}:${node.id}`,
          position,
        );
        return { ...node, position };
      });
      setNodes(laidOut);
    } catch {
      setNodes(initialNodes);
    }
  }, [initialNodes, organizationView, setNodes, visibleRelations]);
  useEffect(() => {
    if (relationshipInitialized.current) return;
    relationshipInitialized.current = true;
    if (Object.keys(layout).length === 0) void applyRelationshipLayout();
  }, [applyRelationshipLayout, layout]);
  useEffect(() => {
    setNodes((current) => {
      current.forEach((node) =>
        relationshipPositions.current.set(
          `${organizationView ? "grouped" : "flat"}:${node.id}`,
          node.position,
        ),
      );
      return initialNodes.map((node) => ({
        ...node,
        position:
          hasGraphPosition(layout, node.id)
            ? node.position
            : (relationshipPositions.current.get(
                `${organizationView ? "grouped" : "flat"}:${node.id}`,
              ) ?? node.position),
      }));
    });
  }, [initialNodes, layout, organizationView, setNodes]);
  const nodesWithSelection = useMemo(
    () =>
      nodes
        .filter(
          (node) =>
            node.type === "organization" ||
            groupedPeople.some((person) => person.id === node.id),
        )
        .map((node) => ({ ...node, selected: node.id === selectedId })),
    [nodes, selectedId, groupedPeople],
  );
  const edges = useMemo<RelationshipFlowEdge[]>(() => {
    const rewired = visibleRelations
      .map((relation) => {
        const source = visiblePeople.find(
          (person) => person.id === relation.sourceId,
        );
        const target = visiblePeople.find(
          (person) => person.id === relation.targetId,
        );
        return {
          relation,
          sourceId:
            organizationView &&
            source?.organization &&
            collapsedOrganizations.includes(source.organization)
              ? `org:${source.organization}`
              : relation.sourceId,
          targetId:
            organizationView &&
            target?.organization &&
            collapsedOrganizations.includes(target.organization)
              ? `org:${target.organization}`
              : relation.targetId,
        };
      })
      .filter(({ sourceId, targetId }) => sourceId !== targetId);
    const seen = new Set<string>();
    return rewired
      .filter(({ sourceId, targetId }) => {
        const key = `${sourceId}\u0000${targetId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(({ relation, sourceId, targetId }) => ({
        id: relation.id,
        source: sourceId,
        target: targetId,
        type: "relation",
        animated: false,
        data: {
          label: relation.label,
          edgeClass: `flow-edge flow-edge-${relation.type}`,
        },
        markerEnd: { type: MarkerType.ArrowClosed },
      }));
  }, [
    collapsedOrganizations,
    organizationView,
    visiblePeople,
    visibleRelations,
  ]);

  return (
    <div className="graph-shell">
      {hiddenPeopleCount > 0 && (
        <div className="notice warning">还有 {hiddenPeopleCount} 人未显示</div>
      )}
      <div className="graph-toolbar">
        <label>
          <input
            type="checkbox"
            checked={organizationView}
            onChange={(event) => setOrganizationView(event.target.checked)}
          />
          按组织分组
        </label>
        {organizationView &&
          [
            ...new Set(
              visiblePeople
                .map((person) => person.organization)
                .filter(Boolean),
            ),
          ].map((organization) => (
            <button
              className="ghost-button compact"
              key={organization}
              onClick={() =>
                setCollapsedOrganizations((items) =>
                  items.includes(organization!)
                    ? items.filter((item) => item !== organization)
                    : [...items, organization!],
                )
              }
            >
              {collapsedOrganizations.includes(organization!)
                ? `展开 ${organization}`
                : `折叠 ${organization}`}
            </button>
          ))}
        <select
          aria-label="关系图聚焦范围"
          value={focusDepth}
          onChange={(event) =>
            setFocusDepth(
              event.target.value === "all"
                ? "all"
                : (Number(event.target.value) as 1 | 2),
            )
          }
          disabled={!selectedId}
        >
          <option value="all">全图</option>
          <option value="1">聚焦一层</option>
          <option value="2">聚焦两层</option>
        </select>
        <div className="graph-filter">
          {(["real", "hidden"] as const).map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={enabledTypes.includes(type)}
                onChange={() =>
                  setEnabledTypes((items) =>
                    items.includes(type)
                      ? items.filter((item) => item !== type)
                      : [...items, type],
                  )
                }
              />
              {type === "real" ? "公开" : "隐藏"}
            </label>
          ))}
        </div>
        <div className="graph-root-indicator">
          绿色为 KP 已知关系，蓝色为公开人物关系。拖拽人物卡可整理布局。
        </div>
        <button
          className="ghost-button compact"
          onClick={() => void applyRelationshipLayout()}
        >
          重新布局
        </button>
        <div className="graph-legend">
          <span>
            <i className="legend-line solid kp-known" />
            KP 已知
          </span>
          <span>
            <i className="legend-line solid public-relation" />
            公开关系
          </span>
          <span>
            <i className="legend-line dashed" />
            AI 推断
          </span>
        </div>
      </div>
      <div className="flow-canvas">
        <ReactFlow
          nodes={nodesWithSelection}
          edges={edges}
          nodeTypes={relationshipNodeTypes}
          edgeTypes={relationshipEdgeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => {
            if (node.type === "person") onSelect(node.id);
          }}
          onNodeDragStop={(_, node) => {
            const parent = node.parentId
              ? nodes.find((candidate) => candidate.id === node.parentId)
              : undefined;
            const position = parent
              ? {
                  x: parent.position.x + node.position.x,
                  y: parent.position.y + node.position.y,
                }
              : node.position;
            relationshipPositions.current.set(
              `${organizationView ? "grouped" : "flat"}:${node.id}`,
              node.position,
            );
            onSaveLayout({ ...layout, [node.id]: position });
          }}
          onEdgeClick={(_, edge) => {
            const relation = visibleRelations.find(
              (item) => item.id === edge.id,
            );
            if (relation?.sources[0]) onOpenSource(relation.sources[0]);
          }}
          fitView
          minZoom={0.25}
          maxZoom={1.6}
          defaultEdgeOptions={{ type: "smoothstep" }}
        >
          <Background gap={22} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {visibleRelations.length === 0 && (
          <div className="graph-empty-relations">
            <strong>当前没有可显示的关系线</strong>
            <span>
              {relations.length === 0
                ? "请先在“分析流程”中完成关系梳理。"
                : "当前没有可连接的人物关系。"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function RelationsView({
  project,
  selectedId,
  onSelect,
  onUpdate,
  onOpenSource,
}: {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (project: Project) => void;
  onOpenSource: (source: SourceRef) => void;
}) {
  if (project.analysis.people.length === 0) {
    return (
      <EmptyState
        title="尚未识别人物"
        description="先在分析流程中完成人物识别，再核对别名，随后生成关系。"
      />
    );
  }
  return (
    <div className="content-stack graph-content">
      <header className="content-header">
        <div>
          <p className="eyebrow">CHARACTERS & FACTIONS</p>
          <h2>人物关系</h2>
          <p>
            {project.analysis.people.length} 个对象 ·{" "}
            {project.analysis.relations.length} 条关系
          </p>
        </div>
      </header>
      {project.analysis.unresolvedRelationCount > 0 && (
        <div className="notice warning">
          {project.analysis.unresolvedRelationCount} 条关系因端点未识别被搁置
        </div>
      )}
      <RelationshipGraph
        people={project.analysis.people}
        relations={project.analysis.relations}
        selectedId={selectedId}
        onSelect={onSelect}
        layout={{}}
        onSaveLayout={() => onUpdate(project)}
        onOpenSource={onOpenSource}
      />
    </div>
  );
}

function TimelineView({
  project,
  onOpenSource,
  onSelect,
}: {
  project: Project;
  onOpenSource: (source: SourceRef) => void;
  onSelect: (id: string) => void;
}) {
  if (project.analysis.timeline.length === 0) {
    return (
      <EmptyState
        title="尚未生成分支时间线"
        description="完成时间线分析后，这里会显示固定历史、默认发展和玩家干预分支。"
      />
    );
  }
  return (
    <TimelineFlowView
      project={project}
      onOpenSource={onOpenSource}
      onSelect={onSelect}
    />
  );
}

type TimelineFlowNodeData = {
  event: TimelineEvent;
  onOpenSource: (source: SourceRef) => void;
  onSelect: (id: string) => void;
};

function TimelineFlowNode({ data }: NodeProps<Node<TimelineFlowNodeData>>) {
  const { event, onOpenSource, onSelect } = data;
  return (
    <article
      className={`flow-timeline-node event-${event.kind}`}
      onClick={() => onSelect(event.id)}
    >
      <Handle type="target" position={Position.Top} className="flow-handle" />
      <div>
        <span>{event.date || "时间不明"}</span>
        <Badge provenance={event.provenance} />
      </div>
      <h3>{event.title}</h3>
      <p>{event.summary}</p>
      {event.trigger && <small>触发：{event.trigger}</small>}
      {event.outcome && <small>后果：{event.outcome}</small>}
      {event.sources[0] && (
        <button
          className="flow-source-button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSource(event.sources[0]);
          }}
        >
          原文依据 ↗
        </button>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="flow-handle"
      />
    </article>
  );
}

const timelineNodeTypes = { timeline: TimelineFlowNode };

function TimelineFlowView({
  project,
  onOpenSource,
  onSelect,
}: {
  project: Project;
  onOpenSource: (source: SourceRef) => void;
  onSelect: (id: string) => void;
}) {
  const events = project.analysis.timeline;
  const nodesAndEdges = useMemo(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
      rankdir: "TB",
      ranksep: 120,
      nodesep: 90,
      marginx: 90,
      marginy: 80,
    });
    events.forEach((event) =>
      graph.setNode(event.id, { width: 300, height: 170 }),
    );
    const roots = events.filter(
      (event) =>
        !event.parentId ||
        !events.some((candidate) => candidate.id === event.parentId),
    );
    roots
      .slice(0, -1)
      .forEach((event, index) =>
        graph.setEdge(event.id, roots[index + 1].id, { kind: "main" }),
      );
    events
      .filter(
        (event) =>
          event.parentId &&
          events.some((candidate) => candidate.id === event.parentId),
      )
      .forEach((event) =>
        graph.setEdge(event.parentId!, event.id, { kind: "branch" }),
      );
    dagre.layout(graph);
    const nodes: Node<TimelineFlowNodeData>[] = events.map((event) => {
      const point = graph.node(event.id);
      return {
        id: event.id,
        type: "timeline",
        position: { x: point.x - 150, y: point.y - 85 },
        data: { event, onOpenSource, onSelect },
      };
    });
    const edges: Edge[] = graph.edges().map((edge) => {
      const info = graph.edge(edge) as { kind?: string };
      return {
        id: `${edge.v}-${edge.w}`,
        source: edge.v,
        target: edge.w,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        className:
          info.kind === "branch"
            ? "flow-timeline-branch"
            : "flow-timeline-main",
      };
    });
    return { nodes, edges };
  }, [events, onOpenSource, onSelect]);
  const [nodes, setNodes, onNodesChange] = useNodesState(nodesAndEdges.nodes);
  useEffect(
    () => setNodes(nodesAndEdges.nodes),
    [nodesAndEdges.nodes, setNodes],
  );
  return (
    <div className="content-stack timeline-content">
      <header className="content-header">
        <div>
          <p className="eyebrow">BRANCHING CHRONOLOGY</p>
          <h2>分支时间线</h2>
          <p>主线自上而下推进；分支从对应事件展开。</p>
        </div>
      </header>
      <div className="flow-canvas timeline-flow-canvas">
        <ReactFlow
          nodes={nodes}
          edges={nodesAndEdges.edges}
          nodeTypes={timelineNodeTypes}
          onNodesChange={onNodesChange}
          fitView
          minZoom={0.25}
          maxZoom={1.5}
        >
          <Background gap={22} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

function CluesView({
  project,
  onOpenSource,
  onUpdate,
}: {
  project: Project;
  onOpenSource: (source: SourceRef) => void;
  onUpdate: (project: Project) => void;
}) {
  const [importanceFilter, setImportanceFilter] = useState<
    Clue["importance"][]
  >(["key", "secondary", "other"]);
  const [targetFilter, setTargetFilter] = useState<
    Clue["targets"][number]["type"][]
  >(["person", "place", "event", "truth"]);
  const [focusClueId, setFocusClueId] = useState<string>("");
  const [focusDepth, setFocusDepth] = useState<"all" | 1 | 2>("all");
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");
  const [editingClue, setEditingClue] = useState<Clue | null>(null);
  const allClues = useMemo(
    () => project.analysis.clues ?? [],
    [project.analysis.clues],
  );
  const clues = useMemo(() => {
    return filterClueView(allClues, {
      importance: importanceFilter,
      targetTypes: targetFilter,
      focusId:
        focusClueId && focusDepth !== "all" ? focusClueId : undefined,
      depth: focusDepth === "all" ? undefined : focusDepth,
    });
  }, [allClues, focusClueId, focusDepth, importanceFilter, targetFilter]);
  const initialNodes = useMemo(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
      rankdir: "LR",
      ranksep: 200,
      nodesep: 80,
      marginx: 70,
      marginy: 70,
    });
    clues.forEach((clue) =>
      graph.setNode(`clue:${clue.id}`, { width: 230, height: 124 }),
    );
    const targets = new Map<
      string,
      { label: string; type: "person" | "place" | "event" | "truth" }
    >();
    clues.forEach((clue) =>
      clue.targets
        .filter((target) => target.type !== "truth" || target.confirmed)
        .forEach((target) => {
          const id = `${target.type}:${target.id || target.label}`;
          targets.set(id, { label: target.label, type: target.type });
          graph.setNode(id, { width: 160, height: 72 });
          graph.setEdge(`clue:${clue.id}`, id);
        }),
    );
    dagre.layout(graph);
    return [
      ...clues.map((clue) => {
        const point = graph.node(`clue:${clue.id}`);
        return {
          id: `clue:${clue.id}`,
          type: "clue",
          position: savedGraphPosition(
            project.analysis.clueLayout ?? {},
            `clue:${clue.id}`,
            { x: point.x - 115, y: point.y - 62 },
          ),
          data: { clue, onOpenSource, onEdit: setEditingClue },
        } as Node<ClueFlowNodeData>;
      }),
      ...[...targets.entries()].map(([id, target]) => {
        const point = graph.node(id);
        return {
          id,
          type: "clueTarget",
          position: savedGraphPosition(
            project.analysis.clueLayout ?? {},
            id,
            { x: point.x - 80, y: point.y - 36 },
          ),
          data: target,
        } as Node<ClueTargetFlowNodeData>;
      }),
    ];
  }, [clues, onOpenSource, project.analysis.clueLayout]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const edges = useMemo<Edge[]>(
    () =>
      clues.flatMap((clue) =>
        clue.targets
          .filter((target) => target.type !== "truth" || target.confirmed)
          .map((target) => ({
            id: `${clue.id}:${target.type}:${target.id || target.label}`,
            source: `clue:${clue.id}`,
            target: `${target.type}:${target.id || target.label}`,
            type: "smoothstep",
            label: target.priority === "primary" ? "指向" : "次要指向",
            markerEnd: { type: MarkerType.ArrowClosed },
            className:
              target.priority === "primary"
                ? "flow-clue-edge-primary"
                : "flow-clue-edge-secondary",
          })),
      ),
    [clues],
  );
  const cluePositions = useRef(
    new Map(initialNodes.map((node) => [node.id, node.position])),
  );
  const clueInitialized = useRef(false);
  const applyClueLayout = useCallback(async () => {
    try {
      const positions = await layoutWithElk({
        nodes: initialNodes.map((node) => ({
          id: node.id,
          width: node.type === "clue" ? 230 : 160,
          height: node.type === "clue" ? 124 : 72,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        })),
      });
      setNodes(
        initialNodes.map((node) => ({
          ...node,
          position: positions.get(node.id) ?? node.position,
        })),
      );
      positions.forEach((position, id) => cluePositions.current.set(id, position));
    } catch {
      setNodes(initialNodes);
    }
  }, [edges, initialNodes, setNodes]);
  useEffect(() => {
    if (clueInitialized.current) return;
    clueInitialized.current = true;
    if (Object.keys(project.analysis.clueLayout ?? {}).length === 0)
      void applyClueLayout();
  }, [applyClueLayout, project.analysis.clueLayout]);
  useEffect(() => {
    setNodes((current) => {
      current.forEach((node) =>
        cluePositions.current.set(node.id, node.position),
      );
      return initialNodes.map((node) => ({
        ...node,
        position: hasGraphPosition(
          project.analysis.clueLayout ?? {},
          node.id,
        )
          ? node.position
          : (cluePositions.current.get(node.id) ?? node.position),
      }));
    });
  }, [initialNodes, project.analysis.clueLayout, setNodes]);
  const saveClue = () => {
    if (!editingClue || !editingClue.name.trim() || !editingClue.source.trim())
      return;
    const exists = allClues.some((clue) => clue.id === editingClue.id);
    const next: Project = {
      ...project,
      updatedAt: new Date().toISOString(),
      analysis: {
        ...project.analysis,
        clues: exists
          ? allClues.map((clue) =>
              clue.id === editingClue.id ? editingClue : clue,
            )
          : [...allClues, editingClue],
      },
    };
    onUpdate(next);
    setEditingClue(null);
  };
  const startNewClue = () =>
    setEditingClue({
      id: crypto.randomUUID(),
      name: "",
      summary: "",
      source: "",
      importance: "secondary",
      targets: [],
      confidence: 1,
      provenance: "keeper",
      sources: [],
    });
  return (
    <div className="content-stack">
      <header className="content-header">
        <div>
          <p className="eyebrow">CLUE NETWORK</p>
          <h2>线索网络</h2>
          <p>
            从关键线索到真相的调查入口、替代路径与卡关风险。每张卡均可直接打开编辑。
          </p>
        </div>
        <div className="clue-controls">
          <button className="primary-button compact" onClick={startNewClue}>
            新增线索
          </button>
          <div className="graph-filter">
            {(["key", "secondary", "other"] as const).map((level) => (
              <label key={level}>
                <input
                  type="checkbox"
                  checked={importanceFilter.includes(level)}
                  onChange={() =>
                    setImportanceFilter((items) =>
                      items.includes(level)
                        ? items.filter((item) => item !== level)
                        : [...items, level],
                    )
                  }
                />
                {level === "key"
                  ? "关键"
                  : level === "secondary"
                    ? "次要"
                    : "其他"}
              </label>
            ))}
          </div>
          <div className="graph-filter">
            {(["person", "place", "event", "truth"] as const).map((type) => (
              <label key={type}>
                <input
                  type="checkbox"
                  checked={targetFilter.includes(type)}
                  onChange={() =>
                    setTargetFilter((items) =>
                      items.includes(type)
                        ? items.filter((item) => item !== type)
                        : [...items, type],
                    )
                  }
                />
                {
                  {
                    person: "人物",
                    place: "地点",
                    event: "事件",
                    truth: "真相",
                  }[type]
                }
              </label>
            ))}
          </div>
          <select
            aria-label="聚焦线索"
            value={focusClueId}
            onChange={(event) => setFocusClueId(event.target.value)}
          >
            <option value="">未聚焦线索</option>
            {allClues.map((clue) => (
              <option key={clue.id} value={clue.id}>
                {clue.name}
              </option>
            ))}
          </select>
          <select
            aria-label="线索图聚焦范围"
            value={focusDepth}
            onChange={(event) =>
              setFocusDepth(
                event.target.value === "all"
                  ? "all"
                  : (Number(event.target.value) as 1 | 2),
              )
            }
            disabled={!focusClueId}
          >
            <option value="all">全图</option>
            <option value="1">一层关系</option>
            <option value="2">两层关系</option>
          </select>
          <div className="segmented-control">
            <button
              className={viewMode === "graph" ? "active" : ""}
              onClick={() => setViewMode("graph")}
            >
              网络图
            </button>
            <button
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
            >
              清单
            </button>
          </div>
          <button
            className="ghost-button compact"
            onClick={() => void applyClueLayout()}
          >
            重新布局
          </button>
        </div>
      </header>
      {editingClue && (
        <section className="clue-editor">
          <div>
            <h3>
              {allClues.some((clue) => clue.id === editingClue.id)
                ? "编辑线索"
                : "新增线索"}
            </h3>
            <button
              className="panel-close"
              onClick={() => setEditingClue(null)}
            >
              ×
            </button>
          </div>
          <label className="field">
            <span>线索名称</span>
            <input
              value={editingClue.name}
              onChange={(event) =>
                setEditingClue({ ...editingClue, name: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>内容摘要</span>
            <textarea
              value={editingClue.summary}
              onChange={(event) =>
                setEditingClue({ ...editingClue, summary: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>来源地点 / 场景</span>
            <input
              value={editingClue.source}
              onChange={(event) =>
                setEditingClue({ ...editingClue, source: event.target.value })
              }
            />
          </label>
          <div className="clue-target-editor">
            <label className="field">
              <span>主要指向</span>
              {editingClue.targets.find(
                (target) => target.priority === "primary",
              )?.type === "place" ? (
                <select
                  value={
                    editingClue.targets.find(
                      (target) => target.priority === "primary",
                    )?.id ?? ""
                  }
                  onChange={(event) => {
                    const place = project.analysis.places.find(
                      (candidate) => candidate.id === event.target.value,
                    );
                    const existing = editingClue.targets.find(
                      (target) => target.priority === "primary",
                    );
                    if (!place || !existing) return;
                    setEditingClue({
                      ...editingClue,
                      targets: editingClue.targets.map((target) =>
                        target === existing
                          ? { ...target, id: place.id, label: place.name }
                          : target,
                      ),
                    });
                  }}
                >
                  <option value="">选择已有地点</option>
                  {project.analysis.places.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={
                    editingClue.targets.find(
                      (target) => target.priority === "primary",
                    )?.label ?? ""
                  }
                  onChange={(event) => {
                    const existing = editingClue.targets.find(
                      (target) => target.priority === "primary",
                    );
                    const rest = editingClue.targets.filter(
                      (target) => target.priority !== "primary",
                    );
                    setEditingClue({
                      ...editingClue,
                      targets: event.target.value
                        ? [
                            ...rest,
                            {
                              id: existing?.id ?? crypto.randomUUID(),
                              type: existing?.type ?? "event",
                              label: event.target.value,
                              priority: "primary",
                              confirmed: true,
                            },
                          ]
                        : rest,
                    });
                  }}
                />
              )}
            </label>
            <label className="field">
              <span>目标类型</span>
              <select
                value={
                  editingClue.targets.find(
                    (target) => target.priority === "primary",
                  )?.type ?? "event"
                }
                onChange={(event) => {
                  const existing = editingClue.targets.find(
                    (target) => target.priority === "primary",
                  );
                  if (!existing) return;
                  setEditingClue({
                    ...editingClue,
                    targets: editingClue.targets.map((target) =>
                      target.id === existing.id
                        ? {
                            ...target,
                            type: event.target.value as
                              "person" | "place" | "event" | "truth",
                            id:
                              event.target.value === "place" ? "" : target.id,
                            label:
                              event.target.value === "place"
                                ? ""
                                : target.label,
                          }
                        : target,
                    ),
                  });
                }}
              >
                <option value="person">人物</option>
                <option value="place">地点</option>
                <option value="event">事件</option>
                <option value="truth">真相</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>关键程度</span>
            <select
              value={editingClue.importance}
              onChange={(event) =>
                setEditingClue({
                  ...editingClue,
                  importance: event.target.value as Clue["importance"],
                })
              }
            >
              <option value="key">关键</option>
              <option value="secondary">次要</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label className="field">
            <span>获得条件</span>
            <textarea
              value={editingClue.acquisition ?? ""}
              onChange={(event) =>
                setEditingClue({
                  ...editingClue,
                  acquisition: event.target.value,
                })
              }
            />
          </label>
          <label className="field">
            <span>错过条件</span>
            <textarea
              value={editingClue.missCondition ?? ""}
              onChange={(event) =>
                setEditingClue({
                  ...editingClue,
                  missCondition: event.target.value,
                })
              }
            />
          </label>
          <label className="field">
            <span>KP 补救建议</span>
            <textarea
              value={editingClue.keeperSuggestion ?? ""}
              onChange={(event) =>
                setEditingClue({
                  ...editingClue,
                  keeperSuggestion: event.target.value,
                })
              }
            />
          </label>
          <div className="clue-editor-actions">
            <button className="primary-button compact" onClick={saveClue}>
              保存线索
            </button>
            <button
              className="ghost-button compact"
              onClick={() => setEditingClue(null)}
            >
              取消
            </button>
          </div>
        </section>
      )}
      {viewMode === "graph" ? (
        <div className="flow-canvas clue-flow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={clueNodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => {
              if (node.type === "clue")
                setFocusClueId(node.id.replace(/^clue:/, ""));
            }}
            onNodeDragStop={(_, node) => {
              cluePositions.current.set(node.id, node.position);
              onUpdate({
                ...project,
                updatedAt: new Date().toISOString(),
                analysis: {
                  ...project.analysis,
                  clueLayout: {
                    ...project.analysis.clueLayout,
                    [node.id]: node.position,
                  },
                },
              });
            }}
            fitView
            minZoom={0.25}
            maxZoom={1.6}
          >
            <Background gap={22} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      ) : (
        <div className="clue-grid">
          {clues.map((clue) => (
            <article
              className={`clue-card clue-${clue.importance}`}
              key={clue.id}
              onDoubleClick={() => setEditingClue(clue)}
            >
              <div className="clue-card-top">
                <span>
                  {clue.importance === "key"
                    ? "关键"
                    : clue.importance === "secondary"
                      ? "次要"
                      : "其他"}
                </span>
                <Badge provenance={clue.provenance} />
              </div>
              <h3>{clue.name}</h3>
              <p>{clue.summary}</p>
              <small>来源：{clue.source}</small>
              <div className="clue-targets">
                {clue.targets.map((target) => (
                  <i key={target.id} className={`target-${target.type}`}>
                    {target.priority === "primary" ? "主要" : "次要"} ·{" "}
                    {target.label}
                  </i>
                ))}
              </div>
              {clue.risk && <p className="clue-risk">风险：{clue.risk}</p>}
              {clue.fallback && (
                <p className="clue-fallback">替代入口：{clue.fallback}</p>
              )}
              {clue.sources[0] && (
                <SourceButton source={clue.sources[0]} onOpen={onOpenSource} />
              )}
              <button
                className="text-button clue-edit-button"
                onClick={() => setEditingClue(clue)}
              >
                编辑线索
              </button>
            </article>
          ))}
        </div>
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
            <i style={{ width: `${completed * 25}%` }} />
          </div>
          <small>{completed} / 4 个分析阶段</small>
        </div>
      </header>
      <div className="dashboard-stats">
        <button onClick={() => onNavigate("structure")}>
          <span>文档</span>
          <strong>{project.pages.length}</strong>
          <small>页 · {project.chapters.length} 个章节</small>
        </button>
        <button onClick={() => onNavigate("relations")}>
          <span>人物</span>
          <strong>{project.analysis.people.length}</strong>
          <small>{project.analysis.relations.length} 条关系</small>
        </button>
        <button onClick={() => onNavigate("timeline")}>
          <span>事件</span>
          <strong>{project.analysis.timeline.length}</strong>
          <small>时间线节点</small>
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
            onClick={() => onNavigate("relations")}
          >
            <span>02</span>
            <div>
              <h3>人物关系</h3>
              <p>真实、公开与主观认知</p>
            </div>
            <i>→</i>
          </button>
          <button
            className="action-card time"
            onClick={() => onNavigate("timeline")}
          >
            <span>03</span>
            <div>
              <h3>分支时间线</h3>
              <p>默认走向与关键干预</p>
            </div>
            <i>→</i>
          </button>
        </div>
      </section>
    </div>
  );
}

function AutoResizeTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "0px";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} onChange={onChange} />;
}

function DetailPanel({
  project,
  selectedPerson,
  selectedEvent,
  onClose,
  onUpdate,
  onOpenSource,
}: {
  project: Project;
  selectedPerson?: Person;
  selectedEvent?: TimelineEvent;
  onClose: () => void;
  onUpdate: (project: Project) => void;
  onOpenSource: (source: SourceRef) => void;
}) {
  if (!selectedPerson && !selectedEvent) return null;
  const updatePerson = (patch: Partial<Person>) => {
    if (!selectedPerson) return;
    onUpdate({
      ...project,
      updatedAt: new Date().toISOString(),
      analysis: {
        ...project.analysis,
        people: project.analysis.people.map((person) =>
          person.id === selectedPerson.id
            ? { ...person, ...patch, provenance: "keeper" }
            : person,
        ),
      },
    });
  };
  const updateEvent = (patch: Partial<TimelineEvent>) => {
    if (!selectedEvent) return;
    onUpdate({
      ...project,
      updatedAt: new Date().toISOString(),
      analysis: {
        ...project.analysis,
        timeline: project.analysis.timeline.map((event) =>
          event.id === selectedEvent.id
            ? { ...event, ...patch, provenance: "keeper" }
            : event,
        ),
      },
    });
  };

  return (
    <aside className="detail-panel">
      <button className="panel-close" onClick={onClose} aria-label="关闭详情">
        ×
      </button>
      {selectedPerson && (
        <>
          <p className="eyebrow">CHARACTER FILE</p>
          <div className="detail-title">
            <span>{selectedPerson.name.slice(0, 1)}</span>
            <div>
              <input
                value={selectedPerson.name}
                onChange={(event) => updatePerson({ name: event.target.value })}
              />
              <Badge provenance={selectedPerson.provenance} />
            </div>
          </div>
          <label className="field">
            <span>剧情作用</span>
            <AutoResizeTextarea
              value={selectedPerson.role}
              onChange={(event) => updatePerson({ role: event.target.value })}
            />
          </label>
          <label className="field">
            <span>所属组织</span>
            <input
              value={selectedPerson.organization ?? ""}
              onChange={(event) =>
                updatePerson({ organization: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>公开身份</span>
            <AutoResizeTextarea
              value={selectedPerson.publicIdentity}
              onChange={(event) =>
                updatePerson({ publicIdentity: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>真实身份</span>
            <AutoResizeTextarea
              value={selectedPerson.trueIdentity}
              onChange={(event) =>
                updatePerson({ trueIdentity: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>目标与动机</span>
            <AutoResizeTextarea
              value={selectedPerson.motivation}
              onChange={(event) =>
                updatePerson({ motivation: event.target.value })
              }
            />
          </label>
          <div className="detail-section">
            <span>别名与称呼</span>
            <div className="tag-list">
              {selectedPerson.aliases.length ? (
                selectedPerson.aliases.map((alias) => (
                  <i key={alias}>{alias}</i>
                ))
              ) : (
                <small>暂无已确认别名</small>
              )}
            </div>
          </div>
          <div className="detail-section">
            <span>原文依据</span>
            {selectedPerson.sources.slice(0, 4).map((source, index) => (
              <SourceButton key={index} source={source} onOpen={onOpenSource} />
            ))}
          </div>
        </>
      )}
      {selectedEvent && (
        <>
          <p className="eyebrow">EVENT FILE</p>
          <div className="detail-title event-title">
            <span>时</span>
            <div>
              <input
                value={selectedEvent.title}
                onChange={(event) => updateEvent({ title: event.target.value })}
              />
              <Badge provenance={selectedEvent.provenance} />
            </div>
          </div>
          <label className="field">
            <span>时间</span>
            <input
              value={selectedEvent.date}
              onChange={(event) => updateEvent({ date: event.target.value })}
            />
          </label>
          <label className="field">
            <span>事件摘要</span>
            <textarea
              value={selectedEvent.summary}
              onChange={(event) => updateEvent({ summary: event.target.value })}
            />
          </label>
          <label className="field">
            <span>触发条件</span>
            <textarea
              value={selectedEvent.trigger ?? ""}
              onChange={(event) => updateEvent({ trigger: event.target.value })}
            />
          </label>
          <label className="field">
            <span>结果</span>
            <textarea
              value={selectedEvent.outcome ?? ""}
              onChange={(event) => updateEvent({ outcome: event.target.value })}
            />
          </label>
          <div className="detail-section">
            <span>原文依据</span>
            {selectedEvent.sources.slice(0, 4).map((source, index) => (
              <SourceButton key={index} source={source} onOpen={onOpenSource} />
            ))}
          </div>
        </>
      )}
    </aside>
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
  return {
    ...project,
    analysis: {
      ...defaults,
      ...project.analysis,
      clues: project.analysis.clues ?? [],
      activityLog: project.analysis.activityLog ?? [],
      clueLayout: project.analysis.clueLayout ?? {},
      unresolvedRelationCount:
        project.analysis.unresolvedRelationCount ?? 0,
      places: project.analysis.places ?? [],
      maps: project.analysis.maps ?? [],
      markers: project.analysis.markers ?? [],
      stages: { ...defaults.stages, ...project.analysis.stages },
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
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [sourceRef, setSourceRef] = useState<SourceRef | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [activeStage, setActiveStage] = useState<AnalysisStage | null>(null);
  const [streamPreview, setStreamPreview] = useState("");
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => {
    if (typeof window === "undefined") {
      return { baseUrl: "https://api.moonshot.cn/v1", model: "" };
    }
    const saved = localStorage.getItem("keeper-atlas:model-config");
    if (!saved) return { baseUrl: "https://api.moonshot.cn/v1", model: "" };
    try {
      return JSON.parse(saved) as ModelConfig;
    } catch {
      return { baseUrl: "https://api.moonshot.cn/v1", model: "" };
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

  const runStage = async (stage: AnalysisStage) => {
    if (!activeProject) return;
    setActiveStage(stage);
    setStreamPreview("");
    analysisAbortRef.current = new AbortController();
    setError("");
    const runningProject: Project = {
      ...activeProject,
      status: "analyzing",
      analysis: {
        ...activeProject.analysis,
        stages: {
          ...activeProject.analysis.stages,
          [stage]: { status: "running" },
        },
        activityLog: [
          ...(activeProject.analysis.activityLog ?? []),
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
          },
        }),
      });
      let payload: { data?: Record<string, unknown>; error?: string };
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
          data?: Record<string, unknown>;
          error?: string;
        };
      }
      if (!response.ok || !payload.data) {
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

      if (stage === "overview" && data.overview) {
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
      if (stage === "people" && Array.isArray(data.people)) {
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
      if (stage === "relations" && Array.isArray(data.relations)) {
        const { accepted: relations, unresolved } = partitionRelationsByPeople(
          data.relations as Relation[],
          nextAnalysis.people.map((person) => person.id),
        );
        relations.forEach((relation) => {
          relation.id ||= crypto.randomUUID();
          relation.label = String(relation.label ?? "关系待确认");
          relation.type = relation.type === "hidden" ? "hidden" : "real";
          relation.confidence = 1;
          relation.sources = Array.isArray(relation.sources)
            ? relation.sources
            : [];
        });
        nextAnalysis = {
          ...nextAnalysis,
          relations,
          unresolvedRelationCount: unresolved.length,
          activityLog:
            unresolved.length > 0
              ? [
                  ...nextAnalysis.activityLog,
                  {
                    id: crypto.randomUUID(),
                    stage,
                    kind: "progress",
                    message: `${unresolved.length} 条关系因端点未识别被搁置。`,
                    createdAt: new Date().toISOString(),
                  },
                ]
              : nextAnalysis.activityLog,
        };
      }
      if (stage === "timeline" && Array.isArray(data.timeline)) {
        const timeline = (data.timeline as TimelineEvent[]).map((event) => ({
          ...event,
          id: event.id || crypto.randomUUID(),
          title: String(event.title ?? "未命名事件"),
          date: String(event.date ?? "时间不明"),
          summary: String(event.summary ?? ""),
          kind: event.kind || "history",
          sources: Array.isArray(event.sources) ? event.sources : [],
          confidence: Number(event.confidence ?? 0.5),
          provenance: event.provenance || "source",
        }));
        nextAnalysis = { ...nextAnalysis, timeline };
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

      const stageReviews = [...returnedReviews, ...generatedReviews].map(
        (item) => ({
          ...item,
          stage,
        }),
      );
      nextAnalysis = {
        ...nextAnalysis,
        reviewItems: [
          ...nextAnalysis.reviewItems.filter(
            (item) =>
              item.status !== "pending" ||
              !(
                (stage === "people" && item.type === "merge") ||
                (stage === "relations" && item.type === "relation") ||
                (stage === "timeline" && item.type === "event") ||
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
            status: stageReviews.some((item) => item.type !== "external")
              ? "paused"
              : "complete",
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const allComplete = Object.values(nextAnalysis.stages).every(
        (state) => state.status === "complete",
      );
      const shouldContinueToRelations =
        stage === "people" &&
        !stageReviews.some((item) => item.type !== "external");
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
              kind: stageReviews.some((item) => item.type !== "external")
                ? "paused"
                : "completed",
              message: stageReviews.some((item) => item.type !== "external")
                ? `${stageLabels[stage]}发现待确认事项，等待 KP 确认。`
                : `${stageLabels[stage]}分析完成。`,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      };
      await persistProject(completedProject);
      setStreamPreview("");
      setToast(`${stageLabels[stage]}分析完成。`);
      if (shouldContinueToRelations) {
        window.setTimeout(() => {
          void runStage("relations");
        }, 0);
      }
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

  const resolveReview = async (item: ReviewItem, accepted: boolean) => {
    if (!activeProject) return;
    let people = [...activeProject.analysis.people];
    let relations = [...activeProject.analysis.relations];
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
        relations = relations.map((relation) => ({
          ...relation,
          sourceId: removedIds.has(relation.sourceId)
            ? keeper.id
            : relation.sourceId,
          targetId: removedIds.has(relation.targetId)
            ? keeper.id
            : relation.targetId,
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
              status: accepted ? ("accepted" as const) : ("rejected" as const),
            }
          : review,
    );
    const stageCleared =
      Boolean(item.stage) &&
      !reviewItems.some(
        (review) =>
          review.stage === item.stage &&
          review.status === "pending" &&
          review.type !== "external",
      );
    const next: Project = {
      ...activeProject,
      updatedAt: new Date().toISOString(),
      analysis: {
        ...activeProject.analysis,
        people,
        relations,
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
        activityLog:
          stageCleared && item.stage
            ? [
                ...(activeProject.analysis.activityLog ?? []),
                {
                  id: crypto.randomUUID(),
                  stage: item.stage,
                  kind: "completed",
                  message: `${stageLabels[item.stage]}的待确认事项已处理。`,
                  createdAt: new Date().toISOString(),
                },
              ]
            : activeProject.analysis.activityLog,
      },
    };
    await persistProject(next);
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

  const selectedPerson = activeProject?.analysis.people.find(
    (person) => person.id === selectedPersonId,
  );
  const selectedEvent = activeProject?.analysis.timeline.find(
    (event) => event.id === selectedEventId,
  );
  const pendingCount =
    activeProject?.analysis.reviewItems.filter(
      (item) => item.status === "pending",
    ).length ?? 0;
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

        <main
          className={`workspace-main ${selectedPerson || selectedEvent ? "has-detail" : ""}`}
        >
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
          {view === "relations" && (
            <RelationsView
              project={activeProject}
              onUpdate={persistProject}
              onOpenSource={setSourceRef}
              selectedId={selectedPersonId}
              onSelect={(id) => {
                setSelectedPersonId(id);
                setSelectedEventId(null);
              }}
            />
          )}
          {view === "timeline" && (
            <TimelineView
              project={activeProject}
              onOpenSource={setSourceRef}
              onSelect={(id) => {
                setSelectedEventId(id);
                setSelectedPersonId(null);
              }}
            />
          )}
          {view === "clues" && (
            <CluesView
              project={activeProject}
              onOpenSource={setSourceRef}
              onUpdate={persistProject}
            />
          )}
          {view === "map" && (
            <AtlasMapView
              project={activeProject}
              onUpdate={persistProject}
              onOpenSource={setSourceRef}
              onOpenClue={() => setView("clues")}
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

      <DetailPanel
        project={activeProject}
        selectedPerson={selectedPerson}
        selectedEvent={selectedEvent}
        onClose={() => {
          setSelectedPersonId(null);
          setSelectedEventId(null);
        }}
        onUpdate={persistProject}
        onOpenSource={setSourceRef}
      />
      {sourceRef && (
        <SourcePanel
          project={activeProject}
          source={sourceRef}
          sourceUrl={sourceUrl}
          onClose={() => setSourceRef(null)}
        />
      )}
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
