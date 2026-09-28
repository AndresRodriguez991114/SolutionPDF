interface StatusBarProps {
  fileName: string | undefined;
}

function StatusBar({ fileName }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="status-left">
        <span className="status-dot" />
        Almacenamiento local
      </span>

      <span>
        {fileName
          ? `Abierto: ${fileName}`
          : "Sin conexión  |  Listo"}
      </span>
    </footer>
  );
}

export default StatusBar;