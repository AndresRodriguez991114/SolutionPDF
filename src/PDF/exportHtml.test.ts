import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  cleanup: vi.fn(),
  destroy: vi.fn(),
  recognize: vi.fn(),
  render: vi.fn(),
  textItems: [] as unknown[],
  annotations: [] as unknown[],
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

import { escapeHtml, exportPdfToHtml, safeUrl } from "./exportHtml";

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

describe("exportPdfToHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvases();
    mocks.render.mockReturnValue({ promise: Promise.resolve() });
    mocks.annotations = [];
    mocks.textItems = [
      { str: "Hola <mundo> & \"amigos\"", fontName: "font1", width: 80, height: 12, transform: [12, 0, 0, 12, 60, 156] },
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
      getAnnotations: async () => mocks.annotations,
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

  it("escapa el contenido y solo permite enlaces seguros", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("no es url")).toBeUndefined();
  });

  it("en modo fiel genera una sección por página con fondo y texto posicionado", async () => {
    const progress: Array<[number, number]> = [];
    const result = await exportPdfToHtml(new Uint8Array([1]), {
      mode: "faithful",
      onProgress: (current, total) => progress.push([current, total]),
    });

    expect(result.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(result.html.match(/<section class="page"/g)).toHaveLength(2);
    expect(result.html).toContain("data:image/png;base64,");
    expect(result.html).toContain("Hola &lt;mundo&gt; &amp; &quot;amigos&quot;");
    expect(result.html).not.toContain("<mundo>");
    expect(result.html).toContain("<script>");
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("coloca el texto en la posición vertical correcta (de arriba hacia abajo)", async () => {
    const { html } = await exportPdfToHtml(new Uint8Array([1]), { mode: "faithful", pageNumbers: [1] });

    // Línea base a 156 pt del borde inferior (≈15 % de la altura): el texto queda en la zona inferior.
    const top = Number(/top:([\d.]+)%/.exec(html)?.[1]);
    expect(top).toBeGreaterThan(70);
    expect(top).toBeLessThan(90);
  });

  it("en modo limpio genera HTML semántico sin script ni imágenes", async () => {
    const { html } = await exportPdfToHtml(new Uint8Array([1]), { mode: "semantic", pageNumbers: [1] });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("Hola &lt;mundo&gt;");
    expect(html).toContain("<p>");
  });

  it("en un PDF escaneado usa OCR para crear texto seleccionable", async () => {
    mocks.textItems = [];
    mocks.recognize.mockResolvedValue([
      { str: "Reconocido", x: 50, y: 100, width: 80, size: 12, bold: false, italic: false, font: "Arial", color: "000000" },
    ]);

    const result = await exportPdfToHtml(new Uint8Array([1]), { mode: "faithful", enableOcr: true });

    expect(result.pagesWithoutText).toEqual([1, 2]);
    expect(result.ocrPages).toEqual([1, 2]);
    expect(result.html).toContain("Reconocido");
  });

  it("descarta enlaces peligrosos", async () => {
    mocks.annotations = [{ subtype: "Link", url: "javascript:alert(1)", rect: [0, 0, 900, 1100] }];
    const { html } = await exportPdfToHtml(new Uint8Array([1]), { mode: "faithful", pageNumbers: [1] });

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });

  it("rechaza una exportación cancelada antes de empezar", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(exportPdfToHtml(new Uint8Array([1]), { mode: "faithful", signal: controller.signal }))
      .rejects.toThrow("Exportación a HTML cancelada");
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
});
