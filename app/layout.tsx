import type { Metadata } from "next";
import { headers } from "next/headers";
import PwaRegister from "./pwa-register";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "ふたりの家計室 | 精算と将来シミュレーション";
  const description = "Amex明細の精算から、収入・貯蓄・住宅・教育・老後を含むふたりのライフプランまで試算する個人用ツール。";
  const image = `${origin}/og.png`;
  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: image, width: 1733, height: 908, alt: "ふたりの家計室" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" data-scroll-behavior="smooth">
      <body><PwaRegister />{children}</body>
    </html>
  );
}
