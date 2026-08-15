function escapeControlCharactersInStrings(value: string) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) { result += character; escaped = false; continue; }
    if (character === "\\" && inString) { result += character; escaped = true; continue; }
    if (character === '"') { inString = !inString; result += character; continue; }
    if (inString && character === "\n") { result += "\\n"; continue; }
    if (inString && character === "\r") continue;
    if (inString && character === "\t") { result += "\\t"; continue; }
    result += character;
  }
  return result;
}

export function parseLooseJsonObject(content: string): Record<string, unknown> {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型没有返回 JSON 对象。");
  const candidate = clean.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const repaired = escapeControlCharactersInStrings(candidate)
      .replace(/([,{]\s*)“([^”]+)”\s*:/g, '$1"$2":')
      .replace(/:\s*“([^”]*)”(?=\s*[,}])/g, ':"$1"')
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(repaired) as Record<string, unknown>;
  }
}
