import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { QRMenu } from "@/lib/qr-menu";
import MenuView from "./menu-view";

export default async function QRMenuPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  if (slug.length > 200 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !/^[0-9a-f]{32}$/.test(token)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_qr_menu", { p_slug: slug, p_table_token: token, p_latitude: null, p_longitude: null });
  if (error?.code === "P0001" || error?.code === "22023" || (!error && !data)) notFound();
  if (error) throw new Error("Menyu yüklənmədi. Yenidən cəhd et.");
  return <MenuView slug={slug} token={token} initialMenu={data as QRMenu} />;
}
