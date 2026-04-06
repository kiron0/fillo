import { buildInitialFieldValues, rankProfilesForFields, suggestProfileKey } from "../src/core/matching";
import type { DetectedField, FormHistoryEntry, Profile } from "../src/core/types";

const profile: Profile = {
  id: "profile-1",
  name: "Academic",
  values: {
    fullName: "Toufiq Hasan",
    email: "toufiq@example.com",
    studentId: "IUS-2024-001",
  },
  createdAt: 1,
  updatedAt: 1,
};

const fields: DetectedField[] = [
  {
    id: "name",
    label: "Full Name",
    normalizedLabel: "full name",
    type: "text",
    required: true,
  },
  {
    id: "student",
    label: "Student ID",
    normalizedLabel: "student id",
    type: "text",
    required: true,
  },
  {
    id: "birthday",
    label: "Birthday",
    normalizedLabel: "birthday",
    type: "date",
    required: false,
  },
];

describe("matching", () => {
  it("suggests profile keys from normalized labels", () => {
    expect(suggestProfileKey(fields[0], profile)).toBe("fullName");
    expect(suggestProfileKey(fields[1], profile)).toBe("studentId");
  });

  it("uses preset values first and falls back to mapped profile values", () => {
    const result = buildInitialFieldValues(
      fields,
      { name: "Manual Name" },
      { student: "studentId" },
      profile,
    );

    expect(result.values).toEqual({
      name: "Manual Name",
      student: "IUS-2024-001",
    });
    expect(result.mappings.student).toBe("studentId");
  });

  it("does not keep preset mappings when no profile is selected", () => {
    const result = buildInitialFieldValues(
      fields,
      { name: "Manual Name" },
      { student: "studentId" },
      null,
    );

    expect(result.values).toEqual({
      name: "Manual Name",
    });
    expect(result.mappings).toEqual({});
  });

  it("drops stale preset mappings when the selected profile no longer has that key", () => {
    const result = buildInitialFieldValues(
      fields,
      {},
      { student: "missingKey" },
      profile,
    );

    expect(result.values).toMatchObject({
      student: "IUS-2024-001",
    });
    expect(result.mappings).toMatchObject({
      student: "studentId",
    });
    expect(result.mappings.student).not.toBe("missingKey");
  });

  it("drops preset mappings whose current profile value is incompatible with the field type", () => {
    const incompatibleProfile: Profile = {
      ...profile,
      values: {
        ...profile.values,
        birthday: "not-a-date",
      },
    };

    const result = buildInitialFieldValues(
      fields,
      {},
      { birthday: "birthday" },
      incompatibleProfile,
    );

    expect(result.values.birthday).toBeUndefined();
    expect(result.mappings.birthday).toBeUndefined();
  });

  it("prefers the most recent matching history entry when ranking profiles", () => {
    const profiles: Profile[] = [
      profile,
      {
        id: "profile-2",
        name: "Fallback",
        values: {
          fullName: "Another Person",
          studentId: "IUS-2024-999",
        },
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    const history: FormHistoryEntry[] = [
      {
        id: "history-1",
        formKey: "registration-form",
        formTitle: "Registration",
        lastUsedProfileId: "profile-1",
        lastUsedProfileName: "Academic",
        lastFilledAt: 100,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
      {
        id: "history-2",
        formKey: "registration-form",
        formTitle: "Registration",
        lastUsedProfileId: "profile-2",
        lastUsedProfileName: "Fallback",
        lastFilledAt: 200,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
      {
        id: "history-3",
        formKey: "registration-form",
        formTitle: "Registration",
        lastUsedProfileId: "profile-1",
        lastUsedProfileName: "Academic",
        lastFilledAt: 300,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
    ];

    const ranked = rankProfilesForFields(fields, profiles, history, "registration-form");

    expect(ranked.map((entry) => entry.profile.id)).toEqual(["profile-1", "profile-2"]);
  });

  it("prefers the later matching history entry when timestamps are equal", () => {
    const profiles: Profile[] = [
      profile,
      {
        id: "profile-2",
        name: "Fallback",
        values: {
          fullName: "Another Person",
          studentId: "IUS-2024-999",
        },
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    const history: FormHistoryEntry[] = [
      {
        id: "history-1",
        formKey: "registration-form",
        formTitle: "Registration",
        lastUsedProfileId: "profile-1",
        lastUsedProfileName: "Academic",
        lastFilledAt: 300,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
      {
        id: "history-2",
        formKey: "registration-form",
        formTitle: "Registration",
        lastUsedProfileId: "profile-2",
        lastUsedProfileName: "Fallback",
        lastFilledAt: 300,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
    ];

    const ranked = rankProfilesForFields(fields, profiles, history, "registration-form");

    expect(ranked.map((entry) => entry.profile.id)).toEqual(["profile-2", "profile-1"]);
  });

  it("does not rank a profile by field-name match when its current value is incompatible with the field type", () => {
    const dateField: DetectedField = {
      id: "birthday",
      label: "Birthday",
      normalizedLabel: "birthday",
      type: "date",
      required: false,
    };

    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Invalid",
        values: {
          birthday: "not-a-date",
        },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "profile-2",
        name: "Valid",
        values: {
          birthday: "2026-04-07",
        },
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    const ranked = rankProfilesForFields([dateField], profiles, [], "registration-form");

    expect(ranked.map((entry) => entry.profile.id)).toEqual(["profile-2"]);
  });

  it("does not suggest a recent profile when it has no usable matches for the current fields", () => {
    const dateField: DetectedField = {
      id: "birthday",
      label: "Birthday",
      normalizedLabel: "birthday",
      type: "date",
      required: false,
    };

    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Recent But Invalid",
        values: {
          birthday: "not-a-date",
        },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "profile-2",
        name: "Valid",
        values: {
          birthday: "2026-04-07",
        },
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    const history: FormHistoryEntry[] = [
      {
        id: "history-1",
        formKey: "registration-form",
        formTitle: "Registration",
        lastUsedProfileId: "profile-1",
        lastUsedProfileName: "Recent But Invalid",
        lastFilledAt: 300,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
    ];

    const ranked = rankProfilesForFields([dateField], profiles, history, "registration-form");

    expect(ranked.map((entry) => entry.profile.id)).toEqual(["profile-2"]);
  });
});
