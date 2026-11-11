@EndUserText.label: 'Product (read from an API)'
@ObjectModel.query.implementedBy: 'ABAP:ZCL_PRODUCT_QUERY'
@UI.headerInfo: { typeName: 'Product', typeNamePlural: 'Products', title: { type: #STANDARD, value: 'Name' } }
define root custom entity ZCE_Product
{
      @UI.facet: [ { id: 'Product', purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: 'Product', position: 10 },
                   { id: 'Reviews', purpose: #STANDARD, type: #LINEITEM_REFERENCE, label: 'Reviews', position: 20, targetElement: '_Reviews' } ]
      @UI: { lineItem: [ { position: 10 } ], identification: [ { position: 10 } ], selectionField: [ { position: 10 } ] }
      @EndUserText.label: 'Product'
  key ProductID : abap.char(10);
      @UI: { lineItem: [ { position: 20 } ], identification: [ { position: 20 } ] }
      @EndUserText.label: 'Name'
      Name      : abap.char(40);
      @UI: { lineItem: [ { position: 30 } ], identification: [ { position: 30 } ] }
      @Semantics.amount.currencyCode: 'Currency'
      @EndUserText.label: 'Price'
      Price     : abap.curr(15,2);
      @UI: { selectionField: [ { position: 20 } ] }
      @EndUserText.label: 'Currency'
      Currency  : abap.cuky;
      _Reviews  : association [0..*] to ZCE_Review on _Reviews.ProductID = $projection.ProductID;
}
