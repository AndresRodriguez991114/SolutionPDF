export interface ExcelTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold?: boolean;
  italic?: boolean;
  font?: string;
  color?: string;
  link?: string;
}

export interface ExcelCell {
  text: string;
  x: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
  font: string;
  color: string;
  link?: string;
}

interface TextRow {
  y: number;
  size: number;
  cells: ExcelCell[];
}

export type ExcelLayoutBlock =
  | { type: "text"; rows: ExcelCell[][] }
  | { type: "table"; rows: ExcelCell[][] };

export interface ExcelPageRows {
  blocks: ExcelLayoutBlock[];
  columnWidths: number[];
  detectedTable: boolean;
}

function groupRows(items: ExcelTextItem[]): TextRow[] {
  const rows: Array<{ y: number; size: number; items: ExcelTextItem[] }> = [];
  const ordered = items
    .filter((item) => item.text.trim().length > 0 && Number.isFinite(item.x) && Number.isFinite(item.y))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  for (const item of ordered) {
    const row = rows.find((candidate) =>
      Math.abs(candidate.y - item.y) <= Math.max(2, Math.max(candidate.size, item.size) * 0.35));
    if (row) {
      row.items.push(item);
      row.size = Math.max(row.size, item.size);
    } else {
      rows.push({ y: item.y, size: item.size, items: [item] });
    }
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const cells: ExcelCell[] = [];
      for (const item of row.items.sort((a, b) => a.x - b.x)) {
        const previous = cells[cells.length - 1];
        const gap = previous ? item.x - (previous.x + previous.width) : 0;
        const threshold = Math.max(12, item.size * 1.5);
        const sameLink = previous && previous.link === item.link;
        const join = previous && sameLink && gap <= threshold;
        if (join) {
          const separator = gap > Math.max(1, item.size * 0.15) ? " " : "";
          previous.text += `${separator}${item.text}`;
          previous.width = Math.max(previous.width, item.x + item.width - previous.x);
          previous.size = Math.max(previous.size, item.size);
          previous.bold ||= Boolean(item.bold);
          previous.italic ||= Boolean(item.italic);
        } else {
          cells.push({
            text: item.text.trim(),
            x: item.x,
            width: Math.max(0.1, item.width),
            size: item.size,
            bold: Boolean(item.bold),
            italic: Boolean(item.italic),
            font: item.font || "Arial",
            color: item.color || "000000",
            link: item.link,
          });
        }
      }
      return { y: row.y, size: row.size, cells };
    })
    .filter((row) => row.cells.length > 0);
}

function compatibleRows(previous: TextRow, next: TextRow): boolean {
  if (previous.cells.length < 2 || next.cells.length !== previous.cells.length) return false;
  if (previous.y - next.y > Math.max(4, Math.max(previous.size, next.size) * 3.5)) return false;
  return previous.cells.every((cell, index) => {
    const nextCell = next.cells[index];
    const tolerance = Math.max(18, Math.max(cell.size, nextCell.size) * 2.5);
    return Math.abs(cell.x - nextCell.x) <= tolerance;
  });
}

function makeTable(rows: TextRow[]): ExcelLayoutBlock {
  return { type: "table", rows: rows.map((row) => row.cells) };
}

export function buildExcelPageRows(items: ExcelTextItem[]): ExcelPageRows {
  const rows = groupRows(items);
  if (rows.length === 0) return { blocks: [], columnWidths: [], detectedTable: false };

  const blocks: ExcelLayoutBlock[] = [];
  let textRows: ExcelCell[][] = [];
  let tableRows: TextRow[] = [];

  const flushText = () => {
    if (textRows.length > 0) blocks.push({ type: "text", rows: textRows });
    textRows = [];
  };
  const flushTable = () => {
    if (tableRows.length >= 2) {
      flushText();
      blocks.push(makeTable(tableRows));
    } else {
      for (const row of tableRows) textRows.push([{
        text: row.cells.map((cell) => cell.text).join(" "),
        x: row.cells[0]?.x ?? 0,
        width: row.cells.reduce((right, cell) => Math.max(right, cell.x + cell.width), 0) - (row.cells[0]?.x ?? 0),
        size: row.size,
        bold: row.cells.some((cell) => cell.bold),
        italic: row.cells.some((cell) => cell.italic),
        font: row.cells[0]?.font ?? "Arial",
        color: row.cells[0]?.color ?? "000000",
      }]);
    }
    tableRows = [];
  };

  for (const row of rows) {
    if (tableRows.length === 0) {
      if (row.cells.length >= 2) tableRows = [row];
      else textRows.push(row.cells);
      continue;
    }

    const previous = tableRows[tableRows.length - 1];
    if (compatibleRows(previous, row)) {
      tableRows.push(row);
    } else {
      flushTable();
      if (row.cells.length >= 2) tableRows = [row];
      else textRows.push(row.cells);
    }
  }
  flushTable();
  flushText();

  const columnCount = Math.max(1, ...blocks.map((block) => Math.max(...block.rows.map((row) => row.length))));
  const columnWidths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(10, Math.min(60, ...blocks.flatMap((block) =>
      block.rows.map((row) => (row[column]?.text.length ?? 0) + 2)))));
  return { blocks, columnWidths, detectedTable: blocks.some((block) => block.type === "table") };
}
