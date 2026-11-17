// Round 2 on the SAP BTP trial (D111): the reads of the CDS views of the variant `cds`
// (fixtures/cds), made by scripts/btp-read-trial.mjs on the trial and replayed on Open RAP Runtime
// by packages/runtime/test/cds-round2.test.ts. Pure helpers, tested by scripts/lib/cds-reads.test.mjs.

const HIERARCHY = "com.sap.vocabularies.Hierarchy.v1.TopLevels";
const HIERARCHY_PROPERTIES = "DistanceFromRoot,DrillState,LimitedDescendantCount,LimitedRank";

/**
 * The reads, relative to the root of the service; `{{qualifier}}` is the name of the CDS hierarchy
 * with the suffix of the trial. `compare`: the answer only depends on the data of the fill class
 * (zrt_cl_cds_fill), so the one of Open RAP Runtime must be the same.
 */
export const CDS_READS = [
  { id: "cds-booking", url: "CdsBooking?$orderby=BookingID&$top=20", compare: false },
  { id: "cds-booking-stats", url: "CdsBookingStats?$orderby=TravelUUID", compare: false },
  { id: "cds-dates", url: "CdsDates?$count=true&$top=0", compare: false },
  { id: "cds-travel-by-status", url: "CdsTravelByStatus(p_status='O')/Set?$select=TravelID,OverallStatus", compare: false },
  { id: "cds-travel-by-status-without-parameters", url: "CdsTravelByStatus", compare: false },
  {
    id: "cds-node-top-levels",
    url: `CdsNode?$apply=${HIERARCHY}(HierarchyNodes=$root/CdsNode,HierarchyQualifier='{{qualifier}}',NodeProperty='NodeId',Levels=2)&$select=NodeId,Name,${HIERARCHY_PROPERTIES}&$count=true&$skip=0&$top=100`,
    compare: true,
  },
  {
    id: "cds-node-expand-levels",
    url: `CdsNode?$apply=${HIERARCHY}(HierarchyNodes=$root/CdsNode,HierarchyQualifier='{{qualifier}}',NodeProperty='NodeId',Levels=1,ExpandLevels=[{"NodeID":"A","Levels":1}])&$select=NodeId,${HIERARCHY_PROPERTIES}&$count=true&$skip=0&$top=100`,
    compare: true,
  },
  {
    id: "cds-node-descendants",
    url: "CdsNode?$apply=descendants($root/CdsNode,{{qualifier}},NodeId,filter(NodeId eq 'A'),1)/orderby(Name)&$select=NodeId,DrillState,DistanceFromRoot&$count=true&$skip=0&$top=100",
    compare: true,
  },
  {
    id: "cds-node-ancestors",
    url: `CdsNode?$apply=ancestors($root/CdsNode,{{qualifier}},NodeId,filter(Name eq 'Alpha two one'),keep start)/${HIERARCHY}(HierarchyNodes=$root/CdsNode,HierarchyQualifier='{{qualifier}}',NodeProperty='NodeId',Levels=3)&$select=NodeId,${HIERARCHY_PROPERTIES}&$count=true&$skip=0&$top=100`,
    compare: true,
  },
];

/** The URL of a read for a service root (ending with /) and the suffix of the trial. */
export function readUrl(serviceRoot, read, suffix) {
  const qualifier = `ZRT_I_CdsNodeHier${suffix ?? ""}`;
  const [path, query = ""] = read.url.replaceAll("{{qualifier}}", qualifier).split("?");
  const encoded = query
    .split("&")
    .filter((p) => p !== "")
    .map((p) => {
      const index = p.indexOf("=");
      return index < 0 ? p : `${p.slice(0, index)}=${encodeURIComponent(p.slice(index + 1))}`;
    })
    .join("&");
  return `${serviceRoot}${path}${encoded === "" ? "" : `?${encoded}`}`;
}

/**
 * An answer kept in the repository: no user name, key, namespace or suffix of the trial (the
 * values of user elements become {{user}}, UUIDs {{uuid}}, the namespace {{NS}}, the suffix of the
 * hierarchy disappears).
 */
export function neutralAnswer(status, body, { namespace, suffix } = {}) {
  let text = JSON.stringify(body ?? null, (key, value) => (/^(ReadBy|.*User(Description)?)$/.test(key) && typeof value === "string" && value !== "" ? "{{user}}" : value));
  text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{{uuid}}");
  if (namespace !== undefined && namespace !== "") text = text.split(namespace).join("{{NS}}");
  if (suffix !== undefined && suffix !== "") text = text.split(`ZRT_I_CdsNodeHier${suffix}`).join("ZRT_I_CdsNodeHier");
  return { status, body: JSON.parse(text) };
}
