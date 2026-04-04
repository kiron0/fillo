const punctuationPattern = /[!*()[\]{}:;,.?'"`~_-]+$/g;

export const PROFILE_KEY_ALIASES: Record<string, string[]> = {
  fullName: ["full name", "name", "your name", "applicant name"],
  email: ["email", "email address", "mail"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact number"],
  studentId: ["student id", "student number", "id number", "roll"],
  address: ["address", "mailing address", "current address"],
  company: ["company", "organization", "organisation"],
  department: ["department", "faculty", "team"],
  designation: ["designation", "title", "job title", "role"],
};

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\*/g, "")
    .replace(punctuationPattern, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function toProfileLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

export function optionEquals(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right);
}

export function profileKeyCandidates(key: string): string[] {
  const label = normalizeText(toProfileLabel(key));
  const aliases = PROFILE_KEY_ALIASES[key] ?? [];
  return [key, label, ...aliases].map(normalizeText).filter(Boolean);
}
