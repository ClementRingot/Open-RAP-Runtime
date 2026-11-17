# Round 2 on the SAP BTP trial (D99)

What the next session on the trial must settle, and how. Each answer goes back into the repository
(`observed` of the case files, `fixtures/negative/cases.json`, `metadata*.xml`) and decides a fix of
Open RAP Runtime, which then follows SAP (AGENTS.md, rule 1).

| Question | Today in Open RAP Runtime | Settled by |
|---|---|---|
| Does an action called with `Prefer: handling=strict` that reports a warning answer `412 Precondition Failed`, and with which body? | `Preference-Applied: handling=strict`, `200`, the warning in `sap-messages` (D88) | scenario `strict-handling`, variant `strict` |
| The value of `DraftEntityType` | the root entity in upper case (D87) | scenario `list-report` (`observed`) |
| Is an action disabled by feature control advertised (`#<namespace>.<action>`), and with what? | every action under operation control, `{}` (D89) | scenarios `create` and `action` (`observed`) |
| Do the entity types of a service without draft have `SAP__Messages`? | yes, empty (D94) | `$metadata` of the service without draft |
| Do `missing-handler`, `database-write-in-handler` and `commit-in-handler` activate? | refused, refused, accepted (D91) | `fixtures/negative` |
| Does the BO of `rapt new` activate as is? | yes | case `control` of `fixtures/negative` |
| The `$metadata` of a view with parameters (the parameters type, the navigation `Set`) | `<Set>Parameters`, `Set` contained (D107) | variant `cds`, `results/cds/metadata.xml` |
| The `$metadata` and the values of the views with joins, paths, `$session`, WHERE with BETWEEN and IS INITIAL, aggregates, UNION ALL (D100 to D106) | as their decisions | variant `cds`, `results/cds/cds-booking*.json`, `cds-dates.json` |
| The recursive hierarchy: its qualifier, the names of the four hierarchy properties, the answers of `TopLevels`, `descendants` (the distance of the children) and `ancestors` | the name of the CDS hierarchy, `LimitedDescendantCount`, `DistanceFromRoot`, `DrillState`, `LimitedRank`; distance from the sub-hierarchy (D108) | variant `cds`, class `ZRT_CL_CDS_FILL…`, `results/cds/cds-node-*.json` (compared by `cds-round2.test.ts`) |
| Does a table entity (`define table entity`) activate on the trial? | yes (D55) | variant `cds` (`ZRT_CDSNODE…`) |
| Does `$session.bs_system_id` activate in a view entity? Is `COUNT(*)` without `GROUP BY` refused? | refused (CDS002), refused (CDS022) | `fixtures/negative`, cases `cds-session-bs-system-id`, `cds-aggregate-without-group-by` |

## Steps

Use a suffix of your own of 3 letters or digits at most (the names of the draft tables have 16
characters), a different one for each repository below: they all live on the same trial.

1. **Draft service with the `strict` and `cds` variants**
   `node scripts/btp-roundtrip.mjs --suffix <ABC> --variants draft,trial,strict,cds --out ../trial-r2`,
   then follow its `README.md`: push, pull, activate, publish the binding, open the preview. Then
   run the class `ZRT_CL_CDS_FILL<ABC>` in ADT (F9, *Run as ABAP Application (Console)*): it fills
   the nodes of the hierarchy (`6 nodes`).
2. **Recordings with observed values**
   `node scripts/fe-record-trial.mjs --url <preview URL> --release <release> --scenarios list-report,create,action,strict-handling --out ../trial-r2/results/cases`.
   In `strict-handling`, note the exact text of the confirmation dialog, if one appears.
   Review the `observed` members of the case files (no user name, key or host is kept, but read
   them).
3. **`$metadata` of the draft service**: save it as `../trial-r2/results/metadata.xml`, then
   `rapt conformance compare ../trial-r2 --sap ../trial-r2/results/metadata.xml --suffix <ABC> --out ../trial-r2/results/metadata-diff.md`.
   Then the **reads of the CDS views** (D111), with the session the recordings signed in:
   `node scripts/btp-read-trial.mjs --service <service root URL> --suffix <ABC> --out ../trial-r2/results/cds`
   (the service root is the URL of the preview up to `…/0001/`). Each answer is written neutral
   (no user name, key or namespace): read them before bringing them back.
4. **Service without draft**:
   `node scripts/btp-roundtrip.mjs --suffix <ABD> --variants trial --out ../trial-r2-active`, pull,
   activate, publish; save its `$metadata` as `../trial-r2-active/results/metadata.xml` (no
   recording needed).
5. **Sources SAP must refuse**:
   `node scripts/btp-roundtrip.mjs --negative --suffix <ABE> --out ../trial-negative`, pull,
   activate all, and write `results/negative.md` as its README says.
6. **Bring back** the `results/` folders (cases, `metadata.xml` files, `cds/` answers,
   `negative.md`, and the activation messages of each repository, exact texts). The `cds/` answers
   go to `conformance/btp/<release>/cds/`: `cds-round2.test.ts` then compares the hierarchy of
   Open RAP Runtime with them.

The trial account lasts 30 days: the steps can be split over several sessions, in this order.
