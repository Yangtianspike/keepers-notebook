import type { ReactNode } from "react";

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part,
  );
}

export function MarkdownDocument({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(<ul key={`list-${blocks.length}`}>{list.map((item, index) => <li key={index}>{inlineMarkdown(item)}</li>)}</ul>);
    list = [];
  };

  markdown.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) {
      list.push(item[1]);
      return;
    }
    flushList();
    if (!line.trim()) return;
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (level === 1) blocks.push(<h1 key={blocks.length}>{inlineMarkdown(heading[2])}</h1>);
      else if (level === 2) blocks.push(<h2 key={blocks.length}>{inlineMarkdown(heading[2])}</h2>);
      else if (level === 3) blocks.push(<h3 key={blocks.length}>{inlineMarkdown(heading[2])}</h3>);
      else blocks.push(<h4 key={blocks.length}>{inlineMarkdown(heading[2])}</h4>);
      return;
    }
    blocks.push(<p key={blocks.length}>{inlineMarkdown(line)}</p>);
  });
  flushList();
  return <div className="markdown-document">{blocks}</div>;
}
