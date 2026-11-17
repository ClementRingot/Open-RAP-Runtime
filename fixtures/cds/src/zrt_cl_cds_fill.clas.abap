"! <p class="shorttext synchronized">Fills the nodes of the tree (round 2)</p>
CLASS zrt_cl_cds_fill DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.



CLASS zrt_cl_cds_fill IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    " the tree of fixtures/cds (round 2, D111): A (A2 (A21), A1), B; X is an orphan
    DELETE FROM zrt_cdsnode.
    INSERT zrt_cdsnode FROM TABLE @( VALUE #(
      ( nodeid = 'A'   parentid = ''   name = 'Alpha'         seq = 1 )
      ( nodeid = 'A1'  parentid = 'A'  name = 'Alpha one'     seq = 2 )
      ( nodeid = 'A2'  parentid = 'A'  name = 'Alpha two'     seq = 1 )
      ( nodeid = 'A21' parentid = 'A2' name = 'Alpha two one' seq = 1 )
      ( nodeid = 'B'   parentid = ''   name = 'Beta'          seq = 2 )
      ( nodeid = 'X'   parentid = 'Z'  name = 'Orphan'        seq = 1 ) ) ).
    out->write( |{ sy-dbcnt } nodes| ).
  ENDMETHOD.
ENDCLASS.
