import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type Guild, type GuildMember, type ModalSubmitInteraction, type Role } from "discord.js";
import { APPLICATION_TARGETS, applicationFormDefinition, builtinApplicationMinimumRank,
  type ApplicationTarget, type ApplicationFormDefinition } from "../config/applicationForms.js";
import { MAIN_RANKS, type MainRank } from "../config/ranks.js";
import { assertNoDbError, supabase, type ApplicationFormConfigRow, type CorpsDutyRow } from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { canManageAll } from "../utils/permissions.js";
import { slugify } from "../utils/slugs.js";
import { dutyDisplayName, usesWardenHierarchy } from "./dutyService.js";
import { clearMemberHoldRole } from "./holdRoleService.js";
import { getRangerByDiscordId } from "./rangerService.js";
import { refreshStoredAssignmentsBoard } from "./assignmentBoardService.js";

export const APPLICATION_CONFIG_MODAL_PREFIX = "application:configure:";
export const APPLICATION_CONFIG_OPEN_PREFIX = "application:configure-open:";
export interface ConfiguredApplicationPosition {
  key: string;
  builtinTarget: ApplicationTarget | null;
  duty: CorpsDutyRow | null;
  enabled: boolean;
  minimumRank: MainRank;
  description: string;
  questions: string[] | null;
  revision: string;
}

export function builtinTarget(value: string): ApplicationTarget | null {
  return APPLICATION_TARGETS.find((target) => target.toLowerCase() === value.toLowerCase()) ?? null;
}

export function mergeApplicationPositions(configs: ApplicationFormConfigRow[], duties: CorpsDutyRow[]): ConfiguredApplicationPosition[] {
  const keys = [...APPLICATION_TARGETS, ...configs.map(({ key }) => key)];
  return [...new Set(keys)].map((key) => {
    const builtin = builtinTarget(key);
    const config = configs.find((row) => row.key === key);
    const duty = config?.duty_id ? duties.find(({ id }) => id === config.duty_id) ?? null
      : builtin && builtin !== "Marshal" && builtin !== "Captain"
        ? duties.find(({ name }) => name === (builtin.endsWith("Warden") ? "Warden" : builtin)) ?? null : null;
    return { key, builtinTarget: builtin, duty,
      enabled: (config?.enabled ?? true) && (builtin === "Marshal" || builtin === "Captain" || Boolean(duty?.active))
        && (!(builtin === "Hold Warden" || builtin === "Local Warden") || Boolean(duty && usesWardenHierarchy(duty))),
      minimumRank: builtin === "Marshal" || builtin === "Captain" ? builtinApplicationMinimumRank(builtin)
        : config?.minimum_rank ?? (builtin ? builtinApplicationMinimumRank(builtin) : "Ranger"),
      description: config?.description || duty?.description || "",
      questions: Array.isArray(config?.questions) ? config.questions.filter((value): value is string => typeof value === "string") : null,
      revision: config?.revision ?? "default" };
  });
}

export async function listApplicationPositions(): Promise<ConfiguredApplicationPosition[]> {
  const [result, dutyResult] = await Promise.all([supabase.from("application_form_configs").select("*"), supabase.from("corps_duties").select("*")]);
  assertNoDbError(result.error, "load application configuration");
  assertNoDbError(dutyResult.error, "load application duty definitions");
  return mergeApplicationPositions(result.data ?? [], dutyResult.data ?? []);
}

export async function getApplicationPosition(key: string): Promise<ConfiguredApplicationPosition> {
  const position = (await listApplicationPositions()).find((position) => position.key.toLowerCase() === key.trim().toLowerCase());
  if (!position?.enabled) throw new UserFacingError("That application is not currently open. Choose a position with `/application apply`.");
  return position;
}

export function configuredApplicationDefinition(position: ConfiguredApplicationPosition): ApplicationFormDefinition {
  if (position.builtinTarget && !position.questions) return applicationFormDefinition(position.builtinTarget);
  const fixed = position.builtinTarget ? applicationFormDefinition(position.builtinTarget).fields
    .filter(({ destination }) => ["hold", "range", "detail"].includes(destination)) : [];
  const questions = position.questions ?? ["Why do you want this position?", "Relevant experience or knowledge", "How would you support the Corps?", "Availability and other responsibilities"];
  validateApplicationQuestions(questions, 5 - fixed.length);
  return { title: `${position.key} Application`.slice(0, 45), fields: [...fixed,
    ...questions.map((label, index) => ({ id: `question_${index}`, label, style: TextInputStyle.Paragraph,
      required: true, maxLength: index === 0 ? 1200 : 800,
      destination: index === 0 ? "reason" as const : "response" as const, responseLabel: label }))] };
}

export function validateApplicationQuestions(questions: string[], maximum = 5): void {
  if (!questions.length || questions.length > maximum) throw new UserFacingError(`Enter between 1 and ${maximum} questions, one per line.`);
  if (questions.some((question) => !question.trim() || question.length > 45)) {
    throw new UserFacingError("Keep each question between 1 and 45 characters so it fits in the Discord form.");
  }
}

export { assertSafeApplicationRole } from "../utils/applicationRoles.js";
import { assertSafeApplicationRole } from "../utils/applicationRoles.js";

export async function applicationConfigurationModal(params: {
  guild: Guild; actor: GuildMember; positionName: string; role: Role | null; minimumRank: MainRank | null; replaces: string;
}): Promise<ModalBuilder> {
  if (!canManageAll(params.actor)) throw new UserFacingError("Captain or higher is required to configure applications.");
  const positions = await listApplicationPositions();
  const previous = positions.find(({ key }) => key.toLowerCase() === params.positionName.trim().toLowerCase());
  const key = previous?.key ?? params.positionName.trim();
  if ((previous?.builtinTarget === "Hold Warden" || previous?.builtinTarget === "Local Warden")
    && previous.duty && !usesWardenHierarchy(previous.duty)) {
    throw new UserFacingError("The Warden positions have been consolidated. Configure Guide or create a new duty application instead.");
  }
  const protectedName = [...MAIN_RANKS, "Senior Ranger", "Retired Ranger"].some((name) => name.toLowerCase() === key.toLowerCase());
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '\-]{0,31}$/u.test(key) || (!previous && protectedName) || !slugify(key)) {
    throw new UserFacingError("Use a duty name of up to 32 letters, numbers, spaces, apostrophes or hyphens.");
  }
  const replaces: string[] = [];
  for (const name of params.replaces.split(",").map((value) => value.trim()).filter(Boolean)) {
    const match = positions.find(({ key }) => key.toLowerCase() === name.toLowerCase());
    if (name.toLowerCase() === "warden") replaces.push("Warden");
    else if (match?.builtinTarget === "Hold Warden" || match?.builtinTarget === "Local Warden") {
      throw new UserFacingError("Use replaces:Warden to consolidate both Warden positions together.");
    }
    else if (!match || match.builtinTarget === "Marshal" || match.builtinTarget === "Captain") {
      throw new UserFacingError(`Cannot replace ${name}. Choose an existing duty application, not a leadership rank.`);
    } else {
      replaces.push(match.key);
      if (match.duty) replaces.push(match.duty.name);
    }
  }
  let role = params.role;
  if (!role && previous?.duty?.discord_role_id) role = await params.guild.roles.fetch(previous.duty.discord_role_id);
  const leadership = previous?.builtinTarget === "Marshal" || previous?.builtinTarget === "Captain";
  if (leadership && (params.role || replaces.length || params.minimumRank)) {
    throw new UserFacingError("Marshal and Captain forms can be edited, but their rank rules and promotion-vote workflow stay fixed.");
  }
  if (!leadership && !role) throw new UserFacingError("Select the Discord duty role when creating a new application.");
  if (role) assertSafeApplicationRole(role);
  const { data: duties, error: dutyError } = await supabase.from("corps_duties").select("*");
  assertNoDbError(dutyError, "load duty role ownership");
  const roleOwner = duties?.find((duty) => duty.discord_role_id === role?.id);
  if (previous?.duty && roleOwner && roleOwner.id !== previous.duty.id) {
    throw new UserFacingError(`That role belongs to ${dutyDisplayName(roleOwner)}. Select an unused role, or configure a new position that explicitly replaces the old duties.`);
  }
  if (!previous && roleOwner && dutyDisplayName(roleOwner).toLowerCase() !== key.toLowerCase()
    && !replaces.includes(roleOwner.name)) {
    throw new UserFacingError(`This role belongs to ${dutyDisplayName(roleOwner)}. Include replaces:${dutyDisplayName(roleOwner)} to consolidate it.`);
  }
  for (const current of positions.filter((position) => roleOwner && position.enabled && position.duty?.id === roleOwner.id && position.key !== key)) {
    const replacedByWarden = (current.builtinTarget === "Hold Warden" || current.builtinTarget === "Local Warden") && replaces.includes("Warden");
    if (!replacedByWarden && !replaces.includes(current.key)) {
      throw new UserFacingError(`This role is used by ${current.key} applications. Include replaces:${current.key} to replace that form.`);
    }
  }
  const minimumRank = leadership ? previous.minimumRank : params.minimumRank ?? previous?.minimumRank ?? "Ranger";
  const fixed = previous?.builtinTarget ? applicationFormDefinition(previous.builtinTarget).fields
    .filter(({ destination }) => ["hold", "range", "detail"].includes(destination)) : [];
  const definition = previous ? configuredApplicationDefinition(previous) : null;
  const questions = definition?.fields.filter((field) => !fixed.some(({ id }) => id === field.id)).map(({ label }) => label)
    ?? ["Why do you want this position?", "Relevant experience or knowledge", "How would you support the Corps?", "Availability and other responsibilities"];
  const id = randomUUID();
  const cleanup = await supabase.from("application_configuration_drafts").delete().lt("expires_at", new Date().toISOString());
  assertNoDbError(cleanup.error, "remove expired application editors");
  const { error } = await supabase.from("application_configuration_drafts").insert({ id, guild_id: params.guild.id,
    actor_discord_user_id: params.actor.id, payload: { key, role_id: role?.id ?? null,
      minimum_rank: minimumRank, duty_id: previous?.duty?.id ?? roleOwner?.id ?? null,
      builtin_target: previous?.builtinTarget ?? null, slug: slugify(key), replaces: [...new Set(replaces)],
      editor_description: previous?.description ?? "", editor_questions: questions,
      maximum_questions: 5 - fixed.length,
      expected_revision: previous?.revision === "default" ? null : previous?.revision ?? null } });
  assertNoDbError(error, "prepare application editor");
  const description = new TextInputBuilder().setCustomId("description").setLabel("Position description")
    .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false);
  if (previous?.description) description.setValue(previous.description.slice(0, 1000));
  const input = new TextInputBuilder().setCustomId("questions").setLabel(`Questions (max ${5 - fixed.length}, 45 characters each)`).setPlaceholder("One question per line")
    .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(questions.join("\n"));
  return new ModalBuilder().setCustomId(`${APPLICATION_CONFIG_MODAL_PREFIX}${id}`).setTitle(`Configure ${key}`.slice(0, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(description), new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export async function openApplicationConfiguration(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild() || !canManageAll(interaction.member)) throw new UserFacingError("Captain or higher is required to configure applications.");
  const { data: draft, error } = await supabase.from("application_configuration_drafts").select("*")
    .eq("id", interaction.customId.slice(APPLICATION_CONFIG_OPEN_PREFIX.length))
    .eq("guild_id", interaction.guild.id).eq("actor_discord_user_id", interaction.user.id)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  assertNoDbError(error, "open application editor");
  if (!draft?.payload || typeof draft.payload !== "object" || Array.isArray(draft.payload)) throw new UserFacingError("This editor expired. Run `/application configure` again.");
  const payload = draft.payload;
  const description = new TextInputBuilder().setCustomId("description").setLabel("Position description")
    .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false);
  if (typeof payload.editor_description === "string" && payload.editor_description) description.setValue(payload.editor_description);
  const questions = new TextInputBuilder().setCustomId("questions").setLabel(`Questions (max ${payload.maximum_questions}, 45 characters each)`).setPlaceholder("One question per line")
    .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
    .setValue((payload.editor_questions as string[]).join("\n"));
  await interaction.showModal(new ModalBuilder().setCustomId(`${APPLICATION_CONFIG_MODAL_PREFIX}${draft.id}`)
    .setTitle(`Configure ${payload.key}`.slice(0, 45)).addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(description), new ActionRowBuilder<TextInputBuilder>().addComponents(questions)));
}

export async function handleApplicationConfigurationModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) throw new UserFacingError("Use this form in the Corps server.");
  await interaction.deferReply({ ephemeral: true });
  const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
  if (!canManageAll(actor)) throw new UserFacingError("Captain or higher is required to configure applications.");
  const id = interaction.customId.slice(APPLICATION_CONFIG_MODAL_PREFIX.length);
  const { data: draft, error } = await supabase.from("application_configuration_drafts").select("*")
    .eq("id", id).eq("guild_id", interaction.guild.id).eq("actor_discord_user_id", actor.id)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  assertNoDbError(error, "load application editor");
  if (!draft || !draft.payload || typeof draft.payload !== "object" || Array.isArray(draft.payload)) {
    throw new UserFacingError("This configuration form expired. Run `/application configure` again.");
  }
  const payload = draft.payload;
  if (typeof payload.role_id === "string") {
    const role = await interaction.guild.roles.fetch(payload.role_id);
    if (!role) throw new UserFacingError("The selected duty role no longer exists.");
    assertSafeApplicationRole(role);
  }
  const questions = interaction.fields.getTextInputValue("questions").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const builtin = typeof payload.builtin_target === "string" ? builtinTarget(payload.builtin_target) : null;
  const fixed = builtin ? applicationFormDefinition(builtin).fields.filter(({ destination }) => ["hold", "range", "detail"].includes(destination)).length : 0;
  validateApplicationQuestions(questions, 5 - fixed);
  const { data: result, error: saveError } = await supabase.rpc("configure_application_form", {
    draft_id_input: id, guild_id_input: interaction.guild.id, actor_input: actor.id,
    description_input: interaction.fields.getTextInputValue("description").trim(), questions_input: questions
  });
  assertNoDbError(saveError, "save application configuration");
  const saved = result as { position: { key: string; revision: string }; member_ids: string[]; role_id: string | null; old_role_ids: (string | null)[]; clear_hold_roles: boolean };
  let unavailable = 0;
  if (saved.role_id) {
    try {
      const role = await interaction.guild.roles.fetch(saved.role_id);
      if (role && role.name !== saved.position.key) await role.setName(saved.position.key, "Configured application duty name");
    } catch (roleError) {
      unavailable++;
      console.warn("Could not update the configured duty role name:", roleError);
    }
  }
  for (const memberId of saved.member_ids) {
    try {
      const member = await interaction.guild.members.fetch({ user: memberId, force: true });
      const ranger = await getRangerByDiscordId(memberId);
      if (!ranger || !["Active", "On Leave"].includes(ranger.status)) continue;
      if (saved.role_id) await member.roles.add(saved.role_id, "Application duty configuration updated");
      if (saved.clear_hold_roles) await clearMemberHoldRole(member);
      for (const oldRoleId of saved.old_role_ids) {
        if (oldRoleId && oldRoleId !== saved.role_id && member.roles.cache.has(oldRoleId)) {
          await member.roles.remove(oldRoleId, "Duty consolidated through application configuration");
        }
      }
    } catch (memberError) {
      unavailable++;
      console.warn(`Could not reconcile configured duty role for ${memberId}:`, memberError);
    }
  }
  if (!unavailable) {
    const { error: reconcileError } = await supabase.from("application_form_configs").update({ retired_role_ids: [], clear_hold_roles: false })
      .eq("key", saved.position.key).eq("revision", saved.position.revision);
    assertNoDbError(reconcileError, "finish duty role reconciliation");
  }
  const rosterUpdated = await refreshStoredAssignmentsBoard(interaction.guild).catch((rosterError) => {
    console.warn("Application configuration saved, but the roster could not be refreshed:", rosterError);
    return false;
  });
  await interaction.editReply({ content: `**${saved.position.key}** applications are open. The questions and duty settings have been saved.`
    + (rosterUpdated ? " The roster has been refreshed." : " Run `/ranger assignments` in the roster channel to refresh its display.")
    + (unavailable ? ` ${unavailable} member role update(s) could not finish. Run the same configuration again to retry.` : "") });
}

export async function setApplicationPositionEnabled(key: string, enabled: boolean, actorId: string): Promise<string> {
  const position = (await listApplicationPositions()).find((position) => position.key.toLowerCase() === key.toLowerCase());
  if (!position) throw new UserFacingError("Choose an existing application position.");
  if (enabled && position.builtinTarget !== "Marshal" && position.builtinTarget !== "Captain" && !position.duty?.active) {
    throw new UserFacingError("This duty was consolidated or deactivated. Use `/application configure` with a duty role to reopen it.");
  }
  if (enabled && (position.builtinTarget === "Hold Warden" || position.builtinTarget === "Local Warden")
    && position.duty && !usesWardenHierarchy(position.duty)) {
    throw new UserFacingError("These Warden positions have been consolidated. Configure Guide or a new duty application instead.");
  }
  const { data: existing, error: lookupError } = await supabase.from("application_form_configs").select("*").eq("key", position.key).maybeSingle();
  assertNoDbError(lookupError, "load application settings");
  const values = { enabled, revision: randomUUID(), updated_by_discord_user_id: actorId, updated_at: new Date().toISOString() };
  const result = existing ? await supabase.from("application_form_configs").update(values).eq("key", position.key).eq("revision", existing.revision).select("key").single()
    : await supabase.from("application_form_configs").insert({ key: position.key, duty_id: position.duty?.id ?? null, minimum_rank: position.minimumRank, ...values });
  assertNoDbError(result.error, "change application availability");
  return position.key;
}
