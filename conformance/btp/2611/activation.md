# Activation on the SAP BTP ABAP trial

- System: SAP Business AI Platform, ABAP environment 2611 (HFC 3), TRL Shared Trial US10 - 2026/11
- Suffix `CRG`, package `ZRAPT_CRG` (under `ZLOCAL`), repository commit `4ab97fd`
- Tool: abapGit for ADT (*Link*, then *Pull* on its own)

## 1. Pull

Log message: `Pulled with errors`

| Object | Type | Flag | Exact message |
|---|---|---|---|
| ZRT_C_TRAVELCRG | BDEF | S | `Object ZRT_C_TRAVELCRG imported` |
| ZRT_R_TRAVELCRG | BDEF | S | `Object ZRT_R_TRAVELCRG imported` |
| ZBP_RT_R_TRAVELCRG | CLAS | S | `Object ZBP_RT_R_TRAVELCRG imported` |
| ZRT_C_BOOKINGCRG | DCLS | S | `Object ZRT_C_BOOKINGCRG imported` |
| ZRT_C_TRAVELCRG | DCLS | S | `Object ZRT_C_TRAVELCRG imported` |
| ZRT_R_TRAVELCRG | DCLS | S | `Object ZRT_R_TRAVELCRG imported` |
| ZRT_A_DISCOUNTCRG | DDLS | S | `Object ZRT_A_DISCOUNTCRG imported` |
| ZRT_C_BOOKINGCRG | DDLS | S | `Object ZRT_C_BOOKINGCRG imported` |
| ZRT_C_TRAVELCRG | DDLS | S | `Object ZRT_C_TRAVELCRG imported` |
| ZRT_R_BOOKINGCRG | DDLS | S | `Object ZRT_R_BOOKINGCRG imported` |
| ZRT_R_TRAVELCRG | DDLS | S | `Object ZRT_R_TRAVELCRG imported` |
| ZRT_C_BOOKINGCRG | DDLX | E | `The description is missing for` (truncated in the log) |
| ZRT_C_BOOKINGCRG | DDLX | E | `Import of object ZRT_C_BOOKINGCRG failed` |
| ZRT_C_TRAVELCRG | DDLX | E | `The description is missing for The description is missing for` (truncated in the log) |
| ZRT_C_TRAVELCRG | DDLX | E | `Import of object ZRT_C_TRAVELCRG failed` |
| ZRAPT_CRG | DEVC | S | `Object ZRAPT_CRG  not imported; no import requested` |
| ZRT_TRAVELCRG | MSAG | S | `Object ZRT_TRAVELCRG imported` |
| ZRT_UI_TRAVEL_O4CRG | SRVB | E | `Object description is missing` |
| ZRT_UI_TRAVEL_O4CRG | SRVB | E | `Import of object ZRT_UI_TRAVEL_O4CRG failed` |
| ZRT_UI_TRAVELCRG | SRVD | S | `Object ZRT_UI_TRAVELCRG imported` |
| ZRT_BOOKINGCRG | TABL | S | `Object ZRT_BOOKINGCRG imported` |
| ZRT_D_BOOKINGCRG | TABL | S | `Object ZRT_D_BOOKINGCRG imported` |
| ZRT_D_TRAVELCRG | TABL | S | `Object ZRT_D_TRAVELCRG imported` |
| ZRT_TRAVELCRG | TABL | S | `Object ZRT_TRAVELCRG imported` |

20 of 23 objects imported; 3 not imported: the 2 DDLX and the SRVB.

### Cause of the 3 failed imports (analysis)

The `.ddlx.xml` and `.srvb.xml` files of the repository use a flat structure (the fields directly
under `<DDLX>` / `<SRVB>`). The files that the abapGit of SAP BTP writes for these types, for
example in `SAP-samples/abap-platform-rap-workshops`
(`src/zrap100_000/zrap100_c_traveltp_000.ddlx.xml`, `zrap100_ui_traveltp_o4_000.srvb.xml`),
nest them:

- DDLX: `<DDLX><METADATA><NAME/><DESCRIPTION/><MASTER_LANGUAGE>EN</MASTER_LANGUAGE></METADATA></DDLX>`
- SRVB: `<SRVB><METADATA>` (`NAME`, `TYPE` `SRVB/SVB`, `DESCRIPTION`, `MASTER_LANGUAGE`, …)
  `</METADATA><CONTENT>` (`BIND_TYPE` `ODATA`, `BIND_TYPE_VERSION` `V4`, `SERVICES/item`:
  `SERVICE_NAME`, `SERVICE_CONTENT/item`: `SERVICE_VERSION`, `RELEASE_STATE`, `SRVD_REF`
  (`URI`, `TYPE` `SRVD/SRV`, `NAME`)) `</CONTENT></SRVB>`

The importer finds no `METADATA/DESCRIPTION`, hence `description is missing`. The flat structure
of BDEF and SRVD matches the samples, and these objects imported.

Same files in the repository of Open RAP Runtime: `fixtures/travel/src/zrt_c_travel.ddlx.xml`,
`zrt_c_booking.ddlx.xml`, `zrt_ui_travel_o4.srvb.xml` (copied and renamed by
`rapt abapgit --suffix`). Not changed for the trial. The same flat structure is in
`fixtures/table-entity/src/zrt_c_order.ddlx.xml`, `zrt_ui_order_o4.srvb.xml` and
`fixtures/custom-entity/src/zui_product_o4.srvb.xml`.

### Fix in Open RAP Runtime (D85, commit `000bef9`, branch `abapgit-btp-format`)

On request, the generation was fixed in the repository of Open RAP Runtime rather than on the trial:

- `ddlxXml` / `srvbXml` (`packages/compiler/src/authoring/abapgit.ts`) write the format of SAP BTP,
  for `rapt abapgit`, `rapt new` and `rapt generate … binding`; `readSrvbXml` and the VS Code
  extension read both formats.
- The 3 DDLX and 3 SRVB of `fixtures/` are rewritten in this format.
- `rapt abapgit --suffix` now renames a name inside a path (the `URI` of `SRVD_REF`), not a name
  after a namespace.
- The repository for the trial was regenerated (only the 2 DDLX and the SRVB changed) and pushed:
  commit `d1598cd`.

## 2. Second pull (commit `d1598cd`)

The pull was done and the activation followed. The log of this pull was not recorded (to be
completed: were the 2 DDLX and the SRVB imported?).

## 3. Activation

### 3a. First activation (sources as pulled)

| Object | Type | Location | Severity | Exact message |
|---|---|---|---|---|
| ZRT_R_TRAVELCRG | BDEF | line 11 | error | `"( \| changedocuments \| early \| extensible \| late \| with \| {" was expected, not "total".` |
| ZRT_C_TRAVELCRG | BDEF | line 1 | error | `The behavior definition of the base entity "ZRT_R_TRAVELCRG" contains errors.` |

Lines 8-11 of `zrt_r_travelcrg.bdef.asbdef` (from the `draft` variant of `fixtures/variants.json`):

```
lock master
authorization master ( global, instance )
etag master LocalLastChangedAt
total etag LastChangedAt
```

Cause: in BDL, `total etag` is an addition of `lock master` (`lock master total etag Field`), not
an entity characteristic of its own. The BDEF parser of Open RAP Runtime accepts it anywhere
among the characteristics (`packages/compiler/src/bdef/parser.ts`, `kind: "totalEtag"`).

### 3b. Activation after the manual fix of the BDEF

Errors:

| Object | Type | Location | Exact message |
|---|---|---|---|
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 89 | `No component exists with the name "%ASSOC-_BOOKING".` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 48 | `Only reads can be performed on the field "SY-SUBRC" in the current ABAP language version.` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 55 | `Only reads can be performed on the field "SY-SUBRC" in the current ABAP language version.` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 62 | `Only reads can be performed on the field "SY-SUBRC" in the current ABAP language version.` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 66 | `Only reads can be performed on the field "SY-SUBRC" in the current ABAP language version.` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 80 | `Only reads can be performed on the field "SY-SUBRC" in the current ABAP language version.` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 82 | `Only reads can be performed on the field "SY-SUBRC" in the current ABAP language version.` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 54 | `The data object "REQUESTED_AUTHORIZATIONS" does not have a component called "%ASSOC-_BOOKING".` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 59 | `The data object "RESULT" does not have a component called "%ASSOC-_BOOKING".` |

Warnings:

| Object | Type | Location | Kind | Exact message |
|---|---|---|---|---|
| ZRT_R_TRAVELCRG | BDEF | line 1 | ABAP Syntax Check Problem | `Class can't be analyzed during BDEF implementation check. Inconsistencies or errors exist: Only reads can be performed on the field "SY-SUBRC" in the current ABAP language version.` |
| ZRT_C_TRAVELCRG | DCLS | line 5 | ABAP Syntax Check Problem | `Conditions defined by full access rule in role ZRT_R_TRAVELCRG (position 1)` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 152 | ABAP Activation Problem | `The secondary key "ENTITY" is completely covered. However, "ENTITY" is not used in the statement.` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 184 | ABAP Activation Problem | `The secondary key "ENTITY" is completely covered. However, "ENTITY" is not used in the statement.` |
| ZRT_R_TRAVELCRG | BDEF | line 76 | ABAP Syntax Check Problem | `Validation "validateMandatory" is not assigned to any determine action (not even "Prepare").` |

Objects still inactive: not recorded yet (at least `ZBP_RT_R_TRAVELCRG`).

### Analysis

1. **`sy-subrc = 0.` (`trial` variant, lines 48, 55, 62, 66, 80, 82)**: ABAP for Cloud
   Development forbids writing to `sy-subrc`. The open point of KNOWN_GAPS ("The `trial` variant
   replaces each `AUTHORITY-CHECK` by `sy-subrc = 0.`") is confirmed as an error: the `trial`
   variant must not depend on `sy-subrc` at all (for example, replace each
   `COND #( WHEN sy-subrc = 0 THEN … ELSE … )` by `if_abap_behv=>auth-allowed`).
2. **`%assoc-_Booking` in the authorization types (lines 54, 59, 89)**: the fixture checks and
   returns the authorization of the create-by-association `_Booking` in `get_global_authorizations`
   (`requested_authorizations-%assoc-_Booking`, `result-%assoc-_Booking`) and
   `get_instance_authorizations` (`%assoc-_Booking`). SAP 2611 has no such component in these BDEF
   derived types for this BDEF (`association _Booking { create; with draft; }`): its
   authorization follows `%update` of the travel (ABAP keyword documentation, *RAP -
   Authorization*: create-by-association is checked with the update authorization unless
   separate authorizations are specified). Open RAP Runtime accepts the component: a gap of its
   derived types, independent of the trial.
3. **`total etag` (line 11)**: see 3a; a gap of the BDEF parser of Open RAP Runtime, and of the
   `draft` variant.
4. **Warnings**: `validateMandatory` is not in `draft determine action Prepare`; the secondary key
   `entity` is not used by `READ TABLE … WITH KEY TravelUUID = …` (lines 152, 184); the full
   access rule warning comes from the `trial` variant (`inheriting conditions` from a role that
   grants everything).

### Fix in Open RAP Runtime (D85, commit `b8714e6`, PR #25)

- BDEF031 for `total etag` outside `lock master`; the `draft` variant writes
  `lock master total etag LastChangedAt` (same as the manual fix below).
- The `trial` variant no longer writes `sy-subrc`: each `AUTHORITY-CHECK` and its `COND` become
  `if_abap_behv=>auth-allowed`.
- No `%assoc` in the authorization types of Open RAP Runtime; a creation by association is
  authorized as an update; the behavior pool of the fixture no longer names `%assoc-_Booking`.
- `Prepare` of the `draft` variant also runs `Booking~validateMandatory`.
- Repository for the trial regenerated and pushed: commit `93b9952` (only the BDEF
  `zrt_r_travelcrg` and the behavior pool changed).

## 4. Third pull and activation (commit `93b9952`)

Pull and activation: no error; every object of `ZRAPT_CRG` is active (as reported by the user).
The service binding `ZRT_UI_TRAVEL_O4CRG` was published and the Fiori elements preview of the
root entity opens; the list of travels shows an empty table (no data on SAP).

Remaining warnings:

| Object | Type | Location | Kind | Exact message |
|---|---|---|---|---|
| ZRT_C_TRAVELCRG | DCLS | line 5 | ABAP Activation Problem | `Inheriting from entity ZRT_R_TRAVELCRG does not yield any access conditions` |
| (none given: `TRL_EN`) | – | Unknown | ABAP Activation Problem | `Primary key should have type INVERTED INDIVIDUAL on the database` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 150 | ABAP Activation Problem | `The secondary key "ENTITY" is completely covered. However, "ENTITY" is not used in the statement.` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 182 | ABAP Activation Problem | `The secondary key "ENTITY" is completely covered. However, "ENTITY" is not used in the statement.` |
| ZRT_C_BOOKINGCRG | DDLS | line 1 | ABAP Activation Problem | `Value of AccessControl annotation in view ZRT_C_BOOKINGCRG different in base view ZRT_R_BOOKINGCRG` |

Analysis:

- The `Validation "validateMandatory" …` warning is gone (Prepare of D85).
- `Inheriting … does not yield any access conditions`: consequence of the `trial` variant (the
  role of `ZRT_R_TRAVELCRG` grants everything); the earlier `Conditions defined by full access
  rule …` warning is no longer listed.
- `AccessControl` annotation: `ZRT_C_BOOKINGCRG` is `#CHECK` (it has its own access control),
  `ZRT_R_BOOKINGCRG` is `#NOT_REQUIRED` (none). In the fixture itself, not only in the trial.
- Secondary key `ENTITY`: `READ TABLE travels INTO DATA(travel) WITH KEY TravelUUID = …`
  (lines 150 and 182) on a result table of SAP that has a secondary key `entity`; a performance
  hint (`WITH KEY entity COMPONENTS …`), not a difference of behavior.
- `INVERTED INDIVIDUAL`: no object named; a database hint of SAP HANA for one of the tables,
  probably a draft table written by `rapt abapgit` (to check in the table settings in ADT).

## Preview

- URL (host replaced): `https://<trial-host>/sap/bc/adt/businessservices/odatav4/feap/<encoded service>/flp.html?sap-ui-xx-viewCache=false&sap-ui-language=EN&sap-client=100#app-preview`
- The full URL is kept outside the files meant for the repository.

## Manual fixes on the trial

1. `ZRT_R_TRAVELCRG` (BDEF), lines 8-11: `total etag LastChangedAt` moved after `lock master`:

   ```
   define behavior for ZRT_R_Travelcrg alias Travel
   persistent table zrt_travelcrg
   draft table zrt_d_travelcrg
   lock master total etag LastChangedAt
   authorization master ( global, instance )
   etag master LocalLastChangedAt
   ```

   After this fix the BDEF error is gone; the errors and warnings of 3b remain.

## 5. Fourth pull and activation (commit `fc24957`, D86)

Pull and activation: no error (as reported by the user). In the preview, a travel was created;
the value help of Currency and the side effect on Booking Fee (Total Price updated when the field
is left) work.

Remaining warnings:

| Object | Type | Location | Kind | Exact message |
|---|---|---|---|---|
| ZRT_C_TRAVELCRG | DCLS | line 5 | ABAP Syntax Check Problem | `Conditions defined by full access rule in role ZRT_R_TRAVELCRG (position 1)` |
| (none given: `TRL_EN`) | – | Unknown | ABAP Activation Problem | `Primary key should have type INVERTED INDIVIDUAL on the database` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 150 | ABAP Syntax Check Problem | `The secondary key "ENTITY" is completely covered. However, "ENTITY" is not used in the statement.` |
| ZBP_RT_R_TRAVELCRG | CLAS (Local Types) | line 182 | ABAP Syntax Check Problem | `The secondary key "ENTITY" is completely covered. However, "ENTITY" is not used in the statement.` |
| ZRT_C_BOOKINGCRG | DDLS | line 1 | ABAP Syntax Check Problem | `Value of AccessControl annotation in view ZRT_C_BOOKINGCRG different in base view ZRT_R_BOOKINGCRG` |

Same warnings as in section 4 (analysis there); the access control warning is again
`Conditions defined by full access rule …` instead of `Inheriting from entity … does not yield any
access conditions`.
