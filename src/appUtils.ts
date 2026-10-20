export interface SavedSignature {
  id: string;
  name: string;
  dataUrl: string;
}

export interface AppPreferences {
  zoom: number;
  showThumbnails: boolean;
  documentsPanelCollapsed: boolean;
  thumbnailsPanelCollapsed: boolean;
  documentsPanelWidth: number;
  thumbnailsPanelWidth: number;
}

export const defaultPreferences: AppPreferences = {
  zoom: 100,
  showThumbnails: true,
  documentsPanelCollapsed: false,
  thumbnailsPanelCollapsed: false,
  documentsPanelWidth: 258,
  thumbnailsPanelWidth: 190,
};

export function readRecentFiles(): string[] {
  try {
    const stored = localStorage.getItem("solutionpdf.recentFiles");
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) && parsed.every((path) => typeof path === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Ocurrió un error inesperado.";
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function boundedWidth(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function readPreferences(): AppPreferences {
  try {
    const stored = localStorage.getItem("solutionpdf.preferences");
    if (!stored) return defaultPreferences;
    const parsed = JSON.parse(stored) as Partial<AppPreferences>;
    return {
      ...defaultPreferences,
      ...parsed,
      documentsPanelWidth: boundedWidth(parsed.documentsPanelWidth, defaultPreferences.documentsPanelWidth, 180, 420),
      thumbnailsPanelWidth: boundedWidth(parsed.thumbnailsPanelWidth, defaultPreferences.thumbnailsPanelWidth, 140, 340),
    };
  } catch {
    return defaultPreferences;
  }
}

export function readSavedSignatures(): SavedSignature[] {
  try {
    const stored = localStorage.getItem("solutionpdf.signatures");
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed as SavedSignature[] : [];
  } catch {
    return [];
  }
}
