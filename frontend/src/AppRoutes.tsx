import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";

const ShopPage = lazy(() => import("./features/shop/ShopPage"));
const ProductDetailPage = lazy(() => import("./features/shop/ProductDetailPage"));
const CartPage = lazy(() => import("./features/cart/CartPage"));
const OrdersPage = lazy(() => import("./features/orders/OrdersPage"));
const OrderDetailPage = lazy(() => import("./features/orders/OrderDetailPage"));
const AdminProductsPage = lazy(() => import("./features/admin/products/AdminProductsPage"));
const StockHistoryPage = lazy(() => import("./features/admin/products/StockHistoryPage"));
const ImportPage = lazy(() => import("./features/admin/import/ImportPage"));
const SystemPage = lazy(() => import("./features/admin/system/SystemPage"));
const NotFoundPage = lazy(() => import("./components/NotFoundPage"));

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<ShopPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="admin/products" element={<AdminProductsPage />} />
        <Route path="admin/products/:id/history" element={<StockHistoryPage />} />
        <Route path="admin/import" element={<ImportPage />} />
        <Route path="admin/system" element={<SystemPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
