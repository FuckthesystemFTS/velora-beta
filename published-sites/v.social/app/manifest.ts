import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "V per Verita",
    short_name: "V",
    description: "Social network dark con feed, profili, inviti e condivisione.",
    start_url: "/feed",
    display: "standalone",
    background_color: "#060608",
    theme_color: "#d53127",
    icons: [
      {
        src: "/icon?size=192",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon?size=512",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon?size=512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
