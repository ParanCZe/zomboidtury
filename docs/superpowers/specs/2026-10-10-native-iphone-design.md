# Nativní BO1 Zombies Kino pro iPhone — návrh portu

## Výsledek a stav
Cílem je skutečná nativní hra: Xcode projekt, C++ engine, dotykové ovládání,
mapa Kino přibalená jako prostředek aplikace a žádné stahování při hraní.
Současný engine není pro iOS sestavený. Tento dokument je návrh postupu,
nikoliv hotový nebo ověřený herní projekt.

## Ověřené překážky ve zdrojích
- `cmake/portable.cmake` přijímá Linux/Emscripten. Linux target používá
  `-m32`, SSE/MMX, SDL2, GLEW a desktop OpenGL. Neobsahuje iOS target.
- `clientscript/cscr_variable.h`: `VariableUnion` obsahuje ukazatele;
  `cscr_save.cpp` vyžaduje velikost 4 B a offset zásobníku 13 B.
  Na ARM64 tyto požadavky nelze zachovat prostým překladem.
- `database/db_load.cpp` načítá struktury v původních velikostech a přetypovává
  ukazatele na `unsigned int`. Samotné odstranění size assertions není oprava.
- Renderer již umí GLSL ES 3.00 pro WebGL2, ale nativní GLES kontext,
  rozhraní funkcí, životní cyklus a jednotlivé podporované funkce musí být upraveny.
- Soubory packu jsou ověřené na úrovni SHA256. To zatím nedokazuje, že je engine
  všechny správně interpretuje. Zvukový pack a mapový fastfile vyžadují ověření.
- Dostupné prostředí je Linux x86_64, bez `xcodebuild` a Apple SDK.
  Úspěšný iOS build ani test zařízení zde nelze zatím doložit.

## Volba implementace
Doporučení: zachovat C++ herní logiku, portovat runtime na ARM64 a nejprve
přizpůsobit existující renderer nativnímu OpenGL ES 3. Je zastaralé, ale tento
postup zmenšuje první port; potřebné API se ověří skutečným buildem s Apple SDK.
Metal je další samostatná etapa, pokud GLES nebude pro aktuální zařízení
použitelné, nebo po získání funkčního referenčního portu.

Alternativy:
1. Metal od začátku: vhodnější dlouhodobá grafika, ale vyžaduje nový backend
   a převod DX9 shaderů a pipeline. Výrazně větší první etapa.
2. WKWebView se současným Wasm: menší balení, ale stále webový runtime,
   stávající problém inicializace a limity Safari. Nesplňuje zvolený cíl.

## Rozhraní a data
- UIKit aplikace vlastní obrazovku, rotaci na šířku, dotykový vstup a životní cyklus.
- Nativní platformní vrstva vlastní SDL/GLES kontext, časování, vlákna,
  souborové cesty, zvuk a přechod do pozadí.
- C++ engine zachovává herní logiku Zombies. Žádná náhrada jinou jednoduchou hrou.
- Původní diskové struktury používají pevné `uint32_t` reference a explicitní
  čtení little-endian hodnot. Nepoužívají velikost hostitelského ukazatele.
- Dekodér převádí tyto struktury na oddělené runtime objekty s ARM64 ukazateli,
  řeší aliasy a relokace a kontroluje hranice vstupu i přetečení výpočtů.
- Script VM zachová diskovou reprezentaci uložených hodnot; živé ukazatele
  nesmí projít přes čtyřbajtovou hodnotu. Serializace používá ID/offsety.
- Read-only mapa je v `Bundle/Game`, uživatelská konfigurace a případné uložené
  pozice v Application Support. Engine nesmí zapisovat do podepsaného bundle.
- Pinned manifest obsahuje 51 souborů, celkem 736 259 588 B. Příprava na Macu
  použije existující validaci SHA256. Do Git historie se velká data nepřidávají.
  Balení hry obsahuje pouze ověřené soubory; na zařízení není potřeba downloader.

## Etapy a kritéria
1. ARM64 a datový dekodér: oddělit diskové a runtime struktury, odstranit
   zkracování ukazatelů, portovat SIMD. Testy musí číst skutečné pinned fastfiles
   bez výstupů mimo rozsah a ověřit modely, materiály, skripty a asset reference.
2. Apple platforma a Xcode: iOS toolchain, nativní entry point, bundle soubory,
   životní cyklus, zvuk a vlákna. Debug build pro arm64 s Apple SDK musí projít;
   varování o zkrácení ukazatelů jsou chyby. Simulator není důkaz běhu na iPhonu.
3. Grafika: nativní GLES 3, překlad shaderů, textury včetně DXT fallbacku,
   render targets, kontext a přerušení aplikace. Nejprve skutečný první snímek mapy.
4. Hra a ovládání: spawn, pohyb, střelba, kolize a Zombies simulace. Teprve po
   tomto testu označit sestavení jako hratelné. Dotykový vstup se předává do
   existujícího engine rozhraní a uvolní se při přechodu do pozadí.
5. Předání: Xcode projekt a zdroje v repozitáři, příprava dat na Macu,
   jasné nastavení Development Team a protokol skutečného testu zařízení.

## První implementační etapa
Začít bodem 1, nikoli vizuálním obalem aplikace. Jeho výstupem bude testovatelný
ARM64 základ a dekodér mapových struktur. Nejprve inventář používaných typů
mapy, jejich velikostí a relokací, poté převod a testy se skutečnými daty.
Rozsah další etapy se určí podle výsledků těchto testů. Xcode projekt nesmí
skrývat neimplementovaný engine za úvodní obrazovkou nebo prázdným plátnem.

## Ověření a omezení
Zde lze ověřovat datový převod a přenositelné části C++ na 64bitovém hostiteli.
Apple specifický kód a výkon musí následně ověřit Mac a fyzický iPhone.
Bez Apple SDK nejsou tvrzení „sestaveno pro iPhone“ nebo „hra funguje“ platná.
Výběr podepisovacího týmu patří uživateli, žádné certifikáty se nepřibalují.

## Primární dokumentace
Apple: https://developer.apple.com/documentation/metal/migrating-opengl-code-to-metal
Apple GLES guide: https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/Introduction/Introduction.html
