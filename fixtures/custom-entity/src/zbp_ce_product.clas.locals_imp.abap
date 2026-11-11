CLASS lhc_product DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Product RESULT result.

    METHODS validateprice FOR VALIDATE ON SAVE
      IMPORTING keys FOR Product~validatePrice.
ENDCLASS.

CLASS lhc_product IMPLEMENTATION.

  METHOD get_global_authorizations.
    result-%create = if_abap_behv=>auth-allowed.
    result-%update = if_abap_behv=>auth-allowed.
    result-%delete = if_abap_behv=>auth-allowed.
  ENDMETHOD.

  METHOD validateprice.
    READ ENTITIES OF zce_product IN LOCAL MODE
      ENTITY Product FIELDS ( Price ) WITH CORRESPONDING #( keys )
      RESULT DATA(products).
    LOOP AT products INTO DATA(product) WHERE Price < 0.
      APPEND VALUE #( %tky = product-%tky ) TO failed-product.
      APPEND VALUE #( %tky = product-%tky
                      %msg = new_message_with_text( text = 'The price cannot be negative' ) ) TO reported-product.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.

"! The changes are sent to the catalog API (here, written to the table zproduct_api).
CLASS lsc_product DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS save_modified REDEFINITION.
ENDCLASS.

CLASS lsc_product IMPLEMENTATION.

  METHOD save_modified.
    DATA row TYPE zproduct_api.
    LOOP AT create-product INTO DATA(created).
      row = VALUE #( product_id = created-ProductID name = created-Name price = created-Price currency = created-Currency ).
      INSERT zproduct_api FROM @row.
    ENDLOOP.
    LOOP AT update-product INTO DATA(updated).
      row = VALUE #( product_id = updated-ProductID name = updated-Name price = updated-Price currency = updated-Currency ).
      UPDATE zproduct_api FROM @row.
    ENDLOOP.
    LOOP AT delete-product INTO DATA(deleted).
      DELETE FROM zproduct_api WHERE product_id = @deleted-ProductID.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
