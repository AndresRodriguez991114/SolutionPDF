import {
  ChevronRight,
  FileText,
  FolderOpen,
  HardDrive,
  Search,
} from "lucide-react";
import { useState } from "react";
import { useEffect } from "react";

interface PagesPanelProps {
  fileName: string | undefined;
  onOpenPdf: () => void;
  recentFiles: string[];
  onSelectFile: (path: string) => void;
  searchRequest: number;
}

function PagesPanel({
  fileName,
  onOpenPdf,
  recentFiles,
  onSelectFile,
  searchRequest,
}: PagesPanelProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const filteredFiles = recentFiles.filter((path) =>
    path.split(/[\\/]/).pop()?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    if (searchRequest > 0) setSearchOpen(true);
  }, [searchRequest]);

  return (
    <aside className="pages-panel">

      <div className="panel-heading">
        <span>Documentos locales</span>

        <button
          className="search-button"
          aria-label="Buscar documentos"
          title="Buscar documentos"
          aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen((open) => !open);
            setSearchTerm("");
          }}
        >
          <Search size={16} />
        </button>
      </div>

      {searchOpen && (
        <input
          className="library-search"
          autoFocus
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar en recientes..."
          aria-label="Buscar documentos recientes"
        />
      )}

      <div className="library-label">
        <HardDrive size={15} />
        Este dispositivo
      </div>

      {filteredFiles.length > 0 ? filteredFiles.map((path) => {
        const name = path.split(/[\\/]/).pop() || path;
        return (
          <button
            key={path}
            className={`document-row ${name === fileName ? "active" : ""}`}
            title={path}
            onClick={() => onSelectFile(path)}
          >
            <FileText size={18} />
            <span>{name}</span>
            <ChevronRight size={15} className="row-chevron" />
          </button>
        );
      }) : (
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

      {recentFiles.length === 0 && (
        <div className="library-empty">
          <span>
            Los archivos que abras aparecerán aquí.
          </span>
        </div>
      )}

      {recentFiles.length > 0 && filteredFiles.length === 0 && (
        <div className="library-empty">No hay documentos coincidentes.</div>
      )}

      {recentFiles.length > 0 && (
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
