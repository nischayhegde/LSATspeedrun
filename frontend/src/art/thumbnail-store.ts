/**
 * Catalog thumbnails, kept between sessions.
 *
 * A card is a scene built from scratch, drawn with a shadow map and encoded, and
 * measured over the whole catalog that is 150 ms of main thread each with the
 * capture size corrected and 200 ms without. The Firm catalog shows fourteen at
 * a time and the whole catalog is 107 assets, so a player who opens that tab in
 * two sessions pays for the same 107 pictures twice — and they cannot differ
 * between sessions, because a thumbnail is a pure function of the asset's type,
 * key and tier and of the resolution it was captured at, all of which are in the
 * key.
 *
 * IndexedDB rather than `localStorage`: these are blobs, and the whole catalog
 * at the 384 rung is about 3 MB, which would be most of a 5 MB string quota and
 * would have to be base64'd to get in there at all.
 *
 * Everything here fails soft. A blocked store, a private window, a quota
 * refusal, or a browser with no IndexedDB at all must cost nothing more than the
 * render the page was going to do anyway, so every path resolves rather than
 * rejects and the caller cannot tell a miss from a broken store.
 */

const DB_NAME = 'lsat-art'
const DB_VERSION = 1
const STORE = 'catalog-thumbs'
/**
 * How many cards to keep. The catalog is 107 assets and a session renders them
 * at one rung, so this holds a whole catalog with room for a player who changes
 * display or zoom, and evicts the oldest beyond that.
 */
const KEEP = 160

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    // A store that never answers must not hold a card hostage: Safari in a
    // private window leaves the request pending rather than failing it.
    setTimeout(() => resolve(null), 1500)
  })
  return opening
}

function transaction(db: IDBDatabase, mode: IDBTransactionMode) {
  try {
    return db.transaction(STORE, mode).objectStore(STORE)
  } catch {
    return null
  }
}

/** A stored card as an object URL, or null if this one has not been drawn. */
export async function readThumbnail(key: string): Promise<string | null> {
  const db = await open()
  if (!db) return null
  const store = transaction(db, 'readonly')
  if (!store) return null
  return new Promise((resolve) => {
    let request: IDBRequest<Blob | undefined>
    try {
      request = store.get(key)
    } catch {
      resolve(null)
      return
    }
    request.onsuccess = () => {
      const found = request.result
      if (found instanceof Blob) {
        resolve(URL.createObjectURL(found))
        return
      }
      resolve(null)
    }
    request.onerror = () => resolve(null)
  })
}

/**
 * Keeps a drawn card, and trims the store back to `KEEP` while it is open.
 *
 * The trim is here rather than on read because a read is on the path to showing
 * a card and a write is not: this runs after the image is already on screen.
 */
export async function writeThumbnail(key: string, blob: Blob): Promise<void> {
  const db = await open()
  if (!db) return
  const store = transaction(db, 'readwrite')
  if (!store) return
  try {
    store.put(blob, key)
  } catch {
    return
  }
  const count = store.count()
  count.onsuccess = () => {
    const excess = count.result - KEEP
    if (excess <= 0) return
    // Oldest first, by insertion order of the key cursor, which is as good an
    // order as any here: every entry in the store is equally cheap to redraw.
    let removed = 0
    const cursor = store.openKeyCursor()
    cursor.onsuccess = () => {
      const at = cursor.result
      if (!at || removed >= excess) return
      store.delete(at.key)
      removed += 1
      at.continue()
    }
  }
}
