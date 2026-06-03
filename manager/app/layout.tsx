import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZenArt Manager",
  description: "Stage 0 Rev2 manager console for delivery, release gates, and surface health."
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
