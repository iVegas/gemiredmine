import { describe, it, expect } from 'vitest';
import { MAX_GLIBC, findProblems, maxGlibcVersion } from '../check-linux-binary.mjs';

const OBJDUMP = (...versions: string[]) =>
  versions.map((version) => `0000000000000000      DF *UND*\t0000000000000000 (GLIBC_${version}) memcpy`).join('\n');

const LDD = `
\tlinux-vdso.so.1 (0x00007ffc)
\tlibwebkit2gtk-4.1.so.0 => /lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0 (0x00007f00)
\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f01)
`;

describe('maxGlibcVersion', () => {
  it('compares versions as numbers, not text', () => {
    expect(maxGlibcVersion(OBJDUMP('2.9', '2.17', '2.34', '2.4'))).toBe('2.34');
    expect(maxGlibcVersion(OBJDUMP('2.35', '2.4'))).toBe('2.35');
    expect(maxGlibcVersion(OBJDUMP('2.100', '2.39'))).toBe('2.100');
  });

  it('is null when the output names no glibc version', () => {
    expect(maxGlibcVersion('statically linked')).toBeNull();
  });
});

describe('findProblems', () => {
  it('accepts an executable that is built on the oldest supported system', () => {
    expect(findProblems({ ldd: LDD, objdump: OBJDUMP('2.17', MAX_GLIBC) })).toEqual([]);
  });

  it('rejects one that needs a newer glibc, which would not start on the oldest systems', () => {
    expect(findProblems({ ldd: LDD, objdump: OBJDUMP('2.35', '2.39') })).toEqual([
      'It needs glibc 2.39, and 2.35 is the newest supported.',
    ]);
  });

  it('rejects a library the build machine could not find', () => {
    const ldd = `${LDD}\tlibfoo.so.1 => not found\n`;

    expect(findProblems({ ldd, objdump: OBJDUMP('2.17') })).toEqual(['A library is missing: libfoo.so.1 => not found']);
  });

  it('rejects a tray library, which the app does not use and many desktops lack', () => {
    const ldd = `${LDD}\tlibayatana-appindicator3.so.1 => /usr/lib/libayatana-appindicator3.so.1 (0x1)\n`;

    expect(findProblems({ ldd, objdump: OBJDUMP('2.17') })).toEqual([
      'A tray library is linked: libayatana-appindicator3.so.1 => /usr/lib/libayatana-appindicator3.so.1 (0x1)',
    ]);
  });

  it('rejects output that is not from a Linux executable', () => {
    expect(findProblems({ ldd: 'not a dynamic executable', objdump: '' })).toEqual([
      'No GLIBC symbol versions were found; is this a Linux executable?',
    ]);
  });
});
