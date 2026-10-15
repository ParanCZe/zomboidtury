#!/usr/bin/env python3
"""Restore portable startup prerequisites present in the original WinMain."""
from pathlib import Path
import argparse
import subprocess
import tempfile

ANCHOR = '    KBZ_SetCommandLine(cmdline);\n    Com_Init(cmdline);'
FIX = '''    KBZ_SetCommandLine(cmdline);
    // Match WinMain: config parsing and the set/seta commands must exist
    // before Com_Init executes startup configs and reads engine dvars.
    Com_InitParse();
    Dvar_Init();
    Com_Init(cmdline);'''


def patch(text):
    include = '#include <qcommon/tl_support.h>'
    if text.count(ANCHOR) != 1 or text.count(include) != 1:
        raise RuntimeError('Portable bootstrap source changed or fix already installed')
    return text.replace(include, include + '\n#include <universal/q_parse.h>\n#include <universal/dvar.h>', 1).replace(ANCHOR, FIX, 1)


def verify(text):
    # Run the actual entry-point initialization sequence with minimal subsystem
    # doubles. Com_Init rejects startup when parser/dvar commands are inactive.
    start = text.index('    Sys_InitializeCriticalSections();', text.index('int main('))
    end = text.index('    Com_Init(cmdline);', start) + len('    Com_Init(cmdline);')
    source = '''bool parser=false, dvars=false;
void Sys_InitializeCriticalSections() {}
void Sys_InitMainThread() {}
void Sys_SetupTLCallbacks(int) {}
void KBZ_SetCommandLine(const char*) {}
void Com_InitParse() { parser=true; }
void Dvar_Init() { dvars=parser; }
void Com_Init(const char*) {}
int main() { const char* cmdline="";
''' + text[start:end] + '\nreturn parser && dvars ? 0 : 1;\n}\n'
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / 'test.cpp').write_text(source)
        subprocess.run(['g++', '-std=c++20', str(root/'test.cpp'), '-o', str(root/'test')], check=True)
        return subprocess.run([str(root/'test')]).returncode == 0


def apply(root):
    path = root / 'src/platform/linux/linux_main.cpp'
    original = path.read_text()
    fixed = patch(original)
    if verify(original):
        raise RuntimeError('Baseline unexpectedly initialized subsystems: inspect upstream before applying')
    if not verify(fixed):
        raise RuntimeError('Fixed bootstrap failed initialization contract')
    path.write_text(fixed)
    print('Portable bootstrap: missing initialization reproduced, parser/dvar fix verified')


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('engine_root', type=Path)
    apply(cli.parse_args().engine_root)
