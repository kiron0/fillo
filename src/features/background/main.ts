import { scriptingExecuteScript, tabsQuery, tabsSendMessage } from "../../core/chrome-api";
import type { ActiveFormLookup, BackgroundRequest, ContentRequest, FillResult, MessageResponse, ScanResult } from "../../core/types";

const SCAN_RETRY_ATTEMPTS = 8;
const SCAN_RETRY_DELAY_MS = 300;

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function sendToTab<T>(tabId: number, message: ContentRequest): Promise<T> {
  const response = (await tabsSendMessage<MessageResponse<T>>(tabId, message)) as MessageResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error ?? "Content script did not respond");
  }

  return response.data as T;
}

function isGoogleFormUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname === "docs.google.com" && parsed.pathname.startsWith("/forms/");
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await sendToTab(tabId, { type: "PING" });
    return;
  } catch {
    await scriptingExecuteScript({
      target: { tabId },
      files: ["content/index.js"],
    });
  }
}

async function scanActiveFormWithRetry(tabId: number): Promise<ScanResult> {
  await ensureContentScript(tabId);

  let lastScan: ScanResult | null = null;

  for (let attempt = 0; attempt < SCAN_RETRY_ATTEMPTS; attempt += 1) {
    const scan = await sendToTab<ScanResult>(tabId, { type: "SCAN_FORM" });
    lastScan = scan;

    if (scan.fields.length > 0) {
      return scan;
    }

    await sleep(SCAN_RETRY_DELAY_MS);
  }

  if (lastScan) {
    throw new Error("No supported fields were detected on this Google Form.");
  }

  throw new Error("Unable to scan the active Google Form.");
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "GET_ACTIVE_FORM_CONTEXT": {
          const tab = await getActiveTab();
          if (!tab?.id) {
            sendResponse({
              ok: true,
              data: {
                status: "no_active_tab",
              } satisfies ActiveFormLookup,
            } satisfies MessageResponse<ActiveFormLookup>);
            return;
          }

          if (tab.url?.startsWith("https://forms.gle/")) {
            sendResponse({
              ok: true,
              data: {
                status: "invalid_url",
                pageUrl: tab.url,
              } satisfies ActiveFormLookup,
            } satisfies MessageResponse<ActiveFormLookup>);
            return;
          }

          if (!isGoogleFormUrl(tab.url)) {
            sendResponse({
              ok: true,
              data: {
                status: "invalid_url",
                pageUrl: tab.url,
              } satisfies ActiveFormLookup,
            } satisfies MessageResponse<ActiveFormLookup>);
            return;
          }

          const scan = await scanActiveFormWithRetry(tab.id);
          sendResponse({
            ok: true,
            data: {
              status: "ready",
              pageUrl: tab.url,
              context: scan,
            } satisfies ActiveFormLookup,
          } satisfies MessageResponse<ActiveFormLookup>);
          return;
        }
        case "FILL_ACTIVE_FORM": {
          const tab = await getActiveTab();
          if (!tab?.id || !isGoogleFormUrl(tab.url)) {
            throw new Error("Open a live Google Form before filling fields.");
          }

          const scan = await scanActiveFormWithRetry(tab.id);
          const result = await sendToTab<FillResult>(tab.id, {
            type: "FILL_FORM",
            payload: {
              ...message.payload,
              fields: message.payload.fields ?? scan.fields,
            },
          });
          sendResponse({
            ok: true,
            data: result,
          } satisfies MessageResponse<FillResult>);
          return;
        }
        default:
          throw new Error("Unsupported background message");
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown background error",
      } satisfies MessageResponse<never>);
    }
  })();

  return true;
});
