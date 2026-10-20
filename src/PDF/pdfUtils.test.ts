import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  addTextToPage,
  applyAnnotationsToPdf,
  applyPageAction,
  getPageCount,
  highlightPageText,
  isPdfFile,
  mergePdfs,
  movePageTo,
} from "./pdfUtils";

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
