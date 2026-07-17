import { decodeSample, setCustomKit } from './sound.js';

/**
 * Bring-your-own-switch storage. Imported recordings persist in IndexedDB
 * (audio is far too big for localStorage) and are decoded once per session
 * into the live kit in sound.ts. Everything degrades quietly: no IndexedDB,
 * no WebAudio, or an undecodable file all leave the stock presets working.
 */

const DB_NAME = 'opendeck';
const STORE = 'switch-sounds';
/** Switch recordings are tens of KB; 2 MB catches "wrong file" mistakes. */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;

export type SampleSlot = 'down' | 'up';

interface StoredSound {
  name: string;
  data: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('IndexedDB open failed'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const opening = openDb();
  if (!opening) return undefined;
  const db = await opening;
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

async function readSlot(slot: SampleSlot): Promise<StoredSound | undefined> {
  const value = await withStore<unknown>('readonly', (store) => store.get(slot));
  if (value && typeof value === 'object' && 'name' in value && 'data' in value) {
    return value as StoredSound;
  }
  return undefined;
}

/** Loads and decodes whatever is stored, arming the custom kit. */
export async function primeSwitchSounds(): Promise<string | undefined> {
  const [down, up] = await Promise.all([readSlot('down'), readSlot('up')]);
  if (!down) {
    setCustomKit({});
    return undefined;
  }
  const [downBuffer, upBuffer] = await Promise.all([
    decodeSample(down.data),
    up ? decodeSample(up.data) : Promise.resolve(undefined),
  ]);
  if (!downBuffer) {
    setCustomKit({});
    return undefined;
  }
  setCustomKit({
    down: downBuffer,
    ...(upBuffer ? { up: upBuffer } : {}),
    name: down.name,
  });
  return down.name;
}

/**
 * Imports a user file into a slot. Returns the stored name, or undefined
 * when the file is too large or not decodable audio (nothing is stored).
 */
export async function importSwitchSound(slot: SampleSlot, file: File): Promise<string | undefined> {
  if (file.size > MAX_SOUND_BYTES) return undefined;
  const data = await file.arrayBuffer();
  if (!(await decodeSample(data))) return undefined;
  await withStore('readwrite', (store) => store.put({ name: file.name, data }, slot));
  return primeSwitchSounds().then(() => file.name);
}

/** Removes both samples and disarms the kit. */
export async function clearSwitchSounds(): Promise<void> {
  await withStore('readwrite', (store) => store.delete('down'));
  await withStore('readwrite', (store) => store.delete('up'));
  setCustomKit({});
}
