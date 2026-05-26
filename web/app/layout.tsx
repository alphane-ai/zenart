import type { Metadata } from "next";
import { ClientTelemetry } from "@/components/client-telemetry";
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
      <body>
        <ClientTelemetry />
        {children}
      </body>
    </html>
  );
}
