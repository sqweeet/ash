import {
  WINDOW_CAPTION_SIZE,
  WINDOW_CAPTION_VIEW_BOX,
  windowCaptionPaths,
} from "../lib/window-caption-icons";

interface WindowControlsProps {
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

function CaptionIcon({ name }: { name: keyof typeof windowCaptionPaths }) {
  return (
    <svg
      className="wc-icon"
      width={WINDOW_CAPTION_SIZE}
      height={WINDOW_CAPTION_SIZE}
      viewBox={WINDOW_CAPTION_VIEW_BOX}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={windowCaptionPaths[name]} fillRule="evenodd" />
    </svg>
  );
}

export default function WindowControls({
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps) {
  const sizeLabel = maximized ? "Restore" : "Maximize";
  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        className="wc-btn"
        title="Minimize"
        aria-label="Minimize"
        onClick={onMinimize}
      >
        <CaptionIcon name="minimize" />
      </button>
      <button
        type="button"
        className="wc-btn"
        title={sizeLabel}
        aria-label={sizeLabel}
        onClick={onToggleMaximize}
      >
        <CaptionIcon name={maximized ? "restore" : "maximize"} />
      </button>
      <button
        type="button"
        className="wc-btn wc-close"
        title="Close"
        aria-label="Close"
        onClick={onClose}
      >
        <CaptionIcon name="close" />
      </button>
    </div>
  );
}
