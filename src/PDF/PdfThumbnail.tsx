import type { MouseEvent } from "react";
import { Page } from "react-pdf";
import { Ellipsis } from "lucide-react";

interface PdfThumbnailProps {
  pageNumber: number;
  onClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  onMenuClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  menuOpen?: boolean;
  rotation?: number;
}

function PdfThumbnail({
  pageNumber,
  onClick,
  onContextMenu,
  onMenuClick,
  active = false,
  menuOpen = false,
  rotation = 0,
}: PdfThumbnailProps) {
  return (
    <div className="thumbnail-item">
      <button
        className={`pdf-thumbnail ${active ? "active" : ""}`}
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={`Página ${pageNumber}`}
        aria-current={active ? "page" : undefined}
      >
        <div className="thumbnail-page">
          <Page
            pageNumber={pageNumber}
            width={140}
            rotate={rotation}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        </div>

        <span className="thumbnail-number">
          Página {pageNumber}
        </span>
      </button>
      <button
        type="button"
        className={`thumbnail-menu-trigger ${menuOpen ? "open" : ""}`}
        aria-label={`Acciones de la página ${pageNumber}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Acciones de página"
        onClick={onMenuClick}
      >
        <Ellipsis size={17} />
      </button>
    </div>
  );
}

export default PdfThumbnail;