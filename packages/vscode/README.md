# RAP Transpiler pour VS Code

Vérifier, générer et lancer un business object RAP avec [rap-transpiler](https://github.com/ClementRingot/rap-transpiler),
sans système SAP. L'extension ne compile rien elle-même : elle appelle la CLI `rapt` (`--json`)
et en affiche les résultats.

## Fonctions

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

## Prérequis

- Node.js 22 ou plus.
- La CLI `rapt`. L'extension la cherche dans cet ordre : le réglage `rapt.cliPath` (chemin du
  `cli.js` ou du clone rap-transpiler), un clone rap-transpiler ouvert dans l'espace de travail
  (`packages/compiler/dist/cli.js`, après `pnpm install && pnpm build`), le `node_modules` d'un
  dossier de l'espace de travail, puis la commande `rapt` du PATH.

## Réglages

| Réglage | Défaut | Rôle |
|---|---|---|
| `rapt.cliPath` | vide | `cli.js` de rapt ou dossier du clone |
| `rapt.nodePath` | `node` | Node.js qui lance rapt |
| `rapt.checkOnSave` | `true` | vérifier à chaque enregistrement |
| `rapt.dev.port` | `8080` | port de l'application |
| `rapt.dev.openUi` | `true` | ouvrir le navigateur au démarrage de rapt dev |

## Construire l'extension

```sh
pnpm install && pnpm build
cd packages/vscode && pnpm run package    # rap-transpiler-vscode.vsix
code --install-extension rap-transpiler-vscode.vsix
```
