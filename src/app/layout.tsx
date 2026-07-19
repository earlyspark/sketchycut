import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "SketchyCut · laser-cut 3D construction",
  description: "Turn a supported three-dimensional idea into linked construction geometry, an assembly preview, and inspectable fabrication files."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <script src="/shell-auth-state.mjs" type="module" />
      </body>
    </html>
  );
}
