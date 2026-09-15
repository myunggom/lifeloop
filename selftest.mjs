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

console.log(`통과 ${passed}개${process.exitCode ? ' · 실패 있음' : ''}`);
