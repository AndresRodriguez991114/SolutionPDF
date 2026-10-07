import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export type PageAction =
  | "rotate-left"
  | "rotate-right"
  | "move-up"
  | "move-down"
  | "delete";

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
    !Number.isInteger(fromPageNumber) ||
    !Number.isInteger(toPageNumber) ||
    fromPageNumber < 1 ||
    fromPageNumber > pageCount ||
    toPageNumber < 1 ||
    toPageNumber > pageCount
  ) {
    throw new Error("La página de origen o destino no es válida.");
  }
  if (fromPageNumber === toPageNumber) return bytes;

  const order = Array.from({ length: pageCount }, (_, index) => index);
  const [movedPage] = order.splice(fromPageNumber - 1, 1);
  order.splice(toPageNumber - 1, 0, movedPage);

  return savePdf(await reorderPages(pdf, order));
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

export async function optimizePdf(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  return savePdf(pdf, { useObjectStreams: true, objectsPerTick: 50 });
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