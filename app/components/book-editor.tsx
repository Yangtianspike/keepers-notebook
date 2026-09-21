"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { buildNotebookOutline } from "@/lib/notebook-outline";
import {
  editableHtmlToMarkdown,
  markdownToEditableHtml,
  normalizeFontToken,
  isSafeImageUrl,
  type MarkdownFont,
} from "@/lib/markdown";
import {
  ENTITY_KIND_LABELS,
  entityName,
  keeperEntityUri,
} from "@/lib/entities";
import type { EntityCard, EntityKind } from "@/lib/types";

const MAX_IMAGE_EDGE = 1600;
const MAX_IMAGE_BYTES = 1024 * 1024;

export type BookEditorSession = {
  drafts: Record<string, string>;
  activeKey: string;
  sourceMode: boolean;
  dirty: boolean;
  lastEditedKey?: string;
  lastHeadingId?: string;
  focusHeadingId?: string;
  expandedHeadingIds: string[];
  scrollBySection: Record<string, number>;
  outlineScrollTop: number;
};

export type NewEntityRelation = {
  targetRef: string;
  label: string;
};

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil(base64.length * 0.75);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片格式无法读取。"));
    image.src = src;
  });
}

async function compressImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1 && dataUrlBytes(original) <= MAX_IMAGE_BYTES && isSafeImageUrl(original)) return original;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法压缩图片。");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (let quality = 0.9; quality >= 0.45; quality -= 0.1) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(dataUrl) <= MAX_IMAGE_BYTES) return dataUrl;
  }
  throw new Error("图片压缩后仍超过 1MB，请选择更小的图片。");
}

export function BookEditor({
  sections,
  entities,
  initialSession,
  onSessionChange,
  onCreateEntity,
  onOpenCreatedEntity,
  onSave,
  onCancel,
}: {
  sections: Array<{
    key: string;
    name: string;
    markdown: string;
    templateMarkdown: string;
    customized: boolean;
  }>;
  entities: EntityCard[];
  initialSession?: BookEditorSession;
  onSessionChange: (session: BookEditorSession) => void;
  onCreateEntity: (kind: EntityKind, name: string, sectionKey: string, relations: NewEntityRelation[]) => EntityCard;
  onOpenCreatedEntity: (entity: EntityCard) => void;
  onSave: (markdown: Record<string, string>, target: { sectionKey: string; headingId?: string }) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => initialSession?.drafts ??
    Object.fromEntries(sections.map((section) => [section.key, section.markdown])));
  const draftsRef = useRef(drafts);
  const [activeKey, setActiveKey] = useState(initialSession?.activeKey ?? sections[0]?.key ?? "");
  const [sourceMode, setSourceMode] = useState(initialSession?.sourceMode ?? false);
  const [dirty, setDirty] = useState(initialSession?.dirty ?? false);
  const [lastEditedKey, setLastEditedKey] = useState(initialSession?.lastEditedKey);
  const [lastHeadingId, setLastHeadingId] = useState(initialSession?.lastHeadingId);
  const [focusHeadingId, setFocusHeadingId] = useState(initialSession?.focusHeadingId);
  const [expandedHeadingIds, setExpandedHeadingIds] = useState<Set<string>>(
    () => new Set(initialSession?.expandedHeadingIds ?? []),
  );
  const [scrollBySection, setScrollBySection] = useState<Record<string, number>>(
    initialSession?.scrollBySection ?? {},
  );
  const [outlineScrollTop, setOutlineScrollTop] = useState(initialSession?.outlineScrollTop ?? 0);
  const [entityPicker, setEntityPicker] = useState(false);
  const [entityCreator, setEntityCreator] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [selectedEntityRef, setSelectedEntityRef] = useState("");
  const [createKind, setCreateKind] = useState<EntityKind>("person");
  const [createName, setCreateName] = useState("");
  const [createRelations, setCreateRelations] = useState<Record<string, string>>({});
  const [insertCreatedLink, setInsertCreatedLink] = useState(true);
  const [jump, setJump] = useState(true);
  const [preview, setPreview] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);
  const sourceEditorRef = useRef<HTMLTextAreaElement>(null);
  const outlineRef = useRef<HTMLElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const [toolError, setToolError] = useState("");
  const active = sections.find((section) => section.key === activeKey) ?? sections[0];
  const outline = useMemo(() => buildNotebookOutline(sections.map((section) => ({
    key: section.key,
    markdown: drafts[section.key] ?? "",
  }))), [drafts, sections]);
  const outlineById = useMemo(() => new Map(outline.map((heading) => [heading.id, heading])), [outline]);
  const visibleOutline = outline.filter((heading) => {
    let current = heading;
    while (current.parentId) {
      if (!expandedHeadingIds.has(current.parentId)) return false;
      const parent = outlineById.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return true;
  });

  useEffect(() => {
    onSessionChange({
      drafts,
      activeKey,
      sourceMode,
      dirty,
      lastEditedKey,
      lastHeadingId,
      focusHeadingId,
      expandedHeadingIds: [...expandedHeadingIds],
      scrollBySection,
      outlineScrollTop,
    });
  }, [activeKey, dirty, drafts, expandedHeadingIds, focusHeadingId, lastEditedKey, lastHeadingId, onSessionChange, outlineScrollTop, scrollBySection, sourceMode]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!sourceMode && editorRef.current && active) {
      editorRef.current.innerHTML = markdownToEditableHtml(draftsRef.current[active.key] ?? "");
      editorRef.current.scrollTop = scrollBySection[active.key] ?? 0;
    } else if (sourceMode && sourceEditorRef.current && active) {
      sourceEditorRef.current.scrollTop = scrollBySection[active.key] ?? 0;
    }
    // Draft changes originate in this DOM while visual mode is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key, sourceMode]);

  useEffect(() => {
    if (outlineRef.current) outlineRef.current.scrollTop = outlineScrollTop;
    // Restoring the saved scroll position must not feed another state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headingIndexAtVisualSelection = () => {
    if (!active || !editorRef.current) return -1;
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    if (!anchor || !editorRef.current.contains(anchor)) return -1;
    const anchorElement = anchor instanceof Element ? anchor : anchor.parentElement;
    if (!anchorElement) return -1;
    const headings = Array.from(editorRef.current.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const headingIndex = headings.findLastIndex((heading) => (
      heading === anchorElement ||
      heading.contains(anchorElement) ||
      Boolean(heading.compareDocumentPosition(anchorElement) & Node.DOCUMENT_POSITION_FOLLOWING)
    ));
    return headingIndex;
  };

  const syncFromVisual = () => {
    if (!active || !editorRef.current) return;
    const markdown = editableHtmlToMarkdown(editorRef.current);
    const changed = markdown !== (draftsRef.current[active.key] ?? "");
    draftsRef.current = { ...draftsRef.current, [active.key]: markdown };
    setDrafts(draftsRef.current);
    if (changed) {
      setDirty(true);
      setLastEditedKey(active.key);
      const nextOutline = buildNotebookOutline(sections.map((section) => ({
        key: section.key,
        markdown: draftsRef.current[section.key] ?? "",
      })));
      const headingIndex = headingIndexAtVisualSelection();
      setLastHeadingId(nextOutline.find((heading) => heading.sectionKey === active.key && heading.headingIndex === headingIndex)?.id);
    }
  };

  const openHeading = (index: number) => {
    if (sourceMode) setSourceMode(false);
    window.setTimeout(() => {
      const heading = editorRef.current?.querySelectorAll("h1,h2,h3,h4,h5,h6")[index];
      heading?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (heading instanceof HTMLElement) {
        heading.focus();
        const range = document.createRange();
        range.selectNodeContents(heading);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }, 0);
  };

  const openOutlineHeading = (headingId: string) => {
    const heading = outlineById.get(headingId);
    if (!heading) return;
    if (!sourceMode) syncFromVisual();
    setActiveKey(heading.sectionKey);
    setFocusHeadingId(headingId);
    setExpandedHeadingIds((current) => {
      const next = new Set(current);
      let parentId = heading.parentId;
      while (parentId) {
        next.add(parentId);
        parentId = outlineById.get(parentId)?.parentId;
      }
      return next;
    });
    window.setTimeout(() => {
      const currentHeading = outlineById.get(headingId);
      if (currentHeading && currentHeading.headingIndex >= 0) openHeading(currentHeading.headingIndex);
    }, 0);
  };

  useEffect(() => {
    if (!focusHeadingId) return;
    const heading = outlineById.get(focusHeadingId);
    if (!heading || heading.sectionKey !== active?.key) return;
    const timeout = window.setTimeout(() => {
      if (heading.headingIndex >= 0) openHeading(heading.headingIndex);
    }, 0);
    return () => window.clearTimeout(timeout);
    // openHeading intentionally acts on the freshly rendered editor DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key, focusHeadingId]);

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    const range = selectionRef.current;
    if (!range || !editorRef.current?.contains(range.commonAncestorContainer)) return false;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  };

  const command = (name: string, value?: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(name, false, value);
    syncFromVisual();
    rememberSelection();
  };

  const insertHtml = (html: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand("insertHTML", false, html);
    syncFromVisual();
    rememberSelection();
  };

  const applyFont = (font: MarkdownFont) => {
    if (!restoreSelection()) return;
    const range = selectionRef.current;
    if (!range || range.collapsed) return;
    const span = document.createElement("span");
    span.dataset.font = font;
    span.append(range.extractContents());
    range.insertNode(span);
    range.selectNodeContents(span);
    rememberSelection();
    syncFromVisual();
  };

  const insertImageUrl = () => {
    const value = window.prompt("输入图片 URL（仅支持 http/https）：")?.trim() ?? "";
    if (!value) return;
    if (!isSafeImageUrl(value) || value.startsWith("data:") || value.startsWith("blob:")) {
      setToolError("图片 URL 必须使用 http 或 https。");
      return;
    }
    setToolError("");
    insertHtml(`<figure><img src="${value.replace(/"/g, "&quot;")}" alt=""><figcaption></figcaption></figure><p><br></p>`);
  };

  const openEntityPicker = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!selection || selection.rangeCount === 0 || !text || !editorRef.current?.contains(selection.anchorNode)) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
    setSelectedText(text);
    const nameMatch = entities.find((entity) => entityName(entity) === text);
    setSelectedEntityRef(nameMatch?.ref ?? "");
    setEntityPicker(true);
  };

  const linkEntity = (entity: EntityCard) => {
    if (!restoreSelection()) return;
    document.execCommand("createLink", false, keeperEntityUri(entity.ref, { jump, preview }));
    syncFromVisual();
    setEntityPicker(false);
  };

  const openEntityCreator = (name = "") => {
    rememberSelection();
    setCreateName(name);
    setCreateRelations({});
    setInsertCreatedLink(true);
    setEntityCreator(true);
  };

  const createEntityFromDialog = () => {
    if (!active || !createName.trim()) return;
    const relations = Object.entries(createRelations).flatMap(([targetRef, label]) => (
      label.trim() ? [{ targetRef, label: label.trim() }] : []
    ));
    const entity = onCreateEntity(createKind, createName.trim(), active.key, relations);
    if (insertCreatedLink && restoreSelection()) {
      insertHtml(`<a href="${keeperEntityUri(entity.ref, { jump, preview })}">${createName.trim().replace(/[<>]/g, "")}</a>`);
    }
    setEntityCreator(false);
    setEntityPicker(false);
    onOpenCreatedEntity(entity);
  };

  return (
    <div className="visual-editor-shell">
      <header className="visual-editor-header">
        <div>
          <strong>可视化书页编辑</strong>
          <span>{dirty ? "有尚未保存的修改" : "像文档一样修改内容；Markdown 只作为底层存储。"}</span>
        </div>
        <div>
          <button className="ghost-button compact" type="button" onClick={() => {
            if (!sourceMode) {
              syncFromVisual();
              setDrafts({ ...draftsRef.current });
            }
            setSourceMode((value) => !value);
          }}>
            {sourceMode ? "返回可视化" : "Markdown 源码"}
          </button>
          <button className="ghost-button compact" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button compact" type="button" onClick={() => {
            if (!sourceMode) syncFromVisual();
            window.setTimeout(() => onSave({
              ...draftsRef.current,
              ...(active && !sourceMode && editorRef.current
                ? { [active.key]: editableHtmlToMarkdown(editorRef.current) }
                : {}),
            }, {
              sectionKey: lastEditedKey ?? active?.key ?? sections[0]?.key ?? "stage-background",
              headingId: lastHeadingId,
            }), 0);
          }}>保存并返回书页</button>
        </div>
      </header>
      <div className="visual-editor-workspace">
        <nav
          className="visual-editor-outline"
          aria-label="文档目录"
          ref={outlineRef}
          onScroll={(event) => setOutlineScrollTop(event.currentTarget.scrollTop)}
        >
          <strong>文档目录</strong>
          {visibleOutline.map((heading) => (
            <div
              className="visual-editor-outline-row"
              data-level={heading.level}
              key={heading.id}
              style={{ "--editor-outline-depth": heading.level - 1 } as CSSProperties}
            >
              {heading.hasChildren ? (
                <button
                  className="visual-editor-outline-toggle"
                  type="button"
                  aria-label={`${expandedHeadingIds.has(heading.id) ? "收起" : "展开"}${heading.title}`}
                  onClick={() => setExpandedHeadingIds((current) => {
                    const next = new Set(current);
                    if (next.has(heading.id)) next.delete(heading.id);
                    else next.add(heading.id);
                    return next;
                  })}
                >{expandedHeadingIds.has(heading.id) ? "▾" : "▸"}</button>
              ) : <span className="visual-editor-outline-spacer" />}
              <button
                className={`visual-editor-outline-heading${heading.sectionKey === activeKey ? " active" : ""}`}
                type="button"
                title={`H${heading.level} · ${heading.title}`}
                onClick={() => openOutlineHeading(heading.id)}
              >{heading.title || "未命名标题"}</button>
            </div>
          ))}
        </nav>
        <div className="visual-editor-main">
        {!sourceMode && (
          <div className="visual-format-toolbar" aria-label="文档格式工具">
          <select aria-label="段落样式" defaultValue="p" onChange={(event) => command("formatBlock", event.target.value)}>
            <option value="p">正文</option><option value="h1">H1</option><option value="h2">H2</option><option value="h3">H3</option><option value="h4">H4</option><option value="h5">H5</option><option value="h6">H6</option>
          </select>
          <button type="button" onClick={() => command("bold")}><strong>B</strong></button>
          <button type="button" onClick={() => command("italic")}><em>I</em></button>
          <button type="button" onClick={() => command("underline")}><u>U</u></button>
          <button type="button" onClick={() => command("strikeThrough")}><s>S</s></button>
          <button type="button" onClick={() => command("insertUnorderedList")}>• 列表</button>
          <button type="button" onClick={() => command("insertOrderedList")}>1. 列表</button>
          <button type="button" onClick={() => command("formatBlock", "blockquote")}>引用</button>
          <button type="button" onClick={() => command("insertHorizontalRule")}>分隔线</button>
          <button type="button" title="快捷键 Ctrl+Z" onClick={() => command("undo")}>撤销（Ctrl+Z）</button>
          <button type="button" title="恢复刚刚撤销的内容；快捷键 Ctrl+Y" onClick={() => command("redo")}>恢复撤销（Ctrl+Y）</button>
          <button type="button" onClick={() => insertHtml("<table><thead><tr><th>标题 1</th><th>标题 2</th><th>标题 3</th></tr></thead><tbody><tr><td>内容</td><td>内容</td><td>内容</td></tr><tr><td>内容</td><td>内容</td><td>内容</td></tr></tbody></table><p><br></p>")}>插入表格</button>
          <button type="button" onClick={insertImageUrl}>图片 URL</button>
          <button type="button" onClick={() => imageInputRef.current?.click()}>上传图片</button>
          <select aria-label="字体" defaultValue="" onChange={(event) => {
            const font = normalizeFontToken(event.target.value);
            if (font) applyFont(font);
            event.target.value = "";
          }}>
            <option value="">字体</option><option value="serif">宋体</option><option value="sans">无衬线</option><option value="kai">楷体</option>
          </select>
          <button className="entity-link-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={openEntityPicker}>关联实体</button>
          <button className="entity-link-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => openEntityCreator()}>新建实体</button>
          <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void compressImage(file).then((dataUrl) => {
              setToolError("");
              insertHtml(`<figure><img src="${dataUrl}" alt="${file.name.replace(/["<>]/g, "")}"><figcaption>${file.name.replace(/[<>]/g, "")}</figcaption></figure><p><br></p>`);
            }).catch((error: unknown) => setToolError(error instanceof Error ? error.message : "图片处理失败。"));
          }} />
          </div>
        )}
        {toolError && <p className="editor-tool-error" role="alert">{toolError}</p>}
        {active && (sourceMode ? (
        <textarea
          className="visual-editor-source"
          ref={sourceEditorRef}
          aria-label={`${active.name} Markdown`}
          spellCheck={false}
          value={drafts[active.key] ?? ""}
          onChange={(event) => {
            const next = { ...draftsRef.current, [active.key]: event.target.value };
            draftsRef.current = next;
            setDrafts(next);
            setDirty(true);
            setLastEditedKey(active.key);
            const beforeCursor = event.target.value.slice(0, event.target.selectionStart);
            const headingIndex = Math.max(-1, Array.from(beforeCursor.matchAll(/^(#{1,6})\s+.+$/gm)).length - 1);
            const nextOutline = buildNotebookOutline(sections.map((section) => ({
              key: section.key,
              markdown: next[section.key] ?? "",
            })));
            setLastHeadingId(nextOutline.find((heading) => heading.sectionKey === active.key && heading.headingIndex === headingIndex)?.id);
          }}
          onScroll={(event) => {
            const scrollTop = event.currentTarget.scrollTop;
            setScrollBySection((current) => ({ ...current, [active.key]: scrollTop }));
          }}
        />
      ) : (
        <article
          className="visual-document-editor markdown-document"
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onInput={syncFromVisual}
          onScroll={(event) => {
            const scrollTop = event.currentTarget.scrollTop;
            setScrollBySection((current) => ({ ...current, [active.key]: scrollTop }));
          }}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
        />
        ))}
        </div>
      </div>
      {entityPicker && (
        <div className="editor-entity-picker">
          <header><strong>关联“{selectedText}”</strong><button type="button" onClick={() => setEntityPicker(false)}>×</button></header>
          <select value={selectedEntityRef} onChange={(event) => setSelectedEntityRef(event.target.value)}>
            <option value="">选择已有实体</option>
            {entities.map((entity) => <option value={entity.ref} key={entity.ref}>{ENTITY_KIND_LABELS[entity.kind]} · {entityName(entity)}</option>)}
          </select>
          <div className="entity-picker-behavior">
            <label><input type="checkbox" checked={jump} onChange={(event) => setJump(event.target.checked)} />跳转</label>
            <label><input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} />资料窗口</label>
          </div>
          <button type="button" disabled={!selectedEntityRef} onClick={() => {
            const entity = entities.find((candidate) => candidate.ref === selectedEntityRef);
            if (entity) linkEntity(entity);
          }}>关联已有实体</button>
          <div className="entity-picker-create">
            <select value={createKind} onChange={(event) => setCreateKind(event.target.value as EntityKind)}>
              {Object.entries(ENTITY_KIND_LABELS).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}
            </select>
            <button type="button" onClick={() => openEntityCreator(selectedText)}>创建实体并关联</button>
          </div>
        </div>
      )}
      {entityCreator && active && (
        <div className="editor-entity-picker editor-entity-creator" role="dialog" aria-modal="true" aria-label="新建实体">
          <header><strong>新建实体</strong><button type="button" aria-label="关闭" onClick={() => setEntityCreator(false)}>×</button></header>
          <label>实体类型<select value={createKind} onChange={(event) => setCreateKind(event.target.value as EntityKind)}>
            {Object.entries(ENTITY_KIND_LABELS).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}
          </select></label>
          <label>实体名称<input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} /></label>
          <fieldset className="entity-creator-relations">
            <legend>关联已有实体（可选）</legend>
            <p>勾选对象并填写关系说明；保存后双方关系图立即更新。</p>
            <div>
              {entities.map((entity) => (
                <label key={entity.ref}>
                  <input
                    type="checkbox"
                    checked={entity.ref in createRelations}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setCreateRelations((current) => {
                      const next = { ...current };
                      if (checked) next[entity.ref] = "KP 新建关联";
                      else delete next[entity.ref];
                      return next;
                      });
                    }}
                  />
                  <span>{ENTITY_KIND_LABELS[entity.kind]} · {entityName(entity)}</span>
                  {entity.ref in createRelations && <input value={createRelations[entity.ref]} aria-label={`与${entityName(entity)}的关系`} onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCreateRelations((current) => ({ ...current, [entity.ref]: value }));
                  }} />}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="entity-creator-insert"><input type="checkbox" checked={insertCreatedLink} onChange={(event) => setInsertCreatedLink(event.target.checked)} />同时在当前光标处插入实体链接</label>
          <button type="button" disabled={!createName.trim()} onClick={createEntityFromDialog}>创建并打开资料卡</button>
        </div>
      )}
    </div>
  );
}
