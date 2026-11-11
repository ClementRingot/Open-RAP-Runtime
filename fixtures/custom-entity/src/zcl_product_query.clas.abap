"! <p class="shorttext synchronized">Products of the catalog API (custom entity ZCE_Product)</p>
CLASS zcl_product_query DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_rap_query_provider.
    TYPES tt_products TYPE STANDARD TABLE OF zce_product WITH EMPTY KEY.
    "! The products of the API (here, the table zproduct_api).
    CLASS-METHODS catalog RETURNING VALUE(result) TYPE tt_products.
ENDCLASS.



CLASS zcl_product_query IMPLEMENTATION.

  METHOD catalog.
    SELECT product_id AS productid, name, price, currency
      FROM zproduct_api
      ORDER BY product_id
      INTO CORRESPONDING FIELDS OF TABLE @result.
  ENDMETHOD.

  METHOD if_rap_query_provider~select.
    DATA ids TYPE RANGE OF zce_product-productid.
    DATA currencies TYPE RANGE OF zce_product-currency.
    DATA page TYPE tt_products.

    TRY.
        DATA(filters) = io_request->get_filter( )->get_as_ranges( ).
      CATCH cx_rap_query_filter_no_range INTO DATA(no_range).
        RAISE EXCEPTION TYPE cx_rap_query_provider EXPORTING previous = no_range.
    ENDTRY.
    LOOP AT filters INTO DATA(filter).
      CASE filter-name.
        WHEN 'PRODUCTID'.
          ids = CORRESPONDING #( filter-range ).
        WHEN 'CURRENCY'.
          currencies = CORRESPONDING #( filter-range ).
      ENDCASE.
    ENDLOOP.

    DATA(products) = catalog( ).
    DELETE products WHERE productid NOT IN ids OR currency NOT IN currencies.

    LOOP AT io_request->get_sort_elements( ) INTO DATA(sort).
      IF sort-element_name = 'NAME' AND sort-descending = abap_true.
        SORT products BY name DESCENDING.
      ELSEIF sort-element_name = 'NAME'.
        SORT products BY name.
      ELSEIF sort-element_name = 'PRICE'.
        SORT products BY price.
      ENDIF.
    ENDLOOP.

    IF io_request->is_total_numb_of_rec_requested( ).
      io_response->set_total_number_of_records( lines( products ) ).
    ENDIF.
    IF io_request->is_data_requested( ).
      DATA(offset) = CONV i( io_request->get_paging( )->get_offset( ) ).
      DATA(size) = io_request->get_paging( )->get_page_size( ).
      LOOP AT products INTO DATA(product) FROM offset + 1.
        IF size <> if_rap_query_paging=>page_size_unlimited AND lines( page ) >= size.
          EXIT.
        ENDIF.
        APPEND product TO page.
      ENDLOOP.
      io_response->set_data( page ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
