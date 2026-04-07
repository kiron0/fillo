import { runtimeManifestVersion, scriptingExecuteScript, tabsQuery, tabsSendMessage } from "../../core/chrome-api";
import {
  clearAllDataDirect,
  clearHistoryDirect,
  deletePresetDirect,
  deleteProfileDirect,
  importAppDataDirect,
  saveHistoryEntryDirect,
  savePresetDirect,
  saveProfileDirect,
  saveSettingsDirect,
} from "../../core/storage-ops";
import type { ActiveFormLookup, BackgroundRequest, ContentRequest, FillResult, MessageResponse, ScanResult } from "../../core/types";

const SCAN_RETRY_ATTEMPTS = 20;
const SCAN_RETRY_DELAY_MS = 400;
let storageMutationQueue: Promise<void> = Promise.resolve();

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function sendToTab<T>(tabId: number, message: ContentRequest): Promise<T> {
  const response = (await tabsSendMessage<MessageResponse<T>>(tabId, message)) as MessageResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error ?? "Content script did not respond");
  }

  if (response.data === undefined) {
    throw new Error("Content script response was missing data");
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

function isGoogleFormEditUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname === "docs.google.com" && parsed.pathname.startsWith("/forms/") && parsed.pathname.endsWith("/edit");
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCurrentContentScriptPing(
  ping: { ready?: boolean; version?: string | null } | null | undefined,
  expectedVersion: string | null,
): boolean {
  return Boolean(ping?.ready && (!expectedVersion || ping.version === expectedVersion));
}

async function ensureContentScript(tabId: number): Promise<void> {
  const expectedVersion = runtimeManifestVersion();

  try {
    const ping = await sendToTab<{ ready: boolean; version?: string | null }>(tabId, { type: "PING" });
    if (isCurrentContentScriptPing(ping, expectedVersion)) {
      return;
    }

    throw new Error("Reload the Google Form tab to use the latest extension code, then open Fillo again.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("latest extension code")) {
      throw error;
    }

    try {
      await scriptingExecuteScript({
        target: { tabId },
        files: ["content/index.js"],
      });
      const injectedPing = await sendToTab<{ ready: boolean; version?: string | null }>(tabId, { type: "PING" });
      if (!isCurrentContentScriptPing(injectedPing, expectedVersion)) {
        throw new Error("Content script version mismatch");
      }
      return;
    } catch {
      throw new Error("Reload the Google Form tab to use the latest extension code, then open Fillo again.");
    }
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
    return lastScan;
  }

  throw new Error("Unable to scan the active Google Form.");
}

function hasSupportedFillableField(scan: ScanResult): boolean {
  return scan.fields.length > 0;
}

function enqueueStorageMutation<T>(action: () => Promise<T>): Promise<T> {
  const run = storageMutationQueue.then(() => action());
  storageMutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "GET_ACTIVE_FORM_CONTEXT": {
          const tab = await getActiveTab();
          if (typeof tab?.id !== "number") {
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

          if (isGoogleFormEditUrl(tab.url)) {
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
              status: hasSupportedFillableField(scan) ? "ready" : "unsupported_only",
              pageUrl: tab.url,
              context: scan,
            } satisfies ActiveFormLookup,
          } satisfies MessageResponse<ActiveFormLookup>);
          return;
        }
        case "FILL_ACTIVE_FORM": {
          const tab = await getActiveTab();
          if (typeof tab?.id !== "number" || !isGoogleFormUrl(tab.url) || isGoogleFormEditUrl(tab.url)) {
            throw new Error("Open a live Google Form before filling fields.");
          }

          const scan = await scanActiveFormWithRetry(tab.id);
          if (scan.formKey !== message.payload.formKey) {
            throw new Error("The active tab changed to a different Google Form. Reopen the popup on the current form and try again.");
          }
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
        case "RUN_STORAGE_MUTATION": {
          await enqueueStorageMutation(async () => {
            switch (message.payload.kind) {
              case "save_profile":
                await saveProfileDirect(message.payload.profile);
                return;
              case "delete_profile":
                await deleteProfileDirect(message.payload.profileId);
                return;
              case "save_preset":
                await savePresetDirect(message.payload.preset);
                return;
              case "delete_preset":
                await deletePresetDirect(message.payload.presetId);
                return;
              case "save_history_entry":
                await saveHistoryEntryDirect(message.payload.entry);
                return;
              case "clear_history":
                await clearHistoryDirect();
                return;
              case "save_settings":
                await saveSettingsDirect(message.payload.settings);
                return;
              case "clear_all_data":
                await clearAllDataDirect();
                return;
              case "import_app_data":
                await importAppDataDirect(message.payload.data);
                return;
              default:
                throw new Error("Unsupported storage mutation");
            }
          });
          sendResponse({
            ok: true,
            data: null,
          } satisfies MessageResponse<null>);
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
