import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  FileText,
  WifiOff,
} from "lucide-react";

import "./App.css";

import PdfViewer from "./PDF/PdfViewer";
import Toolbar from "./components/Toolbar";
import PagesPanel from "./components/PagesPanel";
import StatusBar from "./components/StatusBar";

function App() {
  const [pdfFile, setPdfFile] = useState<string | null>(null);

  const fileName = pdfFile?.split(/[\\/]/).pop();

  async function handleOpenPdf() {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Documentos PDF",
          extensions: ["pdf"],
        },
      ],
    });

    if (typeof selected === "string") {
      setPdfFile(selected);
    }
  }

  return (
    <div className="app">

      {/* BARRA SUPERIOR */}
      <header className="topbar">

        <div className="brand">

          <div className="brand-icon">
            <FileText
              size={18}
              strokeWidth={2.2}
            />
          </div>

          <span className="brand-name">
            Solutions<span>PDF</span>
          </span>

        </div>

        <nav className="menu">
          <button onClick={handleOpenPdf}>
            Archivo
          </button>

          <button>
            Editar
          </button>

          <button>
            Ver
          </button>

          <button>
            Ayuda
          </button>
        </nav>

        <div className="window-caption">
          Gestor local de PDF
        </div>

      </header>

      {/* HERRAMIENTAS */}
      <Toolbar onOpenPdf={handleOpenPdf} />

      {/* ESPACIO PRINCIPAL */}
      <main className="workspace">

        <PagesPanel
          fileName={fileName}
          onOpenPdf={handleOpenPdf}
        />

        <section className="document-area">

          {!pdfFile ? (

            <div className="welcome">

              <div className="welcome-mark">
                <FileText
                  size={39}
                  strokeWidth={1.5}
                />

                <span className="welcome-mark-fold" />
              </div>

              <p className="welcome-eyebrow">
                SOLUTIONS PDF · ESPACIO LOCAL
              </p>

              <h1>
                Ningún documento cargado
              </h1>

              <p className="welcome-copy">
                Abre un PDF para empezar a trabajar
                en tu equipo.
              </p>

              <button
                className="open-button"
                onClick={handleOpenPdf}
              >
                <FileText size={18} />
                Abrir PDF
              </button>

              <p className="welcome-footnote">
                <WifiOff size={14} />
                Sin conexión. Tus archivos no salen
                de este dispositivo.
              </p>

            </div>

          ) : (

            <PdfViewer file={pdfFile} />

          )}

        </section>

      </main>

      {/* BARRA INFERIOR */}
      <StatusBar fileName={fileName} />

    </div>
  );
}

export default App;