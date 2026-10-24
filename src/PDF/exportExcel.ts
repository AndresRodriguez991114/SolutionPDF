import type { CellValue, Worksheet } from "exceljs";
import { pdfjs } from "react-pdf";

import { recognizeOcrItems } from "./ocr";
import { genericFamily, resolveFont } from "./wordLayout";
import {
  buildExcelPageRows,
  type ExcelCell,
  type ExcelTextItem,
} from "./excelLayout";

export interface ExcelExportOptions {
  pageNumbers?: number[];
  enableOcr?: boolean;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

export interface ExcelExportResult {
  bytes: Uint8Array;
  pagesWithoutText: number[];
  ocrPages: number[];
  detectedTablePages: number[];
  substitutedFonts: string[];
}

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Exportación a Excel cancelada por el usuario.");
}

function safeUrl(url: string | undefined): string | undefined {
  const value = url?.trim();
  return value && /^(https?:\/\/|mailto:)/i.test(value) ? value : undefined;
}

async function linkAreas(page: any, viewport: any) {
  try {
    const annotations = await page.getAnnotations();
    return annotations.flatMap((annotation: any) => {
      const link = safeUrl(annotation.url);
      if (!link || !Array.isArray(annotation.rect)) return [];
      const rectangle = viewport.convertToViewportRectangle(annotation.rect) as number[];
      return [{
        left: Math.min(rectangle[0], rectangle[2]),
        right: Math.max(rectangle[0], rectangle[2]),
        top: Math.min(rectangle[1], rectangle[3]),
        bottom: Math.max(rectangle[1], rectangle[3]),
        link,
      }];
    });
  } catch {
    return [];
  }
}

async function extractPageItems(page: any, viewport: any): Promise<{ items: ExcelTextItem[]; substitutedFonts: string[] }> {
  const content = await page.getTextContent();
  const links = await linkAreas(page, viewport);
  const substitutedFonts = new Set<string>();
  const items: ExcelTextItem[] = [];

  for (const entry of content.items as any[]) {
    if (typeof entry?.str !== "string" || entry.str.trim().length === 0) continue;
    const matrix = pdfjs.Util.transform(viewport.transform, entry.transform) as number[];
    const angle = Math.abs(Math.atan2(matrix[1], matrix[0]));
    if (angle > 0.22 && Math.abs(Math.PI - angle) > 0.22) continue;

    const viewportScale = Math.hypot(viewport.transform[0], viewport.transform[1]);
    const width = Math.max(0.1, viewportScale * Math.abs(entry.width));
    const x = matrix[4];
    const y = viewport.height - matrix[5];
    const centerX = x + width / 2;
    const centerY = viewport.height - y;
    const link = links.find((area: { left: number; right: number; top: number; bottom: number }) =>
      centerX >= area.left && centerX <= area.right
      && centerY >= area.top && centerY <= area.bottom)?.link;

    let rawFontName: string | undefined;
    try {
      rawFontName = page.commonObjs.has(entry.fontName)
        ? page.commonObjs.get(entry.fontName)?.name as string | undefined
        : undefined;
    } catch {
      rawFontName = undefined;
    }
    const fontStyle = content.styles[entry.fontName];
    const { name: fontName, known } = resolveFont(rawFontName, genericFamily(fontStyle?.fontFamily));
    if (!known && rawFontName) substitutedFonts.add(rawFontName);

    items.push({
      text: entry.str,
      x,
      y,
      width,
      size: Math.max(5, Math.hypot(matrix[2], matrix[3]) || entry.height || 10),
      bold: /bold|black|heavy|semibold/i.test(fontName ?? ""),
      italic: /italic|oblique/i.test(fontName ?? ""),
      font: fontName || "Arial",
      link,
    });
  }
  return { items, substitutedFonts: [...substitutedFonts] };
}

async function recognizePage(
  page: any,
  pageWidth: number,
  pageHeight: number,
  signal?: AbortSignal
): Promise<ExcelTextItem[]> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.sqrt(16_000_000 / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No se pudo preparar la página para OCR.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  try {
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const words = await recognizeOcrItems(canvas, pageWidth, pageHeight, signal);
    return words.map((word) => ({
      text: word.str,
      x: word.x,
      y: word.y,
      width: word.width,
      size: word.size,
    }));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function safeSheetName(pageNumber: number): string {
  return `Página ${pageNumber}`.slice(0, 31);
}

function tryNumber(text: string): { value: number; format?: string } | null {
  const trimmed = text.trim();
  if (/^0\d+/.test(trimmed)) return null;
  const percent = trimmed.endsWith("%");
  const currency = trimmed.match(/^[€$£¥]\s*|\s*[€$£¥]$/)?.[0]?.trim();
  let numeric = trimmed
    .replace(/^[€$£¥]\s*|\s*[€$£¥]$/g, "")
    .replace(/\s/g, "")
    .replace(/%$/, "");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:[.,]\d{3})+)(?:[.,]\d+)?$/.test(numeric)) return null;

  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  let decimalSeparator: string | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const parts = numeric.split(separator);
    const fraction = parts[parts.length - 1];
    if (fraction.length <= 2) decimalSeparator = separator;
  }

  if (decimalSeparator) {
    const groupSeparator = decimalSeparator === "," ? "." : ",";
    numeric = numeric.split(groupSeparator).join("");
    if (decimalSeparator === ",") numeric = numeric.replace(",", ".");
  } else {
    numeric = numeric.replace(/[.,]/g, "");
  }

  const value = Number(numeric);
  if (!Number.isFinite(value)) return null;
  if (percent) return { value: value / 100, format: "0.00%" };
  if (currency) return { value, format: `"${currency}"#,##0.00;[Red]-"${currency}"#,##0.00` };
  return { value, format: decimalSeparator ? "#,##0.00" : "#,##0" };
}

function valueForCell(cell: ExcelCell): { value: CellValue; format?: string } {
  const link = safeUrl(cell.link);
  if (link) return { value: { text: cell.text, hyperlink: link, tooltip: link } };
  const numeric = tryNumber(cell.text);
  return numeric ? numeric : { value: cell.text };
}

function styleCell(worksheet: Worksheet, row: number, column: number, source: ExcelCell, boldOverride = false): void {
  const cell = worksheet.getCell(row, column);
  const { value, format } = valueForCell(source);
  cell.value = value;
  cell.font = {
    name: source.font,
    size: Math.max(8, Math.min(24, Math.round(source.size * 0.75))),
    bold: source.bold || boldOverride,
    italic: source.italic,
    color: { argb: `FF${/^[0-9A-F]{6}$/i.test(source.color) ? source.color : "000000"}` },
  };
  cell.alignment = {
    vertical: "middle",
    horizontal: typeof value === "number" ? "right" : "left",
    wrapText: true,
  };
  if (format) cell.numFmt = format;
  if (typeof value === "object" && value && "hyperlink" in value) {
    cell.font = { ...cell.font, color: { argb: "FF0563C1" }, underline: true };
  }
}

function createWorksheet(ExcelJS: typeof import("exceljs"), workbook: InstanceType<typeof ExcelJS.Workbook>, pageNumber: number, pageRows: ReturnType<typeof buildExcelPageRows>) {
  const worksheet = workbook.addWorksheet(safeSheetName(pageNumber), {
    properties: { defaultRowHeight: 19 },
    views: [{ state: "frozen", ySplit: 1, showGridLines: false, zoomScale: 90 }],
  });
  worksheet.columns = pageRows.columnWidths.map((width, index) => ({
    key: `column-${index + 1}`,
    width,
  }));
  const title = worksheet.addRow([`Página ${pageNumber}`]);
  title.height = 25;
  title.getCell(1).font = { name: "Arial", size: 14, bold: true, color: { argb: "FF263238" } };
  title.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF3" } };
  if (pageRows.columnWidths.length > 1) {
    worksheet.mergeCells(1, 1, 1, pageRows.columnWidths.length);
  }

  let tableNumber = 0;
  for (const block of pageRows.blocks) {
    if (block.type === "text") {
      for (const row of block.rows) {
        const excelRow = worksheet.addRow([]);
        row.forEach((cell, index) => styleCell(worksheet, excelRow.number, index + 1, cell));
      }
      continue;
    }

    tableNumber += 1;
    const columnCount = Math.max(...block.rows.map((row) => row.length));
    const headers = Array.from({ length: columnCount }, (_, column) => {
      const heading = block.rows[0]?.[column]?.text.trim();
      return heading || `Columna ${column + 1}`;
    });
    const uniqueHeaders = headers.map((heading, index) =>
      headers.indexOf(heading) === index ? heading : `${heading} ${index + 1}`);
    const tableRows = block.rows.slice(1).map((row) =>
      Array.from({ length: columnCount }, (_, column) => row[column] ? valueForCell(row[column]).value : null));
    const refRow = worksheet.rowCount + 1;
    worksheet.addTable({
      name: `PDFPage${pageNumber}Table${tableNumber}`,
      ref: `A${refRow}`,
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: uniqueHeaders.map((name) => ({ name, filterButton: true })),
      rows: tableRows,
    });
    block.rows.forEach((row, rowIndex) => {
      row.forEach((cell, column) => styleCell(
        worksheet,
        refRow + rowIndex,
        column + 1,
        cell,
        rowIndex === 0
      ));
    });
  }

  if (pageRows.blocks.length === 0) {
    const row = worksheet.addRow(["No se encontró texto en esta página. Activa OCR al exportar si es un documento escaneado."]);
    row.getCell(1).font = { italic: true, color: { argb: "FF707070" } };
  }
  return worksheet;
}

export async function exportPdfToExcel(
  bytes: Uint8Array,
  options: ExcelExportOptions = {}
): Promise<ExcelExportResult> {
  abortIfNeeded(options.signal);
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  try {
    const source = await loadingTask.promise;
    const pages = options.pageNumbers && options.pageNumbers.length > 0
      ? [...new Set(options.pageNumbers)].filter((page) => page >= 1 && page <= source.numPages).sort((a, b) => a - b)
      : Array.from({ length: source.numPages }, (_, index) => index + 1);
    if (pages.length === 0) throw new Error("No hay páginas para exportar.");

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SolutionsPDF";
    workbook.subject = "Contenido extraído de un PDF";
    workbook.title = "Exportación de PDF a Excel";
    workbook.description = "Cada hoja contiene texto y tablas reconstruidas de una página PDF.";
    workbook.company = "SolutionsPDF";
    const pagesWithoutText: number[] = [];
    const ocrPages: number[] = [];
    const detectedTablePages: number[] = [];
    const substitutedFonts = new Set<string>();

    for (const [index, pageNumber] of pages.entries()) {
      abortIfNeeded(options.signal);
      const page = await source.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      try {
        const { items, substitutedFonts: pageFonts } = await extractPageItems(page, viewport);
        pageFonts.forEach((font) => substitutedFonts.add(font));
        let outputItems = items;
        if (outputItems.length === 0) {
          pagesWithoutText.push(pageNumber);
          if (options.enableOcr) {
            abortIfNeeded(options.signal);
            outputItems = await recognizePage(page, viewport.width, viewport.height, options.signal);
            if (outputItems.length > 0) ocrPages.push(pageNumber);
          }
        }

        const pageRows = buildExcelPageRows(outputItems);
        if (pageRows.detectedTable) detectedTablePages.push(pageNumber);
        createWorksheet(ExcelJS, workbook, pageNumber, pageRows);
      } finally {
        page.cleanup();
      }
      options.onProgress?.(index + 1, pages.length);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    abortIfNeeded(options.signal);
    const output = await workbook.xlsx.writeBuffer();
    return {
      bytes: new Uint8Array(output),
      pagesWithoutText,
      ocrPages,
      detectedTablePages,
      substitutedFonts: [...substitutedFonts].sort(),
    };
  } finally {
    await loadingTask.destroy();
  }
}
