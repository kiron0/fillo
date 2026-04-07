import { fillFormDocument, fillFormDocumentAsync, scanFormDocument } from "../src/features/content/form-dom";

const formHtml = `
<!doctype html>
<html>
  <head>
    <title>Student Registration</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Full Name *</div>
      <input type="text" name="full_name" />
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Bio</div>
      <textarea name="bio"></textarea>
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Department</div>
      <div role="radio" aria-checked="false">CSE</div>
      <div role="radio" aria-checked="false">EEE</div>
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Skills</div>
      <div role="checkbox" aria-checked="false">JavaScript</div>
      <div role="checkbox" aria-checked="false">TypeScript</div>
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Session</div>
      <select name="session">
        <option value="">Choose</option>
        <option value="morning">Morning</option>
        <option value="evening">Evening</option>
      </select>
    </div>
  </body>
</html>
`;

const nestedChoiceHtml = `
<!doctype html>
<html>
  <head>
    <title>Nested Choices</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Pick one</div>
      <div role="radio" aria-checked="false" aria-labelledby="choice-a">
        <div><span id="choice-a">Option A</span></div>
      </div>
      <div role="radio" aria-checked="false" aria-label="Option B"></div>
    </div>
  </body>
</html>
`;

const duplicateLabelDifferentTypesHtml = `
<!doctype html>
<html>
  <head>
    <title>Duplicate Labels</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Contact</div>
      <input type="text" name="contact_text" />
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Contact</div>
      <select name="contact_select">
        <option value="">Choose</option>
        <option value="sales">Sales</option>
        <option value="support">Support</option>
      </select>
    </div>
  </body>
</html>
`;

const radioWithOtherHtml = `
<!doctype html>
<html>
  <head>
    <title>Batch Form</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Batch *</div>
      <div role="radio" aria-checked="false">17</div>
      <div role="radio" aria-checked="false">16</div>
      <div role="radio" aria-checked="false">Other</div>
      <input type="text" name="batch_other" />
    </div>
  </body>
</html>
`;

const radioWithSyntheticOtherHtml = `
<!doctype html>
<html>
  <head>
    <title>Batch Synthetic Other</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Batch *</div>
      <div><div role="radio" aria-checked="false">17</div></div>
      <div><div role="radio" aria-checked="false">16</div></div>
      <div>
        <div role="radio" aria-checked="false"></div>
        <input type="text" name="batch_other_synthetic" />
      </div>
    </div>
  </body>
</html>
`;

const radioWithDelayedOtherInputHtml = `
<!doctype html>
<html>
  <head>
    <title>Batch Delayed Other</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Batch *</div>
      <div role="radio" aria-checked="false">17</div>
      <div role="radio" aria-checked="false">Other</div>
    </div>
  </body>
</html>
`;

const explicitNonOtherOptionHtml = `
<!doctype html>
<html>
  <head>
    <title>Explicit Non Other</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Reason</div>
      <div role="radio" aria-checked="false">Other Department</div>
      <div role="radio" aria-checked="false">Transfer</div>
    </div>
  </body>
</html>
`;

const checkboxOtherBindingHtml = `
<!doctype html>
<html>
  <head>
    <title>Checkbox Other Binding</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Courses</div>
      <div role="checkbox" aria-checked="false">Math</div>
      <div>
        <div role="checkbox" aria-checked="false"></div>
        <input type="text" name="courses_other" />
      </div>
      <input type="text" name="unrelated_text" />
    </div>
  </body>
</html>
`;

const scopedListboxHtml = `
<!doctype html>
<html>
  <head>
    <title>Scoped Listbox</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Session</div>
      <div role="listbox" aria-controls="session-options"></div>
    </div>
    <div id="session-options">
      <div role="option">Morning</div>
      <div role="option">Evening</div>
    </div>
    <div id="unrelated-options">
      <div role="option">Wrong Option</div>
    </div>
  </body>
</html>
`;

const scopedComboboxHtml = `
<!doctype html>
<html>
  <head>
    <title>Scoped Combobox</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Department</div>
      <div role="combobox" aria-controls="department-options" aria-expanded="false"></div>
    </div>
    <div id="department-options">
      <div role="option">CSE</div>
      <div role="option">EEE</div>
    </div>
  </body>
</html>
`;

const mousedownComboboxHtml = `
<!doctype html>
<html>
  <head>
    <title>Mousedown Combobox</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Department</div>
      <div role="combobox" aria-controls="department-options" aria-expanded="false"></div>
    </div>
    <div id="department-options">
      <div role="option">CSE</div>
      <div role="option">EEE</div>
    </div>
  </body>
</html>
`;

const keyboardComboboxHtml = `
<!doctype html>
<html>
  <head>
    <title>Keyboard Combobox</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Department</div>
      <div role="combobox" aria-controls="department-options" aria-expanded="false"></div>
    </div>
    <div id="department-options">
      <div id="department-option-cse" role="option">CSE</div>
      <div id="department-option-eee" role="option">EEE</div>
    </div>
  </body>
</html>
`;

const comboboxWithTextInputHtml = `
<!doctype html>
<html>
  <head>
    <title>Combobox With Text Input</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Department</div>
      <div role="combobox" aria-controls="department-options" aria-expanded="false">
        <input type="text" name="department_search" />
      </div>
    </div>
    <div id="department-options">
      <div role="option">CSE</div>
      <div role="option">EEE</div>
    </div>
  </body>
</html>
`;


const keyboardListboxHtml = `
<!doctype html>
<html>
  <head>
    <title>Keyboard Listbox</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Session</div>
      <div role="listbox" aria-controls="session-options"></div>
    </div>
    <div id="session-options">
      <div id="session-option-morning" role="option">Morning</div>
      <div id="session-option-evening" role="option">Evening</div>
    </div>
  </body>
</html>
`;

const selectedStateListboxHtml = `
<!doctype html>
<html>
  <head>
    <title>Selected State Listbox</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">All the options</div>
      <div role="listbox" aria-expanded="false">
        <div role="option" aria-selected="true" data-value="">Choose</div>
        <div role="option" aria-selected="false" data-value="Option 1">Option 1</div>
        <div role="option" aria-selected="false" data-value="Option 2">Option 2</div>
        <div role="option" aria-selected="false" data-value="Option 3">Option 3</div>
      </div>
    </div>
  </body>
</html>
`;

const delayedListboxHtml = `
<!doctype html>
<html>
  <head>
    <title>Delayed Listbox</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">All the options</div>
      <div role="listbox" aria-expanded="false"></div>
    </div>
  </body>
</html>
`;

const keyboardClearListboxHtml = `
<!doctype html>
<html>
  <head>
    <title>Keyboard Clear Listbox</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Session</div>
      <div role="listbox" aria-expanded="false" aria-activedescendant="session-option-evening" data-selected="Evening"></div>
    </div>
    <div id="session-options">
      <div id="session-option-choose" role="option">Choose</div>
      <div id="session-option-morning" role="option">Morning</div>
      <div id="session-option-evening" role="option" aria-selected="true">Evening</div>
    </div>
  </body>
</html>
`;

const selectWithTextPlaceholderHtml = `
<!doctype html>
<html>
  <head>
    <title>Text Placeholder Select</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Department</div>
      <select name="department">
        <option value="placeholder">Choose</option>
        <option value="cse">CSE</option>
        <option value="eee">EEE</option>
      </select>
    </div>
  </body>
</html>
`;

const verifiedEmailConsentHtml = `
<!doctype html>
<html>
  <head>
    <title>Email Consent</title>
  </head>
  <body>
    <div class="XfpsVe">
      <div>Email *</div>
      <div class="consent-row">
        <div role="checkbox" aria-checked="false" aria-label="Record email"></div>
        <span>Record toufiqhasankiron0@gmail.com as the email to be included with my response</span>
      </div>
    </div>
  </body>
</html>
`;

const verifiedEmailBeforeQuestionHtml = `
<!doctype html>
<html>
  <head>
    <title>Email First</title>
  </head>
  <body>
    <div class="XfpsVe">
      <div>Email *</div>
      <div class="consent-row">
        <div role="checkbox" aria-checked="false" aria-label="Record email"></div>
        <span>Record toufiqhasankiron0@gmail.com as the email to be included with my response</span>
      </div>
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Full Name *</div>
      <input type="text" name="full_name" />
    </div>
  </body>
</html>
`;

const ordinaryEmailCheckboxQuestionHtml = `
<!doctype html>
<html>
  <head>
    <title>Notification Preferences</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Notification preferences</div>
      <div role="checkbox" aria-checked="false">Record updates in the email summary</div>
      <div role="checkbox" aria-checked="false">Send immediately</div>
    </div>
  </body>
</html>
`;

const linearScaleHtml = `
<!doctype html>
<html>
  <head>
    <title>Linear Scale</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Linear scale</div>
      <div class="scale-values">
        <div>Not excited</div>
        <div role="radio" aria-checked="false">1</div>
        <div role="radio" aria-checked="false">2</div>
        <div role="radio" aria-checked="false">3</div>
        <div role="radio" aria-checked="false">4</div>
        <div role="radio" aria-checked="false">5</div>
        <div role="radio" aria-checked="false">6</div>
        <div role="radio" aria-checked="false">7</div>
        <div role="radio" aria-checked="false">8</div>
        <div role="radio" aria-checked="false">9</div>
        <div role="radio" aria-checked="false">10</div>
        <div>Extremely excited</div>
      </div>
    </div>
  </body>
</html>
`;

const dateTimeFormHtml = `
<!doctype html>
<html>
  <head>
    <title>Schedule</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Start date *</div>
      <input type="date" name="start_date" />
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Start time</div>
      <input type="time" name="start_time" />
    </div>
  </body>
</html>
`;

const compositeTimeFormHtml = `
<!doctype html>
<html>
  <head>
    <title>Composite Time</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Interview time</div>
      <input type="number" aria-label="Hour" max="23" />
      <input type="number" aria-label="Minute" max="59" />
    </div>
  </body>
</html>
`;

const compositeDateFormHtml = `
<!doctype html>
<html>
  <head>
    <title>Composite Date</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Interview date</div>
      <input type="number" aria-label="Month" max="12" />
      <input type="number" aria-label="Day" max="31" />
      <input type="number" aria-label="Year" maxlength="4" />
    </div>
  </body>
</html>
`;

const duplicateLabelFormHtml = `
<!doctype html>
<html>
  <head>
    <title>Duplicate Labels</title>
  </head>
  <body>
    <section>
      <div>Personal</div>
      <div role="list">
        <div role="listitem" class="Qr7Oae">
          <div role="heading">Email</div>
          <div class="gubaDc">Personal email address</div>
          <input type="text" />
        </div>
      </div>
    </section>
    <section>
      <div>Work</div>
      <div role="list">
        <div role="listitem" class="Qr7Oae">
          <div role="heading">Email</div>
          <div class="gubaDc">Work email address</div>
          <input type="text" />
        </div>
      </div>
    </section>
  </body>
</html>
`;

const duplicateLabelPlainFormHtml = `
<!doctype html>
<html>
  <head>
    <title>Duplicate Plain Labels</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Email</div>
      <input type="text" name="email_home" />
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Email</div>
      <input type="text" name="email_work" />
    </div>
  </body>
</html>
`;

const gridOnlyFormHtml = `
<!doctype html>
<html>
  <head>
    <title>Availability Form</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Availability</div>
      <div role="grid">
        <div role="row">
          <div role="columnheader">Morning</div>
          <div role="columnheader">Afternoon</div>
        </div>
        <div role="row">
          <div role="rowheader">Monday</div>
          <div role="radio" aria-checked="false">Morning</div>
          <div role="radio" aria-checked="false">Afternoon</div>
        </div>
        <div role="row">
          <div role="rowheader">Tuesday</div>
          <div role="radio" aria-checked="false">Morning</div>
          <div role="radio" aria-checked="false">Afternoon</div>
        </div>
      </div>
    </div>
  </body>
</html>
`;

const unsupportedOnlyFormHtml = `
<!doctype html>
<html>
  <head>
    <title>Grid Only</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Availability</div>
      <div role="grid">
        <div role="row">
          <div role="columnheader">Morning</div>
          <div role="columnheader">Afternoon</div>
        </div>
        <div role="row">
          <div role="rowheader">Monday</div>
          <div role="radio" aria-checked="false">Morning</div>
          <div role="radio" aria-checked="false">Afternoon</div>
        </div>
      </div>
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Preferences</div>
      <div role="grid">
        <div role="row">
          <div role="columnheader">A</div>
          <div role="columnheader">B</div>
        </div>
        <div role="row">
          <div role="rowheader">Row 1</div>
          <div role="checkbox" aria-checked="false">A</div>
          <div role="checkbox" aria-checked="false">B</div>
        </div>
      </div>
    </div>
  </body>
</html>
`;

const checkboxGridHtml = `
<!doctype html>
<html>
  <head>
    <title>Checkbox Grid</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Preferences</div>
      <div role="grid">
        <div role="row">
          <div role="columnheader">A</div>
          <div role="columnheader">B</div>
        </div>
        <div role="row">
          <div role="rowheader">Row 1</div>
          <div role="checkbox" aria-checked="false">A</div>
          <div role="checkbox" aria-checked="false">B</div>
        </div>
        <div role="row">
          <div role="rowheader">Row 2</div>
          <div role="checkbox" aria-checked="false">A</div>
          <div role="checkbox" aria-checked="false">B</div>
        </div>
      </div>
    </div>
  </body>
</html>
`;

const flattenedRadioGridHtml = `
<!doctype html>
<html>
  <head>
    <title>Flattened Radio Grid</title>
  </head>
  <body>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Multiple choice grid</div>
      <div class="row">
        <div role="radio" aria-checked="false" aria-label="Column 1, response for Row 1"></div>
        <div role="radio" aria-checked="false" aria-label="Column 2, response for Row 1"></div>
      </div>
      <div class="row">
        <div role="radio" aria-checked="false" aria-label="Column 1, response for Row 2"></div>
        <div role="radio" aria-checked="false" aria-label="Column 2, response for Row 2"></div>
      </div>
    </div>
  </body>
</html>
`;

const pollutedTitleFormHtml = `
<!doctype html>
<html>
  <head>
    <title>&lt;div class="HB1eCd-X3SwIb-haAclf"&gt;JavaScript isn't enabled in your browser, so this file can't be opened.&lt;/div&gt; Test Party</title>
    <meta property="og:title" content="Test Party" />
  </head>
  <body>
    <div role="heading" aria-level="1">Test Party</div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Full Name *</div>
      <input type="text" name="full_name" />
    </div>
  </body>
</html>
`;

const publicLoadDataTitleFormHtml = `
<!doctype html>
<html>
  <head>
    <title>&lt;div class="HB1eCd-X3SwIb-haAclf"&gt;JavaScript isn't enabled in your browser, so this file can't be opened. Enable and reload.&lt;/div&gt;Test PartyLorem ipsum dolor sit amet, consectetur adipiscing elit.</title>
    <script>
      var FB_PUBLIC_LOAD_DATA_ = [null, ["Lorem ipsum dolor sit amet, consectetur adipiscing elit.", [], null, null, null, null, null, null, "Test Party", 73, null, null, null, null, null, null, null, null, null, null, [null, "Lorem ipsum dolor sit amet, consectetur adipiscing elit."], [null, "Test Party"]], "/forms"];
    </script>
  </head>
  <body>
    <div role="heading" aria-level="1">
      &lt;div class="HB1eCd-X3SwIb-haAclf"&gt;JavaScript isn't enabled in your browser, so this file can't be opened. Enable and reload.&lt;/div&gt;Test Party
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Email *</div>
      <input type="email" name="email" />
    </div>
  </body>
</html>
`;

const publicLoadDataNestedTitleOnlyFormHtml = `
<!doctype html>
<html>
  <head>
    <title>&lt;div class="HB1eCd-X3SwIb-haAclf"&gt;JavaScript isn't enabled in your browser, so this file can't be opened. Enable and reload.&lt;/div&gt;Registration NotesFull Name</title>
    <script>
      var FB_PUBLIC_LOAD_DATA_ = [null, [null, [], null, null, null, null, null, null, null, 73, null, null, null, null, null, null, null, null, null, null, [null, "Registration Notes"], [null, "Student Registration"]], "/forms"];
    </script>
  </head>
  <body>
    <div role="heading" aria-level="1">
      &lt;div class="HB1eCd-X3SwIb-haAclf"&gt;JavaScript isn't enabled in your browser, so this file can't be opened. Enable and reload.&lt;/div&gt;Student RegistrationFull Name
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Full Name *</div>
      <input type="text" name="full_name" />
    </div>
  </body>
</html>
`;

const fieldPollutedTitleFormHtml = `
<!doctype html>
<html>
  <head>
    <title>&lt;div class="HB1eCd-X3SwIb-haAclf"&gt;JavaScript isn't enabled in your browser, so this file can't be opened. Enable and reload.&lt;/div&gt; Test Party Lorem ipsum dolor sit amet toufiqhasankiron2@gmail.com Switch accounts * Indicates required question Email</title>
    <meta property="og:title" content="Test Party" />
  </head>
  <body>
    <div role="heading" aria-level="1">Test Party</div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Email *</div>
      <input type="email" name="email" />
    </div>
    <div role="listitem" class="Qr7Oae">
      <div role="heading">Type your date</div>
      <input type="text" name="date" />
    </div>
  </body>
</html>
`;

const pollutedSectionHeaderHtml = `
<!doctype html>
<html>
  <head>
    <title>Test Party</title>
  </head>
  <body>
    <div>
      <div class="HB1eCd-X3SwIb-haAclf">
        <div class="HB1eCd-X3SwIb-i8xkGf">
          <div class="tk3N6e-cXJiPb tk3N6e-cXJiPb-TSZdd tk3N6e-cXJiPb-GMvhG">
            JavaScript isn't enabled in your browser, so this file can't be opened. Enable and reload.
          </div>
        </div>
        <br />
      </div>
      Test Party Lorem ipsum dolor sit amet, consectetur adipiscing elit. toufiqhasankiron0@gmail.com Switch account * Indicates required question
    </div>
    <div role="list">
      <div role="listitem" class="Qr7Oae">
        <div role="heading">Email *</div>
        <input type="email" name="email" />
      </div>
      <div role="listitem" class="Qr7Oae">
        <div role="heading">Type your date</div>
        <input type="text" name="date" />
      </div>
    </div>
  </body>
</html>
`;

function setInteractiveRoleClicks(root: Document) {
  for (const option of root.querySelectorAll<HTMLElement>('[role="radio"], [role="checkbox"]')) {
    option.addEventListener("click", () => {
      const role = option.getAttribute("role");
      if (role === "radio") {
        for (const sibling of option.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []) {
          sibling.setAttribute("aria-checked", sibling === option ? "true" : "false");
        }
      }

      if (role === "checkbox") {
        option.setAttribute("aria-checked", option.getAttribute("aria-checked") === "true" ? "false" : "true");
      }
    });
  }
}

describe("content dom", () => {
  it("scans supported fields from the form dom", () => {
    document.documentElement.innerHTML = formHtml;
    const result = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS123/viewform");

    expect(result.title).toBe("Student Registration");
    expect(result.formKey).toBe("1FAIpQLS123");
    expect(result.fields.map((field) => field.type)).toEqual(["text", "textarea", "radio", "checkbox", "dropdown"]);
    expect(result.fields[0]).toMatchObject({
      label: "Full Name",
      required: true,
    });
    expect(result.fields[4]).toMatchObject({
      options: ["Morning", "Evening"],
    });
  });

  it("fills text, textarea, radio, checkbox, and select fields", () => {
    document.documentElement.innerHTML = formHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS123/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        full_name: "Toufiq Hasan",
        bio: "Builder",
        department_2: "EEE",
        skills_3: ["JavaScript", "TypeScript"],
        session: "Evening",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["full_name", "bio", "department_2", "skills_3", "session"]);
    expect((document.querySelector('input[name="full_name"]') as HTMLInputElement).value).toBe("Toufiq Hasan");
    expect((document.querySelector('textarea[name="bio"]') as HTMLTextAreaElement).value).toBe("Builder");
    expect(document.querySelectorAll<HTMLElement>('[role="radio"]')[1].getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll<HTMLElement>('[role="checkbox"]')[0].getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll<HTMLElement>('[role="checkbox"]')[1].getAttribute("aria-checked")).toBe("true");
    expect((document.querySelector('select[name="session"]') as HTMLSelectElement).value).toBe("evening");
  });

  it("clears a native select field when the payload explicitly sets the dropdown to no option", () => {
    document.documentElement.innerHTML = formHtml;
    const select = document.querySelector('select[name="session"]') as HTMLSelectElement;
    select.value = "evening";

    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS123/viewform");
    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        session: null,
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["session"]);
    expect(fillResult.skippedFieldIds).toEqual([]);
    expect(select.value).toBe("");
  });

  it("extracts radio option labels from nested text and aria metadata", () => {
    document.documentElement.innerHTML = nestedChoiceHtml;
    const result = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS456/viewform");

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      type: "radio",
      options: ["Option A", "Option B"],
    });
  });

  it("matches duplicate labels by field type when ids change and DOM order shifts", () => {
    document.documentElement.innerHTML = duplicateLabelDifferentTypesHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSdupetypes/viewform");

    const listItems = Array.from(document.querySelectorAll<HTMLElement>('[role="listitem"]'));
    const textItem = listItems[0]!;
    const dropdownItem = listItems[1]!;
    (textItem.querySelector('input[name="contact_text"]') as HTMLInputElement).name = "contact_text_new";
    (dropdownItem.querySelector('select[name="contact_select"]') as HTMLSelectElement).name = "contact_select_new";
    dropdownItem.parentElement?.insertBefore(dropdownItem, textItem);

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: "Alice",
        [scan.fields[1]!.id]: "Support",
      },
    });

    expect(fillResult.filledFieldIds).toEqual([scan.fields[0]!.id, scan.fields[1]!.id]);
    expect(fillResult.skippedFieldIds).toEqual([]);
    expect((document.querySelector('input[name="contact_text_new"]') as HTMLInputElement).value).toBe("Alice");
    expect((document.querySelector('select[name="contact_select_new"]') as HTMLSelectElement).value).toBe("support");
  });

  it("captures bound labels for linear scale questions", () => {
    document.documentElement.innerHTML = linearScaleHtml;
    const result = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSlinear/viewform");

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      type: "scale",
      options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
      scaleLowLabel: "Not excited",
      scaleHighLabel: "Extremely excited",
    });
  });

  it("treats radio questions with an embedded other text input as radio fields", () => {
    document.documentElement.innerHTML = radioWithOtherHtml;
    const result = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS789/viewform");

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      type: "radio",
      label: "Batch",
      options: ["17", "16", "Other"],
      otherOption: "Other",
    });
  });

  it("fills an attached other text input when the other radio option is selected", () => {
    document.documentElement.innerHTML = radioWithOtherHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS789/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        batch_other: {
          kind: "choice_with_other",
          selected: "Other",
          otherText: "18",
        },
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["batch_other"]);
    expect(document.querySelectorAll<HTMLElement>('[role="radio"]')[2].getAttribute("aria-checked")).toBe("true");
    expect((document.querySelector('input[name="batch_other"]') as HTMLInputElement).value).toBe("18");
  });

  it("does not clear the attached radio Other input when the payload has blank otherText", () => {
    document.documentElement.innerHTML = radioWithOtherHtml;
    setInteractiveRoleClicks(document);
    (document.querySelector('input[name="batch_other"]') as HTMLInputElement).value = "17A";
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS789/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        batch_other: {
          kind: "choice_with_other",
          selected: "Other",
          otherText: "   ",
        },
      },
    });

    expect(fillResult.skippedFieldIds).toEqual(["batch_other"]);
    expect((document.querySelector('input[name="batch_other"]') as HTMLInputElement).value).toBe("17A");
    expect(document.querySelectorAll<HTMLElement>('[role="radio"]')[2].getAttribute("aria-checked")).toBe("false");
  });

  it("does not select a raw Other radio payload without attached text", () => {
    document.documentElement.innerHTML = radioWithOtherHtml;
    (document.querySelector('input[name="batch_other"]') as HTMLInputElement).value = "17A";
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSradiootherraw/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        batch_other: "Other",
      },
    });

    expect(fillResult.skippedFieldIds).toEqual(["batch_other"]);
    expect((document.querySelector('input[name="batch_other"]') as HTMLInputElement).value).toBe("17A");
    expect(document.querySelectorAll<HTMLElement>('[role="radio"]')[2].getAttribute("aria-checked")).toBe("false");
  });

  it("adds a synthetic Other option when a radio choice only exposes an attached text input", () => {
    document.documentElement.innerHTML = radioWithSyntheticOtherHtml;
    const result = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS999/viewform");

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      type: "radio",
      options: ["17", "16", "Other"],
      otherOption: "Other",
    });
  });

  it("fills a synthetic Other radio option by selecting the attached choice and writing text", () => {
    document.documentElement.innerHTML = radioWithSyntheticOtherHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS999/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        batch_other_synthetic: {
          kind: "choice_with_other",
          selected: "Other",
          otherText: "18",
        },
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["batch_other_synthetic"]);
    expect(document.querySelectorAll<HTMLElement>('[role="radio"]')[2].getAttribute("aria-checked")).toBe("true");
    expect((document.querySelector('input[name="batch_other_synthetic"]') as HTMLInputElement).value).toBe("18");
  });

  it("does not treat ordinary options starting with Other as attached-other fields", () => {
    document.documentElement.innerHTML = explicitNonOtherOptionHtml;
    const result = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSabc/viewform");

    expect(result.fields[0]).toMatchObject({
      type: "radio",
      options: ["Other Department", "Transfer"],
      otherOption: undefined,
    });
  });

  it("fills the attached checkbox other text without overwriting unrelated text inputs", () => {
    document.documentElement.innerHTML = checkboxOtherBindingHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScheckbox/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        courses_other: {
          kind: "choice_with_other",
          selected: ["Other"],
          otherText: "Physics",
        },
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["courses_other"]);
    expect((document.querySelector('input[name="courses_other"]') as HTMLInputElement).value).toBe("Physics");
    expect((document.querySelector('input[name="unrelated_text"]') as HTMLInputElement).value).toBe("");
  });

  it("does not clear the attached checkbox Other input when the payload has blank otherText", () => {
    document.documentElement.innerHTML = checkboxOtherBindingHtml;
    setInteractiveRoleClicks(document);
    (document.querySelector('input[name="courses_other"]') as HTMLInputElement).value = "Physics";
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScheckboxblank/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        courses_other: {
          kind: "choice_with_other",
          selected: ["Other"],
          otherText: "",
        },
      },
    });

    expect(fillResult.skippedFieldIds).toEqual(["courses_other"]);
    expect((document.querySelector('input[name="courses_other"]') as HTMLInputElement).value).toBe("Physics");
    expect(document.querySelectorAll<HTMLElement>('[role="checkbox"]')[1].getAttribute("aria-checked")).toBe("false");
  });

  it("still fills non-Other checkbox choices when stale payloads include Other with blank text", () => {
    document.documentElement.innerHTML = checkboxOtherBindingHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScheckboxmixedblank/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        courses_other: {
          kind: "choice_with_other",
          selected: ["Math", "Other"],
          otherText: "   ",
        },
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["courses_other"]);
    expect(document.querySelectorAll<HTMLElement>('[role="checkbox"]')[0].getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll<HTMLElement>('[role="checkbox"]')[1].getAttribute("aria-checked")).toBe("false");
    expect((document.querySelector('input[name="courses_other"]') as HTMLInputElement).value).toBe("");
  });

  it("does not report success or clear existing selections when checkbox targets do not match", () => {
    document.documentElement.innerHTML = formHtml;
    setInteractiveRoleClicks(document);
    document.querySelectorAll<HTMLElement>('[role="checkbox"]')[0].setAttribute("aria-checked", "true");
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScheckboxmissing/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        skills_3: ["Rust"],
      },
    });

    expect(fillResult.skippedFieldIds).toEqual(["skills_3"]);
    expect(document.querySelectorAll<HTMLElement>('[role="checkbox"]')[0].getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll<HTMLElement>('[role="checkbox"]')[1].getAttribute("aria-checked")).toBe("false");
  });

  it("fills checkbox Other values in the async path", async () => {
    document.documentElement.innerHTML = checkboxOtherBindingHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScheckboxotherasync/viewform");

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: {
          kind: "choice_with_other",
          selected: ["Math", "Other"],
          otherText: "Physics",
        },
      },
    });

    const checkboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]'));
    expect(fillResult.filledFieldIds).toEqual([scan.fields[0]!.id]);
    expect(checkboxes[0]!.getAttribute("aria-checked")).toBe("true");
    expect(checkboxes[1]!.getAttribute("aria-checked")).toBe("true");
    expect((document.querySelector('input[name="courses_other"]') as HTMLInputElement).value).toBe("Physics");
  });

  it("waits for a delayed radio Other input in the async path", async () => {
    document.documentElement.innerHTML = radioWithDelayedOtherInputHtml;
    setInteractiveRoleClicks(document);

    const radios = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]'));
    radios[1]!.addEventListener("click", () => {
      window.setTimeout(() => {
        const input = document.createElement("input");
        input.type = "text";
        input.name = "batch_other_delayed";
        radios[1]!.insertAdjacentElement("afterend", input);
      }, 0);
    });

    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSdelayedother/viewform");

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: {
          kind: "choice_with_other",
          selected: "Other",
          otherText: "18",
        },
      },
    });

    expect(fillResult.filledFieldIds).toEqual([scan.fields[0]!.id]);
    expect((document.querySelector('input[name="batch_other_delayed"]') as HTMLInputElement).value).toBe("18");
  });

  it("fills listbox options from the scoped popup instead of unrelated global options", () => {
    document.documentElement.innerHTML = scopedListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSlistbox/viewform");

    expect(scan.fields[0]).toMatchObject({
      type: "dropdown",
      options: ["Morning", "Evening"],
    });

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    for (const option of document.querySelectorAll<HTMLElement>('#session-options [role="option"], #unrelated-options [role="option"]')) {
      option.addEventListener("click", () => {
        listbox.setAttribute("data-selected", option.textContent ?? "");
      });
    }

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        session_0: "Evening",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["session_0"]);
    expect(listbox.getAttribute("data-selected")).toBe("Evening");
  });

  it("fills combobox options from the scoped popup", () => {
    document.documentElement.innerHTML = scopedComboboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScombobox/viewform");

    expect(scan.fields[0]).toMatchObject({
      type: "dropdown",
      options: ["CSE", "EEE"],
    });

    const combobox = document.querySelector('[role="combobox"]') as HTMLElement;
    combobox.addEventListener("click", () => {
      combobox.setAttribute("aria-expanded", "true");
    });

    for (const option of document.querySelectorAll<HTMLElement>('#department-options [role="option"]')) {
      option.addEventListener("click", () => {
        combobox.setAttribute("data-selected", option.textContent ?? "");
      });
    }

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        department_0: "EEE",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["department_0"]);
    expect(
      combobox.getAttribute("data-selected") === "EEE" || combobox.getAttribute("aria-activedescendant") === "department-option-eee",
    ).toBe(true);
  });

  it("fills combobox options when selection commits on mousedown instead of click", () => {
    document.documentElement.innerHTML = mousedownComboboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSmousedown/viewform");

    const combobox = document.querySelector('[role="combobox"]') as HTMLElement;
    combobox.addEventListener("mousedown", () => {
      combobox.setAttribute("aria-expanded", "true");
    });

    for (const option of document.querySelectorAll<HTMLElement>('#department-options [role="option"]')) {
      option.addEventListener("mousedown", () => {
        combobox.setAttribute("data-selected", option.textContent ?? "");
      });
    }

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        department_0: "EEE",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["department_0"]);
    expect(combobox.getAttribute("data-selected")).toBe("EEE");
  });

  it("fills combobox options when selection commits through aria-activedescendant and Enter", async () => {
    document.documentElement.innerHTML = keyboardComboboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSkeyboard/viewform");

    const combobox = document.querySelector('[role="combobox"]') as HTMLElement;
    const options = Array.from(document.querySelectorAll<HTMLElement>('#department-options [role="option"]'));
    let activeIndex = -1;

    combobox.addEventListener("click", () => {
      combobox.setAttribute("aria-expanded", "true");
    });

    combobox.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        activeIndex = Math.min(activeIndex + 1, options.length - 1);
        combobox.setAttribute("aria-activedescendant", options[activeIndex]!.id);
      }

      if (event.key === "Enter" && activeIndex >= 0) {
        combobox.setAttribute("data-selected", options[activeIndex]!.textContent ?? "");
      }
    });

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        department_0: "EEE",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["department_0"]);
    expect(
      combobox.getAttribute("data-selected") === "EEE" || combobox.getAttribute("aria-activedescendant") === "department-option-eee",
    ).toBe(true);
  });

  it("detects a combobox dropdown before a nested text input fallback", () => {
    document.documentElement.innerHTML = comboboxWithTextInputHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScomboboxtext/viewform");

    expect(scan.fields[0]).toMatchObject({
      type: "dropdown",
      options: ["CSE", "EEE"],
    });
  });

  it("fills listbox options when selection commits through aria-activedescendant and Enter", async () => {
    document.documentElement.innerHTML = keyboardListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSkeyboardlistbox/viewform");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    const options = Array.from(document.querySelectorAll<HTMLElement>('#session-options [role="option"]'));
    let activeIndex = -1;

    listbox.addEventListener("click", () => {
      listbox.setAttribute("aria-expanded", "true");
    });

    listbox.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        activeIndex = Math.min(activeIndex + 1, options.length - 1);
        listbox.setAttribute("aria-activedescendant", options[activeIndex]!.id);
      }

      if (event.key === "Enter" && activeIndex >= 0) {
        listbox.setAttribute("data-selected", options[activeIndex]!.textContent ?? "");
      }
    });

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        session_0: "Evening",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["session_0"]);
  });

  it("fills Google-style listboxes that track selection with aria-selected on child options", async () => {
    document.documentElement.innerHTML = selectedStateListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSselectedstate/viewform");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    const getOptions = () => Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));

    listbox.addEventListener("click", () => {
      listbox.setAttribute("aria-expanded", "true");
    });

    listbox.addEventListener("keydown", (event) => {
      const options = getOptions();
      let currentIndex = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
      if (currentIndex < 0) {
        currentIndex = 0;
      }

      if (event.key === "ArrowDown") {
        const nextIndex = Math.min(currentIndex + 1, options.length - 1);
        options.forEach((option, index) => option.setAttribute("aria-selected", index === nextIndex ? "true" : "false"));
      }

      if (event.key === "ArrowUp") {
        const nextIndex = Math.max(currentIndex - 1, 0);
        options.forEach((option, index) => option.setAttribute("aria-selected", index === nextIndex ? "true" : "false"));
      }

      if ((event.key === "Enter" || event.key === " ") && currentIndex >= 0) {
        listbox.setAttribute("data-selected", options[currentIndex]!.textContent ?? "");
      }
    });

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        all_the_options_0: "Option 2",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["all_the_options_0"]);
  });

  it("fills popup dropdowns when options appear after the listbox opens", async () => {
    document.documentElement.innerHTML = delayedListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSdelayedlistbox/viewform");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    listbox.addEventListener("click", () => {
      listbox.setAttribute("aria-expanded", "true");
      window.setTimeout(() => {
        if (listbox.querySelector('[role="option"]')) {
          return;
        }

        const choose = document.createElement("div");
        choose.setAttribute("role", "option");
        choose.setAttribute("aria-selected", "true");
        choose.textContent = "Choose";

        const option1 = document.createElement("div");
        option1.setAttribute("role", "option");
        option1.setAttribute("aria-selected", "false");
        option1.textContent = "Option 1";

        const option2 = document.createElement("div");
        option2.setAttribute("role", "option");
        option2.setAttribute("aria-selected", "false");
        option2.textContent = "Option 2";

        for (const option of [choose, option1, option2]) {
          option.addEventListener("click", () => {
            listbox.setAttribute("data-selected", option.textContent ?? "");
          });
          listbox.append(option);
        }
      }, 10);
    });

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        all_the_options_0: "Option 2",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["all_the_options_0"]);
    expect(listbox.getAttribute("data-selected")).toBe("Option 2");
  });

  it("reports popup dropdowns as filled when the selection commit lands shortly after the option click", async () => {
    document.documentElement.innerHTML = delayedListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSasynccommit/viewform");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    listbox.addEventListener("click", () => {
      listbox.setAttribute("aria-expanded", "true");

      if (listbox.querySelector('[role="option"]')) {
        return;
      }

      const choose = document.createElement("div");
      choose.setAttribute("role", "option");
      choose.setAttribute("aria-selected", "true");
      choose.textContent = "Choose";

      const option2 = document.createElement("div");
      option2.setAttribute("role", "option");
      option2.setAttribute("aria-selected", "false");
      option2.textContent = "Option 2";
      option2.addEventListener("click", () => {
        window.setTimeout(() => {
          listbox.setAttribute("data-selected", "Option 2");
        }, 10);
      });

      listbox.append(choose, option2);
    });

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        all_the_options_0: "Option 2",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["all_the_options_0"]);
    expect(fillResult.skippedFieldIds).toEqual([]);
    expect(listbox.getAttribute("data-selected")).toBe("Option 2");
  });

  it("reports popup dropdowns as filled when selection is only visible on freshly rendered options", async () => {
    document.documentElement.innerHTML = delayedListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSfreshoptions/viewform");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    let selectedValue = "Choose";

    const renderOptions = () => {
      listbox.replaceChildren();

      for (const optionLabel of ["Choose", "Option 1", "Option 2"]) {
        const option = document.createElement("div");
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", optionLabel === selectedValue ? "true" : "false");
        option.textContent = optionLabel;
        option.addEventListener("click", () => {
          selectedValue = optionLabel;
          listbox.setAttribute("aria-expanded", "false");
          listbox.replaceChildren();
        });
        listbox.append(option);
      }
    };

    listbox.addEventListener("click", () => {
      listbox.setAttribute("aria-expanded", "true");
      renderOptions();
    });

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        all_the_options_0: "Option 2",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["all_the_options_0"]);
    expect(fillResult.skippedFieldIds).toEqual([]);
  });

  it("clears popup dropdowns when the placeholder is only visible on freshly rendered options", async () => {
    document.documentElement.innerHTML = delayedListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSclearfresh/viewform");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    let selectedValue = "Option 2";

    const renderOptions = () => {
      listbox.replaceChildren();

      for (const optionLabel of ["Choose", "Option 1", "Option 2"]) {
        const option = document.createElement("div");
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", optionLabel === selectedValue ? "true" : "false");
        option.textContent = optionLabel;
        option.addEventListener("click", () => {
          selectedValue = optionLabel;
          listbox.setAttribute("aria-expanded", "false");
          listbox.replaceChildren();
        });
        listbox.append(option);
      }
    };

    listbox.addEventListener("click", () => {
      listbox.setAttribute("aria-expanded", "true");
      renderOptions();
    });

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        all_the_options_0: null,
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["all_the_options_0"]);
    expect(fillResult.skippedFieldIds).toEqual([]);
    expect(selectedValue).toBe("Choose");
  });

  it("retries popup dropdown fill when the first open does not commit a selection and closes afterward", async () => {
    document.documentElement.innerHTML = delayedListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSretrylistbox/viewform");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    let openCount = 0;

    listbox.addEventListener("click", () => {
      openCount += 1;
      listbox.setAttribute("aria-expanded", "true");

      if (openCount === 1) {
        return;
      }

      if (listbox.querySelector('[role="option"]')) {
        return;
      }

      const choose = document.createElement("div");
      choose.setAttribute("role", "option");
      choose.setAttribute("aria-selected", "true");
      choose.textContent = "Choose";

      const option2 = document.createElement("div");
      option2.setAttribute("role", "option");
      option2.setAttribute("aria-selected", "false");
      option2.textContent = "Option 2";
      option2.addEventListener("click", () => {
        listbox.setAttribute("data-selected", "Option 2");
      });

      listbox.append(choose, option2);
    });

    listbox.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        listbox.setAttribute("aria-expanded", "false");
      }
    });

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        all_the_options_0: "Option 2",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["all_the_options_0"]);
    expect(listbox.getAttribute("data-selected")).toBe("Option 2");
    expect(listbox.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not report popup listboxes as filled when no dropdown selection commits", async () => {
    document.documentElement.innerHTML = delayedListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSfailedlistbox/viewform");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    listbox.addEventListener("click", () => {
      listbox.setAttribute("aria-expanded", "true");

      if (listbox.querySelector('[role="option"]')) {
        return;
      }

      const choose = document.createElement("div");
      choose.setAttribute("role", "option");
      choose.setAttribute("aria-selected", "true");
      choose.textContent = "Choose";

      const option2 = document.createElement("div");
      option2.setAttribute("role", "option");
      option2.setAttribute("aria-selected", "false");
      option2.textContent = "Option 2";

      listbox.append(choose, option2);
    });

    listbox.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        listbox.setAttribute("aria-expanded", "false");
      }
    });

    const fillResult = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        all_the_options_0: "Option 2",
      },
    });

    expect(fillResult.filledFieldIds).toEqual([]);
    expect(fillResult.skippedFieldIds).toEqual(["all_the_options_0"]);
    expect(listbox.getAttribute("data-selected")).toBeNull();
    expect(listbox.getAttribute("aria-expanded")).toBe("false");
  });

  it("clears popup listboxes when placeholder selection only commits through keyboard navigation", async () => {
    document.documentElement.innerHTML = keyboardClearListboxHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSkeyboardclear/viewform");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    let activeIndex = 2;

    listbox.addEventListener("click", () => {
      listbox.setAttribute("aria-expanded", "true");
    });

    listbox.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp") {
        activeIndex = Math.max(0, activeIndex - 1);
        listbox.setAttribute("aria-activedescendant", options[activeIndex]!.id);
      }

      if (event.key === "Enter") {
        for (const [index, option] of options.entries()) {
          option.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
        }
        listbox.setAttribute("data-selected", options[activeIndex]!.textContent ?? "");
      }
    });

    const result = await fillFormDocumentAsync(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: null,
      },
    });

    expect(result.filledFieldIds).toEqual([scan.fields[0]!.id]);
    expect(listbox.getAttribute("data-selected")).toBe("Choose");
  });

  it("does not treat a native select placeholder as a real dropdown answer", () => {
    document.documentElement.innerHTML = formHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSplaceholder/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        session: "Choose",
      },
    });

    expect(fillResult.skippedFieldIds).toEqual(["session"]);
    expect((document.querySelector('select[name="session"]') as HTMLSelectElement).value).toBe("");
  });

  it("ignores non-empty native select placeholder labels during scan and fill", () => {
    document.documentElement.innerHTML = selectWithTextPlaceholderHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLStextplaceholder/viewform");

    expect(scan.fields[0]).toMatchObject({
      type: "dropdown",
      options: ["CSE", "EEE"],
    });

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        department: "Choose",
      },
    });

    expect(fillResult.skippedFieldIds).toEqual(["department"]);
    expect((document.querySelector('select[name="department"]') as HTMLSelectElement).value).toBe("placeholder");
  });

  it("does not report success for empty checkbox payloads or clear existing checks", () => {
    document.documentElement.innerHTML = formHtml;
    setInteractiveRoleClicks(document);
    document.querySelectorAll<HTMLElement>('[role="checkbox"]')[0].setAttribute("aria-checked", "true");
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScheckboxempty/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        skills_3: [],
      },
    });

    expect(fillResult.skippedFieldIds).toEqual(["skills_3"]);
    expect(document.querySelectorAll<HTMLElement>('[role="checkbox"]')[0].getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll<HTMLElement>('[role="checkbox"]')[1].getAttribute("aria-checked")).toBe("false");
  });

  it("scans and fills the verified-email consent checkbox", () => {
    document.documentElement.innerHTML = verifiedEmailConsentHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSemail/viewform");

    expect(scan.fields.map((field) => field.label)).toEqual(["Email"]);
    expect(scan.fields[0]).toMatchObject({
      label: "Email",
      type: "checkbox",
      required: true,
      options: ["Record toufiqhasankiron0@gmail.com as the email to be included with my response"],
    });

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0].id]: ["Record toufiqhasankiron0@gmail.com as the email to be included with my response"],
      },
    });

    expect(fillResult.filledFieldIds).toEqual([scan.fields[0].id]);
    expect(document.querySelector<HTMLElement>('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps verified-email consent fields in document order", () => {
    document.documentElement.innerHTML = verifiedEmailBeforeQuestionHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSemailorder/viewform");

    expect(scan.fields.map((field) => field.label)).toEqual(["Email", "Full Name"]);
  });

  it("does not misclassify ordinary email-related checkbox questions as verified-email consent", () => {
    document.documentElement.innerHTML = ordinaryEmailCheckboxQuestionHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSemailcheckbox/viewform");

    expect(scan.fields[0]).toMatchObject({
      label: "Notification preferences",
      type: "checkbox",
      required: false,
      options: ["Record updates in the email summary", "Send immediately"],
    });
  });

  it("scans and fills date and time fields", () => {
    document.documentElement.innerHTML = dateTimeFormHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSdatetime/viewform");

    expect(scan.fields.map((field) => field.type)).toEqual(["date", "time"]);

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        start_date: "2026-04-04",
        start_time: "09:30",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["start_date", "start_time"]);
    expect((document.querySelector('input[name="start_date"]') as HTMLInputElement).value).toBe("2026-04-04");
    expect((document.querySelector('input[name="start_time"]') as HTMLInputElement).value).toBe("09:30");
  });

  it("does not clear date and time inputs when stale payloads use invalid formats", () => {
    document.documentElement.innerHTML = dateTimeFormHtml;
    (document.querySelector('input[name="start_date"]') as HTMLInputElement).value = "2026-04-04";
    (document.querySelector('input[name="start_time"]') as HTMLInputElement).value = "09:30";
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSdatetimeinvalid/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        start_date: "tomorrow",
        start_time: "25:99",
      },
    });

    expect(fillResult.skippedFieldIds).toEqual(["start_date", "start_time"]);
    expect((document.querySelector('input[name="start_date"]') as HTMLInputElement).value).toBe("2026-04-04");
    expect((document.querySelector('input[name="start_time"]') as HTMLInputElement).value).toBe("09:30");
  });

  it("detects and fills composite Google Forms time inputs", () => {
    document.documentElement.innerHTML = compositeTimeFormHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScompositetime/viewform");

    expect(scan.fields).toHaveLength(1);
    expect(scan.fields[0]).toMatchObject({
      label: "Interview time",
      type: "time",
    });

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: "09:30",
      },
    });

    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(fillResult.filledFieldIds).toEqual([scan.fields[0]!.id]);
    expect(inputs[0]!.value).toBe("9");
    expect(inputs[1]!.value).toBe("30");
  });

  it("detects and fills composite Google Forms date inputs", () => {
    document.documentElement.innerHTML = compositeDateFormHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLScompositedate/viewform");

    expect(scan.fields).toHaveLength(1);
    expect(scan.fields[0]).toMatchObject({
      label: "Interview date",
      type: "date",
    });

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: "2026-04-05",
      },
    });

    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(fillResult.filledFieldIds).toEqual([scan.fields[0]!.id]);
    expect(inputs[0]!.value).toBe("4");
    expect(inputs[1]!.value).toBe("5");
    expect(inputs[2]!.value).toBe("2026");
  });

  it("matches duplicate labels using section and help text when ids change", () => {
    document.documentElement.innerHTML = duplicateLabelFormHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSduplicate/viewform");
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="text"]');

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: [
        {
          ...scan.fields[1]!,
          id: "stale_work_email_id",
        },
      ],
      values: {
        stale_work_email_id: "work@example.com",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["stale_work_email_id"]);
    expect(inputs[0]!.value).toBe("");
    expect(inputs[1]!.value).toBe("work@example.com");
  });

  it("matches duplicate labels by ordinal when ids change and no extra metadata exists", () => {
    document.documentElement.innerHTML = duplicateLabelPlainFormHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSduplicateplain/viewform");
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="text"]');

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: [
        {
          ...scan.fields[0]!,
          id: "stale_duplicate_email_home_id",
        },
        {
          ...scan.fields[1]!,
          id: "stale_duplicate_email_id",
        },
      ],
      values: {
        stale_duplicate_email_id: "work@example.com",
      },
    });

    expect(fillResult.filledFieldIds).toEqual(["stale_duplicate_email_id"]);
    expect(inputs[0]!.value).toBe("");
    expect(inputs[1]!.value).toBe("work@example.com");
  });

  it("extracts rows, columns, and mode for grid questions during scan", () => {
    document.documentElement.innerHTML = gridOnlyFormHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSgridonly/viewform");

    expect(scan.fields).toHaveLength(1);
    expect(scan.fields[0]).toMatchObject({
      label: "Availability",
      type: "grid",
      options: ["Morning", "Afternoon"],
      gridRows: ["Monday", "Tuesday"],
      gridMode: "radio",
    });
  });

  it("keeps grid-only scans populated instead of returning an empty result", () => {
    document.documentElement.innerHTML = unsupportedOnlyFormHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSunsupported/viewform");

    expect(scan.fields.map((field) => field.type)).toEqual(["grid", "grid"]);
  });

  it("fills multiple choice grid answers by row", () => {
    document.documentElement.innerHTML = gridOnlyFormHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSgridfill/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: {
          kind: "grid",
          rows: {
            Monday: "Afternoon",
            Tuesday: "Morning",
          },
        },
      },
    });

    const gridRows = Array.from(document.querySelectorAll<HTMLElement>('[role="grid"] [role="row"]')).slice(1);
    expect(fillResult.filledFieldIds).toEqual([scan.fields[0]!.id]);
    expect(gridRows[0]!.querySelectorAll<HTMLElement>('[role="radio"]')[1]!.getAttribute("aria-checked")).toBe("true");
    expect(gridRows[1]!.querySelectorAll<HTMLElement>('[role="radio"]')[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("fills checkbox grid answers by row", () => {
    document.documentElement.innerHTML = checkboxGridHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSgridcheck/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: {
          kind: "grid",
          rows: {
            "Row 1": ["A", "B"],
            "Row 2": ["B"],
          },
        },
      },
    });

    const gridRows = Array.from(document.querySelectorAll<HTMLElement>('[role="grid"] [role="row"]')).slice(1);
    expect(fillResult.filledFieldIds).toEqual([scan.fields[0]!.id]);
    expect(gridRows[0]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[0]!.getAttribute("aria-checked")).toBe("true");
    expect(gridRows[0]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[1]!.getAttribute("aria-checked")).toBe("true");
    expect(gridRows[1]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[0]!.getAttribute("aria-checked")).toBe("false");
    expect(gridRows[1]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("does not clear unspecified checkbox grid rows when filling partial values", () => {
    document.documentElement.innerHTML = checkboxGridHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSpartialgrid/viewform");
    const firstRowKey = scan.fields[0]!.gridRowIds?.[0] ?? scan.fields[0]!.gridRows?.[0] ?? "Row 1";

    const gridRows = Array.from(document.querySelectorAll<HTMLElement>('[role="grid"] [role="row"]')).slice(1);
    gridRows[1]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[0]!.click();
    gridRows[1]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[1]!.click();
    expect(gridRows[1]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[0]!.getAttribute("aria-checked")).toBe("true");
    expect(gridRows[1]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[1]!.getAttribute("aria-checked")).toBe("true");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: {
          kind: "grid",
          rows: {
            [firstRowKey]: ["A"],
          },
        },
      },
    });

    expect(fillResult.filledFieldIds).toEqual([scan.fields[0]!.id]);
    expect(gridRows[0]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[0]!.getAttribute("aria-checked")).toBe("true");
    expect(gridRows[0]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[1]!.getAttribute("aria-checked")).toBe("false");
    expect(gridRows[1]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[0]!.getAttribute("aria-checked")).toBe("true");
    expect(gridRows[1]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("skips malformed grid row values without changing existing selections", () => {
    document.documentElement.innerHTML = checkboxGridHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSmalformedgrid/viewform");

    const gridRows = Array.from(document.querySelectorAll<HTMLElement>('[role="grid"] [role="row"]')).slice(1);
    gridRows[0]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[0]!.click();
    expect(gridRows[0]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[0]!.getAttribute("aria-checked")).toBe("true");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: {
          kind: "grid",
          rows: {
            "Row 1": { nested: true },
          },
        } as never,
      },
    });

    expect(fillResult.filledFieldIds).toEqual([]);
    expect(fillResult.skippedFieldIds).toEqual([scan.fields[0]!.id]);
    expect(gridRows[0]!.querySelectorAll<HTMLElement>('[role="checkbox"]')[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("detects flattened radio grids from accessibility labels", () => {
    document.documentElement.innerHTML = flattenedRadioGridHtml;
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSflattened/viewform");

    expect(scan.fields).toHaveLength(1);
    expect(scan.fields[0]).toMatchObject({
      type: "grid",
      label: "Multiple choice grid",
      options: ["Column 1", "Column 2"],
      gridRows: ["Row 1", "Row 2"],
      gridMode: "radio",
    });
  });

  it("fills flattened radio grids by inferred row groups", () => {
    document.documentElement.innerHTML = flattenedRadioGridHtml;
    setInteractiveRoleClicks(document);
    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSflattenedfill/viewform");

    const fillResult = fillFormDocument(document, {
      formKey: scan.formKey,
      fields: scan.fields,
      values: {
        [scan.fields[0]!.id]: {
          kind: "grid",
          rows: {
            "Row 1": "Column 2",
            "Row 2": "Column 1",
          },
        },
      },
    });

    const radios = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(fillResult.filledFieldIds).toEqual([scan.fields[0]!.id]);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("false");
    expect(radios[1]!.getAttribute("aria-checked")).toBe("true");
    expect(radios[2]!.getAttribute("aria-checked")).toBe("true");
    expect(radios[3]!.getAttribute("aria-checked")).toBe("false");
  });

  it("prefers the visible form header when the document title is polluted by shell text", () => {
    document.documentElement.innerHTML = pollutedTitleFormHtml;

    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSpolluted/viewform");

    expect(scan.title).toBe("Test Party");
    expect(scan.fields).toHaveLength(1);
  });

  it("prefers FB_PUBLIC_LOAD_DATA title when document and visible headers are polluted", () => {
    document.documentElement.innerHTML = publicLoadDataTitleFormHtml;

    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSpublic/viewform");

    expect(scan.title).toBe("Test Party");
    expect(scan.fields).toHaveLength(1);
  });

  it("uses nested FB_PUBLIC_LOAD_DATA title pairs when the direct title slot is empty", () => {
    document.documentElement.innerHTML = publicLoadDataNestedTitleOnlyFormHtml;

    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSnested/viewform");

    expect(scan.title).toBe("Student Registration");
    expect(scan.fields).toHaveLength(1);
  });

  it("rejects title candidates polluted with question labels", () => {
    document.documentElement.innerHTML = fieldPollutedTitleFormHtml;

    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSfieldpolluted/viewform");

    expect(scan.title).toBe("Test Party");
    expect(scan.fields).toHaveLength(2);
  });

  it("does not treat polluted pre-list shell text as a section title", () => {
    document.documentElement.innerHTML = pollutedSectionHeaderHtml;

    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSsectionpolluted/viewform");

    expect(scan.fields).toHaveLength(2);
    expect(scan.fields[0]?.sectionTitle).toBeUndefined();
    expect(scan.fields[1]?.sectionTitle).toBeUndefined();
  });

  it("clears section titles when they only repeat the form title", () => {
    document.documentElement.innerHTML = `
<!doctype html>
<html>
  <head>
    <title>Test Party</title>
  </head>
  <body>
    <div>
      <div role="heading" aria-level="1">Test Party</div>
    </div>
    <div role="list">
      <div role="listitem" class="Qr7Oae">
        <div role="heading">Email *</div>
        <input type="email" name="email" />
      </div>
      <div role="listitem" class="Qr7Oae">
        <div role="heading">Type your date</div>
        <input type="text" name="date" />
      </div>
    </div>
  </body>
</html>
`;

    const scan = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLSsectiontitle/viewform");

    expect(scan.title).toBe("Test Party");
    expect(scan.fields[0]?.sectionTitle).toBeUndefined();
    expect(scan.fields[1]?.sectionTitle).toBeUndefined();
  });

});
