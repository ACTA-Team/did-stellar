/**
 * Branded primitive types.
 *
 * TypeScript does not natively express "a string that has been validated
 * as an HTTPS URL". A brand attaches an unforgeable phantom property so
 * that, once a value has passed a runtime check, the rest of the program
 * can rely on the type system to enforce the invariant.
 *
 * Brands are erased at runtime; the runtime representation remains the
 * underlying primitive.
 */

declare const __brand: unique symbol;

/** Generic brand helper. */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** A `string` that has been validated against `^https://...$` with `len <= 255`. */
export type Url = Brand<string, 'Url'>;

/** A `string` of exactly 64 lowercase hex characters (32 bytes). */
export type Hex32 = Brand<string, 'Hex32'>;
