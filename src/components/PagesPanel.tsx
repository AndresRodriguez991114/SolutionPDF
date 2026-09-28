import {
  ChevronRight,
  FileText,
  FolderOpen,
  HardDrive,
  Search,
} from "lucide-react";

interface PagesPanelProps {
  fileName: string | undefined;
  onOpenPdf: () => void;
}

function PagesPanel({
  fileName,
  onOpenPdf,
}: PagesPanelProps) {
  return (
    <aside className="pages-panel">

      <div className="panel-heading">
        <span>Documentos locales</span>

        <button
          className="search-button"
          aria-label="Buscar documentos"
          title="Buscar documentos"
        >
          <Search size={16} />
        </button>
      </div>

      <div className="library-label">
        <HardDrive size={15} />
        Este dispositivo
      </div>

      {fileName ? (
        <button
          className="document-row active"
          title={fileName}
        >
          <FileText size={18} />

          <span>{fileName}</span>

          <ChevronRight
            size={15}
            className="row-chevron"
          />
        </button>
      ) : (
        <button
          className="document-row"
          onClick={onOpenPdf}
        >
          <FolderOpen size={18} />

          <span>Abrir archivo local...</span>

          <ChevronRight
            size={15}
            className="row-chevron"
          />
        </button>
      )}

      {!fileName && (
        <div className="library-empty">
          <span>
            Los archivos que abras aparecerán aquí.
          </span>
        </div>
      )}

      {fileName && (
        <div className="file-location">
          <span className="location-dot" />
          Abierto desde este equipo
        </div>
      )}

      {fileName && (
        <button
          className="open-another"
          onClick={onOpenPdf}
        >
          <FolderOpen size={16} />
          Abrir otro archivo
        </button>
      )}

      {!fileName && (
        <div className="local-note">
          <HardDrive size={15} />

          <span>
            Tus documentos permanecen en tu equipo.
          </span>
        </div>
      )}

    </aside>
  );
}

export default PagesPanel;
