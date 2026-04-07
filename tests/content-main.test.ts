import type { ContentRequest } from "../src/core/types";

type ContentListener = (
  message: ContentRequest,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

async function loadContentMainWithChrome(): Promise<ContentListener> {
  vi.resetModules();
  const addListener = vi.fn();
  vi.stubGlobal("chrome", {
    runtime: {
      getManifest() {
        return { version: "1.2.3" };
      },
      onMessage: {
        addListener,
      },
    },
  });

  await import("../src/features/content/main");
  const listener = addListener.mock.calls[0]?.[0] as ContentListener | undefined;
  if (!listener) {
    throw new Error("Content listener was not registered");
  }

  return listener;
}

describe("content main", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("responds to ping messages", async () => {
    const listener = await loadContentMainWithChrome();
    const sendResponse = vi.fn();

    expect(listener({ type: "PING" }, {}, sendResponse)).toBe(false);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: {
        ready: true,
        version: "1.2.3",
      },
    });
  });

  it("rejects malformed messages without throwing", async () => {
    const listener = await loadContentMainWithChrome();
    const sendResponse = vi.fn();

    expect(listener(null as unknown as ContentRequest, {}, sendResponse)).toBe(false);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "Malformed content-script message",
    });
  });

  it("rejects fill messages with malformed payloads before filling", async () => {
    const listener = await loadContentMainWithChrome();
    const sendResponse = vi.fn();

    expect(listener({ type: "FILL_FORM" } as unknown as ContentRequest, {}, sendResponse)).toBe(false);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "Malformed content-script message",
    });
  });

  it("rejects fill messages with inherited envelope properties before filling", async () => {
    const listener = await loadContentMainWithChrome();
    const sendResponse = vi.fn();
    const inheritedMessage = Object.create({
      type: "FILL_FORM",
      payload: {
        formKey: "form-1",
        values: {},
      },
    });

    expect(listener(inheritedMessage as ContentRequest, {}, sendResponse)).toBe(false);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "Malformed content-script message",
    });
  });

  it("rejects fill messages with inherited payload properties before filling", async () => {
    const listener = await loadContentMainWithChrome();
    const sendResponse = vi.fn();

    expect(
      listener(
        {
          type: "FILL_FORM",
          payload: Object.create({
            formKey: "form-1",
            values: {},
          }),
        } as ContentRequest,
        {},
        sendResponse,
      ),
    ).toBe(false);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "Malformed content-script message",
    });
  });

  it("rejects fill messages with malformed values before filling", async () => {
    const listener = await loadContentMainWithChrome();
    const sendResponse = vi.fn();

    expect(
      listener(
        {
          type: "FILL_FORM",
          payload: {
            formKey: "form-1",
            values: {
              "field-1": { nested: true },
            },
          },
        } as unknown as ContentRequest,
        {},
        sendResponse,
      ),
    ).toBe(false);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "Malformed content-script message",
    });
  });

  it("rejects fill messages with inherited value payload fields before filling", async () => {
    const listener = await loadContentMainWithChrome();
    const sendResponse = vi.fn();
    const inheritedChoice = Object.create({
      kind: "choice_with_other",
      selected: "Other",
      otherText: "Biology",
    });

    expect(
      listener(
        {
          type: "FILL_FORM",
          payload: {
            formKey: "form-1",
            values: {
              "field-1": inheritedChoice,
            },
          },
        } as unknown as ContentRequest,
        {},
        sendResponse,
      ),
    ).toBe(false);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "Malformed content-script message",
    });
  });
});
