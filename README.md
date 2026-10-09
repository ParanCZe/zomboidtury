# Experimentální BO1 web build pro iPhone

Tento balíček obsahuje sestavený engine a experimentální dotykové ovládání. **Nejde o ověřenou hratelnou verzi Kino der Toten.** Neobsahuje herní data.

## Spuštění testu

1. V repozitáři zapněte Settings → Pages → Deploy from a branch → main → / (root). Soubory webu jsou přímo v kořenu repozitáře.
2. Na iPhonu otevřete `https://ParanCZe.github.io/zomboidtury/?mobile=1`, telefon otočte na šířku a klepněte na „Načíst herní soubory“.
3. Vyberte vlastní odpovídající soubory `.iwd` a `.ff`. Soubory `.iwd` se mapují do `main`, `.ff` s prefixem `en_` do `zone/english` a ostatní `.ff` do `zone/common`. Toto odvození cest nepokrývá libovolnou strukturu instalace ani video soubory.
4. Výchozí mapa je `mp_nuked`, protože zdrojová větev je multiplayerová. `?mobile=1&map=zombie_theater` předá engine požadavek na Kino; **Zombies režim v této větvi není ověřený a samotný parametr ho nepřidá**.
5. Pro další diagnostiku zaznamenejte první chybovou hlášku v horní části stránky a verzi iOS. Ověření skutečného iPhonu nebylo provedeno.

Pro test na počítači lze spustit `python3 -m http.server 8000 --directory .` a otevřít `http://localhost:8000/?mobile=1`. Pro telefon použijte HTTPS hosting; localhost počítače není localhost telefonu.

## Co je změněno

- Jeden hlavní thread, Asyncify místo JSPI. Mobilní režim nepouští service worker pro cross-origin isolation.
- Výchozí rozlišení mobilního režimu 960×540; lze změnit parametrem `rmode=640x480`.
- Dotykový WASD joystick, pohled bez Pointer Lock, střelba, míření, přebití, použití, skok, dřep, běh, zbraně a Escape. Krátký dotyk oblasti pohledu odešle kliknutí.
- Více souběžných dotyků nesmí uvolnit klávesu, kterou drží jiný ovladač. Ztráta viditelnosti/aktivace stránky uvolní držené klávesy.
- Lokální soubory přes File input a existující čtení po částech v KBFS, bez desktopového Directory Picker API.
- Experimentální čtecí větev pro `IWffr100`, verzi 473: payload se kopíruje bez zlib. Některá data vel.gg stále používají původní `IWffu100`. Přijetí hlavičky není důkaz kompatibility následných assetů.

## Ověřené a neověřené

Ověřeno: sestavení Emscripten 3.1.69, validace a instanciace WebAssembly v Node 24, přítomnost pěti mobilních exportů, nesdílená počáteční paměť 536 870 912 bajtů, Asyncify exporty, testy kláves/vstupu/raw kopírování a syntaxe mobilního JavaScriptu.

Instanciace používala zástupné importované funkce. Neověřuje skutečnou inicializaci platformy, WebGL2 ani běh hry. Neověřeno: Safari/iPhone, zvuk, renderování, skutečné kompletní načtení fastfile, kompatibilita Kino a Zombies gameplay, výkon a spotřeba paměti. Paměť může růst až na 2 GiB podle potřeb enginu; udržitelnost tohoto limitu na iPhonu není ověřena.

## Zdroj a reprodukce

Základ: https://github.com/riicchhaarrd/KisakBlack, větev `web-port`, commit `65d1eb9a21898ae43b27f93e8204dc5d03560d70`. Není to přesný zdrojový strom enginu vel.gg. `mobile-port.patch` obsahuje všechny změny této iterace včetně testů.

```
git clone --branch web-port https://github.com/riicchhaarrd/KisakBlack.git
cd KisakBlack
git checkout 65d1eb9a21898ae43b27f93e8204dc5d03560d70
git apply /cesta/mobile-port.patch
# Aktivujte Emscripten SDK 3.1.69, instalujte CMake a Ninja.
emcmake cmake -S . -B build-mobile -G Ninja -DCMAKE_BUILD_TYPE=Release -DKISAK_WEB_THREADS=OFF -DKISAK_WEB_ASSERTIONS=ON
cmake --build build-mobile --parallel 4
```

Testy v aplikovaném zdrojovém stromu:

```
g++ -std=c++17 tests/mobile_motion_test.cpp src/platform/sdl/mobile_motion.cpp -o /tmp/mobile-motion-test
/tmp/mobile-motion-test
g++ -std=c++17 -Isrc tests/raw_fastfile_test.cpp src/database/db_raw.cpp -o /tmp/raw-fastfile-test
/tmp/raw-fastfile-test
node tests/mobile_keys_test.cjs
```

## Další práce

Priorita je získat přesnou zdrojovou větev vel.gg nebo ověřit a doplnit singleplayer/Zombies cestu v tomto zdroji. Pak ověřit načtení kompletního Kino balíčku, diagnostikovat chybějící assety a testovat Safari na fyzickém zařízení. Přímé používání CDN vel.gg z jiného originu blokuje jeho CORS pravidlo; tento build proto používá lokálně vybrané soubory.

Původní licenční soubory zdrojové větve jsou přiložené; tento balíček nemění jejich podmínky.

## Nasazení v tomto repozitáři

Engine je uložen ve dvou souborech `blackops.wasm.001` a `blackops.wasm.002` kvůli limitu přenosu. `engine-loader.js` je automaticky spojí do původního Wasm a předá jej Emscriptenu přes `Module.wasmBinary`. Oba soubory musí být dostupné ze stejného adresáře jako `index.html`.
