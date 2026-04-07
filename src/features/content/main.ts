import { runtimeManifestVersion } from "../../core/chrome-api";
import { isFieldValue } from "../../core/storage-ops";
import { fillFormDocumentAsync, scanFormDocument } from "./form-dom";
import type { ContentRequest, FillRequest, MessageResponse } from "../../core/types";

function respond<T>(data: T): MessageResponse<T> {
  return { ok: true, data };
}

function respondError(error: unknown): MessageResponse<never> {
  return { ok: false, error: error instanceof Error ? error.message : "Unknown content-script error" };
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function hasOnlyOwnEnumerableProperties(value: Record<string, unknown>): boolean {
  for (const key in value) {
    if (!hasOwnKey(value, key)) {
      return false;
    }
  }

  return true;
}

function hasOwnString(value: Record<string, unknown>, key: string): boolean {
  return hasOwnKey(value, key) && typeof value[key] === "string";
}

function isFillRequest(value: unknown): value is FillRequest {
  return (
    isStringRecord(value) &&
    hasOwnString(value, "formKey") &&
    hasOwnKey(value, "values") &&
    isStringRecord(value.values) &&
    hasOnlyOwnEnumerableProperties(value.values) &&
    Object.values(value.values).every(isFieldValue)
  );
}

function isContentRequest(value: unknown): value is ContentRequest {
  if (!isStringRecord(value) || !hasOwnString(value, "type")) {
    return false;
  }

  if (value.type === "PING" || value.type === "SCAN_FORM") {
    return true;
  }

  return value.type === "FILL_FORM" && hasOwnKey(value, "payload") && isFillRequest(value.payload);
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (!isContentRequest(message)) {
    sendResponse(respondError(new Error("Malformed content-script message")));
    return false;
  }

  switch (message.type) {
    case "PING":
      sendResponse(respond({ ready: true, version: runtimeManifestVersion() }));
      return false;
    case "SCAN_FORM":
      try {
        sendResponse(respond(scanFormDocument(document)));
      } catch (error) {
        sendResponse(respondError(error));
      }
      return false;
    case "FILL_FORM":
      void fillFormDocumentAsync(document, message.payload)
        .then((result) => sendResponse(respond(result)))
        .catch((error) => sendResponse(respondError(error)));
      return true;
    default:
      sendResponse(respondError(new Error("Unsupported content-script message")));
      return false;
  }
});
