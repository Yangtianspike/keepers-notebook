"use client";

import { useState } from "react";

export function EditableText({
  as = "span",
  className,
  editing,
  text,
  onChange,
}: {
  as?: "span" | "p" | "h2" | "h3" | "dd";
  className?: string;
  editing: boolean;
  text: string;
  onChange: (value: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState(text);
  const Tag = as;

  if (editing && active) {
    return (
      <textarea
        aria-label="编辑书页文字"
        className={`editable-text-input ${className ?? ""}`.trim()}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setActive(false);
          if (draft !== text) onChange(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(text);
            setActive(false);
          }
        }}
        autoFocus
        rows={Math.min(8, Math.max(2, draft.split("\n").length))}
      />
    );
  }

  return (
    <Tag
      className={`${className ?? ""}${editing ? " editable-text" : ""}`.trim()}
      onClick={editing ? () => {
        setDraft(text);
        setActive(true);
      } : undefined}
      title={editing ? "点击编辑" : undefined}
    >
      {text}
    </Tag>
  );
}
