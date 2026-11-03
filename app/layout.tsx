import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "rakkau ops — planilla de proyecto",
  description:
    "PoC Rakkau: tareas generales, subtareas, dependencias y sprints sobre GitHub Projects v2.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={nunito.variable}>{children}</body>
    </html>
  );
}
