import ExcelJS from "exceljs";
import { Buffer } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  cleanup: vi.fn(),
  destroy: vi.fn(),
  annotations: [] as unknown[],
  fontName: null as string | null,
}));

vi.mock("react-pdf", () => ({
  pdfjs: {
    getDocument: mocks.getDocument,
    Util: {
      transform: (first: number[], second: number[]) => [
        first[0] * second[0] + first[2] * second[1],
        first[1] * second[0] + first[3] * second[1],
        first[0] * second[2] + first[2] * second[3],
        first[1] * second[2] + first[3] * second[3],
        first[0] * second[4] + first[2] * second[5] + first[4],
        first[1] * second[4] + first[3] * second[5] + first[5],
      ],
    },
  },
}));

import { exportPdfToExcel } from "./exportExcel";

describe("exportPdfToExcel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.annotations = [];
    mocks.fontName = null;
    const page = {
      getViewport: () => ({
        width: 600,
        height: 800,
        transform: [1, 0, 0, -1, 0, 800],
        convertToViewportRectangle: (rect: number[]) => [rect[0], 800 - rect[1], rect[2], 800 - rect[3]],
      }),
      getTextContent: async () => ({
        styles: {},
        items: [
          { str: "Producto", fontName: "Arial", width: 55, height: 10, transform: [10, 0, 0, 10, 10, 700] },
          { str: "Cantidad", fontName: "Arial", width: 58, height: 10, transform: [10, 0, 0, 10, 200, 700] },
          { str: "Lápiz", fontName: "Arial", width: 24, height: 10, transform: [10, 0, 0, 10, 10, 682] },
          { str: "12,50", fontName: "Arial", width: 22, height: 10, transform: [10, 0, 0, 10, 200, 682] },
          { str: "Más información", fontName: "Arial", width: 70, height: 10, transform: [10, 0, 0, 10, 10, 640] },
        ],
      }),
      getAnnotations: async () => mocks.annotations,
      commonObjs: {
        has: () => mocks.fontName !== null,
        get: () => ({ name: mocks.fontName }),
      },
      cleanup: mocks.cleanup,
    };
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page }),
      destroy: mocks.destroy,
    });
  });

  it("genera un libro XLSX con celdas reconstruidas, tabla filtrable y una hoja por página", async () => {
    const result = await exportPdfToExcel(new Uint8Array([1]));
    const workbook = new ExcelJS.Workbook();
    const workbookBytes = Buffer.from(result.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(workbookBytes);
    const sheet = workbook.getWorksheet("Página 1");

    expect(sheet).toBeTruthy();
    expect(sheet?.getCell("A1").value).toBe("Página 1");
    expect(sheet?.getCell("A2").value).toBe("Producto");
    expect(sheet?.getCell("B2").value).toBe("Cantidad");
    expect(sheet?.getCell("B3").value).toBe(12.5);
    expect(sheet?.getCell("B3").numFmt).toBe("#,##0.00");
    expect(sheet?.getTable("PDFPage1Table1")).toBeTruthy();
    expect(result.detectedTablePages).toEqual([1]);
    expect(result.pagesWithoutText).toEqual([]);
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("retains safe PDF hyperlinks and reports unknown source fonts", async () => {
    mocks.annotations = [{ url: "https://example.com/report", rect: [10, 630, 100, 655] }];
    mocks.fontName = "UnlistedReportFont";

    const result = await exportPdfToExcel(new Uint8Array([1]));
    const workbook = new ExcelJS.Workbook();
    const workbookBytes = Buffer.from(result.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(workbookBytes);
    const sheet = workbook.getWorksheet("Página 1");

    expect(sheet?.getCell("A4").value).toMatchObject({
      text: "Más información",
      hyperlink: "https://example.com/report",
    });
    expect(result.substitutedFonts).toContain("UnlistedReportFont");
  });

  it("rechaza una exportación cancelada antes de empezar", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(exportPdfToExcel(new Uint8Array([1]), { signal: controller.signal }))
      .rejects.toThrow("Exportación a Excel cancelada");
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
});
