"! <p class="shorttext synchronized">Reviews of the catalog API (custom entity ZCE_Review)</p>
CLASS zcl_review_query DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_rap_query_provider.
ENDCLASS.



CLASS zcl_review_query IMPLEMENTATION.

  METHOD if_rap_query_provider~select.
    DATA products TYPE RANGE OF zce_review-productid.
    DATA reviews TYPE STANDARD TABLE OF zce_review WITH EMPTY KEY.

    DATA(filters) = io_request->get_filter( )->get_as_ranges( ).
    LOOP AT filters INTO DATA(filter) WHERE name = 'PRODUCTID'.
      products = CORRESPONDING #( filter-range ).
    ENDLOOP.

    reviews = VALUE #( ( productid = 'P1' reviewid = '0001' rating = 5 comment = 'Fast' )
                       ( productid = 'P1' reviewid = '0002' rating = 3 comment = 'Heavy' )
                       ( productid = 'P2' reviewid = '0001' rating = 4 comment = 'Good camera' ) ).
    DELETE reviews WHERE productid NOT IN products.

    IF io_request->is_total_numb_of_rec_requested( ).
      io_response->set_total_number_of_records( lines( reviews ) ).
    ENDIF.
    IF io_request->is_data_requested( ).
      io_response->set_data( reviews ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
