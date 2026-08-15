"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";

type ExtractedAsset = {
  id: string;
  page: number;
  width: number;
  height: number;
  dataUrl: string;
};

function downloadAsset(asset: ExtractedAsset, projectName: string) {
  const anchor = document.createElement("a");
  anchor.href = asset.dataUrl;
  anchor.download = `${projectName}-p${asset.page}-${asset.id}.png`;
  anchor.click();
}

function imageToDataUrl(image: unknown): { dataUrl: string; width: number; height: number } | null {
  if (!image || typeof image !== "object") return null;
  const candidate = image as {
    width?: number;
    height?: number;
    data?: Uint8ClampedArray;
    bitmap?: CanvasImageSource;
  };
  const width = Number(candidate.width ?? 0);
  const height = Number(candidate.height ?? 0);
  if (width < 120 || height < 120 || width * height < 40_000) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (candidate.bitmap) {
    context.drawImage(candidate.bitmap, 0, 0, width, height);
  } else if (candidate.data) {
    context.putImageData(new ImageData(new Uint8ClampedArray(candidate.data), width, height), 0, 0);
  } else if (image instanceof ImageBitmap || image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) {
    context.drawImage(image, 0, 0, width, height);
  } else {
    return null;
  }
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

export function SourceImageExtractor({
  project,
  sourceUrl,
}: {
  project: Project;
  sourceUrl: string;
}) {
  const [assets, setAssets] = useState<ExtractedAsset[]>([]);
  const [status, setStatus] = useState("尚未扫描原始 PDF。");
  const [scanning, setScanning] = useState(false);

  const scan = async () => {
    if (!sourceUrl || project.fileType !== "pdf") return;
    setScanning(true);
    setAssets([]);
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const document = await pdfjs.getDocument({ url: sourceUrl }).promise;
      const found: ExtractedAsset[] = [];
      const seen = new Set<string>();
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        setStatus(`正在扫描第 ${pageNumber} / ${document.numPages} 页…`);
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const renderCanvas = window.document.createElement("canvas");
        renderCanvas.width = Math.ceil(viewport.width);
        renderCanvas.height = Math.ceil(viewport.height);
        const renderContext = renderCanvas.getContext("2d");
        if (renderContext) await page.render({ canvas: renderCanvas, canvasContext: renderContext, viewport }).promise;
        const operators = await page.getOperatorList();
        const imageNames = operators.fnArray.flatMap((operation, index) => {
          if (
            operation !== pdfjs.OPS.paintImageXObject
          ) return [];
          const name = operators.argsArray[index]?.[0];
          return typeof name === "string" ? [name] : [];
        });
        for (const name of new Set(imageNames)) {
          const image = await new Promise<unknown>((resolve) => {
            try {
              page.objs.get(name, (value: unknown) => resolve(value));
            } catch {
              resolve(null);
            }
          });
          const converted = imageToDataUrl(image);
          if (!converted) continue;
          const signature = `${converted.width}x${converted.height}:${converted.dataUrl.slice(-80)}`;
          if (seen.has(signature)) continue;
          seen.add(signature);
          found.push({
            id: String(found.length + 1).padStart(3, "0"),
            page: pageNumber,
            ...converted,
          });
          if (found.length >= 100) break;
        }
        if (found.length >= 100) break;
      }
      setAssets(found);
      setStatus(found.length
        ? `扫描完成，找到 ${found.length} 张可独立提取的图片。`
        : "扫描完成，但该 PDF 没有可独立提取的大图；图片可能已经合并进整页背景，后续可使用版面识别裁切。",
      );
    } catch (error) {
      setStatus(error instanceof Error ? `扫描失败：${error.message}` : "扫描失败。");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="source-image-extractor">
      <header className="content-header">
        <div>
          <p className="eyebrow">SOURCE ASSETS</p>
          <h2>图片提取</h2>
          <p>先在本机提取 PDF 内嵌原图，不上传剧本；扫描页和整页背景需要后续版面识别。</p>
        </div>
        <button className="primary-button" disabled={scanning || !sourceUrl || project.fileType !== "pdf"} onClick={() => void scan()}>
          {scanning ? "正在扫描…" : "扫描 PDF 图片"}
        </button>
      </header>
      <div className="source-image-status">{status}</div>
      {project.fileType !== "pdf" && <div className="notice">图片提取目前仅支持 PDF 原始资料。</div>}
      <div className="source-image-grid">
        {assets.map((asset) => (
          <article key={`${asset.page}-${asset.id}`}>
            {/* Blob-backed local extraction previews are not remote image assets. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.dataUrl} alt={`第 ${asset.page} 页提取图片`} />
            <footer>
              <span>第 {asset.page} 页 · {asset.width} × {asset.height}</span>
              <button className="ghost-button compact" onClick={() => downloadAsset(asset, project.name)}>保存 PNG</button>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
