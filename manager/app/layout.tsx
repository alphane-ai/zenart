import "./globals.css";

export const metadata = {
  title: "ZenArt Manager",
  description: "ZenArt manager console"
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
