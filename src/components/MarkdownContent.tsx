"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { rehypePlugins, remarkPlugins } from "@/lib/markdown-renderer";
import { prepareScientificText } from "@/lib/latex-markdown";

type Props = {
  content: string;
  streaming?: boolean;
  className?: string;
  inline?: boolean;
};

const inlineComponents = {
  p: ({ children }: { children?: ReactNode }) => <>{children}</>,
};

export function MarkdownContent({
  content,
  streaming = false,
  className = "chat-markdown min-w-0 break-words",
  inline = false,
}: Props) {
  const markdown = prepareScientificText(content);
  const Wrapper = inline ? "span" : "div";
  const wrapperClassName = inline
    ? className
    : `${className}${streaming ? " is-streaming" : ""}`;

  return (
    <Wrapper className={wrapperClassName}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={inline ? inlineComponents : undefined}
      >
        {markdown}
      </ReactMarkdown>
    </Wrapper>
  );
}
