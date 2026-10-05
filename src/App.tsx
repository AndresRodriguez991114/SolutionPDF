import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import {
  ArrowDown,
  ArrowUp,
  Info,
  Check,
  Eraser,
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
import UserManual from "./components/UserManual";
import StatusBar from "./components/StatusBar";
import {
  applyAnnotationsToPdf,
  applyPageAction,
  mergePdfs,
  movePageTo,
  optimizePdf,
  type PdfAnnotation,
  type NormalizedRect,
  type PageAction,
} from "./PDF/pdfUtils";
import type { PdfTool } from "./components/Toolbar";

interface SavedSignature {
  id: string;
  name: string;
  dataUrl: string;
}

interface EditablePdfSnapshot {
  path: string;
  baseBytes: ArrayBuffer;
  outputHash: string;
  annotations: PdfAnnotation[];
}

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
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Ocurrió un error inesperado.";
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface AppPreferences {
  zoom: number;
  showThumbnails: boolean;
  documentsPanelCollapsed: boolean;
  thumbnailsPanelCollapsed: boolean;
  documentsPanelWidth: number;
  thumbnailsPanelWidth: number;
}

const defaultPreferences: AppPreferences = {
  zoom: 100,
  showThumbnails: true,
  documentsPanelCollapsed: false,
  thumbnailsPanelCollapsed: false,
  documentsPanelWidth: 258,
  thumbnailsPanelWidth: 190,
};

function boundedWidth(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function readPreferences(): AppPreferences {
  try {
    const stored = localStorage.getItem("solutionpdf.preferences");
    if (!stored) return defaultPreferences;
    const parsed = JSON.parse(stored) as Partial<AppPreferences>;
    return {
      ...defaultPreferences,
      ...parsed,
      documentsPanelWidth: boundedWidth(parsed.documentsPanelWidth, defaultPreferences.documentsPanelWidth, 180, 420),
      thumbnailsPanelWidth: boundedWidth(parsed.thumbnailsPanelWidth, defaultPreferences.thumbnailsPanelWidth, 140, 340),
    };
  } catch {
    return defaultPreferences;
  }
}

function readSavedSignatures(): SavedSignature[] {
  try {
    const stored = localStorage.getItem("solutionpdf.signatures");
    return stored ? JSON.parse(stored) as SavedSignature[] : [];
  } catch {
    return [];
  }
}

function openAnnotationDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("solutionpdf-editable-pdfs", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("documents")) {
        request.result.createObjectStore("documents", { keyPath: "path" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readEditableSnapshot(path: string): Promise<EditablePdfSnapshot | null> {
  const database = await openAnnotationDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("documents", "readonly").objectStore("documents").get(path);
    request.onsuccess = () => {
      database.close();
      resolve((request.result as EditablePdfSnapshot | undefined) || null);
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

async function writeEditableSnapshot(snapshot: EditablePdfSnapshot | null, path: string): Promise<void> {
  const database = await openAnnotationDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("documents", "readwrite");
    const store = transaction.objectStore("documents");
    if (snapshot) store.put(snapshot);
    else store.delete(path);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}

async function hashPdfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function persistEditableSnapshot(
  path: string,
  baseBytes: Uint8Array,
  annotations: PdfAnnotation[],
  outputBytes: Uint8Array
): Promise<void> {
  try {
    const snapshot = annotations.length
      ? {
          path,
          baseBytes: Uint8Array.from(baseBytes).buffer,
          outputHash: await hashPdfBytes(outputBytes),
          annotations,
        }
      : null;
    await writeEditableSnapshot(snapshot, path);
  } catch (error) {
    console.warn("SolutionsPDF: no se pudo guardar el estado editable", error);
  }
}

function App() {
  const [pdfFile, setPdfFile] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [documentRevision, setDocumentRevision] = useState(0);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const undoStack = useRef<Uint8Array[]>([]);
  const redoStack = useRef<Uint8Array[]>([]);
  const annotationUndoStack = useRef<PdfAnnotation[][]>([]);
  const annotationRedoStack = useRef<PdfAnnotation[][]>([]);
  const menuRef = useRef<HTMLElement>(null);
  const [recentFiles, setRecentFiles] = useState(readRecentFiles);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const closeApprovedRef = useRef(false);
  const [menu, setMenu] = useState<AppMenu | null>(null);
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<PdfTool>(null);
  const [textTarget, setTextTarget] = useState<{ pageNumber: number; x: number; y: number; rectangles?: NormalizedRect[]; annotationId?: string; selectedText?: string } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [savedSignatures, setSavedSignatures] = useState(readSavedSignatures);
  const [activeSignature, setActiveSignature] = useState<string | null>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const signatureDrawingRef = useRef(false);
  const [properties, setProperties] = useState<{ title: string; body: string } | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState(readPreferences);
  const {
    zoom,
    showThumbnails,
    documentsPanelCollapsed,
    thumbnailsPanelCollapsed,
    documentsPanelWidth,
    thumbnailsPanelWidth,
  } = preferences;
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
    annotationUndoStack.current = [];
    annotationRedoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setDirty(false);
    setAnnotations([]);
    setSelectedAnnotationId(null);
  }

  function commitPdfBytes(bytes: Uint8Array, previousBytes = pdfBytesRef.current) {
    const current = previousBytes;
    if (current) {
      undoStack.current.push(new Uint8Array(current));
      if (undoStack.current.length > 30) undoStack.current.shift();
    }
    redoStack.current = [];
    setCanUndo(undoStack.current.length > 0 || annotationUndoStack.current.length > 0);
    setCanRedo(false);
    setDocumentBytes(bytes);
    setDirty(true);
    setStatus("Cambios sin guardar");
  }

  function commitAnnotations(next: PdfAnnotation[]) {
    annotationUndoStack.current.push(annotations);
    if (annotationUndoStack.current.length > 30) annotationUndoStack.current.shift();
    annotationRedoStack.current = [];
    setAnnotations(next);
    setCanUndo(true);
    setCanRedo(false);
    setDirty(true);
  }

  async function readPdf(path: string): Promise<Uint8Array> {
    const response = await fetch(convertFileSrc(path));
    if (!response.ok) throw new Error(`No se pudo leer el PDF (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function loadDocument(path: string) {
    if (dirty && !await confirm("Hay cambios sin guardar. ¿Quieres descartarlos y abrir otro documento?")) return;
    try {
      const diskBytes = await readPdf(path);
      let bytes = diskBytes;
      let restoredAnnotations: PdfAnnotation[] = [];
      try {
        const snapshot = await readEditableSnapshot(path);
        if (snapshot && snapshot.outputHash === await hashPdfBytes(diskBytes)) {
          bytes = new Uint8Array(snapshot.baseBytes);
          restoredAnnotations = snapshot.annotations;
        } else if (snapshot) {
          await writeEditableSnapshot(null, path);
        }
      } catch (error) {
        console.warn("SolutionsPDF: no se pudo restaurar el estado editable", error);
      }
      await PDFDocument.load(bytes);
      setPdfFile(path);
      setDocumentBytes(bytes);
      setCurrentPage(1);
      setPageCount(0);
      resetHistory();
      setAnnotations(restoredAnnotations);
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

  async function handleSaveAs(bytes = pdfBytesRef.current, suggestedName = fileName || "documento.pdf"): Promise<boolean> {
    if (!bytes) return false;
    try {
      const output = bytes === pdfBytesRef.current ? await applyAnnotationsToPdf(bytes, annotations) : bytes;
      const path = await saveCopy(output, suggestedName);
      if (path) {
        if (bytes === pdfBytesRef.current) await persistEditableSnapshot(path, bytes, annotations, output);
        setPdfFile(path);
        setDirty(false);
        setStatus("Guardado");
        return true;
      }
      return false;
    } catch (error) {
      notify("No se pudo guardar el PDF", errorMessage(error));
      return false;
    }
  }

  async function handleSave(): Promise<boolean> {
    const bytes = pdfBytesRef.current;
    if (!bytes) return false;
    if (!pdfFile) return handleSaveAs();
    try {
      const output = await applyAnnotationsToPdf(bytes, annotations);
      await invoke("save_pdf", { path: pdfFile, bytes: Array.from(output) });
      await persistEditableSnapshot(pdfFile, bytes, annotations, output);
      setDirty(false);
      setStatus("Guardado");
      return true;
    } catch (error) {
      notify("No se pudo guardar el PDF", `${errorMessage(error)}\nPrueba con “Guardar como...” en otra ubicación.`);
      return false;
    }
  }

  async function handleMergePdf() {
    try {
      const selected = await open({ multiple: true, filters: [{ name: "Documentos PDF", extensions: ["pdf"] }] });
      if (!selected || typeof selected === "string") return;
      const paths = selected.filter((path) => path !== pdfFile);
      const documents: Uint8Array[] = [];
      if (pdfBytesRef.current) documents.push(await applyAnnotationsToPdf(pdfBytesRef.current, annotations));
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
      const optimized = await optimizePdf(await applyAnnotationsToPdf(current, annotations));
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
      const withAnnotations = await applyAnnotationsToPdf(current, annotations);
      const updated = await applyPageAction(withAnnotations, action, pageNumber);
      if (updated === withAnnotations) return;
      setAnnotations([]);
      setSelectedAnnotationId(null);
      annotationUndoStack.current = [];
      annotationRedoStack.current = [];
      commitPdfBytes(updated, withAnnotations);
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
      const withAnnotations = await applyAnnotationsToPdf(current, annotations);
      const updated = await movePageTo(withAnnotations, fromPageNumber, toPageNumber);
      if (updated === withAnnotations) return;
      setAnnotations([]);
      setSelectedAnnotationId(null);
      annotationUndoStack.current = [];
      annotationRedoStack.current = [];
      commitPdfBytes(updated, withAnnotations);
      setCurrentPage(toPageNumber);
    } catch (error) {
      notify("No se pudo mover la página", errorMessage(error));
    }
  }

  async function handlePageClick(pageNumber: number, x: number, y: number) {
    if (activeTool === "text") {
      setTextTarget({ pageNumber, x, y });
      setTextInput("");
      return;
    }
    if (activeTool !== "signature" || !activeSignature) return;
    const signature: PdfAnnotation = {
      id: crypto.randomUUID(),
      kind: "signature",
      pageNumber,
      x: Math.min(x, 0.75),
      y: Math.min(y, 0.945),
      width: 0.25,
      height: 0.055,
      dataUrl: activeSignature,
    };
    commitAnnotations([...annotations, signature]);
    setSelectedAnnotationId(signature.id);
    setActiveTool(null);
    setStatus("Firma agregada. Arrástrala o usa el control para cambiar su tamaño.");
  }

  async function handleHighlightSelection(pageNumber: number, rectangles: NormalizedRect[]) {
    const highlights: PdfAnnotation[] = rectangles.map((rectangle) => ({
      ...rectangle,
      id: crypto.randomUUID(),
      pageNumber,
      kind: "highlight",
    }));
    commitAnnotations([...annotations, ...highlights]);
    setStatus("Texto resaltado");
  }

  function handleTextSelection(pageNumber: number, rectangles: NormalizedRect[], selectedText: string) {
    const first = rectangles[0];
    if (!first) return;
    setTextTarget({ pageNumber, x: first.x, y: first.y, rectangles, selectedText });
    setTextInput(selectedText);
  }

  function handleEditAnnotation(annotation: Extract<PdfAnnotation, { kind: "text" }>) {
    setTextTarget({
      pageNumber: annotation.pageNumber,
      x: annotation.x,
      y: annotation.y,
      rectangles: annotation.coverRects,
      annotationId: annotation.id,
    });
    setTextInput(annotation.text);
  }

  async function handleAddText() {
    const target = textTarget;
    const text = textInput.trim().replace(/\s+/g, " ");
    if (!target || !text) return;
    if (target.annotationId) {
      commitAnnotations(annotations.map((annotation) =>
        annotation.id === target.annotationId && annotation.kind === "text"
          ? { ...annotation, text }
          : annotation
      ));
    } else if (target.selectedText !== undefined) {
      const current = pdfBytesRef.current;
      if (!current) return;
      try {
        const updated = await invoke<number[]>("replace_pdf_text", {
          bytes: Array.from(current),
          pageNumber: target.pageNumber,
          selectionRects: target.rectangles || [],
          selectedText: target.selectedText,
          replacementText: text,
        });
        commitPdfBytes(Uint8Array.from(updated));
        setTextTarget(null);
        setActiveTool(null);
        setStatus("Texto original editado con PDFium");
      } catch (error) {
        notify("No se pudo editar el texto original", errorMessage(error));
      }
      return;
    } else {
      const first = target.rectangles?.[0];
      const right = target.rectangles?.reduce((edge, rectangle) => Math.max(edge, rectangle.x + rectangle.width), first ? first.x + first.width : 0);
      const width = first && right ? Math.min(1, Math.max(0.08, right - first.x)) : 0.35;
      const height = first?.height || 0.035;
      const annotation: PdfAnnotation = {
        id: crypto.randomUUID(),
        kind: "text",
        pageNumber: target.pageNumber,
        x: Math.max(0, Math.min(target.x, 1 - width)),
        y: Math.max(0, Math.min(target.y, 1 - height)),
        width,
        height,
        text,
        coverRects: target.rectangles,
      };
      commitAnnotations([...annotations, annotation]);
      setSelectedAnnotationId(annotation.id);
    }
    setTextTarget(null);
    setActiveTool(null);
    setStatus("Texto actualizado. Arrástralo, edítalo con doble clic o elimínalo desde el control.");
  }

  function handleUpdateAnnotation(id: string, position: Pick<PdfAnnotation, "x" | "y" | "width" | "height">) {
    commitAnnotations(annotations.map((annotation) => annotation.id === id ? { ...annotation, ...position } : annotation));
  }

  function handleDeleteAnnotation(id: string) {
    commitAnnotations(annotations.filter((annotation) => annotation.id !== id));
    setSelectedAnnotationId(null);
    setStatus("Anotación eliminada");
  }

  function chooseSignature(dataUrl: string) {
    setActiveSignature(dataUrl);
    setActiveTool("signature");
    setSignatureDialogOpen(false);
    setStatus("Firma lista: haz clic en el lugar donde quieres colocarla");
  }

  function saveSignature() {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context || !context.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)) {
      notify("Firma vacía", "Dibuja tu firma antes de guardarla.");
      return;
    }
    const entry = {
      id: `${Date.now()}`,
      name: `Firma ${savedSignatures.length + 1}`,
      dataUrl: canvas.toDataURL("image/png"),
    };
    const signatures = [...savedSignatures, entry];
    setSavedSignatures(signatures);
    localStorage.setItem("solutionpdf.signatures", JSON.stringify(signatures));
    chooseSignature(entry.dataUrl);
  }

  function clearSignatureCanvas() {
    const canvas = signatureCanvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function handleUndo() {
    const previousAnnotations = annotationUndoStack.current.pop();
    if (previousAnnotations) {
      annotationRedoStack.current.push(annotations);
      setAnnotations(previousAnnotations);
      setCanUndo(undoStack.current.length > 0 || annotationUndoStack.current.length > 0);
      setCanRedo(true);
      setDirty(true);
      setStatus("Anotación deshecha");
      return;
    }
    const previous = undoStack.current.pop();
    const current = pdfBytesRef.current;
    if (!previous || !current) return;
    redoStack.current.push(new Uint8Array(current));
    setDocumentBytes(previous);
    setCanUndo(undoStack.current.length > 0 || annotationUndoStack.current.length > 0);
    setCanRedo(true);
    setDirty(true);
    setStatus("Cambio deshecho");
  }

  function handleRedo() {
    const nextAnnotations = annotationRedoStack.current.pop();
    if (nextAnnotations) {
      annotationUndoStack.current.push(annotations);
      setAnnotations(nextAnnotations);
      setCanUndo(true);
      setCanRedo(annotationRedoStack.current.length > 0 || redoStack.current.length > 0);
      setDirty(true);
      setStatus("Anotación rehecha");
      return;
    }
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
    try {
      await getCurrentWindow().close();
    } catch {
      notify("Salir", "Cierra esta ventana para salir de SolutionsPDF.");
    }
  }

  async function finishWindowClose() {
    closeApprovedRef.current = true;
    setCloseConfirmationOpen(false);
    try {
      await getCurrentWindow().close();
    } catch (error) {
      closeApprovedRef.current = false;
      notify("No se pudo cerrar SolutionsPDF", errorMessage(error));
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

  async function handleCheckUpdates() {
    try {
      setStatus("Buscando actualizaciones...");
      const update = await check();
      if (!update) {
        setStatus("La aplicación está actualizada");
        notify("Sin actualizaciones", "Tienes la versión más reciente de SolutionsPDF.");
        return;
      }

      const details = update.body ? `\n\n${update.body}` : "";
      const shouldInstall = await confirm(
        `Está disponible SolutionsPDF ${update.version}.${details}\n\n¿Descargar e instalar ahora?`,
        {
          title: "Actualización disponible",
          kind: "info",
          okLabel: "Actualizar",
          cancelLabel: "Más tarde",
        },
      );
      if (!shouldInstall) return;

      setStatus("Descargando actualización...");
      await update.downloadAndInstall();
      setStatus("Reiniciando SolutionsPDF...");
      await relaunch();
    } catch (error) {
      setStatus("No se pudo buscar actualizaciones");
      notify("No se pudieron buscar actualizaciones", errorMessage(error));
    }
  }

  async function handleAbout() {
    const version = await getVersion().catch(() => null);
    notify(
      "Acerca de SolutionsPDF",
      `${version ? `SolutionsPDF ${version}` : "Versión no disponible"}\nGestor local de documentos PDF. Los archivos se procesan en este dispositivo.`,
    );
  }

  function runPageAction(action: PageAction) {
    void handlePageAction(action, currentPage);
    setMenu(null);
    setEditDialogOpen(false);
  }

  function handlePrint() {
    if (pdfFile) window.print();
  }

  function handleMenuAction(action: string) {
    setMenu(null);
    switch (action) {
      case "open": void handleOpenPdf(); break;
      case "save": void handleSave(); break;
      case "save-as": void handleSaveAs(); break;
      case "close": void handleCloseDocument(); break;
      case "print": handlePrint(); break;
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
      case "fit": updatePreferences({ zoom: Math.max(40, Math.min(100, Math.floor((window.innerWidth - documentsPanelWidth - (showThumbnails ? thumbnailsPanelWidth : 0) - 100) / 750 * 100))) }); break;
      case "rotate-view": runPageAction("rotate-right"); break;
      case "toggle-panel": updatePreferences({ showThumbnails: !showThumbnails }); break;
      case "reading-mode": setReadingMode((value) => !value); break;
      case "manual": setManualOpen(true); break;
      case "about": void handleAbout(); break;
      case "updates": void handleCheckUpdates(); break;
      case "properties": void handleFileProperties(); break;
      case "edit-page": setEditDialogOpen(true); break;
      case "merge": void handleMergePdf(); break;
      case "optimize": void handleOptimizePdf(); break;
    }
  }

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    async function openPendingPdfs() {
      const paths = await invoke<string[]>("take_pending_pdf_paths");
      for (const path of paths) {
        await loadDocument(path);
      }
    }

    void listen("open-pdf-requested", () => {
      void openPendingPdfs().catch((error: unknown) => {
        notify("No se pudo abrir el PDF", errorMessage(error));
      });
    }).then((stopListening) => {
      if (!active) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      void openPendingPdfs().catch((error: unknown) => {
        notify("No se pudo abrir el PDF", errorMessage(error));
      });
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

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
        setManualOpen(false);
        setEditDialogOpen(false);
        setPreferencesOpen(false);
        setProperties(null);
        setReadingMode(false);
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "+" || key === "=" || event.code === "NumpadAdd") {
        event.preventDefault();
        updatePreferences({ zoom: Math.min(150, zoom + 10) });
        return;
      }
      if (key === "-" || key === "_" || event.code === "NumpadSubtract") {
        event.preventDefault();
        updatePreferences({ zoom: Math.max(40, zoom - 10) });
        return;
      }
      if (key === "0" || event.code === "Numpad0") {
        event.preventDefault();
        updatePreferences({ zoom: 100 });
        return;
      }
      if (key === "o") { event.preventDefault(); void handleOpenPdf(); }
      if (key === "s") { event.preventDefault(); void (event.shiftKey ? handleSaveAs() : handleSave()); }
      if (key === "z") { event.preventDefault(); event.shiftKey ? handleRedo() : handleUndo(); }
      if (key === "y") { event.preventDefault(); handleRedo(); }
      if (key === "p") { event.preventDefault(); handlePrint(); }
      if (key === "f") { event.preventDefault(); setSearchRequest((request) => request + 1); }
    }
    document.addEventListener("pointerdown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu, pdfFile, dirty, zoom, showThumbnails]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (closeApprovedRef.current || !dirty) return;
      event.preventDefault();
      setCloseConfirmationOpen(true);
    }).then((stopListening) => {
      if (active) unlisten = stopListening;
      else stopListening();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [dirty]);

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
              Ver: [[readingMode ? "Salir de modo lectura" : "Modo de lectura", "reading-mode", ""], ["Ajustar a la ventana", "fit", ""], ["Reducir zoom", "zoom-out", "Ctrl+-"], [`Zoom ${zoom}%`, "zoom-reset", "Ctrl+0"], ["Aumentar zoom", "zoom-in", "Ctrl++"], ["Rotar página actual", "rotate-view", ""], [showThumbnails ? "Ocultar miniaturas" : "Mostrar miniaturas", "toggle-panel", ""]],
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
        onSign={() => {
          setActiveTool(null);
          setSignatureDialogOpen(true);
        }}
        onToolChange={(tool) => {
          setActiveTool(tool);
          setStatus(tool === "highlight" ? "Selecciona texto del documento para resaltarlo" : tool === "text" ? "Selecciona texto para editarlo o haz clic en la página para agregarlo" : "Listo");
        }}
        activeTool={activeTool}
        onMergePdf={handleMergePdf}
        onOptimizePdf={handleOptimizePdf}
        onPrint={handlePrint}
        onCheckUpdates={handleCheckUpdates}
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
          collapsed={documentsPanelCollapsed}
          width={documentsPanelWidth}
          onToggleCollapsed={() => updatePreferences({ documentsPanelCollapsed: !documentsPanelCollapsed })}
          onResize={(delta) => updatePreferences({ documentsPanelWidth: Math.min(420, Math.max(180, documentsPanelWidth + delta)) })}
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
              hasUnsavedChanges={dirty || annotations.length > 0}
              currentPage={currentPage}
              onCurrentPageChange={setCurrentPage}
              onPageCountChange={setPageCount}
              onPageAction={handlePageAction}
              onMovePage={handleMovePage}
              zoom={zoom}
              onZoomChange={(nextZoom) => updatePreferences({ zoom: nextZoom })}
              showThumbnails={showThumbnails}
              thumbnailsCollapsed={thumbnailsPanelCollapsed}
              thumbnailsWidth={thumbnailsPanelWidth}
              onToggleThumbnailsCollapsed={() => updatePreferences({ thumbnailsPanelCollapsed: !thumbnailsPanelCollapsed })}
              onThumbnailsResize={(delta) => updatePreferences({ thumbnailsPanelWidth: Math.min(340, Math.max(140, thumbnailsPanelWidth + delta)) })}
              activeTool={activeTool}
              onPageClick={handlePageClick}
              onTextSelection={handleTextSelection}
              onHighlightSelection={handleHighlightSelection}
              annotations={annotations}
              selectedAnnotationId={selectedAnnotationId}
              onSelectAnnotation={setSelectedAnnotationId}
              onUpdateAnnotation={handleUpdateAnnotation}
              onDeleteAnnotation={handleDeleteAnnotation}
              onEditAnnotation={handleEditAnnotation}
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

      {textTarget && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTextTarget(null); }}>
          <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="text-dialog-title">
            <h2 id="text-dialog-title">{textTarget.rectangles || textTarget.annotationId ? "Editar texto" : "Agregar texto"}</h2>
            <p>{textTarget.selectedText !== undefined ? "PDFium reemplaza el fragmento dentro del PDF. Si la fuente no está disponible o el texto es mucho más largo, el resultado puede variar." : textTarget.annotationId ? "Edita el texto de esta anotación." : `Se insertará en la página ${textTarget.pageNumber}, en el punto seleccionado.`}</p>
            <textarea
              className="annotation-input"
              autoFocus
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void handleAddText(); }}
              placeholder="Escribe el texto"
            />
            <div className="dialog-footer"><span>Ctrl+Enter para insertar</span><button onClick={() => setTextTarget(null)}>Cancelar</button><button className="dialog-primary" onClick={() => void handleAddText()} disabled={!textInput.trim()}>Agregar</button></div>
          </section>
        </div>
      )}

      {signatureDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSignatureDialogOpen(false); }}>
          <section className="app-dialog signature-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-dialog-title">
            <h2 id="signature-dialog-title">Firmas</h2>
            <p>Las firmas guardadas se conservan en este dispositivo.</p>
            {savedSignatures.length > 0 && <div className="saved-signatures">
              {savedSignatures.map((signature) => (
                <div className="saved-signature" key={signature.id}>
                  <button className="signature-choice" onClick={() => chooseSignature(signature.dataUrl)} title={`Usar ${signature.name}`}>
                    <img src={signature.dataUrl} alt="" />
                    <span>{signature.name}</span>
                  </button>
                  <button className="signature-delete" aria-label={`Eliminar ${signature.name}`} title="Eliminar firma" onClick={() => {
                    const signatures = savedSignatures.filter((item) => item.id !== signature.id);
                    setSavedSignatures(signatures);
                    localStorage.setItem("solutionpdf.signatures", JSON.stringify(signatures));
                  }}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>}
            <label className="signature-label">Crear una firma nueva</label>
            <canvas
              ref={signatureCanvasRef}
              className="signature-canvas"
              width={520}
              height={150}
              aria-label="Área para dibujar una firma"
              onPointerDown={(event) => {
                const canvas = event.currentTarget;
                const bounds = canvas.getBoundingClientRect();
                const context = canvas.getContext("2d");
                if (!context) return;
                signatureDrawingRef.current = true;
                canvas.setPointerCapture(event.pointerId);
                context.beginPath();
                context.lineWidth = 4;
                context.lineCap = "round";
                context.lineJoin = "round";
                context.strokeStyle = "#202927";
                context.moveTo((event.clientX - bounds.left) * canvas.width / bounds.width, (event.clientY - bounds.top) * canvas.height / bounds.height);
              }}
              onPointerMove={(event) => {
                if (!signatureDrawingRef.current) return;
                const canvas = event.currentTarget;
                const bounds = canvas.getBoundingClientRect();
                const context = canvas.getContext("2d");
                if (!context) return;
                context.lineTo((event.clientX - bounds.left) * canvas.width / bounds.width, (event.clientY - bounds.top) * canvas.height / bounds.height);
                context.stroke();
              }}
              onPointerUp={() => { signatureDrawingRef.current = false; }}
              onPointerCancel={() => { signatureDrawingRef.current = false; }}
            />
            <div className="dialog-footer"><button onClick={clearSignatureCanvas}><Eraser size={15} /> Limpiar</button><span /><button onClick={() => setSignatureDialogOpen(false)}>Cancelar</button><button className="dialog-primary" onClick={saveSignature}><Check size={15} /> Guardar y usar</button></div>
          </section>
        </div>
      )}

      {closeConfirmationOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-confirmation-title">
            <h2 id="close-confirmation-title">¿Guardar los cambios?</h2>
            <p>Hay cambios sin guardar en {fileName ? `“${fileName}”` : "el documento"}.</p>
            <div className="dialog-footer">
              <button onClick={() => setCloseConfirmationOpen(false)}>Cancelar</button>
              <button onClick={() => void finishWindowClose()}>Descartar</button>
              <button className="dialog-primary" onClick={() => void handleSave().then(async (saved) => { if (saved) await finishWindowClose(); })}>Guardar</button>
            </div>
          </section>
        </div>
      )}
      {dialog && (
        <div className="dialog-backdrop notice-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <section className="app-dialog notice-dialog" role="dialog" aria-modal="true" aria-labelledby="notice-title">
            <div className="notice-heading">
              <span className="notice-icon"><Info size={21} strokeWidth={2} /></span>
              <div className="notice-heading-copy">
                <span className="notice-kicker">AVISO</span>
                <h2 id="notice-title">{dialog.title}</h2>
              </div>
            </div>
            <p className="dialog-message">{dialog.body}</p>
            <div className="dialog-footer"><span /><button className="dialog-primary" onClick={() => setDialog(null)}>Aceptar</button></div>
          </section>
        </div>
      )}

      {manualOpen && <UserManual onClose={() => setManualOpen(false)} />}

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