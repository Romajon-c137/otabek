import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, apiAll, queryString, saveToken } from './client';

describe('API client', () => {
  afterEach(() => { vi.unstubAllGlobals(); saveToken(null); });

  it('omits empty query values', () => {
    expect(queryString({ warehouse: 2, q: '', page: null, status: 'posted' })).toBe('?warehouse=2&status=posted');
  });

  it('sends authentication and request identity', async () => {
    saveToken('secret-test-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/health-test/');
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get('Authorization')).toBe('Token secret-test-token');
    expect(headers.get('X-Request-ID')).toBeTruthy();
  });

  it('preserves server validation details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Отклонено', details: { amount: ['Минимум 0.01'] }, request_id: 'req-7' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })));
    await expect(api('/broken/')).rejects.toMatchObject({ status: 400, requestId: 'req-7', details: { amount: ['Минимум 0.01'] } });
  });

  it('loads every page of a paginated catalog', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: 1 }], pages: 2 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: 2 }], pages: 2 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiAll<{ id: number }>('/catalog/products/?active=true')).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/catalog/products/?active=true&page_size=200&page=1'), expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/catalog/products/?active=true&page_size=200&page=2'), expect.anything());
  });
});

