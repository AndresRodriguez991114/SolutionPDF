import { Document, Page, pdfjs } from "react-pdf";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";

import PdfThumbnail from "./PdfThumbnail";
import type { PageAction } from "./pdfUtils";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  file: Uint8Array | null;
  sourcePath: string;
  hasUnsavedChanges: boolean;
  onPageCountChange?: (count: number) => void;
  currentPage: number;
  onCurrentPageChange: (pageNumber: number) => void;
  onPageAction: (action: PageAction, pageNumber: number) => void;
  onMovePage: (fromPageNumber: number, toPageNumber: number) => void;
  zoom: number;
  showThumbnails: boolean;
}

function PdfViewer({
  file,
  sourcePath,
  hasUnsavedChanges,
  onPageCountChange,
  currentPage,
  onCurrentPageChange,
  onPageAction,
  onMovePage,
  zoom,
  showThumbnails,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [pageRenderError, setPageRenderError] = useState<string | null>(null);
  const [draggedPage, setDraggedPage] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const thumbnailPanelRef = useRef<HTMLElement | null>(null);
  const pointerDragRef = useRef<{
    pageNumber: number;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const autoScrollTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{
    pageNumber: number;
    x: number;
    y: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const documentSource = useMemo(() => {
    if (!hasUnsavedChanges) return convertFileSrc(sourcePath);
    return file ? { data: new Uint8Array(file) } : null;
  }, [file, hasUnsavedChanges, sourcePath]);

  useEffect(() => () => {
    if (autoScrollTimerRef.current !== null) {
      window.clearInterval(autoScrollTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        !contextMenuRef.current?.contains(event.target as Node)
      ) {
        setContextMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  if (!file) {
    return null;
  }

  function onDocumentLoadSuccess({
    numPages,
  }: {
    numPages: number;
  }) {
    setNumPages(numPages);
    setDocumentError(null);
    setPageRenderError(null);
    if (onPageCountChange) {
      onPageCountChange(numPages);
    }
  }

  function onDocumentLoadError(error: Error) {
    console.error("SolutionsPDF: no se pudo renderizar el documento", error);
    setDocumentError(error.message);
  }

  function onPageRenderError(error: Error) {
    console.error("SolutionsPDF: no se pudo dibujar una página", error);
    setPageRenderError(error.message);
  }

  function goToPage(pageNumber: number) {
    onCurrentPageChange(pageNumber);

    const pageElement = document.getElementById(
      `pdf-page-${pageNumber}`
    );

    if (pageElement) {
      pageElement.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }

  function openPageMenu(
    pageNumber: number,
    x: number,
    y: number
  ) {
    onCurrentPageChange(pageNumber);
    setContextMenu({
      pageNumber,
      x: Math.max(8, Math.min(x, window.innerWidth - 224)),
      y: Math.max(8, Math.min(y, window.innerHeight - 246)),
    });
  }

  function updateDropTarget(x: number, y: number) {
    const drag = pointerDragRef.current;
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-page-number]");
    const pageNumber = Number(target?.dataset.pageNumber);
    setDropTarget(
      drag?.active && pageNumber >= 1 && pageNumber <= numPages && pageNumber !== drag.pageNumber
        ? pageNumber
        : null
    );
  }

  function scrollWhileDragging() {
    const drag = pointerDragRef.current;
    const panel = thumbnailPanelRef.current;
    if (!drag?.active || !panel) return;

    const bounds = panel.getBoundingClientRect();
    const edgeSize = Math.min(72, bounds.height / 4);
    if (drag.y < bounds.top + edgeSize) panel.scrollTop -= 18;
    else if (drag.y > bounds.bottom - edgeSize) panel.scrollTop += 18;
    updateDropTarget(drag.x, drag.y);
  }

  function finishPointerDrag(x: number, y: number, cancel = false) {
    const drag = pointerDragRef.current;
    if (!drag) return;

    if (autoScrollTimerRef.current !== null) {
      window.clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }

    if (drag.active && !cancel) {
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-page-number]");
      const targetPage = Number(target?.dataset.pageNumber);
      suppressClickRef.current = true;
      if (targetPage >= 1 && targetPage <= numPages && targetPage !== drag.pageNumber) {
        onMovePage(drag.pageNumber, targetPage);
      }
    }

    pointerDragRef.current = null;
    setDraggedPage(null);
    setDropTarget(null);
  }

  function runAction(action: PageAction) {
    if (!contextMenu) return;
    const pageNumber = contextMenu.pageNumber;
    onPageAction(action, pageNumber);
    setContextMenu(null);
    if (action === "move-up") onCurrentPageChange(Math.max(1, pageNumber - 1));
    if (action === "move-down") onCurrentPageChange(Math.min(numPages, pageNumber + 1));
    if (action === "delete") onCurrentPageChange(Math.max(1, Math.min(pageNumber, numPages - 1)));
  }

  return (
    <Document
      className="pdf-workspace"
      file={documentSource}
      suspense={false}
      onLoadSuccess={onDocumentLoadSuccess}
      onLoadError={onDocumentLoadError}
      loading={<div className="pdf-loading">Cargando documento...</div>}
      error={
        <div className="pdf-error">
          No se pudo mostrar el PDF: {documentError || "verifica que el archivo sea válido y no tenga contraseña"}
        </div>
      }
    >

      {/* PANEL DE MINIATURAS */}
      {showThumbnails && <aside ref={thumbnailPanelRef} className="pdf-thumbnails-panel">

        <div className="thumbnails-header">
          <span>Páginas</span>
          <span>{numPages}</span>
        </div>

        <div className="thumbnails-list">

          {Array.from(
            { length: numPages },
            (_, index) => (
              <PdfThumbnail
                key={`thumbnail_${index + 1}`}
                pageNumber={index + 1}
                active={currentPage === index + 1}
                menuOpen={contextMenu?.pageNumber === index + 1}
                dragging={draggedPage === index + 1}
                dropTarget={dropTarget === index + 1 && draggedPage !== index + 1}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  goToPage(index + 1);
                }}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  pointerDragRef.current = {
                    pageNumber: index + 1,
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    x: event.clientX,
                    y: event.clientY,
                    active: false,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const drag = pointerDragRef.current;
                  if (!drag || drag.pointerId !== event.pointerId) return;
                  drag.x = event.clientX;
                  drag.y = event.clientY;

                  if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6) {
                    drag.active = true;
                    setDraggedPage(drag.pageNumber);
                    autoScrollTimerRef.current = window.setInterval(scrollWhileDragging, 40);
                  }

                  if (drag.active) {
                    event.preventDefault();
                    updateDropTarget(event.clientX, event.clientY);
                  }
                }}
                onPointerUp={(event) => {
                  if (pointerDragRef.current?.pointerId !== event.pointerId) return;
                  finishPointerDrag(event.clientX, event.clientY);
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
                onPointerCancel={(event) => {
                  if (pointerDragRef.current?.pointerId === event.pointerId) {
                    finishPointerDrag(event.clientX, event.clientY, true);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openPageMenu(index + 1, event.clientX, event.clientY);
                }}
                onMenuClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  openPageMenu(index + 1, bounds.right + 6, bounds.top);
                }}
              />
            )
          )}

        </div>

      </aside>}

      {/* DOCUMENTO PRINCIPAL */}
      <div className="pdf-viewer">

        <div className="pdf-info">
          <span>
            Página {currentPage} de {numPages}
          </span>
        </div>

        {pageRenderError && <div className="pdf-error">No se pudo dibujar la página: {pageRenderError}</div>}

          {Array.from(
            { length: numPages },
            (_, index) => {

              const pageNumber = index + 1;

              return (
                <div
                  className="pdf-page"
                  id={`pdf-page-${pageNumber}`}
                  key={`page_${pageNumber}`}
                  onClick={() =>
                    onCurrentPageChange(pageNumber)
                  }
                >
                  <Page
                    pageNumber={pageNumber}
                    width={750 * zoom / 100}
                    onRenderError={onPageRenderError}
                  />
                </div>
              );
            }
          )}

      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="thumbnail-context-menu"
          role="menu"
          aria-label={`Acciones para la página ${contextMenu.pageNumber}`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="context-menu-heading">
            Página {contextMenu.pageNumber}
          </div>
          <button
            role="menuitem"
            onClick={() => {
              runAction("rotate-left");
            }}
          >
            <RotateCcw size={16} />
            Rotar a la izquierda
          </button>
          <button
            role="menuitem"
            onClick={() => {
              runAction("rotate-right");
            }}
          >
            <RotateCw size={16} />
            Rotar a la derecha
          </button>
          <div className="context-menu-divider" />
          <button
            role="menuitem"
            disabled={contextMenu.pageNumber === 1}
            onClick={() => {
              runAction("move-up");
            }}
          >
            <ArrowUp size={16} />
            Mover hacia arriba
          </button>
          <button
            role="menuitem"
            disabled={contextMenu.pageNumber === numPages}
            onClick={() => {
              runAction("move-down");
            }}
          >
            <ArrowDown size={16} />
            Mover hacia abajo
          </button>
          <div className="context-menu-divider" />
          <button
            className="context-menu-danger"
            role="menuitem"
            onClick={() => {
              runAction("delete");
            }}
          >
            <Trash2 size={16} />
            Eliminar página
          </button>
        </div>
      )}
    </Document>
  );
}

export default PdfViewer;