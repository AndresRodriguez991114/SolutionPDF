import {
  Files,
  FolderOpen,
  Minimize2,
  Pencil,
  Highlighter,
  PenLine,
  Printer,
  RefreshCw,
  Type,
} from "lucide-react";

export type PdfTool = "text" | "signature" | "highlight" | null;

interface ToolbarProps {
  onOpenPdf: () => void;
  onEditPdf: () => void;
  onSign: () => void;
  onToolChange: (tool: PdfTool) => void;
  activeTool: PdfTool;
  onMergePdf: () => void;
  onOptimizePdf: () => void;
  onPrint: () => void;
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
  onOptimizePdf,
  onPrint,
  onCheckUpdates,
  hasDocument,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <button
        className="tool-button primary"
        onClick={onOpenPdf}
      >
        <FolderOpen size={23} strokeWidth={1.8} />
        <span>Abrir PDF</span>
      </button>

      <button
        className="tool-button"
        onClick={onEditPdf}
        disabled={!hasDocument}
        title={hasDocument ? "Editar las páginas del PDF" : "Abre un PDF primero"}
      >
        <Pencil size={22} strokeWidth={1.8} />
        <span>Páginas</span>
      </button>

      <button
        className={`tool-button ${activeTool === "text" ? "active" : ""}`}
        onClick={() => onToolChange(activeTool === "text" ? null : "text")}
        disabled={!hasDocument}
        title="Selecciona texto para editarlo o haz clic para agregar texto"
      >
        <Type size={22} strokeWidth={1.8} />
        <span>Editar texto</span>
      </button>

      <button
        className={`tool-button ${activeTool === "signature" ? "active" : ""}`}
        onClick={onSign}
        disabled={!hasDocument}
        title="Crear o usar una firma guardada"
      >
        <PenLine size={22} strokeWidth={1.8} />
        <span>Firmar</span>
      </button>

      <button
        className={`tool-button ${activeTool === "highlight" ? "active" : ""}`}
        onClick={() => onToolChange(activeTool === "highlight" ? null : "highlight")}
        disabled={!hasDocument}
        title="Selecciona texto para resaltarlo"
      >
        <Highlighter size={22} strokeWidth={1.8} />
        <span>Resaltar</span>
      </button>

      <button
        className="tool-button"
        onClick={onMergePdf}
        title="Unir este PDF con otros documentos"
      >
        <Files size={23} strokeWidth={1.8} />
        <span>Unir PDF</span>
      </button>

      <button
        className="tool-button"
        onClick={onOptimizePdf}
        disabled={!hasDocument}
        title={hasDocument ? "Guardar una copia optimizada" : "Abre un PDF primero"}
      >
        <Minimize2 size={22} strokeWidth={1.8} />
        <span>Optimizar PDF</span>
      </button>

      <button
        className="tool-button"
        onClick={onPrint}
        disabled={!hasDocument}
        title={hasDocument ? "Imprimir el PDF" : "Abre un PDF primero"}
      >
        <Printer size={22} strokeWidth={1.8} />
        <span>Imprimir</span>
      </button>

      <div className="toolbar-spacer" />

      <button
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