/**
 * Standard CDS views of SAP (released, content delivered by SAP) that RAP business objects use for
 * value helps and associations: I_Currency, I_UnitOfMeasure, I_Country, I_Language and their
 * text views. On SAP they exist in every system; here they are added to a project that names
 * them and does not define them, with their tables (`rapt_*`) and their reference data (decision
 * D44). The element names are those of SAP, the tables are Open RAP Runtime's own.
 */

import { COUNTRIES, CURRENCIES, LANGUAGES, REGIONS, rows, TIMEZONES, UNITS } from "./data.js";

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
  // ------------------------------------------------------------------------------------ regions
  table(
    "rapt_region",
    "Regions (I_Region)",
    `  key land1 : abap.char(3) not null;
  key bland : abap.char(3) not null;`,
  ),
  table(
    "rapt_regiont",
    "Region texts (I_RegionText)",
    `  key spras : abap.lang not null;
  key land1 : abap.char(3) not null;
  key bland : abap.char(3) not null;
  bezei : abap.char(20);`,
  ),
  view(
    "I_Region",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Region'
@ObjectModel.representativeKey: 'Region'
@ObjectModel.dataCategory: #VALUE_HELP
@Search.searchable: true
define view entity I_Region
  as select from rapt_region
  association [0..*] to I_RegionText as _RegionText on $projection.Country = _RegionText.Country
                                                      and $projection.Region = _RegionText.Region
  association [1..1] to I_Country as _Country on $projection.Country = _Country.Country
{
      @EndUserText.label: 'Country/Region'
  key land1 as Country,
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Region'
  key bland as Region,
      _RegionText,
      _Country
}
`,
    ["rapt_region", "I_RegionText", "I_Country"],
  ),
  view(
    "I_RegionText",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Region - Text'
@ObjectModel.dataCategory: #TEXT
@ObjectModel.representativeKey: 'Region'
@Search.searchable: true
define view entity I_RegionText
  as select from rapt_regiont
{
      @Semantics.language: true
      @EndUserText.label: 'Language'
  key spras as Language,
      @EndUserText.label: 'Country/Region'
  key land1 as Country,
      @EndUserText.label: 'Region'
  key bland as Region,
      @Semantics.text: true
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Region Name'
      bezei as RegionName
}
`,
    ["rapt_regiont"],
  ),
  // ---------------------------------------------------------------------------------- calendar
  table(
    "rapt_calendar",
    "Calendar dates (I_CalendarDate)",
    `  key calendardate : abap.dats not null;
  calendaryear : abap.numc(4);
  calendarquarter : abap.numc(1);
  calendarmonth : abap.numc(2);
  calendarweek : abap.numc(2);
  calendarday : abap.numc(2);
  yearmonth : abap.numc(6);
  yearquarter : abap.numc(5);
  yearweek : abap.numc(6);
  weekday : abap.numc(1);
  dayofyear : abap.numc(3);
  firstdayofweek : abap.dats;
  firstdayofmonth : abap.dats;`,
  ),
  view(
    "I_CalendarDate",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Calendar Date'
@ObjectModel.representativeKey: 'CalendarDate'
define view entity I_CalendarDate
  as select from rapt_calendar
{
      @EndUserText.label: 'Calendar Date'
  key calendardate    as CalendarDate,
      @EndUserText.label: 'Calendar Year'
      calendaryear    as CalendarYear,
      @EndUserText.label: 'Calendar Quarter'
      calendarquarter as CalendarQuarter,
      @EndUserText.label: 'Calendar Month'
      calendarmonth   as CalendarMonth,
      @EndUserText.label: 'Calendar Week'
      calendarweek    as CalendarWeek,
      @EndUserText.label: 'Calendar Day'
      calendarday     as CalendarDay,
      @EndUserText.label: 'Year Month'
      yearmonth       as YearMonth,
      @EndUserText.label: 'Year Quarter'
      yearquarter     as YearQuarter,
      @EndUserText.label: 'Year Week'
      yearweek        as YearWeek,
      @EndUserText.label: 'Weekday'
      weekday         as WeekDay,
      @EndUserText.label: 'Day of Year'
      dayofyear       as CalendarDayOfYear,
      @EndUserText.label: 'First Day of Week'
      firstdayofweek  as FirstDayOfWeekDate,
      @EndUserText.label: 'First Day of Month'
      firstdayofmonth as FirstDayOfMonthDate
}
`,
    ["rapt_calendar"],
  ),
  // -------------------------------------------------------------------------------- time zones
  table(
    "rapt_timezone",
    "Time zones (I_TimeZone)",
    `  key tzone : abap.char(6) not null;
  utcdiff : abap.char(5);
  iana : abap.char(40);`,
  ),
  table(
    "rapt_timezonet",
    "Time zone texts (I_TimeZoneText)",
    `  key spras : abap.lang not null;
  key tzone : abap.char(6) not null;
  descript : abap.char(40);`,
  ),
  view(
    "I_TimeZone",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Time Zone'
@ObjectModel.representativeKey: 'TimeZoneID'
@ObjectModel.dataCategory: #VALUE_HELP
@Search.searchable: true
define view entity I_TimeZone
  as select from rapt_timezone
  association [0..*] to I_TimeZoneText as _Text on $projection.TimeZoneID = _Text.TimeZoneID
{
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Time Zone'
  key tzone   as TimeZoneID,
      @EndUserText.label: 'UTC Difference'
      utcdiff as TimeZoneUTCDifference,
      @EndUserText.label: 'IANA Time Zone'
      iana    as TimeZoneIANACode,
      _Text
}
`,
    ["rapt_timezone", "I_TimeZoneText"],
  ),
  view(
    "I_TimeZoneText",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Time Zone - Text'
@ObjectModel.dataCategory: #TEXT
@ObjectModel.representativeKey: 'TimeZoneID'
@Search.searchable: true
define view entity I_TimeZoneText
  as select from rapt_timezonet
{
      @Semantics.language: true
      @EndUserText.label: 'Language'
  key spras    as Language,
      @EndUserText.label: 'Time Zone'
  key tzone    as TimeZoneID,
      @Semantics.text: true
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Description'
      descript as TimeZoneText
}
`,
    ["rapt_timezonet"],
  ),
  // ----------------------------------------------------------------------------- business users
  table(
    "rapt_bususer",
    "Business users (I_BusinessUserBasic)",
    `  key userid : abap.char(12) not null;
  partner : abap.char(10);
  fullname : abap.char(80);
  firstname : abap.char(40);
  lastname : abap.char(40);
  email : abap.char(241);`,
  ),
  view(
    "I_BusinessUserBasic",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Business User'
@ObjectModel.representativeKey: 'UserID'
@ObjectModel.dataCategory: #VALUE_HELP
@Search.searchable: true
define view entity I_BusinessUserBasic
  as select from rapt_bususer
{
      @Search.defaultSearchElement: true
      @EndUserText.label: 'User'
  key userid    as UserID,
      @EndUserText.label: 'Business Partner'
      partner   as BusinessPartner,
      @Semantics.text: true
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Full Name'
      fullname  as PersonFullName,
      @EndUserText.label: 'First Name'
      firstname as FirstName,
      @EndUserText.label: 'Last Name'
      lastname  as LastName,
      @EndUserText.label: 'E-Mail Address'
      email     as DefaultEmailAddress
}
`,
    ["rapt_bususer"],
  ),
  // ----------------------------------------------------------------------------- exchange rates
  table(
    "rapt_exchrate",
    "Exchange rates (I_ExchangeRate)",
    `  key kurst : abap.char(4) not null;
  key fcurr : abap.cuky not null;
  key tcurr : abap.cuky not null;
  key gdatu : abap.dats not null;
  ukurs : abap.dec(9,5);
  ffact : abap.dec(9,0);
  tfact : abap.dec(9,0);`,
  ),
  view(
    "I_ExchangeRate",
    `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Exchange Rate'
define view entity I_ExchangeRate
  as select from rapt_exchrate
{
      @EndUserText.label: 'Exchange Rate Type'
  key kurst as ExchangeRateType,
      @EndUserText.label: 'Source Currency'
  key fcurr as SourceCurrency,
      @EndUserText.label: 'Target Currency'
  key tcurr as TargetCurrency,
      @EndUserText.label: 'Valid From'
  key gdatu as ValidityStartDate,
      @EndUserText.label: 'Exchange Rate'
      ukurs as ExchangeRate,
      @EndUserText.label: 'Source Currency Units'
      ffact as NumberOfSourceCurrencyUnits,
      @EndUserText.label: 'Target Currency Units'
      tfact as NumberOfTargetCurrencyUnits
}
`,
    ["rapt_exchrate"],
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
    if (!["DDLS", "DDLX", "BDEF", "CLAS", "INTF", "DCLS", "SRVD"].includes(source.type)) {
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
    case "rapt_region":
      return rows(REGIONS).map(([country = "", region = ""]) => ({ land1: country, bland: region }));
    case "rapt_regiont":
      return rows(REGIONS).map(([country = "", region = "", name = ""]) => ({ spras: "E", land1: country, bland: region, bezei: short(name, 20) }));
    case "rapt_timezone":
      return rows(TIMEZONES).map(([zone = "", diff = "", iana = ""]) => ({ tzone: zone, utcdiff: diff, iana }));
    case "rapt_timezonet":
      return rows(TIMEZONES).map(([zone = "", , , name = ""]) => ({ spras: "E", tzone: zone, descript: short(name, 40) }));
    case "rapt_languaget":
      return rows(LANGUAGES).map(([language = "", , name = ""]) => ({ spras: "E", sprsl: language, sptxt: short(name, 16) }));
    default:
      return [];
  }
}

/**
 * Reference data written as SQL (too many rows to list): the calendar of I_CalendarDate, 1990 to
 * 2060, computed by PostgreSQL once (ISO weeks; weekday 1 = Monday, as SAP).
 */
export function standardSql(tableName: string): string | undefined {
  if (tableName.toLowerCase() !== "rapt_calendar") {
    return undefined;
  }
  return `INSERT INTO "rapt_calendar" ("calendardate", "calendaryear", "calendarquarter", "calendarmonth", "calendarweek", "calendarday", "yearmonth", "yearquarter", "yearweek", "weekday", "dayofyear", "firstdayofweek", "firstdayofmonth")
SELECT d::date, to_char(d, 'YYYY'), to_char(d, 'Q'), to_char(d, 'MM'), to_char(d, 'IW'), to_char(d, 'DD'), to_char(d, 'YYYYMM'),
  to_char(d, 'YYYY') || to_char(d, 'Q'), to_char(d, 'IYYY') || to_char(d, 'IW'), to_char(d, 'ID'), to_char(d, 'DDD'),
  (d - ((extract(isodow from d)::int - 1) * interval '1 day'))::date, date_trunc('month', d)::date
FROM generate_series(date '1990-01-01', date '2060-12-31', interval '1 day') AS g(d)
WHERE NOT EXISTS (SELECT 1 FROM "rapt_calendar" LIMIT 1);`;
}
