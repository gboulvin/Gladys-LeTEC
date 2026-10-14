// -----------------------------------------------------------------------------
// Entry point of the TEC integration for Gladys Assistant.
//
// This file only wires the SDK to the service (src/service.js): handlers are
// registered BEFORE connect(), the service does the work.
//
// Environment variables provided by the Gladys supervisor to the container
// (read by the SDK): GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR. TEC_DATA_DIR overrides the data directory
// (default /data, the only writable volume of the container).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { TecService } from './src/service.js';
import { ACTIONS } from './src/actions.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { WIDGETS, refreshWidgets } from './src/widgets.js';

const gladys = new GladysIntegration();
const service = new TecService({ gladys, dataDir: process.env.TEC_DATA_DIR || '/data' });

// The widgets show the departures: nudge them whenever the list changes.
service.onChange = () => refreshWidgets(gladys);

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing the monitored stops');
  await service.publishDevices();
});

// --- Commands: every feature is read-only ------------------------------------
gladys.onSetValue(async (device) => {
  throw new Error(`${device.external_id} is read-only`);
});

// --- Manifest actions: buttons of the Configuration screen -------------------
for (const [key, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(key, (fields) => handler(gladys, { fields, service }));
}

// --- Scene actions -----------------------------------------------------------
// Scene TRIGGERS need no handler: the service fires them with
// publishSceneEvent (see src/triggers.js).
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(gladys, { fields, service }));
}

// --- Dashboard widgets -------------------------------------------------------
for (const [key, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, service }));
  if (typeof widget.action === 'function') {
    gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
      widget.action(gladys, { actionKey, params, settings, service }),
    );
  }
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  await service.reconfigure(newConfig);
  refreshWidgets(gladys);
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    await service.start();
    // Nudges sent while the socket was down were dropped: re-sync dashboards.
    refreshWidgets(gladys);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Logs der Integration.',
        es: 'La inicialización falló, revise los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => service.stop());

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  service.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the TEC integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
