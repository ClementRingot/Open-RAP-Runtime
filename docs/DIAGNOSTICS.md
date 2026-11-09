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
| DDIC001 | erreur | Élément de données inconnu |
| DDIC002 | erreur | Type de données non pris en charge |
| DDIC003 | erreur | Structure incluse non prise en charge |
| DDIC004 | avertissement | Classe de table autre que transparente |
| DDIC010 | erreur | Définition de table illisible |
| BDEF001 | erreur | Erreur de syntaxe BDEF |
| BDEF002 | erreur | Fonctionnalité hors périmètre (draft, unmanaged, late numbering…) |
| BDEF003 | avertissement | Construction ignorée |
| BDEF004 | erreur | Entité CDS inconnue |
| BDEF005 | erreur | Élément inconnu |
| BDEF006 | erreur | Association inconnue |
| BDEF007 | erreur | Table persistante inconnue |
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
| ABP002 | erreur | Méthode de handler manquante |
| ABP003 | avertissement | Méthode de handler sans élément BDEF correspondant |
| ABP004 | erreur | Erreur de syntaxe ABAP (abaplint) |
