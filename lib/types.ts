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

export type TimePlace = {
  timeline: string;
  places: Place[];
};

export type CharacterArc = {
  personId: string;
  experience: string;
  motivation: string;
};

export type CoCStats = {
  str?: number;
  con?: number;
  dex?: number;
  int?: number;
  pow?: number;
  hp?: number;
  sanLoss?: string;
  mp?: number;
};

export type KeyEvent = {
  title: string;
  type: "boss" | "death" | "revelation" | "checkpoint";
  description: string;
  stats?: CoCStats;
};

export type ActBranch = {
  id: string;
  condition: string;
  nextActId?: string;
  isEnding?: boolean;
  endingType?: "good" | "bad" | "neutral";
};

export type Act = {
  id: string;
  title: string;
  sequence: number;
  placeId?: string;
  placeText?: string;
  time: string;
  personIds: string[];
  clueIds: string[];
  branches: ActBranch[];
  keyEvents: KeyEvent[];
  description: string;
};

export type ChapterSummary = {
  chapterId: string;
  background: string;
  timeAndPlace: string;
  coreCharacters: string;
  characterArcs: string;
  openingHook: string;
  clueArrangements: Array<{
    name: string;
    acquisition: string;
    leadsTo: string;
  }>;
  acts: Array<{ actId: string; title: string; summary: string }>;
  keyEvents: KeyEvent[];
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

export type AnalysisStage =
  | "background"
  | "timeplace"
  | "characters"
  | "characterArcs"
  | "openingHook"
  | "clues"
  | "acts";

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
  timePlace?: TimePlace;
  people: Person[];
  unresolvedRelationCount: number;
  characterArcs?: CharacterArc[];
  openingHook?: string;
  clues: Clue[];
  acts: Act[];
  chapterSummaries: ChapterSummary[];
  places: Place[];
  maps: AtlasMap[];
  markers: MapMarker[];
  reviewItems: ReviewItem[];
  activityLog: AnalysisLogEntry[];
  stages: Record<AnalysisStage, StageState>;
  pendingAskUserCall?: {
    stage: AnalysisStage;
    callId: string;
    question: string;
    options: string[];
    context: string;
    previousMessages: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string | null;
      tool_call_id?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }>;
  };
};

export type KPNotes = {
  stageViewOverrides?: Record<string, Record<string, string>>;
  actViewOverrides?: Record<string, Record<string, string>>;
  sectionNotes?: Record<string, KPNoteBlock[]>;
  sectionMarkdown?: Record<string, string>;
};

export type KPNoteBlock = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type ReadingPosition = {
  sectionKey: string;
  page: number;
  updatedAt: string;
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
  kpNotes?: KPNotes;
  lastReadingPosition?: ReadingPosition;
};

export type ModelConfig = {
  baseUrl: string;
  model: string;
  confirmMode?: "tier1" | "tier2" | "tier3";
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
  unresolvedRelationCount: 0,
  characterArcs: [],
  openingHook: "",
  clues: [],
  acts: [],
  chapterSummaries: [],
  places: [],
  maps: [],
  markers: [],
  reviewItems: [],
  activityLog: [],
  stages: {
    background: { status: "idle" },
    timeplace: { status: "idle" },
    characters: { status: "idle" },
    characterArcs: { status: "idle" },
    openingHook: { status: "idle" },
    clues: { status: "idle" },
    acts: { status: "idle" },
  },
});
