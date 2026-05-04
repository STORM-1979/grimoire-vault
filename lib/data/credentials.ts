import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRecord } from "@/lib/types";
import type { CreateCredentialInput, UpdateCredentialInput } from "@/lib/schemas/credentials";
import { DataError } from "./entries";

function rowToCredential(r: Record<string, unknown>): CredentialRecord {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    service: r.service as string,
    url: (r.url as string) ?? null,
    usernameEncrypted: r.username_encrypted as string,
    passwordEncrypted: r.password_encrypted as string,
    notesEncrypted: (r.notes_encrypted as string) ?? null,
    ivUsername: r.iv_username as string,
    ivPassword: r.iv_password as string,
    ivNotes: (r.iv_notes as string) ?? null,
    twoFactor: !!r.two_factor,
    strength: ((r.strength as "weak" | "medium" | "strong") ?? null),
    tags: (r.tags as string[]) ?? [],
    pinned: !!r.pinned,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function inputToRow(input: Partial<CreateCredentialInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.service !== undefined) row.service = input.service;
  if (input.url !== undefined) row.url = input.url;
  if (input.usernameEncrypted !== undefined) row.username_encrypted = input.usernameEncrypted;
  if (input.passwordEncrypted !== undefined) row.password_encrypted = input.passwordEncrypted;
  if (input.notesEncrypted !== undefined) row.notes_encrypted = input.notesEncrypted;
  if (input.ivUsername !== undefined) row.iv_username = input.ivUsername;
  if (input.ivPassword !== undefined) row.iv_password = input.ivPassword;
  if (input.ivNotes !== undefined) row.iv_notes = input.ivNotes;
  if (input.twoFactor !== undefined) row.two_factor = input.twoFactor;
  if (input.strength !== undefined) row.strength = input.strength;
  if (input.tags !== undefined) row.tags = input.tags;
  if (input.pinned !== undefined) row.pinned = input.pinned;
  return row;
}

export async function listCredentials(): Promise<CredentialRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("credentials")
    .select("*")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw new DataError(error.message, 500);
  return (data ?? []).map(rowToCredential);
}

export async function createCredential(userId: string, input: CreateCredentialInput): Promise<CredentialRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("credentials")
    .insert({ ...inputToRow(input), user_id: userId })
    .select()
    .single();
  if (error) throw new DataError(error.message, 500);
  return rowToCredential(data);
}

export async function updateCredential(id: string, input: UpdateCredentialInput): Promise<CredentialRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("credentials")
    .update(inputToRow(input))
    .eq("id", id)
    .select()
    .single();
  if (error) throw new DataError(error.message, 500);
  return rowToCredential(data);
}

export async function deleteCredential(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("credentials").delete().eq("id", id);
  if (error) throw new DataError(error.message, 500);
}
