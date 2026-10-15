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
    // Generic CreateThread workers use contexts >= 64, outside g_threadValues.
    // Keep their own bank and preserve a bank selected by SetupWorkerThread /
    // Sys_InitThread while that generic fiber was running.
    struct GenericTls { void* slots[5] = {}; void** selected = nullptr; };
    static std::map<int, GenericTls> genericBanks;
    static int activeContext = -1;
    if (activeContext >= 15 && g_dwTlsIndex)
        genericBanks[activeContext].selected = g_dwTlsIndex;
    if (ctx < 15)
        g_dwTlsIndex = g_threadValues[ctx < 0 ? 0 : ctx];
    else
    {
        GenericTls& bank = genericBanks[ctx];
        g_dwTlsIndex = bank.selected ? bank.selected : bank.slots;
    }
    activeContext = ctx;''',1)
    updated=text[:start]+body+text[end:]
    return '#include <map>\n'+updated


def verify(text):
    _,_,body=callback(text)
    source='''#include <map>
#include <array>
#include <cstdint>
void *g_threadValues[15][5];
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
 int generic=64, second=65, genericValue=4, secondValue=5;
 Sys_Web_OnFiberSwitch(generic);
 // A generic bank must be separate from, and outside the end of, the fixed table.
 const auto address=reinterpret_cast<std::uintptr_t>(g_dwTlsIndex);
 const auto fixedStart=reinterpret_cast<std::uintptr_t>(g_threadValues);
 const auto legacyBank=reinterpret_cast<std::uintptr_t>(g_threadValues)+64*sizeof(g_threadValues[0]);
 if((address>=fixedStart && address<fixedStart+sizeof(g_threadValues)) || address==legacyBank)return 5;
 if(!g_dwTlsIndex)return 6;
 g_dwTlsIndex[1]=&genericValue;
 Sys_Web_OnFiberSwitch(-1);
 if(g_dwTlsIndex!=g_threadValues[0])return 7;
 Sys_Web_OnFiberSwitch(generic);
 if(g_dwTlsIndex[1]!=&genericValue)return 8;
 // SetupWorkerThread calls Sys_InitThread, redirecting this worker's bank.
 g_dwTlsIndex=g_threadValues[2];
 Sys_Web_OnFiberSwitch(second);
 if(g_dwTlsIndex==g_threadValues[2])return 9;
 g_dwTlsIndex[1]=&secondValue;
 Sys_Web_OnFiberSwitch(generic);
 if(g_dwTlsIndex!=g_threadValues[2])return 10;
 Sys_Web_OnFiberSwitch(second);
 if(g_dwTlsIndex[1]!=&secondValue)return 11;
 Sys_Web_OnFiberSwitch(-1);
 if(g_dwTlsIndex!=g_threadValues[0])return 12;
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
    print('Fiber TLS: fixed contexts, generic workers, selected banks and main returns verified')


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('engine_root',type=Path)
    apply(cli.parse_args().engine_root)
