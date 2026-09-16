import {
  state, save, today, addDays, weekStart, daysBetween,
  activeGoals, leadProgress, UNIT_LABEL, exportJSON, importJSON, lastSaveError,
} from '../store.js';
import { el, toast, download, pickFiles, confirmed, copyText } from '../ui.js';
import {
  STATUS_EVENT,
  clearSyncCode,
  getSyncCode,
  getSyncStatus,
  lastSyncedAt,
  newSyncCode,
  normalizeCode,
  setSyncCode,
  syncNow,
} from '../sync.js';

const WEEKS = 12;

// 잔디밭. 열 하나가 한 주, 칸 하나가 하루.
// "오늘 몇 개 했나"가 아니라 "빈 칸이 이어지는가"를 보는 그림이다.
function grid() {
  const thisWeek = weekStart(today());
  const counts = new Map();
  for (const s of state.sessions) counts.set(s.date, (counts.get(s.date) ?? 0) + 1);

  let activeDays = 0;
  let totalDays = 0;
  const cols = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const start = addDays(thisWeek, -7 * w);
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, d);
      const n = counts.get(date) ?? 0;
      const future = daysBetween(today(), date) > 0;
      const level = future ? 'future' : n === 0 ? 'l0' : n === 1 ? 'l1' : n === 2 ? 'l2' : 'l3';
      if (!future && n > 0) activeDays++;
      if (!future) totalDays++;
      cells.push(el('div', {
        class: 'cell ' + level,
        title: `${date} · ${n}회`,
        'aria-hidden': 'true',
      }));
    }
    cols.push(el('div', { class: 'gcol' }, cells));
  }

  return el('div', {
    class: 'grid-wrap',
    role: 'img',
    'aria-label': `최근 ${WEEKS}주 기록. 지난 ${totalDays}일 중 ${activeDays}일에 기록이 있습니다.`,
  },
    el('div', { class: 'glabels', 'aria-hidden': 'true' },
      ['월', '화', '수', '목', '금', '토', '일'].map((d) => el('span', { text: d }))),
    el('div', { class: 'grid', 'aria-hidden': 'true' }, cols));
}

function leadSummary() {
  const rows = [];
  for (const goal of activeGoals()) {
    for (const lead of goal.leads) {
      const done = leadProgress(goal, lead, weekStart());
      const pct = Math.min(100, Math.round((done / lead.target) * 100));
      rows.push(el('div', { class: 'lead' },
        el('div', { class: 'lead-head' },
          el('strong', { text: lead.title }),
          el('span', { class: 'lead-num', text: done + ' / ' + lead.target + (UNIT_LABEL[lead.unit] ?? '') })),
        el('div', { class: 'bar' },
          el('div', { class: 'bar-fill' + (pct >= 100 ? ' full' : ''), style: 'width:' + pct + '%' }))));
    }
  }
  return rows.length
    ? el('div', { class: 'card' }, el('h2', { text: '이번 주 선행지표' }), rows)
    : null;
}

// 주간 회고 3문항. 이번 주 것만 쓰고 고친다.
function retro(ctx) {
  const week = weekStart(today());
  let entry = state.weekly.find((w) => w.week === week);
  if (!entry) {
    entry = { week, keep: '', drop: '', next: '' };
    state.weekly.push(entry);
  }

  const mk = (key, label, placeholder) => {
    const area = el('textarea', { rows: '2', placeholder });
    area.value = entry[key];
    area.addEventListener('change', () => {
      entry[key] = area.value.trim();
      save();
      toast('회고를 저장했습니다.');
    });
    return el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), area);
  };

  return el('div', { class: 'card' },
    el('h2', { text: '이번 주 회고' }),
    el('p', { class: 'hint', text: week + ' 주차' }),
    mk('keep', '유지할 것', '이번 주에 잘 굴러간 것'),
    mk('drop', '버릴 것', '계속 안 되는 것은 루틴을 고치거나 버린다'),
    mk('next', '다음 주에 바꿀 한 가지', '한 가지만'));
}

const timeText = (at) =>
  new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * 기기 간 동기화. 한 기기에서 코드를 만들고 다른 기기에 같은 코드를 넣으면 묶인다.
 * 로그인이 없으므로 코드가 곧 열쇠다.
 */
function syncPanel(ctx) {
  const code = getSyncCode();
  const status = getSyncStatus();

  const connect = async (next) => {
    setSyncCode(next);
    ctx.render();
    try {
      await syncNow();
      toast('맞췄습니다.');
    } catch (err) {
      toast(err.message, 'warn');
    }
    ctx.render();
  };

  if (!code) {
    const input = el('input', {
      type: 'text',
      placeholder: '다른 기기의 코드 붙여넣기',
      'aria-label': '동기화 코드',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
    });
    return el(
      'div',
      { class: 'card' },
      el('h2', { text: '기기 간 동기화' }),
      el('p', {
        class: 'hint',
        text: '폰과 다른 기기에서 같은 기록을 보려면 켠다. 한 기기에서 코드를 만들고 다른 기기에 그 코드를 넣으면 된다. 양쪽에 있던 기록은 합쳐진다.',
      }),
      el('button', {
        class: 'btn primary wide',
        text: '새 코드 만들기',
        onclick: () => void connect(newSyncCode()),
      }),
      el(
        'div',
        { class: 'row' },
        input,
        el('button', {
          class: 'btn',
          text: '연결',
          onclick: () => {
            const next = normalizeCode(input.value);
            if (!next) return toast('코드는 32자입니다. 복사한 코드를 그대로 붙여넣으세요.', 'warn');
            void connect(next);
          },
        }),
      ),
    );
  }

  const last = lastSyncedAt();
  const statusText =
    status.state === 'syncing'
      ? '동기화 중…'
      : status.state === 'error'
        ? `동기화 실패: ${status.message}`
        : last
          ? `마지막 동기화 ${timeText(last)}`
          : '아직 동기화하지 않았습니다.';

  return el(
    'div',
    { class: 'card' },
    el('h2', { text: '기기 간 동기화 · 켜짐' }),
    el('p', {
      class: 'hint',
      text: '다른 기기에서 이 코드를 넣으면 같은 기록을 본다. 코드를 아는 사람은 기록을 볼 수 있으니 남에게 보내지 말자.',
    }),
    el('code', { class: 'sync-code', text: code }),
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'btn',
        text: '코드 복사',
        onclick: async () => {
          const ok = await copyText(code);
          toast(ok ? '복사했습니다.' : '복사가 막혔습니다. 코드를 길게 눌러 복사하세요.', ok ? 'info' : 'warn');
        },
      }),
      el('button', {
        class: 'btn ghost',
        text: '지금 동기화',
        onclick: async () => {
          try {
            await syncNow();
            toast('맞췄습니다.');
          } catch (err) {
            toast(err.message, 'warn');
          }
          ctx.render();
        },
      }),
    ),
    el('button', {
      class: 'btn ghost wide',
      text: '연결 끊기',
      onclick: () => {
        if (!confirmed('이 기기의 동기화를 끕니다. 기록은 이 기기에 그대로 남습니다.')) return;
        clearSyncCode();
        ctx.render();
      },
    }),
    el('p', { class: status.state === 'error' ? 'warn' : 'hint', text: statusText }),
  );
}

function backup(ctx) {
  return el('div', { class: 'card' },
    el('h2', { text: '백업' }),
    el('p', { class: 'hint', text: '동기화를 쓰지 않거나 따로 보관해 두고 싶을 때. 가져오기는 이 기기 기록을 지우고 파일 내용으로 바꿉니다. (기출 문항은 언제든 다시 가져올 수 있어 백업에 포함하지 않습니다.)' }),
    el('div', { class: 'row' },
      el('button', {
        class: 'btn', text: '내보내기',
        onclick: () => download(`lifeloop-${today()}.json`, exportJSON()),
      }),
      el('button', {
        class: 'btn ghost', text: '가져오기',
        onclick: async () => {
          const files = await pickFiles({ accept: '.json' });
          if (!files.length) return;
          if (!confirmed('지금 기록을 모두 지우고 파일 내용으로 바꿉니다. 계속할까요?')) return;
          try {
            importJSON(files[0].text);
            toast('가져왔습니다.');
            ctx.render();
          } catch (err) {
            toast('가져오기 실패: ' + err.message, 'warn');
          }
        },
      })));
}

export default function renderWeekly(ctx) {
  const saveErr = lastSaveError();
  return el('section', { class: 'view' },
    el('header', { class: 'view-head' },
      el('h1', { text: '주간' }),
      el('p', { class: 'sub', text: '빈 칸이 이어지는지를 봅니다.' })),
    saveErr
      ? el('p', { class: 'warn card', text: '저장에 실패하고 있습니다. 저장 공간이 찼거나 브라우저가 저장을 막고 있습니다.' })
      : null,
    el('div', { class: 'card' }, el('h2', { text: '최근 12주' }), grid()),
    leadSummary(),
    retro(ctx),
    syncPanel(ctx),
    backup(ctx));
}
