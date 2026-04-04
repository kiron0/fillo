import { buildInitialFieldValues, suggestProfileKey } from "../src/core/matching";
import type { DetectedField, Profile } from "../src/core/types";

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
});
