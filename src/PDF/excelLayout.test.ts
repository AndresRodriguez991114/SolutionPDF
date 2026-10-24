import { describe, expect, it } from "vitest";

import { buildExcelPageRows } from "./excelLayout";

describe("buildExcelPageRows", () => {
  it("detecta columnas repetidas y las conserva como tabla", () => {
    const result = buildExcelPageRows([
      { text: "Producto", x: 10, y: 100, width: 55, size: 10 },
      { text: "Cantidad", x: 200, y: 100, width: 58, size: 10 },
      { text: "Lápiz", x: 10, y: 82, width: 24, size: 10 },
      { text: "12", x: 200, y: 82, width: 9, size: 10 },
    ]);

    expect(result.detectedTable).toBe(true);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("table");
    expect(result.blocks[0].rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ["Producto", "Cantidad"],
      ["Lápiz", "12"],
    ]);
    expect(result.columnWidths).toHaveLength(2);
  });

  it("mantiene texto corrido en una sola columna cuando no parece tabla", () => {
    const result = buildExcelPageRows([
      { text: "Primera línea", x: 10, y: 100, width: 65, size: 10 },
      { text: "continúa aquí", x: 10, y: 82, width: 68, size: 10 },
    ]);

    expect(result.detectedTable).toBe(false);
    expect(result.blocks).toEqual([{
      type: "text",
      rows: [
        [expect.objectContaining({ text: "Primera línea" })],
        [expect.objectContaining({ text: "continúa aquí" })],
      ],
    }]);
  });
});
