"use client";

import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

const plugins = {
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
};

const controls = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
};

const FENCED_CODE_BLOCK_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
const INLINE_CODE_PATTERN = /(`+[^`]*?`+)/g;

type Props = {
  content: string;
  streaming?: boolean;
};

export function ChatMarkdown({ content, streaming = false }: Props) {
  const markdown = normalizeLatexDelimiters(content);

  return (
    <Streamdown
      className="chat-markdown min-w-0 break-words"
      plugins={plugins}
      mode={streaming ? "streaming" : "static"}
      parseIncompleteMarkdown={streaming}
      isAnimating={streaming}
      animated={streaming}
      caret={streaming ? "block" : undefined}
      shikiTheme={["github-dark", "github-dark"]}
      controls={controls}
    >
      {markdown}
    </Streamdown>
  );
}

function normalizeLatexDelimiters(markdown: string) {
  return markdown
    .split(FENCED_CODE_BLOCK_PATTERN)
    .map((segment) => {
      if (segment.startsWith("```") || segment.startsWith("~~~")) {
        return segment;
      }

      return segment
        .split(INLINE_CODE_PATTERN)
        .map((part) => {
          if (part.startsWith("`")) return part;
          return part
            .replace(/\\\[([\s\S]*?)\\\]/g, "\n$$\n$1\n$$\n")
            .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$");
        })
        .join("");
    })
    .join("");
}
