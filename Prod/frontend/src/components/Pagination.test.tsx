import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('changes pages and enforces the list boundaries', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pages={3} total={125} onChange={onChange} />);

    expect(screen.getByRole('button', { name: /назад/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /далее/i }));
    expect(onChange).toHaveBeenCalledWith(2);

    rerender(<Pagination page={3} pages={3} total={125} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /далее/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /назад/i }));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('stays hidden for a single page', () => {
    const { container } = render(<Pagination page={1} pages={1} total={12} onChange={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
