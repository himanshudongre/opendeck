/**
 * Protocol major version. A single integer: any mismatch between hub and deck
 * is a breaking mismatch, and the hub answers with a `version_mismatch` error
 * telling the user to upgrade.
 */
export const PROTOCOL_VERSION = 1;
