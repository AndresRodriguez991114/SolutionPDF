import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { pdfjs } from "react-pdf";

export type PdfCompressionLevel = "extreme" | "recommended" | "low";

const compressionSettings: Record<PdfCompressionLevel, { dpi: number; quality: number }> = {
  extreme: { dpi: 72, quality: 0.35 },
  recommended: { dpi: 120, quality: 0.65 },
  low: { dpi: 180, quality: 0.85 },
};

export type PageAction =
  | "rotate-left"
  | "rotate-right"
  | "move-up"
  | "move-down"
  | "delete";

export type RotationDirection = "left" | "right";
export type PageImageFormat = "png" | "jpg";

export interface PageRange {
  start: number;
  end: number;
}

export interface ExportedPageImage {
  pageNumber: number;
  bytes: Uint8Array;
}

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes);
}

/**
 * Obtiene la cantidad de páginas de un PDF.
 */
export function getPageCount(pdf: PDFDocument): number {
  return pdf.getPageCount();
}

/**
 * Elimina una página del PDF.
 */
export function removePage(
  pdf: PDFDocument,
  pageIndex: number
): void {
  if (
    pageIndex >= 0 &&
    pageIndex < pdf.getPageCount()
  ) {
    pdf.removePage(pageIndex);
  }
}

/**
 * Rota una página del PDF.
 *
 * @param pageIndex Índice de la página empezando en 0.
 * @param rotation Grados de rotación.
 */
export function rotatePage(
  pdf: PDFDocument,
  pageIndex: number,
  rotation: number
): void {
  if (
    pageIndex >= 0 &&
    pageIndex < pdf.getPageCount()
  ) {
    const page = pdf.getPage(pageIndex);
    const currentRotation = page.getRotation().angle;

    page.setRotation(
      degrees(currentRotation + rotation)
    );
  }
}

/**
 * Reordena las páginas de un PDF.
 *
 * Ejemplo:
 * [0, 2, 1]
 *
 * significa:
 * Página 1 → Página 1
 * Página 2 → Página 3
 * Página 3 → Página 2
 */
export async function reorderPages(
  pdf: PDFDocument,
  newOrder: number[]
): Promise<PDFDocument> {
  const newPdf = await PDFDocument.create();

  const pages = await newPdf.copyPages(
    pdf,
    newOrder
  );

  pages.forEach((page) => {
    newPdf.addPage(page);
  });

  return newPdf;
}

export async function movePageTo(
  bytes: Uint8Array,
  fromPageNumber: number,
  toPageNumber: number
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const pageCount = pdf.getPageCount();
  if (
    !Number.isInteger(fromPageNumber)
    || !Number.isInteger(toPageNumber)
    || fromPageNumber < 1
    || fromPageNumber > pageCount
    || toPageNumber < 1
    || toPageNumber > pageCount
  ) {
    throw new Error("La página de origen o destino no es válida.");
  }
  return movePagesTo(bytes, [fromPageNumber], toPageNumber);
}

function validatePageNumbers(pageNumbers: number[], pageCount: number): number[] {
  const uniquePageNumbers = [...new Set(pageNumbers)];
  if (
    uniquePageNumbers.length === 0
    || uniquePageNumbers.some((pageNumber) =>
      !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount
    )
  ) {
    throw new Error("La selección contiene páginas no válidas.");
  }
  return uniquePageNumbers.sort((left, right) => left - right);
}

export async function movePagesTo(
  bytes: Uint8Array,
  pageNumbers: number[],
  targetPageNumber: number
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const pageCount = pdf.getPageCount();
  if (
    !Number.isInteger(targetPageNumber)
    || targetPageNumber < 1
    || targetPageNumber > pageCount
  ) {
    throw new Error("La posición de destino no es válida.");
  }
  const selectedPageNumbers = validatePageNumbers(pageNumbers, pageCount);
  if (selectedPageNumbers.includes(targetPageNumber)) return bytes;

  const pageIndices = pdf.getPages().map((_, index) => index);
  const selectedIndices = new Set(selectedPageNumbers.map((pageNumber) => pageNumber - 1));
  const selectedInOrder = pageIndices.filter((index) => selectedIndices.has(index));
  const remaining = pageIndices.filter((index) => !selectedIndices.has(index));
  remaining.splice(Math.min(targetPageNumber - 1, remaining.length), 0, ...selectedInOrder);

  return savePdf(await reorderPages(pdf, remaining));
}

/**
 * Exporta el PDF modificado como bytes.
 */
export async function savePdf(
  pdf: PDFDocument,
  options?: Parameters<PDFDocument["save"]>[0]
): Promise<Uint8Array> {
  return pdf.save(options);
}

export async function applyPageAction(
  bytes: Uint8Array,
  action: PageAction,
  pageNumber: number
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const pageIndex = pageNumber - 1;

  if (action === "delete") {
    if (pdf.getPageCount() <= 1) {
      throw new Error("El PDF debe conservar al menos una página.");
    }

    removePage(pdf, pageIndex);
    return savePdf(pdf);
  }

  if (action === "rotate-left" || action === "rotate-right") {
    rotatePage(pdf, pageIndex, action === "rotate-left" ? -90 : 90);
    return savePdf(pdf);
  }

  const targetIndex = pageIndex + (action === "move-up" ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= pdf.getPageCount()) {
    return bytes;
  }

  const order = Array.from({ length: pdf.getPageCount() }, (_, index) => index);
  [order[pageIndex], order[targetIndex]] = [order[targetIndex], order[pageIndex]];

  const reordered = await reorderPages(pdf, order);
  return savePdf(reordered);
}

export async function rotatePages(
  bytes: Uint8Array,
  pageNumbers: number[],
  direction: RotationDirection
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const uniquePageNumbers = validatePageNumbers(pageNumbers, pdf.getPageCount());
  const rotation = direction === "left" ? -90 : 90;
  for (const pageNumber of uniquePageNumbers) {
    rotatePage(pdf, pageNumber - 1, rotation);
  }
  return savePdf(pdf);
}

export async function deletePages(
  bytes: Uint8Array,
  pageNumbers: number[]
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const selectedPageNumbers = validatePageNumbers(pageNumbers, pdf.getPageCount());
  if (selectedPageNumbers.length >= pdf.getPageCount()) {
    throw new Error("El PDF debe conservar al menos una página.");
  }
  for (const pageNumber of selectedPageNumbers.sort((left, right) => right - left)) {
    pdf.removePage(pageNumber - 1);
  }
  return savePdf(pdf);
}

export async function extractPages(
  bytes: Uint8Array,
  pageNumbers: number[]
): Promise<Uint8Array> {
  const source = await loadPdf(bytes);
  const selectedPageNumbers = validatePageNumbers(pageNumbers, source.getPageCount());
  const extracted = await PDFDocument.create();
  const pages = await extracted.copyPages(
    source,
    selectedPageNumbers.map((pageNumber) => pageNumber - 1)
  );
  pages.forEach((page) => extracted.addPage(page));
  return savePdf(extracted, { useObjectStreams: true });
}

export function parsePageRanges(value: string, pageCount: number): PageRange[] {
  const parts = value.split(",");
  if (!value.trim() || parts.some((part) => !part.trim())) {
    throw new Error("Escribe uno o más rangos, por ejemplo: 1-3, 5.");
  }

  const seenPages = new Set<number>();
  return parts.map((part) => {
    const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) throw new Error(`El rango "${part.trim()}" no es válido.`);
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start > end) throw new Error(`El rango "${part.trim()}" debe ir de menor a mayor.`);
    if (start < 1 || end > pageCount) {
      throw new Error(`Las páginas deben estar entre 1 y ${pageCount}.`);
    }
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      if (seenPages.has(pageNumber)) {
        throw new Error(`La página ${pageNumber} aparece en más de un rango.`);
      }
      seenPages.add(pageNumber);
    }
    return { start, end };
  });
}

export async function splitPdfByRanges(
  bytes: Uint8Array,
  ranges: PageRange[]
): Promise<Uint8Array[]> {
  const source = await loadPdf(bytes);
  const pageCount = source.getPageCount();
  return Promise.all(ranges.map(async ({ start, end }) => {
    const pageNumbers = validatePageNumbers(
      Array.from({ length: end - start + 1 }, (_, index) => start + index),
      pageCount
    );
    const part = await PDFDocument.create();
    const pages = await part.copyPages(source, pageNumbers.map((pageNumber) => pageNumber - 1));
    pages.forEach((page) => part.addPage(page));
    return savePdf(part, { useObjectStreams: true });
  }));
}

export async function splitPdfIntoPages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const source = await loadPdf(bytes);
  return splitPdfByRanges(
    bytes,
    Array.from({ length: source.getPageCount() }, (_, index) => ({
      start: index + 1,
      end: index + 1,
    }))
  );
}

export async function exportPagesAsImages(
  bytes: Uint8Array,
  pageNumbers: number[],
  format: PageImageFormat,
  onProgress?: (current: number, total: number) => void
): Promise<ExportedPageImage[]> {
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  try {
    const source = await loadingTask.promise;
    const selectedPageNumbers = validatePageNumbers(pageNumbers, source.numPages);
    const mimeType = format === "png" ? "image/png" : "image/jpeg";
    const images: ExportedPageImage[] = [];

    for (const [index, pageNumber] of selectedPageNumbers.entries()) {
      const page = await source.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, Math.sqrt(16_000_000 / (baseViewport.width * baseViewport.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: format === "png" });
      if (!context) throw new Error(`No se pudo preparar la página ${pageNumber} como imagen.`);

      try {
        if (format === "jpg") {
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) => result
              ? resolve(result)
              : reject(new Error(`No se pudo exportar la página ${pageNumber} como imagen.`)),
            mimeType,
            format === "jpg" ? 0.92 : undefined
          );
        });
        images.push({ pageNumber, bytes: new Uint8Array(await blob.arrayBuffer()) });
      } finally {
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
      }
      onProgress?.(index + 1, selectedPageNumbers.length);
    }

    return images;
  } finally {
    await loadingTask.destroy();
  }
}

export async function mergePdfs(
  documents: { bytes: Uint8Array; name: string }[],
  onProgress?: (current: number, total: number) => void
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  for (const [index, document] of documents.entries()) {
    try {
      const source = await loadPdf(document.bytes);
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`No se pudo procesar "${document.name}": ${message}`);
    }
    onProgress?.(index + 1, documents.length);
  }

  return savePdf(merged, { useObjectStreams: true });
}

export async function compressPdf(
  bytes: Uint8Array,
  level: PdfCompressionLevel,
  onProgress?: (current: number, total: number) => void
): Promise<Uint8Array> {
  const settings = compressionSettings[level];
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });

  try {
    const source = await loadingTask.promise;
    const compressed = await PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      const sourcePage = await source.getPage(pageNumber);
      const baseViewport = sourcePage.getViewport({ scale: 1 });
      const requestedScale = settings.dpi / 72;
      const pixelLimitScale = Math.sqrt(16_000_000 / (baseViewport.width * baseViewport.height));
      const scale = Math.min(requestedScale, pixelLimitScale);
      const viewport = sourcePage.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("No se pudo preparar la imagen de una página.");

      try {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await sourcePage.render({ canvas, canvasContext: context, viewport }).promise;
        const imageBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error("No se pudo comprimir la imagen de una página.")),
            "image/jpeg",
            settings.quality
          );
        });
        const image = await compressed.embedJpg(await imageBlob.arrayBuffer());
        const pageWidth = viewport.width / scale;
        const pageHeight = viewport.height / scale;
        compressed.addPage([pageWidth, pageHeight]).drawImage(image, {
          x: 0,
          y: 0,
          width: pageWidth,
          height: pageHeight,
        });
      } finally {
        sourcePage.cleanup();
        canvas.width = 0;
        canvas.height = 0;
      }

      onProgress?.(pageNumber, source.numPages);
    }

    return compressed.save({ useObjectStreams: true, objectsPerTick: 50 });
  } finally {
    await loadingTask.destroy();
  }
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnnotationPosition {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfAnnotation =
  | (AnnotationPosition & { kind: "text"; text: string; coverRects?: NormalizedRect[] })
  | (AnnotationPosition & { kind: "signature"; dataUrl: string })
  | (AnnotationPosition & { kind: "highlight" });

export async function applyAnnotationsToPdf(
  bytes: Uint8Array,
  annotations: PdfAnnotation[]
): Promise<Uint8Array> {
  if (!annotations.length) return bytes;
  const pdf = await loadPdf(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const annotation of annotations) {
    if (annotation.pageNumber < 1 || annotation.pageNumber > pdf.getPageCount()) continue;
    const page = pdf.getPage(annotation.pageNumber - 1);
    const { width, height } = page.getSize();

    if (annotation.kind === "highlight") {
      page.drawRectangle({
        x: annotation.x * width,
        y: height - (annotation.y + annotation.height) * height,
        width: annotation.width * width,
        height: annotation.height * height,
        color: rgb(1, 0.88, 0.18),
        opacity: 0.38,
      });
    } else if (annotation.kind === "signature") {
      const signature = await pdf.embedPng(annotation.dataUrl);
      page.drawImage(signature, {
        x: annotation.x * width,
        y: height - (annotation.y + annotation.height) * height,
        width: annotation.width * width,
        height: annotation.height * height,
      });
    } else {
      for (const rectangle of annotation.coverRects || []) {
        page.drawRectangle({
          x: Math.max(0, rectangle.x * width - 1),
          y: height - (rectangle.y + rectangle.height) * height - 1,
          width: Math.min(width, rectangle.width * width + 2),
          height: rectangle.height * height + 2,
          color: rgb(1, 1, 1),
        });
      }
      const fontSize = Math.max(8, Math.min(24, annotation.height * height * 0.82));
      page.drawText(annotation.text, {
        x: annotation.x * width,
        y: height - annotation.y * height - fontSize * 0.82,
        size: fontSize,
        font,
        color: rgb(0.12, 0.15, 0.15),
        maxWidth: Math.max(40, annotation.width * width),
      });
    }
  }

  return savePdf(pdf);
}

export async function addTextToPage(
  bytes: Uint8Array,
  pageNumber: number,
  xRatio: number,
  yRatio: number,
  text: string
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const page = pdf.getPage(pageNumber - 1);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(text, {
    x: xRatio * width,
    y: height - yRatio * height,
    size: 14,
    font,
    color: rgb(0.12, 0.15, 0.15),
    maxWidth: Math.max(40, width - xRatio * width - 18),
  });
  return savePdf(pdf);
}

export async function replaceSelectedText(
  bytes: Uint8Array,
  pageNumber: number,
  rectangles: NormalizedRect[],
  text: string
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const page = pdf.getPage(pageNumber - 1);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const rectangle of rectangles) {
    page.drawRectangle({
      x: Math.max(0, rectangle.x * width - 1),
      y: height - (rectangle.y + rectangle.height) * height - 1,
      width: Math.min(width, rectangle.width * width + 2),
      height: rectangle.height * height + 2,
      color: rgb(1, 1, 1),
    });
  }
  const first = rectangles[0];
  if (first) {
    const fontSize = Math.max(8, Math.min(24, first.height * height * 0.82));
    page.drawText(text, {
      x: first.x * width,
      y: height - first.y * height - fontSize * 0.82,
      size: fontSize,
      font,
      color: rgb(0.12, 0.15, 0.15),
      maxWidth: Math.max(40, width - first.x * width - 18),
    });
  }
  return savePdf(pdf);
}

export async function addSignatureToPage(
  bytes: Uint8Array,
  pageNumber: number,
  xRatio: number,
  yRatio: number,
  signatureDataUrl: string
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const page = pdf.getPage(pageNumber - 1);
  const { width, height } = page.getSize();
  const signature = await pdf.embedPng(signatureDataUrl);
  const dimensions = signature.scale(Math.min(180 / signature.width, 64 / signature.height, 1));
  page.drawImage(signature, {
    x: xRatio * width,
    y: height - yRatio * height - dimensions.height,
    ...dimensions,
  });
  return savePdf(pdf);
}

export async function highlightPageText(
  bytes: Uint8Array,
  pageNumber: number,
  rectangles: NormalizedRect[]
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const page = pdf.getPage(pageNumber - 1);
  const { width, height } = page.getSize();
  for (const rectangle of rectangles) {
    page.drawRectangle({
      x: rectangle.x * width,
      y: height - (rectangle.y + rectangle.height) * height,
      width: rectangle.width * width,
      height: rectangle.height * height,
      color: rgb(1, 0.88, 0.18),
      opacity: 0.38,
    });
  }
  return savePdf(pdf);
}

/**
 * Comprueba si un archivo tiene extensión PDF.
 */
export function isPdfFile(filePath: string): boolean {
  return filePath
    .toLowerCase()
    .endsWith(".pdf");
}