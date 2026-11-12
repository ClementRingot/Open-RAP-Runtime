/** Generation of the OpenUI5 UI of the application (`ui/` folder, decision D10). */

import type { Model } from "@open-rap/model";
import { buildUiLayout } from "./layout.js";
import { APP_CONTROLLER, APP_VIEW, CHART, COMPONENT, CONDITIONS, FILTERS, indexHtml, LIST_CONTROLLER, manifest, OBJECT_CONTROLLER, OVERVIEW_CONTROLLER, STYLE, SUPPORT, VARIANTS } from "./static.js";
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
    { path: "controller/App.controller.js", content: APP_CONTROLLER },
    { path: "controller/List.controller.js", content: LIST_CONTROLLER },
    { path: "controller/Object.controller.js", content: OBJECT_CONTROLLER },
    { path: "controller/support.js", content: SUPPORT },
    { path: "controller/filters.js", content: FILTERS },
    { path: "controller/conditions.js", content: CONDITIONS },
    { path: "controller/variants.js", content: VARIANTS },
    { path: "controller/Chart.js", content: CHART },
    ...(layout.overview === undefined ? [] : [{ path: "controller/Overview.controller.js", content: OVERVIEW_CONTROLLER }]),
    { path: "css/style.css", content: STYLE },
    { path: "model/layout.json", content: `${JSON.stringify(layout, null, 2)}\n` },
  ];
}
