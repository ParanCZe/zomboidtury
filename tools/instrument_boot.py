#!/usr/bin/env python3
"""Add WebAssembly boot-phase checkpoints to the pinned KisakBlack source tree.

Runs AFTER applying mobile-port.patch.gz and BEFORE compiling. Fails if source
anchors change; never silently builds an uninstru­mented or incompatible engine.

On the single-threaded Asyncify build, selected transitions yield to the
browser event loop for 1 ms, avoiding an unbroken synchronous Com_Init chain.
This is diagnostic, not a claim that gameplay itself is fixed.
"""
from pathlib import Path
import argparse
import re
import sys

HEADER = r'''#pragma once
// Generated/installed by tools/instrument_boot.py; WebAssembly bring-up only.
#if defined(__EMSCRIPTEN__) && !defined(__EMSCRIPTEN_PTHREADS__)
#include <emscripten.h>
#include <stdio.h>
static inline void KB_WebBootPhase(const char* stage, bool yield_to_browser = false) {
    // Store the checkpoint immediately, before a possibly blocking C++ call.
    // The page's KBZBootLog.phase synchronously persists it in localStorage.
    EM_ASM({
        var phase = UTF8ToString($0);
        if (typeof globalThis !== 'undefined' &&
            globalThis.KBZBootLog && typeof globalThis.KBZBootLog.phase === 'function') {
            globalThis.KBZBootLog.phase('ENGINE C++: ' + phase);
        }
    }, stage);
    if (yield_to_browser)
        emscripten_sleep(1);
}
#else
static inline void KB_WebBootPhase(const char*, bool = false) {}
#endif
'''

MAIN_CHECKPOINTS = [
    ('    FS_InitFilesystem(1);',
     '    KB_WebBootPhase("Com_Init: before FS_InitFilesystem");\n'
     '    FS_InitFilesystem(1);\n'
     '    KB_WebBootPhase("Com_Init: after FS_InitFilesystem", true);'),
    ('    Con_InitChannels();',
     '    KB_WebBootPhase("Com_Init: before Con_InitChannels");\n'
     '    Con_InitChannels();'),
    ('    TaskManager2_Init();',
     '    KB_WebBootPhase("Com_Init: before TaskManager2_Init", true);\n'
     '    TaskManager2_Init();'),
    ('    DDL_Init();',
     '    KB_WebBootPhase("Com_Init: before DDL_Init", true);\n'
     '    DDL_Init();'),
    ('    Com_InitClientGameStates();',
     '    KB_WebBootPhase("Com_Init: before Com_InitClientGameStates");\n'
     '    Com_InitClientGameStates();'),
    ('        Com_StartupConfigs(localClientNum);',
     '        KB_WebBootPhase("Com_Init: before Com_StartupConfigs", true);\n'
     '        Com_StartupConfigs(localClientNum);'),
    ('    Cbuf_Execute(0, ControllerIndex);',
     '    KB_WebBootPhase("Com_Init: before Cbuf_Execute", true);\n'
     '    Cbuf_Execute(0, ControllerIndex);'),
    ('    R_StreamSetInitData(Com_CalculateStreamBuffer());',
     '    KB_WebBootPhase("Com_Init: before renderer stream init", true);\n'
     '    R_StreamSetInitData(Com_CalculateStreamBuffer());'),
    ('    Com_InitHunkMemory();',
     '    KB_WebBootPhase("Com_Init: before Com_InitHunkMemory", true);\n'
     '    Com_InitHunkMemory();'),
    ('    Hunk_UserStartup();',
     '    KB_WebBootPhase("Com_Init: before Hunk_UserStartup");\n'
     '    Hunk_UserStartup();'),
]
FILESYSTEM_CHECKPOINTS = [
    ('    FS_Startup("main", allow_devraw);',
     '    KB_WebBootPhase("FS_InitFilesystem: before FS_Startup");\n'
     '    FS_Startup("main", allow_devraw);\n'
     '    KB_WebBootPhase("FS_InitFilesystem: after FS_Startup (IWD indexed)", true);'),
    ('    SEH_Init_StringEd();',
     '    KB_WebBootPhase("FS_InitFilesystem: before SEH_Init_StringEd", true);\n'
     '    SEH_Init_StringEd();\n'
     '    KB_WebBootPhase("FS_InitFilesystem: after SEH_Init_StringEd", true);'),
    ('    SEH_UpdateLanguageInfo();',
     '    KB_WebBootPhase("FS_InitFilesystem: before SEH_UpdateLanguageInfo");\n'
     '    SEH_UpdateLanguageInfo();\n'
     '    KB_WebBootPhase("FS_InitFilesystem: after SEH_UpdateLanguageInfo", true);'),
    ('    FS_SetRestrictions();',
     '    KB_WebBootPhase("FS_InitFilesystem: before FS_SetRestrictions");\n'
     '    FS_SetRestrictions();\n'
     '    KB_WebBootPhase("FS_InitFilesystem: after FS_SetRestrictions", true);'),
    ('    if ( !FS_IsBasePathValid() )',
     '    KB_WebBootPhase("FS_InitFilesystem: before base game validation", true);\n'
     '    if ( !FS_IsBasePathValid() )'),
]

# Keep these checkpoints synchronous: yielding here could schedule a database
# fiber while filesystem globals are only partially initialized.
STARTUP_CHECKPOINTS = [
    ('    FS_RegisterDvars();',
     '    KB_WebBootPhase("FS_Startup: before FS_RegisterDvars");\n'
     '    FS_RegisterDvars();\n'
     '    KB_WebBootPhase("FS_Startup: after FS_RegisterDvars");'),
    ('    Com_ReadCDKey();',
     '    KB_WebBootPhase("FS_Startup: directories indexed; before Com_ReadCDKey");\n'
     '    Com_ReadCDKey();\n'
     '    KB_WebBootPhase("FS_Startup: after Com_ReadCDKey");'),
]
REGISTER_CHECKPOINTS = [
    ('    v1 = (char *)Sys_DefaultCDPath();',
     '    KB_WebBootPhase("FS_RegisterDvars: initial dvars registered; before default CD path");\n'
     '    v1 = (char *)Sys_DefaultCDPath();'),
    ('    v2 = Sys_Cwd();',
     '    KB_WebBootPhase("FS_RegisterDvars: before working directory");\n'
     '    v2 = Sys_Cwd();'),
    ('    FS_GetOsFolderPath(5, ospathPersonalDocuments);',
     '    KB_WebBootPhase("FS_RegisterDvars: before personal documents path");\n'
     '    FS_GetOsFolderPath(5, ospathPersonalDocuments);\n'
     '    KB_WebBootPhase("FS_RegisterDvars: after personal documents path");'),
]
ARCHIVE_CHECKPOINTS = [
    ('        ZipFile = FS_LoadZipFile(ospath, s0[i]);',
     '        KB_WebBootPhase(ospath);\n'
     '        KB_WebBootPhase("FS archive: before FS_LoadZipFile");\n'
     '        ZipFile = FS_LoadZipFile(ospath, s0[i]);\n'
     '        KB_WebBootPhase("FS archive: after FS_LoadZipFile");'),
]

def inject_once(body: str, old: str, new: str, label: str) -> str:
    n = body.count(old)
    if n != 1:
        raise RuntimeError(f'{label}: expected exactly 1 anchor, found {n}: {old!r}')
    return body.replace(old, new, 1)

def transform(path: Path, start_pattern: str, end_pattern: str, include: str, checkpoints):
    text = path.read_text()
    begin = re.search(start_pattern, text, re.MULTILINE)
    if not begin:
        raise RuntimeError(f'{path}: could not locate target C++ function')
    end = re.search(end_pattern, text[begin.start()+1:], re.MULTILINE)
    if not end:
        raise RuntimeError(f'{path}: could not locate end of target C++ function')
    finish = begin.start() + 1 + end.start()
    scope = text[begin.start():finish]
    if 'KB_WebBootPhase(' in scope:
        raise RuntimeError(f'{path}: already instrumented: refusing duplicate injection')
    for old, new in checkpoints:
        scope = inject_once(scope, old, new, str(path))
    text = text[:begin.start()] + scope + text[finish:]
    text = inject_once(text, include[0], include[1], str(path) + ' include')
    path.write_text(text)
    print(f'[boot-trace] {path}: installed {len(checkpoints)} phase groups')

def apply(root: Path):
    header = root / 'src/qcommon/boot_trace_web.h'
    if header.exists():
        raise RuntimeError(f'{header}: already exists, refusing to overwrite')
    common = root / 'src/qcommon/common.cpp'
    filesystem = root / 'src/universal/com_files.cpp'
    for path in (common, filesystem):
        if not path.exists():
            raise RuntimeError(f'missing engine source: {path}')
    # Source patch may have changed symbols: validate every anchor before writing
    # any source files, then write the generated helper last.
    originals = {p:p.read_bytes() for p in (common, filesystem)}
    try:
        transform(
            common,
            r'^void __cdecl Com_Init_Try_Block_Function\s*\(',
            r'^void (?:__cdecl )?\w+\s*\(',
            ('#include "common.h"', '#include "common.h"\n#include <qcommon/boot_trace_web.h>'),
            MAIN_CHECKPOINTS)
        transform(
            filesystem,
            r'^void __cdecl FS_InitFilesystem\s*\(',
            r'^void (?:__cdecl )?\w+\s*\(',
            ('#include "com_files.h"', '#include "com_files.h"\n#include <qcommon/boot_trace_web.h>'),
            FILESYSTEM_CHECKPOINTS)
        # Include was already installed above; no duplicate include insertion.
        for signature, checkpoints in (
            (r'^void __cdecl FS_Startup\s*\(', STARTUP_CHECKPOINTS),
            (r'^void FS_RegisterDvars\s*\(', REGISTER_CHECKPOINTS),
            (r'^void __cdecl FS_AddIwdFilesForGameDirectory\s*\(', ARCHIVE_CHECKPOINTS),
        ):
            transform(filesystem, signature, r'^void (?:__cdecl )?\w+\s*\(',
                      ('#include <qcommon/boot_trace_web.h>',
                       '#include <qcommon/boot_trace_web.h>'), checkpoints)
        header.write_text(HEADER)
    except Exception:
        for p, data in originals.items():
            p.write_bytes(data)
        raise

def self_test():
    # Use the exact subset of source structure to ensure stage anchors are
    # non-ambiguous and the tool refuses an unknown/upstream-changed source.
    body = '\n'.join(old for old, _ in MAIN_CHECKPOINTS)
    for old, new in MAIN_CHECKPOINTS:
        body = inject_once(body, old, new, 'self-test main')
    assert body.count('KB_WebBootPhase(') == len(MAIN_CHECKPOINTS) + 1
    fs = '\n'.join(old for old, _ in FILESYSTEM_CHECKPOINTS)
    for old, new in FILESYSTEM_CHECKPOINTS:
        fs = inject_once(fs, old, new, 'self-test fs')
    assert 'FS_InitFilesystem: after FS_Startup' in fs
    assert 'FS_InitFilesystem: before base game validation' in fs
    try:
        inject_once('FS_Startup("wrong");', 'FS_Startup("main", allow_devraw);',
                    'unexpected', 'self-test missing anchor')
    except RuntimeError:
        pass
    else:
        raise AssertionError('source drift was not detected')
    for group in (STARTUP_CHECKPOINTS, REGISTER_CHECKPOINTS, ARCHIVE_CHECKPOINTS):
        body = '\n'.join(old for old, _ in group)
        for old, new in group:
            body = inject_once(body, old, new, 'self-test FS detail')
        assert 'KB_WebBootPhase(' in body
    print('[boot-trace] source anchors, checkpoint insertion and drift detection PASS')

if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('engine_root', nargs='?', type=Path)
    cli.add_argument('--self-test', action='store_true')
    args = cli.parse_args()
    try:
        if args.self_test:
            self_test()
        elif args.engine_root:
            apply(args.engine_root)
        else:
            cli.error('Supply engine_root or --self-test')
    except Exception as err:
        print(f'[boot-trace] ERROR: {err}', file=sys.stderr)
        sys.exit(1)
