# Conformance with SAP BTP

The results of the round trips of the fixtures to the SAP BTP ABAP environment (D84, D99), by
release of SAP BTP: how SAP activated the sources (`activation.md`), the scenarios of SAP Fiori
elements recorded on the trial (`recording.md`, the case files are in
`packages/runtime/test/fe-protocol/cases/trial-*-har.json`), the `$metadata` SAP generated for the
service of the fixture (`metadata.xml`), its differences with the `$metadata` of Open RAP Runtime
(`metadata-diff.md`, written by `rapt conformance compare`, D90), and the report of the round trip
(`REPORT.md`).

The sources SAP must refuse are in `fixtures/negative/cases.json` (D91): `node
scripts/btp-roundtrip.mjs --negative --suffix XYZ --out <dir>` writes them for the trial, and the
outcome of SAP goes back to the `sap` member of each case.

The next session on the trial and what it must settle: [btp/round-2.md](btp/round-2.md).

To compare a project of your own with the `$metadata` SAP BTP generated for it:

```
rapt conformance compare <src> --sap <metadata.xml> [--suffix XYZ] [--out metadata-diff.md]
```

`--suffix` is the suffix of the copy pulled on a shared system (`rapt abapgit --suffix`).
`conformance.test.ts` keeps `btp/<release>/metadata-diff.md` up to date: a change of Open RAP
Runtime that removes or adds a difference changes that file (`vitest -u`).

They are the reference Open RAP Runtime is compared with. They come from the SAP BTP trial of a
contributor, on the sources of this repository; they hold no SAP software, no credentials and no
host name.

| Release | Fixture | Variants | Report |
|---|---|---|---|
| 2611 (HFC 3) | `fixtures/travel` | `draft`, `trial` | [btp/2611/REPORT.md](btp/2611/REPORT.md) |
