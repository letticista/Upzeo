# Sardinian Coffee Corner · reel 3D

Questa cartella contiene due video verticali per Reels (1080×1920, 60 fps), generati interamente da codice. La scena 3D è fatta in Three.js e renderizzata fotogramma per fotogramma in Chromium. FFmpeg si occupa di color grading, audio sintetizzato e codifica H.264.

| Versione | Script | Output | Durata |
|---|---|---|---|
| v1 · logo 3D cromato | `render.mjs` | `sardinian_coffee_reveal.mp4` | 6 s |
| v2 · dalla macinatura alla tazza col logo | `v2/render.mjs` | `sardinian_coffee_reveal_v2.mp4` | 8 s |
| **v3 · outro Instagram realistico** | `v3/render.mjs` | `sardinian_coffee_outro_v3.mp4` | 12 s |

## v3 · outro per Instagram (consigliata)

Si apre con i chicchi in slow motion, poi le macine, la dose e il tamper. L'estrazione è con portafiltro senza fondo (bottomless), come nei video di Instagram: le gocce escono dai fori del filtro, si uniscono in un velo, si raccolgono nel cono e da lì scende un unico filo di caffè nella tazza. Dalla crema la camera sale fino alla tazza, dove si stampa il logo; il finale si ferma sul claim "Su cafè de Sardigna". Non ci sono scritte durante i passaggi.

Il look realistico è dato da:
- illuminazione e riflessi da un HDRI reale di una caffetteria, che fa anche da sfondo sfocato;
- profondità di campo, motion blur (4 sottofotogrammi per fotogramma), ambient occlusion e ombre morbide;
- macinato fatto con una texture scansionata (colore, normal, rugosità, AO e displacement), nel getto e nel cumulo; dopo il tamper resta una pastiglia compatta;
- il caffè è un liquido vero: rifrange quello che ha dietro e assorbe la luce secondo lo spessore (quasi nero al centro del filo, ambrato sui bordi), con striature di crema che scendono insieme al flusso;
- fisica del getto: il filo accelera, si assottiglia e in basso si increspa; il cono oscilla appena; nella tazza il getto scava una piccola conca con onde concentriche e la crema si allarga attorno; niente più goccioline finte;
- luci a pannello (soft box) per riflessi ampi e fotografici su metallo e liquido;
- micro-rilievi su chicchi, crema e porcellana;
- anti-aliasing da "supersampling": ogni fotogramma è la media di 4 sottofotogrammi spostati di frazioni di pixel, più una lieve aberrazione cromatica dell'obiettivo.

Il finale dura di più: la polvere dorata si spegne piano e la dissolvenza al nero dura 1,2 s.

```bash
cd ~/Upzeo/sardinian-coffee
git pull
npm run preview:v3:chrome -- 255,300,330,404,414 0.5   # fotogrammi di prova dell'estrazione in v3/preview/
npm run render:v3:chrome                      # video completo → sardinian_coffee_outro_v3.mp4
```

Se usi il Chromium di Playwright invece di Google Chrome, togli `:chrome` dai comandi (`npm run preview:v3`, `npm run render:v3`). I fotogrammi vanno direttamente a FFmpeg, quindi non servono file temporanei su disco.

Opzioni: `-- --mb=8` aumenta il motion blur (più lento); `-- --mb=1 --no-ao` dà una bozza veloce.

Crediti: HDRI `comfy_cafe` e texture `walnut_veneer` da [Poly Haven](https://polyhaven.com); texture `Ground048` da [ambientCG](https://ambientcg.com), ricolorata come caffè macinato. Tutte con licenza CC0.

## Renderizzare la v2 sul tuo computer (con la scheda video)

La parte lenta è il rendering 3D, non la codifica. Con una GPU vera Chromium disegna ogni fotogramma in una frazione di secondo, quindi i 480 fotogrammi richiedono pochi minuti invece di circa 40.

### Cosa serve

- **Node.js 18 o superiore** (consigliata la 22 LTS): <https://nodejs.org>
- **FFmpeg** nel PATH:
  - Windows: `winget install Gyan.FFmpeg` (poi riapri il terminale)
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
- Circa **4 GB liberi** su disco per i fotogrammi temporanei, che vengono cancellati alla fine.

### Comandi

```bash
git clone https://github.com/letticista/Upzeo.git
cd Upzeo
git checkout ccr-7ee232c1-yzdpt6
cd sardinian-coffee
npm install
npx playwright install chromium
npm run render:v2
```

Si apre una finestra di Chromium che usa la tua scheda video: lasciala aperta finché il terminale non scrive `wrote …sardinian_coffee_reveal_v2.mp4`. Il video finito si trova in `sardinian-coffee/sardinian_coffee_reveal_v2.mp4`.

### Opzioni utili

| Comando | Cosa fa |
|---|---|
| `npm run preview:v2 -- 0,240,479 0.5` | Salva solo alcuni fotogrammi (a metà risoluzione) in `v2/preview/` per un controllo veloce |
| `npm run render:v2 -- --workers=2` | Due finestre in parallelo, se la scheda video regge |
| `npm run render:v2:cpu` | Rendering software senza GPU: funziona ovunque ma è lento (circa 40 minuti su 4 core) |
| `node v2/render.mjs --encode-only --keep-frames` | Rifà solo grading, audio e codifica sui fotogrammi già presenti in `v2/.frames/` |
| `node v2/render.mjs --range=0-110` | Rifà solo un intervallo di fotogrammi e lascia gli altri |

Se `npx playwright install chromium` si blocca o la modalità GPU dà errore all'avvio, puoi usare Google Chrome già installato sul computer. Non serve scaricare Chromium:

```bash
npm run preview:v2:chrome -- 0,300,479 0.5   # test veloce
npm run render:v2:chrome                      # video completo
```

In ultima istanza, `npm run render:v2:cpu` fa tutto in software: funziona ovunque ma è lento.

## Dove cambiare le cose

- **Montaggio e tempi** (tagli, tamp, reveal del logo): le costanti `CUT_DOSE`, `CUT_EXTRACT`, `CUT_CUP`, `TAMP` e `REVEAL` in cima a `v2/scene.js`. Se le sposti, sposta anche quelle con lo stesso nome in `v2/render.mjs`, che sincronizzano l'audio.
- **Logo sulla tazza**: `v2/logo.png`, un PNG quadrato con sfondo trasparente fuori dal cerchio.
- **Claim finale** ("Su cafè de Sardigna"): `LABELS.tag` in `v2/scene.js`.
- **Colore e look**: il filtro `curves` nella funzione `encode()` di `v2/render.mjs`.

Il font Cinzel è distribuito con licenza SIL Open Font License (`assets/OFL.txt`).
