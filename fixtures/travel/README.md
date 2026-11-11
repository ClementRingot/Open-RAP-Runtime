# Fixture « Travel / Booking »

BO RAP managed non-draft de référence de rap-transpiler, au format abapGit (`src/`).
C'est le test de bout en bout principal. La fixture doit pouvoir s'importer et s'activer
telle quelle sur un système ABAP Cloud ou S/4HANA récent (décision D7).

| Objet | Type | Rôle |
|---|---|---|
| `ZRT_TRAVEL`, `ZRT_BOOKING` | TABL | Tables persistantes |
| `ZRT_R_TRAVEL` | DDLS | Root view entity, `composition [0..*] of ZRT_R_Booking` |
| `ZRT_R_BOOKING` | DDLS | View entity enfant, `association to parent` |
| `ZRT_C_TRAVEL`, `ZRT_C_BOOKING` | DDLS | Projections (`provider contract transactional_query`) |
| `ZRT_C_TRAVEL`, `ZRT_C_BOOKING` | DDLX | Annotations UI |
| `ZRT_R_TRAVEL` | BDEF | Comportement managed, strict(2) |
| `ZRT_C_TRAVEL` | BDEF | Projection |
| `ZBP_RT_R_TRAVEL` | CLAS | Behavior pool |
| `ZRT_UI_TRAVEL` | SRVD | Définition de service |
| `ZRT_UI_TRAVEL_O4` | SRVB | Binding OData V4 UI |

Comportement couvert :

- create, update, delete ; création des réservations par l'association `_Booking` ;
- numérotation managed (UUID) ; champs en lecture seule et obligatoires ;
- `lock master` / `lock dependent`, `etag master` sur les deux entités ;
- autorisation globale (`get_global_authorizations`, tout autorisé) ;
- détermination `setStatusOpen` (statut `O` à la création) ;
- déterminations `calculateTotalPrice` sur Travel et Booking, qui exécutent l'action interne
  `reCalcTotalPrice` (lecture des réservations par `READ … BY \_Booking`). Celle de Booking se
  déclenche aussi à la suppression (`delete`) : une réservation supprimée ne se lit plus dans le
  buffer transactionnel, son voyage est lu en base (`SELECT` sur `ZRT_R_Booking`) ;
- validation `validateDates` (dates renseignées, fin après début) ;
- validations `validateMandatory` sur Travel et Booking : `field ( mandatory )` n'est qu'une
  indication pour le consommateur, sans contrôle à l'exécution, le contrôle est à implémenter
  par une validation on save (documentation ABAP, `ABENBDL_FIELD_CHAR`) ;
- action `acceptTravel` (statut `A`), désactivée par feature control d'instance quand le voyage
  est déjà accepté.
