# Signex web: uso y despliegue

Esta versión conserva la interfaz y los pesos ASL web incluidos. `python launcher.py` abre el servidor local; para un teléfono necesitas HTTPS en tu alojamiento. El servidor del Workshop necesita almacenamiento persistente para SQLite. Puedes seguir usando el modo ASL de inmediato.

Los modos LESCO usan el mismo motor MediaPipe + Dense/TCN que ASL. Esta entrega incluye las **24 letras LESCO**, incluida T, en `web/model/lesco_letters/model_weights.json` y `web/model/labels_lesco_letters.json`. El modelo se entrenó con los datos locales del equipo del usuario; la precisión reportada por el entrenamiento fue 97,91 % en su partición de validación y requiere pruebas con capturas nuevas. Las **palabras LESCO** siguen sin pesos; cuando estén entrenadas, copia `web/model/lesco_words/` y `web/model/labels_lesco_words.json` desde el ZIP local a las mismas rutas de esta versión.

En Workshop puedes elegir ASL, LESCO o Personalizada y capturar posturas de una mano en rondas de 10. Se necesitan 100 muestras para guardar y puedes añadir más, sujeto al almacenamiento disponible. Los paquetes comunitarios son independientes de los pesos Dense/TCN; las señas de dos manos y movimiento se entrenan en el ZIP local. La exportación CSV/JSON de capturas y el entrenamiento de pesos están disponibles en ese ZIP.

Para verificar cálculos ejecuta `node tests/packages.mjs` y `node tests/parity.mjs`. Antes de desplegar verifica cámara y rendimiento desde HTTPS con tus dispositivos. El servidor acepta paquetes de hasta 20 MB; configura el límite del proxy de acuerdo con esto y conserva una copia de seguridad de SQLite.

GitHub conserva el código, pero no inicia `serve.py` por sí solo. Un alojamiento estático puede servir `web/` y el reconocimiento ASL/LESCO; para publicar y compartir paquetes del Workshop necesitas ejecutar `serve.py` con almacenamiento persistente y HTTPS.
