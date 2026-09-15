// 노트를 마크다운으로 내보낸다. 카카오톡·노션·메모 어디에 붙여넣어도 읽힌다.
//
// 기본적으로 문제 전문은 포함하지 않는다. 공유되는 본문은 내 설명이어야 한다.
// 문제집에서 전사한 지문이 링크를 타고 퍼지는 건 이 앱이 할 일이 아니다.

import { CONFIDENCE } from './store.js';
import { questionById } from './exam.js';

function sourceLine(note) {
  const s = note.source ?? {};
  if (s.kind === 'exam') return `출처: ${s.title}${s.locator ? ` · ${s.locator}` : ''}`;
  if (s.kind === 'book') return `출처: ${s.title}${s.locator ? ` p.${s.locator}` : ''}`;
  if (s.title) return `출처: ${s.title}`;
  return null;
}

export function noteToMarkdown(note, { includeQuestion = false } = {}) {
  const out = [];
  out.push(`## ${note.concept || '(제목 없음)'}`);

  const src = sourceLine(note);
  if (src) out.push(`> ${src}`);
  out.push('');

  if (includeQuestion && note.source?.examId) {
    const q = questionById(note.source.examId);
    if (q) {
      out.push('**문제**');
      out.push('');
      out.push(q.question.split('\n').map((l) => `> ${l}`).join('\n'));
      if (q.given?.length) {
        out.push('>');
        out.push(q.given.map((g) => `> - ${g}`).join('\n'));
      }
      out.push('');
    }
  }

  out.push(note.explanation?.trim() || '_(설명 없음)_');
  out.push('');

  if (note.analogy?.trim()) {
    out.push(`**비유** — ${note.analogy.trim()}`);
    out.push('');
  }

  if (note.gaps?.length) {
    out.push('### 막힌 곳');
    for (const g of note.gaps) out.push(`- [${g.resolved ? 'x' : ' '}] ${g.text}`);
    out.push('');
  }

  const c = CONFIDENCE[note.confidence] ?? CONFIDENCE[2];
  out.push(`_${note.date} · ${c.emoji} ${c.label} · 복습 ${note.reviews?.length ?? 0}회_`);

  return out.join('\n');
}

export function notesToMarkdown(notes, opts = {}) {
  if (notes.length === 1) return noteToMarkdown(notes[0], opts);
  const head = `# 정리 노트 ${notes.length}개\n`;
  return head + '\n' + notes.map((n) => noteToMarkdown(n, opts)).join('\n\n---\n\n');
}
