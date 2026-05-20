import { normalizeArxivLatex } from "@/lib/arxiv-latex";
import { normalizeMarkdownTables } from "@/lib/markdown-tables";

const FENCED_CODE_BLOCK_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
const INLINE_CODE_PATTERN = /(`+[^`]*?`+)/g;

export function prepareScientificText(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  return normalizeMarkdownTables(trimmed)
    .split(FENCED_CODE_BLOCK_PATTERN)
    .map((segment) => {
      if (segment.startsWith("```") || segment.startsWith("~~~")) {
        return segment;
      }

      return segment
        .split(INLINE_CODE_PATTERN)
        .map((part) => {
          if (part.startsWith("`")) return part;
          return normalizeLatexDelimiters(normalizeArxivLatex(part));
        })
        .join("");
    })
    .join("");
}

function normalizeLatexDelimiters(text: string) {
  return text
    .replace(
      /\\begin\{([^}]+)\}([\s\S]*?)\\end\{\1\}/g,
      (_full, envName: string, body: string) =>
        `\n$$\n\\begin{${envName}}${body}\\end{${envName}}\n$$\n`,
    )
    .replace(
      /\\\[([\s\S]*?)\\\]/g,
      (_full, body: string) => `\n$$\n${body.trim()}\n$$\n`,
    )
    .replace(/\\\(([\s\S]*?)\\\)/g, (_full, body: string) => `$${body.trim()}$`);
}
