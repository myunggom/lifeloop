// 상태 · 저장 · 날짜 유틸 · 파생 계산
// 서버 없음. 모든 데이터는 이 기기의 localStorage 안에만 있다.

const KEY = 'lifeloop.v1';

const EMPTY = {
  version: 1,
  goals: [],
  routines: [],
  sessions: [],
  notes: [],
  weekly: [],
  // 지운 항목의 id와 지운 시각. 기기 간 병합은 양쪽을 다 남기는 방식이라
  // 이 기록이 없으면 한쪽에서 지운 노트가 다른 기기와 맞출 때 되살아난다.
  deleted: {},
};

/** 동기화가 합칠 수 있는 묶음. 배열은 id로, weekly는 주차 문자열로 식별한다 */
export const COLLECTIONS = [
  { key: 'goals', idOf: (x) => x.id },
  { key: 'routines', idOf: (x) => x.id },
  { key: 'sessions', idOf: (x) => x.id },
  { key: 'notes', idOf: (x) => x.id },
  { key: 'weekly', idOf: (x) => x.week },
];

/** 삭제 표시를 영원히 들고 있을 필요는 없다 */
const DELETED_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));

// ---------- 날짜 (모두 로컬 기준 YYYY-MM-DD) ----------

export function ymd(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export const today = () => ymd();
export function addDays(str, n) {
  const d = new Date(str + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
export const dow = (str) => new Date(str + 'T00:00:00').getDay();

// 주는 월요일 시작
export function weekStart(str = today()) {
  const d = new Date(str + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}

export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

// ---------- 저장 ----------

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(EMPTY), parsed);
  } catch (err) {
    // 저장소가 깨졌거나 접근 불가(사생활 보호 모드 등). 빈 상태로 시작하되 조용히 넘어가지 않는다.
    console.error('저장된 데이터를 읽지 못했습니다:', err);
    return structuredClone(EMPTY);
  }
}

export const state = load();

/** 불러온 직후의 모습을 기준으로 삼는다. 이걸 안 하면 첫 저장에 전부 바뀐 것으로 찍힌다 */
export function resetSnapshot() {
  snapshot = new Map();
  for (const { key, idOf } of COLLECTIONS) {
    for (const item of state[key]) {
      const id = idOf(item);
      if (id !== undefined) snapshot.set(key + ':' + id, fingerprint(item));
    }
  }
}

let saveError = null;
export const lastSaveError = () => saveError;

/**
 * 바뀐 항목에만 updatedAt을 찍고, 사라진 항목은 삭제 표시를 남긴다.
 *
 * 화면 곳곳에서 객체를 직접 고치므로(Object.assign, push, splice) 호출부마다
 * 시각을 찍게 하면 빠뜨리기 쉽다. 저장 직전에 지난 저장 때의 모습과 비교하면
 * 한 곳에서 끝난다. 이 시각이 있어야 기기 간 병합에서 어느 쪽이 최신인지 가린다.
 */
let snapshot = new Map();

// updatedAt은 빼고, 키 순서에 흔들리지 않게 직렬화한다
const fingerprint = (obj) =>
  JSON.stringify(
    Object.keys(obj)
      .filter((k) => k !== 'updatedAt')
      .sort()
      .map((k) => [k, obj[k]]),
  );

function stampChanges(now = Date.now()) {
  const seen = new Map();
  for (const { key, idOf } of COLLECTIONS) {
    for (const item of state[key]) {
      const id = idOf(item);
      if (id === undefined) continue;
      const mark = key + ':' + id;
      const print = fingerprint(item);
      seen.set(mark, print);
      if (snapshot.get(mark) !== print) item.updatedAt = now;
    }
  }
  // 지난 저장에는 있었는데 지금 없으면 지워진 것이다
  for (const mark of snapshot.keys()) {
    if (!seen.has(mark)) state.deleted[mark.slice(mark.indexOf(':') + 1)] = now;
  }
  for (const [id, at] of Object.entries(state.deleted)) {
    if (typeof at !== 'number' || now - at > DELETED_TTL_MS) delete state.deleted[id];
  }
  snapshot = seen;
}

// 선언이 모두 끝난 뒤에 기준을 잡는다
resetSnapshot();

/**
 * 저장이 끝나면 부를 함수. app.js 가 동기화를 건다.
 * store 가 sync 를 직접 import 하면 순환이 되므로 갈고리만 둔다.
 */
let onSaved = null;
export const setOnSaved = (fn) => {
  onSaved = fn;
};

/**
 * @param {boolean} [silent] 저장 후 알림을 보내지 않는다.
 *   동기화가 받아온 결과를 심을 때 쓴다. 이게 없으면
 *   저장 → 동기화 → 저장 → 동기화 로 끝없이 돈다.
 */
export function save(silent = false) {
  stampChanges();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveError = null;
  } catch (err) {
    // 용량 초과나 저장소 차단. 사용자가 알아야 하므로 남긴다.
    saveError = err;
    console.error('저장 실패:', err);
  }
  if (!saveError && !silent && onSaved) onSaved();
  return saveError;
}

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

// 가져오기는 신뢰 경계다. 모양을 확인하고 통째로 교체한다.
export function importJSON(text) {
  const incoming = JSON.parse(text);
  if (!incoming || typeof incoming !== 'object') throw new Error('JSON 형식이 아닙니다.');
  for (const key of ['goals', 'routines', 'sessions', 'notes', 'weekly']) {
    if (incoming[key] !== undefined && !Array.isArray(incoming[key])) {
      throw new Error(`"${key}" 항목이 배열이 아닙니다.`);
    }
  }
  if (incoming.deleted !== undefined && (typeof incoming.deleted !== 'object' || incoming.deleted === null)) {
    throw new Error('"deleted" 항목의 형식이 올바르지 않습니다.');
  }
  Object.assign(state, structuredClone(EMPTY), incoming);
  resetSnapshot();
  save();
}

// ---------- 조회 ----------

export const activeGoals = () => state.goals.filter((g) => !g.archived);
export const activeRoutines = () => state.routines.filter((r) => !r.archived);
export const routineById = (id) => state.routines.find((r) => r.id === id);
export const goalById = (id) => state.goals.find((g) => g.id === id);
export const noteById = (id) => state.notes.find((n) => n.id === id);

export const routinesForDay = (date = today()) =>
  activeRoutines().filter((r) => r.days.includes(dow(date)));

export const sessionsOn = (date) => state.sessions.filter((s) => s.date === date);

export const isDone = (routineId, date = today()) =>
  state.sessions.some((s) => s.routineId === routineId && s.date === date);

// ---------- 연속 기록 / 결석 ----------

// 루틴이 생기기 전은 결석이 아니다.
// 이 경계가 없으면 오늘 만든 루틴이 "42번 연속 건너뛰었습니다"로 사용자를 혼낸다.
export function routineStart(routine) {
  if (routine.createdAt) return routine.createdAt;
  const dates = state.sessions.filter((s) => s.routineId === routine.id).map((s) => s.date);
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today();
}

// 오늘을 제외하고, 예정된 날 중 연속으로 빠진 횟수.
// "never miss twice": 이 값이 2 이상일 때만 경고한다.
export function missStreak(routine, from = today()) {
  const start = routineStart(routine);
  let miss = 0;
  for (let i = 1; i <= 60; i++) {
    const d = addDays(from, -i);
    if (d < start) break;
    if (!routine.days.includes(dow(d))) continue;
    if (isDone(routine.id, d)) break;
    miss++;
  }
  return miss;
}

// 오늘 포함, 예정된 날 중 연속으로 해낸 횟수.
export function doneStreak(routine, from = today()) {
  const start = routineStart(routine);
  let streak = 0;
  for (let i = 0; i <= 365; i++) {
    const d = addDays(from, -i);
    if (d < start) break;
    if (!routine.days.includes(dow(d))) continue;
    if (!isDone(routine.id, d)) {
      if (i === 0) continue; // 오늘은 아직 안 한 것일 뿐, 끊긴 게 아니다
      break;
    }
    streak++;
  }
  return streak;
}

// ---------- 선행지표 진척 ----------

export function leadProgress(goal, lead, wkStart = weekStart()) {
  const end = addDays(wkStart, 7);
  const inWeek = (d) => d >= wkStart && d < end;
  const ids = activeRoutines().filter((r) => r.leadId === lead.id).map((r) => r.id);
  const weekSessions = state.sessions.filter((s) => ids.includes(s.routineId) && inWeek(s.date));

  if (lead.unit === 'minute') return weekSessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
  if (lead.unit === 'note') return state.notes.filter((n) => n.goalId === goal.id && inWeek(n.date)).length;
  return weekSessions.length;
}

export const UNIT_LABEL = { session: '회', minute: '분', note: '개' };

// ---------- 파인만 노트 ----------

export const STUDY_TAGS = ['study', 'read'];
export const isStudyTag = (tag) => STUDY_TAGS.includes(tag);

// 하루 최대 1개. 상한은 제약이 아니라 기능이다.
export const NOTE_DAILY_CAP = 1;
export const notesOn = (date) => state.notes.filter((n) => n.date === date);
export const canWriteNoteToday = () => notesOn(today()).length < NOTE_DAILY_CAP;

export const openGaps = () =>
  state.notes.flatMap((n) => n.gaps.filter((g) => !g.resolved).map((g) => ({ note: n, gap: g })));

export const dueNotes = (date = today()) =>
  state.notes.filter((n) => n.nextReviewAt && n.nextReviewAt <= date);

// 간격 반복. 자기 평가에 따른 고정 배열.
// ponytail: 고정 배열은 하루 1개 생성 속도에서 SM-2와 사실상 차이가 없다.
// 노트 300개를 넘고 복습이 밀리기 시작하면 SM-2로 교체한다. 스키마 변경은 필요 없다.
const LADDER = [7, 16, 35, 75];

export function nextInterval(confidence, reviewCount = 0) {
  if (confidence === 1) return 1;
  if (confidence === 2) return 3;
  return LADDER[Math.min(reviewCount, LADDER.length - 1)];
}

export function scheduleReview(note, confidence, from = today()) {
  note.confidence = confidence;
  note.nextReviewAt = addDays(from, nextInterval(confidence, note.reviews.length));
  return note.nextReviewAt;
}

export function makeNote(fields = {}) {
  return {
    id: uid(),
    goalId: null,
    routineId: null,
    sessionId: null,
    date: today(),
    source: { kind: 'study', title: '', locator: '' },
    concept: '',
    explanation: '',
    analogy: '',
    gaps: [],
    confidence: 2,
    reviews: [],
    nextReviewAt: null,
    ...fields,
  };
}

export const CONFIDENCE = {
  1: { emoji: '🤔', label: '막막함' },
  2: { emoji: '😐', label: '어설픔' },
  3: { emoji: '😎', label: '설명됨' },
};
