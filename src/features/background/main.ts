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
  isFieldValue,
  validateImportedAppData,
} from "../../core/storage-ops";
import type { ActiveFormLookup, BackgroundRequest, ContentRequest, DetectedField, FillRequest, FillResult, MessageResponse, ScanResult } from "../../core/types";

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

function parseUrl(url: string | undefined): URL | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isLiveGoogleFormUrl(url: string | undefined): boolean {
  const parsed = parseUrl(url);
  if (!parsed || parsed.hostname !== "docs.google.com") {
    return false;
  }

  return /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[a-zA-Z0-9_-]+\/(?:viewform|formResponse)\/?$/.test(parsed.pathname);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function hasOwnString(value: Record<string, unknown>, key: string): boolean {
  return hasOwnKey(value, key) && typeof value[key] === "string";
}

function hasOwnBoolean(value: Record<string, unknown>, key: string): boolean {
  return hasOwnKey(value, key) && typeof value[key] === "boolean";
}

function hasOwnOptionalString(value: Record<string, unknown>, key: string): boolean {
  return !(key in value) || (hasOwnKey(value, key) && (value[key] === undefined || typeof value[key] === "string"));
}

function hasOwnOptionalStringArray(value: Record<string, unknown>, key: string): boolean {
  const fieldValue = value[key];
  return (
    !(key in value) ||
    (hasOwnKey(value, key) &&
      (fieldValue === undefined || (Array.isArray(fieldValue) && fieldValue.every((item) => typeof item === "string"))))
  );
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

function isDetectedField(value: unknown): value is DetectedField {
  if (!isStringRecord(value)) {
    return false;
  }

  const field = value;
  const allowedTypes = new Set(["text", "textarea", "radio", "checkbox", "dropdown", "scale", "date", "time", "grid"]);
  const gridRows = field.gridRows;
  const gridRowIds = field.gridRowIds;
  const gridMetadataValid =
    field.type === "grid"
      ? hasOwnKey(field, "gridRows") &&
        Array.isArray(gridRows) &&
        gridRows.every((row) => typeof row === "string") &&
        (!("gridRowIds" in field) ||
          (hasOwnKey(field, "gridRowIds") &&
            (gridRowIds === undefined ||
              (Array.isArray(gridRowIds) &&
                gridRowIds.length === gridRows.length &&
                gridRowIds.every((rowId) => typeof rowId === "string"))))) &&
        hasOwnKey(field, "gridMode") &&
        (field.gridMode === "radio" || field.gridMode === "checkbox")
      : !("gridRows" in field) && !("gridRowIds" in field) && !("gridMode" in field);
  const scaleMetadataValid =
    field.type === "scale"
      ? hasOwnOptionalString(field, "scaleLowLabel") && hasOwnOptionalString(field, "scaleHighLabel")
      : !("scaleLowLabel" in field) && !("scaleHighLabel" in field);

  return (
    hasOwnString(field, "id") &&
    hasOwnString(field, "label") &&
    hasOwnString(field, "normalizedLabel") &&
    hasOwnString(field, "type") &&
    allowedTypes.has(field.type as string) &&
    hasOwnBoolean(field, "required") &&
    (!("textSubtype" in field) ||
      (hasOwnKey(field, "textSubtype") &&
        (field.textSubtype === undefined ||
          field.textSubtype === "text" ||
          field.textSubtype === "email" ||
          field.textSubtype === "number" ||
          field.textSubtype === "tel" ||
          field.textSubtype === "url"))) &&
    hasOwnOptionalStringArray(field, "options") &&
    hasOwnOptionalString(field, "otherOption") &&
    gridMetadataValid &&
    scaleMetadataValid &&
    hasOwnOptionalString(field, "sectionKey") &&
    hasOwnOptionalString(field, "sectionTitle") &&
    hasOwnOptionalString(field, "helpText")
  );
}

function isScanResult(value: unknown): value is ScanResult {
  if (!isStringRecord(value)) {
    return false;
  }

  return (
    hasOwnString(value, "title") &&
    hasOwnString(value, "url") &&
    hasOwnString(value, "formKey") &&
    hasOwnKey(value, "fields") &&
    Array.isArray(value.fields) &&
    value.fields.every(isDetectedField)
  );
}

function isFillResult(value: unknown): value is FillResult {
  if (!isStringRecord(value)) {
    return false;
  }

  return (
    hasOwnKey(value, "filledFieldIds") &&
    Array.isArray(value.filledFieldIds) &&
    value.filledFieldIds.every((fieldId) => typeof fieldId === "string") &&
    hasOwnKey(value, "skippedFieldIds") &&
    Array.isArray(value.skippedFieldIds) &&
    value.skippedFieldIds.every((fieldId) => typeof fieldId === "string")
  );
}

function isFillRequest(value: unknown): value is FillRequest {
  if (
    !isStringRecord(value) ||
    !hasOwnString(value, "formKey") ||
    !hasOwnKey(value, "values") ||
    !isStringRecord(value.values) ||
    !Object.values(value.values).every(isFieldValue)
  ) {
    return false;
  }

  return !("fields" in value) || (hasOwnKey(value, "fields") && Array.isArray(value.fields) && value.fields.every(isDetectedField));
}

function isStorageMutationPayload(value: unknown): value is Extract<BackgroundRequest, { type: "RUN_STORAGE_MUTATION" }>["payload"] {
  if (!isStringRecord(value) || !hasOwnString(value, "kind")) {
    return false;
  }

  switch (value.kind) {
    case "save_profile":
      return hasOwnKey(value, "profile") && validateImportedAppData({ version: 1, profiles: [value.profile] });
    case "delete_profile":
      return hasOwnString(value, "profileId");
    case "save_preset":
      return hasOwnKey(value, "preset") && validateImportedAppData({ version: 1, presets: [value.preset] });
    case "delete_preset":
      return hasOwnString(value, "presetId");
    case "save_history_entry":
      return hasOwnKey(value, "entry") && validateImportedAppData({ version: 1, history: [value.entry] });
    case "clear_history":
      return true;
    case "save_settings":
      return hasOwnKey(value, "settings") && validateImportedAppData({ version: 1, settings: value.settings });
    case "clear_all_data":
      return true;
    case "import_app_data":
      return hasOwnKey(value, "data") && validateImportedAppData(value.data);
    default:
      return false;
  }
}

function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (!isStringRecord(value) || !hasOwnString(value, "type")) {
    return false;
  }

  if (value.type === "GET_ACTIVE_FORM_CONTEXT") {
    return true;
  }

  if (value.type === "FILL_ACTIVE_FORM") {
    return hasOwnKey(value, "payload") && isFillRequest(value.payload);
  }

  return value.type === "RUN_STORAGE_MUTATION" && hasOwnKey(value, "payload") && isStorageMutationPayload(value.payload);
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
    if (!isScanResult(scan)) {
      throw new Error("Content script scan response was malformed");
    }

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
      if (!isBackgroundRequest(message)) {
        throw new Error("Malformed background message");
      }

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

          if (!isLiveGoogleFormUrl(tab.url)) {
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
          if (typeof tab?.id !== "number" || !isLiveGoogleFormUrl(tab.url)) {
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
          if (!isFillResult(result)) {
            throw new Error("Content script fill response was malformed");
          }

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
