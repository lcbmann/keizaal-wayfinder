export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || "trailmark";
}

export function channelNameForTrailmark(name: string): string {
  return `trailmark-${slugify(name)}`.slice(0, 90);
}
