import {
  state, save, uid, makeNote, scheduleReview,
  canWriteNoteToday, NOTE_DAILY_CAP, CONFIDENCE, noteById,
} from '../store.js';
import { el, modal, toast, confirmed, copyText, pickFiles } from '../ui.js';
import { exam, hasExam, importRounds, searchQuestions, topics, questionAsSource, questionById } from '../exam.js';
import { notesToMarkdown } from '../share.js';

// ---------- 기출 문항 가져오기 ----------

async function importExamFiles(onDone) {
  const files = await pickFiles({ accept: '.json', multiple: true });
  if (!files.length) return;
  try {
    const { added, updated, rounds } = importRounds(files);
    toast(`${rounds}개 회차 · 새 문항 ${added}개, 갱신 ${updated}개`);
    onDone?.();
  } catch (err) {
    toast(err.message, 'warn');
  }
}

// energy-exam 의 rounds/*.json 을 고르게 하는 안내.
function examSetupBody(onDone) {
  return el('div', { class: 'form' },
    el('p', { class: 'hint', text: 'energy-exam 저장소의 src/data/rounds/ 안에 있는 회차 JSON 파일을 고르세요. 여러 개를 한 번에 고를 수 있습니다.' }),
    el('p', { class: 'hint', text: '문항은 이 기기에만 저장되고 어디로도 전송되지 않습니다.' }),
    el('button', { class: 'btn primary wide', text: '파일 고르기', onclick: () => importExamFiles(onDone) }));
}

// ---------- 문항 고르기 ----------

function questionPicker(onPick) {
  const topicSel = el('select', { 'aria-label': '주제로 거르기' }, el('option', { value: '', text: '전체 주제' }),
    ...topics().map((t) => el('option', { value: t, text: t })));
  const roundSel = el('select', { 'aria-label': '회차로 거르기' }, el('option', { value: '', text: '전체 회차' }),
    ...exam.rounds.map((r) => el('option', { value: r.label, text: `${r.year}년 ${r.round}회` })));
  const search = el('input', { type: 'search', placeholder: '내용 검색' });
  const list = el('div', { class: 'q-list' });

  const refresh = () => {
    const found = searchQuestions({ topic: topicSel.value, round: roundSel.value, text: search.value });
    list.replaceChildren();
    if (!found.length) {
      list.append(el('p', { class: 'hint', text: '해당하는 문항이 없습니다.' }));
      return;
    }
    for (const q of found.slice(0, 60)) {
      list.append(el('button', {
        class: 'q-item',
        onclick: () => { dialog.close(); onPick(q); },
      },
        el('span', { class: 'q-meta', text: `${q.year}년 ${q.round}회 ${q.no ?? ''}번 · ${q.topic ?? ''}` }),
        el('span', { class: 'q-text', text: q.question.slice(0, 110) })));
    }
    if (found.length > 60) list.append(el('p', { class: 'hint', text: `외 ${found.length - 60}개. 검색으로 좁혀보세요.` }));
  };

  topicSel.addEventListener('change', refresh);
  roundSel.addEventListener('change', refresh);
  search.addEventListener('input', refresh);

  const body = el('div', { class: 'form' },
    el('div', { class: 'row' }, topicSel, roundSel),
    search,
    list);
  const dialog = modal('기출 문항 고르기', body);
  refresh();
  return dialog;
}

// ---------- 파인만 노트 작성 ----------

function composer(existing, ctx) {
  const note = existing ?? makeNote();
  let source = { ...note.source };

  const concept = el('input', { type: 'text', value: note.concept, placeholder: '엔트로피가 왜 항상 증가하나' });
  const srcLabel = el('span', { class: 'src-label' });
  const explanation = el('textarea', { rows: '9', placeholder: '중학생에게 설명하듯 적어보세요. 폰 키보드의 마이크 버튼으로 말해서 넣어도 됩니다.' });
  explanation.value = note.explanation;
  const analogy = el('input', { type: 'text', value: note.analogy, placeholder: '비유 (선택)' });

  const paintSource = () => {
    if (source.kind === 'exam') srcLabel.textContent = `기출 · ${source.title}${source.locator ? ' · ' + source.locator : ''}`;
    else if (source.kind === 'book') srcLabel.textContent = `책 · ${source.title}${source.locator ? ' p.' + source.locator : ''}`;
    else srcLabel.textContent = source.title ? `공부 · ${source.title}` : '출처 없음';
  };
  paintSource();

  const pickExam = () => {
    if (!hasExam()) return modal('기출 문항 가져오기', examSetupBody(() => toast('이제 문항을 고를 수 있습니다.')));
    questionPicker((q) => {
      source = questionAsSource(q);
      if (!concept.value.trim() && q.topic) concept.value = q.topic;
      paintSource();
    });
  };

  const pickBook = () => {
    const title = el('input', { type: 'text', value: source.kind === 'book' ? source.title : '', placeholder: '책 제목' });
    const page = el('input', { type: 'text', value: source.kind === 'book' ? source.locator : '', placeholder: '페이지 (선택)' });
    const dlg = modal('책 출처', el('div', { class: 'form' }, title, page,
      el('button', {
        class: 'btn primary wide', text: '확인',
        onclick: () => {
          if (!title.value.trim()) return toast('책 제목을 적어주세요.', 'warn');
          source = { kind: 'book', title: title.value.trim(), locator: page.value.trim() };
          paintSource();
          dlg.close();
        },
      })));
  };

  // 구멍 — 이 기능의 진짜 산출물. 설명이 아니라 막힌 곳이 다음 공부 주제가 된다.
  const gaps = note.gaps.map((g) => ({ ...g }));
  const gapList = el('ul', { class: 'gap-list' });
  const gapInput = el('input', { type: 'text', placeholder: '설명하다 막힌 부분' });

  const paintGaps = () => {
    gapList.replaceChildren();
    gaps.forEach((g, i) => {
      gapList.append(el('li', { class: g.resolved ? 'resolved' : '' },
        el('span', { text: g.text }),
        el('button', {
          class: 'link danger', text: '✕', 'aria-label': '삭제',
          onclick: () => { gaps.splice(i, 1); paintGaps(); },
        })));
    });
  };
  paintGaps();

  const addGap = () => {
    const text = gapInput.value.trim();
    if (!text) return;
    gaps.push({ id: uid(), text, resolved: false });
    gapInput.value = '';
    paintGaps();
  };
  gapInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addGap(); }
  });

  let confidence = note.confidence;
  const confBtns = [1, 2, 3].map((level) =>
    el('button', {
      type: 'button',
      class: 'conf' + (confidence === level ? ' on' : ''),
      text: `${CONFIDENCE[level].emoji} ${CONFIDENCE[level].label}`,
      onclick: (e) => {
        confidence = level;
        for (const b of e.currentTarget.parentElement.children) b.classList.remove('on');
        e.currentTarget.classList.add('on');
      },
    }));

  const submit = () => {
    if (!concept.value.trim()) return toast('무엇을 설명할지 한 줄로 적어주세요.', 'warn');
    if (!explanation.value.trim()) return toast('설명이 비어 있습니다. 한 문장이라도 좋습니다.', 'warn');

    Object.assign(note, {
      concept: concept.value.trim(),
      explanation: explanation.value.trim(),
      analogy: analogy.value.trim(),
      source,
      gaps,
    });
    scheduleReview(note, confidence);
    if (!existing) state.notes.push(note);
    save();
    dialog.close();
    ctx.render();
    toast(existing ? '수정했습니다.' : `저장했습니다. ${note.nextReviewAt}에 다시 물어봅니다.`);
  };

  const body = el('div', { class: 'form composer' },
    el('span', { class: 'step', text: '1 · 무엇을 설명할 것인가' }),
    concept,
    el('div', { class: 'src-row' }, srcLabel,
      el('button', { class: 'link', text: '기출', onclick: pickExam }),
      el('button', { class: 'link', text: '책', onclick: pickBook }),
      el('button', { class: 'link', text: '출처 없음', onclick: () => { source = { kind: 'study', title: '', locator: '' }; paintSource(); } })),
    el('span', { class: 'step', text: '2 · 중학생에게 설명하듯' }),
    explanation,
    el('span', { class: 'step', text: '3 · 막힌 곳' }),
    el('div', { class: 'row' }, gapInput, el('button', { class: 'btn', text: '추가', onclick: addGap })),
    gapList,
    el('span', { class: 'step', text: '4 · 지금 얼마나 설명할 수 있나' }),
    el('div', { class: 'conf-row' }, confBtns),
    analogy,
    el('button', { class: 'btn primary wide', text: '저장', onclick: submit }));

  const dialog = modal(existing ? '노트 수정' : '오늘의 정리', body);
  return dialog;
}

// ---------- 공유 ----------

function shareDialog(notes) {
  const hasExamSource = notes.some((n) => n.source?.examId);
  const includeBox = el('input', { type: 'checkbox' });
  const out = el('textarea', { rows: '12', readonly: true });

  const paint = () => { out.value = notesToMarkdown(notes, { includeQuestion: includeBox.checked }); };
  includeBox.addEventListener('change', paint);
  paint();

  const body = el('div', { class: 'form' },
    hasExamSource
      ? el('label', { class: 'check' }, includeBox, el('span', { text: '문제 전문도 함께 넣기' }))
      : null,
    hasExamSource
      ? el('small', { class: 'hint', text: '기본은 내 설명만 나갑니다. 문제집에서 옮겨 적은 지문이 그대로 퍼지지 않도록 기본값을 꺼둡니다.' })
      : null,
    out,
    el('button', {
      class: 'btn primary wide', text: '클립보드로 복사',
      onclick: async () => {
        const ok = await copyText(out.value);
        toast(ok ? '복사했습니다. 붙여넣기 하세요.' : '복사 권한이 없습니다. 직접 선택해 복사하세요.', ok ? 'info' : 'warn');
      },
    }));

  modal(notes.length > 1 ? `노트 ${notes.length}개 공유` : '노트 공유', body);
}

// ---------- 상세 ----------

function detail(note, ctx) {
  const q = note.source?.examId ? questionById(note.source.examId) : null;

  const gapList = el('ul', { class: 'gap-list' });
  const paintGaps = () => {
    gapList.replaceChildren();
    for (const g of note.gaps) {
      gapList.append(el('li', { class: g.resolved ? 'resolved' : '' },
        el('label', { class: 'check' },
          el('input', {
            type: 'checkbox', checked: g.resolved,
            onchange: (e) => { g.resolved = e.currentTarget.checked; save(); paintGaps(); ctx.render(); },
          }),
          el('span', { text: g.text }))));
    }
    if (!note.gaps.length) gapList.append(el('p', { class: 'hint', text: '막힌 곳 없음.' }));
  };
  paintGaps();

  const body = el('div', { class: 'detail' },
    el('p', { class: 'src-label', text: sourceText(note) }),
    q ? el('details', {}, el('summary', { text: '문제 보기' }), el('p', { class: 'q-full', text: q.question })) : null,
    el('p', { class: 'explanation', text: note.explanation }),
    note.analogy ? el('p', { class: 'analogy', text: '비유 — ' + note.analogy }) : null,
    el('h3', { text: '막힌 곳' }),
    gapList,
    el('p', { class: 'hint', text: `${note.date} 작성 · 복습 ${note.reviews.length}회 · 다음 복습 ${note.nextReviewAt ?? '-'}` }),
    el('div', { class: 'card-actions' },
      el('button', { class: 'btn', text: '공유', onclick: () => shareDialog([note]) }),
      el('button', { class: 'btn ghost', text: '수정', onclick: () => { dlg.close(); composer(note, ctx); } }),
      el('button', {
        class: 'btn ghost danger', text: '삭제',
        onclick: () => {
          if (!confirmed(`"${note.concept}" 노트를 삭제할까요?`)) return;
          state.notes.splice(state.notes.indexOf(note), 1);
          save();
          dlg.close();
          ctx.render();
        },
      })));

  const dlg = modal(note.concept, body);
  return dlg;
}

function sourceText(note) {
  const s = note.source ?? {};
  if (s.kind === 'exam') return `기출 · ${s.title}${s.locator ? ' · ' + s.locator : ''}`;
  if (s.kind === 'book') return `책 · ${s.title}${s.locator ? ' p.' + s.locator : ''}`;
  return s.title ? `공부 · ${s.title}` : '출처 없음';
}

// ---------- 목록 ----------

const FILTERS = [
  { key: 'all', label: '전체', match: () => true },
  { key: 'gap', label: '막힌 곳', match: (n) => n.gaps.some((g) => !g.resolved) },
  { key: 'exam', label: '기출', match: (n) => n.source?.kind === 'exam' },
  { key: 'book', label: '책', match: (n) => n.source?.kind === 'book' },
];

let activeFilter = 'all';

function noteRow(note, ctx) {
  const openGapCount = note.gaps.filter((g) => !g.resolved).length;
  const c = CONFIDENCE[note.confidence] ?? CONFIDENCE[2];
  return el('button', { class: 'card note-row', onclick: () => detail(note, ctx) },
    el('span', { class: 'n-concept', text: note.concept }),
    el('span', { class: 'n-meta', text: sourceText(note) }),
    el('span', { class: 'n-tags' },
      el('span', { class: 'chip', text: c.emoji + ' ' + c.label }),
      openGapCount ? el('span', { class: 'chip warn', text: `막힌 곳 ${openGapCount}` }) : null,
      el('span', { class: 'chip quiet', text: note.date })));
}

export default function renderNotes(ctx) {
  const params = ctx.params ?? {};
  const filter = FILTERS.find((f) => f.key === activeFilter) ?? FILTERS[0];
  const notes = [...state.notes].sort((a, b) => b.date.localeCompare(a.date)).filter(filter.match);

  const tabs = el('div', { class: 'filters' }, FILTERS.map((f) =>
    el('button', {
      class: 'filter' + (f.key === activeFilter ? ' on' : ''),
      text: f.label,
      onclick: () => { activeFilter = f.key; ctx.render(); },
    })));

  const view = el('section', { class: 'view' },
    el('header', { class: 'view-head' },
      el('h1', { text: '노트' }),
      el('p', { class: 'sub', text: `내 말로 설명한 것만 남습니다 · 하루 ${NOTE_DAILY_CAP}개` })),
    tabs,
    notes.length
      ? el('div', { class: 'cards' }, notes.map((n) => noteRow(n, ctx)))
      : el('div', { class: 'empty' }, el('p', { text: '아직 노트가 없습니다.' })),
    canWriteNoteToday()
      ? el('button', { class: 'btn primary wide', text: '+ 오늘의 정리', onclick: () => composer(null, ctx) })
      : el('p', { class: 'hint', text: '오늘 정리는 끝났습니다. 하루 한 개면 충분합니다.' }),
    el('div', { class: 'row end' },
      notes.length ? el('button', { class: 'link', text: '이 목록 전체 공유', onclick: () => shareDialog(notes) }) : null,
      el('button', {
        class: 'link',
        text: hasExam() ? `기출 ${exam.questions.length}문항 연결됨 · 다시 가져오기` : '기출 문항 가져오기',
        onclick: () => modal('기출 문항 가져오기', examSetupBody(() => ctx.render())),
      })));

  // 다른 화면에서 넘어온 요청 처리
  if (params.compose && canWriteNoteToday()) queueMicrotask(() => composer(null, ctx));
  if (params.noteId) {
    const target = noteById(params.noteId);
    if (target) queueMicrotask(() => detail(target, ctx));
  }
  return view;
}
