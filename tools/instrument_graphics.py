#!/usr/bin/env python3
"""Trace the exact renderer / post-gfx asset startup bottleneck of mobile BO1Z.

Apply AFTER mobile-port.patch.gz AND tools/instrument_boot.py. No game data
or device capability checks are bypassed. Every expected source location must
exist once, or the build fails before touching live engine files.

The platform's cooperative WebFiber scheduler may legitimately wait for the
database fiber to read zone archives. A 5-second heartbeat distinguishes that
wait from a renderer device failure; no arbitrary timeout aborts game loading.
"""
import argparse
import re
import sys
from pathlib import Path


def inject_exact(body: str, old: str, new: str, what: str) -> str:
    count = body.count(old)
    if count != 1:
        raise RuntimeError(f'{what}: expected one source anchor, got {count}: {old[:100]!r}')
    return body.replace(old, new, 1)


def instrument_function(data: str, signature: str, replacements: list[tuple[str, str]], path: str):
    p = data.find(signature)
    if p < 0 or data.count(signature) != 1:
        raise RuntimeError(f'{path}: function signature absent or repeated: {signature}')
    opening = data.find('{', p + len(signature))
    if opening < 0:
        raise RuntimeError(f'{path}: missing function opening brace')
    # Whole functions in this source have their closing brace at column zero.
    closing = data.find('\n}\n', opening)
    if closing < 0:
        raise RuntimeError(f'{path}: missing function closing brace')
    closing += 3
    body = data[p:closing]
    if 'KB_WebBootPhase(' in body:
        raise RuntimeError(f'{path}: function was already instrumented: {signature}')
    for old, new in replacements:
        body = inject_exact(body, old, new, f'{path}/{signature}')
    return data[:p] + body + data[closing:]


def apply(root: Path):
    graphics = root / 'src/gfx_d3d/r_init.cpp'
    registry = root / 'src/database/db_registry.cpp'
    threads = root / 'src/qcommon/threads.cpp'
    header = root / 'src/qcommon/boot_trace_web.h'
    if not header.exists():
        raise RuntimeError('Run tools/instrument_boot.py first (boot_trace_web.h missing)')
    originals = {p: p.read_text() for p in (graphics, registry, threads)}
    out = {}
    try:
        s = originals[graphics]
        s = inject_exact(s, '#include "r_init.h"',
                         '#include "r_init.h"\n#include <qcommon/boot_trace_web.h>',
                         'gfx renderer header')
        s = instrument_function(
            s, 'HRESULT __cdecl R_CreateDeviceInternal(',
            [
                ('    attempt = 0;\n    while ( 1 )',
                 '    KB_WebBootPhase("R_CreateDeviceInternal: entering device creation");\n'
                 '    attempt = 0;\n    while ( 1 )'),
                ('        hr = dx.d3d9->CreateDevice(dx.adapterIndex, (D3DDEVTYPE)DeviceType, hwnd, behavior, d3dpp, &dx.device);',
                 '        if (attempt == 0) KB_WebBootPhase("R_CreateDeviceInternal: before GLD3D9 CreateDevice");\n'
                 '        hr = dx.d3d9->CreateDevice(dx.adapterIndex, (D3DDEVTYPE)DeviceType, hwnd, behavior, d3dpp, &dx.device);\n'
                 '        if (attempt == 0) KB_WebBootPhase("R_CreateDeviceInternal: GLD3D9 CreateDevice returned");'),
                ('    dx.nvStereoActivated = 0;',
                 '    KB_WebBootPhase("R_CreateDeviceInternal: device created; checking display");\n'
                 '    dx.nvStereoActivated = 0;'),
                ('    return hr;\n}',
                 '    KB_WebBootPhase("R_CreateDeviceInternal: complete");\n'
                 '    return hr;\n}'),
            ], str(graphics))
        s = instrument_function(
            s, 'char __cdecl R_InitHardware(',
            [
                ('    if ( !R_CreateDevice(wndParms) )\n        return 0;',
                 '    KB_WebBootPhase("R_InitHardware: before R_CreateDevice");\n'
                 '    if ( !R_CreateDevice(wndParms) )\n        return 0;\n'
                 '    KB_WebBootPhase("R_InitHardware: device ready");'),
                ('    if ( useFastFile->current.enabled )\n        DB_LoadGraphicsAssetsForPC();',
                 '    if ( useFastFile->current.enabled ) {\n'
                 '        KB_WebBootPhase("R_InitHardware: before DB_LoadGraphicsAssetsForPC");\n'
                 '        DB_LoadGraphicsAssetsForPC();\n'
                 '        KB_WebBootPhase("R_InitHardware: DB_LoadGraphicsAssetsForPC completed", true);\n'
                 '    }'),
                ('    RB_InitSceneViewport();',
                 '    KB_WebBootPhase("R_InitHardware: before viewport/resource initialization");\n'
                 '    RB_InitSceneViewport();'),
                ('    R_FinishAttachingToWindow(wndParms);',
                 '    KB_WebBootPhase("R_InitHardware: finishing renderer attachment");\n'
                 '    R_FinishAttachingToWindow(wndParms);'),
            ], str(graphics))
        out[graphics] = s
        s = originals[registry]
        s = inject_exact(s, '#include "db_registry.h"',
                         '#include "db_registry.h"\n#include <qcommon/boot_trace_web.h>',
                         'asset registry header')
        s = instrument_function(
            s, 'void __cdecl DB_LoadGraphicsAssetsForPC()',
            [
                ('    DB_LoadXAssets(zoneInfo, zoneCount, 0);\n    DB_SyncXAssets();',
                 '    KB_WebBootPhase("DB_LoadGraphicsAssetsForPC: queueing code_post_gfx_mp");\n'
                 '    DB_LoadXAssets(zoneInfo, zoneCount, 0);\n'
                 '    KB_WebBootPhase("DB_LoadGraphicsAssetsForPC: queued; before DB_SyncXAssets");\n'
                 '    DB_SyncXAssets();\n'
                 '    KB_WebBootPhase("DB_LoadGraphicsAssetsForPC: code_post_gfx_mp synchronized", true);'),
                ('    DB_LoadXAssets(zoneInfo, zoneCount, 0);\n}',
                 '    KB_WebBootPhase("DB_LoadGraphicsAssetsForPC: queueing dev_mp/patch_mp");\n'
                 '    DB_LoadXAssets(zoneInfo, zoneCount, 0);\n'
                 '    KB_WebBootPhase("DB_LoadGraphicsAssetsForPC: returned from dev_mp/patch_mp queue", true);\n}'),
            ], str(registry))
        s = instrument_function(
            s, 'void __cdecl DB_SyncXAssets()',
            [
                ('    R_BeginRemoteScreenUpdate();\n    Sys_SyncDatabase();',
                 '    KB_WebBootPhase("DB_SyncXAssets: before R_BeginRemoteScreenUpdate");\n'
                 '    R_BeginRemoteScreenUpdate();\n'
                 '    KB_WebBootPhase("DB_SyncXAssets: before Sys_SyncDatabase");\n'
                 '    Sys_SyncDatabase();\n'
                 '    KB_WebBootPhase("DB_SyncXAssets: databaseCompletedEvent signaled");'),
                ('    DB_PostLoadXZone();',
                 '    KB_WebBootPhase("DB_SyncXAssets: before DB_PostLoadXZone");\n'
                 '    DB_PostLoadXZone();\n'
                 '    KB_WebBootPhase("DB_SyncXAssets: after DB_PostLoadXZone");'),
            ], str(registry))
        out[registry] = s
        s = originals[threads]
        s = inject_exact(s, '#include "threads.h"',
                         '#include "threads.h"\n#include <qcommon/boot_trace_web.h>',
                         'thread/sync header')
        s = instrument_function(
            s, 'void __cdecl Sys_SyncDatabase()',
            [
                ('    while ( !Sys_WaitForSingleObjectTimeout(&databaseCompletedEvent, 1u) )',
                 '    KB_WebBootPhase("Sys_SyncDatabase: waiting for databaseCompletedEvent");\n'
                 '    unsigned int kbLastWaitReport = Sys_Milliseconds();\n'
                 '    while ( !Sys_WaitForSingleObjectTimeout(&databaseCompletedEvent, 1u) )'),
                ('        SocketRouter_EmergencyFrame();\n    }\n}',
                 '        SocketRouter_EmergencyFrame();\n'
                 '        // Keep expensive JS/localStorage diagnostics under 1 log/5 seconds.\n'
                 '        // No new sleep inside WebFiber waits (fiber swaps are already async).\n'
                 '        if (static_cast<unsigned int>(Sys_Milliseconds() - kbLastWaitReport) >= 5000u) {\n'
                 '            kbLastWaitReport = Sys_Milliseconds();\n'
                 '            KB_WebBootPhase("Sys_SyncDatabase: still waiting for database fiber");\n'
                 '        }\n'
                 '    }\n'
                 '    KB_WebBootPhase("Sys_SyncDatabase: wait complete");\n}'),
            ], str(threads))
        out[threads] = s
        for path, content in out.items():
            if content == originals[path]:
                raise RuntimeError(f'{path} was not modified')
        for path, content in out.items():
            path.write_text(content)
            print(f'[graphics-trace] {path}: diagnostic guards added')
    except Exception:
        # Don't accidentally leave the source in a half-patched state.
        for path, content in originals.items():
            path.write_text(content)
        raise


def self_test():
    body = 'void __cdecl DB_LoadGraphicsAssetsForPC()\n{\n    DB_SyncXAssets();\n}\n'
    assert inject_exact(body, '    DB_SyncXAssets();',
                        '    KB_WebBootPhase("check");\n    DB_SyncXAssets();', 'self-test') != body
    assert 'KB_WebBootPhase("check");' in instrument_function(
        body, 'void __cdecl DB_LoadGraphicsAssetsForPC()',
        [('    DB_SyncXAssets();', '    KB_WebBootPhase("check");\n    DB_SyncXAssets();')],
        'self-test')
    try:
        inject_exact(body, 'NEVER_PRESENT', '', 'self-test')
    except RuntimeError:
        pass
    else:
        raise AssertionError('source drift detection is broken')
    print('[graphics-trace] source anchors and failure detection PASS')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('engine_root', nargs='?', type=Path)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    try:
        if args.self_test:
            self_test()
        elif args.engine_root:
            apply(args.engine_root)
        else:
            parser.error('Supply engine_root or --self-test')
    except Exception as exc:
        print(f'[graphics-trace] ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
