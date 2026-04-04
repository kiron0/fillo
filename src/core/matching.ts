import type { DetectedField, FieldValue, Profile } from "./types";
import { normalizeText, profileKeyCandidates, tokenize } from "./normalization";

export interface MatchedFieldValue {
  value: FieldValue;
  profileKey: string | null;
  score: number;
}

function scoreTokens(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

export function suggestProfileKey(field: DetectedField, profile: Profile | null): string | null {
  if (!profile) {
    return null;
  }

  const label = normalizeText(field.label);
  let bestKey: string | null = null;
  let bestScore = 0;

  for (const key of Object.keys(profile.values)) {
    const candidates = profileKeyCandidates(key);

    for (const candidate of candidates) {
      if (candidate === label) {
        return key;
      }

      const score = scoreTokens(label, candidate);
      if (score > bestScore) {
        bestKey = key;
        bestScore = score;
      }
    }
  }

  return bestScore >= 0.45 ? bestKey : null;
}

export function buildInitialFieldValues(
  fields: DetectedField[],
  presetValues: Record<string, FieldValue>,
  presetMappings: Record<string, string> | undefined,
  profile: Profile | null,
): {
  values: Record<string, FieldValue>;
  mappings: Record<string, string>;
} {
  const values: Record<string, FieldValue> = {};
  const mappings: Record<string, string> = {};

  for (const field of fields) {
    const presetValue = presetValues[field.id];
    if (presetValue !== undefined) {
      values[field.id] = presetValue;
    }

    const mappedKey = presetMappings?.[field.id] ?? suggestProfileKey(field, profile);
    if (!mappedKey) {
      continue;
    }

    mappings[field.id] = mappedKey;

    if (values[field.id] !== undefined || !profile) {
      continue;
    }

    const candidate = profile.values[mappedKey];
    if (candidate !== undefined) {
      values[field.id] = candidate as FieldValue;
    }
  }

  return { values, mappings };
}
