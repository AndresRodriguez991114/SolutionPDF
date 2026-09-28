import { PDFDocument, degrees } from "pdf-lib";

/**
 * Lee un archivo PDF desde una ruta local.
 */
export async function loadPdf(filePath: string): Promise<PDFDocument> {
  const response = await fetch(filePath);
  const arrayBuffer = await response.arrayBuffer();

  return PDFDocument.load(arrayBuffer);
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
  pdf: PDFDocument
): Promise<Uint8Array> {
  return await pdf.save();
}

/**
 * Comprueba si un archivo tiene extensión PDF.
 */
export function isPdfFile(filePath: string): boolean {
  return filePath
    .toLowerCase()
    .endsWith(".pdf");
}