import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  addTextToPage,
  applyAnnotationsToPdf,
  applyPageAction,
  deletePages,
  extractPages,
  movePagesTo,
  parsePageRanges,
  getPageCount,
  highlightPageText,
  isPdfFile,
  mergePdfs,
  movePageTo,
  rotatePages,
  splitPdfByRanges,
  splitPdfIntoPages,
} from "./pdfUtils";
import { updateThumbnailSelection } from "./pageSelection";

describe("thumbnail selection", () => {
  it("selects a single page and uses it as the range anchor", () => {
    const result = updateThumbnailSelection(new Set([1, 3]), 4, 1, {
      shiftKey: false,
      additive: false,
    });

    expect([...result.selectedPages]).toEqual([4]);
    expect(result.anchorPageNumber).toBe(4);
  });

  it("toggles pages with additive selection", () => {
    const selected = updateThumbnailSelection(new Set([2, 4]), 2, 4, {
      shiftKey: false,
      additive: true,
    });

    expect([...selected.selectedPages]).toEqual([4]);
    expect(selected.anchorPageNumber).toBe(2);
  });

  it("selects an inclusive range from the anchor in either direction", () => {
    const result = updateThumbnailSelection(new Set([1]), 2, 4, {
      shiftKey: true,
      additive: false,
    });

    expect([...result.selectedPages]).toEqual([2, 3, 4]);
    expect(result.anchorPageNumber).toBe(4);
  });

  it("adds a range to the existing selection with Shift and Ctrl/Cmd", () => {
    const result = updateThumbnailSelection(new Set([1, 5]), 3, 2, {
      shiftKey: true,
      additive: true,
    });

    expect([...result.selectedPages]).toEqual([1, 5, 2, 3]);
  });
});

async function createPdf(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([300 + index, 400 + index]);
  }
  return pdf.save();
}

describe("pdfUtils", () => {
  it("detects PDF paths case-insensitively", () => {
    expect(isPdfFile("documento.PDF")).toBe(true);
    expect(isPdfFile("documento.txt")).toBe(false);
  });

  it("removes a page without allowing a document with zero pages", async () => {
    const source = await createPdf(2);
    const result = await applyPageAction(source, "delete", 2);

    expect(getPageCount(await PDFDocument.load(result))).toBe(1);
    await expect(applyPageAction(result, "delete", 1)).rejects.toThrow(
      "El PDF debe conservar al menos una página."
    );
  });

  it("moves pages and rejects invalid page numbers", async () => {
    const source = await createPdf(3);
    const moved = await movePageTo(source, 1, 3);
    const movedPdf = await PDFDocument.load(moved);

    expect(movedPdf.getPage(0).getWidth()).toBe(301);
    expect(movedPdf.getPage(2).getWidth()).toBe(300);
    await expect(movePageTo(source, 0, 2)).rejects.toThrow(
      "La página de origen o destino no es válida."
    );
  });

  it("moves selected pages together while preserving their order", async () => {
    const source = await createPdf(5);
    const moved = await movePagesTo(source, [2, 4], 5);
    const pdf = await PDFDocument.load(moved);

    expect(pdf.getPages().map((page) => page.getWidth())).toEqual([300, 302, 304, 301, 303]);
    await expect(movePagesTo(source, [0], 2)).rejects.toThrow(
      "La selección contiene páginas no válidas."
    );
  });

  it("deletes selected pages in one operation and preserves one page", async () => {
    const source = await createPdf(4);
    const deleted = await deletePages(source, [2, 4]);
    const pdf = await PDFDocument.load(deleted);

    expect(pdf.getPages().map((page) => page.getWidth())).toEqual([300, 302]);
    await expect(deletePages(source, [1, 2, 3, 4])).rejects.toThrow(
      "El PDF debe conservar al menos una página."
    );
  });

  it("extracts selected pages in document order", async () => {
    const source = await createPdf(4);
    const extracted = await extractPages(source, [4, 2]);
    const pdf = await PDFDocument.load(extracted);

    expect(pdf.getPages().map((page) => page.getWidth())).toEqual([301, 303]);
  });

  it("parses and validates page ranges", () => {
    expect(parsePageRanges("1-3, 5, 7-8", 8)).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 7, end: 8 },
    ]);
    expect(() => parsePageRanges("1-3, 3-4", 8)).toThrow("aparece en más de un rango");
    expect(() => parsePageRanges("4-2", 8)).toThrow("debe ir de menor a mayor");
    expect(() => parsePageRanges("1, 9", 8)).toThrow("entre 1 y 8");
  });

  it("splits PDFs by ranges or into one file per page", async () => {
    const source = await createPdf(4);
    const parts = await splitPdfByRanges(source, parsePageRanges("1-2, 4", 4));
    expect(await Promise.all(parts.map(async (part) =>
      getPageCount(await PDFDocument.load(part))
    ))).toEqual([2, 1]);

    const pages = await splitPdfIntoPages(source);
    expect(await Promise.all(pages.map(async (page) =>
      getPageCount(await PDFDocument.load(page))
    ))).toEqual([1, 1, 1, 1]);
  });

  it("merges PDFs and reports progress for each input", async () => {
    const progress: Array<[number, number]> = [];
    const result = await mergePdfs(
      [
        { bytes: await createPdf(1), name: "uno.pdf" },
        { bytes: await createPdf(2), name: "dos.pdf" },
      ],
      (current, total) => progress.push([current, total])
    );

    expect(getPageCount(await PDFDocument.load(result))).toBe(3);
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });

  it("rotates a page without changing the page count", async () => {
    const source = await createPdf(1);
    const result = await applyPageAction(source, "rotate-right", 1);
    const pdf = await PDFDocument.load(result);

    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getRotation().angle).toBe(90);
  });

  it("rotates multiple selected pages in one PDF operation", async () => {
    const source = await createPdf(4);
    const result = await rotatePages(source, [4, 2, 2], "left");
    const pdf = await PDFDocument.load(result);

    expect(pdf.getPages().map((page) => page.getRotation().angle)).toEqual([0, -90, 0, -90]);
  });

  it("rejects empty or invalid page selections when rotating", async () => {
    const source = await createPdf(2);

    await expect(rotatePages(source, [], "right")).rejects.toThrow(
      "La selección contiene páginas no válidas."
    );
    await expect(rotatePages(source, [1, 3], "right")).rejects.toThrow(
      "La selección contiene páginas no válidas."
    );
  });

  it("applies text and highlight annotations to the output PDF", async () => {
    const source = await createPdf(1);
    const annotated = await applyAnnotationsToPdf(source, [
      {
        id: "text-1",
        kind: "text",
        pageNumber: 1,
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.08,
        text: "Texto de prueba",
      },
      {
        id: "highlight-1",
        kind: "highlight",
        pageNumber: 1,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.05,
      },
    ]);

    expect(getPageCount(await PDFDocument.load(annotated))).toBe(1);
  });

  it("adds text and highlights selected page areas", async () => {
    const source = await createPdf(1);
    const withText = await addTextToPage(source, 1, 0.1, 0.2, "Texto agregado");
    const withHighlight = await highlightPageText(withText, 1, [
      { x: 0.1, y: 0.3, width: 0.25, height: 0.04 },
    ]);

    expect(getPageCount(await PDFDocument.load(withHighlight))).toBe(1);
  });
});
