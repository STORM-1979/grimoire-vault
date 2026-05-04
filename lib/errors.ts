/**
 * Domain-level error type used in DAL functions and surfaced as JSON
 * by `withErrorHandler`. Lives in its own module so server-only code
 * (DAL) and request-handling code (API helpers) can both import it
 * without forming an `import "server-only"` cycle.
 *
 * `extra` carries structured payload that flows into the JSON response
 * body alongside the error message — used e.g. by 409 dedup responses to
 * point the caller at the existing entry's id and category.
 */
export class DataError extends Error {
  constructor(
    message: string,
    public status = 500,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
