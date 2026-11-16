# `$metadata` of the Travel fixture (draft, trial) and SAP BTP 2611

Written by `rapt conformance compare` (D90): the facts of the `$metadata` of SAP BTP and of Open RAP
Runtime on normalized names (aliases of the vocabularies, namespace of the service, suffix).

| | Structure | Annotations |
|---|---|---|
| Same | 298 | |
| Only on SAP BTP | 1 | 86 |
| Only in Open RAP Runtime | 16 | 30 |
| Different | 4 | 7 |

## Structure

### `self.BookingType/_Travel`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| ReferentialConstraint | `TravelUUID=TravelUUID` | `IsActiveEntity=IsActiveEntity,TravelUUID=TravelUUID` |

### `self.BookingType/DraftUUID`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.Guid` |

### `self.BookingType/FlightPrice`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | `Type=Edm.Decimal Nullable=false Precision=16 Scale=variable` | `Type=Edm.Decimal Nullable=false Precision=16 Scale=2` |

### `self.Container/I_Currency`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| EntitySet | — | `self.I_CurrencyType` |
| NavigationPropertyBinding _Text | — | `I_CurrencyText` |

### `self.Container/I_CurrencyText`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| EntitySet | — | `self.I_CurrencyTextType` |

### `self.copyTravel(self.TravelType)/ResultIsActiveEntity`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Parameter | `Type=Edm.Boolean Nullable=false` | — |

### `self.I_CurrencyTextType`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Key | — | `Language,Currency` |

### `self.I_CurrencyTextType/Currency`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.String Nullable=false MaxLength=5` |

### `self.I_CurrencyTextType/CurrencyName`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.String Nullable=false MaxLength=40` |

### `self.I_CurrencyTextType/CurrencyShortName`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.String Nullable=false MaxLength=15` |

### `self.I_CurrencyTextType/Language`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.String Nullable=false MaxLength=1` |

### `self.I_CurrencyType`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Key | — | `Currency` |

### `self.I_CurrencyType/_Text`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| NavigationProperty | — | `Type=Collection(self.I_CurrencyTextType)` |

### `self.I_CurrencyType/AlternativeCurrencyKey`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.String Nullable=false MaxLength=3` |

### `self.I_CurrencyType/Currency`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.String Nullable=false MaxLength=5` |

### `self.I_CurrencyType/CurrencyISOCode`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.String Nullable=false MaxLength=3` |

### `self.I_CurrencyType/Decimals`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.Byte Nullable=false` |

### `self.TravelType/BookingFee`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | `Type=Edm.Decimal Nullable=false Precision=16 Scale=variable` | `Type=Edm.Decimal Nullable=false Precision=16 Scale=2` |

### `self.TravelType/DraftUUID`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | — | `Type=Edm.Guid` |

### `self.TravelType/TotalPrice`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| Property | `Type=Edm.Decimal Nullable=false Precision=16 Scale=variable` | `Type=Edm.Decimal Nullable=false Precision=16 Scale=2` |

## Annotations

### `self.BookingType/BookingUUID`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=UUID` | — |
| @Common.QuickInfo | `String=16 Byte UUID in 16 Bytes (Raw Format)` | — |

### `self.BookingType/DraftUUID`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | — | `String=Draft` |
| @Core.Computed | — | `` |
| @UI.Hidden | — | `` |

### `self.BookingType/HasActiveEntity`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.QuickInfo | `String=Draft - Indicator - Has active document` | — |

### `self.BookingType/HasDraftEntity`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.QuickInfo | `String=Draft - Indicator - Has draft document` | — |

### `self.BookingType/IsActiveEntity`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.QuickInfo | `String=Draft - Indicator - Is active document` | — |

### `self.BookingType/LocalLastChangedAt`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.DocumentationRef | `String=urn:sap-com:documentation:key?=type=DE&id=ABP_LOCINST_LASTCHANGE_TSTMPL` | — |
| @Common.Heading | `String=L Chngd On` | — |
| @Common.Label | `String=Changed On (Local)` | — |
| @Common.QuickInfo | `String=Local Instance Last Change Date Time` | — |

### `self.BookingType/TravelUUID`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=UUID` | — |
| @Common.QuickInfo | `String=16 Byte UUID in 16 Bytes (Raw Format)` | — |

### `self.Container`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Capabilities.AsynchronousRequestsSupported | `` | — |
| @Capabilities.BatchSupport | `Record(SupportedFormats: Collection(String("application/json"), String("multipart/mixed")))` | — |
| @Capabilities.FilterFunctions | `Collection(String("eq"), String("ne"), String("gt"), String("ge"), String("lt"), String("le"), String("and"), String("or"), String("contains"), String("startswith"), String("endswith"), String("any"), String("all"))` | — |
| @Capabilities.KeyAsSegmentSupported | `` | — |
| @Capabilities.SupportedFormats | `Collection(String("application/json"), String("application/pdf"))` | — |
| @CodeList.CurrencyCodes | `Record(CollectionPath: String=Currencies, Url: String=../../../../default/iwbep/common/0001/$metadata)` | — |
| @Common.ApplyMultiUnitBehaviorForSortingAndFiltering | `Bool=true` | — |
| @PDF.Features | `Record(ArchiveFormat: Bool=true, Border: Bool=true, CoverPage: Bool=true, DocumentDescriptionCollection: String=MyDocumentDescriptions, DocumentDescriptionReference: String=../../../../default/iwbep/common/0001/$metadata, FitToPage: Bool=true, FontName: Bool=true, FontSize: Bool=true, HeaderFooter: Bool=true, IANATimezoneFormat: Bool=true, Margin: Bool=true, Padding: Bool=true, ResultSizeDefault: Int=20000, ResultSizeMaximum: Int=20000, Signature: Bool=true, TextDirectionLayout: Bool=true, Treeview: Bool=true, UploadToFileShare: Bool=true)` | — |
| @Support.TechnicalInfoLinks | `Record(FunctionImport: String=GetTechnicalInfoLinks, Url: String=../../../../default/iwbep/common/0001/$metadata)` | — |

### `self.Container/Booking`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Capabilities.DeepUpdateSupport | `Record(ContentIDSupported: Bool=true)` | — |
| @Capabilities.FilterRestrictions | `Record(FilterExpressionRestrictions: Collection(Record(AllowedExpressions: String=SingleRange, Property: PropertyPath=DraftEntityCreationDateTime), Record(AllowedExpressions: String=SingleRange, Property: PropertyPath=DraftEntityLastChangeDateTime)), Filterable: Bool=true, NonFilterableProperties: Collection(PropertyPath("__EntityControl")))` | — |
| @Capabilities.NavigationRestrictions | `Record(RestrictedProperties: Collection(Record(DeepUpdateSupport: Record(Supported: Bool=false), NavigationProperty: NavigationPropertyPath=SiblingEntity), Record(DeepUpdateSupport: Record(Supported: Bool=false), InsertRestrictions: Record(Insertable: Bool=false), NavigationProperty: NavigationPropertyPath=_Travel)))` | — |
| @Capabilities.SortRestrictions | `Record(NonSortableProperties: Collection(PropertyPath("__EntityControl")))` | — |
| @Capabilities.UpdateRestrictions | `Record(DeltaUpdateSupported: Bool=true, NonUpdatableNavigationProperties: Collection(PropertyPath("DraftAdministrativeData"), PropertyPath("SiblingEntity"), PropertyPath("_Travel")), QueryOptions: Record(SelectSupported: Bool=true), Updatable: Path=__EntityControl/Updatable)` | `Record(Updatable: Path=__EntityControl/Updatable)` |

### `self.Container/I_Currency`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Capabilities.DeleteRestrictions | — | `Record(Deletable: Bool=false)` |
| @Capabilities.InsertRestrictions | — | `Record(Insertable: Bool=false)` |
| @Capabilities.NavigationRestrictions | — | `Record(RestrictedProperties: Collection(Record(InsertRestrictions: Record(Insertable: Bool=false), NavigationProperty: NavigationPropertyPath=_Text, Type=Capabilities.NavigationPropertyRestriction)))` |
| @Capabilities.SearchRestrictions | — | `Record(Searchable: Bool=true)` |
| @Capabilities.UpdateRestrictions | — | `Record(Updatable: Bool=false)` |

### `self.Container/I_CurrencyText`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Capabilities.DeleteRestrictions | — | `Record(Deletable: Bool=false)` |
| @Capabilities.InsertRestrictions | — | `Record(Insertable: Bool=false)` |
| @Capabilities.SearchRestrictions | — | `Record(Searchable: Bool=true)` |
| @Capabilities.UpdateRestrictions | — | `Record(Updatable: Bool=false)` |

### `self.Container/I_DraftAdministrativeData`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Capabilities.FilterRestrictions | `Record(FilterExpressionRestrictions: Collection(Record(AllowedExpressions: String=SingleRange, Property: PropertyPath=CreationDateTime), Record(AllowedExpressions: String=SingleRange, Property: PropertyPath=LastChangeDateTime)), Filterable: Bool=true)` | — |
| @Capabilities.ReadRestrictions | `Record(Readable: Bool=false)` | — |
| @Capabilities.SearchRestrictions | `Record(SearchSyntax: String=https://url.sap/odata-search, Searchable: Bool=true, UnsupportedExpressions: EnumMember=Capabilities.SearchExpressions/AND Capabilities.SearchExpressions/NOT Capabilities.SearchExpressions/group)` | `Record(Searchable: Bool=false)` |
| @Capabilities.UpdateRestrictions | `Record(QueryOptions: Record(SelectSupported: Bool=true), Updatable: Bool=false)` | `Record(Updatable: Bool=false)` |

### `self.Container/Travel`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Capabilities.DeepUpdateSupport | `Record(ContentIDSupported: Bool=true)` | — |
| @Capabilities.FilterRestrictions | `Record(FilterExpressionRestrictions: Collection(Record(AllowedExpressions: String=SingleRange, Property: PropertyPath=DraftEntityCreationDateTime), Record(AllowedExpressions: String=SingleRange, Property: PropertyPath=DraftEntityLastChangeDateTime)), Filterable: Bool=true, NonFilterableProperties: Collection(PropertyPath("__CreateByAssociationControl"), PropertyPath("__EntityControl"), PropertyPath("__OperationControl")))` | — |
| @Capabilities.InsertRestrictions | — | `Record(Insertable: Bool=true)` |
| @Capabilities.NavigationRestrictions | `Record(RestrictedProperties: Collection(Record(DeepUpdateSupport: Record(Supported: Bool=false), InsertRestrictions: Record(Insertable: Bool=false), NavigationProperty: NavigationPropertyPath=SiblingEntity), Record(InsertRestrictions: Record(Insertable: Path=__CreateByAssociationControl/_Booking), NavigationProperty: NavigationPropertyPath=_Booking)))` | `Record(RestrictedProperties: Collection(Record(InsertRestrictions: Record(Insertable: Path=__CreateByAssociationControl/_Booking), NavigationProperty: NavigationPropertyPath=_Booking, Type=Capabilities.NavigationPropertyRestriction)))` |
| @Capabilities.SearchRestrictions | `Record(SearchSyntax: String=https://url.sap/odata-search, Searchable: Bool=true, UnsupportedExpressions: EnumMember=Capabilities.SearchExpressions/AND Capabilities.SearchExpressions/NOT Capabilities.SearchExpressions/group)` | `Record(Searchable: Bool=true)` |
| @Capabilities.SortRestrictions | `Record(NonSortableProperties: Collection(PropertyPath("__CreateByAssociationControl"), PropertyPath("__EntityControl"), PropertyPath("__OperationControl")))` | — |
| @Capabilities.UpdateRestrictions | `Record(DeltaUpdateSupported: Bool=true, NonUpdatableNavigationProperties: Collection(PropertyPath("DraftAdministrativeData"), PropertyPath("SiblingEntity"), PropertyPath("_Booking")), QueryOptions: Record(SelectSupported: Bool=true), Updatable: Path=__EntityControl/Updatable)` | `Record(Updatable: Path=__EntityControl/Updatable)` |

### `self.copyTravel(self.TravelType)/ResultIsActiveEntity`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | `String=Result is active` | — |
| @Common.QuickInfo | `String=Draft - Indicator - Is active document` | — |

### `self.Edit(self.TravelType)/PreserveChanges`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.IsUpperCase | `` | — |
| @Common.Label | `String=TRUE` | — |
| @Common.QuickInfo | `String=Data element for domain BOOLE: TRUE (='X') and FALSE (=' ')` | — |

### `self.EntityControl/Deletable`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=Dynamic Method Control` | — |
| @Common.Label | `String=Dyn. Method Control` | — |
| @Common.QuickInfo | `String=Dynamic Method Property` | — |

### `self.EntityControl/Updatable`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=Dynamic Method Control` | — |
| @Common.Label | `String=Dyn. Method Control` | — |
| @Common.QuickInfo | `String=Dynamic Method Property` | — |

### `self.I_CurrencyTextType`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | — | `String=Currency - Text` |

### `self.I_CurrencyTextType/Currency`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.IsCurrency | — | `` |
| @Common.Label | — | `String=Currency` |

### `self.I_CurrencyTextType/CurrencyName`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | — | `String=Description` |

### `self.I_CurrencyTextType/CurrencyShortName`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | — | `String=Short Text` |

### `self.I_CurrencyTextType/Language`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | — | `String=Language` |

### `self.I_CurrencyType`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | — | `String=Currency` |

### `self.I_CurrencyType/AlternativeCurrencyKey`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.IsDigitSequence | — | `` |
| @Common.Label | — | `String=Alternative Key` |

### `self.I_CurrencyType/Currency`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.IsCurrency | — | `` |
| @Common.Label | — | `String=Currency` |

### `self.I_CurrencyType/CurrencyISOCode`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | — | `String=ISO Code` |

### `self.I_CurrencyType/Decimals`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | — | `String=Decimals` |

### `self.I_DraftAdministrativeDataType/CreatedByUser`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.IsUpperCase | `` | — |
| @Common.ValueListReferences | `Collection(String("../../../../srvd_f4/sap/i_draftadministrativeuservh/0001;ps='srvd-zrt_ui_travel-0001';va='self.et-i_draftadministrativedata.createdbyuser'/$metadata"))` | — |

### `self.I_DraftAdministrativeDataType/DraftAccessType`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.IsUpperCase | `` | — |

### `self.I_DraftAdministrativeDataType/DraftEntityType`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.IsUpperCase | `` | — |

### `self.I_DraftAdministrativeDataType/InProcessByUser`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.IsUpperCase | `` | — |

### `self.I_DraftAdministrativeDataType/LastChangedByUser`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.IsUpperCase | `` | — |
| @Common.ValueListReferences | `Collection(String("../../../../srvd_f4/sap/i_draftadministrativeuservh/0001;ps='srvd-zrt_ui_travel-0001';va='self.et-i_draftadministrativedata.lastchangedbyuser'/$metadata"))` | — |

### `self.TravelCbAControl/_Booking`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=Dynamic Create by Association Control` | — |
| @Common.Label | `String=Dynamic CbA-Control` | — |
| @Common.QuickInfo | `String=Dynamic Create via Association Control Property` | — |

### `self.TravelOperationControl/acceptTravel`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=Dynamic Action Control` | — |
| @Common.Label | `String=Dyn. Action Control` | — |
| @Common.QuickInfo | `String=Dynamic Action Property` | — |

### `self.TravelOperationControl/copyTravel`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=Dynamic Action Control` | — |
| @Common.Label | `String=Dyn. Action Control` | — |
| @Common.QuickInfo | `String=Dynamic Action Property` | — |

### `self.TravelOperationControl/deductDiscount`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=Dynamic Action Control` | — |
| @Common.Label | `String=Dyn. Action Control` | — |
| @Common.QuickInfo | `String=Dynamic Action Property` | — |

### `self.TravelOperationControl/Edit`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=Dynamic Action Control` | — |
| @Common.Label | `String=Dyn. Action Control` | — |
| @Common.QuickInfo | `String=Dynamic Action Property` | — |

### `self.TravelType`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @UI.Identification | `Collection(Record(Type=UI.DataField, Value: Path=TravelID), Record(Type=UI.DataField, Value: Path=AgencyID), Record(Type=UI.DataField, Value: Path=CustomerID), Record(Type=UI.DataField, Value: Path=Description), Record(Type=UI.DataField, Value: Path=OverallStatus), Record(Action: String=self.copyTravel(self.TravelType), InvocationGrouping: EnumMember=UI.OperationGroupingType/Isolated, Label: String=Copy Travel, Type=UI.DataFieldForAction), Record(Action: String=self.deductDiscount(self.TravelType), InvocationGrouping: EnumMember=UI.OperationGroupingType/Isolated, Label: String=Deduct Discount, Type=UI.DataFieldForAction), Record(Action: String=self.acceptTravel(self.TravelType), InvocationGrouping: EnumMember=UI.OperationGroupingType/Isolated, Label: String=Accept Travel, Type=UI.DataFieldForAction))` | `Collection(Record(Type=UI.DataField, Value: Path=TravelID), Record(Type=UI.DataField, Value: Path=AgencyID), Record(Type=UI.DataField, Value: Path=CustomerID), Record(Type=UI.DataField, Value: Path=Description), Record(Type=UI.DataField, Value: Path=OverallStatus), Record(Action: String=self.acceptTravel(self.TravelType), InvocationGrouping: EnumMember=UI.OperationGroupingType/Isolated, Label: String=Accept Travel, Type=UI.DataFieldForAction), Record(Action: String=self.deductDiscount(self.TravelType), InvocationGrouping: EnumMember=UI.OperationGroupingType/Isolated, Label: String=Deduct Discount, Type=UI.DataFieldForAction), Record(Action: String=self.copyTravel(self.TravelType), InvocationGrouping: EnumMember=UI.OperationGroupingType/Isolated, Label: String=Copy Travel, Type=UI.DataFieldForAction))` |

### `self.TravelType/CreatedAt`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.DocumentationRef | `String=urn:sap-com:documentation:key?=type=DE&id=ABP_CREATION_TSTMPL` | — |
| @Common.Heading | `String=Created On` | — |
| @Common.QuickInfo | `String=Creation Date Time` | — |

### `self.TravelType/CreatedBy`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.DocumentationRef | `String=urn:sap-com:documentation:key?=type=DE&id=ABP_CREATION_USER` | — |
| @Common.Heading | `String=Created By` | — |
| @Common.IsUpperCase | `` | — |
| @Common.QuickInfo | `String=Created By User` | — |

### `self.TravelType/CurrencyCode`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.ValueList | — | `Record(CollectionPath: String=I_Currency, Label: String=Currency, Parameters: Collection(Record(LocalDataProperty: PropertyPath=CurrencyCode, Type=Common.ValueListParameterInOut, ValueListProperty: String=Currency), Record(Type=Common.ValueListParameterDisplayOnly, ValueListProperty: String=Decimals), Record(Type=Common.ValueListParameterDisplayOnly, ValueListProperty: String=CurrencyISOCode), Record(Type=Common.ValueListParameterDisplayOnly, ValueListProperty: String=AlternativeCurrencyKey)), SearchSupported: Bool=true)` |
| @Common.ValueListReferences | `Collection(String("../../../../srvd_f4/sap/i_currency/0001;ps='srvd-zrt_ui_travel-0001';va='self.et-zrt_c_travel.currencycode'/$metadata"))` | — |

### `self.TravelType/DraftUUID`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Label | — | `String=Draft` |
| @Core.Computed | — | `` |
| @UI.Hidden | — | `` |

### `self.TravelType/HasActiveEntity`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.QuickInfo | `String=Draft - Indicator - Has active document` | — |

### `self.TravelType/HasDraftEntity`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.QuickInfo | `String=Draft - Indicator - Has draft document` | — |

### `self.TravelType/IsActiveEntity`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.QuickInfo | `String=Draft - Indicator - Is active document` | — |

### `self.TravelType/LastChangedAt`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.DocumentationRef | `String=urn:sap-com:documentation:key?=type=DE&id=ABP_LASTCHANGE_TSTMPL` | — |
| @Common.Heading | `String=Changed On` | — |
| @Common.QuickInfo | `String=Last Change Date Time` | — |

### `self.TravelType/LastChangedBy`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.DocumentationRef | `String=urn:sap-com:documentation:key?=type=DE&id=ABP_LASTCHANGE_USER` | — |
| @Common.Heading | `String=Changed By` | — |
| @Common.IsUpperCase | `` | — |
| @Common.QuickInfo | `String=Last Changed By User` | — |

### `self.TravelType/LocalLastChangedAt`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.DocumentationRef | `String=urn:sap-com:documentation:key?=type=DE&id=ABP_LOCINST_LASTCHANGE_TSTMPL` | — |
| @Common.Heading | `String=L Chngd On` | — |
| @Common.Label | `String=Changed On (Local)` | — |
| @Common.QuickInfo | `String=Local Instance Last Change Date Time` | — |

### `self.TravelType/TravelUUID`

| | SAP BTP | Open RAP Runtime |
|---|---|---|
| @Common.Heading | `String=UUID` | — |
| @Common.QuickInfo | `String=16 Byte UUID in 16 Bytes (Raw Format)` | — |
