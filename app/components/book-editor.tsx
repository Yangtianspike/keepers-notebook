"use client";

import { useState } from "react";
import { MarkdownDocument } from "@/app/components/markdown-document";

export function BookEditor({
  sections,
  onSave,
  onCancel,
}: {
  sections: Array<{ key: string; name: string; markdown: string }>;
  onSave: (markdown: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(sections.map((section) => [section.key, section.markdown])),
  );
  const [activeKey, setActiveKey] = useState(sections[0]?.key ?? "");
  const active = sections.find((section) => section.key === activeKey) ?? sections[0];

  return (
    <div className="markdown-editor-shell">
      <header className="markdown-editor-toolbar">
        <div>
          <strong>书页 Markdown 文档</strong>
          <span>支持标题、段落、列表和自由笔记；保存后重新生成双页书。</span>
        </div>
        <div>
          <button className="ghost-button compact" onClick={onCancel}>取消</button>
          <button className="primary-button compact" onClick={() => onSave(drafts)}>保存并返回书页</button>
        </div>
      </header>
      <nav className="markdown-editor-tabs">
        {sections.map((section) => (
          <button
            className={section.key === activeKey ? "active" : ""}
            key={section.key}
            onClick={() => setActiveKey(section.key)}
          >
            {section.name}
          </button>
        ))}
      </nav>
      {active && (
        <div className="markdown-editor-workspace">
          <textarea
            aria-label={`${active.name} Markdown`}
            spellCheck={false}
            value={drafts[active.key] ?? ""}
            onChange={(event) => setDrafts((current) => ({
              ...current,
              [active.key]: event.target.value,
            }))}
          />
          <article className="markdown-editor-preview">
            <MarkdownDocument markdown={drafts[active.key] ?? ""} />
          </article>
        </div>
      )}
    </div>
  );
}
