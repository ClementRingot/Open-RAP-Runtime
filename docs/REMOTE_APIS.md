# Consuming a remote API from the BO (SCM, SCM2, HTTP client)

A behavior pool can call a remote API with the usual ABAP Cloud code: the HTTP client
(`cl_web_http_client_manager`) for a REST API, the OData client proxy of a service consumption
model for an OData V2 or V4 service. The generated application runs this code as is; only the
destination is configured differently from SAP (decision D31).

## 1. What to export with abapGit

| On SAP | In the abapGit repository | What rap-transpiler does with it |
|---|---|---|
| Service consumption model 2 (OData V4) | the generated consumption model class (`INHERITING FROM /iwbep/cl_v4_abs_pm_model_prov`) | keeps its types (`tys_…`, `tyt_…`) and constants (`gcs_entity_set`…); the `define` method is removed |
| Service consumption model (OData V2/V4, first generation) | the generated abstract entities and the service definition of the proxy | the abstract entities type the data; the service definition without a binding is not built (info SRVD007) |
| REST API | nothing | |

The `.srvc` file of the service consumption model itself is not needed: the proxy reads the
`$metadata` of the remote service on its first call.

## 2. The code of the behavior pool

The same as on SAP, for example in an action:

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

The internal names of the class (`TRAVEL_ID`, `'TRAVEL'`) are matched with the names of the
service (`TravelID`, `Travel`) ignoring case and `_`. Supported: list read (`create_by_range`,
`and`/`or`/`not`, `set_select_properties`, `set_orderby`, `set_top`, `set_skip`,
`request_count`, `request_no_business_data`), read by key (`navigate_with_key`), create, update
(`PATCH` or `PUT`, `it_provided_property`, `set_if_match`), delete. The CSRF token and the
session cookies of SAP Gateway are handled by the proxy.

A REST API:

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

## 3. The destination

On SAP, the URL and the credentials come from a communication arrangement or from the
destination service of BTP. In the generated application, they are environment variables:

| Variable | Content |
|---|---|
| `DESTINATION_<NAME>_URL` | base URL (mandatory) |
| `DESTINATION_<NAME>_USER`, `DESTINATION_<NAME>_PASSWORD` | basic authentication |
| `DESTINATION_<NAME>_TOKEN` | bearer token (`Authorization: Bearer`) |
| `DESTINATION_<NAME>_HEADERS` | other headers, JSON object: `{"APIKey":"…"}` |

`<NAME>` is the name of `create_by_cloud_destination` (`RATINGS`), or for
`create_by_comm_arrangement`: `<SCENARIO>_<SERVICE_ID>`, otherwise `<SCENARIO>`
(`ZRT_TRAVEL_REMOTE_ZRT_TRAVEL_REMOTE_REST`, then `ZRT_TRAVEL_REMOTE`), in upper case, the
characters other than letters and digits replaced by `_`. `rapt build` lists the destinations
written as literals in the `.env.example` and the README of the application. The credentials stay
on the server: the ABAP only sees the URL.

With docker compose, in the `app` service:

```yaml
    environment:
      DESTINATION_ZRT_TRAVEL_REMOTE_URL: https://my-system.example.com
      DESTINATION_ZRT_TRAVEL_REMOTE_USER: ${REMOTE_USER}
      DESTINATION_ZRT_TRAVEL_REMOTE_PASSWORD: ${REMOTE_PASSWORD}
```

Behind an outgoing proxy: `HTTPS_PROXY=…` and `NODE_USE_ENV_PROXY=1`.

## 4. Limits

See [KNOWN_GAPS.md](../KNOWN_GAPS.md#remote-apis-d31): no `$batch`, `$expand`, deep insert,
navigation by association nor actions of the remote service in the client proxy; value controls
not filled; neither user propagation nor OAuth client credentials (a fixed token with `_TOKEN`);
no communication targets, SOAP nor RFC. As on SAP, a remote call made during the interaction is
not undone by a rollback of the LUW.

Complete tested example: `packages/runtime/test/variants.ts` (`remoteVariant`) and
`packages/runtime/test/rap-variant-remote.test.ts`.
