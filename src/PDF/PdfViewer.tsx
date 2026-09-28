import { Document, Page, pdfjs } from "react-pdf";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";

import PdfThumbnail from "./PdfThumbnail";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  file: string | null;
  onPageCountChange?: (count: number) => void;
}

function PdfViewer({
  file,
  onPageCountChange,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Guardamos las páginas que han sido modificadas
  const [rotations, setRotations] = useState<
    Record<number, number>
  >({});

  if (!file) {
    return null;
  }

  const pdfUrl = convertFileSrc(file);

  function onDocumentLoadSuccess({
    numPages,
  }: {
    numPages: number;
  }) {
    setNumPages(numPages);
    setCurrentPage(1);
    setRotations({});

    if (onPageCountChange) {
      onPageCountChange(numPages);
    }
  }

  function goToPage(pageNumber: number) {
    setCurrentPage(pageNumber);

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

  function rotatePage(direction: number) {
    setRotations((previous) => ({
      ...previous,
      [currentPage]:
        (previous[currentPage] || 0) + direction,
    }));
  }

  function deletePage() {
    if (numPages <= 1) {
      alert("El PDF debe tener al menos una página.");
      return;
    }

    alert(
      `La eliminación de la página ${currentPage} se conectará al PDF en el siguiente paso.`
    );
  }

  function movePage(direction: number) {
    if (
      (direction === -1 && currentPage === 1) ||
      (direction === 1 && currentPage === numPages)
    ) {
      return;
    }

    const newPage = currentPage + direction;

    setCurrentPage(newPage);

    setTimeout(() => {
      const pageElement = document.getElementById(
        `pdf-page-${newPage}`
      );

      if (pageElement) {
        pageElement.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }, 50);
  }

  return (
    <div className="pdf-workspace">

      {/* PANEL DE MINIATURAS */}
      <aside className="pdf-thumbnails-panel">

        <div className="thumbnails-header">
          <span>Páginas</span>
          <span>{numPages}</span>
        </div>

        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="pdf-loading">
              Cargando páginas...
            </div>
          }
          error={
            <div className="pdf-error">
              No se pudo cargar el PDF.
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
                  onClick={() =>
                    goToPage(index + 1)
                  }
                />
              )
            )}

          </div>
        </Document>

      </aside>

      {/* DOCUMENTO PRINCIPAL */}
      <div className="pdf-viewer">

        {/* BARRA DE EDICIÓN */}
        <div className="pdf-edit-toolbar">

          <button
            onClick={() => rotatePage(-90)}
            title="Rotar izquierda"
          >
            <RotateCcw size={18} />
            <span>Rotar</span>
          </button>

          <button
            onClick={() => rotatePage(90)}
            title="Rotar derecha"
          >
            <RotateCw size={18} />
            <span>Rotar</span>
          </button>

          <button
            onClick={deletePage}
            title="Eliminar página"
          >
            <Trash2 size={18} />
            <span>Eliminar</span>
          </button>

          <button
            onClick={() => movePage(-1)}
            disabled={currentPage === 1}
            title="Mover página arriba"
          >
            <ArrowUp size={18} />
            <span>Subir</span>
          </button>

          <button
            onClick={() => movePage(1)}
            disabled={currentPage === numPages}
            title="Mover página abajo"
          >
            <ArrowDown size={18} />
            <span>Bajar</span>
          </button>

        </div>

        <div className="pdf-info">
          <span>
            Página {currentPage} de {numPages}
          </span>
        </div>

        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="pdf-loading">
              Cargando documento...
            </div>
          }
          error={
            <div className="pdf-error">
              No se pudo cargar el PDF.
            </div>
          }
        >

          {Array.from(
            { length: numPages },
            (_, index) => {

              const pageNumber = index + 1;

              const rotation =
                rotations[pageNumber] || 0;

              return (
                <div
                  className="pdf-page"
                  id={`pdf-page-${pageNumber}`}
                  key={`page_${pageNumber}`}
                  onClick={() =>
                    setCurrentPage(pageNumber)
                  }
                >
                  <Page
                    pageNumber={pageNumber}
                    width={750}
                    rotate={rotation}
                  />
                </div>
              );
            }
          )}

        </Document>

      </div>
    </div>
  );
}

export default PdfViewer;