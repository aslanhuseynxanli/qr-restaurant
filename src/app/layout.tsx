import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "QR Restoran",
  description: "Restoran idarəetmə və QR sifariş sistemi",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="az">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}