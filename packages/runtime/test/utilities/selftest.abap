CLASS lcl_selftest DEFINITION.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_item,
             item_id TYPE i,
             label   TYPE string,
             active  TYPE abap_bool,
           END OF ty_item.
    TYPES ty_items TYPE STANDARD TABLE OF ty_item WITH EMPTY KEY.
    TYPES: BEGIN OF ty_order,
             order_id TYPE n LENGTH 4,
             total    TYPE p LENGTH 8 DECIMALS 2,
             created  TYPE d,
             items    TYPE ty_items,
           END OF ty_order.
    "! Runs every check; returns OK, or the failed checks.
    CLASS-METHODS run RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    CLASS-DATA failures TYPE string.
    CLASS-METHODS check
      IMPORTING name     TYPE string
                actual   TYPE simple
                expected TYPE simple.
    CLASS-METHODS json.
    CLASS-METHODS encodings.
    CLASS-METHODS text.
    CLASS-METHODS time.
    CLASS-METHODS hashes.
    CLASS-METHODS random.
    CLASS-METHODS regex.
    CLASS-METHODS rtts.
ENDCLASS.

CLASS lcl_selftest IMPLEMENTATION.
  METHOD run.
    CLEAR failures.
    TRY.
        json( ).
        encodings( ).
        text( ).
        time( ).
        hashes( ).
        random( ).
        regex( ).
        rtts( ).
      CATCH cx_root INTO DATA(error).
        failures = failures && |exception { error->get_text( ) }; |.
    ENDTRY.
    IF failures IS INITIAL.
      result = `OK`.
    ELSE.
      result = failures.
    ENDIF.
  ENDMETHOD.

  METHOD check.
    IF |{ actual }| <> |{ expected }|.
      failures = failures && |{ name }: { actual } <> { expected }; |.
    ENDIF.
  ENDMETHOD.

  METHOD json.
    DATA order TYPE ty_order.
    DATA back TYPE ty_order.
    DATA item TYPE ty_item.
    DATA strings TYPE string_table.
    order = VALUE #( order_id = '0042' total = '12.50' created = '20261111'
                     items = VALUE #( ( item_id = 1 label = `Pen "blue"` active = abap_true )
                                      ( item_id = 2 label = `Ink` ) ) ).

    DATA(camel) = /ui2/cl_json=>serialize( data = order pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
    check( name     = `json camel`
           actual   = camel
           expected = `{"orderId":42,"total":12.50,"created":"2026-11-11","items":[{"itemId":1,"label":"Pen \"blue\"","active":true},{"itemId":2,"label":"Ink","active":false}]}` ).
    check( name     = `json compress`
           actual   = /ui2/cl_json=>serialize( data = order compress = abap_true pretty_name = /ui2/cl_json=>pretty_mode-low_case )
           expected = `{"order_id":42,"total":12.50,"created":"2026-11-11","items":[{"item_id":1,"label":"Pen \"blue\"","active":true},{"item_id":2,"label":"Ink"}]}` ).
    check( name     = `json none`
           actual   = /ui2/cl_json=>serialize( data = VALUE ty_item( item_id = 3 label = `x` ) )
           expected = `{"ITEM_ID":3,"LABEL":"x","ACTIVE":false}` ).
    check( name     = `json mappings`
           actual   = /ui2/cl_json=>serialize( data          = VALUE ty_item( item_id = 7 )
                                               compress      = abap_true
                                               pretty_name   = /ui2/cl_json=>pretty_mode-user
                                               name_mappings = VALUE #( ( abap = 'ITEM_ID' json = `id` ) ) )
           expected = `{"id":7}` ).
    strings = VALUE #( ( `a` ) ( `b` ) ).
    check( name = `json table` actual = /ui2/cl_json=>serialize( data = strings ) expected = `["a","b"]` ).

    /ui2/cl_json=>deserialize( EXPORTING json = camel pretty_name = /ui2/cl_json=>pretty_mode-camel_case CHANGING data = back ).
    check( name = `json back id` actual = back-order_id expected = `0042` ).
    check( name = `json back total` actual = back-total expected = `12.50` ).
    check( name = `json back date` actual = back-created expected = `20261111` ).
    check( name = `json back lines` actual = lines( back-items ) expected = 2 ).
    check( name = `json back label` actual = back-items[ 1 ]-label expected = `Pen "blue"` ).
    check( name = `json back bool` actual = back-items[ 1 ]-active expected = `X` ).
    CLEAR strings.
    /ui2/cl_json=>deserialize( EXPORTING json = `["x","y","z"]` CHANGING data = strings ).
    check( name = `json back table` actual = lines( strings ) expected = 3 ).

    check( name     = `xco from_abap`
           actual   = xco_cp_json=>data->from_abap( VALUE ty_item( item_id = 3 label = `x` )
                        )->apply( VALUE #( ( xco_cp_json=>transformation->underscore_to_camel_case ) ) )->to_string( )
           expected = `{"itemId":3,"label":"x","active":""}` ).
    xco_cp_json=>data->from_string( `{"itemId":5,"label":"y","active":true}`
      )->apply( VALUE #( ( xco_cp_json=>transformation->camel_case_to_underscore )
                         ( xco_cp_json=>transformation->boolean_to_abap_bool ) )
      )->write_to( REF #( item ) ).
    check( name = `xco write_to id` actual = item-item_id expected = 5 ).
    check( name = `xco write_to bool` actual = item-active expected = `X` ).
    check( name     = `xco builder`
           actual   = xco_cp_json=>data->builder( )->begin_object(
                        )->add_member( 'a' )->add_number( 1
                        )->add_member( 'b' )->begin_array( )->add_string( 'x' )->add_boolean( abap_true )->add_null( )->end_array(
                        )->end_object( )->get_data( )->to_string( )
           expected = `{"a":1,"b":["x",true,null]}` ).
  ENDMETHOD.

  METHOD encodings.
    DATA zipped TYPE xstring.
    DATA unzipped TYPE string.
    check( name = `base64` actual = cl_web_http_utility=>encode_base64( `Hello world` ) expected = `SGVsbG8gd29ybGQ=` ).
    check( name = `base64 back` actual = cl_web_http_utility=>decode_base64( `SGVsbG8gd29ybGQ=` ) expected = `Hello world` ).
    DATA(bytes) = cl_abap_conv_codepage=>create_out( )->convert( `Hello world` ).
    check( name = `codepage out` actual = bytes expected = `48656C6C6F20776F726C64` ).
    check( name = `codepage in` actual = cl_abap_conv_codepage=>create_in( )->convert( bytes ) expected = `Hello world` ).
    check( name = `codepage latin1` actual = cl_abap_conv_codepage=>create_out( codepage = `ISO-8859-1` )->convert( `é` ) expected = `E9` ).
    check( name = `x base64` actual = cl_web_http_utility=>encode_x_base64( bytes ) expected = `SGVsbG8gd29ybGQ=` ).
    check( name = `x base64 back` actual = cl_web_http_utility=>decode_x_base64( `SGVsbG8gd29ybGQ=` ) expected = bytes ).
    check( name = `url` actual = cl_web_http_utility=>escape_url( `a b&c` ) expected = `a%20b%26c` ).
    check( name = `url back` actual = cl_web_http_utility=>unescape_url( `a%20b%26c` ) expected = `a b&c` ).
    check( name = `html` actual = cl_web_http_utility=>escape_html( `<a href="x">` ) expected = `&lt;a href=&quot;x&quot;&gt;` ).
    check( name     = `xco xstring`
           actual   = xco_cp=>string( `Some string` )->as_xstring( xco_cp_character=>code_page->utf_8 )->value
           expected = `536F6D6520737472696E67` ).
    check( name     = `xco base64`
           actual   = xco_cp=>xstring( bytes )->as_string( xco_cp_binary=>text_encoding->base64 )->value
           expected = `SGVsbG8gd29ybGQ=` ).
    cl_abap_gzip=>compress_text( EXPORTING text_in = `Hello Hello Hello` IMPORTING gzip_out = zipped ).
    cl_abap_gzip=>decompress_text( EXPORTING gzip_in = zipped IMPORTING text_out = unzipped ).
    check( name = `gzip` actual = unzipped expected = `Hello Hello Hello` ).
  ENDMETHOD.

  METHOD text.
    DATA parts TYPE string_table.
    DATA trailing TYPE string VALUE `ABAP   `.
    DATA chars TYPE c LENGTH 4 VALUE 'AB'.
    DATA preserved TYPE string.
    check( name = `cr_lf` actual = strlen( cl_abap_char_utilities=>cr_lf ) expected = 2 ).
    check( name = `tab` actual = xsdbool( cl_abap_char_utilities=>horizontal_tab = |\t| ) expected = abap_true ).
    SPLIT |a{ cl_abap_char_utilities=>newline }b| AT |\n| INTO TABLE parts.
    check( name = `newline` actual = lines( parts ) expected = 2 ).
    cl_abap_string_utilities=>del_trailing_blanks( CHANGING str = trailing ).
    check( name = `trailing` actual = strlen( trailing ) expected = 4 ).
    cl_abap_string_utilities=>c2str_preserving_blanks( EXPORTING source = chars IMPORTING dest = preserved ).
    check( name = `preserving` actual = strlen( preserved ) expected = 4 ).
    check( name = `xco split` actual = lines( xco_cp=>string( `a,b,c` )->split( `,` )->value ) expected = 3 ).
    check( name = `xco join` actual = xco_cp=>string( `a,b,c` )->split( `,` )->join( `-` )->value expected = `a-b-c` ).
  ENDMETHOD.

  METHOD time.
    DATA ts TYPE timestamp VALUE '20240101131220'.
    DATA low TYPE utclong.
    DATA high TYPE utclong.
    check( name = `tstmp add` actual = cl_abap_tstmp=>add( tstmp = ts secs = 3600 ) expected = `20240101141220.0000000` ).
    check( name = `tstmp subtractsecs` actual = cl_abap_tstmp=>subtractsecs( tstmp = ts secs = 86400 ) expected = `20231231131220.0000000` ).
    check( name     = `tstmp subtract`
           actual   = CONV i( cl_abap_tstmp=>subtract( tstmp1 = CONV timestamp( '20240102000000' ) tstmp2 = CONV timestamp( '20240101000000' ) ) )
           expected = 86400 ).
    check( name = `tstmp compare` actual = cl_abap_tstmp=>compare( tstmp1 = ts tstmp2 = CONV timestamp( '20240101000000' ) ) expected = 1 ).
    check( name = `tstmp utclong` actual = cl_abap_tstmp=>utclong2tstmp_short( cl_abap_tstmp=>tstmp2utclong( ts ) ) expected = ts ).
    low = cl_abap_tstmp=>tstmp2utclong( ts ).
    high = utclong_add( val = low days = 1 hours = 2 ).
    cl_abap_utclong=>diff( EXPORTING high = high low = low IMPORTING days = DATA(days) hours = DATA(hours) ).
    check( name = `utclong diff` actual = |{ days } { hours }| expected = `1 2` ).
    DATA(moment) = xco_cp_time=>moment( iv_year = '2024' iv_month = '01' iv_day = '01' iv_hour = '12' iv_minute = '34' iv_second = '55' ).
    check( name = `xco moment` actual = moment->as( xco_cp_time=>format->iso_8601_extended )->value expected = `2024-01-01T12:34:55` ).
    check( name = `xco moment abap` actual = moment->as( xco_cp_time=>format->abap )->value expected = `20240101123455` ).
    check( name     = `xco moment add`
           actual   = moment->add( iv_month = 1 iv_day = 30 )->as( xco_cp_time=>format->iso_8601_extended )->value
           expected = `2024-03-02T12:34:55` ).
    check( name     = `xco date add`
           actual   = xco_cp_time=>date( iv_year = '2024' iv_month = '01' iv_day = '31' )->add( iv_month = 1 )->as( xco_cp_time=>format->iso_8601_extended )->value
           expected = `2024-02-29` ).
    check( name     = `xco time add`
           actual   = xco_cp_time=>time( iv_hour = '23' iv_minute = '30' iv_second = '00' )->add( iv_hour = 1 )->as( xco_cp_time=>format->iso_8601_extended )->value
           expected = `00:30:00` ).
    check( name     = `xco unix`
           actual   = xco_cp_time=>moment( iv_year = '1970' iv_month = '01' iv_day = '02' iv_hour = '00' iv_minute = '00' iv_second = '00' )->get_unix_timestamp( )->value
           expected = 86400 ).
    check( name = `xco user` actual = xco_cp=>sy->user( )->name expected = sy-uname ).
    check( name = `xco date` actual = strlen( xco_cp=>sy->date( )->as( xco_cp_time=>format->iso_8601_extended )->value ) expected = 10 ).
  ENDMETHOD.

  METHOD hashes.
    DATA hash TYPE string.
    cl_abap_message_digest=>calculate_hash_for_char( EXPORTING if_algorithm = `SHA256` if_data = `abc` IMPORTING ef_hashstring = hash ).
    check( name = `sha256` actual = hash expected = `BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD` ).
    cl_abap_message_digest=>calculate_hash_for_char( EXPORTING if_algorithm = `MD5` if_data = `abc` IMPORTING ef_hashstring = hash ).
    check( name = `md5` actual = hash expected = `900150983CD24FB0D6963F7D28E17F72` ).
    cl_abap_hmac=>calculate_hmac_for_char( EXPORTING if_algorithm = `SHA256`
                                                     if_key       = cl_abap_hmac=>string_to_xstring( `key` )
                                                     if_data      = `The quick brown fox jumps over the lazy dog`
                                           IMPORTING ef_hmacstring = hash ).
    check( name = `hmac` actual = hash expected = `F7BC83F430538424B13298E6AA6FB143EF4D59A14946175997479DBC2D1A3CD8` ).
  ENDMETHOD.

  METHOD random.
    DATA outside TYPE i.
    DATA(dice) = cl_abap_random_int=>create( seed = 42 min = 1 max = 6 ).
    DO 200 TIMES.
      DATA(value) = dice->get_next( ).
      IF value < 1 OR value > 6.
        outside = outside + 1.
      ENDIF.
    ENDDO.
    check( name = `random range` actual = outside expected = 0 ).
    check( name     = `random seed`
           actual   = cl_abap_random_int=>create( seed = 7 min = 1 max = 1000 )->get_next( )
           expected = cl_abap_random_int=>create( seed = 7 min = 1 max = 1000 )->get_next( ) ).
    DATA(float) = cl_abap_random_float=>create( )->get_next( ).
    check( name = `random float` actual = xsdbool( float >= 0 AND float < 1 ) expected = abap_true ).
  ENDMETHOD.

  METHOD regex.
    DATA(matches) = cl_abap_matcher=>create_pcre( pattern = `\D\d` text = `a1 # B2 ? cd . E3` ignore_case = abap_true )->find_all( ).
    check( name = `regex find_all` actual = lines( matches ) expected = 3 ).
    check( name = `regex offset` actual = matches[ 2 ]-offset expected = 5 ).
    DATA(matcher) = cl_abap_matcher=>create_pcre( pattern = `X(.*?)X` text = `XabcdXXefgXXhXXijklmnXX` ).
    check( name = `regex replace count` actual = matcher->replace_all( `#$1#` ) expected = 4 ).
    check( name = `regex replace text` actual = matcher->text expected = `#abcd##efg##h##ijklmn#X` ).
    check( name = `regex matches` actual = cl_abap_matcher=>matches( pattern = `\d+` text = `123` ) expected = abap_true ).
    check( name = `regex contains` actual = cl_abap_matcher=>contains( pattern = `b` text = `abc` ) expected = abap_true ).
    DATA(next) = cl_abap_regex=>create_pcre( pattern = `\d(\D.)` )->create_matcher( text = `a1bc2def` ).
    next->find_next( ).
    check( name = `regex submatch` actual = next->get_submatch( 1 ) expected = `bc` ).
    DATA(found) = next->get_match( ).
    check( name = `regex submatch offset` actual = found-submatches[ 1 ]-offset expected = 2 ).
  ENDMETHOD.

  METHOD rtts.
    DATA item TYPE ty_item.
    DATA strings TYPE string_table.
    DATA chars TYPE c LENGTH 10.
    DATA(struct) = CAST cl_abap_structdescr( cl_abap_typedescr=>describe_by_data( item ) ).
    check( name = `rtts components` actual = lines( struct->components ) expected = 3 ).
    check( name = `rtts name` actual = struct->components[ 1 ]-name expected = `ITEM_ID` ).
    check( name = `rtts kind` actual = struct->components[ 2 ]-type_kind expected = cl_abap_typedescr=>typekind_string ).
    check( name = `rtts get_components` actual = lines( struct->get_components( ) ) expected = 3 ).
    check( name = `rtts int` actual = cl_abap_typedescr=>describe_by_data( 1 )->type_kind expected = cl_abap_typedescr=>typekind_int ).
    check( name = `rtts char length` actual = cl_abap_typedescr=>describe_by_data( chars )->length expected = 20 ).
    DATA(table) = CAST cl_abap_tabledescr( cl_abap_typedescr=>describe_by_data( strings ) ).
    check( name = `rtts table line` actual = table->get_table_line_type( )->type_kind expected = cl_abap_typedescr=>typekind_string ).
    check( name = `rtts kind struct` actual = struct->kind expected = cl_abap_typedescr=>kind_struct ).
  ENDMETHOD.
ENDCLASS.

