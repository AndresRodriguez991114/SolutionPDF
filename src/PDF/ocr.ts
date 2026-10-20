import { createWorker } from "tesseract.js";

import type { RawItem } from "./wordLayout";

let workerPromise: Promise<Tesseract.Worker> | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    const origin = window.location.origin;
    workerPromise = createWorker("spa", 1, {
      workerPath: `${origin}/tesseract/worker.min.js`,
      corePath: `${origin}/tesseract/tesseract-core-simd-lstm.wasm.js`,
      langPath: `${origin}/tesseract/lang`,
      gzip: false,
      logger: () => undefined,
    }).then(async (worker) => {
      await worker.setParameters({
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return worker;
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function recognizeOcrItems(
  canvas: HTMLCanvasElement,
  pageWidth: number,
  pageHeight: number,
  signal?: AbortSignal
): Promise<RawItem[]> {
  if (signal?.aborted) return [];
  try {
    const worker = await getWorker();
    if (signal?.aborted) return [];
    const result = await worker.recognize(canvas, {}, { blocks: true });
    if (signal?.aborted) return [];

    const blocks = result.data.blocks ?? [];
    const scale = canvas.width / pageWidth;
    const items: RawItem[] = [];

    for (const block of blocks) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const lineHeight = Math.max(1, (line.bbox.y1 - line.bbox.y0) / scale);
          const size = Math.max(6, lineHeight * 0.85);
          for (const word of line.words) {
            const text = word.text?.trim();
            if (!text) continue;
            const width = Math.max(1, (word.bbox.x1 - word.bbox.x0) / scale);
            items.push({
              str: text,
              x: word.bbox.x0 / scale,
              y: pageHeight - (word.bbox.y1 / scale) + lineHeight * 0.22,
              width,
              size,
              bold: false,
              italic: false,
              font: "Arial",
              color: "000000",
            });
          }
        }
      }
    }

    return items;
  } catch (error) {
    console.warn("SolutionsPDF: OCR no disponible para esta página", error);
    return [];
  }
}
