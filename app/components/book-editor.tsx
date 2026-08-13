"use client";

import { useEffect, useRef, useState } from "react";
import {
  editableHtmlToMarkdown,
  markdownToEditableHtml,
} from "@/app/components/markdown-document";
import {
  ENTITY_KIND_LABELS,
  entityName,
  keeperEntityUri,
} from "@/lib/entities";
import type { EntityCard, EntityKind } from "@/lib/types";

export function BookEditor({
  sections,
  entities,
  onCreateEntity,
  onSave,
  onCancel,
}: {
  sections: Array<{ key: string; name: string; markdown: string }>;
  entities: EntityCard[];
  onCreateEntity: (kind: EntityKind, name: string, sectionKey: string) => EntityCard;
  onSave: (markdown: Record<string, string>) => void;
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
  const selectionRef = useRef<Range | null>(null);
  const active = sections.find((section) => section.key === activeKey) ?? sections[0];

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

  const command = (name: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, value);
    syncFromVisual();
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

  const restoreSelection = () => {
    const range = selectionRef.current;
    if (!range) return false;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
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
            }), 0);
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
      {!sourceMode && (
        <div className="visual-format-toolbar" aria-label="文档格式工具">
          <select aria-label="段落样式" defaultValue="p" onChange={(event) => command("formatBlock", event.target.value)}>
            <option value="p">正文</option><option value="h1">一级标题</option><option value="h2">二级标题</option><option value="h3">三级标题</option>
          </select>
          <button type="button" onClick={() => command("bold")}><strong>B</strong></button>
          <button type="button" onClick={() => command("insertUnorderedList")}>• 列表</button>
          <button type="button" onClick={() => command("insertOrderedList")}>1. 列表</button>
          <button type="button" onClick={() => command("formatBlock", "blockquote")}>引用</button>
          <button type="button" onClick={() => command("insertHorizontalRule")}>分隔线</button>
          <button type="button" onClick={() => command("insertParagraph")}>新增段落</button>
          <button type="button" onClick={() => command("undo")}>撤销</button>
          <button type="button" onClick={() => command("redo")}>重做</button>
          <button className="entity-link-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={openEntityPicker}>关联实体</button>
        </div>
      )}
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
