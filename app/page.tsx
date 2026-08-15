"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { parseScenarioFile } from "@/lib/parser";
import { hybridSearch, stageQuery } from "@/lib/retrieval";
import {
  extractExplicitCoCStats,
  mergeExplicitCoCStats,
} from "@/lib/coc-stat-extractor";
import { ensureVectorIndex, probeEmbedding } from "@/lib/embedding";
import { parseLooseJsonObject } from "@/lib/json-repair";
import {
  flagUnverifiedSourceRefs,
  verifySourceRefs,
} from "@/lib/quote-check";
import { ConfirmWizard } from "@/app/components/confirm-wizard";
import { ActTreeView } from "@/app/components/act-tree-view";
import { SettingsModal } from "@/app/components/settings-modal";
import { StageView, type BookHeading } from "@/app/components/stage-view";
import { PersonDetailPanel } from "@/app/components/person-detail-panel";
import { BookEditor } from "@/app/components/book-editor";
import { AnalysisLogModal } from "@/app/components/analysis-log-modal";
import {
  markdownHeadingId,
  markdownToReactBlocks,
  parseMarkdownBlocks,
} from "@/app/components/markdown-document";
import { EntityEditForm, EntityWindow } from "@/app/components/entity-window";
import { SourceDocumentView } from "@/app/components/source-document-view";
import { SourceImageExtractor } from "@/app/components/source-image-extractor";
import { CoreCharacterRelations } from "@/app/components/core-character-relations";
import { PersonRelationWindow } from "@/app/components/person-relation-window";
import {
  buildProjectEntities,
  buildActMarkdown,
  buildCharacterArcsMarkdown,
  buildCharacterMarkdown,
  buildMonsterMarkdown,
  buildPrologueMarkdown,
  createKeeperEntity,
  entityFields,
  entityName,
  keeperEntityUri,
  normalizeActMarkdownHierarchy,
} from "@/lib/entities";
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
  type EntityCard,
  type EntityKind,
  type EntityOverrides,
  type ModelConfig,
  type Monster,
  type OpeningHookDetails,
  type Person,
  type PersonRelation,
  type PersonCoCStatKey,
  type PersonCoCStats,
  type Project,
  type ReviewItem,
  type SourceRef,
  type TimePlace,
} from "@/lib/types";

type View =
  | "dashboard"
  | "structure"
  | "analysis"
  | "stage-background"
  | "stage-timeplace"
  | "stage-characters"
  | "stage-monsters"
  | "stage-characterArcs"
  | "stage-clues"
  | "acts"
  | "source-document"
  | "source-images"
  | "settings";

type FloatingEntityWindow = {
  id: string;
  entityRef: string;
  x: number;
  y: number;
  width: number;
  zIndex: number;
};

type FloatingPersonRelationWindow = {
  id: string;
  entityRef: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
};

function updateCharacterImportanceMarkdown(markdown: string, entity: EntityCard, importance: Person["importance"]) {
  const ref = entity.ref;
  const uriPrefix = `keeper://${ref}?`;
  const lines = markdown.split(/\r?\n/).filter((line) => !(
    (line.includes(":::character-card") && line.includes(`\"ref\":\"${ref}\"`)) ||
    (line.trimStart().startsWith("- [") && line.includes(uriPrefix))
  ));
  if (importance === "core") {
    const coreHeading = lines.findIndex((line) => /^##\s+核心人物\s*$/.test(line));
    if (coreHeading >= 0) lines.splice(coreHeading + 1, 0, `:::character-card${JSON.stringify({ ref, importance: "core" })}`);
  }
  const targetTitle = ({ core: "核心人物", important: "重要人物", minor: "次要人物" } as const)[importance];
  let groupHeading = lines.findIndex((line) => new RegExp(`^###\\s+${targetTitle}\\s*$`).test(line));
  if (groupHeading < 0) {
    const indexHeading = lines.findIndex((line) => /^##\s+全部人物索引\s*$/.test(line));
    groupHeading = indexHeading >= 0 ? indexHeading + 1 : lines.length;
    lines.splice(groupHeading, 0, `### ${targetTitle}`);
  }
  const role = String(entityFields(entity).role || "").trim();
  lines.splice(groupHeading + 1, 0, `- [${entityName(entity)}](${keeperEntityUri(ref)})${role ? `：${role}` : ""}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function EntityEditOverlay({
  entity,
  onClose,
  onSave,
}: {
  entity: EntityCard;
  onClose: () => void;
  onSave: (entity: EntityCard, override: EntityOverrides) => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="entity-edit-overlay" role="dialog" aria-modal="true" aria-label={`编辑${entity.original.name}`}>
      <article className="entity-edit-overlay-card parchment-window">
        <header><div><small>编辑资料</small><h2>{entity.original.name}</h2></div><button type="button" aria-label="关闭编辑" onClick={onClose}>×</button></header>
        <EntityEditForm
          entity={entity}
          onCancel={onClose}
          onSave={(override) => {
            onSave(entity, override);
            onClose();
          }}
        />
      </article>
    </div>
  );
}

const stageLabels: Record<AnalysisStage, string> = {
  background: "故事背景",
  timeplace: "时间地点",
  characters: "人物",
  monsters: "怪物 / Boss",
  characterArcs: "人物经历与动机",
  clues: "关键线索安排",
  acts: "幕",
};

const STAGE_ORDER: AnalysisStage[] = [
  "background",
  "timeplace",
  "characters",
  "monsters",
  "characterArcs",
  "clues",
  "acts",
];
function isActionableReview(item: ReviewItem) {
  return item.status === "pending" && item.type !== "external";
}

const STAGE_VIEWS: View[] = [
  "stage-background",
  "stage-timeplace",
  "stage-characters",
  "stage-monsters",
  "stage-characterArcs",
  "stage-clues",
  "acts",
];

const DASHBOARD_FLOW_STAGES: AnalysisStage[] = STAGE_ORDER;

function pausedStageFor(project: Project): AnalysisStage | null {
  return (
    STAGE_ORDER.find(
      (stage) =>
        project.analysis.stages[stage].status === "paused" &&
        (project.analysis.pendingAskUserCall?.stage === stage ||
          project.analysis.reviewItems.some(
            (item) => item.stage === stage && isActionableReview(item),
          )),
    ) ?? null
  );
}

const PREPARATION_NAV: Array<{ view: View; label: string }> = [
  { view: "dashboard", label: "项目仪表盘" },
  { view: "structure", label: "文档结构" },
  { view: "analysis", label: "分析流程" },
];

function analysisStageForSectionKey(sectionKey: string): AnalysisStage | undefined {
  if (sectionKey.startsWith("acts:")) return "acts";
  return ({
    "stage-background": "background",
    "stage-timeplace": "timeplace",
    "stage-characters": "characters",
    "stage-monsters": "monsters",
    "stage-characterArcs": "characterArcs",
    "stage-clues": "clues",
  } as Record<string, AnalysisStage>)[sectionKey];
}

function stageHasReadableAnalysis(project: Project, stage: AnalysisStage) {
  switch (stage) {
    case "background":
      return Boolean(project.analysis.overview);
    case "timeplace":
      return Boolean(project.analysis.timePlace?.timeline || project.analysis.timePlace?.places.length);
    case "characters":
      return project.analysis.people.length > 0;
    case "monsters":
      return Boolean(project.analysis.monsters?.length);
    case "characterArcs":
      return Boolean(project.analysis.characterArcs?.length);
    case "clues":
      return project.analysis.clues.length > 0;
    case "acts":
      return project.analysis.acts.length > 0;
  }
}

type NotebookHeading = BookHeading & { parentId?: string; hasChildren: boolean };

function organizeNotebookHeadings(headings: BookHeading[]): NotebookHeading[] {
  return headings.map((heading, index) => {
    let parentId: string | undefined;
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      if (headings[candidateIndex].level < heading.level) {
        parentId = headings[candidateIndex].id;
        break;
      }
    }
    const next = headings[index + 1];
    return {
      ...heading,
      parentId,
      hasChildren: Boolean(next && next.level > heading.level),
    };
  });
}

function NotebookToc({
  headings,
  activeHeadingId,
  onSelect,
}: {
  headings: NotebookHeading[];
  activeHeadingId?: string;
  onSelect: (heading: NotebookHeading) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const byId = new Map(headings.map((heading) => [heading.id, heading]));
  const visible = headings.filter((heading) => {
    let current = heading;
    while (current.parentId) {
      if (!expanded.has(current.parentId)) return false;
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return true;
  });
  if (headings.length === 0) {
    return <p className="notebook-toc-empty">完成分析后将在这里生成目录。</p>;
  }
  return (
    <div className="notebook-toc">
      {visible.map((heading) => (
        <div
          className={`notebook-toc-row${activeHeadingId === heading.id ? " active" : ""}`}
          style={{ "--toc-depth": Math.min(heading.level - 1, 4) } as CSSProperties}
          key={heading.id}
        >
          {heading.hasChildren ? (
            <button
              className="notebook-toc-toggle"
              type="button"
              aria-label={`${expanded.has(heading.id) ? "收起" : "展开"}${heading.title}`}
              aria-expanded={expanded.has(heading.id)}
              onClick={() => setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(heading.id)) next.delete(heading.id);
                else next.add(heading.id);
                return next;
              })}
            >
              {expanded.has(heading.id) ? "▾" : "▸"}
            </button>
          ) : <span className="notebook-toc-spacer" />}
          <button className="notebook-toc-link" type="button" onClick={() => onSelect(heading)}>
            {heading.title}
          </button>
        </div>
      ))}
    </div>
  );
}

function parseModelJson(content: string): Record<string, unknown> {
  try {
    return parseLooseJsonObject(content);
  } catch {
    throw new Error("模型流式输出未形成可修复的完整 JSON。请重试该阶段。");
  }
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
          <div className="brand-mark">KN</div>
          <div>
            <p className="eyebrow">KEEPER&apos;S LOCAL NOTEBOOK</p>
            <h1>守秘人笔记本</h1>
          </div>
        </div>
        <button className="dark-outline-button" onClick={onOpenSettings}>
          模型连接
        </button>
      </header>

      <section className="home-hero">
        <div>
          <p className="eyebrow accent">LOCAL FIRST · EVIDENCE LINKED</p>
          <h2>
            把模组整理成你的
            <br />
            主持笔记。
          </h2>
          <p className="hero-copy">
            从原始剧本中梳理人物、线索、地点与幕结构。随时编辑、建立关联，
            并回到对应原文核对依据。
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
  onRefresh,
}: {
  project: Project;
  onChange: (project: Project) => void;
  onConfirm: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
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
        <div className="inline-actions">
          {project.fileType === "pdf" && (
            <button
              className="dark-outline-button"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                void onRefresh().finally(() => setRefreshing(false));
              }}
            >
              {refreshing ? "正在读取…" : "重新读取 PDF 书签"}
            </button>
          )}
          <button className="dark-outline-button" onClick={onConfirm}>
            确认结构并进入分析
          </button>
        </div>
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
  onRunAll,
  onRerunAll,
  onShowLog,
  onOpenSettings,
  onNavigate,
  onRerunStage,
}: {
  project: Project;
  configReady: boolean;
  activeStage: AnalysisStage | null;
  streamPreview: string;
  reviewItems: ReviewItem[];
  onResolveReview: (item: ReviewItem, accepted: boolean) => void;
  onEditReview: (item: ReviewItem, changes: Partial<ReviewItem>) => void;
  onPause: () => void;
  onRunAll: () => void;
  onRerunAll: () => void;
  onShowLog: () => void;
  onOpenSettings: () => void;
  onNavigate: (view: View) => void;
  onRerunStage: (stage: AnalysisStage) => void;
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
      target: "stage-background",
    },
    timeplace: {
      id: "timeplace",
      number: "02",
      description: "汇总剧本的时间脉络、地点信息与区域提示。",
      requires: "background",
      target: "stage-timeplace",
    },
    characters: {
      id: "characters",
      number: "03",
      description: "识别人名、组织、公开身份与真实动机。",
      requires: "timeplace",
      target: "stage-characters",
    },
    monsters: {
      id: "monsters",
      number: "04",
      description: "独立识别怪物、神话生物、野兽、敌人模板与 Boss。",
      requires: "characters",
      target: "stage-monsters",
    },
    characterArcs: {
      id: "characterArcs",
      number: "05",
      description: "梳理人物在故事中的经历、变化与深层动机。",
      requires: "monsters",
      target: "stage-characterArcs",
    },
    clues: {
      id: "clues",
      number: "06",
      description: "梳理调查线索、关键真相、替代入口与卡关风险。",
      requires: "characterArcs",
      target: "stage-clues",
    },
    acts: {
      id: "acts",
      number: "07",
      description: "生成序幕及后续各幕，并补全分支和关键事件。",
      requires: "clues",
      target: "acts",
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
  ) => {
    const state = project.analysis.stages[stage.id] ?? {
      status: "idle" as const,
    };
    return (
      <section
        className={`pipeline-body pipeline-${state.status}${activeStage === stage.id ? " pipeline-running" : ""}`}
        key={stage.id}
      >
        <div className="pipeline-number">{stage.number}</div>
        <div className="pipeline-title">
          <h3>{stageLabels[stage.id]}</h3>
        </div>
        <div className="pipeline-description">
          <p>{stage.description}</p>
          {state.error && <p className="inline-error">{state.error}</p>}
        </div>
        <div className="pipeline-actions">
          <span className="pipeline-state-icon" aria-label={stateLabel(state.status)}>
            {activeStage === stage.id ? (
              <span className="analysis-loading-spinner" />
            ) : state.status === "complete" ? (
              "✓"
            ) : state.status === "error" ? (
              "!"
            ) : state.status === "paused" ? (
              "…"
            ) : (
              "—"
            )}
          </span>
          <button
            className="cb-action-button compact pipeline-rerun-button"
            disabled={
              !configReady ||
              activeStage !== null ||
              state.status === "running" ||
              Boolean(stage.requires && project.analysis.stages[stage.requires].status !== "complete")
            }
            onClick={(event) => {
              event.stopPropagation();
              onRerunStage(stage.id);
            }}
          >
            重新分析此阶段
          </button>
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
          {!configReady && <small className="analysis-config-hint">请先完成模型连接配置后开始分析。</small>}
          <div className="analysis-header-actions">
            <button
              className="cb-action-button analysis-run-all"
              disabled={!configReady || activeStage !== null}
              onClick={onRunAll}
            >
              {activeStage ? "分析进行中…" : "分析剧本"}
            </button>
            <button
              className="cb-action-button"
              disabled={!configReady || activeStage !== null}
              onClick={onRerunAll}
            >
              重新分析
            </button>
            <button className="cb-action-button" onClick={onShowLog}>
              分析记录
            </button>
          </div>
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
            onClick={onOpenSettings}
          >
            前往配置 →
          </button>
        </div>
      )}

      <div className="pipeline pipeline-major">
        {STAGE_ORDER.map((stage) => (
          <section
            className={`pipeline-card pipeline-${project.analysis.stages[stage]?.status ?? "idle"}`}
            key={stage}
            role="button"
            tabIndex={0}
            onClick={() => onNavigate(stages[stage].target)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onNavigate(stages[stage].target);
              }
            }}
          >
            {renderStage(stages[stage])}
          </section>
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
      {reviewItems.filter(isActionableReview).length > 0 && (
        <aside className="analysis-confirmation-rail">
          <div>
            <span className="eyebrow">KP CONFIRMATION</span>
            <h3>等待确认</h3>
          </div>
          {reviewItems
            .filter(isActionableReview)
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

function SettingsView({
  config,
  apiKey,
  rememberApiKey,
  testState,
  onConfig,
  onApiKey,
  onRememberApiKey,
  onTest,
}: {
  config: ModelConfig;
  apiKey: string;
  rememberApiKey: boolean;
  testState: "idle" | "testing" | "success" | "error";
  onConfig: (config: ModelConfig) => void;
  onApiKey: (value: string) => void;
  onRememberApiKey: (value: boolean) => void;
  onTest: () => void;
}) {
  return (
    <div className="settings-page">
      <header className="content-header">
        <div>
          <p className="eyebrow">MODEL CONNECTION</p>
          <h2>模型连接</h2>
          <p>支持 OpenAI 兼容、Anthropic Messages、Google Gemini 与 Ollama 本地协议。</p>
        </div>
      </header>
      <div className="settings-grid">
        <section className="settings-card">
          <span className="settings-index">01</span>
          <h3>接口协议</h3>
          <label className="field">
            <span>API 协议</span>
            <select
              value={config.protocol ?? "openai"}
              onChange={(event) => {
                const protocol = event.target.value as NonNullable<ModelConfig["protocol"]>;
                const defaults = {
                  openai: "https://api.openai.com/v1",
                  anthropic: "https://api.anthropic.com/v1",
                  gemini: "https://generativelanguage.googleapis.com/v1beta",
                  ollama: "http://localhost:11434/api",
                } as const;
                onConfig({ ...config, protocol, baseUrl: defaults[protocol], capabilities: undefined });
              }}
            >
              <option value="openai">OpenAI Compatible</option>
              <option value="anthropic">Anthropic Messages</option>
              <option value="gemini">Google Gemini</option>
              <option value="ollama">Ollama Local</option>
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
            <small>填写服务根地址；应用会按所选协议自动补全请求路径。</small>
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
              默认仅保存到当前浏览器会话；本地 Ollama 通常不需要凭据。
            </small>
          </label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={rememberApiKey}
              onChange={(event) => onRememberApiKey(event.target.checked)}
            />
            <span>在此浏览器中记住 API Key（以明文保存在 localStorage）</span>
          </label>
          <button
            className="dark-outline-button"
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
  onContinueReading,
}: {
  project: Project;
  onNavigate: (view: View) => void;
  onContinueReading: (sectionKey?: string) => void;
}) {
  const completed = DASHBOARD_FLOW_STAGES.filter(
    (stage) => project.analysis.stages[stage].status === "complete",
  ).length;
  const completedAnalysisStages = STAGE_ORDER.filter(
    (stage) => project.analysis.stages[stage].status === "complete",
  ).length;
  const pending = project.analysis.reviewItems.filter(isActionableReview).length;
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
            <i style={{ width: `${(completed / DASHBOARD_FLOW_STAGES.length) * 100}%` }} />
          </div>
          <small>{completed} / {DASHBOARD_FLOW_STAGES.length} 个备本流程</small>
        </div>
      </header>
      <div className="dashboard-stats">
        <button onClick={() => onNavigate("structure")}>
          <span>文档</span>
          <strong>{project.pages.length}</strong>
          <small>页 · {project.chapters.length} 个章节</small>
        </button>
        <button onClick={() => onNavigate("stage-characters")}>
          <span>人物</span>
          <strong>{project.analysis.people.length}</strong>
          <small>人物资料</small>
        </button>
        <button onClick={() => onNavigate("acts")}>
          <span>幕</span>
          <strong>{project.analysis.acts.length}</strong>
          <small>剧情幕</small>
        </button>
        <button onClick={() => onNavigate("analysis")}>
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
            <h2>继续工作</h2>
          </div>
        </div>
        <div className="dashboard-next-work">
          <button
            className="action-card truth"
            onClick={() => {
              if (pending > 0) onNavigate("analysis");
              else if (completed < STAGE_ORDER.length) onNavigate("analysis");
              else onContinueReading(project.lastReadingPosition?.sectionKey);
            }}
          >
            <span>→</span>
            <div>
              <h3>{pending > 0
                ? `处理 ${pending} 项待确认`
                : completedAnalysisStages < STAGE_ORDER.length
                  ? `继续分析（${completed} / ${DASHBOARD_FLOW_STAGES.length}）`
                  : "继续阅读"}</h3>
              <p>{project.lastReadingPosition
                ? `上次阅读：${project.lastReadingPosition.sectionKey} · 第 ${project.lastReadingPosition.page} 页`
                : "从项目当前最重要的下一步继续。"}</p>
            </div>
            <i>→</i>
          </button>
        </div>
        <div className="dashboard-health">
          <button onClick={() => onNavigate("analysis")}><span>备本进度</span><strong>{completed} / {DASHBOARD_FLOW_STAGES.length}</strong></button>
          <button onClick={() => onNavigate("analysis")}><span>待确认</span><strong>{pending}</strong></button>
          <button onClick={() => onNavigate("analysis")}><span>分析错误</span><strong>{Object.values(project.analysis.stages).filter((stage) => stage.status === "error").length}</strong></button>
          <div><span>最后更新</span><strong>{new Date(project.updatedAt).toLocaleString("zh-CN")}</strong></div>
        </div>
        <section className="dashboard-recent-activity">
          <h3>最近活动</h3>
          {(project.analysis.activityLog ?? []).length === 0 ? (
            <p>尚无活动记录。</p>
          ) : (
            <ol>
              {project.analysis.activityLog.slice(-5).reverse().map((entry) => (
                <li key={entry.id}>
                  <time>{new Date(entry.createdAt).toLocaleString("zh-CN")}</time>
                  <span>{entry.message}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
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
  const sourceLabel = source.printedPage
    ? `印刷页 ${source.printedPage}（PDF 第 ${source.page} 页）`
    : `PDF 第 ${source.page} 页`;
  return (
    <div className="source-overlay">
      <header>
        <div>
          <p className="eyebrow">SOURCE EVIDENCE</p>
          <h3>
            {sourceLabel}
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeSourceList(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const raw = asRecord(candidate);
    const page = Number(raw.page);
    if (!Number.isFinite(page) || page < 1) return [];
    return [{
      page: Math.floor(page),
      printedPage: raw.printedPage ? String(raw.printedPage) : undefined,
      chapter: raw.chapter ? String(raw.chapter) : undefined,
      quote: String(raw.quote ?? "").slice(0, 120),
      verified: typeof raw.verified === "boolean" ? raw.verified : undefined,
    }];
  });
}

const COC_NUMERIC_LIMITS: Partial<Record<PersonCoCStatKey, [number, number]>> = {
  str: [1, 100], con: [1, 100], siz: [1, 100], dex: [1, 100], app: [1, 100],
  int: [1, 100], pow: [1, 100], edu: [1, 100], hp: [0, 100], mp: [0, 100],
  san: [0, 100], luck: [0, 100], mov: [0, 20], build: [-2, 5],
};

function normalizePersonCoCStats(value: unknown): PersonCoCStats | undefined {
  const raw = asRecord(value);
  if (Object.keys(raw).length === 0) return undefined;
  const stats: PersonCoCStats = {};
  Object.entries(COC_NUMERIC_LIMITS).forEach(([key, [minimum, maximum]]) => {
    const number = Number(raw[key]);
    if (Number.isFinite(number)) {
      stats[key as keyof typeof COC_NUMERIC_LIMITS] = Math.max(minimum, Math.min(maximum, number)) as never;
    }
  });
  if (raw.damageBonus !== undefined) stats.damageBonus = String(raw.damageBonus);
  if (raw.armor !== undefined) stats.armor = String(raw.armor);
  if (Array.isArray(raw.skills)) {
    stats.skills = raw.skills.flatMap((candidate) => {
      const skill = asRecord(candidate);
      const name = String(skill.name ?? "").trim();
      const value = Number(skill.value);
      if (!name || !Number.isFinite(value)) return [];
      return [{
        name,
        value: Math.max(0, Math.min(100, value)),
        provenance: skill.provenance === "source" ? "source" as const : "inference" as const,
        sources: normalizeSourceList(skill.sources),
      }];
    });
  }
  if (Array.isArray(raw.attacks)) {
    stats.attacks = raw.attacks.flatMap((candidate) => {
      const attack = asRecord(candidate);
      const name = String(attack.name ?? "").trim();
      const damage = String(attack.damage ?? "").trim();
      if (!name || !damage) return [];
      const value = Number(attack.value);
      return [{
        name,
        value: Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined,
        damage,
        range: attack.range ? String(attack.range) : undefined,
        attacksPerRound: attack.attacksPerRound ? String(attack.attacksPerRound) : undefined,
        provenance: attack.provenance === "source" ? "source" as const : "inference" as const,
        sources: normalizeSourceList(attack.sources),
      }];
    });
  }
  const provenance = asRecord(raw.fieldProvenance);
  stats.fieldProvenance = Object.fromEntries(
    Object.keys({ ...COC_NUMERIC_LIMITS, damageBonus: true, armor: true }).flatMap((key) => {
      const entry = asRecord(provenance[key]);
      if (entry.provenance !== "source" && entry.provenance !== "inference") return [];
      return [[key, { provenance: entry.provenance, sources: normalizeSourceList(entry.sources) }]];
    }),
  );
  return stats;
}

function normalizeOpeningHookDetails(value: unknown): OpeningHookDetails | undefined {
  const raw = asRecord(value);
  if (Object.keys(raw).length === 0) return undefined;
  return {
    readAloud: raw.readAloud ? String(raw.readAloud) : undefined,
    initialSituation: raw.initialSituation ? String(raw.initialSituation) : undefined,
    firstConflict: raw.firstConflict ? String(raw.firstConflict) : undefined,
    atmosphere: raw.atmosphere ? String(raw.atmosphere) : undefined,
    introductionTips: raw.introductionTips ? String(raw.introductionTips) : undefined,
  };
}

function hydrateProject(project: Project): Project {
  const defaults = emptyAnalysis();
  const stages = Object.fromEntries(
    STAGE_ORDER.map((stage) => {
      const saved = project.analysis.stages?.[stage] ?? (
        stage === "monsters" && project.analysis.stages?.characters?.status === "complete"
          ? { status: "complete" as const, updatedAt: project.analysis.stages.characters.updatedAt }
          : defaults.stages[stage]
      );
      return [stage, saved.status === "running" ? { status: "idle" } : saved];
    }),
  ) as Project["analysis"]["stages"];
  return {
    ...project,
    analysis: {
      ...defaults,
      ...project.analysis,
      people: project.analysis.people ?? [],
      monsters: project.analysis.monsters ?? [],
      clues: project.analysis.clues ?? [],
      acts: project.analysis.acts ?? [],
      chapterSummaries: project.analysis.chapterSummaries ?? [],
      characterArcs: project.analysis.characterArcs ?? [],
      personRelations: project.analysis.personRelations ?? [],
      openingHook: project.analysis.openingHook ?? "",
      openingHookDetails: normalizeOpeningHookDetails(project.analysis.openingHookDetails),
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
  const [showSettings, setShowSettings] = useState(false);
  const [actView, setActView] = useState<"tree" | "detail">("detail");
  const [characterView, setCharacterView] = useState<"relations" | "detail">("detail");
  const [selectedActId, setSelectedActId] = useState<string | null>(null);
  const [selectedActPersonId, setSelectedActPersonId] = useState<string | null>(
    null,
  );
  const [sourceRef, setSourceRef] = useState<SourceRef | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [activeStage, setActiveStage] = useState<AnalysisStage | null>(null);
  const [wizardStage, setWizardStage] = useState<AnalysisStage | null>(null);
  const [isContinuing, setIsContinuing] = useState(false);
  const [bookEditing, setBookEditing] = useState(false);
  const [showAnalysisLog, setShowAnalysisLog] = useState(false);
  const [entityWindows, setEntityWindows] = useState<FloatingEntityWindow[]>([]);
  const [personRelationWindows, setPersonRelationWindows] = useState<FloatingPersonRelationWindow[]>([]);
  const floatingWindowZRef = useRef(110);
  const [editingEntityRef, setEditingEntityRef] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === "undefined"
      ? true
      : localStorage.getItem("keeper-atlas:sidebar-open") !== "false",
  );
  const [requestedHeadingId, setRequestedHeadingId] = useState<string>();
  const [activeNotebookHeadingId, setActiveNotebookHeadingId] = useState<string>();
  const [pendingReadingPosition, setPendingReadingPosition] = useState<Project["lastReadingPosition"]>();
  const [streamPreview, setStreamPreview] = useState("");
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => {
    if (typeof window === "undefined") {
      return {
        protocol: "openai",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "",
        confirmMode: "tier1",
      };
    }
    const saved = localStorage.getItem("keeper-atlas:model-config");
    if (!saved)
      return {
        protocol: "openai",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "",
        confirmMode: "tier1",
      };
    try {
      return {
        ...(JSON.parse(saved) as ModelConfig),
        protocol: (JSON.parse(saved) as ModelConfig).protocol ?? "openai",
        confirmMode:
          (JSON.parse(saved) as ModelConfig).confirmMode ?? "tier1",
      };
    } catch {
      return {
        protocol: "openai",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "",
        confirmMode: "tier1",
      };
    }
  });
  const [apiKey, setApiKey] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (localStorage.getItem("keeper-atlas:api-key") ??
        sessionStorage.getItem("keeper-atlas:api-key") ?? ""),
  );
  const [rememberApiKey, setRememberApiKey] = useState(() =>
    typeof window !== "undefined" &&
    localStorage.getItem("keeper-atlas:remember-api-key") === "true",
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
    localStorage.setItem("keeper-atlas:remember-api-key", String(rememberApiKey));
    if (rememberApiKey) {
      sessionStorage.removeItem("keeper-atlas:api-key");
      if (apiKey) localStorage.setItem("keeper-atlas:api-key", apiKey);
      else localStorage.removeItem("keeper-atlas:api-key");
    } else {
      localStorage.removeItem("keeper-atlas:api-key");
      if (apiKey) sessionStorage.setItem("keeper-atlas:api-key", apiKey);
      else sessionStorage.removeItem("keeper-atlas:api-key");
    }
  }, [apiKey, rememberApiKey]);

  useEffect(() => {
    localStorage.setItem("keeper-atlas:sidebar-open", String(sidebarOpen));
  }, [sidebarOpen]);

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
    const timeout = window.setTimeout(() => {
      setEntityWindows([]);
      setPersonRelationWindows([]);
    }, 0);
    return () => window.clearTimeout(timeout);
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
          stage === "characters" || stage === "monsters" || stage === "characterArcs" ? 24 : 12,
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
          phase:
            stage === "acts" || stage === "characters" || stage === "monsters"
              ? "skeleton"
              : undefined,
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
                    monsters: runningAnalysis.monsters,
                    characterArcs: runningAnalysis.characterArcs,
                    openingHook: runningAnalysis.openingHook,
                    openingHookDetails: runningAnalysis.openingHookDetails,
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
        (stage === "characters" || stage === "monsters") &&
        responseOk &&
        payload.data &&
        (Array.isArray(payload.data.people) || Array.isArray(payload.data.monsters))
      ) {
        const characterSkeleton = stage === "characters" && Array.isArray(payload.data.people)
          ? payload.data.people as Array<Record<string, unknown>>
          : [];
        const detailedPeople: Array<Record<string, unknown>> = [];
        const monsterSkeleton = stage === "monsters" && Array.isArray(payload.data.monsters)
          ? payload.data.monsters as Array<Record<string, unknown>>
          : [];
        const detailedMonsters: Array<Record<string, unknown>> = [];
        const detailReviews: unknown[] = [];
        const detailMergeCandidates: unknown[] = [];
        const batchSize = 6;
        const includedSourcePages = runningProject.pages.filter((page) =>
          runningProject.chapters.some((chapter) =>
            chapter.included &&
            page.pageNumber >= chapter.startPage &&
            page.pageNumber <= chapter.endPage,
          ),
        );

        for (let index = 0; index < characterSkeleton.length; index += batchSize) {
          const batch = characterSkeleton.slice(index, index + batchSize);
          const completed = Math.min(index + batch.length, characterSkeleton.length);
          const batchNames = batch.flatMap((person) => [
            String(person.name ?? ""),
            ...(Array.isArray(person.aliases) ? person.aliases.map(String) : []),
          ]).filter(Boolean);
          let batchScenarioText = scenarioText;
          try {
            const detailChunks = await hybridSearch(
              runningProject,
              `${batchNames.join(" ")} 守秘人笔记 建议数据 力量 体质 体型 敏捷 灵感 外貌 意志 教育 理智 HP MP DB 体格 移动 战斗 技能 伤害`,
              18,
              modelConfig,
              apiKey,
            );
            if (detailChunks.length > 0) {
              batchScenarioText = detailChunks
                .sort((left, right) => left.chunk.startPage - right.chunk.startPage)
                .map(({ chunk }) => {
                  const page = runningProject.pages.find(
                    (candidate) => candidate.pageNumber === chunk.startPage,
                  );
                  return `[[PDF_PAGE:${chunk.startPage}]]${
                    page?.printedPage ? `[[PRINTED_PAGE:${page.printedPage}]]` : ""
                  }\n${chunk.text}`;
                })
                .join("\n\n");
            }
          } catch {
            // The first-stage retrieval remains a valid fallback.
          }
          setStreamPreview(
            `正在补全人物属性与主持资料（${completed} / ${characterSkeleton.length}）…`,
          );
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
                text: batchScenarioText,
                chapters: runningProject.chapters
                  .filter((chapter) => chapter.included)
                  .map(({ title, startPage, endPage }) => ({
                    title,
                    startPage,
                    endPage,
                  })),
              },
              context: {
                characterSkeleton: batch,
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
          const detailPayload = (await detailResponse.json()) as {
            type?: "complete";
            data?: Record<string, unknown>;
            error?: string;
          };
          const returnedPeople = Array.isArray(detailPayload.data?.people)
            ? detailPayload.data.people as Array<Record<string, unknown>>
            : [];
          if (!detailResponse.ok || returnedPeople.length === 0) {
            throw new Error(
              detailPayload.error ||
                `人物资料第 ${Math.floor(index / batchSize) + 1} 批生成失败。`,
            );
          }

          for (const skeletonPerson of batch) {
            const detailPerson = returnedPeople.find(
              (candidate) =>
                String(candidate.id ?? "") === String(skeletonPerson.id ?? "") ||
                String(candidate.name ?? "") === String(skeletonPerson.name ?? ""),
            );
            if (!detailPerson) {
              throw new Error(
                `模型遗漏了人物“${String(skeletonPerson.name ?? skeletonPerson.id ?? "未知人物")}”，请重试人物阶段。`,
              );
            }
            detailedPeople.push({
              ...skeletonPerson,
              ...detailPerson,
              id: skeletonPerson.id,
              name: skeletonPerson.name,
              cocStats: mergeExplicitCoCStats(
                normalizePersonCoCStats(detailPerson.cocStats),
                extractExplicitCoCStats(
                  includedSourcePages,
                  [
                    String(skeletonPerson.name ?? ""),
                    ...(Array.isArray(skeletonPerson.aliases)
                      ? skeletonPerson.aliases.map(String)
                      : []),
                  ],
                ),
              ),
            });
          }
          if (Array.isArray(detailPayload.data?.reviewItems)) {
            detailReviews.push(...detailPayload.data.reviewItems);
          }
          if (Array.isArray(detailPayload.data?.mergeCandidates)) {
            detailMergeCandidates.push(...detailPayload.data.mergeCandidates);
          }
        }

        for (let index = 0; index < monsterSkeleton.length; index += batchSize) {
          const batch = monsterSkeleton.slice(index, index + batchSize);
          const batchNames = batch.flatMap((monster) => [
            String(monster.name ?? ""),
            ...(Array.isArray(monster.aliases) ? monster.aliases.map(String) : []),
          ]).filter(Boolean);
          let batchScenarioText = scenarioText;
          try {
            const detailChunks = await hybridSearch(
              runningProject,
              `${batchNames.join(" ")} 怪物 Boss 守秘人笔记 建议数据 力量 体质 体型 敏捷 意志 HP MP DB 体格 移动 护甲 战斗 技能 伤害`,
              18,
              modelConfig,
              apiKey,
            );
            if (detailChunks.length > 0) {
              batchScenarioText = detailChunks
                .sort((left, right) => left.chunk.startPage - right.chunk.startPage)
                .map(({ chunk }) => `[[PDF_PAGE:${chunk.startPage}]]\n${chunk.text}`)
                .join("\n\n");
            }
          } catch {
            // The skeleton-stage retrieval remains a valid fallback.
          }
          setStreamPreview(`正在补全怪物与 Boss（${Math.min(index + batch.length, monsterSkeleton.length)} / ${monsterSkeleton.length}）…`);
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
              document: { name: runningProject.name, text: batchScenarioText, chapters: [] },
              context: { monsterSkeleton: batch },
            }),
          });
          const detailPayload = (await detailResponse.json()) as {
            data?: Record<string, unknown>;
            error?: string;
          };
          const returned = Array.isArray(detailPayload.data?.monsters)
            ? detailPayload.data.monsters as Array<Record<string, unknown>>
            : [];
          if (!detailResponse.ok || returned.length === 0) {
            throw new Error(detailPayload.error || `怪物资料第 ${Math.floor(index / batchSize) + 1} 批生成失败。`);
          }
          for (const skeletonMonster of batch) {
            const detailMonster = returned.find((candidate) =>
              String(candidate.id ?? "") === String(skeletonMonster.id ?? "") ||
              String(candidate.name ?? "") === String(skeletonMonster.name ?? ""),
            );
            if (!detailMonster) {
              throw new Error(`模型遗漏了怪物“${String(skeletonMonster.name ?? "未知怪物")}”。`);
            }
            detailedMonsters.push({
              ...skeletonMonster,
              ...detailMonster,
              id: skeletonMonster.id,
              name: skeletonMonster.name,
              cocStats: mergeExplicitCoCStats(
                normalizePersonCoCStats(detailMonster.cocStats),
                extractExplicitCoCStats(includedSourcePages, [
                  String(skeletonMonster.name ?? ""),
                  ...(Array.isArray(skeletonMonster.aliases)
                    ? skeletonMonster.aliases.map(String)
                    : []),
                ]),
              ),
            });
          }
        }

        payload = {
          type: "complete",
          data: {
            ...payload.data,
            ...(stage === "characters" ? { people: detailedPeople } : {}),
            ...(stage === "monsters" ? { monsters: detailedMonsters } : {}),
            reviewItems: [
              ...(Array.isArray(payload.data.reviewItems)
                ? payload.data.reviewItems
                : []),
              ...detailReviews,
            ],
            mergeCandidates: [
              ...(Array.isArray(payload.data.mergeCandidates)
                ? payload.data.mergeCandidates
                : []),
              ...detailMergeCandidates,
            ],
          },
        };
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
              monsters: (runningAnalysis.monsters ?? []).map(
                ({ id, name, aliases, monsterType }) => ({ id, name, aliases, role: monsterType }),
              ),
              priorAnalysis: {
                overview: runningAnalysis.overview,
                timePlace: runningAnalysis.timePlace,
                characterArcs: runningAnalysis.characterArcs,
                openingHook: runningAnalysis.openingHook,
                openingHookDetails: runningAnalysis.openingHookDetails,
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
        payload = {
          ...detailPayload,
          data: {
            ...detailPayload.data,
            prologue: detailPayload.data.prologue ?? payload.data.prologue,
          },
        };
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
          summary: person.summary ? String(person.summary) : undefined,
          appearance: person.appearance ? String(person.appearance) : undefined,
          personality: person.personality ? String(person.personality) : undefined,
          state: person.state ? String(person.state) : undefined,
          performanceHints: person.performanceHints ? String(person.performanceHints) : undefined,
          isBoss: person.isBoss === true,
          cocStats: normalizePersonCoCStats(person.cocStats),
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
      if (stage === "monsters" && Array.isArray(data.monsters)) {
        const personNames = new Set(nextAnalysis.people.flatMap((person) =>
          [person.name, ...person.aliases].map((name) => name.trim().toLocaleLowerCase()).filter(Boolean),
        ));
        const seenMonsterNames = new Set<string>();
        const monsters = (data.monsters as Monster[]).flatMap((monster) => {
          const names = [monster.name, ...(Array.isArray(monster.aliases) ? monster.aliases : [])]
            .map((name) => String(name ?? "").trim().toLocaleLowerCase())
            .filter(Boolean);
          if (names.some((name) => personNames.has(name) || seenMonsterNames.has(name))) return [];
          names.forEach((name) => seenMonsterNames.add(name));
          return [{
            ...monster,
            id: String(monster.id || crypto.randomUUID()),
            name: String(monster.name ?? "未命名怪物"),
            aliases: Array.isArray(monster.aliases) ? monster.aliases.map(String) : [],
            monsterType: String(monster.monsterType ?? "怪物"),
            threatLevel: String(monster.threatLevel ?? "待评估"),
            summary: String(monster.summary ?? ""),
            appearance: monster.appearance ? String(monster.appearance) : undefined,
            abilities: monster.abilities ? String(monster.abilities) : undefined,
            weaknesses: monster.weaknesses ? String(monster.weaknesses) : undefined,
            tactics: monster.tactics ? String(monster.tactics) : undefined,
            rewards: monster.rewards ? String(monster.rewards) : undefined,
            keeperPrivate: monster.keeperPrivate ? String(monster.keeperPrivate) : undefined,
            cocStats: normalizePersonCoCStats(monster.cocStats),
            sources: Array.isArray(monster.sources) ? monster.sources : [],
            provenance: monster.provenance || "source",
            confidence: Number(monster.confidence ?? 0.5),
          }];
        });
        nextAnalysis = { ...nextAnalysis, monsters };
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
            motivationChanges: arc.motivationChanges ? {
              initial: String(arc.motivationChanges.initial ?? ""),
              turningPoints: Array.isArray(arc.motivationChanges.turningPoints)
                ? arc.motivationChanges.turningPoints.map(String)
                : [],
              final: String(arc.motivationChanges.final ?? ""),
            } : undefined,
            mainlineRelation: arc.mainlineRelation ? String(arc.mainlineRelation) : undefined,
          }),
        );
        const personIds = new Set(nextAnalysis.people.map((person) => person.id));
        const personRelations = Array.isArray(data.personRelations)
          ? (data.personRelations as Partial<PersonRelation>[]).flatMap((relation, index) => {
              const sourcePersonId = String(relation.sourcePersonId ?? "");
              const targetPersonId = String(relation.targetPersonId ?? "");
              const label = String(relation.label ?? "").trim();
              if (
                !personIds.has(sourcePersonId) ||
                !personIds.has(targetPersonId) ||
                sourcePersonId === targetPersonId ||
                !label
              ) {
                return [];
              }
              return [{
                id: String(relation.id ?? `person-relation-${index}`),
                sourcePersonId,
                targetPersonId,
                label,
                summary: String(relation.summary ?? ""),
                importance: relation.importance === "secondary" ? "secondary" as const : "primary" as const,
                provenance: relation.provenance === "source" ? "source" as const : "inference" as const,
                sources: normalizeSourceList(relation.sources),
              }];
            })
          : nextAnalysis.personRelations ?? [];
        nextAnalysis = { ...nextAnalysis, characterArcs, personRelations };
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
        const prologue = normalizeOpeningHookDetails(data.prologue);
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
            monsterIds: Array.isArray(act.monsterIds) ? act.monsterIds.map(String) : [],
            clueIds: Array.isArray(act.clueIds) ? act.clueIds.map(String) : [],
            branches: Array.isArray(act.branches)
              ? act.branches.map((branch) => ({
                  ...branch,
                  id: String(branch.id || crypto.randomUUID()),
                  condition: String(branch.condition || "条件待补充"),
                }))
              : [],
            keyEvents: Array.isArray(act.keyEvents) ? act.keyEvents : [],
            personActions: Array.isArray(act.personActions)
              ? act.personActions.flatMap((candidate) => {
                  const action = asRecord(candidate);
                  const personId = String(action.personId ?? "").trim();
                  if (!personId) return [];
                  const provenance: "source" | "inference" | "none" = action.provenance === "source" || action.provenance === "inference"
                    ? action.provenance
                    : "none";
                  return [{
                    personId,
                    summary: String(action.summary ?? (provenance === "none" ? "本幕无明确行动" : "")),
                    provenance,
                    sources: normalizeSourceList(action.sources),
                  }];
                })
              : undefined,
            description: String(act.description || ""),
          }))
          .sort((left, right) => left.sequence - right.sequence);
        nextAnalysis = {
          ...nextAnalysis,
          acts,
          openingHookDetails: prologue ?? nextAnalysis.openingHookDetails,
        };
      }

      const stageReviews = [...returnedReviews, ...generatedReviews].map(
        (item) => ({
          ...item,
          stage,
        }),
      );
      // Tier 1/2 may pause during the model call. This final safety barrier also
      // stops providers that ignore the realtime protocol from carrying an
      // unresolved decision into later stages.
      const shouldPause = stageReviews.some(isActionableReview);
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
    setWizardStage(null);
    setIsContinuing(true);
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
    const continuingProject: Project = {
      ...activeProject,
      updatedAt: new Date().toISOString(),
      analysis: {
        ...activeProject.analysis,
        stages: {
          ...activeProject.analysis.stages,
          [pending.stage]: { status: "running", updatedAt: new Date().toISOString() },
        },
        activityLog: [
          ...activeProject.analysis.activityLog,
          {
            id: crypto.randomUUID(),
            stage: pending.stage,
            kind: "progress",
            message: `${stageLabels[pending.stage]}已收到 KP 裁决，正在继续分析。`,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    };
    await persistProject(continuingProject);
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
          ...continuingProject,
          updatedAt: new Date().toISOString(),
          analysis: {
            ...continuingProject.analysis,
            pendingAskUserCall: {
              stage: pending.stage,
              callId: payload.callId,
              question: payload.question,
              options: payload.options ?? [],
              context: payload.context ?? "模型需要进一步裁决。",
              previousMessages: payload.previousMessages,
            },
            activityLog: [
              ...continuingProject.analysis.activityLog,
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
        ...continuingProject,
        analysis: {
          ...continuingProject.analysis,
          pendingAskUserCall: undefined,
          reviewItems: [
            ...continuingProject.analysis.reviewItems,
            {
              id: crypto.randomUUID(),
              type: "event",
              severity: "warning",
              title: pending.question,
              description: pending.context,
              keeperNote: keeperNote ? `${answer}\n${keeperNote}` : answer,
              status: "accepted",
              sources: [],
              stage: pending.stage,
            },
          ],
          stages: {
            ...continuingProject.analysis.stages,
            [pending.stage]: { status: "running" },
          },
        },
      };
      await runStage(pending.stage, resumedProject, payload.data);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        await persistProject({
          ...continuingProject,
          status: "structured",
          analysis: {
            ...continuingProject.analysis,
            stages: {
              ...continuingProject.analysis.stages,
              [pending.stage]: { status: "paused", updatedAt: new Date().toISOString() },
            },
            activityLog: [
              ...continuingProject.analysis.activityLog,
              {
                id: crypto.randomUUID(),
                stage: pending.stage,
                kind: "paused",
                message: `${stageLabels[pending.stage]}继续请求已暂停。`,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        });
        if (analysisAbortRef.current === controller) setActiveStage(null);
        return;
      }
      const message = caught instanceof Error ? caught.message : "继续分析失败。";
      await persistProject({
        ...continuingProject,
        status: "structured",
        analysis: {
          ...continuingProject.analysis,
          pendingAskUserCall: undefined,
          stages: {
            ...continuingProject.analysis.stages,
            [pending.stage]: { status: "error", error: message, updatedAt: new Date().toISOString() },
          },
          activityLog: [
            ...continuingProject.analysis.activityLog,
            {
              id: crypto.randomUUID(),
              stage: pending.stage,
              kind: "error",
              message: `${stageLabels[pending.stage]}继续分析失败：${message}`,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      });
      setError(message);
    } finally {
      setIsContinuing(false);
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
          isActionableReview(review),
      );
    const remainingForStage = item.stage
      ? reviewItems.filter(
          (review) =>
            review.stage === item.stage && isActionableReview(review),
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

  const wizardItems =
    activeProject && wizardStage
      ? activeProject.analysis.reviewItems.filter(
          (item) => item.stage === wizardStage && isActionableReview(item),
        )
      : [];
  const wizardItem = wizardItems[0];
  const realtimeAskUserCall = activeProject?.analysis.pendingAskUserCall;
  const configReady = Boolean(
    modelConfig.baseUrl.trim() &&
    modelConfig.model.trim() &&
    ((modelConfig.protocol ?? "openai") === "ollama" || apiKey.trim()),
  );
  const selectedActPerson = activeProject?.analysis.people.find(
    (person) => person.id === selectedActPersonId,
  );
  const entities = activeProject ? buildProjectEntities(activeProject) : [];

  const focusEntityWindow = (windowId: string) => {
    setEntityWindows((current) => {
      const zIndex = ++floatingWindowZRef.current;
      return current.map((item) => item.id === windowId ? { ...item, zIndex } : item);
    });
  };

  const openEntityWindow = (entityRef: string, anchorRect?: DOMRect) => {
    setEntityWindows((current) => {
      const zIndex = ++floatingWindowZRef.current;
      const existing = current.find((item) => item.entityRef === entityRef);
      if (existing) return current.map((item) => item.id === existing.id ? { ...item, zIndex } : item);
      const width = Math.min(620, Math.max(360, window.innerWidth - 32));
      const offset = current.length * 24;
      const preferredX = anchorRect
        ? (anchorRect.right + 16 + width <= window.innerWidth ? anchorRect.right + 16 : anchorRect.left - width - 16)
        : window.innerWidth - width - 40 - offset;
      const preferredY = anchorRect ? anchorRect.top : 92 + offset;
      return [...current, {
        id: crypto.randomUUID(),
        entityRef,
        x: Math.max(8, Math.min(window.innerWidth - width - 8, preferredX)),
        y: Math.max(8, Math.min(window.innerHeight - 96, preferredY)),
        width,
        zIndex,
      }];
    });
  };

  const openPersonRelationWindow = (entityRef: string) => {
    setPersonRelationWindows((current) => {
      const zIndex = ++floatingWindowZRef.current;
      const existing = current.find((item) => item.entityRef === entityRef);
      if (existing) {
        return current.map((item) => item.id === existing.id ? { ...item, zIndex } : item);
      }
      const offset = current.length * 26;
      const width = Math.min(720, window.innerWidth - 16);
      return [...current, {
        id: crypto.randomUUID(),
        entityRef,
        x: Math.max(8, Math.min(window.innerWidth - width - 8, 110 + offset)),
        y: Math.max(8, 90 + offset),
        width,
        height: Math.min(560, window.innerHeight - 16),
        zIndex,
      }];
    });
  };

  const openCoreCharacterRelations = () => {
    setBookEditing(false);
    setActView("detail");
    setView("stage-characters");
    setCharacterView("relations");
  };

  const saveEntityOverride = (entity: EntityCard, override: EntityOverrides) => {
    if (!activeProject) return;
    if (entity.source === "keeper") {
      const keeperEntities = (activeProject.kpNotes?.keeperEntities ?? []).map((candidate) =>
        candidate.ref === entity.ref ? { ...candidate, overrides: override, linkBehavior: override.linkBehavior ?? candidate.linkBehavior, updatedAt: override.updatedAt } : candidate,
      );
      void persistProject({
        ...activeProject,
        updatedAt: new Date().toISOString(),
        kpNotes: { ...activeProject.kpNotes, keeperEntities },
      });
      return;
    }
    const requestedImportance: Person["importance"] | undefined = entity.kind === "person" && (
      override.fields?.importance === "core" ||
      override.fields?.importance === "important" ||
      override.fields?.importance === "minor"
    ) ? override.fields.importance as Person["importance"] : undefined;
    const originalPerson = requestedImportance
      ? activeProject.analysis.people.find((person) => person.id === entity.id)
      : undefined;
    const importanceChanged = Boolean(originalPerson && requestedImportance && originalPerson.importance !== requestedImportance);
    const nextPeople = importanceChanged
      ? activeProject.analysis.people.map((person) => person.id === entity.id ? { ...person, importance: requestedImportance! } : person)
      : activeProject.analysis.people;
    const currentCharacterMarkdown = activeProject.kpNotes?.sectionMarkdown?.["stage-characters"];
    const nextSectionMarkdown = importanceChanged && currentCharacterMarkdown
      ? {
          ...activeProject.kpNotes?.sectionMarkdown,
          "stage-characters": updateCharacterImportanceMarkdown(currentCharacterMarkdown, { ...entity, overrides: override }, requestedImportance!),
        }
      : activeProject.kpNotes?.sectionMarkdown;
    void persistProject({
      ...activeProject,
      updatedAt: new Date().toISOString(),
      analysis: { ...activeProject.analysis, people: nextPeople },
      kpNotes: {
        ...activeProject.kpNotes,
        sectionMarkdown: nextSectionMarkdown,
        entityOverrides: { ...activeProject.kpNotes?.entityOverrides, [entity.ref]: override },
      },
    }).then(() => {
      if (importanceChanged) setToast("人物级别已更新；人物章节与关系图已同步刷新。");
      else setToast("资料修改已保存。");
    });
  };

  const addKeeperEntity = (kind: EntityKind, name: string, sectionKey: string, relatedTo?: EntityCard) => {
    const entity = createKeeperEntity(kind, name, sectionKey);
    if (!activeProject) return entity;
    const relation = relatedTo ? {
      id: crypto.randomUUID(), sourceRef: relatedTo.ref, targetRef: entity.ref,
      label: "KP 新建关联", level: "keeper" as const,
    } : null;
    void persistProject({
      ...activeProject,
      updatedAt: new Date().toISOString(),
      kpNotes: {
        ...activeProject.kpNotes,
        keeperEntities: [...(activeProject.kpNotes?.keeperEntities ?? []), entity],
        entityRelations: relation
          ? [...(activeProject.kpNotes?.entityRelations ?? []), relation]
          : activeProject.kpNotes?.entityRelations,
      },
    });
    return entity;
  };

  const jumpToEntity = (entity: EntityCard, targetSectionKey?: string) => {
    const sectionKey = targetSectionKey ?? entity.appearances[0]?.sectionKey;
    if (!sectionKey) return;
    if (sectionKey.startsWith("acts:")) {
      setSelectedActId(sectionKey.slice("acts:".length));
      setView("acts");
    } else setView(sectionKey as View);
    setActView("detail");
    setCharacterView("detail");
  };

  const sectionMarkdown = activeProject?.kpNotes?.sectionMarkdown ?? {};
  const noteMarkdown = (sectionKey: string) => (activeProject?.kpNotes?.sectionNotes?.[sectionKey] ?? [])
    .map((note) => `\n## ${note.title}\n${note.body}`)
    .join("\n");
  const prologueAct = activeProject?.analysis.acts.find((act) =>
    /序幕|楔子|开场/.test(act.title),
  ) ?? activeProject?.analysis.acts[0];
  const firstActId = activeProject?.analysis.acts[0]?.id;
  const activeActSectionKey = `acts:${selectedActId ?? prologueAct?.id ?? ""}`;
  const legacyPrologue = activeProject
    ? (sectionMarkdown["acts:prologue"] ?? buildPrologueMarkdown(activeProject))
    : "";
  const openingSupplement = legacyPrologue
    .replace(/^\s*#\s+幕\s*/m, "")
    .replace(/^\s*##\s+序幕\s*/m, "")
    .replace(/^(#{3,6})(\s+)/gm, (_match, marks: string, spacing: string) =>
      `${"#".repeat(Math.min(6, marks.length + 1))}${spacing}`,
    )
    .trim();
  const defaultMarkdown: Record<string, string> = activeProject ? {
    "stage-background": `# 故事背景\n\n## 起因\n${activeProject.analysis.overview?.cause ?? ""}\n\n## 开团前的历史\n${activeProject.analysis.overview?.history ?? ""}\n\n## 当前状态\n${activeProject.analysis.overview?.currentState ?? ""}${noteMarkdown("stage-background")}`,
    "stage-timeplace": `# 时间地点\n\n${activeProject.analysis.timePlace?.places.map((place) => `## ${place.name}\n${place.description || place.summary}`).join("\n\n") ?? ""}${noteMarkdown("stage-timeplace")}`,
    "stage-characters": `${buildCharacterMarkdown(activeProject)}${noteMarkdown("stage-characters")}`,
    "stage-monsters": `${buildMonsterMarkdown(activeProject)}${noteMarkdown("stage-monsters")}`,
    "stage-characterArcs": `${buildCharacterArcsMarkdown(activeProject)}${noteMarkdown("stage-characterArcs")}`,
    "stage-clues": `# 关键线索安排\n\n${activeProject.analysis.clues.map((clue) => `## ${clue.name}\n${clue.summary}\n\n- 来源：${clue.source}\n- 获取方式：${clue.acquisition || "待补充"}\n- 指向：${clue.targets.map((target) => target.label).join("、") || "待补充"}`).join("\n\n")}${noteMarkdown("stage-clues")}`,
    ...Object.fromEntries(activeProject.analysis.acts.map((act) => [
      `acts:${act.id}`,
      `${buildActMarkdown(activeProject, act.id, act.id === firstActId)}${
        act.id === prologueAct?.id && openingSupplement
          ? `\n\n### 开场导入\n\n${openingSupplement}${noteMarkdown("acts:prologue")}`
          : ""
      }${noteMarkdown(`acts:${act.id}`)}`,
    ])),
  } : {};

  const markdownSections = Object.keys(defaultMarkdown).map((key) => {
    const savedMarkdown = sectionMarkdown[key] ?? defaultMarkdown[key];
    return {
      key,
      name: key.startsWith("acts:")
        ? activeProject?.analysis.acts.find((act) => `acts:${act.id}` === key)?.title ?? "幕"
        : key === "stage-monsters"
          ? "怪物与 Boss"
        : stageLabels[({
            "stage-background": "background",
            "stage-timeplace": "timeplace",
            "stage-characters": "characters",
            "stage-monsters": "monsters",
            "stage-characterArcs": "characterArcs",
            "stage-clues": "clues",
          } as Record<string, AnalysisStage>)[key]],
      markdown: key.startsWith("acts:")
        ? normalizeActMarkdownHierarchy(
            key === `acts:${prologueAct?.id}` &&
              openingSupplement &&
              !/^(?:###)\s+开场导入\s*$/m.test(savedMarkdown)
              ? `${savedMarkdown}\n\n### 开场导入\n\n${openingSupplement}`
              : savedMarkdown,
            key === `acts:${firstActId}`,
          )
        : savedMarkdown,
      templateMarkdown: defaultMarkdown[key],
      customized: sectionMarkdown[key] !== undefined,
    };
  });

  const notebookHeadings = organizeNotebookHeadings(
    markdownSections.flatMap((section) => {
      const stage = analysisStageForSectionKey(section.key);
      const readable = section.customized || (stage && activeProject
        ? activeProject.analysis.stages[stage].status === "complete" ||
          stageHasReadableAnalysis(activeProject, stage)
        : false);
      if (!readable) return [];
      return parseMarkdownBlocks(section.markdown).flatMap((block, blockIndex) => {
        if (block.kind !== "heading" || !block.text?.trim()) return [];
        return [{
          id: markdownHeadingId(section.key, blockIndex),
          title: block.text.trim(),
          level: Math.max(1, Math.min(6, Number(block.level ?? 1))),
          sectionKey: section.key,
        }];
      });
    }),
  );

  const renderedBookSections = markdownSections.map((section) => {
    const content = markdownToReactBlocks({
      markdown: section.markdown,
      sectionKey: section.key,
      entities,
      onEntityAction: ({ entity, action, anchorRect }) => {
        if (action === "jump") jumpToEntity(entity);
        else openEntityWindow(entity.ref, anchorRect);
      },
      onEntityImageChange: (entity, image) => {
        saveEntityOverride(entity, {
          ...entity.overrides,
          image,
          imageSource: "manual",
          updatedAt: new Date().toISOString(),
        });
      },
      onEntityEdit: (entity) => setEditingEntityRef(entity.ref),
      onOpenCoreRelations: openCoreCharacterRelations,
      onOpenEntityRelations: (entity) => openPersonRelationWindow(entity.ref),
    });
    return {
      key: section.key,
      name: section.name,
      content,
    };
  });

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
            rememberApiKey={rememberApiKey}
            testState={testState}
            onConfig={setModelConfig}
            onApiKey={setApiKey}
            onRememberApiKey={setRememberApiKey}
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
    <div className={`app-shell${sidebarOpen ? "" : " sidebar-hidden"}`}>
      <aside className="sidebar" aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
        <nav>
          <div className="nav-group">
            <span className="nav-label">前期准备</span>
            {PREPARATION_NAV.map((item) => (
              <button
                key={item.view}
                className={view === item.view ? "active" : ""}
                onClick={() => setView(item.view)}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="nav-group nav-group-separated">
            <span className="nav-label">模组笔记本</span>
            <NotebookToc
              headings={notebookHeadings}
              activeHeadingId={activeNotebookHeadingId}
              onSelect={(heading) => {
                setRequestedHeadingId(heading.id);
                setBookEditing(false);
                setActView("detail");
                setCharacterView("detail");
                if (heading.sectionKey.startsWith("acts:")) {
                  setSelectedActId(heading.sectionKey.slice("acts:".length));
                  setView("acts");
                } else {
                  setView(heading.sectionKey as View);
                }
              }}
            />
          </div>
          <div className="nav-group nav-group-separated">
            <span className="nav-label">原始资料</span>
            <button
              className={view === "source-document" ? "active" : ""}
              onClick={() => setView("source-document")}
            >
              <span>原始文档</span>
            </button>
            <button
              className={view === "source-images" ? "active" : ""}
              onClick={() => setView("source-images")}
            >
              <span>图片资料</span>
            </button>
          </div>
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
          <div className="topbar-leading">
            <button
              className="topbar-icon-button"
              type="button"
              aria-label={sidebarOpen ? "隐藏菜单" : "展开菜单"}
              title={sidebarOpen ? "隐藏菜单" : "展开菜单"}
              onClick={() => setSidebarOpen((value) => !value)}
            >
              ☰
            </button>
            <button
              className="topbar-icon-button"
              type="button"
              aria-label="返回项目首页"
              title="返回项目首页"
              onClick={() => {
                setActiveProject(null);
                setView("dashboard");
              }}
            >
              ⌂
            </button>
            <strong>{activeProject.name}</strong>
          </div>
          <div className="topbar-book-tools" id="book-toolbar-slot" />
          <div className="topbar-actions">
            {entityWindows.length + personRelationWindows.length > 0 && (
              <button
                className="topbar-card-counter"
                type="button"
                onClick={() => {
                  setEntityWindows([]);
                  setPersonRelationWindows([]);
                }}
                title="关闭全部资料窗口"
              >
                资料窗口 {entityWindows.length + personRelationWindows.length} · 全部关闭
              </button>
            )}
            <button
              className="icon-button settings-trigger"
              aria-label="打开模型连接设置"
              title="模型连接设置"
              onClick={() => setShowSettings(true)}
            >
              ⚙
            </button>
          </div>
        </header>

        <main
          className={`workspace-main${
            STAGE_VIEWS.includes(view) && (view !== "acts" || actView === "detail" || actView === "tree")
              ? " book-workspace-main"
              : ""
          }`}
        >
          {view === "dashboard" && (
            <DashboardView
              project={activeProject}
              onNavigate={(target) => {
                setCharacterView("detail");
                setView(target);
              }}
              onContinueReading={(sectionKey) => {
                setCharacterView("detail");
                setPendingReadingPosition(activeProject.lastReadingPosition);
                if (sectionKey?.startsWith("acts:")) {
                  setSelectedActId(sectionKey.slice("acts:".length));
                  setView("acts");
                  return;
                }
                setView((sectionKey as View | undefined) ?? "stage-background");
              }}
            />
          )}
          {view === "structure" && (
            <StructureView
              project={activeProject}
              onChange={persistProject}
              onRefresh={async () => {
                const blob = await loadSourceFile(activeProject.id);
                if (!blob) throw new Error("未找到原始文档，无法重新读取书签。");
                const parsed = await parseScenarioFile(new File([blob], activeProject.fileName, {
                  type: blob.type,
                }));
                await persistProject({
                  ...activeProject,
                  documentText: parsed.documentText,
                  pages: parsed.pages,
                  chapters: parsed.chapters,
                  updatedAt: new Date().toISOString(),
                });
                setToast(parsed.chapters.length > 1
                  ? `已读取 ${parsed.chapters.length} 个章节。`
                  : "PDF 未提供可用书签，已按正文标题重新识别。");
              }}
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
              onRunAll={() => {
                const firstIncomplete = STAGE_ORDER.find(
                  (stage) => activeProject.analysis.stages[stage].status !== "complete",
                );
                if (!firstIncomplete) {
                  setToast("全部分析阶段均已完成；如需覆盖结果，请使用“重新分析”。");
                  return;
                }
                void runStage(firstIncomplete);
              }}
              onRerunAll={() => {
                if (!window.confirm("重新分析会从故事背景开始覆盖全部阶段的 AI 结果。KP 笔记会保留，是否继续？")) return;
                const resetProject: Project = {
                  ...activeProject,
                  status: "structured",
                  analysis: {
                    ...activeProject.analysis,
                    personRelations: [],
                    stages: Object.fromEntries(STAGE_ORDER.map((stage) => [stage, { status: "idle" }])) as Project["analysis"]["stages"],
                    pendingAskUserCall: undefined,
                  },
                };
                void persistProject(resetProject).then(() => runStage("background", resetProject));
              }}
              onShowLog={() => setShowAnalysisLog(true)}
              onRerunStage={(stage) => {
                if (activeStage) return;
                void runStage(stage);
              }}
              onOpenSettings={() => setShowSettings(true)}
              onNavigate={(target) => {
                setRequestedHeadingId(undefined);
                setPendingReadingPosition(undefined);
                setBookEditing(false);
                setActView("detail");
                setCharacterView("detail");
                if (target === "acts") {
                  setSelectedActId(prologueAct?.id ?? firstActId ?? null);
                }
                setView(target);
              }}
            />
          )}
          {STAGE_VIEWS.includes(view) && actView === "detail" && (
            view !== "stage-characters" || characterView === "detail"
          ) && (
            <>
            {bookEditing ? (
              <BookEditor
                sections={markdownSections}
                entities={entities}
                onCreateEntity={(kind, name, sectionKey) => addKeeperEntity(kind, name, sectionKey)}
                onCancel={() => setBookEditing(false)}
                onSave={(markdown) => {
                  void persistProject({
                    ...activeProject,
                    updatedAt: new Date().toISOString(),
                    kpNotes: {
                      ...activeProject.kpNotes,
                      sectionMarkdown: markdown,
                      sectionTemplateVersion: activeProject.kpNotes?.sectionTemplateVersion,
                    },
                  }).then(() => setBookEditing(false));
                }}
              />
            ) : (
            <StageView
              sections={renderedBookSections}
              activeSectionKey={
                view === "acts"
                  ? activeActSectionKey
                  : view
              }
              contentKey={`${activeProject.id}:${activeProject.updatedAt}`}
              requestedHeadingId={requestedHeadingId}
              onHeadingStateChange={(_headings, activeHeadingId) => {
                setActiveNotebookHeadingId(activeHeadingId);
                if (activeHeadingId === requestedHeadingId) {
                  setRequestedHeadingId(undefined);
                }
              }}
              editing={bookEditing}
              onEditingChange={setBookEditing}
              onOpenActTree={() => setActView("tree")}
              initialPage={pendingReadingPosition?.sectionKey === (
                view === "acts" ? activeActSectionKey : view
              ) ? pendingReadingPosition.page : undefined}
              onPageChange={(sectionKey, page) => {
                setPendingReadingPosition(undefined);
                const current = activeProject.lastReadingPosition;
                if (current?.sectionKey === sectionKey && current.page === page) return;
                void persistProject({
                  ...activeProject,
                  lastReadingPosition: {
                    sectionKey,
                    page,
                    updatedAt: new Date().toISOString(),
                  },
                });
              }}
              onActiveSectionChange={(sectionKey) => {
                if (sectionKey.startsWith("acts:")) {
                  setSelectedActId(sectionKey.slice("acts:".length));
                  setView("acts");
                  return;
                }
                setView(sectionKey as View);
              }}
            />
            )}
            </>
          )}
          {view === "source-document" && (
            <SourceDocumentView project={activeProject} sourceUrl={sourceUrl} />
          )}
          {view === "source-images" && (
            <SourceImageExtractor project={activeProject} sourceUrl={sourceUrl} />
          )}
          {view === "acts" && actView === "tree" && (
            <div className="content-stack">
              <div className="act-tree-reader">
                <div className="act-tree-reader-toolbar">
                  <div>
                    <span className="eyebrow">ACT STRUCTURE</span>
                    <h2>幕树</h2>
                  </div>
                  <button
                    className="ghost-button compact"
                    onClick={() => setActView("detail")}
                  >
                    返回文本
                  </button>
                </div>
                <ActTreeView
                  acts={activeProject.analysis.acts}
                  onSelectAct={(actId) => {
                    setSelectedActId(actId);
                    setActView("detail");
                  }}
                />
              </div>
            </div>
          )}
          {view === "stage-characters" && characterView === "relations" && (
            <div className="content-stack">
              <div className="act-tree-reader character-relations-reader">
                <div className="act-tree-reader-toolbar">
                  <div>
                    <span className="eyebrow">CHARACTER RELATIONS</span>
                    <h2>核心人物关系</h2>
                  </div>
                  <div className="character-relations-toolbar-actions">
                    <span>滚轮缩放；点击人物可打开资料卡。</span>
                    <button
                      className="ghost-button compact"
                      onClick={() => setCharacterView("detail")}
                    >
                      返回文本
                    </button>
                  </div>
                </div>
                <CoreCharacterRelations
                  project={activeProject}
                  onSelectPerson={(personId) => openEntityWindow(`person:${personId}`)}
                />
              </div>
            </div>
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
      {showAnalysisLog && (
        <AnalysisLogModal
          entries={activeProject.analysis.activityLog ?? []}
          onClose={() => setShowAnalysisLog(false)}
        />
      )}
      {wizardStage && realtimeAskUserCall ? (
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
      {isContinuing && (
        <div className="analysis-progress-toast" role="status" aria-live="polite">
          <span className="analysis-loading-spinner" />
          <strong>已记录裁决，分析继续在后台进行…</strong>
        </div>
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)}>
          <SettingsView
            config={modelConfig}
            apiKey={apiKey}
            rememberApiKey={rememberApiKey}
            testState={testState}
            onConfig={setModelConfig}
            onApiKey={setApiKey}
            onRememberApiKey={setRememberApiKey}
            onTest={testConnection}
          />
        </SettingsModal>
      )}
      {selectedActPerson && (
        <PersonDetailPanel
          person={selectedActPerson}
          acts={activeProject.analysis.acts}
          clues={activeProject.analysis.clues}
          onClose={() => setSelectedActPersonId(null)}
          onSelectAct={(actId) => {
            setSelectedActId(actId);
            setActView("detail");
            setSelectedActPersonId(null);
          }}
          onUpdatePerson={(person) =>
            void persistProject({
              ...activeProject,
              updatedAt: new Date().toISOString(),
              analysis: {
                ...activeProject.analysis,
                people: activeProject.analysis.people.map((candidate) =>
                  candidate.id === person.id ? person : candidate,
                ),
              },
            })
          }
        />
      )}
      {editingEntityRef && entities.find((entity) => entity.ref === editingEntityRef) && (
        <EntityEditOverlay
          entity={entities.find((entity) => entity.ref === editingEntityRef)!}
          onClose={() => setEditingEntityRef(null)}
          onSave={saveEntityOverride}
        />
      )}
      {entityWindows.map((floatingWindow) => (
        <EntityWindow
          key={floatingWindow.id}
          entities={entities}
          project={activeProject}
          initialRef={floatingWindow.entityRef}
          x={floatingWindow.x}
          y={floatingWindow.y}
          width={floatingWindow.width}
          zIndex={floatingWindow.zIndex}
          onClose={() => setEntityWindows((current) => current.filter((item) => item.id !== floatingWindow.id))}
          onFocus={() => focusEntityWindow(floatingWindow.id)}
          onMove={(x, y) => setEntityWindows((current) => current.map((item) => item.id === floatingWindow.id ? { ...item, x, y } : item))}
          onOpenRelated={(entityRef) => openEntityWindow(entityRef)}
          onOpenRelations={openPersonRelationWindow}
          onOpenCoreRelations={openCoreCharacterRelations}
          onJump={jumpToEntity}
          onSave={saveEntityOverride}
          onCreate={(kind, name, relatedTo) => addKeeperEntity(kind, name, relatedTo?.appearances[0]?.sectionKey ?? "stage-background", relatedTo)}
          onDelete={(entity) => {
            if (entity.source !== "keeper" || !window.confirm(`删除“${entity.original.name}”实体卡？书页文字会保留。`)) return;
            void persistProject({
              ...activeProject,
              updatedAt: new Date().toISOString(),
              kpNotes: {
                ...activeProject.kpNotes,
                keeperEntities: (activeProject.kpNotes?.keeperEntities ?? []).filter((candidate) => candidate.ref !== entity.ref),
                entityRelations: (activeProject.kpNotes?.entityRelations ?? []).filter((relation) => relation.sourceRef !== entity.ref && relation.targetRef !== entity.ref),
              },
            }).then(() => setEntityWindows((current) => current.filter((item) => item.id !== floatingWindow.id)));
          }}
        />
      ))}
      {personRelationWindows.map((floatingWindow) => (
        <PersonRelationWindow
          key={floatingWindow.id}
          project={activeProject}
          entityRef={floatingWindow.entityRef}
          x={floatingWindow.x}
          y={floatingWindow.y}
          width={floatingWindow.width}
          height={floatingWindow.height}
          zIndex={floatingWindow.zIndex}
          onClose={() => setPersonRelationWindows((current) => current.filter((item) => item.id !== floatingWindow.id))}
          onFocus={() => setPersonRelationWindows((current) => current.map((item) => item.id === floatingWindow.id ? { ...item, zIndex: ++floatingWindowZRef.current } : item))}
          onMove={(x, y) => setPersonRelationWindows((current) => current.map((item) => item.id === floatingWindow.id ? { ...item, x, y } : item))}
          onResize={(width, height) => setPersonRelationWindows((current) => current.map((item) => item.id === floatingWindow.id ? { ...item, width, height } : item))}
          onOpenEntity={openEntityWindow}
        />
      ))}
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
