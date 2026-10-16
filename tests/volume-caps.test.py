"""Execute the actual capability method against deterministic GL limits."""
from pathlib import Path
import subprocess
import tempfile
import sys

def verify(text):
    start=text.index('HRESULT WINAPI GLDevice::GetDeviceCaps(')
    end=text.index('\n}',start)+2
    source='''#include <cassert>
#include <cstdio>
#include <initializer_list>
#define WINAPI
using HRESULT=int; using GLint=int;
constexpr int E_INVALIDARG=-1,D3D_OK=0,GL_MAX_3D_TEXTURE_SIZE=0x8073;
struct D3DCAPS9 { unsigned int MaxVolumeExtent=0; };
struct GLDevice { HRESULT GetDeviceCaps(D3DCAPS9*); };
int actualLimit=2048;
void FillDefaultCaps(D3DCAPS9*c){*c={};}
void glGetIntegerv(int name,int*p){assert(name==GL_MAX_3D_TEXTURE_SIZE);*p=actualLimit;}
'''+text[start:end]+'''
int main(){GLDevice device;D3DCAPS9 caps;
 for(int limit:{2048,256,128,0}){
  actualLimit=limit;
  assert(device.GetDeviceCaps(&caps)==D3D_OK);
  if(caps.MaxVolumeExtent!=(unsigned)limit){
   fprintf(stderr,"Wrong volume limit: %u, expected %d\\n",caps.MaxVolumeExtent,limit);return 1;
  }
 }
 assert(device.GetDeviceCaps(nullptr)==E_INVALIDARG);
 puts("PASS: actual volume limits, small devices, and invalid pointer");
}
'''
    with tempfile.TemporaryDirectory() as d:
        p=Path(d);(p/'test.cpp').write_text(source)
        subprocess.run(['g++','-std=c++20',str(p/'test.cpp'),'-o',str(p/'test')],check=True)
        return subprocess.run([str(p/'test')]).returncode==0

if __name__=='__main__':
    sys.exit(0 if verify((Path(sys.argv[1])/'src/gfx_gl/gl_d3d9.cpp').read_text()) else 1)
