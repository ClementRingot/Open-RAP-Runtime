# RAP Transpiler pour VS Code

Vérifier, générer et lancer un business object RAP avec [rap-transpiler](https://github.com/ClementRingot/rap-transpiler),
sans système SAP. L'extension ne compile rien elle-même : elle appelle la CLI `rapt` (`--json`)
et en affiche les résultats.

## Fonctions

- **Coloration syntaxique** de l'ABAP (`.abap`, grammaire de
  [larshp/vscode-abap](https://github.com/larshp/vscode-abap), MIT), des sources CDS (`.asddls`,
  `.asddlxs`, `.asdcls`, `.srvdsrv`, tables `.astabl`) et des behavior definitions (`.asbdef`).
- **Problèmes** : les diagnostics de `rapt check` (BDEF, CDS, behavior pool…) à chaque
  enregistrement, soulignés dans le code.
- **RAP : Lancer rapt dev** : l'application tourne avec une base PGlite et se reconstruit à
  chaque enregistrement. La barre d'état indique l'état (construction, prête, erreurs) et ouvre
  l'application d'un clic.
- **RAP : Générer l'application** : `rapt build` dans le dossier de son choix.
- Menus contextuels de l'explorateur (dossier du projet, `.abapgit.xml`) et boutons dans la
  barre de titre des sources RAP.

Un projet est un dossier abapGit : le dossier qui contient `.abapgit.xml` (à défaut, le parent
d'un dossier `src`).

## Installation

Rien d'autre à installer : le `.vsix` contient rapt (compilateur et runtime), OpenUI5 et PGlite,
et rapt tourne sur le Node.js intégré à VS Code (1.101 ou plus, Node.js 22).

```sh
code --install-extension rap-transpiler-vscode.vsix
```

Le `.vsix` est joint à chaque [release GitHub](https://github.com/ClementRingot/rap-transpiler/releases)
(tag `v*`) et produit par la CI à chaque commit (artefact `rap-transpiler-vscode`).

Pour utiliser une autre version de rapt (un clone en cours de développement, par exemple) :
réglage `rapt.cliPath`. Sans version intégrée (extension construite sans `pnpm run stage`),
l'extension prend un clone rap-transpiler ou le `node_modules` d'un dossier de l'espace de
travail, puis la commande `rapt` du PATH.

## Réglages

| Réglage | Défaut | Rôle |
|---|---|---|
| `rapt.cliPath` | vide | `cli.js` de rapt ou dossier d'un clone (vide : rapt intégré) |
| `rapt.nodePath` | vide | Node.js 22+ qui lance rapt (vide : celui de VS Code) |
| `rapt.checkOnSave` | `true` | vérifier à chaque enregistrement |
| `rapt.dev.port` | `8080` | port de l'application |
| `rapt.dev.openUi` | `true` | ouvrir le navigateur au démarrage de rapt dev |

## Publier une version

Pousser un tag `v1.2.3` : le workflow `release.yml` construit le `.vsix` (version 1.2.3) et le
joint à la release GitHub du tag. Il le publie aussi sur le Visual Studio Marketplace si le
secret `VSCE_PAT` est défini (éditeur `clementringot` à créer sur le Marketplace), et sur
Open VSX (VSCodium, Cursor…) si le secret `OVSX_PAT` est défini.

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## Construire l'extension

```sh
pnpm install && pnpm build
cd packages/vscode && pnpm run package    # rap-transpiler-vscode.vsix (~31 Mo)
```

`pnpm run package` compile l'extension (esbuild), prépare `rapt/` (`scripts/stage-rapt.mjs` :
paquets du dépôt et dépendances installés depuis le registre npm, fichiers inutiles retirés),
puis appelle `vsce package`.
