declare module "mammoth/mammoth.browser" {
  type RawTextResult = { value: string };
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<RawTextResult>;
}

declare module "cloudflare:workers" {
  export const env: { DB?: unknown };
}
