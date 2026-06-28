import "./globals.css";

export const metadata = {
  title: "zenari.ai Manager",
  description: "zenari.ai manager console"
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
