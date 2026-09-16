// 두 기기의 상태를 합친다.
//
// 규칙은 하나다: 같은 항목이면 나중에 손댄 쪽, 다른 항목이면 둘 다 남긴다.
// 지운 항목은 삭제 표시(state.deleted)보다 나중에 손댄 경우에만 살아남는다.
// 그래서 한쪽에서 지운 노트가 다른 기기와 맞출 때 되살아나지 않는다.

import { COLLECTIONS } from './store.js';

const DELETED_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const stamp = (item) => (typeof item.updatedAt === 'number' ? item.updatedAt : 0);

/** 알 수 없는 값에서 삭제 표시만 걸러낸다 */
export function sanitizeDeleted(input, now = Date.now()) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [id, at] of Object.entries(input)) {
    if (typeof id !== 'string' || !id || id.length > 100) continue;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (now - at > DELETED_TTL_MS) continue;
    out[id] = at;
  }
  return out;
}

function mergeCollection(mine, theirs, idOf, deleted) {
  const byId = new Map();
  for (const item of [...(Array.isArray(mine) ? mine : []), ...(Array.isArray(theirs) ? theirs : [])]) {
    if (!item || typeof item !== 'object') continue;
    const id = idOf(item);
    if (id === undefined || id === null) continue;
    const cur = byId.get(id);
    if (!cur || stamp(item) > stamp(cur)) byId.set(id, item);
  }
  // 지운 뒤에 다른 기기에서 고친 항목은 살린다. 지운 시각보다 늦게 손댄 쪽이 이긴다.
  return [...byId.entries()]
    .filter(([id, item]) => !Object.hasOwn(deleted, id) || stamp(item) > deleted[id])
    .map(([, item]) => item);
}

/**
 * 내 상태와 서버에서 받은 상태를 합쳐 새 상태 객체를 만든다.
 * 넘겨받은 두 상태는 고치지 않는다.
 */
export function mergeState(mine, theirs, now = Date.now()) {
  const deleted = sanitizeDeleted(mine && mine.deleted, now);
  for (const [id, at] of Object.entries(sanitizeDeleted(theirs && theirs.deleted, now))) {
    if (!Object.hasOwn(deleted, id) || at > deleted[id]) deleted[id] = at;
  }

  const out = { version: 1, deleted };
  for (const { key, idOf } of COLLECTIONS) {
    out[key] = mergeCollection(mine && mine[key], theirs && theirs[key], idOf, deleted);
  }
  return out;
}
