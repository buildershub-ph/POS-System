import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Builders Hub Inventory",
  description: "Secure inventory, receiving, barcode lookup and cashier preparation for a finishing materials store.",
  applicationName: "Builders Hub",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Builders Hub" },
  openGraph: {
    title: "Builders Hub Inventory",
    description: "Trusted inventory. Faster sales.",
    type: "website",
    images: [{ url: "/og.png", width: 1732, height: 909, alt: "Builders Hub inventory application" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Builders Hub Inventory",
    description: "Trusted inventory. Faster sales.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b4ea2",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
