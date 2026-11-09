/** Generation of the OpenUI5 UI of the application (`ui/` folder, decision D10). */

import type { Model } from "@rap-transpiler/model";
import { buildUiLayout } from "./layout.js";
import { APP_VIEW, COMPONENT, indexHtml, LIST_CONTROLLER, manifest, OBJECT_CONTROLLER, SUPPORT } from "./static.js";
import { views } from "./views.js";

export { buildUiLayout, type UiLayout } from "./layout.js";

export function generateUi(model: Model): Array<{ path: string; content: string }> {
  const layout = buildUiLayout(model);
  return [
    { path: "index.html", content: indexHtml(layout) },
    { path: "manifest.json", content: manifest(layout) },
    { path: "Component.js", content: COMPONENT },
    { path: "view/App.view.xml", content: APP_VIEW },
    ...views(layout),
    { path: "controller/List.controller.js", content: LIST_CONTROLLER },
    { path: "controller/Object.controller.js", content: OBJECT_CONTROLLER },
    { path: "controller/support.js", content: SUPPORT },
    { path: "model/layout.json", content: `${JSON.stringify(layout, null, 2)}\n` },
  ];
}
