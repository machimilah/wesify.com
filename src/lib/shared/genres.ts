import { hashString } from "./random";

export type Genre = "tech" | "sports" | "music" | "gaming" | "comedy" | "food";

/** Home page genre rows, in display order. */
export const GENRES: { value: Genre; label: string }[] = [
  { value: "tech", label: "Tech" },
  { value: "sports", label: "Sports" },
  { value: "music", label: "Music" },
  { value: "gaming", label: "Gaming" },
  { value: "comedy", label: "Comedy" },
  { value: "food", label: "Food" },
];

/** There's no content classification source yet, so a video's genre is a stable hash of its
 * id — the same video always lands in the same row across polls and reloads. */
export function genreOf(videoId: string): Genre {
  // FNV's low bits cluster for ids that share a prefix ("vid_…"), so spread with a
  // multiplicative mix and take the high bits.
  const mixed = Math.imul(hashString(videoId) ^ (hashString(videoId) >>> 16), 2654435761) >>> 0;
  return GENRES[Math.floor((mixed / 2 ** 32) * GENRES.length)].value;
}
