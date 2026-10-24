import type PptxGenJS from "pptxgenjs";
import { pdfjs } from "react-pdf";

import { recognizeOcrItems } from "./ocr";
import type { RawItem } from "./wordLayout";

export type PowerPointExportMode = "image" | "editable";
export type PowerPointExportQuality = "high" | "medium" | "low";

export interface PowerPointExportOptions {
  mode: PowerPointExportMode;
  pageNumbers?: number[];
  quality?: PowerPointExportQuality;
  enableOcr?: boolean;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

export interface PowerPointExportResult {
  bytes: Uint8Array;
  pagesWithoutText: number[];
  ocrPages: number[];
}

const QUALITY: Record<PowerPointExportQuality, { scale: number; format: "png" | "jpeg"; jpeg: number; maxPixels: number }> = {
  high: { scale: 2.5, format: "png", jpeg: 1, maxPixels: 16_000_000 },
  medium: { scale: 2, format: "jpeg", jpeg: 0.8, maxPixels: 16_000_000 },
  low: { scale: 1.5, format: "jpeg", jpeg: 0.65, maxPixels: 16_000_000 },
};

const MAX_SLIDE_WIDTH = 13.333;
const MAX_SLIDE_HEIGHT = 7.5;

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Exportación a PowerPoint cancelada por el usuario.");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function renderPage(
  page: any,
  scale: number,
  operationsFilter?: (operationIndex: number) => boolean
): Promise<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }> {
  const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("No se pudo preparar la página para PowerPoint.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    await page.render({ canvas, canvasContext: context, viewport, operationsFilter }).promise;
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  }
  return { canvas, context };
}

function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

async function canvasToData(canvas: HTMLCanvasElement, format: "png" | "jpeg", quality: number): Promise<string> {
  const mimeType = format === "png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("No se pudo generar la imagen de una diapositiva."));
    }, mimeType, quality);
  });
  return `${mimeType};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

async function pageImage(page: any, scale: number, format: "png" | "jpeg", quality: number): Promise<string> {
  const { canvas } = await renderPage(page, scale);
  try {
    return await canvasToData(canvas, format, quality);
  } finally {
    releaseCanvas(canvas);
  }
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
  list.fnArray.forEach((operation: number, index: number) => {
    if (textOps.has(operation)) indexes.add(index);
  });
  return indexes;
}

interface PixelBox { left: number; right: number; top: number; bottom: number }

function pixelBox(item: RawItem, scale: number, width: number, height: number): PixelBox | null {
  const left = Math.max(0, Math.floor((item.x - 1) * scale));
  const right = Math.min(width, Math.ceil((item.x + item.width + 1) * scale));
  const top = Math.max(0, Math.floor((item.y - item.size * 1.0) * scale));
  const bottom = Math.min(height, Math.ceil((item.y + item.size * 0.25) * scale));
  return right > left && bottom > top ? { left, right, top, bottom } : null;
}

function hex(red: number, green: number, blue: number): string {
  return [red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Color del texto nativo: píxel que más cambia entre la página completa y la página sin texto.
function colorNativeText(full: CanvasRenderingContext2D, withoutText: CanvasRenderingContext2D, items: RawItem[], scale: number): void {
  const { width, height } = full.canvas;
  const fullData = full.getImageData(0, 0, width, height).data;
  const baseData = withoutText.getImageData(0, 0, width, height).data;
  for (const item of items) {
    const box = pixelBox(item, scale, width, height);
    if (!box) continue;
    let best = 0;
    let color = "000000";
    for (let y = box.top; y < box.bottom; y += 1) {
      for (let x = box.left; x < box.right; x += 1) {
        const index = (y * width + x) * 4;
        const distance = Math.abs(fullData[index] - baseData[index])
          + Math.abs(fullData[index + 1] - baseData[index + 1])
          + Math.abs(fullData[index + 2] - baseData[index + 2]);
        if (distance > best) {
          best = distance;
          color = hex(fullData[index], fullData[index + 1], fullData[index + 2]);
        }
      }
    }
    if (best > 45) item.color = color;
  }
}

// En páginas escaneadas el texto está dentro de la imagen: se borra solo donde el OCR lo reconoció.
function eraseOcrText(context: CanvasRenderingContext2D, items: RawItem[], scale: number): void {
  const { width, height } = context.canvas;
  const data = context.getImageData(0, 0, width, height).data;
  for (const item of items) {
    const box = pixelBox(item, scale, width, height);
    if (!box) continue;
    const samples: number[][] = [];
    for (const y of [Math.max(0, box.top - 1), Math.min(height - 1, box.bottom)]) {
      for (let x = box.left; x < box.right; x += 1) {
        const index = (y * width + x) * 4;
        samples.push([data[index], data[index + 1], data[index + 2]]);
      }
    }
    const channel = (position: number) => {
      const values = samples.map((sample) => sample[position]).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)] ?? 255;
    };
    const background = [channel(0), channel(1), channel(2)];

    let best = 0;
    let color = "000000";
    for (let y = box.top; y < box.bottom; y += 1) {
      for (let x = box.left; x < box.right; x += 1) {
        const index = (y * width + x) * 4;
        const distance = Math.abs(data[index] - background[0])
          + Math.abs(data[index + 1] - background[1])
          + Math.abs(data[index + 2] - background[2]);
        if (distance > best) {
          best = distance;
          color = hex(data[index], data[index + 1], data[index + 2]);
        }
      }
    }
    item.color = best > 90 ? color : "000000";
    context.fillStyle = `rgb(${background[0]}, ${background[1]}, ${background[2]})`;
    context.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  }
}

function slideDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(MAX_SLIDE_WIDTH / width, MAX_SLIDE_HEIGHT / height);
  return { width: width * scale, height: height * scale };
}

function fittedPage(
  pageWidth: number,
  pageHeight: number,
  slideWidth: number,
  slideHeight: number
): { x: number; y: number; width: number; height: number; scale: number } {
  const scale = Math.min(slideWidth / pageWidth, slideHeight / pageHeight);
  const width = pageWidth * scale;
  const height = pageHeight * scale;
  return {
    x: (slideWidth - width) / 2,
    y: (slideHeight - height) / 2,
    width,
    height,
    scale,
  };
}

export function textBoxForSlide(
  item: RawItem,
  pageWidth: number,
  pageHeight: number,
  slideWidth: number,
  slideHeight: number
): { x: number; y: number; w: number; h: number; fontSize: number } | null {
  const fitted = fittedPage(pageWidth, pageHeight, slideWidth, slideHeight);
  const x = fitted.x + item.x * fitted.scale;
  const y = fitted.y + (item.y - item.size) * fitted.scale;
  const right = Math.min(fitted.x + fitted.width, x + item.width * fitted.scale);
  const bottom = Math.min(fitted.y + fitted.height, y + item.size * fitted.scale * 1.35);
  const left = Math.max(fitted.x, x);
  const top = Math.max(fitted.y, y);
  if (right <= left || bottom <= top) return null;
  return {
    x: left,
    y: top,
    w: Math.max(0.02, right - left),
    h: Math.max(0.05, item.size * fitted.scale * 1.35),
    fontSize: Math.max(5, Math.min(96, item.size * fitted.scale * 72)),
  };
}

async function extractText(page: any): Promise<RawItem[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const viewportScale = Math.hypot(viewport.transform[0], viewport.transform[1]);
  const items: RawItem[] = [];

  for (const entry of content.items as any[]) {
    if (typeof entry?.str !== "string" || entry.str.length === 0) continue;
    const matrix = pdfjs.Util.transform(viewport.transform, entry.transform) as number[];
    const angle = Math.abs(Math.atan2(matrix[1], matrix[0]));
    if (angle > 0.22 && Math.abs(Math.PI - angle) > 0.22) continue;

    let rawFontName: string | undefined;
    try {
      rawFontName = page.commonObjs.has(entry.fontName)
        ? page.commonObjs.get(entry.fontName)?.name as string | undefined
        : undefined;
    } catch {
      rawFontName = undefined;
    }

    items.push({
      str: entry.str,
      x: matrix[4],
      y: viewport.height - matrix[5] + Math.max(1, entry.height * viewportScale * 0.15),
      width: Math.max(1, Math.abs(entry.width) * viewportScale),
      size: Math.max(5, Math.hypot(matrix[2], matrix[3]) || entry.height * viewportScale || 10),
      bold: /bold|black|heavy|semibold/i.test(rawFontName ?? ""),
      italic: /italic|oblique/i.test(rawFontName ?? ""),
      font: content.styles[entry.fontName]?.fontFamily || "Arial",
      color: "000000",
    });
  }
  return items;
}

function addEditableText(
  slide: PptxGenJS.Slide,
  items: RawItem[],
  pageWidth: number,
  pageHeight: number,
  slideWidth: number,
  slideHeight: number
): void {
  for (const item of items) {
    const position = textBoxForSlide(item, pageWidth, pageHeight, slideWidth, slideHeight);
    if (!position) continue;
    slide.addText(item.str, {
      x: position.x,
      y: position.y,
      w: position.w,
      h: position.h,
      margin: 0,
      breakLine: false,
      fontFace: item.font || "Arial",
      fontSize: position.fontSize,
      bold: item.bold,
      italic: item.italic,
      color: item.color || "000000",
      valign: "middle",
      fit: "shrink",
    });
  }
}

export async function exportPdfToPowerPoint(
  bytes: Uint8Array,
  options: PowerPointExportOptions
): Promise<PowerPointExportResult> {
  abortIfNeeded(options.signal);
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  try {
    const source = await loadingTask.promise;
    const pages = options.pageNumbers && options.pageNumbers.length > 0
      ? [...new Set(options.pageNumbers)].filter((page) => page >= 1 && page <= source.numPages).sort((a, b) => a - b)
      : Array.from({ length: source.numPages }, (_, index) => index + 1);
    if (pages.length === 0) throw new Error("No hay páginas para exportar.");

    const { default: PptxGenJS } = await import("pptxgenjs");
    const pptx = new PptxGenJS();
    pptx.author = "SolutionsPDF";
    pptx.company = "SolutionsPDF";
    pptx.subject = "Contenido exportado desde un PDF";
    pptx.title = "Exportación de PDF a PowerPoint";
    const quality = QUALITY[options.quality ?? "high"];
    const pagesWithoutText: number[] = [];
    const ocrPages: number[] = [];
    let slideWidth = 0;
    let slideHeight = 0;

    for (const [index, pageNumber] of pages.entries()) {
      abortIfNeeded(options.signal);
      const page = await source.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      try {
        if (index === 0) {
          const dimensions = slideDimensions(viewport.width / 96, viewport.height / 96);
          slideWidth = dimensions.width;
          slideHeight = dimensions.height;
          pptx.defineLayout({ name: "PDF_PAGE", width: slideWidth, height: slideHeight });
          pptx.layout = "PDF_PAGE";
          pptx.theme = {
            headFontFace: "Arial",
            bodyFontFace: "Arial",
          };
        }

        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };

        if (options.mode === "image") {
          const scale = Math.min(
            quality.scale,
            Math.sqrt(quality.maxPixels / (viewport.width * viewport.height))
          );
          const data = await pageImage(page, scale, quality.format, quality.jpeg);
          const fitted = fittedPage(viewport.width, viewport.height, slideWidth, slideHeight);
          slide.addImage({
            data,
            x: fitted.x,
            y: fitted.y,
            w: fitted.width,
            h: fitted.height,
            altText: `Página ${pageNumber} del PDF`,
          });
        } else {
          const pixelScale = Math.sqrt(quality.maxPixels / (viewport.width * viewport.height));
          const imageScale = Math.min(quality.scale, pixelScale);
          const fitted = fittedPage(viewport.width, viewport.height, slideWidth, slideHeight);
          let items = await extractText(page);
          let background: HTMLCanvasElement | null = null;
          let fullCanvas: HTMLCanvasElement | null = null;
          let withoutTextCanvas: HTMLCanvasElement | null = null;
          let backgroundScale = imageScale;

          try {
            if (items.length > 0) {
              const full = await renderPage(page, imageScale);
              fullCanvas = full.canvas;
              background = full.canvas;
              try {
                const indexes = await textOperatorIndexes(page);
                const withoutText = await renderPage(page, imageScale, (operation) => !indexes.has(operation));
                withoutTextCanvas = withoutText.canvas;
                colorNativeText(full.context, withoutText.context, items, imageScale);
                background = withoutText.canvas;
              } catch {
                // Sin la capa sin texto se conserva la página completa y el texto se borra por zonas.
                eraseOcrText(full.context, items, imageScale);
              }
            } else {
              pagesWithoutText.push(pageNumber);
              abortIfNeeded(options.signal);
              backgroundScale = options.enableOcr ? Math.min(3, pixelScale) : imageScale;
              const scan = await renderPage(page, backgroundScale);
              fullCanvas = scan.canvas;
              background = scan.canvas;
              if (options.enableOcr) {
                items = await recognizeOcrItems(scan.canvas, viewport.width, viewport.height, options.signal);
                if (items.length > 0) {
                  eraseOcrText(scan.context, items, backgroundScale);
                  ocrPages.push(pageNumber);
                }
              }
            }

            const data = await canvasToData(background, quality.format, quality.jpeg);
            slide.addImage({
              data,
              x: fitted.x,
              y: fitted.y,
              w: fitted.width,
              h: fitted.height,
              altText: `Fondo de la página ${pageNumber} sin texto editable`,
            });
          } finally {
            releaseCanvas(fullCanvas);
            releaseCanvas(withoutTextCanvas);
          }
          addEditableText(slide, items, viewport.width, viewport.height, slideWidth, slideHeight);
        }
      } finally {
        page.cleanup();
      }

      options.onProgress?.(index + 1, pages.length);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    abortIfNeeded(options.signal);
    const output = await pptx.write({ outputType: "uint8array", compression: true });
    if (!(output instanceof Uint8Array)) throw new Error("PowerPoint no devolvió un archivo binario válido.");
    return { bytes: output, pagesWithoutText, ocrPages };
  } finally {
    await loadingTask.destroy();
  }
}
