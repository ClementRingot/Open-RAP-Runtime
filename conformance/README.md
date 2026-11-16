# Conformance with SAP BTP

The results of the round trips of the fixtures to the SAP BTP ABAP environment (D84, D99), by
release of SAP BTP: how SAP activated the sources (`activation.md`), the scenarios of SAP Fiori
elements recorded on the trial (`recording.md`, the case files are in
`packages/runtime/test/fe-protocol/cases/trial-*-har.json`), the `$metadata` SAP generated for the
service of the fixture (`metadata.xml`), and the report of the round trip (`REPORT.md`).

They are the reference Open RAP Runtime is compared with. They come from the SAP BTP trial of a
contributor, on the sources of this repository; they hold no SAP software, no credentials and no
host name.

| Release | Fixture | Variants | Report |
|---|---|---|---|
| 2611 (HFC 3) | `fixtures/travel` | `draft`, `trial` | [btp/2611/REPORT.md](btp/2611/REPORT.md) |
