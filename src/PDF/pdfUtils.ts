import { PDFDocument, degrees } from "pdf-lib";

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
  documents: Uint8Array[]
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  for (const bytes of documents) {
    const source = await loadPdf(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  return savePdf(merged, { useObjectStreams: true });
}

export async function optimizePdf(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  return savePdf(pdf, { useObjectStreams: true, objectsPerTick: 50 });
}

/**
 * Comprueba si un archivo tiene extensión PDF.
 */
export function isPdfFile(filePath: string): boolean {
  return filePath
    .toLowerCase()
    .endsWith(".pdf");
}