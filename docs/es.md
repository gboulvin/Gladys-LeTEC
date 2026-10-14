# TEC — autobuses, tranvía y metro de Valonia

Esta integración muestra en Gladys las **próximas salidas** de los autobuses
TEC, del tranvía de Lieja y del metro de Charleroi, con **retrasos**,
**cancelaciones** e **incidencias** (obras, desvíos, huelgas) en tiempo real.

## Qué obtiene

Un dispositivo por parada vigilada, con:

| Función                      | Ejemplo                                              |
| ---------------------------- | ---------------------------------------------------- |
| Próxima salida               | `8` minutos                                          |
| Próximo paso                 | `M2 → ANDERLUES Monument · 08:03 (+3 min)`           |
| Retraso de la próxima salida | `3` minutos                                          |
| Salida siguiente             | `22` minutos                                         |
| Próximas salidas             | `M2 8 min (+3 min) · 52 08:05 cancelado · M4 25 min` |
| Incidencias                  | `1` (avisos en vigor en las líneas)                  |

Por la noche, «Próxima salida» cuenta los minutos hasta la primera salida de
la mañana.

## Configuración

1. **Clave de API (opcional, recomendada).** Los retrasos proceden del portal
   de datos abiertos [Belgian Mobility](https://data.belgianmobility.io). Sin
   clave solo acepta 100 peticiones al día: el tiempo real se actualiza cada
   20 minutos. Con una clave gratuita, cada minuto:
   - cree una cuenta en el
     [portal para desarrolladores](https://api-management-opendata-production.developer.azure-api.net/signup);
   - suscríbase al producto gratuito (Standard);
   - copie la **clave principal** de su suscripción en el campo «Clave de API».
2. **Encuentre sus paradas.** Cada parada tiene **un código por sentido**
   (p. ej. `CMpa1` y `CMpa2` para los dos andenes de la estación de metro
   Palais). Dos botones ayudan:
   - **Buscar una parada**: escriba parte del nombre («charleroi gare») y se
     listan los códigos con las líneas que pasan;
   - **Paradas cerca de mi casa**: las paradas más cercanas a sus casas de
     Gladys (la ubicación de la casa debe estar indicada).
     La primera carga de los horarios tarda uno o dos minutos.
3. **Paradas**: enumere los códigos separados por comas. Para conservar solo
   algunas líneas de una parada, añádalas tras dos puntos, separadas por `+`:
   `CMpa1:M2+M4, Ctrrpla2:82`. Veinte paradas como máximo.
4. Guarde y añada los dispositivos desde la pestaña **Descubrir**.

Otros ajustes:

- **Idioma de los textos**: idioma de los nombres de los dispositivos y de los
  textos escritos en los estados.
- **Actualización en tiempo real**: con clave, la frecuencia de lectura del
  flujo en tiempo real (60 s por defecto).
- **Salidas mostradas**: hasta dónde miran las listas (90 minutos por
  defecto).
- **Aviso de retraso desde**: el retraso que activa «Salida TEC retrasada» (5
  minutos por defecto).

## Acciones

- **Buscar una parada** y **Paradas cerca de mi casa** — ver arriba.
- **Probar la conexión** — lee el flujo en tiempo real en directo y muestra la
  versión de los horarios, los viajes seguidos y las peticiones usadas.
- **Actualizar los horarios ahora** — TEC publica nuevos horarios cada noche;
  la integración lo comprueba sola cada 6 horas.

## Escenas

Disparadores (categoría **Integraciones** del editor de escenas):

- **Salida TEC inminente** — una salida en N minutos. Elija la parada, la
  línea y uno o varios valores de N (1 a 30 minutos).
- **Salida TEC retrasada** — una salida en la próxima hora lleva al menos el
  retraso configurado.
- **Salida TEC cancelada** — una salida en la próxima hora se cancela o ya no
  para en la parada.
- **Nueva incidencia TEC** — un nuevo aviso afecta a una línea de una parada
  vigilada.

Las acciones siguientes leen los detalles, p. ej.
`{{triggerEvent.data.line}}`, `{{triggerEvent.data.destination}}`,
`{{triggerEvent.data.expected_time}}` o `{{triggerEvent.data.title}}`.

Acciones:

- **Obtener la próxima salida TEC** — línea, destino, minutos, hora estimada,
  retraso y un resumen, para un mensaje.
- **Comprobar una línea TEC** — si una línea tiene incidencias, con el número
  de avisos y su resumen.

## Widgets

- **Salidas TEC** — el panel de salidas de una parada: próxima salida, retraso
  e incidencias en directo, las próximas salidas coloreadas según su retraso,
  la fuente de datos y un botón «Actualizar».
- **Incidencias TEC** — los avisos en vigor en las líneas de sus paradas, con
  el enlace al detalle en letec.be.

## Datos y privacidad

- Horarios: datos abiertos de TEC (CC0), descargados de `opendata.tec-wl.be`
  (unos 80 MB) e indexados localmente en `/data`.
- Tiempo real: portal de datos abiertos Belgian Mobility (CC BY 4.0) —
  «Fuente: LETEC – Open Data».
- La ubicación de sus casas solo la lee el botón «Paradas cerca de mi casa» y
  nunca sale de su Gladys.

## Solución de problemas

- **«Ignoradas (parada desconocida…)»**: el código no está en los horarios;
  use la búsqueda de paradas (se distinguen mayúsculas: `CMpa1`).
- **Insignia de nube naranja**: sin clave de API (tiempo real cada 20 minutos)
  o tiempo real no disponible temporalmente; los horarios teóricos siguen
  visibles.
