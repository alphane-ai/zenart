import type { Metadata } from "next";
import "./globals.css";
import { AdminShell } from "@/components/AdminShell";

export const metadata: Metadata = {
  title: "zenari.ai Admin",
  description: "Stage 0 Rev2 administration console"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
