/**
 * XML views of the generated UI (OpenUI5 freestyle, decision D10): one List Report per root
 * entity set (sap.f.DynamicPage, filter fields, sap.m.Table) and one Object Page per entity set
 * (sap.uxap.ObjectPageLayout, header actions, forms and child tables).
 */

import type { UiAction, UiCard, UiField, UiLayout, UiPage, UiSection, UiTable } from "./layout.js";

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
    // %{…}: the value itself; ${…} would give the text formatted by the OData type ("1")
    conditions.push(`%{__FieldControl/${field.property}} !== 1`);
  }
  return esc(`{= ${conditions.join(" && ")} }`);
}

/**
 * The label of the member of an enumeration type (D55), as an expression binding: the raw value
 * (%{…}) is the member name.
 */
function enumText(field: UiField): string {
  const value = `%{${field.property}}`;
  const cases = (field.options ?? []).map((o) => `${value} === '${o.key.replace(/'/g, "\\'")}' ? '${o.text.replace(/'/g, "\\'")}' : `).join("");
  return esc(`{= ${cases}${value} }`);
}

/** The binding of an enumeration value: a string, the OData type of the member names. */
function enumValue(field: UiField): string {
  return esc(`{ path: '${field.property}', type: 'sap.ui.model.odata.type.String' }`);
}

function enumItems(field: UiField, empty: boolean): string {
  return `${empty ? `<core:Item key="" text=""/>` : ""}${(field.options ?? []).map((o) => `<core:Item key="${esc(o.key)}" text="${esc(o.text)}"/>`).join("")}`;
}

/** The state of a criticality (0 neutral, 1 negative, 2 critical, 3 positive), as an expression (D57). */
function criticalityState(field: UiField): string {
  const c = `%{${field.criticality ?? ""}}`;
  return esc(`{= ${c} === 1 ? 'Error' : ${c} === 2 ? 'Warning' : ${c} === 3 ? 'Success' : 'None' }`);
}

/** The value with its text (`@ObjectModel.text.element`, `@UI.textArrangement`, D57). */
function valueText(field: UiField): string {
  if (field.kind === "enum") {
    return enumText(field);
  }
  const text = field.text;
  if (text === undefined || text.arrangement === "TextSeparate") {
    return `{${field.property}}`;
  }
  const v = `\${${field.property}}`;
  const t = `\${${text.property}}`;
  switch (text.arrangement) {
    case "TextOnly":
      return esc(`{= ${t} ? ${t} : ${v} }`);
    case "TextLast":
      return esc(`{= ${t} ? ${v} + ' (' + ${t} + ')' : ${v} }`);
    default:
      return esc(`{= ${t} ? ${t} + ' (' + ${v} + ')' : ${v} }`);
  }
}

/**
 * A display control: numbers, check boxes, links (e-mail, phone, URL), statuses with their
 * criticality, texts. `extra`: attributes (id, visibility).
 */
function displayControl(field: UiField, extra: string): string {
  const state = field.criticality === undefined ? "" : ` state="${criticalityState(field)}"`;
  switch (field.kind) {
    case "amount":
    case "decimal":
    case "integer":
      return `<ObjectNumber${extra} number="{${field.property}}"${field.unit === undefined ? "" : ` unit="{${field.unit}}"`} emphasized="false"${state}/>`;
    case "boolean":
      return `<CheckBox${extra} selected="{${field.property}}" editable="false"/>`;
    default:
      break;
  }
  if (field.link !== undefined) {
    const href =
      field.link.kind === "url" ? `{${field.link.url ?? field.property}}` : esc(`{= ${field.link.kind === "email" ? "'mailto:'" : "'tel:'"} + \${${field.property}} }`);
    return `<Link${extra} text="${valueText(field)}" href="${href}"${field.link.kind === "url" ? ' target="_blank"' : ""}/>`;
  }
  if (field.criticality !== undefined) {
    return `<ObjectStatus${extra} text="${valueText(field)}"${state}/>`;
  }
  return `<Text${extra} text="${valueText(field)}"${field.multiLine === true ? ' renderWhitespace="true"' : ""}/>`;
}

/** A display control (list report cells). */
function display(field: UiField): string {
  return displayControl(field, "");
}

/** The value as text (display mode of a form or a child table). */
function text(field: UiField, id?: string): string {
  const idAttribute = id === undefined ? "" : ` id="${esc(id)}"`;
  return displayControl(field, `${idAttribute} visible="${esc("{= !${ui>/editMode} }")}"`);
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
  if (field.multiLine === true && field.kind === "text" && field.valueHelp === undefined) {
    return `<TextArea ${common}${required} value="{${field.property}}" rows="4" width="100%" growing="true"/>`;
  }
  switch (field.kind) {
    case "enum":
      return `<Select ${common}${required} forceSelection="false" width="100%" selectedKey="${enumValue(field)}">${enumItems(field, false)}</Select>`;
    case "boolean":
      return `<CheckBox ${common} selected="{${field.property}}"/>`;
    case "date":
      return `<DatePicker ${common}${required} value="{${field.property}}"/>`;
    case "datetime":
      return `<DateTimePicker ${common}${required} value="{${field.property}}"/>`;
    case "time":
      return `<TimePicker ${common}${required} value="{${field.property}}"/>`;
    default: {
      const help = field.valueHelp;
      const property = `<customData><core:CustomData key="property" value="${esc(field.property)}"/></customData>`;
      if (help?.fixedValues === true) {
        // a drop-down list of the values (Common.ValueListWithFixedValues)
        const description = help.columns.slice(1).find((c) => c.string);
        // the elements of the items and of the additional bindings
        const select = [...new Set([help.element, ...(description === undefined ? [] : [description.property]), ...(help.bindings ?? []).map((b) => b.element)])].join(",");
        return `<ComboBox ${common}${required} width="100%"${description === undefined ? "" : ` showSecondaryValues="true"`} selectedKey="{${field.property}}" selectionChange=".onValueHelpChange" items="${esc(`{ path: '/${help.set}', templateShareable: false, length: 500, parameters: { $select: '${select}' } }`)}"><items><core:ListItem key="{${help.element}}" text="{${help.element}}"${description === undefined ? "" : ` additionalText="{${description.property}}"`}/></items>${property}</ComboBox>`;
      }
      const check = help !== undefined && (help.validation === true || (help.bindings ?? []).some((b) => b.usage !== "filter")) ? ` change=".onValueHelpChange"` : "";
      return `<Input ${common}${required} value="{${field.property}}"${field.unit === undefined ? "" : ` description="{${field.unit}}"`}${
        help === undefined ? "/>" : ` showValueHelp="true" valueHelpRequest=".onValueHelp"${check}>${property}</Input>`
      }`;
    }
  }
}

function actionButton(action: UiAction, owner: string, scope: "object" | "list" | "table"): string {
  const press = `.onAction`;
  const enabled =
    scope === "object" && action.dynamic && !action.static
      ? ` enabled="${esc(`{= %{__OperationControl/${action.name}} !== false && !\${ui>/editMode} }`)}"`
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

/** The control of a filter field: conditions (tokens), date range or yes/no. */
function filterControl(f: UiField): string {
  const controlId = `filter_${idOf(f.property)}`;
  switch (f.kind) {
    case "date":
    case "datetime":
      return `<DateRangeSelection id="${controlId}" width="100%" change=".onFilterChange"/>`;
    case "boolean":
      return `<Select id="${controlId}" width="100%" change=".onFilterChange"><core:Item key="" text=""/><core:Item key="true" text="Yes"/><core:Item key="false" text="No"/></Select>`;
    case "enum":
      return `<Select id="${controlId}" width="100%" change=".onFilterChange">${enumItems(f, true)}</Select>`;
    default:
      return `<MultiInput id="${controlId}" width="100%"${f.filter?.single === true ? ' maxTokens="1"' : ""} submit=".onFilterSubmit" tokenUpdate=".onFilterChange" showValueHelp="${f.valueHelp === undefined ? "false" : "true"}" valueHelpRequest=".onFilterValueHelp" placeholder="${esc(placeholderOf(f))}"><customData><core:CustomData key="property" value="${esc(f.property)}"/></customData></MultiInput>`;
  }
}

/** A hint of the condition syntax of a filter field. */
function placeholderOf(f: UiField): string {
  return f.kind === "text" ? "contains, =, *, !=" : "=, >, <, a...b";
}

function listReport(page: UiPage): string {
  const list = page.list as NonNullable<UiPage["list"]>;
  const table = list.table;
  // draft (D54): the active instances and the new drafts; an edited instance shows its marker
  const parameters = [`$count: true`, ...(table.orderby === undefined ? [] : [`$orderby: '${table.orderby}'`]), ...(page.draft === undefined ? [] : [`$filter: 'IsActiveEntity eq true or HasActiveEntity eq false'`])];
  const filters = list.filterFields
    .map((f) => `<VBox id="filterItem_${idOf(f.property)}" class="raptFilterItem" width="12rem" visible="{= %{lr>/visible/${f.property}} === true }"><Label text="${esc(f.label)}" labelFor="filter_${idOf(f.property)}"${f.filter?.mandatory === true ? ' required="true"' : ""}/>${filterControl(f)}</VBox>`)
    .join("\n          ");
  const search = list.searchable
    ? `<VBox class="raptFilterItem" width="12rem"><Label text="Search" labelFor="search"/><SearchField id="search" width="100%" search=".onSearch"/></VBox>`
    : "";
  const worklist = page.floorplan === "worklist";
  const alp = page.floorplan === "analyticalListPage";
  const chart = alp ? page.charts[0] : undefined;
  // worklist: no filter bar; the search in the toolbar, the selection variants as tabs (D53)
  const header = worklist
    ? ""
    : `<f:header>
      <f:DynamicPageHeader pinnable="true">
        <FlexBox id="filterBar" wrap="Wrap" alignItems="End" class="raptFilterBar">
          ${search}
          ${filters}
          <HBox id="filterButtons" class="raptFilterItem raptFilterButtons">
            <Button id="go" text="Go" type="Emphasized" press=".onSearch"/>
            <Button id="clearFilters" text="Clear" type="Transparent" press=".onClearFilters" class="sapUiTinyMarginBegin"/>
            <Button id="adaptFilters" text="{= 'Adapt Filters' + (\${lr>/active} > 0 ? ' (' + \${lr>/active} + ')' : '') }" type="Transparent" press=".onAdaptFilters" class="sapUiTinyMarginBegin"/>
          </HBox>
        </FlexBox>
      </f:DynamicPageHeader>
    </f:header>`;
  const tabs =
    worklist && page.selectionVariants.length > 0
      ? `<IconTabHeader id="worklistTabs" mode="Inline" select=".onWorklistTab" selectedKey="all">
          <items>
            <IconTabFilter key="all" text="All" count="{lr>/tabCounts/all}"/>
            ${page.selectionVariants.map((v) => `<IconTabFilter key="${esc(v.key)}" text="${esc(v.text)}" count="{lr>/tabCounts/${esc(v.key)}}"/>`).join("\n            ")}
          </items>
        </IconTabHeader>`
      : "";
  // analytical list page: the chart above the table, the views chart / table / both (D53)
  const chartArea =
    chart === undefined
      ? ""
      : `<VBox id="chartArea" visible="{= \${lr>/view} !== 'table' }" class="raptChartArea">
          <Toolbar style="Clear"><Title id="chartTitle" text="${esc(chart.title)}" level="H3"/><ToolbarSpacer/><Text id="chartSelection" text="{= \${lr>/chartSelection} ? '${esc(chart.dimension.label)}: ' + \${lr>/chartSelection} : '' }"/></Toolbar>
          <rapt:Chart id="chart" type="${chart.type}" height="16rem" select=".onChartSelect"/>
        </VBox>`;
  const viewSwitch =
    chart === undefined
      ? ""
      : `<SegmentedButton id="viewSwitch" selectedKey="{lr>/view}" selectionChange=".onViewSwitch">
              <items>
                <SegmentedButtonItem key="both" icon="sap-icon://chart-table-view" tooltip="Chart and table"/>
                <SegmentedButtonItem key="chart" icon="sap-icon://vertical-bar-chart" tooltip="Chart"/>
                <SegmentedButtonItem key="table" icon="sap-icon://table-view" tooltip="Table"/>
              </items>
            </SegmentedButton>`;
  const toolbarSearch = worklist && list.searchable ? `<SearchField id="search" width="14rem" search=".onSearch"/>` : "";
  return `<mvc:View controllerName="rapt.app.controller.List" xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:f="sap.f" xmlns:core="sap.ui.core" xmlns:rapt="rapt.app.controller">
  <f:DynamicPage id="page" toggleHeaderOnTitleClick="true" headerPinned="false">
    <f:customData><core:CustomData key="set" value="${esc(page.set)}"/><core:CustomData key="floorplan" value="${page.floorplan}"/></f:customData>
    <f:title>
      <f:DynamicPageTitle>
        <f:heading>
          <VariantManagement id="variants" level="H2" titleStyle="H2" supportPublic="false" supportContexts="false" supportApplyAutomatically="false"
            selectedKey="{lr>/variant}" defaultKey="{lr>/defaultVariant}" modified="{lr>/modified}"
            select=".onVariantSelect" save=".onVariantSave" manage=".onVariantManage"
            items="{path: 'lr>/variants', templateShareable: false}">
            <items><VariantItem key="{lr>key}" title="{lr>title}" author="{lr>author}" rename="{lr>changeable}" remove="{lr>changeable}" changeable="{lr>changeable}" favorite="{lr>favorite}"/></items>
          </VariantManagement>
        </f:heading>
        <f:snappedContent><Text id="filterSummary" text="{lr>/summary}"/></f:snappedContent>
      </f:DynamicPageTitle>
    </f:title>
    ${header}
    <f:content>
      <VBox id="content" renderType="Bare" height="100%">
      ${tabs}
      ${chartArea}
      <Table id="table" visible="{= \${lr>/view} !== 'chart' }" growing="true" growingThreshold="25" growingScrollToLoad="true" mode="SingleSelectLeft" selectionChange=".onSelectionChange" updateFinished=".onUpdateFinished" sticky="ColumnHeaders,HeaderToolbar"
        items="{path: '/${esc(page.set)}', parameters: {${esc(parameters.join(", "))}}}">
        <headerToolbar>
          <OverflowToolbar>
            <Title id="tableTitle" text="{lr>/tableTitle}" level="H3"><customData><core:CustomData key="plural" value="${esc(page.typeNamePlural)}"/></customData></Title>
            <ToolbarSpacer/>
            ${toolbarSearch}
            ${table.insertable ? `<Button id="create" text="Create" type="Transparent" press=".onCreate" visible="${esc(`{= %{ui>/permissions/${page.set}/create} !== false }`)}"/>` : ""}
            ${table.deletable ? `<Button id="delete" text="Delete" type="Transparent" press=".onDelete" enabled="{ui>/tableSelected}"/>` : ""}
            ${table.actions.map((a) => actionButton(a, "table", "list")).join("\n            ")}
            <Button id="tableSettings" icon="sap-icon://action-settings" tooltip="Table settings" type="Transparent" press=".onTableSettings"/>
            ${viewSwitch}
          </OverflowToolbar>
        </headerToolbar>
        <columns>
            ${listColumns(table)}
            ${page.draft === undefined ? "" : `<Column id="${esc(idOf(table.set))}Col_EditingStatus" width="8rem"><Text text="Editing Status"/></Column>`}
        </columns>
        <items>
          <ColumnListItem type="Navigation" press=".onItemPress">
            <cells>
              ${table.columns.map(display).join("\n              ")}
              ${page.draft === undefined ? "" : `<ObjectMarker type="${esc("{= ${IsActiveEntity} ? 'Locked' : 'Draft' }")}" visible="${esc("{= !${IsActiveEntity} || ${HasDraftEntity} }")}"/>`}
            </cells>
          </ColumnListItem>
        </items>
      </Table>
      </VBox>
    </f:content>
  </f:DynamicPage>
</mvc:View>
`;
}

/** A card of the Overview Page (D53): list, table, chart or KPI. */
function cardXml(card: UiCard): string {
  const params = [`$count: true`, ...(card.filter === undefined ? [] : [`$filter: '${card.filter.replace(/'/g, "\\'")}'`]), ...(card.orderby === undefined ? [] : [`$orderby: '${card.orderby}'`])];
  const items = `{path: '/${card.set}', parameters: {${params.join(", ")}}}`;
  const header =
    card.type === "kpi"
      ? `<card:NumericHeader id="${card.id}_header" title="${esc(card.title)}" subtitle="${esc(card.subtitle ?? "")}" number="{ovp>/kpi/${card.id}/number}" unitOfMeasurement="{ovp>/kpi/${card.id}/unit}" details="{ovp>/kpi/${card.id}/details}" press=".onCardHeader"/>`
      : `<card:Header id="${card.id}_header" title="${esc(card.title)}" subtitle="${esc(card.subtitle ?? "")}" statusText="{ovp>/counts/${card.id}}" press=".onCardHeader"/>`;
  const [first, second, third] = card.fields;
  let content = "";
  if (card.type === "list") {
    content = `<List id="${card.id}_list" growing="false" growingThreshold="${card.top}" showNoData="true" items="${esc(items)}" updateFinished=".onCardUpdated" showSeparators="Inner">
            <items><StandardListItem type="Navigation" press=".onCardItem" title="{${first?.property ?? ""}}"${second === undefined ? "" : ` description="{${second.property}}"`}${third === undefined ? "" : ` info="{${third.property}}"`}/></items>
          </List>`;
  } else if (card.type === "table") {
    content = `<Table id="${card.id}_table" growing="false" growingThreshold="${card.top}" items="${esc(items)}" updateFinished=".onCardUpdated">
            <columns>${card.fields.map((f) => `<Column${f.kind === "amount" || f.kind === "decimal" || f.kind === "integer" ? ' hAlign="End"' : ""}><Text text="${esc(f.label)}"/></Column>`).join("")}</columns>
            <items><ColumnListItem type="Navigation" press=".onCardItem"><cells>${card.fields.map(display).join("")}</cells></ColumnListItem></items>
          </Table>`;
  } else if (card.type === "chart") {
    content = `<rapt:Chart id="${card.id}_chart" type="${card.chart?.type ?? "column"}" height="14rem" select=".onCardChartSelect"/>`;
  } else {
    content = `<VBox id="${card.id}_kpi" class="sapUiSmallMargin"><Text text="{ovp>/kpi/${card.id}/text}"/></VBox>`;
  }
  return `<f:Card id="${card.id}" width="${card.type === "table" || card.type === "chart" ? "36rem" : "22rem"}" class="raptCard">
        <f:customData><core:CustomData key="card" value="${card.id}"/></f:customData>
        <f:header>${header}</f:header>
        <f:content>
          ${content}
        </f:content>
      </f:Card>`;
}

/** The Overview Page (D53): the cards of rapt/config.json in a grid. */
function overviewPage(layout: UiLayout): string {
  const overview = layout.overview as NonNullable<UiLayout["overview"]>;
  return `<mvc:View controllerName="rapt.app.controller.Overview" xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:f="sap.f" xmlns:card="sap.f.cards" xmlns:core="sap.ui.core" xmlns:rapt="rapt.app.controller">
  <f:DynamicPage id="page" toggleHeaderOnTitleClick="false" class="raptOverview">
    <f:title>
      <f:DynamicPageTitle>
        <f:heading><Title id="overviewTitle" text="${esc(overview.title)}" level="H2"/></f:heading>
      </f:DynamicPageTitle>
    </f:title>
    <f:content>
      <FlexBox id="cards" wrap="Wrap" alignItems="Start" class="raptCards">
      ${overview.cards.map(cardXml).join("\n      ")}
      </FlexBox>
    </f:content>
  </f:DynamicPage>
</mvc:View>
`;
}

/** The columns of the list report: their visibility is a setting of the user (variants). */
function listColumns(table: UiTable): string {
  return table.columns
    .map((c) => `<Column id="${esc(`${idOf(table.set)}Col_${idOf(c.property)}`)}" visible="{= %{lr>/columns/${c.property}} !== false }"${c.importance === "Low" ? ' demandPopin="true" minScreenWidth="Tablet"' : ""}${c.kind === "amount" || c.kind === "decimal" || c.kind === "integer" ? ' hAlign="End"' : ""}><Text text="${esc(c.label)}"/></Column>`)
    .join("\n            ");
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
              items="{path: '${esc(table.navigation ?? "")}', parameters: {$$updateGroupId: '${table.draft === true ? "$auto" : "changes"}'${table.orderby === undefined ? "" : `, $orderby: '${esc(table.orderby)}'`}}}">
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
                    ${table.columns.map((c) => `<VBox${c.kind === "amount" || c.kind === "decimal" || c.kind === "integer" ? ' alignItems="End"' : ""}>${displayOrInput(c, undefined)}</VBox>`).join("\n                    ")}
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

/** Breadcrumbs of an object page: the list report, then the parent object (back). */
function breadcrumbs(page: UiPage, layout: UiLayout): string {
  const start = layout.pages.find((p) => p.set === layout.start);
  const parent = layout.pages.find((p) => p.set !== page.set && p.sections.some((s) => tablesOf(s).some((t) => t.set === page.set)));
  const links = [];
  if (start?.list !== undefined) {
    links.push(`<Link id="crumbList" text="${esc(start.typeNamePlural)}" press=".onNavList"/>`);
  }
  if (parent !== undefined) {
    links.push(`<Link id="crumbParent" text="${esc(parent.typeName)}" press=".onNavBack"/>`);
  }
  return links.length === 0 ? "" : `<uxap:breadcrumbs><Breadcrumbs id="breadcrumbs" currentLocationText="${esc(page.typeName)}">${links.join("")}</Breadcrumbs></uxap:breadcrumbs>`;
}

function tablesOf(section: UiSection): UiTable[] {
  return section.kind === "table" ? [section.table] : section.kind === "collection" ? section.sections.flatMap(tablesOf) : [];
}

/** The header facets of the object page: data points and field groups (D57). */
function headerContent(page: UiPage): string {
  const facets = page.headerFacets ?? [];
  if (facets.length === 0) {
    return "";
  }
  const blocks = facets.map((facet) => {
    const title = facet.title === "" ? "" : `<Title text="${esc(facet.title)}" level="H5" class="sapUiTinyMarginBottom"/>`;
    if (facet.kind === "fields") {
      const rows = facet.fields.map((f) => `<HBox alignItems="Center"><Label text="${esc(f.label)}:" class="sapUiTinyMarginEnd"/>${display(f)}</HBox>`).join("");
      return `<VBox id="header_${idOf(facet.id)}" class="sapUiLargeMarginEnd sapUiSmallMarginBottom">${title}${rows}</VBox>`;
    }
    const f = facet.field;
    const state = f.criticality === undefined ? "" : ` state="${criticalityState(f)}"`;
    let control: string;
    if (facet.visualization === "rating") {
      control = `<RatingIndicator value="{${f.property}}" maxValue="${facet.target ?? 5}" editable="false" iconSize="1.25rem"/>`;
    } else if (facet.visualization === "progress") {
      const target = facet.target ?? 100;
      control = `<ProgressIndicator width="12rem" percentValue="${esc(`{= Math.min(100, Math.max(0, %{${f.property}} * 100 / ${target})) }`)}" displayValue="${esc(`{= %{${f.property}} + ' / ${target}' }`)}"${state}/>`;
    } else if (f.kind === "amount" || f.kind === "decimal" || f.kind === "integer") {
      control = `<ObjectNumber number="{${f.property}}"${f.unit === undefined ? "" : ` unit="{${f.unit}}"`} emphasized="true" class="sapMObjectNumberLarge"${state}/>`;
    } else {
      control = `<ObjectStatus text="${valueText(f)}"${state} class="sapMObjectStatusLarge"/>`;
    }
    return `<VBox id="header_${idOf(facet.id)}" class="sapUiLargeMarginEnd sapUiSmallMarginBottom">${title}${control}</VBox>`;
  });
  return `<uxap:headerContent><FlexBox wrap="Wrap" alignItems="Start">${blocks.join("")}</FlexBox></uxap:headerContent>`;
}

function objectPage(page: UiPage, layout: UiLayout): string {
  const title = page.title === undefined ? `<Title text="${esc(page.typeName)}" wrapping="true"/>` : `<Title text="{${page.title}}" wrapping="true"/>`;
  const edit = page.updatable
    ? `<Button id="edit" text="Edit" type="Emphasized" press=".onEdit" visible="{= !\${ui>/editMode} }"${page.updatableDynamic ? ` enabled="${esc("{= %{__EntityControl/Updatable} !== false }")}"` : ""}/>`
    : "";
  const remove = page.deletable
    ? `<Button id="deleteObject" text="Delete" type="Transparent" press=".onDelete" visible="{= !\${ui>/editMode} }"${page.deletableDynamic ? ` enabled="${esc("{= %{__EntityControl/Deletable} !== false }")}"` : ""}/>`
    : "";
  return `<mvc:View controllerName="rapt.app.controller.Object" xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:uxap="sap.uxap" xmlns:form="sap.ui.layout.form" xmlns:core="sap.ui.core">
  <uxap:ObjectPageLayout id="page" showFooter="{ui>/editMode}" upperCaseAnchorBar="false" busy="{ui>/busy}" busyIndicatorDelay="0">
    <uxap:customData><core:CustomData key="set" value="${esc(page.set)}"/></uxap:customData>
    <uxap:headerTitle>
      <uxap:ObjectPageDynamicHeaderTitle id="headerTitle">
        ${breadcrumbs(page, layout)}
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
    ${headerContent(page)}
    <uxap:sections>
    ${page.sections.map(section).join("\n    ")}
    </uxap:sections>
    <uxap:footer>
      <OverflowToolbar>
        <Button id="messages" icon="sap-icon://message-popup" type="Negative" text="{= \${message>/}.length }" visible="{= \${message>/}.length > 0 }" press=".onMessages"/>
        <ToolbarSpacer/>
        <ObjectStatus id="draftStatus" text="Draft" state="Information" icon="sap-icon://edit" visible="{ui>/draft}" class="sapUiSmallMarginBegin"/>
        <Button id="save" text="{= \${ui>/createMode} ? 'Create' : 'Save' }" type="Emphasized" press=".onSave"/>
        <Button id="cancel" text="{= \${ui>/draft} ? 'Discard Draft' : 'Cancel' }" press=".onCancel"/>
      </OverflowToolbar>
    </uxap:footer>
  </uxap:ObjectPageLayout>
</mvc:View>
`;
}

export function views(layout: UiLayout): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  if (layout.overview !== undefined) {
    files.push({ path: "view/Overview.view.xml", content: overviewPage(layout) });
  }
  for (const page of layout.pages) {
    if (page.list !== undefined) {
      files.push({ path: `view/${page.set}List.view.xml`, content: listReport(page) });
    }
    files.push({ path: `view/${page.set}Object.view.xml`, content: objectPage(page, layout) });
  }
  return files;
}
