/**
 * XML views of the generated UI (OpenUI5 freestyle, decision D10): one List Report per root
 * entity set (sap.f.DynamicPage, filter fields, sap.m.Table) and one Object Page per entity set
 * (sap.uxap.ObjectPageLayout, header actions, forms and child tables).
 */

import type { UiAction, UiField, UiLayout, UiPage, UiSection, UiTable } from "./layout.js";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Safe id of a property or action name. */
const idOf = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, "_");

/** `editable` of a field in an object page or a child table. */
function editable(field: UiField): string {
  if (field.computed) {
    return "false";
  }
  const conditions = ["${ui>/editMode}"];
  if (field.immutable) {
    conditions.push("${ui>/createMode}");
  }
  if (field.dynamic) {
    conditions.push(`\${__FieldControl/${field.property}} !== 1`);
  }
  return esc(`{= ${conditions.join(" && ")} }`);
}

/** A display control (list report cells). */
function display(field: UiField): string {
  switch (field.kind) {
    case "amount":
    case "decimal":
    case "integer":
      return `<ObjectNumber number="{${field.property}}"${field.unit === undefined ? "" : ` unit="{${field.unit}}"`} emphasized="false"/>`;
    case "boolean":
      return `<CheckBox selected="{${field.property}}" editable="false"/>`;
    default:
      return `<Text text="{${field.property}}"/>`;
  }
}

/** The value as text (display mode of a form or a child table). */
function text(field: UiField, id?: string): string {
  const idAttribute = id === undefined ? "" : ` id="${esc(id)}"`;
  switch (field.kind) {
    case "boolean":
      return `<CheckBox${idAttribute} selected="{${field.property}}" editable="false" visible="${esc("{= !${ui>/editMode} }")}"/>`;
    case "amount":
    case "decimal":
    case "integer":
      return `<ObjectNumber${idAttribute} number="{${field.property}}"${field.unit === undefined ? "" : ` unit="{${field.unit}}"`} emphasized="false" visible="${esc("{= !${ui>/editMode} }")}"/>`;
    default:
      return `<Text${idAttribute} text="{${field.property}}" visible="${esc("{= !${ui>/editMode} }")}"/>`;
  }
}

/** Text in display mode, input in edit mode. */
function displayOrInput(field: UiField, id: string | undefined): string {
  if (field.computed) {
    return text(field, id === undefined ? undefined : `text_${id}`).replace(/ visible="[^"]*"/, "");
  }
  return `${text(field, id === undefined ? undefined : `text_${id}`)}${input(field, id)}`;
}

/** An input control for an object page or a child table. */
function input(field: UiField, id: string | undefined): string {
  const common = `${id === undefined ? "" : `id="${esc(id)}" `}editable="${editable(field)}" visible="{ui>/editMode}"`;
  const required = field.mandatory ? ` required="{ui>/editMode}"` : "";
  switch (field.kind) {
    case "boolean":
      return `<CheckBox ${common} selected="{${field.property}}"/>`;
    case "date":
      return `<DatePicker ${common}${required} value="{${field.property}}"/>`;
    case "datetime":
      return `<DateTimePicker ${common}${required} value="{${field.property}}"/>`;
    case "time":
      return `<TimePicker ${common}${required} value="{${field.property}}"/>`;
    default:
      return `<Input ${common}${required} value="{${field.property}}"${field.unit === undefined ? "" : ` description="{${field.unit}}"`}/>`;
  }
}

function actionButton(action: UiAction, owner: string, scope: "object" | "list" | "table"): string {
  const press = `.onAction`;
  const enabled =
    scope === "object" && action.dynamic && !action.static
      ? ` enabled="${esc(`{= \${__OperationControl/${action.name}} !== false && !\${ui>/editMode} }`)}"`
      : scope === "object"
        ? ` enabled="${esc("{= !${ui>/editMode} }")}"`
        : action.static
          ? ""
          : ` enabled="{ui>/${owner}Selected}"`;
  return `<Button id="${esc(`${owner}Action_${idOf(action.name)}`)}" text="${esc(action.label)}" press="${press}"${enabled}>
            <customData><core:CustomData key="action" value="${esc(action.name)}"/><core:CustomData key="scope" value="${scope}"/><core:CustomData key="owner" value="${esc(owner)}"/></customData>
          </Button>`;
}

function columns(table: UiTable): string {
  return table.columns
    .map((c) => `<Column id="${esc(`${idOf(table.set)}${table.navigation === undefined ? "" : "Child"}Col_${idOf(c.property)}`)}"${c.importance === "Low" ? ' demandPopin="true" minScreenWidth="Tablet"' : ""}${c.kind === "amount" || c.kind === "decimal" || c.kind === "integer" ? ' hAlign="End"' : ""}><Text text="${esc(c.label)}"/></Column>`)
    .join("\n            ");
}

function listReport(page: UiPage): string {
  const list = page.list as NonNullable<UiPage["list"]>;
  const table = list.table;
  const parameters = [`$count: true`, ...(table.orderby === undefined ? [] : [`$orderby: '${table.orderby}'`])];
  const filters = list.selectionFields
    .map((f) => {
      const control =
        f.kind === "date"
          ? `<DatePicker id="filter_${idOf(f.property)}" width="12rem" change=".onSearch"/>`
          : f.kind === "boolean"
            ? `<Select id="filter_${idOf(f.property)}" width="8rem" change=".onSearch"><core:Item key="" text=""/><core:Item key="true" text="Yes"/><core:Item key="false" text="No"/></Select>`
            : `<Input id="filter_${idOf(f.property)}" width="12rem" submit=".onSearch"/>`;
      return `<VBox class="sapUiSmallMarginEnd"><Label text="${esc(f.label)}" labelFor="filter_${idOf(f.property)}"/>${control}</VBox>`;
    })
    .join("\n              ");
  const search = list.searchable ? `<VBox class="sapUiSmallMarginEnd"><Label text="Search" labelFor="search"/><SearchField id="search" width="14rem" search=".onSearch"/></VBox>` : "";
  return `<mvc:View controllerName="rapt.app.controller.List" xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:f="sap.f" xmlns:core="sap.ui.core">
  <f:DynamicPage id="page" toggleHeaderOnTitleClick="false">
    <f:customData><core:CustomData key="set" value="${esc(page.set)}"/></f:customData>
    <f:title>
      <f:DynamicPageTitle>
        <f:heading><Title text="${esc(page.typeNamePlural)}" level="H2"/></f:heading>
      </f:DynamicPageTitle>
    </f:title>
    <f:header>
      <f:DynamicPageHeader pinnable="false">
        <HBox wrap="Wrap" alignItems="End">
              ${search}
              ${filters}
          <Button id="go" text="Go" type="Emphasized" press=".onSearch" class="sapUiSmallMarginBottom"/>
        </HBox>
      </f:DynamicPageHeader>
    </f:header>
    <f:content>
      <Table id="table" growing="true" growingThreshold="25" growingScrollToLoad="true" mode="SingleSelectLeft" selectionChange=".onSelectionChange" sticky="ColumnHeaders,HeaderToolbar"
        items="{path: '/${esc(page.set)}', parameters: {${esc(parameters.join(", "))}}}">
        <headerToolbar>
          <OverflowToolbar>
            <Title id="tableTitle" text="${esc(page.typeNamePlural)}" level="H3"/>
            <ToolbarSpacer/>
            ${table.insertable ? `<Button id="create" text="Create" type="Transparent" press=".onCreate"/>` : ""}
            ${table.deletable ? `<Button id="delete" text="Delete" type="Transparent" press=".onDelete" enabled="{ui>/tableSelected}"/>` : ""}
            ${table.actions.map((a) => actionButton(a, "table", "list")).join("\n            ")}
          </OverflowToolbar>
        </headerToolbar>
        <columns>
            ${columns(table)}
        </columns>
        <items>
          <ColumnListItem type="Navigation" press=".onItemPress">
            <cells>
              ${table.columns.map(display).join("\n              ")}
            </cells>
          </ColumnListItem>
        </items>
      </Table>
    </f:content>
  </f:DynamicPage>
</mvc:View>
`;
}

function form(section: Extract<UiSection, { kind: "form" }>): string {
  const content = section.fields
    .map((f) => `<Label text="${esc(f.label)}"${f.mandatory ? ' required="{ui>/editMode}"' : ""}/>\n                ${displayOrInput(f, `field_${idOf(section.id)}_${idOf(f.property)}`)}`)
    .join("\n                ");
  return `<form:SimpleForm id="form_${idOf(section.id)}" editable="true" layout="ColumnLayout" columnsM="2" columnsL="3" columnsXL="4">
              <form:content>
                ${content}
              </form:content>
            </form:SimpleForm>`;
}

function childTable(section: Extract<UiSection, { kind: "table" }>): string {
  const table = section.table;
  const id = `table_${idOf(section.id)}`;
  return `<Table id="${id}" growing="true" growingThreshold="20" mode="{= \${ui>/editMode} ? 'SingleSelectLeft' : 'None' }" selectionChange=".onChildSelectionChange"
              items="{path: '${esc(table.navigation ?? "")}', parameters: {$$updateGroupId: 'changes'${table.orderby === undefined ? "" : `, $orderby: '${esc(table.orderby)}'`}}}">
              <customData><core:CustomData key="set" value="${esc(table.set)}"/></customData>
              <headerToolbar>
                <OverflowToolbar>
                  <Title text="${esc(section.label)}" level="H4"/>
                  <ToolbarSpacer/>
                  ${table.insertable ? `<Button id="${id}_create" text="Create" type="Transparent" press=".onCreateChild" visible="{ui>/editMode}"><customData><core:CustomData key="table" value="${id}"/></customData></Button>` : ""}
                  ${table.deletable ? `<Button id="${id}_delete" text="Delete" type="Transparent" press=".onDeleteChild" visible="{ui>/editMode}" enabled="{ui>/childSelected}"><customData><core:CustomData key="table" value="${id}"/></customData></Button>` : ""}
                </OverflowToolbar>
              </headerToolbar>
              <columns>
                ${columns(table)}
              </columns>
              <items>
                <ColumnListItem type="{= \${ui>/editMode} ? 'Inactive' : 'Navigation' }" press=".onChildPress">
                  <cells>
                    ${table.columns.map((c) => `<VBox>${displayOrInput(c, undefined)}</VBox>`).join("\n                    ")}
                  </cells>
                </ColumnListItem>
              </items>
            </Table>`;
}

function section(s: UiSection): string {
  const subSections =
    s.kind === "collection"
      ? s.sections.map((inner) => `<uxap:ObjectPageSubSection id="sub_${idOf(inner.id)}" title="${esc(inner.label)}"><uxap:blocks>${inner.kind === "table" ? childTable(inner) : inner.kind === "form" ? form(inner) : ""}</uxap:blocks></uxap:ObjectPageSubSection>`).join("\n        ")
      : `<uxap:ObjectPageSubSection id="sub_${idOf(s.id)}" title="${esc(s.label)}" showTitle="false">
          <uxap:blocks>
            ${s.kind === "table" ? childTable(s) : form(s)}
          </uxap:blocks>
        </uxap:ObjectPageSubSection>`;
  return `<uxap:ObjectPageSection id="section_${idOf(s.id)}" title="${esc(s.label)}" titleUppercase="false">
      <uxap:subSections>
        ${subSections}
      </uxap:subSections>
    </uxap:ObjectPageSection>`;
}

function objectPage(page: UiPage): string {
  const title = page.title === undefined ? `<Title text="${esc(page.typeName)}" wrapping="true"/>` : `<Title text="{${page.title}}" wrapping="true"/>`;
  const edit = page.updatable
    ? `<Button id="edit" text="Edit" type="Emphasized" press=".onEdit" visible="{= !\${ui>/editMode} }"${page.updatableDynamic ? ` enabled="${esc("{= ${__EntityControl/Updatable} !== false }")}"` : ""}/>`
    : "";
  const remove = page.deletable
    ? `<Button id="deleteObject" text="Delete" type="Transparent" press=".onDelete" visible="{= !\${ui>/editMode} }"${page.deletableDynamic ? ` enabled="${esc("{= ${__EntityControl/Deletable} !== false }")}"` : ""}/>`
    : "";
  return `<mvc:View controllerName="rapt.app.controller.Object" xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:uxap="sap.uxap" xmlns:form="sap.ui.layout.form" xmlns:core="sap.ui.core">
  <uxap:ObjectPageLayout id="page" showFooter="{ui>/editMode}" upperCaseAnchorBar="false" busy="{ui>/busy}" busyIndicatorDelay="0">
    <uxap:customData><core:CustomData key="set" value="${esc(page.set)}"/></uxap:customData>
    <uxap:headerTitle>
      <uxap:ObjectPageDynamicHeaderTitle id="headerTitle">
        <uxap:heading>${title}</uxap:heading>
        <uxap:snappedTitleOnMobile><Title text="${esc(page.typeName)}"/></uxap:snappedTitleOnMobile>
        <uxap:expandedContent>${page.description === undefined ? `<Text text="${esc(page.typeName)}"/>` : `<Text text="{${page.description}}"/>`}</uxap:expandedContent>
        <uxap:actions>
          ${edit}
          ${remove}
          ${page.actions.map((a) => actionButton(a, "object", "object")).join("\n          ")}
        </uxap:actions>
      </uxap:ObjectPageDynamicHeaderTitle>
    </uxap:headerTitle>
    <uxap:sections>
    ${page.sections.map(section).join("\n    ")}
    </uxap:sections>
    <uxap:footer>
      <OverflowToolbar>
        <Button id="messages" icon="sap-icon://message-popup" type="Negative" text="{= \${message>/}.length }" visible="{= \${message>/}.length > 0 }" press=".onMessages"/>
        <ToolbarSpacer/>
        <Button id="save" text="{= \${ui>/createMode} ? 'Create' : 'Save' }" type="Emphasized" press=".onSave"/>
        <Button id="cancel" text="Cancel" press=".onCancel"/>
      </OverflowToolbar>
    </uxap:footer>
  </uxap:ObjectPageLayout>
</mvc:View>
`;
}

export function views(layout: UiLayout): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  for (const page of layout.pages) {
    if (page.list !== undefined) {
      files.push({ path: `view/${page.set}List.view.xml`, content: listReport(page) });
    }
    files.push({ path: `view/${page.set}Object.view.xml`, content: objectPage(page) });
  }
  return files;
}
