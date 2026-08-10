import { X } from 'lucide-react';

export default function Modal({ isOpen, onClose, title, children, footer, size = 'md', closeOnOverlay = true }) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={closeOnOverlay ? onClose : undefined}
    >
      <div
        className={`modal modal-${size}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
