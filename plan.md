Yes — this is a **good and practical extension idea**.

The core value is clear: many people repeatedly fill the same Google Forms with the same personal, academic, office, shipping, or registration details, and a Chrome extension can reduce that friction by detecting form fields, showing saved defaults, letting the user override them, and then filling the form in one click. Chrome extensions support this architecture well through Manifest V3, content scripts, runtime script injection, and extension storage APIs. ([Chrome for Developers][1])

The biggest challenge is not whether it is possible, but **how reliably you map Google Form fields**. Google Forms has many question types and validation behaviors, and the page structure is not a public stable API, so your extension should treat DOM parsing as a resilient best-effort layer rather than something guaranteed forever. Google Forms also supports validation/rules on several question types, which means your filler should respect required fields and visible constraints instead of blindly inserting values. ([Google Help][2])

Here is a detailed prompt in markdown you can use to plan or build it:

````markdown
# Build Prompt: Fillo Browser Extension

## Product Name
Create a Chrome browser extension called **Fillo**.

## Product Goal
Build a browser extension that helps users quickly fill repetitive Google Forms by saving reusable profile values and form-specific defaults.

The extension should detect Google Form fields when the user opens a Google Form URL. When the user clicks the extension icon, it should show all detected form fields in a clean popup UI.

If saved values already exist for that form, the popup should show those values prefilled.
If no saved values exist yet, the extension should detect all fields from the current Google Form and let the user create saved defaults.

The user can then:
- review detected fields
- edit or override values
- save defaults for this specific form
- optionally map fields to reusable profile data
- click a button to auto-fill the form

The product should reduce repetitive manual form filling while still giving the user control before insertion.

---

## Core Problem
Users often fill the same or similar Google Forms multiple times with repeated data such as:
- full name
- email
- phone number
- student ID
- address
- department
- company
- designation
- emergency contact
- preferences
- common checkbox/radio answers

Doing this manually every time is slow and annoying.

This extension should make the process fast, editable, and reusable.

---

## Target Users
- students filling academic forms repeatedly
- job seekers filling application forms
- employees filling internal company forms
- event participants filling registration forms
- users who frequently submit repetitive Google Forms

---

## Core User Flow

### Flow 1: First time on a form
1. User opens a Google Form link.
2. User clicks the extension icon.
3. Extension scans the current form and detects all fillable fields.
4. Popup shows the field list with empty or guessed values.
5. User enters values manually or maps fields to a reusable profile.
6. User saves this configuration as defaults for the current form.
7. User clicks **Fill Form**.
8. Extension fills the fields into the live Google Form.

### Flow 2: Returning to a known form
1. User opens the same Google Form again.
2. User clicks the extension icon.
3. Extension identifies the form using a stable form key.
4. Popup loads previously saved defaults for that form.
5. User can review and override any value.
6. User clicks **Fill Form**.
7. Extension fills the form instantly.

### Flow 3: Using reusable profile values
1. User creates one or more reusable profiles such as:
   - Personal
   - Work
   - Academic
   - Shipping
2. When a new Google Form is detected, user can map form fields to profile values.
3. Form-specific defaults can override profile values when necessary.

---

## Main Features

### 1. Detect Google Form fields
The extension must detect the visible fillable fields on Google Forms pages.

Support these types initially:
- short answer
- paragraph
- multiple choice
- checkboxes
- dropdown
- linear scale
- multiple choice grid (optional in v2)
- checkbox grid (optional in v2)
- date (optional in v2)
- time (optional in v2)

For each field, capture:
- internal field key
- question label text
- field type
- required or optional
- options list if applicable
- validation hints if visible
- section/page information if possible

### 2. Form-specific saved defaults
Each Google Form can have its own saved default values.

A saved form config should include:
- form identifier
- form title if available
- form URL signature
- detected fields
- saved values for each field
- last updated timestamp

### 3. Reusable profiles
Allow users to create reusable value sets such as:
- personal profile
- office profile
- university profile

Each profile can store values like:
- full name
- email
- phone
- address
- organization
- department
- ID numbers
- common preferences

### 4. Smart field mapping
When a new form is detected, try to match form labels to known profile keys.

Examples:
- "Full Name" -> profile.fullName
- "Email Address" -> profile.email
- "Phone Number" -> profile.phone
- "Student ID" -> profile.studentId

Matching should be based on:
- exact label match
- normalized text match
- synonym matching
- previous mappings from user history

### 5. Override before fill
Even if defaults exist, the popup must always allow the user to override values before filling.

### 6. One-click fill
After review, the user clicks **Fill Form** and the extension fills the Google Form fields in the page.

### 7. Save after changes
If the user modifies a value, they can choose:
- fill once only
- update this form’s default
- update linked profile value

### 8. Manage saved forms
Provide a management view where users can:
- list saved forms
- rename saved form presets
- delete saved presets
- export/import saved data

### 9. Privacy-first storage
User data should be stored locally by default.
No server should be required in the first version.

### 10. Safe behavior
The extension must never auto-submit the form without explicit user action.
Only fill fields.
Submission must remain manual.

---

## MVP Scope

### Include in MVP
- Manifest V3 Chrome extension
- popup UI
- detect current Google Form page
- scan fields from current form
- save defaults per form
- create reusable profiles
- manual override in popup
- fill short answer, paragraph, radio, checkbox, dropdown
- local storage only
- never auto-submit

### Exclude from MVP
- cloud sync
- AI-based form understanding
- multi-page section navigation automation
- file upload support
- auto-submit
- OCR
- advanced enterprise sharing
- cross-browser packaging

---

## Technical Architecture

### Extension Components
Build the extension using:
- `manifest.json`
- background service worker
- popup page
- content script
- shared storage utilities

### Responsibilities

#### Popup
- shows current form status
- lists detected fields
- loads saved defaults
- allows editing values
- allows saving presets
- triggers fill action

#### Content Script
- runs on Google Form pages
- scans DOM for field structure
- extracts labels, options, required state, type
- fills fields based on provided payload
- returns scan results to popup

#### Background Service Worker
- coordinates messaging
- manages storage reads/writes
- handles tab checks and script injection if needed

#### Storage Layer
Use extension storage for:
- profiles
- form presets
- field mappings
- settings
- usage metadata

---

## Suggested Data Models

### Profile
```ts
type Profile = {
  id: string;
  name: string;
  values: Record<string, string | string[] | boolean | number>;
  createdAt: number;
  updatedAt: number;
};
````

### FormPreset

```ts
type FormPreset = {
  id: string;
  formKey: string;
  formTitle?: string;
  formUrl?: string;
  fields: DetectedField[];
  values: Record<string, FieldValue>;
  mappings?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
};
```

### DetectedField

```ts
type DetectedField = {
  id: string;
  label: string;
  normalizedLabel: string;
  type: "text" | "textarea" | "radio" | "checkbox" | "dropdown" | "scale" | "date" | "time" | "grid";
  required: boolean;
  options?: string[];
  sectionTitle?: string;
  helpText?: string;
};
```

### FieldValue

```ts
type FieldValue =
  | string
  | string[]
  | number
  | boolean
  | null;
```

---

## Form Identification Strategy

A Google Form should be identified using a stable `formKey`.

Possible strategy:

1. extract form ID from URL if available
2. fallback to normalized action/path signature
3. combine with form title for extra safety

Example:

* parse `/forms/d/e/{FORM_ID}/viewform`
* use that `{FORM_ID}` as primary key

If not available, generate a deterministic hash from:

* URL path
* title
* visible first few labels

---

## Field Detection Rules

### Text inputs

Detect:

* label text
* placeholder if any
* required state
* current value

### Paragraph

Detect as multi-line text field.

### Multiple choice

Capture all visible options and selected state.

### Checkboxes

Capture all options and allow multiple selected values.

### Dropdown

Capture all options and selected value.

### Required fields

Detect visual required markers and store `required: true`.

### Hidden or unsupported fields

Ignore unsupported or hidden fields safely.

---

## Filling Rules

The extension should:

* fill only supported visible fields
* respect current section/page visibility
* dispatch proper input/change/click events after setting values
* not break Google Forms validation flow
* avoid filling disabled or hidden controls
* handle radio, checkbox, and dropdown by matching visible option labels

For text matching:

* normalize whitespace
* ignore case
* trim punctuation where useful

---

## Matching Strategy

Implement a matching system with this priority:

1. exact saved field ID match
2. exact normalized label match
3. fuzzy label match
4. profile key suggestion

Example label normalization:

* lowercase
* trim
* collapse spaces
* remove trailing colon
* remove required marker

---

## UX Requirements

### Popup UI

The popup should be simple and fast.

Include:

* current form title
* detected field count
* selected profile dropdown
* editable field list
* save preset button
* fill form button
* clear values button

Each field row should show:

* field label
* field type
* required badge
* editable input control
* optional mapping selector

### Empty state

If current tab is not a Google Form:

* show friendly message: "Open a Google Form to use this extension."

If form fields cannot be detected:

* show "Unable to detect fields on this page" with retry option.

### Review-first approach

Never fill silently.
Always show the values before fill.

---

## Settings

Provide settings for:

* default profile
* auto-load matching profile on known forms
* confirm before filling
* local export/import
* clear all saved data

---

## Privacy & Security Requirements

* store data locally by default
* do not send form answers to external servers in MVP
* do not auto-submit forms
* do not collect browsing history
* only run on Google Forms URLs
* clearly explain permissions to users
* allow user to delete all saved data anytime

---

## Suggested Chrome Permissions

Use the minimum permissions necessary.

Potential needs:

* storage
* activeTab
* scripting
* host permissions for Google Forms URLs only

Suggested match patterns:

* `https://docs.google.com/forms/*`
* `https://forms.gle/*` if needed for detection flow, but final page parsing may occur on docs.google.com

---

## Edge Cases

Handle these carefully:

* duplicated question labels
* multi-section forms
* conditional branching
* required fields with validation
* changed forms where saved mappings are stale
* unsupported field types
* forms that load slowly
* forms in different languages
* checkbox fields with multiple defaults
* radio/dropdown options that changed since last save

When a field changed:

* show mismatch warning
* let user remap or ignore

---

## Nice-to-Have v2 Features

* import profile from CSV or JSON
* multiple presets for the same form
* keyboard shortcuts
* quick fill button injected into page
* field templates
* cross-device sync
* AI-assisted label matching
* support for section navigation
* partial fill
* team-shared profiles

---

## Success Criteria

The extension is successful if:

* users can save default values for a specific Google Form
* users can override values before filling
* users can fill repetitive forms in seconds
* data stays private and locally stored
* common question types work reliably

---

## Deliverables

Build:

1. Manifest V3 Chrome extension
2. popup UI
3. background service worker
4. Google Form content script scanner/filler
5. local storage management
6. saved form preset system
7. reusable profiles system
8. README with setup, permissions, and privacy notes

---

## Recommended Tech Stack

* TypeScript
* Chrome Extension Manifest V3
* React or plain TypeScript for popup UI
* chrome.storage for persistence
* lightweight utility layer for field normalization and matching
* build with Vite or Plasmo if desired

---

## Implementation Order

1. detect current Google Form tab
2. scan and return field metadata
3. render fields in popup
4. save/load form presets
5. fill supported field types
6. add reusable profiles
7. add mapping and mismatch handling
8. polish UI and settings

---

## Important Product Principle

This extension should behave like a **reviewable smart assistant**, not a blind auto-bot.

The user should always:

* see detected fields
* control values
* choose what gets filled
* submit manually

```

My take: **worth building**, especially as an MVP Chrome extension first. The idea is useful, narrow, and easy to explain. The main risk is long-term maintenance of Google Forms DOM detection, so design the parser to be modular and tolerant to markup changes rather than hardcoding brittle selectors. Chrome’s current extension model supports the needed pieces for content scripts, runtime injection, and persistent extension storage. :contentReference[oaicite:2]{index=2}

A very strong positioning line for it could be:

**“Save once, review fast, fill repetitive Google Forms in one click.”**

I can also turn this into a full PRD or folder structure next.
::contentReference[oaicite:3]{index=3}
```
