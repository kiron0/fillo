import { createFormKey } from "../../core/form-key";
import { normalizeText, optionEquals } from "../../core/normalization";
import type { ChoiceWithOtherValue, DetectedField, FieldType, FieldValue, FillRequest, FillResult, GridValue, ScanResult } from "../../core/types";

type FieldDescriptor = {
  field: DetectedField;
  container: HTMLElement;
  control: HTMLElement;
  type: FieldType;
};

type FieldIdentity = {
  normalizedLabel: string;
  type: FieldType;
  sectionTitle?: string;
  helpText?: string;
};

type FormTitleDebug = {
  titleSource: string;
  documentTitle?: string;
  metaTitle?: string;
  structuredTitle?: string;
};

const POPUP_OPTION_RETRY_ATTEMPTS = 8;
const POPUP_OPTION_RETRY_DELAY_MS = 50;
const POPUP_FILL_ATTEMPTS = 2;
const POPUP_KEYBOARD_STEP_DELAY_MS = 30;

function isVisible(element: Element): boolean {
  const node = element as HTMLElement;
  if (node.hidden) {
    return false;
  }

  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

function textContent(element: Element | null): string {
  return normalizeText(element?.textContent ?? "");
}

function rawTextContent(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function getChoiceLabel(node: HTMLElement): string {
  const direct = rawTextContent(node);
  if (direct) {
    return direct;
  }

  const ariaLabel = node.getAttribute("aria-label")?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => rawTextContent(document.getElementById(id)))
      .filter(Boolean);
    if (parts.length) {
      return parts.join(" ");
    }
  }

  const selectors = [
    '[data-value]',
    '.aDTYNe',
    '.YEVVod',
    '.docssharedWizToggleLabeledLabelText',
    '.nWQGrd',
    'span',
    'label',
  ];

  for (const selector of selectors) {
    const candidate = rawTextContent(node.querySelector(selector));
    if (candidate) {
      return candidate;
    }
  }

  const role = node.getAttribute("role");
  let current = node.parentElement;
  while (current) {
    if (role) {
      const matchingChoices = Array.from(current.querySelectorAll<HTMLElement>(`[role="${role}"]`)).filter(isVisible);
      if (matchingChoices.length === 1 && matchingChoices[0] === node) {
        const candidate = rawTextContent(current);
        if (candidate) {
          return candidate;
        }
      }
    }

    current = current.parentElement;
  }

  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getQuestionContainers(root: Document): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[role="listitem"], .Qr7Oae')).filter((element) => isVisible(element));
  const seen = new Set(candidates);

  for (const checkbox of Array.from(root.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(isVisible)) {
    if (candidates.some((container) => container.contains(checkbox))) {
      continue;
    }

    const container = findVerifiedEmailContainer(checkbox);
    if (container && !seen.has(container)) {
      candidates.push(container);
      seen.add(container);
    }
  }

  return candidates.sort(compareDocumentOrder);
}

function looksLikeVerifiedEmailConsentContainer(container: HTMLElement): boolean {
  const text = rawTextContent(container);
  const checkboxCount = Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(isVisible).length;

  return (
    checkboxCount === 1 &&
    !container.querySelector('[role="radio"]') &&
    /^email\b/i.test(text) &&
    /record\b/i.test(text) &&
    /included with my response/i.test(text)
  );
}

function compareDocumentOrder(left: HTMLElement, right: HTMLElement): number {
  if (left === right) {
    return 0;
  }

  const position = left.compareDocumentPosition(right);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
    return -1;
  }

  if (position & Node.DOCUMENT_POSITION_PRECEDING) {
    return 1;
  }

  return 0;
}

function findVerifiedEmailContainer(checkbox: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = checkbox;

  while (current) {
    if (looksLikeVerifiedEmailConsentContainer(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function getQuestionLabel(container: HTMLElement): string {
  const selectors = [
    '[data-params] [role="heading"]',
    '[role="heading"]',
    '.M7eMe',
    '.HoXoMd',
    '.zHQkBf',
    '.freebirdFormviewerComponentsQuestionBaseTitle',
  ];

  for (const selector of selectors) {
    const element = container.querySelector(selector);
    const label = rawTextContent(element);
    if (label) {
      return label.replace(/\s+\*$/, "").trim();
    }
  }

  if (isVerifiedEmailConsentContainer(container)) {
    return "Email";
  }

  return "";
}

function getHelpText(container: HTMLElement): string | undefined {
  const selectors = [".gubaDc", ".freebirdFormviewerComponentsQuestionBaseDescription", '[role="note"]'];

  for (const selector of selectors) {
    const element = container.querySelector(selector);
    const value = rawTextContent(element);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function getSectionTitle(container: HTMLElement): string | undefined {
  const candidateRoot = container.closest<HTMLElement>('[role="list"]')?.previousElementSibling;
  if (!candidateRoot || !isVisible(candidateRoot)) {
    return undefined;
  }

  const selectors = [
    '[role="heading"][aria-level="2"]',
    '[role="heading"][aria-level="1"]',
    '.M7eMe',
    '.HoXoMd',
    'h2',
    'h1',
  ];

  for (const selector of selectors) {
    const candidate = candidateRoot.matches(selector)
      ? candidateRoot
      : candidateRoot.querySelector<HTMLElement>(selector);
    const title = rawTextContent(candidate);
    if (!title) {
      continue;
    }

    if (title.length > 120 || looksLikeShellText(title)) {
      continue;
    }

    return title;
  }

  return undefined;
}

function isQuestionContainerNode(element: Element | null): boolean {
  return element instanceof HTMLElement && Boolean(element.closest('[role="listitem"], .Qr7Oae'));
}

function normalizeFormTitleCandidate(value: string): string {
  return value.replace(/\s+-\s+google forms$/i, "").trim();
}

function looksLikeShellText(value: string): boolean {
  const normalized = normalizeText(value);
  return (
    value.includes("<div") ||
    value.includes("&lt;div") ||
    value.includes("</div>") ||
    value.includes("&lt;/div") ||
    normalized.includes("javascript isn't enabled in your browser") ||
    normalized.includes("switch accounts") ||
    normalized.includes("indicates required question") ||
    normalized.includes("enable and reload")
  );
}

function containsEmbeddedFieldLabels(value: string, fieldLabels: string[]): boolean {
  const normalizedValue = normalizeText(value);
  if (normalizedValue.length < 80) {
    return false;
  }

  let matches = 0;
  for (const label of fieldLabels) {
    const normalizedLabel = normalizeText(label);
    if (!normalizedLabel || normalizedLabel.length < 4) {
      continue;
    }

    if (normalizedValue.includes(normalizedLabel)) {
      matches += 1;
      if (matches >= 2) {
        return true;
      }
    }
  }

  return false;
}

function isUsableFormTitle(value: string, fieldLabels: string[] = []): boolean {
  const trimmed = normalizeFormTitleCandidate(value);
  if (!trimmed) {
    return false;
  }

  if (trimmed.length > 180) {
    return false;
  }

  return !looksLikeShellText(trimmed) && !containsEmbeddedFieldLabels(trimmed, fieldLabels);
}

function parsePublicLoadData(root: Document): unknown[] | null {
  const scripts = Array.from(root.querySelectorAll<HTMLScriptElement>("script"));

  for (const script of scripts) {
    const source = script.textContent ?? "";
    if (!source.includes("FB_PUBLIC_LOAD_DATA_")) {
      continue;
    }

    const match = source.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*\]);?\s*$/);
    if (!match) {
      continue;
    }

    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getStructuredFormTitle(root: Document, fieldLabels: string[]): string | null {
  const publicLoadData = parsePublicLoadData(root);
  if (!Array.isArray(publicLoadData)) {
    return null;
  }

  const candidates: string[] = [];
  const metadata = publicLoadData[1];
  if (Array.isArray(metadata)) {
    const directTitle = metadata[8];
    if (typeof directTitle === "string") {
      candidates.push(directTitle);
    }

    const nestedCandidates: string[] = [];
    for (const entry of metadata) {
      if (Array.isArray(entry) && entry.length === 2 && entry[0] === null && typeof entry[1] === "string") {
        nestedCandidates.push(entry[1]);
      }
    }
    candidates.push(...nestedCandidates.reverse());
  }

  for (const candidate of candidates) {
    if (isUsableFormTitle(candidate, fieldLabels)) {
      return normalizeFormTitleCandidate(candidate);
    }
  }

  return null;
}

function getFormTitle(root: Document, fieldLabels: string[]): { title: string; debug: FormTitleDebug } {
  const documentTitle = normalizeFormTitleCandidate(root.title ?? "") || undefined;
  const metaTitle = normalizeFormTitleCandidate(root.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content?.trim() ?? "") || undefined;
  const structuredTitle = getStructuredFormTitle(root, fieldLabels);
  if (structuredTitle) {
    return {
      title: structuredTitle,
      debug: {
        titleSource: "fb_public_load_data",
        documentTitle,
        metaTitle,
        structuredTitle,
      },
    };
  }

  const directTitle = documentTitle ?? "";
  if (isUsableFormTitle(directTitle, fieldLabels)) {
    return {
      title: directTitle,
      debug: {
        titleSource: "document_title",
        documentTitle,
        metaTitle,
      },
    };
  }

  if (isUsableFormTitle(metaTitle ?? "", fieldLabels)) {
    return {
      title: normalizeFormTitleCandidate(metaTitle ?? ""),
      debug: {
        titleSource: "meta_og_title",
        documentTitle,
        metaTitle,
      },
    };
  }

  const selectors = [
    '[role="heading"][aria-level="1"]',
    '.ahS2Le',
    '.freebirdFormviewerViewHeaderTitle',
    'h1',
  ];

  for (const selector of selectors) {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
      (element) => isVisible(element) && !isQuestionContainerNode(element),
    );

    for (const candidate of candidates) {
      const text = rawTextContent(candidate);
      if (isUsableFormTitle(text, fieldLabels)) {
        return {
          title: normalizeFormTitleCandidate(text),
          debug: {
            titleSource: `selector:${selector}`,
            documentTitle,
            metaTitle,
          },
        };
      }
    }
  }

  return {
    title: "Untitled Google Form",
    debug: {
      titleSource: "fallback_untitled",
      documentTitle,
      metaTitle,
    },
  };
}

function sanitizeFieldSections(fields: DetectedField[], title: string): void {
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) {
    return;
  }

  for (const field of fields) {
    if (!field.sectionTitle) {
      continue;
    }

    if (normalizeText(field.sectionTitle) === normalizedTitle) {
      delete field.sectionTitle;
      delete field.sectionKey;
    }
  }
}

function isRequired(container: HTMLElement, label: string): boolean {
  return /\*$/.test(rawTextContent(container.querySelector('[role="heading"], .M7eMe')) ?? "") || label.endsWith("*") || isVerifiedEmailConsentContainer(container);
}

function isVerifiedEmailConsentContainer(container: HTMLElement): boolean {
  return looksLikeVerifiedEmailConsentContainer(container);
}

function getVerifiedEmailOptionLabel(container: HTMLElement): string {
  const fullText = rawTextContent(container);
  const optionText = fullText.replace(/^email\s*:?\s*\*?\s*/i, "").trim();
  return optionText || "Record email with my response";
}

function uniqueFieldId(container: HTMLElement, label: string, index: number): string {
  const explicitId =
    container.querySelector<HTMLElement>("input, textarea, select")?.getAttribute("name") ??
    container.querySelector<HTMLElement>("input, textarea, select")?.id ??
    container.getAttribute("data-item-id");

  return explicitId && explicitId.trim() ? explicitId.trim() : `${normalizeText(label).replace(/\s+/g, "_") || "field"}_${index}`;
}

function extractOptionsFromRoleNodes(nodes: HTMLElement[]): string[] {
  return nodes.map((node) => getChoiceLabel(node)).filter(Boolean);
}

function looksLikePlaceholderLabel(label: string): boolean {
  const normalized = normalizeText(label);
  return normalized === "choose" || normalized === "select" || normalized === "select an option" || normalized === "choose an option";
}

function isSelectableNativeOption(option: HTMLOptionElement, totalOptions: number): boolean {
  if (option.disabled) {
    return false;
  }

  if (option.value.trim().length > 0) {
    return !looksLikePlaceholderLabel(option.textContent?.trim() ?? "");
  }

  return totalOptions === 1;
}

function findVisibleTextControl(container: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  const candidates = Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"], textarea',
    ),
  );

  return candidates.find((candidate) => isVisible(candidate)) ?? null;
}

function getInputMetadata(input: HTMLInputElement): string {
  return [
    input.type,
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label"),
    input.getAttribute("aria-describedby"),
  ]
    .filter(Boolean)
    .join(" ");
}

function getVisibleTimeInputs(container: HTMLElement): { hourInput: HTMLInputElement; minuteInput: HTMLInputElement } | null {
  const candidates = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="number"], input[type="tel"], input[type="time"]'),
  ).filter(isVisible);

  if (!candidates.length) {
    return null;
  }

  const hourInput = candidates.find((input) => {
    if (input.type === "time") {
      return false;
    }

    const metadata = normalizeText(getInputMetadata(input));
    return (
      metadata.includes("hour") ||
      /\bhh\b/.test(metadata) ||
      input.max === "12" ||
      input.max === "23"
    );
  });

  const minuteInput = candidates.find((input) => {
    if (input === hourInput || input.type === "time") {
      return false;
    }

    const metadata = normalizeText(getInputMetadata(input));
    return (
      metadata.includes("minute") ||
      /\bmm\b/.test(metadata) ||
      input.max === "59"
    );
  });

  return hourInput && minuteInput ? { hourInput, minuteInput } : null;
}

function getVisibleDateInputs(
  container: HTMLElement,
): { monthInput: HTMLInputElement; dayInput: HTMLInputElement; yearInput: HTMLInputElement } | null {
  const candidates = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="number"], input[type="tel"], input[type="date"]'),
  ).filter(isVisible);

  if (!candidates.length) {
    return null;
  }

  const monthInput = candidates.find((input) => {
    if (input.type === "date") {
      return false;
    }

    const metadata = normalizeText(getInputMetadata(input));
    return metadata.includes("month") || /\bmm\b/.test(metadata) || input.max === "12";
  });

  const dayInput = candidates.find((input) => {
    if (input === monthInput || input.type === "date") {
      return false;
    }

    const metadata = normalizeText(getInputMetadata(input));
    return metadata.includes("day") || /\bdd\b/.test(metadata) || input.max === "31";
  });

  const yearInput = candidates.find((input) => {
    if (input === monthInput || input === dayInput || input.type === "date") {
      return false;
    }

    const metadata = normalizeText(getInputMetadata(input));
    return metadata.includes("year") || /\byyyy\b/.test(metadata) || input.maxLength === 4 || input.size === 4;
  });

  return monthInput && dayInput && yearInput ? { monthInput, dayInput, yearInput } : null;
}

function findAttachedTextControl(
  node: HTMLElement,
  role: "radio" | "checkbox",
  boundary: HTMLElement,
): HTMLInputElement | HTMLTextAreaElement | null {
  let current = node.parentElement;

  while (current && current !== boundary) {
    const textControl = findVisibleTextControl(current);
    if (textControl) {
      const choices = Array.from(current.querySelectorAll<HTMLElement>(`[role="${role}"]`)).filter(isVisible);
      if (choices.length === 1 && choices[0] === node) {
        return textControl;
      }
    }
    current = current.parentElement;
  }

  return null;
}

function findSingleBoundaryTextControl(boundary: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  const controls = Array.from(
    boundary.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"], textarea',
    ),
  ).filter(isVisible);

  return controls.length === 1 ? controls[0] : null;
}

function hasAttachedTextControl(node: HTMLElement, role: "radio" | "checkbox", boundary: HTMLElement): boolean {
  return Boolean(findAttachedTextControl(node, role, boundary));
}

function findAttachedOtherChoice(container: HTMLElement, role: "radio" | "checkbox"): HTMLElement | null {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(`[role="${role}"]`)).filter(isVisible);
  return nodes.find((node) => hasAttachedTextControl(node, role, container)) ?? null;
}

function detectOtherOptionLabel(
  options: string[],
  container: HTMLElement,
  role: "radio" | "checkbox",
): string | undefined {
  const explicitOther = options.find((option) => normalizeText(option) === "other");
  if (explicitOther) {
    return explicitOther;
  }

  return findAttachedOtherChoice(container, role) ? "Other" : undefined;
}

function buildChoiceOptions(nodes: HTMLElement[], container: HTMLElement, role: "radio" | "checkbox"): {
  options: string[];
  otherOption?: string;
} {
  const options = extractOptionsFromRoleNodes(nodes);
  const otherOption = detectOtherOptionLabel(options, container, role);

  if (otherOption && !options.some((option) => optionEquals(option, otherOption))) {
    options.push(otherOption);
  }

  return { options, otherOption };
}

function isGridValue(value: FieldValue): value is GridValue {
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

function getDirectGrid(root: HTMLElement): HTMLElement | null {
  const grid = root.querySelector<HTMLElement>('[role="grid"], .freebirdFormviewerComponentsQuestionGridRoot');
  return grid && isVisible(grid) ? grid : null;
}

function extractGridRowLabel(row: HTMLElement): string {
  const explicit = row.querySelector<HTMLElement>('[role="rowheader"]');
  const explicitText = rawTextContent(explicit);
  if (explicitText) {
    return explicitText;
  }

  const clone = row.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[role="radio"], [role="checkbox"]').forEach((node) => node.remove());
  return rawTextContent(clone);
}

function parseFlattenedGridChoiceLabel(label: string): { column: string; row: string } | null {
  const match = /^(.*?),\s*response for\s+(.+)$/i.exec(label.trim());
  if (!match) {
    return null;
  }

  const column = match[1]?.trim();
  const row = match[2]?.trim();
  return column && row ? { column, row } : null;
}

function extractFlattenedGridDefinition(
  nodes: HTMLElement[],
  mode: "radio" | "checkbox",
): { rows: { id: string; label: string }[]; columns: string[]; mode: "radio" | "checkbox" } | null {
  const parsedChoices = nodes.map((node) => parseFlattenedGridChoiceLabel(getChoiceLabel(node)));
  if (parsedChoices.length === 0 || parsedChoices.some((choice) => !choice)) {
    return null;
  }

  const rows: { id: string; label: string }[] = [];
  const columns: string[] = [];

  for (const choice of parsedChoices) {
    if (!choice) {
      continue;
    }

    if (!rows.some((row) => optionEquals(row.label, choice.row))) {
      rows.push({ id: `row-${rows.length}`, label: choice.row });
    }

    if (!columns.some((column) => optionEquals(column, choice.column))) {
      columns.push(choice.column);
    }
  }

  return rows.length > 0 && columns.length > 0 ? { rows, columns, mode } : null;
}

function extractGridDefinition(
  grid: HTMLElement,
): { rows: { id: string; label: string }[]; columns: string[]; mode: "radio" | "checkbox" } | null {
  const rowElements = Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]')).filter(isVisible);
  const columnHeaders = Array.from(grid.querySelectorAll<HTMLElement>('[role="columnheader"]'))
    .map((header) => rawTextContent(header))
    .filter(Boolean);

  const dataRows = rowElements
    .map((row, index) => {
      const radios = Array.from(row.querySelectorAll<HTMLElement>('[role="radio"]')).filter(isVisible);
      const checkboxes = Array.from(row.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(isVisible);
      const controls = radios.length > 0 ? radios : checkboxes;
      if (controls.length === 0) {
        return null;
      }

      const label = extractGridRowLabel(row);
      const rowHeader = row.querySelector<HTMLElement>('[role="rowheader"]');
      const id =
        [
          row.getAttribute("data-row-id"),
          row.id,
          rowHeader?.getAttribute("data-row-id"),
          rowHeader?.id,
        ].find((candidate) => typeof candidate === "string" && candidate.trim().length > 0) ?? `row-${index}`;
      return label ? { id, label, controls, mode: radios.length > 0 ? "radio" as const : "checkbox" as const } : null;
    })
    .filter((row): row is { id: string; label: string; controls: HTMLElement[]; mode: "radio" | "checkbox" } => Boolean(row));

  if (dataRows.length === 0) {
    return null;
  }

  const mode = dataRows.some((row) => row.mode === "checkbox") ? "checkbox" : "radio";
  const rows = dataRows.map((row) => ({ id: row.id, label: row.label }));
  const columns =
    columnHeaders.length >= dataRows[0]!.controls.length
      ? columnHeaders.slice(columnHeaders.length - dataRows[0]!.controls.length)
      : dataRows[0]!.controls.map((control) => getChoiceLabel(control)).filter(Boolean);

  if (columns.length === 0) {
    return null;
  }

  return { rows, columns, mode };
}

function extractScaleBoundLabels(
  container: HTMLElement,
  label: string,
  options: string[],
  helpText?: string,
): { scaleLowLabel?: string; scaleHighLabel?: string } {
  const ignoredValues = new Set(
    [label, helpText, ...options]
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeText(value)),
  );

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) {
        return NodeFilter.FILTER_REJECT;
      }

      if (
        parent.closest('[role="radio"]') ||
        parent.closest('[role="heading"]') ||
        parent.closest('[role="note"]') ||
        parent.closest(".gubaDc") ||
        parent.closest(".freebirdFormviewerComponentsQuestionBaseDescription")
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      return rawTextContent(parent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const candidates: string[] = [];
  let current: Node | null = walker.nextNode();
  while (current) {
    const text = (current.textContent ?? "").replace(/\s+/g, " ").trim();
    const normalized = normalizeText(text);

    if (
      normalized &&
      !ignoredValues.has(normalized) &&
      !/^\d+(?:\s+\d+)*$/.test(normalized) &&
      !candidates.some((candidate) => normalizeText(candidate) === normalized)
    ) {
      candidates.push(text);
    }

    current = walker.nextNode();
  }

  if (candidates.length >= 2) {
    return {
      scaleLowLabel: candidates[0],
      scaleHighLabel: candidates[candidates.length - 1],
    };
  }

  return {};
}

function isChoiceWithOtherValue(value: FieldValue): value is ChoiceWithOtherValue {
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

function detectField(container: HTMLElement, index: number): FieldDescriptor | null {
  const label = getQuestionLabel(container);
  if (!label) {
    return null;
  }

  const grid = getDirectGrid(container);
  if (grid) {
    const definition = extractGridDefinition(grid);
    if (definition) {
      return {
        field: {
          id: uniqueFieldId(container, label, index),
          label,
          normalizedLabel: normalizeText(label),
          type: "grid",
        required: isRequired(container, label),
        options: definition.columns,
        gridRows: definition.rows.map((row) => row.label),
          gridRowIds: definition.rows.map((row) => row.id),
          gridMode: definition.mode,
          helpText: getHelpText(container),
          sectionTitle: getSectionTitle(container),
        },
        container,
        control: grid,
        type: "grid",
      };
    }
  }

  const radioOptions = Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).filter(isVisible);
  if (radioOptions.length) {
    const flattenedGrid = extractFlattenedGridDefinition(radioOptions, "radio");
    if (flattenedGrid) {
      return {
        field: {
          id: uniqueFieldId(container, label, index),
          label,
          normalizedLabel: normalizeText(label),
          type: "grid",
          required: isRequired(container, label),
          options: flattenedGrid.columns,
          gridRows: flattenedGrid.rows.map((row) => row.label),
          gridRowIds: flattenedGrid.rows.map((row) => row.id),
          gridMode: flattenedGrid.mode,
          helpText: getHelpText(container),
          sectionTitle: getSectionTitle(container),
        },
        container,
        control: radioOptions[0],
        type: "grid",
      };
    }

    const { options, otherOption } = buildChoiceOptions(radioOptions, container, "radio");
    const helpText = getHelpText(container);
    const numericScale = !otherOption && radioOptions.every((option) => {
      const labelText = getChoiceLabel(option);
      return !labelText || /^\d+$/.test(labelText);
    });
    const scaleBounds = numericScale ? extractScaleBoundLabels(container, label, options, helpText) : {};
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: numericScale ? "scale" : "radio",
        required: isRequired(container, label),
        options,
        otherOption,
        helpText,
        scaleLowLabel: scaleBounds.scaleLowLabel,
        scaleHighLabel: scaleBounds.scaleHighLabel,
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: radioOptions[0],
      type: numericScale ? "scale" : "radio",
    };
  }

  const checkboxOptions = Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(isVisible);
  if (checkboxOptions.length) {
    const flattenedGrid = extractFlattenedGridDefinition(checkboxOptions, "checkbox");
    if (flattenedGrid) {
      return {
        field: {
          id: uniqueFieldId(container, label, index),
          label,
          normalizedLabel: normalizeText(label),
          type: "grid",
          required: isRequired(container, label),
          options: flattenedGrid.columns,
          gridRows: flattenedGrid.rows.map((row) => row.label),
          gridRowIds: flattenedGrid.rows.map((row) => row.id),
          gridMode: flattenedGrid.mode,
          helpText: getHelpText(container),
          sectionTitle: getSectionTitle(container),
        },
        container,
        control: checkboxOptions[0],
        type: "grid",
      };
    }

    const { options, otherOption } = isVerifiedEmailConsentContainer(container)
      ? { options: [getVerifiedEmailOptionLabel(container)], otherOption: undefined }
      : buildChoiceOptions(checkboxOptions, container, "checkbox");
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "checkbox",
        required: isRequired(container, label),
        options,
        otherOption,
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: checkboxOptions[0],
      type: "checkbox",
    };
  }

  const select = container.querySelector<HTMLSelectElement>("select");
  if (select && isVisible(select)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "dropdown",
        required: isRequired(container, label),
        options: Array.from(select.options)
          .filter((option) => isSelectableNativeOption(option, select.options.length))
          .map((option) => option.textContent?.trim() ?? "")
          .filter(Boolean),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: select,
      type: "dropdown",
    };
  }

  const compositeTimeInputs = getVisibleTimeInputs(container);
  if (compositeTimeInputs) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "time",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: compositeTimeInputs.hourInput,
      type: "time",
    };
  }

  const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]');
  if (dateInput && isVisible(dateInput)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "date",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: dateInput,
      type: "date",
    };
  }

  const compositeDateInputs = getVisibleDateInputs(container);
  if (compositeDateInputs) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "date",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: compositeDateInputs.yearInput,
      type: "date",
    };
  }

  const timeInput = container.querySelector<HTMLInputElement>('input[type="time"]');
  if (timeInput && isVisible(timeInput)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "time",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: timeInput,
      type: "time",
    };
  }

  const popupDropdown = container.querySelector<HTMLElement>('[role="listbox"], [role="combobox"]');
  if (popupDropdown && isVisible(popupDropdown)) {
    const options = getScopedPopupOptionNodes(popupDropdown, container)
      .map((option) => rawTextContent(option))
      .filter(Boolean);

    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "dropdown",
        required: isRequired(container, label),
        options,
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: popupDropdown,
      type: "dropdown",
    };
  }

  const textInput = container.querySelector<HTMLInputElement>('input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"]');
  if (textInput && isVisible(textInput)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "text",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: textInput,
      type: "text",
    };
  }

  const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
  if (textarea && isVisible(textarea)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "textarea",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: textarea,
      type: "textarea",
    };
  }

  return null;
}

export function scanFormDocument(root: Document, url = root.location.href): ScanResult {
  const descriptors = getQuestionContainers(root).map(detectField).filter((value): value is FieldDescriptor => Boolean(value));
  const fields = descriptors.map((descriptor) => descriptor.field);
  const { title, debug } = getFormTitle(
    root,
    fields.map((field) => field.label),
  );
  sanitizeFieldSections(fields, title);

  return {
    title,
    url,
    formKey: createFormKey(url, title, fields.map((field) => field.label)),
    fields,
    debug,
  };
}

function dispatchInputEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

function setNativeInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  dispatchInputEvents(element);
}

function fillTextField(control: HTMLElement, value: FieldValue): boolean {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return false;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return false;
  }

  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    setNativeInputValue(control, String(value));
    return true;
  }

  return false;
}

function fillTimeField(container: HTMLElement, control: HTMLElement, value: string): boolean {
  if (control instanceof HTMLInputElement && control.type === "time") {
    return fillTextField(control, value);
  }

  const compositeInputs = getVisibleTimeInputs(container);
  if (!compositeInputs) {
    return false;
  }

  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) {
    return false;
  }

  const [, hours, minutes] = match;
  setNativeInputValue(compositeInputs.hourInput, String(Number(hours)));
  setNativeInputValue(compositeInputs.minuteInput, minutes);
  return true;
}

function fillDateField(container: HTMLElement, control: HTMLElement, value: string): boolean {
  if (control instanceof HTMLInputElement && control.type === "date") {
    return fillTextField(control, value);
  }

  const compositeInputs = getVisibleDateInputs(container);
  if (!compositeInputs) {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  setNativeInputValue(compositeInputs.monthInput, String(Number(month)));
  setNativeInputValue(compositeInputs.dayInput, String(Number(day)));
  setNativeInputValue(compositeInputs.yearInput, year);
  return true;
}

function isValidDateFillValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTimeFillValue(value: string): boolean {
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

function isSelected(node: HTMLElement): boolean {
  return node.getAttribute("aria-checked") === "true" || node.getAttribute("aria-selected") === "true";
}

function dispatchPointerMouseClickSequence(node: HTMLElement): void {
  const pointerEventCtor = typeof PointerEvent === "function" ? PointerEvent : null;
  if (pointerEventCtor) {
    node.dispatchEvent(new pointerEventCtor("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 }));
  }

  node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
  node.click();
}

function dispatchKeyboardSequence(node: HTMLElement, key: string): void {
  node.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
  node.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key }));
  node.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key }));
}

function closePopupDropdown(control: HTMLElement): void {
  dispatchKeyboardSequence(control, "Escape");
  control.dispatchEvent(new Event("blur", { bubbles: true }));
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
  document.body.click();
}

function getPopupTextInput(control: HTMLElement, container: HTMLElement): HTMLInputElement | null {
  const candidates = [
    control.querySelector<HTMLInputElement>('input[type="text"]'),
    container.querySelector<HTMLInputElement>('[role="combobox"] input[type="text"]'),
    container.querySelector<HTMLInputElement>('input[type="text"][aria-autocomplete]'),
  ].filter((candidate): candidate is HTMLInputElement => candidate instanceof HTMLInputElement && isVisible(candidate));

  return candidates[0] ?? null;
}

function setPopupFilterValue(control: HTMLElement, container: HTMLElement, value: string): boolean {
  const input = getPopupTextInput(control, container);
  if (!input) {
    return false;
  }

  input.focus();
  setNativeInputValue(input, value);
  return true;
}

function toggleRoleOption(node: HTMLElement): void {
  dispatchPointerMouseClickSequence(node);
}

function selectRadioOption(container: HTMLElement, target: string): HTMLElement | null {
  const options = Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).filter(isVisible);
  const match =
    options.find((option) => optionEquals(getChoiceLabel(option), target)) ??
    (optionEquals(target, "Other") ? findAttachedOtherChoice(container, "radio") : null);
  if (!match) {
    return null;
  }

  if (!isSelected(match)) {
    toggleRoleOption(match);
  }

  return match;
}

function fillCheckboxGroup(container: HTMLElement, targetValues: string[]): boolean {
  if (targetValues.length === 0) {
    return false;
  }

  const desired = new Set(targetValues.map((value) => normalizeText(value)));
  const verifiedEmailOption = isVerifiedEmailConsentContainer(container) ? getVerifiedEmailOptionLabel(container) : null;
  const options = Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"]'))
    .filter(isVisible)
    .map((option) => {
      const choiceLabel = getChoiceLabel(option);
      const labelText = verifiedEmailOption ?? (choiceLabel || (hasAttachedTextControl(option, "checkbox", container) ? "Other" : ""));

      return {
        option,
        label: normalizeText(labelText),
      };
    });

  const availableLabels = new Set(options.map(({ label }) => label).filter(Boolean));
  if (desired.size > 0 && Array.from(desired).some((label) => !availableLabels.has(label))) {
    return false;
  }

  for (const { option, label } of options) {
    if (!label) {
      continue;
    }

    const shouldBeChecked = desired.has(label);
    const currentlyChecked = isSelected(option);
    if (shouldBeChecked !== currentlyChecked) {
      toggleRoleOption(option);
    }
  }

  return availableLabels.size > 0 || targetValues.length === 0;
}

function fillGridField(container: HTMLElement, field: DetectedField, value: FieldValue): boolean {
  if (!isGridValue(value) || !field.gridRows?.length || !field.options?.length || !field.gridMode) {
    return false;
  }

  const grid = getDirectGrid(container);
  const dataRows = grid
    ? Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]'))
        .filter(isVisible)
        .map((row) => {
          const radios = Array.from(row.querySelectorAll<HTMLElement>('[role="radio"]')).filter(isVisible);
          const checkboxes = Array.from(row.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(isVisible);
          const controls = field.gridMode === "checkbox" ? checkboxes : radios;
          const label = extractGridRowLabel(row);
          return controls.length > 0 && label ? { label, controls } : null;
        })
        .filter((row): row is { label: string; controls: HTMLElement[] } => Boolean(row))
    : field.gridMode === "checkbox"
      ? Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"]'))
          .filter(isVisible)
          .reduce<{ label: string; controls: HTMLElement[] }[]>((groups, control) => {
            const parsed = parseFlattenedGridChoiceLabel(getChoiceLabel(control));
            if (!parsed) {
              return groups;
            }

            let group = groups.find((candidate) => optionEquals(candidate.label, parsed.row));
            if (!group) {
              group = { label: parsed.row, controls: [] };
              groups.push(group);
            }
            group.controls.push(control);
            return groups;
          }, [])
      : Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]'))
          .filter(isVisible)
          .reduce<{ label: string; controls: HTMLElement[] }[]>((groups, control) => {
            const parsed = parseFlattenedGridChoiceLabel(getChoiceLabel(control));
            if (!parsed) {
              return groups;
            }

            let group = groups.find((candidate) => optionEquals(candidate.label, parsed.row));
            if (!group) {
              group = { label: parsed.row, controls: [] };
              groups.push(group);
            }
            group.controls.push(control);
            return groups;
          }, []);

  if (dataRows.length === 0) {
    return false;
  }

  let changedAny = false;

  for (const [rowIndex, rowLabel] of field.gridRows.entries()) {
    const row = dataRows[rowIndex];
    if (!row) {
      return false;
    }

    const rowKey = field.gridRowIds?.[rowIndex] ?? rowLabel;
    const rowValue = value.rows[rowKey] ?? value.rows[rowLabel];
    const columnLabels: string[] = field.options ?? [];

    if (rowValue === undefined || rowValue === null) {
      continue;
    }

    if (field.gridMode === "radio") {
      if (typeof rowValue !== "string") {
        continue;
      }

      const targetIndex = columnLabels.findIndex((column) => optionEquals(column, rowValue));
      if (targetIndex < 0 || !row.controls[targetIndex]) {
        return false;
      }

      const target = row.controls[targetIndex]!;
      if (!isSelected(target)) {
        toggleRoleOption(target);
      }
      changedAny = true;
      continue;
    }

    const desired = new Set(Array.isArray(rowValue) ? rowValue.map((item) => normalizeText(String(item))) : []);

    for (const [index, control] of row.controls.entries()) {
      const columnLabel = columnLabels[index];
      if (!columnLabel) {
        continue;
      }

      const shouldBeChecked = desired.has(normalizeText(columnLabel));
      if (isSelected(control) !== shouldBeChecked) {
        toggleRoleOption(control);
      }
    }
    changedAny = true;
  }

  return changedAny;
}

function fillChoiceAttachedText(
  choiceNode: HTMLElement | null,
  role: "radio" | "checkbox",
  container: HTMLElement,
  text: string,
): boolean {
  const control = (choiceNode ? findAttachedTextControl(choiceNode, role, container) : null) ?? findSingleBoundaryTextControl(container);
  if (!control) {
    return false;
  }

  setNativeInputValue(control, text);
  return true;
}

async function fillChoiceAttachedTextAsync(
  choiceNode: HTMLElement | null,
  role: "radio" | "checkbox",
  container: HTMLElement,
  text: string,
): Promise<boolean> {
  const directControl = (choiceNode ? findAttachedTextControl(choiceNode, role, container) : null) ?? findSingleBoundaryTextControl(container);
  if (directControl) {
    setNativeInputValue(directControl, text);
    return true;
  }

  for (let attempt = 0; attempt < POPUP_OPTION_RETRY_ATTEMPTS; attempt += 1) {
    await sleep(POPUP_OPTION_RETRY_DELAY_MS);
    const delayedControl = (choiceNode ? findAttachedTextControl(choiceNode, role, container) : null) ?? findSingleBoundaryTextControl(container);
    if (delayedControl) {
      setNativeInputValue(delayedControl, text);
      return true;
    }
  }

  return false;
}

function findPlaceholderPopupOption(candidates: HTMLElement[]): HTMLElement | undefined {
  return candidates.find((candidate) => looksLikePlaceholderLabel(rawTextContent(candidate)));
}

function fillDropdown(container: HTMLElement, control: HTMLElement, value: string): boolean {
  if (control instanceof HTMLSelectElement) {
    const option = Array.from(control.options).find((candidate) =>
      isSelectableNativeOption(candidate, control.options.length) && optionEquals(candidate.textContent ?? "", value),
    );
    if (!option) {
      return false;
    }

    control.value = option.value;
    dispatchInputEvents(control);
    return true;
  }

  if (control.getAttribute("role") === "listbox" || control.getAttribute("role") === "combobox") {
    dispatchPointerMouseClickSequence(control);
    const candidates = getPopupOptionNodes(control, container);
    const option = candidates.find((candidate) => optionEquals(rawTextContent(candidate), value));
    if (option) {
      dispatchPointerMouseClickSequence(option);
      if (didPopupSelectionCommit(control, option, value)) {
        return true;
      }
    }

    return false;
  }

  return false;
}

function clearDropdown(container: HTMLElement, control: HTMLElement): boolean {
  if (control instanceof HTMLSelectElement) {
    const placeholderOption =
      Array.from(control.options).find((candidate) => candidate.value.trim().length === 0) ??
      Array.from(control.options).find((candidate) => looksLikePlaceholderLabel(candidate.textContent?.trim() ?? ""));

    if (!placeholderOption) {
      return false;
    }

    control.value = placeholderOption.value;
    dispatchInputEvents(control);
    return true;
  }

  if (control.getAttribute("role") === "listbox" || control.getAttribute("role") === "combobox") {
    dispatchPointerMouseClickSequence(control);
    const candidates = getPopupOptionNodes(control, container);
    const placeholderOption = findPlaceholderPopupOption(candidates);
    if (placeholderOption) {
      dispatchPointerMouseClickSequence(placeholderOption);
      return didPopupSelectionCommit(control, placeholderOption, rawTextContent(placeholderOption));
    }
  }

  return false;
}

async function fillDropdownAsync(container: HTMLElement, control: HTMLElement, value: string): Promise<boolean> {
  if (control instanceof HTMLSelectElement) {
    return fillDropdown(container, control, value);
  }

  if (control.getAttribute("role") === "listbox" || control.getAttribute("role") === "combobox") {
    for (let fillAttempt = 0; fillAttempt < POPUP_FILL_ATTEMPTS; fillAttempt += 1) {
      dispatchPointerMouseClickSequence(control);
      setPopupFilterValue(control, container, value);

      let candidates = getPopupOptionNodes(control, container);
      let option = candidates.find((candidate) => optionEquals(rawTextContent(candidate), value));

      for (let attempt = 0; !option && attempt < POPUP_OPTION_RETRY_ATTEMPTS; attempt += 1) {
        await sleep(POPUP_OPTION_RETRY_DELAY_MS);
        if (attempt === 1) {
          setPopupFilterValue(control, container, value);
        }
        candidates = getPopupOptionNodes(control, container);
        option = candidates.find((candidate) => optionEquals(rawTextContent(candidate), value));
      }

      if (option) {
        dispatchPointerMouseClickSequence(option);
        if (didPopupSelectionCommit(control, option, value)) {
          closePopupDropdown(control);
          return true;
        }

        await sleep(POPUP_OPTION_RETRY_DELAY_MS);
        if (didPopupSelectionCommit(control, option, value)) {
          closePopupDropdown(control);
          return true;
        }

        if (await verifyPopupSelectionFromFreshOptions(control, container, value)) {
          closePopupDropdown(control);
          return true;
        }
      }

      if (control.getAttribute("role") === "combobox" || control.getAttribute("role") === "listbox") {
        const keyboardSuccess = await selectPopupOptionWithKeyboard(control, candidates, value);
        if (keyboardSuccess) {
          closePopupDropdown(control);
          return true;
        }
      }

      closePopupDropdown(control);
      await sleep(POPUP_OPTION_RETRY_DELAY_MS);
    }

    return false;
  }

  return fillDropdown(container, control, value);
}

async function clearDropdownAsync(container: HTMLElement, control: HTMLElement): Promise<boolean> {
  if (control instanceof HTMLSelectElement) {
    return clearDropdown(container, control);
  }

  if (control.getAttribute("role") === "listbox" || control.getAttribute("role") === "combobox") {
    for (let fillAttempt = 0; fillAttempt < POPUP_FILL_ATTEMPTS; fillAttempt += 1) {
      dispatchPointerMouseClickSequence(control);

      let candidates = getPopupOptionNodes(control, container);
      let placeholderOption = findPlaceholderPopupOption(candidates);

      for (let attempt = 0; !placeholderOption && attempt < POPUP_OPTION_RETRY_ATTEMPTS; attempt += 1) {
        await sleep(POPUP_OPTION_RETRY_DELAY_MS);
        candidates = getPopupOptionNodes(control, container);
        placeholderOption = findPlaceholderPopupOption(candidates);
      }

      if (placeholderOption) {
        const placeholderValue = rawTextContent(placeholderOption);
        dispatchPointerMouseClickSequence(placeholderOption);
        if (didPopupSelectionCommit(control, placeholderOption, placeholderValue)) {
          closePopupDropdown(control);
          return true;
        }

        await sleep(POPUP_OPTION_RETRY_DELAY_MS);
        if (didPopupSelectionCommit(control, placeholderOption, placeholderValue)) {
          closePopupDropdown(control);
          return true;
        }

        if (await verifyPopupSelectionFromFreshOptions(control, container, placeholderValue)) {
          closePopupDropdown(control);
          return true;
        }
      }

      if (control.getAttribute("role") === "combobox" || control.getAttribute("role") === "listbox") {
        const keyboardSuccess = await selectPopupOptionWithKeyboard(
          control,
          candidates,
          rawTextContent(placeholderOption ?? findPlaceholderPopupOption(candidates) ?? null),
        );
        if (keyboardSuccess) {
          closePopupDropdown(control);
          return true;
        }
      }

      closePopupDropdown(control);
      await sleep(POPUP_OPTION_RETRY_DELAY_MS);
    }

    return false;
  }

  return clearDropdown(container, control);
}

function getScopedPopupOptionNodes(control: HTMLElement, container: HTMLElement): HTMLElement[] {
  const popupId = control.getAttribute("aria-controls") ?? control.getAttribute("aria-owns");
  const popupRoot = popupId ? document.getElementById(popupId) : null;
  return Array.from((popupRoot ?? container).querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible);
}

function getPopupOptionNodes(control: HTMLElement, container: HTMLElement): HTMLElement[] {
  const scopedOptions = getScopedPopupOptionNodes(control, container);
  if (scopedOptions.length > 0) {
    return scopedOptions;
  }

  const popupId = control.getAttribute("aria-controls") ?? control.getAttribute("aria-owns");
  const popupRoot = popupId ? document.getElementById(popupId) : null;
  const roots = [popupRoot, container, document.body, document.documentElement].filter((root): root is HTMLElement => Boolean(root));
  const options: HTMLElement[] = [];

  for (const root of roots) {
    for (const option of Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible)) {
      if (!options.includes(option)) {
        options.push(option);
      }
    }
  }

  return options;
}

function didPopupSelectionCommit(control: HTMLElement, option: HTMLElement, value: string): boolean {
  if (option.getAttribute("aria-selected") === "true" || option.getAttribute("aria-checked") === "true") {
    return true;
  }

  const activeDescendantId = control.getAttribute("aria-activedescendant");
  if (activeDescendantId && option.id && activeDescendantId === option.id) {
    return true;
  }

  const controlValueCandidates = [
    rawTextContent(control),
    control.getAttribute("aria-label") ?? "",
    control.getAttribute("aria-valuetext") ?? "",
    control.getAttribute("data-selected") ?? "",
    control.getAttribute("data-value") ?? "",
  ];

  return controlValueCandidates.some((candidate) => optionEquals(candidate, value));
}

async function verifyPopupSelectionFromFreshOptions(
  control: HTMLElement,
  container: HTMLElement,
  value: string,
): Promise<boolean> {
  dispatchPointerMouseClickSequence(control);
  await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);

  const freshCandidates = getPopupOptionNodes(control, container);
  const freshSelected = freshCandidates.find((candidate) => {
    const isSelected =
      candidate.getAttribute("aria-selected") === "true" || candidate.getAttribute("aria-checked") === "true";
    return isSelected && optionEquals(rawTextContent(candidate), value);
  });

  if (freshSelected) {
    return true;
  }

  const activeDescendantId = control.getAttribute("aria-activedescendant");
  if (activeDescendantId) {
    const activeOption = document.getElementById(activeDescendantId);
    if (activeOption && optionEquals(rawTextContent(activeOption), value)) {
      return true;
    }
  }

  const controlValueCandidates = [
    rawTextContent(control),
    control.getAttribute("aria-label") ?? "",
    control.getAttribute("aria-valuetext") ?? "",
    control.getAttribute("data-selected") ?? "",
    control.getAttribute("data-value") ?? "",
  ];

  return controlValueCandidates.some((candidate) => optionEquals(candidate, value));
}

async function selectPopupOptionWithKeyboard(control: HTMLElement, candidates: HTMLElement[], value: string): Promise<boolean> {
  const targetIndex = candidates.findIndex((candidate) => optionEquals(rawTextContent(candidate), value));
  if (targetIndex < 0) {
    return false;
  }

  control.focus();

  const getCurrentSelectionIndex = (): number =>
    candidates.findIndex((candidate) => candidate.getAttribute("aria-selected") === "true");

  let currentIndex = getCurrentSelectionIndex();

  if (currentIndex >= 0 && currentIndex !== targetIndex) {
    const directionKey = currentIndex < targetIndex ? "ArrowDown" : "ArrowUp";
    const steps = Math.abs(targetIndex - currentIndex);

    for (let step = 0; step < steps; step += 1) {
      dispatchKeyboardSequence(control, directionKey);
      await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);
      currentIndex = getCurrentSelectionIndex();
      if (currentIndex === targetIndex) {
        break;
      }
    }
  }

  currentIndex = getCurrentSelectionIndex();
  if (currentIndex === targetIndex) {
    const targetOption = candidates[targetIndex];
    if (targetOption) {
      dispatchKeyboardSequence(control, "Enter");
      await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);
      if (didPopupSelectionCommit(control, targetOption, value)) {
        return true;
      }

      dispatchKeyboardSequence(control, " ");
      await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);
      return didPopupSelectionCommit(control, targetOption, value);
    }
  }

  for (let step = 0; step <= candidates.length; step += 1) {
    const activeDescendantId = control.getAttribute("aria-activedescendant");
    const activeOption = activeDescendantId ? document.getElementById(activeDescendantId) as HTMLElement | null : null;
    if (activeOption && optionEquals(rawTextContent(activeOption), value)) {
      dispatchKeyboardSequence(control, "Enter");
      await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);
      if (didPopupSelectionCommit(control, activeOption, value)) {
        return true;
      }

      dispatchKeyboardSequence(control, " ");
      await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);
      return didPopupSelectionCommit(control, activeOption, value);
    }

    dispatchKeyboardSequence(control, "ArrowDown");
    await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);
  }

  currentIndex = getCurrentSelectionIndex();
  if (currentIndex < 0) {
    for (let step = 0; step <= targetIndex; step += 1) {
      dispatchKeyboardSequence(control, "ArrowDown");
      await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);
    }
  }

  dispatchKeyboardSequence(control, "Enter");
  await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);
  const targetOption = candidates[targetIndex];
  if (targetOption && didPopupSelectionCommit(control, targetOption, value)) {
    return true;
  }

  dispatchKeyboardSequence(control, " ");
  await sleep(POPUP_KEYBOARD_STEP_DELAY_MS);
  return targetOption ? didPopupSelectionCommit(control, targetOption, value) : false;
}

function buildFieldIdentity(field: Pick<DetectedField, "normalizedLabel" | "type" | "sectionTitle" | "helpText">): FieldIdentity {
  return {
    normalizedLabel: field.normalizedLabel,
    type: field.type,
    sectionTitle: field.sectionTitle ? normalizeText(field.sectionTitle) : undefined,
    helpText: field.helpText ? normalizeText(field.helpText) : undefined,
  };
}

function fieldIdentityScore(left: FieldIdentity, right: FieldIdentity): number {
  if (left.normalizedLabel !== right.normalizedLabel || left.type !== right.type) {
    return -1;
  }

  let score = 2;
  if (left.sectionTitle && right.sectionTitle && left.sectionTitle === right.sectionTitle) {
    score += 2;
  }
  if (left.helpText && right.helpText && left.helpText === right.helpText) {
    score += 1;
  }

  return score;
}

function getDuplicateLabelOrdinal(fields: DetectedField[] | undefined, target: DetectedField): number {
  if (!fields) {
    return 0;
  }

  let ordinal = 0;
  for (const field of fields) {
    if (field.normalizedLabel === target.normalizedLabel) {
      if (field.id === target.id) {
        return ordinal;
      }
      ordinal += 1;
    }
  }

  return 0;
}

function findDescriptorByField(root: Document, field: DetectedField, referenceFields?: DetectedField[]): FieldDescriptor | null {
  const descriptors = getQuestionContainers(root).map(detectField).filter((value): value is FieldDescriptor => Boolean(value));
  const referenceIdentity = buildFieldIdentity(field);

  const exactIdMatch = descriptors.find((descriptor) => descriptor.field.id === field.id);
  if (exactIdMatch) {
    return exactIdMatch;
  }

  let bestMatch: FieldDescriptor | null = null;
  let bestScore = -1;

  for (const descriptor of descriptors) {
    const score = fieldIdentityScore(buildFieldIdentity(descriptor.field), referenceIdentity);
    if (score > bestScore) {
      bestMatch = descriptor;
      bestScore = score;
    }
  }

  if (bestScore === 2) {
    const sameLabelDescriptors = descriptors.filter(
      (descriptor) =>
        descriptor.field.normalizedLabel === referenceIdentity.normalizedLabel &&
        descriptor.field.type === referenceIdentity.type,
    );
    const ordinal = getDuplicateLabelOrdinal(referenceFields, field);
    return sameLabelDescriptors[ordinal] ?? bestMatch;
  }

  return bestScore >= 2 ? bestMatch : null;
}

export function fillFormDocument(root: Document, request: FillRequest): FillResult {
  const filledFieldIds: string[] = [];
  const skippedFieldIds: string[] = [];

  for (const [fieldId, value] of Object.entries(request.values)) {
    const referenceField =
      request.fields?.find((field) => field.id === fieldId) ??
      request.fields?.find((field) => field.normalizedLabel === normalizeText(fieldId));

    if (!referenceField) {
      skippedFieldIds.push(fieldId);
      continue;
    }

    const descriptor = findDescriptorByField(root, referenceField, request.fields);
    if (!descriptor || !isVisible(descriptor.container)) {
      skippedFieldIds.push(fieldId);
      continue;
    }

    let success = false;

    switch (descriptor.type) {
      case "text":
      case "textarea":
        success = fillTextField(descriptor.control, value);
        break;
      case "date":
        success = typeof value === "string" && isValidDateFillValue(value) ? fillDateField(descriptor.container, descriptor.control, value) : false;
        break;
      case "time":
        success = typeof value === "string" && isValidTimeFillValue(value) ? fillTimeField(descriptor.container, descriptor.control, value) : false;
        break;
      case "radio":
      case "scale":
        if (typeof value === "string" || typeof value === "number") {
          if (referenceField.otherOption && optionEquals(referenceField.otherOption, String(value))) {
            success = false;
          } else {
            success = Boolean(selectRadioOption(descriptor.container, String(value)));
          }
        } else if (isChoiceWithOtherValue(value) && typeof value.selected === "string") {
          if (referenceField.otherOption && optionEquals(referenceField.otherOption, value.selected) && !value.otherText.trim()) {
            success = false;
            break;
          }

          const selected = String(value.selected);
          const match = selectRadioOption(descriptor.container, selected);
          success = Boolean(match);

          if (success && referenceField.otherOption && optionEquals(referenceField.otherOption, selected)) {
            success = fillChoiceAttachedText(match, "radio", descriptor.container, value.otherText);
          }
        } else {
          success = false;
        }
        break;
      case "checkbox":
        if (Array.isArray(value)) {
          success = fillCheckboxGroup(descriptor.container, value.map(String));
        } else if (isChoiceWithOtherValue(value) && Array.isArray(value.selected)) {
          const normalizedSelected = referenceField.otherOption && !value.otherText.trim()
            ? value.selected.filter((item) => !optionEquals(item, referenceField.otherOption as string))
            : value.selected;

          if (
            referenceField.otherOption &&
            normalizedSelected.length === value.selected.length &&
            value.selected.some((item) => optionEquals(item, referenceField.otherOption as string)) &&
            !value.otherText.trim()
          ) {
            success = false;
            break;
          }

          success = fillCheckboxGroup(descriptor.container, normalizedSelected.map(String));
          if (
            success &&
            referenceField.otherOption &&
            normalizedSelected.some((item) => optionEquals(item, referenceField.otherOption as string))
          ) {
            success = fillChoiceAttachedText(findAttachedOtherChoice(descriptor.container, "checkbox"), "checkbox", descriptor.container, value.otherText);
          }
        } else {
          success = false;
        }
        break;
      case "dropdown":
        success =
          value === null
            ? clearDropdown(descriptor.container, descriptor.control)
            : typeof value === "string" || typeof value === "number"
              ? fillDropdown(descriptor.container, descriptor.control, String(value))
              : false;
        break;
      case "grid":
        success = fillGridField(descriptor.container, referenceField, value);
        break;
      default:
        success = false;
        break;
    }

    if (success) {
      filledFieldIds.push(fieldId);
    } else {
      skippedFieldIds.push(fieldId);
    }
  }

  return { filledFieldIds, skippedFieldIds };
}

export async function fillFormDocumentAsync(root: Document, request: FillRequest): Promise<FillResult> {
  const filledFieldIds: string[] = [];
  const skippedFieldIds: string[] = [];

  for (const [fieldId, value] of Object.entries(request.values)) {
    const referenceField =
      request.fields?.find((field) => field.id === fieldId) ??
      request.fields?.find((field) => field.normalizedLabel === normalizeText(fieldId));

    if (!referenceField) {
      skippedFieldIds.push(fieldId);
      continue;
    }

    const descriptor = findDescriptorByField(root, referenceField, request.fields);
    if (!descriptor || !isVisible(descriptor.container)) {
      skippedFieldIds.push(fieldId);
      continue;
    }

    let success = false;

    switch (descriptor.type) {
      case "text":
      case "textarea":
        success = fillTextField(descriptor.control, value);
        break;
      case "date":
        success = typeof value === "string" && isValidDateFillValue(value) ? fillDateField(descriptor.container, descriptor.control, value) : false;
        break;
      case "time":
        success = typeof value === "string" && isValidTimeFillValue(value) ? fillTimeField(descriptor.container, descriptor.control, value) : false;
        break;
      case "radio":
      case "scale":
        if (typeof value === "string" || typeof value === "number") {
          if (referenceField.otherOption && optionEquals(referenceField.otherOption, String(value))) {
            success = false;
          } else {
            success = Boolean(selectRadioOption(descriptor.container, String(value)));
          }
        } else if (isChoiceWithOtherValue(value) && typeof value.selected === "string") {
          if (referenceField.otherOption && optionEquals(referenceField.otherOption, value.selected) && !value.otherText.trim()) {
            success = false;
            break;
          }

          const selected = String(value.selected);
          const match = selectRadioOption(descriptor.container, selected);
          success = Boolean(match);

          if (success && referenceField.otherOption && optionEquals(referenceField.otherOption, selected)) {
            success = await fillChoiceAttachedTextAsync(match, "radio", descriptor.container, value.otherText);
          }
        } else {
          success = false;
        }
        break;
      case "checkbox":
        if (Array.isArray(value)) {
          success = fillCheckboxGroup(descriptor.container, value.map(String));
        } else if (isChoiceWithOtherValue(value) && Array.isArray(value.selected)) {
          const normalizedSelected = referenceField.otherOption && !value.otherText.trim()
            ? value.selected.filter((item) => !optionEquals(item, referenceField.otherOption as string))
            : value.selected;

          if (
            referenceField.otherOption &&
            normalizedSelected.length === value.selected.length &&
            value.selected.some((item) => optionEquals(item, referenceField.otherOption as string)) &&
            !value.otherText.trim()
          ) {
            success = false;
            break;
          }

          success = fillCheckboxGroup(descriptor.container, normalizedSelected.map(String));

          if (
            success &&
            referenceField.otherOption &&
            normalizedSelected.some((item) => optionEquals(item, referenceField.otherOption as string)) &&
            value.otherText.trim()
          ) {
            success = await fillChoiceAttachedTextAsync(
              findAttachedOtherChoice(descriptor.container, "checkbox"),
              "checkbox",
              descriptor.container,
              value.otherText,
            );
          }
        } else {
          success = false;
        }
        break;
      case "dropdown":
        success = typeof value === "string" || typeof value === "number"
          ? await fillDropdownAsync(descriptor.container, descriptor.control, String(value))
          : value === null
            ? await clearDropdownAsync(descriptor.container, descriptor.control)
            : false;
        break;
      case "grid":
        success = fillGridField(descriptor.container, referenceField, value);
        break;
      default:
        success = false;
        break;
    }

    if (success) {
      filledFieldIds.push(fieldId);
    } else {
      skippedFieldIds.push(fieldId);
    }
  }

  return { filledFieldIds, skippedFieldIds };
}
