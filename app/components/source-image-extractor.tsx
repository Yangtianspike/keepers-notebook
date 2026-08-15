"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
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
    origin: asset.origin,
    fileName: asset.fileName,
    title: asset.title,
    inPack: asset.inPack,
    packOrder: asset.packOrder,
  };
}

function assetTitle(asset: ExtractedAsset) {
  if (asset.title?.trim()) return asset.title.trim();
  if (asset.fileName) return asset.fileName.replace(/\.[^.]+$/, "");
  return asset.page > 0 ? `原文第 ${asset.page} 页图片` : "图片资料";
}

function fileExtension(asset: ExtractedAsset) {
  if (asset.fileName?.includes(".")) return asset.fileName.split(".").pop()!.toLowerCase();
  if (asset.blob.type === "image/jpeg") return "jpg";
  if (asset.blob.type === "image/webp") return "webp";
  return "png";
}

function safeFileName(value: string) {
  const safe = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
  return safe || "图片资料";
}

function downloadAsset(asset: ExtractedAsset, projectName: string) {
  const anchor = document.createElement("a");
  anchor.href = asset.url;
  anchor.download = `${safeFileName(projectName)}-${safeFileName(assetTitle(asset))}.${fileExtension(asset)}`;
  anchor.click();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  bytes.forEach((byte) => { crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8); });
  return (crc ^ 0xffffffff) >>> 0;
}

function zipHeader(size: number) {
  return new Uint8Array(size);
}

function setZipValue(target: Uint8Array, offset: number, value: number, size: 2 | 4) {
  const view = new DataView(target.buffer);
  if (size === 2) view.setUint16(offset, value, true);
  else view.setUint32(offset, value, true);
}

async function downloadPack(assets: ExtractedAsset[], projectName: string) {
  const encoder = new TextEncoder();
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let localOffset = 0;
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    const name = encoder.encode(`${String(index + 1).padStart(2, "0")}-${safeFileName(assetTitle(asset))}.${fileExtension(asset)}`);
    const checksum = crc32(bytes);
    const local = zipHeader(30);
    setZipValue(local, 0, 0x04034b50, 4);
    setZipValue(local, 4, 20, 2);
    setZipValue(local, 6, 0x0800, 2);
    setZipValue(local, 14, checksum, 4);
    setZipValue(local, 18, bytes.length, 4);
    setZipValue(local, 22, bytes.length, 4);
    setZipValue(local, 26, name.length, 2);
    localParts.push(local, name, bytes);

    const central = zipHeader(46);
    setZipValue(central, 0, 0x02014b50, 4);
    setZipValue(central, 4, 20, 2);
    setZipValue(central, 6, 20, 2);
    setZipValue(central, 8, 0x0800, 2);
    setZipValue(central, 16, checksum, 4);
    setZipValue(central, 20, bytes.length, 4);
    setZipValue(central, 24, bytes.length, 4);
    setZipValue(central, 28, name.length, 2);
    setZipValue(central, 42, localOffset, 4);
    centralParts.push(central, name);
    localOffset += local.length + name.length + bytes.length;
  }
  const centralSize = centralParts.reduce((total, part) => total + (part instanceof Uint8Array ? part.length : 0), 0);
  const end = zipHeader(22);
  setZipValue(end, 0, 0x06054b50, 4);
  setZipValue(end, 8, assets.length, 2);
  setZipValue(end, 10, assets.length, 2);
  setZipValue(end, 12, centralSize, 4);
  setZipValue(end, 16, localOffset, 4);
  const url = URL.createObjectURL(new Blob([...localParts, ...centralParts, end], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(projectName)}-调查员图片资料包.zip`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const uploadRef = useRef<HTMLInputElement>(null);

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

  const updateAsset = (assetId: string, patch: Partial<ExtractedAsset>) => {
    const existing = assets.find((asset) => asset.id === assetId);
    if (!existing) return;
    const updated = { ...existing, ...patch };
    setAssets((current) => current.map((asset) => asset.id === assetId ? updated : asset));
    void saveExtractedImages([toRecord(updated)]);
  };

  const addToPack = (assetId: string) => {
    const nextOrder = Math.max(0, ...assets.filter((asset) => asset.inPack).map((asset) => asset.packOrder ?? 0)) + 1;
    updateAsset(assetId, { inPack: true, packOrder: nextOrder });
  };

  const movePackAsset = (assetId: string, direction: -1 | 1) => {
    const pack = assets.filter((asset) => asset.inPack).sort((left, right) => (left.packOrder ?? 0) - (right.packOrder ?? 0));
    const index = pack.findIndex((asset) => asset.id === assetId);
    const otherIndex = index + direction;
    if (index < 0 || otherIndex < 0 || otherIndex >= pack.length) return;
    const current = pack[index];
    const other = pack[otherIndex];
    const currentOrder = current.packOrder ?? index + 1;
    const otherOrder = other.packOrder ?? otherIndex + 1;
    setAssets((items) => items.map((asset) => asset.id === current.id
      ? { ...asset, packOrder: otherOrder }
      : asset.id === other.id ? { ...asset, packOrder: currentOrder } : asset));
    void saveExtractedImages([
      toRecord({ ...current, packOrder: otherOrder }),
      toRecord({ ...other, packOrder: currentOrder }),
    ]);
  };

  const addUploadedFiles = async (files: FileList | File[]) => {
    const additions: ExtractedAsset[] = [];
    let nextOrder = Math.max(0, ...assets.filter((asset) => asset.inPack).map((asset) => asset.packOrder ?? 0)) + 1;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const bitmap = await createImageBitmap(file);
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      additions.push({
        id: `${project.id}:upload:${crypto.randomUUID()}`,
        projectId: project.id,
        page: 0,
        sourceObjectName: file.name,
        width: bitmap.width,
        height: bitmap.height,
        blob: file,
        createdAt: new Date().toISOString(),
        origin: "upload",
        fileName: file.name,
        title: file.name.replace(/\.[^.]+$/, ""),
        inPack: true,
        packOrder: nextOrder,
        url,
      });
      bitmap.close();
      nextOrder += 1;
    }
    if (additions.length === 0) return;
    setAssets((current) => [...current, ...additions]);
    await saveExtractedImages(additions.map(toRecord));
    setStatus(`已把 ${additions.length} 张本地图片加入调查员资料包。`);
  };

  const handleWorkspaceDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length > 0) {
      void addUploadedFiles(event.dataTransfer.files);
      return;
    }
    const assetId = event.dataTransfer.getData("application/x-keeper-atlas-image");
    if (assetId) addToPack(assetId);
  };

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
          const previous = assets.find((asset) => asset.id === `${project.id}:${pageNumber}:${name}`);
          found.push({
            id: `${project.id}:${pageNumber}:${name}`,
            projectId: project.id,
            page: pageNumber,
            sourceObjectName: name,
            width: converted.width,
            height: converted.height,
            blob: converted.blob,
            createdAt: new Date().toISOString(),
            origin: "pdf",
            title: previous?.title,
            inPack: previous?.inPack,
            packOrder: previous?.packOrder,
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
          <h2>图片资料</h2>
          <p>提取原始 PDF 图片或加入本地截图，再整理成可交付给调查员的图片资料包。</p>
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
      <section className="image-pack-section">
        <header>
          <div><span className="eyebrow">INVESTIGATOR HANDOUTS</span><h3>调查员资料包</h3></div>
          <div className="image-pack-actions">
            <input ref={uploadRef} hidden multiple accept="image/*" type="file" onChange={(event: ChangeEvent<HTMLInputElement>) => {
              if (event.target.files) void addUploadedFiles(event.target.files);
              event.target.value = "";
            }} />
            <button className="ghost-button compact" onClick={() => uploadRef.current?.click()}>添加本地图片</button>
            <button className="primary-button compact" disabled={!assets.some((asset) => asset.inPack)} onClick={() => void downloadPack(assets.filter((asset) => asset.inPack).sort((left, right) => (left.packOrder ?? 0) - (right.packOrder ?? 0)), project.name)}>下载资料包 ZIP</button>
          </div>
        </header>
        <div className="image-pack-workspace" onDragOver={(event) => event.preventDefault()} onDrop={handleWorkspaceDrop}>
          {assets.some((asset) => asset.inPack) ? assets.filter((asset) => asset.inPack).sort((left, right) => (left.packOrder ?? 0) - (right.packOrder ?? 0)).map((asset, index, pack) => (
            <article key={`pack:${asset.id}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt={assetTitle(asset)} />
              <div>
                <input aria-label="图片资料名称" value={asset.title ?? assetTitle(asset)} onChange={(event) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, title: event.target.value } : item))} onBlur={() => {
                  const current = assets.find((item) => item.id === asset.id);
                  if (current) void saveExtractedImages([toRecord(current)]);
                }} />
                <small>{asset.origin === "upload" ? "本地图片" : `PDF 第 ${asset.page} 页`}</small>
              </div>
              <div className="image-pack-order">
                <button disabled={index === 0} title="前移" onClick={() => movePackAsset(asset.id, -1)}>←</button>
                <button disabled={index === pack.length - 1} title="后移" onClick={() => movePackAsset(asset.id, 1)}>→</button>
                <button title="移出资料包" onClick={() => updateAsset(asset.id, { inPack: false, packOrder: undefined })}>×</button>
              </div>
            </article>
          )) : <div className="image-pack-empty"><strong>把图片拖到这里</strong><span>可从下方 PDF 图片库拖入，也可直接拖入本地截图。</span></div>}
        </div>
      </section>
      <section className="source-image-library">
        <header><div><span className="eyebrow">PDF IMAGE LIBRARY</span><h3>PDF 图片库</h3></div><span>{assets.filter((asset) => asset.origin !== "upload").length} 张</span></header>
        <div className="source-image-grid">
        {assets.filter((asset) => asset.origin !== "upload").map((asset) => (
          <article key={`${asset.page}-${asset.id}`} draggable onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("application/x-keeper-atlas-image", asset.id);
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.url} alt={`第 ${asset.page} 页提取图片`} />
            <footer>
              <span>第 {asset.page} 页 · {asset.width} × {asset.height}</span>
              <div><button className="ghost-button compact" disabled={asset.inPack} onClick={() => addToPack(asset.id)}>{asset.inPack ? "已加入" : "加入资料包"}</button><button className="ghost-button compact" onClick={() => downloadAsset(asset, project.name)}>保存 PNG</button></div>
            </footer>
          </article>
        ))}
        </div>
      </section>
      </div>
  );
}
