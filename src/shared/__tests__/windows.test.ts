import { describe, it, expect } from 'vitest';
import { containsPoint, dropGap, stableJson, viewFromHash, viewWindowHash } from '../windows';

const tabs = [
  { left: 0, right: 100 },
  { left: 104, right: 200 },
  { left: 204, right: 300 },
];

describe('dropGap', () => {
  it('picks the gap nearest the pointer, by the middle of each tab', () => {
    expect(dropGap(10, tabs)).toBe(0);
    expect(dropGap(60, tabs)).toBe(1);
    expect(dropGap(160, tabs)).toBe(2);
    expect(dropGap(290, tabs)).toBe(3);
    expect(dropGap(900, tabs)).toBe(3);
  });

  it('never picks a gap before the first movable tab', () => {
    expect(dropGap(10, tabs, 1)).toBe(1);
    expect(dropGap(-50, tabs, 1)).toBe(1);
    expect(dropGap(290, tabs, 1)).toBe(3);
  });
});

describe('containsPoint', () => {
  const rect = { x: 10, y: 20, width: 100, height: 40 };

  it('includes the edges and the margin around the rectangle', () => {
    expect(containsPoint(rect, { x: 10, y: 20 })).toBe(true);
    expect(containsPoint(rect, { x: 110, y: 60 })).toBe(true);
    expect(containsPoint(rect, { x: 115, y: 40 })).toBe(false);
    expect(containsPoint(rect, { x: 115, y: 40 }, 8)).toBe(true);
    expect(containsPoint(rect, { x: 60, y: 10 }, 8)).toBe(false);
  });
});

describe('view window URLs', () => {
  it('names the view in the URL fragment', () => {
    expect(viewWindowHash('calendar')).toBe('#view=calendar');
    expect(viewFromHash('#view=calendar')).toBe('calendar');
  });

  it('names no view in the main window', () => {
    expect(viewFromHash('')).toBeNull();
    expect(viewFromHash('#other=1')).toBeNull();
  });
});

describe('stableJson', () => {
  it('gives the same text for objects that differ only in the order of their keys', () => {
    const one = { servers: [{ id: 's1', name: 'Dev', nested: { b: 1, a: 2 } }], activeServerId: 's1' };
    const other = { activeServerId: 's1', servers: [{ nested: { a: 2, b: 1 }, name: 'Dev', id: 's1' }] };

    expect(stableJson(one)).toBe(stableJson(other));
  });

  it('still tells different values apart, and keeps the order of arrays', () => {
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
    expect(stableJson({ a: [{ b: 1 }] })).toBe('{"a":[{"b":1}]}');
  });

  it('copes with values that are not objects', () => {
    expect(stableJson(null)).toBe('null');
    expect(stableJson('text')).toBe('"text"');
    expect(stableJson({ a: undefined, b: null })).toBe('{"b":null}');
  });
});
