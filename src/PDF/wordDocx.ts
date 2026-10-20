import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  LineRuleType,
  PageNumber,
  PageOrientation,
  Paragraph,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  TextWrappingType,
  UnderlineType,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  WidthType,
  type ISectionOptions,
  type ParagraphChild,
} from "docx";
import {
  cellsOf,
  type Block,
  type Bounds,
  type LineInfo,
  type ParagraphInfo,
  type ResolvedPage,
  type ResolvedSegment,
  type TextRunInfo,
} from "./wordLayout";

export type WordExportMode = "faithful" | "image" | "text";

export interface PageImage {
  data: Uint8Array;
  type: "jpg" | "png";
}

export interface BuildContext {
  mode: WordExportMode;
  pageNumber: number;
  // Si se exportan todas las páginas, "Página 1 de 7" se convierte en campos de Word.
  totalPages: number | null;
}

type Child = Paragraph | Table;

export const PT = 20;
// Posición de la línea base dentro de una línea de altura exacta (fracción desde arriba).
export const BASELINE_RATIO = 0.8;

const twip = (points: number) => Math.round(points * PT);

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
];

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
};
const LIGHT_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const LIGHT_BORDERS = {
  top: LIGHT_BORDER,
  bottom: LIGHT_BORDER,
  left: LIGHT_BORDER,
  right: LIGHT_BORDER,
};

const hasTabs = (line: LineInfo) => line.runs.some((run) => run.tab);

export function paragraphPitch(paragraph: ParagraphInfo): number {
  const [first, second] = paragraph.lines;
  return Math.max(second ? first.y - second.y : first.size * 1.2, first.size);
}

function paragraphMetrics(paragraph: ParagraphInfo) {
  const pitch = paragraphPitch(paragraph);
  const top = paragraph.lines[0].y + BASELINE_RATIO * pitch;
  return { pitch, top, bottom: top - paragraph.lines.length * pitch };
}

function tableMetrics(rows: LineInfo[]) {
  const pitches: number[] = [];
  rows.forEach((row, index) => {
    const next = rows[index + 1];
    pitches.push(Math.max(next ? row.y - next.y : (pitches[index - 1] ?? row.size * 1.2), row.size));
  });
  const tops = rows.map((row, index) => row.y + BASELINE_RATIO * pitches[index]);
  const heights = rows.map((_, index) =>
    Math.max(2, index < rows.length - 1 ? tops[index] - tops[index + 1] : pitches[index]));
  const top = tops[0];
  return { pitches, heights, top, bottom: top - heights.reduce((sum, height) => sum + height, 0) };
}

const blockTop = (block: Block) =>
  block.type === "paragraph" ? paragraphMetrics(block.paragraph).top : tableMetrics(block.rows).top;

function splitPageFields(text: string, context: BuildContext): Array<string | typeof PageNumber.CURRENT> {
  if (context.totalPages === null) return [text];
  const total = String(context.totalPages);
  const current = String(context.pageNumber);
  const tokens = text.split(/(\d+)/);
  const parts: Array<string | typeof PageNumber.CURRENT> = [];
  let buffer = "";
  tokens.forEach((token, index) => {
    if (index % 2 === 0) {
      buffer += token;
      return;
    }
    const previous = tokens[index - 1];
    const next = tokens[index + 1] ?? "";
    const afterNext = tokens[index + 2];
    const labelBefore = /(?:p[aá]g(?:ina|\.)?|page)\s*$/i.test(previous);
    const separatorBefore = /(?:\bde|\bof|\/)\s*$/i.test(previous);
    const isCurrent = token === current && (labelBefore
      || (/^\s*(?:de|of|\/)\s*$/i.test(next) && afterNext === total));
    const isTotal = token === total && separatorBefore;
    if (isCurrent || isTotal) {
      if (buffer) parts.push(buffer);
      buffer = "";
      parts.push(isCurrent ? PageNumber.CURRENT : PageNumber.TOTAL_PAGES);
    } else {
      buffer += token;
    }
  });
  if (buffer) parts.push(buffer);
  return parts;
}

function textRunFor(run: TextRunInfo, lineSize: number, text: string, context: BuildContext): TextRun {
  return new TextRun({
    children: splitPageFields(text, context),
    bold: run.bold,
    italics: run.italic,
    font: run.font,
    size: Math.max(2, Math.round((run.script ? lineSize : run.size) * 2)),
    color: run.color,
    underline: run.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: run.strike || undefined,
    superScript: run.script === "sup" || undefined,
    subScript: run.script === "sub" || undefined,
  });
}

function buildParagraph(
  info: ParagraphInfo,
  before: number,
  bounds: Bounds,
  context: BuildContext
): Paragraph {
  const { lines, kind } = info;
  const first = lines[0];
  const pitch = paragraphPitch(info);
  const x0 = Math.min(...lines.map((line) => line.x0));
  const x1 = Math.max(...lines.map((line) => line.x1));
  const leftGap = x0 - bounds.left;
  const rightGap = bounds.right - x1;
  const columns = lines.some(hasTabs);

  let alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT;
  let indentLeft = leftGap > 2 ? leftGap : 0;
  const listHanging = kind && kind.type !== "heading" ? Math.min(28, Math.max(12, first.size * 1.4)) : 0;
  if (kind && kind.type !== "heading") {
    // La viñeta o el número lo dibuja Word; se conserva la posición original.
  } else if (columns) {
    // Los huecos se reproducen con tabuladores.
  } else if (leftGap > 12 && Math.abs(leftGap - rightGap) < 6) {
    alignment = AlignmentType.CENTER;
    indentLeft = 0;
  } else if (rightGap < 3 && leftGap > 20) {
    alignment = AlignmentType.RIGHT;
    indentLeft = 0;
  } else if (lines.length > 2) {
    const ends = lines.slice(0, -1).map((line) => line.x1);
    if (Math.max(...ends) - Math.min(...ends) < 1.5 && bounds.right - Math.max(...ends) < 3) {
      alignment = AlignmentType.JUSTIFIED;
    }
  }

  const tabStops: Array<{ type: (typeof TabStopType)[keyof typeof TabStopType]; position: number }> = [];
  const children: ParagraphChild[] = [];
  lines.forEach((line, lineIndex) => {
    line.runs.forEach((run, runIndex) => {
      if (run.tab) {
        const endsAtRight = bounds.right - (run.x + run.width) < 4;
        tabStops.push(endsAtRight
          ? { type: TabStopType.RIGHT, position: twip(Math.min(run.x + run.width, bounds.right) - bounds.left) }
          : { type: TabStopType.LEFT, position: twip(run.x - bounds.left) });
        children.push(new TextRun({ children: [new Tab()], size: Math.round(run.size * 2), font: run.font }));
      }
      const text = lineIndex > 0 && runIndex === 0 ? ` ${run.text}` : run.text;
      const textRun = textRunFor(run, line.size, text, context);
      children.push(run.link ? new ExternalHyperlink({ link: run.link, children: [textRun] }) : textRun);
    });
  });

  const firstRun = first.runs[0];
  return new Paragraph({
    alignment,
    heading: kind?.type === "heading" ? HEADINGS[Math.min(kind.level, 4) - 1] : undefined,
    numbering: kind && kind.type !== "heading"
      ? kind.type === "bullet"
        ? { reference: "bullets", level: 0 }
        : { reference: "numbers", level: 0, instance: kind.instance }
      : undefined,
    indent: listHanging
      ? { left: twip(indentLeft + listHanging), hanging: twip(listHanging) }
      : indentLeft > 0 ? { left: twip(indentLeft) } : undefined,
    tabStops: tabStops.length > 0 ? tabStops : undefined,
    spacing: {
      before: twip(before),
      after: 0,
      line: twip(pitch),
      lineRule: LineRuleType.EXACT,
    },
    run: {
      size: Math.max(2, Math.round(first.size * 2)),
      font: firstRun.font,
      color: firstRun.color,
      bold: firstRun.bold,
    },
    children,
  });
}

function spacer(points: number): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: Math.max(20, twip(points)), lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text: "", size: 2 })],
  });
}

function buildTable(rows: LineInfo[], bounds: Bounds, context: BuildContext): Table {
  const { pitches, heights } = tableMetrics(rows);
  const grid = rows.map(cellsOf);
  const count = grid[0].length;
  const x0 = Array.from({ length: count }, (_, column) => Math.min(...grid.map((cells) => cells[column].x0)));
  const x1 = Array.from({ length: count }, (_, column) => Math.max(...grid.map((cells) => cells[column].x1)));

  const edges = [x0[0]];
  for (let column = 1; column < count; column += 1) {
    edges.push(Math.max(edges[column - 1] + 10, (x1[column - 1] + x0[column]) / 2));
  }
  edges.push(Math.max(x1[count - 1], edges[count - 1] + 10));

  const alignments = Array.from({ length: count }, (_, column) => {
    const tally = { left: 0, right: 0, center: 0 };
    for (const cells of grid) {
      const cell = cells[column];
      if (Math.abs(cell.x0 - x0[column]) <= 3) tally.left += 1;
      if (Math.abs(cell.x1 - x1[column]) <= 3) tally.right += 1;
      if (Math.abs((cell.x0 + cell.x1) / 2 - (x0[column] + x1[column]) / 2) <= 3) tally.center += 1;
    }
    if (tally.left >= tally.right && tally.left >= tally.center) return AlignmentType.LEFT;
    return tally.right >= tally.center ? AlignmentType.RIGHT : AlignmentType.CENTER;
  });

  const borders = context.mode === "text" ? LIGHT_BORDERS : NO_BORDERS;
  const widths = Array.from({ length: count }, (_, column) => twip(edges[column + 1] - edges[column]));

  const tableRows = grid.map((cells, rowIndex) => new TableRow({
    cantSplit: true,
    height: { value: twip(heights[rowIndex]), rule: HeightRule.EXACT },
    children: cells.map((cell, column) => {
      const alignment = alignments[column];
      const marginLeft = alignment === AlignmentType.LEFT ? Math.max(0, cell.x0 - edges[column]) : 0;
      const marginRight = alignment === AlignmentType.RIGHT ? Math.max(0, edges[column + 1] - cell.x1) : 0;
      const line = rows[rowIndex];
      const children = cell.runs.map((run) => {
        const textRun = textRunFor(run, line.size, run.text, context);
        return run.link ? new ExternalHyperlink({ link: run.link, children: [textRun] }) : textRun;
      });
      return new TableCell({
        width: { size: widths[column], type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        borders,
        margins: { top: 0, bottom: 0, left: twip(marginLeft), right: twip(marginRight) },
        children: [new Paragraph({
          alignment,
          spacing: { before: 0, after: 0, line: twip(pitches[rowIndex]), lineRule: LineRuleType.EXACT },
          children,
        })],
      });
    }),
  }));

  return new Table({
    width: { size: widths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    indent: { size: twip(Math.max(0, edges[0] - bounds.left)), type: WidthType.DXA },
    borders: {
      ...borders,
      insideHorizontal: borders.top,
      insideVertical: borders.left,
    },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    rows: tableRows,
  });
}

// Coloca los bloques de arriba hacia abajo reproduciendo el espacio entre ellos.
function flowBlocks(blocks: Block[], startY: number, bounds: Bounds, context: BuildContext) {
  const children: Child[] = [];
  let cursor = startY;
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const metrics = paragraphMetrics(block.paragraph);
      children.push(buildParagraph(block.paragraph, Math.max(0, cursor - metrics.top), bounds, context));
      cursor = metrics.bottom;
    } else {
      const metrics = tableMetrics(block.rows);
      const gap = cursor - metrics.top;
      if (gap >= 1) children.push(spacer(gap));
      children.push(buildTable(block.rows, bounds, context));
      cursor = metrics.bottom;
    }
  }
  return { children, bottom: cursor };
}

const endWithParagraph = (children: Child[]): Child[] =>
  children.length === 0 || children[children.length - 1] instanceof Table
    ? [...children, spacer(1)]
    : children;

function buildColumns(
  columns: Array<{ bounds: Bounds; blocks: Block[] }>,
  startY: number,
  pageBounds: Bounds,
  context: BuildContext
) {
  if (columns.length < 2) {
    const only = columns[0];
    return flowBlocks(only.blocks, startY, only.bounds.left > pageBounds.left ? only.bounds : pageBounds, context);
  }
  const [first, second] = columns;
  const flows = columns.map((column) => flowBlocks(column.blocks, startY, column.bounds, context));
  const firstWidth = twip(second.bounds.left - first.bounds.left);
  const secondWidth = twip(second.bounds.right - second.bounds.left);
  const gutter = Math.max(0, second.bounds.left - first.bounds.right);

  const table = new Table({
    width: { size: firstWidth + secondWidth, type: WidthType.DXA },
    columnWidths: [firstWidth, secondWidth],
    layout: TableLayoutType.FIXED,
    indent: { size: twip(Math.max(0, first.bounds.left - pageBounds.left)), type: WidthType.DXA },
    borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    rows: [new TableRow({
      children: flows.map((flow, index) => new TableCell({
        width: { size: index === 0 ? firstWidth : secondWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        borders: NO_BORDERS,
        margins: { top: 0, bottom: 0, left: 0, right: index === 0 ? twip(gutter) : 0 },
        children: endWithParagraph(flow.children),
      })),
    })],
  });
  return { children: [table] as Child[], bottom: Math.min(...flows.map((flow) => flow.bottom)) };
}

function segmentTop(segment: ResolvedSegment): number | null {
  const tops = segment.kind === "flow"
    ? segment.blocks.slice(0, 1).map(blockTop)
    : segment.columns.flatMap((column) => column.blocks.slice(0, 1).map(blockTop));
  return tops.length > 0 ? Math.max(...tops) : null;
}

export function buildSection(page: ResolvedPage, image: PageImage | null, context: BuildContext): ISectionOptions {
  const bounds: Bounds = { left: page.margins.left, right: page.width - page.margins.right };

  const tops = page.segments.map(segmentTop).filter((top): top is number => top !== null);
  const bodyTop = tops.length > 0 ? tops[0] : null;

  const header = page.header.length > 0
    ? flowBlocks(page.header, blockTop(page.header[0]), bounds, context)
    : null;
  const footer = page.footer.length > 0
    ? flowBlocks(page.footer, blockTop(page.footer[0]), bounds, context)
    : null;

  const children: Child[] = [];
  if (image) {
    children.push(new Paragraph({
      spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
      children: [new ImageRun({
        type: image.type,
        data: image.data,
        transformation: { width: page.width / 0.75, height: page.height / 0.75 },
        floating: {
          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
          verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
          behindDocument: true,
          allowOverlap: true,
          wrap: { type: TextWrappingType.NONE },
        },
      })],
    }));
  }

  let cursor = bodyTop ?? 0;
  for (const segment of page.segments) {
    const flow = segment.kind === "flow"
      ? flowBlocks(segment.blocks, cursor, bounds, context)
      : buildColumns(segment.columns, cursor, bounds, context);
    children.push(...flow.children);
    cursor = flow.bottom;
  }

  const hasBody = bodyTop !== null;
  let marginTop = hasBody ? Math.max(0, page.height - bodyTop - (image ? 1 : 0)) : 0;
  if (header) marginTop = Math.max(marginTop, page.height - header.bottom + 0.5);
  const marginBottom = footer ? blockTop(page.footer[0]) + 0.5 : 0;

  return {
    properties: {
      page: {
        size: {
          width: twip(Math.min(page.width, page.height)),
          height: twip(Math.max(page.width, page.height)),
          orientation: page.width > page.height ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
        },
        margin: {
          top: twip(marginTop),
          bottom: twip(marginBottom),
          left: twip(hasBody || header || footer ? page.margins.left : 0),
          right: twip(hasBody || header || footer ? page.margins.right : 0),
          header: header ? twip(Math.max(0, page.height - blockTop(page.header[0]))) : 0,
          footer: footer ? twip(Math.max(0, footer.bottom)) : 0,
        },
      },
    },
    headers: header ? { default: new Header({ children: endWithParagraph(header.children) }) } : undefined,
    footers: footer ? { default: new Footer({ children: endWithParagraph(footer.children) }) } : undefined,
    children: children.length > 0 ? endWithParagraph(children) : [new Paragraph({})],
  };
}

export function buildDocument(sections: ISectionOptions[], title: string): Document {
  const indent = (left: number, hanging: number) => ({ paragraph: { indent: { left, hanging } } });
  return new Document({
    creator: "SolutionsPDF",
    title,
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: indent(720, 360) }],
        },
        {
          reference: "numbers",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: indent(720, 360) }],
        },
      ],
    },
    sections,
  });
}
