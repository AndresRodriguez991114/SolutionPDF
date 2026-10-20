// Análisis de la maquetación de una página PDF. No depende de pdf.js ni de docx para poder probarse.

export interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
  font: string;
  color?: string;
  link?: string;
  underline?: boolean;
  strike?: boolean;
  script?: "sup" | "sub";
}

export interface TextRunInfo {
  text: string;
  x: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
  font: string;
  color: string;
  // Hay un hueco grande antes de este tramo: se reproduce con un tabulador.
  tab?: boolean;
  link?: string;
  underline?: boolean;
  strike?: boolean;
  script?: "sup" | "sub";
}

export interface LineInfo {
  y: number;
  x0: number;
  x1: number;
  size: number;
  runs: TextRunInfo[];
}

export type ParagraphKind =
  | { type: "heading"; level: number }
  | { type: "bullet" }
  | { type: "number"; value: number; instance: number };

export interface ParagraphInfo {
  lines: LineInfo[];
  kind?: ParagraphKind;
}

export type Block =
  | { type: "paragraph"; paragraph: ParagraphInfo }
  | { type: "table"; rows: LineInfo[] };

export interface Bounds {
  left: number;
  right: number;
}

export type PageSegment =
  | { kind: "flow"; lines: LineInfo[] }
  | { kind: "columns"; left: LineInfo[]; right: LineInfo[] };

export interface PageModel {
  pageNumber: number;
  width: number;
  height: number;
  top: LineInfo[];
  bottom: LineInfo[];
  segments: PageSegment[];
}

export type ResolvedSegment =
  | { kind: "flow"; blocks: Block[] }
  | { kind: "columns"; columns: Array<{ bounds: Bounds; blocks: Block[] }> };

export interface ResolvedPage {
  pageNumber: number;
  width: number;
  height: number;
  header: Block[];
  footer: Block[];
  segments: ResolvedSegment[];
  margins: Bounds;
  hasText: boolean;
}

export interface Cell {
  runs: TextRunInfo[];
  x0: number;
  x1: number;
}

export const COLUMN_GAP_EM = 1.5;
const ZONE_RATIO = 0.075;
const BULLET_RE = /^(?:[•·▪◦●■‣▸►]|[-*])(?:\s+|$)/;
const NUMBER_RE = /^(\d{1,3})[.)](?:\s+|$)/;

const KNOWN_FONTS: Record<string, string> = {
  arial: "Arial",
  helvetica: "Arial",
  liberationsans: "Arial",
  arimo: "Arial",
  timesnewroman: "Times New Roman",
  timesnewromanps: "Times New Roman",
  times: "Times New Roman",
  timesroman: "Times New Roman",
  liberationserif: "Times New Roman",
  tinos: "Times New Roman",
  couriernew: "Courier New",
  courier: "Courier New",
  liberationmono: "Courier New",
  calibri: "Calibri",
  cambria: "Cambria",
  verdana: "Verdana",
  tahoma: "Tahoma",
  georgia: "Georgia",
  segoeui: "Segoe UI",
  consolas: "Consolas",
  trebuchetms: "Trebuchet MS",
  garamond: "Garamond",
  palatinolinotype: "Palatino Linotype",
  bookantiqua: "Book Antiqua",
  candara: "Candara",
  constantia: "Constantia",
  corbel: "Corbel",
  impact: "Impact",
  lucidaconsole: "Lucida Console",
  centurygothic: "Century Gothic",
  franklingothicbook: "Franklin Gothic Book",
  opensans: "Open Sans",
  roboto: "Roboto",
  lato: "Lato",
  montserrat: "Montserrat",
};

const GENERIC_FONTS: Record<string, string> = {
  "sans-serif": "Arial",
  serif: "Times New Roman",
  monospace: "Courier New",
};

export function genericFamily(fontFamily: string | undefined): string | undefined {
  const last = fontFamily?.split(",").pop()?.trim().toLowerCase().replace(/['"]/g, "");
  return last && last in GENERIC_FONTS ? last : undefined;
}

export function resolveFont(rawName: string | undefined, generic: string | undefined): { name: string; known: boolean } {
  const cleaned = (rawName ?? "")
    .replace(/^[A-Z]{6}\+/, "")
    .replace(/[-,](bold|italic|oblique|semibold|black|light|medium|regular).*$/i, "")
    .replace(/(bold|italic|oblique)+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/mt$/, "");
  const known = KNOWN_FONTS[cleaned];
  if (known) return { name: known, known: true };
  return { name: GENERIC_FONTS[generic ?? ""] ?? "Arial", known: false };
}

export function resolveFontName(rawName: string | undefined, generic: string | undefined): string {
  return resolveFont(rawName, generic).name;
}

const sameStyle = (run: TextRunInfo, item: RawItem, script: "sup" | "sub" | undefined) =>
  run.bold === item.bold
  && run.italic === item.italic
  && run.font === item.font
  && run.color === (item.color ?? "000000")
  && run.link === item.link
  && Boolean(run.underline) === Boolean(item.underline)
  && Boolean(run.strike) === Boolean(item.strike)
  && run.script === script
  && Math.abs(run.size - item.size) < 0.5;

// Une fragmentos en líneas (misma baseline), conserva el estilo por tramo y marca los huecos grandes.
export function buildLines(items: RawItem[]): LineInfo[] {
  const sorted = items
    .filter((item) => item.str.length > 0)
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const groups: Array<{ refY: number; maxSize: number; items: RawItem[] }> = [];
  for (const item of sorted) {
    const group = groups.find((candidate) =>
      Math.abs(candidate.refY - item.y) <= 0.35 * Math.max(item.size, candidate.maxSize));
    if (!group) {
      groups.push({ refY: item.y, maxSize: item.size, items: [item] });
      continue;
    }
    group.items.push(item);
    if (item.size > group.maxSize + 0.01) {
      group.maxSize = item.size;
      group.refY = item.y;
    }
  }
  groups.sort((a, b) => b.refY - a.refY);

  const lines: LineInfo[] = [];
  for (const group of groups) {
    group.items.sort((a, b) => a.x - b.x);
    const runs: TextRunInfo[] = [];
    let lastEnd: number | null = null;

    for (const raw of group.items) {
      const previous = runs[runs.length - 1];
      if (raw.str.trim().length === 0) {
        if (previous && raw.width <= raw.size * COLUMN_GAP_EM) {
          previous.text += raw.str;
          lastEnd = raw.x + raw.width;
        }
        continue;
      }

      let script = raw.script;
      if (!script && raw.size < group.maxSize * 0.85) {
        const offset = raw.y - group.refY;
        if (offset > 0.18 * group.maxSize) script = "sup";
        else if (offset < -0.1 * group.maxSize) script = "sub";
      }

      const gap = lastEnd === null ? 0 : raw.x - lastEnd;
      const columnGap = Boolean(previous) && gap > raw.size * COLUMN_GAP_EM;
      let text = raw.str;
      if (!columnGap && previous && gap > Math.max(1, raw.size * 0.15)
        && !/\s$/.test(previous.text) && !/^\s/.test(text)) {
        text = ` ${text}`;
      }

      if (!columnGap && previous && sameStyle(previous, raw, script)) {
        previous.text += text;
        previous.width = raw.x + raw.width - previous.x;
      } else {
        runs.push({
          text: columnGap ? text.trimStart() : text,
          x: raw.x,
          width: raw.width,
          size: raw.size,
          bold: raw.bold,
          italic: raw.italic,
          font: raw.font,
          color: raw.color ?? "000000",
          tab: columnGap,
          link: raw.link,
          underline: raw.underline,
          strike: raw.strike,
          script,
        });
      }
      lastEnd = raw.x + raw.width;
    }

    const visible = runs.filter((run) => run.text.trim().length > 0);
    if (visible.length === 0) continue;
    visible[0].text = visible[0].text.trimStart();
    visible[0].tab = false;
    visible[visible.length - 1].text = visible[visible.length - 1].text.trimEnd();
    for (let index = 0; index < visible.length - 1; index += 1) {
      if (visible[index + 1].tab) visible[index].text = visible[index].text.trimEnd();
    }

    const weight = (run: TextRunInfo) => (run.script ? 0 : run.text.length);
    const dominant = visible.reduce((best, run) => (weight(run) > weight(best) ? run : best), visible[0]);
    const last = visible[visible.length - 1];
    lines.push({
      y: group.refY,
      x0: visible[0].x,
      x1: last.x + last.width,
      size: dominant.size,
      runs: visible,
    });
  }
  return lines;
}

export const lineText = (line: LineInfo): string => line.runs.map((run) => run.text).join("");

export const paragraphText = (paragraph: ParagraphInfo): string =>
  paragraph.lines.map(lineText).join(" ");

const hasColumns = (line: LineInfo) => line.runs.some((run) => run.tab);

export function cellsOf(line: LineInfo): Cell[] {
  const cells: Cell[] = [];
  for (const run of line.runs) {
    const last = cells[cells.length - 1];
    if (!last || run.tab) cells.push({ runs: [run], x0: run.x, x1: run.x + run.width });
    else {
      last.runs.push(run);
      last.x1 = run.x + run.width;
    }
  }
  return cells;
}

export function groupIntoParagraphs(lines: LineInfo[]): ParagraphInfo[] {
  if (lines.length === 0) return [];
  const contentRight = Math.max(...lines.map((line) => line.x1));
  const contentLeft = Math.min(...lines.map((line) => line.x0));
  const contentWidth = Math.max(1, contentRight - contentLeft);
  const paragraphs: ParagraphInfo[] = [];
  let current: LineInfo[] = [];

  for (const line of lines) {
    const previous = current[current.length - 1];
    const merges = previous
      && !hasColumns(previous)
      && !hasColumns(line)
      && Math.abs(previous.size - line.size) <= 0.6
      && previous.y - line.y > 0
      && previous.y - line.y <= previous.size * 1.7
      && !BULLET_RE.test(lineText(line))
      && !NUMBER_RE.test(lineText(line))
      && Math.abs(previous.x0 - line.x0) <= 3
      && previous.x1 >= contentRight - contentWidth * 0.12;
    if (merges) {
      current.push(line);
    } else {
      if (current.length > 0) paragraphs.push({ lines: current });
      current = [line];
    }
  }
  if (current.length > 0) paragraphs.push({ lines: current });
  return paragraphs;
}

function takeTable(lines: LineInfo[], start: number): LineInfo[] | null {
  const first = cellsOf(lines[start]);
  if (first.length < 2) return null;
  const columns = first.map((cell) => ({ x0: cell.x0, x1: cell.x1 }));
  const rows = [lines[start]];

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const previous = rows[rows.length - 1];
    if (previous.y - line.y > Math.max(previous.size, line.size) * 3.2) break;
    const cells = cellsOf(line);
    if (cells.length !== columns.length) break;
    const fits = cells.every((cell, column) =>
      cell.x0 <= columns[column].x1 + 4 && cell.x1 >= columns[column].x0 - 4);
    if (!fits) break;
    cells.forEach((cell, column) => {
      columns[column].x0 = Math.min(columns[column].x0, cell.x0);
      columns[column].x1 = Math.max(columns[column].x1, cell.x1);
    });
    rows.push(line);
  }
  return rows.length >= 2 ? rows : null;
}

// Separa tablas (filas con las mismas columnas) del texto corrido y agrupa el resto en párrafos.
export function buildBlocks(lines: LineInfo[]): Block[] {
  const blocks: Block[] = [];
  let pending: LineInfo[] = [];
  const flush = () => {
    for (const paragraph of groupIntoParagraphs(pending)) blocks.push({ type: "paragraph", paragraph });
    pending = [];
  };

  let index = 0;
  while (index < lines.length) {
    const rows = takeTable(lines, index);
    if (rows) {
      flush();
      blocks.push({ type: "table", rows });
      index += rows.length;
    } else {
      pending.push(lines[index]);
      index += 1;
    }
  }
  flush();
  return blocks;
}

export interface ColumnSplit {
  gutter0: number;
  gutter1: number;
  // Las líneas por encima de este valor (si existe) abarcan toda la página.
  prefaceCutY: number | null;
}

// Detecta dos columnas de texto separadas por un canal vertical vacío.
export function detectColumns(items: RawItem[], pageWidth: number): ColumnSplit | null {
  const texts = items.filter((item) => item.str.trim().length > 0);
  if (texts.length < 12) return null;

  const rowYs: number[] = [];
  for (const y of texts.map((item) => item.y).sort((a, b) => b - a)) {
    if (rowYs.length === 0 || Math.abs(rowYs[rowYs.length - 1] - y) > 2) rowYs.push(y);
  }

  for (let skip = 0; skip <= 4; skip += 1) {
    const cutY = skip === 0 ? Number.POSITIVE_INFINITY : rowYs[skip - 1] - 1;
    const body = texts.filter((item) => item.y < cutY);
    if (body.length < 12) break;

    const minX = Math.min(...body.map((item) => item.x));
    const maxX = Math.max(...body.map((item) => item.x + item.width));
    const contentWidth = maxX - minX;
    if (contentWidth < pageWidth * 0.4) continue;

    const coverage = new Uint16Array(Math.ceil(maxX) + 2);
    for (const item of body) {
      const end = Math.ceil(item.x + item.width);
      for (let x = Math.max(0, Math.floor(item.x)); x <= end; x += 1) coverage[x] += 1;
    }

    const from = Math.floor(minX + contentWidth * 0.25);
    const to = Math.ceil(maxX - contentWidth * 0.25);
    let best: { start: number; end: number } | null = null;
    let start = -1;
    for (let x = from; x <= to + 1; x += 1) {
      const empty = x <= to && coverage[x] === 0;
      if (empty && start < 0) start = x;
      if (!empty && start >= 0) {
        if (!best || x - start > best.end - best.start) best = { start, end: x };
        start = -1;
      }
    }
    if (!best || best.end - best.start < 12) continue;

    const center = (best.start + best.end) / 2;
    const left = body.filter((item) => item.x + item.width / 2 < center);
    const right = body.filter((item) => item.x + item.width / 2 >= center);
    const rowCount = (side: RawItem[]) => new Set(side.map((item) => Math.round(item.y / 2))).size;
    if (rowCount(left) < 6 || rowCount(right) < 6) continue;
    const leftWidth = Math.max(...left.map((item) => item.x + item.width)) - minX;
    const rightWidth = maxX - Math.min(...right.map((item) => item.x));
    if (leftWidth < contentWidth * 0.3 || rightWidth < contentWidth * 0.3) continue;

    return { gutter0: best.start, gutter1: best.end, prefaceCutY: skip === 0 ? null : cutY };
  }
  return null;
}

export function buildPageModel(pageNumber: number, width: number, height: number, items: RawItem[]): PageModel {
  const visible = items.filter((item) => item.str.trim().length > 0);
  const topZone = height * (1 - ZONE_RATIO);
  const bottomZone = height * ZONE_RATIO;
  const top = visible.filter((item) => item.y > topZone);
  const bottom = visible.filter((item) => item.y < bottomZone);
  const body = visible.filter((item) => item.y <= topZone && item.y >= bottomZone);

  const segments: PageSegment[] = [];
  const split = detectColumns(body, width);
  if (split) {
    const center = (split.gutter0 + split.gutter1) / 2;
    const below = split.prefaceCutY === null ? body : body.filter((item) => item.y < split.prefaceCutY!);
    const preface = split.prefaceCutY === null ? [] : body.filter((item) => item.y >= split.prefaceCutY!);
    if (preface.length > 0) segments.push({ kind: "flow", lines: buildLines(preface) });
    segments.push({
      kind: "columns",
      left: buildLines(below.filter((item) => item.x + item.width / 2 < center)),
      right: buildLines(below.filter((item) => item.x + item.width / 2 >= center)),
    });
  } else {
    segments.push({ kind: "flow", lines: buildLines(body) });
  }

  return {
    pageNumber,
    width,
    height,
    top: buildLines(top),
    bottom: buildLines(bottom),
    segments,
  };
}

const normalizeKey = (text: string) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

function isPageNumberText(text: string): boolean {
  return /(?:p[aá]g(?:ina|\.)?|page)\s*\d+/i.test(text)
    || /^\s*[-–]?\s*\d{1,4}\s*[-–]?\s*$/.test(text)
    || /\b\d+\s*(?:de|of|\/)\s*\d+\b/i.test(text);
}

const BASE_ROUND = 2;
const roundSize = (size: number) => Math.round(size * BASE_ROUND) / BASE_ROUND;

function paragraphsOf(blocks: Block[]): ParagraphInfo[] {
  return blocks.flatMap((block) => (block.type === "paragraph" ? [block.paragraph] : []));
}

function stripMarker(paragraph: ParagraphInfo, pattern: RegExp): void {
  const first = paragraph.lines[0].runs[0];
  first.text = first.text.replace(pattern, "");
  if (first.text.length === 0 && paragraph.lines[0].runs.length > 1) {
    paragraph.lines[0].runs.shift();
    paragraph.lines[0].runs[0].tab = false;
    paragraph.lines[0].runs[0].text = paragraph.lines[0].runs[0].text.trimStart();
  }
}

function classifyParagraphs(sequences: Block[][]): void {
  const weight = new Map<number, number>();
  for (const blocks of sequences) {
    for (const paragraph of paragraphsOf(blocks)) {
      for (const line of paragraph.lines) {
        for (const run of line.runs) {
          if (run.script) continue;
          weight.set(roundSize(run.size), (weight.get(roundSize(run.size)) ?? 0) + run.text.length);
        }
      }
    }
  }
  if (weight.size === 0) return;
  const bodySize = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const larger = [...weight.keys()].filter((size) => size >= bodySize * 1.12).sort((a, b) => b - a);
  const levelOf = new Map<number, number>();
  let level = 0;
  larger.forEach((size, index) => {
    if (index === 0 || larger[index - 1] - size > 1) level += 1;
    levelOf.set(size, Math.min(level, 4));
  });

  for (const blocks of sequences) {
    for (const paragraph of paragraphsOf(blocks)) {
      const size = roundSize(paragraph.lines[0].size);
      if (levelOf.has(size) && paragraph.lines.length <= 3 && paragraphText(paragraph).length <= 200
        && !paragraph.lines.some(hasColumns)) {
        paragraph.kind = { type: "heading", level: levelOf.get(size)! };
      }
    }
  }

  let instance = 0;
  for (const blocks of sequences) {
    let run: Array<{ paragraph: ParagraphInfo; value: number }> = [];
    const commit = () => {
      if (run.length >= 2) {
        instance += 1;
        for (const entry of run) {
          entry.paragraph.kind = { type: "number", value: entry.value, instance };
          stripMarker(entry.paragraph, NUMBER_RE);
        }
      }
      run = [];
    };

    for (const block of blocks) {
      if (block.type !== "paragraph") {
        commit();
        continue;
      }
      const paragraph = block.paragraph;
      if (paragraph.kind || paragraph.lines.some(hasColumns)) {
        commit();
        continue;
      }
      const text = lineText(paragraph.lines[0]);
      if (BULLET_RE.test(text)) {
        commit();
        paragraph.kind = { type: "bullet" };
        stripMarker(paragraph, BULLET_RE);
        continue;
      }
      const match = NUMBER_RE.exec(text);
      if (!match) {
        commit();
        continue;
      }
      const value = Number(match[1]);
      const previous = run[run.length - 1];
      if (previous && value !== previous.value + 1) commit();
      if (run.length === 0 && value !== 1) continue;
      run.push({ paragraph, value });
    }
    commit();
  }
}

const allLines = (page: PageModel) => page.segments.flatMap((segment) =>
  segment.kind === "flow" ? segment.lines : [...segment.left, ...segment.right]);

// Decide qué líneas de los márgenes son encabezado/pie, arma bloques y clasifica títulos y listas.
export function resolveDocument(pages: PageModel[]): ResolvedPage[] {
  const seen = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const [zone, lines] of [["t", page.top], ["b", page.bottom]] as const) {
      for (const line of lines) {
        const key = `${zone}:${normalizeKey(lineText(line))}`;
        if (!seen.has(key)) seen.set(key, new Set());
        seen.get(key)!.add(page.pageNumber);
      }
    }
  }
  const minPages = Math.max(2, Math.ceil(pages.length * 0.5));
  const accepted = (zone: string, line: LineInfo) =>
    isPageNumberText(lineText(line))
    || (pages.length >= 2 && (seen.get(`${zone}:${normalizeKey(lineText(line))}`)?.size ?? 0) >= minPages);

  const resolved: ResolvedPage[] = pages.map((page) => {
    const headerLines = page.top.filter((line) => accepted("t", line));
    const footerLines = page.bottom.filter((line) => accepted("b", line));
    const rejectedTop = page.top.filter((line) => !headerLines.includes(line));
    const rejectedBottom = page.bottom.filter((line) => !footerLines.includes(line));

    const segments: ResolvedSegment[] = [];
    if (rejectedTop.length > 0) segments.push({ kind: "flow", blocks: buildBlocks(rejectedTop) });
    for (const segment of page.segments) {
      if (segment.kind === "flow") {
        if (segment.lines.length > 0) segments.push({ kind: "flow", blocks: buildBlocks(segment.lines) });
        continue;
      }
      const boundsOf = (lines: LineInfo[]): Bounds => ({
        left: Math.min(...lines.map((line) => line.x0)),
        right: Math.max(...lines.map((line) => line.x1)),
      });
      segments.push({
        kind: "columns",
        columns: [segment.left, segment.right]
          .filter((lines) => lines.length > 0)
          .map((lines) => ({ bounds: boundsOf(lines), blocks: buildBlocks(lines) })),
      });
    }
    if (rejectedBottom.length > 0) segments.push({ kind: "flow", blocks: buildBlocks(rejectedBottom) });

    const everything = [...allLines(page), ...page.top, ...page.bottom];
    const margins = everything.length > 0
      ? {
        left: Math.max(0, Math.min(...everything.map((line) => line.x0))),
        right: Math.max(0, page.width - Math.max(...everything.map((line) => line.x1))),
      }
      : { left: 36, right: 36 };

    return {
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      header: buildBlocks(headerLines),
      footer: buildBlocks(footerLines),
      segments,
      margins,
      hasText: everything.length > 0,
    };
  });

  const sequences: Block[][] = [];
  for (const page of resolved) {
    for (const segment of page.segments) {
      if (segment.kind === "flow") sequences.push(segment.blocks);
      else for (const column of segment.columns) sequences.push(column.blocks);
    }
  }
  classifyParagraphs(sequences);
  return resolved;
}
