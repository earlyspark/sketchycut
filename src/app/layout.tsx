import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "SketchyCut — fabrication verification",
  description: "Inspect one canonical flat-pack design across exact 2D, 3D, BOM, legend, and assembly projections."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
