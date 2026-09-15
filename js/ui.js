// DOM 헬퍼.
// 노트 본문은 사용자가 쓴 임의의 텍스트다. innerHTML을 쓰지 않고 textContent로만 넣어
// 주입 가능성을 원천적으로 없앤다.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') throw new Error('html 속성은 쓰지 않는다. text를 써라.');
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(node) {
  node.replaceChildren();
  return node;
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  const box = $('#toast');
  if (!box) return;
  box.textContent = message;
  box.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.className = 'toast'), 2600);
}

// 확인이 필요한 파괴적 동작에만 쓴다.
export const confirmed = (message) => window.confirm(message);

export function modal(title, bodyNode, { onClose } = {}) {
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const wrap = el(
    'div',
    { class: 'modal-wrap', onclick: (e) => e.target === wrap && close() },
    el(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el(
        'header',
        { class: 'modal-head' },
        el('h2', { text: title }),
        el('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: close, text: '✕' })
      ),
      el('div', { class: 'modal-body' }, bodyNode)
    )
  );
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  // 닫기 버튼에 포커스가 가면 폰에서 키보드가 올라오지 않는다. 첫 입력칸을 잡는다.
  const target = wrap.querySelector('.modal-body input, .modal-body textarea, .modal-body select')
    ?? wrap.querySelector('.modal-head button');
  target?.focus();
  return { close, node: wrap };
}

// 파일 하나를 텍스트로 읽는다. 여러 개면 순서대로.
export function pickFiles({ accept = '.json', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, style: 'display:none' });
    input.addEventListener('change', async () => {
      const files = [...input.files];
      const results = [];
      for (const file of files) results.push({ name: file.name, text: await file.text() });
      input.remove();
      resolve(results);
    });
    document.body.append(input);
    input.click();
  });
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 클립보드 권한이 없거나 보안 컨텍스트가 아닐 때. 조용히 실패시키지 않는다.
    return false;
  }
}
