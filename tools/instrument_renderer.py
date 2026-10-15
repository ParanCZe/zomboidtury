#!/usr/bin/env python3
"""Instrument real BO1 renderer and post-gfx asset synchronization.

This runs after mobile-port.patch.gz AND instrument_boot.py. Adds diagnostics
without skipping graphics operations or bypassing capability validation.
It deliberately fails closed on unknown upstream C++ source.
"""
from pathlib import Path
import argparse
import re
import sys

R_INIT = [
    ('    if ( !R_CreateDevice(wndParms) )\n        return 0;',
     '    KB_WebBootPhase("Renderer: before R_CreateDevice");\n'
     '    if ( !R_CreateDevice(wndParms) )\n        return 0;\n'
     '    KB_WebBootPhase("Renderer: R_CreateDevice returned successfully", true);'),
    ('    if ( useFastFile->current.enabled )\n        DB_LoadGraphicsAssetsForPC();',
     '    if ( useFastFile->current.enabled )\n    {\n'
     '        KB_WebBootPhase("Renderer: before DB_LoadGraphicsAssetsForPC");\n'
     '        DB_LoadGraphicsAssetsForPC();\n'
     '        KB_WebBootPhase("Renderer: after DB_LoadGraphicsAssetsForPC", true);\n'
     '    }'),
    ('    R_UpdateGpuSyncType();',
     '    KB_WebBootPhase("Renderer: before R_UpdateGpuSyncType");\n'
     '    R_UpdateGpuSyncType();'),
    ('    failed = R_CreateForInitOrReset() == 0;',
     '    KB_WebBootPhase("Renderer: before R_CreateForInitOrReset", true);\n'
     '    failed = R_CreateForInitOrReset() == 0;\n'
     '    KB_WebBootPhase("Renderer: after R_CreateForInitOrReset", true);'),
    ('    RB_SetInitialState();',
     '    KB_WebBootPhase("Renderer: before RB_SetInitialState");\n'
     '    RB_SetInitialState();'),
]
DEVICE = [
    ('    Com_Printf(8, "Creating Direct3D device...\\n");',
     '    KB_WebBootPhase("Renderer: entering D3D CreateDeviceInternal");\n'
     '    Com_Printf(8, "Creating Direct3D device...\\n");'),
    ('        hr = dx.d3d9->CreateDevice(dx.adapterIndex, (D3DDEVTYPE)DeviceType, hwnd, behavior, d3dpp, &dx.device);',
     '        KB_WebBootPhase("Renderer: before backend CreateDevice");\n'
     '        hr = dx.d3d9->CreateDevice(dx.adapterIndex, (D3DDEVTYPE)DeviceType, hwnd, behavior, d3dpp, &dx.device);\n'
     '        if (hr >= 0) KB_WebBootPhase("Renderer: backend CreateDevice succeeded", true);\n'
     '        else KB_WebBootPhase("Renderer: backend CreateDevice failed (retry follows)");'),
    ('    dx.nvStereoActivated = 0;',
     '    KB_WebBootPhase("Renderer: D3D device loop completed");\n'
     '    dx.nvStereoActivated = 0;')
]
DB_GRAPHICS = [
    ('    zoneInfo[0].name = "code_post_gfx_mp";',
     '    KB_WebBootPhase("DB gfx: enter DB_LoadGraphicsAssetsForPC");\n'
     '    zoneInfo[0].name = "code_post_gfx_mp";'),
    ('    DB_LoadXAssets(zoneInfo, zoneCount, 0);\n    DB_SyncXAssets();',
     '    KB_WebBootPhase("DB gfx: before first DB_LoadXAssets", true);\n'
     '    DB_LoadXAssets(zoneInfo, zoneCount, 0);\n'
     '    KB_WebBootPhase("DB gfx: after first DB_LoadXAssets; before explicit DB_SyncXAssets", true);\n'
     '    DB_SyncXAssets();\n'
     '    KB_WebBootPhase("DB gfx: after explicit DB_SyncXAssets", true);'),
    ('    DB_LoadXAssets(zoneInfo, zoneCount, 0);\n}',
     '    KB_WebBootPhase("DB gfx: before secondary fastfiles");\n'
     '    DB_LoadXAssets(zoneInfo, zoneCount, 0);\n'
     '    KB_WebBootPhase("DB gfx: finished scheduling secondary fastfiles");\n}')
]
DB_SYNC = [
    ('    R_BeginRemoteScreenUpdate();',
     '    KB_WebBootPhase("DB sync: before remote screen update");\n'
     '    R_BeginRemoteScreenUpdate();'),
    ('    Sys_SyncDatabase();',
     '    KB_WebBootPhase("DB sync: before Sys_SyncDatabase", true);\n'
     '    Sys_SyncDatabase();\n'
     '    KB_WebBootPhase("DB sync: after Sys_SyncDatabase", true);'),
    ('    DB_PostLoadXZone();',
     '    KB_WebBootPhase("DB sync: before DB_PostLoadXZone");\n'
     '    DB_PostLoadXZone();')
]

# The post-gfx queue is followed by DB_SyncXAssets → Sys_SyncDatabase.
# Surface a single heartbeat every 5 seconds if the cooperative DB fiber never
# sets databaseCompletedEvent. This is observation only: no fake completion,
# no unsafe sleeps inside an active Asyncify fiber, no shortened wait.
DB_WAIT = [
    ('    while ( !Sys_WaitForSingleObjectTimeout(&databaseCompletedEvent, 1u) )',
     '    KB_WebBootPhase("DB wait: entering Sys_SyncDatabase");\n'
     '    auto kbLastProgress = std::chrono::steady_clock::now();\n'
     '    while ( !Sys_WaitForSingleObjectTimeout(&databaseCompletedEvent, 1u) )'),
    ('        SocketRouter_EmergencyFrame();\n    }\n}',
     '        SocketRouter_EmergencyFrame();\n'
     '        if (std::chrono::steady_clock::now() - kbLastProgress >= std::chrono::seconds(5))\n'
     '        {\n'
     '            kbLastProgress = std::chrono::steady_clock::now();\n'
     '            KB_WebBootPhase("DB wait: still waiting for databaseCompletedEvent");\n'
     '        }\n'
     '    }\n'
     '    KB_WebBootPhase("DB wait: databaseCompletedEvent signaled");\n}')
]

def patch_function(text: str, signature: str, changes: list):
    if text.count(signature) != 1:
        raise RuntimeError(f'Expected unique function signature: {signature!r}')
    start = text.index(signature)
    end = text.find('\n}\n', start)
    if end < 0:
        raise RuntimeError(f'No function closing brace: {signature}')
    end += len('\n}\n')
    chunk = text[start:end]
    for old, new in changes:
        if chunk.count(old) != 1:
            raise RuntimeError(f'{signature}: anchor missing/ambiguous ({chunk.count(old)}): {old!r}')
        chunk = chunk.replace(old, new, 1)
    return text[:start] + chunk + text[end:]

def patch_file(path: Path, specs: list):
    original = path.read_text(encoding='utf-8')
    if 'boot_trace_web.h' in original:
        raise RuntimeError(f'Already instrumented: {path}')
    updated = '#include <qcommon/boot_trace_web.h>\n' + (('#include <chrono>\n' + original) if path.name == 'threads.cpp' else original)
    for signature, changes in specs:
        updated = patch_function(updated, signature, changes)
    path.write_text(updated, encoding='utf-8')
    print(f'[renderer-trace] {path}: inserted {sum(len(changes) for _,changes in specs)} checkpoint groups')

def run(root: Path):
    gfx = root / 'src/gfx_d3d/r_init.cpp'
    db = root / 'src/database/db_registry.cpp'
    threads = root / 'src/qcommon/threads.cpp'
    for path in (gfx, db, threads):
        if not path.is_file():
            raise RuntimeError(f'Engine source missing: {path}')
    # Restore both files on failure so no partially patched source is compiled.
    originals = {p:p.read_bytes() for p in (gfx, db, threads)}
    try:
        patch_file(gfx, [('char __cdecl R_InitHardware(const GfxWindowParms *wndParms)', R_INIT),
                         ('HRESULT __cdecl R_CreateDeviceInternal(HWND__ *hwnd, unsigned int behavior, _D3DPRESENT_PARAMETERS_ *d3dpp)', DEVICE)])
        patch_file(db, [('void __cdecl DB_LoadGraphicsAssetsForPC()', DB_GRAPHICS),
                        ('void __cdecl DB_SyncXAssets()', DB_SYNC)])
        patch_file(threads, [('void __cdecl Sys_SyncDatabase()', DB_WAIT)])
    except Exception:
        for path, original in originals.items():
            path.write_bytes(original)
        raise

def self_test():
    for name, group in [('renderer',R_INIT),('device',DEVICE),('database',DB_GRAPHICS),('sync',DB_SYNC),('database-wait',DB_WAIT)]:
        sample='\n'.join(old for old, _ in group)
        for old, new in group:
            if sample.count(old) != 1:
                raise AssertionError(f'{name}: bad test fixture: {old!r}')
            sample=sample.replace(old,new,1)
        assert 'KB_WebBootPhase' in sample
    assert 'DB sync: after Sys_SyncDatabase' in str(DB_SYNC)
    assert 'Renderer: backend CreateDevice succeeded' in str(DEVICE)
    print('[renderer-trace] change groups and phase names PASS')

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('root',nargs='?',type=Path)
    parser.add_argument('--self-test',action='store_true')
    a=parser.parse_args()
    try:
        if a.self_test:
            self_test()
        elif a.root:
            run(a.root)
        else:
            parser.error('specify root or --self-test')
    except Exception as error:
        print(f'[renderer-trace] ERROR: {error}',file=sys.stderr)
        sys.exit(1)
