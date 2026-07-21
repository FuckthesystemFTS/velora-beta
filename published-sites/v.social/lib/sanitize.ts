import sanitizeHtml from "sanitize-html";

export function sanitizeRichText(input: string) {
  return sanitizeHtml(input, {
    allowedTags: ["b", "i", "em", "strong", "a", "p", "br"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
  }).trim();
}

export function normalizeText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}
