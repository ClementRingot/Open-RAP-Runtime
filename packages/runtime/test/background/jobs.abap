CLASS lcl_job_controlled DEFINITION.
  PUBLIC SECTION.
    INTERFACES if_bgmc_op_single.
    METHODS constructor IMPORTING travel TYPE sysuuid_x16 text TYPE string.
  PRIVATE SECTION.
    DATA travel TYPE sysuuid_x16.
    DATA text TYPE string.
ENDCLASS.

CLASS lcl_job_controlled IMPLEMENTATION.
  METHOD constructor.
    me->travel = travel.
    me->text = text.
  ENDMETHOD.

  METHOD if_bgmc_op_single~execute.
    " saved by the framework at the end of the operation
    MODIFY ENTITIES OF zrt_r_travel
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( ( TravelUUID = travel Description = text ) ).
  ENDMETHOD.
ENDCLASS.

CLASS lcl_job_uncontrolled DEFINITION.
  PUBLIC SECTION.
    INTERFACES if_bgmc_op_single_tx_uncontr.
    METHODS constructor IMPORTING travel TYPE sysuuid_x16 text TYPE string.
  PRIVATE SECTION.
    DATA travel TYPE sysuuid_x16.
    DATA text TYPE string.
ENDCLASS.

CLASS lcl_job_uncontrolled IMPLEMENTATION.
  METHOD constructor.
    me->travel = travel.
    me->text = text.
  ENDMETHOD.

  METHOD if_bgmc_op_single_tx_uncontr~execute.
    MODIFY ENTITIES OF zrt_r_travel
      ENTITY Travel
        UPDATE FIELDS ( BookingFee )
        WITH VALUE #( ( TravelUUID = travel BookingFee = '77.00' ) ).
    COMMIT ENTITIES RESPONSE OF zrt_r_travel FAILED DATA(failed) REPORTED DATA(reported).
  ENDMETHOD.
ENDCLASS.

CLASS lcl_job_failing DEFINITION.
  PUBLIC SECTION.
    INTERFACES if_bgmc_op_single_tx_uncontr.
ENDCLASS.

CLASS lcl_job_failing IMPLEMENTATION.
  METHOD if_bgmc_op_single_tx_uncontr~execute.
    RAISE EXCEPTION NEW cx_bgmc_operation( ).
  ENDMETHOD.
ENDCLASS.

