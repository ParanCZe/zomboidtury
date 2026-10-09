# Kino mobile: experimental Zombies port

Open https://parancze.github.io/zomboidtury/?mobile=1 in Safari and press **Stáhnout Kino a spustit**. No manual game-file selection is required. Initial download is approximately 702 MiB, then verified data are retained in OPFS storage. Safari must provide WebGL 2 and OPFS, with sufficient available storage. Do not close the page during the first download.

## Deployment

In repository **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. The `Build Kino data and deploy mobile Pages` workflow downloads the publicly accessible upstream pack, checks every SHA-256 against `kino-manifest.json`, and publishes it together with the player from the same origin. Game data are not committed to Git. The page cannot download its pack until this workflow has deployed successfully.

## Engine and verification limits

This is a newly compiled experimental Zombies engine, not an iframe or a claim that the original vel.gg engine works on iOS. It combines riicchhaarrd/KisakBlack `web-port` baseline 65d1eb9a21898ae43b27f93e8204dc5d03560d70 with MisaDev4/bo1-zombies-decompiled 102f6992be332610aff587e681e3180b15f395bb. `mobile-port.patch.gz` (decompress with gzip) contains the combined source changes relative to the web-port baseline. Build using Emscripten 3.1.69, CMake, Ninja, Release, `KISAK_WEB_THREADS=OFF`, `KISAK_WEB_ASSERTIONS=ON`.

The wasm uses unshared 512 MiB memory and Asyncify, portable OpenGL/WebGL rendering, raw-fastfile support, and touch input. Windows-only profiling, Steam/gamepad profile initialization and CPU affinity are disabled on web; these are not game simulation replacements. The game's Zombies simulation source is compiled into this build. Runtime initialization and a real Kino round on a physical iPhone have **not yet been verified**. Compilation and downloader tests alone do not establish gameplay compatibility.

Run downloader tests with `node --test tests/kino-pack.test.cjs`. The downloaded assets come from `https://cdn.vel.gg/packs/kino/` using the pinned manifest; availability and use remain subject to the upstream provider and the asset owners. Existing licenses remain included.
