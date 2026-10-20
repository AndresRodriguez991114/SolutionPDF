import { describe, expect, it } from "vitest";
import { buildLines, groupIntoParagraphs, resolveFontName } from "./wordLayout";

const item = (str: string, x: number, y: number, extra: Partial<{ width: number; size: number; bold: boolean }> = {}) => ({
  str,
  x,
  y,
  width: extra.width ?? 40,
  size: extra.size ?? 10,
  bold: extra.bold ?? false,
  italic: false,
  font: "Arial",
});

const text = (paragraph: { lines: Array<{ runs: Array<{ text: string }> }> }) =>
  paragraph.lines.map((line) => line.runs.map((run) => run.text).join("")).join(" ");

describe("buildLines", () => {
  it("ordena los fragmentos de una línea y conserva el estilo por tramo", () => {
    const lines = buildLines([
      item("mundo", 60, 700),
      item("Hola", 10, 700, { bold: true }),
      item("otra", 10, 600),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].runs.map((run) => [run.text, run.bold])).toEqual([["Hola", true], [" mundo", false]]);
  });

  it("ignora líneas que solo tienen espacios", () => {
    expect(buildLines([item("  ", 0, 10)])).toEqual([]);
  });
});

describe("columnas en la misma línea", () => {
  it("marca con tabulador el tramo separado por un hueco grande (pie de página)", () => {
    const lines = buildLines([
      item("Organización - Confidencial", 10, 30, { width: 150 }),
      item("Página 1 de 7", 500, 30, { width: 60 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].runs.map((run) => [run.text, run.tab])).toEqual([
      ["Organización - Confidencial", false],
      ["Página 1 de 7", true],
    ]);
    expect(groupIntoParagraphs(lines)).toHaveLength(1);
  });

  it("no mezcla una línea con columnas con la línea siguiente", () => {
    const lines = buildLines([
      item("A", 10, 100, { width: 300 }),
      item("B", 500, 100, { width: 50 }),
      item("texto", 10, 88, { width: 300 }),
    ]);
    expect(groupIntoParagraphs(lines)).toHaveLength(2);
  });
});

describe("groupIntoParagraphs", () => {
  it("separa líneas cortas, viñetas y huecos verticales", () => {
    const lines = buildLines([
      item("Autor: Ana", 10, 700, { width: 60 }),
      item("Fecha: hoy", 10, 688, { width: 60 }),
      item("Texto largo línea uno", 10, 650, { width: 300 }),
      item("continúa en línea dos", 10, 638, { width: 300 }),
      item("• Viñeta", 10, 620, { width: 300 }),
    ]);
    expect(groupIntoParagraphs(lines).map(text)).toEqual([
      "Autor: Ana",
      "Fecha: hoy",
      "Texto largo línea uno continúa en línea dos",
      "• Viñeta",
    ]);
  });
});

describe("resolveFontName", () => {
  it("normaliza nombres incrustados y usa la familia genérica como respaldo", () => {
    expect(resolveFontName("ABCDEF+Arial-BoldMT", "sans-serif")).toBe("Arial");
    expect(resolveFontName("Times-Roman", undefined)).toBe("Times New Roman");
    expect(resolveFontName("g_d0_f1", "serif")).toBe("Times New Roman");
    expect(resolveFontName(undefined, "monospace")).toBe("Courier New");
  });
});
