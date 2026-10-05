export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type MenuCategory = { id: string; name: string; description: string | null; sort_order: number; is_active: boolean; updated_at: string };
export type MenuProduct = { id: string; category_id: string; name: string; description: string | null; base_price: number; image_url: string | null; sort_order: number; is_active: boolean; updated_at: string };
export type BranchProduct = { product_id: string; price_override: number | null; is_available: boolean; is_visible: boolean; updated_at: string };
export type MenuActionState = { error: string };

// Keep prices as decimal strings until Postgres validates and stores them.
export function parseMenuPrice(value: string): string | null {
  const price = value.trim().replace(',', '.');
  return /^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/.test(price) ? price : null;
}
export function menuSortOrder(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,10}$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isInteger(number) && number <= 2147483647 ? number : null;
}
