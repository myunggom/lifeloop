import {
  state, save, today, addDays, weekStart, daysBetween,
  activeGoals, leadProgress, UNIT_LABEL, exportJSON, importJSON, lastSaveError,
} from '../store.js';
import { el, toast, download, pickFiles, confirmed } from '../ui.js';

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

function backup(ctx) {
  return el('div', { class: 'card' },
    el('h2', { text: '백업' }),
    el('p', { class: 'hint', text: '이 앱은 서버가 없습니다. 기기를 잃으면 기록도 사라지므로 가끔 내보내세요. (기출 문항은 언제든 다시 가져올 수 있어 백업에 포함하지 않습니다.)' }),
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
    backup(ctx));
}
