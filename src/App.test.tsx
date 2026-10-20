import { PDFDocument } from "pdf-lib";
import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  check: vi.fn(),
  getVersion: vi.fn(),
  relaunch: vi.fn(),
  close: vi.fn(),
  onCloseRequested: vi.fn(),
  onDragDropEvent: vi.fn(),
  convertFileSrc: vi.fn((path: string) => path),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mocks.getVersion,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
  save: mocks.save,
  confirm: mocks.confirm,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: mocks.convertFileSrc,
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: mocks.close,
    onCloseRequested: mocks.onCloseRequested,
    onDragDropEvent: mocks.onDragDropEvent,
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mocks.relaunch,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("./PDF/PdfViewer", () => ({
  default: ({
    onPageCountChange,
    onPageClick,
    onHighlightSelection,
  }: {
    onPageCountChange?: (count: number) => void;
    onPageClick?: (page: number, x: number, y: number) => void;
    onHighlightSelection?: (page: number, rectangles: Array<{ x: number; y: number; width: number; height: number }>) => void;
  }) => {
    useEffect(() => {
      onPageCountChange?.(1);
    }, [onPageCountChange]);
    return (
      <div data-testid="pdf-viewer">
        <button type="button" onClick={() => onPageClick?.(1, 0.1, 0.1)}>Agregar texto</button>
        <button type="button" onClick={() => onHighlightSelection?.(1, [{ x: 0.1, y: 0.2, width: 0.2, height: 0.05 }])}>Resaltar selección</button>
      </div>
    );
  },
}));

import App from "./App";

async function createPdfBytes(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  return pdf.save();
}

function configureNativeMocks(bytes: Uint8Array) {
  mocks.open.mockResolvedValue("C:\\documentos\\informe.pdf");
  mocks.save.mockResolvedValue("C:\\documentos\\informe-copia.pdf");
  mocks.confirm.mockResolvedValue(true);
  mocks.invoke.mockResolvedValue([]);
  mocks.listen.mockResolvedValue(() => undefined);
  mocks.check.mockResolvedValue(null);
  mocks.getVersion.mockResolvedValue("0.2.6");
  mocks.close.mockResolvedValue(undefined);
  mocks.onCloseRequested.mockResolvedValue(() => undefined);
  mocks.onDragDropEvent.mockResolvedValue(() => undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => bytes.buffer,
  }));
}

function clickOpenPdf() {
  fireEvent.click(screen.getAllByRole("button", { name: "Abrir PDF" })[0]);
}

beforeEach(async () => {
  localStorage.clear();
  configureNativeMocks(await createPdfBytes());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App document flows", () => {
  it("opens a PDF and closes it without native file dependencies", async () => {
    render(<App />);

    clickOpenPdf();
    expect(await screen.findByTestId("pdf-viewer")).toBeTruthy();
    expect(screen.getByText("informe.pdf")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Archivo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cerrar documento" }));

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-viewer")).toBeNull();
    });
  });

  it("opens a PDF dropped into the application window", async () => {
    render(<App />);
    await waitFor(() => expect(mocks.onDragDropEvent).toHaveBeenCalled());

    const handler = mocks.onDragDropEvent.mock.calls[0][0] as (event: {
      payload: { type: string; paths: string[] };
    }) => void;
    act(() => handler({ payload: { type: "enter", paths: ["C:\\documentos\\informe.pdf"] } }));
    expect(screen.getByText("Suelta un PDF para abrirlo")).toBeTruthy();
    act(() => handler({ payload: { type: "drop", paths: ["C:\\documentos\\informe.pdf"] } }));

    expect(await screen.findByTestId("pdf-viewer")).toBeTruthy();
    expect(screen.getByText("informe.pdf")).toBeTruthy();
  });

  it("rejects non-PDF and multiple dropped files", async () => {
    render(<App />);
    await waitFor(() => expect(mocks.onDragDropEvent).toHaveBeenCalled());

    const handler = mocks.onDragDropEvent.mock.calls[0][0] as (event: {
      payload: { type: string; paths: string[] };
    }) => void;
    act(() => handler({ payload: { type: "drop", paths: ["C:\\documentos\\imagen.png"] } }));
    expect(await screen.findByText("Formato no compatible")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
    act(() => handler({ payload: { type: "drop", paths: ["C:\\documentos\\uno.pdf", "C:\\documentos\\dos.pdf"] } }));
    expect(await screen.findByText("Suelta un solo archivo PDF a la vez.")).toBeTruthy();
    expect(mocks.convertFileSrc).not.toHaveBeenCalledWith("C:\\documentos\\uno.pdf");
  });

  it("saves a copy through Guardar como", async () => {
    render(<App />);

    clickOpenPdf();
    await screen.findByTestId("pdf-viewer");
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(mocks.invoke.mock.calls.some((call) =>
        call[0] === "save_pdf"
        && (call[1] as { path?: string }).path === "C:\\documentos\\informe.pdf"
      )).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "Archivo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Guardar como/ }));

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalled();
      expect(mocks.invoke).toHaveBeenCalledWith("save_pdf", expect.objectContaining({
        path: "C:\\documentos\\informe-copia.pdf",
      }));
    });
  });

  it("shows validation feedback for an empty signature", async () => {
    render(<App />);

    clickOpenPdf();
    await screen.findByTestId("pdf-viewer");
    fireEvent.click(screen.getByRole("button", { name: "Firmar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar y usar" }));

    expect(await screen.findByText("Firma vacía")).toBeTruthy();
  });

  it("rejects a protection password shorter than eight characters", async () => {
    render(<App />);

    clickOpenPdf();
    await screen.findByTestId("pdf-viewer");
    fireEvent.click(screen.getByRole("button", { name: "Archivo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Proteger PDF..." }));

    const password = screen.getByLabelText("Nueva contraseña");
    const confirmation = screen.getByLabelText("Confirmar contraseña");
    fireEvent.change(password, { target: { value: "corta" } });
    fireEvent.change(confirmation, { target: { value: "corta" } });
    fireEvent.click(screen.getByRole("button", { name: "Proteger y guardar" }));

    expect(await screen.findByText("La contraseña debe tener al menos 8 caracteres.")).toBeTruthy();
  });

  it("undoes an annotation and asks before discarding changes", async () => {
    render(<App />);

    clickOpenPdf();
    await screen.findByTestId("pdf-viewer");
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    fireEvent.click(screen.getByTestId("pdf-viewer").querySelector("button")!);
    fireEvent.change(screen.getByPlaceholderText("Escribe el texto"), {
      target: { value: "Anotación" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(await screen.findByText(/Cambios sin guardar/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    fireEvent.click(screen.getByRole("button", { name: "Resaltar selección" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Deshacer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("menuitem", { name: /Rehacer/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Rehacer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("menuitem", { name: /Deshacer/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Archivo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cerrar documento" }));
    await waitFor(() => expect(screen.queryByTestId("pdf-viewer")).toBeNull());
  });

  it("opens compression options for an open document", async () => {
    render(<App />);

    clickOpenPdf();
    await screen.findByTestId("pdf-viewer");
    fireEvent.click(screen.getByRole("button", { name: "Comprimir PDF" }));

    expect(screen.getByRole("dialog", { name: "Comprimir PDF" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Nivel de compresión" })).toBeTruthy();
    expect(screen.getByText(/Las páginas se guardarán como imágenes/)).toBeTruthy();
  });

  it("shows an explicit error when opening a PDF fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    render(<App />);

    clickOpenPdf();

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("No se pudo abrir el PDF")).toBeTruthy();
  });
});
