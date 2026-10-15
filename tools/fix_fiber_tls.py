#!/usr/bin/env python3
"""Restore the engine TLS bank on every single-threaded WebAssembly fiber swap."""
from pathlib import Path
import argparse
import subprocess
import tempfile

SIGNATURE = 'extern "C" void Sys_Web_OnFiberSwitch(int ctx)\n{'


def callback(text):
    if text.count(SIGNATURE) != 1:
        raise RuntimeError('Expected one cooperative fiber switch callback')
    start=text.index(SIGNATURE)
    end=text.index('\n}',start)+2
    return start,end,text[start:end]


def patch(text):
    start,end,body=callback(text)
    if 'g_dwTlsIndex =' in body:
        raise RuntimeError('TLS switch already present; inspect upstream before applying')
    body=body.replace(SIGNATURE, SIGNATURE+'''
    // All fibers share the OS thread_local pointer. Restore the logical thread's
    // five engine TLS slots, including parser/va buffers and error recovery data.
    const int threadContext = ctx < 0 ? 0 : ctx;
    g_dwTlsIndex = g_threadValues[threadContext];''',1)
    return text[:start]+body+text[end:]


def verify(text):
    _,_,body=callback(text)
    source='''void *g_threadValues[15][5];
void **g_dwTlsIndex;
unsigned int threadId[15],g_webCurrentThreadId;
unsigned int Sys_Web_SynthThreadId(int ctx) { return 100+ctx; }
'''+body+'''
int main() {
 int sentinel[15][5];
 threadId[0]=100;
 for(int i=0;i<15;++i)for(int j=0;j<5;++j)g_threadValues[i][j]=&sentinel[i][j];
 g_dwTlsIndex=g_threadValues[0];
 for(int round=0;round<4;++round)for(int ctx=0;ctx<15;++ctx) {
   Sys_Web_OnFiberSwitch(ctx);
   if(g_webCurrentThreadId!=100u+ctx)return 1;
   for(int j=0;j<5;++j)if(g_dwTlsIndex[j]!=&sentinel[ctx][j])return 2;
   Sys_Web_OnFiberSwitch(-1);
   if(g_webCurrentThreadId!=100)return 3;
   for(int j=0;j<5;++j)if(g_dwTlsIndex[j]!=&sentinel[0][j])return 4;
 }
 return 0;
}
'''
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory)
        (root/'test.cpp').write_text(source)
        subprocess.run(['g++','-std=c++20',str(root/'test.cpp'),'-o',str(root/'test')],check=True)
        return subprocess.run([str(root/'test')]).returncode==0


def apply(root):
    path=root/'src/qcommon/threads.cpp'
    original=path.read_text()
    fixed=patch(original)
    if verify(original):
        raise RuntimeError('Expected missing per-fiber TLS restoration, but baseline passed')
    if not verify(fixed):
        raise RuntimeError('Per-fiber TLS isolation regression failed')
    path.write_text(fixed)
    print('Fiber TLS: reproduced wrong TLS bank; all 15 contexts and main-thread returns verified')


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('engine_root',type=Path)
    apply(cli.parse_args().engine_root)
