import type { ReactNode } from 'react';
import { AlertTriangle, LoaderCircle, PackageOpen } from 'lucide-react';
import { ApiError } from '../api/client';

export function Loading({ label = 'Загрузка данных…' }: { label?: string }) {
  return <div className="state-box"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>;
}

export function Empty({ title = 'Здесь пока нет данных', children }: { title?: string; children?: ReactNode }) {
  return <div className="state-box state-empty"><PackageOpen size={28} /><strong>{title}</strong>{children}</div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof ApiError ? `${error.message}${error.requestId ? ` Код запроса: ${error.requestId}` : ''}` : error instanceof Error ? error.message : 'Не удалось получить данные.';
  return <div className="state-box state-error"><AlertTriangle size={24} /><span>{message}</span>{retry && <button className="button secondary" onClick={retry}>Повторить</button>}</div>;
}

function firstMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = firstMessage(item);
      if (message) return message;
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const message = firstMessage(item);
      if (message) return message;
    }
  }
  return undefined;
}

export function validationMessage(error: unknown, field?: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (!field) return firstMessage(error.details) ?? error.message;
  if (!error.details || typeof error.details !== 'object' || Array.isArray(error.details)) return undefined;
  return firstMessage((error.details as Record<string, unknown>)[field]);
}

export function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = validationMessage(error, field);
  return message ? <span className="field-error" role="alert">{message}</span> : null;
}

