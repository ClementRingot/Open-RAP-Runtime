# Sources SAP BTP must refuse (D91)

`cases.json` lists sources that the ABAP environment of SAP BTP must refuse, or that the round
trip must settle. Each case is the business object of `rapt new <dir> Item --prefix <prefix>`
with exact text replacements, so that the cases do not depend on each other and one pull on the
trial tries them all.

- `expect.code`: the diagnostic `rapt check` gives in `standard` mode (`null`: accepted).
  `scripts/lib/negative.test.mjs` checks it.
- `sap`: the outcome on SAP BTP (`refuses` with the exact message, or `activates`), `null` while
  not tried. `confirm` names what the round trip must settle.

On the trial: `node scripts/btp-roundtrip.mjs --negative --suffix XYZ --out <dir>` writes one
abapGit repository with every case (prefix followed by the suffix of the user), its
`expected.json` and the steps (`README.md`). When SAP and Open RAP Runtime disagree, Open RAP
Runtime follows SAP (AGENTS.md, rule 1).
