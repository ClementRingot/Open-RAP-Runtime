# Écarts connus

Ce fichier recense ce qui n'est pas (encore) pris en charge, en particulier les fonctionnalités
ABAP que `@abaplint/transpiler` ne traite pas : la règle du projet est de les documenter ici
plutôt que de contourner le transpiler. La couverture fonctionnelle globale est suivie dans
[docs/FEATURES.md](docs/FEATURES.md).

Versions de référence : `@abaplint/core` 2.120.98, `@abaplint/transpiler` 2.14.24,
`@abaplint/runtime` 2.14.24.

## Transpiler et runtime abaplint

| Écart | Effet | Contournement | Suivi |
|---|---|---|---|
| Les types dérivés RAP (`TYPE TABLE FOR …`, `keys`, `failed`, `reported`, `result`) sont typés `void` par abaplint. | Le transpiler refuse l'ABP (`TypeNameOrInfer, type not found: #`). | Le compilateur génère les types et réécrit l'ABP avant transpilation (D2). | Résolu (J4) |
| abaplint n'analyse pas toutes les formes EML (`CREATE AUTO FILL CID SET FIELDS WITH`, `CREATE BY \_assoc SET FIELDS WITH` sont des instructions inconnues pour lui), et l'abaissement EML du transpiler ne traite ni `BY \_assoc`, ni `LINK`, ni `CREATE BY`, ni `IN LOCAL MODE`. | Erreur de syntaxe ou « not supported » à l'exécution. | Parser EML propre et abaissement vers `ZRAP_EML` par la passe de réécriture (D2). | Résolu (J4) |
| Les opérations arithmétiques du runtime sur des nombres packed (`p`) passent par des nombres JavaScript (le stockage, lui, est exact). | Un calcul au-delà d'environ 15 chiffres significatifs peut perdre des décimales. | Les valeurs passent en texte exact entre le buffer et l'ABP (D8) ; les montants usuels ne sont pas concernés. | — |
| La couche SQL du transpiler échoue sur les associations CDS. | Transpilation impossible avec les DDLS d'origine. | DDIC « ombre » sans vues CDS (D19). | Résolu (J4) |
| Les méthodes privées des classes locales ne sont accessibles qu'à travers `FRIENDS_ACCESS_INSTANCE`, un détail interne du code généré. | Peut changer avec une version du transpiler. | Versions épinglées ; les tests de J4 appellent tous les handlers par ce chemin. | — |
| Les objets à namespace (`/DMO/…`) donnent des modules nommés avec `#`, importés en `%23`. | Le chargeur de modules de Vitest ne les trouve pas. | Les modules sont renommés (`#` → `_`) à la génération. | Résolu (J4) |

## Behavior pool (ABAP)

| Écart | Statut |
|---|---|
| ABAP SQL (`SELECT`, `INSERT`, `UPDATE`, `MODIFY`, `DELETE` sur une table) | Diagnostic ABP007 (D26) : le runtime abaplint n'a pas de connexion à la base. Lecture SQL de tables de contrôle : évolution possible. |
| Types des vues CDS dans l'ABP (`DATA ls TYPE zr_travel`) | Non disponibles (D19) : utiliser les types dérivés. Les tables et éléments de données le sont. |
| Classes locales de sauvegarde (`lsc_…` héritant de `cl_abap_behavior_saver`) | Non prises en charge (sauvegarde additionnelle ou unmanaged hors périmètre). |
| EML sur une BDEF de projection (`MODIFY ENTITIES OF zc_travel`) | Diagnostic ABP007 : utiliser la BDEF de base. |
| `MODIFY ENTITIES OPERATIONS` (EML dynamique), `RELATING TO`, `AUGMENTING`, `COMMIT ENTITIES RESPONSES`, `GET PERMISSIONS`, `SET LOCKS`, `RAISE ENTITY EVENT` | Diagnostics ABP005/ABP007. |
| Numérotation anticipée par association (`FOR NUMBERING … FOR CREATE Travel\_Booking`), late numbering | Non pris en charge. |
| `COMMIT ENTITIES` et `ROLLBACK ENTITIES` dans un handler | Erreur à l'exécution, comme dans RAP. |
| Réponses d'une instruction EML | Remplacent le contenu des cibles `FAILED`/`REPORTED`/`MAPPED` données ; `sy-subrc` vaut 4 quand `failed` n'est pas vide (convention, non documentée par SAP). |
| Septième décimale des `TIMESTAMPL` générés | Le runtime les génère à la microseconde (D8). |

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
| `If-Match` sur une entité `etag dependent by` | Non contrôlé : seule l'entité `etag master` expose son ETag. |
| Feature control global (`features : global`) dans les lectures | Calculé avec le feature control d'instance, sans cache entre requêtes. |

## Application générée

| Écart | Statut |
|---|---|
| Premier chargement de l'UI : environ 400 modules OpenUI5 servis un par un (pas de bundle `ui5 build`) | Assumé (D27) ; mise en cache HTTP d'une heure. |
| Sessions : ni rafraîchissement de jeton, ni révocation avant l'expiration du cookie (8 h) | Assumé (D28). |
| Verrous entre plusieurs instances de l'application | Verrous de ligne PostgreSQL (`NOWAIT`) ; pas de test de conflit automatisé. |
| TypeScript 7.0.2 compile `new (x as T).Y()` sans parenthèses | Forme évitée dans le code (D29). |

