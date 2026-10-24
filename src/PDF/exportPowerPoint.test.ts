import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  cleanup: vi.fn(),
  destroy: vi.fn(),
  recognize: vi.fn(),
  render: vi.fn(),
  textItems: [] as unknown[],
}));

vi.mock("./ocr", () => ({ recognizeOcrItems: mocks.recognize }));

vi.mock("react-pdf", () => ({
  pdfjs: {
    getDocument: mocks.getDocument,
    OPS: { showText: 44, showSpacedText: 45, nextLineShowText: 46, nextLineSetSpacingShowText: 47 },
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

import { exportPdfToPowerPoint, textBoxForSlide } from "./exportPowerPoint";

const pngData = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
), (character) => character.charCodeAt(0));

function mockCanvases() {
  const createElement = window.document.createElement.bind(window.document);
  vi.spyOn(window.document, "createElement").mockImplementation((tagName, options) => {
    const element = createElement(tagName, options);
    if (tagName === "canvas") {
      const canvas = element as HTMLCanvasElement;
      vi.spyOn(canvas, "getContext").mockReturnValue({
        fillStyle: "#fff",
        canvas,
        fillRect: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray(Math.max(0, canvas.width * canvas.height * 4)).fill(255) }),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(canvas, "toBlob").mockImplementation((callback) => {
        callback(new Blob([pngData], { type: "image/png" }));
      });
    }
    return element;
  });
}

describe("exportPdfToPowerPoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvases();
    mocks.render.mockReturnValue({ promise: Promise.resolve() });
    mocks.textItems = [
      { str: "Texto editable", fontName: "font1", width: 80, height: 12, transform: [12, 0, 0, 12, 60, 900] },
    ];
    const page = {
      getViewport: () => ({
        width: 816,
        height: 1056,
        transform: [4 / 3, 0, 0, -4 / 3, 0, 1056],
      }),
      getTextContent: async () => ({
        styles: { font1: { fontFamily: "Arial" } },
        items: mocks.textItems,
      }),
      getOperatorList: async () => ({ fnArray: [1, 44, 2] }),
      render: mocks.render,
      commonObjs: { has: () => false, get: vi.fn() },
      cleanup: mocks.cleanup,
    };
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage: async () => page }),
      destroy: mocks.destroy,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts PDF text coordinates and font sizes to PowerPoint inches and points", () => {
    const position = textBoxForSlide({
      str: "Texto",
      x: 60,
      y: 156,
      width: 80,
      size: 12,
      bold: false,
      italic: false,
      font: "Arial",
      color: "000000",
    }, 816, 1056, 816 / 1056 * 7.5, 7.5);

    expect(position?.x).toBeCloseTo(0.426, 2);
    expect(position?.y).toBeCloseTo(1.023, 2);
    expect(position?.w).toBeCloseTo(0.568, 2);
    expect(position?.fontSize).toBeCloseTo(6.136, 2);
  });

  it("genera una presentación PPTX con texto editable y reporta el progreso por página", async () => {
    const progress: Array<[number, number]> = [];

    const result = await exportPdfToPowerPoint(new Uint8Array([1]), {
      mode: "editable",
      onProgress: (current, total) => progress.push([current, total]),
    });

    expect(result.bytes.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    expect(result.pagesWithoutText).toEqual([]);
    expect(result.ocrPages).toEqual([]);
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("rechaza una exportación cancelada antes de empezar", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(exportPdfToPowerPoint(new Uint8Array([1]), {
      mode: "image",
      signal: controller.signal,
    })).rejects.toThrow("Exportación a PowerPoint cancelada");
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it("genera diapositivas como imágenes sin depender del sistema de archivos", async () => {
    const result = await exportPdfToPowerPoint(new Uint8Array([1]), { mode: "image" });

    expect(result.bytes.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);
  });

  it("en modo editable conserva las imágenes renderizando el fondo sin el texto", async () => {
    await exportPdfToPowerPoint(new Uint8Array([1]), { mode: "editable" });

    // Por página: render completo + render sin operadores de texto.
    expect(mocks.render).toHaveBeenCalledTimes(4);
    const filtered = mocks.render.mock.calls.filter(([options]) => typeof options.operationsFilter === "function");
    expect(filtered).toHaveLength(2);
    expect(filtered[0][0].operationsFilter(1)).toBe(false);
    expect(filtered[0][0].operationsFilter(0)).toBe(true);
  });

  it("en un PDF escaneado usa OCR como texto y deja el resto como imagen", async () => {
    mocks.textItems = [];
    mocks.recognize.mockResolvedValue([
      { str: "Reconocido", x: 50, y: 100, width: 80, size: 12, bold: false, italic: false, font: "Arial", color: "000000" },
    ]);

    const result = await exportPdfToPowerPoint(new Uint8Array([1]), { mode: "editable", enableOcr: true });

    expect(result.pagesWithoutText).toEqual([1, 2]);
    expect(result.ocrPages).toEqual([1, 2]);
    expect(mocks.recognize).toHaveBeenCalledTimes(2);
    expect(result.bytes.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
  });

  it("en un PDF escaneado sin OCR conserva la página como imagen", async () => {
    mocks.textItems = [];

    const result = await exportPdfToPowerPoint(new Uint8Array([1]), { mode: "editable" });

    expect(result.pagesWithoutText).toEqual([1, 2]);
    expect(result.ocrPages).toEqual([]);
    expect(mocks.recognize).not.toHaveBeenCalled();
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });
});
