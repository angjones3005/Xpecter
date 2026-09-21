import { describe, expect, it } from 'vitest';
import { renderMarkdown, taskMarkerAt } from './markdown';

// Every checkbox the reading view renders must correspond to the task
// marker taskMarkerAt finds at the same index, or a tick lands on the
// wrong line. The two are checked against each other here.
function renderedCheckboxes(text: string): number {
  return (renderMarkdown(text).html.match(/<input type="checkbox" class="md-task"/g) ?? []).length;
}

function markers(text: string): { line: number; checked: boolean }[] {
  const out = [];
  for (let i = 0; ; i += 1) {
    const marker = taskMarkerAt(text, i);
    if (!marker) break;
    out.push({ line: marker.line, checked: marker.checked });
  }
  return out;
}

describe('taskMarkerAt', () => {
  it('numbers plain tasks in document order', () => {
    const text = '- [ ] one\n- [x] two\n\n1. [ ] three\n';
    expect(markers(text)).toEqual([
      { line: 0, checked: false },
      { line: 1, checked: true },
      { line: 3, checked: false },
    ]);
    expect(renderedCheckboxes(text)).toBe(3);
    expect(taskMarkerAt(text, 0)!.column).toBe(3);
  });

  it('counts tasks inside callouts and blockquotes, which render as checkboxes', () => {
    const text = '> [!todo] Today\n> - [ ] inside a callout\n\n> - [x] inside a quote\n\n- [ ] after\n';
    expect(renderedCheckboxes(text)).toBe(3);
    expect(markers(text).map((m) => m.line)).toEqual([1, 3, 5]);
    expect(taskMarkerAt(text, 0)!.column).toBe(5);
  });

  it('skips an empty box, which marked renders as text', () => {
    const text = '- [ ]\n- [ ] real\n';
    expect(renderedCheckboxes(text)).toBe(1);
    expect(markers(text).map((m) => m.line)).toEqual([1]);
  });

  it('skips fenced code', () => {
    const text = '```\n- [ ] not a task\n```\n- [ ] task\n~~~md\n- [x] nor this\n~~~\n';
    expect(renderedCheckboxes(text)).toBe(1);
    expect(markers(text).map((m) => m.line)).toEqual([3]);
  });

  it('counts nested tasks', () => {
    const text = '- [ ] parent\n  - [x] child\n    - [ ] grandchild\n';
    expect(renderedCheckboxes(text)).toBe(3);
    expect(markers(text).map((m) => m.line)).toEqual([0, 1, 2]);
  });

  it('answers null past the last task', () => {
    expect(taskMarkerAt('- [ ] only\n', 1)).toBeNull();
    expect(taskMarkerAt('no tasks here', 0)).toBeNull();
  });
});
