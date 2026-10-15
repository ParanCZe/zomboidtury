#!/usr/bin/env python3
"""Bound synchronous IWD indexing batches so Safari can render and report progress.

Apply after instrument_boot.py. Game data and ZIP traversal are unchanged.
"""
from pathlib import Path
import argparse
import importlib.util


def patch(text):
    start = text.index('iwd_t *__cdecl FS_LoadZipFile(')
    end = text.index('\niwd_t *__cdecl FS_LoadFakeIwdFile(', start)
    body = text[start:end]
    anchor = '        unzGoToNextFile(uf);'
    if body.count(anchor) != 2 or 'IWD scan:' in body:
        raise RuntimeError('Archive scan source changed or fix already applied')
    for label in ('measuring names', 'building index'):
        pos = body.index(anchor)
        # Find the next unmodified traversal, since replacement retains its anchor.
        if label == 'building index':
            pos = body.index(anchor, pos + len(anchor))
        progress = '''        if ((i & 127u) == 0)
        {
            char archiveProgress[384];
            snprintf(archiveProgress, sizeof(archiveProgress),
                "IWD scan: %s; ''' + label + ''' %u/%u", zipfile,
                i + 1, (unsigned int)gi.number_entry);
            KB_WebBootPhase(archiveProgress, true);
        }
'''
        body = body[:pos] + progress + body[pos:]
    body = body.replace('    fs_numHeaderLongs = 0;',
        '    KB_WebBootPhase("IWD scan: opening ZIP directory", true);\n    fs_numHeaderLongs = 0;', 1)
    body = body.replace('    buildBuffer = (fileInIwd_s *)Z_Malloc(',
        '    KB_WebBootPhase("IWD scan: allocating file index", true);\n    buildBuffer = (fileInIwd_s *)Z_Malloc(', 1)
    body = body.replace('    iwd[193] = Com_BlockChecksumKey32(',
        '    KB_WebBootPhase("IWD scan: calculating checksum", true);\n    iwd[193] = Com_BlockChecksumKey32(', 1)
    return text[:start] + body + text[end:]


def apply(root):
    path = root/'src/universal/com_files.cpp'
    original = path.read_text()
    if '#include <qcommon/boot_trace_web.h>' not in original:
        raise RuntimeError('Run instrument_boot.py before archive scan fix')
    spec = importlib.util.spec_from_file_location('archive_scan_test',
        Path(__file__).resolve().parents[1]/'tests/archive-scan.test.py')
    regression = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(regression)
    if regression.verify(original):
        raise RuntimeError('Expected baseline scan to monopolize browser; inspect upstream')
    fixed = patch(original)
    if not regression.verify(fixed):
        raise RuntimeError('Archive scan responsiveness regression failed')
    path.write_text(fixed)
    print('Archive scan: baseline starvation reproduced; bounded scans verified')

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('engine_root', type=Path)
    apply(cli.parse_args().engine_root)
