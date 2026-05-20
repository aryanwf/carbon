type ProtectedBlock = {
  token: string;
  value: string;
};

const SPECTRAL_LINE_MACROS = [
  "hb",
  "hbeta",
  "halpha",
  "mgii",
  "civ",
  "ciii",
  "oiii",
  "oii",
  "cii",
  "nii",
  "niii",
  "sii",
  "siii",
  "lya",
  "lyb",
  "hei",
  "heii",
  "paalpha",
  "pabeta",
  "palpha",
  "pbeta",
] as const;

const SPECTRAL_LINE_LATEX: Record<string, string> = {
  hb: "\\mathrm{H\\beta}",
  hbeta: "\\mathrm{H\\beta}",
  halpha: "\\mathrm{H\\alpha}",
  mgii: "\\mathrm{Mg\\,II}",
  civ: "\\mathrm{C\\,IV}",
  ciii: "\\mathrm{C\\,III}",
  oiii: "\\mathrm{O\\,III}",
  oii: "\\mathrm{O\\,II}",
  cii: "\\mathrm{C\\,II}",
  nii: "\\mathrm{N\\,II}",
  niii: "\\mathrm{N\\,III}",
  sii: "\\mathrm{S\\,II}",
  siii: "\\mathrm{S\\,III}",
  lya: "\\mathrm{Ly\\alpha}",
  lyb: "\\mathrm{Ly\\beta}",
  hei: "\\mathrm{He\\,I}",
  heii: "\\mathrm{He\\,II}",
  paalpha: "\\mathrm{Pa\\alpha}",
  pabeta: "\\mathrm{Pa\\beta}",
  palpha: "\\mathrm{Pa\\alpha}",
  pbeta: "\\mathrm{Pa\\beta}",
};

export function normalizeArxivLatex(input: string) {
  let result = input;

  result = normalizeBrokenPartialMath(result);
  result = normalizeAngstromWavelengths(result);
  result = normalizeKmPerSecondUnits(result);
  result = normalizeSimWithNumbers(result);
  result = normalizeCombinedSpectralLambda(result);
  result = normalizeLambdaWithNumbers(result);
  result = normalizeSpectralLines(result);

  const { text, blocks } = protectMathBlocks(result);
  result = normalizeBareMathCommands(text);

  return restoreMathBlocks(result, blocks);
}

function normalizeBrokenPartialMath(text: string) {
  return text
    .replace(/\$\\sim\$(\d[\d,]*)/g, (_, value: string) => "$\\sim " + value + "$")
    .replace(/\bkm\s+s\s*\$\^\{-1\}\$/g, "km s$^{-1}$");
}

function normalizeCombinedSpectralLambda(text: string) {
  return text.replace(
    /(?<!\$)(?:\\)+(oiii|ciii|niii|siii)\\lambda(\d+)/gi,
    (_full, line: string, value: string) =>
      "$" + SPECTRAL_LINE_LATEX[line.toLowerCase()] + "\\,\\lambda\\," + value + "$",
  );
}

function normalizeAngstromWavelengths(text: string) {
  return text
    .replace(/(\d[\d,]*)\s*~?\s*(?:\\)+AA\{\}?/g, "$1 Å")
    .replace(/(\d[\d,]*)\s*(?:\\)+AA\b/g, "$1 Å");
}

function normalizeKmPerSecondUnits(text: string) {
  return text
    .replace(/\bkm\s+s\s*\^\s*\{\s*-1\s*\}/g, "km s$^{-1}$")
    .replace(/\bkm\s+s\s*(?:\\)?\^\s*\{\s*-1\s*\}/g, "km s$^{-1}$");
}

function normalizeSimWithNumbers(text: string) {
  return text.replace(
    /(?<!\$)(?:\\)+sim\s*(\d[\d,]*)/g,
    (_, value: string) => "$\\sim " + value + "$",
  );
}

function normalizeLambdaWithNumbers(text: string) {
  return text.replace(
    /(?<!\$)(?:\\)+lambda(\d+)/g,
    (_, value: string) => "$\\lambda\\," + value + "$",
  );
}

function normalizeSpectralLines(text: string) {
  const uniqueLines = [...new Set(SPECTRAL_LINE_MACROS)];
  const pattern = new RegExp(
    `(?<![\\\\$])(?:\\\\)+(${uniqueLines.join("|")})(?:\\{\\})?(?:(?:\\\\)+|[~])?(?=[^a-zA-Z]|$)`,
    "gi",
  );

  return text.replace(pattern, (_full, line: string) => {
    const latex = SPECTRAL_LINE_LATEX[line.toLowerCase()];
    return latex ? "$" + latex + "$" : _full;
  });
}

function normalizeBareMathCommands(text: string) {
  return text.replace(
    /(?<!\$)(?:\\)+(?:lesssim|gtrsim|lessgtr|approx|sim|pm|cdot|times|infty|alpha|beta|gamma|delta|Omega|omega)(?=[\s\d,.;:}\]\-]|$)/g,
    (command) => "$" + command + "$",
  );
}

function protectMathBlocks(text: string) {
  const blocks: ProtectedBlock[] = [];
  let cursor = 0;
  let output = "";

  while (cursor < text.length) {
    const match = findNextMathBlock(text, cursor);
    if (!match) {
      output += text.slice(cursor);
      break;
    }

    if (match.start > cursor) {
      output += text.slice(cursor, match.start);
    }

    const token = `@@MATH_${blocks.length}@@`;
    blocks.push({ token, value: match.value });
    output += token;
    cursor = match.end;
  }

  return { text: output, blocks };
}

function restoreMathBlocks(text: string, blocks: ProtectedBlock[]) {
  return blocks.reduce(
    (current, block) => current.replaceAll(block.token, block.value),
    text,
  );
}

type MathMatch = {
  start: number;
  end: number;
  value: string;
};

function findNextMathBlock(text: string, from: number): MathMatch | null {
  for (let index = from; index < text.length; index += 1) {
    if (text.startsWith("$$", index) && !isEscaped(text, index)) {
      const end = findDelimiter(text, index + 2, "$$");
      if (end !== -1) {
        return { start: index, end: end + 2, value: text.slice(index, end + 2) };
      }
    }

    if (text.startsWith("\\[", index)) {
      const end = text.indexOf("\\]", index + 2);
      if (end !== -1) {
        return { start: index, end: end + 2, value: text.slice(index, end + 2) };
      }
    }

    if (text.startsWith("\\(", index)) {
      const end = text.indexOf("\\)", index + 2);
      if (end !== -1) {
        return { start: index, end: end + 2, value: text.slice(index, end + 2) };
      }
    }

    if (text[index] === "$" && !isEscaped(text, index) && text[index + 1] !== "$") {
      const end = findSingleDollarEnd(text, index + 1);
      if (end !== -1) {
        return {
          start: index,
          end: end + 1,
          value: text.slice(index, end + 1),
        };
      }
    }
  }

  return null;
}

function findDelimiter(text: string, from: number, delimiter: string) {
  for (let index = from; index < text.length; index += 1) {
    if (text.startsWith(delimiter, index) && !isEscaped(text, index)) {
      return index;
    }
  }
  return -1;
}

function findSingleDollarEnd(text: string, from: number) {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] !== "$" || isEscaped(text, index)) continue;
    if (text[index + 1] === "$") continue;
    return index;
  }
  return -1;
}

function isEscaped(text: string, index: number) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
