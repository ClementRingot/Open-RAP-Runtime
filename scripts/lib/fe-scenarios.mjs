// The scenarios recorded on the SAP BTP trial (D83): what the user does in the Fiori elements
// preview of the draft fixture, one HAR each. The cases written by scripts/fe-har-to-cases.mjs
// carry the id of the scenario. The instructions name what is on the screen, nothing else.

/**
 * `observe`: the values a recording keeps (`observed` of the case files, read by people): what the
 * trial must settle (D99, round 2). `variants`: the variants of fixtures/variants.json the
 * scenario needs on the trial, beyond draft and trial.
 * @type {Array<{ id: string; floorplan: string; title: string; steps: string[]; observe?: string[]; variants?: string[] }>}
 */
export const SCENARIOS = [
  {
    id: "list-report",
    floorplan: "listReport",
    title: "List Report: the list, its Editing Status filter, its count",
    steps: ["Wait for the list of travels.", "Set the filter Editing Status to All, then Own Draft, then Unchanged, then Locked by Another User; press Go each time."],
    // the value of DraftEntityType (D87)
    observe: ["DraftAdministrativeData"],
  },
  {
    id: "create",
    floorplan: "objectPage",
    title: "Create a travel in a draft and save it",
    steps: ["Press Create.", "Fill Agency, Customer, Begin Date, End Date, Booking Fee and Currency.", "Press Create (save) and wait for the saved travel."],
    // the advertised actions of a new draft and the controls (D89), the administrative data (D87)
    observe: ["#*", "__OperationControl", "__CreateByAssociationControl", "DraftAdministrativeData", "DraftEntityCreationDateTime"],
  },
  {
    id: "edit",
    floorplan: "objectPage",
    title: "Edit an existing travel and save it",
    steps: ["Open a travel of the list.", "Press Edit, change the Description, press Save."],
  },
  {
    id: "validation-error",
    floorplan: "objectPage",
    title: "A validation refuses the activation, then the draft is corrected",
    steps: ["Press Create, fill Agency and Customer only.", "Press Create (save): the message about the dates appears.", "Fill Begin Date and End Date, press Create (save) again."],
  },
  {
    id: "discard",
    floorplan: "objectPage",
    title: "Discard a draft",
    steps: ["Open a travel, press Edit, change the Description.", "Press Discard Draft and confirm."],
  },
  {
    id: "action",
    floorplan: "objectPage",
    title: "Run an action on an active travel and on a draft",
    steps: ["Open a travel, press Accept Travel.", "Press Edit, press Accept Travel in the draft, then Discard Draft."],
    // an action disabled by feature control: advertised or not (D89)
    observe: ["#*", "__OperationControl"],
  },
  {
    id: "strict-handling",
    floorplan: "objectPage",
    title: "Strict handling: an action that reports a warning",
    steps: [
      "Open a travel whose status is Open (not Accepted), press Accept Travel.",
      "If a dialog asks for a confirmation, note its exact text, then press the button that goes on (Confirm, Accept…).",
      "Wait for the status Accepted.",
    ],
    // 412 Precondition Failed, its message, then the request again without handling=strict (D88)
    observe: ["error", "sap-messages", "OverallStatus"],
    variants: ["strict"],
  },
  {
    id: "value-help",
    floorplan: "objectPage",
    title: "A value help",
    steps: ["Open a travel, press Edit.", "Open the value help of Currency, choose a currency.", "Press Discard Draft and confirm."],
  },
  {
    id: "side-effects",
    floorplan: "objectPage",
    title: "Side effects: a field recomputed while editing",
    steps: ["Open a travel, press Edit.", "Change Booking Fee, leave the field, wait for Total Price.", "Press Discard Draft and confirm."],
  },
  {
    id: "child",
    floorplan: "objectPage",
    title: "A child in a draft: create a booking, open it",
    steps: ["Open a travel, press Edit.", "In Bookings, press Create, fill the booking, go back to the travel.", "Open the booking, go back, press Discard Draft and confirm."],
  },
];

/** The scenarios named in a comma-separated list (all when empty); throws on an unknown name. */
export function scenariosOf(list) {
  if (list === undefined || list.trim() === "") {
    return SCENARIOS;
  }
  return list.split(",").map((name) => {
    const scenario = SCENARIOS.find((s) => s.id === name.trim());
    if (scenario === undefined) {
      throw new Error(`unknown scenario ${name.trim()}: ${SCENARIOS.map((s) => s.id).join(", ")}`);
    }
    return scenario;
  });
}
