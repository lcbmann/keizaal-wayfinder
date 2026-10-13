import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type GuildMember, type ModalSubmitInteraction } from "discord.js";
import { assertNoDbError, supabase, type ReferenceItemRow } from "../db/supabase.js";
import { env } from "../config/env.js";
import { canManageAll, memberRankAtLeast } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";

export const REFERENCE_MODAL_PREFIX = "reference:submit:";
export const REFERENCE_CATEGORIES = ["Server Rule", "GM Ruling", "Public Announcement", "Faction Intelligence", "Diplomatic Conversation", "Disciplinary Record", "Leadership Decision", "Other"] as const;
export const REFERENCE_AUTHORITIES = ["official_rule", "gm_ruling", "leadership_decision", "firsthand_report", "secondhand_claim", "rumor", "interpretation", "unverified"] as const;
export const REFERENCE_CONFIDENTIALITIES = ["marshal_plus", "captain_plus", "agents", "corps"] as const;
export const REFERENCE_CONTEXTS = ["ic", "ooc", "mixed", "unspecified"] as const;

export function requireReferencePermission(member: GuildMember, confidentiality = "marshal_plus"): void {
  if (member.guild.id !== env.DISCORD_GUILD_ID || !memberRankAtLeast(member, "Marshal") || (confidentiality === "captain_plus" && !canManageAll(member))) {
    throw new UserFacingError("A Corps Marshal is required to archive references; Captain-only records require Captain+. ");
  }
}

export function referenceUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new UserFacingError("Use a complete http(s) source or attachment link, without embedded credentials."); }
}

export function referenceTimestamp(value: string | null): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new UserFacingError("Use an ISO timestamp including timezone, such as 2026-09-07T18:30:00Z. Leave it empty if unknown.");
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new UserFacingError("That source date does not exist. Leave it empty if unknown.");
  return new Date(value).toISOString();
}

export function referenceModal(id: string): ModalBuilder {
  const fields = [
    ["text", "Exact source text (verbatim, not a summary)", 4000, true],
    ["author", "Source author / speaker", 150, false],
    ["server", "Source server / community", 150, false],
    ["channel", "Source channel / ticket", 150, false],
    ["scope", "Where does this apply? (optional)", 1000, false]
  ] as const;
  return new ModalBuilder().setCustomId(`${REFERENCE_MODAL_PREFIX}${id}`).setTitle("Archive an External Reference").addComponents(
    ...fields.map(([id, label, max, required]) => new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max).setRequired(required).setStyle(id === "text" || id === "scope" ? TextInputStyle.Paragraph : TextInputStyle.Short)
    ))
  );
}

export async function createReferenceDraft(member: GuildMember, input: {
  title: string; category: string; sourceUrl: string; authority: string; confidentiality: string; context: string;
  postedAt: string | null; attachmentLinks: string | null; supersedes: string | null;
}): Promise<ReferenceItemRow> {
  requireReferencePermission(member, input.confidentiality);
  if (!REFERENCE_CATEGORIES.includes(input.category as typeof REFERENCE_CATEGORIES[number]) ||
      !REFERENCE_AUTHORITIES.includes(input.authority as typeof REFERENCE_AUTHORITIES[number]) ||
      !REFERENCE_CONFIDENTIALITIES.includes(input.confidentiality as typeof REFERENCE_CONFIDENTIALITIES[number]) ||
      !REFERENCE_CONTEXTS.includes(input.context as typeof REFERENCE_CONTEXTS[number])) throw new UserFacingError("Choose one of the supported reference classifications.");
  const attachments = (input.attachmentLinks?.trim().split(/\s+/) ?? []).filter(Boolean).map(referenceUrl);
  if (input.supersedes) {
    const prior = await getReferenceItem(member, input.supersedes);
    if (prior.status !== "archived") throw new UserFacingError("Only a completed archived reference can be superseded.");
  }
  const result = await supabase.from("reference_items").insert({
    guild_id: member.guild.id, archived_by_discord_user_id: member.id,
    title: input.title, category: input.category, source_url: referenceUrl(input.sourceUrl),
    authority_level: input.authority, confidentiality: input.confidentiality, ic_or_ooc: input.context,
    original_posted_at: referenceTimestamp(input.postedAt), attachment_urls: attachments, supersedes_reference_id: input.supersedes
  }).select("*").single();
  assertNoDbError(result.error, "prepare private reference archive");
  return result.data;
}

export async function getReferenceItem(member: GuildMember, id: string): Promise<ReferenceItemRow> {
  requireReferencePermission(member);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new UserFacingError("Use the full reference ID returned when it was archived.");
  const result = await supabase.from("reference_items").select("*").eq("guild_id", member.guild.id).eq("id", id).maybeSingle();
  assertNoDbError(result.error, "load archived reference");
  if (!result.data) throw new UserFacingError("That reference was not found in this server.");
  requireReferencePermission(member, result.data.confidentiality);
  return result.data;
}

export async function handleReferenceModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) throw new UserFacingError("Use this form in the Corps server.");
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const reference = await getReferenceItem(member, interaction.customId.slice(REFERENCE_MODAL_PREFIX.length));
  if (reference.archived_by_discord_user_id !== member.id) throw new UserFacingError("Only the officer who opened this form may submit it.");
  if (reference.status === "archived") {
    await interaction.editReply(`Already archived as reference \`${reference.id}\`.`);
    return;
  }
  const text = interaction.fields.getTextInputValue("text");
  if (!text.trim()) throw new UserFacingError("Include the exact source text. Screenshots are not transcribed automatically.");
  // Do not trim/rewrite verbatim evidence. Completed rows are not edited by this flow.
  const result = await supabase.from("reference_items").update({
    exact_source_text: text, source_author: interaction.fields.getTextInputValue("author") || null,
    source_server: interaction.fields.getTextInputValue("server") || null,
    source_channel: interaction.fields.getTextInputValue("channel") || null,
    applicable_scope: interaction.fields.getTextInputValue("scope") || null,
    status: "archived", archived_at: new Date().toISOString()
  }).eq("id", reference.id).eq("guild_id", member.guild.id).eq("archived_by_discord_user_id", member.id).eq("status", "draft");
  assertNoDbError(result.error, "archive external reference");
  await interaction.editReply({ content: `Archived **${reference.title}** as \`${reference.id}\`.\nClassification: ${reference.authority_level}; ${reference.ic_or_ooc}; ${reference.confidentiality}. This is the filing officer’s classification, not independent verification. No public announcement was posted.`, allowedMentions: { parse: [] } });
}

export async function handleReferenceButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) throw new UserFacingError("Use this form in the Corps server.");
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const reference = await getReferenceItem(member, interaction.customId.slice("reference:open:".length));
  if (reference.archived_by_discord_user_id !== member.id || reference.status !== "draft") throw new UserFacingError("This draft is no longer available to you.");
  await interaction.showModal(referenceModal(reference.id));
}
