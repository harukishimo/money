import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ふたりの家計室",
    short_name: "家計室",
    description: "ふたりの家計精算とライフプランを試算する個人用ツール。",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f0e8",
    theme_color: "#17312f",
    lang: "ja",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
