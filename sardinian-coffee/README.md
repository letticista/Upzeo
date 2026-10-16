# Sardinian Coffee Corner · reel 3D

Questa cartella contiene i video verticali per Reels, generati interamente da codice. Le versioni v1–v3 sono in Three.js (1080×1920, renderizzate in Chromium); la v4 è in Blender/Cycles in 4K. FFmpeg si occupa di color grading, audio sintetizzato e codifica H.264.

| Versione | Script | Output | Durata |
|---|---|---|---|
| v1 · logo 3D cromato | `render.mjs` | `sardinian_coffee_reveal.mp4` | 6 s |
| v2 · dalla macinatura alla tazza col logo | `v2/render.mjs` | `sardinian_coffee_reveal_v2.mp4` | 8 s |
| v3 · outro Instagram realistico | `v3/render.mjs` | `sardinian_coffee_outro_v3.mp4` | 12 s |
| **v4 · Blender/Cycles, 4K verticale, fisica vera** | `v4/build.py` + `v4/render.py` + `v4/encode.py` | `sardinian_coffee_outro_v4_4k.mp4` | 12 s |

## v4 · 4K verticale in path tracing (consigliata)

La v4 è rifatta da zero in **Blender 5.2 LTS con Cycles** (path tracing). Ogni inquadratura è una scena Blender sulla stessa timeline; la fisica è simulata e "cotta" (baked) quando si costruisce il file, poi il rendering gira sulla GPU del tuo Mac.

| Tempo | Inquadratura | Cosa succede | Fisica |
|---|---|---|---|
| 0,0–1,0 s | chicchi | i chicchi cadono al rallentatore nell'imbuto della macina | corpi rigidi Bullet (massa da volume × 0,65 g/cm³, attrito e rimbalzo misurati), 20 sotto-passi per fotogramma |
| 1,0–2,6 s | macine | macine piane tipo **Ceado E6C** (64 mm, 48 denti curvi, rivestimento iridescente Opalglide, 1480 giri/min); i chicchi entrano e si **frantumano davvero** | ogni chicco è pre-fratturato in 8–12 pezzi (Voronoi) tenuti insieme da vincoli che si rompono all'urto coi denti; 20 sotto-passi, 30 iterazioni |
| 2,6–4,0 s | dose e tamper | il macinato scende nel cestello, forma un cono, il tamper lo pressa | particelle con resistenza dell'aria e un campo di altezze con angolo di riposo; ≥ 15 sotto-passi |
| 4,0–7,2 s | estrazione bottomless | gocce in **punti a caso** del filtro, crescono, scivolano e si fondono, poi in circa un secondo diventano **un unico cono e un unico filo**; nella tazza si forma la crema | simulazione propria a 24 sotto-passi: gocce pendenti (angolo di contatto, isteresi, goccia che si stacca a ~4 mm), coalescenza, film che drena verso il centro, getto con instabilità di Rayleigh-Plateau, gocce che cadono con attrito dell'aria |
| 7,2–12 s | tazza | crema dall'alto, la camera sale, il logo si stampa sulla tazza, il claim | vapore volumetrico, scintille dorate |

Specifiche di rendering usate (in `v4/coffee/stage.py`): 2160×3840 (4K UHD verticale), Cycles path tracing (OptiX sulle schede NVIDIA, Metal sui Mac), vista colore **AgX** su spazio di lavoro **ACEScg**, motion blur reale con otturatore 0,5 (180°), 16 rimbalzi totali (diffusi 6, glossy 8, trasmissione 12, volume 4), caustiche riflesse e rifratte attive, campionamento adattivo fino a 256 campioni + denoiser OpenImageDenoise, PNG a 16 bit. Materiali Principled BSDF con rugosità non uniforme, normal map ad alta frequenza, micro-displacement sul macinato, subsurface scattering (crema, porcellana, foglie di mirto), IOR fisici (caffè 1,345, porcellana/smalto 1,5–1,52). Illuminazione: HDRI di una caffetteria (`comfy_cafe`) + softbox ad area con potenze reali in watt.

### Cosa serve sul Mac

1. **Blender 5.2 LTS** per Apple Silicon: <https://download.blender.org/release/Blender5.2/blender-5.2.0-macos-arm64.dmg>. Trascinalo in Applicazioni. Nei comandi qui sotto `blender` è
   `/Applications/Blender.app/Contents/MacOS/Blender` (puoi creare un alias: `alias blender=/Applications/Blender.app/Contents/MacOS/Blender`).
2. **FFmpeg**: `brew install ffmpeg`.
3. Circa **15 GB liberi** su disco (720 PNG a 16 bit in 4K).

### Comandi

```bash
cd ~/Upzeo/sardinian-coffee
git pull

# 1. costruisce il file Blender e calcola tutta la fisica (qualche minuto) -> v4/coffee.blend
blender -b --factory-startup -P v4/build.py

# 2. prova veloce: tre fotogrammi a piena qualità, stima del tempo totale
blender -b v4/coffee.blend -P v4/render.py -- --bench

# 3. (consigliato) bozza di tutto il film a 1/4 di risoluzione, per controllare movimenti e tempi
blender -b v4/coffee.blend -P v4/render.py -- --scale 0.25 --samples 32 --out v4/frames_draft
python3 v4/encode.py -- --frames v4/frames_draft --scale 0.25 --out bozza_v4.mp4

# 4. rendering finale 4K (riprende da dove si era fermato se lo interrompi)
blender -b v4/coffee.blend -P v4/render.py

# 5. video finale con titolo e audio -> sardinian_coffee_outro_v4_4k.mp4
python3 v4/encode.py
```

Il rendering in 4K con path tracing è lungo: il comando `--bench` ti dice quanto ci vorrà sul tuo Mac. Se è troppo:
- `--samples 128` dimezza circa i tempi (il denoiser compensa bene);
- costruisci a 30 fps invece di 60 (`blender -b --factory-startup -P v4/build.py -- --fps 30`, poi `python3 v4/encode.py -- --fps 30`): metà dei fotogrammi;
- puoi dividere il lavoro fra più computer con `--frames 1-360` e `--frames 361-720`;
- `--shots extract` renderizza una sola inquadratura.

Fotogrammi singoli di prova: `blender -b v4/coffee.blend -P v4/render.py -- --still 300,450 --scale 0.5` (finiscono in `v4/preview/`).

## v3 · outro per Instagram

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
