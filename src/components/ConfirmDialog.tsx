interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-small" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <i className={danger ? "ri-error-warning-line" : "ri-question-line"} aria-hidden="true" />
          <span>{title}</span>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Cancel">
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={"btn" + (danger ? " btn-danger" : " btn-primary")} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
