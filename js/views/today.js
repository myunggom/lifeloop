import {
  state, save, uid, today, DAY_NAMES, dow,
  routinesForDay, isDone, missStreak, doneStreak,
  openGaps, dueNotes, canWriteNoteToday, isStudyTag, goalById,
  isMinuteRoutine, minutesToday, lastSessionToday,
} from '../store.js';
import { el, modal, toast } from '../ui.js';

// 타이머는 화면이 꺼지면 JS가 멈춘다. 초를 세지 않고 시작 시각만 저장한 뒤
// 종료할 때 차이를 계산한다. 이렇게 해야 폰을 주머니에 넣어도 값이 맞는다.
const TIMER_KEY = 'lifeloop.timer';

const readTimer = () => {
  try {
    return JSON.parse(localStorage.getItem(TIMER_KEY) || 'null');
  } catch {
    return null;
  }
};
const writeTimer = (t) =>
  t ? localStorage.setItem(TIMER_KEY, JSON.stringify(t)) : localStorage.removeItem(TIMER_KEY);

const elapsedMin = (startedAt) => Math.max(1, Math.round((Date.now() - startedAt) / 60000));

/**
 * 몇 분 했는지 묻는다.
 *
 * 분으로 점수를 매기는 지표는 타이머로 끝낸 세션에만 분이 담겼다. "완료"만 누르면
 * 0분으로 남아 주간 지표가 영영 채워지지 않았다. 자주 쓰는 값은 버튼으로 두어
 * 두 번 탭이면 끝나게 한다.
 */
function askMinutes({ title, initial, onPick }) {
  const input = el('input', {
    type: 'number', min: '1', max: '600', step: '1', inputmode: 'numeric', value: String(initial),
    'aria-label': '분',
  });
  const chips = [5, 10, 15, 20, 30, 45, 60].map((m) =>
    el('button', {
      type: 'button', class: 'btn chip', text: m + '분',
      onclick: () => {
        input.value = String(m);
      },
    }),
  );
  const submit = () => {
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n) || n < 1) return toast('몇 분 했는지 숫자로 적어주세요.', 'warn');
    dialog.close();
    onPick(Math.min(n, 600));
  };
  const dialog = modal(
    title,
    el('div', { class: 'form' },
      el('div', { class: 'chips' }, chips),
      input,
      el('button', { class: 'btn primary wide', text: '기록', onclick: submit })),
  );
  return dialog;
}

function logSession(routine, { minutes = 0, level = 'full' }, ctx) {
  state.sessions.push({
    id: uid(),
    routineId: routine.id,
    date: today(),
    minutes,
    level,
    noteId: null,
  });
  save();

  const suggest = isStudyTag(routine.tag) && canWriteNoteToday();
  ctx.render();
  if (suggest) ctx.suggestNote(routine);
  else toast(minutes ? `${minutes}분 기록했습니다.` : '기록했습니다.');
}

function routineCard(routine, ctx) {
  const done = isDone(routine.id);
  const misses = missStreak(routine);
  const streak = doneStreak(routine);
  const timer = readTimer();
  const running = timer && timer.routineId === routine.id;
  const goal = routine.goalId ? goalById(routine.goalId) : null;

  const minuteRoutine = isMinuteRoutine(routine);
  const doneMinutes = done && minuteRoutine ? minutesToday(routine.id) : 0;

  const actions = done
    ? [
        el('span', { class: 'done-mark', text: minuteRoutine ? `오늘 ${doneMinutes}분` : '오늘 완료' }),
        // 타이머 없이 "완료"만 눌러 0분으로 남은 것을 여기서 고친다
        minuteRoutine
          ? el('button', {
              class: 'btn ghost', text: '분 고치기',
              onclick: () =>
                askMinutes({
                  title: '오늘 몇 분 했나요?',
                  initial: doneMinutes || 10,
                  onPick: (minutes) => {
                    const session = lastSessionToday(routine.id);
                    if (!session) return;
                    // 오늘 여러 번 했다면 마지막 기록만 고친다. 나머지는 그대로 둔다.
                    session.minutes = Math.max(0, minutes - (minutesToday(routine.id) - (session.minutes || 0)));
                    save();
                    ctx.render();
                    toast(`오늘 ${minutes}분으로 고쳤습니다.`);
                  },
                }),
            })
          : null,
      ]
    : running
      ? [
          el('button', {
            class: 'btn primary wide',
            text: `타이머 종료 (${elapsedMin(timer.startedAt)}분 경과)`,
            onclick: () => {
              const minutes = elapsedMin(timer.startedAt);
              writeTimer(null);
              logSession(routine, { minutes, level: 'full' }, ctx);
            },
          }),
          el('button', {
            class: 'btn ghost',
            text: '취소',
            onclick: () => {
              writeTimer(null);
              ctx.render();
            },
          }),
        ]
      : [
          el('button', {
            class: 'btn primary', text: '완료',
            onclick: () => {
              if (!isMinuteRoutine(routine)) return logSession(routine, { level: 'full' }, ctx);
              askMinutes({
                title: '몇 분 했나요?',
                initial: 20,
                onPick: (minutes) => logSession(routine, { minutes, level: 'full' }, ctx),
              });
            },
          }),
          el('button', {
            class: 'btn', text: '최소만',
            onclick: () => {
              if (!isMinuteRoutine(routine)) return logSession(routine, { level: 'min' }, ctx);
              askMinutes({
                title: '몇 분 했나요?',
                initial: 5,
                onPick: (minutes) => logSession(routine, { minutes, level: 'min' }, ctx),
              });
            },
          }),
          el('button', {
            class: 'btn ghost',
            text: '타이머',
            onclick: () => {
              writeTimer({ routineId: routine.id, startedAt: Date.now() });
              ctx.render();
            },
          }),
        ];

  return el(
    'article',
    { class: 'card routine' + (done ? ' is-done' : '') + (misses >= 2 ? ' is-warn' : '') },
    goal && el('div', { class: 'card-goal', text: goal.title }),
    el('p', { class: 'cue', text: routine.cue }),
    el('p', { class: 'action', text: routine.action }),
    routine.minimum && el('p', { class: 'minimum', text: `최소: ${routine.minimum}` }),
    // "never miss twice" — 한 번 빠진 것은 알리지 않는다. 두 번째부터가 위험 신호다.
    misses >= 2 && el('p', { class: 'warn', text: `${misses}번 연속 건너뛰었습니다. 오늘은 최소만이라도.` }),
    streak > 0 && el('p', { class: 'streak', text: `연속 ${streak}회` }),
    el('div', { class: 'card-actions' }, actions)
  );
}

export default function renderToday(ctx) {
  const date = today();
  const routines = routinesForDay(date);
  const due = dueNotes(date);
  const gaps = openGaps();

  const banners = [];
  if (due.length) {
    banners.push(
      el('button', {
        class: 'banner review',
        text: `복습할 노트 ${due.length}개`,
        onclick: () => ctx.navigate('review'),
      })
    );
  }
  if (gaps.length) {
    banners.push(
      el('button', {
        class: 'banner gap',
        text: `아직 막힌 곳 ${gaps.length}개 — ${gaps[0].gap.text}`,
        onclick: () => ctx.navigate('notes', { noteId: gaps[0].note.id }),
      })
    );
  }

  return el(
    'section',
    { class: 'view' },
    el(
      'header',
      { class: 'view-head' },
      el('h1', { text: '오늘' }),
      el('p', { class: 'sub', text: `${date} (${DAY_NAMES[dow(date)]})` })
    ),
    banners.length ? el('div', { class: 'banners' }, banners) : null,
    routines.length
      ? el('div', { class: 'cards' }, routines.map((r) => routineCard(r, ctx)))
      : el(
          'div',
          { class: 'empty' },
          el('p', { text: '오늘 예정된 루틴이 없습니다.' }),
          el('button', { class: 'btn primary', text: '목표와 루틴 만들기', onclick: () => ctx.navigate('goals') })
        ),
    routines.length && canWriteNoteToday()
      ? el('button', {
          class: 'btn wide ghost note-cta',
          text: '오늘 개념 하나 정리하기',
          onclick: () => ctx.navigate('notes', { compose: true }),
        })
      : null,
    routines.length && !canWriteNoteToday()
      ? el('p', { class: 'hint', text: '오늘 정리는 끝났습니다. 하루 한 개면 충분합니다.' })
      : null
  );
}
