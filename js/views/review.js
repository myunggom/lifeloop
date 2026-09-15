import { save, today, dueNotes, scheduleReview, CONFIDENCE } from '../store.js';
import { el, toast } from '../ui.js';

// 복습은 "다시 읽기"가 아니라 "다시 꺼내기"다.
// 그래서 이전 설명을 가린 채 새로 쓰게 하고, 제출한 뒤에야 나란히 보여준다.

let current = null;   // 지금 복습 중인 노트
let drafted = null;   // 방금 쓴 설명 (제출 후 비교용)

function finish(note, confidence, ctx) {
  note.reviews.push({ date: today(), explanation: drafted, confidence });
  const next = scheduleReview(note, confidence, today());
  save();
  current = null;
  drafted = null;
  ctx.render();
  toast(`다음 복습은 ${next}.`);
}

function comparePane(note, ctx) {
  return el('div', { class: 'compare' },
    el('h3', { text: '방금 쓴 설명' }),
    el('p', { class: 'explanation fresh', text: drafted }),
    el('h3', { text: '지난번 설명' }),
    el('p', { class: 'explanation old', text: note.explanation }),
    note.gaps.filter((g) => !g.resolved).length
      ? el('p', { class: 'hint', text: '아직 막힌 곳: ' + note.gaps.filter((g) => !g.resolved).map((g) => g.text).join(', ') })
      : null,
    el('h3', { text: '지금은 얼마나 설명할 수 있나' }),
    el('div', { class: 'conf-row' }, [1, 2, 3].map((level) =>
      el('button', {
        class: 'conf',
        text: `${CONFIDENCE[level].emoji} ${CONFIDENCE[level].label}`,
        onclick: () => finish(note, level, ctx),
      }))));
}

function answerPane(note, ctx) {
  const input = el('textarea', { rows: '9', placeholder: '보지 말고 다시 설명해보세요. 막히면 막힌 채로 두어도 됩니다.' });
  return el('div', { class: 'answer' },
    el('p', { class: 'hint', text: '지난 설명은 제출한 뒤에 보여줍니다.' }),
    input,
    el('button', {
      class: 'btn primary wide', text: '제출하고 비교하기',
      onclick: () => {
        drafted = input.value.trim();
        if (!drafted) return toast('한 문장이라도 써보세요. 막혔다는 사실 자체가 정보입니다.', 'warn');
        ctx.render();
      },
    }),
    el('button', {
      class: 'btn ghost wide', text: '오늘은 건너뛰기',
      onclick: () => { current = null; drafted = null; ctx.render(); },
    }));
}

export default function renderReview(ctx) {
  const due = dueNotes(today());

  if (!due.length) {
    current = null;
    drafted = null;
    return el('section', { class: 'view' },
      el('header', { class: 'view-head' }, el('h1', { text: '복습' })),
      el('div', { class: 'empty' },
        el('p', { text: '오늘 복습할 노트가 없습니다.' }),
        el('p', { class: 'hint', text: '노트를 쓰면 자신감에 따라 1일 / 3일 / 7일 뒤에 다시 물어봅니다.' })));
  }

  if (!current || !due.includes(current)) {
    current = due[0];
    drafted = null;
  }

  const source = current.source ?? {};
  const srcText = source.kind === 'exam'
    ? `기출 · ${source.title}`
    : source.kind === 'book'
      ? `책 · ${source.title}`
      : source.title || '';

  return el('section', { class: 'view' },
    el('header', { class: 'view-head' },
      el('h1', { text: '복습' }),
      el('p', { class: 'sub', text: `남은 ${due.length}개` })),
    el('article', { class: 'card review-card' },
      el('h2', { class: 'n-concept', text: current.concept }),
      srcText ? el('p', { class: 'src-label', text: srcText }) : null,
      drafted === null ? answerPane(current, ctx) : comparePane(current, ctx)));
}
