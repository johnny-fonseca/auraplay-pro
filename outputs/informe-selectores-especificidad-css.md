# Informe de distribución de selectores y especificidad por capa CSS

Generado automáticamente desde 39 hojas fuente CSS bajo `css/`, `skins/`, `styles/`, `fonts/`, `karaoke/` y `remote/`. Se analizaron 2175 reglas de estilo y 2521 ramas selectoras. La especificidad se presenta como (ID, clase/atributo/pseudoclase, tipo/pseudoelemento).

## Resumen global

| Capa | Hojas | Reglas | Selectores (ramas) | Promedio (ID, clase, tipo) | Máximo observado |
|---|---:|---:|---:|---:|---|
| base | 17 | 936 | 1074 | (0.37, 1.69, 0.22) | `2,2,1` · `#karaokeOverlay[data-karaoke-style="palco-esmeralda"] #kProgress:hover::-webkit-slider-thumb` |
| theme | 1 | 20 | 27 | (0.22, 1.04, 0.52) | `1,2,2` · `svg:not(.brand-logo):not(.brand-mark svg):not(#artDefault)` |
| skin | 10 | 307 | 334 | (0.00, 3.09, 0.34) | `0,6,1` · `:root[data-skin="emerald"] .art-wrap:has(.art-frame.spinning:not(.paused))::before` |
| surface | 8 | 820 | 965 | (0.03, 2.91, 0.90) | `2,2,1` · `html[data-ui="bento"] .player-panel #artFrame #artDefault` |
| finish | 3 | 92 | 121 | (0.00, 2.02, 0.31) | `0,6,1` · `:root[data-skin="neon"] .art-wrap:has(.art-frame.spinning:not(.paused))::before` |

## Histograma de especificidad por capa

Cada selector separado por coma cuenta como una rama. Los grupos con cero selectores no se muestran.

### `@layer base`

| Especificidad | Selectores | Proporción |
|---|---:|---:|
| (0,0,0) | 4 | 0.4% |
| (0,0,1) | 32 | 3.0% |
| (0,1,0) | 358 | 33.3% |
| (0,1,1) | 52 | 4.8% |
| (0,1,2) | 2 | 0.2% |
| (0,2,0) | 141 | 13.1% |
| (0,2,1) | 24 | 2.2% |
| (0,2,2) | 10 | 0.9% |
| (0,2,3) | 1 | 0.1% |
| (0,3,0) | 53 | 4.9% |
| (0,3,1) | 3 | 0.3% |
| (0,3,2) | 1 | 0.1% |
| (0,4,0) | 1 | 0.1% |
| (0,4,1) | 6 | 0.6% |
| (0,5,1) | 5 | 0.5% |
| (1,0,0) | 1 | 0.1% |
| (1,0,1) | 3 | 0.3% |
| (1,1,0) | 47 | 4.4% |
| (1,1,1) | 16 | 1.5% |
| (1,2,0) | 157 | 14.6% |
| (1,2,1) | 19 | 1.8% |
| (1,2,2) | 7 | 0.7% |
| (1,3,0) | 76 | 7.1% |
| (1,3,1) | 7 | 0.7% |
| (1,3,2) | 6 | 0.6% |
| (1,4,0) | 17 | 1.6% |
| (1,4,1) | 1 | 0.1% |
| (1,5,0) | 7 | 0.7% |
| (2,1,0) | 2 | 0.2% |
| (2,1,1) | 9 | 0.8% |
| (2,2,0) | 2 | 0.2% |
| (2,2,1) | 4 | 0.4% |

### `@layer theme`

| Especificidad | Selectores | Proporción |
|---|---:|---:|
| (0,0,1) | 2 | 7.4% |
| (0,1,0) | 7 | 25.9% |
| (0,1,1) | 6 | 22.2% |
| (0,2,0) | 5 | 18.5% |
| (0,2,1) | 1 | 3.7% |
| (1,0,0) | 2 | 7.4% |
| (1,0,1) | 2 | 7.4% |
| (1,1,1) | 1 | 3.7% |
| (1,2,2) | 1 | 3.7% |

### `@layer skin`

| Especificidad | Selectores | Proporción |
|---|---:|---:|
| (0,0,0) | 1 | 0.3% |
| (0,0,1) | 3 | 0.9% |
| (0,1,0) | 2 | 0.6% |
| (0,2,0) | 17 | 5.1% |
| (0,2,1) | 14 | 4.2% |
| (0,3,0) | 151 | 45.2% |
| (0,3,1) | 83 | 24.9% |
| (0,3,2) | 1 | 0.3% |
| (0,4,0) | 49 | 14.7% |
| (0,4,1) | 6 | 1.8% |
| (0,6,1) | 7 | 2.1% |

### `@layer surface`

| Especificidad | Selectores | Proporción |
|---|---:|---:|
| (0,1,1) | 36 | 3.7% |
| (0,1,2) | 35 | 3.6% |
| (0,1,3) | 8 | 0.8% |
| (0,2,0) | 15 | 1.6% |
| (0,2,1) | 177 | 18.3% |
| (0,2,2) | 57 | 5.9% |
| (0,2,3) | 22 | 2.3% |
| (0,3,0) | 151 | 15.6% |
| (0,3,1) | 99 | 10.3% |
| (0,3,2) | 49 | 5.1% |
| (0,3,3) | 21 | 2.2% |
| (0,4,0) | 130 | 13.5% |
| (0,4,1) | 37 | 3.8% |
| (0,4,2) | 14 | 1.5% |
| (0,4,3) | 1 | 0.1% |
| (0,5,0) | 50 | 5.2% |
| (0,5,1) | 20 | 2.1% |
| (0,5,2) | 4 | 0.4% |
| (0,6,0) | 14 | 1.5% |
| (0,7,0) | 1 | 0.1% |
| (1,1,1) | 9 | 0.9% |
| (1,1,2) | 3 | 0.3% |
| (1,2,1) | 10 | 1.0% |
| (1,3,1) | 1 | 0.1% |
| (2,2,1) | 1 | 0.1% |

### `@layer finish`

| Especificidad | Selectores | Proporción |
|---|---:|---:|
| (0,0,0) | 2 | 1.7% |
| (0,0,1) | 1 | 0.8% |
| (0,0,2) | 1 | 0.8% |
| (0,1,0) | 24 | 19.8% |
| (0,1,1) | 15 | 12.4% |
| (0,1,2) | 1 | 0.8% |
| (0,2,0) | 36 | 29.8% |
| (0,2,1) | 8 | 6.6% |
| (0,3,0) | 15 | 12.4% |
| (0,3,1) | 6 | 5.0% |
| (0,4,0) | 6 | 5.0% |
| (0,4,1) | 2 | 1.7% |
| (0,5,0) | 3 | 2.5% |
| (0,6,1) | 1 | 0.8% |

## Desglose por hoja

En «histograma compacto», por ejemplo `(0,2,1)×8`, se indica el número de ramas con esa especificidad.

| Capa | Archivo | Reglas | Ramas selectoras | Histograma compacto |
|---|---|---:|---:|---|
| base | `css/components.css` | 112 | 118 | (0,1,0)×61<br>(0,1,1)×14<br>(0,1,2)×1<br>(0,2,0)×30<br>(0,2,1)×3<br>(0,2,2)×2<br>(0,3,0)×6<br>(0,3,2)×1 |
| finish | `css/finish.css` | 41 | 56 | (0,0,0)×2<br>(0,0,1)×1<br>(0,0,2)×1<br>(0,1,0)×17<br>(0,1,1)×3<br>(0,1,2)×1<br>(0,2,0)×11<br>(0,2,1)×6<br>(0,3,0)×5<br>(0,3,1)×2<br>(0,4,0)×2<br>(0,4,1)×2<br>(0,5,0)×2<br>(0,6,1)×1 |
| base | `css/layout.css` | 11 | 11 | (0,1,0)×10<br>(0,2,0)×1 |
| base | `css/player.css` | 97 | 104 | (0,1,0)×42<br>(0,1,1)×10<br>(0,2,0)×26<br>(0,2,1)×6<br>(0,2,2)×1<br>(0,3,0)×18<br>(0,3,1)×1 |
| base | `css/playlist.css` | 62 | 65 | (0,1,0)×21<br>(0,1,1)×5<br>(0,1,2)×1<br>(0,2,0)×8<br>(0,2,1)×5<br>(0,2,2)×2<br>(0,2,3)×1<br>(0,3,0)×8<br>(0,3,1)×2<br>(0,4,0)×1<br>(0,4,1)×6<br>(0,5,1)×5 |
| base | `css/queue.css` | 68 | 69 | (0,1,0)×31<br>(0,1,1)×3<br>(0,2,0)×23<br>(0,2,1)×5<br>(0,2,2)×5<br>(0,3,0)×2 |
| base | `css/reset.css` | 20 | 35 | (0,0,0)×2<br>(0,0,1)×26<br>(0,1,0)×5<br>(0,1,1)×2 |
| base | `css/responsive.css` | 32 | 35 | (0,0,1)×2<br>(0,1,0)×28<br>(0,1,1)×1<br>(0,2,0)×4 |
| theme | `css/theme.css` | 20 | 27 | (0,0,1)×2<br>(0,1,0)×7<br>(0,1,1)×6<br>(0,2,0)×5<br>(0,2,1)×1<br>(1,0,0)×2<br>(1,0,1)×2<br>(1,1,1)×1<br>(1,2,2)×1 |
| finish | `css/vinyl-interaction.css` | 42 | 56 | (0,1,0)×6<br>(0,1,1)×10<br>(0,2,0)×25<br>(0,2,1)×2<br>(0,3,0)×9<br>(0,3,1)×2<br>(0,4,0)×2 |
| finish | `css/vinyl.css` | 9 | 9 | (0,1,0)×1<br>(0,1,1)×2<br>(0,3,0)×1<br>(0,3,1)×2<br>(0,4,0)×2<br>(0,5,0)×1 |
| base | `fonts/fonts.css` | 0 | 0 |  |
| base | `karaoke/cinema/cinema.css` | 10 | 11 | (1,1,0)×1<br>(1,1,1)×2<br>(1,2,0)×5<br>(1,3,0)×2<br>(1,4,0)×1 |
| base | `karaoke/guilloche/guilloche.css` | 27 | 40 | (0,1,0)×2<br>(0,2,0)×1<br>(1,1,0)×2<br>(1,2,0)×20<br>(1,3,0)×14<br>(1,4,0)×1 |
| base | `karaoke/kinetico/kinetic.css` | 24 | 25 | (1,1,0)×1<br>(1,1,1)×2<br>(1,2,0)×11<br>(1,2,1)×3<br>(1,3,0)×6<br>(1,4,0)×2 |
| base | `karaoke/neon/neon.css` | 17 | 19 | (1,1,0)×1<br>(1,1,1)×2<br>(1,2,0)×9<br>(1,2,1)×2<br>(1,3,0)×4<br>(1,4,0)×1 |
| base | `karaoke/palco-esmeralda/palco-esmeralda.css` | 77 | 95 | (0,0,0)×1<br>(1,1,0)×5<br>(1,2,0)×38<br>(1,2,1)×7<br>(1,3,0)×25<br>(1,3,1)×1<br>(1,4,0)×3<br>(1,4,1)×1<br>(1,5,0)×1<br>(2,1,0)×1<br>(2,1,1)×7<br>(2,2,0)×1<br>(2,2,1)×4 |
| base | `karaoke/shared/karaoke-common.css` | 104 | 129 | (1,0,0)×1<br>(1,0,1)×3<br>(1,1,0)×36<br>(1,1,1)×10<br>(1,2,0)×41<br>(1,2,1)×7<br>(1,2,2)×7<br>(1,3,0)×10<br>(1,3,1)×4<br>(1,3,2)×6<br>(1,4,0)×3<br>(1,5,0)×1 |
| base | `karaoke/shared/karaoke.css` | 70 | 86 | (0,1,0)×45<br>(0,1,1)×11<br>(0,2,0)×19<br>(0,2,1)×3<br>(0,3,0)×8 |
| base | `karaoke/yozakura/yozakura.css` | 45 | 65 | (1,1,0)×1<br>(1,2,0)×32<br>(1,3,0)×15<br>(1,3,1)×2<br>(1,4,0)×6<br>(1,5,0)×5<br>(2,1,0)×1<br>(2,1,1)×2<br>(2,2,0)×1 |
| base | `remote/remote.css` | 160 | 167 | (0,0,0)×1<br>(0,0,1)×4<br>(0,1,0)×113<br>(0,1,1)×6<br>(0,2,0)×29<br>(0,2,1)×2<br>(0,3,0)×11<br>(1,2,0)×1 |
| skin | `skins/brass.css` | 17 | 17 | (0,1,0)×1<br>(0,2,0)×2<br>(0,3,0)×6<br>(0,3,1)×7<br>(0,4,0)×1 |
| skin | `skins/emerald.css` | 31 | 35 | (0,2,0)×2<br>(0,3,0)×17<br>(0,3,1)×7<br>(0,4,0)×7<br>(0,6,1)×2 |
| skin | `skins/glacier.css` | 36 | 39 | (0,2,0)×2<br>(0,3,0)×23<br>(0,3,1)×8<br>(0,4,0)×5<br>(0,6,1)×1 |
| skin | `skins/gres.css` | 13 | 13 | (0,2,0)×3<br>(0,3,0)×3<br>(0,3,1)×6<br>(0,4,0)×1 |
| skin | `skins/neon.css` | 29 | 34 | (0,2,0)×2<br>(0,3,0)×16<br>(0,3,1)×8<br>(0,4,0)×7<br>(0,6,1)×1 |
| skin | `skins/paper.css` | 22 | 24 | (0,2,0)×1<br>(0,2,1)×6<br>(0,3,0)×7<br>(0,3,1)×7<br>(0,4,0)×1<br>(0,6,1)×2 |
| skin | `skins/ruby.css` | 42 | 45 | (0,2,0)×2<br>(0,3,0)×26<br>(0,3,1)×8<br>(0,4,0)×8<br>(0,6,1)×1 |
| skin | `skins/telar.css` | 85 | 95 | (0,0,0)×1<br>(0,0,1)×3<br>(0,1,0)×1<br>(0,2,0)×2<br>(0,2,1)×8<br>(0,3,0)×39<br>(0,3,1)×18<br>(0,3,2)×1<br>(0,4,0)×17<br>(0,4,1)×5 |
| skin | `skins/titanium.css` | 17 | 17 | (0,2,0)×1<br>(0,3,0)×8<br>(0,3,1)×7<br>(0,4,0)×1 |
| skin | `skins/ulm.css` | 15 | 15 | (0,3,0)×6<br>(0,3,1)×7<br>(0,4,0)×1<br>(0,4,1)×1 |
| surface | `styles/aurora.css` | 126 | 134 | (0,1,1)×8<br>(0,1,2)×17<br>(0,1,3)×2<br>(0,2,1)×38<br>(0,2,2)×15<br>(0,2,3)×7<br>(0,3,1)×16<br>(0,3,2)×13<br>(0,3,3)×7<br>(0,4,1)×3<br>(1,1,1)×3<br>(1,1,2)×1<br>(1,2,1)×4 |
| surface | `styles/bento.css` | 112 | 124 | (0,1,1)×13<br>(0,1,2)×1<br>(0,1,3)×2<br>(0,2,1)×45<br>(0,2,2)×10<br>(0,2,3)×1<br>(0,3,1)×16<br>(0,3,2)×7<br>(0,4,1)×10<br>(0,4,2)×2<br>(0,4,3)×1<br>(0,5,1)×10<br>(0,5,2)×4<br>(1,3,1)×1<br>(2,2,1)×1 |
| surface | `styles/brutalism.css` | 127 | 132 | (0,1,1)×5<br>(0,1,2)×9<br>(0,1,3)×2<br>(0,2,1)×40<br>(0,2,2)×16<br>(0,2,3)×7<br>(0,3,1)×19<br>(0,3,2)×14<br>(0,3,3)×7<br>(0,4,1)×4<br>(0,4,2)×2<br>(1,1,1)×3<br>(1,1,2)×1<br>(1,2,1)×3 |
| surface | `styles/claymorphism.css` | 93 | 127 | (0,1,1)×1<br>(0,2,0)×3<br>(0,2,1)×4<br>(0,3,0)×45<br>(0,3,1)×10<br>(0,3,2)×1<br>(0,4,0)×35<br>(0,4,1)×7<br>(0,4,2)×2<br>(0,5,0)×9<br>(0,5,1)×3<br>(0,6,0)×6<br>(0,7,0)×1 |
| surface | `styles/flat.css` | 125 | 130 | (0,1,1)×6<br>(0,1,2)×8<br>(0,1,3)×2<br>(0,2,1)×38<br>(0,2,2)×16<br>(0,2,3)×7<br>(0,3,1)×19<br>(0,3,2)×14<br>(0,3,3)×7<br>(0,4,1)×4<br>(0,4,2)×2<br>(1,1,1)×3<br>(1,1,2)×1<br>(1,2,1)×3 |
| surface | `styles/glassmorphism.css` | 79 | 106 | (0,1,1)×1<br>(0,2,0)×4<br>(0,2,1)×4<br>(0,3,0)×36<br>(0,3,1)×6<br>(0,4,0)×29<br>(0,4,1)×3<br>(0,4,2)×2<br>(0,5,0)×13<br>(0,5,1)×4<br>(0,6,0)×4 |
| surface | `styles/neumorphism.css` | 74 | 97 | (0,1,1)×1<br>(0,2,0)×4<br>(0,2,1)×4<br>(0,3,0)×30<br>(0,3,1)×6<br>(0,4,0)×31<br>(0,4,1)×3<br>(0,4,2)×2<br>(0,5,0)×13<br>(0,5,1)×1<br>(0,6,0)×2 |
| surface | `styles/skeuomorphism.css` | 84 | 115 | (0,1,1)×1<br>(0,2,0)×4<br>(0,2,1)×4<br>(0,3,0)×40<br>(0,3,1)×7<br>(0,4,0)×35<br>(0,4,1)×3<br>(0,4,2)×2<br>(0,5,0)×15<br>(0,5,1)×2<br>(0,6,0)×2 |

## Selectores de skins que tocan componentes

Lista reproducible de selectores no-`:root` presentes en las diez skins. Los conteos son ramas selectoras; reglas agrupadas, pseudo-elementos y contextos anidados se conservan como aparecen en la fuente. Este inventario sirve para planificar qué se convierte a tokens; no implica que todo selector deba eliminarse (tocadiscos y ornamentación identitaria permanecen en skin).

### brass — 12 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,0) | `:root[data-skin="brass"] .brass-glass` |
| (0,3,1) | `:root[data-skin="brass"] .brass-glass::before` |
| (0,3,0) | `:root[data-skin="brass"] .brass-glass` |
| (0,3,0) | `:root[data-skin="brass"] .brass-glass` |
| (0,3,1) | `:root[data-skin="brass"] .art-wrap::before` |
| (0,3,1) | `:root[data-skin="brass"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="brass"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="brass"] .art-frame img` |
| (0,4,0) | `:root[data-skin="brass"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="brass"] .art-wrap::after` |
| (0,3,0) | `:root[data-skin="brass"] .tonearm` |
| (0,3,1) | `:root[data-skin="brass"] .tonearm::before` |

### emerald — 32 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,0) | `:root[data-skin="emerald"] .aurora-bg` |
| (0,3,0) | `:root[data-skin="emerald"] .brand-mark` |
| (0,3,0) | `:root[data-skin="emerald"] .brand-title` |
| (0,3,0) | `:root[data-skin="emerald"] .panel-title` |
| (0,3,0) | `:root[data-skin="emerald"] .modal-title` |
| (0,3,0) | `:root[data-skin="emerald"] .now-title` |
| (0,4,0) | `:root[data-skin="emerald"] .progress-meta .now-mini-title` |
| (0,4,0) | `:root[data-skin="emerald"] .karaoke-mini .lyric-current` |
| (0,3,0) | `:root[data-skin="emerald"] .k-line` |
| (0,4,0) | `:root[data-skin="emerald"] .transport .btn-play` |
| (0,3,0) | `:root[data-skin="emerald"] .karaoke-overlay` |
| (0,3,0) | `:root[data-skin="emerald"] .toast` |
| (0,4,0) | `:root[data-skin="emerald"][data-theme="light"] .toast` |
| (0,3,0) | `[data-skin="emerald"] [data-theme="light"] .toast` |
| (0,4,0) | `:root[data-skin="emerald"][data-theme="light"] .now-title` |
| (0,3,0) | `[data-skin="emerald"] [data-theme="light"] .now-title` |
| (0,3,0) | `:root[data-skin="emerald"] .now-title` |
| (0,3,0) | `:root[data-skin="emerald"] .now-bar` |
| (0,4,0) | `:root[data-skin="emerald"][data-theme="light"] .now-bar` |
| (0,3,0) | `[data-skin="emerald"] [data-theme="light"] .now-bar` |
| (0,3,1) | `:root[data-skin="emerald"] .art-wrap::before` |
| (0,6,1) | `:root[data-skin="emerald"] .art-wrap:has(.art-frame.spinning:not(.paused))::before` |
| (0,6,1) | `:root[data-skin="emerald"] .art-wrap:has(.art-frame.spinning:not(.paused))::before` |
| (0,3,0) | `:root[data-skin="emerald"] .art-frame` |
| (0,3,1) | `:root[data-skin="emerald"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="emerald"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="emerald"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="emerald"] .art-frame img` |
| (0,4,0) | `:root[data-skin="emerald"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="emerald"] .art-wrap::after` |
| (0,3,0) | `:root[data-skin="emerald"] .tonearm` |
| (0,3,1) | `:root[data-skin="emerald"] .tonearm::before` |

### glacier — 36 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,0) | `:root[data-skin="glacier"] .aurora-bg` |
| (0,3,0) | `:root[data-skin="glacier"] .brand-mark` |
| (0,3,0) | `:root[data-skin="glacier"] .brand-title` |
| (0,3,0) | `:root[data-skin="glacier"] .brand-subtitle` |
| (0,3,0) | `:root[data-skin="glacier"] .panel-title` |
| (0,3,0) | `:root[data-skin="glacier"] .modal-title` |
| (0,3,0) | `:root[data-skin="glacier"] .now-eyebrow` |
| (0,3,0) | `:root[data-skin="glacier"] .now-title` |
| (0,3,0) | `:root[data-skin="glacier"] .btn-tab` |
| (0,3,0) | `:root[data-skin="glacier"] .song-item` |
| (0,3,0) | `:root[data-skin="glacier"] .song-thumb` |
| (0,3,0) | `:root[data-skin="glacier"] .progress-bar` |
| (0,4,0) | `:root[data-skin="glacier"] .progress-bar:hover` |
| (0,3,0) | `:root[data-skin="glacier"] .progress-fill` |
| (0,3,0) | `:root[data-skin="glacier"] .progress-thumb` |
| (0,4,0) | `:root[data-skin="glacier"] .transport .btn-play` |
| (0,3,0) | `:root[data-skin="glacier"] .karaoke-overlay` |
| (0,3,0) | `:root[data-skin="glacier"] .toast` |
| (0,4,0) | `:root[data-skin="glacier"][data-theme="light"] .toast` |
| (0,3,0) | `[data-skin="glacier"] [data-theme="light"] .toast` |
| (0,3,1) | `:root[data-skin="glacier"] .player-panel::before` |
| (0,3,0) | `:root[data-skin="glacier"] .now-title` |
| (0,3,0) | `:root[data-skin="glacier"] .now-bar` |
| (0,4,0) | `:root[data-skin="glacier"][data-theme="light"] .now-bar` |
| (0,3,0) | `[data-skin="glacier"] [data-theme="light"] .now-bar` |
| (0,3,1) | `:root[data-skin="glacier"] .art-wrap::before` |
| (0,6,1) | `:root[data-skin="glacier"] .art-wrap:has(.art-frame.spinning:not(.paused))::before` |
| (0,3,0) | `:root[data-skin="glacier"] .art-frame` |
| (0,3,1) | `:root[data-skin="glacier"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="glacier"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="glacier"] .art-frame img` |
| (0,4,0) | `:root[data-skin="glacier"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="glacier"] .art-wrap::after` |
| (0,3,0) | `:root[data-skin="glacier"] .tonearm` |
| (0,3,1) | `:root[data-skin="glacier"] .tonearm::before` |
| (0,3,1) | `:root[data-skin="glacier"] .art-wrap::before` |

### gres — 8 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,1) | `:root[data-skin="gres"] .art-wrap::before` |
| (0,3,1) | `:root[data-skin="gres"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="gres"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="gres"] .art-frame img` |
| (0,4,0) | `:root[data-skin="gres"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="gres"] .art-wrap::after` |
| (0,3,0) | `:root[data-skin="gres"] .tonearm` |
| (0,3,1) | `:root[data-skin="gres"] .tonearm::before` |

### neon — 31 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,0) | `:root[data-skin="neon"] .aurora-bg` |
| (0,3,0) | `:root[data-skin="neon"] .brand-mark` |
| (0,3,0) | `:root[data-skin="neon"] .brand-title` |
| (0,3,0) | `:root[data-skin="neon"] .panel-title` |
| (0,3,0) | `:root[data-skin="neon"] .now-title` |
| (0,3,0) | `:root[data-skin="neon"] .progress-fill` |
| (0,3,0) | `:root[data-skin="neon"] .progress-thumb` |
| (0,4,0) | `:root[data-skin="neon"] .transport .btn-play` |
| (0,4,0) | `:root[data-skin="neon"] .btn-tab.active` |
| (0,4,0) | `:root[data-skin="neon"] .viz-card.active` |
| (0,3,0) | `:root[data-skin="neon"] .toast` |
| (0,4,0) | `:root[data-skin="neon"][data-theme="light"] .toast` |
| (0,3,0) | `[data-skin="neon"] [data-theme="light"] .toast` |
| (0,3,0) | `:root[data-skin="neon"] .karaoke-overlay` |
| (0,4,0) | `:root[data-skin="neon"][data-theme="light"] .now-title` |
| (0,3,0) | `[data-skin="neon"] [data-theme="light"] .now-title` |
| (0,3,0) | `:root[data-skin="neon"] .now-bar` |
| (0,4,0) | `:root[data-skin="neon"][data-theme="light"] .now-bar` |
| (0,3,0) | `[data-skin="neon"] [data-theme="light"] .now-bar` |
| (0,3,1) | `:root[data-skin="neon"] .art-wrap::before` |
| (0,6,1) | `:root[data-skin="neon"] .art-wrap:has(.art-frame.spinning:not(.paused))::before` |
| (0,3,0) | `:root[data-skin="neon"] .art-frame` |
| (0,3,1) | `:root[data-skin="neon"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="neon"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="neon"] .art-frame img` |
| (0,4,0) | `:root[data-skin="neon"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="neon"] .art-wrap::after` |
| (0,3,1) | `:root[data-skin="neon"] .player-panel::before` |
| (0,3,0) | `:root[data-skin="neon"] .tonearm` |
| (0,3,1) | `:root[data-skin="neon"] .tonearm::before` |
| (0,3,1) | `:root[data-skin="neon"] .art-wrap::before` |

### paper — 13 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,0) | `:root[data-skin="paper"] .paper-sheet` |
| (0,3,1) | `:root[data-skin="paper"] .paper-sheet::before` |
| (0,6,1) | `:root[data-skin="paper"][data-theme="light"] :root[data-skin="paper"] .paper-sheet::before` |
| (0,6,1) | `:root[data-skin="paper"]:not([data-theme="light"]) :root[data-skin="paper"] .paper-sheet::before` |
| (0,3,1) | `:root[data-skin="paper"] .art-wrap::before` |
| (0,3,0) | `:root[data-skin="paper"] .art-frame` |
| (0,3,1) | `:root[data-skin="paper"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="paper"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="paper"] .art-frame img` |
| (0,4,0) | `:root[data-skin="paper"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="paper"] .art-wrap::after` |
| (0,3,0) | `:root[data-skin="paper"] .tonearm` |
| (0,3,1) | `:root[data-skin="paper"] .tonearm::before` |

### ruby — 42 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,0) | `:root[data-skin="ruby"] .aurora-bg` |
| (0,3,0) | `:root[data-skin="ruby"] .noise-overlay` |
| (0,3,0) | `:root[data-skin="ruby"] .brand-mark` |
| (0,3,0) | `:root[data-skin="ruby"] .brand-title` |
| (0,3,0) | `:root[data-skin="ruby"] .brand-subtitle` |
| (0,3,0) | `:root[data-skin="ruby"] .panel-title` |
| (0,3,0) | `:root[data-skin="ruby"] .modal-title` |
| (0,3,0) | `:root[data-skin="ruby"] .now-eyebrow` |
| (0,3,0) | `:root[data-skin="ruby"] .now-title` |
| (0,4,0) | `:root[data-skin="ruby"] .progress-meta .now-mini-title` |
| (0,4,0) | `:root[data-skin="ruby"] .karaoke-mini .lyric-current` |
| (0,3,0) | `:root[data-skin="ruby"] .k-line` |
| (0,3,0) | `:root[data-skin="ruby"] .btn-tab` |
| (0,4,0) | `:root[data-skin="ruby"] .btn-tab.active` |
| (0,3,0) | `:root[data-skin="ruby"] .tag-chip` |
| (0,3,0) | `:root[data-skin="ruby"] .song-item` |
| (0,3,0) | `:root[data-skin="ruby"] .song-thumb` |
| (0,3,0) | `:root[data-skin="ruby"] .progress-bar` |
| (0,4,0) | `:root[data-skin="ruby"] .progress-bar:hover` |
| (0,3,0) | `:root[data-skin="ruby"] .progress-fill` |
| (0,3,0) | `:root[data-skin="ruby"] .progress-thumb` |
| (0,4,0) | `:root[data-skin="ruby"] .transport .btn-play` |
| (0,3,0) | `:root[data-skin="ruby"] .karaoke-overlay` |
| (0,3,0) | `:root[data-skin="ruby"] .toast` |
| (0,4,0) | `:root[data-skin="ruby"][data-theme="light"] .toast` |
| (0,3,0) | `[data-skin="ruby"] [data-theme="light"] .toast` |
| (0,3,1) | `:root[data-skin="ruby"] .player-panel::before` |
| (0,3,0) | `:root[data-skin="ruby"] .now-title` |
| (0,3,0) | `:root[data-skin="ruby"] .now-bar` |
| (0,4,0) | `:root[data-skin="ruby"][data-theme="light"] .now-bar` |
| (0,3,0) | `[data-skin="ruby"] [data-theme="light"] .now-bar` |
| (0,3,1) | `:root[data-skin="ruby"] .art-wrap::before` |
| (0,6,1) | `:root[data-skin="ruby"] .art-wrap:has(.art-frame.spinning:not(.paused))::before` |
| (0,3,0) | `:root[data-skin="ruby"] .art-frame` |
| (0,3,1) | `:root[data-skin="ruby"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="ruby"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="ruby"] .art-frame img` |
| (0,4,0) | `:root[data-skin="ruby"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="ruby"] .art-wrap::after` |
| (0,3,0) | `:root[data-skin="ruby"] .tonearm` |
| (0,3,1) | `:root[data-skin="ruby"] .tonearm::before` |
| (0,3,1) | `:root[data-skin="ruby"] .art-wrap::before` |

### telar — 76 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,1) | `:root[data-skin="telar"] .art-wrap::before` |
| (0,3,0) | `:root[data-skin="telar"] .art-frame` |
| (0,3,1) | `:root[data-skin="telar"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="telar"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="telar"] .art-frame img` |
| (0,4,0) | `:root[data-skin="telar"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="telar"] .art-wrap::after` |
| (0,3,0) | `:root[data-skin="telar"] .tonearm` |
| (0,3,1) | `:root[data-skin="telar"] .tonearm::before` |
| (0,3,0) | `:root[data-skin="telar"] .tl-num` |
| (0,3,0) | `:root[data-skin="telar"] .tl-label` |
| (0,3,0) | `:root[data-skin="telar"] .tl-title` |
| (0,3,0) | `:root[data-skin="telar"] .tl-panel` |
| (0,3,1) | `:root[data-skin="telar"] .tl-panel::before` |
| (0,3,1) | `:root[data-skin="telar"] .tl-panel::after` |
| (0,3,0) | `:root[data-skin="telar"] .tl-btn` |
| (0,4,0) | `:root[data-skin="telar"] .tl-btn:hover` |
| (0,4,0) | `:root[data-skin="telar"] .tl-btn:active` |
| (0,4,0) | `:root[data-skin="telar"] .tl-btn:focus-visible` |
| (0,4,0) | `:root[data-skin="telar"] .tl-btn:disabled` |
| (0,4,0) | `:root[data-skin="telar"] .tl-btn[aria-disabled="true"]` |
| (0,4,0) | `:root[data-skin="telar"] .tl-btn.is-on` |
| (0,4,0) | `:root[data-skin="telar"] .tl-btn[aria-pressed="true"]` |
| (0,3,0) | `:root[data-skin="telar"] .tl-btn--primary` |
| (0,4,0) | `:root[data-skin="telar"] .tl-btn--primary:hover` |
| (0,3,0) | `:root[data-skin="telar"] .tl-btn--icon` |
| (0,3,0) | `:root[data-skin="telar"] .tl-btn--play` |
| (0,3,0) | `:root[data-skin="telar"] .tl-range` |
| (0,3,1) | `:root[data-skin="telar"] .tl-range::-webkit-slider-runnable-track` |
| (0,3,1) | `:root[data-skin="telar"] .tl-range::-moz-range-track` |
| (0,3,1) | `:root[data-skin="telar"] .tl-range::-moz-range-progress` |
| (0,3,1) | `:root[data-skin="telar"] .tl-range::-webkit-slider-thumb` |
| (0,3,1) | `:root[data-skin="telar"] .tl-range::-moz-range-thumb` |
| (0,4,0) | `:root[data-skin="telar"] .tl-range:focus-visible` |
| (0,4,1) | `:root[data-skin="telar"] .tl-range:focus-visible::-webkit-slider-thumb` |
| (0,4,1) | `:root[data-skin="telar"] .tl-range:focus-visible::-moz-range-thumb` |
| (0,3,0) | `:root[data-skin="telar"] .tl-list` |
| (0,3,0) | `:root[data-skin="telar"] .tl-row` |
| (0,4,1) | `:root[data-skin="telar"] .tl-row + .tl-row::before` |
| (0,4,0) | `:root[data-skin="telar"] .tl-row:hover` |
| (0,4,0) | `:root[data-skin="telar"] .tl-row.is-active` |
| (0,4,1) | `:root[data-skin="telar"] .tl-row.is-active::after` |
| (0,3,0) | `:root[data-skin="telar"] .tl-row__title` |
| (0,3,0) | `:root[data-skin="telar"] .tl-row__meta` |
| (0,3,0) | `:root[data-skin="telar"] .tl-eq` |
| (0,3,0) | `:root[data-skin="telar"] .tl-eq__zero` |
| (0,3,0) | `:root[data-skin="telar"] .tl-eq__label` |
| (0,3,0) | `:root[data-skin="telar"] .tl-viz` |
| (0,3,1) | `:root[data-skin="telar"] .tl-viz::after` |
| (0,3,0) | `:root[data-skin="telar"] .tl-lyrics` |
| (0,3,0) | `:root[data-skin="telar"] .tl-line` |
| (0,4,0) | `:root[data-skin="telar"] .tl-line.is-active` |
| (0,4,0) | `:root[data-skin="telar"] .tl-line.is-active` |
| (0,3,0) | `:root[data-skin="telar"] .tl-scrim` |
| (0,3,2) | `:root[data-skin="telar"] dialog.tl-modal::backdrop` |
| (0,3,0) | `:root[data-skin="telar"] .tl-modal` |
| (0,3,0) | `:root[data-skin="telar"] .tl-modal__title` |
| (0,3,1) | `:root[data-skin="telar"] .tl-modal__title::after` |
| (0,3,0) | `:root[data-skin="telar"] .tl-toast` |
| (0,3,1) | `:root[data-skin="telar"] .tl-toast::before` |
| (0,4,0) | `:root[data-skin="telar"] .tl-toast.is-ok` |
| (0,4,0) | `:root[data-skin="telar"] .tl-toast.is-warn` |
| (0,4,0) | `:root[data-skin="telar"] .tl-toast.is-error` |
| (0,3,0) | `:root[data-skin="telar"] .tl-empty` |
| (0,3,1) | `:root[data-skin="telar"] .tl-empty::before` |
| (0,3,0) | `:root[data-skin="telar"] .tl-btn` |
| (0,3,0) | `:root[data-skin="telar"] .tl-row` |
| (0,3,1) | `:root[data-skin="telar"] .art-wrap::before` |
| (0,3,0) | `:root[data-skin="telar"] .tl-btn` |
| (0,3,0) | `:root[data-skin="telar"] .tl-row` |
| (0,3,0) | `:root[data-skin="telar"] .tl-line` |
| (0,3,0) | `:root[data-skin="telar"] .tl-toast` |
| (0,3,0) | `:root[data-skin="telar"] .tl-btn` |
| (0,3,0) | `:root[data-skin="telar"] .tl-panel` |
| (0,3,0) | `:root[data-skin="telar"] .tl-modal` |
| (0,4,1) | `:root[data-skin="telar"] .tl-row.is-active::after` |

### titanium — 12 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,0) | `:root[data-skin="titanium"] .titanium-glass` |
| (0,3,1) | `:root[data-skin="titanium"] .titanium-glass::before` |
| (0,3,0) | `:root[data-skin="titanium"] .titanium-glass` |
| (0,3,0) | `:root[data-skin="titanium"] .titanium-glass` |
| (0,3,1) | `:root[data-skin="titanium"] .art-wrap::before` |
| (0,3,1) | `:root[data-skin="titanium"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="titanium"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="titanium"] .art-frame img` |
| (0,4,0) | `:root[data-skin="titanium"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="titanium"] .art-wrap::after` |
| (0,3,0) | `:root[data-skin="titanium"] .tonearm` |
| (0,3,1) | `:root[data-skin="titanium"] .tonearm::before` |

### ulm — 11 selectores con clase

| Especificidad | Selector |
|---|---|
| (0,3,0) | `:root[data-skin="ulm"] .brass-glass` |
| (0,3,1) | `:root[data-skin="ulm"] .brass-glass::before` |
| (0,4,1) | `:root[data-skin="ulm"][data-theme="light"] .brass-glass::before` |
| (0,3,1) | `:root[data-skin="ulm"] .art-wrap::before` |
| (0,3,1) | `:root[data-skin="ulm"] .art-frame::before` |
| (0,3,1) | `:root[data-skin="ulm"] .art-frame::after` |
| (0,3,1) | `:root[data-skin="ulm"] .art-frame img` |
| (0,4,0) | `:root[data-skin="ulm"] .art-frame .default-art` |
| (0,3,1) | `:root[data-skin="ulm"] .art-wrap::after` |
| (0,3,0) | `:root[data-skin="ulm"] .tonearm` |
| (0,3,1) | `:root[data-skin="ulm"] .tonearm::before` |

## Extracción a tokens: cambios aplicados y alcance

- Los overrides directos de `.glass` de Neon y Ruby se reemplazaron por `--skin-panel-background` y `--skin-panel-backdrop-filter`, definidos en la capa `skin` y consumidos por `styles/glassmorphism.css` en la capa `surface`. Las variantes clara/oscura existentes quedan representadas por el valor del token; el selector que apunta al panel ya no vive en esas dos skins.
- Telar expone su patrón de urdimbre como `--pattern-image`. Glass es, por ahora, la superficie que opta por componer ese patrón sobre `.glass`/`.glass-strong`; las otras siete superficies no leen el token. El velo global Telar deja de imponer la trama de urdimbre en toda la pantalla, aunque conserva el slub y los usos identitarios del disco.
- Este es un primer corte deliberado, no la extracción completa de todos los estilos de componente: el inventario anterior conserva selectores de tipografía, controles, avisos, overlays y la biblioteca optativa `.tl-*`. En particular, la propia hoja Telar indica que varias clases `.tl-*` son opt-in; hay que verificar su uso real antes de moverlas o eliminarlas. Los selectores del plato, vinilo, carátula, brazo y pivote permanecen por la excepción pedida.
- La próxima migración segura es por familia: transferir cada rediseño restante a un token en `:root[data-skin=…]`, agregar el punto de consumo explícito en las superficies que lo elijan y solo entonces borrar la regla de skin. No trasladar ciegamente geometría, estados de interacción, layout ni reglas de accesibilidad.

## Interpretación y límites

- La capa determina prioridad entre reglas normales de distintas capas; la especificidad solo desempata reglas dentro de la misma capa. Reglas `!important` invierten el orden de las capas y no se resumen como prioridad normal.
- Se cuentan selectores en ramas de listas separadas por coma, no declaraciones CSS. Las reglas `@keyframes`, `@font-face` y `@page` no se interpretan como selectores de componentes.
- `:where()` aporta cero; `:is()`, `:not()` y `:has()` aportan la especificidad máxima de sus argumentos; `:nth-child(... of ...)` incluye la rama de `of`.
- Los nombres `:root`, atributos `data-skin` y pseudo-clases cuentan según CSS Selectors. Anidamiento at-rule como `@media`, `@supports` y `@container` se recorre recursivamente.
- El cálculo implementa la especificidad de selectores ordinarios; no se analiza el DOM, el efecto visual, las reglas deshabilitadas ni las propiedades en conflicto. Selectores inválidos se cuentan sintácticamente y requieren validación de navegador.
- Se analizan las hojas fuente listadas, no `node_modules/`, builds temporales ni reglas inline de HTML/atributos `style`. El bloque inline de orden de capas no contiene reglas visuales; el CSS crítico inline ya está en `base`.
