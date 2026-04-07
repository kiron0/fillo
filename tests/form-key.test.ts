import { createFallbackFormKey, createFormKey, extractGoogleFormId } from "../src/core/form-key";

describe("form-key", () => {
  it("extracts the google form id from a canonical viewform url", () => {
    expect(extractGoogleFormId("https://docs.google.com/forms/d/e/1FAIpQLSd123abcXYZ/viewform")).toBe(
      "1FAIpQLSd123abcXYZ",
    );
  });

  it("does not extract google form ids from non-google hosts", () => {
    expect(extractGoogleFormId("https://example.com/forms/d/e/1FAIpQLSd123abcXYZ/viewform")).toBeNull();
  });

  it("does not extract google form ids from malformed urls", () => {
    expect(extractGoogleFormId("/forms/d/e/1FAIpQLSd123abcXYZ/viewform")).toBeNull();
  });

  it("creates a deterministic fallback key when no form id exists", () => {
    const first = createFallbackFormKey("https://example.com/form", "Registration", ["Full Name", "Email"]);
    const second = createFallbackFormKey("https://example.com/form", "Registration", ["Full Name", "Email"]);
    expect(first).toBe(second);
    expect(first.startsWith("fallback_")).toBe(true);
  });

  it("prefers the extracted google form id as the form key", () => {
    expect(
      createFormKey("https://docs.google.com/forms/d/e/1FAIpQLSd123abcXYZ/viewform", "Registration", ["Name"]),
    ).toBe("1FAIpQLSd123abcXYZ");
  });
});
