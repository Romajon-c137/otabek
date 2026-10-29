import type { ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function Money({ value, tone }: { value: string | number; tone?: 'positive' | 'negative' }) {
  const number = Number(value);
  return <span className={tone ? `money ${tone}` : 'money'}>{new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)} сом</span>;
}

export function StatusBadge({ value, label }: { value: string; label: string }) {
  return <span className={`status-badge status-${value}`}>{label}</span>;
}

