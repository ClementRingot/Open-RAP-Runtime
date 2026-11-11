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

/** Filter bar of the list report: fields and buttons aligned on the bottom of the inputs. */
export const STYLE = `.raptFilterBar { column-gap: 1rem; row-gap: 0.5rem; }
.raptFilterBar .raptFilterItem { margin: 0; }
.raptFilterBar .raptFilterButtons { margin-left: auto; align-items: flex-end; }
`;

export function manifest(layout: UiLayout): string {
  const routes: unknown[] = [];
  const targets: Record<string, unknown> = {};
  for (const page of layout.pages) {
    if (page.list !== undefined) {
      routes.push({ pattern: page.set === layout.start ? "" : `${page.set}`, name: `${page.set}List`, target: `${page.set}List` });
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
  <Page id="shell" showHeader="{= !!\${ui>/shell} }" enableScrolling="false">
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
      var oUi = new JSONModel({ editMode: false, createMode: false, busy: false, tableSelected: false, childSelected: false, permissions: {} });
      this.setModel(oUi, "ui");
      this.setModel(Messaging.getMessageModel(), "message");
      // the creations the user may perform (global authorization): Create is hidden otherwise
      var sService = this.getManifestEntry("/sap.app/dataSources/mainService/uri");
      fetch(sService + "$permissions", { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(function (oResponse) { return oResponse.ok ? oResponse.json() : {}; })
        .then(function (oPermissions) { oUi.setProperty("/permissions", oPermissions); })
        .catch(function () { /* the permissions stay unknown: every button is shown */ });
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
  "sap/ui/model/Filter"
], function (Dialog, Button, Label, Input, DatePicker, CheckBox, SimpleForm, Messaging, TableSelectDialog, Column, ColumnListItem, Text, Filter) {
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

    /** Opens the value help of a field; resolves the chosen values (none when cancelled). */
    valueHelp: function (oView, oHelp, bMulti) {
      return new Promise(function (resolve) {
        var bDone = false;
        var done = function (aValues) {
          if (!bDone) {
            bDone = true;
            resolve(aValues);
          }
        };
        var oDialog = new TableSelectDialog({
          title: oHelp.label,
          multiSelect: bMulti,
          growing: true,
          growingThreshold: 50,
          columns: oHelp.columns.map(function (c) {
            return new Column({ header: new Text({ text: c.label }) });
          }),
          search: function (oEvent) {
            var sValue = (oEvent.getParameter("value") || "").trim();
            var aText = oHelp.columns.filter(function (c) { return c.string; });
            oEvent.getSource().getBinding("items").filter(sValue === "" || aText.length === 0 ? [] : new Filter({
              filters: aText.map(function (c) {
                return new Filter({ path: c.property, operator: "Contains", value1: sValue, caseSensitive: false });
              }),
              and: false
            }));
          },
          confirm: function (oEvent) {
            done((oEvent.getParameter("selectedItems") || []).map(function (oItem) {
              return String(oItem.getBindingContext().getProperty(oHelp.element));
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
          parameters: { $count: true },
          template: new ColumnListItem({
            cells: oHelp.columns.map(function (c) {
              return new Text({ text: "{" + c.property + "}" });
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
      this._oLr = new JSONModel({ visible: oVisible, columns: {}, sort: [], active: 0, summary: "Filtered By: None", tableTitle: oPage.typeNamePlural, count: undefined, variant: STANDARD, defaultVariant: STANDARD, modified: false, variants: [{ key: STANDARD, title: oPage.typeNamePlural, author: "", changeable: false, favorite: true }] });
      this.getView().setModel(this._oLr, "lr");
      this._oStandard = this._state();
      // the bindings of other pages do not see the changes of this one: refresh when coming back
      var oRouter = this.getOwnerComponent().getRouter();
      var oRoute = oRouter.getRoute(this._sSet + "List");
      if (oRoute) {
        oRoute.attachPatternMatched(this._onListMatched, this);
      }
      var that = this;
      this._oStore = variants.store(this.getOwnerComponent(), this._sSet + "List");
      this._oStore.load().then(function (oData) {
        var aItems = [that._oLr.getProperty("/variants/0")].concat(oData.items.map(function (v) {
          return { key: v.key, title: v.title, author: "", changeable: true, favorite: v.favorite !== false, content: v.content };
        }));
        that._oLr.setProperty("/variants", aItems);
        var sDefault = aItems.some(function (v) { return v.key === oData.defaultKey; }) ? oData.defaultKey : STANDARD;
        that._oLr.setProperty("/defaultVariant", sDefault);
        if (sDefault !== STANDARD) {
          that._selectVariant(sDefault);
        }
      });
    },

    _page: function () {
      return support.page(this, this._sSet);
    },

    _onListMatched: function () {
      if (this.getOwnerComponent().takeStale(this._sSet)) {
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
        } else if (oField.kind === "boolean") {
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
        } else if (oField.kind === "boolean") {
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
        if (oField.kind === "date" || oField.kind === "datetime") {
          var oFrom = oControl.getDateValue();
          var oTo = oControl.getSecondDateValue();
          oFilter = filters.dateFilter(oField, oFrom ? support.dateText(oFrom) : "", oTo ? support.dateText(oTo) : "");
        } else if (oField.kind === "boolean") {
          var sKey = oControl.getSelectedKey();
          oFilter = sKey === "" ? null : new Filter(oField.property, "EQ", sKey === "true");
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
      oBinding.filter(aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : []);
      this._summarize();
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
  "rapt/app/controller/support"
], function (Controller, Messaging, MessageBox, MessageToast, MessagePopover, MessageItem, History, support) {
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

    _onObjectMatched: function (oEvent) {
      // changes left behind (back button in edit mode) must not be sent with the next save
      this.getView().getModel().resetChanges("changes");
      this._mode(false, false);
      Messaging.removeAllMessages();
      this.getView().bindElement({
        path: "/" + this._sSet + "(" + oEvent.getParameter("arguments").key + ")",
        parameters: { $$updateGroupId: "changes" }
      });
    },

    _onNewMatched: function () {
      var oContext = this.getOwnerComponent().getTransient();
      if (!oContext) {
        this._back();
        return;
      }
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
      support.valueHelp(this.getView(), oField.valueHelp, false).then(function (aValues) {
        if (aValues.length > 0) {
          oInput.getBindingContext().setProperty(sProperty, aValues[0]);
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
      this._mode(true, false);
    },

    onSave: function () {
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

    onCancel: function () {
      var bCreate = this._ui().getProperty("/createMode");
      this.getView().getModel().resetChanges("changes");
      Messaging.removeAllMessages();
      this._mode(false, false);
      if (bCreate) {
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
        oItem.getBindingContext().delete("changes");
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
