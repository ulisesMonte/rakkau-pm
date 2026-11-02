import type { Metadata } from "next";
import { Figtree, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
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
      <body className={`${figtree.variable} ${sourceSerif.variable}`}>
        {children}
      </body>
    </html>
  );
}
