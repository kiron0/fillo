import { normalizeText, optionEquals } from "./normalization";
import type { ChoiceWithOtherValue, DetectedField, FieldValue, GridValue, ProfileValue } from "./types";

export function isChoiceWithOtherValue(value: unknown): value is ChoiceWithOtherValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "kind" in value &&
    value.kind === "choice_with_other" &&
    "selected" in value &&
    (typeof value.selected === "string" || (Array.isArray(value.selected) && value.selected.every((item) => typeof item === "string"))) &&
    "otherText" in value &&
    typeof value.otherText === "string"
  );
}

export function isGridValue(value: unknown): value is GridValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "kind" in value &&
    value.kind === "grid" &&
    "rows" in value &&
    typeof value.rows === "object" &&
    value.rows !== null &&
    !Array.isArray(value.rows) &&
    Object.values(value.rows).every(
      (rowValue) =>
        typeof rowValue === "string" ||
        (Array.isArray(rowValue) && rowValue.every((item) => typeof item === "string")),
    )
  );
}

export function isValidDateValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidTimeValue(value: string): boolean {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) {
    return false;
  }

  const [, hoursText, minutesText, secondsText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = secondsText === undefined ? 0 : Number(secondsText);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
}

export function looksLikePlaceholderOption(label: string): boolean {
  const normalized = normalizeText(label);
  return (
    normalized === "choose" ||
    normalized === "select" ||
    normalized === "select an option" ||
    normalized === "choose an option"
  );
}

export function getSelectableOptions(field: DetectedField): string[] {
  return (field.options ?? []).filter((option) => !looksLikePlaceholderOption(option));
}

function findMatchingOption(field: DetectedField, value: string): string | undefined {
  return getSelectableOptions(field).find((option) => optionEquals(option, value));
}

function normalizeCheckboxValues(
  field: DetectedField,
  values: string[],
  otherTextOverride?: string,
): FieldValue | undefined {
  const selected: string[] = [];
  const unmatched: string[] = [];
  let otherSelected = false;

  for (const rawValue of values) {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) {
      continue;
    }

    if (field.otherOption && optionEquals(trimmedValue, field.otherOption)) {
      if (!selected.some((value) => optionEquals(value, field.otherOption as string))) {
        selected.push(field.otherOption);
      }
      otherSelected = true;
      continue;
    }

    const matchedOption = findMatchingOption(field, trimmedValue);
    if (matchedOption) {
      if (!selected.some((value) => optionEquals(value, matchedOption))) {
        selected.push(matchedOption);
      }
      continue;
    }

    unmatched.push(trimmedValue);
  }

  if (unmatched.length > 1) {
    return undefined;
  }

  if (unmatched.length === 1) {
    if (!field.otherOption) {
      return undefined;
    }

    if (!selected.some((value) => optionEquals(value, field.otherOption as string))) {
      selected.push(field.otherOption);
    }

    return {
      kind: "choice_with_other",
      selected,
      otherText: unmatched[0],
    };
  }

  if (otherSelected) {
    const trimmedOtherText = (otherTextOverride ?? "").trim();
    if (!trimmedOtherText) {
      const selectedWithoutOther = selected.filter((value) => !optionEquals(value, field.otherOption as string));
      return selectedWithoutOther.length > 0 ? selectedWithoutOther : undefined;
    }

    return {
      kind: "choice_with_other",
      selected,
      otherText: trimmedOtherText,
    };
  }

  return selected.length > 0 ? selected : undefined;
}

function normalizeGridValue(field: DetectedField, value: FieldValue | ProfileValue): GridValue | undefined {
  if (!isGridValue(value) || !field.gridRows?.length || !field.options?.length || !field.gridMode) {
    return undefined;
  }

  const normalizedRows: Record<string, string | string[]> = {};

  for (const [rowIndex, rowLabel] of field.gridRows.entries()) {
    const rowKey = field.gridRowIds?.[rowIndex] ?? rowLabel;
    const rawRowValue = value.rows[rowKey] ?? value.rows[rowLabel];
    if (rawRowValue === undefined || rawRowValue === null) {
      continue;
    }

    if (field.gridMode === "radio") {
      if (typeof rawRowValue !== "string") {
        continue;
      }

      const matchedOption = findMatchingOption(field, rawRowValue);
      if (matchedOption) {
        normalizedRows[rowKey] = matchedOption;
      }
      continue;
    }

    if (Array.isArray(rawRowValue)) {
      const matchedOptions = rawRowValue
        .map(String)
        .map((item) => findMatchingOption(field, item))
        .filter((item): item is string => Boolean(item));
      if (matchedOptions.length > 0) {
        normalizedRows[rowKey] = Array.from(new Set(matchedOptions));
      }
    }
  }

  return Object.keys(normalizedRows).length > 0 ? { kind: "grid", rows: normalizedRows } : undefined;
}

export function normalizeFieldValueForField(
  field: DetectedField,
  value: FieldValue | ProfileValue | undefined,
): FieldValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return undefined;
  }

  switch (field.type) {
    case "checkbox":
      if (isChoiceWithOtherValue(value)) {
        return Array.isArray(value.selected)
          ? normalizeCheckboxValues(field, value.selected.map(String), value.otherText)
          : undefined;
      }

      if (typeof value === "string") {
        return normalizeCheckboxValues(field, [value]);
      }

      if (Array.isArray(value)) {
        return normalizeCheckboxValues(field, value.map(String));
      }

      return undefined;
    case "grid":
      return normalizeGridValue(field, value);
    case "date":
      return typeof value === "string" && isValidDateValue(value) ? value : undefined;
    case "time":
      return typeof value === "string" && isValidTimeValue(value) ? value : undefined;
    case "radio":
    case "scale":
    case "dropdown": {
      if (isChoiceWithOtherValue(value)) {
        if (field.type === "dropdown" || typeof value.selected !== "string") {
          return undefined;
        }

        if (field.otherOption && optionEquals(value.selected, field.otherOption)) {
          if (!value.otherText.trim()) {
            return undefined;
          }

          return {
            kind: "choice_with_other",
            selected: field.otherOption,
            otherText: value.otherText.trim(),
          };
        }

        const matchedOption = findMatchingOption(field, String(value.selected));
        return matchedOption;
      }

      if (typeof value !== "string" && typeof value !== "number") {
        return undefined;
      }

      const normalizedValue = String(value).trim();
      if (!normalizedValue) {
        return undefined;
      }

      const matchedOption = findMatchingOption(field, normalizedValue);
      if (matchedOption) {
        if ((field.type === "radio" || field.type === "scale") && field.otherOption && optionEquals(matchedOption, field.otherOption)) {
          return undefined;
        }

        return matchedOption;
      }

      if (field.type === "dropdown" && getSelectableOptions(field).length === 0 && !looksLikePlaceholderOption(normalizedValue)) {
        return normalizedValue;
      }

      if ((field.type === "radio" || field.type === "scale") && field.otherOption) {
        return {
          kind: "choice_with_other",
          selected: field.otherOption,
          otherText: normalizedValue,
        };
      }

      return undefined;
    }
    case "text":
    case "textarea":
      if (typeof value === "string" || typeof value === "number") {
        const normalizedValue = String(value);
        return normalizedValue.trim() ? normalizedValue : undefined;
      }
      return undefined;
    default:
      return undefined;
  }
}
