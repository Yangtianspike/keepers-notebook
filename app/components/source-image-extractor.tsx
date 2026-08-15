"use client";

import { useEffect, useRef, useState } from "react";
import {
  deleteExtractedImages,
  loadExtractedImages,
  saveExtractedImages,
  type ExtractedImageRecord,
} from "@/lib/storage";
import type { Project } from "@/lib/types";

type ExtractedAsset = ExtractedImageRecord & { url: string };
type ConvertedImage = { blob: Blob; width: number; height: number };

function toRecord(asset: ExtractedAsset): ExtractedImageRecord {
  return {
    id: asset.id,
    projectId: asset.projectId,
    page: asset.page,
    sourceObjectName: asset.sourceObjectName,
    width: asset.width,
    height: asset.height,
    blob: asset.blob,
    createdAt: asset.createdAt,
  };
}

function downloadAsset(asset: ExtractedAsset, projectName: string) {
  const anchor = document.createElement("a");
  anchor.href = asset.url;
  anchor.download = `${projectName}-p${asset.page}-${asset.id}.png`;
  anchor.click();
}

function isBlankOrBlackLayer(canvas: HTMLCanvasElement) {
  const sample = document.createElement("canvas");
  sample.width = 32;
  sample.height = 32;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  let visible = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 16) continue;
    const luminance = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
    visible += 1;
    sum += luminance;
    sumSquares += luminance * luminance;
  }
  if (visible < sample.width * sample.height * 0.05) return true;
  const mean = sum / visible;
  const deviation = Math.sqrt(Math.max(0, sumSquares / visible - mean * mean));
  return mean < 5 && deviation < 4;
}

async function imageToBlob(image: unknown): Promise<ConvertedImage | "ignored" | null> {
  if (!image || typeof image !== "object") return null;
  const candidate = image as {
    width?: number;
    height?: number;
    kind?: number;
    data?: Uint8Array | Uint8ClampedArray;
    bitmap?: CanvasImageSource;
  };
  const width = Number(candidate.width ?? 0);
  const height = Number(candidate.height ?? 0);
  if (width < 120 || height < 120 || width * height < 40_000) return null;
  if (candidate.kind === 1) return "ignored";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (candidate.bitmap) context.drawImage(candidate.bitmap, 0, 0, width, height);
  else if (candidate.data) {
    const source = new Uint8ClampedArray(candidate.data);
    let rgba: Uint8ClampedArray;
    if (source.length === width * height * 4) {
      rgba = source;
    } else if (source.length === width * height * 3) {
      rgba = new Uint8ClampedArray(width * height * 4);
      for (let sourceIndex = 0, targetIndex = 0; sourceIndex < source.length; sourceIndex += 3, targetIndex += 4) {
        rgba[targetIndex] = source[sourceIndex];
        rgba[targetIndex + 1] = source[sourceIndex + 1];
        rgba[targetIndex + 2] = source[sourceIndex + 2];
        rgba[targetIndex + 3] = 255;
      }
    } else if (source.length === width * height) {
      rgba = new Uint8ClampedArray(width * height * 4);
      for (let sourceIndex = 0, targetIndex = 0; sourceIndex < source.length; sourceIndex += 1, targetIndex += 4) {
        rgba[targetIndex] = source[sourceIndex];
        rgba[targetIndex + 1] = source[sourceIndex];
        rgba[targetIndex + 2] = source[sourceIndex];
        rgba[targetIndex + 3] = 255;
      }
    } else {
      return null;
    }
    const imageData = context.createImageData(width, height);
    imageData.data.set(rgba);
    context.putImageData(imageData, 0, 0);
  }
  else if (image instanceof ImageBitmap || image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) context.drawImage(image, 0, 0, width, height);
  else return null;
  if (isBlankOrBlackLayer(canvas)) return "ignored";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? { blob, width, height } : null;
}

function readPdfObject(page: { objs: { get: (name: string, callback: (value: unknown) => void) => unknown } }, name: string) {
  return new Promise<unknown>((resolve) => {
    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), 1200);
    try {
      page.objs.get(name, (value: unknown) => {
        window.clearTimeout(timeout);
        finish(value);
      });
    } catch {
      window.clearTimeout(timeout);
      finish(null);
    }
  });
}

export function SourceImageExtractor({ project, sourceUrl }: { project: Project; sourceUrl: string }) {
  const [assets, setAssets] = useState<ExtractedAsset[]>([]);
  const [status, setStatus] = useState("尚未扫描原始 PDF。");
  const [scanning, setScanning] = useState(false);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(Math.max(1, project.pages.length));
  const cancelledRef = useRef(false);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    let disposed = false;
    void loadExtractedImages(project.id).then((records) => {
      if (disposed) return;
      const restored = records.map((record) => {
        const url = URL.createObjectURL(record.blob);
        objectUrlsRef.current.push(url);
        return { ...record, url };
      });
      setAssets(restored);
      setStatus(restored.length > 0 ? `已恢复 ${restored.length} 张历史提取图片。` : "尚未扫描原始 PDF。");
    }).catch((error) => {
      if (!disposed) setStatus(error instanceof Error ? `读取提取记录失败：${error.message}` : "读取提取记录失败。");
    });
    return () => {
      disposed = true;
      cancelledRef.current = true;
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, [project.id]);

  const scan = async () => {
    if (!sourceUrl || project.fileType !== "pdf") return;
    setScanning(true);
    cancelledRef.current = false;
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const loadingTask = pdfjs.getDocument({ url: sourceUrl });
      const pdf = await loadingTask.promise;
      const first = Math.max(1, Math.min(Math.floor(startPage), pdf.numPages));
      const last = Math.max(first, Math.min(Math.floor(endPage), pdf.numPages));
      await deleteExtractedImages(project.id, { start: first, end: last });
      const retained = assets.filter((asset) => asset.page < first || asset.page > last);
      const removedUrls = new Set(assets.filter((asset) => asset.page >= first && asset.page <= last).map((asset) => asset.url));
      removedUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = objectUrlsRef.current.filter((url) => !removedUrls.has(url));
      setAssets(retained);
      const found: ExtractedAsset[] = [];
      const seen = new Set<string>();
      let ignoredLayers = 0;

      for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
        if (cancelledRef.current) break;
        setStatus(`正在扫描第 ${pageNumber} 页（${pageNumber - first + 1} / ${last - first + 1}），已找到 ${found.length} 张…`);
        const page = await pdf.getPage(pageNumber);
        const operators = await page.getOperatorList();
        const imageNames = operators.fnArray.flatMap((operation, index) => {
          if (operation !== pdfjs.OPS.paintImageXObject) return [];
          const name = operators.argsArray[index]?.[0];
          return typeof name === "string" ? [name] : [];
        });

        for (const name of new Set(imageNames)) {
          if (cancelledRef.current) break;
          const image = await readPdfObject(page, name);
          const converted = await imageToBlob(image);
          if (converted === "ignored") {
            ignoredLayers += 1;
            continue;
          }
          if (!converted) continue;
          const signature = `${name}:${converted.width}x${converted.height}:${converted.blob.size}`;
          if (seen.has(signature)) continue;
          seen.add(signature);
          const url = URL.createObjectURL(converted.blob);
          objectUrlsRef.current.push(url);
          found.push({
            id: `${project.id}:${pageNumber}:${name}`,
            projectId: project.id,
            page: pageNumber,
            sourceObjectName: name,
            width: converted.width,
            height: converted.height,
            blob: converted.blob,
            createdAt: new Date().toISOString(),
            url,
          });
          setAssets([...retained, ...found]);
          if (found.length >= 100) break;
        }
        await saveExtractedImages(found.filter((asset) => asset.page === pageNumber).map(toRecord));
        page.cleanup();
        if (found.length >= 100) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      setStatus(cancelledRef.current
          ? `扫描已停止，保留已找到的 ${found.length} 张图片。`
          : found.length
          ? `扫描完成，新提取 ${found.length} 张图片${ignoredLayers > 0 ? `，已过滤 ${ignoredLayers} 张黑色蒙版或空白层` : ""}。结果已保存在当前项目。`
          : `扫描完成，但所选页面没有可独立提取的大图${ignoredLayers > 0 ? `；已过滤 ${ignoredLayers} 张黑色蒙版或空白层` : ""}。`,
      );
      await loadingTask.destroy();
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
          <p>按页直接读取 PDF 内嵌图片，结果边扫描边保存到当前项目；不会上传剧本。</p>
        </div>
        <div className="source-image-actions">
          <label>从第 <input min={1} max={project.pages.length} type="number" value={startPage} onChange={(event) => setStartPage(Number(event.target.value))} /> 页</label>
          <label>到第 <input min={1} max={project.pages.length} type="number" value={endPage} onChange={(event) => setEndPage(Number(event.target.value))} /> 页</label>
          {scanning ? (
            <button className="ghost-button" onClick={() => { cancelledRef.current = true; setStatus("正在停止扫描…"); }}>停止</button>
          ) : (
            <button className="primary-button" disabled={!sourceUrl || project.fileType !== "pdf"} onClick={() => void scan()}>扫描所选页</button>
          )}
        </div>
      </header>
      <div className="source-image-status">{status}</div>
      {project.fileType !== "pdf" && <div className="notice">图片提取目前仅支持 PDF 原始资料。</div>}
      <div className="source-image-grid">
        {assets.map((asset) => (
          <article key={`${asset.page}-${asset.id}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.url} alt={`第 ${asset.page} 页提取图片`} />
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
