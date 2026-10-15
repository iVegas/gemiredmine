import { describe, it, expect } from 'vitest';
import type { execFileSync } from 'node:child_process';
import { dependentsOf, findDumpbin, findProblems } from '../check-windows-binary.mjs';

const dumpbin = (...dlls: string[]) => `Microsoft (R) COFF/PE Dumper Version 14.44.35214.0
Copyright (C) Microsoft Corporation.  All rights reserved.


Dump of file src-tauri\\target\\release\\Gemiredmine-Unstable.exe

File Type: EXECUTABLE IMAGE

  Image has the following dependencies:

${dlls.map((dll) => `    ${dll}`).join('\n')}

  Summary

        1000 .data
        2000 .rdata
`;

describe('dependentsOf', () => {
  it('lists the DLLs and nothing from the rest of the dump', () => {
    expect(dependentsOf(dumpbin('KERNEL32.dll', 'api-ms-win-crt-runtime-l1-1-0.dll'))).toEqual([
      'KERNEL32.dll',
      'api-ms-win-crt-runtime-l1-1-0.dll',
    ]);
  });

  it('includes delay-loaded DLLs', () => {
    const output = `${dumpbin('KERNEL32.dll')}\n  Image has the following delay load dependencies:\n\n    dwmapi.dll\n`;

    expect(dependentsOf(output)).toEqual(['KERNEL32.dll', 'dwmapi.dll']);
  });
});

describe('findProblems', () => {
  it('accepts an executable that needs only Windows components', () => {
    expect(findProblems(dumpbin('ADVAPI32.dll', 'KERNEL32.dll', 'USER32.dll', 'api-ms-win-crt-heap-l1-1-0.dll', 'bcrypt.dll'))).toEqual([]);
  });

  it.each(['VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'MSVCP140.dll', 'CONCRT140.dll', 'WebView2Loader.dll'])('rejects %s', (dll) => {
    expect(findProblems(dumpbin('KERNEL32.dll', dll))).toEqual([`It needs ${dll}, which a clean Windows does not have.`]);
  });

  it('rejects output that lists nothing, so a failed dumpbin cannot pass', () => {
    expect(findProblems('LINK : fatal error LNK1181: cannot open input file')).toEqual([
      'dumpbin listed no dependencies; is this a Windows executable?',
    ]);
  });
});

describe('findDumpbin', () => {
  it('takes the path from DUMPBIN when it is set', () => {
    expect(findDumpbin({ env: { DUMPBIN: 'C:\\tools\\dumpbin.exe' } })).toBe('C:\\tools\\dumpbin.exe');
  });

  it('says what to install when there is none', () => {
    const run = (() => '') as unknown as typeof execFileSync;

    expect(() => findDumpbin({ env: { 'ProgramFiles(x86)': '/nowhere' }, run })).toThrow('Install the Visual Studio C++ build tools');
  });
});
