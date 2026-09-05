import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://builders-hub-inventory.chatgpt.site"),
  title: "Builder's Hub Inventory",
  description: "Secure inventory, receiving, barcode lookup and cashier preparation for a finishing materials store.",
  applicationName: "Builder's Hub",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Builder's Hub" },
  openGraph: {
    title: "Builder's Hub Inventory",
    description: "Trusted inventory. Faster sales.",
    type: "website",
    images: [{ url: "/og.png", width: 1732, height: 909, alt: "Builder's Hub inventory application" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Builder's Hub Inventory",
    description: "Trusted inventory. Faster sales.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffc400",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
