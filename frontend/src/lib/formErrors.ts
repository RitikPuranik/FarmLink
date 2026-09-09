import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiRequestError } from "@/types/api";

/**
 * The backend returns `{ fields: { village: "...", pincode: "..." } }` when a
 * submission fails validation — one message per field. Forms used to just
 * grab the *first* value out of that object (`Object.values(err.fields)[0]`)
 * and show it in a single banner at the top of the form. That meant:
 *   - if two fields were wrong, the person only ever saw one of them
 *   - the message wasn't attached to the field it was actually about, so a
 *     first-time user had to guess which box needed fixing
 *
 * This puts each field-level message directly under its own input (via
 * react-hook-form's `setError`, which the existing `<FieldError>` components
 * already render) instead. Anything the API flags that isn't one of this
 * form's own fields — or the general message when there's no `fields` object
 * at all — is returned so the caller can still show it in a banner.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly (keyof T & string)[],
): string | null {
  if (!(err instanceof ApiRequestError)) return null;

  if (!err.fields || Object.keys(err.fields).length === 0) {
    return err.message;
  }

  let unmatched: string | null = null;
  for (const [field, message] of Object.entries(err.fields)) {
    if ((knownFields as readonly string[]).includes(field)) {
      setError(field as Path<T>, { type: "server", message });
    } else if (!unmatched) {
      unmatched = message;
    }
  }
  return unmatched;
}
