import {
  ClipboardList,
  Eye,
  PackagePlus,
  ShoppingCart,
} from 'lucide-react';
import { Link } from 'react-router-dom';

export function DashboardPage() {
  return (
    <div className="dashboard-home">
      <section className="quick-actions" aria-label="Быстрые действия">
        <Link className="quick-tile sale" to="/sales"><ShoppingCart /><span>Продажа</span></Link>
        <Link className="quick-tile product" to="/stock?new=1"><PackagePlus /><span>Новый товар</span></Link>
        <Link className="quick-tile order" to="/orders/new"><ClipboardList /><span>Заказ</span></Link>
        <Link className="quick-tile view" to="/history"><Eye /><span>Просмотр</span></Link>
      </section>
    </div>
  );
}
