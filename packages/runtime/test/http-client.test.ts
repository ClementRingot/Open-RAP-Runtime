/**
 * The kernel side of the API consumption (D31) without ABAP: destinations of the environment,
 * request URLs, $metadata documents of OData V2 and V4.
 */

import { describe, expect, it } from "vitest";
import { destinationKeys, requestUrl, resolveDestination } from "../src/abap/http.js";
import { parseMetadata } from "../src/abap/odata-client.js";

describe("destinations", () => {
  it("names the environment variables of a destination", () => {
    expect(destinationKeys("RATINGS")).toEqual(["RATINGS"]);
    expect(destinationKeys("my-api.v2")).toEqual(["MY_API_V2", "MY_API"]);
    // a communication arrangement: the service ID first, then the scenario
    expect(destinationKeys("ZRT_TRAVEL_REMOTE.ZRT_TRAVEL_REMOTE_REST")).toEqual(["ZRT_TRAVEL_REMOTE_ZRT_TRAVEL_REMOTE_REST", "ZRT_TRAVEL_REMOTE"]);
  });

  it("reads the URL and the credentials of a destination", () => {
    const env = {
      DESTINATION_RATINGS_URL: "https://ratings.example.com",
      DESTINATION_RATINGS_USER: "rater",
      DESTINATION_RATINGS_PASSWORD: "s3cret",
      DESTINATION_API_URL: "https://api.example.com/v1",
      DESTINATION_API_TOKEN: "t-1",
      DESTINATION_API_HEADERS: '{"X-Api-Key":"k-1","APIKey":42}',
    };
    expect(resolveDestination("ratings", env)).toEqual({ url: "https://ratings.example.com", headers: { authorization: `Basic ${Buffer.from("rater:s3cret").toString("base64")}` } });
    expect(resolveDestination("API", env)).toEqual({ url: "https://api.example.com/v1", headers: { authorization: "Bearer t-1", "x-api-key": "k-1", apikey: "42" } });
    expect(resolveDestination("MISSING", env)).toBeUndefined();
  });

  it("takes the destination of the service of a communication arrangement before the one of its scenario", () => {
    const env = { DESTINATION_SCENARIO_URL: "https://scenario.example.com", DESTINATION_SCENARIO_SERVICE_URL: "https://service.example.com" };
    expect(resolveDestination("SCENARIO.SERVICE", env)?.url).toBe("https://service.example.com");
    expect(resolveDestination("SCENARIO.OTHER", env)?.url).toBe("https://scenario.example.com");
  });
});

describe("request URLs", () => {
  it("adds the path and the query to the destination", () => {
    expect(requestUrl("https://h.example.com/", "/api/x", "")).toBe("https://h.example.com/api/x");
    expect(requestUrl("https://h.example.com/base", "api/x", "?a=1")).toBe("https://h.example.com/base/api/x?a=1");
    expect(requestUrl("https://h.example.com/base?k=v", "", "a=1")).toBe("https://h.example.com/base?k=v&a=1");
    // an absolute URI replaces the destination
    expect(requestUrl("https://h.example.com", "https://other.example.com/y", "")).toBe("https://other.example.com/y");
  });
});

describe("$metadata documents", () => {
  it("reads the entity sets, keys and property types of OData V4 (namespace and alias)", () => {
    const metadata = parseMetadata(`<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="com.example.v0001" Alias="SAP__self" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="TravelType">
        <Key><PropertyRef Name="TravelUUID"/></Key>
        <Property Name="TravelUUID" Type="Edm.Guid" Nullable="false"/>
        <Property Name="Fee" Type="Edm.Decimal" Precision="16" Scale="2"/>
        <Property Name="ChangedAt" Type="Edm.DateTimeOffset" Precision="7"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Travel" EntityType="SAP__self.TravelType"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
    expect(metadata.sets.get("Travel")).toEqual({
      name: "TravelType",
      keys: ["TravelUUID"],
      properties: [
        { name: "TravelUUID", type: "Edm.Guid", nullable: false },
        { name: "Fee", type: "Edm.Decimal", nullable: true, scale: 2, precision: 16 },
        { name: "ChangedAt", type: "Edm.DateTimeOffset", nullable: true, precision: 7 },
      ],
    });
  });

  it("reads OData V2 documents with several key properties", () => {
    const metadata = parseMetadata(`<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="ZSRV" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="Item">
        <Key><PropertyRef Name="Order"/><PropertyRef Name="Item"/></Key>
        <Property Name="Order" Type="Edm.String" Nullable="false"/>
        <Property Name="Item" Type="Edm.Int32" Nullable="false"/>
      </EntityType>
      <EntityContainer Name="ZSRV_Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="ItemSet" EntityType="ZSRV.Item"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
    expect(metadata.sets.get("ItemSet")?.keys).toEqual(["Order", "Item"]);
  });
});
