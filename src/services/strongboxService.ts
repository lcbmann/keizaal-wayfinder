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
import { getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";

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
      new EmbedBuilder()
        .setTitle("HQ Strongbox")
        .setDescription("Private reports and applications appear here. Each entry has its own Marshal discussion thread. Only Ranger Marshal or higher can read this channel.")
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
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Strongbox Drop")
        .setDescription([
          "Leave private messages for Ranger Marshal or higher in this channel, or use the duty and apprenticeship submission commands.",
          "Wayfinder forwards each entry to the HQ Strongbox, creates a private discussion thread, and removes any public copy."
        ].join("\n"))
        .setColor(0x587c4a)
        .setTimestamp(new Date())
    ]
  });
  return channel;
}

export async function dropStrongboxMessage(params: {
  guild: Guild;
  member: GuildMember;
  message: string;
  attachments?: Attachment[];
}): Promise<StrongboxThreadResult> {
  const embed = new EmbedBuilder()
    .setTitle("Strongbox Drop")
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
  return { channel, message, thread };
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

  await message.delete().catch((error) => console.warn(`Could not delete strongbox drop ${message.id}:`, error));
  const confirmation = await dropChannel.send({
    content: `${message.author}, your message was left in the HQ Strongbox.`,
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
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
      deny: [PermissionFlagsBits.ReadMessageHistory]
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
