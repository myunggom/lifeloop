import {
  state, save, uid, today, daysBetween, weekStart, DAY_NAMES,
  activeGoals, activeRoutines, leadProgress, UNIT_LABEL,
} from '../store.js';
import { el, modal, toast, confirmed } from '../ui.js';

const field = (label, input, hint) =>
  el('label', { class: 'field' },
    el('span', { class: 'field-label', text: label }),
    input,
    hint && el('small', { class: 'hint', text: hint }));

// 버튼 묶음은 label 로 감싸면 안 된다. label 은 안의 첫 컨트롤에 이름을 덮어써서
// "일" 버튼의 접근성 이름이 "요일 월 화 수 목 금 토" 가 되어버린다.
const group = (label, node) => {
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', label);
  return el('div', { class: 'field' }, el('span', { class: 'field-label', text: label }), node);
};

const val = (node) => node.value.trim();

// ---------- 목표 ----------

function goalForm(goal, ctx) {
  const title = el('input', { type: 'text', value: goal?.title ?? '', placeholder: '에너지관리기사 실기 합격' });
  const deadline = el('input', { type: 'date', value: goal?.deadline ?? '' });

  const submit = () => {
    if (!val(title)) return toast('목표 이름을 적어주세요.', 'warn');
    if (goal) {
      goal.title = val(title);
      goal.deadline = deadline.value || null;
    } else {
      state.goals.push({ id: uid(), title: val(title), deadline: deadline.value || null, archived: false, leads: [] });
    }
    save();
    dialog.close();
    ctx.render();
  };

  const body = el('div', { class: 'form' },
    field('목표', title, '내가 직접 통제할 수 없는 결과를 적습니다.'),
    field('기한', deadline),
    el('button', { class: 'btn primary wide', text: goal ? '저장' : '만들기', onclick: submit }));

  const dialog = modal(goal ? '목표 수정' : '새 목표', body);
  return dialog;
}

// ---------- 선행지표 ----------

function leadForm(goal, lead, ctx) {
  const title = el('input', { type: 'text', value: lead?.title ?? '', placeholder: '주 5회 기출 세션' });
  const unit = el('select', {},
    el('option', { value: 'session', text: '세션 수 (회)' }),
    el('option', { value: 'minute', text: '시간 (분)' }),
    el('option', { value: 'note', text: '정리 노트 (개)' }));
  unit.value = lead?.unit ?? 'session';
  const target = el('input', { type: 'number', min: '1', value: lead?.target ?? 5 });

  const submit = () => {
    if (!val(title)) return toast('선행지표 이름을 적어주세요.', 'warn');
    const n = Number(target.value);
    if (!Number.isFinite(n) || n < 1) return toast('주간 목표는 1 이상이어야 합니다.', 'warn');
    if (lead) Object.assign(lead, { title: val(title), unit: unit.value, target: n });
    else goal.leads.push({ id: uid(), title: val(title), unit: unit.value, target: n });
    save();
    dialog.close();
    ctx.render();
  };

  const body = el('div', { class: 'form' },
    field('선행지표', title, '내가 통제할 수 있는 주간 행동량입니다.'),
    field('단위', unit),
    field('주간 목표', target),
    el('button', { class: 'btn primary wide', text: lead ? '저장' : '만들기', onclick: submit }));

  const dialog = modal(lead ? '선행지표 수정' : '새 선행지표', body);
  return dialog;
}

// ---------- 루틴 ----------

function routineForm(goal, lead, routine, ctx) {
  const cue = el('input', { type: 'text', value: routine?.cue ?? '', placeholder: '저녁 먹고 나면' });
  const action = el('input', { type: 'text', value: routine?.action ?? '', placeholder: '기출 20문항' });
  const minimum = el('input', { type: 'text', value: routine?.minimum ?? '', placeholder: '5문항' });
  const tag = el('select', {},
    el('option', { value: 'study', text: '공부' }),
    el('option', { value: 'read', text: '독서' }),
    el('option', { value: 'other', text: '그 외' }));
  tag.value = routine?.tag ?? 'study';

  const picked = new Set(routine?.days ?? [1, 2, 3, 4, 5]);
  const dayBtns = DAY_NAMES.map((name, i) =>
    el('button', {
      type: 'button',
      class: 'day' + (picked.has(i) ? ' on' : ''),
      text: name,
      'aria-pressed': picked.has(i) ? 'true' : 'false',
      onclick: (e) => {
        const on = picked.has(i);
        if (on) picked.delete(i);
        else picked.add(i);
        e.currentTarget.classList.toggle('on', !on);
        e.currentTarget.setAttribute('aria-pressed', String(!on));
      },
    }));

  const submit = () => {
    if (!val(cue)) return toast('언제/어디서를 적어주세요. 트리거 없는 루틴은 지켜지지 않습니다.', 'warn');
    if (!val(action)) return toast('무엇을 할지 적어주세요.', 'warn');
    if (!val(minimum)) return toast('최소 버전을 적어주세요. 이게 연속 기록을 살립니다.', 'warn');
    if (!picked.size) return toast('요일을 하나 이상 고르세요.', 'warn');

    const fields = {
      cue: val(cue), action: val(action), minimum: val(minimum),
      tag: tag.value, days: [...picked].sort((a, b) => a - b),
    };
    if (routine) Object.assign(routine, fields);
    else state.routines.push({ id: uid(), goalId: goal.id, leadId: lead.id, createdAt: today(), archived: false, ...fields });
    save();
    dialog.close();
    ctx.render();
  };

  const body = el('div', { class: 'form' },
    field('언제 / 어디서', cue, '구현 의도. 이 칸이 비면 루틴은 거의 지켜지지 않습니다.'),
    field('무엇을', action),
    field('최소 버전', minimum, '바쁜 날 이것만 해도 연속 기록이 유지됩니다.'),
    field('종류', tag, '공부·독서여야 파인만 노트를 남길 수 있습니다.'),
    group('요일', el('div', { class: 'days' }, dayBtns)),
    el('button', { class: 'btn primary wide', text: routine ? '저장' : '만들기', onclick: submit }));

  const dialog = modal(routine ? '루틴 수정' : '새 루틴', body);
  return dialog;
}

// ---------- 렌더 ----------

function leadBlock(goal, lead, ctx) {
  const done = leadProgress(goal, lead, weekStart());
  const pct = Math.min(100, Math.round((done / lead.target) * 100));
  const unitLabel = UNIT_LABEL[lead.unit] ?? '';
  const routines = activeRoutines().filter((r) => r.leadId === lead.id);

  return el('div', { class: 'lead' },
    el('div', { class: 'lead-head' },
      el('strong', { text: lead.title }),
      el('span', { class: 'lead-num', text: done + ' / ' + lead.target + unitLabel })),
    el('div', { class: 'bar' },
      el('div', { class: 'bar-fill' + (pct >= 100 ? ' full' : ''), style: 'width:' + pct + '%' })),
    routines.length
      ? el('ul', { class: 'routine-list' }, routines.map((r) =>
          el('li', {},
            el('span', { class: 'r-text', text: r.cue + ' → ' + r.action }),
            el('span', { class: 'r-days', text: r.days.map((d) => DAY_NAMES[d]).join('') }),
            el('button', { class: 'link', text: '수정', onclick: () => routineForm(goal, lead, r, ctx) }),
            el('button', {
              class: 'link danger', text: '삭제',
              onclick: () => {
                if (!confirmed('루틴 "' + r.action + '"을 삭제할까요? 지난 기록은 남습니다.')) return;
                r.archived = true;
                save();
                ctx.render();
              },
            }))))
      : null,
    el('div', { class: 'lead-actions' },
      el('button', { class: 'link', text: '+ 루틴', onclick: () => routineForm(goal, lead, null, ctx) }),
      el('button', { class: 'link', text: '지표 수정', onclick: () => leadForm(goal, lead, ctx) })));
}

function goalCard(goal, ctx) {
  const dday = goal.deadline ? daysBetween(today(), goal.deadline) : null;
  const ddayText = dday === null ? null : dday === 0 ? 'D-DAY' : dday > 0 ? 'D-' + dday : 'D+' + -dday;

  return el('article', { class: 'card goal' },
    el('header', { class: 'goal-head' },
      el('h2', { text: goal.title }),
      ddayText && el('span', { class: 'dday' + (dday < 0 ? ' past' : ''), text: ddayText })),
    goal.leads.length
      ? el('div', { class: 'leads' }, goal.leads.map((l) => leadBlock(goal, l, ctx)))
      : el('p', { class: 'hint', text: '선행지표가 없습니다. 이 목표를 움직이는 주간 행동량을 정하세요.' }),
    el('div', { class: 'card-actions' },
      el('button', { class: 'link', text: '+ 선행지표', onclick: () => leadForm(goal, null, ctx) }),
      el('button', { class: 'link', text: '목표 수정', onclick: () => goalForm(goal, ctx) }),
      el('button', {
        class: 'link danger', text: '보관',
        onclick: () => {
          if (!confirmed('"' + goal.title + '"을 보관할까요? 기록은 남습니다.')) return;
          goal.archived = true;
          save();
          ctx.render();
        },
      })));
}

/**
 * 보관한 목표를 되돌리거나 완전히 지운다.
 *
 * 보관하면 화면에서 아예 사라져 되돌릴 방법이 없었다. 잘못 눌러도 복구가 안 되니
 * 접어둔 채로 남겨두고, 여기서만 완전 삭제를 할 수 있게 한다.
 */
function archivedSection(ctx) {
  const archived = state.goals.filter((g) => g.archived);
  if (!archived.length) return null;

  const row = (goal) => {
    const routines = state.routines.filter((r) => r.goalId === goal.id);
    return el(
      'li',
      {},
      el('span', { class: 'a-title', text: goal.title }),
      el('span', { class: 'a-meta', text: `루틴 ${routines.length}개` }),
      el('button', {
        class: 'link',
        text: '되돌리기',
        onclick: () => {
          goal.archived = false;
          save();
          ctx.render();
          toast('되돌렸습니다. 오늘 화면에 다시 나옵니다.');
        },
      }),
      el('button', {
        class: 'link danger',
        text: '완전 삭제',
        onclick: () => {
          if (
            !confirmed(
              `"${goal.title}"과 루틴 ${routines.length}개를 완전히 지웁니다.
` +
                '지난 세션 기록과 노트는 남습니다. 되돌릴 수 없습니다.',
            )
          )
            return;
          state.goals.splice(state.goals.indexOf(goal), 1);
          // 뒤에서부터 지운다. 앞에서 지우면 인덱스가 밀린다.
          for (let i = state.routines.length - 1; i >= 0; i--) {
            if (state.routines[i].goalId === goal.id) state.routines.splice(i, 1);
          }
          save();
          ctx.render();
          toast('지웠습니다.');
        },
      }),
    );
  };

  return el(
    'details',
    { class: 'archive' },
    el('summary', { text: `보관한 목표 ${archived.length}개` }),
    el('ul', { class: 'archive-list' }, archived.map(row)),
  );
}

export default function renderGoals(ctx) {
  const goals = activeGoals();
  return el('section', { class: 'view' },
    el('header', { class: 'view-head' },
      el('h1', { text: '목표' }),
      el('p', { class: 'sub', text: '통제할 수 없는 결과 아래에, 통제할 수 있는 행동을 둡니다.' })),
    goals.length
      ? el('div', { class: 'cards' }, goals.map((g) => goalCard(g, ctx)))
      : el('div', { class: 'empty' }, el('p', { text: '아직 목표가 없습니다.' })),
    el('button', { class: 'btn primary wide', text: '+ 새 목표', onclick: () => goalForm(null, ctx) }),
    archivedSection(ctx));
}
