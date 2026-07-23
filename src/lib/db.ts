import type { ExportSettings } from "../export/types";
import type { Clip, MediaKind, Track, Transition, WaveformPeaks } from "../types";

const DB_NAME = "video-editor";
const DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const MEDIA_STORE = "media";
const LAST_PROJECT_KEY = "ve.lastProjectId";

export interface ProjectDoc {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  aspectRatioId: string;
  tracks: Track[];
  clips: Clip[];
  transitions: Transition[];
  exportSettings: ExportSettings;
  playhead: number;
}

export interface MediaDoc {
  id: string;
  projectId: string;
  kind: MediaKind;
  name: string;
  mimeType: string;
  duration: number;
  thumbnail: string;
  filmstrip: string[];
  waveform: WaveformPeaks;
  width: number;
  height: number;
  blob: Blob;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const media = db.createObjectStore(MEDIA_STORE, { keyPath: "id" });
        media.createIndex("projectId", "projectId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function putProject(doc: ProjectDoc): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(PROJECTS_STORE, "readwrite");
  tx.objectStore(PROJECTS_STORE).put(doc);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getProject(id: string): Promise<ProjectDoc | undefined> {
  const db = await openDB();
  const tx = db.transaction(PROJECTS_STORE, "readonly");
  return reqToPromise(tx.objectStore(PROJECTS_STORE).get(id));
}

export async function listProjects(): Promise<ProjectDoc[]> {
  const db = await openDB();
  const tx = db.transaction(PROJECTS_STORE, "readonly");
  const all = await reqToPromise(tx.objectStore(PROJECTS_STORE).getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDB();
  const mediaTx = db.transaction(MEDIA_STORE, "readwrite");
  const index = mediaTx.objectStore(MEDIA_STORE).index("projectId");
  const keys = await reqToPromise(index.getAllKeys(id));
  for (const key of keys) mediaTx.objectStore(MEDIA_STORE).delete(key);
  await new Promise<void>((resolve, reject) => {
    mediaTx.oncomplete = () => resolve();
    mediaTx.onerror = () => reject(mediaTx.error);
  });

  const projectTx = db.transaction(PROJECTS_STORE, "readwrite");
  projectTx.objectStore(PROJECTS_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    projectTx.oncomplete = () => resolve();
    projectTx.onerror = () => reject(projectTx.error);
  });
}

export async function putMedia(doc: MediaDoc): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(MEDIA_STORE, "readwrite");
  tx.objectStore(MEDIA_STORE).put(doc);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getMediaForProject(projectId: string): Promise<MediaDoc[]> {
  const db = await openDB();
  const tx = db.transaction(MEDIA_STORE, "readonly");
  return reqToPromise(tx.objectStore(MEDIA_STORE).index("projectId").getAll(projectId));
}

export async function deleteMedia(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(MEDIA_STORE, "readwrite");
  tx.objectStore(MEDIA_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * IndexedDB structured-clones a File as either a File or a plain Blob depending on the
 * implementation — always rebuild a real File so callers (ffmpeg's fetchFile) get a consistent
 * contract regardless of browser.
 */
export function toFile(doc: MediaDoc): File {
  return new File([doc.blob], doc.name, { type: doc.mimeType });
}

export function getLastOpenedProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_KEY);
}

export function setLastOpenedProjectId(id: string | null): void {
  if (id) localStorage.setItem(LAST_PROJECT_KEY, id);
  else localStorage.removeItem(LAST_PROJECT_KEY);
}
