'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, AlertCircle, AlertTriangle, Info, CheckCircle } from 'lucide-react';
import { AppError, ErrorSeverity } from '../lib/error-handler';

export type ToastType = 'error' | 'warning' | 'info' | 'success';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  suggestions?: string[];
  action?: {
    label: string;
    onClick: () => void;
  };
  duration?: number; // Auto-dismiss after duration (ms), 0 = no auto-dismiss
}

interface ErrorToastProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ErrorToast({ toasts, onDismiss }: ErrorToastProps) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-md">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(toast.id);
    }, 300);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, toast.duration);

      return () => clearTimeout(timer);
    }
  }, [toast.duration, toast.id, handleDismiss]);

  const getIcon = () => {
    switch (toast.type) {
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />;
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />;
      case 'info':
      default:
        return <Info className="w-5 h-5 text-blue-500 flex-shrink-0" />;
    }
  };

  const getBgColor = () => {
    switch (toast.type) {
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'info':
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  return (
    <div
      className={`${getBgColor()} border-2 rounded-lg shadow-lg p-4 transition-all duration-300 ${
        isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'
      }`}
    >
      <div className="flex gap-3">
        {getIcon()}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-900">{toast.title}</h3>
            <button
              onClick={handleDismiss}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <p className="text-sm text-gray-700 mt-1">{toast.message}</p>
          
          {toast.suggestions && toast.suggestions.length > 0 && (
            <ul className="mt-2 text-xs text-gray-600 space-y-1">
              {toast.suggestions.map((suggestion, index) => (
                <li key={index} className="flex items-start gap-1">
                  <span className="text-gray-400">•</span>
                  <span>{suggestion}</span>
                </li>
              ))}
            </ul>
          )}
          
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="mt-3 text-sm font-medium text-amber-600 hover:text-amber-700 underline"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage toasts
 */
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: Toast = {
      ...toast,
      id,
      duration: toast.duration ?? 5000 // Default 5 seconds
    };
    setToasts(prev => [...prev, newToast]);
    return id;
  };

  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const clearAll = () => {
    setToasts([]);
  };

  // Helper methods for common toast types
  const showError = (title: string, message: string, options?: Partial<Toast>) => {
    return addToast({
      type: 'error',
      title,
      message,
      duration: 0, // Errors don't auto-dismiss
      ...options
    });
  };

  const showWarning = (title: string, message: string, options?: Partial<Toast>) => {
    return addToast({
      type: 'warning',
      title,
      message,
      ...options
    });
  };

  const showSuccess = (title: string, message: string, options?: Partial<Toast>) => {
    return addToast({
      type: 'success',
      title,
      message,
      duration: 3000,
      ...options
    });
  };

  const showInfo = (title: string, message: string, options?: Partial<Toast>) => {
    return addToast({
      type: 'info',
      title,
      message,
      ...options
    });
  };

  /**
   * Show error from AppError object
   */
  const showAppError = (appError: AppError, action?: Toast['action']) => {
    return showError(
      `${appError.category} Error`,
      appError.userMessage,
      {
        suggestions: appError.suggestions,
        action
      }
    );
  };

  return {
    toasts,
    addToast,
    dismissToast,
    clearAll,
    showError,
    showWarning,
    showSuccess,
    showInfo,
    showAppError
  };
}
