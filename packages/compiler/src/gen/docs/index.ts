/**
 * The documentation app of `rapt dev` (decision D49): the documentation of rap-transpiler (README,
 * guide, features, diagnostics, decisions…) as an OpenUI5 application of the development
 * launchpad, with a search. The pages are rendered from Markdown when the app is built.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { headingId, pageId, type RenderOptions, renderMarkdown } from "./markdown.js";

export interface DocPage {
  id: string;
  title: string;
  /** The file it comes from (README.md, docs/GUIDE.md…). */
  file: string;
  html: string;
  /** Plain text, for the search. */
  text: string;
  headings: Array<{ id: string; title: string; level: number }>;
}

/** The order of the pages; the others follow, by name. */
const ORDER = ["README.md", "GUIDE.md", "FEATURES.md", "ANNOTATIONS.md", "DIAGNOSTICS.md", "DEPLOYMENT.md", "MCP.md", "UTILITIES.md", "REMOTE_APIS.md", "KNOWN_GAPS.md", "ROADMAP.md", "AGENTS.md", "DECISIONS.md", "PLAN.md"];

/** The folder of the documentation: copied next to the compiled compiler, or that of the repository. */
export function documentationDir(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, "..", "..", "..", "docs"), path.join(here, "..", "..", "..", "..", "..", "docs")]) {
    if (existsSync(path.join(candidate, "FEATURES.md"))) {
      return candidate;
    }
  }
  return undefined;
}

/** The Markdown files of the documentation folder (and, in the repository, the files of its root). */
function markdownFiles(dir: string): string[] {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md")).map((f) => path.join(dir, f));
  const root = path.dirname(dir);
  for (const name of ["README.md", "KNOWN_GAPS.md", "AGENTS.md", "PLAN.md"]) {
    if (!files.some((f) => path.basename(f) === name) && existsSync(path.join(root, name)) && existsSync(path.join(root, "pnpm-workspace.yaml"))) {
      files.push(path.join(root, name));
    }
  }
  const rank = (f: string): number => {
    const i = ORDER.indexOf(path.basename(f));
    return i < 0 ? ORDER.length : i;
  };
  return files.sort((a, b) => rank(a) - rank(b) || path.basename(a).localeCompare(path.basename(b)));
}

export function documentationPages(dir = documentationDir(), options: RenderOptions = {}): DocPage[] {
  if (dir === undefined) {
    return [];
  }
  return markdownFiles(dir).map((file) => {
    const markdown = readFileSync(file, "utf8");
    const headings = [...markdown.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((m) => ({ id: `anchor-${headingId(m[2] ?? "")}`, title: (m[2] ?? "").replace(/`/g, ""), level: m[1]?.length ?? 1 }));
    const name = path.basename(file);
    return {
      id: pageId(name),
      title: name === "README.md" ? "rap-transpiler" : (headings[0]?.title ?? name),
      file: name,
      html: renderMarkdown(markdown, options),
      text: markdown.replace(/[#*`|>[\]()_-]+/g, " ").replace(/\s+/g, " "),
      headings: headings.filter((h) => h.level > 1),
    };
  });
}

const INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Documentation – rap-transpiler</title>
  <script id="sap-ui-bootstrap" src="../resources/sap-ui-core.js"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-async="true"
    data-sap-ui-compat-version="edge"
    data-sap-ui-resource-roots='{"rapt.docs": "./"}'
    data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"></script>
  <link rel="stylesheet" href="css/style.css">
  <style>html, body { height: 100%; margin: 0; }</style>
</head>
<body class="sapUiBody" id="content">
  <div data-sap-ui-component data-name="rapt.docs" data-id="container" data-height="100%" data-settings='{"id": "docs"}' style="height: 100%"></div>
</body>
</html>
`;

const MANIFEST = `${JSON.stringify(
  {
    _version: "1.65.0",
    "sap.app": { id: "rapt.docs", type: "application", title: "Documentation", applicationVersion: { version: "1.0.0" }, dataSources: { pages: { uri: "pages.json", type: "JSON" } } },
    "sap.ui": { technology: "UI5", deviceTypes: { desktop: true, tablet: true, phone: true } },
    "sap.ui5": {
      rootView: { viewName: "rapt.docs.view.Docs", type: "XML", id: "app" },
      dependencies: { minUI5Version: "1.136.0", libs: { "sap.m": {}, "sap.f": {} } },
      models: { "": { type: "sap.ui.model.json.JSONModel", dataSource: "pages" }, ui: { type: "sap.ui.model.json.JSONModel" } },
      routing: {
        config: { routerClass: "sap.m.routing.Router", async: true },
        routes: [
          { pattern: "", name: "home" },
          { pattern: "page/{page}/:anchor:", name: "page" },
        ],
      },
    },
  },
  null,
  2,
)}\n`;

const COMPONENT = `sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {
  "use strict";
  return UIComponent.extend("rapt.docs.Component", {
    metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },
    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      // the view listens to the routes: the router starts once it is created
      var oRouter = this.getRouter();
      this.rootControlLoaded().then(function () {
        oRouter.initialize();
      });
    }
  });
});
`;

const VIEW = `<mvc:View controllerName="rapt.docs.controller.Docs" xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:f="sap.f" xmlns:core="sap.ui.core" displayBlock="true" height="100%">
  <Page id="shell" showHeader="{= !!\${ui>/shell} }" enableScrolling="false">
    <customHeader>
      <f:ShellBar id="shellBar" title="Documentation" secondTitle="{ui>/shell/title}" homeIcon="{ui>/shell/logo}" homeIconPressed=".onHome" showNavButton="false"/>
    </customHeader>
    <content>
      <SplitApp id="split" mode="ShowHideMode">
        <masterPages>
          <Page id="master" title="Documentation" class="raptDocsMaster">
            <subHeader>
              <Toolbar><SearchField id="search" liveChange=".onSearch" placeholder="Search the documentation" width="100%"/></Toolbar>
            </subHeader>
            <List id="pages" items="{path: '/', templateShareable: false}" mode="SingleSelectMaster" selectionChange=".onSelect">
              <StandardListItem title="{title}" description="{file}" type="Active" counter="{= \${ui>/hits}[\${id}] || 0 }">
                <customData><core:CustomData key="id" value="{id}"/></customData>
              </StandardListItem>
            </List>
          </Page>
        </masterPages>
        <detailPages>
          <Page id="detail" title="{ui>/title}" class="raptDocsDetail">
            <core:HTML id="html" sanitizeContent="false"/>
          </Page>
        </detailPages>
      </SplitApp>
    </content>
  </Page>
</mvc:View>
`;

const CONTROLLER = `sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (Controller, Filter, FilterOperator) {
  "use strict";

  return Controller.extend("rapt.docs.controller.Docs", {
    onInit: function () {
      var that = this;
      this._ui = this.getOwnerComponent().getModel("ui");
      this._ui.setData({ title: "", hits: {} });
      this.getOwnerComponent().getRouter().attachRouteMatched(this._onRoute, this);
      // behind the development launchpad: its shell bar, the way home
      fetch("/launchpad/config", { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : undefined; })
        .then(function (c) { if (c && c.user) { that._ui.setProperty("/shell", { title: c.title, home: c.home || "/", logo: c.logo || "" }); } })
        .catch(function () { /* standalone */ });
      // links between pages and to the headings of a page
      this.byId("html").attachAfterRendering(function () {
        var oDom = that.byId("html").getDomRef();
        if (oDom && that._anchor) {
          var oTarget = document.getElementById("anchor-" + that._anchor);
          if (oTarget) { oTarget.scrollIntoView(); }
        }
      });
    },

    _pages: function () {
      return this.getView().getModel().getData() || [];
    },

    _onRoute: function (oEvent) {
      var that = this;
      var oModel = this.getView().getModel();
      var show = function () {
        var aPages = that._pages();
        var sId = oEvent.getParameter("name") === "page" ? oEvent.getParameter("arguments").page : (aPages[0] || {}).id;
        that._anchor = oEvent.getParameter("arguments").anchor;
        var oPage = aPages.find(function (p) { return p.id === sId; }) || aPages[0];
        if (!oPage) { return; }
        that._ui.setProperty("/title", oPage.title);
        that.byId("html").setContent("<div class='raptDoc'>" + oPage.html + "</div>");
        var oList = that.byId("pages");
        oList.getItems().forEach(function (oItem) {
          if (oItem.data("id") === oPage.id) { oList.setSelectedItem(oItem); }
        });
        that.byId("split").toDetail(that.createId("detail"));
        if (!that._anchor) { that.byId("detail").scrollTo(0); }
      };
      if (oModel.getData() && oModel.getData().length) {
        show();
      } else {
        oModel.dataLoaded().then(show);
      }
    },

    onSelect: function (oEvent) {
      var sId = oEvent.getParameter("listItem").data("id");
      this.getOwnerComponent().getRouter().navTo("page", { page: sId });
    },

    onHome: function () {
      window.location.assign(this._ui.getProperty("/shell/home") || "/");
    },

    /** The pages containing the words searched, with the number of hits. */
    onSearch: function (oEvent) {
      var sQuery = (oEvent.getParameter("newValue") || "").trim().toLowerCase();
      var oHits = {};
      if (sQuery !== "") {
        this._pages().forEach(function (p) {
          var sText = (p.title + " " + p.text).toLowerCase();
          var n = 0;
          var i = sText.indexOf(sQuery);
          while (i >= 0) { n++; i = sText.indexOf(sQuery, i + sQuery.length); }
          oHits[p.id] = n;
        });
      }
      this._ui.setProperty("/hits", oHits);
      this.byId("pages").getBinding("items").filter(sQuery === "" ? [] : new Filter({
        path: "id",
        test: function (sId) { return (oHits[sId] || 0) > 0; }
      }));
    }
  });
});
`;

const STYLE = `.raptDoc { padding: 1rem 2rem 3rem 2rem; max-width: 60rem; font-family: var(--sapFontFamily); color: var(--sapTextColor); line-height: 1.5; }
.raptDoc h1 { font-size: 1.75rem; margin: 0.5rem 0 1rem; }
.raptDoc h2 { font-size: 1.35rem; margin: 2rem 0 0.75rem; border-bottom: 1px solid var(--sapGroup_TitleBorderColor); padding-bottom: 0.25rem; }
.raptDoc h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
.raptDoc code { font-family: var(--sapFontFamilyMonospace, monospace); background: var(--sapNeutralBackground, #eef0f2); padding: 0 0.25rem; border-radius: 0.25rem; font-size: 0.875em; }
.raptDoc pre { background: var(--sapShell_Background, #eff1f2); padding: 0.75rem 1rem; border-radius: 0.5rem; overflow-x: auto; }
.raptDoc pre code { background: none; padding: 0; }
.raptDoc table { border-collapse: collapse; margin: 0.75rem 0; font-size: 0.875rem; }
.raptDoc th, .raptDoc td { border: 1px solid var(--sapList_BorderColor, #d9d9d9); padding: 0.375rem 0.5rem; vertical-align: top; text-align: left; }
.raptDoc th { background: var(--sapList_HeaderBackground, #f5f6f7); }
.raptDoc blockquote { margin: 0.75rem 0; padding: 0.25rem 1rem; border-left: 0.25rem solid var(--sapInformativeColor, #0070f2); background: var(--sapInformationBackgroundColor, #f5faff); }
.raptDoc a { color: var(--sapLinkColor); }
`;

/** The files of the documentation app (`docs/` of the development build). */
export function generateDocsApp(pages: DocPage[] = documentationPages()): Array<{ path: string; content: string }> {
  return [
    { path: "index.html", content: INDEX },
    { path: "manifest.json", content: MANIFEST },
    { path: "Component.js", content: COMPONENT },
    { path: "view/Docs.view.xml", content: VIEW },
    { path: "controller/Docs.controller.js", content: CONTROLLER },
    { path: "css/style.css", content: STYLE },
    { path: "pages.json", content: JSON.stringify(pages) },
  ];
}
