import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface WarehouseState {
  warehouseId: number | null;
  setWarehouseId(id: number): void;
}

const WarehouseContext = createContext<WarehouseState | null>(null);

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [preferredId, setPreferredId] = useState<number | null>(() => Number(localStorage.getItem('hozuchet.production.warehouse')) || null);
  const warehouseId = user?.warehouses.some((item) => item.id === preferredId) ? preferredId : user?.warehouses[0]?.id ?? null;
  const value = useMemo(() => ({
    warehouseId,
    setWarehouseId(id: number) {
      localStorage.setItem('hozuchet.production.warehouse', String(id));
      setPreferredId(id);
    },
  }), [warehouseId]);
  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>;
}

export function useWarehouse() {
  const value = useContext(WarehouseContext);
  if (!value) throw new Error('WarehouseProvider is missing');
  return value;
}

