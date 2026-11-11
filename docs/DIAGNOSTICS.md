# Codes de diagnostic

`rapt check` affiche les diagnostics au format `fichier:ligne:colonne: sévérité CODE message`.
Le code de retour est 1 dès qu'il y a une erreur (ou un avertissement avec
`--warnings-as-errors`).

| Code | Sévérité | Signification |
|---|---|---|
| PRJ001 | erreur | Aucune définition de service, ou plusieurs sans `--service` |
| PRJ002 | erreur | La définition de service demandée n'existe pas |
| SRVD001 | erreur | Erreur de syntaxe dans une définition de service |
| SRVD002 | avertissement | Plusieurs bindings pour le service |
| SRVD003 | avertissement | Binding qui n'est pas OData V4 |
| SRVD004 | erreur | Entity set exposé deux fois |
| SRVD005 | erreur | Entité exposée introuvable |
| SRVD006 | info | Association vers une entité non exposée : navigation omise |
| SRVD007 | info | Plusieurs définitions de service : celle qui a un binding est construite (les autres, d'un service consumption model par exemple, ne le sont pas) |
| CDS001 | erreur | Source CDS illisible |
| CDS002 | erreur ou avertissement | Construction CDS non prise en charge |
| CDS003 | erreur | Source de données ou entité projetée inconnue |
| CDS004 | erreur | Élément inconnu dans la source |
| CDS005 | erreur | Cible d'association ou de redirection inconnue |
| CDS006 | avertissement | Métadonnées d'extension pour une entité inconnue |
| CDS007 | avertissement | Métadonnées d'extension ignorées (`@Metadata.allowExtensions` absent) |
| CDS008 | avertissement | Métadonnées d'extension sur un élément inconnu |
| CDS009 | avertissement | Champ mandant non exposé |
| CDS010 | erreur | Condition ON non prise en charge |
| CDS011 | erreur | Entité sans clé |
| CDS012 | avertissement | Composition ou association to parent non redirigée dans la projection |
| CDS013 | erreur | La projection n'expose pas les champs nécessaires à une association |
| CDS014 | erreur | Type inconnu dans une entité abstraite |
| CDS015 | erreur | Composition sans association to parent dans l'enfant |
| CDS016 | erreur | Entité custom sans `@ObjectModel.query.implementedBy: 'ABAP:<classe>'` |
| CDS017 | erreur | Classe de requête d'une entité custom absente des sources |
| CDS018 | avertissement | Value help (`@Consumption.valueHelpDefinition`) sur une entité inconnue : value help omis |
| DDIC001 | erreur | Élément de données inconnu |
| DDIC002 | erreur | Type de données non pris en charge |
| DDIC003 | erreur | Structure incluse non prise en charge |
| DDIC004 | avertissement | Classe de table autre que transparente |
| DDIC005 | info | Table du projet laissée hors de la base (elle ne peut être construite et aucune entité ne l'utilise) |
| DDIC010 | erreur | Définition de table illisible |
| TABL001 | erreur | Erreur dans la source d'une table (`.tabl.astabl`) : syntaxe, type inconnu, nom différent de celui du fichier, table sans clé |
| TABL002 | avertissement | Construction de la source d'une table non transférée au XML abapGit (clé étrangère) |
| BDEF001 | erreur | Erreur de syntaxe BDEF |
| BDEF002 | erreur | Fonctionnalité hors périmètre (draft, unmanaged, late numbering…) |
| BDEF003 | avertissement | Construction ignorée |
| BDEF004 | erreur | Entité CDS inconnue |
| BDEF005 | erreur | Élément inconnu |
| BDEF006 | erreur | Association inconnue |
| BDEF007 | erreur | Table persistante inconnue |
| BDEF027 | erreur ou info | BO managed avec unmanaged save sur une entité custom : extension de rap-transpiler, non activable sur SAP (D43). Erreur en mode `standard`, info en mode `enhanced` (D45) |
| BDEF008 | erreur | Mapping incohérent avec la vue CDS ou la table |
| BDEF009 | erreur | Élément sans colonne correspondante |
| BDEF010 | erreur | Type d'implémentation absent |
| BDEF011 | erreur | Behavior pool requis |
| BDEF012 | erreur | Instruction interdite dans ce type de BDEF |
| BDEF013 | erreur | BDEF managed sur autre chose qu'une view entity |
| BDEF014 | erreur | Table persistante manquante |
| BDEF015 | erreur | Définition de verrou manquante ou invalide |
| BDEF016 | avertissement | Mode strict sans définition d'autorisation |
| BDEF017 | erreur | `numbering : managed` sur un champ qui n'est pas une clé UUID |
| BDEF018 | avertissement | `create` sur une entité enfant |
| BDEF019 | erreur | Création par association sur autre chose qu'une composition |
| BDEF020 | avertissement | Détermination sans trigger |
| BDEF021 | erreur | Entité de paramètre ou de résultat inconnue |
| BDEF022 | erreur | Action factory avec résultat, ou fonction sans résultat |
| BDEF023 | erreur | La projection réutilise une fonctionnalité absente de la base |
| BDEF024 | erreur | Enfant de composition sans comportement |
| BDEF025 | erreur | Entité enfant sans association to parent |
| BDEF026 | erreur | Projection BDEF sur autre chose qu'une projection d'un BO managed |
| ABP001 | erreur | Behavior pool introuvable |
| ABP002 | erreur | Méthode de handler manquante, ou classe saver (avec `save_modified`) manquante pour additional ou unmanaged save |
| ABP003 | avertissement | Méthode de handler ou de saver sans élément BDEF correspondant (dont un precheck non déclaré, un saver sans additional ou unmanaged save) : elle n'est pas appelée |
| ABP004 | erreur | Erreur ABAP (abaplint) : syntaxe des sources d'origine, contrôle complet des sources réécrites, à la ligne d'origine |
| ABP005 | erreur | Instruction EML mal formée ou forme non prise en charge (`OPERATIONS`, `RELATING TO`…) |
| ABP006 | erreur | Nom inconnu dans l'EML ou un type dérivé : BDEF, entité, champ, association, action |
| ABP007 | erreur | Construction non prise en charge : écriture ABAP SQL hors de la classe saver, `DELETE dbtab FROM @wa`, `WITH`, `SELECT … ENDSELECT` avec une liste de champs, `adjust_numbers`, EML sur une projection, `GET PERMISSIONS`, type dérivé ou handler hors périmètre |
| ABP008 | erreur | Erreur interne (ABAP généré) ou erreur du transpiler |
| ABP009 | erreur | Résultat d'un `SELECT` qu'abaplint ne type pas (littéral, agrégat autre que `COUNT(*)`, `MAX` et `MIN`, expression) en déclaration en ligne : déclarer la cible |
| ABP010 | erreur | `AUTHORITY-CHECK` sur un champ que l'objet d'autorisation n'a pas |
| ABP011 | avertissement | `AUTHORITY-CHECK` sur un objet d'autorisation ni dans les sources (SUSO), ni dans `rapt/authorizations.json` : aucun rôle ne l'accorde |
| DCL001 | erreur | Contrôle d'accès (DCL) illisible, ou héritage circulaire |
| DCL002 | avertissement | Condition d'un contrôle d'accès que l'application n'évalue pas : elle n'accorde aucune ligne |
| DCL003 | avertissement | Élément, association ou entité inconnu dans un contrôle d'accès, ou non exposé par la projection : la condition n'accorde aucune ligne |
| DCL004 | erreur ou avertissement | `aspect pfcg_auth` sur un champ que l'objet d'autorisation n'a pas (erreur), ou sur un objet inconnu (avertissement) |
| AUTH001 | erreur | Objet d'autorisation ou `rapt/authorizations.json` illisible ou mal formé |
| AUTH002 | avertissement | Rôle accordant un objet d'autorisation inconnu (ses champs ne sont pas contrôlés) |
| AUTH003 | erreur | Rôle donnant une valeur à un champ que l'objet d'autorisation n'a pas |
| AUTH004 | avertissement | Rôle accordant une activité (`ACTVT`) que l'objet d'autorisation ne permet pas |
| LPD001 | erreur | `launchpad.json` illisible ou mal formé : groupes, titres, id ou URL d'une application, rôles d'une tuile |
| LPD002 | erreur | Tuile sans cible, avec deux cibles (`app` et `url`), ou d'une application inconnue |
| LPD003 | erreur ou avertissement | Dossier d'application qui n'a pas été généré par `rapt build` (erreur) ; application dont les services ne sont pas connus, ni `build` ni `servicePaths` (avertissement) |
| LPD004 | erreur | Intent qui n'est pas de la forme `ObjetSemantique-action` |
| LPD005 | erreur | Chemin de service sous un chemin du launchpad (`/ui`, `/apps`, `/auth`…), ou servi par deux applications |
| LPD006 | erreur | Compteur sur un entity set inconnu du service, ou sur une tuile sans application |
| LPD007 | avertissement | Rôle d'une tuile absent des `rapt/authorizations.json` des applications (l'IdP doit tout de même le donner) |
| LPD008 | erreur | Space ou page mal formé dans `launchpad.json` (titre, pages, sections, rôles) (D48) |
| SEED001 | erreur | `rapt/seed.json` illisible ou mal formé (objet table → tableau de lignes attendu) |
| SEED002 | erreur | `rapt/seed.json` : table ou champ inconnu de l'application |
| NR001 | erreur | `rapt/number-ranges.json` illisible ou mal formé : objet de plus de 10 caractères, intervalle de plus de 2 caractères, bornes non numériques ou inversées |
| CFG001 | erreur | `rapt/config.json` illisible, ou mode inconnu (`standard` ou `enhanced`), dans le fichier ou `--mode` (D45) |
| CFG002 | avertissement | Réglage inconnu dans `rapt/config.json`, ignoré |
| MCP001 | erreur | `rapt/mcp.json` illisible ou mal formé (D47) |
| MCP002 | avertissement | `rapt/mcp.json` décrit un outil que le service n'a plus : relancer `rapt mcp` |
| APP001 | erreur | Paquets du runtime introuvables (`dist/` non construit) pour l'application générée : `--runtime <dossier>` ou `pnpm build` |
