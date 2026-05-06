import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DataError } from "@/lib/errors";
import type { CategoryId, EntryCollection } from "@/lib/types";
import type { CreateCollectionInput, UpdateCollectionInput } from "@/lib/schemas/collections";

function rowToCollection(r: Record<string, unknown>): EntryCollection {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    categoryId: r.category_id as CategoryId,
    parentId: (r.parent_id as string) ?? null,
    name: r.name as string,
    slug: r.slug as string,
    position: r.position as number,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** URL-safe slug: lowercase, dashes for spaces, drop punctuation. */
function deriveSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-zа-яё0-9-]/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "collection";
}

export async function listCollections(
  userId: string,
  categoryId: CategoryId,
): Promise<EntryCollection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entry_collections")
    .select("*")
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new DataError(error.message, 500);
  return (data ?? []).map(rowToCollection);
}

export async function createCollection(
  userId: string,
  input: CreateCollectionInput,
): Promise<EntryCollection> {
  const supabase = await createClient();
  const slug = input.slug ?? deriveSlug(input.name);

  // Compute next position if not provided.
  let position = input.position;
  if (position === undefined) {
    const { data: maxRow } = await supabase
      .from("entry_collections")
      .select("position")
      .eq("user_id", userId)
      .eq("category_id", input.categoryId)
      .is("parent_id", input.parentId ?? null)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    position = ((maxRow?.position as number | undefined) ?? -1) + 1;
  }

  const row = {
    user_id: userId,
    category_id: input.categoryId,
    parent_id: input.parentId ?? null,
    name: input.name.trim(),
    slug,
    position,
  };
  const { data, error } = await supabase
    .from("entry_collections")
    .insert(row)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new DataError("Коллекция с таким названием уже есть", 409);
    }
    throw new DataError(error.message, 500);
  }
  return rowToCollection(data);
}

export async function updateCollection(
  id: string,
  input: UpdateCollectionInput,
): Promise<EntryCollection> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.parentId !== undefined) patch.parent_id = input.parentId;
  if (input.position !== undefined) patch.position = input.position;
  // Re-derive slug if name changed and slug not explicitly set.
  if (input.name !== undefined && input.slug === undefined) {
    patch.slug = deriveSlug(input.name);
  }
  const { data, error } = await supabase
    .from("entry_collections")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new DataError("Коллекция с таким названием уже есть", 409);
    }
    throw new DataError(error.message, 500);
  }
  return rowToCollection(data);
}

export async function deleteCollection(id: string): Promise<void> {
  const supabase = await createClient();
  // entries.collection_id has ON DELETE SET NULL — entries survive,
  // they just lose the collection assignment.
  const { error } = await supabase.from("entry_collections").delete().eq("id", id);
  if (error) throw new DataError(error.message, 500);
}
