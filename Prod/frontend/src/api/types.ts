export type Id = number;

export interface Warehouse {
  id: Id;
  code: string;
  name: string;
  address: string;
  is_active: boolean;
  permissions?: string[];
}

export interface CurrentUser {
  id: Id;
  username: string;
  display_name: string;
  role: 'owner' | 'manager' | 'cashier' | 'auditor';
  warehouses: Warehouse[];
}

export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  page: number;
  pages: number;
  results: T[];
}

export interface Product {
  id: Id;
  code: string;
  category: Id | null;
  category_name: string | null;
  name: string;
  sku: string;
  barcode: string;
  unit: 'piece' | 'kg' | 'meter';
  purchase_price: string;
  retail_price: string;
  wholesale_price: string;
  image: string | null;
  external_provider: string;
  external_product_id: number | null;
  external_variant_id: number | null;
  variant_name: string;
  external_image_url: string;
  track_stock: boolean;
  is_active: boolean;
}

export interface Party {
  id: Id;
  code: string;
  name: string;
  kind: 'customer' | 'supplier' | 'both';
  phone: string;
  email: string;
  address: string;
  note: string;
  system_key: string;
  is_system: boolean;
  is_active: boolean;
  balance?: string;
}

export type DocumentKind = 'opening' | 'receipt' | 'sale' | 'customer_return' | 'supplier_return' | 'customer_order';
export type DocumentStatus = 'draft' | 'confirmed' | 'assembled' | 'posted' | 'fulfilled' | 'cancelled';

export interface TradeLine {
  id: Id;
  position: number;
  product_id: Id;
  product_image: string | null;
  product_external_image_url: string;
  source_line_id: Id | null;
  product_name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  line_total: string;
  allocated_extra_cost: string;
  neighbor_supply: {
    supplier_id: Id;
    supplier_name: string;
    quantity: string;
    unit_price: string;
    amount: string;
  } | null;
}

export interface TradeDocument {
  id: Id;
  kind: DocumentKind;
  kind_label: string;
  status: DocumentStatus;
  status_label: string;
  number: string;
  effective_date: string;
  warehouse: Id;
  warehouse_name: string;
  party: Id | null;
  party_name: string | null;
  note: string;
  amount_total: string;
  document_discount_amount: string;
  version: number;
  source_document: Id | null;
  cancellation_reason?: string;
  lines: TradeLine[];
  extra_costs: { id: Id; name: string; amount: string }[];
}

export interface Obligation {
  id: Id;
  party: Id;
  party_name: string;
  warehouse: Id;
  side: 'receivable' | 'payable';
  original_amount: string;
  open_amount: string;
  effective_date: string;
  due_date: string | null;
  reason: string;
  source_number: string | null;
  source_document: Id | null;
  reversed_at: string | null;
  product: Id | null;
  original_quantity: string | null;
  unit_price: string | null;
}

export interface Payment {
  id: Id;
  number: string;
  direction: 'incoming' | 'outgoing';
  method: 'cash' | 'mbank' | 'aiyl';
  status: 'posted' | 'voided';
  party: Id;
  party_name: string;
  warehouse: Id;
  amount: string;
  effective_date: string;
  note: string;
  source_document: Id | null;
}

