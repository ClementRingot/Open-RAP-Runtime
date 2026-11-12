# Fixture "Travel / Booking"

The reference non-draft managed RAP BO of Open RAP Runtime, in abapGit format (`src/`). It is the
main end-to-end test. The fixture must import and activate as is on an ABAP Cloud or recent
S/4HANA system (decision D7).

| Object | Type | Role |
|---|---|---|
| `ZRT_TRAVEL`, `ZRT_BOOKING` | TABL | Persistent tables |
| `ZRT_R_TRAVEL` | DDLS | Root view entity, `composition [0..*] of ZRT_R_Booking` |
| `ZRT_R_BOOKING` | DDLS | Child view entity, `association to parent` |
| `ZRT_C_TRAVEL`, `ZRT_C_BOOKING` | DDLS | Projections (`provider contract transactional_query`) |
| `ZRT_C_TRAVEL`, `ZRT_C_BOOKING` | DDLX | UI annotations |
| `ZRT_R_TRAVEL` | BDEF | Managed behavior, strict(2) |
| `ZRT_C_TRAVEL` | BDEF | Projection |
| `ZBP_RT_R_TRAVEL` | CLAS | Behavior pool |
| `ZRT_UI_TRAVEL` | SRVD | Service definition |
| `ZRT_UI_TRAVEL_O4` | SRVB | OData V4 UI binding |

Behavior covered:

- create, update, delete; creation of the bookings by the `_Booking` association;
- managed numbering (UUID); read-only and mandatory fields;
- `lock master` / `lock dependent`, `etag master` on both entities;
- global authorization (`get_global_authorizations`, everything allowed);
- determination `setStatusOpen` (status `O` on create);
- determinations `calculateTotalPrice` on Travel and Booking, which run the internal action
  `reCalcTotalPrice` (bookings read with `READ … BY \_Booking`). The one of Booking is also
  triggered on `delete`: a deleted booking can no longer be read from the transactional buffer,
  so its travel is read from the database (`SELECT` on `ZRT_R_Booking`);
- validation `validateDates` (dates filled, end after begin);
- validations `validateMandatory` on Travel and Booking: `field ( mandatory )` is only a hint for
  the consumer, without a check at runtime, the check is implemented by a validation on save
  (ABAP documentation, `ABENBDL_FIELD_CHAR`);
- action `acceptTravel` (status `A`), disabled by instance feature control when the travel is
  already accepted.
