import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ThreadAutoArchiveDuration,
  type GuildMember
} from "discord.js";
import { env } from "../config/env.js";
import {
  attachGeneralVoteMessage,
  closeGeneralVote,
  createGeneralVote,
  finalizeGeneralVoteThread,
  findRecentGeneralVotes,
  generalVoteMessage,
  getGeneralVote,
  listGeneralVoteBallots,
  refreshGeneralVoteMessage,
  tallyGeneralVoteBallots
} from "../services/generalVoteService.js";
import { isAllianceAdmin, isAllianceGuildId } from "../services/allianceIntelService.js";
import { UserFacingError } from "../utils/errors.js";
import { canOpenPromotionVotes } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const voteCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("vote")
    .setDescription("Open, close, or audit a channel vote.")
    .addSubcommand((subcommand) => subcommand
      .setName("open")
      .setDescription("Open an auditable Yes, No, or Abstain vote in this channel.")
      .addStringOption((option) => option
        .setName("question")
        .setDescription("The issue being decided.")
        .setRequired(true)
        .setMaxLength(300))
      .addStringOption((option) => option
        .setName("context")
        .setDescription("Optional background or terms for the vote.")
        .setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName("close")
      .setDescription("Close a vote in this channel and preserve its final tally.")
      .addStringOption((option) => option
        .setName("vote")
        .setDescription("Vote ID.")
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("audit")
      .setDescription("Privately export every ballot cast in a channel vote.")
      .addStringOption((option) => option
        .setName("vote")
        .setDescription("Vote ID.")
        .setRequired(true)
        .setAutocomplete(true))),

  async autocomplete(interaction) {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.respond([]);
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    const votes = (await findRecentGeneralVotes(interaction.guildId, interaction.channelId))
      .filter((vote) => subcommand !== "close" || vote.status === "Open");
    await interaction.respond(votes.map((vote) => ({
      name: `${vote.question} - ${vote.status} - ${vote.id.slice(0, 8)}`.slice(0, 100),
      value: vote.id
    })));
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild() || !interaction.channelId) {
      throw new UserFacingError("Votes can only be used inside a configured server channel.");
    }
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: subcommand !== "open" });
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      throw new UserFacingError("Use this command in a text channel or thread.");
    }
    if (!canManageGeneralVotes(actor, interaction.guild.id, channel.id)) {
      throw new UserFacingError("Channel moderators, Corps Marshals, Alliance admins, or server administrators may manage votes.");
    }

    if (subcommand === "open") {
      const question = interaction.options.getString("question", true).trim();
      if (!question) {
        throw new UserFacingError("The vote question cannot be empty.");
      }
      const vote = await createGeneralVote({
        guildId: interaction.guild.id,
        channelId: channel.id,
        question,
        context: interaction.options.getString("context")?.trim() || null,
        openedByDiscordUserId: interaction.user.id
      });
      await interaction.editReply(await generalVoteMessage(vote.id));
      const message = await interaction.fetchReply();
      let threadId: string | null = null;
      if (channel.type === ChannelType.GuildText) {
        const thread = await message.startThread({
          name: `Vote - ${vote.question}`.slice(0, 100),
          autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
          reason: "Create channel vote discussion"
        }).catch((error) => {
          console.warn(`Could not create discussion thread for channel vote ${vote.id}:`, error);
          return null;
        });
        threadId = thread?.id ?? null;
      }
      await attachGeneralVoteMessage(vote.id, message.id, threadId);
      return;
    }

    const voteId = interaction.options.getString("vote", true);
    const vote = await requireVoteInCurrentChannel(voteId, interaction.guild.id, channel.id);

    if (subcommand === "close") {
      const closed = await closeGeneralVote(vote.id, interaction.user.id);
      await refreshGeneralVoteMessage(interaction.guild, closed.id);
      await finalizeGeneralVoteThread(interaction.guild, closed);
      const tally = tallyGeneralVoteBallots(await listGeneralVoteBallots(closed.id));
      await interaction.editReply({
        content: `Closed **${closed.question}**. Final tally: **${tally.yes} Yes**, **${tally.no} No**, **${tally.abstain} Abstain**.`
      });
      return;
    }

    if (subcommand === "audit") {
      const ballots = await listGeneralVoteBallots(vote.id);
      const tally = tallyGeneralVoteBallots(ballots);
      const rows = await Promise.all(ballots.map(async (ballot) => {
        const member = await interaction.guild.members.fetch(ballot.voter_discord_user_id).catch(() => null);
        const user = member ? null : await interaction.client.users.fetch(ballot.voter_discord_user_id).catch(() => null);
        return [
          ballot.vote.toUpperCase(),
          cleanAuditCell(member?.displayName ?? user?.displayName ?? user?.username ?? "Unknown member"),
          ballot.voter_discord_user_id,
          ballot.updated_at
        ].join("\t");
      }));
      const audit = [
        `Question\t${cleanAuditCell(vote.question)}`,
        `Status\t${vote.status}`,
        `Opened by Discord ID\t${vote.opened_by_discord_user_id}`,
        `Closed by Discord ID\t${vote.closed_by_discord_user_id ?? ""}`,
        `Created\t${vote.created_at}`,
        `Closed\t${vote.closed_at ?? ""}`,
        "",
        "Vote\tDisplay name\tDiscord user ID\tBallot updated",
        ...rows
      ].join("\n");
      await interaction.editReply({
        content: `Audit for **${vote.question}**: **${tally.yes} Yes**, **${tally.no} No**, **${tally.abstain} Abstain**.`,
        files: [{ attachment: Buffer.from(audit, "utf8"), name: `vote-${vote.id.slice(0, 8)}-audit.tsv` }]
      });
      return;
    }

    throw new UserFacingError("Unknown vote action.");
  }
};

function canManageGeneralVotes(member: GuildMember, guildId: string, channelId: string): boolean {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  const channel = member.guild.channels.cache.get(channelId);
  if (channel && member.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages)) {
    return true;
  }
  if (guildId === env.DISCORD_GUILD_ID) {
    return canOpenPromotionVotes(member);
  }
  return isAllianceGuildId(guildId) && isAllianceAdmin(member);
}

async function requireVoteInCurrentChannel(
  voteId: string,
  guildId: string,
  channelId: string
) {
  const vote = await getGeneralVote(voteId);
  if (!vote) {
    throw new UserFacingError("Vote not found.");
  }
  if (vote.guild_id !== guildId || vote.channel_id !== channelId) {
    throw new UserFacingError("That vote does not belong to this channel.");
  }
  return vote;
}

function cleanAuditCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}
