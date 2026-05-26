import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZenArt",
  description: "Stage 0 workspace for candidate selection, canvas iteration, package export, quota, and support."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
