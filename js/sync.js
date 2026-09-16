// 기기 간 동기화. 폰에서 남긴 기록을 다른 기기에서도 보게 한다.
//
// 서버에는 동기화 코드마다 상태 JSON 하나를 통째로 둔다.
// 동기화 = 받고 → merge.js 로 합치고 → 올린다.
// 앱은 여전히 localStorage 로 먼저 돌아간다. 오프라인이어도 기록은 된다.
//
// 기출 문항(exam.js)은 동기화하지 않는다. 용량이 크고 불변이며,
// 비공개 문제집에서 옮겨 적은 내용이라 서버에 둘 이유가 없다.

import { state, save, resetSnapshot } from './store.js';
import { mergeState } from './merge.js';

const SUPABASE_URL = 'https://kmybublirpnvuzwzagli.supabase.co';
/**
 * publishable 키는 브라우저에 두라고 만든 공개 키다. 이 키로 할 수 있는 건
 * sync_pull / sync_push 호출뿐이고 테이블은 RLS 로 막혀 있다.
 * 남의 기록을 보려면 추측 불가능한 32자 코드가 필요하다.
 */
const PUBLISHABLE_KEY = 'sb_publishable_eKi83kQd6rUKKrYI1iUr5A_xa6SQOHk';
/** 같은 프로젝트를 energy-exam 과 함께 쓴다. 코드가 섞이지 않게 앱 이름을 나눈다 */
const APP = 'lifeloop';

const CODE_KEY = 'lifeloop.sync.code';
const LAST_KEY = 'lifeloop.sync.last';
const CODE_RE = /^[A-Za-z0-9_-]{32}$/;
const TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 4;

export const SYNCED_EVENT = 'lifeloop:synced';
export const STATUS_EVENT = 'lifeloop:sync-status';

export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// ---------- 코드 ----------

/** 24바이트 난수 → base64url 32자 */
export function newSyncCode() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

/** 붙여넣다 딸려온 공백·줄바꿈을 걷어낸다 */
export function normalizeCode(input) {
  const code = String(input ?? '').replace(/\s+/g, '');
  return CODE_RE.test(code) ? code : null;
}

export function getSyncCode() {
  try {
    const code = localStorage.getItem(CODE_KEY);
    return code && CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function setSyncCode(code) {
  if (!CODE_RE.test(code)) throw new SyncError('no-code', '동기화 코드 형식이 아닙니다.');
  localStorage.setItem(CODE_KEY, code);
}

export function clearSyncCode() {
  try {
    localStorage.removeItem(CODE_KEY);
    localStorage.removeItem(LAST_KEY);
  } catch {
    // 못 지워도 다음 동기화에서 다시 시도할 뿐이다
  }
}

export function lastSyncedAt() {
  try {
    const v = Number(localStorage.getItem(LAST_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

// ---------- 상태 ----------

let status = { state: 'idle' };
export const getSyncStatus = () => status;

function setStatus(next) {
  status = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STATUS_EVENT));
}

// ---------- 서버 호출 ----------

async function rpc(fn, body) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, p_app: APP }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SyncError('network', '인터넷에 연결되지 않았거나 서버가 응답하지 않습니다.');
  }

  // 내가 받은 뒤에 다른 기기가 먼저 올렸다는 뜻
  if (res.status === 409) throw new SyncError('conflict', '다른 기기가 먼저 올렸습니다.');
  if (!res.ok) {
    let message = `동기화 서버 오류 (${res.status})`;
    try {
      const err = await res.json();
      if (err && typeof err.message === 'string') message += `: ${err.message}`;
    } catch {
      // 본문이 JSON이 아니면 상태 코드만 알린다
    }
    throw new SyncError('server', message);
  }
  return res.json();
}

// ---------- 동기화 ----------

/** 서버로 보내는 몫. 기출 문항은 별도 키라 여기 들어오지 않는다 */
const payload = () => ({
  version: 1,
  goals: state.goals,
  routines: state.routines,
  sessions: state.sessions,
  notes: state.notes,
  weekly: state.weekly,
  deleted: state.deleted,
});

/** 합친 결과를 지금 상태에 그대로 심는다. state 객체는 다른 모듈이 붙들고 있으므로 갈아끼우지 않는다 */
function applyMerged(merged) {
  state.goals = merged.goals;
  state.routines = merged.routines;
  state.sessions = merged.sessions;
  state.notes = merged.notes;
  state.weekly = merged.weekly;
  state.deleted = merged.deleted;
  // 합친 결과가 "바뀐 것"으로 다시 찍히면 서로 최신이라고 우기게 된다
  resetSnapshot();
  // silent: 이 저장이 다시 동기화를 부르면 끝없이 돈다
  return save(true);
}

let inflight = null;

/** 이미 돌고 있으면 새로 시작하지 않고 그 결과를 같이 기다린다 */
export function syncNow() {
  if (!inflight) {
    inflight = runSync().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function runSync() {
  const code = getSyncCode();
  if (!code) throw new SyncError('no-code', '동기화 코드가 없습니다.');

  setStatus({ state: 'syncing' });
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const rows = await rpc('sync_pull', { p_code: code });
      const remote = rows[0];
      const theirs = remote && remote.data && typeof remote.data === 'object' ? remote.data : null;

      // 매번 지금 상태로 다시 합친다. 충돌로 도는 사이에 사용자가 기록했을 수 있다.
      const merged = mergeState(payload(), theirs);

      try {
        await rpc('sync_push', {
          p_code: code,
          p_data: merged,
          p_expected: remote ? remote.version : 0,
        });
      } catch (err) {
        if (err instanceof SyncError && err.kind === 'conflict') continue;
        throw err;
      }

      // 올리는 동안 새로 남긴 기록까지 잃지 않게 한 번 더 합쳐서 심는다
      const saveError = applyMerged(mergeState(payload(), merged));
      if (saveError) {
        throw new SyncError('storage', '받은 기록을 이 기기에 저장하지 못했습니다. 저장 공간을 확인하세요.');
      }

      const now = Date.now();
      try {
        localStorage.setItem(LAST_KEY, String(now));
      } catch {
        // 마지막 동기화 시각은 표시용이다
      }
      setStatus({ state: 'ok', at: now });
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNCED_EVENT));
      return;
    }
    throw new SyncError('conflict', '여러 기기가 동시에 올리고 있습니다. 잠시 뒤 다시 시도하세요.');
  } catch (err) {
    setStatus({ state: 'error', message: err instanceof Error ? err.message : '알 수 없는 오류' });
    throw err;
  }
}

// ---------- 자동 동기화 ----------

let timer = null;

/** 기록한 뒤 부른다. 연달아 불려도 한 번으로 묶는다. 실패해도 던지지 않는다 */
export function scheduleSync(delayMs = 1500) {
  if (!getSyncCode()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncNow().catch(() => {});
  }, delayMs);
}
