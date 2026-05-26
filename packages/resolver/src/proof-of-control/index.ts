export { jcsCanonicalize, jcsStringify } from './jcs';
export { buildChallenge, generateNonce } from './challenge';
export type { BuildChallengeArgs, PoCChallenge } from './challenge';
export {
  DEFAULT_TIMESTAMP_WINDOW_MS,
  verifyProofOfControl,
} from './verify';
export type {
  VerifyProofOfControlArgs,
  VerifyProofOfControlResult,
} from './verify';
