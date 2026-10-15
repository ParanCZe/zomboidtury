"""Exercise the production wait loop with a deterministic clock and scheduler."""
from pathlib import Path
import subprocess
import sys
import tempfile

def extract(text):
    start = text.index('static DWORD WaitForSingleObjectWeb(')
    end = text.index('\n}\n', start) + 2
    return text[start:end]

def verify(text):
    source = r'''
#include <cassert>
#include <cstdio>
#include <stdexcept>
using DWORD = unsigned int;
constexpr DWORD INFINITE=0xffffffff, WAIT_TIMEOUT=258, WAIT_OBJECT_0=0;
enum Kind {K_THREAD,K_MUTEX,K_EVENT,K_SEM};
struct KObject {Kind kind; bool signaled=false,locked=false,manualReset=false; int count=0;};
double clockMs=0;
int turns=0,signalAt=0;
KObject* target=nullptr;
double emscripten_get_now(){return clockMs;}
void advance(){
  if(++turns>100)throw std::runtime_error("Finite wait ignored its deadline while workers stayed runnable");
  ++clockMs;
  if(signalAt && turns==signalAt)target->signaled=true;
}
void WebFiber_Yield(){advance();}
bool WebFiber_WaitOn(const void*,bool){advance();return true;}
int WebFiber_CurrentContext(){return -1;}
void emscripten_sleep(int ms){clockMs+=ms;}
void reset(){clockMs=0;turns=0;signalAt=0;}
''' + extract(text) + r'''
int main(){try{
  KObject event{K_EVENT};target=&event;
  assert(WaitForSingleObjectWeb(&event,3)==WAIT_TIMEOUT);
  assert(clockMs>=3 && turns<=4);
  reset();assert(WaitForSingleObjectWeb(&event,0)==WAIT_TIMEOUT);assert(turns==0);
  reset();signalAt=2;assert(WaitForSingleObjectWeb(&event,10)==WAIT_OBJECT_0);assert(!event.signaled);
  reset();event.signaled=true;event.manualReset=true;
  assert(WaitForSingleObjectWeb(&event,0)==WAIT_OBJECT_0);assert(event.signaled && turns==0);
  KObject mutex{K_MUTEX};mutex.locked=true;reset();
  assert(WaitForSingleObjectWeb(&mutex,0)==WAIT_TIMEOUT);assert(turns==0);
  mutex.locked=false;assert(WaitForSingleObjectWeb(&mutex,0)==WAIT_OBJECT_0);assert(mutex.locked);
  KObject thread{K_THREAD};reset();assert(WaitForSingleObjectWeb(&thread,0)==WAIT_TIMEOUT);assert(turns==0);
  KObject sem{K_SEM};sem.count=1;reset();assert(WaitForSingleObjectWeb(&sem,0)==WAIT_OBJECT_0);assert(sem.count==0);
  event.signaled=false;event.manualReset=false;target=&event;reset();signalAt=2;
  assert(WaitForSingleObjectWeb(&event,INFINITE)==WAIT_OBJECT_0);
  puts("PASS: deadlines, nonblocking polls, event reset, semaphore consumption and infinite signal waits");return 0;
}catch(const std::exception&e){fprintf(stderr,"%s\n",e.what());return 1;}}
'''
    with tempfile.TemporaryDirectory() as d:
        root=Path(d);(root/'test.cpp').write_text(source)
        subprocess.run(['g++','-std=c++20',str(root/'test.cpp'),'-o',str(root/'test')],check=True)
        return subprocess.run([str(root/'test')]).returncode==0

if __name__=='__main__':
    sys.exit(0 if verify((Path(sys.argv[1])/'src/platform/sdl/win_kernel.cpp').read_text()) else 1)
