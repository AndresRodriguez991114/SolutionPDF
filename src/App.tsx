import { useEffect, useRef, useState } from "react";
import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  RotateCcw,
  RotateCw,
  Trash2,
  WifiOff,
} from "lucide-react";
import { PDFDocument } from "pdf-lib";

import "./App.css";
import brandMark from "./assets/solutionspdf-mark.svg";

import PdfViewer from "./PDF/PdfViewer";
import Toolbar from "./components/Toolbar";
import PagesPanel from "./components/PagesPanel";
import StatusBar from "./components/StatusBar";
import {
  applyPageAction,
  mergePdfs,
  movePageTo,
  optimizePdf,
  type PageAction,
} from "./PDF/pdfUtils";

type AppMenu = "Archivo" | "Editar" | "Ver" | "Ayuda";

function readRecentFiles(): string[] {
  try {
    const stored = localStorage.getItem("solutionpdf.recentFiles");
    return stored ? JSON.parse(stored) as string[] : [];
  } catch {
    return [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function readPreferences(): { zoom: number; showThumbnails: boolean } {
  try {
    const stored = localStorage.getItem("solutionpdf.preferences");
    return stored ? JSON.parse(stored) as { zoom: number; showThumbnails: boolean } : { zoom: 100, showThumbnails: true };
  } catch {
    return { zoom: 100, showThumbnails: true };
  }
}

function App() {
  const [pdfFile, setPdfFile] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [documentRevision, setDocumentRevision] = useState(0);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const undoStack = useRef<Uint8Array[]>([]);
  const redoStack = useRef<Uint8Array[]>([]);
  const menuRef = useRef<HTMLElement>(null);
  const [recentFiles, setRecentFiles] = useState(readRecentFiles);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [menu, setMenu] = useState<AppMenu | null>(null);
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [properties, setProperties] = useState<{ title: string; body: string } | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState(readPreferences);
  const { zoom, showThumbnails } = preferences;
  const [readingMode, setReadingMode] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const [status, setStatus] = useState("Listo");

  const fileName = pdfFile?.split(/[\\/]/).pop();

  function setDocumentBytes(bytes: Uint8Array | null) {
    pdfBytesRef.current = bytes;
    setPdfBytes(bytes);
    setDocumentRevision((revision) => revision + 1);
  }

  function notify(title: string, body: string) {
    setDialog({ title, body });
  }

  function updatePreferences(update: Partial<typeof preferences>) {
    setPreferences((previous) => {
      const next = { ...previous, ...update };
      localStorage.setItem("solutionpdf.preferences", JSON.stringify(next));
      return next;
    });
  }

  function rememberFile(path: string) {
    setRecentFiles((previous) => {
      const updated = [path, ...previous.filter((item) => item !== path)].slice(0, 20);
      localStorage.setItem("solutionpdf.recentFiles", JSON.stringify(updated));
      return updated;
    });
  }

  function resetHistory() {
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setDirty(false);
  }

  function commitPdfBytes(bytes: Uint8Array) {
    const current = pdfBytesRef.current;
    if (current) {
      undoStack.current.push(new Uint8Array(current));
      if (undoStack.current.length > 30) undoStack.current.shift();
    }
    redoStack.current = [];
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(false);
    setDocumentBytes(bytes);
    setDirty(true);
    setStatus("Cambios sin guardar");
  }

  async function readPdf(path: string): Promise<Uint8Array> {
    const response = await fetch(convertFileSrc(path));
    if (!response.ok) throw new Error(`No se pudo leer el PDF (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function loadDocument(path: string) {
    if (dirty && !await confirm("Hay cambios sin guardar. ¿Quieres descartarlos y abrir otro documento?")) return;
    try {
      const bytes = await readPdf(path);
      await PDFDocument.load(bytes);
      setPdfFile(path);
      setDocumentBytes(bytes);
      setCurrentPage(1);
      setPageCount(0);
      resetHistory();
      rememberFile(path);
      setStatus("Documento abierto");
    } catch (error) {
      notify("No se pudo abrir el PDF", errorMessage(error));
    }
  }

  async function handleOpenPdf() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Documentos PDF", extensions: ["pdf"] }],
      });
      if (typeof selected === "string") await loadDocument(selected);
    } catch (error) {
      notify("No se pudo abrir el selector", errorMessage(error));
    }
  }

  async function saveCopy(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
    const path = await saveDialog({
      defaultPath: suggestedName,
      filters: [{ name: "Documento PDF", extensions: ["pdf"] }],
    });
    if (!path) return null;
    await invoke("save_pdf", { path, bytes: Array.from(bytes) });
    rememberFile(path);
    return path;
  }

  async function handleSaveAs(bytes = pdfBytesRef.current, suggestedName = fileName || "documento.pdf") {
    if (!bytes) return;
    try {
      const path = await saveCopy(bytes, suggestedName);
      if (path) {
        setPdfFile(path);
        setDirty(false);
        setStatus("Guardado");
      }
    } catch (error) {
      notify("No se pudo guardar el PDF", errorMessage(error));
    }
  }

  async function handleSave() {
    const bytes = pdfBytesRef.current;
    if (!bytes) return;
    if (!pdfFile) return handleSaveAs();
    try {
      await invoke("save_pdf", { path: pdfFile, bytes: Array.from(bytes) });
      setDirty(false);
      setStatus("Guardado");
    } catch (error) {
      notify("No se pudo guardar el PDF", `${errorMessage(error)}\nPrueba con “Guardar como...” en otra ubicación.`);
    }
  }

  async function handleMergePdf() {
    try {
      const selected = await open({ multiple: true, filters: [{ name: "Documentos PDF", extensions: ["pdf"] }] });
      if (!selected || typeof selected === "string") return;
      const paths = selected.filter((path) => path !== pdfFile);
      const documents: Uint8Array[] = [];
      if (pdfBytesRef.current) documents.push(pdfBytesRef.current);
      for (const path of paths) documents.push(await readPdf(path));
      if (documents.length < 2) {
        notify("Faltan documentos", "Selecciona al menos dos PDF para unirlos.");
        return;
      }

      const merged = await mergePdfs(documents);
      const path = await saveCopy(merged, "documentos-unidos.pdf");
      if (path) {
        setPdfFile(path);
        setDocumentBytes(merged);
        setPageCount(0);
        setCurrentPage(1);
        resetHistory();
        setStatus("PDF unidos y guardados");
      }
    } catch (error) {
      notify("No se pudieron unir los PDF", errorMessage(error));
    }
  }

  async function handleOptimizePdf() {
    const current = pdfBytesRef.current;
    if (!current) return;
    try {
      const optimized = await optimizePdf(current);
      const difference = current.length - optimized.length;
      if (difference <= 0) {
        notify("Optimización completada", `La estructura ya es compacta (${formatBytes(current.length)}). No se guardó una copia mayor. Las imágenes no se recomprimen.`);
        return;
      }
      const path = await saveCopy(optimized, fileName?.replace(/\.pdf$/i, "-optimizado.pdf") || "documento-optimizado.pdf");
      if (path) setStatus(`Optimizado: ${formatBytes(current.length)} → ${formatBytes(optimized.length)}`);
    } catch (error) {
      notify("No se pudo optimizar el PDF", errorMessage(error));
    }
  }

  async function handlePageAction(action: PageAction, pageNumber: number) {
    const current = pdfBytesRef.current;
    if (!current) return;
    if (action === "delete" && !await confirm(`¿Eliminar la página ${pageNumber}? Esta acción se puede deshacer.`)) return;
    try {
      const updated = await applyPageAction(current, action, pageNumber);
      if (updated === current) return;
      commitPdfBytes(updated);
      if (action === "delete") {
        setPageCount((count) => Math.max(1, count - 1));
        setCurrentPage(Math.max(1, Math.min(pageNumber, pageCount - 1)));
      } else if (action === "move-up") setCurrentPage(Math.max(1, pageNumber - 1));
      else if (action === "move-down") setCurrentPage(Math.min(pageCount, pageNumber + 1));
    } catch (error) {
      notify("No se pudo modificar la página", errorMessage(error));
    }
  }

  async function handleMovePage(fromPageNumber: number, toPageNumber: number) {
    const current = pdfBytesRef.current;
    if (!current) return;
    try {
      const updated = await movePageTo(current, fromPageNumber, toPageNumber);
      if (updated === current) return;
      commitPdfBytes(updated);
      setCurrentPage(toPageNumber);
    } catch (error) {
      notify("No se pudo mover la página", errorMessage(error));
    }
  }

  function handleUndo() {
    const previous = undoStack.current.pop();
    const current = pdfBytesRef.current;
    if (!previous || !current) return;
    redoStack.current.push(new Uint8Array(current));
    setDocumentBytes(previous);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
    setDirty(true);
    setStatus("Cambio deshecho");
  }

  function handleRedo() {
    const next = redoStack.current.pop();
    const current = pdfBytesRef.current;
    if (!next || !current) return;
    undoStack.current.push(new Uint8Array(current));
    setDocumentBytes(next);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    setDirty(true);
    setStatus("Cambio rehecho");
  }

  async function handleCloseDocument() {
    if (dirty && !await confirm("Hay cambios sin guardar. ¿Cerrar el documento y descartarlos?")) return;
    setPdfFile(null);
    setDocumentBytes(null);
    setPageCount(0);
    setCurrentPage(1);
    resetHistory();
    setStatus("Documento cerrado");
  }

  async function handleExit() {
    if (dirty && !await confirm("Hay cambios sin guardar. ¿Salir de todas formas?")) return;
    try {
      await getCurrentWindow().close();
    } catch {
      notify("Salir", "Cierra esta ventana para salir de SolutionsPDF.");
    }
  }

  async function handleFileProperties() {
    const bytes = pdfBytesRef.current;
    if (!bytes || !fileName) return;
    try {
      const pdf = await PDFDocument.load(bytes);
      setProperties({
        title: "Propiedades del archivo",
        body: `Nombre: ${fileName}\nUbicación: ${pdfFile}\nTamaño: ${formatBytes(bytes.length)}\nPáginas: ${pdf.getPageCount()}\nTítulo: ${pdf.getTitle() || "No indicado"}\nAutor: ${pdf.getAuthor() || "No indicado"}\nCreación: ${pdf.getCreationDate()?.toLocaleString() || "No indicada"}`,
      });
    } catch (error) {
      notify("No se pudieron leer las propiedades", errorMessage(error));
    }
  }

  function runPageAction(action: PageAction) {
    void handlePageAction(action, currentPage);
    setMenu(null);
    setEditDialogOpen(false);
  }

  function handleMenuAction(action: string) {
    setMenu(null);
    switch (action) {
      case "open": void handleOpenPdf(); break;
      case "save": void handleSave(); break;
      case "save-as": void handleSaveAs(); break;
      case "close": void handleCloseDocument(); break;
      case "print": window.print(); break;
      case "exit": void handleExit(); break;
      case "undo": handleUndo(); break;
      case "redo": handleRedo(); break;
      case "copy": {
        const text = window.getSelection()?.toString() || "";
        if (text) void navigator.clipboard.writeText(text).then(() => setStatus("Texto copiado")).catch((error: unknown) => notify("No se pudo copiar", errorMessage(error)));
        else notify("Copiar texto", "Selecciona texto dentro del documento y vuelve a intentarlo.");
        break;
      }
      case "select-all": {
        const viewer = document.querySelector(".pdf-viewer");
        if (viewer) window.getSelection()?.selectAllChildren(viewer);
        break;
      }
      case "search": setSearchRequest((request) => request + 1); break;
      case "preferences": setPreferencesOpen(true); break;
      case "zoom-in": updatePreferences({ zoom: Math.min(150, zoom + 10) }); break;
      case "zoom-out": updatePreferences({ zoom: Math.max(40, zoom - 10) }); break;
      case "zoom-reset": updatePreferences({ zoom: 100 }); break;
      case "fit": updatePreferences({ zoom: Math.max(40, Math.min(100, Math.floor((window.innerWidth - (showThumbnails ? 320 : 100)) / 750 * 100))) }); break;
      case "rotate-view": runPageAction("rotate-right"); break;
      case "toggle-panel": updatePreferences({ showThumbnails: !showThumbnails }); break;
      case "reading-mode": setReadingMode((value) => !value); break;
      case "manual": notify("Manual de usuario", "Abre un PDF desde Archivo. Usa el clic derecho o los tres puntos de una miniatura para rotar, reordenar o eliminar páginas. Guarda con Ctrl+S y deshaz con Ctrl+Z."); break;
      case "about": notify("Acerca de SolutionsPDF", "SolutionsPDF 0.1.0\nGestor local de documentos PDF. Los archivos se procesan en este dispositivo."); break;
      case "updates": notify("Actualizaciones", "La comprobación automática no está configurada en esta versión. Versión instalada: 0.1.0."); break;
      case "properties": void handleFileProperties(); break;
      case "edit-page": setEditDialogOpen(true); break;
      case "merge": void handleMergePdf(); break;
      case "optimize": void handleOptimizePdf(); break;
    }
  }

  useEffect(() => {
    function handleOutsideClick(event: PointerEvent) {
      if (menu && !menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (
        pdfFile &&
        (event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r"))
      ) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        setMenu(null);
        setDialog(null);
        setEditDialogOpen(false);
        setPreferencesOpen(false);
        setProperties(null);
        setReadingMode(false);
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "o") { event.preventDefault(); void handleOpenPdf(); }
      if (key === "s") { event.preventDefault(); void (event.shiftKey ? handleSaveAs() : handleSave()); }
      if (key === "z") { event.preventDefault(); event.shiftKey ? handleRedo() : handleUndo(); }
      if (key === "y") { event.preventDefault(); handleRedo(); }
      if (key === "p") { event.preventDefault(); window.print(); }
      if (key === "f") { event.preventDefault(); setSearchRequest((request) => request + 1); }
    }
    document.addEventListener("pointerdown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu, pdfFile, dirty, zoom, showThumbnails]);

  return (
    <div className={`app ${readingMode ? "reading-mode" : ""}`}>

      {/* BARRA SUPERIOR */}
      <header className="topbar">

        <div className="brand">

          <img className="brand-icon" src={brandMark} alt="" />

          <span className="brand-name">
            Solutions<span>PDF</span>
          </span>

        </div>

        <nav className="menu" ref={menuRef}>
          {(["Archivo", "Editar", "Ver", "Ayuda"] as AppMenu[]).map((item) => {
            const items: Record<AppMenu, [string, string, string][]> = {
              Archivo: [["Abrir PDF", "open", "Ctrl+O"], ["Guardar", "save", "Ctrl+S"], ["Guardar como...", "save-as", "Ctrl+Shift+S"], ["Unir PDF...", "merge", ""], ["Imprimir", "print", "Ctrl+P"], ["Propiedades del archivo", "properties", ""], ["Cerrar documento", "close", ""], ["Salir", "exit", ""]],
              Editar: [["Deshacer", "undo", "Ctrl+Z"], ["Rehacer", "redo", "Ctrl+Y"], ["Copiar texto", "copy", "Ctrl+C"], ["Seleccionar todo", "select-all", "Ctrl+A"], ["Buscar documentos...", "search", "Ctrl+F"], ["Editar página actual...", "edit-page", ""], ["Preferencias", "preferences", ""]],
              Ver: [[readingMode ? "Salir de modo lectura" : "Modo de lectura", "reading-mode", ""], ["Ajustar a la ventana", "fit", ""], ["Reducir zoom", "zoom-out", ""], [`Zoom ${zoom}%`, "zoom-reset", ""], ["Aumentar zoom", "zoom-in", ""], ["Rotar página actual", "rotate-view", ""], [showThumbnails ? "Ocultar miniaturas" : "Mostrar miniaturas", "toggle-panel", ""]],
              Ayuda: [["Manual de usuario (offline)", "manual", ""], ["Acerca de SolutionsPDF", "about", ""], ["Verificar actualizaciones", "updates", ""]],
            };
            return (
              <div className="menu-entry" key={item}>
                <button aria-haspopup="menu" aria-expanded={menu === item} onClick={() => setMenu((current) => current === item ? null : item)}>{item}</button>
                {menu === item && <div className="menu-dropdown" role="menu" aria-label={item}>
                  {items[item].map(([label, action, shortcut]) => {
                    const needsDocument = ["save", "save-as", "close", "print", "properties", "edit-page", "rotate-view"].includes(action);
                    const disabled = (needsDocument && !pdfFile) || (action === "undo" && !canUndo) || (action === "redo" && !canRedo);
                    return <button key={action} role="menuitem" disabled={disabled} onClick={() => handleMenuAction(action)}>
                      <span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}
                    </button>;
                  })}
                </div>}
              </div>
            );
          })}
        </nav>

        <div className="window-caption">
          Gestor local de PDF
        </div>

      </header>

      {/* HERRAMIENTAS */}
      <Toolbar
        onOpenPdf={handleOpenPdf}
        onEditPdf={() => setEditDialogOpen(true)}
        onMergePdf={handleMergePdf}
        onOptimizePdf={handleOptimizePdf}
        onCheckUpdates={() => handleMenuAction("updates")}
        hasDocument={Boolean(pdfFile)}
      />

      {/* ESPACIO PRINCIPAL */}
      <main className="workspace">

        <PagesPanel
          fileName={fileName}
          onOpenPdf={handleOpenPdf}
          recentFiles={recentFiles}
          onSelectFile={loadDocument}
          searchRequest={searchRequest}
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

            <PdfViewer
              key={documentRevision}
              file={pdfBytes}
              sourcePath={pdfFile}
              hasUnsavedChanges={dirty}
              currentPage={currentPage}
              onCurrentPageChange={setCurrentPage}
              onPageCountChange={setPageCount}
              onPageAction={handlePageAction}
              onMovePage={handleMovePage}
              zoom={zoom}
              showThumbnails={showThumbnails}
            />

          )}

        </section>

      </main>

      {/* BARRA INFERIOR */}
      <StatusBar fileName={fileName} status={dirty ? "Cambios sin guardar" : status} />

      {editDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditDialogOpen(false); }}>
          <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title">
            <h2 id="edit-dialog-title">Editar página {currentPage}</h2>
            <p>Los cambios se aplican al PDF y se pueden deshacer.</p>
            <div className="edit-actions">
              <button onClick={() => runPageAction("rotate-left")}><RotateCcw size={17} /> Rotar a la izquierda</button>
              <button onClick={() => runPageAction("rotate-right")}><RotateCw size={17} /> Rotar a la derecha</button>
              <button onClick={() => runPageAction("move-up")} disabled={currentPage <= 1}><ArrowUp size={17} /> Mover hacia arriba</button>
              <button onClick={() => runPageAction("move-down")} disabled={currentPage >= pageCount}><ArrowDown size={17} /> Mover hacia abajo</button>
              <button className="dialog-danger" onClick={() => runPageAction("delete")}><Trash2 size={17} /> Eliminar página</button>
            </div>
            <div className="dialog-footer"><span>Página {currentPage} de {pageCount}</span><button onClick={() => setEditDialogOpen(false)}>Cerrar</button></div>
          </section>
        </div>
      )}

      {dialog && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="notice-title">
            <h2 id="notice-title">{dialog.title}</h2>
            <p className="dialog-message">{dialog.body}</p>
            <div className="dialog-footer"><span /><button className="dialog-primary" onClick={() => setDialog(null)}>Aceptar</button></div>
          </section>
        </div>
      )}

      {properties && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProperties(null); }}>
          <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="properties-title">
            <h2 id="properties-title">{properties.title}</h2>
            <p className="dialog-message">{properties.body}</p>
            <div className="dialog-footer"><span /><button className="dialog-primary" onClick={() => setProperties(null)}>Cerrar</button></div>
          </section>
        </div>
      )}

      {preferencesOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreferencesOpen(false); }}>
          <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
            <h2 id="preferences-title">Preferencias</h2>
            <label className="preference-control">
              <span>Zoom predeterminado</span>
              <select value={zoom} onChange={(event) => updatePreferences({ zoom: Number(event.target.value) })}>
                {[75, 90, 100, 110, 125].map((value) => <option value={value} key={value}>{value}%</option>)}
              </select>
            </label>
            <label className="preference-toggle">
              <input type="checkbox" checked={showThumbnails} onChange={(event) => updatePreferences({ showThumbnails: event.target.checked })} />
              Mostrar miniaturas al abrir un documento
            </label>
            <div className="dialog-footer"><span>Se guarda en este dispositivo.</span><button className="dialog-primary" onClick={() => setPreferencesOpen(false)}>Listo</button></div>
          </section>
        </div>
      )}

    </div>
  );
}

export default App;