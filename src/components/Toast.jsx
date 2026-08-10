import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';

const ToastContext = createContext();

let toastId = 0;

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const removeToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  const icons = { success: CheckCircle, error: XCircle, info: Info, warning: AlertTriangle };
  const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--accent-light)', warning: 'var(--warning)' };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => {
          const Icon = icons[t.type] || Info;
          return (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <Icon size={18} color={colors[t.type]} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{t.message}</span>
              <button className="btn-ghost btn-icon" onClick={() => removeToast(t.id)} style={{ padding: 4 }}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
