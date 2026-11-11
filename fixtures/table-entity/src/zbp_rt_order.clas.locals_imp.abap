CLASS lhc_order DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Order RESULT result.

    METHODS setopen FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Order~setOpen.

    METHODS complete FOR MODIFY
      IMPORTING keys FOR ACTION Order~complete RESULT result.
ENDCLASS.

CLASS lhc_order IMPLEMENTATION.

  METHOD get_global_authorizations.
    result-%create = if_abap_behv=>auth-allowed.
    result-%update = if_abap_behv=>auth-allowed.
    result-%delete = if_abap_behv=>auth-allowed.
    result-%action-complete = if_abap_behv=>auth-allowed.
  ENDMETHOD.

  METHOD setopen.
    " a new order is open (the status is an enumerated type)
    READ ENTITIES OF zrt_order IN LOCAL MODE
      ENTITY Order FIELDS ( Status ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).
    MODIFY ENTITIES OF zrt_order IN LOCAL MODE
      ENTITY Order UPDATE FIELDS ( Status )
      WITH VALUE #( FOR order IN orders WHERE ( Status = zrt_order_status-new )
                    ( %tky = order-%tky Status = zrt_order_status-open ) ).
  ENDMETHOD.

  METHOD complete.
    MODIFY ENTITIES OF zrt_order IN LOCAL MODE
      ENTITY Order UPDATE FIELDS ( Status )
      WITH VALUE #( FOR key IN keys ( %tky = key-%tky Status = zrt_order_status-done ) ).
    READ ENTITIES OF zrt_order IN LOCAL MODE
      ENTITY Order ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(orders).
    result = VALUE #( FOR order IN orders ( %tky = order-%tky %param = order ) ).
  ENDMETHOD.

ENDCLASS.
