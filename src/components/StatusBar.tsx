interface StatusBarProps {
  fileName: string | undefined;
  status: string;
}

function StatusBar({ fileName, status }: StatusBarProps) {
  return (
    <footer className="statusbar" role="status" aria-live="polite">
      <span className="status-left">
        <span className="status-dot" />
        Almacenamiento local
      </span>

      <span>
        {fileName ? `${status}  |  ${fileName}` : `Sin conexión  |  ${status}`}
      </span>
    </footer>
  );
}

export default StatusBar;