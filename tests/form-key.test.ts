import { createFallbackFormKey, createFormKey, extractGoogleFormId } from "../src/core/form-key";

describe("form-key", () => {
  it("extracts the google form id from a canonical viewform url", () => {
    expect(extractGoogleFormId("https://docs.google.com/forms/d/e/1FAIpQLSd123abcXYZ/viewform")).toBe(
      "1FAIpQLSd123abcXYZ",
    );
  });

  it("extracts the google form id from account-prefixed and legacy live form urls", () => {
    expect(extractGoogleFormId("https://docs.google.com/forms/u/0/d/e/1FAIpQLSd123abcXYZ/viewform")).toBe(
      "1FAIpQLSd123abcXYZ",
    );
    expect(extractGoogleFormId("https://docs.google.com/forms/d/1QzYIJlSM_NdFmBKnH50hmAA66KA4pBjyvTCShgzsF-c/viewform")).toBe(
      "1QzYIJlSM_NdFmBKnH50hmAA66KA4pBjyvTCShgzsF-c",
    );
  });

  it("uses the same google form id for viewform and formResponse urls", () => {
    const viewKey = createFormKey("https://docs.google.com/forms/u/0/d/e/1FAIpQLSd123abcXYZ/viewform", "Registration", ["Name"]);
    const responseKey = createFormKey(
      "https://docs.google.com/forms/u/0/d/e/1FAIpQLSd123abcXYZ/formResponse",
      "Registration",
      ["Name"],
    );

    expect(viewKey).toBe("1FAIpQLSd123abcXYZ");
    expect(responseKey).toBe(viewKey);
  });

  it("does not extract google form ids from editor urls", () => {
    expect(extractGoogleFormId("https://docs.google.com/forms/d/e/1FAIpQLSd123abcXYZ/edit")).toBeNull();
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
