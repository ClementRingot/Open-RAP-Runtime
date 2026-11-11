  METHOD startJobs.
    DATA text TYPE string.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).
    DATA(travel) = travels[ 1 ].
    TRY.
        DATA(controlled) = cl_bgmc_process_factory=>get_default( )->create(
          )->set_name( `controlled` )->set_operation( NEW lcl_job_controlled( travel = travel-TravelUUID text = `set in the background (controlled)` )
          )->save_for_execution( ).
        DATA(uncontrolled) = cl_bgmc_process_factory=>get_default( )->create( ).
        uncontrolled->set_name( `uncontrolled` ).
        uncontrolled->set_operation_tx_uncontrolled( NEW lcl_job_uncontrolled( travel = travels[ lines( travels ) ]-TravelUUID text = `set in the background (uncontrolled)` ) ).
        uncontrolled->save_for_execution( ).
        cl_bgmc_process_factory=>get_default( )->create( )->set_name( `failing` )->set_operation_tx_uncontrolled( NEW lcl_job_failing( ) )->save_for_execution( ).
        text = controlled->get_state( ).
      CATCH cx_bgmc INTO DATA(error).
        text = error->get_text( ).
    ENDTRY.
    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( FOR key IN keys ( %tky = key-%tky Description = text ) ).
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT travels.
    result = VALUE #( FOR t IN travels ( %tky = t-%tky %param = t ) ).
  ENDMETHOD.

  METHOD sendMail.
    DATA text TYPE string.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).
    TRY.
        DATA(mail) = cl_bcs_mail_message=>create_instance( ).
        mail->set_sender( 'travel@example.com' ).
        mail->add_recipient( 'alice@example.com' ).
        mail->add_recipient( iv_address = 'bob@example.com' iv_copy = cl_bcs_mail_message=>cc ).
        mail->set_subject( |Travel { travels[ 1 ]-TravelID }| ).
        mail->set_main( cl_bcs_mail_textpart=>create_instance(
          iv_content      = |<h1>Travel { travels[ 1 ]-TravelID }</h1><p>{ travels[ 1 ]-Description }</p>|
          iv_content_type = 'text/html' ) ).
        mail->add_attachment( cl_bcs_mail_textpart=>create_text_plain( iv_content = `some text` iv_filename = `notes.txt` ) ).
        mail->add_attachment( cl_bcs_mail_binarypart=>create_instance( iv_content = 'CAFEBABE' iv_content_type = 'application/octet-stream' iv_filename = 'data.bin' ) ).
        mail->send( IMPORTING et_status = DATA(status) ev_mail_status = DATA(mail_status) ).
        text = |{ mail_status } { lines( status ) } { status[ 2 ]-recipient }|.
      CATCH cx_bcs_mail INTO DATA(error).
        text = error->get_text( ).
    ENDTRY.
    IF travels[ 1 ]-Description = `ROLLBACK`.
      " dates the validation refuses: the save fails, the LUW is rolled back, the mail is not sent
      MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
        ENTITY Travel
          UPDATE FIELDS ( EndDate )
          WITH VALUE #( ( %tky = travels[ 1 ]-%tky EndDate = travels[ 1 ]-BeginDate - 1 ) ).
    ENDIF.
    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( FOR key IN keys ( %tky = key-%tky Description = text ) ).
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT travels.
    result = VALUE #( FOR t IN travels ( %tky = t-%tky %param = t ) ).
  ENDMETHOD.
