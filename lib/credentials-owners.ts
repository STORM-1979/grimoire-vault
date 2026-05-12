/**
 * Account-owner registry for the credentials vault.
 *
 * Why a registry instead of free-form text input: the filter tabs
 * in CredentialsView need a known set of values to render chips
 * for, and the modal dropdown needs the same list to populate
 * options.  Centralising here means adding a third person later
 * is one append — every consumer picks it up automatically.
 *
 * `id` is the value stored in the DB column.  `label` is what the
 * UI shows.  The IDs are ASCII so they survive any encoding round-
 * trip (URL params, JSON, etc) without surprises.
 */
export interface CredentialOwner {
  id: string;
  label: string;
}

export const CREDENTIAL_OWNERS: CredentialOwner[] = [
  { id: "vova", label: "Вова" },
  { id: "sery", label: "Серый" },
];

export function getOwnerLabel(id: string | null | undefined): string {
  if (!id) return "Без владельца";
  return CREDENTIAL_OWNERS.find((o) => o.id === id)?.label ?? id;
}
