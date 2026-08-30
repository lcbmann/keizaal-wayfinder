import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  type ModalSubmitInteraction
} from "discord.js";
import {
  attachGeneralVoteMessage,
  createGeneralVote,
  generalVoteMessage,
  parseGeneralVoteChoices
} from "../services/generalVoteService.js";
import { UserFacingError } from "../utils/errors.js";
import { canManageGeneralVotes } from "../utils/generalVotePermissions.js";

export const GENERAL_VOTE_MODAL_ID = "general-vote:create-choice";

export function buildGeneralVoteModal(prefill?: {
  question?: string | null;
  context?: string | null;
}): ModalBuilder {
  const question = new TextInputBuilder()
    .setCustomId("question")
    .setLabel("Question")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(300)
    .setPlaceholder("What should the Corps decide?");
  if (prefill?.question?.trim()) {
    question.setValue(prefill.question.trim().slice(0, 300));
  }

  const context = new TextInputBuilder()
    .setCustomId("context")
    .setLabel("Context (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("Relevant background, terms, or consequences.");
  if (prefill?.context?.trim()) {
    context.setValue(prefill.context.trim().slice(0, 1000));
  }

  const options = new TextInputBuilder()
    .setCustomId("options")
    .setLabel("Options - one per line")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000)
    .setPlaceholder("Oak Rune | Emphasizes nature and research\nRooted Stone | Emphasizes protection");

  return new ModalBuilder()
    .setCustomId(GENERAL_VOTE_MODAL_ID)
    .setTitle("Open Multiple-Choice Vote")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(question),
      new ActionRowBuilder<TextInputBuilder>().addComponents(context),
      new ActionRowBuilder<TextInputBuilder>().addComponents(options)
    );
}

export async function handleGeneralVoteModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inCachedGuild() || !interaction.channelId) {
    throw new UserFacingError("Votes can only be opened inside a configured server channel.");
  }
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  const channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new UserFacingError("Open the vote from a text channel or thread.");
  }
  if (!canManageGeneralVotes(actor, interaction.guild.id, channel.id)) {
    throw new UserFacingError("Channel moderators, Corps Marshals, Alliance admins, or server administrators may manage votes.");
  }

  const question = interaction.fields.getTextInputValue("question").trim();
  if (!question) {
    throw new UserFacingError("The vote question cannot be empty.");
  }
  const choices = parseGeneralVoteChoices(interaction.fields.getTextInputValue("options"));
  await interaction.deferReply();
  const vote = await createGeneralVote({
    guildId: interaction.guild.id,
    channelId: channel.id,
    question,
    context: interaction.fields.getTextInputValue("context").trim() || null,
    openedByDiscordUserId: interaction.user.id,
    voteType: "choice",
    choices
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
}
