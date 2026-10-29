import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  onChange(page: number): void;
}

export function Pagination({ page, pages, total, onChange }: PaginationProps) {
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Страницы списка">
      <button
        type="button"
        className="button secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={16} />Назад
      </button>
      <span>Страница <strong>{page}</strong> из <strong>{pages}</strong> · всего {total}</span>
      <button
        type="button"
        className="button secondary"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Далее<ChevronRight size={16} />
      </button>
    </nav>
  );
}
