"""Compile both real archive loops with a minimal ZIP/engine boundary."""
from pathlib import Path
import subprocess
import sys
import tempfile


def verify(text):
    start = text.index('iwd_t *__cdecl FS_LoadZipFile(')
    end = text.index('\niwd_t *__cdecl FS_LoadFakeIwdFile(', start)
    body = text[start:end]
    loops = []
    cursor = 0
    for unused in range(2):
        begin = body.index('    for ( i = 0; i < gi.number_entry', cursor)
        finish = body.index('\n    }', begin) + len('\n    }')
        loop = body[begin:finish]
        # Keep the real loop and ZIP traversal; isolate its engine-specific work.
        inner = loop.index('\n    {') + len('\n    {')
        traversal = loop.index('        unzGoToNextFile(uf);', inner)
        work = loop[inner:traversal]
        # Strip only the original per-entry work, preserving inserted progress calls.
        marker = work.find('        if ((i & 127u) == 0)')
        progress = work[marker:] if marker >= 0 else ''
        loops.append(loop[:inner] + '\n' + progress + '        ++processed;\n' + loop[traversal:])
        cursor = finish
    source = r'''
#include <cstdio>
#include <cstring>
struct { unsigned int number_entry; } gi;
unsigned int i, processed, yields, longest, batch, stopAt;
void *uf=nullptr,*file_info=nullptr;
char filename_inzip[256], zipfile[]="main/test.iwd";
unsigned int visited;
int unzGetCurrentFileInfo(...) { return visited < stopAt ? 0 : -1; }
void unzGoToNextFile(void*) { ++visited; ++batch; if(batch>longest)longest=batch; }
void KB_WebBootPhase(const char*,bool yield=false) { if(yield){++yields;batch=0;} }
int main(){
 for(unsigned int count: {1u,127u,128u,129u,4096u}) {
  for(unsigned int limit: {count,count/2}) {
   gi.number_entry=count; stopAt=limit;
''' + '\n'.join('''
   processed=yields=longest=batch=visited=0;
''' + loop + '''
   if(processed!=stopAt || visited!=stopAt)return 1;
   if(stopAt>0 && yields==0){std::puts("Archive loop never yields to browser");return 2;}
   if(longest>128){std::puts("Archive loop monopolizes browser for >128 entries");return 3;}
''' for loop in loops) + '\n }\n }\n}\n'
    source = '#include <initializer_list>\n' + source
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory)
        (root/'test.cpp').write_text(source)
        subprocess.run(['g++','-std=c++20',str(root/'test.cpp'),'-o',str(root/'test')],check=True)
        return subprocess.run([str(root/'test')]).returncode == 0

if __name__=='__main__':
    path=Path(sys.argv[1])/'src/universal/com_files.cpp'
    if not verify(path.read_text()):
        raise SystemExit('FAIL: synchronous IWD scan blocks browser event loop')
    print('PASS: both IWD loops preserve entry/error handling and yield within 128 entries')
