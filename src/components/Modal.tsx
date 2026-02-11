import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  icon?: string;
  actions?: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  icon,
  actions
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm print:hidden"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-[rgb(28_36_46/var(--tw-bg-opacity,1))] rounded-xl shadow-xl max-w-sm w-full overflow-hidden border border-slate-200 dark:border-slate-700"
          >
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-primary text-2xl">
                  {icon || 'info'}
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                {title}
              </h3>
              <div className="text-sm text-slate-600 dark:text-slate-300">
                {children}
              </div>
            </div>
            <div className="bg-[rgb(28_36_46/var(--tw-bg-opacity,1))] px-6 py-3 flex justify-center gap-3">
              {actions ? (
                actions
              ) : (
                <button
                  onClick={onClose}
                  className="w-full px-4 py-2 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default Modal;
