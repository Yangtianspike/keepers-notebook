"use client";

import { useState, type ReactNode } from "react";
import type { KPNoteBlock } from "@/lib/types";

export function BookEditor({
  sections,
  notes,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
}: {
  sections: Array<{ key: string; name: string; content: ReactNode }>;
  notes: Record<string, KPNoteBlock[]>;
  onAddNote: (sectionKey: string, note: KPNoteBlock) => void;
  onUpdateNote: (sectionKey: string, note: KPNoteBlock) => void;
  onDeleteNote: (sectionKey: string, noteId: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { title: string; body: string }>>({});

  return (
    <div className="book-continuous-editor">
      {sections.map((section, index) => {
        const draft = drafts[section.key] ?? { title: "", body: "" };
        return (
          <article className="book-editor-section" key={section.key}>
            <header className="stage-page-heading">
              <small>{String(index + 1).padStart(2, "0")} / {sections.length}</small>
              <strong>{section.name}</strong>
            </header>
            <div className="stage-document">{section.content}</div>
            <section className="kp-note-editor">
              <h3>KP 笔记</h3>
              {(notes[section.key] ?? []).map((note) => (
                <article className="kp-note-block" key={note.id}>
                  <input
                    aria-label="笔记标题"
                    value={note.title}
                    onChange={(event) => onUpdateNote(section.key, {
                      ...note,
                      title: event.target.value,
                      updatedAt: new Date().toISOString(),
                    })}
                  />
                  <textarea
                    aria-label="笔记内容"
                    rows={4}
                    value={note.body}
                    onChange={(event) => onUpdateNote(section.key, {
                      ...note,
                      body: event.target.value,
                      updatedAt: new Date().toISOString(),
                    })}
                  />
                  <button type="button" onClick={() => onDeleteNote(section.key, note.id)}>
                    删除笔记
                  </button>
                </article>
              ))}
              <div className="kp-note-compose">
                <input
                  placeholder="新笔记标题"
                  value={draft.title}
                  onChange={(event) => setDrafts((current) => ({
                    ...current,
                    [section.key]: { ...draft, title: event.target.value },
                  }))}
                />
                <textarea
                  placeholder="自由补充主持提醒、设定或临场记录……"
                  rows={4}
                  value={draft.body}
                  onChange={(event) => setDrafts((current) => ({
                    ...current,
                    [section.key]: { ...draft, body: event.target.value },
                  }))}
                />
                <button
                  type="button"
                  disabled={!draft.title.trim() && !draft.body.trim()}
                  onClick={() => {
                    const now = new Date().toISOString();
                    onAddNote(section.key, {
                      id: crypto.randomUUID(),
                      title: draft.title.trim() || "KP 笔记",
                      body: draft.body.trim(),
                      createdAt: now,
                      updatedAt: now,
                    });
                    setDrafts((current) => ({
                      ...current,
                      [section.key]: { title: "", body: "" },
                    }));
                  }}
                >
                  添加笔记
                </button>
              </div>
            </section>
          </article>
        );
      })}
    </div>
  );
}
