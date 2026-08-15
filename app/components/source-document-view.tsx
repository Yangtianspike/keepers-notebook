"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";

export function SourceDocumentView({
  project,
  sourceUrl,
}: {
  project: Project;
  sourceUrl: string;
}) {
  const [docxHtml, setDocxHtml] = useState("");
  const [docxError, setDocxError] = useState("");
  const [docxForUrl, setDocxForUrl] = useState("");

  useEffect(() => {
    if (!sourceUrl || project.fileType !== "docx") {
      return;
    }
    let cancelled = false;
    void fetch(sourceUrl)
      .then((response) => response.arrayBuffer())
      .then(async (arrayBuffer) => {
        const mammoth = await import("mammoth/mammoth.browser");
        const result = await mammoth.convertToHtml(
          { arrayBuffer },
          { convertImage: mammoth.images.imgElement(async (image) => ({
            src: `data:${image.contentType};base64,${await image.read("base64")}`,
          })) },
        );
        if (!cancelled) {
          setDocxHtml(result.value);
          setDocxError("");
          setDocxForUrl(sourceUrl);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDocxError(error instanceof Error ? error.message : "Word 文档渲染失败。");
          setDocxForUrl(sourceUrl);
        }
      });
    return () => { cancelled = true; };
  }, [project.fileType, sourceUrl]);

  const docxSource = docxForUrl === sourceUrl && docxHtml ? `<!doctype html><html><head><meta charset="utf-8"><style>body{max-width:900px;margin:0 auto;padding:48px 64px;color:#201a16;background:#fff;font:16px/1.75 Georgia,"Noto Serif SC",serif}img{max-width:100%;height:auto}table{width:100%;border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px}h1,h2,h3{line-height:1.3}</style></head><body>${docxHtml}</body></html>` : "";
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
      ) : sourceUrl && project.fileType === "docx" ? (
        docxForUrl === sourceUrl && docxError ? <div className="notice critical">{docxError}</div> : docxSource
          ? <iframe sandbox="" srcDoc={docxSource} title={`原始 Word 文档：${project.fileName}`} />
          : <div className="source-document-loading">正在还原 Word 排版与图片…</div>
      ) : (
        <article className="source-document-text">
          <pre>{project.documentText}</pre>
        </article>
      )}
    </div>
  );
}
