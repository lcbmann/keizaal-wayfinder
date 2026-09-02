import {
  type ActionRowBuilder,
  type ButtonBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  type Attachment,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Message,
  type ModalSubmitInteraction,
  type ThreadChannel,
  type TextChannel
} from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import { UserFacingError } from "../utils/errors.js";
import { emojiEmbed, emojiText, guildEmoji, type WayfinderEmojiName } from "../utils/guildEmojis.js";
import { getBotMessageState, getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";
import { queueBriefingDispatch } from "./briefingService.js";
import {
  STRONGBOX_BUTTON_PREFIX,
  STRONGBOX_MODAL_PREFIX,
  parseStrongboxFormDestination,
  strongboxDropActionRow,
  strongboxSubmissionModal
} from "./strongboxFormService.js";

export { STRONGBOX_BUTTON_PREFIX, STRONGBOX_MODAL_PREFIX } from "./strongboxFormService.js";

const STRONGBOX_STATE_KEY = "hq-strongbox-channel";
const STRONGBOX_DROP_STATE_KEY = "hq-strongbox-drop-channel";
const STRONGBOX_CHANNEL_NAME = "hq-strongbox";
const STRONGBOX_DROP_CHANNEL_NAME = "strongbox-drop";

export async function getStrongboxChannel(guild: Guild): Promise<TextChannel | null> {
  return getStoredTextChannel(guild, STRONGBOX_STATE_KEY);
}

export async function getStrongboxDropChannel(guild: Guild): Promise<TextChannel | null> {
  return getStoredTextChannel(guild, STRONGBOX_DROP_STATE_KEY);
}

export async function setupStrongboxChannels(guild: Guild): Promise<{ privateChannel: TextChannel; dropChannel: TextChannel }> {
  const privateChannel = await setupPrivateStrongboxChannel(guild);
  const dropChannel = await setupStrongboxDropChannel(guild);
  return { privateChannel, dropChannel };
}

export async function refreshStrongboxDropInstructions(guild: Guild): Promise<boolean> {
  const channel = await getStrongboxDropChannel(guild);
  if (!channel) {
    return false;
  }

  await ensureStrongboxDropInstructions(channel);
  return true;
}

async function setupPrivateStrongboxChannel(guild: Guild): Promise<TextChannel> {
  const existing = await getStrongboxChannel(guild);
  if (existing) {
    await applyStrongboxPermissions(existing);
    return existing;
  }

  const channel = await guild.channels.create({
    name: STRONGBOX_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: env.TRAILMARK_CATEGORY_ID,
    reason: "Create Ranger HQ Strongbox",
    permissionOverwrites: strongboxPermissionOverwrites(guild)
  });

  await saveBotMessageState(STRONGBOX_STATE_KEY, channel.id, []);
  await channel.send({
    embeds: [
      emojiEmbed(guild, "strongbox", "HQ Strongbox")
        .setDescription("Private messages and applications are kept here. Each entry has its own discussion thread. Only Ranger Marshals and higher can read this channel.")
        .setColor(0x587c4a)
        .setTimestamp(new Date())
    ]
  });
  return channel;
}

async function setupStrongboxDropChannel(guild: Guild): Promise<TextChannel> {
  const existing = await getStrongboxDropChannel(guild);
  if (existing) {
    await applyStrongboxDropPermissions(existing);
    await ensureStrongboxDropInstructions(existing);
    return existing;
  }

  const channel = await guild.channels.create({
    name: STRONGBOX_DROP_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: env.TRAILMARK_CATEGORY_ID,
    reason: "Create Ranger HQ Strongbox drop channel",
    permissionOverwrites: strongboxDropPermissionOverwrites(guild)
  });

  await saveBotMessageState(STRONGBOX_DROP_STATE_KEY, channel.id, []);
  await ensureStrongboxDropInstructions(channel);
  return channel;
}

async function ensureStrongboxDropInstructions(channel: TextChannel): Promise<Message[]> {
  await channel.setTopic(strongboxDropTopic(), "Update Strongbox submission instructions").catch((error) => {
    console.warn(`Could not update Strongbox Drop topic ${channel.id}:`, error);
  });
  const state = await getBotMessageState(STRONGBOX_DROP_STATE_KEY);
  let overviewMessage: Message | null = null;
  let commandsMessage: Message | null = null;

  if (state?.discord_channel_id === channel.id && state.discord_message_ids[0]) {
    overviewMessage = await channel.messages.fetch(state.discord_message_ids[0]).catch(() => null);
  }
  if (state?.discord_channel_id === channel.id && state.discord_message_ids[1]) {
    commandsMessage = await channel.messages.fetch(state.discord_message_ids[1]).catch(() => null);
  }

  if (!overviewMessage || !commandsMessage) {
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!overviewMessage) {
      overviewMessage = recent?.find((candidate) =>
        candidate.author.id === channel.client.user.id && candidate.embeds[0]?.title?.endsWith("Strongbox Drop")
      ) ?? null;
    }
    if (!commandsMessage) {
      commandsMessage = recent?.find((candidate) =>
        candidate.author.id === channel.client.user.id && candidate.embeds[0]?.title?.endsWith("Strongbox Commands")
      ) ?? null;
    }
  }

  const overviewPayload = {
    embeds: [strongboxDropOverviewEmbed(channel.guild)],
    components: [strongboxDropActionRow()]
  };
  const commandsPayload = { embeds: [strongboxCommandsEmbed(channel.guild)] };
  overviewMessage = overviewMessage
    ? await overviewMessage.edit(overviewPayload)
    : await channel.send(overviewPayload);
  commandsMessage = commandsMessage
    ? await commandsMessage.edit(commandsPayload)
    : await channel.send(commandsPayload);

  for (const message of [overviewMessage, commandsMessage]) {
    if (!message.pinned) {
      await message.pin("Keep Strongbox instructions available").catch((error) => {
        console.warn(`Could not pin Strongbox instructions ${message.id}:`, error);
      });
    }
  }
  await saveBotMessageState(STRONGBOX_DROP_STATE_KEY, channel.id, [overviewMessage.id, commandsMessage.id]);
  return [overviewMessage, commandsMessage];
}

function strongboxDropTopic(): string {
  return [
    "Private reports: send sensitive IC information about people or events outside the Corps to Agents; send internal Corps issues to Ranger Marshal+.",
    "Use the buttons for either route. /strongbox drop accepts one attachment and always goes to the Marshal Strongbox. Ordinary messages may be briefly visible before removal.",
    "Applications: /application apply, /application withdraw.",
    "Apprenticeships: /apprenticeship looking-for, /apprenticeship withdraw-looking, /apprenticeship propose, /apprenticeship sponsor, /apprenticeship info, /apprenticeship end."
  ].join(" ");
}

function strongboxDropOverviewEmbed(guild: Guild): EmbedBuilder {
  return emojiEmbed(guild, "strongbox", "Strongbox Drop")
    .setDescription([
      "Choose the group that should receive your sensitive report.",
      "Use the buttons below to open a form. Your submission stays out of this channel and goes directly to that group."
    ].join("\n"))
    .addFields(
      {
        name: emojiText(guild, "agent", "Send to the Agents"),
        value: [
          "Use this for sensitive **IC information about people, groups, threats, or events outside the Corps**.",
          "When in doubt about external field intelligence, start with the Agents."
        ].join("\n")
      },
      {
        name: emojiText(guild, "rangermarshal", "Send to the Marshals"),
        value: [
          "Use this for **internal Corps issues**, including member conduct, safety, discipline, leadership, or administration.",
          "These reports go into the private HQ Strongbox as before."
        ].join("\n")
      },
      {
        name: "Attachments and the Legacy Route",
        value: [
          "For a Marshal report with a file, use `/strongbox drop`; it accepts one attachment and creates the same private Strongbox entry.",
          "Ordinary channel messages are still moved to the Marshals, but they can appear here briefly before removal. Do not type sensitive content directly into the channel."
        ].join("\n")
      }
    )
    .setColor(0x587c4a)
    .setFooter({ text: "Wayfinder replies privately to submissions." });
}

export async function handleStrongboxButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Strongbox forms are only available in the Ranger Corps server.");
  }
  const destination = parseStrongboxFormDestination(interaction.customId, STRONGBOX_BUTTON_PREFIX);
  if (!destination) {
    throw new UserFacingError("That Strongbox form is no longer valid. Please use the current buttons.");
  }
  await interaction.showModal(strongboxSubmissionModal(destination));
}

export async function handleStrongboxModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Strongbox forms are only available in the Ranger Corps server.");
  }
  const destination = parseStrongboxFormDestination(interaction.customId, STRONGBOX_MODAL_PREFIX);
  if (!destination) {
    throw new UserFacingError("That Strongbox form is no longer valid. Please open it again.");
  }

  await interaction.deferReply({ ephemeral: true });
  await requireStrongboxDropInteraction(interaction.guild, interaction.channelId);
  const subject = interaction.fields.getTextInputValue("subject").replace(/\s+/gu, " ").trim();
  const message = interaction.fields.getTextInputValue("message").trim();
  const references = interaction.fields.getTextInputValue("references").trim() || null;
  if (!subject || !message) {
    throw new UserFacingError("A subject and message are required.");
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (destination === "agents") {
    await sendAgentFieldReport({ guild: interaction.guild, member, subject, message, references });
    await interaction.editReply({ content: "Your sensitive field report was delivered directly to the Agents." });
    return;
  }

  await dropStrongboxMessage({
    guild: interaction.guild,
    member,
    subject,
    message,
    references
  });
  await interaction.editReply({ content: "Your sealed report was delivered privately to the Marshals." });
}

async function requireStrongboxDropInteraction(guild: Guild, channelId: string | null): Promise<void> {
  const dropChannel = await getStrongboxDropChannel(guild);
  if (!dropChannel || channelId !== dropChannel.id) {
    throw new UserFacingError("Use the report buttons in the configured Strongbox Drop channel.");
  }
}

async function sendAgentFieldReport(params: {
  guild: Guild;
  member: GuildMember;
  subject: string;
  message: string;
  references: string | null;
}): Promise<Message> {
  const channel = await params.guild.channels.fetch(env.AGENTS_CHANNEL_ID).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    throw new UserFacingError("The Agents channel is unavailable. Please ask Corps leadership to check its configuration.");
  }

  const embed = emojiEmbed(params.guild, "agent", `Field Report: ${params.subject.slice(0, 150)}`)
    .setDescription(params.message.slice(0, 4096))
    .addFields(
      ...(params.references ? [{ name: "Evidence or references", value: params.references.slice(0, 1024) }] : []),
      { name: "Submitted by", value: `${params.member} (${params.member.displayName})`, inline: true },
      { name: "Submitted", value: formatDiscordTime(new Date()), inline: true }
    )
    .setColor(0x385f7a)
    .setTimestamp(new Date());

  return channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] }
  }).catch(() => {
    console.warn(`Could not deliver an Agent field report to channel ${channel.id}.`);
    throw new UserFacingError("Wayfinder could not deliver the report to the Agents channel. Please ask Corps leadership to check its permissions.");
  });
}

function strongboxCommandsEmbed(guild: Guild): EmbedBuilder {
  return emojiEmbed(guild, "wayfinder", "Strongbox Commands")
    .setDescription("These application and apprenticeship commands work in any channel where you can use them. Wayfinder sends each result to the proper Corps record or Strongbox thread.")
    .addFields(
      {
        name: "Corps Duties",
        value: [
          `**Ranger+ only:** ${roleLabel(guild, "quartermaster", "Quartermaster")}, ${roleLabel(guild, "warden", "Warden")}, ${roleLabel(guild, "agent", "Agent")}, ${roleLabel(guild, "ambassador", "Ambassador")}, and ${roleLabel(guild, "instructor", "Instructor")}.`,
          `**Apprentice+:** ${roleLabel(guild, "craftsman", "Craftsman")} and ${roleLabel(guild, "courier", "Courier")}.`,
          "`/application apply` - Apply for a duty, a Hold Warden appointment, a local Warden Range, or eligible leadership consideration.",
          "`/application withdraw` - Withdraw one of your pending applications."
        ].join("\n")
      },
      {
        name: emojiText(guild, "apprentice", "Finding a Mentor or Apprentice"),
        value: [
          "`/apprenticeship looking-for` - Post on the notice board that you are looking for a mentor or Apprentice.",
          "`/apprenticeship withdraw-looking` - Remove your matching request.",
          "`/apprenticeship propose` - Propose a pairing with an existing Corps member."
        ].join("\n")
      },
      {
        name: emojiText(guild, "ranger", "Recruiting and Current Pairings"),
        value: [
          "`/apprenticeship sponsor` - Sponsor a new member who has already joined the Discord.",
          "`/apprenticeship info` - View your current pairing.",
          "`/apprenticeship end` - End your current pairing."
        ].join("\n")
      }
    )
    .setColor(0x587c4a)
    .setFooter({ text: "The /strongbox drop command always routes to the Marshals and accepts one attachment." });
}

function roleLabel(guild: Guild, emojiName: WayfinderEmojiName, label: string): string {
  const emoji = guildEmoji(guild, emojiName);
  return emoji ? `${emoji} ${label}` : label;
}

export async function dropStrongboxMessage(params: {
  guild: Guild;
  member: GuildMember;
  message: string;
  subject?: string | null;
  references?: string | null;
  attachments?: Attachment[];
}): Promise<StrongboxThreadResult> {
  const subject = params.subject?.replace(/\s+/gu, " ").trim();
  const references = params.references?.trim();
  const embed = emojiEmbed(params.guild, "strongbox", subject ? `Strongbox: ${subject.slice(0, 150)}` : "Strongbox Drop")
    .setDescription(params.message.slice(0, 4096))
    .setColor(0x587c4a)
    .setTimestamp(new Date());

  if (references) {
    embed.addFields({ name: "Evidence or references", value: references.slice(0, 1024) });
  }
  embed.addFields(
    { name: "Submitted by", value: `${params.member} (${params.member.displayName})`, inline: true },
    { name: "Submitted", value: formatDiscordTime(new Date()), inline: true }
  );

  const attachments = params.attachments ?? [];
  if (attachments.length > 0) {
    embed.addFields({
      name: attachments.length === 1 ? "Attachment" : "Attachments",
      value: attachments.map((attachment) => `[${attachment.name}](${attachment.url})`).join("\n").slice(0, 1024),
      inline: false
    });
    const image = attachments.find((attachment) => attachment.contentType?.startsWith("image/"));
    if (image) {
      embed.setImage(image.url);
    }
  }

  return postStrongboxThread({
    guild: params.guild,
    threadName: subject
      ? `Strongbox - ${params.member.displayName} - ${subject}`
      : `Strongbox - ${params.member.displayName}`,
    embed,
    reason: `Strongbox drop from ${params.member.user.tag}`
  });
}

export interface StrongboxThreadResult {
  channel: TextChannel;
  message: Message;
  thread: ThreadChannel;
}

export async function postStrongboxThread(params: {
  guild: Guild;
  threadName: string;
  embed: EmbedBuilder;
  components?: ActionRowBuilder<ButtonBuilder>[];
  reason: string;
}): Promise<StrongboxThreadResult> {
  const channel = await getStrongboxChannel(params.guild);
  if (!channel) {
    throw new UserFacingError("The HQ Strongbox has not been set up yet. Ask a Ranger Marshal to run `/strongbox setup`.");
  }

  const message = await channel.send({
    embeds: [params.embed],
    components: params.components ?? []
  });
  const thread = await message.startThread({
    name: normalizedThreadName(params.threadName),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    reason: params.reason
  });
  await queueStrongboxBriefingUpdate(params.guild, thread, message.url).catch((error) => {
    console.warn(`Could not add Strongbox thread ${thread.id} to Marshal briefings:`, error);
  });
  return { channel, message, thread };
}

export async function recordStrongboxBriefingActivity(message: Message): Promise<boolean> {
  if (!message.guild || !message.channel.isThread()) {
    return false;
  }
  const strongbox = await getStrongboxChannel(message.guild);
  if (!strongbox || message.channel.parentId !== strongbox.id) {
    return false;
  }
  await queueStrongboxBriefingUpdate(message.guild, message.channel, message.url);
  return true;
}

async function queueStrongboxBriefingUpdate(guild: Guild, thread: ThreadChannel, sourceUrl: string): Promise<void> {
  const subject = thread.name.replace(/^(Strongbox|Application|Apprentice Sponsor)\s*-\s*/iu, "").trim() || "Strongbox Message";
  await queueBriefingDispatch({
    guildId: guild.id,
    audience: "marshal_plus",
    title: `Strongbox: ${subject}`,
    body: `A new message has been added to **${subject}** in the HQ Strongbox.`,
    sourceKind: "strongbox-thread",
    sourceId: thread.id,
    sourceUrl
  });
}

function normalizedThreadName(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return (normalized || "Strongbox Entry").slice(0, 100);
}

export async function handleStrongboxDropMessage(message: Message): Promise<boolean> {
  if (!message.guild || message.author.bot) {
    return false;
  }

  const dropChannel = await getStrongboxDropChannel(message.guild);
  if (!dropChannel || message.channelId !== dropChannel.id) {
    return false;
  }

  const content = message.content.trim();
  const attachments = [...message.attachments.values()];
  if (!content && attachments.length === 0) {
    await message.delete().catch((error) => console.warn(`Could not delete empty strongbox drop ${message.id}:`, error));
    return true;
  }

  const member = message.member ?? await message.guild.members.fetch(message.author.id);
  await dropStrongboxMessage({
    guild: message.guild,
    member,
    message: content || "(attachment only)",
    attachments
  });

  let originalRemoved = true;
  await message.delete().catch((error) => {
    originalRemoved = false;
    console.warn(`Could not delete strongbox drop ${message.id}:`, error);
  });
  const confirmation = await dropChannel.send({
    content: originalRemoved
      ? `${message.author}, you place a sealed message in the HQ Strongbox for the Marshals.`
      : `${message.author}, your report reached the Marshals, but Wayfinder could not remove the public copy. Please delete your original message immediately.`,
    allowedMentions: { users: [message.author.id] }
  });
  setTimeout(() => {
    void confirmation.delete().catch(() => undefined);
  }, originalRemoved ? 10000 : 30000);
  return true;
}

async function applyStrongboxPermissions(channel: TextChannel): Promise<void> {
  await channel.permissionOverwrites.set(strongboxPermissionOverwrites(channel.guild), "Update Ranger HQ Strongbox permissions");
}

async function applyStrongboxDropPermissions(channel: TextChannel): Promise<void> {
  await channel.permissionOverwrites.set(strongboxDropPermissionOverwrites(channel.guild), "Update Ranger HQ Strongbox drop permissions");
}

function strongboxPermissionOverwrites(guild: Guild) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.ManageChannels
      ]
    },
    ...(["Ranger Commander", "Ranger Captain", "Ranger Marshal"] as const).map((rank) => ({
      id: roleIdForRank(rank),
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessagesInThreads
      ]
    }))
  ];
}

function strongboxDropPermissionOverwrites(guild: Guild) {
  return [
    {
      id: guild.roles.everyone.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory
      ]
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels
      ]
    },
    ...(["Ranger Commander", "Ranger Captain", "Ranger Marshal"] as const).map((rank) => ({
      id: roleIdForRank(rank),
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    }))
  ];
}

function formatDiscordTime(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}
