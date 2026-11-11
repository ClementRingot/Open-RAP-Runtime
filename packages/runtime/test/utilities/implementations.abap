  METHOD selfTest.
    DATA(text) = lcl_selftest=>run( ).
    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( FOR key IN keys ( %tky = key-%tky Description = text ) ).
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).
    result = VALUE #( FOR travel IN travels ( %tky = travel-%tky %param = travel ) ).
  ENDMETHOD.

  METHOD drawNumber.
    DATA number TYPE cl_numberrange_runtime=>nr_number.
    DATA text TYPE string.
    TRY.
        cl_numberrange_runtime=>number_get( EXPORTING nr_range_nr = '01'
                                                      object      = 'ZRT_TRAVEL'
                                            IMPORTING number      = number
                                                      returncode  = DATA(returncode) ).
        text = |{ number } { returncode }|.
      CATCH cx_number_ranges INTO DATA(error).
        text = error->get_text( ).
    ENDTRY.
    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( FOR key IN keys ( %tky = key-%tky Description = text ) ).
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).
    result = VALUE #( FOR travel IN travels ( %tky = travel-%tky %param = travel ) ).
  ENDMETHOD.

  METHOD writeLog.
    DATA text TYPE string.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).
    TRY.
        DATA(log) = cl_bali_log=>create( ).
        log->set_header( cl_bali_header_setter=>create( object      = 'ZRT_LOG'
                                                        subobject   = 'ACTIONS'
                                                        external_id = CONV #( travels[ 1 ]-TravelID ) ) ).
        log->add_item( cl_bali_free_text_setter=>create( severity = if_bali_constants=>c_severity_information
                                                         text     = |Log of travel { travels[ 1 ]-TravelID }| ) ).
        log->add_item( cl_bali_message_setter=>create( severity   = if_bali_constants=>c_severity_warning
                                                       id         = 'ZRT_TRAVEL'
                                                       number     = '002'
                                                       variable_1 = travels[ 1 ]-TravelID ) ).
        TRY.
            DATA(missing) = travels[ 99 ]-TravelID.
          CATCH cx_sy_itab_line_not_found INTO DATA(not_found).
            log->add_item( cl_bali_exception_setter=>create( severity = if_bali_constants=>c_severity_error exception = not_found ) ).
        ENDTRY.
        cl_bali_log_db=>get_instance( )->save_log( log ).

        DATA(filter) = cl_bali_log_filter=>create( )->set_descriptor( object = 'ZRT_LOG' external_id = CONV #( travels[ 1 ]-TravelID ) ).
        DATA(logs) = cl_bali_log_db=>get_instance( )->load_logs_w_items_via_filter( filter ).
        DATA(items) = logs[ 1 ]->get_all_items( ).
        text = |{ lines( logs ) } { lines( items ) } { items[ 1 ]-item->get_message_text( ) } / { items[ 2 ]-item->severity } { items[ 2 ]-item->get_message_text( ) }|.
      CATCH cx_bali_runtime INTO DATA(error).
        text = error->get_text( ).
    ENDTRY.
    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( FOR key IN keys ( %tky = key-%tky Description = text ) ).
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT travels.
    result = VALUE #( FOR travel IN travels ( %tky = travel-%tky %param = travel ) ).
  ENDMETHOD.
