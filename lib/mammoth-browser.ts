/**
 * 浏览器版 mammoth 的类型补充。
 *
 * 官方发布的 `mammoth/mammoth.browser` 类型声明只覆盖了 `extractRawText`，
 * 但运行时导出还包含 `convertToHtml` 与 `images`（DOCX 转 HTML、以及从
 * Word 文档提取内嵌图片都依赖它们）。这里补上实际用到的签名，
 * 避免调用处退化成 `any`，也让 `npm run typecheck` 能通过。
 */

export type MammothImage = {
  contentType: string;
  read(encoding: string): Promise<string>;
};

export type MammothBrowser = {
  convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { convertImage?: unknown },
  ): Promise<{ value: string; messages: unknown[] }>;
  images: {
    imgElement(
      handler: (image: MammothImage) => Promise<{ src: string }>,
    ): unknown;
  };
};

/** 动态加载浏览器版 mammoth，并按实际运行时导出补齐类型。 */
export async function loadMammoth(): Promise<MammothBrowser> {
  const loaded = await import("mammoth/mammoth.browser");
  return loaded as unknown as MammothBrowser;
}
