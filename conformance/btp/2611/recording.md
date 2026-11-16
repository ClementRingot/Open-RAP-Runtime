# Recording of the Fiori elements scenarios on the SAP BTP trial

- System: SAP Business AI Platform, ABAP environment 2611 (HFC 3), TRL Shared Trial US10 - 2026/11
- Service: `ZRT_UI_TRAVEL_O4CRG` (OData V4 - UI), Fiori elements preview of `Travel`
- Repository for the trial: `travel-BTP` commit `93b9952` (Open RAP Runtime PR #25, D85)
- Script: `node scripts/fe-record-trial.mjs --url <preview URL> --release 2611 --out ../trial-results/cases --scenarios create,list-report,edit,validation-error,discard,action,value-help,side-effects,child`
  (Playwright 1.65.1, Chromium 159, through `PLAYWRIGHT_MODULE`)

## First attempt

- The command pasted on several lines in PowerShell failed before running
  (`Argument manquant dans la liste de paramètres.`); run again with the arguments in variables.
- After the second run, no case file was written in `cases/` and no browser session was saved
  (`~/.rapt/btp-trial-state.json`): to be clarified with the output of the terminal.

## Observations of the user in the preview

| Scenario | Observation |
|---|---|
| value-help | No field of the object page has a value help (Agency included): the step "Open the value help of Agency" cannot be played. |
| side-effects | Total Price is not recomputed when Booking Fee is changed and the field is left (Enter); it is updated only on Save. |

### Analysis

Both follow from the sources of the fixture, not from a difference of SAP:

- **Value help**: neither `fixtures/travel/src/zrt_c_travel.ddls.asddls` nor the metadata
  extensions have a `@Consumption.valueHelpDefinition`; SAP shows no value help, as expected.
  The scenario `value-help` needs a variant of the fixture with a value help on `AgencyID`.
- **Side effects**: the BDEF has `determination calculateTotalPrice on modify { create; field
  BookingFee, CurrencyCode; }` but no `side effects { field BookingFee affects field TotalPrice; }`.
  The determination runs on the PATCH of the draft, but Fiori elements does not read
  `TotalPrice` again until the save. The scenario `side-effects` needs a variant with
  `side effects`. (Open RAP Runtime: `Common.SideEffects` is in its `$metadata`, its generated UI
  does not use it yet, `docs/FEATURES.md`.)

### Fix in Open RAP Runtime (D86, commit `89dc5b8`, PR #25)

- The `draft` variant adds `side effects { field BookingFee affects field TotalPrice; field
  CurrencyCode affects field TotalPrice; }`, `use side effects;` in the projection BDEF, and a
  value help on `CurrencyCode` (`I_Currency`).
- Open RAP Runtime now reads `use side effects;`: without it a projection exposes no side effect,
  as on SAP (it used to expose those of the base in every case).
- The scenario `value-help` opens the value help of Currency (no agency entity in the fixture).
- Repository for the trial regenerated and pushed: `travel-BTP` commit `fc24957` (only
  `zrt_r_travelcrg.bdef`, `zrt_c_travelcrg.bdef` and `zrt_c_travelcrg.ddls` changed).

## Second run (after D86)

Command (PowerShell, from the repository of Open RAP Runtime):

```
$env:PLAYWRIGHT_MODULE = "<folder>\rapt-playwright\node_modules\playwright"
node scripts/fe-record-trial.mjs --url <preview URL> --release 2611 --out ..\trial-results\cases --scenarios create,list-report,edit,validation-error,discard,action,value-help,side-effects,child
```

| # | Scenario | Case file | Steps | Run |
|---|---|---|---|---|
| 1 | create | `trial-create-har.json` | 15 | as described |
| 2 | list-report | `trial-list-report-har.json` | 6 | as described |
| 3 | edit | `trial-edit-har.json` | 7 | as described |
| 4 | validation-error | `trial-validation-error-har.json` | 16 | as described |
| 5 | discard | `trial-discard-har.json` | 8 | as described |
| 6 | action | `trial-action-har.json` | 9 | recorded again: draft part only, see below |
| 7 | value-help | `trial-value-help-har.json` | 12 | as described (value help of Currency) |
| 8 | side-effects | `trial-side-effects-har.json` | 12 | as described: Total Price updated when Booking Fee is left |
| 9 | child | `trial-child-har.json` | 18 | as described |

Output of the script: after `Sign in to SAP BTP in the browser window, wait for the preview, then
press Enter:`, each scenario printed its case file and its step count, and these warnings:

| Scenario | Warnings |
|---|---|
| create | `5 requests outside the service (UI resources, other services) left out`; `the request bodies are kept as recorded: review them before adding the file to the repository` |
| list-report | `2 requests outside the service (UI resources, other services) left out` |
| edit | `2 requests outside the service …`; `the request bodies are kept as recorded …` |
| validation-error | `4 requests outside the service …`; `the request bodies are kept as recorded …` |
| discard | `2 requests outside the service …`; `the request bodies are kept as recorded …` |
| action | `2 requests outside the service …`; `the request bodies are kept as recorded …` |
| value-help | `4 requests outside the service …`; `the request bodies are kept as recorded …` |
| side-effects | `2 requests outside the service …`; `the request bodies are kept as recorded …` |
| child | `2 requests outside the service …`; `the request bodies are kept as recorded …` |

No warning `{{keyN}}: a key of an instance of the SAP system …`: every key of the trial was first
seen in a response and is captured from it (`{{k1}}` …), so no `--map` is needed. `trial-value-help-har.json` has no request of the value help: only Edit, the reads of the draft, the
`PATCH` of `CurrencyCode` (`AUD`) and Discard. On SAP the value help is a separate OData service
(`SAP__common.ValueListReferences` → `srvd_f4/sap/i_currency/0001…`, see `metadata.xml`), and
`scripts/lib/fe-har.mjs` keeps the requests of one service root only: its requests are among the
"requests outside the service" (4 in this scenario). The other left-out requests are probably those
of the common service of SAP Gateway (`iwbep/common`). Recording the value help would need the
converter to keep a second service.

### Scenario `action`

- Recorded: `POST Travel(TravelUUID={{k1}},IsActiveEntity=true)/{{NS}}.acceptTravel` on the
  active travel (200), then the travel and its bookings read again. No `Edit` was recorded.
- Observation of the user: the action saves at once, so the draft could not be discarded after
  it.
- Analysis: on an **active** instance an action of a draft BO changes the active data at once (no
  draft is involved): this is the expected behavior of RAP, not a draft action. The second part
  of the scenario (Edit, Accept Travel in the draft, Discard Draft) was not possible on the same
  travel: the fixture disables `acceptTravel` once the travel is accepted (instance feature
  control, `OverallStatus = 'A'` → `fc-o-disabled`). The scenario needs a second travel that is
  not accepted for its draft part.
- **Recorded again** (`--scenarios action`, 9 steps): on a second travel not accepted yet, Edit
  (`POST …IsActiveEntity=true)/{{NS}}.Edit` `{"PreserveChanges":true}` → 201), the sibling read,
  `POST …IsActiveEntity=false)/{{NS}}.acceptTravel` on the draft (→ 200), the draft read again,
  `POST …IsActiveEntity=false)/{{NS}}.Discard` (→ 204), the active travel read again. No warning
  other than those of the other scenarios. The file replaced the first recording: the action on
  the **active** travel (`POST …IsActiveEntity=true)/{{NS}}.acceptTravel` → 200) is described above
  but no longer in `cases/`.

## Review of the case files

- No host name, URL of the trial, cookie, CSRF token or session id in `cases/*.json`.
- The responses are kept as their structure only (status, property names, annotations): no value,
  so no user name of the trial (`InProcessByUser`, `CreatedBy` …).
- Request bodies: test data only (`TravelID` `00000002`/`00000003`, `AgencyID`/`CustomerID`
  `000001`, dates in November 2026, `BookingFee` 10/100, `CurrencyCode` `EUR`/`AUD`,
  `Description` `test`/`test2`, a booking `0001` / carrier `1` / connection `0001`), the bodies of
  the draft actions (`{"PreserveChanges":true}`, `{}`).
- Every URL carries `sap-client=100` (112 occurrences): the client of the trial, to drop or
  ignore when the cases are replayed against Open RAP Runtime.
- The instance keys of the trial are placeholders `{{k1}}`, `{{k2}}`, `{{k3}}`, `{{k5}}` (`--map <guid>=T1` was not
  used); the namespace is `{{NS}}`.
