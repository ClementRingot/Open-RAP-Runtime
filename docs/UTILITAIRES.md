# Classes utilitaires d'ABAP Cloud dans le behavior pool

Un behavior pool peut utiliser les classes utilitaires libérées d'ABAP Cloud avec le code
habituel : JSON, encodages, numérotation, dates, journal applicatif, hachage, nombres aléatoires,
expressions régulières, RTTS. rap-transpiler en fournit une implémentation « clean-room »
(écrite à partir des signatures publiques documentées par SAP, aucun code SAP) ; le noyau de
l'application fait ce que l'ABAP ne peut pas faire seul (lire et écrire du JSON, convertir une
page de codes, hacher, compresser, écrire en base, décrire une donnée) (décision D40).

Seuls les objets que le projet utilise sont donnés au transpiler : un projet qui n'en utilise
aucun ne change pas.

## Classes disponibles

| Domaine | Classes | Méthodes et attributs |
|---|---|---|
| JSON | `/ui2/cl_json` | `serialize` (`compress`, `name`, `pretty_name`, `numc_as_string`, `ts_as_iso8601`, `name_mappings`, `format_output`, `hex_as_base64`), `deserialize` (`json`, `jsonx`, `pretty_name`, `name_mappings`), constantes `pretty_mode` (`none`, `low_case`, `camel_case`, `extended`, `user`, `user_low_case`) et `c_bool` |
| JSON (XCO) | `xco_cp_json` | `data->from_string`, `data->from_abap`, `->apply( … )`, `->to_string( )`, `->write_to( REF #( … ) )`, `data->builder( )` (`begin_object`, `end_object`, `begin_array`, `end_array`, `add_member`, `add_string`, `add_number`, `add_boolean`, `add_null`, `get_data`) ; transformations `camel_case_to_underscore`, `underscore_to_camel_case`, `pascal_case_to_underscore`, `underscore_to_pascal_case`, `boolean_to_abap_bool`, `abap_bool_to_boolean` |
| Encodages | `cl_web_http_utility` | `encode_base64`, `decode_base64`, `encode_x_base64`, `decode_x_base64`, `encode_utf8`, `decode_utf8`, `escape_url`, `unescape_url`, `escape_html` |
| | `cl_abap_conv_codepage` | `create_out( codepage )->convert( )`, `create_in( codepage )->convert( )` : UTF-8, UTF-16 (LE, BE), ISO-8859-1, windows-1252, US-ASCII |
| | `cl_abap_gzip` | `compress_binary`, `decompress_binary`, `compress_text`, `decompress_text` |
| | `xco_cp=>string`, `xco_cp=>xstring`, `xco_cp_character=>code_page`, `xco_cp_binary=>text_encoding->base64` | `as_xstring`, `as_string`, `value`, `split`, `join`, `append`, `prepend`, `to_upper_case`, `to_lower_case`, `starts_with`, `ends_with` |
| Texte | `cl_abap_char_utilities` | `newline`, `cr_lf`, `horizontal_tab`, `vertical_tab`, `form_feed`, `backspace`, `maxchar`, `charsize`, `byte_order_mark_utf8` |
| | `cl_abap_string_utilities` | `del_trailing_blanks`, `c2str_preserving_blanks` |
| Numérotation | `cl_numberrange_runtime` | `number_get` (`quantity`, `subobject`, `toyear` ; `number`, `returncode`, `returned_quantity`), `number_check` ; exceptions `cx_number_ranges`, `cx_nr_object_not_found` |
| Dates et horodatages | `cl_abap_tstmp` | `add`, `subtractsecs`, `subtract`, `compare`, `move`, `move_to_short`, `normalize`, `tstmp2utclong`, `utclong2tstmp`, `utclong2tstmp_short`, `systemtstmp_syst2utc`, `systemtstmp_utc2syst`, `td_add`, `td_subtract` |
| | `cl_abap_utclong` | `diff`, `read` |
| | `xco_cp=>sy`, `xco_cp_time` | `sy->user( )->name`, `sy->language( )->value`, `sy->date( )`, `sy->time( )`, `sy->moment( )`, `sy->unix_timestamp( )` ; `xco_cp_time=>date( )`, `time( )`, `moment( )` ; `->as( xco_cp_time=>format->abap / iso_8601_basic / iso_8601_extended )->value`, `->add( … )`, `->subtract( … )`, `year`, `month`, `day`, `hour`, `minute`, `second` ; `xco_cp_time=>time_zone->user / utc` |
| Journal applicatif | `cl_bali_log`, `cl_bali_header_setter`, `cl_bali_free_text_setter`, `cl_bali_message_setter`, `cl_bali_exception_setter`, `cl_bali_log_db`, `cl_bali_log_filter`, `if_bali_constants` | `create`, `create_with_header`, `set_header`, `add_item`, `get_all_items`, `get_handle` ; `save_log`, `load_log`, `load_logs_via_filter`, `load_logs_w_items_via_filter`, `delete_log` ; filtre par objet, sous-objet, ID externe, utilisateur, intervalle de temps |
| Hachage | `cl_abap_message_digest`, `cl_abap_hmac` | `calculate_hash_for_char`, `calculate_hash_for_raw`, `calculate_hmac_for_char`, `calculate_hmac_for_raw`, `string_to_xstring` : MD5, SHA1, SHA224, SHA256, SHA384, SHA512 |
| Nombres aléatoires | `cl_abap_random`, `cl_abap_random_int`, `cl_abap_random_int8`, `cl_abap_random_float`, `cl_abap_random_decfloat34` | `cl_abap_random=>seed( )`, `create( seed min max )->get_next( )` ; `int`, `intinrange`, `float` |
| Expressions régulières | `cl_abap_regex`, `cl_abap_matcher` | `create_pcre`, `create_posix`, `create_matcher`, `cl_abap_matcher=>create`, `create_pcre`, `matches`, `contains`, `find_next`, `find_all`, `match`, `get_match`, `get_offset`, `get_length`, `get_submatch`, `replace_all`, `replace_found`, `replace_next` |
| RTTS | `cl_abap_typedescr`, `cl_abap_elemdescr`, `cl_abap_structdescr`, `cl_abap_tabledescr`, `cl_abap_refdescr`, `cl_abap_classdescr` | `describe_by_data`, `describe_by_data_ref`, `describe_by_object_ref` ; `type_kind`, `kind`, `length`, `decimals`, `absolute_name`, `components`, `get_components( )`, `get_component_type( )`, `get_table_line_type( )`, constantes `typekind_*` et `kind_*` |
| Traitement en arrière-plan | `cl_bgmc_process_factory`, `if_bgmc_op_single`, `if_bgmc_op_single_tx_uncontr`, `cl_abap_tx` | `get_default( )->create( )`, `set_name`, `set_operation`, `set_operation_tx_uncontrolled`, `save_for_execution( )` → moniteur (`get_state( )`), `cl_abap_tx=>save( )` / `modify( )` |
| E-mail | `cl_bcs_mail_message`, `cl_bcs_mail_textpart`, `cl_bcs_mail_binarypart` | `create_instance`, `set_sender`, `set_reply_to`, `add_recipient` (`to`, `cc`, `bcc`), `set_subject`, `set_main`, `add_attachment`, `send` (`et_status`, `ev_mail_status`), `send_async` ; `create_text_plain`, `create_text_html` |
| Types | `string_table`, `xstring_table`, `match_result(_tab)`, `submatch_result(_tab)`, `abap_compdescr_tab`, `abap_component_tab` | |

## Numérotation : `rapt/number-ranges.json`

Les objets et intervalles de numérotation se déclarent à côté des sources, comme les rôles
(`rapt/authorizations.json`), et sont versionnés avec elles :

```json
{
  "ZRT_TRAVEL": {
    "01": { "from": "1", "to": "99999999" }
  }
}
```

Un intervalle peut aussi avoir `subobject` et `toyear`. Les numéros sont tirés dans la base de
l'application (table `rapt_number_range`) ; un intervalle absent du fichier commence à 1. Changer
les bornes garde le numéro courant. `number` est le dernier numéro du bloc tiré, comme sur SAP :
avec `quantity`, les numéros vont de `number - returned_quantity + 1` à `number`. `returncode`
vaut `2` au dernier numéro de l'intervalle, `3` quand le bloc a été réduit ; un intervalle épuisé
lève `cx_number_ranges`.

## Journal applicatif

`cl_bali_log_db=>get_instance( )->save_log( )` écrit le journal dans la base de l'application
(tables `rapt_application_log` et `rapt_application_log_item`), avec l'utilisateur et l'heure de
la requête. Les objets et sous-objets de journal n'ont pas à être déclarés. Les tables ne sont
créées que si le code utilise le journal (ou la numérotation, pour `rapt_number_range`).

## Traitement en arrière-plan (bgPF)

`save_for_execution( )` enregistre le processus dans la LUW de la requête (table
`rapt_background_process`, état `NEW`). Une fois la LUW validée, l'opération s'exécute dans une LUW
à elle, avec le même utilisateur, après la réponse à la requête ; une LUW annulée ne lance rien.

- **Opération contrôlée** (`if_bgmc_op_single`) : l'EML de l'opération (sans `IN LOCAL MODE`) est
  sauvegardé à sa fin, comme par le framework RAP ; l'ABAP SQL n'écrit qu'après
  `cl_abap_tx=>save( )`.
- **Opération non contrôlée** (`if_bgmc_op_single_tx_uncontr`) : l'ABAP SQL écrit quand il veut ;
  `COMMIT ENTITIES` (avec `RESPONSE OF`) sauvegarde l'EML, `ROLLBACK ENTITIES` annule la LUW.
- **État** : `SUCCESSFUL` ou `ERRONEOUS` (avec le texte de l'exception) dans
  `rapt_background_process`, lu par `get_state( )` du moniteur.

## E-mail

`send( )` compose le mail (HTML ou texte, pièces jointes texte et binaires, copies) et le garde dans
la table `rapt_mail` de la LUW (état `WAITING`, `ev_mail_status` = `W`). Une fois la LUW validée,
il part par le serveur SMTP de `MAIL_SMTP_URL` (`smtp://utilisateur:motdepasse@serveur:587`, ou
`smtps://…:465`) : état `SENT`, ou `ERROR` avec la raison. Sans `MAIL_SMTP_URL`, le mail reste dans
`rapt_mail` (état `STORED`, message MIME complet dans `raw_message`) : pratique avec `rapt dev`.
`MAIL_FROM` donne l'expéditeur quand le code n'appelle pas `set_sender`. Une LUW annulée n'envoie
rien.

## Différences avec SAP

Voir [KNOWN_GAPS.md](../KNOWN_GAPS.md), section « Utilitaires d'ABAP Cloud ». En bref : le fuseau
horaire de l'utilisateur est UTC ; la numérotation et le journal sont écrits dans la LUW de la
requête (annulés avec elle) ; `describe_by_name`, `/ui2/cl_json=>generate` et les tableaux
associatifs ne sont pas pris en charge ; les expressions régulières passent par celles de
JavaScript.
