"""Report the current GL device's volume texture limit to the engine."""
from pathlib import Path
import importlib.util
import sys

def patch(text):
    start=text.index('HRESULT WINAPI GLDevice::GetDeviceCaps(')
    end=text.index('\n}',start)+2
    old=text[start:end]
    anchor='    FillDefaultCaps(pCaps);'
    if old.count(anchor)!=1 or 'GL_MAX_3D_TEXTURE_SIZE' in old:
        raise RuntimeError('Unexpected GetDeviceCaps implementation')
    new=old.replace(anchor,anchor+'''
    // The lighting atlas uses a 3D texture. Default caps leave this field zero.
    // Query the active device instead of advertising an invented hardware limit.
    GLint volumeExtent = 0;
    glGetIntegerv(GL_MAX_3D_TEXTURE_SIZE, &volumeExtent);
    pCaps->MaxVolumeExtent = volumeExtent > 0 ? volumeExtent : 0;''')
    return text[:start]+new+text[end:]

def main(root):
    spec=importlib.util.spec_from_file_location('volume_test',Path(__file__).resolve().parents[1]/'tests/volume-caps.test.py')
    test=importlib.util.module_from_spec(spec);spec.loader.exec_module(test)
    path=root/'src/gfx_gl/gl_d3d9.cpp'
    original=path.read_text();fixed=patch(original)
    if test.verify(original):raise RuntimeError('Expected zero-cap baseline failure')
    if not test.verify(fixed):raise RuntimeError('Volume capability regression failed')
    path.write_text(fixed)
    print('Device volume texture limit now comes from GL_MAX_3D_TEXTURE_SIZE')

if __name__=='__main__':main(Path(sys.argv[1]))
