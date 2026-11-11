/**
 * Standard CDS views of SAP (released, content delivered by SAP) that RAP business objects use for
 * value helps and associations: I_Currency, I_UnitOfMeasure, I_Country, I_Language and their
 * text views. On SAP they exist in every system; here they are added to a project that names
 * them and does not define them, with their tables (`rapt_*`) and their reference data (decision
 * D44). The element names are those of SAP, the tables are rap-transpiler's own.
 */

import { COUNTRIES, CURRENCIES, LANGUAGES, rows, UNITS } from "./data.js";

export interface StandardObject {
  /** Object name, upper case. */
  name: string;
  type: "TABL" | "DDLS";
  /** File name in abapGit form (`i_currency.ddls.asddls`). */
  fileName: string;
  content: string;
  /** Other standard objects it needs. */
  uses: string[];
}

const TABLE_HEADER = (label: string): string => `@EndUserText.label : '${label}'
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #S
@AbapCatalog.dataMaintenance : #RESTRICTED`;

const table = (name: string, label: string, fields: string): StandardObject => ({
  name: name.toUpperCase(),
  type: "TABL",
  fileName: `${name}.tabl.astabl`,
  content: `${TABLE_HEADER(label)}
define table ${name} {
  key client : abap.clnt not null;
${fields}
}
`,
  uses: [],
});

const view = (name: string, content: string, uses: string[]): StandardObject => ({
  name: name.toUpperCase(),
  type: "DDLS",
  fileName: `${name.toLowerCase()}.ddls.asddls`,
  content,
  uses: uses.map((u) => u.toUpperCase()),
});

export const STANDARD_OBJECTS: StandardObject[] = [
  // ------------------------------------------------------------------------------- currencies
  table(
    "rapt_currency",
    "Currency codes (I_Currency)",
    `  key waers : abap.cuky not null;
  isocd : abap.char(3);
  altwr : abap.numc(3);
  currdec : abap.int1;`,
  ),
  table(
    "rapt_currencyt",
    "Currency texts (I_CurrencyText)",
    `  key spras : abap.lang not null;
  key waers : abap.cuky not null;
  ktext : abap.char(15);
  ltext : abap.char(40);`,
  ),
  view(
    "I_Currency",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Currency'
@ObjectModel.representativeKey: 'Currency'
@ObjectModel.dataCategory: #VALUE_HELP
@Search.searchable: true
define view entity I_Currency
  as select from rapt_currency
  association [0..*] to I_CurrencyText as _Text on $projection.Currency = _Text.Currency
{
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Currency'
  key waers   as Currency,
      @EndUserText.label: 'Decimals'
      currdec as Decimals,
      @EndUserText.label: 'ISO Code'
      isocd   as CurrencyISOCode,
      @EndUserText.label: 'Alternative Key'
      altwr   as AlternativeCurrencyKey,
      _Text
}
`,
    ["rapt_currency", "I_CurrencyText"],
  ),
  view(
    "I_CurrencyText",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Currency - Text'
@ObjectModel.dataCategory: #TEXT
@ObjectModel.representativeKey: 'Currency'
@Search.searchable: true
define view entity I_CurrencyText
  as select from rapt_currencyt
{
      @Semantics.language: true
      @EndUserText.label: 'Language'
  key spras as Language,
      @EndUserText.label: 'Currency'
  key waers as Currency,
      @Semantics.text: true
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Description'
      ltext as CurrencyName,
      @EndUserText.label: 'Short Text'
      ktext as CurrencyShortName
}
`,
    ["rapt_currencyt"],
  ),
  // ------------------------------------------------------------------------- units of measure
  table(
    "rapt_uom",
    "Units of measure (I_UnitOfMeasure)",
    `  key msehi : abap.unit(3) not null;
  isocode : abap.char(3);
  dimid : abap.char(6);
  andec : abap.int2;`,
  ),
  table(
    "rapt_uomt",
    "Unit of measure texts (I_UnitOfMeasureText)",
    `  key spras : abap.lang not null;
  key msehi : abap.unit(3) not null;
  mseht : abap.char(10);
  msehl : abap.char(30);`,
  ),
  view(
    "I_UnitOfMeasure",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Unit of Measure'
@ObjectModel.representativeKey: 'UnitOfMeasure'
@ObjectModel.dataCategory: #VALUE_HELP
@Search.searchable: true
define view entity I_UnitOfMeasure
  as select from rapt_uom
  association [0..*] to I_UnitOfMeasureText as _Text on $projection.UnitOfMeasure = _Text.UnitOfMeasure
{
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Unit of Measure'
  key msehi    as UnitOfMeasure,
      @EndUserText.label: 'ISO Code'
      isocode  as UnitOfMeasureISOCode,
      @EndUserText.label: 'Dimension'
      dimid    as UnitOfMeasureDimension,
      @EndUserText.label: 'Decimals'
      andec    as UnitOfMeasureNumberOfDecimals,
      _Text
}
`,
    ["rapt_uom", "I_UnitOfMeasureText"],
  ),
  view(
    "I_UnitOfMeasureText",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Unit of Measure - Text'
@ObjectModel.dataCategory: #TEXT
@ObjectModel.representativeKey: 'UnitOfMeasure'
@Search.searchable: true
define view entity I_UnitOfMeasureText
  as select from rapt_uomt
{
      @Semantics.language: true
      @EndUserText.label: 'Language'
  key spras as Language,
      @EndUserText.label: 'Unit of Measure'
  key msehi as UnitOfMeasure,
      @Semantics.text: true
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Unit of Measure Name'
      msehl as UnitOfMeasureLongName,
      @EndUserText.label: 'Unit of Measure Text'
      mseht as UnitOfMeasureName
}
`,
    ["rapt_uomt"],
  ),
  // ---------------------------------------------------------------------------------- countries
  table(
    "rapt_country",
    "Countries (I_Country)",
    `  key land1 : abap.char(3) not null;
  intca3 : abap.char(3);
  waers : abap.cuky;
  xegld : abap.char(1);`,
  ),
  table(
    "rapt_countryt",
    "Country texts (I_CountryText)",
    `  key spras : abap.lang not null;
  key land1 : abap.char(3) not null;
  landx50 : abap.char(50);
  landx : abap.char(15);`,
  ),
  view(
    "I_Country",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Country/Region'
@ObjectModel.representativeKey: 'Country'
@ObjectModel.dataCategory: #VALUE_HELP
@Search.searchable: true
define view entity I_Country
  as select from rapt_country
  association [0..*] to I_CountryText as _Text on $projection.Country = _Text.Country
{
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Country/Region'
  key land1  as Country,
      @EndUserText.label: 'ISO Code (3 letters)'
      intca3 as CountryThreeLetterISOCode,
      @EndUserText.label: 'Currency'
      waers  as CountryCurrency,
      @EndUserText.label: 'EU Member'
      xegld  as IsEuropeanUnionMember,
      _Text
}
`,
    ["rapt_country", "I_CountryText"],
  ),
  view(
    "I_CountryText",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Country/Region - Text'
@ObjectModel.dataCategory: #TEXT
@ObjectModel.representativeKey: 'Country'
@Search.searchable: true
define view entity I_CountryText
  as select from rapt_countryt
{
      @Semantics.language: true
      @EndUserText.label: 'Language'
  key spras   as Language,
      @EndUserText.label: 'Country/Region'
  key land1   as Country,
      @Semantics.text: true
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Country/Region Name'
      landx50 as CountryName,
      @EndUserText.label: 'Short Name'
      landx   as CountryShortName
}
`,
    ["rapt_countryt"],
  ),
  // ---------------------------------------------------------------------------------- languages
  table(
    "rapt_language",
    "Languages (I_Language)",
    `  key spras : abap.lang not null;
  laiso : abap.char(2);`,
  ),
  table(
    "rapt_languaget",
    "Language texts (I_LanguageText)",
    `  key spras : abap.lang not null;
  key sprsl : abap.lang not null;
  sptxt : abap.char(16);`,
  ),
  view(
    "I_Language",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Language'
@ObjectModel.representativeKey: 'Language'
@ObjectModel.dataCategory: #VALUE_HELP
@Search.searchable: true
define view entity I_Language
  as select from rapt_language
  association [0..*] to I_LanguageText as _Text on $projection.Language = _Text.LanguageCode
{
      @EndUserText.label: 'Language Key'
  key spras as Language,
      @Search.defaultSearchElement: true
      @EndUserText.label: 'ISO Code'
      laiso as LanguageISOCode,
      _Text
}
`,
    ["rapt_language", "I_LanguageText"],
  ),
  view(
    "I_LanguageText",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Language - Text'
@ObjectModel.dataCategory: #TEXT
@ObjectModel.representativeKey: 'LanguageCode'
@Search.searchable: true
define view entity I_LanguageText
  as select from rapt_languaget
{
      @Semantics.language: true
      @EndUserText.label: 'Language of the Text'
  key spras as Language,
      @EndUserText.label: 'Language Key'
  key sprsl as LanguageCode,
      @Semantics.text: true
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Language Name'
      sptxt as LanguageName
}
`,
    ["rapt_languaget"],
  ),
];

const BY_NAME = new Map(STANDARD_OBJECTS.map((o) => [o.name, o]));

/** The standard views a project may name. */
export const STANDARD_VIEW_NAMES = STANDARD_OBJECTS.filter((o) => o.type === "DDLS").map((o) => o.name);

const REFERENCE = new RegExp(`\\b(${STANDARD_VIEW_NAMES.join("|")})\\b`, "gi");

/**
 * The standard objects named by sources (CDS, metadata extensions, BDEF, ABAP) and not defined by
 * the project, with the objects they need.
 */
export function standardObjectsFor(sources: Array<{ type: string; name: string; content: string }>): StandardObject[] {
  const defined = new Set(sources.map((s) => `${s.type}:${s.name.toUpperCase()}`));
  const needed = new Set<string>();
  const add = (name: string): void => {
    const object = BY_NAME.get(name.toUpperCase());
    if (object === undefined || needed.has(object.name) || defined.has(`${object.type}:${object.name}`)) {
      return;
    }
    needed.add(object.name);
    object.uses.forEach(add);
  };
  for (const source of sources) {
    if (!["DDLS", "DDLX", "BDEF", "CLAS", "INTF", "DCLS"].includes(source.type)) {
      continue;
    }
    for (const match of source.content.matchAll(REFERENCE)) {
      add(match[1] ?? "");
    }
  }
  return STANDARD_OBJECTS.filter((o) => needed.has(o.name));
}

/** The reference data of a standard table: column → value, in the order of the table. */
export function standardRows(tableName: string): Array<Record<string, string | number>> {
  const short = (text: string, length: number): string => text.slice(0, length);
  switch (tableName.toLowerCase()) {
    case "rapt_currency":
      return rows(CURRENCIES).map(([code = "", decimals = "2"]) => ({ waers: code, isocd: code, altwr: "000", currdec: Number(decimals) }));
    case "rapt_currencyt":
      return rows(CURRENCIES).map(([code = "", , name = ""]) => ({ spras: "E", waers: code, ktext: short(name, 15), ltext: short(name, 40) }));
    case "rapt_uom":
      return rows(UNITS).map(([unit = "", iso = "", dimension = "", decimals = "0"]) => ({ msehi: unit, isocode: iso, dimid: dimension, andec: Number(decimals) }));
    case "rapt_uomt":
      return rows(UNITS).map(([unit = "", , , , name = ""]) => ({ spras: "E", msehi: unit, mseht: short(name, 10), msehl: short(name, 30) }));
    case "rapt_country":
      return rows(COUNTRIES).map(([country = "", iso3 = "", currency = "", eu = ""]) => ({ land1: country, intca3: iso3, waers: currency, xegld: eu }));
    case "rapt_countryt":
      return rows(COUNTRIES).map(([country = "", , , , name = ""]) => ({ spras: "E", land1: country, landx50: short(name, 50), landx: short(name, 15) }));
    case "rapt_language":
      return rows(LANGUAGES).map(([language = "", iso = ""]) => ({ spras: language, laiso: iso }));
    case "rapt_languaget":
      return rows(LANGUAGES).map(([language = "", , name = ""]) => ({ spras: "E", sprsl: language, sptxt: short(name, 16) }));
    default:
      return [];
  }
}
