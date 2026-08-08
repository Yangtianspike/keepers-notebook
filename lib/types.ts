export type Provenance = "source" | "inference" | "keeper" | "conflict";

export type SourceRef = {
  page: number;
  printedPage?: string;
  chapter?: string;
  quote: string;
  verified?: boolean;
};

export type Chapter = {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  included: boolean;
};

export type DocumentPage = {
  pageNumber: number;
  printedPage?: string;
  text: string;
  imageHeavy?: boolean;
};

export type TextChunk = {
  id: string;
  projectId: string;
  index: number;
  text: string;
  startPage: number;
  endPage: number;
};

export type StoryOverview = {
  oneLine: string;
  cause: string;
  history: string;
  currentState: string;
  plans: Array<{ faction: string; plan: string }>;
  endings: string[];
  externalDependencies: string[];
  conflicts: Array<{
    summary: string;
    options: string[];
    sources: SourceRef[];
  }>;
};

export type Person = {
  id: string;
  name: string;
  aliases: string[];
  role: string;
  importance: "core" | "important" | "minor";
  publicIdentity: string;
  trueIdentity: string;
  motivation: string;
  secrets: string[];
  confidence: number;
  provenance: Provenance;
  sources: SourceRef[];
  organization?: string;
  portrait?: string;
  portraitSource?: "manual" | "extracted" | "generated";
};

export type Place = {
  id: string;
  name: string;
  aliases: string[];
  summary: string;
  description?: string;
  regionHint?: string;
  confirmed: boolean;
  provenance: Provenance;
  sources: SourceRef[];
};

export type AtlasMap = {
  id: string;
  name: string;
  imageKey: string;
  width: number;
  height: number;
  createdAt: string;
};

export type MapMarker = {
  id: string;
  mapId: string;
  placeId: string;
  x: number;
  y: number;
};

export type Relation = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  type: "real" | "hidden";
  confidence: number;
  sources: SourceRef[];
};

export type TimelineEvent = {
  id: string;
  title: string;
  date: string;
  summary: string;
  kind: "history" | "present" | "default" | "branch";
  parentId?: string;
  trigger?: string;
  outcome?: string;
  confidence: number;
  provenance: Provenance;
  sources: SourceRef[];
};

export type ClueTarget = {
  id: string;
  type: "person" | "place" | "event" | "truth";
  label: string;
  priority: "primary" | "secondary";
  confirmed?: boolean;
};

export type Clue = {
  id: string;
  name: string;
  summary: string;
  source: string;
  acquisition?: string;
  missCondition?: string;
  importance: "key" | "secondary" | "other";
  targets: ClueTarget[];
  fallback?: string;
  risk?: string;
  keeperSuggestion?: string;
  confidence: number;
  provenance: Provenance;
  sources: SourceRef[];
};

export type ReviewItem = {
  id: string;
  type: "merge" | "relation" | "event" | "conflict" | "external" | "quote" | "place";
  severity: "warning" | "critical";
  title: string;
  description: string;
  candidateNames?: string[];
  status: "pending" | "accepted" | "rejected";
  sources: SourceRef[];
  keeperNote?: string;
  applyToAnalysis?: boolean;
  appliedAt?: string;
  proposal?:
    | { kind: "clueTruth"; clueId: string; targetId: string }
    | { kind: "placeConfirm"; placeId: string };
  stage?: AnalysisStage;
};

export type AnalysisStage = "overview" | "people" | "relations" | "timeline" | "clues";

export type StageState = {
  status: "idle" | "running" | "paused" | "complete" | "error";
  error?: string;
  updatedAt?: string;
};

export type AnalysisLogEntry = {
  id: string;
  stage: AnalysisStage;
  kind: "started" | "progress" | "checkpoint" | "paused" | "completed" | "error";
  message: string;
  createdAt: string;
};

export type ProjectAnalysis = {
  overview?: StoryOverview;
  people: Person[];
  relations: Relation[];
  unresolvedRelationCount: number;
  timeline: TimelineEvent[];
  clues: Clue[];
  clueLayout: Record<string, { x: number; y: number }>;
  places: Place[];
  maps: AtlasMap[];
  markers: MapMarker[];
  reviewItems: ReviewItem[];
  activityLog: AnalysisLogEntry[];
  stages: Record<AnalysisStage, StageState>;
};

export type Project = {
  id: string;
  name: string;
  fileName: string;
  fileType: "pdf" | "docx" | "markdown";
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  status: "imported" | "structured" | "analyzing" | "ready";
  documentText: string;
  pages: DocumentPage[];
  chapters: Chapter[];
  analysis: ProjectAnalysis;
};

export type ModelConfig = {
  baseUrl: string;
  model: string;
  capabilities?: ModelCapabilities;
};

export type EmbeddingCapability = {
  model: string;
  dimensions: number;
  testedAt: string;
};

export type ModelCapabilities = {
  chat: { model: string };
  embedding?: EmbeddingCapability;
};

export const emptyAnalysis = (): ProjectAnalysis => ({
  people: [],
  relations: [],
  unresolvedRelationCount: 0,
  timeline: [],
  clues: [],
  clueLayout: {},
  places: [],
  maps: [],
  markers: [],
  reviewItems: [],
  activityLog: [],
  stages: {
    overview: { status: "idle" },
    people: { status: "idle" },
    relations: { status: "idle" },
    timeline: { status: "idle" },
    clues: { status: "idle" },
  },
});
