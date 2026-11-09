# Écarts connus

Ce fichier recense ce qui n'est pas (encore) pris en charge, en particulier les fonctionnalités
ABAP que `@abaplint/transpiler` ne traite pas : la règle du projet est de les documenter ici
plutôt que de contourner le transpiler. La couverture fonctionnelle globale est suivie dans
[docs/FEATURES.md](docs/FEATURES.md).

Versions de référence : `@abaplint/core` 2.120.98, `@abaplint/transpiler` 2.14.24.

## Transpiler et runtime abaplint

| Écart | Effet | Contournement | Suivi |
|---|---|---|---|
| Les types dérivés RAP (`TYPE TABLE FOR …`, `keys`, `failed`, `reported`, `result`) sont typés `void` par abaplint. | Le transpiler refuse l'ABP (`TypeNameOrInfer, type not found: #`). | Le compilateur génère les types et réécrit l'ABP avant transpilation (décision D2). | J4 |
| L'abaissement EML du transpiler ne traite pas `READ … BY \_assoc`, `LINK`, `CREATE BY \_assoc`. | Erreur « not supported » à l'exécution. | Abaissement par la passe de réécriture du compilateur (D2). | J4 |
| L'abaissement EML ne traite pas `MODIFY ENTITIES OPERATIONS`, `RELATING TO`, `AUGMENTING`, `READ … EXECUTE` (fonctions), `COMMIT ENTITIES IN SIMULATION MODE`. | Erreur « not supported » à l'exécution. | Aucun : diagnostic du compilateur. | — |
| `IN LOCAL MODE` et `PRIVILEGED` ne sont pas transmis au kernel EML. | Tout EML venant de l'ABP est traité comme local mode. | Sans effet sur un code qui compile sur SAP. | — |
| `@abaplint/runtime` représente les `DEC` par un nombre JavaScript. | Un `TIMESTAMPL` (21 chiffres) perd ses dernières décimales dans le code ABP. | Les ETag et horodatages du runtime ne passent pas par l'ABP (D8). | — |
| La couche SQL du transpiler échoue sur les associations CDS. | Transpilation impossible avec les DDLS d'origine. | DDIC « ombre » sans associations (D19). | J4 |
| Les méthodes privées des classes locales ne sont accessibles qu'à travers `FRIENDS_ACCESS_INSTANCE`, un détail interne du code généré. | Peut changer avec une version du transpiler. | Versions épinglées et test de contrat. | J4 |

## CDS

| Écart | Statut |
|---|---|
| Expressions dans la liste de sélection (CAST, CASE, calculs, littéraux) | Diagnostic CDS002 |
| Chemins d'association dans la liste de sélection (`_Agency.Name`) | Diagnostic CDS002 |
| Jointures, clause WHERE | Diagnostic CDS002 (WHERE ignoré avec avertissement) |
| Vues avec paramètres, unions, hiérarchies, entités custom | Diagnostic CDS002 |
| Contrôle d'accès DCL | `@AccessControl.authorizationCheck` ignoré |
| Structures incluses (`.INCLUDE`) dans les tables | Diagnostic DDIC003 |
| Conversion exits (ALPHA…), conversion ISO des langues | Non gérés |

## Base de données

| Écart | Statut |
|---|---|
| Colonne mandant (`CLNT`) | Retirée : applications mono-tenant (D9) |
| Septième décimale des `TIMESTAMPL` | Perdue : `timestamptz(6)` (D8) |

## OData

| Écart | Statut |
|---|---|
| Comparaisons `lt`/`le` sur une date initiale : en ABAP `00000000` est inférieure à toute date ; ici la valeur initiale est `NULL` et n'est retenue par aucune comparaison (sémantique OData de `null`). | Assumé |
| `$filter` avec `any`/`all`, `$expand` imbriqué, `$apply`, JSON batch, `$value` | Réponse 501 ou 400 |
