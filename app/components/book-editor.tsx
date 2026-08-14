"use client";

import { useEffect, useRef, useState } from "react";
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
  onCreateEntity,
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
  onCreateEntity: (kind: EntityKind, name: string, sectionKey: string) => EntityCard;
  onSave: (markdown: Record<string, string>, appliedTemplateKeys: string[]) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(sections.map((section) => [section.key, section.markdown])),
  );
  const draftsRef = useRef(drafts);
  const [activeKey, setActiveKey] = useState(sections[0]?.key ?? "");
  const [sourceMode, setSourceMode] = useState(false);
  const [entityPicker, setEntityPicker] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [selectedEntityRef, setSelectedEntityRef] = useState("");
  const [createKind, setCreateKind] = useState<EntityKind>("person");
  const [jump, setJump] = useState(true);
  const [preview, setPreview] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const [toolError, setToolError] = useState("");
  const [appliedTemplateKeys, setAppliedTemplateKeys] = useState<string[]>([]);
  const active = sections.find((section) => section.key === activeKey) ?? sections[0];
  const templateEligible = Boolean(active && (
    active.key === "stage-characters" ||
    active.key === "stage-characterArcs" ||
    active.key === "stage-openingHook" ||
    active.key.startsWith("acts:")
  ));

  useEffect(() => {
    if (!sourceMode && editorRef.current && active) {
      editorRef.current.innerHTML = markdownToEditableHtml(draftsRef.current[active.key] ?? "");
    }
    // Draft changes originate in this DOM while visual mode is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key, sourceMode]);

  const syncFromVisual = () => {
    if (!active || !editorRef.current) return;
    const markdown = editableHtmlToMarkdown(editorRef.current);
    draftsRef.current = { ...draftsRef.current, [active.key]: markdown };
  };

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    const range = selectionRef.current;
    if (!range) return false;
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

  return (
    <div className="visual-editor-shell">
      <header className="visual-editor-header">
        <div>
          <strong>可视化书页编辑</strong>
          <span>像文档一样修改内容；Markdown 只作为底层存储。</span>
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
            }, appliedTemplateKeys), 0);
          }}>保存并返回书页</button>
        </div>
      </header>
      <nav className="visual-editor-tabs">
        {sections.map((section) => (
          <button className={section.key === activeKey ? "active" : ""} type="button" key={section.key} onClick={() => {
            if (!sourceMode) syncFromVisual();
            setActiveKey(section.key);
          }}>{section.name}</button>
        ))}
      </nav>
      {active && templateEligible && (
        <div className="template-upgrade-bar">
          <span>{active.customized ? "当前章节保存过自定义内容。" : "当前章节正在使用生成模板。"}</span>
          <button type="button" onClick={() => {
            if (!window.confirm(`应用 v0.8 模板会替换“${active.name}”当前编辑草稿；其他章节不受影响。是否继续？`)) return;
            const next = { ...draftsRef.current, [active.key]: active.templateMarkdown };
            draftsRef.current = next;
            setDrafts(next);
            setAppliedTemplateKeys((current) => current.includes(active.key) ? current : [...current, active.key]);
            if (!sourceMode && editorRef.current) editorRef.current.innerHTML = markdownToEditableHtml(active.templateMarkdown);
          }}>应用 v0.8 模板</button>
        </div>
      )}
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
          <button type="button" onClick={() => command("insertParagraph")}>新增段落</button>
          <button type="button" onClick={() => command("undo")}>撤销</button>
          <button type="button" onClick={() => command("redo")}>重做</button>
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
          aria-label={`${active.name} Markdown`}
          spellCheck={false}
          value={drafts[active.key] ?? ""}
          onChange={(event) => {
            const next = { ...draftsRef.current, [active.key]: event.target.value };
            draftsRef.current = next;
            setDrafts(next);
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
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
        />
      ))}
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
            <button type="button" onClick={() => linkEntity(onCreateEntity(createKind, selectedText, active.key))}>创建实体并关联</button>
          </div>
        </div>
      )}
    </div>
  );
}
