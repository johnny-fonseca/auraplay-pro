# AuraPlay Pro
## Guía de skins, estilos visuales y Karaoke a pantalla completa

**Proyecto:** AuraPlay Pro  
**Contenido:** skins de interfaz, estilos visuales y estilos de Karaoke fullscreen  

---

## 1. Cómo se organiza la personalización visual

AuraPlay Pro separa la personalización en tres niveles:

- **Skins:** cambian la identidad completa del tocadiscos: paleta, materiales, vinilo, plato, brazo, tipografías y ambientación.
- **Estilos visuales:** cambian la forma de los paneles, botones, listas, controles, barras, modales y demás componentes de la interfaz.
- **Estilos de Karaoke a pantalla completa:** cambian exclusivamente la escena fullscreen, la tipografía de las letras, la iluminación, los efectos de audio y el dock de controles.

Los skins y los estilos visuales pueden combinarse. Por ejemplo, un skin Neon con Glassmorfismo produce una interfaz futurista con superficies de cristal; un skin Paper con Bento crea un reproductor editorial organizado en módulos.

---

# 2. Skins disponibles

Los skins cambian principalmente la identidad del tocadiscos, el vinilo, el brazo, el plato, la paleta de colores, las tipografías y la ambientación general. Todos contemplan tema claro y oscuro.

## 2.1 Brass — Latón

Skin de apariencia **Hi-Fi clásica y lujosa**, inspirado en un tocadiscos de alta fidelidad fabricado con grafito cálido, latón pulido y aluminio cepillado. Utiliza dorados, champagne, marrones oscuros y negros cálidos.

El vinilo incluye reflejos metálicos, micro-surcos, anillos de precisión y un centro con acabado de latón torneado. Los paneles tienen apariencia de cristal oscuro biselado, con transparencias, brillos especulares, sombras profundas y un resplandor ámbar discreto.

- **Sensación:** elegante, cálida, costosa y tradicional.
- **Tipografía:** serif refinada para títulos y sans serif limpia para el contenido.
- **Ideal para:** una experiencia de audio premium y clásica.
- **Archivo:** `skins/brass.css`

## 2.2 Emerald — Esmeralda

Skin inspirada en una combinación de **cristal esmeralda, madera de roble y bronce**. Usa verde esmeralda como color principal, oro ámbar como color secundario y fondos de bosque oscuro.

El plato simula madera tallada con vetas, poros y canales iluminados. El vinilo parece estar fabricado con cristal verde translúcido, con nubes orgánicas, reflejos y profundidad visual. Los paneles tienen una estética de lujo natural, parecida a un objeto artesanal de alta gama.

- **Sensación:** orgánica, exclusiva, natural y sofisticada.
- **Tipografía:** serif elegante combinada con una sans serif moderna.
- **Ideal para:** música acústica, clásica, jazz, folk o una interfaz de lujo artesanal.
- **Archivo:** `skins/emerald.css`

## 2.3 Glacier — Glaciar

Skin inspirada en **hielo, cristal facetado y una noche polar**. Su paleta combina azul hielo, blanco escarcha, azul acero, turquesa y fondos azulados muy oscuros.

El plato parece estar tallado en cristal o zafiro, con facetas, cáusticas internas, marcas precisas y destellos fríos. El vinilo incorpora partículas luminosas, escarcha, reflejos azulados y distintos niveles de profundidad.

La interfaz utiliza líneas finas, esquinas relativamente rectas, etiquetas en mayúsculas y efectos de brillo frío.

- **Sensación:** limpia, fría, tecnológica y cristalina.
- **Tipografía:** geométrica y contemporánea.
- **Ideal para:** electrónica ambiental, synthwave, música espacial o interfaces futuristas.
- **Archivo:** `skins/glacier.css`

## 2.4 Gres — Cerámica de taller

Skin basada en la apariencia de **cerámica artesanal hecha a mano**. Utiliza colores de barro, óxido, hierro negro, arena, ceniza y celadón apagado.

El plato parece una pieza de gres torneada, con marcas de torno, motas de hierro y textura granular. El vinilo tiene un esmalte oscuro tipo *tenmoku*, con vetas irregulares, manchas de aceite y bordes que se transforman gradualmente en tonos oxidados.

A diferencia de los skins metálicos, evita los brillos intensos y utiliza reflejos mate, sombras suaves y superficies casi opacas.

- **Sensación:** artesanal, sobria, terrosa y contemplativa.
- **Tipografía:** serif de inspiración japonesa o editorial.
- **Ideal para:** música experimental, acústica, jazz, ambient o una estética de objeto de autor.
- **Archivo:** `skins/gres.css`

## 2.5 Neon — Neón

Skin inspirada en una **discoteca futurista o un club nocturno cyberpunk**. La paleta principal combina magenta, cian, violeta, azul eléctrico y negro profundo.

El plato tiene un bisel de policarbonato, anillos luminosos y un núcleo de plasma blanco. El vinilo simula acetato negro piano con reflejos holográficos y surcos iluminados. La etiqueta central utiliza un degradado tipo “sunset retro” con amarillo, naranja, rosa y violeta.

Los paneles muestran esquinas HUD, estrellas, líneas de interfaz, transparencias y fuertes resplandores de color.

- **Sensación:** energética, nocturna, futurista y llamativa.
- **Tipografía:** display geométrica de estilo tecnológico.
- **Ideal para:** synthwave, EDM, pop electrónico, videojuegos o experiencias visuales intensas.
- **Archivo:** `skins/neon.css`

## 2.6 Paper — Papel

Skin inspirada en un **cuaderno de papel de algodón, tinta y materiales editoriales**. En tema oscuro utiliza papel negro, tinta marfil y sello bermellón. En tema claro utiliza papel crema, tinta índigo y detalles rojos.

El plato se interpreta como una pila circular de papeles troquelados. El vinilo adquiere apariencia de papel marmolado y la etiqueta central parece papel de algodón. El brazo se convierte visualmente en un lacre de cera y un pincel de sumi.

Incluye grano, fibras, moteado, viñeta, iluminación de lámpara y texturas de papel mediante SVG incrustado.

- **Sensación:** editorial, artesanal, literaria y táctil.
- **Tipografía:** serif tipo libro para títulos y sans serif funcional para el cuerpo.
- **Ideal para:** podcasts, música clásica, folk, jazz o una interfaz con identidad editorial.
- **Archivo:** `skins/paper.css`

## 2.7 Paper Accessibility — Papel accesible

No es un skin independiente completo, sino una **capa de accesibilidad complementaria para Paper**.

Cuando el sistema solicita mayor contraste, aumenta la visibilidad de los bordes, fortalece los contornos, mejora el texto secundario y elimina las capas globales de grano y viñeta. Esto reduce el ruido visual y mejora la lectura para personas sensibles a texturas, transparencia o bajo contraste.

- **Función:** versión de alto contraste del skin Paper.
- **Activación:** `prefers-contrast: more`.
- **Archivo:** `skins/paper-accessibility.css`

## 2.8 Ruby — Rubí

Skin inspirada en la **alta relojería y los equipos de audio de lujo**. Utiliza vino oscuro, rubí, oro rosa, champagne rosado y superficies negras brillantes.

El vinilo simula un rubí translúcido con reflejos, cáusticas y un centro de oro rosa. El brazo combina laca negra, incrustaciones de oro rosa, una cápsula de rubí y un contrapeso moleteado.

La interfaz usa serif elegante, títulos en cursiva, trazos finos, botones con apariencia de gema y brillos cálidos.

- **Sensación:** romántica, exclusiva, elegante y joyera.
- **Tipografía:** serif sofisticada para títulos y sans serif refinada para controles.
- **Ideal para:** música vocal, clásica, soul, jazz, baladas o una experiencia de lujo nocturno.
- **Archivo:** `skins/ruby.css`

## 2.9 Telar — Tapiz textil

Skin inspirada en un **tapiz jacquard de lana y seda**. En tema oscuro utiliza lana color ciruela, negro, añil y un hilo de gualda verde-amarillo. En tema claro utiliza lana gris perla, añil y gualda oscurecida.

La textura principal es una trama de urdimbre y trama. Los bordes utilizan pespuntes discontinuos en lugar de líneas convencionales. El plato parece una alfombrilla de fieltro con festón y el vinilo se convierte en un tapiz circular con rosetón jacquard.

- **Sensación:** artesanal, textil, cálida y creativa.
- **Tipografía:** serif suave para títulos y sans serif humanista para el cuerpo.
- **Ideal para:** música folclórica, acústica, world music, indie o una interfaz de carácter artístico.
- **Archivo:** `skins/telar.css`

## 2.10 Titanium — Titanio

Skin inspirada en **metal frío, titanio anodizado, fibra de carbono y hardware de precisión**. Su paleta utiliza negro azulado, azul acero, platino, violeta, turquesa y pequeños cambios cromáticos tipo anodizado térmico.

El bisel del plato presenta reflejos metálicos, marcas estroboscópicas y cambios de color entre oro, violeta, azul y turquesa. El vinilo utiliza micro-surcos precisos y un centro de titanio torneado con un halo azul controlado.

Los paneles parecen cristal templado con cantos anodizados y reflejos fríos.

- **Sensación:** técnica, precisa, fría y de ingeniería avanzada.
- **Tipografía:** sans serif estrecha y moderna.
- **Ideal para:** música electrónica, industrial, ambient, techno o una interfaz profesional.
- **Archivo:** `skins/titanium.css`

## 2.11 Ulm — Diseño industrial de los años 60

Skin inspirada en la **Escuela de Ulm y los equipos Hi-Fi industriales de los años sesenta**. Utiliza superficies mate, esmalte en polvo, goma, policarbonato y un único acento naranja señal.

El plato es mate y geométrico, con un anillo estroboscópico de marcas repetidas. El vinilo no tiene brillos intensos y la etiqueta central utiliza naranja plano con serigrafía oscura. El brazo combina fibra de carbono mate, esmalte color hueso, cápsula naranja y contrapeso industrial.

No utiliza resplandores ni cromados llamativos; la profundidad se comunica por forma, contraste y pequeñas sombras.

- **Sensación:** funcional, industrial, sobria y moderna.
- **Tipografía:** sans serif fuerte, inspirada en señalética y diseño técnico.
- **Ideal para:** usuarios que prefieren claridad, control visual y una estética de producto industrial.
- **Archivo:** `skins/ulm.css`

---

# 3. Estilos visuales de interfaz

Los estilos visuales cambian la forma en que se presentan los paneles, botones, campos, listas, controles, barras, modales y demás componentes de la interfaz. Pueden combinarse con los skins.

El ciclo configurado actualmente es:

**Neumorfismo → Skeuomorfismo → Glassmorfismo → Claymorfismo → Neubrutalismo → Aurora → Diseño plano → Bento → Neumorfismo**

## 3.1 Neumorfismo

Construye la interfaz a partir de una superficie continua con objetos que parecen **salir o hundirse en el fondo**. Utiliza sombras dobles: una clara en la parte superior izquierda y otra oscura en la parte inferior derecha.

Los botones parecen piezas moldeadas en la misma superficie. Los campos de búsqueda y las barras de progreso están hundidos, mientras que las tarjetas, controles y botones se elevan mediante sombras suaves.

- **Elementos:** relieve, hundimiento, sombras suaves y controles redondeados.
- **Interacción:** los botones se elevan al pasar el cursor y se hunden al pulsarlos.
- **Sensación:** suave, calmada, táctil y minimalista.
- **Identificador:** `data-ui="neu"`
- **Archivo:** `styles/neumorphism.css`

## 3.2 Skeuomorfismo

Busca que la aplicación parezca un **equipo de audio físico real**. Utiliza aluminio cepillado, cromados, tornillos, teclas metálicas, faders, perillas y pantallas tipo VFD.

Los botones parecen interruptores físicos y el botón Play tiene un bisel cromado. Los controles de volumen y progreso se comportan visualmente como faders de hardware. El karaoke se muestra como una pantalla oscura con líneas de exploración.

- **Elementos:** metal, tornillos, relieves, ranuras, cromado y controles físicos.
- **Interacción:** los botones se presionan y se hunden.
- **Sensación:** realista, mecánica, retro y de estudio profesional.
- **Identificador:** `data-ui="skeuo"`
- **Archivo:** `styles/skeuomorphism.css`

## 3.3 Glassmorfismo

Utiliza **vidrio translúcido esmerilado**, desenfoque de fondo, bordes brillantes y capas flotantes.

Los paneles dejan ver parcialmente el fondo y las manchas de color que hay detrás. Los botones tienen transparencias, reflejos internos y pequeños brillos. Las filas de canciones parecen láminas de vidrio superpuestas.

- **Elementos:** transparencia, `backdrop-filter`, desenfoque, bordes especulares y halos de color.
- **Interacción:** los botones se elevan ligeramente y aumentan su iluminación.
- **Sensación:** moderna, elegante, ligera y tecnológica.
- **Identificador:** `data-ui="glass"`
- **Archivo:** `styles/glassmorphism.css`

## 3.4 Claymorfismo

Transforma los componentes en **figuras infladas de plastilina o arcilla suave**. Usa colores pastel, esquinas muy redondeadas y sombras internas pronunciadas.

Cada módulo puede tener un color propio: lavanda para la cabecera, durazno para la biblioteca, azul cielo para el reproductor, verde menta para la cola y amarillo mantequilla para la barra inferior.

- **Elementos:** superficies acolchadas, colores pastel, radios grandes y sombras internas.
- **Interacción:** los botones se aplastan ligeramente al pulsarlos.
- **Sensación:** amigable, juguetona, suave y accesible.
- **Identificador:** `data-ui="clay"`
- **Archivo:** `styles/claymorphism.css`

## 3.5 Neubrutalismo

Estilo de alto contraste inspirado en el **diseño brutalista contemporáneo**. Utiliza fondos de papel, amarillo ácido, magenta, cian, rojo, bordes negros gruesos y sombras duras sin desenfoque.

Los botones son rectangulares, pesados y claramente delimitados. Al pasar el cursor se desplazan, y al presionarlos se hunden de forma brusca. Los títulos aparecen en mayúsculas y con tipografía muy pesada.

- **Elementos:** bordes de 3 a 5 píxeles, sombras sólidas, colores intensos y esquinas rectas.
- **Interacción:** movimientos rápidos y mecánicos.
- **Sensación:** directa, experimental, juvenil y contundente.
- **Identificador:** `data-ui="brutal"`
- **Archivo:** `styles/brutalism.css`

## 3.6 Aurora

Estilo basado en **manchas fluidas de color y luces similares a una aurora boreal**. El fondo combina menta, azul cielo, violeta, rosa y azul intenso mediante gradientes muy difuminados.

Los componentes se presentan como superficies de cristal suave con formas redondeadas, botones tipo píldora, halos de color y transiciones fluidas. Incluye movimiento ambiental lento en el fondo y respeta la preferencia de movimiento reducido del sistema.

- **Elementos:** gradientes fluidos, manchas difusas, cristal suave, píldoras y brillos de color.
- **Interacción:** elevación suave, transiciones fluidas y estados activos con degradados.
- **Sensación:** dinámica, luminosa, relajada y moderna.
- **Identificador:** `data-ui="aurora"`
- **Archivo:** `styles/aurora.css`

## 3.7 Diseño plano — Flat Design

Elimina prácticamente todos los efectos de profundidad. Utiliza **colores sólidos, bloques geométricos, líneas claras y estados fáciles de distinguir**.

No utiliza sombras, desenfoques, transparencias decorativas ni degradados visuales. Los estados se comunican mediante color, forma, grosor y etiquetas, no únicamente mediante cambios sutiles de tono.

- **Elementos:** bloques sólidos, bordes sencillos, superficies limpias y contraste.
- **Interacción:** cambios rápidos de color sin desplazamientos ni efectos complejos.
- **Sensación:** clara, funcional, accesible y eficiente.
- **Identificador:** `data-ui="flat"`
- **Archivo:** `styles/flat.css`

## 3.8 Bento

Organiza la aplicación como una **composición modular tipo Bento Grid**. Cada área tiene una función y una jerarquía definida: cabecera, pista actual, controles, progreso, volumen, búsqueda, biblioteca, cola, ecualizador y visualizadores.

Utiliza diferentes niveles de superficie:

- **Escena:** módulo principal de la pista actual.
- **Superficie:** biblioteca, cola, pestañas y ecualizador.
- **Hundido:** transporte, progreso, volumen y búsqueda.
- **Fantasma:** cabecera e información secundaria sin caja visible.

Los módulos tienen radios adaptativos, espaciado responsive y límites de altura para que las listas no estiren excesivamente la página.

- **Elementos:** composición modular, jerarquía de tarjetas, responsive y estructura espacial.
- **Interacción:** controles organizados por módulos y superficies claramente diferenciadas.
- **Sensación:** editorial, ordenada, moderna y orientada a dashboards.
- **Identificador:** `data-ui="bento"`
- **Archivo:** `styles/bento.css`

---

# 4. Karaoke a pantalla completa

AuraPlay Pro incluye **6 estilos exclusivos para el modo Karaoke a pantalla completa**:

1. Cinema
2. Guilloché Zafiro
3. Kinético
4. Neón
5. Palco Esmeralda
6. Yozakura

Todos utilizan el mismo motor compartido para sincronizar las letras palabra por palabra, controlar el progreso, mostrar la carátula y manejar los controles. Lo que cambia entre ellos es la dirección artística, la tipografía, el fondo, los efectos, el dock de controles y la forma en que se iluminan las palabras cantadas.

## 4.1 Cinema

Estilo inspirado en una **película cinematográfica de alta calidad**, con una atmósfera tranquila, elegante y ligeramente dramática.

Utiliza un fondo azul profundo con brillos de aurora, desenfoque de la carátula, viñeta oscura y grano de película. La zona central de las letras recibe un resplandor suave para mantener el foco visual en la línea actual.

Las letras utilizan una tipografía serif de alto contraste, con un peso moderado y proporciones amplias. La línea actual se muestra en tonos marfil y azul claro, mientras que las palabras cantadas avanzan con un brillo blanco cálido.

El dock inferior tiene apariencia de cristal zafiro escarchado, con controles flotantes, sombras largas y un botón principal blanco brillante.

- **Paleta:** azul cinematográfico, lavanda, blanco marfil, rosa suave y turquesa.
- **Tipografía:** serif elegante, inspirada en títulos cinematográficos.
- **Fondo:** aurora desenfocada, viñeta y grano de película.
- **Letras:** sobrias, amplias y luminosas.
- **Controles:** cristal azul con brillos suaves.
- **Sensación:** emocional, elegante, relajada y cinematográfica.
- **Ideal para:** baladas, bandas sonoras, música clásica, jazz y canciones lentas.
- **Identificador:** `cinema`
- **Archivo:** `karaoke/cinema/cinema.css`

## 4.2 Guilloché Zafiro

Estilo inspirado en la **orfebrería de relojes de lujo**, el grabado guilloché y las esferas de relojes de alta gama.

La escena utiliza un fondo de zafiro nocturno con detalles de platino, escarcha y oro rosa. En las esquinas aparecen rosetas guilloché formadas por patrones geométricos que se mueven en sentidos opuestos. El centro permanece despejado para no competir con las letras.

También incorpora un bisel de reloj elíptico con marcas perimetrales, una aguja luminosa, ondas que reaccionan a los golpes de la música y destellos lentos. Los efectos evitan los parpadeos agresivos y buscan una sensación de precisión y lujo.

La línea actual se muestra en platino con un halo azul zafiro. Las palabras cantadas adoptan un tono cálido rosado, creando un contraste entre metal frío y oro rosa.

- **Paleta:** abismo azul, zafiro, platino, escarcha, oro rosa y champagne.
- **Tipografía:** serif tipo Didot, Bodoni o Didona.
- **Fondo:** patrones guilloché, bisel de reloj y detalles de joyería.
- **Letras:** platino para la línea actual y tonos cálidos para las palabras cantadas.
- **Controles:** paneles oscuros con bordes finos y detalles metálicos.
- **Sensación:** precisa, exclusiva, ornamental y sofisticada.
- **Ideal para:** música clásica, vocal, jazz, ópera, baladas y canciones elegantes.
- **Identificador:** `guilloche`
- **Archivo:** `karaoke/guilloche/guilloche.css`

## 4.3 Kinético

Estilo inspirado en **carteles impresos, pósteres musicales y diseño editorial de alto impacto**.

Utiliza una paleta cálida con rojo anaranjado, amarillo dorado, tinta oscura y crema. Las letras son grandes, gruesas, condensadas y aparecen en mayúsculas. Cada nueva línea puede entrar con una ligera inclinación y un movimiento elástico, como si fuera una pieza de un póster animado.

El dock inferior abandona las transparencias y se convierte en una placa plana impresa. Utiliza bordes gruesos, sombras desplazadas y un comportamiento muy marcado al pulsar los controles.

- **Paleta:** rojo coral, naranja, amarillo dorado, crema y marrón oscuro.
- **Tipografía:** sans serif pesada, condensada y en mayúsculas.
- **Fondo:** tinta cálida, viñeta, grano y composición tipo póster.
- **Letras:** muy grandes, gruesas y de fuerte presencia.
- **Controles:** placas planas con bordes y sombras duras.
- **Sensación:** energética, gráfica, intensa y juvenil.
- **Ideal para:** rock, pop, punk, hip-hop, música latina y canciones con ritmo fuerte.
- **Identificador interno:** `kinetic`
- **Carpeta:** `karaoke/kinetico/`
- **Archivo:** `karaoke/kinetico/kinetic.css`

## 4.4 Neon

Estilo inspirado en el **synthwave, los clubes nocturnos, los letreros de neón y los videojuegos retrofuturistas**.

Utiliza una escena con cielo índigo profundo, horizonte magenta, suelo oscuro y una cuadrícula en perspectiva. La carátula aparece muy desenfocada y saturada para convertirse en una fuente ambiental de color, no en el elemento principal.

Las letras tienen apariencia de tubos luminosos. Las palabras aún no cantadas utilizan contornos cian y violeta, mientras que las palabras cantadas se vuelven blancas y magenta, con un borde luminoso cian.

El texto puede mostrar un breve efecto de encendido o parpadeo controlado al aparecer la palabra actual, simulando un tubo de neón que se activa. El dock inferior tiene botones oscuros con bordes luminosos y resplandores magenta y cian.

- **Paleta:** magenta eléctrico, cian, violeta, azul índigo y blanco.
- **Tipografía:** geométrica, tecnológica y ligeramente retro.
- **Fondo:** horizonte synthwave, cuadrícula HUD, líneas de escaneo y resplandor.
- **Letras:** tubos de neón con borde cian y relleno blanco-magenta.
- **Controles:** botones oscuros con halos eléctricos.
- **Sensación:** futurista, intensa, nocturna y retro.
- **Ideal para:** synthwave, electrónica, EDM, pop, música de videojuegos y temas de club.
- **Identificador:** `neon`
- **Archivo:** `karaoke/neon/neon.css`

**Neon es el estilo de Karaoke a pantalla completa con la estética más luminosa, colorida y futurista.**

## 4.5 Palco Esmeralda

Estilo inspirado en un **teatro de ópera clásico**, con cortinas de terciopelo esmeralda, latón bruñido, luces de rampa y detalles de joyería.

La composición representa el instante previo a que comience una actuación. Las cortinas laterales enmarcan el espacio central, mientras que la bambalina superior y la rampa de lámparas crean la sensación de estar frente a un escenario real.

El fondo combina verde pino, esmeralda profunda y negro. El latón se utiliza para bordes, controles, progreso, filetes y reflejos. Los rubíes aparecen como acentos secundarios, especialmente en los controles de cierre y en algunos destellos decorativos.

La letra principal utiliza una serif clásica en color marfil. Las palabras cantadas se iluminan en tonos dorados. Además, cada palabra activa puede mostrar un pequeño filete de latón inferior que crece con el progreso de la sincronización.

La escena reacciona al audio:

- Los graves activan las lámparas de la rampa y los haces laterales.
- Los medios mueven suavemente las cortinas y las borlas.
- Los agudos iluminan partículas y destellos metálicos.
- Los golpes de la música provocan pequeños acentos en los rubíes y en la iluminación.

- **Paleta:** terciopelo esmeralda, verde pino, latón, marfil y rubí.
- **Tipografía:** serif clásica para letras y títulos; sans serif para controles.
- **Fondo:** escenario teatral con cortinas, polvo, haces y luces.
- **Letras:** marfil y dorado, con progreso subrayado por un filete de latón.
- **Controles:** panel esmeralda translúcido con botón principal de latón.
- **Sensación:** teatral, lujosa, cálida y dramática.
- **Ideal para:** ópera, música clásica, baladas, musicales, boleros y canciones interpretativas.
- **Identificador:** `palco-esmeralda`
- **Archivo:** `karaoke/palco-esmeralda/palco-esmeralda.css`

**Nota técnica:** la documentación del proyecto indica que este paquete fue creado como un tema autocontenido y debe conectarse o validarse dentro del reproductor para confirmar completamente su integración.

## 4.6 Yozakura

Estilo inspirado en una **noche japonesa de hanami bajo los cerezos**, con luna, montañas, una pagoda, laca bermellón y pétalos flotando.

La escena utiliza un paisaje nocturno compuesto por montañas de tinta, un horizonte ciruela, agua oscura y una rama de cerezo con lámparas *chochin*. Los pétalos se mueven lentamente y la composición mantiene el centro despejado para que las letras sean siempre legibles.

La paleta combina papel washi, rosa sakura, rojo bermellón, azul verdoso asagi y tonos de laca oscura. El título utiliza una tipografía serif japonesa o una alternativa clásica. El artista aparece con un tratamiento más discreto y puede incluir un pequeño sello visual inspirado en un *hanko*.

Las letras actuales conservan una apariencia sólida y elegante. Las palabras cantadas avanzan de blanco cálido a rosa sakura, con un borde bermellón que indica el progreso.

- **Paleta:** negro abismo, azul noche, ciruela, papel washi, rosa sakura, bermellón y asagi.
- **Tipografía:** serif japonesa o serif clásica compatible.
- **Fondo:** luna, montañas, pagoda, agua, rama de cerezo y pétalos.
- **Letras:** papel cálido para texto principal, rosa para palabras cantadas y rojo para el avance.
- **Controles:** laca oscura con detalles de papel y bermellón.
- **Sensación:** contemplativa, poética, tradicional y nocturna.
- **Ideal para:** música japonesa, ambient, baladas, música acústica y canciones tranquilas.
- **Identificador:** `yozakura`
- **Archivo:** `karaoke/yozakura/yozakura.css`

---

# 5. Comparaciones rápidas

## 5.1 Skins

| Skin | Concepto | Paleta dominante | Personalidad |
|---|---|---|---|
| Brass | Tocadiscos Hi-Fi de lujo | Latón, champagne y grafito | Clásica y premium |
| Emerald | Cristal, roble y bronce | Verde esmeralda y ámbar | Natural y sofisticada |
| Glacier | Hielo y cristal facetado | Azul hielo y blanco | Fría y tecnológica |
| Gres | Cerámica artesanal | Barro, óxido y ceniza | Terrosa y contemplativa |
| Neon | Club cyberpunk | Magenta, cian y violeta | Futurista y energética |
| Paper | Papel, tinta y algodón | Crema, índigo y bermellón | Editorial y artesanal |
| Ruby | Alta relojería | Rubí, vino y oro rosa | Elegante y joyera |
| Telar | Tapiz de lana y seda | Ciruela, gualda y añil | Textil y creativa |
| Titanium | Metal anodizado y carbono | Azul acero y platino | Técnica y precisa |
| Ulm | Diseño industrial de los 60 | Gris, negro y naranja | Funcional y sobria |

## 5.2 Estilos visuales de interfaz

| Estilo | Concepto | Rasgo principal | Personalidad |
|---|---|---|---|
| Neumorfismo | Superficie moldeada | Objetos elevados o hundidos | Suave y táctil |
| Skeuomorfismo | Equipo de audio físico | Metal, tornillos y controles reales | Mecánica y retro |
| Glassmorfismo | Vidrio esmerilado | Transparencia y desenfoque | Moderna y elegante |
| Claymorfismo | Plastilina inflada | Pasteles y sombras internas | Amigable y juguetona |
| Neubrutalismo | Póster de alto contraste | Bordes gruesos y sombras duras | Directa y contundente |
| Aurora | Luces fluidas | Manchas de color y cristal suave | Luminosa y dinámica |
| Diseño plano | Bloques sólidos | Claridad sin profundidad | Funcional y accesible |
| Bento | Composición modular | Jerarquía de módulos | Ordenada y editorial |

## 5.3 Karaoke fullscreen

| Estilo | Tema visual | Color dominante | Personalidad |
|---|---|---|---|
| Cinema | Película y aurora | Azul y lavanda | Elegante y emocional |
| Guilloché Zafiro | Relojería de lujo | Zafiro y platino | Precisa y exclusiva |
| Kinético | Póster impreso | Rojo y naranja | Intensa y gráfica |
| Neon | Synthwave y club nocturno | Magenta y cian | Futurista y energética |
| Palco Esmeralda | Teatro de ópera | Esmeralda y latón | Dramática y lujosa |
| Yozakura | Noche japonesa bajo cerezos | Sakura y bermellón | Poética y contemplativa |

---

# 6. Recomendaciones rápidas

- **Para una experiencia clásica y lujosa:** Brass + Skeuomorfismo.
- **Para una estética futurista:** Neon + Glassmorfismo.
- **Para una interfaz tecnológica y precisa:** Titanium + Diseño plano.
- **Para una experiencia natural y artesanal:** Emerald o Gres + Neumorfismo.
- **Para una estética editorial:** Paper + Bento.
- **Para una estética industrial:** Ulm + Diseño plano.
- **Para Karaoke de club y música electrónica:** Neon.
- **Para Karaoke elegante y cinematográfico:** Cinema.
- **Para Karaoke de lujo y precisión:** Guilloché Zafiro.
- **Para Karaoke teatral:** Palco Esmeralda.
- **Para Karaoke poético y japonés:** Yozakura.
- **Para Karaoke de alto impacto:** Kinético.

---

## 7. Ubicación de los archivos en el proyecto

```text
skins/
├── brass.css
├── emerald.css
├── glacier.css
├── gres.css
├── neon.css
├── paper.css
├── paper-accessibility.css
├── ruby.css
├── telar.css
├── titanium.css
└── ulm.css

styles/
├── aurora.css
├── bento.css
├── brutalism.css
├── claymorphism.css
├── flat.css
├── glassmorphism.css
├── neumorphism.css
├── skeuomorphism.css
└── ui-style-cycle.js

karaoke/
├── cinema/
├── guilloche/
├── kinetico/
├── neon/
├── palco-esmeralda/
├── yozakura/
└── shared/
```
