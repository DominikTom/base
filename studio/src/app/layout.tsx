import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#f4f4f5",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MyBed Visual Studio",
  description: "Generowanie i edycja wizualizacji produktowych MyBed Group",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Motyw przed pierwszym malowaniem — domyślnie jasny; zapisany ciemny bez błysku. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('studio-theme')==='dark'){document.documentElement.setAttribute('data-theme','dark');var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content','#09090b');}}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
