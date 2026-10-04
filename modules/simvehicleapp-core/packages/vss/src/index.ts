export * from "./types.ts";
export { blocksFor, elementType, is64BitInteger, isArrayType, isVssDataType } from "./classify.ts";
export { canonicalJson, sha256Hex } from "./canonical.ts";
export { parseVssRelease, VssParseError } from "./parse.ts";
export {
  COVESA_PINS,
  COVESA_RELEASES_URL,
  CompositeSource,
  compareReleases,
  HttpSource,
  LocalFileSource,
  VssSourceError,
  type HttpSourceOptions,
  type LocalReleaseEntry,
  type ReleaseFiles,
  type ReleasePin,
  type VehicleModelSource,
} from "./sources.ts";
