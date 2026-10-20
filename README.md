# SolutionsPDF

SolutionsPDF es una aplicación de escritorio para leer, organizar, editar y
anotar documentos PDF. Está construida con React, TypeScript, Vite y Tauri, y
prioriza el procesamiento local de los archivos.

## Funciones actuales

- Abrir PDFs locales y consultar archivos recientes.
- Navegar por páginas con miniaturas, zoom y búsqueda de texto.
- Rotar, mover y eliminar páginas.
- Editar o agregar texto, resaltar contenido y colocar firmas.
- Unir, comprimir y proteger documentos con contraseña.
- Guardar, guardar como e imprimir.
- Recuperar anotaciones editables mientras el archivo original no cambie.
- Buscar actualizaciones desde la aplicación.

Consulta [ROADMAP.md](./ROADMAP.md) para ver las mejoras planificadas.

## Requisitos

- Node.js 20 o superior.
- npm.
- Rust y Cargo.
- Dependencias de desarrollo de Tauri para Windows.

Para configurar el entorno de escritorio, sigue la
[guía oficial de Tauri](https://v2.tauri.app/start/prerequisites/).

## Desarrollo

Instala las dependencias:

```bash
npm install
```

Inicia la aplicación web:

```bash
npm run dev
```

Inicia la aplicación de escritorio con Tauri:

```bash
npm run tauri dev
```

## Verificación

Ejecuta las pruebas de utilidades frontend:

```bash
npm test
```

Ejecuta TypeScript y la compilación de producción:

```bash
npm run build
```

Las pruebas Rust del backend se pueden ejecutar desde `src-tauri`:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Arquitectura

### Interfaz

- `src/App.tsx` coordina el documento abierto, el historial, las preferencias,
  los diálogos y las operaciones de archivo.
- `src/PDF/PdfViewer.tsx` renderiza el documento, miniaturas, navegación,
  búsqueda y la interacción con anotaciones.
- `src/PDF/pdfUtils.ts` contiene operaciones PDF reutilizables como mover,
  rotar, unir, comprimir y aplicar anotaciones.
- `src/components` contiene la barra de herramientas, paneles, manual y barra
  de estado.

### Aplicación nativa

- `src-tauri/src/lib.rs` expone comandos nativos para guardar, desbloquear,
  proteger y editar PDFs mediante PDFium.
- `src-tauri/src/main.rs` inicia la aplicación en producción.
- `src-tauri/pdf-thumbnailer` contiene el componente nativo de miniaturas para
  la integración con Windows.

### Datos locales y privacidad

Los PDFs se leen y procesan en el dispositivo. Las rutas recientes y las
preferencias se almacenan localmente en `localStorage`; el estado editable y
las anotaciones se guardan en IndexedDB. La aplicación solo necesita conexión
para consultar actualizaciones.

## Configuración recomendada del IDE

- [VS Code](https://code.visualstudio.com/)
- [Extensión Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
