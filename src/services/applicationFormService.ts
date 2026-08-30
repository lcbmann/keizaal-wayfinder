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
  APPLICATION_TARGETS,
  applicationTitle,
  createCorpsApplication,
  isApplicationTarget,
  type ApplicationTarget,
  type CorpsApplicationResponse
} from "./applicationService.js";

const MODAL_PREFIX = "application:submit:";

type ApplicationFieldDestination = "reason" | "experience" | "hold" | "range" | "detail" | "response";

export interface ApplicationFormField {
  id: string;
  label: string;
  style: TextInputStyle;
  required: boolean;
  maxLength: number;
  destination: ApplicationFieldDestination;
  responseLabel?: string;
  placeholder?: string;
}

interface ApplicationFormDefinition {
  title: string;
  fields: ApplicationFormField[];
}

const reason = (label = "Why do you want this position?"): ApplicationFormField => ({
  id: "reason",
  label,
  style: TextInputStyle.Paragraph,
  required: true,
  maxLength: 1500,
  destination: "reason"
});

const experience = (label: string): ApplicationFormField => ({
  id: "experience",
  label,
  style: TextInputStyle.Paragraph,
  required: true,
  maxLength: 1500,
  destination: "experience"
});

const response = (id: string, label: string, required = true): ApplicationFormField => ({
  id,
  label,
  style: TextInputStyle.Paragraph,
  required,
  maxLength: 1500,
  destination: "response",
  responseLabel: label
});

const availability = response("availability", "Availability and current responsibilities");
const loyalties = response("loyalties", "Other loyalties/responsibilities, or none");

const FORM_DEFINITIONS: Record<ApplicationTarget, ApplicationFormDefinition> = {
  Quartermaster: {
    title: "Quartermaster Application",
    fields: [
      reason(),
      experience("Relevant logistical experience"),
      response("plans", "Would you change how supplies are organized?"),
      availability
    ]
  },
  Craftsman: {
    title: "Craftsman Application",
    fields: [
      {
        id: "specialty",
        label: "Craft or specialty",
        style: TextInputStyle.Short,
        required: true,
        maxLength: 150,
        destination: "detail",
        placeholder: "Blacksmithing, alchemy, tailoring..."
      },
      reason(),
      experience("Experience and capabilities"),
      response("support", "How would your craft support the Corps?"),
      availability
    ]
  },
  Agent: {
    title: "Agent Application",
    fields: [
      reason(),
      experience("Investigation experience"),
      response("approach", "Approach to evidence and confidentiality"),
      availability
    ]
  },
  Courier: {
    title: "Courier Application",
    fields: [
      reason(),
      experience("Travel and delivery experience"),
      response("routes", "Routes and regions you know well"),
      availability
    ]
  },
  Ambassador: {
    title: "Ambassador Application",
    fields: [
      reason(),
      experience("Diplomatic experience and contacts"),
      loyalties,
      response("approach", "How would you represent the Corps?"),
      availability
    ]
  },
  Instructor: {
    title: "Instructor Application",
    fields: [
      reason("Why do you wish to become an Instructor?"),
      experience("Teaching, mentoring, and field experience"),
      response("subjects", "Skills or subjects you can teach"),
      response("approach", "How would you structure practical training?"),
      availability
    ]
  },
  "Hold Warden": {
    title: "Hold Warden Application",
    fields: [
      holdField(),
      reason("Why are you suited to this Hold?"),
      experience("Knowledge and relationships in this Hold"),
      response("operations", "How would you lead operations there?"),
      availability
    ]
  },
  "Local Warden": {
    title: "Local Warden Application",
    fields: [
      holdField(),
      {
        id: "range",
        label: "Town or local Range",
        style: TextInputStyle.Short,
        required: true,
        maxLength: 150,
        destination: "range",
        placeholder: "Dragon Bridge, Ivarstead, Lake Ilinalta..."
      },
      reason("Why are you suited to this Range?"),
      experience("Knowledge and ties to this Range"),
      availability
    ]
  },
  "Ranger Marshal": {
    title: "Ranger Marshal Application",
    fields: [
      reason("Why do you wish to become a Marshal?"),
      experience("Corps service and leadership experience"),
      response("priorities", "Priorities as a Ranger Marshal"),
      loyalties,
      response("availability", "Availability and potential conflicts")
    ]
  },
  "Ranger Captain": {
    title: "Ranger Captain Application",
    fields: [
      reason("Why do you wish to become a Captain?"),
      experience("Command and leadership record"),
      response("priorities", "Priorities and command approach"),
      loyalties,
      response("availability", "Availability and potential conflicts")
    ]
  }
};

export function applicationFormDefinition(target: ApplicationTarget): ApplicationFormDefinition {
  return FORM_DEFINITIONS[target];
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
  const target = interaction.customId.slice(MODAL_PREFIX.length);
  if (!isApplicationTarget(target)) {
    throw new UserFacingError("That application form is no longer valid. Run `/application apply` again.");
  }
  const values = applicationValues(interaction, target);
  await interaction.deferReply({ ephemeral: true });
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

function holdField(): ApplicationFormField {
  return {
    id: "hold",
    label: "Parent Hold",
    style: TextInputStyle.Short,
    required: true,
    maxLength: 30,
    destination: "hold",
    placeholder: "Whiterun, Eastmarch, The Rift..."
  };
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

function applicationValues(interaction: ModalSubmitInteraction, target: ApplicationTarget): {
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

  for (const field of applicationFormDefinition(target).fields) {
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
