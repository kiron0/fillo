import { normalizeText } from "./normalization";
import type { DetectedField, Profile } from "./types";

export interface TemplatePresetDefinition {
  id: string;
  name: string;
  description: string;
  tags: string[];
  mappingHints: Record<string, string[]>;
}

export const BUILTIN_TEMPLATE_PRESETS: TemplatePresetDefinition[] = [
  {
    id: "registration",
    name: "Registration",
    description: "Common identity, contact, department, and batch questions.",
    tags: ["student", "signup", "registration"],
    mappingHints: {
      "full name": ["fullName", "name"],
      email: ["email"],
      "phone number": ["phone", "mobile"],
      phone: ["phone", "mobile"],
      department: ["department"],
      batch: ["batch", "session"],
      session: ["session", "batch"],
      skills: ["skills", "topics"],
    },
  },
  {
    id: "job-application",
    name: "Job Application",
    description: "Applicant identity, role, experience, links, and contact details.",
    tags: ["career", "resume", "application"],
    mappingHints: {
      "full name": ["fullName", "name"],
      email: ["email"],
      "phone number": ["phone"],
      address: ["address"],
      company: ["company", "organization"],
      designation: ["designation", "title", "role"],
      department: ["department", "team"],
      skills: ["skills", "technologies"],
      portfolio: ["portfolio", "website"],
      linkedin: ["linkedin"],
    },
  },
  {
    id: "event-rsvp",
    name: "Event RSVP",
    description: "Quick RSVP and attendee contact details.",
    tags: ["event", "attendance", "rsvp"],
    mappingHints: {
      "full name": ["fullName", "name"],
      email: ["email"],
      phone: ["phone"],
      company: ["company", "organization"],
      "dietary restrictions": ["dietaryRestrictions", "dietary"],
      guests: ["guestCount", "guests"],
    },
  },
];

function normalizedTemplateLabels(template: TemplatePresetDefinition): Map<string, string[]> {
  return new Map(
    Object.entries(template.mappingHints).map(([label, keys]) => [normalizeText(label), keys.map((key) => normalizeText(key))]),
  );
}

export function findTemplatePresetById(templateId: string | null | undefined): TemplatePresetDefinition | null {
  return BUILTIN_TEMPLATE_PRESETS.find((template) => template.id === templateId) ?? null;
}

export function suggestTemplateMappingKey(
  template: TemplatePresetDefinition,
  field: DetectedField,
  profile: Profile | null,
): string | null {
  if (!profile) {
    return null;
  }

  const labels = normalizedTemplateLabels(template);
  const exactMatch = labels.get(field.normalizedLabel);
  if (exactMatch) {
    const profileKey = Object.keys(profile.values).find((key) => exactMatch.includes(normalizeText(key)));
    if (profileKey) {
      return profileKey;
    }
  }

  for (const [label, keys] of labels.entries()) {
    if (!field.normalizedLabel.includes(label) && !label.includes(field.normalizedLabel)) {
      continue;
    }

    const profileKey = Object.keys(profile.values).find((key) => keys.includes(normalizeText(key)));
    if (profileKey) {
      return profileKey;
    }
  }

  return null;
}
