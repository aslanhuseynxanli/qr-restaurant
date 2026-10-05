"use client";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { uuidPattern } from "@/lib/menu-management";

export default function MenuNavigation({ restaurantId }: { restaurantId: string }) {
  const pathname = usePathname();
  const params = useParams();
  const branchId = typeof params.branchId === "string" && uuidPattern.test(params.branchId) ? params.branchId : null;
  const root = `/admin/restaurants/${restaurantId}`;
  const links = [{ href: root, label: "Filiallar" }, { href: `${root}/menu`, label: "Restoran menyusu" }];
  if (branchId) links.push({ href: `${root}/branches/${branchId}`, label: "Masalar və QR" }, { href: `${root}/branches/${branchId}/menu`, label: "Filial menyusu" });
  return <nav aria-label="Restoran bölmələri" className="border-b border-emerald-200 bg-white px-4 py-3 sm:px-8"><div className="mx-auto flex max-w-6xl flex-wrap gap-2">{links.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} className={`rounded-xl px-3 py-2 text-sm font-medium ${pathname === link.href ? "bg-emerald-700 text-white" : "text-emerald-700 hover:bg-emerald-50"}`}>{link.label}</Link>)}</div></nav>;
}
