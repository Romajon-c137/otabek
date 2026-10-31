import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AppShell } from "./AppShell";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LoginPage } from "../features/LoginPage";
import { DocumentListPage } from "../features/documents/DocumentListPage";
import { StockPage } from "../features/catalog/StockPage";
import { PartiesPage } from "../features/parties/PartiesPage";
import { FinancePage } from "../features/finance/FinancePage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { PosPage } from "../features/pos/PosPage";
import { HistoryPage } from "../features/history/HistoryPage";
import { OperationDetailPage } from "../features/operations/OperationDetailPage";
import { Loading } from "../components/Feedback";

function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="center-screen">
        <Loading label="Проверяем сессию…" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="sales" element={<PosPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route
          path="operations/document/:id"
          element={<OperationDetailPage />}
        />
        <Route path="orders/new" element={<PosPage flow="order" />} />
        <Route path="orders/:id/edit" element={<PosPage flow="order" />} />
        <Route
          path="orders"
          element={
            <DocumentListPage
              kind="customer_order"
              title="Заказы покупателей"
            />
          }
        />
        <Route
          path="receipts"
          element={<DocumentListPage kind="receipt" title="Поступления" />}
        />
        <Route
          path="returns"
          element={
            <DocumentListPage
              kind="customer_return"
              title="Возвраты покупателей"
              alternateKind="supplier_return"
            />
          }
        />
        <Route path="stock" element={<StockPage />} />
        <Route
          path="opening"
          element={
            <DocumentListPage kind="opening" title="Ввод начальных остатков" />
          }
        />
        <Route path="parties" element={<PartiesPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
