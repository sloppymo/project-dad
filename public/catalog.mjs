import { merchantKey } from "./recurrence.mjs";

// Edit names and service kinds here. Keys use the recurrence descriptor normalization.
export const merchantCatalog = {
  "HULU *STREAMING": { name: "Hulu", kind: "on-demand video" },
  "NETFLIX.COM": { name: "Netflix", kind: "on-demand video" },
  "DISNEY PLUS": { name: "Disney+", kind: "on-demand video" },
  "DISNEY+": { name: "Disney+", kind: "on-demand video" },
  "MAX": { name: "Max", kind: "on-demand video" },
  "PEACOCK": { name: "Peacock", kind: "on-demand video" },
  "PARAMOUNT+": { name: "Paramount+", kind: "on-demand video" },
  "PRIME VIDEO": { name: "Prime Video", kind: "on-demand video" },
  "LANTERN STREAMING": { name: "Lantern Streaming", kind: "on-demand video" },
  "YOUTUBE TV": { name: "YouTube TV", kind: "live TV" },
  "SLING TV": { name: "Sling", kind: "live TV" },
  "FUBO": { name: "Fubo", kind: "live TV" },
  "DIRECTV STREAM": { name: "DirecTV Stream", kind: "live TV" },
  "SPOTIFY USA": { name: "Spotify", kind: "music" },
  "SDGE ENERGY WEB PAY": { name: "SDG&E", kind: "utility" },
  "WSJ DIGITAL": { name: "The Wall Street Journal", kind: "news" },
  "NYTIMES DIGITAL": { name: "The New York Times", kind: "news" },
  "COASTLINE FIBER": { name: "Coastline Fiber", kind: "internet" },
  "COASTLINE FIBER INTERNET": { name: "Coastline Fiber", kind: "internet" },
  "APPLE.COM/BILL": { name: "Apple", kind: "payment processor" },
};

export const catalogEntry = (item, catalog = merchantCatalog) => catalog[merchantKey(item.latest.description)];
export const findingName = (item, catalog = merchantCatalog) => item.review.name || catalogEntry(item, catalog)?.name || item.name;
