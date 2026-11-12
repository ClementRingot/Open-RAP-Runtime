/**
 * The fixed files of the generated UI: bootstrap, component, manifest, and the generic
 * controllers of the List Report and the Object Page, driven by `model/layout.json`.
 * Plain OpenUI5 1.136 (sap.m, sap.f, sap.uxap, sap.ui.layout), ODataModel V4.
 */

import type { UiLayout } from "./layout.js";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function indexHtml(layout: UiLayout): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(layout.title)}</title>
  <script id="sap-ui-bootstrap" src="../resources/sap-ui-core.js"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-async="true"
    data-sap-ui-compat-version="edge"
    data-sap-ui-resource-roots='{"rapt.app": "./"}'
    data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"></script>
  <style>html, body { height: 100%; margin: 0; }</style>
  <link rel="stylesheet" href="css/style.css">
</head>
<body class="sapUiBody" id="content">
  <div data-sap-ui-component data-name="rapt.app" data-id="container" data-height="100%" data-settings='{"id": "rapt"}' style="height: 100%"></div>
</body>
</html>
`;
}

/**
 * The content of the shell page sits between the shell bar and the bottom of the window: the
 * inline `height: 100%` that sap.m.App writes on its ancestors would push it one shell bar below
 * the window, and the document would scroll as well as the page.
 */
export const SHELL_STYLE = `.raptShell > section { height: auto !important; }
`;

/** Filter bar of the list report: fields and buttons aligned on the bottom of the inputs. */
export const STYLE = `${SHELL_STYLE}.raptFilterBar { column-gap: 1rem; row-gap: 0.5rem; }
.raptFilterBar .raptFilterItem { margin: 0; }
.raptFilterBar .raptFilterButtons { margin-left: auto; align-items: flex-end; }
.raptChartArea { padding: 0 0 1rem 0; }
.raptChart { width: 100%; box-sizing: border-box; padding: 0.5rem 0; }
.raptChart svg { display: block; }
.raptChartLabel { font-family: var(--sapFontFamily); font-size: 11px; fill: var(--sapContent_LabelColor, #556b82); }
.raptChartGrid { stroke: var(--sapList_BorderColor, #e5e5e5); stroke-width: 1; }
.raptChartItem { cursor: pointer; opacity: 0.9; }
.raptChartItem:hover { opacity: 1; }
.raptChartSelected { stroke: var(--sapContent_FocusColor, #0070f2); stroke-width: 3; opacity: 1; }
.raptChartHole { fill: var(--sapTile_Background, #fff); }
.raptChartEmpty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--sapContent_LabelColor); }
.raptCards { gap: 1rem; padding-top: 1rem; }
.raptCards .raptCard { max-width: 100%; }
`;

export function manifest(layout: UiLayout): string {
  const routes: unknown[] = [];
  const targets: Record<string, unknown> = {};
  // the start page (D53): an Overview Page, a form to create (form entry), or a list report
  const startPage = layout.pages.find((p) => p.set === layout.start);
  if (layout.overview !== undefined) {
    routes.push({ pattern: "", name: "Overview", target: "Overview" });
    targets["Overview"] = { name: "Overview", id: "Overview", level: 0 };
  } else if (startPage?.floorplan === "formEntry") {
    routes.push({ pattern: "", name: `${startPage.set}FormEntry`, target: `${startPage.set}Object` });
  }
  for (const page of layout.pages) {
    if (page.list !== undefined) {
      const start = page.set === layout.start && layout.overview === undefined && page.floorplan !== "formEntry";
      routes.push({ pattern: start ? "" : `${page.set}`, name: `${page.set}List`, target: `${page.set}List` });
      targets[`${page.set}List`] = { name: `${page.set}List`, id: `${page.set}List`, level: 1 };
    }
    if (page.insertable) {
      routes.push({ pattern: `${page.set}/new`, name: `${page.set}New`, target: `${page.set}Object` });
    }
    routes.push({ pattern: `${page.set}({key})`, name: `${page.set}Object`, target: `${page.set}Object` });
    targets[`${page.set}Object`] = { name: `${page.set}Object`, id: `${page.set}Object`, level: page.list === undefined ? 3 : 2 };
  }
  return `${JSON.stringify(
    {
      "_version": "1.65.0",
      "sap.app": {
        id: "rapt.app",
        type: "application",
        title: layout.title,
        applicationVersion: { version: "1.0.0" },
        dataSources: {
          mainService: { uri: layout.servicePath, type: "OData", settings: { odataVersion: "4.0" } },
          layout: { uri: "model/layout.json", type: "JSON" },
        },
      },
      "sap.ui": { technology: "UI5", deviceTypes: { desktop: true, tablet: true, phone: true } },
      "sap.ui5": {
        rootView: { viewName: "rapt.app.view.App", type: "XML", id: "appView" },
        dependencies: { minUI5Version: "1.136.0", libs: { "sap.m": {}, "sap.f": {}, "sap.uxap": {}, "sap.ui.layout": {} } },
        contentDensities: { compact: true, cozy: true },
        models: {
          "": { dataSource: "mainService", preload: true, settings: { autoExpandSelect: true, earlyRequests: true, operationMode: "Server" } },
          layout: { dataSource: "layout", type: "sap.ui.model.json.JSONModel" },
        },
        routing: {
          config: { routerClass: "sap.m.routing.Router", type: "View", viewType: "XML", path: "rapt.app.view", controlId: "app", controlAggregation: "pages", async: true },
          routes,
          targets,
        },
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * The root view: the pages of the application in an App; above them the shell bar of the
 * launchpad (D37) when the application is served behind one (home, user, logout).
 */
export const APP_VIEW = `<mvc:View controllerName="rapt.app.controller.App" xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:f="sap.f" displayBlock="true" height="100%">
  <Page id="shell" showHeader="{= !!\${ui>/shell} }" enableScrolling="false" class="raptShell">
    <customHeader>
      <f:ShellBar id="shellBar" title="{ui>/shell/title}" secondTitle="{ui>/shell/launchpad}" homeIcon="{ui>/shell/logo}" homeIconTooltip="Home" homeIconPressed=".onHome" avatarPressed=".onAvatarPressed">
        <f:profile>
          <Avatar id="avatar" initials="{ui>/shell/user/initials}" tooltip="{ui>/shell/user/name}"/>
        </f:profile>
      </f:ShellBar>
    </customHeader>
    <content>
      <App id="app"/>
    </content>
  </Page>
</mvc:View>
`;

export const APP_CONTROLLER = `sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/ResponsivePopover",
  "sap/m/VBox",
  "sap/m/Text",
  "sap/m/Button"
], function (Controller, ResponsivePopover, VBox, Text, Button) {
  "use strict";

  /** The shell bar of the launchpad the application is served behind (D37). */
  return Controller.extend("rapt.app.controller.App", {
    onHome: function () {
      window.location.assign(this.getView().getModel("ui").getProperty("/shell/home") || "/");
    },

    onAvatarPressed: function (oEvent) {
      if (!this._oUserMenu) {
        var oShell = this.getView().getModel("ui").getProperty("/shell");
        var aItems = [];
        if (oShell.user.id !== oShell.user.name) {
          aItems.push(new Text({ text: oShell.user.id }));
        }
        if (!oShell.logout) {
          aItems.push(new Text({ text: "Development user (no login)" }));
        }
        this._oUserMenu = new ResponsivePopover(this.createId("userMenu"), { title: oShell.user.name, placement: "Bottom", contentMinWidth: "12rem" });
        if (aItems.length > 0) {
          this._oUserMenu.addContent(new VBox({ items: aItems }).addStyleClass("sapUiSmallMargin"));
        }
        if (oShell.logout) {
          this._oUserMenu.setBeginButton(new Button(this.createId("logout"), {
            text: "Sign Out",
            icon: "sap-icon://log",
            press: function () {
              window.location.assign(oShell.logout);
            }
          }));
        }
        this.getView().addDependent(this._oUserMenu);
      }
      this._oUserMenu.openBy(oEvent.getParameter("avatar"));
    }
  });
});
`;

export const COMPONENT = `sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Messaging"
], function (UIComponent, JSONModel, Messaging) {
  "use strict";

  return UIComponent.extend("rapt.app.Component", {
    metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      var oUi = new JSONModel({ editMode: false, createMode: false, draft: false, busy: false, tableSelected: false, childSelected: false, permissions: {}, user: undefined, collab: { users: [] } });
      var that = this;
      this._aUserCallbacks = [];
      this.setModel(oUi, "ui");
      this.setModel(Messaging.getMessageModel(), "message");
      // the creations the user may perform (global authorization): Create is hidden otherwise
      var sService = this.getManifestEntry("/sap.app/dataSources/mainService/uri");
      fetch(sService + "$permissions", { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(function (oResponse) { return oResponse.ok ? oResponse.json() : {}; })
        .then(function (oPermissions) {
          oUi.setProperty("/permissions", oPermissions);
          // the user, for the draft markers (D58)
          oUi.setProperty("/user", oPermissions.$user || "");
          that._fireUser();
        })
        .catch(function () { /* the permissions stay unknown: every button is shown */ oUi.setProperty("/user", ""); that._fireUser(); });
      // behind a launchpad (D37): its shell bar above the pages; standalone, the request fails
      var sTitle = this.getManifestEntry("/sap.app/title");
      fetch("/launchpad/config", { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(function (oResponse) { return oResponse.ok ? oResponse.json() : undefined; })
        .then(function (oLaunchpad) {
          if (oLaunchpad && oLaunchpad.user) {
            oUi.setProperty("/shell", { title: sTitle, launchpad: oLaunchpad.title, home: oLaunchpad.home || "/", logo: oLaunchpad.logo || "", user: oLaunchpad.user, logout: oLaunchpad.logout || "" });
          }
        })
        .catch(function () { /* not behind a launchpad */ });
      this.getRouter().initialize();
    },

    /** Calls back with the user once known (from $permissions). */
    whenUser: function (fnCallback) {
      var sUser = this.getModel("ui").getProperty("/user");
      if (sUser !== undefined) {
        fnCallback(sUser);
      } else {
        this._aUserCallbacks.push(fnCallback);
      }
    },

    _fireUser: function () {
      var sUser = this.getModel("ui").getProperty("/user");
      (this._aUserCallbacks || []).splice(0).forEach(function (fn) { fn(sUser); });
    },

    /** A change was saved: the lists show it when the user comes back to them. */
    markStale: function () {
      this._iVersion = (this._iVersion || 0) + 1;
    },

    /** Whether the list of an entity set must be refreshed (a change since it was last shown). */
    takeStale: function (sSet) {
      this._mSeen = this._mSeen || {};
      var bStale = (this._mSeen[sSet] || 0) !== (this._iVersion || 0);
      this._mSeen[sSet] = this._iVersion || 0;
      return bStale;
    },

    /** The transient context of an instance being created (List Report → Object Page). */
    setTransient: function (oContext) {
      this._oTransient = oContext;
    },

    getTransient: function () {
      return this._oTransient;
    }
  });
});
`;

/** Helpers shared by the controllers: layout lookups, key predicates, actions. */
export const SUPPORT = `sap.ui.define([
  "sap/m/Dialog",
  "sap/m/Button",
  "sap/m/Label",
  "sap/m/Input",
  "sap/m/DatePicker",
  "sap/m/CheckBox",
  "sap/ui/layout/form/SimpleForm",
  "sap/ui/core/Messaging",
  "sap/m/TableSelectDialog",
  "sap/m/Column",
  "sap/m/ColumnListItem",
  "sap/m/Text",
  "sap/ui/model/Filter",
  "sap/m/Select",
  "sap/ui/core/Item"
], function (Dialog, Button, Label, Input, DatePicker, CheckBox, SimpleForm, Messaging, TableSelectDialog, Column, ColumnListItem, Text, Filter, Select, Item) {
  "use strict";

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  var support = {
    page: function (oController, sSet) {
      return oController.getOwnerComponent().getModel("layout").getProperty("/pages").find(function (p) {
        return p.set === sSet;
      });
    },

    action: function (oPage, sName, aActions) {
      return (aActions || oPage.actions).find(function (a) {
        return a.name === sName;
      });
    },

    /** The key of an instance as written in the URL: \`3f25…\` or \`A='x',B=1\`. */
    keyOf: function (sPath) {
      var iOpen = sPath.lastIndexOf("(");
      return sPath.slice(iOpen + 1, sPath.length - 1);
    },

    keyPredicate: function (oPage, oData) {
      var aKeys = oPage.keys.map(function (sKey) {
        var vValue = oData[sKey];
        var sEdm = oPage.fields[sKey] ? oPage.fields[sKey].edm : "Edm.String";
        var sText = sEdm === "Edm.String" ? "'" + String(vValue).replace(/'/g, "''") + "'" : String(vValue);
        return { key: sKey, text: sText };
      });
      return aKeys.length === 1 ? aKeys[0].text : aKeys.map(function (k) { return k.key + "=" + k.text; }).join(",");
    },

    dateText: function (oDate) {
      return oDate.getFullYear() + "-" + pad(oDate.getMonth() + 1) + "-" + pad(oDate.getDate());
    },

    /** Asks for the parameters of an action; resolves null when cancelled. */
    askParameters: function (oView, oAction) {
      if (oAction.parameters.length === 0) {
        return Promise.resolve({});
      }
      return new Promise(function (resolve) {
        var aControls = [];
        var aContent = [];
        oAction.parameters.forEach(function (oParameter) {
          var oControl;
          if (oParameter.kind === "date") {
            oControl = new DatePicker({ valueFormat: "yyyy-MM-dd" });
          } else if (oParameter.kind === "boolean") {
            oControl = new CheckBox();
          } else if (oParameter.kind === "enum") {
            oControl = new Select({ forceSelection: true, items: oParameter.options.map(function (o) { return new Item({ key: o.key, text: o.text }); }) });
          } else if (oParameter.valueHelp) {
            oControl = new Input({ showValueHelp: true });
            oControl.attachValueHelpRequest(function () {
              var oInput = this;
              support.valueHelp(oView, oParameter.valueHelp, false).then(function (aValues) {
                if (aValues.length > 0) {
                  oInput.setValue(aValues[0]);
                }
              });
            }, oControl);
          } else {
            oControl = new Input({ type: oParameter.kind === "integer" || oParameter.kind === "decimal" ? "Number" : "Text" });
          }
          aControls.push({ parameter: oParameter, control: oControl });
          aContent.push(new Label({ text: oParameter.label, labelFor: oControl }), oControl);
        });
        var oDialog = new Dialog({
          title: oAction.label,
          content: [new SimpleForm({ editable: true, content: aContent })],
          beginButton: new Button({
            text: oAction.label,
            type: "Emphasized",
            press: function () {
              var oValues = {};
              aControls.forEach(function (o) {
                var p = o.parameter;
                if (p.kind === "boolean") {
                  oValues[p.name] = o.control.getSelected();
                } else if (p.kind === "enum") {
                  oValues[p.name] = o.control.getSelectedKey();
                } else if (p.kind === "integer") {
                  oValues[p.name] = o.control.getValue() === "" ? 0 : Number(o.control.getValue());
                } else {
                  oValues[p.name] = o.control.getValue();
                }
              });
              oDialog.close();
              resolve(oValues);
            }
          }),
          endButton: new Button({
            text: "Cancel",
            press: function () {
              oDialog.close();
              resolve(null);
            }
          }),
          afterClose: function () {
            oDialog.destroy();
          }
        });
        oView.addDependent(oDialog);
        oDialog.open();
      });
    },

    /** Calls an action (or a function); resolves its return value context, or null when cancelled. */
    invoke: function (oView, oPage, oAction, oContext) {
      return support.askParameters(oView, oAction).then(function (oValues) {
        if (oValues === null) {
          return null;
        }
        Messaging.removeAllMessages();
        var oModel = oView.getModel();
        var oOperation = oAction.static
          ? oModel.bindContext("/" + oPage.set + "/" + oAction.qualified + "(...)")
          : oModel.bindContext(oAction.qualified + "(...)", oContext, { $$inheritExpandSelect: true });
        Object.keys(oValues).forEach(function (sName) {
          oOperation.setParameter(sName, oValues[sName]);
        });
        return oOperation.invoke();
      });
    },

    /** The descriptions of the values of a value help (text entity), by value: { EUR: "Euro" }. */
    valueHelpTexts: function (oView, oHelp) {
      if (!oHelp.text) {
        return Promise.resolve({});
      }
      var sService = oView.getModel().getServiceUrl();
      var sLanguage = (navigator.language || "en").slice(0, 2).toUpperCase();
      var sKey = { EN: "E", DE: "D", FR: "F", ES: "S", IT: "I", PT: "P", NL: "N", JA: "J", ZH: "1", RU: "R", PL: "L" }[sLanguage] || "E";
      var oText = oHelp.text;
      var sFilter = oText.language ? "&$filter=" + encodeURIComponent(oText.language + " eq '" + sKey + "' or " + oText.language + " eq 'E'") : "";
      return fetch(sService + oText.set + "?$select=" + [oText.key, oText.element].concat(oText.language ? [oText.language] : []).join(",") + sFilter, {
        credentials: "same-origin",
        headers: { accept: "application/json" }
      }).then(function (oResponse) {
        return oResponse.ok ? oResponse.json() : { value: [] };
      }).then(function (oData) {
        var mTexts = {};
        (oData.value || []).forEach(function (oRow) {
          var sValue = String(oRow[oText.key]);
          if (mTexts[sValue] === undefined || (oText.language && oRow[oText.language] === sKey)) {
            mTexts[sValue] = oRow[oText.element];
          }
        });
        return mTexts;
      }).catch(function () {
        return {};
      });
    },

    /**
     * Opens the value help of a field; resolves the chosen values (none when cancelled). With the
     * context of the instance, the bindings of usage filter restrict the list, and the chosen rows
     * are given as second argument (results of the additional bindings).
     */
    valueHelp: function (oView, oHelp, bMulti, oContext) {
      return support.valueHelpTexts(oView, oHelp).then(function (mTexts) {
        return support._valueHelpDialog(oView, oHelp, bMulti, mTexts, oContext);
      });
    },

    /** The filters of the additional bindings of usage filter, from the values of the instance. */
    valueHelpFilters: function (oHelp, oContext) {
      if (!oContext || !oHelp.bindings) {
        return [];
      }
      return oHelp.bindings.filter(function (b) {
        var vValue = oContext.getProperty(b.local);
        return b.usage !== "result" && vValue !== undefined && vValue !== null && vValue !== "";
      }).map(function (b) {
        return new Filter(b.element, "EQ", oContext.getProperty(b.local));
      });
    },

    /** Copies the elements of a chosen row to the local elements (additional bindings of usage result). */
    applyValueHelpResults: function (oHelp, oContext, oRow) {
      (oHelp.bindings || []).forEach(function (b) {
        if (b.usage !== "filter" && oRow && oRow[b.element] !== undefined) {
          oContext.setProperty(b.local, oRow[b.element]);
        }
      });
    },

    /**
     * Checks a typed value against the value help (useForValidation) and fills the additional
     * bindings of usage result; resolves false when the value is not in the list.
     */
    checkValueHelp: function (oView, oHelp, oContext, sValue) {
      if (sValue === "" || sValue === null || sValue === undefined) {
        return Promise.resolve(true);
      }
      var aConditions = [oHelp.element + " eq '" + String(sValue).replace(/'/g, "''") + "'"];
      support.valueHelpFilters(oHelp, oContext).forEach(function (oFilter) {
        aConditions.push(oFilter.getPath() + " eq '" + String(oFilter.getValue1()).replace(/'/g, "''") + "'");
      });
      return fetch(oView.getModel().getServiceUrl() + oHelp.set + "?$top=1&$filter=" + encodeURIComponent(aConditions.join(" and ")), {
        credentials: "same-origin",
        headers: { accept: "application/json" }
      }).then(function (oResponse) {
        return oResponse.ok ? oResponse.json() : { value: [] };
      }).then(function (oData) {
        var oRow = (oData.value || [])[0];
        if (oRow) {
          support.applyValueHelpResults(oHelp, oContext, oRow);
        }
        return oRow !== undefined;
      }).catch(function () {
        return true;
      });
    },

    _valueHelpDialog: function (oView, oHelp, bMulti, mTexts, oContext) {
      var bTexts = Object.keys(mTexts).length > 0;
      var aColumns = oHelp.columns.slice();
      if (bTexts) {
        aColumns.splice(1, 0, { property: oHelp.element, label: oHelp.text.label, string: false, text: true });
      }
      return new Promise(function (resolve) {
        var bDone = false;
        var aBase = support.valueHelpFilters(oHelp, oContext);
        var done = function (aValues, aRows) {
          if (!bDone) {
            bDone = true;
            resolve(aValues);
            if (aRows && aRows.length > 0 && oContext) {
              support.applyValueHelpResults(oHelp, oContext, aRows[0]);
            }
          }
        };
        var oDialog = new TableSelectDialog({
          title: oHelp.label,
          multiSelect: bMulti,
          growing: true,
          growingThreshold: 50,
          columns: aColumns.map(function (c) {
            return new Column({ header: new Text({ text: c.label }) });
          }),
          search: function (oEvent) {
            var sValue = (oEvent.getParameter("value") || "").trim();
            var aFilters = oHelp.columns.filter(function (c) { return c.string; }).map(function (c) {
              return new Filter({ path: c.property, operator: "Contains", value1: sValue, caseSensitive: false });
            });
            // values whose description matches
            var sLower = sValue.toLowerCase();
            Object.keys(mTexts).filter(function (k) {
              return String(mTexts[k]).toLowerCase().indexOf(sLower) >= 0;
            }).slice(0, 30).forEach(function (k) {
              aFilters.push(new Filter(oHelp.element, "EQ", k));
            });
            var aAll = aBase.slice();
            if (sValue !== "" && aFilters.length > 0) {
              aAll.push(new Filter({ filters: aFilters, and: false }));
            }
            oEvent.getSource().getBinding("items").filter(aAll.length === 0 ? [] : new Filter({ filters: aAll, and: true }));
          },
          confirm: function (oEvent) {
            var aItems = oEvent.getParameter("selectedItems") || [];
            done(aItems.map(function (oItem) {
              return String(oItem.getBindingContext().getProperty(oHelp.element));
            }), aItems.map(function (oItem) {
              return oItem.getBindingContext().getObject();
            }));
          },
          cancel: function () {
            done([]);
          },
          afterClose: function () {
            done([]);
            oDialog.destroy();
          }
        });
        oDialog.bindAggregation("items", {
          path: "/" + oHelp.set,
          // the elements of the columns and of the additional bindings
          parameters: { $count: true, $select: aColumns.filter(function (c) { return !c.text; }).map(function (c) { return c.property; }).concat((oHelp.bindings || []).map(function (b) { return b.element; })).filter(function (p, i, a) { return a.indexOf(p) === i; }).join(",") },
          filters: aBase.length === 0 ? undefined : new Filter({ filters: aBase, and: true }),
          template: new ColumnListItem({
            cells: aColumns.map(function (c) {
              return c.text
                ? new Text({ text: { path: c.property, formatter: function (v) { return mTexts[v] || ""; } } })
                : new Text({ text: "{" + c.property + "}" });
            })
          })
        });
        oView.addDependent(oDialog);
        oDialog.open();
      });
    },

    errorText: function (oError) {
      var aMessages = Messaging.getMessageModel().getData().filter(function (m) {
        return m.getType() === "Error";
      });
      if (aMessages.length > 0) {
        return aMessages.map(function (m) { return m.getMessage(); }).join("\\n");
      }
      return oError && oError.message ? oError.message : "The request failed";
    }
  };
  return support;
});
`;

/**
 * The conditions of the filter fields, written as in SAP Fiori: `=x`, `!=x`, `>x`, `>=x`, `<x`,
 * `<=x`, `a...b`, `*x*`, `x*`, `*x`; a value alone is "contains" for a text, "equal" otherwise.
 * Pure functions (no control): unit tested in Node.js with a stub of `sap.ui.define`.
 */
export const FILTERS = `sap.ui.define([
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (Filter, FilterOperator) {
  "use strict";

  var NUMERIC = { integer: true, decimal: true, amount: true };
  var PREFIXES = [["!=", "NE"], [">=", "GE"], ["<=", "LE"], [">", "GT"], ["<", "LT"], ["=", "EQ"]];
  var SIGNS = { EQ: "=", NE: "!=", GT: ">", GE: ">=", LT: "<", LE: "<=" };

  function valid(oField, sValue) {
    if (sValue === "") {
      return false;
    }
    if (NUMERIC[oField.kind]) {
      return /^[-+]?\\d*[.,]?\\d+$/.test(sValue);
    }
    if (oField.kind === "digits") {
      return /^\\d+$/.test(sValue) && (!oField.maxLength || sValue.length <= oField.maxLength);
    }
    if (oField.kind === "uuid") {
      return /^[0-9a-fA-F-]+$/.test(sValue);
    }
    return true;
  }

  var filters = {
    /** The condition of a text typed in a filter field; null when it is not valid for the field. */
    parse: function (oField, sText) {
      var sValue = String(sText).trim();
      if (sValue === "") {
        return null;
      }
      var oCondition;
      var iRange = sValue.indexOf("...");
      if (iRange > 0 && !/^[!<>=]/.test(sValue)) {
        oCondition = { op: "BT", values: [sValue.slice(0, iRange).trim(), sValue.slice(iRange + 3).trim()] };
      } else {
        var aPrefix = PREFIXES.find(function (p) { return sValue.indexOf(p[0]) === 0; });
        if (aPrefix) {
          oCondition = { op: aPrefix[1], values: [sValue.slice(aPrefix[0].length).trim()] };
        } else if (oField.kind === "text" && sValue.length > 1 && sValue[0] === "*" && sValue[sValue.length - 1] === "*") {
          oCondition = { op: "Contains", values: [sValue.slice(1, -1)] };
        } else if (oField.kind === "text" && sValue.length > 1 && sValue[sValue.length - 1] === "*") {
          oCondition = { op: "StartsWith", values: [sValue.slice(0, -1)] };
        } else if (oField.kind === "text" && sValue.length > 1 && sValue[0] === "*") {
          oCondition = { op: "EndsWith", values: [sValue.slice(1)] };
        } else {
          oCondition = { op: oField.kind === "text" ? "Contains" : "EQ", values: [sValue] };
        }
      }
      var bValid = oCondition.values.every(function (v) { return valid(oField, v); });
      return bValid ? oCondition : null;
    },

    /** The text of the token of a condition (parsed back by parse). */
    text: function (oCondition) {
      var v = oCondition.values;
      switch (oCondition.op) {
        case "BT": return v[0] + "..." + v[1];
        case "Contains": return "*" + v[0] + "*";
        case "StartsWith": return v[0] + "*";
        case "EndsWith": return "*" + v[0];
        default: return SIGNS[oCondition.op] + v[0];
      }
    },

    /** The value sent to the service: NUMC with its leading zeros, decimal point. */
    value: function (oField, sValue) {
      if (oField.kind === "digits" && oField.maxLength && /^\\d+$/.test(sValue)) {
        return sValue.padStart(oField.maxLength, "0");
      }
      if (NUMERIC[oField.kind]) {
        return sValue.replace(",", ".").replace(/^\\+/, "");
      }
      if (oField.kind === "uuid") {
        return sValue.toLowerCase();
      }
      return sValue;
    },

    /** The filter of a condition. */
    filter: function (oField, oCondition) {
      var v = oCondition.values.map(function (s) { return filters.value(oField, s); });
      var bText = oField.kind === "text";
      if (oCondition.op === "BT") {
        return new Filter({ path: oField.property, operator: FilterOperator.BT, value1: v[0], value2: v[1] });
      }
      if (oCondition.op === "Contains" || oCondition.op === "StartsWith" || oCondition.op === "EndsWith") {
        return new Filter({ path: oField.property, operator: FilterOperator[oCondition.op], value1: v[0], caseSensitive: false });
      }
      return new Filter({ path: oField.property, operator: FilterOperator[oCondition.op], value1: v[0], caseSensitive: bText ? true : undefined });
    },

    /** The filter of the conditions of one field: included values or'ed, exclusions and'ed. */
    fieldFilter: function (oField, aConditions) {
      var aInclude = [];
      var aExclude = [];
      aConditions.forEach(function (c) {
        (c.op === "NE" ? aExclude : aInclude).push(filters.filter(oField, c));
      });
      var aParts = [];
      if (aInclude.length === 1) {
        aParts.push(aInclude[0]);
      } else if (aInclude.length > 1) {
        aParts.push(new Filter({ filters: aInclude, and: false }));
      }
      aParts = aParts.concat(aExclude);
      if (aParts.length === 0) {
        return null;
      }
      return aParts.length === 1 ? aParts[0] : new Filter({ filters: aParts, and: true });
    },

    /**
     * A filter as an OData $filter expression (the chart of the Analytical List Page and the counts
     * of the worklist tabs send their own requests). mFields: property → field of the layout.
     */
    toOData: function (oFilter, mFields) {
      if (!oFilter) {
        return "";
      }
      var aInner = oFilter.aFilters || (oFilter.getFilters && oFilter.getFilters());
      if (aInner && aInner.length) {
        var bAnd = oFilter.bAnd !== undefined ? oFilter.bAnd : !!(oFilter.isAnd && oFilter.isAnd());
        return "(" + aInner.map(function (f) { return filters.toOData(f, mFields); }).join(bAnd ? " and " : " or ") + ")";
      }
      var sPath = oFilter.sPath || (oFilter.spec && oFilter.spec.path);
      var sOp = oFilter.sOperator || (oFilter.spec && oFilter.spec.operator);
      var v1 = oFilter.oValue1 !== undefined ? oFilter.oValue1 : oFilter.spec && oFilter.spec.value1;
      var v2 = oFilter.oValue2 !== undefined ? oFilter.oValue2 : oFilter.spec && oFilter.spec.value2;
      var bCaseInsensitive = oFilter.bCaseSensitive === false || (oFilter.spec && oFilter.spec.caseSensitive === false);
      var oField = (mFields && mFields[sPath]) || { edm: "Edm.String" };
      var literal = function (v) {
        if (v === null || v === undefined) { return "null"; }
        if (oField.edm === "Edm.String") { return "'" + String(v).replace(/'/g, "''") + "'"; }
        return String(v);
      };
      var sLeft = bCaseInsensitive ? "tolower(" + sPath + ")" : sPath;
      var lit = function (v) { return bCaseInsensitive ? "tolower(" + literal(v) + ")" : literal(v); };
      switch (sOp) {
        case "BT": return "(" + sPath + " ge " + literal(v1) + " and " + sPath + " le " + literal(v2) + ")";
        case "Contains": return "contains(" + sLeft + "," + lit(v1) + ")";
        case "StartsWith": return "startswith(" + sLeft + "," + lit(v1) + ")";
        case "EndsWith": return "endswith(" + sLeft + "," + lit(v1) + ")";
        default: return sPath + " " + String(sOp).toLowerCase() + " " + literal(v1);
      }
    },

    /** The filter of a date range (Edm.Date: inclusive bounds; Edm.DateTimeOffset: whole days, UTC). */
    dateFilter: function (oField, sFrom, sTo) {
      if (!sFrom) {
        return null;
      }
      var sEnd = sTo || sFrom;
      if (oField.kind === "datetime") {
        var oNext = new Date(sEnd + "T00:00:00Z");
        oNext.setUTCDate(oNext.getUTCDate() + 1);
        return new Filter({
          filters: [
            new Filter(oField.property, FilterOperator.GE, sFrom + "T00:00:00Z"),
            new Filter(oField.property, FilterOperator.LT, oNext.toISOString().slice(0, 10) + "T00:00:00Z")
          ],
          and: true
        });
      }
      return sEnd === sFrom ? new Filter(oField.property, FilterOperator.EQ, sFrom) : new Filter({ path: oField.property, operator: FilterOperator.BT, value1: sFrom, value2: sEnd });
    }
  };
  return filters;
});
`;

/**
 * A chart of the Analytical List Page and of the cards (D53): an SVG drawn by the control itself —
 * columns, bars, line, pie, donut — from the groups of a `$apply` (OpenUI5 has no chart library:
 * sap.viz exists in SAPUI5 only). Clicking a column selects its dimension value (event select).
 */
export const CHART = `sap.ui.define(["sap/ui/core/Control"], function (Control) {
  "use strict";

  var COLORS = ["var(--sapChart_OrderedColor_1, #168eff)", "var(--sapChart_OrderedColor_2, #c87b00)", "var(--sapChart_OrderedColor_3, #75980b)", "var(--sapChart_OrderedColor_4, #df1278)", "var(--sapChart_OrderedColor_5, #8b47d7)", "var(--sapChart_OrderedColor_6, #049f9a)"];

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmt(n) {
    var a = Math.abs(n);
    if (a >= 1e9) { return (n / 1e9).toFixed(1) + "B"; }
    if (a >= 1e6) { return (n / 1e6).toFixed(1) + "M"; }
    if (a >= 1e4) { return (n / 1e3).toFixed(1) + "K"; }
    return Math.round(n * 100) / 100 + "";
  }

  return Control.extend("rapt.app.controller.Chart", {
    metadata: {
      properties: {
        type: { type: "string", defaultValue: "column" },
        height: { type: "sap.ui.core.CSSSize", defaultValue: "16rem" },
        selected: { type: "string", defaultValue: "" },
        noDataText: { type: "string", defaultValue: "No data" }
      },
      events: { select: { parameters: { value: { type: "string" } } } }
    },

    /** aRows: [{ key, label, values: [number…] }]; aMeasures: [label…]. */
    setData: function (aRows, aMeasures) {
      this._aRows = aRows || [];
      this._aMeasures = aMeasures || [];
      this.invalidate();
      return this;
    },

    getData: function () {
      return this._aRows || [];
    },

    renderer: {
      apiVersion: 2,
      render: function (rm, oChart) {
        rm.openStart("div", oChart);
        rm.class("raptChart");
        rm.style("height", oChart.getHeight());
        rm.openEnd();
        rm.unsafeHtml(oChart._svg());
        rm.close("div");
      }
    },

    _svg: function () {
      var aRows = this._aRows || [];
      var aMeasures = this._aMeasures || [];
      var sType = this.getType();
      var sSelected = this.getSelected();
      if (aRows.length === 0) {
        return "<div class='raptChartEmpty'>" + esc(this.getNoDataText()) + "</div>";
      }
      var W = 640, H = 260, L = 56, B = 48, T = 12, R = 12;
      var aParts = ["<svg viewBox='0 0 " + W + " " + H + "' width='100%' height='100%' preserveAspectRatio='xMidYMid meet' role='img'>"];
      var legend = aMeasures.length > 1 ? aMeasures.map(function (m, i) {
        return "<rect x='" + (L + i * 140) + "' y='" + (H - 14) + "' width='10' height='10' fill='" + COLORS[i % COLORS.length] + "'/><text x='" + (L + i * 140 + 14) + "' y='" + (H - 5) + "' class='raptChartLabel'>" + esc(m) + "</text>";
      }).join("") : "";
      if (sType === "pie" || sType === "donut") {
        var total = aRows.reduce(function (t, r) { return t + Math.max(0, r.values[0] || 0); }, 0) || 1;
        var cx = 150, cy = H / 2, r = 100, a0 = -Math.PI / 2;
        aRows.forEach(function (row, i) {
          var v = Math.max(0, row.values[0] || 0);
          var a1 = a0 + (v / total) * Math.PI * 2;
          var large = a1 - a0 > Math.PI ? 1 : 0;
          var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
          var path = aRows.length === 1 ? "M" + (cx - r) + "," + cy + "a" + r + "," + r + " 0 1,0 " + (2 * r) + ",0a" + r + "," + r + " 0 1,0 " + (-2 * r) + ",0" : "M" + cx + "," + cy + "L" + x0 + "," + y0 + "A" + r + "," + r + " 0 " + large + ",1 " + x1 + "," + y1 + "Z";
          aParts.push("<path d='" + path + "' fill='" + COLORS[i % COLORS.length] + "' data-value='" + esc(row.key) + "' class='raptChartItem" + (sSelected === row.key ? " raptChartSelected" : "") + "'><title>" + esc(row.label) + ": " + esc(fmt(v)) + "</title></path>");
          aParts.push("<rect x='300' y='" + (20 + i * 22) + "' width='12' height='12' fill='" + COLORS[i % COLORS.length] + "'/><text x='318' y='" + (31 + i * 22) + "' class='raptChartLabel'>" + esc(row.label) + " (" + esc(fmt(v)) + ")</text>");
          a0 = a1;
        });
        if (sType === "donut") {
          aParts.push("<circle cx='" + cx + "' cy='" + cy + "' r='55' class='raptChartHole'/>");
        }
        aParts.push("</svg>");
        return aParts.join("");
      }
      var max = 0, min = 0;
      aRows.forEach(function (row) {
        row.values.forEach(function (v) { max = Math.max(max, v || 0); min = Math.min(min, v || 0); });
      });
      if (max === min) { max = min + 1; }
      var plotW = W - L - R, plotH = H - T - B;
      var horizontal = sType === "bar";
      var scale = function (v) { return (v - min) / (max - min); };
      // axis and grid
      for (var g = 0; g <= 4; g++) {
        var gv = min + (max - min) * g / 4;
        if (horizontal) {
          var gx = L + plotW * g / 4;
          aParts.push("<line x1='" + gx + "' y1='" + T + "' x2='" + gx + "' y2='" + (T + plotH) + "' class='raptChartGrid'/><text x='" + gx + "' y='" + (T + plotH + 14) + "' text-anchor='middle' class='raptChartLabel'>" + esc(fmt(gv)) + "</text>");
        } else {
          var gy = T + plotH - plotH * g / 4;
          aParts.push("<line x1='" + L + "' y1='" + gy + "' x2='" + (L + plotW) + "' y2='" + gy + "' class='raptChartGrid'/><text x='" + (L - 6) + "' y='" + (gy + 4) + "' text-anchor='end' class='raptChartLabel'>" + esc(fmt(gv)) + "</text>");
        }
      }
      var n = aRows.length, m = Math.max(1, aMeasures.length);
      var band = (horizontal ? plotH : plotW) / n;
      if (sType === "line") {
        for (var k = 0; k < m; k++) {
          var pts = aRows.map(function (row, i) { return (L + band * (i + 0.5)) + "," + (T + plotH - plotH * scale(row.values[k] || 0)); });
          aParts.push("<polyline points='" + pts.join(" ") + "' fill='none' stroke='" + COLORS[k % COLORS.length] + "' stroke-width='2'/>");
          aRows.forEach(function (row, i) {
            aParts.push("<circle cx='" + (L + band * (i + 0.5)) + "' cy='" + (T + plotH - plotH * scale(row.values[k] || 0)) + "' r='5' fill='" + COLORS[k % COLORS.length] + "' data-value='" + esc(row.key) + "' class='raptChartItem" + (sSelected === row.key ? " raptChartSelected" : "") + "'><title>" + esc(row.label) + ": " + esc(fmt(row.values[k] || 0)) + "</title></circle>");
          });
        }
      } else {
        var bar = band * 0.7 / m;
        aRows.forEach(function (row, i) {
          for (var k = 0; k < m; k++) {
            var v = row.values[k] || 0;
            var size = (horizontal ? plotW : plotH) * Math.abs(scale(v) - scale(0));
            var start = band * i + band * 0.15 + bar * k;
            var cls = "raptChartItem" + (sSelected === row.key ? " raptChartSelected" : "");
            var tip = "<title>" + esc(row.label) + (m > 1 ? " – " + esc(aMeasures[k]) : "") + ": " + esc(fmt(v)) + "</title>";
            if (horizontal) {
              aParts.push("<rect x='" + (L + plotW * Math.min(scale(v), scale(0))) + "' y='" + (T + start) + "' width='" + size + "' height='" + bar + "' fill='" + COLORS[k % COLORS.length] + "' data-value='" + esc(row.key) + "' class='" + cls + "'>" + tip + "</rect>");
            } else {
              aParts.push("<rect x='" + (L + start) + "' y='" + (T + plotH - plotH * Math.max(scale(v), scale(0))) + "' width='" + bar + "' height='" + size + "' fill='" + COLORS[k % COLORS.length] + "' data-value='" + esc(row.key) + "' class='" + cls + "'>" + tip + "</rect>");
            }
          }
        });
      }
      // category labels
      aRows.forEach(function (row, i) {
        var label = String(row.label).length > 14 ? String(row.label).slice(0, 13) + "…" : String(row.label);
        if (horizontal) {
          aParts.push("<text x='" + (L - 6) + "' y='" + (T + band * (i + 0.5) + 4) + "' text-anchor='end' class='raptChartLabel'>" + esc(label) + "</text>");
        } else {
          aParts.push("<text x='" + (L + band * (i + 0.5)) + "' y='" + (T + plotH + 16) + "' text-anchor='middle' class='raptChartLabel'>" + esc(label) + "</text>");
        }
      });
      aParts.push(legend);
      aParts.push("</svg>");
      return aParts.join("");
    },

    onclick: function (oEvent) {
      var oTarget = oEvent.target && oEvent.target.closest ? oEvent.target.closest("[data-value]") : null;
      if (!oTarget) {
        return;
      }
      var sValue = oTarget.getAttribute("data-value");
      this.setSelected(this.getSelected() === sValue ? "" : sValue);
      this.fireSelect({ value: this.getSelected() });
    }
  });
});
`;

/** The Overview Page (D53): counts of the list cards, data of the chart and KPI cards, navigation. */
export const OVERVIEW_CONTROLLER = `sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/format/NumberFormat",
  "rapt/app/controller/support"
], function (Controller, JSONModel, NumberFormat, support) {
  "use strict";

  var oNumber = NumberFormat.getFloatInstance({ style: "short", maxFractionDigits: 1 });

  return Controller.extend("rapt.app.controller.Overview", {
    onInit: function () {
      this._oOvp = new JSONModel({ counts: {}, kpi: {} });
      this.getView().setModel(this._oOvp, "ovp");
      this._bFirst = true;
      this.getOwnerComponent().getRouter().getRoute("Overview").attachPatternMatched(this._onMatched, this);
    },

    _cards: function () {
      return this.getOwnerComponent().getModel("layout").getProperty("/overview/cards") || [];
    },

    _service: function () {
      return this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/mainService/uri");
    },

    _onMatched: function () {
      var that = this;
      var bStale = this.getOwnerComponent().takeStale("Overview");
      this._cards().forEach(function (oCard) {
        if (oCard.type === "chart") {
          that._loadChart(oCard);
        } else if (oCard.type === "kpi") {
          that._loadKpi(oCard);
        } else if (bStale && !that._bFirst) {
          var oControl = that.byId(oCard.id + (oCard.type === "list" ? "_list" : "_table"));
          if (oControl && oControl.getBinding("items")) {
            oControl.getBinding("items").refresh();
          }
        }
      });
      this._bFirst = false;
    },

    _get: function (oCard, sQuery) {
      return fetch(this._service() + oCard.set + "?" + sQuery, { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : { value: [] }; });
    },

    _loadChart: function (oCard) {
      var oSpec = oCard.chart;
      var oChart = this.byId(oCard.id + "_chart");
      var sApply = (oCard.filter ? "filter(" + oCard.filter + ")/" : "") + "groupby((" + oSpec.dimension.property + "),aggregate(" + oSpec.measures.map(function (m) {
        return m.property + " with " + m.aggregation + " as " + m.property;
      }).join(",") + "))";
      this._get(oCard, "$apply=" + encodeURIComponent(sApply) + "&$orderby=" + encodeURIComponent(oSpec.dimension.property) + "&$top=20").then(function (oData) {
        oChart.setData((oData.value || []).map(function (row) {
          var v = row[oSpec.dimension.property];
          return { key: v === null ? "" : String(v), label: v === null || v === "" ? "(empty)" : String(v), values: oSpec.measures.map(function (m) { return Number(row[m.property]) || 0; }) };
        }), oSpec.measures.map(function (m) { return m.label; }));
      });
    },

    /** A KPI: the aggregate of a measure (per currency or unit when it has one), or the count. */
    _loadKpi: function (oCard) {
      var oKpi = oCard.kpi;
      var that = this;
      var sAggregate = oKpi.aggregation === "count" || !oKpi.property ? "$count as Value" : oKpi.property + " with " + oKpi.aggregation + " as Value";
      var sApply = (oCard.filter ? "filter(" + oCard.filter + ")/" : "") + (oKpi.unit ? "groupby((" + oKpi.unit + "),aggregate(" + sAggregate + "))" : "aggregate(" + sAggregate + ")");
      this._get(oCard, "$apply=" + encodeURIComponent(sApply) + (oKpi.unit ? "&$orderby=Value%20desc" : "")).then(function (oData) {
        var aRows = oData.value || [];
        var oFirst = aRows[0] || { Value: 0 };
        that._oOvp.setProperty("/kpi/" + oCard.id, {
          number: oNumber.format(Number(oFirst.Value) || 0),
          unit: oKpi.unit ? (oFirst[oKpi.unit] || "") : "",
          details: oKpi.label + (oKpi.aggregation === "count" ? "" : " (" + oKpi.aggregation + ")"),
          text: aRows.length > 1 ? aRows.slice(1, 4).map(function (r) { return oNumber.format(Number(r.Value) || 0) + " " + (r[oKpi.unit] || ""); }).join(" · ") : ""
        });
      });
    },

    _card: function (oControl) {
      var oParent = oControl;
      while (oParent && !(oParent.data && oParent.data("card"))) {
        oParent = oParent.getParent();
      }
      var sId = oParent ? oParent.data("card") : "";
      return this._cards().find(function (c) { return c.id === sId; });
    },

    onCardUpdated: function (oEvent) {
      var oCard = this._card(oEvent.getSource());
      var oBinding = oEvent.getSource().getBinding("items");
      if (oCard && oBinding && oBinding.isLengthFinal()) {
        this._oOvp.setProperty("/counts/" + oCard.id, oEvent.getParameter("total") + "");
      }
    },

    onCardHeader: function (oEvent) {
      var oCard = this._card(oEvent.getSource());
      if (oCard && oCard.navigable) {
        this.getOwnerComponent().getRouter().navTo(oCard.set + "List");
      }
    },

    onCardChartSelect: function (oEvent) {
      this.onCardHeader(oEvent);
    },

    onCardItem: function (oEvent) {
      var oCard = this._card(oEvent.getSource());
      var oContext = oEvent.getSource().getBindingContext();
      if (oCard && oContext) {
        this.getOwnerComponent().getRouter().navTo(oCard.set + "Object", { key: support.keyOf(oContext.getPath()) });
      }
    }
  });
});
`;

export const LIST_CONTROLLER = `sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/Sorter",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/m/Token",
  "sap/m/SelectDialog",
  "sap/m/StandardListItem",
  "sap/m/p13n/Popup",
  "sap/m/p13n/SelectionPanel",
  "sap/m/p13n/SortPanel",
  "rapt/app/controller/support",
  "rapt/app/controller/filters",
  "rapt/app/controller/variants"
], function (Controller, Filter, Sorter, JSONModel, MessageBox, MessageToast, Token, SelectDialog, StandardListItem, P13nPopup, SelectionPanel, SortPanel, support, filters, variants) {
  "use strict";

  function id(sName) {
    return sName.replace(/[^A-Za-z0-9_]/g, "_");
  }

  var STANDARD = "standard";

  return Controller.extend("rapt.app.controller.List", {
    onInit: function () {
      this._sSet = this.byId("page").data("set");
      var oPage = this._page();
      var oVisible = {};
      oPage.list.filterFields.forEach(function (f) {
        oVisible[f.property] = oPage.list.selectionFields.some(function (s) { return s.property === f.property; });
      });
      this._oLr = new JSONModel({ visible: oVisible, columns: {}, sort: [], active: 0, summary: "Filtered By: None", tableTitle: oPage.typeNamePlural, count: undefined, variant: STANDARD, defaultVariant: STANDARD, modified: false, variants: [{ key: STANDARD, title: oPage.typeNamePlural, author: "", changeable: false, favorite: true }], view: "both", chartSelection: "", tab: "all", tabCounts: {} });
      this._aFilters = [];
      this.getView().setModel(this._oLr, "lr");
      this._oStandard = this._state();
      if (oPage.draft) {
        // the draft condition needs the user (D58)
        var oList = this;
        this.getOwnerComponent().whenUser(function () {
          // once the table is bound to the model
          var fnApply = function () {
            if (oList.byId("table").getBinding("items")) {
              oList._applyTableFilters();
            } else {
              setTimeout(fnApply, 50);
            }
          };
          fnApply();
        });
      }
      // the default values of the filters (@Consumption.filter.defaultValue, D57)
      var bDefaults = false;
      oPage.list.filterFields.forEach(function (f) {
        if (f.filter && f.filter.defaultValue !== undefined) {
          bDefaults = true;
          this._oStandard.filters[f.property] = f.kind === "boolean" || f.kind === "enum" ? f.filter.defaultValue : ["=" + f.filter.defaultValue];
          if (this._oStandard.visible.indexOf(f.property) < 0) {
            this._oStandard.visible.push(f.property);
          }
        }
      }, this);
      this._bFilterDefaults = bDefaults;
      // the bindings of other pages do not see the changes of this one: refresh when coming back
      var oRouter = this.getOwnerComponent().getRouter();
      var oRoute = oRouter.getRoute(this._sSet + "List");
      if (oRoute) {
        oRoute.attachPatternMatched(this._onListMatched, this);
      }
      var that = this;
      // the chart of an Analytical List Page, the counts of the tabs of a worklist (D53)
      this._loadChart();
      this._loadTabCounts();
      this._oStore = variants.store(this.getOwnerComponent(), this._sSet + "List");
      this._oStore.load().then(function (oData) {
        var aItems = [that._oLr.getProperty("/variants/0")].concat(oData.items.map(function (v) {
          return { key: v.key, title: v.title, author: "", changeable: true, favorite: v.favorite !== false, content: v.content };
        }));
        that._oLr.setProperty("/variants", aItems);
        var sDefault = aItems.some(function (v) { return v.key === oData.defaultKey; }) ? oData.defaultKey : STANDARD;
        that._oLr.setProperty("/defaultVariant", sDefault);
        if (sDefault !== STANDARD || that._bFilterDefaults) {
          that._selectVariant(sDefault);
        }
      });
    },

    _page: function () {
      return support.page(this, this._sSet);
    },

    _onListMatched: function () {
      if (this.getOwnerComponent().takeStale(this._sSet)) {
        this._loadChart();
        this._loadTabCounts();
        this.byId("table").getBinding("items").refresh();
        this.byId("table").removeSelections(true);
        this.getView().getModel("ui").setProperty("/tableSelected", false);
      }
    },

    _field: function (sProperty) {
      return this._page().list.filterFields.find(function (f) { return f.property === sProperty; });
    },

    /** The filters, the search, the visible filters and columns, the sort order: a variant. */
    _state: function () {
      var oState = { filters: {}, search: "", visible: [], hidden: [], sort: this._oLr.getProperty("/sort").slice() };
      var oVisible = this._oLr.getProperty("/visible");
      var oColumns = this._oLr.getProperty("/columns");
      this._page().list.filterFields.forEach(function (oField) {
        if (oVisible[oField.property]) {
          oState.visible.push(oField.property);
        }
        var oControl = this.byId("filter_" + id(oField.property));
        if (!oControl) {
          return;
        }
        if (oField.kind === "date" || oField.kind === "datetime") {
          if (oControl.getDateValue()) {
            oState.filters[oField.property] = { from: support.dateText(oControl.getDateValue()), to: oControl.getSecondDateValue() ? support.dateText(oControl.getSecondDateValue()) : "" };
          }
        } else if (oField.kind === "boolean" || oField.kind === "enum") {
          if (oControl.getSelectedKey() !== "") {
            oState.filters[oField.property] = oControl.getSelectedKey();
          }
        } else if (oControl.getTokens().length > 0) {
          oState.filters[oField.property] = oControl.getTokens().map(function (t) { return t.getText(); });
        }
      }, this);
      Object.keys(oColumns).forEach(function (sProperty) {
        if (oColumns[sProperty] === false) {
          oState.hidden.push(sProperty);
        }
      });
      if (this.byId("search")) {
        oState.search = this.byId("search").getValue();
      }
      return oState;
    },

    _applyState: function (oState) {
      var oVisible = {};
      var oColumns = {};
      this._page().list.filterFields.forEach(function (oField) {
        oVisible[oField.property] = oState.visible.indexOf(oField.property) >= 0;
        var oControl = this.byId("filter_" + id(oField.property));
        var vValue = oState.filters[oField.property];
        if (!oControl) {
          return;
        }
        if (oField.kind === "date" || oField.kind === "datetime") {
          oControl.setDateValue(vValue ? new Date(vValue.from + "T00:00:00") : null);
          oControl.setSecondDateValue(vValue && vValue.to ? new Date(vValue.to + "T00:00:00") : null);
        } else if (oField.kind === "boolean" || oField.kind === "enum") {
          oControl.setSelectedKey(vValue || "");
        } else {
          oControl.setValue("");
          oControl.setValueState("None");
          oControl.setTokens((vValue || []).map(function (sText) { return new Token({ text: sText, key: sText }); }));
        }
      }, this);
      oState.hidden.forEach(function (sProperty) { oColumns[sProperty] = false; });
      this._oLr.setProperty("/visible", oVisible);
      this._oLr.setProperty("/columns", oColumns);
      this._oLr.setProperty("/sort", oState.sort.slice());
      if (this.byId("search")) {
        this.byId("search").setValue(oState.search || "");
      }
      this._applySort();
      this.onSearch();
      this._oLr.setProperty("/modified", false);
    },

    _applySort: function () {
      var oBinding = this.byId("table").getBinding("items");
      oBinding.sort(this._oLr.getProperty("/sort").map(function (s) { return new Sorter(s.key, s.descending); }));
    },

    /** Turns the text typed in a filter field into a token (condition). */
    _commitText: function (oControl) {
      var sText = oControl.getValue();
      if (sText.trim() === "") {
        oControl.setValueState("None");
        return true;
      }
      var oCondition = filters.parse(this._field(oControl.data("property")), sText);
      if (!oCondition) {
        oControl.setValueState("Error");
        oControl.setValueStateText("Enter a valid value or condition (=, !=, >, >=, <, <=, a...b, *x*)");
        return false;
      }
      var sToken = filters.text(oCondition);
      if (!oControl.getTokens().some(function (t) { return t.getText() === sToken; })) {
        oControl.addToken(new Token({ text: sToken, key: sToken }));
      }
      oControl.setValue("");
      oControl.setValueState("None");
      return true;
    },

    onFilterSubmit: function (oEvent) {
      if (this._commitText(oEvent.getSource())) {
        this.onSearch();
      }
    },

    onFilterChange: function () {
      this._oLr.setProperty("/modified", true);
      this._summarize();
    },

    onSearch: function () {
      var oPage = this._page();
      var aFilters = [];
      var bValid = true;
      oPage.list.filterFields.forEach(function (oField) {
        var oControl = this.byId("filter_" + id(oField.property));
        if (!oControl) {
          return;
        }
        var oFilter = null;
        // a mandatory filter (@Consumption.filter.mandatory, D57)
        if (oField.filter && oField.filter.mandatory) {
          var bEmpty = oControl.getTokens ? oControl.getTokens().length === 0 && oControl.getValue() === "" : oControl.getSelectedKey ? oControl.getSelectedKey() === "" : !oControl.getDateValue();
          oControl.setValueState(bEmpty ? "Error" : "None");
          if (bEmpty) {
            oControl.setValueStateText("Fill in this filter");
            bValid = false;
          }
        }
        if (oField.kind === "date" || oField.kind === "datetime") {
          var oFrom = oControl.getDateValue();
          var oTo = oControl.getSecondDateValue();
          oFilter = filters.dateFilter(oField, oFrom ? support.dateText(oFrom) : "", oTo ? support.dateText(oTo) : "");
        } else if (oField.kind === "boolean") {
          var sKey = oControl.getSelectedKey();
          oFilter = sKey === "" ? null : new Filter(oField.property, "EQ", sKey === "true");
        } else if (oField.kind === "enum") {
          var sMember = oControl.getSelectedKey();
          oFilter = sMember === "" ? null : new Filter(oField.property, "EQ", sMember);
        } else {
          bValid = this._commitText(oControl) && bValid;
          var aConditions = oControl.getTokens().map(function (t) { return filters.parse(oField, t.getText()); }).filter(Boolean);
          oFilter = filters.fieldFilter(oField, aConditions);
        }
        if (oFilter) {
          aFilters.push(oFilter);
        }
      }, this);
      if (!bValid) {
        return;
      }
      var oBinding = this.byId("table").getBinding("items");
      if (oPage.list.searchable && this.byId("search")) {
        var sSearch = this.byId("search").getValue().trim();
        oBinding.changeParameters({ $search: sSearch === "" ? undefined : sSearch });
      }
      this._aFilters = aFilters;
      this._applyTableFilters();
      this._loadChart();
      this._loadTabCounts();
      this._summarize();
    },

    /** The filters of the filter bar, and the value selected in the chart (Analytical List Page). */
    _applyTableFilters: function () {
      var aFilters = this._aFilters.slice();
      var oChart = this._page().charts[0];
      var sSelection = this._oLr.getProperty("/chartSelection");
      if (this._page().floorplan === "analyticalListPage" && oChart && sSelection !== "") {
        aFilters.push(new Filter(oChart.dimension.property, "EQ", sSelection));
      }
      // the members of an enumeration type (D55): OpenUI5 does not write their literals, they go
      // to the $filter parameter of the binding (with the draft condition of the list)
      var oPage = this._page();
      var aEnum = [];
      aFilters = aFilters.filter(function (oFilter) {
        var oField = (oPage.fields || {})[oFilter.getPath()];
        if (oField && oField.kind === "enum" && !oFilter.getFilters()) {
          aEnum.push(oFilter.getPath() + " eq '" + String(oFilter.getValue1()).replace(/'/g, "''") + "'");
          return false;
        }
        return true;
      });
      var oBinding = this.byId("table").getBinding("items");
      if (!oBinding) {
        return;
      }
      var sDraft = this._draftClause();
      if (aEnum.length > 0 || this._bEnumFilter || sDraft !== "") {
        var aClauses = (sDraft === "" ? [] : ["(" + sDraft + ")"]).concat(aEnum);
        var sFilter = aClauses.length > 0 ? aClauses.join(" and ") : undefined;
        if (sFilter !== this._sParameterFilter) {
          this._sParameterFilter = sFilter;
          oBinding.changeParameters({ $filter: sFilter });
        }
        this._bEnumFilter = aEnum.length > 0;
      }
      oBinding.filter(aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : []);
    },

    /**
     * The draft condition of the list (D58), as Fiori Elements: all (the own drafts, and the
     * active instances without an own draft), own drafts, locked by another user, no changes.
     */
    _draftClause: function () {
      if (!this._page().draft) {
        return "";
      }
      var sMe = String(this.getOwnerComponent().getModel("ui").getProperty("/user") || "").replace(/'/g, "''");
      var oStatus = this.byId("filter_EditingStatus");
      var sStatus = oStatus ? oStatus.getSelectedKey() : "";
      if (sStatus === "own") {
        return "IsActiveEntity eq false";
      }
      if (sStatus === "locked") {
        return "IsActiveEntity eq true and HasDraftEntity eq true" + (sMe ? " and DraftAdministrativeData/InProcessByUser ne '" + sMe + "'" : "");
      }
      if (sStatus === "unchanged") {
        return "IsActiveEntity eq true and HasDraftEntity eq false";
      }
      return sMe ? "IsActiveEntity eq false or HasDraftEntity eq false or DraftAdministrativeData/InProcessByUser ne '" + sMe + "'" : "IsActiveEntity eq true or HasActiveEntity eq false";
    },

    _service: function () {
      return this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/mainService/uri");
    },

    /** The $filter of the filter bar, for the requests of the chart and of the tab counts. */
    _odataFilter: function (sExtra) {
      var sFilter = this._aFilters.length > 0 ? filters.toOData(new Filter({ filters: this._aFilters, and: true }), this._page().fields) : "";
      return [sFilter, sExtra].filter(Boolean).join(" and ");
    },

    _searchParameter: function () {
      var oSearch = this.byId("search");
      var sSearch = oSearch ? oSearch.getValue().trim() : "";
      return sSearch === "" ? "" : "&$search=" + encodeURIComponent(sSearch);
    },

    /** The chart of the Analytical List Page: the groups of its dimension ($apply). */
    _loadChart: function () {
      var oPage = this._page();
      var oSpec = oPage.charts[0];
      var oChart = this.byId("chart");
      if (oPage.floorplan !== "analyticalListPage" || !oSpec || !oChart) {
        return;
      }
      var sFilter = this._odataFilter();
      var sApply = (sFilter ? "filter(" + sFilter + ")/" : "") + "groupby((" + oSpec.dimension.property + "),aggregate(" + oSpec.measures.map(function (m) {
        return m.property + " with " + m.aggregation + " as " + m.property;
      }).join(",") + "))";
      var that = this;
      fetch(this._service() + this._sSet + "?$apply=" + encodeURIComponent(sApply) + "&$orderby=" + encodeURIComponent(oSpec.dimension.property) + "&$top=50" + this._searchParameter(), { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : { value: [] }; })
        .then(function (oData) {
          oChart.setData((oData.value || []).map(function (row) {
            var v = row[oSpec.dimension.property];
            return { key: v === null ? "" : String(v), label: v === null || v === "" ? "(empty)" : String(v), values: oSpec.measures.map(function (m) { return Number(row[m.property]) || 0; }) };
          }), oSpec.measures.map(function (m) { return m.label; }));
          that._oChartRows = oData.value || [];
        })
        .catch(function () { oChart.setData([], []); });
    },

    onChartSelect: function (oEvent) {
      this._oLr.setProperty("/chartSelection", oEvent.getParameter("value"));
      this._applyTableFilters();
    },

    onViewSwitch: function (oEvent) {
      this._oLr.setProperty("/view", oEvent.getParameter("item").getKey());
    },

    /** Worklist: a tab is a selection variant (@UI.selectionVariant), its filter a parameter of the list. */
    onWorklistTab: function (oEvent) {
      var sKey = oEvent.getParameter("key");
      var oVariant = this._page().selectionVariants.find(function (v) { return v.key === sKey; });
      this._oLr.setProperty("/tab", sKey);
      var sDraft = this._draftClause();
      var sFilter = [sDraft, oVariant && oVariant.filter ? oVariant.filter : ""].filter(Boolean).map(function (f) { return "(" + f + ")"; }).join(" and ");
      this.byId("table").getBinding("items").changeParameters({ $filter: sFilter || undefined });
    },

    _loadTabCounts: function () {
      var oPage = this._page();
      if (oPage.floorplan !== "worklist" || oPage.selectionVariants.length === 0) {
        return;
      }
      var that = this;
      var aTabs = [{ key: "all" }].concat(oPage.selectionVariants);
      aTabs.forEach(function (oTab) {
        var sFilter = that._odataFilter(oTab.filter ? "(" + oTab.filter + ")" : "");
        fetch(that._service() + that._sSet + "/$count" + (sFilter ? "?$filter=" + encodeURIComponent(sFilter) : "?") + that._searchParameter(), { credentials: "same-origin" })
          .then(function (r) { return r.ok ? r.text() : ""; })
          .then(function (sCount) { that._oLr.setProperty("/tabCounts/" + oTab.key, sCount.trim()); })
          .catch(function () { /* no count */ });
      });
    },

    /** "Filtered By: …" in the collapsed header, the count of "Adapt Filters (n)". */
    _summarize: function () {
      var oState = this._state();
      var aLabels = [];
      Object.keys(oState.filters).forEach(function (sProperty) {
        var oField = this._field(sProperty);
        var vValue = oState.filters[sProperty];
        aLabels.push(oField.label + (Array.isArray(vValue) && vValue.length > 1 ? " (" + vValue.length + ")" : ""));
      }, this);
      if (oState.search && oState.search.trim() !== "") {
        aLabels.unshift("Search");
      }
      this._oLr.setProperty("/active", aLabels.length);
      this._oLr.setProperty("/summary", "Filtered By: " + (aLabels.length === 0 ? "None" : aLabels.join(", ")));
    },

    onClearFilters: function () {
      if (this.byId("filter_EditingStatus")) {
        this.byId("filter_EditingStatus").setSelectedKey("");
      }
      var oState = this._state();
      oState.filters = {};
      oState.search = "";
      this._applyState(oState);
      this._oLr.setProperty("/modified", true);
    },

    onAdaptFilters: function () {
      var that = this;
      var oVisible = this._oLr.getProperty("/visible");
      var oDialog = new SelectDialog({
        title: "Adapt Filters",
        multiSelect: true,
        rememberSelections: false,
        items: this._page().list.filterFields.map(function (f) {
          return new StandardListItem({ title: f.label, description: f.property, selected: oVisible[f.property] === true });
        }),
        search: function (oEvent) {
          var sValue = (oEvent.getParameter("value") || "").toLowerCase();
          oEvent.getSource().getItems().forEach(function (oItem) {
            oItem.setVisible(oItem.getTitle().toLowerCase().indexOf(sValue) >= 0);
          });
        },
        confirm: function (oEvent) {
          var aSelected = (oEvent.getParameter("selectedItems") || []).map(function (oItem) { return oItem.getDescription(); });
          var oNew = {};
          that._page().list.filterFields.forEach(function (f) {
            oNew[f.property] = aSelected.indexOf(f.property) >= 0;
          });
          var oState = that._state();
          oState.visible = aSelected;
          // a hidden filter does not filter
          Object.keys(oState.filters).forEach(function (sProperty) {
            if (!oNew[sProperty]) {
              delete oState.filters[sProperty];
            }
          });
          that._applyState(oState);
          that._oLr.setProperty("/modified", true);
        },
        afterClose: function () {
          oDialog.destroy();
        }
      });
      this.getView().addDependent(oDialog);
      oDialog.open();
    },

    onTableSettings: function (oEvent) {
      var that = this;
      var oTable = this._page().list.table;
      var oColumns = this._oLr.getProperty("/columns");
      var aSort = this._oLr.getProperty("/sort");
      var oSelection = new SelectionPanel({ title: "Columns", showHeader: true, enableCount: true, enableReorder: false });
      oSelection.setP13nData(oTable.columns.map(function (c) {
        return { key: c.property, label: c.label, visible: oColumns[c.property] !== false };
      }));
      var oSort = new SortPanel({ title: "Sort" });
      oSort.setP13nData(oTable.columns.map(function (c) {
        var oSorted = aSort.find(function (s) { return s.key === c.property; });
        return { key: c.property, label: c.label, sorted: !!oSorted, descending: oSorted ? oSorted.descending : false };
      }));
      var oPopup = new P13nPopup({
        title: "View Settings",
        panels: [oSelection, oSort],
        close: function (oClose) {
          if (oClose.getParameter("reason") === "Ok") {
            var oNew = {};
            oSelection.getP13nData().forEach(function (o) {
              if (!o.visible) {
                oNew[o.key] = false;
              }
            });
            that._oLr.setProperty("/columns", oNew);
            that._oLr.setProperty("/sort", oSort.getP13nData().filter(function (o) { return o.sorted; }).map(function (o) {
              return { key: o.key, descending: !!o.descending };
            }));
            that._applySort();
            that._oLr.setProperty("/modified", true);
          }
          oPopup.destroy();
        }
      });
      this.getView().addDependent(oPopup);
      oPopup.open(oEvent.getSource());
    },

    onFilterValueHelp: function (oEvent) {
      var oControl = oEvent.getSource();
      var oField = this._field(oControl.data("property"));
      var that = this;
      support.valueHelp(this.getView(), oField.valueHelp, true).then(function (aValues) {
        aValues.forEach(function (sValue) {
          var sToken = "=" + sValue;
          if (!oControl.getTokens().some(function (t) { return t.getText() === sToken; })) {
            oControl.addToken(new Token({ text: sToken, key: sToken }));
          }
        });
        if (aValues.length > 0) {
          that.onFilterChange();
        }
      });
    },

    _items: function () {
      return this._oLr.getProperty("/variants");
    },

    _selectVariant: function (sKey) {
      var oItem = this._items().find(function (v) { return v.key === sKey; });
      this._oLr.setProperty("/variant", oItem ? sKey : STANDARD);
      this._applyState(oItem && oItem.content ? oItem.content : this._oStandard);
    },

    onVariantSelect: function (oEvent) {
      this._selectVariant(oEvent.getParameter("key"));
    },

    _persist: function () {
      var sDefault = this._oLr.getProperty("/defaultVariant");
      this._oStore.save({
        defaultKey: sDefault,
        items: this._items().filter(function (v) { return v.key !== STANDARD; }).map(function (v) {
          return { key: v.key, title: v.title, favorite: v.favorite, content: v.content };
        })
      }).catch(function () {
        MessageToast.show("The view could not be saved");
      });
    },

    onVariantSave: function (oEvent) {
      var sKey = oEvent.getParameter("key") || ("v" + Date.now());
      var aItems = this._items().slice();
      var oContent = this._state();
      if (oEvent.getParameter("overwrite")) {
        aItems = aItems.map(function (v) { return v.key === sKey ? Object.assign({}, v, { content: oContent }) : v; });
      } else {
        aItems.push({ key: sKey, title: oEvent.getParameter("name"), author: "", changeable: true, favorite: true, content: oContent });
      }
      this._oLr.setProperty("/variants", aItems);
      if (oEvent.getParameter("def")) {
        this._oLr.setProperty("/defaultVariant", sKey);
      }
      this._oLr.setProperty("/variant", sKey);
      this._oLr.setProperty("/modified", false);
      this._persist();
    },

    onVariantManage: function (oEvent) {
      var aDeleted = oEvent.getParameter("deleted") || [];
      var aRenamed = oEvent.getParameter("renamed") || [];
      var aFavorites = oEvent.getParameter("fav") || [];
      var aItems = this._items().filter(function (v) { return aDeleted.indexOf(v.key) < 0; }).map(function (v) {
        var oRename = aRenamed.find(function (r) { return r.key === v.key; });
        var oFavorite = aFavorites.find(function (f) { return f.key === v.key; });
        return Object.assign({}, v, oRename ? { title: oRename.name } : {}, oFavorite ? { favorite: oFavorite.visible } : {});
      });
      this._oLr.setProperty("/variants", aItems);
      var sDefault = oEvent.getParameter("def");
      if (sDefault !== undefined) {
        this._oLr.setProperty("/defaultVariant", sDefault);
      }
      if (aDeleted.indexOf(this._oLr.getProperty("/defaultVariant")) >= 0) {
        this._oLr.setProperty("/defaultVariant", STANDARD);
      }
      if (aDeleted.indexOf(this._oLr.getProperty("/variant")) >= 0) {
        this._selectVariant(STANDARD);
      }
      this._persist();
    },

    onUpdateFinished: function (oEvent) {
      var iTotal = oEvent.getParameter("total");
      var sPlural = this.byId("tableTitle").data("plural");
      var oBinding = this.byId("table").getBinding("items");
      var bKnown = oBinding && oBinding.isLengthFinal();
      this._oLr.setProperty("/tableTitle", bKnown ? sPlural + " (" + iTotal + ")" : sPlural);
    },

    onSelectionChange: function () {
      this.getView().getModel("ui").setProperty("/tableSelected", !!this.byId("table").getSelectedItem());
    },

    onItemPress: function (oEvent) {
      var oContext = oEvent.getSource().getBindingContext();
      this.getOwnerComponent().getRouter().navTo(this._sSet + "Object", { key: support.keyOf(oContext.getPath()) });
    },

    onCreate: function () {
      var oModel = this.getView().getModel();
      var that = this;
      if (this._page().draft) {
        // draft (D54): a new draft at once, then its object page in edit mode
        var oDraft = oModel.bindList("/" + this._sSet, undefined, undefined, undefined, { $$updateGroupId: "$auto" }).create({});
        oDraft.created().then(function () {
          that.getOwnerComponent().markStale();
          that.getOwnerComponent().getRouter().navTo(that._sSet + "Object", { key: support.keyOf(oDraft.getPath()) });
        }, function (oError) {
          MessageBox.error(support.errorText(oError));
        });
        return;
      }
      var oBinding = oModel.bindList("/" + this._sSet, undefined, undefined, undefined, { $$updateGroupId: "changes" });
      this.getOwnerComponent().setTransient(oBinding.create({}));
      this.getOwnerComponent().getRouter().navTo(this._sSet + "New");
    },

    onDelete: function () {
      var oItem = this.byId("table").getSelectedItem();
      if (!oItem) {
        return;
      }
      var oContext = oItem.getBindingContext();
      var that = this;
      MessageBox.confirm("Delete this object?", {
        onClose: function (sAction) {
          if (sAction !== MessageBox.Action.OK) {
            return;
          }
          oContext.delete("$auto").then(function () {
            that.getView().getModel("ui").setProperty("/tableSelected", false);
            MessageToast.show("Object deleted");
          }, function (oError) {
            MessageBox.error(support.errorText(oError));
          });
        }
      });
    },

    onAction: function (oEvent) {
      var oButton = oEvent.getSource();
      var oPage = this._page();
      var oAction = support.action(oPage, oButton.data("action"), oPage.list.table.actions);
      var oItem = this.byId("table").getSelectedItem();
      var oContext = oItem ? oItem.getBindingContext() : undefined;
      var that = this;
      if (!oAction || (!oAction.static && !oContext)) {
        return;
      }
      support.invoke(this.getView(), oPage, oAction, oContext).then(function (oResult) {
        if (oResult === null) {
          return;
        }
        MessageToast.show(oAction.label + ": done");
        that.byId("table").getBinding("items").refresh();
        if ((oAction.factory || oAction.static) && oResult && oAction.returnsEntity) {
          that.getOwnerComponent().getRouter().navTo(that._sSet + "Object", { key: support.keyPredicate(oPage, oResult.getObject()) });
        }
      }, function (oError) {
        MessageBox.error(support.errorText(oError));
      });
    }
  });
});
`;

/**
 * The views (variants) of a user: saved by the service (`$variants`, a table of the database,
 * per user), in the local storage of the browser when the service does not keep them.
 */
export const VARIANTS = `sap.ui.define([], function () {
  "use strict";

  function local(sKey) {
    return {
      load: function () {
        try {
          return Promise.resolve(JSON.parse(window.localStorage.getItem(sKey) || "null") || { items: [] });
        } catch (e) {
          return Promise.resolve({ items: [] });
        }
      },
      save: function (oData) {
        try {
          window.localStorage.setItem(sKey, JSON.stringify(oData));
        } catch (e) {
          return Promise.reject(e);
        }
        return Promise.resolve();
      }
    };
  }

  return {
    store: function (oComponent, sPage) {
      var sService = oComponent.getManifestEntry("/sap.app/dataSources/mainService/uri");
      var sUrl = sService + "$variants?page=" + encodeURIComponent(sPage);
      var oLocal = local("rapt.variants." + sService + sPage);
      var bServer = true;
      return {
        load: function () {
          return fetch(sUrl, { credentials: "same-origin", headers: { accept: "application/json" } }).then(function (oResponse) {
            if (!oResponse.ok) {
              throw new Error(String(oResponse.status));
            }
            return oResponse.json();
          }).then(function (oData) {
            return { items: oData.items || [], defaultKey: oData.defaultKey };
          }).catch(function () {
            bServer = false;
            return oLocal.load();
          });
        },
        save: function (oData) {
          if (!bServer) {
            return oLocal.save(oData);
          }
          return fetch(sService, { method: "HEAD", credentials: "same-origin", headers: { "X-CSRF-Token": "Fetch" } }).then(function (oHead) {
            return fetch(sUrl, {
              method: "PUT",
              credentials: "same-origin",
              headers: { "content-type": "application/json", "X-CSRF-Token": oHead.headers.get("X-CSRF-Token") || "" },
              body: JSON.stringify(oData)
            });
          }).then(function (oResponse) {
            if (!oResponse.ok) {
              throw new Error(String(oResponse.status));
            }
          });
        }
      };
    }
  };
});
`;

export const OBJECT_CONTROLLER = `sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/Messaging",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/m/MessagePopover",
  "sap/m/MessageItem",
  "sap/ui/core/routing/History",
  "rapt/app/controller/support",
  "sap/m/Dialog",
  "sap/m/Button",
  "sap/m/Input",
  "sap/m/Label",
  "sap/m/VBox"
], function (Controller, Messaging, MessageBox, MessageToast, MessagePopover, MessageItem, History, support, Dialog, Button, Input, Label, VBox) {
  "use strict";

  return Controller.extend("rapt.app.controller.Object", {
    onInit: function () {
      this._sSet = this.byId("page").data("set");
      var oRouter = this.getOwnerComponent().getRouter();
      oRouter.getRoute(this._sSet + "Object").attachPatternMatched(this._onObjectMatched, this);
      var oNew = oRouter.getRoute(this._sSet + "New");
      if (oNew) {
        oNew.attachPatternMatched(this._onNewMatched, this);
      }
      // form entry (D53): the start page creates, again and again
      var oFormEntry = oRouter.getRoute(this._sSet + "FormEntry");
      if (oFormEntry) {
        oFormEntry.attachPatternMatched(this._onFormEntryMatched, this);
      }
    },

    _page: function () {
      return support.page(this, this._sSet);
    },

    _ui: function () {
      return this.getView().getModel("ui");
    },

    _mode: function (bEdit, bCreate) {
      this._ui().setProperty("/editMode", bEdit);
      this._ui().setProperty("/createMode", bCreate);
      this._ui().setProperty("/childSelected", false);
    },

    /** Collaborative draft (D59): the users of the draft, the changes of the others (polling). */
    _startCollab: function () {
      var that = this;
      this._loadCollabUsers();
      this._iCollab = setInterval(function () {
        var oModel = that.getView().getModel();
        if (!that._ui().getProperty("/draft") || oModel.hasPendingChanges()) {
          return;
        }
        var oBinding = that.getView().getElementBinding();
        if (oBinding) {
          oBinding.refresh();
        }
        that._loadCollabUsers();
      }, 5000);
    },

    _stopCollab: function () {
      if (this._iCollab) {
        clearInterval(this._iCollab);
        this._iCollab = undefined;
      }
    },

    _loadCollabUsers: function () {
      var oContext = this.getView().getBindingContext();
      var oUi = this._ui();
      var sService = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/mainService/uri");
      if (!oContext) {
        return;
      }
      oContext.requestProperty("DraftUUID").then(function (sUuid) {
        if (!sUuid) {
          return undefined;
        }
        return fetch(sService + "DraftAdministrativeUser?$orderby=UserID&$filter=" + encodeURIComponent("DraftUUID eq " + sUuid), { credentials: "same-origin", headers: { accept: "application/json" } })
          .then(function (r) { return r.ok ? r.json() : { value: [] }; })
          .then(function (oData) {
            oUi.setProperty("/collab/users", (oData.value || []).map(function (u) {
              return { UserID: u.UserID, initials: String(u.UserID).slice(0, 2).toUpperCase(), owner: u.UserAccessRole === "O" };
            }));
          });
      }).catch(function () { /* the list stays as it was */ });
    },

    /** Invites a user to the collaborative draft: the action Share (D59). */
    onInvite: function () {
      var that = this;
      var oInput = new Input({ placeholder: "User ID", width: "100%" });
      var oDialog = new Dialog({
        title: "Invite Users",
        content: [new VBox({ items: [new Label({ text: "User", labelFor: oInput }), oInput] }).addStyleClass("sapUiSmallMargin")],
        beginButton: new Button({
          text: "Invite",
          type: "Emphasized",
          press: function () {
            var sUser = oInput.getValue().trim();
            oDialog.close();
            if (sUser === "") {
              return;
            }
            that._draftAction("Share", { Users: [{ UserID: sUser, UserAccessRole: "E" }], ShareAll: false }).then(function () {
              MessageToast.show(sUser.toUpperCase() + " can now edit the draft");
              that._loadCollabUsers();
            }, function (oError) {
              MessageBox.error(support.errorText(oError));
            });
          }
        }),
        endButton: new Button({ text: "Cancel", press: function () { oDialog.close(); } }),
        afterClose: function () { oDialog.destroy(); }
      });
      this.getView().addDependent(oDialog);
      oDialog.open();
    },

    _onObjectMatched: function (oEvent) {
      // changes left behind (back button in edit mode) must not be sent with the next save
      this.getView().getModel().resetChanges("changes");
      this._mode(false, false);
      Messaging.removeAllMessages();
      var sKey = oEvent.getParameter("arguments").key;
      // a draft (D54): edited at once, each change saved in the draft
      var bDraft = /IsActiveEntity=false/.test(sKey);
      this._ui().setProperty("/draft", bDraft);
      this.getView().bindElement({
        path: "/" + this._sSet + "(" + sKey + ")",
        parameters: { $$updateGroupId: bDraft ? "$auto" : "changes" }
      });
      this._stopCollab();
      if (bDraft) {
        // each change is saved in the draft: "Saving draft..." then "Draft saved" (D58)
        var oIndicator = this.byId("draftStatus");
        var oBinding = this.getView().getElementBinding();
        if (oIndicator && oBinding && !oBinding._raptIndicator) {
          oBinding._raptIndicator = true;
          oBinding.attachPatchSent(function () { oIndicator.showDraftSaving(); });
          oBinding.attachPatchCompleted(function (oPatch) {
            if (oPatch.getParameter("success")) {
              oIndicator.showDraftSaved();
            } else {
              oIndicator.clearDraftState();
            }
          });
        }
        if (this.byId("collab")) {
          this._startCollab();
        }
      }
      if (bDraft) {
        // a new draft (no active instance) is a creation: its keys may still be entered
        var that = this;
        var sService = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/mainService/uri");
        this._bHasActive = true;
        fetch(sService + this._sSet + "(" + sKey + ")?$select=HasActiveEntity", { credentials: "same-origin", headers: { accept: "application/json" } })
          .then(function (r) { return r.ok ? r.json() : { HasActiveEntity: true }; })
          .then(function (oData) {
            that._bHasActive = oData.HasActiveEntity !== false;
            that._mode(true, !that._bHasActive);
          }, function () {
            that._mode(true, false);
          });
      }
    },

    /** Runs an action of the draft on the bound instance; resolves the context it returns. */
    _draftAction: function (sName, oParameters) {
      var oView = this.getView();
      var oNamespace = oView.getModel("layout").getProperty("/namespace");
      // Share returns nothing: no inherited $expand / $select (D59)
      var oAction = oView.getModel().bindContext(oNamespace + "." + sName + "(...)", oView.getBindingContext(), sName === "Share" ? {} : { $$inheritExpandSelect: true });
      Object.keys(oParameters || {}).forEach(function (sParameter) {
        oAction.setParameter(sParameter, oParameters[sParameter]);
      });
      return oAction.invoke("$auto");
    },

    _onFormEntryMatched: function () {
      this._bFormEntry = true;
      this._newTransient();
      this._onNewMatched();
    },

    /** A new instance to create, when none was prepared (form entry, link to …/new). */
    _newTransient: function () {
      var oBinding = this.getView().getModel().bindList("/" + this._sSet, undefined, undefined, undefined, { $$updateGroupId: "changes" });
      this.getOwnerComponent().setTransient(oBinding.create({}));
    },

    _onNewMatched: function (oEvent) {
      if (oEvent) {
        this._bFormEntry = false;
      }
      if (!this.getOwnerComponent().getTransient()) {
        this._newTransient();
      }
      var oContext = this.getOwnerComponent().getTransient();
      Messaging.removeAllMessages();
      this.getView().unbindElement();
      this.getView().setBindingContext(oContext);
      this._mode(true, true);
    },

    _back: function () {
      if (History.getInstance().getPreviousHash() !== undefined) {
        window.history.go(-1);
      } else {
        this.getOwnerComponent().getRouter().navTo(this.getOwnerComponent().getModel("layout").getProperty("/start") + "List", {}, true);
      }
    },

    /** Leaves the page, after a confirmation when changes are not saved. */
    _leave: function (fnLeave) {
      var oModel = this.getView().getModel();
      var that = this;
      if (this._ui().getProperty("/draft")) {
        // leaving a draft, as Fiori Elements: keep it for later, or discard it (D58)
        var oContext = this.getView().getBindingContext();
        MessageBox.show("Do you want to keep the draft of your changes?", {
          title: "Leave Page",
          actions: ["Keep Draft", "Discard Draft", MessageBox.Action.CANCEL],
          emphasizedAction: "Keep Draft",
          onClose: function (sAction) {
            if (sAction === "Keep Draft") {
              that._stopCollab();
              that.getOwnerComponent().markStale();
              fnLeave();
            } else if (sAction === "Discard Draft" && oContext) {
              oContext.delete("$auto").then(function () {
                that._stopCollab();
                that.getOwnerComponent().markStale();
                MessageToast.show("Draft discarded");
                fnLeave();
              }, function (oError) {
                MessageBox.error(support.errorText(oError));
              });
            }
          }
        });
        return;
      }
      if (!this._ui().getProperty("/editMode") || !oModel.hasPendingChanges("changes")) {
        fnLeave();
        return;
      }
      MessageBox.confirm("Discard the changes?", {
        onClose: function (sAction) {
          if (sAction === MessageBox.Action.OK) {
            oModel.resetChanges("changes");
            that.getOwnerComponent().setTransient(undefined);
            that._mode(false, false);
            fnLeave();
          }
        }
      });
    },

    onNavList: function () {
      var oRouter = this.getOwnerComponent().getRouter();
      var sStart = this.getOwnerComponent().getModel("layout").getProperty("/start");
      this._leave(function () {
        oRouter.navTo(sStart + "List", {}, false);
      });
    },

    onNavBack: function () {
      var that = this;
      this._leave(function () {
        that._back();
      });
    },

    onValueHelp: function (oEvent) {
      var oInput = oEvent.getSource();
      var sProperty = oInput.data("property");
      var oField = this._page().fields[sProperty] || this._childField(oInput, sProperty);
      if (!oField || !oField.valueHelp) {
        return;
      }
      var oContext = oInput.getBindingContext();
      support.valueHelp(this.getView(), oField.valueHelp, false, oContext).then(function (aValues) {
        if (aValues.length > 0) {
          oContext.setProperty(sProperty, aValues[0]);
          oInput.setValueState("None");
        }
      });
    },

    /** A value typed or chosen in a field with a value help: validation, additional bindings. */
    onValueHelpChange: function (oEvent) {
      var oControl = oEvent.getSource();
      var sProperty = oControl.data("property");
      var oField = this._page().fields[sProperty] || this._childField(oControl, sProperty);
      var oContext = oControl.getBindingContext();
      if (!oField || !oField.valueHelp || !oContext) {
        return;
      }
      var oHelp = oField.valueHelp;
      var oItem = oEvent.getParameter("selectedItem") || (oControl.getSelectedItem && oControl.getSelectedItem());
      if (oItem) {
        // drop-down list: the row of the chosen item
        support.applyValueHelpResults(oHelp, oContext, oItem.getBindingContext().getObject());
        oControl.setValueState("None");
        return;
      }
      var sValue = oControl.getValue ? oControl.getValue() : "";
      support.checkValueHelp(this.getView(), oHelp, oContext, sValue).then(function (bFound) {
        if (!bFound && oHelp.validation) {
          oControl.setValueState("Error");
          oControl.setValueStateText("Enter a valid value: " + sValue + " is not in " + oHelp.label);
        } else {
          oControl.setValueState("None");
        }
      });
    },

    /** The field of a child table (the input is in a row of a table of the page). */
    _childField: function (oInput, sProperty) {
      var oParent = oInput.getParent();
      while (oParent && !(oParent.data && oParent.data("set"))) {
        oParent = oParent.getParent();
      }
      var oPage = oParent ? support.page(this, oParent.data("set")) : undefined;
      return oPage ? oPage.fields[sProperty] : undefined;
    },

    onEdit: function () {
      Messaging.removeAllMessages();
      if (this._page().draft) {
        // draft (D54): Edit opens the draft of the instance
        var that = this;
        this._ui().setProperty("/busy", true);
        this._draftAction("Edit", { PreserveChanges: false }).then(function (oDraft) {
          that._ui().setProperty("/busy", false);
          that.getOwnerComponent().markStale();
          that.getOwnerComponent().getRouter().navTo(that._sSet + "Object", { key: support.keyOf(oDraft.getPath()) }, true);
        }, function (oError) {
          that._ui().setProperty("/busy", false);
          MessageBox.error(support.errorText(oError));
        });
        return;
      }
      this._mode(true, false);
    },

    onSave: function () {
      if (this._ui().getProperty("/draft")) {
        this._activate();
        return;
      }
      var oView = this.getView();
      var oModel = oView.getModel();
      var oUi = this._ui();
      var that = this;
      var bCreate = oUi.getProperty("/createMode");
      var oContext = oView.getBindingContext();
      Messaging.removeAllMessages();
      oUi.setProperty("/busy", true);
      oModel.submitBatch("changes").then(function () {
        oUi.setProperty("/busy", false);
        if (oModel.hasPendingChanges("changes")) {
          MessageBox.error(support.errorText());
          return;
        }
        that.getOwnerComponent().markStale();
        if (bCreate) {
          return oContext.created().then(function () {
            that.getOwnerComponent().setTransient(undefined);
            if (that._bFormEntry) {
              // form entry: a new, empty form
              MessageToast.show("Object created");
              that._newTransient();
              that._onNewMatched();
              return;
            }
            that._mode(false, false);
            MessageToast.show("Object created");
            that.getOwnerComponent().getRouter().navTo(that._sSet + "Object", { key: support.keyOf(oContext.getPath()) }, true);
          });
        }
        that._mode(false, false);
        MessageToast.show("Changes saved");
      }, function (oError) {
        oUi.setProperty("/busy", false);
        MessageBox.error(support.errorText(oError));
      });
    },

    /** Save of a draft: Activate, then the active instance (D54). */
    _activate: function () {
      var that = this;
      var oUi = this._ui();
      Messaging.removeAllMessages();
      oUi.setProperty("/busy", true);
      this.getView().getModel().submitBatch("$auto").then(function () {
        return that._draftAction("Activate");
      }).then(function (oActive) {
        oUi.setProperty("/busy", false);
        that.getOwnerComponent().markStale();
        MessageToast.show(oUi.getProperty("/createMode") ? "Object created" : "Changes saved");
        that.getOwnerComponent().getRouter().navTo(that._sSet + "Object", { key: support.keyOf(oActive.getPath()) }, true);
      }, function (oError) {
        oUi.setProperty("/busy", false);
        MessageBox.error(support.errorText(oError));
      });
    },

    onCancel: function () {
      if (this._ui().getProperty("/draft")) {
        // draft (D54): Discard, back to the active instance (or the list)
        var that = this;
        var oContext = this.getView().getBindingContext();
        MessageBox.confirm(that._bHasActive ? "Discard all changes?" : "Discard this draft?", {
          title: "Discard Draft",
          actions: ["Discard", MessageBox.Action.CANCEL],
          emphasizedAction: "Discard",
          onClose: function (sAction) {
            if (sAction !== "Discard") {
              return;
            }
            that._stopCollab();
            var bHasActive = that._bHasActive;
            var sActive = support.keyOf(oContext.getPath()).replace("IsActiveEntity=false", "IsActiveEntity=true");
            // DELETE of the draft root discards the draft (D54)
            oContext.delete("$auto").then(function () {
              that.getOwnerComponent().markStale();
              MessageToast.show("Draft discarded");
              if (bHasActive) {
                that.getOwnerComponent().getRouter().navTo(that._sSet + "Object", { key: sActive }, true);
              } else {
                that._back();
              }
            }, function (oError) {
              MessageBox.error(support.errorText(oError));
            });
          }
        });
        return;
      }
      var bCreate = this._ui().getProperty("/createMode");
      this.getView().getModel().resetChanges("changes");
      Messaging.removeAllMessages();
      this._mode(false, false);
      if (bCreate && this._bFormEntry) {
        this._newTransient();
        this._onNewMatched();
      } else if (bCreate) {
        this.getOwnerComponent().setTransient(undefined);
        this._back();
      }
    },

    onDelete: function () {
      var oContext = this.getView().getBindingContext();
      var that = this;
      MessageBox.confirm("Delete this object?", {
        onClose: function (sAction) {
          if (sAction !== MessageBox.Action.OK) {
            return;
          }
          oContext.delete("$auto").then(function () {
            that.getOwnerComponent().markStale();
            MessageToast.show("Object deleted");
            that._back();
          }, function (oError) {
            MessageBox.error(support.errorText(oError));
          });
        }
      });
    },

    onAction: function (oEvent) {
      var oPage = this._page();
      var oAction = support.action(oPage, oEvent.getSource().data("action"));
      var oContext = this.getView().getBindingContext();
      var that = this;
      if (!oAction) {
        return;
      }
      support.invoke(this.getView(), oPage, oAction, oContext).then(function (oResult) {
        if (oResult === null) {
          return;
        }
        MessageToast.show(oAction.label + ": done");
        that.getOwnerComponent().markStale();
        if (oAction.factory && oResult && oAction.returnsEntity) {
          that.getOwnerComponent().getRouter().navTo(that._sSet + "Object", { key: support.keyPredicate(oPage, oResult.getObject()) });
          return;
        }
        that.getView().getElementBinding().refresh();
      }, function (oError) {
        MessageBox.error(support.errorText(oError));
      });
    },

    onCreateChild: function (oEvent) {
      var oTable = this.byId(oEvent.getSource().data("table"));
      oTable.getBinding("items").create({}, true);
    },

    onDeleteChild: function (oEvent) {
      var oTable = this.byId(oEvent.getSource().data("table"));
      var oItem = oTable.getSelectedItem();
      if (oItem) {
        oItem.getBindingContext().delete(this._ui().getProperty("/draft") ? "$auto" : "changes");
        this._ui().setProperty("/childSelected", false);
      }
    },

    onChildSelectionChange: function (oEvent) {
      this._ui().setProperty("/childSelected", !!oEvent.getSource().getSelectedItem());
    },

    onChildPress: function (oEvent) {
      if (this._ui().getProperty("/editMode")) {
        return;
      }
      var oItem = oEvent.getSource();
      var sSet = oItem.getParent().data("set");
      this.getOwnerComponent().getRouter().navTo(sSet + "Object", { key: support.keyOf(oItem.getBindingContext().getPath()) });
    },

    onMessages: function (oEvent) {
      if (!this._oPopover) {
        this._oPopover = new MessagePopover({
          items: { path: "message>/", template: new MessageItem({ type: "{message>type}", title: "{message>message}", subtitle: "{message>additionalText}" }) }
        });
        this.getView().addDependent(this._oPopover);
      }
      this._oPopover.toggle(oEvent.getSource());
    }
  });
});
`;
