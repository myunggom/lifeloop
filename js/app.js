import { el, clear, modal } from './ui.js';
import { dueNotes, today, setOnSaved } from './store.js';
import { SYNCED_EVENT, scheduleSync } from './sync.js';
import renderToday from './views/today.js';
import renderGoals from './views/goals.js';
import renderNotes from './views/notes.js';
import renderReview from './views/review.js';
import renderWeekly from './views/weekly.js';

const TABS = [
  { key: 'today', label: '오늘', render: renderToday },
  { key: 'goals', label: '목표', render: renderGoals },
  { key: 'notes', label: '노트', render: renderNotes },
  { key: 'review', label: '복습', render: renderReview },
  { key: 'weekly', label: '주간', render: renderWeekly },
];

let activeTab = 'today';
let params = {};

const main = document.getElementById('main');
const tabbar = document.getElementById('tabbar');

const ctx = {
  get params() {
    return params;
  },
  render,
  navigate(tab, nextParams = {}) {
    activeTab = tab;
    params = nextParams;
    render();
    main.scrollTo(0, 0);
  },
  // 공부·독서 루틴을 끝낸 직후에만 한 번 권한다. 거절하면 그걸로 끝이다.
  suggestNote(routine) {
    const dlg = modal(
      '오늘 하나만',
      el('div', { class: 'form' },
        el('p', { text: `"${routine.action}" 을 끝냈습니다. 방금 배운 것 중 하나를 내 말로 설명해볼까요?` }),
        el('p', { class: 'hint', text: '3분이면 됩니다. 막히는 곳이 나오면 그게 다음 공부거리가 됩니다.' }),
        el('button', {
          class: 'btn primary wide', text: '정리하기',
          onclick: () => { dlg.close(); ctx.navigate('notes', { compose: true }); },
        }),
        el('button', { class: 'btn ghost wide', text: '오늘은 넘어가기', onclick: () => dlg.close() }))
    );
  },
};

function renderTabs() {
  const due = dueNotes(today()).length;
  clear(tabbar);
  for (const tab of TABS) {
    tabbar.append(el('button', {
      class: 'tab' + (tab.key === activeTab ? ' on' : ''),
      'aria-current': tab.key === activeTab ? 'page' : null,
      onclick: () => ctx.navigate(tab.key),
    },
      el('span', { text: tab.label }),
      tab.key === 'review' && due ? el('span', { class: 'badge', text: String(due) }) : null));
  }
}

function render() {
  const tab = TABS.find((t) => t.key === activeTab) ?? TABS[0];
  const view = tab.render(ctx);
  clear(main).append(view);
  // 파라미터는 한 번만 쓰인다. 다음 렌더에서 모달이 다시 뜨면 안 된다.
  params = {};
  renderTabs();
}

render();

// 기록을 남길 때마다 동기화를 예약한다. 연달아 눌러도 한 번으로 묶인다.
setOnSaved(() => scheduleSync());

// 다른 기기에서 들어온 것이 화면에 바로 보이게 한다
window.addEventListener(SYNCED_EVENT, () => render());

// 앱을 열 때, 다시 돌아올 때, 인터넷이 돌아올 때 맞춘다
scheduleSync(0);
window.addEventListener('online', () => scheduleSync(0));

// 앱을 닫았다 열면 "오늘"부터 시작하는 게 맞다. 날짜가 바뀌면 화면도 새로 그린다.
let lastSeenDate = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  scheduleSync(0);
  if (today() !== lastSeenDate) {
    lastSeenDate = today();
    ctx.navigate('today');
  } else {
    render();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('서비스워커 등록 실패:', err));
  });
}
