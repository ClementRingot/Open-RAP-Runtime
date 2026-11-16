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

## Steps

Use a suffix of your own of 3 letters or digits at most (the names of the draft tables have 16
characters), a different one for each repository below: they all live on the same trial.

1. **Draft service with the `strict` variant**
   `node scripts/btp-roundtrip.mjs --suffix <ABC> --variants draft,trial,strict --out ../trial-r2`,
   then follow its `README.md`: push, pull, activate, publish the binding, open the preview.
2. **Recordings with observed values**
   `node scripts/fe-record-trial.mjs --url <preview URL> --release <release> --scenarios list-report,create,action,strict-handling --out ../trial-r2/results/cases`.
   In `strict-handling`, note the exact text of the confirmation dialog, if one appears.
   Review the `observed` members of the case files (no user name, key or host is kept, but read
   them).
3. **`$metadata` of the draft service**: save it as `../trial-r2/results/metadata.xml`, then
   `rapt conformance compare ../trial-r2 --sap ../trial-r2/results/metadata.xml --suffix <ABC> --out ../trial-r2/results/metadata-diff.md`.
4. **Service without draft**:
   `node scripts/btp-roundtrip.mjs --suffix <ABD> --variants trial --out ../trial-r2-active`, pull,
   activate, publish; save its `$metadata` as `../trial-r2-active/results/metadata.xml` (no
   recording needed).
5. **Sources SAP must refuse**:
   `node scripts/btp-roundtrip.mjs --negative --suffix <ABE> --out ../trial-negative`, pull,
   activate all, and write `results/negative.md` as its README says.
6. **Bring back** the `results/` folders (cases, `metadata.xml` files, `negative.md`, and the
   activation messages of each repository, exact texts).

The trial account lasts 30 days: the steps can be split over several sessions, in this order.
