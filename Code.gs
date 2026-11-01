function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.appName = EMMS.APP_NAME;
  template.version = EMMS.VERSION;
  template.qrEquipmentId = e && e.parameter ? String(e.parameter.equipment || '') : '';
  return template.evaluate()
    .setTitle(EMMS.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Ping endpoint for smoke testing. */
function apiHealth() {
  return { ok: true, app: EMMS.APP_NAME, version: EMMS.VERSION, time: new Date().toISOString() };
}

