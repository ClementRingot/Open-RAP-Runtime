/**
 * Reference data of the standard CDS views (I_Currency, I_UnitOfMeasure, I_Country, I_Language):
 * on SAP, the content of these tables is delivered and maintained by SAP. English texts.
 * Compact form: one entry per line, fields separated by `|`.
 */

/** Currency | decimals | name (ISO 4217). */
export const CURRENCIES = `AED|2|UAE Dirham
AFN|2|Afghani
ALL|2|Lek
AMD|2|Armenian Dram
ANG|2|Netherlands Antillean Guilder
AOA|2|Kwanza
ARS|2|Argentine Peso
AUD|2|Australian Dollar
AWG|2|Aruban Florin
AZN|2|Azerbaijan Manat
BAM|2|Convertible Mark
BBD|2|Barbados Dollar
BDT|2|Taka
BGN|2|Bulgarian Lev
BHD|3|Bahraini Dinar
BIF|0|Burundi Franc
BMD|2|Bermudian Dollar
BND|2|Brunei Dollar
BOB|2|Boliviano
BRL|2|Brazilian Real
BSD|2|Bahamian Dollar
BTN|2|Ngultrum
BWP|2|Pula
BYN|2|Belarusian Ruble
BZD|2|Belize Dollar
CAD|2|Canadian Dollar
CDF|2|Congolese Franc
CHF|2|Swiss Franc
CLP|0|Chilean Peso
CNY|2|Yuan Renminbi
COP|2|Colombian Peso
CRC|2|Costa Rican Colon
CUP|2|Cuban Peso
CVE|2|Cabo Verde Escudo
CZK|2|Czech Koruna
DJF|0|Djibouti Franc
DKK|2|Danish Krone
DOP|2|Dominican Peso
DZD|2|Algerian Dinar
EGP|2|Egyptian Pound
ERN|2|Nakfa
ETB|2|Ethiopian Birr
EUR|2|Euro
FJD|2|Fiji Dollar
FKP|2|Falkland Islands Pound
GBP|2|Pound Sterling
GEL|2|Lari
GHS|2|Ghana Cedi
GIP|2|Gibraltar Pound
GMD|2|Dalasi
GNF|0|Guinean Franc
GTQ|2|Quetzal
GYD|2|Guyana Dollar
HKD|2|Hong Kong Dollar
HNL|2|Lempira
HTG|2|Gourde
HUF|2|Forint
IDR|2|Rupiah
ILS|2|New Israeli Sheqel
INR|2|Indian Rupee
IQD|3|Iraqi Dinar
IRR|2|Iranian Rial
ISK|0|Iceland Krona
JMD|2|Jamaican Dollar
JOD|3|Jordanian Dinar
JPY|0|Yen
KES|2|Kenyan Shilling
KGS|2|Som
KHR|2|Riel
KMF|0|Comorian Franc
KPW|2|North Korean Won
KRW|0|Won
KWD|3|Kuwaiti Dinar
KYD|2|Cayman Islands Dollar
KZT|2|Tenge
LAK|2|Lao Kip
LBP|2|Lebanese Pound
LKR|2|Sri Lanka Rupee
LRD|2|Liberian Dollar
LSL|2|Loti
LYD|3|Libyan Dinar
MAD|2|Moroccan Dirham
MDL|2|Moldovan Leu
MGA|2|Malagasy Ariary
MKD|2|Denar
MMK|2|Kyat
MNT|2|Tugrik
MOP|2|Pataca
MRU|2|Ouguiya
MUR|2|Mauritius Rupee
MVR|2|Rufiyaa
MWK|2|Malawi Kwacha
MXN|2|Mexican Peso
MYR|2|Malaysian Ringgit
MZN|2|Mozambique Metical
NAD|2|Namibia Dollar
NGN|2|Naira
NIO|2|Cordoba Oro
NOK|2|Norwegian Krone
NPR|2|Nepalese Rupee
NZD|2|New Zealand Dollar
OMR|3|Rial Omani
PAB|2|Balboa
PEN|2|Sol
PGK|2|Kina
PHP|2|Philippine Peso
PKR|2|Pakistan Rupee
PLN|2|Zloty
PYG|0|Guarani
QAR|2|Qatari Rial
RON|2|Romanian Leu
RSD|2|Serbian Dinar
RUB|2|Russian Ruble
RWF|0|Rwanda Franc
SAR|2|Saudi Riyal
SBD|2|Solomon Islands Dollar
SCR|2|Seychelles Rupee
SDG|2|Sudanese Pound
SEK|2|Swedish Krona
SGD|2|Singapore Dollar
SHP|2|Saint Helena Pound
SLE|2|Leone
SOS|2|Somali Shilling
SRD|2|Surinam Dollar
SSP|2|South Sudanese Pound
STN|2|Dobra
SVC|2|El Salvador Colon
SYP|2|Syrian Pound
SZL|2|Lilangeni
THB|2|Baht
TJS|2|Somoni
TMT|2|Turkmenistan New Manat
TND|3|Tunisian Dinar
TOP|2|Pa'anga
TRY|2|Turkish Lira
TTD|2|Trinidad and Tobago Dollar
TWD|2|New Taiwan Dollar
TZS|2|Tanzanian Shilling
UAH|2|Hryvnia
UGX|0|Uganda Shilling
USD|2|US Dollar
UYU|2|Peso Uruguayo
UZS|2|Uzbekistan Sum
VES|2|Bolivar Soberano
VND|0|Dong
VUV|0|Vatu
WST|2|Tala
XAF|0|CFA Franc BEAC
XCD|2|East Caribbean Dollar
XOF|0|CFA Franc BCEAO
XPF|0|CFP Franc
YER|2|Yemeni Rial
ZAR|2|Rand
ZMW|2|Zambian Kwacha
ZWG|2|Zimbabwe Gold`;

/** Unit (internal SAP code) | ISO code | dimension | decimals | name. */
export const UNITS = `ST|PCE|AAAADL|0|Piece
EA|EA|AAAADL|0|Each
PAK|PK|AAAADL|0|Pack
KAR|CT|AAAADL|0|Carton
PAL|PF|AAAADL|0|Pallet
%|P1|PROPOR|2|Percent
KG|KGM|MASS|3|Kilogram
G|GRM|MASS|3|Gram
MG|MGM|MASS|3|Milligram
TO|TNE|MASS|3|Ton
LB|LBR|MASS|3|Pound
M|MTR|LENGTH|3|Meter
CM|CMT|LENGTH|2|Centimeter
MM|MMT|LENGTH|0|Millimeter
KM|KMT|LENGTH|3|Kilometer
IN|INH|LENGTH|2|Inch
FT|FOT|LENGTH|2|Foot
M2|MTK|SURFAC|3|Square meter
M3|MTQ|VOLUME|3|Cubic meter
L|LTR|VOLUME|3|Liter
ML|MLT|VOLUME|0|Milliliter
S|SEC|TIME|0|Second
MIN|MIN|TIME|0|Minute
H|HUR|TIME|2|Hour
TAG|DAY|TIME|0|Day
WCH|WEE|TIME|0|Week
MON|MON|TIME|0|Month
JHR|ANN|TIME|0|Year
KWH|KWH|ENERGY|3|Kilowatt hour`;

/** Language (SAP key) | ISO code | name. */
export const LANGUAGES = `E|EN|English
D|DE|German
F|FR|French
S|ES|Spanish
I|IT|Italian
P|PT|Portuguese
N|NL|Dutch
K|DA|Danish
V|SV|Swedish
O|NO|Norwegian
U|FI|Finnish
L|PL|Polish
C|CS|Czech
Q|SK|Slovak
H|HU|Hungarian
R|RU|Russian
T|TR|Turkish
G|EL|Greek
J|JA|Japanese
3|KO|Korean
1|ZH|Chinese
A|AR|Arabic
B|HE|Hebrew
2|TH|Thai
4|RO|Romanian
5|SL|Slovenian
6|HR|Croatian
0|SR|Serbian
8|UK|Ukrainian
9|ET|Estonian
W|BG|Bulgarian`;

/** Country (ISO 3166 alpha-2) | alpha-3 | currency | EU member (X) | name. */
export const COUNTRIES = `AD|AND|EUR||Andorra
AE|ARE|AED||United Arab Emirates
AF|AFG|AFN||Afghanistan
AG|ATG|XCD||Antigua and Barbuda
AL|ALB|ALL||Albania
AM|ARM|AMD||Armenia
AO|AGO|AOA||Angola
AR|ARG|ARS||Argentina
AT|AUT|EUR|X|Austria
AU|AUS|AUD||Australia
AZ|AZE|AZN||Azerbaijan
BA|BIH|BAM||Bosnia and Herzegovina
BB|BRB|BBD||Barbados
BD|BGD|BDT||Bangladesh
BE|BEL|EUR|X|Belgium
BF|BFA|XOF||Burkina Faso
BG|BGR|BGN|X|Bulgaria
BH|BHR|BHD||Bahrain
BI|BDI|BIF||Burundi
BJ|BEN|XOF||Benin
BN|BRN|BND||Brunei Darussalam
BO|BOL|BOB||Bolivia
BR|BRA|BRL||Brazil
BS|BHS|BSD||Bahamas
BT|BTN|BTN||Bhutan
BW|BWA|BWP||Botswana
BY|BLR|BYN||Belarus
BZ|BLZ|BZD||Belize
CA|CAN|CAD||Canada
CD|COD|CDF||Congo, Democratic Republic
CF|CAF|XAF||Central African Republic
CG|COG|XAF||Congo
CH|CHE|CHF||Switzerland
CI|CIV|XOF||Cote d'Ivoire
CL|CHL|CLP||Chile
CM|CMR|XAF||Cameroon
CN|CHN|CNY||China
CO|COL|COP||Colombia
CR|CRI|CRC||Costa Rica
CU|CUB|CUP||Cuba
CV|CPV|CVE||Cabo Verde
CY|CYP|EUR|X|Cyprus
CZ|CZE|CZK|X|Czechia
DE|DEU|EUR|X|Germany
DJ|DJI|DJF||Djibouti
DK|DNK|DKK|X|Denmark
DM|DMA|XCD||Dominica
DO|DOM|DOP||Dominican Republic
DZ|DZA|DZD||Algeria
EC|ECU|USD||Ecuador
EE|EST|EUR|X|Estonia
EG|EGY|EGP||Egypt
ER|ERI|ERN||Eritrea
ES|ESP|EUR|X|Spain
ET|ETH|ETB||Ethiopia
FI|FIN|EUR|X|Finland
FJ|FJI|FJD||Fiji
FM|FSM|USD||Micronesia
FR|FRA|EUR|X|France
GA|GAB|XAF||Gabon
GB|GBR|GBP||United Kingdom
GD|GRD|XCD||Grenada
GE|GEO|GEL||Georgia
GH|GHA|GHS||Ghana
GM|GMB|GMD||Gambia
GN|GIN|GNF||Guinea
GQ|GNQ|XAF||Equatorial Guinea
GR|GRC|EUR|X|Greece
GT|GTM|GTQ||Guatemala
GW|GNB|XOF||Guinea-Bissau
GY|GUY|GYD||Guyana
HK|HKG|HKD||Hong Kong
HN|HND|HNL||Honduras
HR|HRV|EUR|X|Croatia
HT|HTI|HTG||Haiti
HU|HUN|HUF|X|Hungary
ID|IDN|IDR||Indonesia
IE|IRL|EUR|X|Ireland
IL|ISR|ILS||Israel
IN|IND|INR||India
IQ|IRQ|IQD||Iraq
IR|IRN|IRR||Iran
IS|ISL|ISK||Iceland
IT|ITA|EUR|X|Italy
JM|JAM|JMD||Jamaica
JO|JOR|JOD||Jordan
JP|JPN|JPY||Japan
KE|KEN|KES||Kenya
KG|KGZ|KGS||Kyrgyzstan
KH|KHM|KHR||Cambodia
KI|KIR|AUD||Kiribati
KM|COM|KMF||Comoros
KN|KNA|XCD||Saint Kitts and Nevis
KP|PRK|KPW||Korea, Democratic People's Republic
KR|KOR|KRW||Korea, Republic
KW|KWT|KWD||Kuwait
KZ|KAZ|KZT||Kazakhstan
LA|LAO|LAK||Laos
LB|LBN|LBP||Lebanon
LC|LCA|XCD||Saint Lucia
LI|LIE|CHF||Liechtenstein
LK|LKA|LKR||Sri Lanka
LR|LBR|LRD||Liberia
LS|LSO|LSL||Lesotho
LT|LTU|EUR|X|Lithuania
LU|LUX|EUR|X|Luxembourg
LV|LVA|EUR|X|Latvia
LY|LBY|LYD||Libya
MA|MAR|MAD||Morocco
MC|MCO|EUR||Monaco
MD|MDA|MDL||Moldova
ME|MNE|EUR||Montenegro
MG|MDG|MGA||Madagascar
MH|MHL|USD||Marshall Islands
MK|MKD|MKD||North Macedonia
ML|MLI|XOF||Mali
MM|MMR|MMK||Myanmar
MN|MNG|MNT||Mongolia
MO|MAC|MOP||Macao
MR|MRT|MRU||Mauritania
MT|MLT|EUR|X|Malta
MU|MUS|MUR||Mauritius
MV|MDV|MVR||Maldives
MW|MWI|MWK||Malawi
MX|MEX|MXN||Mexico
MY|MYS|MYR||Malaysia
MZ|MOZ|MZN||Mozambique
NA|NAM|NAD||Namibia
NE|NER|XOF||Niger
NG|NGA|NGN||Nigeria
NI|NIC|NIO||Nicaragua
NL|NLD|EUR|X|Netherlands
NO|NOR|NOK||Norway
NP|NPL|NPR||Nepal
NR|NRU|AUD||Nauru
NZ|NZL|NZD||New Zealand
OM|OMN|OMR||Oman
PA|PAN|PAB||Panama
PE|PER|PEN||Peru
PG|PNG|PGK||Papua New Guinea
PH|PHL|PHP||Philippines
PK|PAK|PKR||Pakistan
PL|POL|PLN|X|Poland
PT|PRT|EUR|X|Portugal
PW|PLW|USD||Palau
PY|PRY|PYG||Paraguay
QA|QAT|QAR||Qatar
RO|ROU|RON|X|Romania
RS|SRB|RSD||Serbia
RU|RUS|RUB||Russian Federation
RW|RWA|RWF||Rwanda
SA|SAU|SAR||Saudi Arabia
SB|SLB|SBD||Solomon Islands
SC|SYC|SCR||Seychelles
SD|SDN|SDG||Sudan
SE|SWE|SEK|X|Sweden
SG|SGP|SGD||Singapore
SI|SVN|EUR|X|Slovenia
SK|SVK|EUR|X|Slovakia
SL|SLE|SLE||Sierra Leone
SM|SMR|EUR||San Marino
SN|SEN|XOF||Senegal
SO|SOM|SOS||Somalia
SR|SUR|SRD||Suriname
SS|SSD|SSP||South Sudan
ST|STP|STN||Sao Tome and Principe
SV|SLV|USD||El Salvador
SY|SYR|SYP||Syria
SZ|SWZ|SZL||Eswatini
TD|TCD|XAF||Chad
TG|TGO|XOF||Togo
TH|THA|THB||Thailand
TJ|TJK|TJS||Tajikistan
TL|TLS|USD||Timor-Leste
TM|TKM|TMT||Turkmenistan
TN|TUN|TND||Tunisia
TO|TON|TOP||Tonga
TR|TUR|TRY||Turkey
TT|TTO|TTD||Trinidad and Tobago
TV|TUV|AUD||Tuvalu
TW|TWN|TWD||Taiwan
TZ|TZA|TZS||Tanzania
UA|UKR|UAH||Ukraine
UG|UGA|UGX||Uganda
US|USA|USD||United States
UY|URY|UYU||Uruguay
UZ|UZB|UZS||Uzbekistan
VA|VAT|EUR||Holy See
VC|VCT|XCD||Saint Vincent and the Grenadines
VE|VEN|VES||Venezuela
VN|VNM|VND||Viet Nam
VU|VUT|VUV||Vanuatu
WS|WSM|WST||Samoa
YE|YEM|YER||Yemen
ZA|ZAF|ZAR||South Africa
ZM|ZMB|ZMW||Zambia
ZW|ZWE|ZWG||Zimbabwe`;

export function rows(text: string): string[][] {
  return text.split("\n").map((line) => line.split("|"));
}
