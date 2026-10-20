import { Packer } from "docx";
import { pdfjs } from "react-pdf";

import { recognizeOcrItems } from "./ocr";
import { buildDocument, buildSection, type PageImage, type WordExportMode } from "./wordDocx";
import {
  buildPageModel,
  genericFamily,
  resolveDocument,
  resolveFont,
  type RawItem,
} from "./wordLayout";

export type { WordExportMode };

export type WordExportQuality = "high" | "medium" | "low";

export interface WordExportOptions {
  mode: WordExportMode;
  pageNumbers?: number[];
  quality?: WordExportQuality;
  enableOcr?: boolean;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

export interface WordExportResult {
  bytes: Uint8Array;
  pagesWithoutText: number[];
  substitutedFonts: string[];
  ocrPages: number[];
}

const QUALITY: Record<WordExportQuality, { scale: number; jpeg: number; maxPixels: number }> = {
  high: { scale: 2.5, jpeg: 0.92, maxPixels: 16_000_000 },
  medium: { scale: 2, jpeg: 0.8, maxPixels: 16_000_000 },
  low: { scale: 1.5, jpeg: 0.65, maxPixels: 16_000_000 },
};

const safeUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  const text = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(text) ? text : undefined;
};

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Exportación a Word cancelada por el usuario.");
}

function toHex(red: number, green: number, blue: number): string {
  return [red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function pixelDistance(
  source: Uint8ClampedArray,
  candidate: Uint8ClampedArray,
  sourceIndex: number,
  candidateIndex: number
): number {
  return Math.abs(source[sourceIndex] - candidate[candidateIndex])
    + Math.abs(source[sourceIndex + 1] - candidate[candidateIndex + 1])
    + Math.abs(source[sourceIndex + 2] - candidate[candidateIndex + 2]);
}

function asMimeImage(canvas: HTMLCanvasElement, mimeType: "image/jpeg" | "image/png", quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("No se pudo generar la imagen de una página."));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, mimeType, quality);
  });
}

async function renderPage(page: any, scale: number, whiteBackground: boolean, operationsFilter?: (opIndex: number) => boolean) {
  const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true, alpha: !whiteBackground });
  if (!context) throw new Error("No se pudo preparar un lienzo para exportar.");
  if (whiteBackground) {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvas, canvasContext: context, viewport, operationsFilter }).promise;
  return { canvas, context, viewport };
}

async function urlByPoint(page: any, viewport: any): Promise<Array<{ x0: number; x1: number; y0: number; y1: number; link: string }>> {
  try {
    const annotations = await page.getAnnotations?.();
    return (annotations ?? []).flatMap((annotation: any) => {
      const link = safeUrl(annotation.url);
      if (!link || !Array.isArray(annotation.rect)) return [];
      const rect = viewport.convertToViewportRectangle(annotation.rect) as number[];
      const x0 = Math.min(rect[0], rect[2]);
      const x1 = Math.max(rect[0], rect[2]);
      const y0 = Math.min(rect[1], rect[3]);
      const y1 = Math.max(rect[1], rect[3]);
      return [{ x0, x1, y0, y1, link }];
    });
  } catch {
    return [];
  }
}

async function collectTextItems(page: any, pageHeight: number, viewport: any) {
  const content = await page.getTextContent();
  const links = await urlByPoint(page, viewport);
  const items: RawItem[] = [];
  const substitutedFonts = new Set<string>();

  for (const entry of content.items as any[]) {
    if (typeof entry?.str !== "string" || entry.str.length === 0) continue;
    const matrix = pdfjs.Util.transform(viewport.transform, entry.transform) as number[];
    const angle = Math.abs(Math.atan2(matrix[1], matrix[0]));
    const rotated = angle > 0.22 && Math.abs(Math.PI - angle) > 0.22;
    if (rotated) continue;

    const x = matrix[4];
    const y = pageHeight - matrix[5];
    const width = Math.max(0.1, Math.abs(entry.width));
    const size = Math.max(5, Math.hypot(matrix[2], matrix[3]) || entry.height || 10);
    const style = content.styles[entry.fontName];

    let rawFontName: string | undefined;
    try {
      rawFontName = page.commonObjs.has(entry.fontName)
        ? page.commonObjs.get(entry.fontName)?.name as string | undefined
        : undefined;
    } catch {
      rawFontName = undefined;
    }
    const { name: fontName, known } = resolveFont(rawFontName, genericFamily(style?.fontFamily));
    if (!known && rawFontName) substitutedFonts.add(rawFontName);

    const centerX = x + width / 2;
    const centerYViewport = pageHeight - y;
    const link = links.find((candidate) =>
      centerX >= candidate.x0 && centerX <= candidate.x1
      && centerYViewport >= candidate.y0 && centerYViewport <= candidate.y1)?.link;

    items.push({
      str: entry.str,
      x,
      y,
      width,
      size,
      bold: /bold|black|heavy|semibold/i.test(rawFontName ?? ""),
      italic: /italic|oblique/i.test(rawFontName ?? ""),
      font: fontName,
      color: "000000",
      link,
    });
  }

  return { items, substitutedFonts };
}

async function textOperatorIndexes(page: any): Promise<Set<number>> {
  const list = await page.getOperatorList();
  const ops = pdfjs.OPS as Record<string, number>;
  const textOps = new Set<number>([
    ops.showText ?? 44,
    ops.showSpacedText ?? 45,
    ops.nextLineShowText ?? 46,
    ops.nextLineSetSpacingShowText ?? 47,
  ]);
  const indexes = new Set<number>();
  list.fnArray.forEach((op: number, index: number) => {
    if (textOps.has(op)) indexes.add(index);
  });
  return indexes;
}

function enrichTextColorAndBackground(
  imageContext: CanvasRenderingContext2D,
  nonTextContext: CanvasRenderingContext2D | null,
  items: RawItem[],
  pageHeight: number,
  scale: number,
  eraseTextFromImage: boolean
) {
  const source = imageContext.getImageData(0, 0, imageContext.canvas.width, imageContext.canvas.height);
  const target = source.data;
  const comparison = nonTextContext
    ? nonTextContext.getImageData(0, 0, nonTextContext.canvas.width, nonTextContext.canvas.height).data
    : null;

  for (const item of items) {
    const x0 = Math.max(0, Math.floor((item.x - 1) * scale));
    const x1 = Math.min(imageContext.canvas.width, Math.ceil((item.x + item.width + 1) * scale));
    const top = Math.max(0, Math.floor((pageHeight - item.y - item.size * 0.95) * scale));
    const bottom = Math.min(imageContext.canvas.height, Math.ceil((pageHeight - item.y + item.size * 0.28) * scale));
    if (x1 <= x0 || bottom <= top) continue;

    let maxDistance = 0;
    let best = [0, 0, 0];
    let background = [255, 255, 255];

    for (let y = top; y < bottom; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * imageContext.canvas.width + x) * 4;
        const distance = comparison ? pixelDistance(target, comparison, index, index) : 0;
        if (distance > maxDistance) {
          maxDistance = distance;
          best = [target[index], target[index + 1], target[index + 2]];
        }
        if (y === top && x === x0) background = [target[index], target[index + 1], target[index + 2]];
      }
    }

    item.color = maxDistance > 45 ? toHex(best[0], best[1], best[2]) : "000000";

    if (!eraseTextFromImage) continue;
    if (comparison) {
      for (let y = top; y < bottom; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = (y * imageContext.canvas.width + x) * 4;
          target[index] = comparison[index];
          target[index + 1] = comparison[index + 1];
          target[index + 2] = comparison[index + 2];
        }
      }
    } else {
      for (let y = top; y < bottom; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = (y * imageContext.canvas.width + x) * 4;
          target[index] = background[0];
          target[index + 1] = background[1];
          target[index + 2] = background[2];
        }
      }
    }
  }

  imageContext.putImageData(source, 0, 0);
}

async function runOcrForEmptyPage(
  page: any,
  pageWidth: number,
  pageHeight: number,
  imageScale: number,
  signal: AbortSignal | undefined
): Promise<RawItem[]> {
  const ocrScale = Math.max(3, imageScale);
  const { canvas } = await renderPage(page, ocrScale, true);
  try {
    return await recognizeOcrItems(canvas, pageWidth, pageHeight, signal);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function exportPdfToWord(bytes: Uint8Array, options: WordExportOptions): Promise<WordExportResult> {
  const {
    mode,
    pageNumbers,
    quality = "high",
    enableOcr = false,
    signal,
    onProgress,
  } = options;
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  const selected = QUALITY[quality];
  const pagesWithoutText: number[] = [];
  const ocrPages: number[] = [];
  const substitutedFonts = new Set<string>();

  try {
    abortIfNeeded(signal);
    const source = await loadingTask.promise;
    const pages = pageNumbers && pageNumbers.length > 0
      ? [...new Set(pageNumbers)].filter((value) => value >= 1 && value <= source.numPages).sort((a, b) => a - b)
      : Array.from({ length: source.numPages }, (_, index) => index + 1);
    if (pages.length === 0) throw new Error("No hay páginas para exportar.");

    const models: ReturnType<typeof buildPageModel>[] = [];
    const images = new Map<number, PageImage>();

    for (const [index, pageNumber] of pages.entries()) {
      abortIfNeeded(signal);
      const page = await source.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const pixelScale = Math.sqrt(selected.maxPixels / (base.width * base.height));
      const imageScale = Math.min(selected.scale, pixelScale);
      const extractionViewport = page.getViewport({ scale: 1 });

      const { canvas: imageCanvas, context: imageContext } = await renderPage(page, imageScale, mode !== "image");
      let nonTextContext: CanvasRenderingContext2D | null = null;
      try {
        const needsText = mode !== "image";
        const needsImage = mode !== "text";

        if (needsImage && needsText) {
          try {
            const indexes = await textOperatorIndexes(page);
            const nonText = await renderPage(page, imageScale, true, (opIndex) => !indexes.has(opIndex));
            nonTextContext = nonText.context;
          } catch {
            nonTextContext = null;
          }
        }

        const { items, substitutedFonts: pageFonts } = await collectTextItems(page, base.height, extractionViewport);
        pageFonts.forEach((font) => substitutedFonts.add(font));

        if (items.length === 0) {
          pagesWithoutText.push(pageNumber);
          if (enableOcr && mode !== "image") {
            abortIfNeeded(signal);
            const ocrItems = await runOcrForEmptyPage(page, base.width, base.height, imageScale, signal);
            if (ocrItems.length > 0) {
              items.push(...ocrItems);
              ocrPages.push(pageNumber);
            }
          }
        }

        if (items.length > 0 && mode !== "text") {
          enrichTextColorAndBackground(imageContext, nonTextContext, items, base.height, imageScale, mode === "faithful");
        }

        const model = buildPageModel(pageNumber, base.width, base.height, items);
        models.push(model);

        if (needsImage) {
          const type = mode === "image" ? "png" : "jpg";
          const data = await asMimeImage(imageCanvas, type === "png" ? "image/png" : "image/jpeg", type === "jpg" ? selected.jpeg : undefined);
          images.set(pageNumber, { data, type });
        }
      } finally {
        page.cleanup();
        imageCanvas.width = 0;
        imageCanvas.height = 0;
        if (nonTextContext) {
          nonTextContext.canvas.width = 0;
          nonTextContext.canvas.height = 0;
        }
      }

      onProgress?.(index + 1, pages.length);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    const resolved = resolveDocument(models);
    const allPages = pages.length === source.numPages && pages.every((page, index) => page === index + 1);
    const sections = resolved.map((page, index) =>
      buildSection(
        page,
        mode === "text" ? null : images.get(page.pageNumber) ?? null,
        { mode, pageNumber: pages[index], totalPages: allPages ? pages.length : null }
      ));

    const document = buildDocument(sections, "Documento exportado");
    const blob = await Packer.toBlob(document);
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      pagesWithoutText,
      substitutedFonts: [...substitutedFonts].sort(),
      ocrPages,
    };
  } finally {
    await loadingTask.destroy();
  }
}
