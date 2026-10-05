import { useRef } from "react";

interface SidebarResizeHandleProps {
  label: string;
  onResize: (delta: number) => void;
}

function SidebarResizeHandle({ label, onResize }: SidebarResizeHandleProps) {
  const lastX = useRef<number | null>(null);

  return (
    <button
      type="button"
      className="sidebar-resize-handle"
      aria-label={`Cambiar ancho de ${label}`}
      title={`Arrastra para cambiar el ancho de ${label}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        lastX.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (lastX.current === null) return;
        const delta = event.clientX - lastX.current;
        lastX.current = event.clientX;
        if (delta !== 0) onResize(delta);
      }}
      onPointerUp={() => { lastX.current = null; }}
      onPointerCancel={() => { lastX.current = null; }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(-12);
        if (event.key === "ArrowRight") onResize(12);
      }}
    />
  );
}

export default SidebarResizeHandle;