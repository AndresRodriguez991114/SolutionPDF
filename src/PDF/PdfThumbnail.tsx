import { Page } from "react-pdf";

interface PdfThumbnailProps {
  pageNumber: number;
  onClick?: () => void;
  active?: boolean;
}

function PdfThumbnail({
  pageNumber,
  onClick,
  active = false,
}: PdfThumbnailProps) {
  return (
    <button
      className={`pdf-thumbnail ${active ? "active" : ""}`}
      onClick={onClick}
      title={`Página ${pageNumber}`}
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
  );
}

export default PdfThumbnail;