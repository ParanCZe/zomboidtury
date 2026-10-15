"""Enforce finite Win32 wait deadlines in the cooperative browser runtime."""
from pathlib import Path
import importlib.util
import sys

def patch(text):
    anchor='    const bool finite = (ms != INFINITE);     // ms==0 or ms>0 => allow timeout return'
    if text.count(anchor)!=1:
        raise RuntimeError('Expected the original cooperative wait implementation')
    replacement='''    const bool finite = (ms != INFINITE);
    const double expires = finite ? emscripten_get_now() + ms : 0;
    auto waitTurn = [&]() -> bool {
        if (!finite) return WebFiber_WaitOn(k, false);
        // Finite waits stay runnable: a blocked fiber has no timer wakeup.
        // Test the monotonic deadline even while other workers keep running.
        if (ms == 0 || emscripten_get_now() >= expires) return false;
        WebFiber_Yield();
        // Let browser I/O and input callbacks run during main-thread polling.
        if (WebFiber_CurrentContext() < 0 && emscripten_get_now() < expires)
            emscripten_sleep(1);
        return true;
    };'''
    start=text.index('static DWORD WaitForSingleObjectWeb(')
    end=text.index('\n}\n',start)+2
    body=text[start:end].replace(anchor,replacement).replace('WebFiber_WaitOn(k, finite)','waitTurn()')
    if body.count('if (!waitTurn())')!=4:
        raise RuntimeError('Expected four wait paths')
    return text[:start]+body+text[end:]

def main(root):
    test_path=Path(__file__).resolve().parents[1]/'tests/cooperative-wait.test.py'
    spec=importlib.util.spec_from_file_location('wait_test',test_path)
    test=importlib.util.module_from_spec(spec);spec.loader.exec_module(test)
    target=root/'src/platform/sdl/win_kernel.cpp'
    original=target.read_text()
    fixed=patch(original)
    fixed=fixed.replace('#    include "web_fibers.h"','#    include <emscripten.h>\n#    include "web_fibers.h"',1)
    if test.verify(original):raise RuntimeError('Expected baseline deadline failure')
    if not test.verify(fixed):raise RuntimeError('Corrected wait failed regression checks')
    target.write_text(fixed)
    print('Cooperative finite waits now expire while workers remain runnable')

if __name__=='__main__':main(Path(sys.argv[1]))
