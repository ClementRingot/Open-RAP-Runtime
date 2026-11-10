# Consommer une API distante depuis le BO (SCM, SCM2, client HTTP)

Un behavior pool peut appeler une API distante avec le code ABAP Cloud habituel : le client
HTTP (`cl_web_http_client_manager`) pour une API REST, le client proxy OData d'un service
consumption model pour un service OData V2 ou V4. L'application générée exécute ce code tel quel ;
seule la destination se configure autrement que sur SAP (décision D31).

## 1. Ce qu'il faut exporter avec abapGit

| Sur SAP | Dans le dépôt abapGit | Ce que rap-transpiler en fait |
|---|---|---|
| Service consumption model 2 (OData V4) | la classe de modèle de consommation générée (`INHERITING FROM /iwbep/cl_v4_abs_pm_model_prov`) | garde ses types (`tys_…`, `tyt_…`) et constantes (`gcs_entity_set`…) ; la méthode `define` est retirée |
| Service consumption model (OData V2/V4, première génération) | les entités abstraites générées et la définition de service du proxy | les entités abstraites typent les données ; la définition de service sans binding n'est pas construite (info SRVD007) |
| API REST | rien | |

Le fichier `.srvc` du service consumption model lui-même n'est pas nécessaire : le proxy lit le
`$metadata` du service distant à son premier appel.

## 2. Le code du behavior pool

Le même que sur SAP, par exemple dans une action :

```abap
METHOD importRemote.
  DATA remote_travels TYPE zscm_rt_travel=>tyt_travel_type.
  DATA travel_ids     TYPE RANGE OF zscm_rt_travel=>tys_travel_type-travel_id.

  READ ENTITIES OF zrt_r_travel IN LOCAL MODE
    ENTITY Travel FIELDS ( TravelID ) WITH CORRESPONDING #( keys )
    RESULT DATA(travels).
  travel_ids = VALUE #( FOR t IN travels ( sign = 'I' option = 'EQ' low = t-TravelID ) ).

  TRY.
      DATA(destination) = cl_http_destination_provider=>create_by_comm_arrangement(
                            comm_scenario = 'ZRT_TRAVEL_REMOTE'
                            service_id    = 'ZRT_TRAVEL_REMOTE_REST' ).
      DATA(proxy) = /iwbep/cl_cp_factory_remote=>create_v4_remote_proxy(
                      is_proxy_model_key       = VALUE #( repository_id       = 'DEFAULT'
                                                          proxy_model_id      = 'ZSCM_RT_TRAVEL'
                                                          proxy_model_version = '0001' )
                      io_http_client           = cl_web_http_client_manager=>create_by_http_destination( destination )
                      iv_relative_service_root = '/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/' ).

      DATA(request) = proxy->create_resource_for_entity_set( zscm_rt_travel=>gcs_entity_set-travel )->create_request_for_read( ).
      DATA(filter_factory) = request->create_filter_factory( ).
      request->set_filter( filter_factory->create_by_range( iv_property_path = 'TRAVEL_ID' it_range = travel_ids ) ).
      request->set_top( 50 ).
      DATA(response) = request->execute( ).
      response->get_business_data( IMPORTING et_business_data = remote_travels ).

    CATCH /iwbep/cx_cp_remote INTO DATA(remote_error).
      " remote_error->http_status_code, remote_error->get_text( )
    CATCH /iwbep/cx_gateway cx_web_http_client_error cx_http_dest_provider_error INTO DATA(error).
      " error->get_text( )
  ENDTRY.
ENDMETHOD.
```

Les noms internes de la classe (`TRAVEL_ID`, `'TRAVEL'`) sont rapprochés des noms du service
(`TravelID`, `Travel`) sans tenir compte de la casse ni des `_`. Sont pris en charge : lecture de
liste (`create_by_range`, `and`/`or`/`not`, `set_select_properties`, `set_orderby`, `set_top`,
`set_skip`, `request_count`, `request_no_business_data`), lecture par clé
(`navigate_with_key`), création, mise à jour (`PATCH` ou `PUT`, `it_provided_property`,
`set_if_match`), suppression. Le jeton CSRF et les cookies de session de SAP Gateway sont gérés
par le proxy.

Une API REST :

```abap
DATA(client) = cl_web_http_client_manager=>create_by_http_destination(
                 cl_http_destination_provider=>create_by_cloud_destination( i_name       = 'RATINGS'
                                                                            i_authn_mode = if_a4c_cp_service=>service_specific ) ).
DATA(request) = client->get_http_request( ).
request->set_uri_path( |/api/ratings/{ travel-TravelID }| ).
request->set_header_field( i_name = 'Accept' i_value = 'application/json' ).
DATA(response) = client->execute( if_web_http_client=>get ).
DATA(status) = response->get_status( ).
IF status-code = 200.
  DATA(json) = response->get_text( ).
ENDIF.
```

## 3. La destination

Sur SAP, l'URL et les identifiants viennent d'un communication arrangement ou du destination
service de BTP. Dans l'application générée, ce sont des variables d'environnement :

| Variable | Contenu |
|---|---|
| `DESTINATION_<NOM>_URL` | URL de base (obligatoire) |
| `DESTINATION_<NOM>_USER`, `DESTINATION_<NOM>_PASSWORD` | authentification basic |
| `DESTINATION_<NOM>_TOKEN` | jeton porteur (`Authorization: Bearer`) |
| `DESTINATION_<NOM>_HEADERS` | autres en-têtes, objet JSON : `{"APIKey":"…"}` |

`<NOM>` est le nom de `create_by_cloud_destination` (`RATINGS`), ou pour
`create_by_comm_arrangement` : `<SCENARIO>_<SERVICE_ID>`, à défaut `<SCENARIO>`
(`ZRT_TRAVEL_REMOTE_ZRT_TRAVEL_REMOTE_REST`, puis `ZRT_TRAVEL_REMOTE`), en majuscules, les autres
caractères que lettres et chiffres remplacés par `_`. `rapt build` liste les destinations écrites
en littéraux dans le `.env.example` et le README de l'application. Les identifiants restent côté
serveur : l'ABAP ne voit que l'URL.

Avec docker compose, dans le service `app` :

```yaml
    environment:
      DESTINATION_ZRT_TRAVEL_REMOTE_URL: https://my-system.example.com
      DESTINATION_ZRT_TRAVEL_REMOTE_USER: ${REMOTE_USER}
      DESTINATION_ZRT_TRAVEL_REMOTE_PASSWORD: ${REMOTE_PASSWORD}
```

Derrière un proxy sortant : `HTTPS_PROXY=…` et `NODE_USE_ENV_PROXY=1`.

## 4. Limites

Voir [KNOWN_GAPS.md](../KNOWN_GAPS.md#api-distantes-d31) : pas de `$batch`, de `$expand`, de
deep insert, de navigation par association ni d'actions du service distant dans le client proxy ;
value controls non remplis ; ni propagation de l'utilisateur ni OAuth client credentials (un jeton
fixe par `_TOKEN`) ; pas de communication targets, de SOAP ni de RFC. Comme sur SAP, un appel
distant fait pendant l'interaction n'est pas annulé par un rollback de la LUW.

Exemple complet testé : `packages/runtime/test/variants.ts` (`remoteVariant`) et
`packages/runtime/test/rap-variant-remote.test.ts`.
