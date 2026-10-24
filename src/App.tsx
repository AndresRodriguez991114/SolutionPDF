import { useEffect, useRef, useState, type FormEvent } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
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
  LoaderCircle,
} from "lucide-react";
import { PDFDocument } from "pdf-lib";

import "./App.css";
import brandMark from "./assets/solutionspdf-mark.svg";

import PdfViewer from "./PDF/PdfViewer";
import Toolbar from "./components/Toolbar";
import { exportPdfToWord } from "./PDF/exportWord";
import type { WordExportMode, WordExportQuality } from "./PDF/exportWord";
import { exportPdfToExcel } from "./PDF/exportExcel";
import PagesPanel from "./components/PagesPanel";
import UserManual from "./components/UserManual";
import StatusBar from "./components/StatusBar";
import {
  applyAnnotationsToPdf,
  applyPageAction,
  deletePages,
  exportPagesAsImages,
  extractPages,
  mergePdfs,
  movePagesTo,
  movePageTo,
  parsePageRanges,
  rotatePages,
  splitPdfByRanges,
  splitPdfIntoPages,
  compressPdf,
  type PdfAnnotation,
  type NormalizedRect,
  type PageAction,
  type PageImageFormat,
  type RotationDirection,
  type PdfCompressionLevel,
} from "./PDF/pdfUtils";
import type { PdfTool } from "./components/Toolbar";
import {
  errorMessage,
  formatBytes,
  readPreferences,
  readRecentFiles,
  readSavedSignatures,
} from "./appUtils";

interface EditablePdfSnapshot {
  path: string;
  baseBytes: ArrayBuffer;
  outputHash: string;
  annotations: PdfAnnotation[];
}

type AppMenu = "Archivo" | "Editar" | "Ver" | "Ayuda";

interface PdfPasswordDialog {
  fileName: string;
  password: string;
  error: string | null;
}

interface PdfProtectionDialog {
  password: string;
  confirmation: string;
  error: string | null;
}

interface MergeProgress {
  phase: "loading" | "merging";
  current: number;
  total: number;
  fileName?: string;
}

interface CompressionProgress {
  current: number;
  total: number;
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
  if (typeof indexedDB === "undefined") return null;
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
  if (typeof indexedDB === "undefined") return;
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
  const [printRequest, setPrintRequest] = useState(0);
  const [updateOffer, setUpdateOffer] = useState<Update | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
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
  const [pdfPasswordDialog, setPdfPasswordDialog] = useState<PdfPasswordDialog | null>(null);
  const pdfPasswordResolverRef = useRef<((password: string | null) => void) | null>(null);
  const [pdfProtectionDialog, setPdfProtectionDialog] = useState<PdfProtectionDialog | null>(null);
  const [protectionInProgress, setProtectionInProgress] = useState(false);
  const protectInProgressRef = useRef(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [compressionDialogOpen, setCompressionDialogOpen] = useState(false);
  const [compressionLevel, setCompressionLevel] = useState<PdfCompressionLevel>("recommended");
  const [compressionProgress, setCompressionProgress] = useState<CompressionProgress | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [wordDialogOpen, setWordDialogOpen] = useState(false);
  const [wordMode, setWordMode] = useState<WordExportMode>("faithful");
  const [wordQuality, setWordQuality] = useState<WordExportQuality>("high");
  const [wordUseOcr, setWordUseOcr] = useState(false);
  const [wordPages, setWordPages] = useState("");
  const [wordProgress, setWordProgress] = useState<CompressionProgress | null>(null);
  const wordAbortRef = useRef<AbortController | null>(null);
  const [excelDialogOpen, setExcelDialogOpen] = useState(false);
  const [excelPages, setExcelPages] = useState("");
  const [excelUseOcr, setExcelUseOcr] = useState(false);
  const [excelProgress, setExcelProgress] = useState<CompressionProgress | null>(null);
  const excelAbortRef = useRef<AbortController | null>(null);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitRanges, setSplitRanges] = useState("");
  const [splitError, setSplitError] = useState<string | null>(null);
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
  const [dropActive, setDropActive] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const [pdfSearchRequest, setPdfSearchRequest] = useState(0);
  const [status, setStatus] = useState("Listo");
  const [documentUnlocked, setDocumentUnlocked] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<MergeProgress | null>(null);
  const mergeInProgressRef = useRef(false);
  const checkingUpdatesRef = useRef(false);
  const cancelledUpdateVersionRef = useRef<string | null>(null);

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

  function requestPdfPassword(name: string, error: string | null = null): Promise<string | null> {
    return new Promise((resolve) => {
      pdfPasswordResolverRef.current = resolve;
      setPdfPasswordDialog({ fileName: name, password: "", error });
    });
  }

  async function preparePdfForEditing(
    bytes: Uint8Array,
    name: string
  ): Promise<{ bytes: Uint8Array; wasUnlocked: boolean } | null> {
    try {
      await PDFDocument.load(bytes);
      return { bytes, wasUnlocked: false };
    } catch (error) {
      if (!errorMessage(error).toLowerCase().includes("encrypt")) throw error;
    }

    let passwordError: string | null = null;
    while (true) {
      const password = await requestPdfPassword(name, passwordError);
      if (password === null) return null;
      try {
        const unlocked = new Uint8Array(await invoke<number[]>("unlock_pdf", {
          bytes: Array.from(bytes),
          password,
        }));
        await PDFDocument.load(unlocked);
        return { bytes: unlocked, wasUnlocked: true };
      } catch (error) {
        passwordError = `No se pudo desbloquear el PDF. ${errorMessage(error)}`;
      }
    }
  }

  function cancelPdfPasswordRequest() {
    const resolve = pdfPasswordResolverRef.current;
    pdfPasswordResolverRef.current = null;
    setPdfPasswordDialog(null);
    resolve?.(null);
  }

  function submitPdfPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resolve = pdfPasswordResolverRef.current;
    if (!resolve || !pdfPasswordDialog) return;
    pdfPasswordResolverRef.current = null;
    setPdfPasswordDialog(null);
    resolve(pdfPasswordDialog.password);
  }

  async function loadDocument(path: string) {
    if (dirty && !await confirm("Hay cambios sin guardar. ¿Quieres descartarlos y abrir otro documento?")) return;
    try {
      const diskBytes = await readPdf(path);
      const name = path.split(/[\\/]/).pop() || path;
      const prepared = await preparePdfForEditing(diskBytes, name);
      if (!prepared) return;
      let bytes = prepared.bytes;
      let restoredAnnotations: PdfAnnotation[] = [];
      if (!prepared.wasUnlocked) {
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
      }
      setPdfFile(path);
      setDocumentBytes(bytes);
      setDocumentUnlocked(prepared.wasUnlocked);
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
    if (bytes === pdfBytesRef.current && documentUnlocked
      && !await confirm("Esta copia se guardará sin contraseña. El archivo protegido original no se modificará. ¿Continuar?")) return false;
    try {
      const output = bytes === pdfBytesRef.current ? await applyAnnotationsToPdf(bytes, annotations) : bytes;
      const path = await saveCopy(output, suggestedName);
      if (path) {
        if (bytes === pdfBytesRef.current) await persistEditableSnapshot(path, bytes, annotations, output);
        setPdfFile(path);
        setDocumentUnlocked(false);
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
    if (documentUnlocked
      && !await confirm("Al guardar se reemplazará el PDF protegido por una copia sin contraseña. ¿Continuar?")) return false;
    try {
      const output = await applyAnnotationsToPdf(bytes, annotations);
      await invoke("save_pdf", { path: pdfFile, bytes: Array.from(output) });
      await persistEditableSnapshot(pdfFile, bytes, annotations, output);
      setDocumentUnlocked(false);
      setDirty(false);
      setStatus("Guardado");
      return true;
    } catch (error) {
      notify("No se pudo guardar el PDF", `${errorMessage(error)}\nPrueba con “Guardar como...” en otra ubicación.`);
      return false;
    }
  }

  async function handleProtectPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pdfProtectionDialog || protectInProgressRef.current) return;

    const { password, confirmation } = pdfProtectionDialog;
    const passwordBytes = new TextEncoder().encode(password).length;
    if (Array.from(password).length < 8) {
      setPdfProtectionDialog({ ...pdfProtectionDialog, error: "La contraseña debe tener al menos 8 caracteres." });
      return;
    }
    if (passwordBytes > 127) {
      setPdfProtectionDialog({ ...pdfProtectionDialog, error: "La contraseña no puede superar 127 bytes UTF-8." });
      return;
    }
    if (password !== confirmation) {
      setPdfProtectionDialog({ ...pdfProtectionDialog, error: "Las contraseñas no coinciden." });
      return;
    }

    const bytes = pdfBytesRef.current;
    if (!bytes) return;

    protectInProgressRef.current = true;
    setProtectionInProgress(true);
    try {
      const editableBytes = await applyAnnotationsToPdf(bytes, annotations);
      const protectedBytes = new Uint8Array(await invoke<number[]>("protect_pdf", {
        bytes: Array.from(editableBytes),
        password,
      }));
      const verifiedBytes = new Uint8Array(await invoke<number[]>("unlock_pdf", {
        bytes: Array.from(protectedBytes),
        password,
      }));
      await PDFDocument.load(verifiedBytes);

      const path = await saveDialog({
        defaultPath: fileName?.replace(/\.pdf$/i, "-protegido.pdf") || "documento-protegido.pdf",
        filters: [{ name: "Documento PDF", extensions: ["pdf"] }],
      });
      if (!path) {
        setPdfProtectionDialog(null);
        return;
      }
      if (pdfFile && path.replace(/[\\/]+/g, "\\").toLowerCase() === pdfFile.replace(/[\\/]+/g, "\\").toLowerCase()) {
        setPdfProtectionDialog({
          ...pdfProtectionDialog,
          error: "Elige otro nombre o ubicación para conservar intacto el PDF original.",
        });
        return;
      }

      await invoke("save_pdf", { path, bytes: Array.from(protectedBytes) });
      rememberFile(path);
      setPdfProtectionDialog(null);
      setStatus("PDF protegido y guardado");
      notify("PDF protegido", `Se guardó una copia cifrada con AES-256 en:\n${path}\n\nPara abrirla se necesitará la contraseña. El documento original no se modificó.`);
    } catch (error) {
      setPdfProtectionDialog((current) => current
        ? { ...current, error: errorMessage(error) }
        : null);
    } finally {
      protectInProgressRef.current = false;
      setProtectionInProgress(false);
    }
  }

  async function handleMergePdf() {
    if (mergeInProgressRef.current) return;
    mergeInProgressRef.current = true;
    try {
      const selected = await open({ multiple: true, filters: [{ name: "Documentos PDF", extensions: ["pdf"] }] });
      if (!selected || typeof selected === "string") return;
      const paths = selected.filter((path) => path !== pdfFile);
      const currentBytes = pdfBytesRef.current;
      const total = paths.length + (currentBytes ? 1 : 0);
      if (total < 2) {
        notify("Faltan documentos", "Selecciona al menos dos PDF para unirlos.");
        return;
      }

      const documents: { bytes: Uint8Array; name: string }[] = [];
      let containsUnlockedPdf = documentUnlocked;
      setMergeProgress({ phase: "loading", current: 0, total });
      if (currentBytes) {
        const currentFileName = fileName || "documento abierto";
        setMergeProgress({ phase: "loading", current: 0, total, fileName: currentFileName });
        try {
          documents.push({
            bytes: await applyAnnotationsToPdf(currentBytes, annotations),
            name: currentFileName,
          });
        } catch (error) {
          throw new Error(`No se pudo preparar "${currentFileName}": ${errorMessage(error)}`);
        }
        setMergeProgress({ phase: "loading", current: documents.length, total });
      }
      for (const path of paths) {
        const name = path.split(/[\\/]/).pop() || path;
        setMergeProgress({ phase: "loading", current: documents.length, total, fileName: name });
        try {
          const diskBytes = await readPdf(path);
          const prepared = await preparePdfForEditing(diskBytes, name);
          if (!prepared) return;
          containsUnlockedPdf ||= prepared.wasUnlocked;
          documents.push({ bytes: prepared.bytes, name });
        } catch (error) {
          const message = errorMessage(error);
          throw new Error(`No se pudo leer "${name}": ${message}`);
        }
        setMergeProgress({ phase: "loading", current: documents.length, total });
      }

      setMergeProgress({ phase: "merging", current: 0, total });
      const merged = await mergePdfs(documents, (current, documentTotal) => {
        setMergeProgress({ phase: "merging", current, total: documentTotal });
      });
      if (containsUnlockedPdf
        && !await confirm("El PDF unido se guardará sin contraseña. Los archivos originales protegidos no se modificarán. ¿Continuar?")) return;
      const path = await saveCopy(merged, "documentos-unidos.pdf");
      if (path) {
        setPdfFile(path);
        setDocumentBytes(merged);
        setDocumentUnlocked(false);
        setPageCount(0);
        setCurrentPage(1);
        resetHistory();
        setStatus("PDF unidos y guardados");
      }
    } catch (error) {
      notify("No se pudieron unir los PDF", errorMessage(error));
    } finally {
      setMergeProgress(null);
      mergeInProgressRef.current = false;
    }
  }

  async function handleOptimizePdf() {
    if (!pdfBytesRef.current) return;
    setCompressionDialogOpen(true);
  }

  async function handleCompressPdf() {
    const current = pdfBytesRef.current;
    if (!current) return;
    setCompressionDialogOpen(false);
    setCompressionProgress({ current: 0, total: pageCount });
    try {
      const source = await applyAnnotationsToPdf(current, annotations);
      const compressed = await compressPdf(source, compressionLevel, (currentPage, total) => {
        setCompressionProgress({ current: currentPage, total });
      });
      const difference = source.length - compressed.length;
      if (difference <= 0) {
        notify("Compresión completada", `Con este nivel no se obtuvo un archivo más pequeño (${formatBytes(source.length)}). No se guardó una copia mayor.`);
        return;
      }
      const path = await saveCopy(compressed, fileName?.replace(/\.pdf$/i, `-${compressionLevel}.pdf`) || `documento-${compressionLevel}.pdf`);
      if (path) setStatus(`Comprimido: ${formatBytes(source.length)} → ${formatBytes(compressed.length)}`);
    } catch (error) {
      notify("No se pudo comprimir el PDF", errorMessage(error));
    } finally {
      setCompressionProgress(null);
    }
  }

  function handleExportWord() {
    if (!pdfBytesRef.current) return;
    setWordPages("");
    setWordQuality("high");
    setWordUseOcr(false);
    setWordDialogOpen(true);
  }

  function handleExportExcel() {
    if (!pdfBytesRef.current) return;
    setExcelPages("");
    setExcelUseOcr(false);
    setExcelDialogOpen(true);
  }

  function encodePathHex(text: string): string {
    return Array.from(new TextEncoder().encode(text), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function saveBinaryExport(path: string, bytes: Uint8Array): Promise<void> {
    try {
      await invoke("save_binary_file", bytes, { headers: { "x-file-path-hex": encodePathHex(path) } });
    } catch (error) {
      console.warn("SolutionsPDF: no se pudo usar save_binary_file, se usará el guardado JSON", error);
      await invoke("save_pdf", { path, bytes: Array.from(bytes) });
    }
  }

  async function handleRunWordExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = pdfBytesRef.current;
    if (!current) return;

    let pageNumbers: number[] | undefined;
    if (wordPages.trim()) {
      try {
        pageNumbers = parsePageRanges(wordPages, pageCount).flatMap(({ start, end }) =>
          Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
        );
      } catch (error) {
        notify("Páginas no válidas", errorMessage(error));
        return;
      }
    }

    const baseName = (fileName || "documento.pdf").replace(/\.pdf$/i, "");
    const abortController = new AbortController();
    wordAbortRef.current = abortController;
    try {
      const path = await saveDialog({
        defaultPath: `${baseName}.docx`,
        filters: [{ name: "Documento de Word", extensions: ["docx"] }],
      });
      if (!path) return;
      setWordDialogOpen(false);
      setWordProgress({ current: 0, total: pageNumbers?.length ?? pageCount });
      const source = await applyAnnotationsToPdf(current, annotations);
      const { bytes, pagesWithoutText, substitutedFonts, ocrPages } = await exportPdfToWord(source, {
        mode: wordMode,
        quality: wordQuality,
        enableOcr: wordUseOcr,
        signal: abortController.signal,
        pageNumbers,
        onProgress: (done, total) => setWordProgress({ current: done, total }),
      });
      await saveBinaryExport(path, bytes);
      setStatus("Exportado a Word");
      try {
        await invoke("open_exported_file", { path });
      } catch (error) {
        notify("Se exportó a Word, pero no se pudo abrir el archivo", errorMessage(error));
      }
      if (wordMode !== "image" && pagesWithoutText.length > 0) {
        notify(
          "Páginas sin texto seleccionable",
          ocrPages.length > 0
            ? `Se aplicó OCR en: ${ocrPages.join(", ")}. Sin texto editable: ${pagesWithoutText.filter((page) => !ocrPages.includes(page)).join(", ") || "ninguna"}.`
            : `Estas páginas parecen escaneadas y no tienen texto editable: ${pagesWithoutText.join(", ")}.\nActiva “OCR” o usa el modo “Imagen idéntica”.`
        );
      }
      if (substitutedFonts.length > 0) {
        notify("Fuentes sustituidas", `Word reemplazó fuentes no instaladas: ${substitutedFonts.slice(0, 8).join(", ")}${substitutedFonts.length > 8 ? "…" : ""}.`);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        setStatus("Exportación cancelada");
      } else {
        setStatus("Listo");
        notify("No se pudo exportar a Word", errorMessage(error));
      }
    } finally {
      wordAbortRef.current = null;
      setWordProgress(null);
    }
  }

  function handleCancelWordExport() {
    wordAbortRef.current?.abort();
    wordAbortRef.current = null;
  }

  async function handleRunExcelExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = pdfBytesRef.current;
    if (!current) return;

    let pageNumbers: number[] | undefined;
    if (excelPages.trim()) {
      try {
        pageNumbers = parsePageRanges(excelPages, pageCount).flatMap(({ start, end }) =>
          Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
        );
      } catch (error) {
        notify("Páginas no válidas", errorMessage(error));
        return;
      }
    }

    const baseName = (fileName || "documento.pdf").replace(/\.pdf$/i, "");
    const abortController = new AbortController();
    excelAbortRef.current = abortController;
    try {
      const path = await saveDialog({
        defaultPath: `${baseName}.xlsx`,
        filters: [{ name: "Libro de Excel", extensions: ["xlsx"] }],
      });
      if (!path) return;
      setExcelDialogOpen(false);
      setExcelProgress({ current: 0, total: pageNumbers?.length ?? pageCount });
      const source = await applyAnnotationsToPdf(current, annotations);
      const { bytes, pagesWithoutText, ocrPages, detectedTablePages, substitutedFonts } = await exportPdfToExcel(source, {
        pageNumbers,
        enableOcr: excelUseOcr,
        signal: abortController.signal,
        onProgress: (done, total) => setExcelProgress({ current: done, total }),
      });
      await saveBinaryExport(path, bytes);
      setStatus("Exportado a Excel");
      try {
        await invoke("open_exported_file", { path });
      } catch (error) {
        notify("Se exportó a Excel, pero no se pudo abrir el archivo", errorMessage(error));
      }
      if (pagesWithoutText.length > 0) {
        notify(
          "Páginas sin texto seleccionable",
          ocrPages.length > 0
            ? `Se aplicó OCR en: ${ocrPages.join(", ")}. Sin texto extraído: ${pagesWithoutText.filter((page) => !ocrPages.includes(page)).join(", ") || "ninguna"}.`
            : `No se encontró texto en las páginas ${pagesWithoutText.join(", ")}. Activa OCR para intentar reconocer páginas escaneadas.`
        );
      }
      if (detectedTablePages.length === 0) {
        notify("No se detectaron tablas", "Se exportó el texto encontrado en una columna por página. Comprueba el resultado y ajusta las celdas en Excel si hace falta.");
      }
      if (substitutedFonts.length > 0) {
        notify("Fuentes sustituidas", `Se usaron fuentes similares para nombres de fuente no reconocidos: ${substitutedFonts.slice(0, 8).join(", ")}${substitutedFonts.length > 8 ? "…" : ""}.`);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        setStatus("Exportación cancelada");
      } else {
        setStatus("Listo");
        notify("No se pudo exportar a Excel", errorMessage(error));
      }
    } finally {
      excelAbortRef.current = null;
      setExcelProgress(null);
    }
  }

  function handleCancelExcelExport() {
    excelAbortRef.current?.abort();
    excelAbortRef.current = null;
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

  async function handleRotatePages(pageNumbers: number[], direction: RotationDirection) {
    const current = pdfBytesRef.current;
    if (!current) return;
    try {
      const withAnnotations = await applyAnnotationsToPdf(current, annotations);
      const updated = await rotatePages(withAnnotations, pageNumbers, direction);
      setAnnotations([]);
      setSelectedAnnotationId(null);
      annotationUndoStack.current = [];
      annotationRedoStack.current = [];
      commitPdfBytes(updated, withAnnotations);
    } catch (error) {
      notify("No se pudieron rotar las páginas", errorMessage(error));
    }
  }

  function exportFileStem() {
    const stem = (fileName || "documento")
      .replace(/\.pdf$/i, "")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/[. ]+$/g, "")
      .trim();
    return stem || "documento";
  }

  async function savePageExportFiles(
    files: Array<{ name: string; bytes: Uint8Array }>,
    title: string
  ): Promise<boolean> {
    if (files.length === 0) return false;
    try {
      const directory = await open({ directory: true, multiple: false, title });
      if (typeof directory !== "string") return false;
      const paths = await invoke<string[]>("save_page_exports", {
        directory,
        files: files.map(({ name, bytes }) => ({ name, bytes: Array.from(bytes) })),
      });
      setStatus(`Exportados ${paths.length} archivos`);
      notify("Exportación completada", `Se guardaron ${paths.length} archivos en:\n${directory}`);
      return true;
    } catch (error) {
      notify("No se pudieron guardar los archivos exportados", errorMessage(error));
      return false;
    }
  }

  async function handleDeletePages(pageNumbers: number[]) {
    const current = pdfBytesRef.current;
    if (!current) return;
    const pages = [...new Set(pageNumbers)].sort((left, right) => left - right);
    if (!pages.length) return;
    try {
      const withAnnotations = await applyAnnotationsToPdf(current, annotations);
      const pageCountBefore = (await PDFDocument.load(withAnnotations)).getPageCount();
      if (pages.length >= pageCountBefore) {
        notify("No se pueden eliminar las páginas", "El PDF debe conservar al menos una página.");
        return;
      }
      if (!await confirm(`¿Eliminar las ${pages.length} páginas seleccionadas? Esta acción se puede deshacer.`)) return;
      const updated = await deletePages(withAnnotations, pages);
      setAnnotations([]);
      setSelectedAnnotationId(null);
      annotationUndoStack.current = [];
      annotationRedoStack.current = [];
      commitPdfBytes(updated, withAnnotations);
      setPageCount(Math.max(1, pageCountBefore - pages.length));
      setCurrentPage((page) => Math.max(1, Math.min(page, pageCountBefore - pages.length)));
    } catch (error) {
      notify("No se pudieron eliminar las páginas", errorMessage(error));
    }
  }

  async function handleExtractPages(pageNumbers: number[]) {
    const current = pdfBytesRef.current;
    if (!current) return;
    try {
      const withAnnotations = await applyAnnotationsToPdf(current, annotations);
      const extracted = await extractPages(withAnnotations, pageNumbers);
      const path = await saveCopy(extracted, `${exportFileStem()}-paginas-seleccionadas.pdf`);
      if (path) notify("Páginas extraídas", `Se guardó una copia con ${pageNumbers.length} páginas en:\n${path}`);
    } catch (error) {
      notify("No se pudieron extraer las páginas", errorMessage(error));
    }
  }

  async function handleSplitRanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = pdfBytesRef.current;
    if (!current) return;
    setSplitError(null);
    try {
      const ranges = parsePageRanges(splitRanges, pageCount);
      const withAnnotations = await applyAnnotationsToPdf(current, annotations);
      const parts = await splitPdfByRanges(withAnnotations, ranges);
      const files = parts.map((bytes, index) => {
        const { start, end } = ranges[index];
        return {
          name: `${exportFileStem()}-paginas-${start}${end === start ? "" : `-${end}`}.pdf`,
          bytes,
        };
      });
      if (await savePageExportFiles(files, "Elige la carpeta para guardar los PDF divididos")) {
        setSplitDialogOpen(false);
      }
    } catch (error) {
      setSplitError(errorMessage(error));
    }
  }

  async function handleExportEachPage() {
    const current = pdfBytesRef.current;
    if (!current) return;
    try {
      const withAnnotations = await applyAnnotationsToPdf(current, annotations);
      const pages = await splitPdfIntoPages(withAnnotations);
      const files = pages.map((bytes, index) => ({
        name: `${exportFileStem()}-pagina-${index + 1}.pdf`,
        bytes,
      }));
      await savePageExportFiles(files, "Elige la carpeta para guardar un PDF por página");
    } catch (error) {
      notify("No se pudo crear un PDF por página", errorMessage(error));
    }
  }

  async function handleExportPagesAsImages(pageNumbers: number[], format: PageImageFormat) {
    const current = pdfBytesRef.current;
    if (!current) return;
    try {
      const withAnnotations = await applyAnnotationsToPdf(current, annotations);
      const images = await exportPagesAsImages(withAnnotations, pageNumbers, format);
      const files = images.map(({ pageNumber, bytes }) => ({
        name: `${exportFileStem()}-pagina-${pageNumber}.${format}`,
        bytes,
      }));
      await savePageExportFiles(files, `Elige la carpeta para guardar las imágenes ${format.toUpperCase()}`);
    } catch (error) {
      notify("No se pudieron exportar las páginas como imágenes", errorMessage(error));
    }
  }

  async function handleExportAllPagesAsImages(format: PageImageFormat) {
    if (pageCount < 1) return;
    await handleExportPagesAsImages(
      Array.from({ length: pageCount }, (_, index) => index + 1),
      format
    );
  }

  async function handleMovePages(pageNumbers: number[], targetPageNumber: number) {
    const current = pdfBytesRef.current;
    if (!current) return;
    try {
      const withAnnotations = await applyAnnotationsToPdf(current, annotations);
      const updated = await movePagesTo(withAnnotations, pageNumbers, targetPageNumber);
      if (updated === withAnnotations) return;
      setAnnotations([]);
      setSelectedAnnotationId(null);
      annotationUndoStack.current = [];
      annotationRedoStack.current = [];
      commitPdfBytes(updated, withAnnotations);
      setCurrentPage(targetPageNumber);
    } catch (error) {
      notify("No se pudieron mover las páginas", errorMessage(error));
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
    setDocumentUnlocked(false);
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

  async function checkForUpdates(silent: boolean) {
    if (checkingUpdatesRef.current) return;
    checkingUpdatesRef.current = true;
    try {
      setStatus("Buscando actualizaciones...");
      const update = await check();
      if (!update) {
        setStatus("La aplicación está actualizada");
        if (!silent) notify("Sin actualizaciones", "Tienes la versión más reciente de SolutionsPDF.");
        return;
      }

      setStatus(`Actualización ${update.version} disponible`);
      if (cancelledUpdateVersionRef.current !== update.version) setUpdateOffer(update);
    } catch (error) {
      setStatus("No se pudo buscar actualizaciones");
      if (!silent) notify("No se pudieron buscar actualizaciones", errorMessage(error));
    } finally {
      checkingUpdatesRef.current = false;
    }
  }

  function handleCheckUpdates() {
    void checkForUpdates(false);
  }

  async function handleInstallUpdate() {
    if (!updateOffer || updateInstalling) return;
    const update = updateOffer;
    setUpdateInstalling(true);
    setStatus("Descargando actualización...");
    try {
      await update.downloadAndInstall();
      setStatus("Reiniciando SolutionsPDF...");
      await relaunch();
    } catch (error) {
      setUpdateInstalling(false);
      notify("No se pudo instalar la actualización", errorMessage(error));
    }
  }

  function handleCancelUpdate() {
    if (!updateOffer) return;
    cancelledUpdateVersionRef.current = updateOffer.version;
    setUpdateOffer(null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkForUpdates(true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

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
    if (!pdfFile || printRequest > 0) return;
    if (pageCount === 0) {
      notify("Documento no disponible", "Espera a que termine de cargar antes de imprimir.");
      return;
    }
    setPrintRequest((request) => request + 1);
  }

  function handlePrintReady(request: number) {
    if (request !== printRequest) return;
    try {
      window.print();
    } finally {
      setPrintRequest(0);
    }
  }

  function handlePrintError(error: Error) {
    if (printRequest === 0) return;
    setPrintRequest(0);
    notify("No se pudo preparar la impresión", errorMessage(error));
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
      case "search-pdf": setPdfSearchRequest((request) => request + 1); break;
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
      case "updates": handleCheckUpdates(); break;
      case "properties": void handleFileProperties(); break;
      case "edit-page": setEditDialogOpen(true); break;
      case "protect": setPdfProtectionDialog({ password: "", confirmation: "", error: null }); break;
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
    let active = true;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow().onDragDropEvent((event) => {
      const { payload } = event;
      if (payload.type === "enter") {
        setDropActive(true);
      } else if (payload.type === "leave") {
        setDropActive(false);
      } else if (payload.type === "drop") {
        setDropActive(false);
        if (payload.paths.length !== 1) {
          notify("No se pudieron abrir los archivos", "Suelta un solo archivo PDF a la vez.");
        } else if (!payload.paths[0].toLowerCase().endsWith(".pdf")) {
          notify("Formato no compatible", "Solo puedes abrir archivos PDF.");
        } else {
          void loadDocument(payload.paths[0]);
        }
      }
    }).then((stopListening) => {
      if (!active) {
        stopListening();
        return;
      }
      unlisten = stopListening;
    }).catch((error: unknown) => {
      if (active) notify("No se pudo activar arrastrar y soltar", errorMessage(error));
    });

    return () => {
      active = false;
      setDropActive(false);
      unlisten?.();
    };
  }, [dirty]);

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
      if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
        event.preventDefault();
        if (pdfFile) setPdfSearchRequest((request) => request + 1);
        return;
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
  }, [menu, pdfFile, dirty, pageCount, printRequest, zoom, showThumbnails]);

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

        <nav className="menu" ref={menuRef} aria-label="Menú principal">
          {(["Archivo", "Editar", "Ver", "Ayuda"] as AppMenu[]).map((item) => {
            const items: Record<AppMenu, [string, string, string][]> = {
              Archivo: [["Abrir PDF", "open", "Ctrl+O"], ["Guardar", "save", "Ctrl+S"], ["Guardar como...", "save-as", "Ctrl+Shift+S"], ["Unir PDF...", "merge", ""], ["Proteger PDF...", "protect", ""], ["Imprimir", "print", "Ctrl+P"], ["Propiedades del archivo", "properties", ""], ["Cerrar documento", "close", ""], ["Salir", "exit", ""]],
              Editar: [["Deshacer", "undo", "Ctrl+Z"], ["Rehacer", "redo", "Ctrl+Y"], ["Copiar texto", "copy", "Ctrl+C"], ["Seleccionar todo", "select-all", "Ctrl+A"], ["Buscar documentos...", "search", "Ctrl+F"], ["Buscar dentro del PDF...", "search-pdf", "Ctrl+Espacio"], ["Editar página actual...", "edit-page", ""], ["Preferencias", "preferences", ""]],
              Ver: [[readingMode ? "Salir de modo lectura" : "Modo de lectura", "reading-mode", ""], ["Ajustar a la ventana", "fit", ""], ["Reducir zoom", "zoom-out", "Ctrl+-"], [`Zoom ${zoom}%`, "zoom-reset", "Ctrl+0"], ["Aumentar zoom", "zoom-in", "Ctrl++"], ["Rotar página actual", "rotate-view", ""], [showThumbnails ? "Ocultar miniaturas" : "Mostrar miniaturas", "toggle-panel", ""]],
              Ayuda: [["Manual de usuario (offline)", "manual", ""], ["Acerca de SolutionsPDF", "about", ""], ["Verificar actualizaciones", "updates", ""]],
            };
            return (
              <div className="menu-entry" key={item}>
                <button type="button" aria-haspopup="menu" aria-expanded={menu === item} onClick={() => setMenu((current) => current === item ? null : item)}>{item}</button>
                {menu === item && <div className="menu-dropdown" role="menu" aria-label={item}>
                  {items[item].map(([label, action, shortcut]) => {
                    const needsDocument = ["save", "save-as", "close", "print", "properties", "edit-page", "rotate-view", "search-pdf", "protect"].includes(action);
                    const disabled = (needsDocument && !pdfFile) || (action === "undo" && !canUndo) || (action === "redo" && !canRedo) || (action === "merge" && mergeProgress !== null) || (action === "protect" && protectionInProgress);
                    return <button type="button" key={action} role="menuitem" disabled={disabled} onClick={() => handleMenuAction(action)}>
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
        mergeInProgress={mergeProgress !== null}
        onOptimizePdf={handleOptimizePdf}
        onPrint={handlePrint}
        onExportWord={handleExportWord}
        onExportExcel={handleExportExcel}
        onExportImage={(format) => void handleExportAllPagesAsImages(format)}
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
                type="button"
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
              hasUnsavedChanges={dirty || annotations.length > 0 || documentUnlocked}
              printRequest={printRequest}
              onPrintReady={handlePrintReady}
              onPrintError={handlePrintError}
              currentPage={currentPage}
              onCurrentPageChange={setCurrentPage}
              onPageCountChange={setPageCount}
              onPageAction={handlePageAction}
              onRotatePages={handleRotatePages}
              onDeletePages={handleDeletePages}
              onExtractPages={handleExtractPages}
              onMovePages={handleMovePages}
              onExportPagesAsImages={handleExportPagesAsImages}
              onSplitRanges={() => {
                setSplitRanges("");
                setSplitError(null);
                setSplitDialogOpen(true);
              }}
              onExportEachPage={handleExportEachPage}
              onMovePage={handleMovePage}
              zoom={zoom}
              onZoomChange={(nextZoom) => updatePreferences({ zoom: nextZoom })}
              pdfSearchRequest={pdfSearchRequest}
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

      {mergeProgress && (
        <aside className="merge-progress" role="status" aria-live="polite">
          <div className="merge-progress-heading">
            <LoaderCircle className="merge-progress-spinner" size={17} aria-hidden="true" />
            <strong>{mergeProgress.phase === "loading" ? "Preparando PDF" : "Uniendo PDF"}</strong>
          </div>
          <p>
            {mergeProgress.phase === "loading"
              ? mergeProgress.fileName
                ? `Leyendo ${mergeProgress.current + 1} de ${mergeProgress.total}: ${mergeProgress.fileName}`
                  : mergeProgress.current > 0
                    ? `PDF leídos ${mergeProgress.current} de ${mergeProgress.total}`
                    : `Preparando ${mergeProgress.total} documentos...`
              : mergeProgress.current > 0
                ? `Combinando ${mergeProgress.current} de ${mergeProgress.total} documentos`
                : `Iniciando combinación de ${mergeProgress.total} documentos...`}
          </p>
          <div
            className="merge-progress-track"
            role="progressbar"
            aria-label={mergeProgress.phase === "loading" ? "PDF leídos" : "PDF combinados"}
            aria-valuemin={0}
            aria-valuemax={mergeProgress.total}
            aria-valuenow={mergeProgress.current}
          >
            <span style={{ width: `${(mergeProgress.current / mergeProgress.total) * 100}%` }} />
          </div>
        </aside>
      )}

      {compressionProgress && (
        <aside className="merge-progress" role="status" aria-live="polite">
          <div className="merge-progress-heading">
            <LoaderCircle className="merge-progress-spinner" size={17} aria-hidden="true" />
            <strong>Comprimiendo PDF</strong>
          </div>
          <p>
            {compressionProgress.total > 0
              ? `Procesando página ${compressionProgress.current} de ${compressionProgress.total}`
              : "Preparando páginas..."}
          </p>
          <div
            className="merge-progress-track"
            role="progressbar"
            aria-label="Páginas comprimidas"
            aria-valuemin={0}
            aria-valuemax={compressionProgress.total}
            aria-valuenow={compressionProgress.current}
          >
            <span style={{ width: `${compressionProgress.total ? (compressionProgress.current / compressionProgress.total) * 100 : 0}%` }} />
          </div>
        </aside>
      )}

      {wordProgress && (
        <aside className="merge-progress" role="status" aria-live="polite">
          <div className="merge-progress-heading">
            <LoaderCircle className="merge-progress-spinner" size={17} aria-hidden="true" />
            <strong>Exportando a Word</strong>
          </div>
          <p>
            {wordProgress.current > 0
              ? `Procesando página ${wordProgress.current} de ${wordProgress.total}`
              : "Preparando páginas..."}
          </p>
          <div
            className="merge-progress-track"
            role="progressbar"
            aria-label="Páginas exportadas"
            aria-valuemin={0}
            aria-valuemax={wordProgress.total}
            aria-valuenow={wordProgress.current}
          >
            <span style={{ width: `${wordProgress.total ? (wordProgress.current / wordProgress.total) * 100 : 0}%` }} />
          </div>
          <div className="dialog-footer" style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={handleCancelWordExport}>Cancelar exportación</button>
          </div>
        </aside>
      )}

      {excelProgress && (
        <aside className="merge-progress" role="status" aria-live="polite">
          <div className="merge-progress-heading">
            <LoaderCircle className="merge-progress-spinner" size={17} aria-hidden="true" />
            <strong>Exportando a Excel</strong>
          </div>
          <p>
            {excelProgress.current > 0
              ? `Procesando página ${excelProgress.current} de ${excelProgress.total}`
              : "Preparando páginas..."}
          </p>
          <div
            className="merge-progress-track"
            role="progressbar"
            aria-label="Páginas exportadas a Excel"
            aria-valuemin={0}
            aria-valuemax={excelProgress.total}
            aria-valuenow={excelProgress.current}
          >
            <span style={{ width: `${excelProgress.total ? (excelProgress.current / excelProgress.total) * 100 : 0}%` }} />
          </div>
          <div className="dialog-footer" style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={handleCancelExcelExport}>Cancelar exportación</button>
          </div>
        </aside>
      )}

      {wordDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setWordDialogOpen(false); }}>
          <form className="app-dialog compression-dialog" role="dialog" aria-modal="true" aria-labelledby="word-dialog-title" onSubmit={(event) => void handleRunWordExport(event)}>
            <h2 id="word-dialog-title">Exportar a Word</h2>
            <p>Elige cómo quieres que quede el documento. Al terminar se abrirá automáticamente.</p>
            <div className="compression-options" role="radiogroup" aria-label="Modo de exportación">
              {([
                { id: "faithful", title: "FIEL AL PDF (RECOMENDADO)", description: "Mismo diseño y texto editable" },
                { id: "image", title: "IMAGEN IDÉNTICA", description: "Cada página igual al PDF, sin texto editable" },
                { id: "text", title: "SOLO TEXTO", description: "Texto con formato, sin imágenes ni gráficos" },
              ] as const).map((option) => (
                <label className={`compression-option ${wordMode === option.id ? "selected" : ""}`} key={option.id}>
                  <input
                    type="radio"
                    name="word-mode"
                    value={option.id}
                    checked={wordMode === option.id}
                    onChange={() => setWordMode(option.id)}
                  />
                  <span className="compression-option-copy">
                    <strong>{option.title}</strong>
                    <span>{option.description}</span>
                  </span>
                  {wordMode === option.id && <Check className="compression-option-check" size={20} aria-hidden="true" />}
                </label>
              ))}
            </div>
            <label className="signature-label" htmlFor="word-pages-input">Páginas (vacío = todas)</label>
            <input
              id="word-pages-input"
              className="password-input"
              value={wordPages}
              placeholder={`Ej.: 1-3, 5 (el documento tiene ${pageCount})`}
              onChange={(event) => setWordPages(event.target.value)}
            />
            <label className="signature-label" htmlFor="word-quality-input">Calidad del fondo</label>
            <select
              id="word-quality-input"
              className="password-input"
              value={wordQuality}
              onChange={(event) => setWordQuality(event.target.value as WordExportQuality)}
            >
              <option value="high">Alta (recomendada)</option>
              <option value="medium">Media</option>
              <option value="low">Baja (archivo más liviano)</option>
            </select>
            <label className="signature-label" htmlFor="word-ocr-input">
              <input
                id="word-ocr-input"
                type="checkbox"
                checked={wordUseOcr}
                onChange={(event) => setWordUseOcr(event.target.checked)}
                style={{ marginRight: "0.5rem" }}
              />
              OCR para páginas escaneadas (más lento)
            </label>
            <div className="dialog-footer">
              <button type="button" onClick={() => setWordDialogOpen(false)}>Cancelar</button>
              <button type="submit" className="dialog-primary">Exportar y abrir</button>
            </div>
          </form>
        </div>
      )}

      {excelDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setExcelDialogOpen(false); }}>
          <form className="app-dialog compression-dialog" role="dialog" aria-modal="true" aria-labelledby="excel-dialog-title" onSubmit={(event) => void handleRunExcelExport(event)}>
            <h2 id="excel-dialog-title">Exportar a Excel</h2>
            <p>Se creará una hoja por página. Las filas y columnas se detectan automáticamente; revisa y ajusta el resultado en Excel.</p>
            <label className="signature-label" htmlFor="excel-pages-input">Páginas (vacío = todas)</label>
            <input
              id="excel-pages-input"
              className="password-input"
              value={excelPages}
              placeholder={`Ej.: 1-3, 5 (el documento tiene ${pageCount})`}
              onChange={(event) => setExcelPages(event.target.value)}
            />
            <label className="signature-label" htmlFor="excel-ocr-input">
              <input
                id="excel-ocr-input"
                type="checkbox"
                checked={excelUseOcr}
                onChange={(event) => setExcelUseOcr(event.target.checked)}
                style={{ marginRight: "0.5rem" }}
              />
              OCR para páginas escaneadas en español (más lento)
            </label>
            <p className="compression-warning">El PDF no siempre contiene tablas estructuradas; la conversión reconstruye celdas según la posición del texto. Las páginas escaneadas necesitan OCR para extraer contenido.</p>
            <div className="dialog-footer">
              <button type="button" onClick={() => setExcelDialogOpen(false)}>Cancelar</button>
              <button type="submit" className="dialog-primary">Exportar y abrir</button>
            </div>
          </form>
        </div>
      )}

      {compressionDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCompressionDialogOpen(false); }}>
          <section className="app-dialog compression-dialog" role="dialog" aria-modal="true" aria-labelledby="compression-dialog-title">
            <h2 id="compression-dialog-title">Comprimir PDF</h2>
            <p>Elige cuánto reducir el tamaño del archivo.</p>
            <div className="compression-options" role="radiogroup" aria-label="Nivel de compresión">
              {([
                { id: "extreme", title: "COMPRESIÓN EXTREMA", description: "Menos calidad, alta compresión" },
                { id: "recommended", title: "COMPRESIÓN RECOMENDADA", description: "Buena calidad, buena compresión" },
                { id: "low", title: "BAJA COMPRESIÓN", description: "Alta calidad, menos compresión" },
              ] as const).map((option) => (
                <label className={`compression-option ${compressionLevel === option.id ? "selected" : ""}`} key={option.id}>
                  <input
                    type="radio"
                    name="compression-level"
                    value={option.id}
                    checked={compressionLevel === option.id}
                    onChange={() => setCompressionLevel(option.id)}
                  />
                  <span className="compression-option-copy">
                    <strong>{option.title}</strong>
                    <span>{option.description}</span>
                  </span>
                  {compressionLevel === option.id && <Check className="compression-option-check" size={20} aria-hidden="true" />}
                </label>
              ))}
            </div>
            <p className="compression-warning">Las páginas se guardarán como imágenes; el texto dejará de ser seleccionable o buscable. El PDF original no se modifica.</p>
            <div className="dialog-footer">
              <button type="button" onClick={() => setCompressionDialogOpen(false)}>Cancelar</button>
              <button type="button" className="dialog-primary" onClick={() => void handleCompressPdf()}>Comprimir PDF</button>
            </div>
          </section>
        </div>
      )}

      {splitDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSplitDialogOpen(false);
        }}>
          <form className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="split-ranges-title" onSubmit={(event) => void handleSplitRanges(event)}>
            <h2 id="split-ranges-title">Dividir PDF por rangos</h2>
            <p>Indica qué páginas incluir en cada archivo. Se creará un PDF nuevo por rango; el original no se modifica.</p>
            <label className="signature-label" htmlFor="split-ranges-input">Rangos de páginas</label>
            <input
              id="split-ranges-input"
              className="password-input"
              value={splitRanges}
              onChange={(event) => {
                setSplitRanges(event.target.value);
                setSplitError(null);
              }}
              placeholder="Ejemplo: 1-3, 5, 7-9"
              aria-describedby="split-ranges-help"
              autoFocus
            />
            <p id="split-ranges-help">Este documento tiene {pageCount} páginas. Los rangos no deben solaparse.</p>
            {splitError && <p className="password-error" role="alert">{splitError}</p>}
            <div className="dialog-footer">
              <button type="button" onClick={() => setSplitDialogOpen(false)}>Cancelar</button>
              <button type="submit" className="dialog-primary" disabled={!splitRanges.trim()}>Dividir y guardar</button>
            </div>
          </form>
        </div>
      )}

      {editDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditDialogOpen(false); }}>
          <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title">
            <h2 id="edit-dialog-title">Editar página {currentPage}</h2>
            <p>Los cambios se aplican al PDF y se pueden deshacer.</p>
            <div className="edit-actions">
              <button type="button" onClick={() => runPageAction("rotate-left")}><RotateCcw size={17} /> Rotar a la izquierda</button>
              <button type="button" onClick={() => runPageAction("rotate-right")}><RotateCw size={17} /> Rotar a la derecha</button>
              <button type="button" onClick={() => runPageAction("move-up")} disabled={currentPage <= 1}><ArrowUp size={17} /> Mover hacia arriba</button>
              <button type="button" onClick={() => runPageAction("move-down")} disabled={currentPage >= pageCount}><ArrowDown size={17} /> Mover hacia abajo</button>
              <button type="button" className="dialog-danger" onClick={() => runPageAction("delete")}><Trash2 size={17} /> Eliminar página</button>
            </div>
            <div className="dialog-footer"><span>Página {currentPage} de {pageCount}</span><button type="button" onClick={() => setEditDialogOpen(false)}>Cerrar</button></div>
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
            <div className="dialog-footer"><span>Ctrl+Enter para insertar</span><button type="button" onClick={() => setTextTarget(null)}>Cancelar</button><button type="button" className="dialog-primary" onClick={() => void handleAddText()} disabled={!textInput.trim()}>Agregar</button></div>
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
                  <button type="button" className="signature-choice" onClick={() => chooseSignature(signature.dataUrl)} title={`Usar ${signature.name}`}>
                    <img src={signature.dataUrl} alt="" />
                    <span>{signature.name}</span>
                  </button>
                  <button type="button" className="signature-delete" aria-label={`Eliminar ${signature.name}`} title="Eliminar firma" onClick={() => {
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
            <div className="dialog-footer"><button type="button" onClick={clearSignatureCanvas}><Eraser size={15} /> Limpiar</button><span /><button type="button" onClick={() => setSignatureDialogOpen(false)}>Cancelar</button><button type="button" className="dialog-primary" onClick={saveSignature}><Check size={15} /> Guardar y usar</button></div>
          </section>
        </div>
      )}

      {closeConfirmationOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-confirmation-title">
            <h2 id="close-confirmation-title">¿Guardar los cambios?</h2>
            <p>Hay cambios sin guardar en {fileName ? `“${fileName}”` : "el documento"}.</p>
            <div className="dialog-footer">
              <button type="button" onClick={() => setCloseConfirmationOpen(false)}>Cancelar</button>
              <button type="button" onClick={() => void finishWindowClose()}>Descartar</button>
              <button type="button" className="dialog-primary" onClick={() => void handleSave().then(async (saved) => { if (saved) await finishWindowClose(); })}>Guardar</button>
            </div>
          </section>
        </div>
      )}
      {pdfPasswordDialog && (
        <div className="dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) cancelPdfPasswordRequest();
        }}>
          <form className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="pdf-password-title" onSubmit={submitPdfPassword}>
            <h2 id="pdf-password-title">PDF protegido con contraseña</h2>
            <p>
              Ingresa la contraseña de “{pdfPasswordDialog.fileName}”. Se usará solo en este dispositivo y no se guardará.
              Al guardar una copia o unir documentos, el resultado quedará sin contraseña; el original no se modifica salvo que confirmes sobrescribirlo.
            </p>
            <label className="signature-label" htmlFor="pdf-password">Contraseña del PDF</label>
            <input
              id="pdf-password"
              className="password-input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={pdfPasswordDialog.password}
              onChange={(event) => setPdfPasswordDialog({ ...pdfPasswordDialog, password: event.target.value })}
            />
            {pdfPasswordDialog.error && <p className="password-error" role="alert">{pdfPasswordDialog.error}</p>}
            <div className="dialog-footer">
              <button type="button" onClick={cancelPdfPasswordRequest}>Cancelar</button>
              <button className="dialog-primary" type="submit">Desbloquear</button>
            </div>
          </form>
        </div>
      )}
      {pdfProtectionDialog && (
        <div className="dialog-backdrop" onMouseDown={(event) => {
          if (!protectionInProgress && event.target === event.currentTarget) setPdfProtectionDialog(null);
        }}>
          <form className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="pdf-protection-title" onSubmit={handleProtectPdf}>
            <h2 id="pdf-protection-title">Proteger PDF con contraseña</h2>
            <p>
              La contraseña será necesaria para abrir el archivo. Al desbloquearlo, se permite imprimir, editar y copiar.
              Se guardará una copia protegida con cifrado AES-256; el original no se modificará.
            </p>
            <label className="signature-label" htmlFor="pdf-protection-password">Nueva contraseña</label>
            <input
              id="pdf-protection-password"
              className="password-input"
              type="password"
              autoComplete="new-password"
              autoFocus
              minLength={8}
              maxLength={127}
              required
              disabled={protectionInProgress}
              value={pdfProtectionDialog.password}
              onChange={(event) => setPdfProtectionDialog({ ...pdfProtectionDialog, password: event.target.value, error: null })}
            />
            <label className="signature-label password-confirm-label" htmlFor="pdf-protection-confirmation">Confirmar contraseña</label>
            <input
              id="pdf-protection-confirmation"
              className="password-input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={127}
              required
              disabled={protectionInProgress}
              value={pdfProtectionDialog.confirmation}
              onChange={(event) => setPdfProtectionDialog({ ...pdfProtectionDialog, confirmation: event.target.value, error: null })}
            />
            {pdfProtectionDialog.error && <p className="password-error" role="alert">{pdfProtectionDialog.error}</p>}
            <div className="dialog-footer">
              <span>{protectionInProgress ? "Cifrando PDF…" : "Mínimo 8 caracteres"}</span>
              <button type="button" disabled={protectionInProgress} onClick={() => setPdfProtectionDialog(null)}>Cancelar</button>
              <button className="dialog-primary" type="submit" disabled={protectionInProgress}>
                {protectionInProgress && <LoaderCircle className="merge-progress-spinner" size={14} aria-hidden="true" />}
                {protectionInProgress ? "Protegiendo…" : "Proteger y guardar"}
              </button>
            </div>
          </form>
        </div>
      )}
      {updateOffer && (
        <section className="update-notice" role="status" aria-live="polite">
          <div className="update-notice-heading">
            {updateInstalling
              ? <LoaderCircle className="merge-progress-spinner" size={18} aria-hidden="true" />
              : <Info size={18} aria-hidden="true" />}
            <strong>{updateInstalling ? "Instalando actualización…" : "Actualización disponible"}</strong>
          </div>
          <p>SolutionsPDF V.{updateOffer.version} ya está disponible.</p>
          <div className="update-notice-actions">
            <button type="button" onClick={handleCancelUpdate} disabled={updateInstalling}>Cancelar</button>
            <button type="button" onClick={() => setUpdateOffer(null)} disabled={updateInstalling}>Más tarde</button>
            <button type="button" className="dialog-primary" onClick={() => void handleInstallUpdate()} disabled={updateInstalling}>
              {updateInstalling ? "Descargando…" : "Descargar"}
            </button>
          </div>
        </section>
      )}
      {dialog && (
        <div className="dialog-backdrop notice-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <section className="app-dialog notice-dialog" role="alertdialog" aria-modal="true" aria-labelledby="notice-title" aria-describedby="notice-message">
            <div className="notice-heading">
              <span className="notice-icon"><Info size={21} strokeWidth={2} /></span>
              <div className="notice-heading-copy">
                <span className="notice-kicker">AVISO</span>
                <h2 id="notice-title">{dialog.title}</h2>
              </div>
            </div>
            <p id="notice-message" className="dialog-message">{dialog.body}</p>
            <div className="dialog-footer"><span /><button type="button" className="dialog-primary" onClick={() => setDialog(null)}>Aceptar</button></div>
          </section>
        </div>
      )}

      {manualOpen && <UserManual onClose={() => setManualOpen(false)} />}

      {properties && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProperties(null); }}>
          <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="properties-title">
            <h2 id="properties-title">{properties.title}</h2>
            <p className="dialog-message">{properties.body}</p>
            <div className="dialog-footer"><span /><button type="button" className="dialog-primary" onClick={() => setProperties(null)}>Cerrar</button></div>
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
            <div className="dialog-footer"><span>Se guarda en este dispositivo.</span><button type="button" className="dialog-primary" onClick={() => setPreferencesOpen(false)}>Listo</button></div>
          </section>
        </div>
      )}

      {dropActive && (
        <div className="file-drop-overlay" role="status" aria-live="polite">
          <FileText size={38} aria-hidden="true" />
          <span>Suelta un PDF para abrirlo</span>
        </div>
      )}

    </div>
  );
}

export default App;