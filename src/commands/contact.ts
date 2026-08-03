import { ChannelType, SlashCommandBuilder, type GuildMember } from "discord.js";
import {
  CONTACT_HOLD_CHOICES,
  archiveContact,
  createContact,
  editContact,
  listContacts,
  setupContactsForum
} from "../services/contactService.js";
import { canUseTrailmarks, memberRankAtLeast } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";
import type { BotCommand } from "./types.js";

const holdChoices = CONTACT_HOLD_CHOICES.map((hold) => ({ name: hold, value: hold }));

export const contactCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("contact")
    .setDescription("Maintain the Ranger Corps contact records.")
    .addSubcommand((subcommand) => subcommand
      .setName("setup")
      .setDescription("Marshal+: create or repair the Contacts Forum.")
      .addChannelOption((option) => option
        .setName("category")
        .setDescription("Optional category for the Contacts Forum.")
        .addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand((subcommand) => subcommand
      .setName("create")
      .setDescription("Apprentice+: create a structured contact record.")
      .addStringOption((option) => option.setName("name").setDescription("The contact's name.").setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName("race").setDescription("The contact's race.").setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName("sex").setDescription("The contact's sex.").setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName("occupation").setDescription("Occupation, such as Alchemist or Merchant.").setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName("hold").setDescription("Primary Hold or region.").setRequired(true).addChoices(...holdChoices))
      .addStringOption((option) => option.setName("faction").setDescription("Faction or organization.").setMaxLength(150))
      .addStringOption((option) => option.setName("usual_locations").setDescription("Places where this person is usually found.").setMaxLength(500))
      .addStringOption((option) => option.setName("commentary").setDescription("Additional notes about the contact.").setMaxLength(1500))
      .addBooleanOption((option) => option.setName("high_priority").setDescription("Mark important contacts such as leaders or high-ranking officials.")))
    .addSubcommand((subcommand) => subcommand
      .setName("edit")
      .setDescription("Ranger+: edit a contact record.")
      .addStringOption((option) => option.setName("contact").setDescription("Contact to edit.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("name").setDescription("Replace the contact's name.").setMaxLength(100))
      .addStringOption((option) => option.setName("race").setDescription("Replace the contact's race.").setMaxLength(100))
      .addStringOption((option) => option.setName("sex").setDescription("Replace the contact's sex.").setMaxLength(100))
      .addStringOption((option) => option.setName("occupation").setDescription("Replace the occupation.").setMaxLength(100))
      .addStringOption((option) => option.setName("hold").setDescription("Replace the primary Hold or region.").addChoices(...holdChoices))
      .addStringOption((option) => option.setName("faction").setDescription("Replace the faction or organization.").setMaxLength(150))
      .addStringOption((option) => option.setName("usual_locations").setDescription("Replace usual locations.").setMaxLength(500))
      .addStringOption((option) => option.setName("commentary").setDescription("Replace the commentary.").setMaxLength(1500))
      .addBooleanOption((option) => option.setName("high_priority").setDescription("Set whether this is a high-priority contact.")))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("List active contacts, optionally filtered.")
      .addStringOption((option) => option.setName("hold").setDescription("Only contacts in this Hold or region.").addChoices(...holdChoices))
      .addStringOption((option) => option.setName("occupation").setDescription("Only contacts with this occupation.").setMaxLength(100))
      .addBooleanOption((option) => option.setName("high_priority").setDescription("Only show high-priority contacts.")))
    .addSubcommand((subcommand) => subcommand
      .setName("archive")
      .setDescription("Marshal+: archive a contact without deleting its history.")
      .addStringOption((option) => option.setName("contact").setDescription("Contact to archive.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("reason").setDescription("Why the contact is being archived.").setMaxLength(500))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const contacts = await listContacts();
    const choices = contacts
      .map(({ contact, summary }) => ({
        name: `${contact.high_priority ? "High Priority - " : ""}${contact.name} (${contact.hold}) - ${summary.status}`.slice(0, 100),
        value: contact.id
      }))
      .filter((choice) => choice.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("Contacts are only available in the Ranger Corps server.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "setup") {
      requireMarshal(actor);
      await interaction.deferReply({ ephemeral: true });
      const category = interaction.options.getChannel("category");
      const forum = await setupContactsForum(interaction.guild, category?.type === ChannelType.GuildCategory ? category.id : null);
      await interaction.editReply({ content: `The Contacts Forum is ready: ${forum}.` });
      return;
    }

    if (subcommand === "create") {
      requireContactCreator(actor);
      await interaction.deferReply({ ephemeral: true });
      const created = await createContact({
        guild: interaction.guild,
        creator: actor,
        name: interaction.options.getString("name", true),
        race: interaction.options.getString("race", true),
        sex: interaction.options.getString("sex", true),
        occupation: interaction.options.getString("occupation", true),
        hold: interaction.options.getString("hold", true),
        faction: interaction.options.getString("faction"),
        usualLocations: interaction.options.getString("usual_locations"),
        commentary: interaction.options.getString("commentary"),
        highPriority: interaction.options.getBoolean("high_priority") ?? false
      });
      await interaction.editReply({ content: `Contact created: ${created.thread}.` });
      return;
    }

    requireContactMember(actor);

    if (subcommand === "edit") {
      await interaction.deferReply({ ephemeral: true });
      const changes = optionalContactChanges(interaction);
      const updated = await editContact({
        guild: interaction.guild,
        editor: actor,
        contactId: interaction.options.getString("contact", true),
        ...changes
      });
      await interaction.editReply({ content: `Updated **${updated.contact.name}** in the Contacts Forum.` });
      return;
    }

    if (subcommand === "list") {
      const contacts = await listContacts({
        hold: interaction.options.getString("hold"),
        occupation: interaction.options.getString("occupation"),
        highPriority: interaction.options.getBoolean("high_priority")
      });
      const lines = contacts.slice(0, 25).map(({ contact, summary }) =>
        `${contact.high_priority ? "⚠️ " : ""}**${contact.name}** - ${contact.occupation} - ${contact.hold} - ${summary.status}`
      );
      await interaction.reply({
        content: lines.length ? lines.join("\n") : "No active contacts match those filters.",
        ephemeral: true
      });
      return;
    }

    requireMarshal(actor);
    if (subcommand === "archive") {
      await interaction.deferReply({ ephemeral: true });
      await archiveContact({
        guild: interaction.guild,
        contactId: interaction.options.getString("contact", true),
        archivedByDiscordUserId: actor.id,
        reason: interaction.options.getString("reason") ?? "Archived by a Marshal."
      });
      await interaction.editReply({ content: "The contact was archived and its history was preserved." });
    }
  }
};

function requireContactMember(member: GuildMember): void {
  if (!canUseTrailmarks(member)) {
    throw new UserFacingError("Apprentice or higher is required for contact records.");
  }
}

function requireContactCreator(member: GuildMember): void {
  if (!canUseTrailmarks(member)) {
    throw new UserFacingError("Apprentice or higher is required to create contact records.");
  }
}

function requireMarshal(member: GuildMember): void {
  if (!memberRankAtLeast(member, "Ranger Marshal")) {
    throw new UserFacingError("Ranger Marshal or higher is required for this contact command.");
  }
}

function optionalContactChanges(interaction: Parameters<BotCommand["execute"]>[0]): {
  name?: string;
  race?: string;
  sex?: string;
  occupation?: string;
  hold?: string;
  faction?: string | null;
  usualLocations?: string | null;
  commentary?: string | null;
  highPriority?: boolean;
} {
  const changes: ReturnType<typeof optionalContactChanges> = {};
  const name = interaction.options.getString("name");
  if (name !== null) changes.name = name;
  const race = interaction.options.getString("race");
  if (race !== null) changes.race = race;
  const sex = interaction.options.getString("sex");
  if (sex !== null) changes.sex = sex;
  const occupation = interaction.options.getString("occupation");
  if (occupation !== null) changes.occupation = occupation;
  const hold = interaction.options.getString("hold");
  if (hold !== null) changes.hold = hold;
  if (interaction.options.get("faction")) changes.faction = interaction.options.getString("faction");
  if (interaction.options.get("usual_locations")) changes.usualLocations = interaction.options.getString("usual_locations");
  if (interaction.options.get("commentary")) changes.commentary = interaction.options.getString("commentary");
  if (interaction.options.get("high_priority")) changes.highPriority = interaction.options.getBoolean("high_priority") ?? false;
  return changes;
}
