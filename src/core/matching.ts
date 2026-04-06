import type { DetectedField, FieldValue, FormHistoryEntry, Profile } from "./types";
import { normalizeFieldValueForField } from "./field-value-normalization";
import { normalizeText, profileKeyCandidates, tokenize } from "./normalization";

export interface MatchedFieldValue {
  value: FieldValue;
  profileKey: string | null;
  score: number;
}

export interface RankedProfileSuggestion {
  profile: Profile;
  score: number;
  matchedFieldCount: number;
  historyBoost: number;
  lastUsedAt: number;
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
    const candidates = getProfileCandidates(profile, key);

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

function getProfileCandidates(profile: Profile, key: string): string[] {
  const aliases = profile.aliases?.[key] ?? [];
  return [...profileKeyCandidates(key), ...aliases.map(normalizeText)].filter(Boolean);
}

export function rankProfilesForFields(
  fields: DetectedField[],
  profiles: Profile[],
  history: FormHistoryEntry[],
  formKey?: string,
): RankedProfileSuggestion[] {
  const latestHistoryByProfileId = new Map<string, FormHistoryEntry>();

  if (formKey) {
    for (const entry of history) {
      if (entry.formKey !== formKey || !entry.lastUsedProfileId) {
        continue;
      }

      const previousEntry = latestHistoryByProfileId.get(entry.lastUsedProfileId);
      if (!previousEntry || entry.lastFilledAt >= previousEntry.lastFilledAt) {
        latestHistoryByProfileId.set(entry.lastUsedProfileId, entry);
      }
    }
  }

  return profiles
    .map((profile) => {
      let matchedFieldCount = 0;
      let totalScore = 0;

      for (const field of fields) {
        let bestFieldScore = 0;
        for (const key of Object.keys(profile.values)) {
          if (normalizeFieldValueForField(field, profile.values[key]) === undefined) {
            continue;
          }

          for (const candidate of getProfileCandidates(profile, key)) {
            if (candidate === field.normalizedLabel) {
              bestFieldScore = 1;
              break;
            }

            bestFieldScore = Math.max(bestFieldScore, scoreTokens(field.normalizedLabel, candidate));
          }

          if (bestFieldScore === 1) {
            break;
          }
        }

        if (bestFieldScore >= 0.45) {
          matchedFieldCount += 1;
          totalScore += bestFieldScore;
        }
      }

      const historyEntry = latestHistoryByProfileId.get(profile.id);
      const historyBoost =
        historyEntry && matchedFieldCount > 0
          ? 1 + Math.min(1, matchedFieldCount / Math.max(fields.length, 1))
          : 0;

      return {
        profile,
        matchedFieldCount,
        historyBoost,
        lastUsedAt: historyEntry?.lastFilledAt ?? 0,
        score: totalScore + historyBoost,
      };
    })
    .filter((entry) => entry.matchedFieldCount > 0 || entry.historyBoost > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.matchedFieldCount !== left.matchedFieldCount) {
        return right.matchedFieldCount - left.matchedFieldCount;
      }

      if (right.lastUsedAt !== left.lastUsedAt) {
        return right.lastUsedAt - left.lastUsedAt;
      }

      return right.profile.updatedAt - left.profile.updatedAt;
    });
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

    const presetMappedKey = presetMappings?.[field.id];
    const compatiblePresetMappedKey =
      profile && presetMappedKey
        ? normalizeFieldValueForField(field, profile.values[presetMappedKey]) !== undefined
          ? presetMappedKey
          : null
        : null;
    const suggestedMappedKey = profile
      ? suggestProfileKey(field, profile)
      : null;
    const compatibleSuggestedMappedKey =
      profile && suggestedMappedKey
        ? normalizeFieldValueForField(field, profile.values[suggestedMappedKey]) !== undefined
          ? suggestedMappedKey
          : null
        : null;
    const mappedKey = profile
      ? (compatiblePresetMappedKey ??
          compatibleSuggestedMappedKey)
      : null;
    if (!mappedKey) {
      continue;
    }

    mappings[field.id] = mappedKey;

    if (values[field.id] !== undefined || !profile) {
      continue;
    }

    const candidate = normalizeFieldValueForField(field, profile.values[mappedKey]);
    if (candidate !== undefined) {
      values[field.id] = candidate;
    }
  }

  return { values, mappings };
}
