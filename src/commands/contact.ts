import { ChannelType, SlashCommandBuilder, type GuildMember } from "discord.js";
import {
  CONTACT_GROUP_CATEGORIES,
  CONTACT_HOLD_CHOICES,
  archiveContact,
  createContact,
  createContactGroup,
  editContact,
  linkContactGroupMember,
  listContacts,
  setupContactsForum,
  unlinkContactGroupMember
} from "../services/contactService.js";
import { canUseTrailmarks, memberRankAtLeast } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";
import type { BotCommand } from "./types.js";

const holdChoices = CONTACT_HOLD_CHOICES.map((hold) => ({ name: hold, value: hold }));
const groupCategoryChoices = CONTACT_GROUP_CATEGORIES.map((category) => ({ name: category, value: category }));

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
      .setDescription("Apprentice+: create a record for an individual contact.")
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
      .setName("create-group")
      .setDescription("Apprentice+: create a record for a known group.")
      .addStringOption((option) => option.setName("name").setDescription("The group's known name.").setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName("category").setDescription("What kind of group this is.").setRequired(true).addChoices(...groupCategoryChoices))
      .addStringOption((option) => option.setName("hold").setDescription("Primary Hold or region.").setRequired(true).addChoices(...holdChoices))
      .addStringOption((option) => option.setName("estimated_size").setDescription("Estimated numbers or strength.").setMaxLength(200))
      .addStringOption((option) => option.setName("identifying_features").setDescription("Clothing, symbols, appearance, or other identifying signs.").setMaxLength(700))
      .addStringOption((option) => option.setName("weapons_capabilities").setDescription("Known weapons, magic, creatures, or other capabilities.").setMaxLength(700))
      .addStringOption((option) => option.setName("tactics").setDescription("Known tactics, behavior, or patterns.").setMaxLength(700))
      .addStringOption((option) => option.setName("usual_locations").setDescription("Territory, camps, routes, or usual locations.").setMaxLength(500))
      .addStringOption((option) => option.setName("faction").setDescription("Larger faction or known affiliation.").setMaxLength(150))
      .addStringOption((option) => option.setName("commentary").setDescription("Additional intelligence or notes.").setMaxLength(1500))
      .addBooleanOption((option) => option.setName("high_priority").setDescription("Mark a particularly important or dangerous group.")))
    .addSubcommand((subcommand) => subcommand
      .setName("edit")
      .setDescription("Apprentice+: edit a person or group record.")
      .addStringOption((option) => option.setName("contact").setDescription("Person or group to edit.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("name").setDescription("Replace the record's name.").setMaxLength(100))
      .addStringOption((option) => option.setName("race").setDescription("Replace the contact's race.").setMaxLength(100))
      .addStringOption((option) => option.setName("sex").setDescription("Replace the contact's sex.").setMaxLength(100))
      .addStringOption((option) => option.setName("occupation").setDescription("Replace the occupation.").setMaxLength(100))
      .addStringOption((option) => option.setName("hold").setDescription("Replace the primary Hold or region.").addChoices(...holdChoices))
      .addStringOption((option) => option.setName("faction").setDescription("Replace the faction or organization.").setMaxLength(150))
      .addStringOption((option) => option.setName("usual_locations").setDescription("Replace usual locations.").setMaxLength(500))
      .addStringOption((option) => option.setName("commentary").setDescription("Replace the commentary.").setMaxLength(1500))
      .addStringOption((option) => option.setName("group_category").setDescription("Group records only: replace the category.").addChoices(...groupCategoryChoices))
      .addStringOption((option) => option.setName("estimated_size").setDescription("Group records only: replace estimated size.").setMaxLength(200))
      .addStringOption((option) => option.setName("identifying_features").setDescription("Group records only: replace identifying signs.").setMaxLength(700))
      .addStringOption((option) => option.setName("weapons_capabilities").setDescription("Group records only: replace arms or capabilities.").setMaxLength(700))
      .addStringOption((option) => option.setName("tactics").setDescription("Group records only: replace tactics or behavior.").setMaxLength(700))
      .addBooleanOption((option) => option.setName("high_priority").setDescription("Set whether this is a high-priority contact.")))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("List active people and groups, optionally filtered.")
      .addStringOption((option) => option.setName("type").setDescription("Only people or groups.").addChoices(
        { name: "People", value: "Person" },
        { name: "Groups", value: "Group" }
      ))
      .addStringOption((option) => option.setName("hold").setDescription("Only contacts in this Hold or region.").addChoices(...holdChoices))
      .addStringOption((option) => option.setName("occupation").setDescription("Only contacts with this occupation.").setMaxLength(100))
      .addStringOption((option) => option.setName("group_category").setDescription("Only groups in this category.").addChoices(...groupCategoryChoices))
      .addBooleanOption((option) => option.setName("high_priority").setDescription("Only show high-priority contacts.")))
    .addSubcommand((subcommand) => subcommand
      .setName("link-member")
      .setDescription("Apprentice+: link a person contact as a known member of a group.")
      .addStringOption((option) => option.setName("group").setDescription("Group contact record.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("person").setDescription("Person contact record to add as a member.").setRequired(true).setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("unlink-member")
      .setDescription("Apprentice+: remove a person's membership link from a group.")
      .addStringOption((option) => option.setName("group").setDescription("Group contact record.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("person").setDescription("Person contact record to unlink.").setRequired(true).setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("archive")
      .setDescription("Marshal+: archive a contact without deleting its history.")
      .addStringOption((option) => option.setName("contact").setDescription("Contact to archive.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("reason").setDescription("Why the contact is being archived.").setMaxLength(500))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const subcommand = interaction.options.getSubcommand();
    const recordType = (subcommand === "link-member" || subcommand === "unlink-member")
      ? focused.name === "group" ? "Group" : "Person"
      : null;
    const contacts = await listContacts({ recordType });
    const choices = contacts
      .map(({ contact, summary }) => ({
        name: `${contact.high_priority ? "High Priority - " : ""}[${contact.record_type}] ${contact.name} (${contact.hold}) - ${summary.status}`.slice(0, 100),
        value: contact.id
      }))
      .filter((choice) => choice.name.toLowerCase().includes(focused.value.toLowerCase()))
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

    if (subcommand === "create-group") {
      requireContactCreator(actor);
      await interaction.deferReply({ ephemeral: true });
      const created = await createContactGroup({
        guild: interaction.guild,
        creator: actor,
        name: interaction.options.getString("name", true),
        groupCategory: interaction.options.getString("category", true),
        hold: interaction.options.getString("hold", true),
        estimatedSize: interaction.options.getString("estimated_size"),
        identifyingFeatures: interaction.options.getString("identifying_features"),
        weaponsCapabilities: interaction.options.getString("weapons_capabilities"),
        tactics: interaction.options.getString("tactics"),
        usualLocations: interaction.options.getString("usual_locations"),
        faction: interaction.options.getString("faction"),
        commentary: interaction.options.getString("commentary"),
        highPriority: interaction.options.getBoolean("high_priority") ?? false
      });
      await interaction.editReply({ content: `Group record created: ${created.thread}.` });
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
      const recordType = interaction.options.getString("type");
      const contacts = await listContacts({
        recordType: recordType === "Person" || recordType === "Group" ? recordType : null,
        hold: interaction.options.getString("hold"),
        occupation: interaction.options.getString("occupation"),
        groupCategory: interaction.options.getString("group_category"),
        highPriority: interaction.options.getBoolean("high_priority")
      });
      const lines = contacts.slice(0, 25).map(({ contact, summary }) => {
        const kind = contact.record_type === "Group" ? contact.group_category ?? "Group" : contact.occupation ?? "Unknown occupation";
        return `${contact.high_priority ? "⚠️ " : ""}**${contact.name}** - ${kind} - ${contact.hold} - ${summary.status}`;
      });
      await interaction.reply({
        content: lines.length ? lines.join("\n") : "No active contacts match those filters.",
        ephemeral: true
      });
      return;
    }

    if (subcommand === "link-member") {
      await interaction.deferReply({ ephemeral: true });
      const linked = await linkContactGroupMember({
        guild: interaction.guild,
        actor,
        groupContactId: interaction.options.getString("group", true),
        memberContactId: interaction.options.getString("person", true)
      });
      await interaction.editReply({
        content: `Linked **${linked.member.name}** as a known member of **${linked.group.name}**. Both contact records have been updated.`
      });
      return;
    }

    if (subcommand === "unlink-member") {
      await interaction.deferReply({ ephemeral: true });
      const unlinked = await unlinkContactGroupMember({
        guild: interaction.guild,
        actor,
        groupContactId: interaction.options.getString("group", true),
        memberContactId: interaction.options.getString("person", true)
      });
      await interaction.editReply({
        content: `Removed **${unlinked.member.name}** from the known members of **${unlinked.group.name}**. Both contact records have been updated.`
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
  groupCategory?: string;
  estimatedSize?: string | null;
  identifyingFeatures?: string | null;
  weaponsCapabilities?: string | null;
  tactics?: string | null;
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
  const groupCategory = interaction.options.getString("group_category");
  if (groupCategory !== null) changes.groupCategory = groupCategory;
  if (interaction.options.get("estimated_size")) changes.estimatedSize = interaction.options.getString("estimated_size");
  if (interaction.options.get("identifying_features")) changes.identifyingFeatures = interaction.options.getString("identifying_features");
  if (interaction.options.get("weapons_capabilities")) changes.weaponsCapabilities = interaction.options.getString("weapons_capabilities");
  if (interaction.options.get("tactics")) changes.tactics = interaction.options.getString("tactics");
  if (interaction.options.get("high_priority")) changes.highPriority = interaction.options.getBoolean("high_priority") ?? false;
  return changes;
}
