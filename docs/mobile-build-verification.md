# Mobile build verification, 2026-10-09

The target is BO1 Zombies Kino der Toten in Safari on iPhone, with automatic game-data download. The current player and data pack are already on GitHub Pages. This report distinguishes build verification from game verification.

## Reconstructing the engine

Baseline: riicchhaarrd/KisakBlack commit 65d1eb9a21898ae43b27f93e8204dc5d03560d70. The checked-in compressed source patch combines the portable web engine with Zombies simulation code and platform fixes. A clean clone accepted the patch with `git apply --check`. Mobile-key cancellation/ownership, movement accumulation, coordinate rounding and raw-fastfile reader tests passed locally.

The new GitHub Actions engine workflow reconstructs this source and compiles it using Emscripten 3.1.69, Release, threads disabled and assertions enabled. It produces a downloadable engine/player artifact. It does not automatically replace the live engine or include the large game pack.

## Wasm contract

The previously published binary was joined from its transport parts and validated as WebAssembly. Its exports include the entry point `__main_argc_argv`, the five `KBMobile_*` functions and Asyncify unwind/rewind functions. Instantiation with dummy function imports verified unshared initial memory of 512 MiB. The entry point was not called: this verifies the binary layout and memory contract, not engine initialization or gameplay.

## Shader compatibility investigation

The portable source does not directly read the original site's KSPK shader and sound archives. This alone does not prove a failure: its renderer translates D3D9 shader bytecode to GLSL and loads shader definitions from fastfiles.

The deployed `zone/Common/code_post_gfx.ff` was downloaded (2,248,000 bytes, `IWffu100`, version 473). Inflating the zlib stream after its 12-byte header yielded 6,222,433 bytes. That payload contained 741 pixel-shader version signatures and 352 vertex-shader version signatures. These counts are signatures, not a count of individually validated shaders. They confirm that at least this fastfile retains shader bytecode; compilation of those shaders and full map compatibility have not been tested.

## Remaining runtime verification

The available cloud browser rejected the WebGL2 context before engine startup. No rendered Kino map, audio playback or first Zombies round has been verified. Real Safari testing is still required. In particular, fastfile pointer/layout compatibility, sound decoding and peak memory at map load remain unverified; successful C++ compilation does not establish them.

## Optional S3TC fallback

The original 2D and cube upload code selected compressed DXT uploads by texture format even when the GL extension list reported no S3TC support. The revised source decodes DXT1/3/5 into temporary RGBA8 buffers when S3TC is unavailable, covering 2D textures, cube faces and material texture arrays. Supported contexts retain compressed uploads. Input-length and allocation-overflow checks prevent reading truncated blocks. Tests cover solid colors, DXT1 transparency, DXT3/5 alpha, both DXT5 alpha palette modes, non-multiple-of-four dimensions and truncated inputs. These tests passed under AddressSanitizer/UndefinedBehaviorSanitizer with leak detection disabled because the execution environment cannot inspect process tasks. This verifies CPU conversion; it is not evidence of a rendered scene on Safari.
