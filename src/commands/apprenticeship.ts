import { EmbedBuilder, SlashCommandBuilder, type Guild, type GuildMember } from "discord.js";
import {
  assignApprenticeship,
  clearApprenticeshipPreference,
  endApprenticeship,
  getCurrentApprenticeship,
  listApprenticeshipPreferences,
  listCurrentApprenticeships,
  proposeApprenticeship,
  requireNoticeBoardChannel,
  setApprenticeshipPreference,
  sponsorApprentice
} from "../services/apprenticeshipService.js";
import { getStrongboxDropChannel } from "../services/strongboxService.js";
import { refreshStoredAssignmentsBoard } from "../services/assignmentBoardService.js";
import { canOpenPromotionVotes, canUseTrailmarks } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";
import type { BotCommand } from "./types.js";

export const apprenticeshipCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("apprenticeship")
    .setDescription("Find, establish, and manage Ranger apprenticeships.")
    .addSubcommand((subcommand) => subcommand
      .setName("looking-for")
      .setDescription("Post a notice that you are looking for a mentor or Apprentice.")
      .addStringOption((option) => option
        .setName("type")
        .setDescription("What you are looking for.")
        .setRequired(true)
        .addChoices(
          { name: "A mentor", value: "Mentor" },
          { name: "An apprentice", value: "Apprentice" }
        ))
      .addStringOption((option) => option.setName("note").setDescription("Optional preferences or introduction.").setMaxLength(1500)))
    .addSubcommand((subcommand) => subcommand.setName("withdraw-looking").setDescription("Remove your apprenticeship matching request."))
    .addSubcommand((subcommand) => subcommand
      .setName("propose")
      .setDescription("Propose a pairing between an existing Ranger and Apprentice.")
      .addUserOption((option) => option.setName("member").setDescription("The proposed mentor or Apprentice.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("sponsor")
      .setDescription("Sponsor a new Discord member as your Apprentice for Marshal review.")
      .addUserOption((option) => option.setName("recruit").setDescription("The new recruit already in the Discord.").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Why they would make a good Ranger.").setRequired(true).setMaxLength(2000)))
    .addSubcommand((subcommand) => subcommand
      .setName("assign")
      .setDescription("Marshal+: directly pair an existing Ranger and Apprentice.")
      .addUserOption((option) => option.setName("mentor").setDescription("Ranger or higher who will mentor.").setRequired(true))
      .addUserOption((option) => option.setName("apprentice").setDescription("Existing Apprentice.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("end")
      .setDescription("End your apprenticeship, or Marshal+: end another pairing.")
      .addUserOption((option) => option.setName("member").setDescription("A participant in the pairing; omit for your own."))
      .addStringOption((option) => option.setName("reason").setDescription("Optional reason.").setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName("info")
      .setDescription("Show a current apprenticeship.")
      .addUserOption((option) => option.setName("member").setDescription("Participant to inspect; omit for yourself.")))
    .addSubcommand((subcommand) => subcommand.setName("requests").setDescription("Marshal+: list matching requests and current pairings.")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "looking-for") {
      requireCorpsMember(actor);
      await requireApprenticeshipRequestChannel(interaction.channelId, interaction.guild);
      await interaction.deferReply({ ephemeral: true });
      const seeking = interaction.options.getString("type", true) as "Mentor" | "Apprentice";
      await setApprenticeshipPreference({
        guild: interaction.guild,
        discordUserId: interaction.user.id,
        seeking,
        note: interaction.options.getString("note")?.trim() || null
      });
      await interaction.editReply({
        content: `You pin a notice stating that you are looking for ${seeking === "Mentor" ? "a mentor" : "an Apprentice"}. It can now be found on the Corps notice board.`
      });
      await refreshApprenticeshipBoard(interaction.guild);
      return;
    }

    if (subcommand === "withdraw-looking") {
      requireCorpsMember(actor);
      await requireApprenticeshipRequestChannel(interaction.channelId, interaction.guild);
      const removed = await clearApprenticeshipPreference(interaction.user.id, interaction.guild);
      await interaction.reply({ content: removed ? "You remove your apprenticeship notice from the Corps notice board." : "You do not have an active matching request.", ephemeral: true });
      if (removed) {
        await refreshApprenticeshipBoard(interaction.guild);
      }
      return;
    }

    if (subcommand === "propose") {
      requireCorpsMember(actor);
      await requireApprenticeshipRequestChannel(interaction.channelId, interaction.guild);
      const other = interaction.options.getUser("member", true);
      await interaction.deferReply({ ephemeral: true });
      const result = await proposeApprenticeship({
        guild: interaction.guild,
        proposerDiscordUserId: interaction.user.id,
        otherDiscordUserId: other.id
      });
      await interaction.editReply({ content: `You offer to form an apprenticeship with ${result.recipient}. They may accept or decline by DM.` });
      return;
    }

    if (subcommand === "sponsor") {
      requireCorpsMember(actor);
      await requireApprenticeshipRequestChannel(interaction.channelId, interaction.guild);
      const recruit = interaction.options.getUser("recruit", true);
      await interaction.deferReply({ ephemeral: true });
      await sponsorApprentice({
        guild: interaction.guild,
        mentorDiscordUserId: interaction.user.id,
        recruitDiscordUserId: recruit.id,
        reason: interaction.options.getString("reason", true).trim()
      });
      await interaction.editReply({ content: `You place your sponsorship of ${recruit} in the HQ Strongbox. A Marshal will review it.` });
      return;
    }

    if (subcommand === "info") {
      requireCorpsMember(actor);
      const member = interaction.options.getUser("member") ?? interaction.user;
      const details = await getCurrentApprenticeship(member.id);
      await interaction.reply({
        content: details
          ? `**${details.apprenticeship.status} apprenticeship**\nMentor: <@${details.apprenticeship.mentor_discord_user_id}>\nApprentice: <@${details.apprenticeship.apprentice_discord_user_id}>\nStarted: ${formatMaybeTime(details.apprenticeship.started_at)}`
          : "No current apprenticeship found.",
        ephemeral: true
      });
      return;
    }

    if (subcommand === "end") {
      requireCorpsMember(actor);
      const selected = interaction.options.getUser("member");
      const lookupId = selected?.id ?? interaction.user.id;
      const details = await getCurrentApprenticeship(lookupId);
      if (!details || details.apprenticeship.status !== "Active") {
        throw new UserFacingError("No active apprenticeship was found for that member.");
      }
      const isParticipant = [
        details.apprenticeship.mentor_discord_user_id,
        details.apprenticeship.apprentice_discord_user_id
      ].includes(interaction.user.id);
      if (!isParticipant && !canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Only a participant or Ranger Marshal or higher can end this apprenticeship.");
      }
      await interaction.deferReply({ ephemeral: true });
      await endApprenticeship({
        guild: interaction.guild,
        apprenticeDiscordUserId: details.apprenticeship.apprentice_discord_user_id,
        endedByDiscordUserId: interaction.user.id,
        reason: interaction.options.getString("reason")?.trim() || null
      });
      await interaction.editReply({ content: "The apprenticeship has been brought to an end and removed from the active Corps records." });
      await refreshApprenticeshipBoard(interaction.guild);
      return;
    }

    requireMarshal(actor);

    if (subcommand === "assign") {
      const mentor = interaction.options.getUser("mentor", true);
      const apprentice = interaction.options.getUser("apprentice", true);
      await interaction.deferReply({ ephemeral: true });
      await assignApprenticeship({
        guild: interaction.guild,
        mentorDiscordUserId: mentor.id,
        apprenticeDiscordUserId: apprentice.id,
        assignedByDiscordUserId: interaction.user.id
      });
      await interaction.editReply({ content: `Assigned ${apprentice} as ${mentor}'s Apprentice.` });
      await refreshApprenticeshipBoard(interaction.guild);
      return;
    }

    if (subcommand === "requests") {
      await interaction.deferReply({ ephemeral: true });
      const [preferences, pairings] = await Promise.all([
        listApprenticeshipPreferences(),
        listCurrentApprenticeships()
      ]);
      const preferenceLines = preferences.map((preference) =>
        `<@${preference.discord_user_id}> - looking for **${preference.seeking.toLocaleLowerCase()}**${
          preference.notice_channel_id && preference.notice_message_id
            ? ` - [notice](https://discord.com/channels/${interaction.guild.id}/${preference.notice_channel_id}/${preference.notice_message_id})`
            : ""
        }`
      );
      const pairingLines = pairings.map(({ apprenticeship }) =>
        `<@${apprenticeship.apprentice_discord_user_id}> with <@${apprenticeship.mentor_discord_user_id}> - **${apprenticeship.status}**${apprenticeship.strongbox_thread_id ? ` - <#${apprenticeship.strongbox_thread_id}>` : ""}`
      );
      const embed = new EmbedBuilder()
        .setTitle("Apprenticeship Requests")
        .addFields(
          { name: "Looking", value: truncate(preferenceLines.join("\n") || "None."), inline: false },
          { name: "Current and pending pairings", value: truncate(pairingLines.join("\n") || "None."), inline: false }
        )
        .setColor(0x587c4a)
        .setTimestamp(new Date());
      await interaction.editReply({ embeds: [embed] });
    }
  }
};

function requireCorpsMember(member: GuildMember): void {
  if (!canUseTrailmarks(member)) {
    throw new UserFacingError("Apprentice or higher is required to use apprenticeship commands.");
  }
}

function requireMarshal(member: GuildMember): void {
  if (!canOpenPromotionVotes(member)) {
    throw new UserFacingError("Ranger Marshal or higher is required for this apprenticeship command.");
  }
}

async function requireApprenticeshipRequestChannel(channelId: string, guild: Guild): Promise<void> {
  const dropChannel = await getStrongboxDropChannel(guild);
  if (dropChannel?.id === channelId) {
    return;
  }

  const noticeBoardChannel = await requireNoticeBoardChannel(guild);
  if (noticeBoardChannel.id === channelId) {
    return;
  }

  const allowedChannels = [dropChannel, noticeBoardChannel].filter((channel) => channel !== null).join(" or ");
  throw new UserFacingError(`Submit apprenticeship requests in ${allowedChannels}.`);
}

function formatMaybeTime(value: string | null): string {
  return value ? `<t:${Math.floor(new Date(value).getTime() / 1000)}:f>` : "Not started";
}

function truncate(value: string): string {
  return value.length <= 1024 ? value : `${value.slice(0, 1020).trimEnd()}...`;
}

async function refreshApprenticeshipBoard(guild: Guild): Promise<void> {
  await refreshStoredAssignmentsBoard(guild).catch((error) => {
    console.error("Failed to refresh assignments board after apprenticeship change:", error);
  });
}
