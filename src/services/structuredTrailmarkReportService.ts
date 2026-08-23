import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type TextChannel
} from "discord.js";
import {
  assertNoDbError,
  supabase,
  type StructuredTrailmarkReportRow,
  type StructuredTrailmarkReportType
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { canUseTrailmarks } from "../utils/permissions.js";
import { emojiEmbed } from "../utils/guildEmojis.js";
import { getContactDetails } from "./contactService.js";
import { captureBotAuthoredTrailmarkReportForIntel } from "./intelService.js";
import { forwardDeliveredStructuredReports } from "./structuredReportForwardService.js";
import { getActiveTrailmarkByChannelId, getTrailmark } from "./trailmarkService.js";

const MODAL_PREFIX = "trailmark-report-submit:";

export async function createStructuredTrailmarkReportDraft(params: {
  member: GuildMember;
  channelId: string;
  reportType: StructuredTrailmarkReportType;
  contactIds: string[];
  participantDiscordUserIds: string[];
}): Promise<{ report: StructuredTrailmarkReportRow; modal: ModalBuilder }> {
  if (!canUseTrailmarks(params.member)) {
    throw new UserFacingError("Apprentice or higher is required to leave Trailmark reports.");
  }
  const trailmark = await getActiveTrailmarkByChannelId(params.channelId);
  if (!trailmark) {
    throw new UserFacingError("Run `/trailmark report` inside the Trailmark cache where the report is being left.");
  }

  const contactIds = [...new Set(params.contactIds.filter(Boolean))].slice(0, 3);
  if (contactIds.length) {
    const { data: contacts, error: contactsError } = await supabase
      .from("ranger_contacts")
      .select("id")
      .in("id", contactIds)
      .eq("active", true);
    assertNoDbError(contactsError, "validate structured report contacts");
    if ((contacts?.length ?? 0) !== contactIds.length) {
      throw new UserFacingError("One of the selected contacts is no longer active.");
    }
  }

  const participantIds = [...new Set(params.participantDiscordUserIds.filter((id) => id !== params.member.id))].slice(0, 3);
  const { data, error } = await supabase
    .from("structured_trailmark_reports")
    .insert({
      trailmark_id: trailmark.id,
      reporter_discord_user_id: params.member.id,
      reporter_display_name: params.member.displayName,
      report_type: params.reportType,
      status: "Draft",
      subject: null,
      location: null,
      summary: null,
      details: null,
      follow_up: null,
      commendation: null,
      contact_ids: contactIds,
      participant_discord_user_ids: participantIds,
      discord_channel_id: null,
      discord_message_id: null,
      submitted_at: null
    })
    .select("*")
    .single();
  assertNoDbError(error, "create structured Trailmark report draft");
  return { report: data, modal: structuredReportModal(data) };
}

export async function handleStructuredTrailmarkReportModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Trailmark reports are only available in the Ranger Corps server.");
  }
  const reportId = interaction.customId.slice(MODAL_PREFIX.length);
  const report = await getStructuredReport(reportId);
  if (!report || report.status !== "Draft") {
    throw new UserFacingError("That report form has expired or was already submitted.");
  }
  if (report.reporter_discord_user_id !== interaction.user.id) {
    throw new UserFacingError("That report form belongs to another Ranger.");
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!canUseTrailmarks(member)) {
    throw new UserFacingError("Apprentice or higher is required to leave Trailmark reports.");
  }
  const trailmark = await getTrailmark(report.trailmark_id);
  if (!trailmark?.active || interaction.channelId !== trailmark.discord_channel_id) {
    throw new UserFacingError("Return to the original Trailmark channel and open a new report form.");
  }
  if (!interaction.channel?.isTextBased() || interaction.channel.isDMBased()) {
    throw new UserFacingError("The Trailmark report channel could not be opened.");
  }

  await interaction.deferReply({ ephemeral: true });
  const values = structuredReportValues(interaction, report.report_type);
  const [contactNames, participantLabels] = await Promise.all([
    contactNamesFor(report.contact_ids),
    participantLabelsFor(interaction.guild, report.participant_discord_user_ids)
  ]);
  const content = formatStructuredReportIntelContent(report.report_type, values, contactNames, participantLabels);
  const embed = structuredReportEmbed({
    guild: interaction.guild,
    report,
    trailmarkName: trailmark.name,
    values,
    contactNames,
    participantLabels
  });

  const channel = interaction.channel as TextChannel;
  const message = await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] }
  });
  const submittedAt = new Date().toISOString();
  const { error } = await supabase
    .from("structured_trailmark_reports")
    .update({
      status: "Submitted",
      subject: values.subject,
      location: values.location,
      summary: values.summary,
      details: values.details,
      follow_up: values.followUp,
      commendation: values.commendation,
      discord_channel_id: message.channelId,
      discord_message_id: message.id,
      submitted_at: submittedAt
    })
    .eq("id", report.id);
  assertNoDbError(error, "submit structured Trailmark report");

  try {
    await captureBotAuthoredTrailmarkReportForIntel({
      guild: interaction.guild,
      trailmark,
      message,
      content,
      authorDiscordUserId: interaction.user.id,
      authorDisplayName: member.displayName
    });
    await forwardDeliveredStructuredReports({ guild: interaction.guild, discordMessageIds: [message.id] });
  } catch (error) {
    console.error(`Structured Trailmark report ${report.id} was posted but could not be routed:`, error);
    await interaction.editReply({
      content: `Your report was left in ${channel}, but Wayfinder could not finish filing its Intel copies. A Marshal should check the bot logs.`
    });
    return;
  }

  await interaction.editReply({ content: `Your structured report was left in ${channel}.` });
}

async function getStructuredReport(id: string): Promise<StructuredTrailmarkReportRow | null> {
  const { data, error } = await supabase
    .from("structured_trailmark_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  assertNoDbError(error, "get structured Trailmark report");
  return data;
}

function structuredReportModal(report: StructuredTrailmarkReportRow): ModalBuilder {
  const incident = report.report_type === "Incident";
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${report.id}`)
    .setTitle(incident ? "Trailmark Incident Report" : "Trailmark General Report");
  const fields = [
    textInput("report-subject", incident ? "Incident title" : "Report title", TextInputStyle.Short, true, 100),
    textInput("report-location", incident ? "Exact location" : "Location or area", TextInputStyle.Short, false, 150),
    textInput("report-summary", incident ? "What happened?" : "Summary", TextInputStyle.Paragraph, true, 1000),
    textInput("report-details", incident ? "Threat and current status" : "Details and observations", TextInputStyle.Paragraph, false, 2000),
    textInput("report-follow-up", incident ? "Actions taken or aid requested" : "Follow-up, request, or commendation", TextInputStyle.Paragraph, false, 1000)
  ];
  modal.addComponents(...fields.map((field) => new ActionRowBuilder<TextInputBuilder>().addComponents(field)));
  return modal;
}

function textInput(id: string, label: string, style: TextInputStyle, required: boolean, maxLength: number): TextInputBuilder {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);
}

interface StructuredReportValues {
  subject: string;
  location: string | null;
  summary: string;
  details: string | null;
  followUp: string | null;
  commendation: string | null;
}

function structuredReportValues(interaction: ModalSubmitInteraction, reportType: StructuredTrailmarkReportType): StructuredReportValues {
  const followUp = optionalValue(interaction, "report-follow-up");
  return {
    subject: interaction.fields.getTextInputValue("report-subject").trim(),
    location: optionalValue(interaction, "report-location"),
    summary: interaction.fields.getTextInputValue("report-summary").trim(),
    details: optionalValue(interaction, "report-details"),
    followUp,
    commendation: reportType === "General" && followUp?.toLocaleLowerCase().includes("commend") ? followUp : null
  };
}

function optionalValue(interaction: ModalSubmitInteraction, customId: string): string | null {
  const value = interaction.fields.getTextInputValue(customId).trim();
  return value || null;
}

async function contactNamesFor(contactIds: string[]): Promise<string[]> {
  const names: string[] = [];
  for (const contactId of contactIds) {
    const details = await getContactDetails(contactId);
    if (details?.contact.active) {
      names.push(details.contact.name);
    }
  }
  return names;
}

async function participantLabelsFor(guild: Guild, discordUserIds: string[]): Promise<string[]> {
  return Promise.all(discordUserIds.map(async (discordUserId) => {
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    return member ? `<@${discordUserId}> - ${member.displayName}` : `<@${discordUserId}>`;
  }));
}

function structuredReportEmbed(params: {
  guild: Guild;
  report: StructuredTrailmarkReportRow;
  trailmarkName: string;
  values: StructuredReportValues;
  contactNames: string[];
  participantLabels: string[];
}): EmbedBuilder {
  const participants = params.participantLabels.join("\n") || "None listed";
  const embed = emojiEmbed(params.guild, "intel", `${params.report.report_type} Report - ${params.values.subject}`)
    .setDescription(params.values.summary)
    .addFields(
      { name: "Reported by", value: `<@${params.report.reporter_discord_user_id}> - ${params.report.reporter_display_name}`, inline: true },
      { name: "Trailmark", value: params.trailmarkName, inline: true },
      { name: "Location", value: params.values.location ?? "At or near this Trailmark", inline: true },
      { name: "Participating Rangers", value: participants, inline: false }
    )
    .setColor(params.report.report_type === "Incident" ? 0xa64d3f : 0x587c4a)
    .setTimestamp(new Date());
  if (params.contactNames.length) {
    embed.addFields({ name: "Linked contacts", value: params.contactNames.join(", ").slice(0, 1024), inline: false });
  }
  if (params.values.details) {
    embed.addFields({ name: params.report.report_type === "Incident" ? "Threat / current status" : "Details", value: params.values.details.slice(0, 1024) });
  }
  if (params.values.followUp) {
    embed.addFields({ name: params.report.report_type === "Incident" ? "Actions / aid requested" : "Follow-up", value: params.values.followUp.slice(0, 1024) });
  }
  return embed;
}

export function formatStructuredReportIntelContent(
  reportType: StructuredTrailmarkReportType,
  values: StructuredReportValues,
  contacts: string[],
  participantLabels: string[]
): string {
  return [
    `${reportType} Report: ${values.subject}`,
    values.location ? `Location: ${values.location}` : null,
    values.summary,
    values.details,
    values.followUp,
    contacts.length ? `Contacts: ${contacts.join(", ")}` : null,
    participantLabels.length ? `Participating Rangers: ${participantLabels.join(", ")}` : null
  ].filter((value): value is string => Boolean(value)).join("\n\n");
}
