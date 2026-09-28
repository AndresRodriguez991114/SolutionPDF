import {
  Files,
  FolderOpen,
  Minimize2,
  Pencil,
  RefreshCw,
} from "lucide-react";

interface ToolbarProps {
  onOpenPdf: () => void;
}

function Toolbar({ onOpenPdf }: ToolbarProps) {
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
        disabled
        title="Disponible próximamente"
      >
        <Pencil size={22} strokeWidth={1.8} />
        <span>Editar PDF</span>
      </button>

      <button
        className="tool-button"
        disabled
        title="Disponible próximamente"
      >
        <Files size={23} strokeWidth={1.8} />
        <span>Unir PDF</span>
      </button>

      <button
        className="tool-button"
        disabled
        title="Disponible próximamente"
      >
        <Minimize2 size={22} strokeWidth={1.8} />
        <span>Comprimir PDF</span>
      </button>

      <div className="toolbar-spacer" />

      <button
        className="update-button"
        disabled
        title="Disponible próximamente"
      >
        <RefreshCw size={20} strokeWidth={2} />
        <span>Buscar actualizaciones</span>
      </button>
    </div>
  );
}

export default Toolbar;