# First round trip to the SAP BTP ABAP trial

| | |
|---|---|
| Release | SAP Business AI Platform, ABAP environment **2611 (HFC 3)** |
| System | TRL Shared Trial US10 - 2026/11 |
| Suffix | `CRG` (package `ZRAPT_CRG` under `ZLOCAL`) |
| Dates | 2026-11-15 and 2026-11-16 |
| Fixture | `fixtures/travel`, variants `draft,trial` (`scripts/btp-roundtrip.mjs`, D84) |
| Open RAP Runtime | from `claude/new-session-jctj10` (`c9c4615`, D84) to `abapgit-btp-format` (`89dc5b8`, D85 and D86, PR #25) |
| Repository for the trial | `travel-BTP` (public GitHub repository), commits `4ab97fd` → `d1598cd` → `93b9952` → `fc24957` |
| Tools | ADT with abapGit for ADT; Node 24.15.0, pnpm 10.28.0; Playwright 1.65.1, Chromium 159 |

Details: `activation.md` (every pull and activation, the exact messages, the analysis),
`recording.md` (the scenarios), `metadata.xml` (the `$metadata` of SAP), `cases/*.json`.

## Summary

The Travel fixture does **not** activate on SAP as it was in D84: four pulls and activations were
needed. Each problem was fixed in Open RAP Runtime (not on the trial), the repository for the
trial was regenerated, and the last pull (`fc24957`) activates **without error**: the 12 objects
of `expected.json` (the 2 draft tables included) are active, the service binding is published, and the
Fiori elements preview works (list, create, edit, draft, actions, value help, side effect,
child).

| Round | `travel-BTP` | Result on SAP | Fix in Open RAP Runtime |
|---|---|---|---|
| 1 | `4ab97fd` | Pull: 20 of 23 objects imported; the 2 DDLX and the SRVB refused | D85 (`000bef9`): abapGit XML of DDLX and SRVB in the format of SAP BTP |
| 2 | `d1598cd` | Pull (log not recorded); activation: BDEF syntax error (`total etag`), then (after a manual fix) 9 errors in the behavior pool | D85 (`b8714e6`): BDEF031, `trial` variant without `sy-subrc` written, no `%assoc` in the authorization types |
| 3 | `93b9952` | Pull and activation OK, 5 warnings; preview opens | – |
| 4 | `fc24957` | Pull and activation OK, 5 warnings; value help and side effect work | D86 (`89dc5b8`): `use side effects`, side effects and value help of the draft variant |

## Activation: exact messages

### Round 1: pull

| Object | Type | Messages |
|---|---|---|
| ZRT_C_BOOKINGCRG | DDLX | `The description is missing for` (truncated in the log); `Import of object ZRT_C_BOOKINGCRG failed` |
| ZRT_C_TRAVELCRG | DDLX | `The description is missing for The description is missing for` (truncated); `Import of object ZRT_C_TRAVELCRG failed` |
| ZRT_UI_TRAVEL_O4CRG | SRVB | `Object description is missing`; `Import of object ZRT_UI_TRAVEL_O4CRG failed` |

Cause: the XML of these types put their fields directly under `<DDLX>` / `<SRVB>`; abapGit of SAP
BTP nests them in `METADATA` (and `CONTENT` for a SRVB, the service definition in `SRVD_REF`).

### Round 2: activation

| Object | Line | Severity | Message |
|---|---|---|---|
| ZRT_R_TRAVELCRG (BDEF) | 11 | error | `"( \| changedocuments \| early \| extensible \| late \| with \| {" was expected, not "total".` |
| ZRT_C_TRAVELCRG (BDEF) | 1 | error | `The behavior definition of the base entity "ZRT_R_TRAVELCRG" contains errors.` |

Fixed by hand on the trial (`lock master total etag LastChangedAt`), then:

| Object | Line | Severity | Message |
|---|---|---|---|
| ZBP_RT_R_TRAVELCRG | 48, 55, 62, 66, 80, 82 | error | `Only reads can be performed on the field "SY-SUBRC" in the current ABAP language version.` |
| ZBP_RT_R_TRAVELCRG | 89 | error | `No component exists with the name "%ASSOC-_BOOKING".` |
| ZBP_RT_R_TRAVELCRG | 54 | error | `The data object "REQUESTED_AUTHORIZATIONS" does not have a component called "%ASSOC-_BOOKING".` |
| ZBP_RT_R_TRAVELCRG | 59 | error | `The data object "RESULT" does not have a component called "%ASSOC-_BOOKING".` |
| ZRT_R_TRAVELCRG (BDEF) | 1 | warning | `Class can't be analyzed during BDEF implementation check. Inconsistencies or errors exist: Only reads can be performed on the field "SY-SUBRC" in the current ABAP language version.` |
| ZRT_R_TRAVELCRG (BDEF) | 76 | warning | `Validation "validateMandatory" is not assigned to any determine action (not even "Prepare").` |

### Rounds 3 and 4: warnings that remain

| Object | Location | Message |
|---|---|---|
| ZRT_C_TRAVELCRG (DCLS) | line 5 | `Conditions defined by full access rule in role ZRT_R_TRAVELCRG (position 1)` (round 3: `Inheriting from entity ZRT_R_TRAVELCRG does not yield any access conditions`) |
| – (`TRL_EN`) | Unknown | `Primary key should have type INVERTED INDIVIDUAL on the database` |
| ZBP_RT_R_TRAVELCRG | lines 150, 182 | `The secondary key "ENTITY" is completely covered. However, "ENTITY" is not used in the statement.` |
| ZRT_C_BOOKINGCRG (DDLS) | line 1 | `Value of AccessControl annotation in view ZRT_C_BOOKINGCRG different in base view ZRT_R_BOOKINGCRG` |

## Differences with `expected.json` and the open points of KNOWN_GAPS

- **`expected.json`** ("every object activates without error"): not true for the repository of
  D84 (rounds 1 and 2); true from `93b9952` on. The 12 renamed objects and the service path
  `/sap/opu/odata4/sap/zrt_ui_travel_o4crg/srvd/sap/zrt_ui_travelcrg/0001/` are those of SAP.
- **Draft tables** written by `rapt abapgit` (`ZRT_D_TRAVELCRG`, `ZRT_D_BOOKINGCRG`): imported and
  activated without a message naming them. Not compared field by field with the tables ADT
  generates. The `INVERTED INDIVIDUAL` warning names no object and may concern one of them.
- **`sy-subrc = 0.`** of the `trial` variant: refused (6 errors). Since D85 each `AUTHORITY-CHECK`
  and the `COND` after it become `if_abap_behv=>auth-allowed`.
- **Authorizations**: the authorization object `ZAO_TRAVL` (and its undefined field `ZAGENCY`)
  stays left out by the `trial` variant; its activation on SAP is not tested. The access controls
  reduced to `grant select` give the full access warnings above. Besides the trial: SAP has no
  `%assoc` in the authorization types of this BDEF (the creation of bookings is authorized as an
  update of the travel), which Open RAP Runtime allowed; fixed in D85 (D36 annotated).
- **Not in KNOWN_GAPS before this round trip, found on SAP**:
  - the abapGit XML of DDLX and SRVB (D85);
  - `total etag` accepted by Open RAP Runtime outside `lock master` (BDEF031, D85);
  - `use side effects;` ignored by Open RAP Runtime, which exposed the side effects of the base
    in every projection (D86);
  - the `AccessControl` annotation of `ZRT_C_BOOKING` (`#CHECK`) different from its base
    `ZRT_R_BOOKING` (`#NOT_REQUIRED`): in the fixture itself, not fixed;
  - the secondary key `entity` not used by two `READ TABLE`: a performance hint, not fixed.

## `$metadata` of SAP compared with Open RAP Runtime (first look)

`metadata.xml` (after D86): namespace `com.sap.gateway.srvd.zrt_ui_travelcrg.v0001`, entity sets
`Travel`, `Booking`, `I_DraftAdministrativeData`, actions `acceptTravel`, `copyTravel`,
`deductDiscount`, `Edit`, `Activate`, `Discard`, `Prepare`, `Resume`.

- Annotation aliases `SAP__common`, `SAP__UI`, …
- Side effects qualified `SAP__Field_BookingFee`, `SAP__Field_CurrencyCode` (Open RAP Runtime:
  `BookingFee`, `CurrencyCode2`).
- **Value help**: SAP writes `SAP__common.ValueListReferences` to a separate value help service
  (`srvd_f4/sap/i_currency/0001…`) and exposes no `I_Currency` entity set; Open RAP Runtime
  exposes the value help entity in the service with an inline `Common.ValueList` (D44). Also a
  value help on `I_DraftAdministrativeData/CreatedByUser`.

The full comparison is left to D99 (b).

## Scenarios of Fiori elements

`fe-record-trial.mjs --release 2611 --out ../trial-results/cases`; first attempt: no file (the
session was not saved, see `recording.md`); then, after D86:

| Scenario | Steps | Run |
|---|---|---|
| create | 15 | as described |
| list-report | 6 | as described |
| edit | 7 | as described |
| validation-error | 16 | as described |
| discard | 8 | as described |
| action | 9 | **draft part only** (see below) |
| value-help | 12 | as described, value help of Currency; the requests of the value help service are not in the case |
| side-effects | 12 | as described: Total Price updated when Booking Fee is left |
| child | 18 | as described |

- Before D86, the scenarios `value-help` (no value help in the fixture) and `side-effects` (Total
  Price updated on Save only) could not be played.
- `action`: on the active travel the action is saved at once (expected in RAP); the draft part
  was not possible on the same travel (`acceptTravel` disabled once accepted). The scenario was
  recorded again on a second travel: the file has the draft part only (Edit, `acceptTravel` on
  the draft, Discard); the action on the active travel (`POST …IsActiveEntity=true)/…acceptTravel`
  → 200) is described in `recording.md` only. The instructions of the scenario do not say that
  the draft part needs another travel (not changed).
- Warnings of the script: `N requests outside the service … left out` (2 to 5 per scenario) and
  `the request bodies are kept as recorded …`; no unresolved key (`{{k1}}` … are captured from
  responses).
- Review: no host name, cookie, token or user name in `cases/*.json`; responses kept as their
  structure only; request bodies hold test data only. Every URL carries `sap-client=100`.

## Other findings (environment)

- `scripts/btp-roundtrip.mjs` fails on a Windows working copy with CRLF line endings
  (`variant draft: text not found in zrt_r_travel.bdef.asbdef …`): the files were checked out
  again in LF; not fixed in the repository.
- A suffix of 4 characters truncates `ZRT_D_BOOKING` (16 characters for a table); 3 characters at
  most keep every name.
- Tests on Windows (unrelated to these changes): `rapt.test.ts` "resolves the CLI" (`/repo` →
  `C:\repo`), `e2e.test.ts` (`spawnSync npm ENOENT`), `dev.test.ts` flaky (file watching).

## Files produced

| File | Content |
|---|---|
| `REPORT.md` | this report |
| `activation.md` | the pulls and activations, exact messages, analysis, manual fix on the trial |
| `recording.md` | the recording of the scenarios, observations, warnings, review of the cases |
| `metadata.xml` | the `$metadata` of `ZRT_UI_TRAVEL_O4CRG` on the trial (after D86) |
| `cases/trial-*-har.json` | 9 case files: create, list-report, edit, validation-error, discard, action, value-help, side-effects, child |
| `notes.md` | working notes (environment, findings), folded into this report |

Kept outside these files: the full URL of the preview (`../trial-local/preview-url.txt`) and the
signed-in session of the browser (`~/.rapt/btp-trial-state.json`, to delete).
