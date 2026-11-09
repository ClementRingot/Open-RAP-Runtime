# Décisions techniques

Décisions prises le 2026-11-09, après validation du principe par le porteur du projet
(« prends les décisions techniques que tu penses les meilleures ; toutes les fonctionnalités
d'un BO RAP non-draft doivent être respectées »). Chaque entrée donne la décision, la raison
et la conséquence. Les numéros D1 à D13 correspondent aux points 1 à 13 du §11 de PLAN.md.

## D1 — Grammaire BDEF écrite avec Chevrotain

- **Décision** : grammaire Chevrotain pour les BDEF (behavior managed et projection) ;
  le parser BDEF d'abaplint sert d'oracle dans les tests.
- **Pourquoi** : AST typé, messages d'erreur positionnés, contrôle total sur le traitement des
  constructions hors périmètre. Le parser d'abaplint ne produit qu'un arbre générique.
- **Conséquence** : deux parsers à maintenir alignés ; un test compare les entités, alias et
  opérations trouvés par chacun.

## D2 — ABP : types dérivés générés et réécriture source à source

- **Décision** : le compilateur génère, pour chaque BDEF, une interface ABAP contenant les types
  dérivés RAP (`%tky`, `%control`, tables `FOR …`, réponses `FAILED/REPORTED/MAPPED`), puis
  réécrit l'ABP avant de le donner au transpiler :
  signatures des handlers, références `TYPE TABLE FOR …`, `#` des opérandes EML, `DATA(…)`
  inline des réponses EML.
  Les formes EML que le transpiler n'abaisse pas (`READ … BY \_assoc`, `LINK`,
  `CREATE BY \_assoc`) sont abaissées par cette même passe vers notre kernel.
- **Pourquoi** : abaplint type ces constructions en `void` et le transpiler refuse alors l'ABP.
  Le PoC (PLAN.md, V10) prouve que l'approche fonctionne avec les paquets publiés. Les lectures
  et créations par association sont indispensables à un BO non-draft réel (calcul d'un total
  depuis les enfants, par exemple).
- **Conséquence** : on ne patche ni ne monkeypatche jamais le transpiler ou le runtime ; on leur
  donne de l'ABAP standard. Toute construction que la passe ne sait pas traiter produit un
  diagnostic et une entrée dans KNOWN_GAPS.md. Une contribution upstream (types dérivés dans
  abaplint, abaissement des formes `BY`) reste souhaitable, mais elle est publique : elle ne sera
  proposée qu'avec l'accord du porteur du projet.

## D3 — Fastify plutôt qu'Express

- **Pourquoi** : `inject()` permet de tester le serveur sans réseau ; plugins encapsulés ;
  bon typage TypeScript ; performances.

## D4 — Lectures OData via des vues SQL générées

- **Décision** : chaque vue CDS devient une vue PostgreSQL (`zr_*` sur les tables, puis `zc_*`
  sur `zr_*`). Les lectures OData interrogent les vues `zc_*` ; les écritures passent par le
  runtime RAP, vers les tables.
- **Pourquoi** : c'est la séparation de RAP (requête via la projection CDS, transaction via le
  BO). Les expressions CDS futures (CASE, CAST…) se traduiront directement en SQL.

## D5 — Périmètre OData étendu à ce qu'une List Report / Object Page V4 envoie

- **Décision** : en plus de la liste initiale : navigation `Entité(…)/_Assoc` (lecture et
  création), `ge`, `le`, `not`, `startswith`, `endswith`, segment `/$count`, `$search` simple,
  jeton CSRF, `IEEE754Compatible=true`, deep insert sur un niveau, en-tête `sap-messages`,
  références `$<Content-ID>` dans un changeset, paramètres `sap-*` ignorés.
- **Pourquoi** : sans eux, une application Fiori Elements V4 (ou notre UI OpenUI5, qui utilise le
  même ODataModel) ne fonctionne pas entièrement.

## D6 — Chemin du service calqué sur RAP

- **Décision** : par défaut `/sap/opu/odata4/sap/<binding>/srvd/sap/<srvd>/0001/`, configurable.
- **Pourquoi** : une application Fiori Elements existante peut pointer sur le service sans
  modifier son manifest.

## D7 — Fixture activable telle quelle sur un vrai système

- **Décision** : la fixture `fixtures/travel` est un export abapGit complet et cohérent
  (strict(2), autorisation globale, numérotation managed…). L'autorisation n'est plus ignorée :
  elle fait partie des fonctionnalités non-draft prises en charge (D14).
- **Pourquoi** : le comportement de référence peut être vérifié sur un système SAP.

## D8 — Horodatages en `timestamptz(6)`

- **Décision** : `TIMESTAMPL`/`UTCLONG` → `timestamptz(6)`, `TIMESTAMP` → `timestamptz(0)`.
- **Pourquoi** : type naturel en SQL et pour les filtres OData. Les horodatages générés par le
  runtime sont à la microseconde, ce qui garde les ETag stables.
- **Conséquence** : la septième décimale ABAP est perdue (KNOWN_GAPS.md). Dans l'ABP, le runtime
  abaplint représente les `DEC` par un nombre JavaScript : un `TIMESTAMPL` y perd ses dernières
  décimales. Les ETag ne passent donc jamais par l'ABP.

## D9 — Mandant retiré

- **Décision** : la colonne `CLNT` (`CLIENT`, `MANDT`) est retirée des tables ; application
  mono-tenant.

## D10 — UI OpenUI5 1.136 LTS en freestyle

- **Décision** : contrôles `sap.m`, `sap.f`, `sap.uxap`, `sap.ui.layout`, thème `sap_horizon`,
  ODataModel V4 avec `autoExpandSelect`. `sap.ui.mdc` est une évolution possible.
- **Pourquoi** : bibliothèques Apache-2.0 ; le ODataModel V4 est celui de Fiori Elements V4.

## D11 — Exécution ABP sérialisée, réentrante dans un même LUW

- **Décision** : un verrou par processus encadre les appels ABP ; il est réentrant pour le LUW
  qui le détient (une détermination qui exécute une action interne ne se bloque pas elle-même).
- **Pourquoi** : le runtime abaplint a un état global (`sy-*`, attributs statiques).
- **Conséquence** : montée en charge par processus ou conteneurs.

## D12 — Nommage et licence

- **Décision** : paquets `@rap-transpiler/model`, `@rap-transpiler/compiler`,
  `@rap-transpiler/runtime` ; CLI `rapt` ; licence MIT pour ce dépôt.

## D13 — Corpus de test SAP-samples

- **Décision** : un petit extrait de sources BDEF et CDS des dépôts SAP-samples (Apache-2.0),
  utilisé en lecture seule pour tester la robustesse des parsers, avec attribution dans
  LICENSES.md.

## D14 — Périmètre fonctionnel : un BO RAP managed non-draft complet

- **Décision** : la cible est l'ensemble des fonctionnalités d'un BO managed sans draft, suivi
  dans [FEATURES.md](FEATURES.md). Cela ajoute au MVP initial : autorisations (globales et
  d'instance), feature control statique et dynamique, numérotation externe, actions statiques,
  factory, internes et avec paramètre, déterminations on save, precheck, side effects (CSDL),
  messages T100, lectures et créations par association dans l'ABP.
- **Restent hors périmètre**, avec leur raison dans FEATURES.md : draft (exclu par le cahier des
  charges), implémentation unmanaged, late numbering, `with additional save` et
  `with unmanaged save` (il faudrait de l'ABAP SQL dans le saver), événements, change documents,
  extensions, analytique.

## D15 — Runtime générique piloté par l'IR

- **Décision** : l'application générée contient un runtime générique (`@rap-transpiler/runtime`)
  qui lit `model.json`. Seuls le SQL, le CSDL, le JavaScript de l'ABP, l'UI et le packaging sont
  générés. Le runtime est embarqué sous forme de tarball dans `vendor/`.
- **Pourquoi** : un seul runtime testé pour tous les BO ; une sortie autonome sans registre privé.

## D16 — Représentation canonique des valeurs

- **Décision** : dans le buffer transactionnel, les valeurs sont des valeurs JavaScript
  canoniques : chaînes pour CHAR, NUMC et STRING (blancs finaux supprimés) ; chaînes pour les
  décimaux et INT8 (pas de perte de précision) ; `AAAA-MM-JJ` pour les dates (initiale = `null`) ;
  `HH:MM:SS` pour les heures ; ISO 8601 UTC à la microseconde pour les horodatages ; UUID en
  minuscules avec tirets ; booléens pour `ABAP_BOOLEAN`.
- **Pourquoi** : une seule forme pivot entre ABAP, SQL et OData ; les conversions sont isolées et
  testées.

## D17 — Chaîne d'outils

- **Décision** : TypeScript 7.0 (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM `NodeNext` avec spécificateurs
  `.js`, compilation `tsc` vers `dist/`, Vitest (alias vers les sources), workspaces pnpm.

## D18 — Base de données des tests

- **Décision** : PGlite (PostgreSQL en WASM, en processus) pour les tests d'intégration ; un vrai
  PostgreSQL pour l'e2e.

## D19 — DDIC « ombre » pour le transpiler

- **Décision** : le registre passé au transpiler reçoit des tables aux types prédéfinis et des
  vues CDS sans associations, générées depuis l'IR.
- **Pourquoi** : la couche SQL du transpiler échoue sur les associations et ne connaît pas les
  éléments de données SAP standard ; notre SQL vient de l'IR.

## D20 — `field ( mandatory )` sans contrôle à l'exécution

- **Décision** : comme RAP, aucun contrôle runtime ; `Common.FieldControl` Mandatory dans le
  CSDL et champ requis dans l'UI. `mandatory : create`, lui, est contrôlé à la création, comme
  dans RAP.

## D21 — Déclenchement des déterminations et validations

- **Décision** : les déterminations on modify s'exécutent à la fin de chaque requête de
  modification, par tours successifs : un tour traite les instances dont un trigger a été touché
  depuis le passage précédent de cette détermination ; une détermination n'est pas redéclenchée
  par ses propres modifications ; la boucle est bornée (erreur au-delà de 20 tours).
  Les validations et les déterminations on save s'exécutent dans la séquence de sauvegarde, sur
  les changements cumulés du LUW.
