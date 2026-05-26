export type {
  DidKey,
  DidRecord,
  DidRecordInput,
  DidService,
} from './types';
export {
  DID_RECORD_LIMITS,
  MAX_KEY_COUNT_AGREEMENT,
  MAX_KEY_COUNT_ASSERT,
  MAX_KEY_COUNT_AUTH,
  MAX_KEY_MULTIBASE_LEN,
  MAX_SERVICE_COUNT,
  MAX_SERVICE_ID_LEN,
  MAX_SERVICE_TYPE_LEN,
  MAX_URL_LEN,
  METADATA_HASH_LEN,
  MIN_KEY_COUNT_AUTH,
} from './types';
export { validateDidRecordInput } from './validate';
export { encodeDidRecord } from './encode';
export { decodeDidRecord } from './decode';
export { readDidRecord } from './reader';
export type { ReadDidRecordOptions } from './reader';
