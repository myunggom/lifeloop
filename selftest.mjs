// 자체 점검: node selftest.mjs
// 브라우저 저장소만 얇게 흉내 내고 순수 로직을 그대로 돌린다.
// 프레임워크 없음. 깨지면 0이 아닌 코드로 죽는다.

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.crypto ??= {};
let seq = 0;
globalThis.crypto.randomUUID = () => 'id-' + ++seq;

const store = await import('./js/store.js');
const examMod = await import('./js/exam.js');
const share = await import('./js/share.js');

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
};

// ---------- 날짜 ----------

check('addDays 는 월을 넘어간다', () => {
  assert.equal(store.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(store.addDays('2026-03-01', -1), '2026-02-28');
});

check('addDays 는 윤년을 안다', () => {
  assert.equal(store.addDays('2028-02-28', 1), '2028-02-29');
});

check('daysBetween 은 부호가 있다', () => {
  assert.equal(store.daysBetween('2026-09-15', '2026-09-20'), 5);
  assert.equal(store.daysBetween('2026-09-20', '2026-09-15'), -5);
});

check('weekStart 는 월요일로 맞춘다', () => {
  assert.equal(store.weekStart('2026-09-15'), '2026-09-14'); // 화요일 -> 월요일
  assert.equal(store.weekStart('2026-09-14'), '2026-09-14'); // 월요일은 그대로
  assert.equal(store.weekStart('2026-09-20'), '2026-09-14'); // 일요일은 그 주 월요일
});

// ---------- 간격 반복 ----------

check('자신감이 낮으면 내일 다시 묻는다', () => {
  assert.equal(store.nextInterval(1, 0), 1);
  assert.equal(store.nextInterval(1, 9), 1);
});

check('설명된 노트는 복습할수록 간격이 벌어진다', () => {
  assert.equal(store.nextInterval(3, 0), 7);
  assert.equal(store.nextInterval(3, 1), 16);
  assert.equal(store.nextInterval(3, 2), 35);
  assert.equal(store.nextInterval(3, 3), 75);
  assert.equal(store.nextInterval(3, 99), 75, '사다리 끝에서 멈춰야 한다');
});

check('scheduleReview 는 다음 복습일을 박는다', () => {
  const note = store.makeNote({ date: '2026-09-15' });
  const next = store.scheduleReview(note, 2, '2026-09-15');
  assert.equal(next, '2026-09-18');
  assert.equal(note.nextReviewAt, '2026-09-18');
  assert.equal(note.confidence, 2);
});

// ---------- 연속 기록 ----------
// 2026-09-14 가 월요일이다 (위 weekStart 검사로 확인됨).
// r1 은 월~금 루틴. 토·일은 예정일이 아니므로 계산에서 빠져야 한다.

const r1 = {
  id: 'r1', goalId: 'g1', leadId: 'l1',
  cue: '저녁 먹고 나면', action: '기출 20문항', minimum: '5문항',
  tag: 'study', days: [1, 2, 3, 4, 5], archived: false,
};
const r2 = { ...r1, id: 'r2', leadId: 'l2', action: '개념 정리' };
store.state.routines.push(r1, r2);

const addSession = (routineId, date, minutes = 0) =>
  store.state.sessions.push({ id: routineId + date, routineId, date, minutes, level: 'full', noteId: null });

addSession('r1', '2026-09-11', 30); // 금
addSession('r1', '2026-09-14', 25); // 월

check('바로 앞 예정일을 했으면 결석은 0', () => {
  assert.equal(store.missStreak(r1, '2026-09-15'), 0);
});

check('missStreak 는 주말을 건너뛰고 예정일만 센다', () => {
  // 09-17(목) 기준 뒤로: 09-16(수) 빔, 09-15(화) 빔, 09-14(월) 했음 -> 2
  assert.equal(store.missStreak(r1, '2026-09-17'), 2);
  // 09-18(금) 기준: 09-17, 09-16, 09-15 세 번 빔 -> 3
  assert.equal(store.missStreak(r1, '2026-09-18'), 3);
});

check('오늘 아직 안 한 것은 연속 기록을 끊지 않는다', () => {
  // 09-15(화)는 아직 안 했지만, 09-14(월)과 09-11(금)이 이어져 2.
  // 그 사이 토·일은 예정일이 아니므로 끊긴 것으로 보지 않는다.
  assert.equal(store.doneStreak(r1, '2026-09-15'), 2);
});

check('오늘을 마치면 연속 기록이 하나 는다', () => {
  addSession('r1', '2026-09-15', 40);
  assert.equal(store.doneStreak(r1, '2026-09-15'), 3);
});

// ---------- 선행지표 ----------

const goal = {
  id: 'g1', title: '실기 합격', deadline: '2026-03-01', archived: false,
  leads: [
    { id: 'l1', title: '주 5회 기출 세션', unit: 'session', target: 5 },
    { id: 'l2', title: '주 120분', unit: 'minute', target: 120 },
    { id: 'l3', title: '주 3개 정리', unit: 'note', target: 3 },
    { id: 'l4', title: '루틴을 안 붙인 지표', unit: 'session', target: 5 },
  ],
};
store.state.goals.push(goal);

check('세션 단위는 이번 주 것만 센다', () => {
  // 주 시작 09-14. 지난주인 09-11 은 빠지고 09-14, 09-15 만 잡힌다.
  assert.equal(store.leadProgress(goal, goal.leads[0], '2026-09-14'), 2);
});

check('분 단위는 시간을 합산한다', () => {
  addSession('r2', '2026-09-14', 25);
  addSession('r2', '2026-09-15', 40);
  assert.equal(store.leadProgress(goal, goal.leads[1], '2026-09-14'), 65);
});

check('노트 단위는 그 목표의 이번 주 노트를 센다', () => {
  store.state.notes.push(store.makeNote({ goalId: 'g1', date: '2026-09-15', concept: '엔트로피' }));
  store.state.notes.push(store.makeNote({ goalId: 'g1', date: '2026-09-09', concept: '지난주 것' }));
  assert.equal(store.leadProgress(goal, goal.leads[2], '2026-09-14'), 1);
});

check('루틴을 붙이지 않은 선행지표는 0 이다', () => {
  // 화면에서 "+ 루틴" 안내가 나가야 하는 상태. 조용히 채워지면 안 된다.
  assert.equal(store.leadProgress(goal, goal.leads[3], '2026-09-14'), 0);
});

// ---------- 기출 문항 가져오기 ----------
// 가져오기는 신뢰 경계다. 모양이 틀린 파일은 조용히 절반만 먹으면 안 된다.

const round2023 = JSON.stringify({
  year: 2023, round: 1, examDate: '2023-04-23',
  source: '기출문제집', pages: '712-720',
  questions: [
    { id: '2023-1-01', no: 1, type: '계산', topic: '전열·열전달', question: '절탄기 출구 급수온도를 구하시오.', given: ['공기비 1.2'], answer: ['58.01[℃]'], solution: '풀이' },
    { id: '2023-1-02', no: 2, type: '서술', topic: '연소', question: '공기비가 클 때의 손실을 쓰시오.', answer: ['배기손실 증가'] },
  ],
});

check('정상 회차 파일은 문항을 채운다', () => {
  const res = examMod.importRounds([{ name: '2023-1.json', text: round2023 }]);
  assert.equal(res.added, 2);
  assert.equal(res.rounds, 1);
  assert.equal(examMod.exam.questions.length, 2);
  assert.equal(examMod.questionById('2023-1-01').topic, '전열·열전달');
});

check('같은 파일을 다시 가져와도 문항이 늘지 않는다', () => {
  const res = examMod.importRounds([{ name: '2023-1.json', text: round2023 }]);
  assert.equal(res.added, 0);
  assert.equal(res.updated, 2);
  assert.equal(examMod.exam.questions.length, 2);
});

check('year 가 없는 파일은 거부한다', () => {
  assert.throws(
    () => examMod.importRounds([{ name: '깨진.json', text: '{"questions":[]}' }]),
    /year/
  );
});

check('id 없는 문항이 있으면 거부한다', () => {
  assert.throws(
    () => examMod.importRounds([{ name: 'bad.json', text: '{"year":2020,"round":1,"questions":[{"question":"x"}]}' }]),
    /id/
  );
});

check('문항은 노트 출처로만 들어간다 (문제 전문은 복사하지 않는다)', () => {
  const src = examMod.questionAsSource(examMod.questionById('2023-1-01'));
  assert.equal(src.kind, 'exam');
  assert.equal(src.title, '2023년 1회 1번');
  assert.equal(src.examId, '2023-1-01');
  assert.ok(!JSON.stringify(src).includes('절탄기'), '출처에 문제 지문이 섞이면 안 된다');
});

// ---------- 공유 ----------

const shared = store.makeNote({
  date: '2026-09-15',
  concept: '공기비가 크면 왜 손해인가',
  explanation: '공기를 너무 많이 넣으면 그 공기까지 데워서 굴뚝으로 버리는 셈이다.',
  analogy: '난로 옆 창문을 열어두는 것',
  source: examMod.questionAsSource(examMod.questionById('2023-1-02')),
  gaps: [
    { id: 'g1', text: '최적 공기비 계산', resolved: false },
    { id: 'g2', text: '단위 환산', resolved: true },
  ],
  confidence: 2,
});

check('공유 기본값은 내 설명만 내보낸다', () => {
  const md = share.noteToMarkdown(shared);
  assert.ok(md.includes('공기비가 크면 왜 손해인가'));
  assert.ok(md.includes('2023년 1회 2번'));
  assert.ok(md.includes('굴뚝으로 버리는 셈'));
  assert.ok(!md.includes('공기비가 클 때의 손실을 쓰시오'), '문제 전문이 기본으로 나가면 안 된다');
});

check('명시적으로 요청할 때만 문제 전문을 붙인다', () => {
  const md = share.noteToMarkdown(shared, { includeQuestion: true });
  assert.ok(md.includes('공기비가 클 때의 손실을 쓰시오'));
});

check('막힌 곳은 체크박스로 나간다', () => {
  const md = share.noteToMarkdown(shared);
  assert.ok(md.includes('- [ ] 최적 공기비 계산'));
  assert.ok(md.includes('- [x] 단위 환산'));
});

check('여러 개를 한 번에 공유하면 구분선으로 나뉜다', () => {
  const md = share.notesToMarkdown([shared, shared]);
  assert.ok(md.startsWith('# 정리 노트 2개'));
  assert.equal(md.split('\n---\n').length, 2);
});


// ---------- 루틴 생성 이전은 결석이 아니다 ----------
// 실제로 났던 버그: 오늘 만든 루틴이 "42번 연속 건너뛰었습니다"로 사용자를 혼냈다.

check('오늘 만든 루틴의 결석은 0 이다', () => {
  const fresh = {
    id: 'r9', goalId: 'g1', leadId: 'l1',
    cue: '아침에 일어나면', action: '스트레칭', minimum: '1분',
    tag: 'other', days: [0, 1, 2, 3, 4, 5, 6],
    createdAt: '2026-09-15', archived: false,
  };
  store.state.routines.push(fresh);
  assert.equal(store.missStreak(fresh, '2026-09-15'), 0);
  // 만든 다음 날이면 만든 날 하루만 후보가 된다.
  assert.equal(store.missStreak(fresh, '2026-09-16'), 1);
  // 60일 뒤라도 만들기 전 날짜는 세지 않는다.
  assert.ok(store.missStreak(fresh, '2026-11-15') <= 61);
});

check('createdAt 이 없는 루틴은 첫 기록일을 시작으로 본다', () => {
  const legacy = {
    id: 'r10', goalId: 'g1', leadId: 'l1',
    cue: '자기 전', action: '일지', minimum: '한 줄',
    tag: 'other', days: [0, 1, 2, 3, 4, 5, 6], archived: false,
  };
  store.state.routines.push(legacy);
  addSession('r10', '2026-09-12');
  assert.equal(store.routineStart(legacy), '2026-09-12');
  // 09-15 기준: 09-14, 09-13 두 번 빠짐. 09-12 는 기록이 있어 거기서 멈춘다.
  assert.equal(store.missStreak(legacy, '2026-09-15'), 2);
});


// ---------- 기기 간 병합 ----------

const merge = await import('./js/merge.js');

const G = (id, title, at) => ({ id, title, deadline: null, archived: false, leads: [], updatedAt: at });
const N = (id, concept, at) => ({ ...store.makeNote({ concept, date: '2026-09-15' }), id, updatedAt: at });

check('양쪽에만 있던 것은 둘 다 남는다', () => {
  const mine = { goals: [G('g1', '내 목표', 100)], routines: [], sessions: [], notes: [], weekly: [], deleted: {} };
  const theirs = { goals: [G('g2', '다른 기기 목표', 200)], routines: [], sessions: [], notes: [], weekly: [], deleted: {} };
  const out = merge.mergeState(mine, theirs);
  assert.deepEqual(out.goals.map((g) => g.id).sort(), ['g1', 'g2']);
});

check('같은 것은 나중에 손댄 쪽이 이긴다', () => {
  const mine = { goals: [G('g1', '옛 제목', 100)], deleted: {} };
  const theirs = { goals: [G('g1', '새 제목', 500)], deleted: {} };
  assert.equal(merge.mergeState(mine, theirs).goals[0].title, '새 제목');
  // 방향이 반대여도 결과는 같다
  assert.equal(merge.mergeState(theirs, mine).goals[0].title, '새 제목');
});

const T = Date.now();

check('한쪽에서 지운 것은 되살아나지 않는다', () => {
  const mine = { notes: [], deleted: { n1: T - 1000 } };
  const theirs = { notes: [N('n1', '지워진 노트', T - 5000)], deleted: {} };
  assert.equal(merge.mergeState(mine, theirs).notes.length, 0);
  assert.equal(merge.mergeState(theirs, mine).notes.length, 0, '방향이 반대여도 같다');
});

check('지운 뒤에 다른 기기에서 고친 것은 살린다', () => {
  const mine = { notes: [], deleted: { n1: T - 5000 } };
  const theirs = { notes: [N('n1', '다시 고친 노트', T - 1000)], deleted: {} };
  assert.equal(merge.mergeState(mine, theirs).notes.length, 1);
});

check('삭제 표시는 양쪽을 합치고 늦은 시각을 남긴다', () => {
  const out = merge.mergeState({ deleted: { a: T - 900, b: T - 300 } }, { deleted: { a: T - 600 } });
  assert.deepEqual(out.deleted, { a: T - 600, b: T - 300 });
});

check('180일이 지난 삭제 표시는 버린다', () => {
  // 표시를 영원히 들고 있지 않는다. 그만큼 오래 안 맞춘 기기는 없다고 본다.
  const old = T - 200 * 24 * 60 * 60 * 1000;
  const out = merge.mergeState({ deleted: { stale: old } }, { deleted: {} });
  assert.deepEqual(out.deleted, {});
});

check('세션은 같은 날 여러 건이어도 id로 구분해 모두 남는다', () => {
  const mine = { sessions: [{ id: 's1', routineId: 'r1', date: '2026-09-15', minutes: 20, updatedAt: 1 }], deleted: {} };
  const theirs = { sessions: [{ id: 's2', routineId: 'r1', date: '2026-09-15', minutes: 30, updatedAt: 2 }], deleted: {} };
  assert.equal(merge.mergeState(mine, theirs).sessions.length, 2);
});

check('주간 회고는 주차로 식별한다', () => {
  const mine = { weekly: [{ week: '2026-09-14', keep: '내 회고', updatedAt: 100 }], deleted: {} };
  const theirs = { weekly: [{ week: '2026-09-14', keep: '다른 기기 회고', updatedAt: 300 }], deleted: {} };
  const out = merge.mergeState(mine, theirs);
  assert.equal(out.weekly.length, 1);
  assert.equal(out.weekly[0].keep, '다른 기기 회고');
});

check('빈 쪽과 합쳐도 잃지 않는다', () => {
  const mine = { goals: [G('g1', '혼자', 100)], deleted: {} };
  assert.equal(merge.mergeState(mine, null).goals.length, 1);
  assert.equal(merge.mergeState(null, mine).goals.length, 1);
});

check('오염된 삭제 표시는 걸러낸다', () => {
  const evil = JSON.parse(`{"__proto__":{"polluted":true},"ok":${T - 100}}`);
  const out = merge.mergeState({ deleted: {} }, { deleted: evil });
  assert.equal({}.polluted, undefined, '프로토타입이 오염되면 안 된다');
  assert.deepEqual(Object.keys(out.deleted), ['ok']);
});

// ---------- 저장할 때 시각이 찍히는가 ----------

check('바뀐 항목에만 시각이 찍히고, 지운 항목은 표시가 남는다', () => {
  const goal = { id: 'g-stamp', title: '처음', deadline: null, archived: false, leads: [] };
  store.state.goals.push(goal);
  store.save();
  const firstStamp = goal.updatedAt;
  assert.ok(firstStamp > 0, '새 항목에 시각이 찍혀야 한다');

  store.save();
  assert.equal(goal.updatedAt, firstStamp, '고치지 않았으면 시각이 그대로여야 한다');

  goal.title = '고침';
  store.save();
  assert.ok(goal.updatedAt >= firstStamp, '고치면 시각이 갱신된다');

  store.state.goals.splice(store.state.goals.indexOf(goal), 1);
  store.save();
  assert.ok(store.state.deleted['g-stamp'] > 0, '지우면 삭제 표시가 남아야 한다');
});


check('동기화가 심은 저장은 다시 동기화를 부르지 않는다', () => {
  // 이게 깨지면 저장 → 동기화 → 저장 → 동기화 로 끝없이 돈다
  let calls = 0;
  store.setOnSaved(() => calls++);
  store.state.goals.push({ id: 'g-loop', title: '되먹임 확인', archived: false, leads: [] });
  store.save();
  assert.equal(calls, 1, '보통 저장은 알린다');
  store.save(true);
  assert.equal(calls, 1, 'silent 저장은 알리지 않는다');
  store.setOnSaved(null);
});


// ---------- 보관한 목표 ----------
// 실제로 났던 버그: 목표를 보관했는데 그 루틴이 오늘 화면에 계속 떴다.

check('목표를 보관하면 그 루틴은 오늘 화면에서 빠진다', () => {
  const goal = { id: 'g-arch', title: '접은 목표', deadline: null, archived: false, leads: [{ id: 'l-arch', title: '주 3회', unit: 'session', target: 3 }] };
  const routine = {
    id: 'r-arch', goalId: 'g-arch', leadId: 'l-arch', createdAt: store.today(),
    cue: '아침에', action: '접을 루틴', minimum: '1분', tag: 'other',
    days: [0, 1, 2, 3, 4, 5, 6], archived: false,
  };
  store.state.goals.push(goal);
  store.state.routines.push(routine);

  assert.ok(store.routinesForDay(store.today()).some((r) => r.id === 'r-arch'), '보관 전에는 보인다');

  goal.archived = true;
  assert.ok(!store.routinesForDay(store.today()).some((r) => r.id === 'r-arch'), '보관하면 사라져야 한다');
  assert.ok(!store.activeRoutines().some((r) => r.id === 'r-arch'));

  // 다른 목표의 루틴까지 휩쓸지 않는다
  const other = { id: 'g-live', title: '살아있는 목표', deadline: null, archived: false, leads: [] };
  const otherRoutine = { ...routine, id: 'r-live', goalId: 'g-live', action: '남을 루틴' };
  store.state.goals.push(other);
  store.state.routines.push(otherRoutine);
  assert.ok(store.routinesForDay(store.today()).some((r) => r.id === 'r-live'));
});


// ---------- 보관함 ----------

check('되돌리면 루틴이 오늘 화면에 다시 나온다', () => {
  const goal = { id: 'g-back', title: '되돌릴 목표', deadline: null, archived: true, leads: [] };
  const routine = {
    id: 'r-back', goalId: 'g-back', leadId: 'l-back', createdAt: store.today(),
    cue: '아침에', action: '돌아올 루틴', minimum: '1분', tag: 'other',
    days: [0, 1, 2, 3, 4, 5, 6], archived: false,
  };
  store.state.goals.push(goal);
  store.state.routines.push(routine);
  assert.ok(!store.routinesForDay(store.today()).some((r) => r.id === 'r-back'), '보관 중에는 안 보인다');

  goal.archived = false;
  assert.ok(store.routinesForDay(store.today()).some((r) => r.id === 'r-back'), '되돌리면 다시 보인다');
});

check('완전 삭제는 목표와 그 루틴만 지우고 기록은 남긴다', () => {
  const goal = { id: 'g-del', title: '지울 목표', deadline: null, archived: true, leads: [] };
  const mine = { id: 'r-del', goalId: 'g-del', leadId: 'l-del', createdAt: store.today(),
    cue: '밤에', action: '지울 루틴', minimum: '1분', tag: 'other', days: [0,1,2,3,4,5,6], archived: false };
  const other = { ...mine, id: 'r-keep', goalId: 'g-keep', action: '남을 루틴' };
  store.state.goals.push(goal, { id: 'g-keep', title: '남을 목표', deadline: null, archived: false, leads: [] });
  store.state.routines.push(mine, other);
  store.state.sessions.push({ id: 's-del', routineId: 'r-del', date: store.today(), minutes: 20, level: 'full', noteId: null });
  store.save();

  // 화면의 "완전 삭제"가 하는 일
  store.state.goals.splice(store.state.goals.indexOf(goal), 1);
  for (let i = store.state.routines.length - 1; i >= 0; i--) {
    if (store.state.routines[i].goalId === 'g-del') store.state.routines.splice(i, 1);
  }
  store.save();

  assert.ok(!store.state.goals.some((g) => g.id === 'g-del'));
  assert.ok(!store.state.routines.some((r) => r.id === 'r-del'));
  assert.ok(store.state.routines.some((r) => r.id === 'r-keep'), '다른 목표의 루틴은 남는다');
  assert.ok(store.state.sessions.some((s) => s.id === 's-del'), '지난 기록은 남는다');
  // 지운 것이 다른 기기로도 전해져야 한다
  assert.ok(store.state.deleted['g-del'] > 0, '목표에 삭제 표시');
  assert.ok(store.state.deleted['r-del'] > 0, '루틴에 삭제 표시');
});

console.log(`통과 ${passed}개${process.exitCode ? ' · 실패 있음' : ''}`);
