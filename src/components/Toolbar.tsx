import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Files,
  FolderOpen,
  Globe,
  Image,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Highlighter,
  PenLine,
  Presentation,
  Printer,
  RefreshCw,
  Type,
} from "lucide-react";
import type { PageImageFormat } from "../PDF/pdfUtils";

export type PdfTool = "text" | "signature" | "highlight" | null;

interface ToolbarProps {
  onOpenPdf: () => void;
  onEditPdf: () => void;
  onSign: () => void;
  onToolChange: (tool: PdfTool) => void;
  activeTool: PdfTool;
  onMergePdf: () => void;
  mergeInProgress: boolean;
  onOptimizePdf: () => void;
  onPrint: () => void;
  onExportWord: () => void;
  onExportExcel: () => void;
  onExportImage: (format: PageImageFormat) => void;
  onCheckUpdates: () => void;
  hasDocument: boolean;
}

function Toolbar({
  onOpenPdf,
  onEditPdf,
  onSign,
  onToolChange,
  activeTool,
  onMergePdf,
  mergeInProgress,
  onOptimizePdf,
  onPrint,
  onExportWord,
  onExportExcel,
  onExportImage,
  onCheckUpdates,
  hasDocument,
}: ToolbarProps) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportMenuOpen) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !exportMenuRef.current?.contains(event.target)) {
        setExportMenuOpen(false);
        setImageMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExportMenuOpen(false);
        setImageMenuOpen(false);
      }
    };
    window.document.addEventListener("mousedown", closeOnOutsideClick);
    window.document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.removeEventListener("mousedown", closeOnOutsideClick);
      window.document.removeEventListener("keydown", closeOnEscape);
    };
  }, [exportMenuOpen]);

  const selectExport = (callback: () => void) => {
    setExportMenuOpen(false);
    setImageMenuOpen(false);
    callback();
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Herramientas del documento">
      <button
        type="button"
        className="tool-button primary"
        onClick={onOpenPdf}
      >
        <FolderOpen size={23} strokeWidth={1.8} />
        <span>Abrir PDF</span>
      </button>

      <button
        type="button"
        className="tool-button"
        onClick={onEditPdf}
        disabled={!hasDocument}
        title={hasDocument ? "Editar las páginas del PDF" : "Abre un PDF primero"}
      >
        <Pencil size={22} strokeWidth={1.8} />
        <span>Páginas</span>
      </button>

      <button
        type="button"
        className={`tool-button ${activeTool === "text" ? "active" : ""}`}
        onClick={() => onToolChange(activeTool === "text" ? null : "text")}
        disabled={!hasDocument}
        title="Selecciona texto para editarlo o haz clic para agregar texto"
      >
        <Type size={22} strokeWidth={1.8} />
        <span>Editar texto</span>
      </button>

      <button
        type="button"
        className={`tool-button ${activeTool === "signature" ? "active" : ""}`}
        onClick={onSign}
        disabled={!hasDocument}
        title="Crear o usar una firma guardada"
      >
        <PenLine size={22} strokeWidth={1.8} />
        <span>Firmar</span>
      </button>

      <button
        type="button"
        className={`tool-button ${activeTool === "highlight" ? "active" : ""}`}
        onClick={() => onToolChange(activeTool === "highlight" ? null : "highlight")}
        disabled={!hasDocument}
        title="Selecciona texto para resaltarlo"
      >
        <Highlighter size={22} strokeWidth={1.8} />
        <span>Resaltar</span>
      </button>

      <button
        type="button"
        className="tool-button"
        onClick={onMergePdf}
        disabled={mergeInProgress}
        title="Unir este PDF con otros documentos"
      >
        <Files size={23} strokeWidth={1.8} />
        <span>Unir PDF</span>
      </button>

      <button
        type="button"
        className="tool-button"
        onClick={onOptimizePdf}
        disabled={!hasDocument}
        title={hasDocument ? "Guardar una copia comprimida" : "Abre un PDF primero"}
      >
        <Minimize2 size={22} strokeWidth={1.8} />
        <span>Comprimir PDF</span>
      </button>

      <button
        type="button"
        className="tool-button"
        onClick={onPrint}
        disabled={!hasDocument}
        title={hasDocument ? "Imprimir el PDF" : "Abre un PDF primero"}
      >
        <Printer size={22} strokeWidth={1.8} />
        <span>Imprimir</span>
      </button>

      <div className="export-menu-anchor" ref={exportMenuRef}>
        <button
          type="button"
          className={`tool-button export-trigger ${exportMenuOpen ? "active" : ""}`}
          onClick={() => {
            setExportMenuOpen((open) => !open);
            setImageMenuOpen(false);
          }}
          disabled={!hasDocument}
          title={hasDocument ? "Exportar este PDF a otro formato" : "Abre un PDF primero"}
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen}
        >
          <FileText size={22} strokeWidth={1.8} />
          <span>Exportar Archivo PDF</span>
          <ChevronDown className="export-trigger-chevron" size={13} aria-hidden="true" />
        </button>
        {exportMenuOpen && (
          <div className="export-format-menu" role="menu" aria-label="Formatos de exportación">
            <button type="button" role="menuitem" onClick={() => selectExport(onExportWord)}>
              <FileText size={18} aria-hidden="true" />
              <span>Microsoft Word</span>
            </button>
            <button type="button" role="menuitem" onClick={() => selectExport(onExportExcel)}>
              <FileSpreadsheet size={18} aria-hidden="true" />
              <span>Hoja de cálculo Excel</span>
            </button>
            <button type="button" role="menuitem" disabled title="Próximamente">
              <Presentation size={18} aria-hidden="true" />
              <span>Microsoft PowerPoint <small>Próximamente</small></span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={imageMenuOpen}
              onClick={() => setImageMenuOpen((open) => !open)}
            >
              <Image size={18} aria-hidden="true" />
              <span>Imagen</span>
              <ChevronDown className="export-submenu-chevron" size={14} aria-hidden="true" />
            </button>
            {imageMenuOpen && (
              <div className="export-image-options" role="menu" aria-label="Formato de imagen">
                <button type="button" role="menuitem" onClick={() => selectExport(() => onExportImage("png"))}>PNG</button>
                <button type="button" role="menuitem" onClick={() => selectExport(() => onExportImage("jpg"))}>JPG</button>
              </div>
            )}
            <button type="button" role="menuitem" disabled title="Próximamente">
              <Globe size={18} aria-hidden="true" />
              <span>Página web HTML <small>Próximamente</small></span>
            </button>
            <button type="button" role="menuitem" disabled title="Próximamente">
              <MoreHorizontal size={18} aria-hidden="true" />
              <span>Más formatos <small>Próximamente</small></span>
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-spacer" />

      <button
        type="button"
        className="update-button"
        onClick={onCheckUpdates}
        title="Información de actualizaciones"
      >
        <RefreshCw size={20} strokeWidth={2} />
        <span>Buscar actualizaciones</span>
      </button>
    </div>
  );
}

export default Toolbar;