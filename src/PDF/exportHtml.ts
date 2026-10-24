import { pdfjs } from "react-pdf";

import {
  canvasToData,
  colorNativeText,
  eraseOcrText,
  extractText,
  releaseCanvas,
  renderPage,
  textOperatorIndexes,
} from "./exportPowerPoint";
import { recognizeOcrItems } from "./ocr";
import {
  buildPageModel,
  cellsOf,
  genericFamily,
  resolveDocument,
  resolveFont,
  type Block,
  type LineInfo,
  type RawItem,
  type TextRunInfo,
} from "./wordLayout";

export type HtmlExportMode = "faithful" | "semantic";
export type HtmlExportQuality = "high" | "medium" | "low";

export interface HtmlExportOptions {
  mode: HtmlExportMode;
  pageNumbers?: number[];
  quality?: HtmlExportQuality;
  enableOcr?: boolean;
  title?: string;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

export interface HtmlExportResult {
  html: string;
  pagesWithoutText: number[];
  ocrPages: number[];
}

const QUALITY: Record<HtmlExportQuality, { scale: number; format: "png" | "jpeg"; jpeg: number; maxPixels: number }> = {
  high: { scale: 2, format: "png", jpeg: 1, maxPixels: 12_000_000 },
  medium: { scale: 1.75, format: "jpeg", jpeg: 0.8, maxPixels: 12_000_000 },
  low: { scale: 1.25, format: "jpeg", jpeg: 0.6, maxPixels: 12_000_000 },
};

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Exportación a HTML cancelada por el usuario.");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const safeColor = (color: string | undefined) => (color && /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#000000");

function fontStack(font: string | undefined): string {
  const generic = genericFamily(font) ?? "sans-serif";
  const first = (font ?? "").split(",")[0].replace(/['"]/g, "").trim();
  const name = resolveFont(first, generic).name.replace(/[^\w \-]/g, "");
  return `'${name}',${generic}`;
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

async function annotateLinks(page: any, items: RawItem[]): Promise<void> {
  let annotations: any[] = [];
  try {
    annotations = await page.getAnnotations({ intent: "display" });
  } catch {
    return;
  }
  const viewport = page.getViewport({ scale: 1 });
  const areas = annotations
    .filter((annotation) => annotation?.subtype === "Link" && Array.isArray(annotation.rect))
    .map((annotation) => ({ url: safeUrl(annotation.url ?? annotation.unsafeUrl), rect: annotation.rect as number[] }))
    .filter((area) => area.url);
  if (areas.length === 0 || typeof viewport.convertToViewportRectangle !== "function") return;
  const boxes = areas.map((area) => {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(area.rect) as number[];
    return { url: area.url as string, left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) };
  });
  for (const item of items) {
    const centerX = item.x + item.width / 2;
    const centerY = viewport.height - item.y - item.size * 0.3;
    const hit = boxes.find((box) => centerX >= box.left && centerX <= box.right && centerY >= box.top && centerY <= box.bottom);
    if (hit) item.link = hit.url;
  }
}

function faithfulPage(
  pageNumber: number,
  width: number,
  height: number,
  items: RawItem[],
  image: string
): string {
  const spans = items
    .filter((item) => item.str.length > 0 && item.str.trim().length > 0)
    .map((item) => {
      const left = round((item.x / width) * 100);
      const top = round(((height - item.y - item.size * 0.85) / height) * 100);
      const size = round((item.size / width) * 100);
      const itemWidth = round((item.width / width) * 100);
      const style = [
        `left:${left}%`,
        `top:${top}%`,
        `font-size:${size}cqw`,
        `font-family:${fontStack(item.font)}`,
        `color:${safeColor(item.color)}`,
        item.bold ? "font-weight:700" : "",
        item.italic ? "font-style:italic" : "",
      ].filter(Boolean).join(";");
      const text = escapeHtml(item.str);
      const href = safeUrl(item.link);
      const inner = href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
      return `<span style="${style}" data-w="${itemWidth}">${inner}</span>`;
    })
    .join("\n");
  return `<section class="page" id="pagina-${pageNumber}" aria-label="Página ${pageNumber}" style="aspect-ratio:${round(width, 2)}/${round(height, 2)}">
<img src="data:${image}" alt="" draggable="false">
${spans}
</section>`;
}

function runHtml(run: TextRunInfo): string {
  let html = escapeHtml(run.text);
  if (run.script === "sup") html = `<sup>${html}</sup>`;
  else if (run.script === "sub") html = `<sub>${html}</sub>`;
  if (run.bold) html = `<strong>${html}</strong>`;
  if (run.italic) html = `<em>${html}</em>`;
  if (run.underline) html = `<u>${html}</u>`;
  if (run.strike) html = `<s>${html}</s>`;
  const color = safeColor(run.color);
  if (color !== "#000000") html = `<span style="color:${color}">${html}</span>`;
  const href = safeUrl(run.link);
  if (href) html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
  return html;
}

const linesHtml = (lines: LineInfo[]) =>
  lines.map((line) => line.runs.map(runHtml).join("")).join(" ").replace(/\s+/g, " ").trim();

function blocksHtml(blocks: Block[]): string {
  const out: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${item}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const block of blocks) {
    if (block.type === "table") {
      flushList();
      const rows = block.rows.map((row) => {
        const cells = cellsOf(row).map((cell) => `<td>${cell.runs.map(runHtml).join("")}</td>`).join("");
        return `<tr>${cells}</tr>`;
      }).join("");
      out.push(`<div class="table-wrap"><table><tbody>${rows}</tbody></table></div>`);
      continue;
    }
    const { paragraph } = block;
    const text = linesHtml(paragraph.lines);
    if (!text) continue;
    const kind = paragraph.kind;
    if (kind?.type === "bullet" || kind?.type === "number") {
      const tag = kind.type === "bullet" ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push(text.replace(/^(?:<[^>]+>)*(?:[•·▪◦●■‣▸►*-]|\d{1,3}[.)])\s+/, ""));
      continue;
    }
    flushList();
    if (kind?.type === "heading") {
      const level = Math.min(6, Math.max(1, kind.level));
      out.push(`<h${level}>${text}</h${level}>`);
    } else {
      out.push(`<p>${text}</p>`);
    }
  }
  flushList();
  return out.join("\n");
}

const FAITHFUL_CSS = `
body{margin:0;background:#e9ecef;font-family:system-ui,sans-serif}
main{display:flex;flex-direction:column;align-items:center;gap:20px;padding:20px 12px}
.page{position:relative;width:min(100%,1000px);background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.25);overflow:hidden;container-type:inline-size}
.page>img{position:absolute;inset:0;width:100%;height:100%;user-select:none;pointer-events:none}
.page>span{position:absolute;white-space:pre;line-height:1;transform-origin:left top;cursor:text}
.page a{color:inherit;text-decoration:underline}
@media print{body{background:#fff}main{padding:0;gap:0}.page{width:100%;box-shadow:none;break-after:page}}
`;

const SEMANTIC_CSS = `
body{margin:0;background:#f5f6f8;color:#1c1f24;font:16px/1.65 system-ui,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 20px;background:#fff}
section.page{padding:8px 0 28px;border-bottom:1px solid #dde1e6}
section.page:last-child{border-bottom:0}
h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.4em 0 .5em}
p{margin:.7em 0}
a{color:#0b5fd6}
.table-wrap{overflow-x:auto;margin:1em 0}
table{border-collapse:collapse;width:100%}
td{border:1px solid #c8cdd3;padding:6px 10px;vertical-align:top}
.page-label{font-size:.75rem;color:#6b7280;text-transform:uppercase;letter-spacing:.06em}
@media print{body{background:#fff}main{max-width:none;padding:0}section.page{break-after:page}}
`;

// Ajusta el ancho de cada texto al original aunque el navegador sustituya la fuente.
const FIT_SCRIPT = `(function(){function fit(){document.querySelectorAll('.page').forEach(function(p){var w=p.clientWidth;p.querySelectorAll('span[data-w]').forEach(function(s){s.style.transform='';var t=parseFloat(s.getAttribute('data-w'))/100*w,a=s.offsetWidth;if(a>0&&t>0){var r=Math.max(.5,Math.min(1.6,t/a));if(Math.abs(r-1)>.01)s.style.transform='scaleX('+r+')'}})})}
window.addEventListener('load',fit);window.addEventListener('resize',fit);window.addEventListener('beforeprint',fit);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit)})();`;

export async function exportPdfToHtml(bytes: Uint8Array, options: HtmlExportOptions): Promise<HtmlExportResult> {
  abortIfNeeded(options.signal);
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
  try {
    const source = await loadingTask.promise;
    const pages = options.pageNumbers && options.pageNumbers.length > 0
      ? [...new Set(options.pageNumbers)].filter((page) => page >= 1 && page <= source.numPages).sort((a, b) => a - b)
      : Array.from({ length: source.numPages }, (_, index) => index + 1);
    if (pages.length === 0) throw new Error("No hay páginas para exportar.");

    const quality = QUALITY[options.quality ?? "high"];
    const pagesWithoutText: number[] = [];
    const ocrPages: number[] = [];
    const sections: string[] = [];
    const models: ReturnType<typeof buildPageModel>[] = [];

    for (const [index, pageNumber] of pages.entries()) {
      abortIfNeeded(options.signal);
      const page = await source.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      try {
        const pixelScale = Math.sqrt(quality.maxPixels / (viewport.width * viewport.height));
        let items = await extractText(page);
        await annotateLinks(page, items);
        const hasNativeText = items.length > 0;
        if (!hasNativeText) pagesWithoutText.push(pageNumber);

        if (options.mode === "semantic") {
          if (!hasNativeText && options.enableOcr) {
            const scan = await renderPage(page, Math.min(3, pixelScale));
            try {
              items = await recognizeOcrItems(scan.canvas, viewport.width, viewport.height, options.signal);
              if (items.length > 0) ocrPages.push(pageNumber);
            } finally {
              releaseCanvas(scan.canvas);
            }
          }
          models.push(buildPageModel(pageNumber, viewport.width, viewport.height, items));
        } else {
          const imageScale = Math.min(quality.scale, pixelScale);
          const backgroundScale = !hasNativeText && options.enableOcr ? Math.min(3, pixelScale) : imageScale;
          let fullCanvas: HTMLCanvasElement | null = null;
          let withoutTextCanvas: HTMLCanvasElement | null = null;
          let image: string;
          try {
            const full = await renderPage(page, backgroundScale);
            fullCanvas = full.canvas;
            let background = full.canvas;
            if (hasNativeText) {
              try {
                const indexes = await textOperatorIndexes(page);
                const withoutText = await renderPage(page, backgroundScale, (operation) => !indexes.has(operation));
                withoutTextCanvas = withoutText.canvas;
                colorNativeText(full.context, withoutText.context, items, backgroundScale);
                background = withoutText.canvas;
              } catch {
                eraseOcrText(full.context, items, backgroundScale);
              }
            } else if (options.enableOcr) {
              items = await recognizeOcrItems(full.canvas, viewport.width, viewport.height, options.signal);
              if (items.length > 0) {
                eraseOcrText(full.context, items, backgroundScale);
                ocrPages.push(pageNumber);
              }
            }
            image = await canvasToData(background, quality.format, quality.jpeg);
          } finally {
            releaseCanvas(fullCanvas);
            releaseCanvas(withoutTextCanvas);
          }
          sections.push(faithfulPage(pageNumber, viewport.width, viewport.height, items, image));
        }
      } finally {
        page.cleanup();
      }
      options.onProgress?.(index + 1, pages.length);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    abortIfNeeded(options.signal);
    if (options.mode === "semantic") {
      for (const page of resolveDocument(models)) {
        const parts = [
          blocksHtml(page.header),
          ...page.segments.flatMap((segment) =>
            segment.kind === "flow"
              ? [blocksHtml(segment.blocks)]
              : segment.columns.map((column) => blocksHtml(column.blocks))
          ),
        ].filter(Boolean);
        sections.push(`<section class="page" id="pagina-${page.pageNumber}">
<div class="page-label">Página ${page.pageNumber}</div>
${parts.join("\n")}
</section>`);
      }
    }

    const faithful = options.mode === "faithful";
    const title = escapeHtml(options.title?.trim() || "Documento exportado desde PDF");
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="generator" content="SolutionsPDF">
<title>${title}</title>
<style>${faithful ? FAITHFUL_CSS : SEMANTIC_CSS}</style>
</head>
<body>
<main>
${sections.join("\n")}
</main>
${faithful ? `<script>${FIT_SCRIPT}</script>` : ""}
</body>
</html>
`;
    return { html, pagesWithoutText, ocrPages };
  } finally {
    await loadingTask.destroy();
  }
}
