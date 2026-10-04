export type QRMenu = {
  restaurant: { id: string; name: string; slug: string; logo_url: string | null; phone: string | null };
  branch: { id: string; name: string; address: string | null; phone: string | null };
  table: { id: string; name: string; table_number: number };
  currency: string;
  language: string;
  accepting_orders: boolean;
  can_order: boolean;
  location: { required: boolean; status: "NOT_REQUIRED" | "REQUIRED" | "INVALID" | "ALLOWED" | "OUTSIDE"; allowed_radius_meters: number; distance_meters: number | null };
  categories: { id: string; name: string; description: string | null; image_url: string | null; products: { id: string; name: string; description: string | null; image_url: string | null; price: number; is_available: boolean }[] }[];
};
