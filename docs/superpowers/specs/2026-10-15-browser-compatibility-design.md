# Návrh přestavby platformní vrstvy BO1 Zombies pro prohlížeč
Datum: 2026-10-15. Stav: návrh k posouzení, implementace nové architektury nezahájena.

## Cíl a hranice
Spustit stávající mapu Kino der Toten v Safari s WebGL2, lokálně uloženými daty a dotykovým ovládáním. Zachovat původní herní logiku, formáty map a existující data. Úspěchem je skutečné načtení mapy, vykreslený svět a ovladatelný hráč; sestavení Wasm ani vytvoření grafického zařízení tento výsledek nepotvrzují.

## Posouzené možnosti
1. Pokračovat v jednotlivých opravách stávající emulace Windows. Nejmenší zásah, ale obtížné dokazování správnosti vzájemně závislých čekání.
2. Systematicky přepracovat platformní vrstvu a ponechat herní jádro. Doporučená varianta: umožňuje samostatně ověřit plánovač, synchronizaci, soubory a grafické předávání.
3. Přepsat celou hru do nového enginu. Znamenalo by znovu implementovat chování, skripty a podporu dat; rozsah výrazně přesahuje opravu portu.

## Zjištěný stav
Engine se sestavuje ze zdrojů KisakBlack na revizi 65d1eb9a21898ae43b27f93e8204dc5d03560d70 s mobilními úpravami. Běží bez sdílené paměti, pomocí kooperativních vláken Asyncify. Pevné kontexty používají 15 bank TLS, obecná CreateThread vlákna dostávají ID od 64. Oprava na main nově odděluje tyto případy a zachovává banku vybranou inicializací pracovního vlákna.

Kontrola zdrojů dále ukazuje riziková místa: konečná čekání nemají spolehlivě vynucený časový limit; některé návraty z čekání nepředstavují prokázané splnění podmínky; kooperativní mutexy a nativní zámky nemají jednotnou identitu vlastníka. Tyto nálezy vyžadují reprodukční testy před změnou implementace. Poslední uživatelské logy končí v načítání grafických dat či po vytvoření zařízení; samy neurčují jedinou příčinu zastavení.

## Navržené části
- Jeden plánovač s explicitní identitou úlohy, stavem připravena/běží/čeká/dokončena a přesně definovaným předáním řízení.
- Kontext úlohy oddělený od ID operačního vlákna; řízená obnova TLS při každém přepnutí. Prověřit i další thread_local proměnné.
- Události a zámky se zachovanou sémantikou: automatický/manuální reset, rekurzivní vlastnictví, monotónní časové limity. Probuzení vždy vede k opětovné kontrole podmínky.
- Načítání souborů přes existující rozhraní s omezeným objemem práce mezi předáními prohlížeči. Zachovat kontrolu integrity, práci s OPFS a možnost opakování po chybě.
- Grafické příkazy s jasným vlastníkem WebGL kontextu a definovanou hranicí dokončení práce. Ztráta kontextu musí skončit rozpoznatelným stavem.
- Diagnostika čekání: úloha, objekt, vlastník, důvod a doba; omezené výpisy nesmí zamrazit stránku.

## Pořadí a ověření
1. Reprodukovatelné testy současných čekání, událostí, zámků a TLS bez spuštění celé hry.
2. Opravit prokázané odchylky platformní vrstvy po malých změnách; kontrolovat stávající přenositelné testy.
3. Integračně ověřit start, dokončení databázového načítání a první snímek s reálným WebGL2.
4. V Safari ověřit načtení Kina, pohyb/rozhlížení, základní herní interakci, obnovení stránky z cache a opakovaný start.
5. Zařazovat změny do hlavní větve až s uvedením toho, co bylo skutečně ověřeno. Zachovat možnost návratu k předchozímu kompletnímu páru JS/Wasm.

## Praktické omezení
Aktuální prostředí umožňuje sestavení a automatické testy, ale dostupný prohlížeč neposkytuje WebGL2. Plné ověření na Safari proto zatím není dostupné. Nelze označit hru za funkční pouze podle úspěšné CI kontroly.
