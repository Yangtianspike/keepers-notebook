"use client";

import type { Project } from "@/lib/types";

export function SourceDocumentView({
  project,
  sourceUrl,
}: {
  project: Project;
  sourceUrl: string;
}) {
  return (
    <div className="source-document-view">
      <header>
        <div>
          <span className="eyebrow">ORIGINAL DOCUMENT</span>
          <h2>{project.fileName}</h2>
        </div>
      </header>
      {sourceUrl && project.fileType === "pdf" ? (
        <iframe src={sourceUrl} title={`原始文档：${project.fileName}`} />
      ) : (
        <article className="source-document-text">
          <pre>{project.documentText}</pre>
        </article>
      )}
    </div>
  );
}
