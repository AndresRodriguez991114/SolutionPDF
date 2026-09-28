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
  zoom,
  showThumbnails,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    pageNumber: number;
    x: number;
    y: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const thumbnailSource = useMemo(() => {
    if (!hasUnsavedChanges) return convertFileSrc(sourcePath);
    return file ? { data: new Uint8Array(file) } : null;
  }, [file, hasUnsavedChanges, sourcePath]);
  const documentSource = useMemo(() => {
    if (!hasUnsavedChanges) return convertFileSrc(sourcePath);
    return file ? { data: new Uint8Array(file) } : null;
  }, [file, hasUnsavedChanges, sourcePath]);

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
    if (onPageCountChange) {
      onPageCountChange(numPages);
    }
  }

  function onDocumentLoadError(error: Error) {
    console.error("SolutionsPDF: no se pudo renderizar el documento", error);
    setDocumentError(error.message);
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
    <div className="pdf-workspace">

      {/* PANEL DE MINIATURAS */}
      {showThumbnails && <aside className="pdf-thumbnails-panel">

        <div className="thumbnails-header">
          <span>Páginas</span>
          <span>{numPages}</span>
        </div>

        <Document
          file={thumbnailSource}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="pdf-loading">
              Cargando páginas...
            </div>
          }
          error={
            <div className="pdf-error">
              No se pudo mostrar el PDF: {documentError || "verifica que el archivo sea válido y no tenga contraseña"}
            </div>
          }
        >
          <div className="thumbnails-list">

            {Array.from(
              { length: numPages },
              (_, index) => (
                <PdfThumbnail
                  key={`thumbnail_${index + 1}`}
                  pageNumber={index + 1}
                  active={
                    currentPage === index + 1
                  }
                  menuOpen={contextMenu?.pageNumber === index + 1}
                  onClick={() =>
                    goToPage(index + 1)
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openPageMenu(
                      index + 1,
                      event.clientX,
                      event.clientY
                    );
                  }}
                  onMenuClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    openPageMenu(index + 1, bounds.right + 6, bounds.top);
                  }}
                />
              )
            )}

          </div>
        </Document>

      </aside>}

      {/* DOCUMENTO PRINCIPAL */}
      <div className="pdf-viewer">

        <div className="pdf-info">
          <span>
            Página {currentPage} de {numPages}
          </span>
        </div>

        <Document
          file={documentSource}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="pdf-loading">
              Cargando documento...
            </div>
          }
          error={
            <div className="pdf-error">
              No se pudo mostrar el PDF: {documentError || "verifica que el archivo sea válido y no tenga contraseña"}
            </div>
          }
        >

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
                  />
                </div>
              );
            }
          )}

        </Document>

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
    </div>
  );
}

export default PdfViewer;