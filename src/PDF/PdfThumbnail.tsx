import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Page } from "react-pdf";
import { Ellipsis } from "lucide-react";

interface PdfThumbnailProps {
  pageNumber: number;
  onClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  onMenuClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  active?: boolean;
  menuOpen?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
}

function PdfThumbnail({
  pageNumber,
  onClick,
  onContextMenu,
  onMenuClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  active = false,
  menuOpen = false,
  dragging = false,
  dropTarget = false,
}: PdfThumbnailProps) {
  return (
    <div className="thumbnail-item">
      <button
        className={`pdf-thumbnail ${active ? "active" : ""} ${dragging ? "dragging" : ""} ${dropTarget ? "drop-target" : ""}`}
        data-page-number={pageNumber}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        title={`Página ${pageNumber}`}
        aria-current={active ? "page" : undefined}
      >
        <div className="thumbnail-page">
          <Page
            pageNumber={pageNumber}
            width={140}
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