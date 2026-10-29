import {
  BarChart3,
  Boxes,
  ChevronDown,
  ClipboardList,
  HandCoins,
  LogOut,
  PackagePlus,
  RotateCcw,
  Settings,
  ShoppingCart,
  UsersRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { useKeyboardTables } from './useKeyboardTables';
import { useWarehouse } from './WarehouseContext';

const operations = [
  { to: '/sales', label: 'Продажа', icon: ShoppingCart },
  { to: '/history', label: 'Просмотр', icon: BarChart3 },
  { to: '/orders', label: 'Заказы', icon: ClipboardList },
  { to: '/receipts', label: 'Поступления', icon: PackagePlus },
  { to: '/returns', label: 'Возвраты', icon: RotateCcw },
  { to: '/parties', label: 'Люди', icon: UsersRound },
  { to: '/finance', label: 'Взаиморасчёты', icon: HandCoins },
  { to: '/reports', label: 'Отчёты', icon: BarChart3 },
  { to: '/settings', label: 'Управление', icon: Settings },
];

export function AppShell() {
  useKeyboardTables();
  const { user, logout } = useAuth();
  const { warehouseId, setWarehouseId } = useWarehouse();
  const cache = useQueryClient();
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    let stopped = false;
    let cursor = 0;

    async function followChanges() {
      try {
        const state = await api<{ last_seq: number }>('/sync/state/');
        cursor = state.last_seq;
        while (!stopped) {
          const update = await api<{ last_seq: number; changes: unknown[] }>(
            `/sync/changes/?since=${cursor}&limit=500&wait=25`,
          );
          cursor = update.last_seq;
          setConnected(true);
          if (update.changes.length) await cache.invalidateQueries();
        }
      } catch {
        if (!stopped) {
          setConnected(false);
          window.setTimeout(() => {
            if (!stopped) void followChanges();
          }, 2000);
        }
      }
    }

    void followChanges();
    return () => {
      stopped = true;
    };
  }, [cache, user?.id]);

  return (
    <div className="app-shell">
      <header className="workspace-bar">
        <NavLink className="brand-link" to="/">ХозУчёт</NavLink>
        <span className="mode-badge">Рабочий режим</span>
        <nav className="primary-nav" aria-label="Основная навигация">
          <NavLink to="/" end><BarChart3 size={17} />Итоги</NavLink>
          <NavLink to="/stock"><Boxes size={18} />Каталог</NavLink>
          <details className="operations-menu">
            <summary><Settings size={18} />Операции<ChevronDown size={14} /></summary>
            <div className="operations-popover">
              <label className="operations-warehouse">
                <span>Рабочий склад</span>
                <select
                  aria-label="Рабочий склад"
                  value={warehouseId ?? ''}
                  onChange={(event) => setWarehouseId(Number(event.target.value))}
                >
                  {user?.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </select>
              </label>
              {operations.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}><Icon size={17} />{label}</NavLink>
              ))}
            </div>
          </details>
        </nav>
        <span className="bar-spacer" />
        <div className={connected ? 'connection' : 'connection offline'}>
          {connected ? 'Сохранено' : 'Нет связи'}
        </div>
        <button className="bar-button" onClick={() => void logout()}>
          <LogOut size={17} />Выйти
        </button>
      </header>
      <main className="content"><Outlet /></main>
    </div>
  );
}
