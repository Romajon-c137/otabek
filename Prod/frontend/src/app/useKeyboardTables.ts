import { useEffect } from 'react';

const interactive = 'input, select, textarea, button, a, [contenteditable="true"]';

/** Makes data tables usable without a mouse while leaving native form Tab order intact. */
export function useKeyboardTables(): void {
  useEffect(() => {
    const markRows = () => {
      document.querySelectorAll<HTMLTableRowElement>('.table-card tbody tr').forEach((row) => {
        if (!row.hasAttribute('tabindex')) row.tabIndex = 0;
      });
    };
    const observer = new MutationObserver(markRows);
    observer.observe(document.body, { childList: true, subtree: true });
    markRows();

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(interactive)) return;
      const row = target.closest<HTMLTableRowElement>('.table-card tbody tr');
      if (!row) return;
      const rows = [...row.closest('tbody')!.querySelectorAll<HTMLTableRowElement>('tr')];
      const current = rows.indexOf(row);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        rows[Math.min(rows.length - 1, Math.max(0, current + direction))]?.focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        rows[event.key === 'Home' ? 0 : rows.length - 1]?.focus();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        row.querySelector<HTMLElement>('button:not(:disabled), a[href]')?.click();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
