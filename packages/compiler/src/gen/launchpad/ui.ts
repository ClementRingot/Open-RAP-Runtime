/**
 * The UI of the launchpad (decision D37), plain OpenUI5 (sap.m, sap.f): the counterpart of the
 * SAP Fiori launchpad, whose shell (sap.ushell) exists in SAPUI5 only. A ShellBar (home, search,
 * user menu with the logout), the groups of tiles of `/launchpad/config` (GenericTile; a
 * NumericContent for the tiles with a count) and the navigation by intent (`#Travel-manage`).
 */

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function launchpadIndexHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <link rel="icon" href="logo.svg" type="image/svg+xml">
  <script id="sap-ui-bootstrap" src="../resources/sap-ui-core.js"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-async="true"
    data-sap-ui-compat-version="edge"
    data-sap-ui-resource-roots='{"rapt.launchpad": "./"}'
    data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"></script>
  <style>html, body { height: 100%; margin: 0; }</style>
</head>
<body class="sapUiBody" id="content">
  <div data-sap-ui-component data-name="rapt.launchpad" data-id="container" data-height="100%" data-settings='{"id": "launchpad"}' style="height: 100%"></div>
</body>
</html>
`;
}

export function launchpadManifest(title: string): string {
  return `${JSON.stringify(
    {
      "_version": "1.65.0",
      "sap.app": { id: "rapt.launchpad", type: "application", title, applicationVersion: { version: "1.0.0" } },
      "sap.ui": { technology: "UI5", deviceTypes: { desktop: true, tablet: true, phone: true } },
      "sap.ui5": {
        rootView: { viewName: "rapt.launchpad.view.Launchpad", type: "XML", id: "home" },
        dependencies: { minUI5Version: "1.136.0", libs: { "sap.m": {}, "sap.f": {} } },
        contentDensities: { compact: true, cozy: true },
        resources: { css: [{ uri: "css/style.css" }] },
      },
    },
    null,
    2,
  )}\n`;
}

export const LAUNCHPAD_COMPONENT = `sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("rapt.launchpad.Component", {
    metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({ title: "", user: {}, logout: "", groups: [], counts: {}, loaded: false, error: "", emptyText: "" }));
    }
  });
});
`;

export const LAUNCHPAD_VIEW = `<mvc:View controllerName="rapt.launchpad.controller.Launchpad" xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:f="sap.f" displayBlock="true" height="100%">
  <Page id="page" enableScrolling="true" class="raptLaunchpad">
    <customHeader>
      <f:ShellBar id="shellBar" title="{/title}" homeIcon="logo.svg" homeIconTooltip="Home" homeIconPressed=".onHome" avatarPressed=".onAvatarPressed">
        <f:searchManager>
          <f:SearchManager id="search" placeholder="Search for apps" liveChange=".onSearch" search=".onSearch"/>
        </f:searchManager>
        <f:profile>
          <Avatar id="avatar" initials="{/user/initials}" tooltip="{/user/name}"/>
        </f:profile>
      </f:ShellBar>
    </customHeader>
    <content>
      <MessageStrip id="message" visible="{= \${/error} !== '' }" text="{/error}" type="Error" showIcon="true" class="sapUiSmallMargin"/>
      <VBox id="groups" class="raptLaunchpadGroups"/>
      <Text id="empty" visible="{= \${/emptyText} !== '' }" text="{/emptyText}" class="raptLaunchpadEmpty"/>
    </content>
  </Page>
</mvc:View>
`;

export const LAUNCHPAD_CONTROLLER = `sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/GenericTile",
  "sap/m/TileContent",
  "sap/m/NumericContent",
  "sap/m/ImageContent",
  "sap/m/Title",
  "sap/m/FlexBox",
  "sap/m/VBox",
  "sap/m/Text",
  "sap/m/Button",
  "sap/m/ResponsivePopover"
], function (Controller, GenericTile, TileContent, NumericContent, ImageContent, Title, FlexBox, VBox, Text, Button, ResponsivePopover) {
  "use strict";

  var INTENT = /^([A-Za-z][A-Za-z0-9_]*-[A-Za-z][A-Za-z0-9_]*)(\\?.*)?$/;

  /** The menu of the user: its identifier, and the logout of the OIDC sessions. */
  function userMenu(sId, oUser, sLogout) {
    var aItems = [];
    if (oUser.id !== oUser.name) {
      aItems.push(new Text({ text: oUser.id }));
    }
    if (!sLogout) {
      aItems.push(new Text({ text: "Development user (no login)" }));
    }
    var oMenu = new ResponsivePopover(sId, { title: oUser.name, placement: "Bottom", contentMinWidth: "12rem" });
    if (aItems.length > 0) {
      oMenu.addContent(new VBox({ items: aItems }).addStyleClass("sapUiSmallMargin"));
    }
    if (sLogout) {
      oMenu.setBeginButton(new Button(sId + "-logout", {
        text: "Sign Out",
        icon: "sap-icon://log",
        press: function () {
          window.location.assign(sLogout);
        }
      }));
    }
    return oMenu;
  }

  return Controller.extend("rapt.launchpad.controller.Launchpad", {
    onInit: function () {
      var that = this;
      this._sQuery = "";
      fetch("/launchpad/config", { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(function (oResponse) {
          if (!oResponse.ok) {
            throw new Error("The launchpad answered " + oResponse.status);
          }
          return oResponse.json();
        })
        .then(function (oConfig) {
          var oModel = that._model();
          oModel.setProperty("/title", oConfig.title);
          oModel.setProperty("/user", oConfig.user);
          oModel.setProperty("/logout", oConfig.logout || "");
          oModel.setProperty("/groups", oConfig.groups);
          document.title = oConfig.title;
          // #SemanticObject-action: straight to the application of the intent
          if (that._navigateToIntent()) {
            return;
          }
          that._render();
          that._loadCounts();
          oModel.setProperty("/loaded", true);
        })
        .catch(function (oError) {
          that._model().setProperty("/error", oError.message);
        });
    },

    _model: function () {
      return this.getOwnerComponent().getModel();
    },

    _tiles: function () {
      return this._model().getProperty("/groups").reduce(function (aAll, oGroup) {
        return aAll.concat(oGroup.tiles);
      }, []);
    },

    _navigateToIntent: function () {
      var sHash = window.location.hash.replace(/^#/, "");
      try {
        sHash = decodeURIComponent(sHash);
      } catch (e) {
        // kept as written
      }
      var aMatch = INTENT.exec(sHash);
      if (!aMatch || aMatch[1] === "Shell-home") {
        return false;
      }
      var oTile = this._tiles().find(function (t) {
        return t.intent === aMatch[1];
      });
      if (!oTile) {
        this._model().setProperty("/error", "No application of the launchpad for the intent " + aMatch[1]);
        return false;
      }
      var sQuery = aMatch[2] || "";
      window.location.replace(oTile.target + (sQuery && oTile.target.indexOf("?") >= 0 ? "&" + sQuery.slice(1) : sQuery));
      return true;
    },

    _render: function () {
      var that = this;
      var oBox = this.byId("groups");
      var sQuery = this._sQuery.toLowerCase();
      var iVisible = 0;
      oBox.destroyItems();
      this._model().getProperty("/groups").forEach(function (oGroup) {
        var aTiles = oGroup.tiles.filter(function (t) {
          return !sQuery || [t.title, t.subtitle, t.info].some(function (s) {
            return !!s && s.toLowerCase().indexOf(sQuery) >= 0;
          });
        });
        if (aTiles.length === 0) {
          return;
        }
        iVisible += aTiles.length;
        var oTiles = new FlexBox({ wrap: "Wrap", renderType: "Bare" }).addStyleClass("raptLaunchpadTiles");
        aTiles.forEach(function (oTile) {
          oTiles.addItem(that._tile(oTile));
        });
        oBox.addItem(new VBox({ items: [new Title({ text: oGroup.title, level: "H2", titleStyle: "H4" }).addStyleClass("raptLaunchpadGroupTitle"), oTiles] }).addStyleClass("raptLaunchpadGroup"));
      });
      this._model().setProperty("/emptyText", iVisible > 0 ? "" : sQuery ? "No app matches the search." : "No application is assigned to your roles.");
    },

    _tile: function (oTile) {
      var oContent;
      if (oTile.count) {
        oContent = new NumericContent({ value: "{/counts/" + oTile.id + "}", icon: oTile.icon, withMargin: false, nullifyValue: false, animateTextChange: false });
      } else if (oTile.icon) {
        oContent = new ImageContent({ src: oTile.icon });
      }
      return new GenericTile(this.createId("tile-" + oTile.id), {
        header: oTile.title,
        subheader: oTile.subtitle,
        press: this._open.bind(this, oTile),
        tileContent: [new TileContent({ footer: oTile.info, content: oContent })]
      }).addStyleClass("raptLaunchpadTile");
    },

    /** The dynamic tiles: the $count of an entity set of an application, with the access controls of the user. */
    _loadCounts: function () {
      var oModel = this._model();
      this._tiles().filter(function (t) {
        return !!t.count;
      }).forEach(function (oTile) {
        fetch(oTile.count, { credentials: "same-origin", headers: { accept: "text/plain" } })
          .then(function (oResponse) {
            return oResponse.ok ? oResponse.text() : "";
          })
          .then(function (sCount) {
            oModel.setProperty("/counts/" + oTile.id, sCount.trim());
          })
          .catch(function () {
            oModel.setProperty("/counts/" + oTile.id, "");
          });
      });
    },

    _open: function (oTile) {
      if (oTile.external) {
        window.open(oTile.target, "_blank", "noopener");
      } else {
        window.location.assign(oTile.target);
      }
    },

    onHome: function () {
      window.location.assign("/");
    },

    onSearch: function (oEvent) {
      var sValue = oEvent.getParameter("newValue");
      this._sQuery = (sValue === undefined ? oEvent.getParameter("query") : sValue) || "";
      this._render();
    },

    onAvatarPressed: function (oEvent) {
      if (!this._oUserMenu) {
        this._oUserMenu = userMenu(this.createId("userMenu"), this._model().getProperty("/user"), this._model().getProperty("/logout"));
        this.getView().addDependent(this._oUserMenu);
      }
      this._oUserMenu.openBy(oEvent.getParameter("avatar"));
    }
  });
});
`;

export const LAUNCHPAD_CSS = `.raptLaunchpadGroups { padding: 1rem 2rem 0 2rem; }
.raptLaunchpadGroup { margin-bottom: 1.5rem; }
.raptLaunchpadGroupTitle { margin: 0 0 0.75rem 0; }
.raptLaunchpadTile { margin: 0 1rem 1rem 0; }
.raptLaunchpadEmpty { display: block; margin: 2rem; }
@media (max-width: 599px) {
  .raptLaunchpadGroups { padding: 1rem 1rem 0 1rem; }
  .raptLaunchpadTile { margin: 0 0.5rem 0.5rem 0; }
}
`;

/** The mark of the launchpad: four tiles. */
export const LAUNCHPAD_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect x="3" y="3" width="11" height="11" rx="2.5" fill="#0070f2"/>
  <rect x="18" y="3" width="11" height="11" rx="2.5" fill="#0070f2" fill-opacity="0.6"/>
  <rect x="3" y="18" width="11" height="11" rx="2.5" fill="#0070f2" fill-opacity="0.6"/>
  <rect x="18" y="18" width="11" height="11" rx="2.5" fill="#0070f2"/>
</svg>
`;
