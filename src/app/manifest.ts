import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wesify | Social Prediction Markets",
    short_name: "Wesify",
    description: "Trade the future of virality. Play money only.",
    start_url: "/",
    display: "standalone",
    background_color: "#080809",
    theme_color: "#080809",
    categories: ["entertainment", "games", "social"],
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    // Android share target (§15): TikTok → Share → Wesify.
    share_target: {
      action: "/share-target",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
