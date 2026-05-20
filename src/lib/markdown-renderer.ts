import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";

export const katexOptions = {
  throwOnError: false,
  strict: false,
  macros: {
    "\\sha": "\\mathord{\\text{Ш}}",
    "\\hb": "{\\rm H\\beta}",
    "\\hbeta": "{\\rm H\\beta}",
    "\\halpha": "{\\rm H\\alpha}",
    "\\mgii": "{\\rm Mg\\,II}",
    "\\civ": "{\\rm C\\,IV}",
    "\\ciii": "{\\rm C\\,III}",
    "\\oiii": "{\\rm O\\,III}",
    "\\oii": "{\\rm O\\,II}",
    "\\cii": "{\\rm C\\,II}",
    "\\nii": "{\\rm N\\,II}",
    "\\niii": "{\\rm N\\,III}",
    "\\sii": "{\\rm S\\,II}",
    "\\siii": "{\\rm S\\,III}",
    "\\lya": "{\\rm Ly\\alpha}",
    "\\lyb": "{\\rm Ly\\beta}",
    "\\hei": "{\\rm He\\,I}",
    "\\heii": "{\\rm He\\,II}",
    "\\paalpha": "{\\rm Pa\\alpha}",
    "\\pabeta": "{\\rm Pa\\beta}",
    "\\palpha": "{\\rm Pa\\alpha}",
    "\\pbeta": "{\\rm Pa\\beta}",
  },
};

export const remarkPlugins: PluggableList = [remarkGfm, remarkMath];

export const rehypePlugins: PluggableList = [[rehypeKatex, katexOptions]];
