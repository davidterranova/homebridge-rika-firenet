/** Thrown when the RIKA Firenet credentials are rejected or the session is invalid. */
export class AuthenticationError extends Error {
  constructor(message = 'RIKA Firenet authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when a controls update is rejected because the supplied `revision`
 * is stale. The caller should re-fetch the status and retry with the fresh
 * revision.
 */
export class OutdatedRevisionError extends Error {
  constructor(message = 'Stove controls revision is outdated') {
    super(message);
    this.name = 'OutdatedRevisionError';
  }
}

/** Thrown when the requested stove does not belong to the signed-in account. */
export class StoveNotFoundError extends Error {
  constructor(message = 'Stove not found for this account') {
    super(message);
    this.name = 'StoveNotFoundError';
  }
}
