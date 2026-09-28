import {
  Files,
  FolderOpen,
  Minimize2,
  Pencil,
  RefreshCw,
} from "lucide-react";

interface ToolbarProps {
  onOpenPdf: () => void;
  onEditPdf: () => void;
  onMergePdf: () => void;
  onOptimizePdf: () => void;
  onCheckUpdates: () => void;
  hasDocument: boolean;
}

function Toolbar({
  onOpenPdf,
  onEditPdf,
  onMergePdf,
  onOptimizePdf,
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
        <span>Editar PDF</span>
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