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
</head>
<body class="sapUiBody" id="content">
  <div data-sap-ui-component data-name="rapt.app" data-id="container" data-height="100%" data-settings='{"id": "rapt"}' style="height: 100%"></div>
</body>
</html>
`;
}

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
  "sap/ui/core/Messaging"
], function (Dialog, Button, Label, Input, DatePicker, CheckBox, SimpleForm, Messaging) {
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

export const LIST_CONTROLLER = `sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "rapt/app/controller/support"
], function (Controller, Filter, FilterOperator, MessageBox, MessageToast, support) {
  "use strict";

  function id(sName) {
    return sName.replace(/[^A-Za-z0-9_]/g, "_");
  }

  return Controller.extend("rapt.app.controller.List", {
    onInit: function () {
      this._sSet = this.byId("page").data("set");
    },

    _page: function () {
      return support.page(this, this._sSet);
    },

    onSearch: function () {
      var oPage = this._page();
      var aFilters = [];
      oPage.list.selectionFields.forEach(function (oField) {
        var oControl = this.byId("filter_" + id(oField.property));
        if (!oControl) {
          return;
        }
        if (oField.kind === "date") {
          var oDate = oControl.getDateValue();
          if (oDate) {
            aFilters.push(new Filter(oField.property, FilterOperator.EQ, support.dateText(oDate)));
          }
        } else if (oField.kind === "boolean") {
          var sKey = oControl.getSelectedKey();
          if (sKey !== "") {
            aFilters.push(new Filter(oField.property, FilterOperator.EQ, sKey === "true"));
          }
        } else {
          var sValue = oControl.getValue().trim();
          if (sValue === "") {
            return;
          }
          if (oField.kind === "integer" || oField.kind === "decimal" || oField.kind === "amount" || oField.kind === "uuid") {
            aFilters.push(new Filter(oField.property, FilterOperator.EQ, sValue));
          } else {
            aFilters.push(new Filter({ path: oField.property, operator: FilterOperator.Contains, value1: sValue, caseSensitive: false }));
          }
        }
      }, this);
      var oBinding = this.byId("table").getBinding("items");
      if (oPage.list.searchable && this.byId("search")) {
        var sSearch = this.byId("search").getValue().trim();
        oBinding.changeParameters({ $search: sSearch === "" ? undefined : sSearch });
      }
      oBinding.filter(aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : []);
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
