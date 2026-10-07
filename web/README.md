# Signex en el navegador

`index.html` reconoce letras ASL, números ASL, señas ASL y letras LESCO.
Las 24 etiquetas LESCO incluyen T; el modo de palabras LESCO se habilitará
cuando se exporte su propio modelo. El reconocimiento usa MediaPipe y los
modelos de `model/`, sin enviar vídeo al servidor.

Para una prueba estática, sirve esta carpeta por HTTP:

```bash
python -m http.server 8000
```

Abre `http://localhost:8000/` y `http://localhost:8000/js/utils.test.html`.
En otros dispositivos la cámara requiere un origen HTTPS. El servidor
`../serve.py` es necesario para cuentas, publicación y descarga de paquetes
compartidos del Workshop; un alojamiento estático solo permite el borrador
local y el reconocimiento.

Al reentrenar letras LESCO desde la versión local, ejecuta
`python tools/update_web.py lesco_letters` y copia los JSON generados a
`model/lesco_letters/model_weights.json` y `model/labels_lesco_letters.json`.
