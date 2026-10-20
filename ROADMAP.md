# Roadmap de SolutionsPDF

Lista de mejoras propuestas para avanzar paso a paso. Marca cada elemento con `[x]`
cuando esté terminado.

## Fase 1: Base y calidad

- [x] Actualizar el `README.md` con propósito, funciones, instalación y compilación.
- [x] Documentar la arquitectura de React, Tauri, Rust y procesamiento local.
- [x] Añadir un comando `test` para ejecutar las pruebas del proyecto.
- [x] Crear pruebas frontend para apertura y cierre de documentos.
- [x] Crear pruebas para guardar, guardar como y descartar cambios.
- [x] Crear pruebas para deshacer y rehacer.
- [x] Crear pruebas para anotaciones y resaltados en las utilidades PDF.
- [x] Crear pruebas de interfaz para herramientas, panel de documentos y estado del documento.
- [x] Crear prueba de redimensionado de paneles mediante teclado.
- [x] Crear pruebas de interfaz para firmas y resaltados.
- [x] Crear pruebas para unión de PDFs.
- [x] Crear pruebas para compresión y protección de PDFs.
- [x] Extraer y probar preferencias, archivos recientes y mensajes de error.
- [x] Revisar etiquetas, roles y anuncios de estado en las superficies principales.
- [x] Revisar foco, navegación por teclado, contraste base y lectores de pantalla en las superficies principales.
- [x] Revisar mensajes de error y estados de carga en las operaciones principales.

## Fase 2: Flujo de trabajo con páginas

- [x] Añadir arrastrar y soltar PDFs dentro de la ventana.
- [ ] Permitir seleccionar varias miniaturas a la vez.
- [ ] Rotar varias páginas en una sola operación.
- [ ] Eliminar varias páginas en una sola operación.
- [ ] Extraer páginas seleccionadas a un nuevo PDF.
- [ ] Dividir un PDF por rangos de páginas.
- [ ] Crear un PDF separado por cada página.
- [ ] Reordenar grupos de páginas.
- [ ] Añadir exportación de páginas como PNG o JPG.
- [ ] Añadir caché y renderizado virtualizado para miniaturas.

## Fase 3: Varios documentos

- [ ] Añadir pestañas para abrir varios PDFs.
- [ ] Permitir cerrar una pestaña sin cerrar la aplicación.
- [ ] Mantener cambios y estado de cada documento por separado.
- [ ] Copiar páginas entre documentos abiertos.
- [ ] Mover páginas entre documentos abiertos.
- [ ] Comparar dos documentos lado a lado.
- [ ] Permitir seleccionar varios archivos desde el explorador para unirlos.

## Fase 4: OCR y búsqueda

- [ ] Investigar una solución OCR que funcione localmente.
- [ ] Añadir selección de idioma para OCR.
- [ ] Reconocer texto en documentos escaneados.
- [ ] Crear una capa de texto seleccionable sobre las páginas.
- [ ] Permitir buscar texto reconocido.
- [ ] Permitir editar texto reconocido.
- [ ] Mostrar claramente cuándo un documento no tiene texto reconocible.
- [ ] Añadir progreso y cancelación para OCR en documentos grandes.

## Fase 5: Edición y anotaciones

- [ ] Añadir subrayado.
- [ ] Añadir tachado.
- [ ] Añadir notas adhesivas y comentarios.
- [ ] Añadir dibujo libre.
- [ ] Añadir líneas, flechas, rectángulos y círculos.
- [ ] Permitir configurar color, grosor y opacidad.
- [ ] Crear un panel con la lista de anotaciones.
- [ ] Mostrar autor y fecha de cada comentario.
- [ ] Permitir responder o eliminar comentarios.
- [ ] Mejorar la edición de texto en documentos con fuentes o diseños complejos.

## Fase 6: Seguridad y privacidad

- [ ] Añadir una herramienta de redacción permanente.
- [ ] Eliminar el texto subyacente al aplicar una redacción.
- [ ] Mostrar una advertencia antes de aplicar redacciones irreversibles.
- [ ] Añadir sanitización de PDFs.
- [ ] Eliminar metadatos, JavaScript, adjuntos y capas ocultas.
- [ ] Permitir editar título, autor, asunto y palabras clave.
- [ ] Configurar permisos de impresión, copia y edición.
- [ ] Mostrar claramente el tipo de cifrado utilizado.
- [ ] Investigar validación de firmas digitales.
- [ ] Investigar firma digital mediante certificado.

## Fase 7: Conversión y productividad

- [ ] Convertir imágenes PNG, JPG y TIFF a PDF.
- [ ] Permitir ordenar imágenes antes de crear el PDF.
- [ ] Configurar orientación, márgenes y tamaño de página al importar imágenes.
- [ ] Añadir compresión configurable para imágenes.
- [ ] Añadir marca de agua de texto.
- [ ] Añadir marca de agua de imagen.
- [ ] Añadir numeración de páginas.
- [ ] Añadir encabezados y pies de página.
- [ ] Añadir plantillas de nombre para archivos exportados.
- [ ] Mostrar el tamaño antes y después de comprimir.

## Fase 8: Experiencia de usuario

- [ ] Añadir modo oscuro.
- [ ] Añadir opción para seguir el tema del sistema.
- [ ] Añadir modo de alto contraste.
- [ ] Permitir ajustar el tamaño de la interfaz.
- [ ] Mejorar la navegación completa con teclado.
- [ ] Añadir una paleta de comandos (`Ctrl+K`).
- [ ] Permitir personalizar atajos de teclado.
- [ ] Añadir historial visible de acciones recientes.
- [ ] Añadir guardado automático opcional.
- [ ] Añadir recuperación después de un cierre inesperado.
- [ ] Mostrar cuándo se guardó el documento por última vez.
- [ ] Añadir versiones anteriores del documento.

## Fase 9: Rendimiento

- [ ] Probar PDFs de cientos y miles de páginas.
- [ ] Probar PDFs de gran tamaño.
- [ ] Medir consumo de memoria durante zoom y navegación.
- [ ] Optimizar la carga de documentos grandes.
- [ ] Ejecutar unión y compresión sin bloquear la interfaz.
- [ ] Añadir cancelación a las operaciones largas.
- [ ] Mejorar el progreso de unión, compresión y OCR.
- [ ] Medir y reducir el tiempo de generación de miniaturas.

## Fase 10: Distribución y mantenimiento

- [ ] Revisar el flujo de actualización de la aplicación.
- [ ] Añadir notas de versión visibles después de una actualización.
- [ ] Crear una pantalla de información de la aplicación.
- [ ] Añadir un mecanismo para reportar errores.
- [ ] Documentar el proceso de publicación para Windows.
- [ ] Verificar instalador, desinstalador y asociación con archivos PDF.
- [ ] Verificar que los artefactos generados no se incluyan accidentalmente en Git.
- [ ] Configurar validaciones automáticas en CI.
- [ ] Ejecutar compilación y pruebas automáticamente en cada cambio.

## Próximo ciclo recomendado

Para empezar con entregas de alto impacto, se recomienda este orden:

- [ ] Actualizar documentación y añadir pruebas base.
- [x] Añadir arrastrar y soltar.
- [ ] Añadir selección múltiple y extracción de páginas.
- [ ] Añadir guardado automático y recuperación.
- [ ] Añadir pestañas.
- [ ] Añadir OCR.
- [ ] Añadir redacción segura.
