// 기출 문항 연동 (energy-exam 의 rounds/*.json).
//
// 문항 데이터는 저장소에 포함하지 않는다. 사용자가 파일로 가져와 이 기기에만 보관한다.
// 노트 데이터와 키를 분리한 이유: 문항은 600KB대인데 불변이다.
// 같은 키에 두면 루틴 체크 한 번마다 그 용량을 통째로 다시 직렬화하게 된다.

const KEY = 'lifeloop.exam.v1';

const EMPTY = { rounds: [], questions: [] };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? Object.assign(structuredClone(EMPTY), JSON.parse(raw)) : structuredClone(EMPTY);
  } catch (err) {
    console.error('문항 데이터를 읽지 못했습니다:', err);
    return structuredClone(EMPTY);
  }
}

export const exam = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(exam));
    return null;
  } catch (err) {
    console.error('문항 저장 실패:', err);
    return err;
  }
}

// 가져오기는 신뢰 경계다. 모양을 확인한 뒤에만 받아들인다.
function validateRound(data, filename) {
  const fail = (why) => {
    throw new Error(`${filename}: ${why}`);
  };
  if (!data || typeof data !== 'object') fail('JSON 객체가 아닙니다.');
  if (!Number.isFinite(data.year) || !Number.isFinite(data.round)) fail('year / round 가 없습니다.');
  if (!Array.isArray(data.questions)) fail('questions 가 배열이 아닙니다.');
  for (const q of data.questions) {
    if (!q || typeof q.id !== 'string' || !q.id) fail('id 없는 문항이 있습니다.');
    if (typeof q.question !== 'string') fail(`${q.id}: question 이 문자열이 아닙니다.`);
  }
  return data;
}

/**
 * energy-exam 의 회차 JSON 여러 개를 받아 병합한다.
 * 같은 문항 id 는 나중 것으로 덮어쓴다.
 * @returns {{added:number, updated:number, rounds:number}}
 */
export function importRounds(files) {
  let added = 0;
  let updated = 0;
  let roundCount = 0;

  for (const { name, text } of files) {
    const data = validateRound(JSON.parse(text), name);
    const label = `${data.year}-${data.round}`;

    const meta = {
      label,
      year: data.year,
      round: data.round,
      examDate: data.examDate ?? null,
      source: data.source ?? null,
    };
    const at = exam.rounds.findIndex((r) => r.label === label);
    if (at >= 0) exam.rounds[at] = meta;
    else exam.rounds.push(meta);
    roundCount++;

    for (const q of data.questions) {
      const entry = {
        id: q.id,
        no: q.no ?? null,
        type: q.type ?? null,
        topic: q.topic ?? null,
        question: q.question,
        given: Array.isArray(q.given) ? q.given : [],
        answer: Array.isArray(q.answer) ? q.answer : q.answer ? [q.answer] : [],
        solution: typeof q.solution === 'string' ? q.solution : '',
        year: data.year,
        round: data.round,
        label,
      };
      const i = exam.questions.findIndex((x) => x.id === q.id);
      if (i >= 0) {
        exam.questions[i] = entry;
        updated++;
      } else {
        exam.questions.push(entry);
        added++;
      }
    }
  }

  exam.rounds.sort((a, b) => b.year - a.year || b.round - a.round);
  exam.questions.sort((a, b) => b.year - a.year || b.round - a.round || (a.no ?? 0) - (b.no ?? 0));

  const err = persist();
  if (err) throw new Error('문항이 너무 커서 저장하지 못했습니다. 회차를 나눠서 가져오세요.');
  return { added, updated, rounds: roundCount };
}

export const hasExam = () => exam.questions.length > 0;
export const questionById = (id) => exam.questions.find((q) => q.id === id);

export const topics = () =>
  [...new Set(exam.questions.map((q) => q.topic).filter(Boolean))].sort();

export function searchQuestions({ topic = '', round = '', text = '' } = {}) {
  const needle = text.trim().toLowerCase();
  return exam.questions.filter((q) => {
    if (topic && q.topic !== topic) return false;
    if (round && q.label !== round) return false;
    if (needle && !(`${q.question} ${q.topic ?? ''} ${q.id}`.toLowerCase().includes(needle))) return false;
    return true;
  });
}

export function clearExam() {
  exam.rounds = [];
  exam.questions = [];
  localStorage.removeItem(KEY);
}

// 문항을 노트의 출처로 바꾼다. 문제 전문은 넣지 않는다 —
// 노트의 본문은 어디까지나 내 설명이어야 하고, 공유할 때 문제집 내용이 따라 나가면 안 된다.
export function questionAsSource(q) {
  return {
    kind: 'exam',
    title: `${q.year}년 ${q.round}회 ${q.no ?? ''}번`.replace(/\s+/g, ' ').trim(),
    locator: q.topic ?? '',
    examId: q.id,
  };
}
