# ABAP Cloud utility classes in the behavior pool

A behavior pool can use the released utility classes of ABAP Cloud with the usual code: JSON,
encodings, numbering, dates, application log, hashing, random numbers, regular expressions,
RTTS. rap-transpiler provides a "clean-room" implementation of them (written from the public
signatures documented by SAP, no SAP code); the kernel of the application does what ABAP cannot
do alone (read and write JSON, convert a code page, hash, compress, write to the database,
describe a data object) (decision D40).

Only the objects the project uses are given to the transpiler: a project that uses none of them
does not change.

## Available classes

| Area | Classes | Methods and attributes |
|---|---|---|
| JSON | `/ui2/cl_json` | `serialize` (`compress`, `name`, `pretty_name`, `numc_as_string`, `ts_as_iso8601`, `name_mappings`, `format_output`, `hex_as_base64`), `deserialize` (`json`, `jsonx`, `pretty_name`, `name_mappings`), constants `pretty_mode` (`none`, `low_case`, `camel_case`, `extended`, `user`, `user_low_case`) and `c_bool` |
| JSON (XCO) | `xco_cp_json` | `data->from_string`, `data->from_abap`, `->apply( … )`, `->to_string( )`, `->write_to( REF #( … ) )`, `data->builder( )` (`begin_object`, `end_object`, `begin_array`, `end_array`, `add_member`, `add_string`, `add_number`, `add_boolean`, `add_null`, `get_data`); transformations `camel_case_to_underscore`, `underscore_to_camel_case`, `pascal_case_to_underscore`, `underscore_to_pascal_case`, `boolean_to_abap_bool`, `abap_bool_to_boolean` |
| Encodings | `cl_web_http_utility` | `encode_base64`, `decode_base64`, `encode_x_base64`, `decode_x_base64`, `encode_utf8`, `decode_utf8`, `escape_url`, `unescape_url`, `escape_html` |
| | `cl_abap_conv_codepage` | `create_out( codepage )->convert( )`, `create_in( codepage )->convert( )`: UTF-8, UTF-16 (LE, BE), ISO-8859-1, windows-1252, US-ASCII |
| | `cl_abap_gzip` | `compress_binary`, `decompress_binary`, `compress_text`, `decompress_text` |
| | `xco_cp=>string`, `xco_cp=>xstring`, `xco_cp_character=>code_page`, `xco_cp_binary=>text_encoding->base64` | `as_xstring`, `as_string`, `value`, `split`, `join`, `append`, `prepend`, `to_upper_case`, `to_lower_case`, `starts_with`, `ends_with` |
| Text | `cl_abap_char_utilities` | `newline`, `cr_lf`, `horizontal_tab`, `vertical_tab`, `form_feed`, `backspace`, `maxchar`, `charsize`, `byte_order_mark_utf8` |
| | `cl_abap_string_utilities` | `del_trailing_blanks`, `c2str_preserving_blanks` |
| Numbering | `cl_numberrange_runtime` | `number_get` (`quantity`, `subobject`, `toyear`; `number`, `returncode`, `returned_quantity`), `number_check`; exceptions `cx_number_ranges`, `cx_nr_object_not_found` |
| Dates and timestamps | `cl_abap_tstmp` | `add`, `subtractsecs`, `subtract`, `compare`, `move`, `move_to_short`, `normalize`, `tstmp2utclong`, `utclong2tstmp`, `utclong2tstmp_short`, `systemtstmp_syst2utc`, `systemtstmp_utc2syst`, `td_add`, `td_subtract` |
| | `cl_abap_utclong` | `diff`, `read` |
| | `xco_cp=>sy`, `xco_cp_time` | `sy->user( )->name`, `sy->language( )->value`, `sy->date( )`, `sy->time( )`, `sy->moment( )`, `sy->unix_timestamp( )`; `xco_cp_time=>date( )`, `time( )`, `moment( )`; `->as( xco_cp_time=>format->abap / iso_8601_basic / iso_8601_extended )->value`, `->add( … )`, `->subtract( … )`, `year`, `month`, `day`, `hour`, `minute`, `second`; `xco_cp_time=>time_zone->user / utc` |
| Application log | `cl_bali_log`, `cl_bali_header_setter`, `cl_bali_free_text_setter`, `cl_bali_message_setter`, `cl_bali_exception_setter`, `cl_bali_log_db`, `cl_bali_log_filter`, `if_bali_constants` | `create`, `create_with_header`, `set_header`, `add_item`, `get_all_items`, `get_handle`; `save_log`, `load_log`, `load_logs_via_filter`, `load_logs_w_items_via_filter`, `delete_log`; filter by object, subobject, external ID, user, time interval |
| Hashing | `cl_abap_message_digest`, `cl_abap_hmac` | `calculate_hash_for_char`, `calculate_hash_for_raw`, `calculate_hmac_for_char`, `calculate_hmac_for_raw`, `string_to_xstring`: MD5, SHA1, SHA224, SHA256, SHA384, SHA512 |
| Random numbers | `cl_abap_random`, `cl_abap_random_int`, `cl_abap_random_int8`, `cl_abap_random_float`, `cl_abap_random_decfloat34` | `cl_abap_random=>seed( )`, `create( seed min max )->get_next( )`; `int`, `intinrange`, `float` |
| Regular expressions | `cl_abap_regex`, `cl_abap_matcher` | `create_pcre`, `create_posix`, `create_matcher`, `cl_abap_matcher=>create`, `create_pcre`, `matches`, `contains`, `find_next`, `find_all`, `match`, `get_match`, `get_offset`, `get_length`, `get_submatch`, `replace_all`, `replace_found`, `replace_next` |
| RTTS | `cl_abap_typedescr`, `cl_abap_elemdescr`, `cl_abap_structdescr`, `cl_abap_tabledescr`, `cl_abap_refdescr`, `cl_abap_classdescr` | `describe_by_data`, `describe_by_data_ref`, `describe_by_object_ref`; `type_kind`, `kind`, `length`, `decimals`, `absolute_name`, `components`, `get_components( )`, `get_component_type( )`, `get_table_line_type( )`, constants `typekind_*` and `kind_*` |
| Background processing | `cl_bgmc_process_factory`, `if_bgmc_op_single`, `if_bgmc_op_single_tx_uncontr`, `cl_abap_tx` | `get_default( )->create( )`, `set_name`, `set_operation`, `set_operation_tx_uncontrolled`, `save_for_execution( )` → monitor (`get_state( )`), `cl_abap_tx=>save( )` / `modify( )` |
| E-mail | `cl_bcs_mail_message`, `cl_bcs_mail_textpart`, `cl_bcs_mail_binarypart` | `create_instance`, `set_sender`, `set_reply_to`, `add_recipient` (`to`, `cc`, `bcc`), `set_subject`, `set_main`, `add_attachment`, `send` (`et_status`, `ev_mail_status`), `send_async`; `create_text_plain`, `create_text_html` |
| Types | `string_table`, `xstring_table`, `match_result(_tab)`, `submatch_result(_tab)`, `abap_compdescr_tab`, `abap_component_tab` | |

## Numbering: `rapt/number-ranges.json`

The number range objects and intervals are declared next to the sources, like the roles
(`rapt/authorizations.json`), and are versioned with them:

```json
{
  "ZRT_TRAVEL": {
    "01": { "from": "1", "to": "99999999" }
  }
}
```

An interval can also have `subobject` and `toyear`. The numbers are drawn in the database of the
application (table `rapt_number_range`); an interval missing from the file starts at 1. Changing
the bounds keeps the current number. `number` is the last number of the drawn block, as on SAP:
with `quantity`, the numbers go from `number - returned_quantity + 1` to `number`. `returncode`
is `2` at the last number of the interval, `3` when the block was reduced; an exhausted interval
raises `cx_number_ranges`.

## Application log

`cl_bali_log_db=>get_instance( )->save_log( )` writes the log into the database of the
application (tables `rapt_application_log` and `rapt_application_log_item`), with the user and
the time of the request. Log objects and subobjects do not have to be declared. The tables are
only created when the code uses the log (or the numbering, for `rapt_number_range`).

## Background processing (bgPF)

`save_for_execution( )` records the process in the LUW of the request (table
`rapt_background_process`, state `NEW`). Once the LUW is committed, the operation runs in a LUW
of its own, with the same user, after the response to the request; a rolled-back LUW starts
nothing.

- **Controlled operation** (`if_bgmc_op_single`): the EML of the operation (without
  `IN LOCAL MODE`) is saved at its end, as by the RAP framework; ABAP SQL only writes after
  `cl_abap_tx=>save( )`.
- **Uncontrolled operation** (`if_bgmc_op_single_tx_uncontr`): ABAP SQL writes whenever it wants;
  `COMMIT ENTITIES` (with `RESPONSE OF`) saves the EML, `ROLLBACK ENTITIES` rolls back the LUW.
- **State**: `SUCCESSFUL` or `ERRONEOUS` (with the text of the exception) in
  `rapt_background_process`, read by `get_state( )` of the monitor.

## E-mail

`send( )` composes the mail (HTML or text, text and binary attachments, copies) and keeps it in
the `rapt_mail` table of the LUW (state `WAITING`, `ev_mail_status` = `W`). Once the LUW is
committed, it is sent through the SMTP server of `MAIL_SMTP_URL`
(`smtp://user:password@server:587`, or `smtps://…:465`): state `SENT`, or `ERROR` with the
reason. Without `MAIL_SMTP_URL`, the mail stays in `rapt_mail` (state `STORED`, complete MIME
message in `raw_message`): handy with `rapt dev`. `MAIL_FROM` gives the sender when the code does
not call `set_sender`. A rolled-back LUW sends nothing.

## Differences with SAP

See [KNOWN_GAPS.md](../KNOWN_GAPS.md), section "ABAP Cloud utilities". In short: the time zone of
the user is UTC; numbering and log are written in the LUW of the request (rolled back with it);
`describe_by_name`, `/ui2/cl_json=>generate` and associative arrays are not supported; regular
expressions go through those of JavaScript.
