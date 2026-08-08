"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import type { Person } from "@/lib/types";

type PersonPortraitProps = {
  person?: Person;
  size?: "sm" | "md" | "lg";
  onUpload?: () => void;
  borderStyle?: "real" | "hidden";
};

const dimensions = {
  sm: 72,
  md: 128,
  lg: 208,
};

export function PersonPortrait({
  person,
  size = "md",
  onUpload,
  borderStyle = "real",
}: PersonPortraitProps) {
  const dimension = dimensions[size];
  const canUpload = Boolean(onUpload && !person?.portrait);
  const initial = person?.name.trim().charAt(0).toLocaleUpperCase() || "?";
  const style = {
    "--portrait-size": `${dimension}px`,
    "--portrait-border":
      borderStyle === "hidden" ? "var(--red)" : "var(--frame-gold)",
  } as CSSProperties;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canUpload || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onUpload?.();
  };

  return (
    <div
      className={`person-portrait person-portrait-${size} ${canUpload ? "is-uploadable" : ""}`}
      style={style}
      role={canUpload ? "button" : "img"}
      tabIndex={canUpload ? 0 : undefined}
      aria-label={
        canUpload
          ? `为${person?.name || "人物"}上传肖像`
          : `${person?.name || "人物"}的肖像`
      }
      onClick={canUpload ? onUpload : undefined}
      onKeyDown={handleKeyDown}
    >
      {person?.portrait ? (
        <span
          className="person-portrait-image"
          style={{ backgroundImage: `url(${person.portrait})` }}
        />
      ) : (
        <span className="person-portrait-placeholder" aria-hidden="true">
          {initial}
        </span>
      )}
    </div>
  );
}
