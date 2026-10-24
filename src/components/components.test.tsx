import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PagesPanel from "./PagesPanel";
import SidebarResizeHandle from "./SidebarResizeHandle";
import StatusBar from "./StatusBar";
import Toolbar from "./Toolbar";

afterEach(() => {
  cleanup();
});

function renderToolbar(hasDocument = true) {
  return render(
    <Toolbar
      onOpenPdf={vi.fn()}
      onEditPdf={vi.fn()}
      onSign={vi.fn()}
      onToolChange={vi.fn()}
      activeTool={null}
      onMergePdf={vi.fn()}
      mergeInProgress={false}
      onOptimizePdf={vi.fn()}
      onPrint={vi.fn()}
      onExportWord={vi.fn()}
      onExportExcel={vi.fn()}
      onExportImage={vi.fn()}
      onCheckUpdates={vi.fn()}
      hasDocument={hasDocument}
    />
  );
}

describe("Toolbar", () => {
  it("disables document actions until a PDF is open", () => {
    renderToolbar(false);

    expect(screen.getByRole("button", { name: "Páginas" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Editar texto" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Firmar" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Comprimir PDF" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Imprimir" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Exportar Archivo PDF" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Abrir PDF" }).hasAttribute("disabled")).toBe(false);
  });

  it("exposes the document tools as a toolbar", () => {
    renderToolbar();

    expect(screen.getByRole("toolbar", { name: "Herramientas del documento" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unir PDF" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Buscar actualizaciones" }).hasAttribute("disabled")).toBe(false);
    const exportButton = screen.getByRole("button", { name: "Exportar Archivo PDF" });
    expect(exportButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(exportButton);
    expect(screen.getByRole("menu", { name: "Formatos de exportación" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Microsoft Word" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Hoja de cálculo Excel" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Microsoft PowerPoint/ }).hasAttribute("disabled")).toBe(true);
  });

  it("opens the Word export from the consolidated format menu", () => {
    const onExportWord = vi.fn();
    render(<Toolbar
      onOpenPdf={vi.fn()}
      onEditPdf={vi.fn()}
      onSign={vi.fn()}
      onToolChange={vi.fn()}
      activeTool={null}
      onMergePdf={vi.fn()}
      mergeInProgress={false}
      onOptimizePdf={vi.fn()}
      onPrint={vi.fn()}
      onExportWord={onExportWord}
      onExportExcel={vi.fn()}
      onExportImage={vi.fn()}
      onCheckUpdates={vi.fn()}
      hasDocument
    />);

    fireEvent.click(screen.getByRole("button", { name: "Exportar Archivo PDF" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Microsoft Word" }));

    expect(onExportWord).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "Formatos de exportación" })).toBeNull();
  });

  it("offers PNG and JPG from the image export option", () => {
    const onExportImage = vi.fn();
    render(<Toolbar
      onOpenPdf={vi.fn()}
      onEditPdf={vi.fn()}
      onSign={vi.fn()}
      onToolChange={vi.fn()}
      activeTool={null}
      onMergePdf={vi.fn()}
      mergeInProgress={false}
      onOptimizePdf={vi.fn()}
      onPrint={vi.fn()}
      onExportWord={vi.fn()}
      onExportExcel={vi.fn()}
      onExportImage={onExportImage}
      onCheckUpdates={vi.fn()}
      hasDocument
    />);

    fireEvent.click(screen.getByRole("button", { name: "Exportar Archivo PDF" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Imagen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "PNG" }));

    expect(onExportImage).toHaveBeenCalledWith("png");
    expect(screen.queryByRole("menu", { name: "Formatos de exportación" })).toBeNull();
  });
});

describe("PagesPanel", () => {
  const baseProps = {
    fileName: undefined,
    onOpenPdf: vi.fn(),
    recentFiles: ["C:\\documentos\\informe.pdf", "C:\\documentos\\factura.pdf"],
    onSelectFile: vi.fn(),
    searchRequest: 0,
    collapsed: false,
    width: 258,
    onToggleCollapsed: vi.fn(),
    onResize: vi.fn(),
  };

  it("filters recent files by their visible file name", () => {
    render(<PagesPanel {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Buscar documentos" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar documentos recientes" }), {
      target: { value: "factura" },
    });

    expect(screen.getByRole("button", { name: /factura\.pdf/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /informe\.pdf/ })).toBeNull();
  });

  it("opens the selected recent file", () => {
    const onSelectFile = vi.fn();
    render(<PagesPanel {...baseProps} onSelectFile={onSelectFile} />);

    fireEvent.click(screen.getByRole("button", { name: /informe\.pdf/ }));

    expect(onSelectFile).toHaveBeenCalledWith("C:\\documentos\\informe.pdf");
  });
});

describe("StatusBar", () => {
  it("announces the current document state", () => {
    render(<StatusBar fileName="informe.pdf" status="Cambios sin guardar" />);

    expect(screen.getByRole("status").textContent).toContain("Cambios sin guardar  |  informe.pdf");
  });

  it("announces local offline state without an open document", () => {
    render(<StatusBar fileName={undefined} status="Listo" />);

    expect(screen.getByRole("status").textContent).toContain("Sin conexión  |  Listo");
  });
});

describe("SidebarResizeHandle", () => {
  it("supports keyboard resizing", () => {
    const onResize = vi.fn();
    render(<SidebarResizeHandle label="documentos locales" onResize={onResize} />);

    const handle = screen.getByRole("button", { name: "Cambiar ancho de documentos locales" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(onResize.mock.calls).toEqual([[-12], [12]]);
  });
});
