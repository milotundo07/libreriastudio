import {
  CLOUD_BUCKET,
  CLOUD_TABLE,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./config.js";
import {
  getAllBooks,
  getCover,
  getMeta,
  getTrash,
  moveBookToTrash,
  nextInternalCode,
  saveBook,
  saveCover,
  setMeta,
} from "./db.js";
import {
  bookForCloud,
  bookFromCloud,
  compareVersions,
  isValidCloudConfig,
  remoteDeletionWins,
} from "./sync-core.js";

let client;
let realtimeChannel;
let syncPromise;

export function cloudConfigured() {
  return isValidCloudConfig(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

export function getCloudClient() {
  if (!cloudConfigured()) return null;
  if (client) return client;
  const createClient = globalThis.supabase?.createClient;
  if (typeof createClient !== "function") {
    throw new Error("La libreria Supabase non è stata caricata.");
  }
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export async function getCloudSession() {
  const supabase = getCloudClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export function onCloudAuthChange(callback) {
  const supabase = getCloudClient();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}

export async function createAccount(email, password) {
  const supabase = getCloudClient();
  if (!supabase) throw new Error("Sincronizzazione cloud non configurata.");
  const redirectTo = `${location.origin}${location.pathname}`;
  const { data, error } = await supabase.auth.signUp({
    email: String(email || "").trim(),
    password,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const supabase = getCloudClient();
  if (!supabase) throw new Error("Sincronizzazione cloud non configurata.");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || "").trim(),
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = getCloudClient();
  if (!supabase) return;
  stopRealtime();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordReset(email) {
  const supabase = getCloudClient();
  if (!supabase) throw new Error("Sincronizzazione cloud non configurata.");
  const redirectTo = `${location.origin}${location.pathname}`;
  const { error } = await supabase.auth.resetPasswordForEmail(String(email || "").trim(), { redirectTo });
  if (error) throw error;
}

export async function updatePassword(password) {
  const supabase = getCloudClient();
  if (!supabase) throw new Error("Sincronizzazione cloud non configurata.");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

async function uploadCover(supabase, userId, book) {
  if (!book.cover_id || !book.cloud_id) return "";
  const blob = await getCover(book.cover_id);
  if (!blob) return "";
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${book.cloud_id}.${extension}`;
  const { error } = await supabase.storage.from(CLOUD_BUCKET).upload(path, blob, {
    cacheControl: "3600",
    contentType: blob.type || "image/jpeg",
    upsert: true,
  });
  if (error) throw error;
  return path;
}

async function downloadCover(supabase, path, currentCoverId = "") {
  if (!path) return currentCoverId;
  const { data, error } = await supabase.storage.from(CLOUD_BUCKET).download(path);
  if (error) throw error;
  return saveCover(data, currentCoverId);
}

async function upsertRemoteBook(supabase, user, book, existingCoverPath = "", attempt = 0) {
  const cloudId = book.cloud_id || crypto.randomUUID();
  const local = book.cloud_id && book.cloud_user_id === user.id
    ? book
    : await saveBook({ ...book, cloud_id: cloudId, cloud_user_id: user.id }, { preserveUpdatedAt: true });
  let coverPath = existingCoverPath || local.cloud_cover_path || "";
  if (local.cover_id) {
    const uploadedPath = await uploadCover(supabase, user.id, local);
    if (coverPath && uploadedPath && coverPath !== uploadedPath) {
      await supabase.storage.from(CLOUD_BUCKET).remove([coverPath]).catch(() => {});
    }
    coverPath = uploadedPath;
  } else if (local.cloud_cover_deleted && coverPath) {
    await supabase.storage.from(CLOUD_BUCKET).remove([coverPath]).catch(() => {});
    coverPath = "";
  }
  const row = {
    id: cloudId,
    user_id: user.id,
    data: bookForCloud({ ...local, cloud_id: cloudId, cloud_user_id: user.id }),
    internal_code: local.internal_code,
    cover_path: coverPath || null,
    updated_at: local.updated_at,
    deleted_at: null,
  };
  const { error } = await supabase.from(CLOUD_TABLE).upsert(row, { onConflict: "user_id,id" });
  if (error) {
    const codeConflict = error.code === "23505" || /internal_code|unique/i.test(String(error.message || ""));
    if (!codeConflict || attempt >= 5) throw error;
    const { data: remoteCodes, error: codesError } = await supabase
      .from(CLOUD_TABLE)
      .select("internal_code")
      .is("deleted_at", null);
    if (codesError) throw codesError;
    const localBooks = await getAllBooks();
    const used = [...localBooks.map((item) => item.internal_code), ...(remoteCodes || []).map((item) => item.internal_code)];
    const replacement = nextInternalCode(used.map((internal_code) => ({ internal_code })));
    const renamed = await saveBook({ ...local, internal_code: replacement });
    return upsertRemoteBook(supabase, user, renamed, coverPath, attempt + 1);
  }
  const synced = {
    ...local,
    cloud_id: cloudId,
    cloud_user_id: user.id,
    cloud_cover_path: coverPath,
    cloud_cover_deleted: false,
    cloud_synced_at: new Date().toISOString(),
  };
  return saveBook(synced, { preserveUpdatedAt: true });
}

async function pushTombstones(supabase, user, trash) {
  const rows = trash
    .filter((item) => item?.book?.cloud_id && (!item.book.cloud_user_id || item.book.cloud_user_id === user.id))
    .map((item) => ({
      id: item.book.cloud_id,
      user_id: user.id,
      data: bookForCloud(item.book),
      internal_code: item.book.internal_code,
      cover_path: null,
      updated_at: item.deleted_at,
      deleted_at: item.deleted_at,
    }));
  if (!rows.length) return 0;
  const coverPaths = trash
    .filter((item) => item?.book?.cloud_user_id === user.id && item.book.cloud_cover_path)
    .map((item) => item.book.cloud_cover_path);
  if (coverPaths.length) {
    await supabase.storage.from(CLOUD_BUCKET).remove(coverPaths).catch(() => {});
  }
  const { error } = await supabase.from(CLOUD_TABLE).upsert(rows, { onConflict: "user_id,id" });
  if (error) throw error;
  return rows.length;
}

async function pullRemoteBook(supabase, row, existingBooks) {
  let incoming = bookFromCloud(row);
  const existing = existingBooks.find((book) => book.cloud_id === row.id);
  incoming.cloud_cover_path = row.cover_path || "";
  incoming.cloud_cover_deleted = false;
  if (row.cover_path) {
    try {
      incoming.cover_id = await downloadCover(supabase, row.cover_path, existing?.cover_id || "");
      incoming.cover_url = "";
    } catch (error) {
      console.warn("Copertina cloud non scaricata:", error);
      incoming.cover_id = existing?.cover_id || "";
    }
  } else {
    incoming.cover_id = existing?.cover_id || "";
  }
  if (existing) incoming.id = existing.id;
  try {
    return await saveBook(incoming, { preserveUpdatedAt: true });
  } catch (error) {
    if (!/codice inventario/i.test(String(error.message))) throw error;
    const current = await getAllBooks();
    incoming.internal_code = nextInternalCode(current);
    const saved = await saveBook(incoming, { preserveUpdatedAt: true });
    return { ...saved, requiresRemoteCorrection: true };
  }
}

function findMatchingRemote(book, remoteRows, claimedIds) {
  const active = remoteRows.filter((row) => !row.deleted_at && !claimedIds.has(row.id));
  const code = String(book.internal_code || "").trim().toUpperCase();
  if (code) {
    const byCode = active.find((row) => String(row.internal_code || row.data?.internal_code || "").trim().toUpperCase() === code);
    if (byCode) return byCode;
  }
  const isbn = String(book.canonical_isbn || book.isbn13 || "").trim();
  if (!isbn) return null;
  const candidates = active.filter((row) => {
    const data = row.data || {};
    const remoteIsbn = String(data.canonical_isbn || data.isbn13 || "").trim();
    return remoteIsbn === isbn
      && Number(data.copy_number || 1) === Number(book.copy_number || 1)
      && String(data.title || "").trim().toLocaleLowerCase("it") === String(book.title || "").trim().toLocaleLowerCase("it");
  });
  return candidates.length === 1 ? candidates[0] : null;
}

async function replaceRemoteIfRequested(supabase, user) {
  const pending = await getMeta("cloud_replace_pending");
  if (!pending || pending.user_id !== user.id) return false;
  const { error } = await supabase.from(CLOUD_TABLE).delete().eq("user_id", user.id);
  if (error) throw error;
  try {
    const { data: files } = await supabase.storage.from(CLOUD_BUCKET).list(user.id, { limit: 1000 });
    const paths = (files || []).map((file) => `${user.id}/${file.name}`);
    if (paths.length) await supabase.storage.from(CLOUD_BUCKET).remove(paths);
  } catch (error) {
    console.warn("Vecchie copertine cloud non eliminate:", error);
  }
  await setMeta("cloud_replace_pending", false);
  return true;
}

export async function syncLibrary({ onProgress = () => {} } = {}) {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    if (!navigator.onLine) throw new Error("Sei offline. Le modifiche restano sul dispositivo e saranno sincronizzate più tardi.");
    const supabase = getCloudClient();
    if (!supabase) throw new Error("Sincronizzazione cloud non configurata.");
    const session = await getCloudSession();
    const user = session?.user;
    if (!user) throw new Error("Accedi prima di sincronizzare.");

    const replacedRemote = await replaceRemoteIfRequested(supabase, user);
    if (replacedRemote) onProgress("Archivio cloud precedente rimosso…", 0.04);
    onProgress("Preparo i dati locali…", 0.08);
    let localBooks = await getAllBooks();
    const trash = await getTrash();
    await pushTombstones(supabase, user, trash);

    onProgress("Leggo la biblioteca cloud…", 0.18);
    const { data: remoteRows, error } = await supabase
      .from(CLOUD_TABLE)
      .select("id,user_id,data,internal_code,cover_path,updated_at,deleted_at")
      .order("updated_at", { ascending: true });
    if (error) throw error;

    const rows = remoteRows || [];
    const claimedIds = new Set(localBooks.filter((book) => book.cloud_user_id === user.id && book.cloud_id).map((book) => book.cloud_id));
    for (const book of localBooks) {
      if (book.cloud_user_id && book.cloud_user_id !== user.id) continue;
      if (!book.cloud_id || !book.cloud_user_id) {
        const matching = findMatchingRemote(book, rows, claimedIds);
        book.cloud_id = matching?.id || book.cloud_id || crypto.randomUUID();
        book.cloud_user_id = user.id;
        claimedIds.add(book.cloud_id);
        await saveBook(book, { preserveUpdatedAt: true });
      }
    }
    localBooks = (await getAllBooks()).filter((book) => !book.cloud_user_id || book.cloud_user_id === user.id);

    const remoteById = new Map(rows.map((row) => [row.id, row]));
    let pushed = 0;
    let pulled = 0;
    let deleted = 0;

    for (const [index, local] of localBooks.entries()) {
      onProgress(`Sincronizzo ${index + 1} di ${localBooks.length}…`, 0.25 + (0.45 * (index / Math.max(1, localBooks.length))));
      const remote = remoteById.get(local.cloud_id);
      if (!remote) {
        await upsertRemoteBook(supabase, user, local);
        pushed += 1;
        continue;
      }
      if (remote.deleted_at) {
        if (remoteDeletionWins(local, remote)) {
          await moveBookToTrash(local.id);
          deleted += 1;
        } else {
          await upsertRemoteBook(supabase, user, local, remote.cover_path || "");
          pushed += 1;
        }
        continue;
      }
      const winner = compareVersions(local, remote);
      if (winner === "local") {
        await upsertRemoteBook(supabase, user, local, remote.cover_path || "");
        pushed += 1;
      } else if (winner === "remote" || (winner === "equal" && remote.cover_path && !local.cover_id)) {
        const saved = await pullRemoteBook(supabase, remote, localBooks);
        pulled += 1;
        if (saved.requiresRemoteCorrection) {
          await upsertRemoteBook(supabase, user, saved, remote.cover_path || "");
          pushed += 1;
        }
      } else if (winner === "equal" && local.cover_id && !remote.cover_path) {
        await upsertRemoteBook(supabase, user, local, "");
        pushed += 1;
      }
    }

    const refreshedLocal = await getAllBooks();
    const refreshedByCloudId = new Map(refreshedLocal.filter((book) => book.cloud_id).map((book) => [book.cloud_id, book]));
    const trashedCloudIds = new Set((await getTrash()).map((item) => item?.book?.cloud_id).filter(Boolean));
    const activeRemote = rows.filter((row) => !row.deleted_at);
    for (const [index, remote] of activeRemote.entries()) {
      if (refreshedByCloudId.has(remote.id) || trashedCloudIds.has(remote.id)) continue;
      onProgress(`Scarico nuovi libri ${index + 1} di ${activeRemote.length}…`, 0.72 + (0.2 * (index / Math.max(1, activeRemote.length))));
      const saved = await pullRemoteBook(supabase, remote, refreshedLocal);
      refreshedLocal.push(saved);
      pulled += 1;
      if (saved.requiresRemoteCorrection) {
        await upsertRemoteBook(supabase, user, saved, remote.cover_path || "");
        pushed += 1;
      }
    }

    const completedAt = new Date().toISOString();
    await setMeta("last_cloud_sync", { completed_at: completedAt, user_id: user.id, pushed, pulled, deleted });
    onProgress("Sincronizzazione completata.", 1);
    return { completedAt, pushed, pulled, deleted, total: (await getAllBooks()).length };
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

export function startRealtime(userId, onChange) {
  const supabase = getCloudClient();
  if (!supabase || !userId) return;
  stopRealtime();
  realtimeChannel = supabase
    .channel(`library:${userId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: CLOUD_TABLE,
      filter: `user_id=eq.${userId}`,
    }, () => onChange())
    .subscribe();
}

export function stopRealtime() {
  if (!realtimeChannel || !client) return;
  client.removeChannel(realtimeChannel).catch(() => {});
  realtimeChannel = null;
}
