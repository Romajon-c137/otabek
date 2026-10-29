import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function Modal({ title, children, onClose, wide = false, className = '', backdropClassName = '' }: { title: string; children: ReactNode; onClose(): void; wide?: boolean; className?: string; backdropClassName?: string }) {
  return <div className={`modal-backdrop ${backdropClassName}`.trim()} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal ${wide ? 'modal-wide' : ''} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button></header>
      <div className="modal-body">{children}</div>
    </section>
  </div>;
}

