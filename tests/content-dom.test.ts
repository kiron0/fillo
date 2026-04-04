import { fillFormDocument, scanFormDocument } from "../src/features/content/form-dom";

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

  it("extracts radio option labels from nested text and aria metadata", () => {
    document.documentElement.innerHTML = nestedChoiceHtml;
    const result = scanFormDocument(document, "https://docs.google.com/forms/d/e/1FAIpQLS456/viewform");

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      type: "radio",
      options: ["Option A", "Option B"],
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
});
