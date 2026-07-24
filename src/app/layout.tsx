import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/Toast";

const socialPreview = {
  url: "/social-preview.png",
  width: 1200,
  height: 630,
  alt: "SimplAssist",
};

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://simplassist.com"
  ),
  title: "SimplAssist",
  description: "AI-powered customer support assistant",
  openGraph: {
    title: "SimplAssist",
    description: "AI-powered customer support assistant",
    type: "website",
    images: [socialPreview],
  },
  twitter: {
    card: "summary_large_image",
    title: "SimplAssist",
    description: "AI-powered customer support assistant",
    images: [socialPreview.url],
  },
  icons: {
    icon: [{ url: "/favicon-2.png", type: "image/png" }],
    apple: [{ url: "/favicon-2.png", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
