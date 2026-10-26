import { TextInputStyle } from "discord.js";
import type { MainRank } from "./ranks.js";
export const APPLICATION_TARGETS = ["Quartermaster", "Craftsman", "Agent", "Courier", "Ambassador", "Instructor", "Hold Warden", "Local Warden", "Marshal", "Captain"] as const;
export type ApplicationTarget = typeof APPLICATION_TARGETS[number];
export function builtinApplicationMinimumRank(target: ApplicationTarget): MainRank {
  return target === "Captain" ? "Marshal" : target === "Craftsman" || target === "Courier" ? "Apprentice" : "Ranger";
}

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

export interface ApplicationFormDefinition {
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
  "Marshal": {
    title: "Marshal Application",
    fields: [
      reason("Why do you wish to become a Marshal?"),
      experience("Corps service and leadership experience"),
      response("priorities", "Priorities as a Marshal"),
      loyalties,
      response("availability", "Availability and potential conflicts")
    ]
  },
  "Captain": {
    title: "Captain Application",
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


