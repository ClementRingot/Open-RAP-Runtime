# open-rap-runtime

## 0.2.0

### Minor Changes

- The launchpad of the workspace in development (D75): `rapt launchpad dev <launchpad.json>` and
  *RAP: Start the launchpad* in VS Code run every application of the workspace behind the
  launchpad, each one rebuilt on save; the commands of VS Code are greyed out until they are
  possible.
- A Web API or a Fiori application, chosen at the creation (D76): `rapt new --binding-type
  webapi`, the wizards of VS Code (a business object, or a binding alone with the name SAP would
  give); a Web API is never in the launchpad (LPD011) and has no floorplan; the UI binding is
  preferred when a service has both.
- The versions are managed by Changesets (D77): each change carries a changeset, the *Version
  packages* pull request bumps the versions and writes the changelogs, its merge releases.

### Patch Changes

- `rapt launchpad dev`: a regeneration of the launchpad that throws no longer stops the next ones.
