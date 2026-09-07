import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "./types.js";
import { createReferenceDraft, getReferenceItem, requireReferencePermission, REFERENCE_AUTHORITIES, REFERENCE_CATEGORIES, REFERENCE_CONFIDENTIALITIES, REFERENCE_CONTEXTS } from "../services/referenceService.js";
import { UserFacingError } from "../utils/errors.js";

export const referenceCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("reference").setDescription("Privately archive external rules, rulings and evidence (Marshal+).")
    .addSubcommand((s) => s.setName("add").setDescription("Open a private form to preserve verbatim source material.")
      .addStringOption((o) => o.setName("title").setDescription("Short reference title.").setRequired(true).setMaxLength(150))
      .addStringOption((o) => o.setName("category").setDescription("Type of source.").setRequired(true).addChoices(...REFERENCE_CATEGORIES.map((v) => ({ name: v, value: v }))))
      .addStringOption((o) => o.setName("source-url").setDescription("Original message, ticket, document or image link.").setRequired(true).setMaxLength(2000))
      .addStringOption((o) => o.setName("authority").setDescription("Your classification, not automatic verification. Default: unverified.").addChoices(...REFERENCE_AUTHORITIES.map((v) => ({ name: v, value: v }))))
      .addStringOption((o) => o.setName("context").setDescription("IC/OOC context, if known.").addChoices(...REFERENCE_CONTEXTS.map((v) => ({ name: v, value: v }))))
      .addStringOption((o) => o.setName("confidentiality").setDescription("Handling label; archive remains private. Default: marshal_plus.").addChoices(...REFERENCE_CONFIDENTIALITIES.map((v) => ({ name: v, value: v }))))
      .addStringOption((o) => o.setName("posted-at").setDescription("Original timestamp with timezone, e.g. 2026-09-07T18:30:00Z. Omit if unknown."))
      .addStringOption((o) => o.setName("attachment-links").setDescription("Supporting http(s) links, separated by whitespace.").setMaxLength(2000))
      .addStringOption((o) => o.setName("supersedes").setDescription("ID of an earlier reference this replaces (the original is preserved).")))
    .addSubcommand((s) => s.setName("view").setDescription("Retrieve a private reference by ID.")
      .addStringOption((o) => o.setName("id").setDescription("Full archived reference ID.").setRequired(true))),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) throw new UserFacingError("Use this command in the Corps server.");
    const member = await interaction.guild.members.fetch(interaction.user.id);
    requireReferencePermission(member);
    if (interaction.options.getSubcommand() === "view") {
      await interaction.deferReply({ ephemeral: true });
      const record = await getReferenceItem(member, interaction.options.getString("id", true));
      await interaction.editReply({ content: `Reference: ${record.title} (${record.status})`, files: [new AttachmentBuilder(Buffer.from(JSON.stringify(record, null, 2)), { name: `reference-${record.id}.json` })], allowedMentions: { parse: [] } });
      return;
    }
    // Discord cannot show a modal after deferring: reply with a private continuation button.
    await interaction.deferReply({ ephemeral: true });
    const draft = await createReferenceDraft(member, {
      title: interaction.options.getString("title", true), category: interaction.options.getString("category", true), sourceUrl: interaction.options.getString("source-url", true),
      authority: interaction.options.getString("authority") ?? "unverified", context: interaction.options.getString("context") ?? "unspecified",
      confidentiality: interaction.options.getString("confidentiality") ?? "marshal_plus", postedAt: interaction.options.getString("posted-at"),
      attachmentLinks: interaction.options.getString("attachment-links"), supersedes: interaction.options.getString("supersedes")
    });
    await interaction.editReply({ content: "Source details saved. Open the form to paste the exact text; it enters the audit feed only after submission.", components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`reference:open:${draft.id}`).setLabel("Enter Source Text").setStyle(ButtonStyle.Primary))] });
  }
};
