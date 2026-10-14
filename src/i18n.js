// -----------------------------------------------------------------------------
// Translations of every text the integration writes (English, French, German,
// Spanish — the languages of the Gladys interface).
//
//   t(lang, key, vars)  -> one string, for the texts stored in a device state
//                          (the language chosen in the configuration);
//   tAll(key, vars)     -> a multi-language object { en, fr, de, es }, for the
//                          action messages, statuses, toasts and widgets: the
//                          core picks the language of the user viewing it.
//
// A value is a template ("{n} min") or a function of the variables (plurals).
// test/i18n.test.js checks that every key exists in every language.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
export const FALLBACK_LANGUAGE = 'en';

const plural = (one, many) => (vars) => (vars.n === 1 ? one : many);

export const MESSAGES = {
  en: {
    minutes: '{n} min',
    now: 'now',
    on_time: 'on time',
    cancelled: 'cancelled',
    scheduled_only: 'timetable',
    no_departure: 'No departure in the next {n} minutes',
    no_service: 'No departure scheduled',
    disruptions_none: 'No disruption',
    disruptions_count: plural('{n} disruption', '{n} disruptions'),
    feature_next: 'Next departure',
    feature_next_trip: 'Next bus',
    feature_delay: 'Delay of the next departure',
    feature_following: 'Following departure',
    feature_departures: 'Next departures',
    feature_disruptions: 'Disruptions',
    status_no_stops: 'Add the stops to monitor in the configuration.',
    status_loading: 'Downloading the TEC timetable (about 80 MB), this takes a minute or two.',
    status_timetable_error: 'The TEC timetable could not be loaded: {message}',
    status_key_refused: 'The Belgian Mobility portal refused the API key: check it.',
    status_invalid_stops: 'Ignored (unknown stop or wrong format): {list}',
    transport_no_key: 'No API key: real-time data is refreshed every 20 minutes only.',
    transport_realtime_down: 'Real-time data unavailable: timetable only.',
    action_not_ready: 'The timetable is still loading, try again in a minute.',
    action_test_ok:
      'Timetable {version} loaded ({stops} stops). Real-time: {trips} trips tracked, {alerts} alerts. Requests over 24 h: {used}/{limit}.',
    action_test_realtime_failed: 'Timetable OK, but the real-time feed failed: {message}',
    action_test_quota: 'Timetable OK, real-time quota reached for now: try again later.',
    action_search_empty: 'Type part of the name of the stop, e.g. "Charleroi Gare".',
    action_search_none: 'No stop matches "{query}".',
    action_search_results:
      'Copy the code of your stop (one per direction) into the "Stops" field:\n{list}',
    action_nearby_no_house:
      'No house with a location in Gladys: set it in Settings → Houses, or use the stop search.',
    action_nearby_results: 'Stops near {house}:\n{list}',
    action_refresh_updated: 'Timetable updated ({version}).',
    action_refresh_unchanged: 'The timetable is already up to date ({version}).',
    widget_choose_stop: 'Choose a stop in the settings of this widget.',
    widget_unknown_stop: 'This stop is no longer monitored.',
    widget_next: 'Next',
    widget_delay: 'Delay',
    widget_source: 'Data',
    widget_realtime: 'Real-time, {clock}',
    widget_timetable_only: 'Timetable only',
    widget_disruptions: 'Disruptions',
    widget_refresh: 'Refresh',
    widget_refreshed: 'Real-time data refreshed.',
    widget_refresh_quota: 'Quota reached: data of {clock} kept.',
    widget_no_disruption: 'No disruption on your lines.',
    widget_lines: 'Lines {lines}',
    widget_details: 'Details on letec.be',
    effect_1: 'No service',
    effect_2: 'Reduced',
    effect_3: 'Delays',
    effect_4: 'Detour',
    effect_5: 'Extra service',
    effect_6: 'Modified',
    effect_9: 'Stop moved',
    effect_11: 'Accessibility',
    effect_other: 'Info',
  },
  fr: {
    minutes: '{n} min',
    now: 'maintenant',
    on_time: "à l'heure",
    cancelled: 'supprimé',
    scheduled_only: 'théorique',
    no_departure: 'Aucun départ dans les {n} prochaines minutes',
    no_service: 'Aucun départ prévu',
    disruptions_none: 'Aucune perturbation',
    disruptions_count: plural('{n} perturbation', '{n} perturbations'),
    feature_next: 'Prochain départ',
    feature_next_trip: 'Prochain passage',
    feature_delay: 'Retard du prochain départ',
    feature_following: 'Départ suivant',
    feature_departures: 'Prochains départs',
    feature_disruptions: 'Perturbations',
    status_no_stops: 'Ajoutez les arrêts à surveiller dans la configuration.',
    status_loading:
      'Téléchargement des horaires TEC (environ 80 Mo), cela prend une à deux minutes.',
    status_timetable_error: "Les horaires TEC n'ont pas pu être chargés : {message}",
    status_key_refused: "Le portail Belgian Mobility a refusé la clé d'API : vérifiez-la.",
    status_invalid_stops: 'Ignorés (arrêt inconnu ou format incorrect) : {list}',
    transport_no_key: "Sans clé d'API, le temps réel n'est rafraîchi que toutes les 20 minutes.",
    transport_realtime_down: 'Temps réel indisponible : horaires théoriques uniquement.',
    action_not_ready: 'Les horaires sont encore en cours de chargement, réessayez dans une minute.',
    action_test_ok:
      'Horaires {version} chargés ({stops} arrêts). Temps réel : {trips} courses suivies, {alerts} alertes. Requêtes sur 24 h : {used}/{limit}.',
    action_test_realtime_failed: 'Horaires OK, mais le flux temps réel a échoué : {message}',
    action_test_quota:
      'Horaires OK, quota temps réel atteint pour le moment : réessayez plus tard.',
    action_search_empty: "Tapez une partie du nom de l'arrêt, par ex. « Charleroi Gare ».",
    action_search_none: 'Aucun arrêt ne correspond à « {query} ».',
    action_search_results:
      'Copiez le code de votre arrêt (un par sens de circulation) dans le champ « Arrêts » :\n{list}',
    action_nearby_no_house:
      "Aucune maison localisée dans Gladys : renseignez-la dans Paramètres → Maisons, ou utilisez la recherche d'arrêt.",
    action_nearby_results: 'Arrêts proches de {house} :\n{list}',
    action_refresh_updated: 'Horaires mis à jour ({version}).',
    action_refresh_unchanged: 'Les horaires sont déjà à jour ({version}).',
    widget_choose_stop: 'Choisissez un arrêt dans les réglages de ce widget.',
    widget_unknown_stop: "Cet arrêt n'est plus surveillé.",
    widget_next: 'Prochain',
    widget_delay: 'Retard',
    widget_source: 'Données',
    widget_realtime: 'Temps réel, {clock}',
    widget_timetable_only: 'Horaires théoriques',
    widget_disruptions: 'Perturbations',
    widget_refresh: 'Actualiser',
    widget_refreshed: 'Temps réel actualisé.',
    widget_refresh_quota: 'Quota atteint : données de {clock} conservées.',
    widget_no_disruption: 'Aucune perturbation sur vos lignes.',
    widget_lines: 'Lignes {lines}',
    widget_details: 'Détails sur letec.be',
    effect_1: 'Interrompu',
    effect_2: 'Réduit',
    effect_3: 'Retards',
    effect_4: 'Déviation',
    effect_5: 'Renfort',
    effect_6: 'Modifié',
    effect_9: 'Arrêt déplacé',
    effect_11: 'Accessibilité',
    effect_other: 'Info',
  },
  de: {
    minutes: '{n} Min.',
    now: 'jetzt',
    on_time: 'pünktlich',
    cancelled: 'fällt aus',
    scheduled_only: 'Fahrplan',
    no_departure: 'Keine Abfahrt in den nächsten {n} Minuten',
    no_service: 'Keine Abfahrt geplant',
    disruptions_none: 'Keine Störung',
    disruptions_count: plural('{n} Störung', '{n} Störungen'),
    feature_next: 'Nächste Abfahrt',
    feature_next_trip: 'Nächste Fahrt',
    feature_delay: 'Verspätung der nächsten Abfahrt',
    feature_following: 'Übernächste Abfahrt',
    feature_departures: 'Nächste Abfahrten',
    feature_disruptions: 'Störungen',
    status_no_stops: 'Fügen Sie die zu überwachenden Haltestellen in der Konfiguration hinzu.',
    status_loading:
      'Der TEC-Fahrplan wird heruntergeladen (ca. 80 MB), das dauert ein bis zwei Minuten.',
    status_timetable_error: 'Der TEC-Fahrplan konnte nicht geladen werden: {message}',
    status_key_refused:
      'Das Belgian-Mobility-Portal hat den API-Schlüssel abgelehnt: bitte prüfen.',
    status_invalid_stops: 'Ignoriert (unbekannte Haltestelle oder falsches Format): {list}',
    transport_no_key: 'Ohne API-Schlüssel werden Echtzeitdaten nur alle 20 Minuten aktualisiert.',
    transport_realtime_down: 'Echtzeitdaten nicht verfügbar: nur Fahrplanzeiten.',
    action_not_ready: 'Der Fahrplan wird noch geladen, bitte in einer Minute erneut versuchen.',
    action_test_ok:
      'Fahrplan {version} geladen ({stops} Haltestellen). Echtzeit: {trips} Fahrten verfolgt, {alerts} Meldungen. Anfragen in 24 h: {used}/{limit}.',
    action_test_realtime_failed:
      'Fahrplan OK, aber der Echtzeit-Feed ist fehlgeschlagen: {message}',
    action_test_quota:
      'Fahrplan OK, Echtzeit-Kontingent vorerst erreicht: später erneut versuchen.',
    action_search_empty: 'Geben Sie einen Teil des Haltestellennamens ein, z. B. „Charleroi Gare".',
    action_search_none: 'Keine Haltestelle entspricht „{query}".',
    action_search_results:
      'Kopieren Sie den Code Ihrer Haltestelle (einer pro Fahrtrichtung) in das Feld „Haltestellen":\n{list}',
    action_nearby_no_house:
      'Kein Haus mit Standort in Gladys: unter Einstellungen → Häuser festlegen oder die Haltestellensuche nutzen.',
    action_nearby_results: 'Haltestellen in der Nähe von {house}:\n{list}',
    action_refresh_updated: 'Fahrplan aktualisiert ({version}).',
    action_refresh_unchanged: 'Der Fahrplan ist bereits aktuell ({version}).',
    widget_choose_stop: 'Wählen Sie in den Einstellungen dieses Widgets eine Haltestelle.',
    widget_unknown_stop: 'Diese Haltestelle wird nicht mehr überwacht.',
    widget_next: 'Nächste',
    widget_delay: 'Verspätung',
    widget_source: 'Daten',
    widget_realtime: 'Echtzeit, {clock}',
    widget_timetable_only: 'Nur Fahrplan',
    widget_disruptions: 'Störungen',
    widget_refresh: 'Aktualisieren',
    widget_refreshed: 'Echtzeitdaten aktualisiert.',
    widget_refresh_quota: 'Kontingent erreicht: Daten von {clock} beibehalten.',
    widget_no_disruption: 'Keine Störung auf Ihren Linien.',
    widget_lines: 'Linien {lines}',
    widget_details: 'Details auf letec.be',
    effect_1: 'Kein Betrieb',
    effect_2: 'Eingeschränkt',
    effect_3: 'Verspätungen',
    effect_4: 'Umleitung',
    effect_5: 'Zusatzfahrten',
    effect_6: 'Geändert',
    effect_9: 'Verlegt',
    effect_11: 'Barrierefreiheit',
    effect_other: 'Info',
  },
  es: {
    minutes: '{n} min',
    now: 'ahora',
    on_time: 'puntual',
    cancelled: 'cancelado',
    scheduled_only: 'horario',
    no_departure: 'Ninguna salida en los próximos {n} minutos',
    no_service: 'Ninguna salida prevista',
    disruptions_none: 'Sin incidencias',
    disruptions_count: plural('{n} incidencia', '{n} incidencias'),
    feature_next: 'Próxima salida',
    feature_next_trip: 'Próximo paso',
    feature_delay: 'Retraso de la próxima salida',
    feature_following: 'Salida siguiente',
    feature_departures: 'Próximas salidas',
    feature_disruptions: 'Incidencias',
    status_no_stops: 'Añada las paradas que desea vigilar en la configuración.',
    status_loading: 'Descargando los horarios de TEC (unos 80 MB), tarda uno o dos minutos.',
    status_timetable_error: 'No se pudieron cargar los horarios de TEC: {message}',
    status_key_refused: 'El portal Belgian Mobility rechazó la clave de API: compruébela.',
    status_invalid_stops: 'Ignoradas (parada desconocida o formato incorrecto): {list}',
    transport_no_key: 'Sin clave de API, el tiempo real solo se actualiza cada 20 minutos.',
    transport_realtime_down: 'Tiempo real no disponible: solo horarios teóricos.',
    action_not_ready: 'Los horarios aún se están cargando, inténtelo de nuevo en un minuto.',
    action_test_ok:
      'Horarios {version} cargados ({stops} paradas). Tiempo real: {trips} viajes seguidos, {alerts} avisos. Peticiones en 24 h: {used}/{limit}.',
    action_test_realtime_failed: 'Horarios OK, pero el flujo en tiempo real falló: {message}',
    action_test_quota:
      'Horarios OK, cuota de tiempo real alcanzada por ahora: inténtelo más tarde.',
    action_search_empty: 'Escriba parte del nombre de la parada, p. ej. «Charleroi Gare».',
    action_search_none: 'Ninguna parada coincide con «{query}».',
    action_search_results:
      'Copie el código de su parada (uno por sentido) en el campo «Paradas»:\n{list}',
    action_nearby_no_house:
      'Ninguna casa con ubicación en Gladys: indíquela en Ajustes → Casas, o use la búsqueda de paradas.',
    action_nearby_results: 'Paradas cerca de {house}:\n{list}',
    action_refresh_updated: 'Horarios actualizados ({version}).',
    action_refresh_unchanged: 'Los horarios ya están al día ({version}).',
    widget_choose_stop: 'Elija una parada en los ajustes de este widget.',
    widget_unknown_stop: 'Esta parada ya no se vigila.',
    widget_next: 'Próxima',
    widget_delay: 'Retraso',
    widget_source: 'Datos',
    widget_realtime: 'Tiempo real, {clock}',
    widget_timetable_only: 'Solo horario',
    widget_disruptions: 'Incidencias',
    widget_refresh: 'Actualizar',
    widget_refreshed: 'Tiempo real actualizado.',
    widget_refresh_quota: 'Cuota alcanzada: se mantienen los datos de las {clock}.',
    widget_no_disruption: 'Sin incidencias en sus líneas.',
    widget_lines: 'Líneas {lines}',
    widget_details: 'Detalles en letec.be',
    effect_1: 'Sin servicio',
    effect_2: 'Reducido',
    effect_3: 'Retrasos',
    effect_4: 'Desvío',
    effect_5: 'Refuerzo',
    effect_6: 'Modificado',
    effect_9: 'Parada movida',
    effect_11: 'Accesibilidad',
    effect_other: 'Aviso',
  },
};

function render(template, vars) {
  const text = typeof template === 'function' ? template(vars) : template;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/** One text, in `lang` (English when unknown). */
export function t(lang, key, vars = {}) {
  const messages = MESSAGES[lang] ?? MESSAGES[FALLBACK_LANGUAGE];
  const template = messages[key] ?? MESSAGES[FALLBACK_LANGUAGE][key];
  if (template === undefined) {
    throw new Error(`Missing translation key: ${key}`);
  }
  return render(template, vars);
}

/** The same text in every language, as a multi-language object. */
export function tAll(key, vars = {}) {
  return Object.fromEntries(LANGUAGES.map((lang) => [lang, t(lang, key, vars)]));
}

/** The label of a GTFS-RT alert effect. */
export function effectKey(effect) {
  return MESSAGES.en[`effect_${effect}`] ? `effect_${effect}` : 'effect_other';
}

/**
 * Pick the text of an alert translation map (`{ fr: ..., nl: ... }`) in the
 * wanted language: TEC writes its alerts in French first.
 */
export function pickTranslation(translations, lang) {
  return (
    translations?.[lang] ??
    translations?.fr ??
    translations?.en ??
    Object.values(translations ?? {})[0] ??
    ''
  );
}
