import { EmbedBuilder, type Message } from "discord.js";
import { assertNoDbError, supabase, type Json } from "../db/supabase.js";
import { emojiEmbed } from "../utils/guildEmojis.js";

const SHARE_CODE_PREFIX = "RGFA2.";
const LEGACY_GUILD_SHARE_CODE_PREFIX = "RGFA1.";
const LEGACY_CORPS_SHARE_CODE_PREFIX = "RCFA1.";
const REMOTE_CODE_PATTERN = /^[A-Z0-9_-]{4,24}$/;
const RANDOM_SHARE_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
const MAP_WIDTH = 8192;
const MAP_HEIGHT = 6144;

const categories = [
  { id: "city", label: "City" },
  { id: "town", label: "Town" },
  { id: "cache", label: "Cache" },
  { id: "contact", label: "Contact" },
  { id: "threat", label: "Threat" },
  { id: "camp", label: "Camp" },
  { id: "hunting", label: "Hunting Spot" },
  { id: "ore", label: "Ore Vein" },
  { id: "ingredient", label: "Ingredient" },
  { id: "range", label: "Range" },
  { id: "route", label: "Trail" },
  { id: "post", label: "Guild Post" },
  { id: "trailmark", label: "Trailmark" },
  { id: "station", label: "Station" },
  { id: "landmark", label: "Landmark" }
] as const;

const categoryById: Map<string, { id: string; label: string }> = new Map(categories.map((category) => [category.id, category]));
const categoryIdsByCode: Map<string, string> = new Map(categories.map((category, index) => [index.toString(36), category.id]));
const typesByCode = new Map([
  ["m", "marker"],
  ["g", "range"],
  ["t", "route"]
]);
const confidencesByCode = new Map([
  ["c", "confirmed"],
  ["r", "rumor"],
  ["s", "scouted"],
  ["t", "stale"]
]);
const categoryAliases = new Map([
  ["danger", "threat"],
  ["guild", "post"],
  ["herb", "ingredient"],
  ["hunting_spot", "hunting"],
  ["mine", "ore"],
  ["mineral", "ore"],
  ["loot", "cache"],
  ["npc", "contact"],
  ["other", "landmark"],
  ["plant", "ingredient"],
  ["resource", "ore"],
  ["settlement", "city"],
  ["ranger_station", "station"],
  ["outpost", "station"],
  ["trail_mark", "trailmark"],
  ["trailcache", "trailmark"]
]);

export interface AtlasPreviewEntry {
  title: string;
  type: string;
  category: string;
  confidence: string;
  creator: string;
}

export interface AtlasSharePreview {
  code: string;
  source: "remote" | "inline" | "legacy";
  featureCount: number;
  typeCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  confidenceCounts: Record<string, number>;
  creators: string[];
  entries: AtlasPreviewEntry[];
}

interface AtlasFeature {
  id: string;
  type: string;
  category: string;
  title: string;
  confidence: string;
  creator: string;
  points: Array<{ x: number; y: number }>;
}

interface AtlasShareReference {
  source: "remote" | "inline" | "legacy";
  code: string;
  input: string;
}

export async function maybeSendAtlasSharePreview(message: Message): Promise<boolean> {
  const preview = await resolveAtlasSharePreviewFromContent(message.content);
  if (!preview) {
    return false;
  }

  await message.reply({
    embeds: [atlasSharePreviewEmbed(preview, message.guild)],
    allowedMentions: { repliedUser: false }
  });
  return true;
}

export async function resolveAtlasSharePreviewFromContent(content: string): Promise<AtlasSharePreview | null> {
  const references = atlasShareReferencesFromContent(content);
  for (const reference of references) {
    const preview = await resolveAtlasShareReference(reference);
    if (preview) {
      return preview;
    }
  }

  return null;
}

export function atlasSharePreviewFromJson(value: Json | null): AtlasSharePreview | null {
  if (!isRecord(value)) {
    return null;
  }

  const featureCount = numberFrom(value.featureCount);
  const entries = Array.isArray(value.entries)
    ? value.entries
        .flatMap((entry) => {
          if (!isRecord(entry)) {
            return [];
          }

          return [{
            title: stringFrom(entry.title, "Untitled"),
            type: stringFrom(entry.type, "entry"),
            category: stringFrom(entry.category, "Landmark"),
            confidence: stringFrom(entry.confidence, "scouted"),
            creator: stringFrom(entry.creator, "")
          }];
        })
    : [];

  if (!featureCount || entries.length === 0) {
    return null;
  }

  return {
    code: stringFrom(value.code, ""),
    source: sourceFrom(value.source),
    featureCount,
    typeCounts: recordOfNumbers(value.typeCounts),
    categoryCounts: recordOfNumbers(value.categoryCounts),
    confidenceCounts: recordOfNumbers(value.confidenceCounts),
    creators: Array.isArray(value.creators) ? value.creators.map((creator) => stringFrom(creator, "")).filter(Boolean) : [],
    entries
  };
}

export function atlasSharePreviewEmbed(preview: AtlasSharePreview, guild?: Message["guild"]): EmbedBuilder {
  const embed = guild
    ? emojiEmbed(guild, "atlas", "Field Atlas Share")
    : new EmbedBuilder().setTitle("Field Atlas Share")
    .setDescription(`${preview.featureCount} ${preview.featureCount === 1 ? "entry" : "entries"} - ${typeCountText(preview)}`)
    .setColor(0x4f6535)
    .addFields(
      { name: "Categories", value: countText(preview.categoryCounts), inline: false },
      { name: "Mapped by", value: preview.creators.length ? preview.creators.slice(0, 6).join(", ") : "Unsigned", inline: true },
      { name: "Code", value: codeFieldValue(preview), inline: true },
      { name: "Preview", value: entryPreviewText(preview), inline: false }
    )
    .setFooter({ text: "Paste the Atlas code into Receive Atlas to merge these entries." });

  return embed;
}

export function atlasReportFieldValue(summary: Json | null, code: string | null): string | null {
  const preview = atlasSharePreviewFromJson(summary);
  if (!preview) {
    return code ? `Atlas code: \`${code}\`` : null;
  }

  return [
    `${preview.featureCount} ${preview.featureCount === 1 ? "entry" : "entries"} - ${typeCountText(preview)}`,
    `Categories: ${countText(preview.categoryCounts)}`,
    `Mapped by: ${preview.creators.length ? preview.creators.slice(0, 5).join(", ") : "Unsigned"}`,
    code ? `Code: \`${code}\`` : null
  ].filter(Boolean).join("\n").slice(0, 1024);
}

export function atlasPreviewToJson(preview: AtlasSharePreview | null): Json | null {
  return preview as unknown as Json | null;
}

function atlasShareReferencesFromContent(content: string): AtlasShareReference[] {
  const inlineCodes = (content.match(/\b(?:RGFA2|RGFA1|RCFA1)\.[A-Za-z0-9._-]+/g) ?? [])
    .map(trimShareCodePunctuation)
    .filter(Boolean);
  if (inlineCodes.length > 0) {
    const source = inlineCodes.some((code) => code.startsWith(SHARE_CODE_PREFIX)) ? "inline" : "legacy";
    return [{
      source,
      code: inlineCodes.length === 1 ? inlineCodes[0] ?? "" : `${inlineCodes.length} code parts`,
      input: inlineCodes.join("\n")
    }];
  }

  const labeledCodePatterns = [
    /\bfield\s+atlas\s+code\s*[:#-]?\s*`?([A-Z0-9_-]{4,24})`?/iu,
    /\batlas\s+code\s*[:#-]?\s*`?([A-Z0-9_-]{4,24})`?/iu,
    /\batlas\s+share\s+code\s*[:#-]?\s*`?([A-Z0-9_-]{4,24})`?/iu,
    /\bshare\s+code\s*[:#-]?\s*`?([A-Z0-9_-]{4,24})`?/iu
  ];

  for (const pattern of labeledCodePatterns) {
    const match = pattern.exec(content);
    const code = normalizeRemoteShareCode(match?.[1] ?? "");
    if (code) {
      return [{ source: "remote", code, input: code }];
    }
  }

  const bareCode = bareRemoteShareCodeFromContent(content);
  if (bareCode) {
    return [{ source: "remote", code: bareCode, input: bareCode }];
  }

  return [];
}

async function resolveAtlasShareReference(reference: AtlasShareReference): Promise<AtlasSharePreview | null> {
  try {
    const payload = reference.source === "remote" ? await getRemoteAtlasShare(reference.input) : decodeShareCodes(reference.input);
    if (!payload) {
      return null;
    }

    return summarizeAtlasPayload(payload, reference);
  } catch (error) {
    console.warn(`Could not preview Atlas share ${reference.code}:`, error);
    return null;
  }
}

async function getRemoteAtlasShare(code: string): Promise<unknown | null> {
  const { data, error } = await supabase.rpc("get_atlas_share", { share_code: code });
  assertNoDbError(error, "get Atlas share");
  return data ?? null;
}

function decodeShareCodes(input: string): unknown {
  const codes = input
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (codes.length === 0) {
    throw new Error("Missing share code");
  }

  if (codes.length === 1 && isLegacyShareCode(codes[0] ?? "")) {
    return decodeLegacyShareCode(codes[0] ?? "");
  }

  const compactCodes = codes.filter((code) => code.startsWith(SHARE_CODE_PREFIX));
  if (compactCodes.length !== codes.length) {
    throw new Error("Mixed or unknown share code prefixes");
  }

  if (compactCodes.length === 1) {
    const parts = (compactCodes[0] ?? "").split(".");
    if (parts.length === 2) {
      return decodeCompactPayload(decodeBase64Url(parts[1] ?? ""));
    }
  }

  const chunks = compactCodes.map((code) => {
    const parts = code.split(".");
    if (parts.length !== 4 || `${parts[0]}.` !== SHARE_CODE_PREFIX) {
      throw new Error("Invalid share code part");
    }

    return {
      body: parts[3] ?? "",
      index: Number.parseInt(parts[1] ?? "", 36),
      total: Number.parseInt(parts[2] ?? "", 36)
    };
  });
  const total = chunks[0]?.total ?? 0;
  const indexes = new Set(chunks.map((chunk) => chunk.index));
  if (!Number.isFinite(total) || chunks.some((chunk) => chunk.total !== total) || indexes.size !== total) {
    throw new Error("Missing share code parts");
  }

  const body = chunks
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.body)
    .join("");
  return decodeCompactPayload(decodeBase64Url(body));
}

function decodeStoredSharePayload(payload: unknown): { features: AtlasFeature[] } | null {
  if (isRecord(payload) && payload.v === 2 && Array.isArray(payload.f)) {
    return decodeCompactPayloadObject(payload);
  }

  if (!isRecord(payload) || !Array.isArray(payload.features)) {
    return null;
  }

  return {
    features: payload.features.map(decodeLegacyFeature).filter((feature): feature is AtlasFeature => Boolean(feature))
  };
}

function decodeCompactPayload(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function decodeCompactPayloadObject(payload: Record<string, unknown>): { features: AtlasFeature[] } {
  return {
    features: (payload.f as unknown[]).map(decodeCompactFeature).filter((feature): feature is AtlasFeature => Boolean(feature))
  };
}

function decodeCompactFeature(value: unknown): AtlasFeature | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const category = categoryIdsByCode.get(stringFrom(value[2], "")) ?? stringFrom(value[2], "");
  const type = typesByCode.get(stringFrom(value[1], "")) ?? stringFrom(value[1], "");
  return normalizeFeature({
    id: decodeFeatureId(stringFrom(value[0], "")),
    type,
    category,
    title: stringFrom(value[3], "Untitled"),
    confidence: confidencesByCode.get(stringFrom(value[4], "")) ?? stringFrom(value[4], "scouted"),
    creator: stringFrom(value[9], ""),
    points: expandPoints(Array.isArray(value[6]) ? value[6] : [])
  });
}

function decodeLegacyFeature(value: unknown): AtlasFeature | null {
  if (!isRecord(value)) {
    return null;
  }

  return normalizeFeature({
    id: stringFrom(value.id, ""),
    type: stringFrom(value.type, ""),
    category: stringFrom(value.category, ""),
    title: stringFrom(value.title, "Untitled"),
    confidence: stringFrom(value.confidence, "scouted"),
    creator: stringFrom(value.creator, ""),
    points: Array.isArray(value.points)
      ? value.points.map((point) => isRecord(point) ? { x: numberFrom(point.x), y: numberFrom(point.y) } : { x: 0, y: 0 })
      : []
  });
}

function normalizeFeature(feature: AtlasFeature): AtlasFeature | null {
  if (!feature.id || !["marker", "route", "range"].includes(feature.type) || feature.points.length === 0) {
    return null;
  }

  const categoryId = categoryById.has(feature.category)
    ? feature.category
    : categoryAliases.get(feature.category) ?? "landmark";

  return {
    ...feature,
    category: categoryId,
    title: feature.title || "Untitled",
    confidence: feature.confidence || "scouted",
    creator: normalizeCreatorName(feature.creator),
    points: feature.points.map((point) => ({
      x: Math.max(0, Math.min(MAP_WIDTH, Math.round(point.x))),
      y: Math.max(0, Math.min(MAP_HEIGHT, Math.round(point.y)))
    }))
  };
}

function summarizeAtlasPayload(payload: unknown, reference: AtlasShareReference): AtlasSharePreview | null {
  const decoded = decodeStoredSharePayload(payload);
  const features = decoded?.features ?? [];
  if (features.length === 0) {
    return null;
  }

  const typeCounts = countBy(features, (feature) => feature.type);
  const categoryCounts = countBy(features, (feature) => categoryLabel(feature.category));
  const confidenceCounts = countBy(features, (feature) => titleCase(feature.confidence));
  const creators = [...new Set(features.map((feature) => feature.creator).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const entries = features
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 8)
    .map((feature) => ({
      title: feature.title,
      type: featureTypeLabel(feature.type),
      category: categoryLabel(feature.category),
      confidence: feature.confidence,
      creator: feature.creator
    }));

  return {
    code: reference.code,
    source: reference.source,
    featureCount: features.length,
    typeCounts,
    categoryCounts,
    confidenceCounts,
    creators,
    entries
  };
}

function normalizeRemoteShareCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!REMOTE_CODE_PATTERN.test(normalized) || ["GUILD", "SKYRIM", "CANON"].includes(normalized)) {
    return "";
  }

  return RANDOM_SHARE_CODE_PATTERN.test(normalized) ? normalized : "";
}

function bareRemoteShareCodeFromContent(content: string): string {
  const candidates = content
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/^`|`$/gu, ""))
    .flatMap((line) => {
      if (RANDOM_SHARE_CODE_PATTERN.test(line.toUpperCase())) {
        return [line];
      }

      const firstToken = trimShareCodePunctuation(line.split(/\s+/u)[0] ?? "");
      return RANDOM_SHARE_CODE_PATTERN.test(firstToken.toUpperCase()) ? [firstToken] : [];
    });

  return candidates.length === 1 ? normalizeRemoteShareCode(candidates[0] ?? "") : "";
}

function trimShareCodePunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/u, "");
}

function isLegacyShareCode(code: string): boolean {
  return code.startsWith(LEGACY_GUILD_SHARE_CODE_PREFIX) || code.startsWith(LEGACY_CORPS_SHARE_CODE_PREFIX);
}

function decodeLegacyShareCode(code: string): unknown {
  const prefix = code.startsWith(LEGACY_GUILD_SHARE_CODE_PREFIX)
    ? LEGACY_GUILD_SHARE_CODE_PREFIX
    : code.startsWith(LEGACY_CORPS_SHARE_CODE_PREFIX)
      ? LEGACY_CORPS_SHARE_CODE_PREFIX
      : "";

  if (!prefix) {
    throw new Error("Unknown share code prefix");
  }

  return JSON.parse(decodeBase64Url(code.slice(prefix.length))) as unknown;
}

function decodeBase64Url(value: string): string {
  const body = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = body.padEnd(body.length + ((4 - (body.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodeFeatureId(id: string): string {
  return /^[0-9a-f]{32}$/i.test(id)
    ? `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
    : id;
}

function expandPoints(points: unknown[]): Array<{ x: number; y: number }> {
  const expanded: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < points.length; index += 2) {
    expanded.push({
      x: numberFrom(points[index]),
      y: numberFrom(points[index + 1])
    });
  }

  return expanded;
}

function entryPreviewText(preview: AtlasSharePreview): string {
  const lines = preview.entries.map((entry) => {
    const creator = entry.creator ? `, by ${entry.creator}` : "";
    return `- ${entry.category}: ${entry.title} (${entry.type}, ${entry.confidence}${creator})`;
  });
  const remaining = Math.max(0, preview.featureCount - preview.entries.length);
  if (remaining) {
    lines.push(`- ${remaining} more ${remaining === 1 ? "entry" : "entries"}`);
  }

  return lines.join("\n").slice(0, 1024);
}

function codeFieldValue(preview: AtlasSharePreview): string {
  if (preview.source === "inline" && preview.code.includes("code parts")) {
    return preview.code;
  }

  return `\`${preview.code.slice(0, 80)}\``;
}

function typeCountText(preview: AtlasSharePreview): string {
  return [
    `${preview.typeCounts.marker ?? 0} ${(preview.typeCounts.marker ?? 0) === 1 ? "mark" : "marks"}`,
    `${preview.typeCounts.route ?? 0} ${(preview.typeCounts.route ?? 0) === 1 ? "trail" : "trails"}`,
    `${preview.typeCounts.range ?? 0} ${(preview.typeCounts.range ?? 0) === 1 ? "range" : "ranges"}`
  ].join(", ");
}

function countText(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([label, count]) => `${label} ${count}`).join(", ").slice(0, 1024) : "None";
}

function countBy<T>(items: T[], keyForItem: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyForItem(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function categoryLabel(categoryId: string): string {
  return categoryById.get(categoryId)?.label ?? "Landmark";
}

function featureTypeLabel(type: string): string {
  if (type === "marker") {
    return "mark";
  }
  if (type === "route") {
    return "trail";
  }
  if (type === "range") {
    return "range";
  }

  return type || "entry";
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeCreatorName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}

function sourceFrom(value: unknown): "remote" | "inline" | "legacy" {
  return value === "inline" || value === "legacy" ? value : "remote";
}

function recordOfNumbers(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, numberFrom(item)] as const)
      .filter(([, item]) => item > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
