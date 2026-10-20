import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Page } from "react-pdf";
import { useRef } from "react";
import { Ellipsis } from "lucide-react";

interface PdfThumbnailProps {
  pageNumber: number;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  onMenuClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  active?: boolean;
  selected?: boolean;
  cachedThumbnail?: string;
  onThumbnailRendered?: (pageNumber: number, dataUrl: string) => void;
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
  selected = false,
  cachedThumbnail,
  onThumbnailRendered,
  menuOpen = false,
  dragging = false,
  dropTarget = false,
}: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  return (
    <div className="thumbnail-item">
      <button
        className={`pdf-thumbnail ${active ? "active" : ""} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${dropTarget ? "drop-target" : ""}`}
        data-page-number={pageNumber}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        aria-label={`Página ${pageNumber}`}
        aria-pressed={selected}
        title={`Página ${pageNumber}`}
        aria-current={active ? "page" : undefined}
      >
        <div className="thumbnail-page">
          {cachedThumbnail ? (
            <img className="thumbnail-cached-image" src={cachedThumbnail} alt="" />
          ) : (
            <Page
              pageNumber={pageNumber}
              width={130}
              height={170}
              canvasRef={canvasRef}
              onRenderSuccess={() => {
                const canvas = canvasRef.current;
                if (canvas) onThumbnailRendered?.(pageNumber, canvas.toDataURL("image/jpeg", 0.82));
              }}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          )}
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