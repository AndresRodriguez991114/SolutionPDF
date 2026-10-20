import { afterEach, describe, expect, it } from "vitest";

import {
  defaultPreferences,
  errorMessage,
  formatBytes,
  readPreferences,
  readRecentFiles,
  readSavedSignatures,
} from "./appUtils";

afterEach(() => {
  localStorage.clear();
});

describe("appUtils", () => {
  it("reads only valid recent file paths", () => {
    localStorage.setItem("solutionpdf.recentFiles", JSON.stringify(["a.pdf", 42]));
    expect(readRecentFiles()).toEqual([]);

    localStorage.setItem("solutionpdf.recentFiles", JSON.stringify(["a.pdf", "b.pdf"]));
    expect(readRecentFiles()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("falls back to default preferences and clamps panel widths", () => {
    expect(readPreferences()).toEqual(defaultPreferences);

    localStorage.setItem("solutionpdf.preferences", JSON.stringify({
      zoom: 125,
      documentsPanelWidth: 999,
      thumbnailsPanelWidth: 20,
    }));
    expect(readPreferences()).toMatchObject({
      zoom: 125,
      documentsPanelWidth: 420,
      thumbnailsPanelWidth: 140,
    });
  });

  it("handles invalid saved signatures without breaking startup", () => {
    localStorage.setItem("solutionpdf.signatures", "{invalid");
    expect(readSavedSignatures()).toEqual([]);
  });

  it("normalizes error messages and byte sizes", () => {
    expect(errorMessage("falló")).toBe("falló");
    expect(errorMessage(new Error("falló"))).toBe("falló");
    expect(errorMessage({ message: "falló" })).toBe("falló");
    expect(errorMessage({ reason: "falló" })).toBe("Ocurrió un error inesperado.");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});
