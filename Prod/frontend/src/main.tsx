import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { AuthProvider } from './app/AuthContext';
import { WarehouseProvider } from './app/WarehouseContext';
import './styles/app.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={queryClient}><AuthProvider><WarehouseProvider><BrowserRouter><App /></BrowserRouter></WarehouseProvider></AuthProvider></QueryClientProvider></StrictMode>,
);

