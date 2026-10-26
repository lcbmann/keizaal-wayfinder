import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitInteraction
} from "discord.js";
import { HOLDS, type Hold } from "../config/holds.js";
import { UserFacingError } from "../utils/errors.js";
import {
  applicationTitle,
  createCorpsApplication,
  type ApplicationTarget,
  type CorpsApplicationResponse
} from "./applicationService.js";

const MODAL_PREFIX = "application:submit:";

export { applicationFormDefinition } from "../config/applicationForms.js";
import { applicationFormDefinition, type ApplicationFormField } from "../config/applicationForms.js";
import { configuredApplicationDefinition, getApplicationPosition, type ConfiguredApplicationPosition } from "./applicationConfigurationService.js";

export function configuredCorpsApplicationModal(position: ConfiguredApplicationPosition): ModalBuilder {
  const definition = configuredApplicationDefinition(position);
  return new ModalBuilder().setCustomId(`${MODAL_PREFIX}${position.key}:${position.revision}`)
    .setTitle(definition.title).addComponents(...definition.fields.map((field) =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(textInput(field))));
}

export function corpsApplicationModal(target: ApplicationTarget): ModalBuilder {
  const definition = applicationFormDefinition(target);
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${target}`)
    .setTitle(definition.title)
    .addComponents(...definition.fields.map((field) =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(textInput(field))
    ));
}

export async function handleCorpsApplicationModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Corps applications are only available in the Ranger Corps server.");
  }
  await interaction.deferReply({ ephemeral: true });
  const [target = "", revision = "default"] = interaction.customId.slice(MODAL_PREFIX.length).split(":");
  const position = await getApplicationPosition(target);
  if (position.revision !== revision) throw new UserFacingError("This application form changed while it was open. Run `/application apply` again.");
  const values = applicationValues(interaction, configuredApplicationDefinition(position).fields);
  const details = await createCorpsApplication({
    guild: interaction.guild,
    applicantDiscordUserId: interaction.user.id,
    target,
    reason: values.reason,
    experience: values.experience,
    hold: values.hold,
    range: values.range,
    assignmentDetail: values.assignmentDetail,
    responses: values.responses
  });
  await interaction.editReply({
    content: `Your **${applicationTitle(details)}** application has been filed for review${details.application.strongbox_thread_id ? ` in <#${details.application.strongbox_thread_id}>` : ""}.`
  });
}

function textInput(field: ApplicationFormField): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(field.id)
    .setLabel(field.label)
    .setStyle(field.style)
    .setRequired(field.required)
    .setMaxLength(field.maxLength);
  if (field.placeholder) {
    input.setPlaceholder(field.placeholder);
  }
  return input;
}

function applicationValues(interaction: ModalSubmitInteraction, fields: ApplicationFormField[]): {
  reason: string;
  experience: string | null;
  hold: Hold | null;
  range: string | null;
  assignmentDetail: string | null;
  responses: CorpsApplicationResponse[];
} {
  let reasonValue = "";
  let experienceValue: string | null = null;
  let hold: Hold | null = null;
  let range: string | null = null;
  let assignmentDetail: string | null = null;
  const responses: CorpsApplicationResponse[] = [];

  for (const field of fields) {
    const value = interaction.fields.getTextInputValue(field.id).trim();
    if (!value) {
      continue;
    }
    if (field.destination === "reason") {
      reasonValue = value;
    } else if (field.destination === "experience") {
      experienceValue = value;
    } else if (field.destination === "hold") {
      hold = normalizedHold(value);
    } else if (field.destination === "range") {
      range = value;
    } else if (field.destination === "detail") {
      assignmentDetail = value;
    } else {
      responses.push({ label: field.responseLabel ?? field.label, value });
    }
  }
  if (!reasonValue) {
    throw new UserFacingError("Explain why you are applying for this position.");
  }
  return { reason: reasonValue, experience: experienceValue, hold, range, assignmentDetail, responses };
}

function normalizedHold(value: string): Hold {
  const hold = HOLDS.find((candidate) => candidate.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  if (!hold) {
    throw new UserFacingError(`Enter one of Skyrim's nine Holds: ${HOLDS.join(", ")}.`);
  }
  return hold;
}

export function isCorpsApplicationModal(customId: string): boolean {
  return customId.startsWith(MODAL_PREFIX);
}
