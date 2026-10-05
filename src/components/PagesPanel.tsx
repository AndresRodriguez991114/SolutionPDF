import {
  ChevronRight,
  ChevronLeft,
  FileText,
  FolderOpen,
  HardDrive,
  Search,
} from "lucide-react";
import { useState } from "react";
import { useEffect } from "react";
import SidebarResizeHandle from "./SidebarResizeHandle";

interface PagesPanelProps {
  fileName: string | undefined;
  onOpenPdf: () => void;
  recentFiles: string[];
  onSelectFile: (path: string) => void;
  searchRequest: number;
  collapsed: boolean;
  width: number;
  onToggleCollapsed: () => void;
  onResize: (delta: number) => void;
}

function PagesPanel({
  fileName,
  onOpenPdf,
  recentFiles,
  onSelectFile,
  searchRequest,
  collapsed,
  width,
  onToggleCollapsed,
  onResize,
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
    <aside
      className={`pages-panel ${collapsed ? "collapsed" : ""}`}
      style={{ width: collapsed ? 40 : width, flexBasis: collapsed ? 40 : width }}
    >
      {collapsed ? (
        <button
          type="button"
          className="sidebar-expand-button"
          aria-label="Expandir documentos locales"
          title="Expandir documentos locales"
          onClick={onToggleCollapsed}
        >
          <ChevronRight size={17} />
        </button>
      ) : (
        <>

      <div className="panel-heading">
        <span>Documentos locales</span>

        <div className="panel-heading-actions">
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

          <SidebarResizeHandle label="documentos locales" onResize={onResize} />
          <button
            type="button"
            className="sidebar-mid-toggle"
            aria-label="Contraer documentos locales"
            title="Contraer documentos locales"
            onClick={onToggleCollapsed}
          >
            <ChevronLeft size={16} />
          </button>
        </>
      )}

    </aside>
  );
}

export default PagesPanel;
