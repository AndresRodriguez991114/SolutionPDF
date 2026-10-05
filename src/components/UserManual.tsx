import { useState } from "react";
import { X } from "lucide-react";

interface ManualTopic {
  title: string;
  body: string;
}

interface ManualSection {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  introduction: string;
  topics: ManualTopic[];
}

const sections: ManualSection[] = [
  {
    id: "inicio",
    label: "Primeros pasos",
    eyebrow: "01 / INICIO",
    title: "Trabaja con tus PDF",
    introduction: "SolutionsPDF reúne lectura, organización y anotación en una sola ventana. Abre un documento para comenzar; tus archivos permanecen en este dispositivo.",
    topics: [
      { title: "Abrir un documento", body: "Pulsa Abrir PDF en la barra de herramientas o elige Archivo > Abrir PDF. También puedes usar Ctrl+O. Los documentos que abras aparecerán en Documentos locales para volver a abrirlos rápidamente." },
      { title: "Recorrer el documento", body: "Desplázate por las páginas en el área central. El indicador superior muestra la página actual y el total. En el panel Páginas, selecciona una miniatura para saltar directamente a ella." },
      { title: "Guardar el trabajo", body: "Usa Archivo > Guardar o Ctrl+S para guardar los cambios en el archivo abierto. Guardar como... crea una copia en otra ubicación. Si intentas cerrar con cambios pendientes, la app te preguntará si quieres guardarlos." },
    ],
  },
  {
    id: "archivos",
    label: "Archivos",
    eyebrow: "02 / DOCUMENTOS",
    title: "Abrir, unir e imprimir",
    introduction: "Las operaciones de archivo están en la barra de herramientas y en el menú Archivo. Usa Guardar como... si quieres conservar intacto el original.",
    topics: [
      { title: "Documentos locales", body: "El panel izquierdo muestra archivos abiertos recientemente. Selecciona uno para abrirlo y usa la lupa para filtrar la lista. Se guardan rutas locales, no se suben los PDF a la nube." },
      { title: "Unir PDF", body: "Pulsa Unir PDF y selecciona los documentos que quieras combinar. Si hay un PDF abierto, también se incluye. La app genera un archivo nuevo y te permite elegir dónde guardarlo." },
      { title: "Optimizar", body: "Pulsa Optimizar PDF para guardar una copia con una estructura interna más compacta. Si el resultado no es más pequeño, no se crea una copia mayor. Las imágenes no se recomprimen." },
      { title: "Imprimir y propiedades", body: "Pulsa Imprimir o usa Ctrl+P para abrir las opciones de impresión. En Archivo > Propiedades del archivo puedes consultar información del PDF abierto." },
    ],
  },
  {
    id: "paginas",
    label: "Páginas",
    eyebrow: "03 / ORGANIZACIÓN",
    title: "Ordena y modifica páginas",
    introduction: "El botón Páginas abre las acciones para la página actual. También puedes trabajar directamente con las miniaturas del panel lateral.",
    topics: [
      { title: "Rotar, mover o eliminar", body: "En Páginas puedes rotar la página a izquierda o derecha, moverla una posición arriba o abajo, o eliminarla. Las mismas opciones aparecen con clic derecho o en el menú de tres puntos de una miniatura. La app pide confirmación antes de eliminar." },
      { title: "Reordenar miniaturas", body: "Arrastra una miniatura y suéltala en la posición deseada para mover la página. Haz clic en una miniatura para navegar hasta ella. No se puede mover una página más allá de la primera o la última." },
      { title: "Deshacer y rehacer", body: "Usa Editar > Deshacer (Ctrl+Z) y Rehacer (Ctrl+Y) para recorrer los cambios de páginas y anotaciones disponibles en el historial." },
    ],
  },
  {
    id: "anotar",
    label: "Texto y firmas",
    eyebrow: "04 / ANOTACIÓN",
    title: "Edita, resalta y firma",
    introduction: "Elige una herramienta en la barra y después interactúa con la página. Guarda el documento para incorporar los cambios al PDF.",
    topics: [
      { title: "Editar o agregar texto", body: "Activa Editar texto. Selecciona texto existente para reemplazarlo o haz clic en la página para insertar una anotación. Puedes moverla arrastrando, cambiar su tamaño desde el control de selección y editarla con doble clic. Ctrl+Enter confirma el texto." },
      { title: "Límites de edición", body: "La edición del texto original depende de que PDFium pueda reconocer el texto y la fuente. En documentos escaneados, texto convertido en imagen o fuentes no disponibles, la edición puede fallar; puedes agregar una anotación de texto sobre la página." },
      { title: "Resaltar", body: "Activa Resaltar y selecciona texto en la página. Selecciona el resaltado para moverlo o eliminarlo." },
      { title: "Firmar", body: "Pulsa Firmar para dibujar una firma nueva o elegir una guardada. Pulsa Guardar y usar y haz clic en la página para colocarla. Las firmas guardadas se conservan localmente en este dispositivo." },
    ],
  },
  {
    id: "vista",
    label: "Vista y paneles",
    eyebrow: "05 / VISUALIZACIÓN",
    title: "Ajusta el espacio de trabajo",
    introduction: "La vista se adapta a tu forma de trabajar y recuerda tus preferencias en este dispositivo.",
    topics: [
      { title: "Zoom del PDF", body: "En Ver, usa Aumentar zoom, Reducir zoom o Ajustar a la ventana. Ctrl++ acerca, Ctrl+- aleja y Ctrl+0 restablece el 100%. La rueda sobre la hoja ajusta el zoom; fuera de ella desplaza el documento." },
      { title: "Paneles laterales", body: "Usa la flecha de cada borde para contraer o expandir Documentos locales y Páginas por separado. Arrastra el divisor para cambiar el ancho. El estado y el ancho se guardan automáticamente." },
      { title: "Miniaturas y modo de lectura", body: "Ver > Mostrar/Ocultar miniaturas controla el panel de páginas. En Preferencias puedes decidir si aparecen al abrir un documento. Modo de lectura oculta las barras de la app para dar más espacio al documento." },
      { title: "Preferencias", body: "Abre Archivo > Preferencias para elegir el zoom inicial y si se muestran miniaturas al abrir un PDF." },
    ],
  },
  {
    id: "atajos",
    label: "Atajos y ayuda",
    eyebrow: "06 / REFERENCIA",
    title: "Atajos de teclado",
    introduction: "Los atajos principales también aparecen junto a las acciones correspondientes en los menús.",
    topics: [
      { title: "Buscar en un PDF", body: "Pulsa Ctrl+Espacio, escribe el texto y presiona Enter. El panel muestra fragmentos, coincidencias por página y resalta los resultados; selecciónalos o usa las flechas para recorrerlos. Ctrl+F sigue buscando documentos recientes. Los PDF escaneados sin texto reconocible requieren OCR y no se pueden buscar." },
      { title: "Archivos y edición", body: "Ctrl+O abrir · Ctrl+S guardar · Ctrl+Shift+S guardar como · Ctrl+Z deshacer · Ctrl+Y rehacer · Ctrl+P imprimir." },
      { title: "Zoom y texto", body: "Ctrl++ acercar · Ctrl+- alejar · Ctrl+0 restablecer zoom · Ctrl+Enter confirmar texto. En algunos teclados, para escribir + hay que mantener Shift." },
      { title: "Procesamiento local", body: "La lectura, edición, unión y optimización se procesan en este dispositivo. Se necesita conexión a Internet únicamente para buscar actualizaciones." },
    ],
  },
];

interface UserManualProps {
  onClose: () => void;
}

function UserManual({ onClose }: UserManualProps) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0].id);
  const activeSection = sections.find((section) => section.id === activeSectionId) || sections[0];

  return (
    <div className="dialog-backdrop manual-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="app-dialog user-manual" role="dialog" aria-modal="true" aria-labelledby="manual-title">
        <header className="manual-header">
          <div>
            <span className="manual-kicker">GUÍA DE USO</span>
            <h2 id="manual-title">Manual de SolutionsPDF</h2>
          </div>
          <button type="button" className="manual-close" aria-label="Cerrar manual" title="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="manual-layout">
          <nav className="manual-nav" aria-label="Secciones del manual" role="tablist" aria-orientation="vertical">
            {sections.map((section) => (
              <button
                key={section.id}
                id={`manual-tab-${section.id}`}
                type="button"
                role="tab"
                aria-selected={activeSectionId === section.id}
                aria-controls="manual-panel"
                className={activeSectionId === section.id ? "active" : ""}
                onClick={() => setActiveSectionId(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          <article
            className="manual-content"
            id="manual-panel"
            role="tabpanel"
            aria-labelledby={`manual-tab-${activeSection.id}`}
            key={activeSection.id}
          >
            <span className="manual-eyebrow">{activeSection.eyebrow}</span>
            <h3>{activeSection.title}</h3>
            <p className="manual-introduction">{activeSection.introduction}</p>
            <div className="manual-topics">
              {activeSection.topics.map((topic, index) => (
                <section className="manual-topic" key={topic.title}>
                  <span className="manual-topic-index">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h4>{topic.title}</h4>
                    <p>{topic.body}</p>
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>

        <footer className="manual-footer">
          <span>Los cambios se guardan en el PDF al usar Guardar.</span>
          <button type="button" className="dialog-primary" onClick={onClose}>Listo</button>
        </footer>
      </section>
    </div>
  );
}

export default UserManual;