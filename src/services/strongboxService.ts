import {
  type ActionRowBuilder,
  type ButtonBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  type Attachment,
  type Guild,
  type GuildMember,
  type Message,
  type ThreadChannel,
  type TextChannel
} from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import { UserFacingError } from "../utils/errors.js";
import { canCreateTrailmarks } from "../utils/permissions.js";
import { emojiEmbed, emojiText, guildEmoji, type WayfinderEmojiName } from "../utils/guildEmojis.js";
import { getBotMessageState, getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";
import { queueBriefingDispatch } from "./briefingService.js";

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

  const overviewPayload = { embeds: [strongboxDropOverviewEmbed(channel.guild)] };
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
    "Private submissions to Ranger Marshal+. Member messages are moved to the Strongbox and removed here. Marshal+ messages remain as notices.",
    "Applications: /application apply, /application withdraw.",
    "Apprenticeships: /apprenticeship looking-for, /apprenticeship withdraw-looking, /apprenticeship propose, /apprenticeship sponsor, /apprenticeship info, /apprenticeship end."
  ].join(" ");
}

function strongboxDropOverviewEmbed(guild: Guild): EmbedBuilder {
  return emojiEmbed(guild, "strongbox", "Strongbox Drop")
    .setDescription([
      "Leave private messages and applications for the Marshals here.",
      "Wayfinder moves each submission into the HQ Strongbox and removes it from this channel."
    ].join("\n"))
    .addFields(
      {
        name: "Private Message",
        value: [
          "Type an ordinary message here, or use `/strongbox drop` with an optional attachment.",
          "Marshal notices remain visible. Other messages are moved into the private Strongbox."
        ].join("\n")
      }
    )
    .setColor(0x587c4a)
    .setFooter({ text: "Wayfinder replies privately to submissions." });
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
    .setFooter({ text: "The private /strongbox drop command remains limited to this channel." });
}

function roleLabel(guild: Guild, emojiName: WayfinderEmojiName, label: string): string {
  const emoji = guildEmoji(guild, emojiName);
  return emoji ? `${emoji} ${label}` : label;
}

export async function dropStrongboxMessage(params: {
  guild: Guild;
  member: GuildMember;
  message: string;
  attachments?: Attachment[];
}): Promise<StrongboxThreadResult> {
  const embed = emojiEmbed(params.guild, "strongbox", "Strongbox Drop")
    .setDescription(params.message.slice(0, 4096))
    .addFields(
      { name: "Submitted by", value: `${params.member} (${params.member.displayName})`, inline: true },
      { name: "Submitted", value: formatDiscordTime(new Date()), inline: true }
    )
    .setColor(0x587c4a)
    .setTimestamp(new Date());

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
    threadName: `Strongbox - ${params.member.displayName}`,
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
  if (canCreateTrailmarks(member)) {
    return true;
  }

  await dropStrongboxMessage({
    guild: message.guild,
    member,
    message: content || "(attachment only)",
    attachments
  });

  await message.delete().catch((error) => console.warn(`Could not delete strongbox drop ${message.id}:`, error));
  const confirmation = await dropChannel.send({
    content: `${message.author}, you place a sealed message in the HQ Strongbox for the Marshals.`,
    allowedMentions: { users: [message.author.id] }
  });
  setTimeout(() => {
    void confirmation.delete().catch(() => undefined);
  }, 10000);
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
