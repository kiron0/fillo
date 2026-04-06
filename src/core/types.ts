export type FieldType =
  | "text"
  | "textarea"
  | "radio"
  | "checkbox"
  | "dropdown"
  | "scale"
  | "date"
  | "time"
  | "grid";

export interface ChoiceWithOtherValue {
  kind: "choice_with_other";
  selected: string | string[];
  otherText: string;
}

export interface GridValue {
  kind: "grid";
  rows: Record<string, string | string[]>;
}

export type FieldValue = string | string[] | number | boolean | null | ChoiceWithOtherValue | GridValue;

export type ProfileValue = string | string[] | boolean | number;

export type MessageResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export interface DetectedField {
  id: string;
  label: string;
  normalizedLabel: string;
  type: FieldType;
  required: boolean;
  textSubtype?: "text" | "email" | "number" | "tel" | "url";
  options?: string[];
  otherOption?: string;
  gridRows?: string[];
  gridRowIds?: string[];
  gridMode?: "radio" | "checkbox";
  scaleLowLabel?: string;
  scaleHighLabel?: string;
  sectionKey?: string;
  sectionTitle?: string;
  helpText?: string;
}

export interface Profile {
  id: string;
  name: string;
  values: Record<string, ProfileValue>;
  aliases?: Record<string, string[]>;
  createdAt: number;
  updatedAt: number;
}

export interface PresetSectionSnapshot {
  id: string;
  title: string;
  fieldIds: string[];
  updatedAt: number;
}

export interface FormPreset {
  id: string;
  formKey: string;
  name: string;
  formTitle?: string;
  formUrl?: string;
  fields: DetectedField[];
  values: Record<string, FieldValue>;
  mappings?: Record<string, string>;
  unmappedFieldIds?: string[];
  excludedFieldIds?: string[];
  sections?: PresetSectionSnapshot[];
  mappingSchemaVersion?: 2;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  defaultProfileId: string | null;
  autoLoadMatchingProfile: boolean;
  confirmBeforeFill: boolean;
  showBackupSection: boolean;
}

export interface FormHistoryEntry {
  id: string;
  formKey: string;
  formTitle: string;
  formUrl?: string;
  lastUsedProfileId: string | null;
  lastUsedProfileName?: string | null;
  lastFilledAt: number;
  filledFieldCount: number;
  skippedFieldCount: number;
}

export interface ExportSelection {
  profiles: boolean;
  presets: boolean;
  settings: boolean;
  history: boolean;
}

export interface ExportedAppData {
  version: 1;
  exportedAt: number;
  selection: ExportSelection;
  profiles?: Profile[];
  presets?: FormPreset[];
  settings?: AppSettings;
  history?: FormHistoryEntry[];
}

export interface ImportedAppData {
  version?: number;
  exportedAt?: number;
  profiles?: Profile[];
  presets?: FormPreset[];
  settings?: AppSettings;
  history?: FormHistoryEntry[];
  selection?: Partial<ExportSelection>;
}

export interface ActiveFormContext {
  title: string;
  url: string;
  formKey: string;
  fields: DetectedField[];
  debug?: {
    titleSource: string;
    documentTitle?: string;
    metaTitle?: string;
    structuredTitle?: string;
  };
}

export interface ActiveFormLookup {
  status: "ready" | "unsupported_only" | "invalid_url" | "no_active_tab";
  pageUrl?: string;
  context?: ActiveFormContext;
}

export interface FillResult {
  filledFieldIds: string[];
  skippedFieldIds: string[];
}

export interface ScanResult extends ActiveFormContext {}

export interface FillRequest {
  formKey: string;
  values: Record<string, FieldValue>;
  fields?: DetectedField[];
}

export type BackgroundRequest =
  | { type: "GET_ACTIVE_FORM_CONTEXT" }
  | { type: "FILL_ACTIVE_FORM"; payload: FillRequest }
  | {
      type: "RUN_STORAGE_MUTATION";
      payload:
        | { kind: "save_profile"; profile: Profile }
        | { kind: "delete_profile"; profileId: string }
        | { kind: "save_preset"; preset: FormPreset }
        | { kind: "delete_preset"; presetId: string }
        | { kind: "save_history_entry"; entry: FormHistoryEntry }
        | { kind: "clear_history" }
        | { kind: "save_settings"; settings: AppSettings }
        | { kind: "clear_all_data" }
        | { kind: "import_app_data"; data: ImportedAppData };
    };

export type ContentRequest =
  | { type: "PING" }
  | { type: "SCAN_FORM" }
  | { type: "FILL_FORM"; payload: FillRequest };

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProfileId: null,
  autoLoadMatchingProfile: true,
  confirmBeforeFill: true,
  showBackupSection: false,
};

export const DEFAULT_EXPORT_SELECTION: ExportSelection = {
  profiles: true,
  presets: true,
  settings: true,
  history: true,
};
