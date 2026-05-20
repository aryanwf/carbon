type ProtectedTable = {
  token: string;
  value: string;
};

export function normalizeMarkdownTables(text: string) {
  const { text: protectedText, tables } = protectTableBlocks(text);
  const restored = restoreTableBlocks(protectedText, tables);
  return cleanupTableSpacing(restored);
}

export function protectTableBlocks(text: string) {
  const lines = text.split("\n");
  const tables: ProtectedTable[] = [];
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const start = findTableStart(lines, index);
    if (start === -1) {
      output.push(...lines.slice(index));
      break;
    }

    output.push(...lines.slice(index, start));

    const end = findTableEnd(lines, start);
    const rawBlock = lines.slice(start, end + 1).join("\n");
    const token = `@@TABLE_BLOCK_${tables.length}@@`;
    tables.push({
      token,
      value: normalizeTableBlock(rawBlock),
    });
    output.push(token);
    index = end + 1;
  }

  return { text: output.join("\n"), tables };
}

export function restoreTableBlocks(text: string, tables: ProtectedTable[]) {
  return tables.reduce(
    (current, table) => current.replaceAll(table.token, table.value),
    text,
  );
}

function cleanupTableSpacing(text: string) {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function findTableStart(lines: string[], from: number) {
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line.includes("|")) continue;
    if (/^\|/.test(line) || hasInlineTableRows(line)) {
      return index;
    }
  }
  return -1;
}

function findTableEnd(lines: string[], start: number) {
  let end = start;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) break;
    if (isTableLine(trimmed) || isBrokenTableContinuation(trimmed)) {
      end = index;
      continue;
    }
    break;
  }

  return end;
}

function isTableLine(line: string) {
  return line.includes("|");
}

function isBrokenTableContinuation(line: string) {
  if (/^#{1,6}\s/.test(line)) return false;
  if (/^[-*+]\s/.test(line)) return false;
  if (/^\d+\.\s/.test(line)) return false;
  if (/^```/.test(line)) return false;
  if (/^>\s/.test(line)) return false;
  if (/^\$\$/.test(line)) return false;
  return true;
}

function hasInlineTableRows(line: string) {
  return /^\|/.test(line.trim()) || /\|\s+\|\s*[-–—―─]/.test(line);
}

function normalizeTableBlock(rawBlock: string) {
  const flattened = flattenTableBlock(rawBlock);
  const parsed = parseTableCells(flattened);
  if (!parsed) return rawBlock.trim();

  const { header, separator, rows, columnCount } = parsed;
  const lines = [
    formatRow(header, columnCount),
    formatSeparatorRow(separator, columnCount),
    ...rows.map((row) => formatRow(row, columnCount)),
  ];

  return lines.join("\n");
}

function flattenTableBlock(rawBlock: string) {
  const lines = rawBlock.split("\n");
  const parts: string[] = [];
  let buffer = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!buffer) {
      buffer = trimmed;
      continue;
    }

    if (trimmed.startsWith("|") && /\|\s*$/.test(buffer)) {
      parts.push(buffer);
      buffer = trimmed;
      continue;
    }

    if (
      /\|\s*$/.test(buffer) &&
      trimmed.includes("|") &&
      splitTableCells(toRow(trimmed)).length >= 2
    ) {
      parts.push(buffer);
      buffer = trimmed;
      continue;
    }

    buffer = `${buffer} ${trimmed}`;
  }

  if (buffer) parts.push(buffer);
  return parts.join("\n");
}

function parseTableCells(text: string) {
  const segments = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (segments.length === 0) return null;

  const cells: string[] = [];
  for (const segment of segments) {
    cells.push(...splitTableCells(toRow(segment)));
  }

  while (cells.length > 0 && !cells[cells.length - 1]?.trim()) {
    cells.pop();
  }

  if (cells.length === 0) return null;

  let separatorStart = -1;
  let separatorEnd = -1;
  for (let index = 0; index < cells.length; index += 1) {
    if (!isSeparatorCell(cells[index])) continue;
    separatorStart = index;
    separatorEnd = index;
    while (
      separatorEnd + 1 < cells.length &&
      isSeparatorCell(cells[separatorEnd + 1])
    ) {
      separatorEnd += 1;
    }
    break;
  }

  if (separatorStart === -1) {
    const columnCount = inferColumnCountFromCells(cells);
    if (columnCount < 2) return null;
    const rows = chunkCells(cells, columnCount);
    return {
      header: rows[0] ?? [],
      separator: Array.from({ length: columnCount }, () => "---"),
      rows: rows.slice(1),
      columnCount,
    };
  }

  const header = trimTrailingEmpty(cells.slice(0, separatorStart));
  const separator = cells.slice(separatorStart, separatorEnd + 1);
  const columnCount = Math.max(header.length, separator.length, 2);
  const dataCells = trimLeadingEmpty(cells.slice(separatorEnd + 1));
  const rows = chunkCells(dataCells, columnCount);

  return {
    header: padCells(header, columnCount),
    separator: padCells(separator, columnCount),
    rows,
    columnCount,
  };
}

function inferColumnCountFromCells(cells: string[]) {
  if (cells.length >= 2 && cells.length % 2 === 0) return 2;
  if (cells.length >= 3 && cells.length % 3 === 0) return 3;
  return Math.min(2, cells.length);
}

function chunkCells(cells: string[], columnCount: number) {
  const rows: string[][] = [];
  let buffer: string[] = [];

  for (const cell of cells) {
    const normalized = normalizeTableCell(cell);
    if (!normalized && buffer.length === 0) continue;

    buffer.push(normalized);
    if (buffer.length < columnCount) continue;

    if (buffer.some((value) => value.length > 0)) {
      rows.push(padCells(buffer, columnCount));
    }
    buffer = [];
  }

  if (buffer.length > 0) {
    rows.push(padCells(buffer, columnCount));
  }

  return rows;
}

function padCells(cells: string[], columnCount: number) {
  const next = cells.map(normalizeTableCell);
  while (next.length < columnCount) next.push("");
  return next.slice(0, columnCount);
}

function trimTrailingEmpty(cells: string[]) {
  const next = [...cells];
  while (next.length > 0 && !next[next.length - 1]?.trim()) {
    next.pop();
  }
  return next;
}

function trimLeadingEmpty(cells: string[]) {
  const next = [...cells];
  while (next.length > 0 && !next[0]?.trim()) {
    next.shift();
  }
  return next;
}

function formatRow(cells: string[], columnCount: number) {
  return `| ${padCells(cells, columnCount).join(" | ")} |`;
}

function formatSeparatorRow(cells: string[], columnCount: number) {
  const normalized = padCells(cells, columnCount).map(formatSeparatorCell);
  return `| ${normalized.join(" | ")} |`;
}

function toRow(line: string) {
  const trimmed = line.trim();
  if (trimmed.startsWith("|") && trimmed.endsWith("|")) return trimmed;
  if (trimmed.startsWith("|")) return `${trimmed} |`;
  if (trimmed.endsWith("|")) return `| ${trimmed}`;
  return `| ${trimmed} |`;
}

function splitTableCells(row: string) {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "|" && !isEscaped(trimmed, index) && !isInsideInlineMath(trimmed, index)) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function normalizeTableCell(cell: string) {
  return cell
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isSeparatorCell(cell: string) {
  const trimmed = cell.trim();
  if (!trimmed) return false;
  return /^:?[\s\-–—―─−‐‑‒]+:?$/.test(trimmed);
}

function formatSeparatorCell(cell: string) {
  const trimmed = cell.trim();
  if (!isSeparatorCell(trimmed)) return "---";
  const alignLeft = trimmed.startsWith(":");
  const alignRight = trimmed.endsWith(":");
  if (alignLeft && alignRight) return ":---:";
  if (alignRight) return "---:";
  if (alignLeft) return ":---";
  return "---";
}

function isInsideInlineMath(text: string, index: number) {
  let dollars = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] !== "$" || isEscaped(text, cursor)) continue;
    if (text[cursor + 1] === "$") {
      cursor += 1;
      continue;
    }
    dollars += 1;
  }
  return dollars % 2 === 1;
}

function isEscaped(text: string, index: number) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
