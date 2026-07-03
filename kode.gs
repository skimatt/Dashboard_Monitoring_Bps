/************************************************************
 * DASHBOARD MONITORING BPS BIREUEN - FINAL CODE.GS V2.4 PRODUCTION
 * Source:
 * 1. Sheet "Progres"  = Rekap kecamatan
 * 2. Sheet "Petugas"  = Export SERASI detail SLS per petugas
 *
 * Prinsip final:
 * - persenRealisasi = hasil hitung dashboard
 *   Total Berhasil DiData / Total Target FASIH * 100
 * - persenRealisasiSource = angka dari export SERASI
 * - selisihPersenSource = audit selisih hitung dashboard vs export
 ************************************************************/

const APP_CONFIG = {
  APP_NAME: "Dashboard Monitoring BPS Bireuen",
  VERSION: "2.4.0",
  TIMEZONE: "Asia/Jakarta",

  SPREADSHEET_ID: "1_tkrxzaZsS_X9MRa9k4okKiGlkN8RkSqEhD9vP9TWj4",
  APP_LOGO_FILE_ID: "1lBVpPGzrWfpl_nyvLxXzj9y3bX2CA1Q7",

  SHEETS: {
    PROGRES: "Progres",
    PETUGAS: "Petugas",
  },

  PROGRES_RANGE: {
    DATA_START_ROW: 8,
    DATA_ROWS: 17,
    TOTAL_ROW: 25,
    DATA_COLUMNS: 11,
    TARGET_CELL: "E3",
  },

  TARGETS: {
    PETUGAS: {
      ELITE: 30,
      ON_TRACK: 20,
      PERHATIAN: 10,
    },
  },

  VALIDATION: {
    PERCENT_TOLERANCE: 0.05,
  },

  RISK: {
    OPEN_HIGH_RATIO: 0.75,
    DRAFT_HIGH_RATIO: 0.25,
    DRAFT_HIGH_MIN: 10,
  },

  AI: {
    API_KEY_PROPERTY: "OPENROUTER_API_KEY",
    MODEL_PROPERTY: "OPENROUTER_MODEL",
    DEFAULT_MODEL: "cohere/north-mini-code:free",
    API_URL: "https://openrouter.ai/api/v1/chat/completions",
    WORKER_CHAT_URL: "https://bps.rahmatyoung10.workers.dev/chat",
    WORKER_HEALTH_URL: "https://bps.rahmatyoung10.workers.dev/health",
    MAX_PROMPT_CHARS: 4000,
    MAX_CONTEXT_ROWS: 25,
  },

  SECURITY: {
    // Biarkan kosong agar akses mengikuti pengaturan deployment Apps Script.
    // Isi ALLOWED_EMAILS atau ALLOWED_DOMAINS untuk mengaktifkan pembatasan akun.
    ALLOWED_EMAILS: [],
    ALLOWED_DOMAINS: [],
    SENSITIVE_APIS: ["petugas", "pml", "sls", "all", "super"],
  },
};

/* =========================================================
   ROUTER
========================================================= */

function doGet(e) {
  const api =
    e && e.parameter ? String(e.parameter.api || "").toLowerCase() : "";

  try {
    if (api) {
      return handleApiRequest_(api);
    }

    const template = HtmlService.createTemplateFromFile("index");
    template.appLogo = getAppLogoDataUrl_();

    return template
      .evaluate()
      .setTitle(APP_CONFIG.APP_NAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {
    logError_("doGet", error);

    return jsonOutput_({
      success: false,
      app: APP_CONFIG.APP_NAME,
      version: APP_CONFIG.VERSION,
      error: isUserFacingError_(error)
        ? String(error.message)
        : "Terjadi kesalahan pada server. Silakan hubungi administrator.",
    });
  }
}

function handleApiRequest_(api) {
  enforceApiAccess_(api);
  const superPayload =
    api === "petugas" ||
    api === "pml" ||
    api === "sls" ||
    api === "all" ||
    api === "super"
      ? getSuperDashboardData_()
      : null;

  if (api === "1" || api === "overview" || api === "kecamatan") {
    return jsonOutput_(getDashboardData());
  }

  if (api === "petugas") {
    return jsonOutput_(superPayload.petugas);
  }

  if (api === "pml") {
    return jsonOutput_({
      success: superPayload.petugas.success,
      meta: superPayload.petugas.meta,
      summary: superPayload.petugas.summary,
      pml: superPayload.petugas.pml,
    });
  }

  if (api === "sls") {
    return jsonOutput_(superPayload.sls);
  }

  if (api === "all" || api === "super") {
    return jsonOutput_(superPayload);
  }

  if (api === "health") {
    return jsonOutput_(healthCheck_());
  }

  return jsonOutput_({
    success: false,
    app: APP_CONFIG.APP_NAME,
    version: APP_CONFIG.VERSION,
    message: "API tidak dikenal.",
    availableApis: [
      "?api=overview",
      "?api=kecamatan",
      "?api=petugas",
      "?api=pml",
      "?api=sls",
      "?api=all",
      "?api=health",
    ],
  });
}

function include(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}

function getAppLogoDataUrl_() {
  try {
    const file = DriveApp.getFileById(APP_CONFIG.APP_LOGO_FILE_ID);
    const blob = file.getBlob();
    const fileName = file.getName().toLowerCase();
    let mimeType = blob.getContentType();

    if (
      !mimeType ||
      mimeType === "application/octet-stream" ||
      mimeType === "text/plain"
    ) {
      if (fileName.endsWith(".svg")) {
        mimeType = "image/svg+xml";
      } else if (fileName.endsWith(".png")) {
        mimeType = "image/png";
      } else if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
        mimeType = "image/jpeg";
      } else {
        mimeType = "image/png";
      }
    }

    const base64 = Utilities.base64Encode(blob.getBytes());

    return "data:" + mimeType + ";base64," + base64;
  } catch (error) {
    logError_("getAppLogoDataUrl_", error);
    return "";
  }
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(
    JSON.stringify(payload, null, 2),
  ).setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================
   MAIN PAYLOAD
========================================================= */

function getDashboardData() {
  return runPublicApi_("getDashboardData", function () {
    return getKecamatanDashboardData_();
  });
}

function getSuperDashboardData() {
  return runPublicApi_("getSuperDashboardData", function () {
    enforceApiAccess_("super");
    return getSuperDashboardData_();
  });
}

function getSuperDashboardData_() {
  const kecamatan = getKecamatanDashboardData_();
  const sls = getSlsDashboardData_();
  const petugas = getPetugasDashboardData_(sls);

  return {
    success: true,
    app: APP_CONFIG.APP_NAME,
    version: APP_CONFIG.VERSION,
    generatedAt: nowText_(),
    executive: buildExecutiveSummary_(kecamatan, petugas),
    kecamatan: kecamatan,
    petugas: petugas,
    sls: sls,
  };
}

/* =========================================================
   AI ASSISTANT - OPENROUTER SERVER-SIDE PROXY
========================================================= */

function askAiDashboard(request) {
  return runPublicApi_("askAiDashboard", function () {
    const prompt = cleanText_(request && request.prompt);
    const contextMode = cleanText_(request && request.contextMode) || "summary";

    if (!prompt) {
      throw userFacingError_("Pertanyaan AI belum diisi.");
    }

    if (prompt.length > APP_CONFIG.AI.MAX_PROMPT_CHARS) {
      throw userFacingError_(
        "Pertanyaan terlalu panjang. Ringkas pertanyaan agar analisis lebih fokus.",
      );
    }

    const model = getOpenRouterModel_();
    const dashboard = getSuperDashboardData_();
    const context = buildAiDashboardContext_(dashboard, contextMode);
    const answer = callAiWorker_(model, prompt, context);

    return {
      success: true,
      app: APP_CONFIG.APP_NAME,
      version: APP_CONFIG.VERSION,
      model: model,
      generatedAt: nowText_(),
      answer: answer,
      contextMode: contextMode,
    };
  });
}

function getOpenRouterApiKey_() {
  const key = cleanText_(
    PropertiesService.getScriptProperties().getProperty(
      APP_CONFIG.AI.API_KEY_PROPERTY,
    ),
  );

  if (!key) {
    throw userFacingError_(
      "API key AI belum disetel. Isi Script Properties: " +
        APP_CONFIG.AI.API_KEY_PROPERTY +
        ".",
    );
  }

  return key;
}

function getOpenRouterModel_() {
  return (
    cleanText_(
      PropertiesService.getScriptProperties().getProperty(
        APP_CONFIG.AI.MODEL_PROPERTY,
      ),
    ) || APP_CONFIG.AI.DEFAULT_MODEL
  );
}

function buildAiDashboardContext_(dashboard, mode) {
  const kecamatan = dashboard.kecamatan || {};
  const petugas = dashboard.petugas || {};
  const sls = dashboard.sls || {};
  const petugasRanking = petugas.ranking || {};
  const pmlAnalytics = petugas.pml || {};
  const slsRanking = sls.ranking || {};
  const maxRows = APP_CONFIG.AI.MAX_CONTEXT_ROWS;

  const context = {
    app: dashboard.app,
    version: dashboard.version,
    generatedAt: dashboard.generatedAt,
    mode: mode,
    executive: dashboard.executive || {},
    rankingGuide: {
      topRealisasi: "Petugas dengan persentase realisasi tertinggi.",
      bottomRealisasi: "Petugas dengan persentase realisasi terendah.",
      topBerhasil: "Petugas dengan jumlah berhasil didata terbanyak.",
      topOpen: "Petugas/SLS dengan open terbanyak.",
      topDraft: "Petugas/SLS dengan draft terbanyak.",
      topRisk: "Petugas dengan risk score tertinggi.",
      rankingSubmit: "Kecamatan dengan percentSubmit tertinggi.",
      warningList: "Kecamatan yang perlu perhatian karena submit rendah.",
    },
    kecamatan: {
      summary: kecamatan.summary || {},
      rankingSubmit: slimRows_(kecamatan.rankingSubmit || [], maxRows, [
        "kode",
        "kecamatan",
        "percentSubmit",
        "submit",
        "approve",
        "jumlahPPL",
        "status",
      ]),
      warningList: slimRows_(kecamatan.warningList || [], maxRows, [
        "kode",
        "kecamatan",
        "percentSubmit",
        "submit",
        "approve",
        "jumlahPPL",
        "status",
      ]),
    },
    petugas: {
      summary: petugas.summary || {},
      topRealisasi: slimRows_(petugasRanking.topRealisasi || [], maxRows, [
        "pplNama",
        "pplEmail",
        "pmlNama",
        "kecamatan",
        "targetFasih",
        "berhasilDidata",
        "persenRealisasi",
        "open",
        "draft",
        "riskScore",
        "status",
      ]),
      topBerhasil: slimRows_(petugasRanking.topBerhasil || [], maxRows, [
        "pplNama",
        "pplEmail",
        "pmlNama",
        "kecamatan",
        "targetFasih",
        "berhasilDidata",
        "persenRealisasi",
        "open",
        "draft",
        "riskScore",
        "status",
      ]),
      topRisk: slimRows_(petugasRanking.highestRisk || [], maxRows, [
        "pplNama",
        "pplEmail",
        "pmlNama",
        "kecamatan",
        "persenRealisasi",
        "open",
        "draft",
        "riskScore",
        "status",
      ]),
      bottomRealisasi: slimRows_(petugasRanking.bottomRealisasi || [], maxRows, [
        "pplNama",
        "pplEmail",
        "pmlNama",
        "kecamatan",
        "targetFasih",
        "berhasilDidata",
        "persenRealisasi",
        "open",
        "draft",
        "status",
      ]),
      topOpen: slimRows_(petugasRanking.topOpen || [], maxRows, [
        "pplNama",
        "pmlNama",
        "kecamatan",
        "targetFasih",
        "berhasilDidata",
        "open",
        "draft",
        "riskScore",
      ]),
      topDraft: slimRows_(petugasRanking.topDraft || [], maxRows, [
        "pplNama",
        "pmlNama",
        "kecamatan",
        "targetFasih",
        "berhasilDidata",
        "open",
        "draft",
        "riskScore",
      ]),
    },
    pml: {
      summary: pmlAnalytics.summary || {},
      topRealisasi: slimRows_(pmlAnalytics.topRealisasi || [], maxRows, [
        "pmlNama",
        "pmlEmail",
        "kecamatan",
        "totalPPL",
        "totalSLS",
        "targetFasih",
        "berhasilDidata",
        "persenRealisasi",
        "open",
        "draft",
        "riskScore",
      ]),
      topBerhasil: slimRows_(pmlAnalytics.topBerhasil || [], maxRows, [
        "pmlNama",
        "pmlEmail",
        "kecamatan",
        "totalPPL",
        "totalSLS",
        "targetFasih",
        "berhasilDidata",
        "persenRealisasi",
        "open",
        "draft",
        "riskScore",
      ]),
      highestRisk: slimRows_(pmlAnalytics.highestRisk || [], maxRows, [
        "pmlNama",
        "pmlEmail",
        "kecamatan",
        "totalPPL",
        "totalSLS",
        "targetFasih",
        "berhasilDidata",
        "persenRealisasi",
        "open",
        "draft",
        "riskScore",
      ]),
    },
    sls: {
      summary: sls.summary || {},
      topSls: slimRows_(slsRanking.topSls || [], maxRows, [
        "kodeSls",
        "kecamatan",
        "pplNama",
        "pmlNama",
        "targetFasih",
        "berhasilDidata",
        "persenRealisasi",
        "open",
        "draft",
        "riskScore",
        "status",
      ]),
      topOpen: slimRows_(slsRanking.topOpen || [], maxRows, [
        "kodeSls",
        "kecamatan",
        "pplNama",
        "pmlNama",
        "targetFasih",
        "berhasilDidata",
        "persenRealisasi",
        "open",
        "draft",
        "riskScore",
        "status",
      ]),
      bottomSls: slimRows_(slsRanking.bottomSls || [], maxRows, [
        "kodeSls",
        "kecamatan",
        "pplNama",
        "pmlNama",
        "targetFasih",
        "berhasilDidata",
        "persenRealisasi",
        "open",
        "draft",
        "riskScore",
        "status",
      ]),
    },
  };

  if (mode === "detail") {
    context.petugas.dataPreview = slimRows_(petugas.data || [], maxRows, [
      "pplNama",
      "pplEmail",
      "pmlNama",
      "pmlEmail",
      "kecamatan",
      "totalSLS",
      "targetFasih",
      "berhasilDidata",
      "persenRealisasi",
      "open",
      "draft",
      "riskScore",
      "status",
    ]);
    context.sls.dataPreview = slimRows_(sls.data || [], maxRows, [
      "kodeSls",
      "kecamatan",
      "pplNama",
      "pmlNama",
      "targetFasih",
      "berhasilDidata",
      "persenRealisasi",
      "open",
      "draft",
      "riskScore",
      "status",
    ]);
  }

  return context;
}

function slimRows_(rows, limit, keys) {
  return (rows || []).slice(0, limit).map((row) => {
    const item = {};

    keys.forEach((key) => {
      if (row && row[key] !== undefined) item[key] = row[key];
    });

    return item;
  });
}

function callAiWorker_(model, prompt, context) {
  const messages = [
    {
      role: "system",
      content:
        "Anda adalah asisten analisis dashboard monitoring BPS Bireuen. " +
        "Jawab dalam bahasa Indonesia yang ringkas, profesional, dan operasional. " +
        "Gunakan hanya data JSON yang diberikan. Jangan mengarang angka. " +
        "Jika data tidak tersedia, katakan tidak tersedia. " +
        "Beri prioritas, temuan, dan rekomendasi praktis jika relevan. " +
        "Untuk pertanyaan tertinggi/terbaik gunakan topRealisasi atau topBerhasil. " +
        "Untuk pertanyaan terendah gunakan bottomRealisasi atau bottomSls. " +
        "Untuk risiko gunakan topRisk/highestRisk. Jangan membalik tertinggi dan terendah. " +
        "Format jawaban dengan heading pendek, bullet, dan angka konkret. " +
        "Untuk pertanyaan ranking, tampilkan 5 teratas kecuali diminta lebih. " +
        "Jangan menampilkan JSON mentah.",
    },
    {
      role: "user",
      content:
        "DATA_DASHBOARD_JSON:\n" +
        JSON.stringify(context) +
        "\n\nPERTANYAAN_USER:\n" +
        prompt,
    },
  ];

  let response;

  try {
    response = UrlFetchApp.fetch(APP_CONFIG.AI.WORKER_CHAT_URL, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.2,
        max_tokens: 1200,
      }),
    });
  } catch (error) {
    logError_("callAiWorker_:fetch", error);
    throw userFacingError_(
      "Gagal menghubungi AI Worker: " +
        sanitizeOpenRouterErrorText_(
          error && error.message ? error.message : error,
        ),
    );
  }

  const status = response.getResponseCode();
  const text = response.getContentText();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch (error) {
    logError_("callAiWorker_:parse", error);
    throw userFacingError_("AI Worker mengembalikan response yang tidak valid.");
  }

  if (status < 200 || status >= 300 || payload.success === false) {
    logError_("callAiWorker_:http", new Error(text));
    throw userFacingError_(
      payload && payload.error
        ? sanitizeOpenRouterErrorText_(payload.error)
        : "AI Worker gagal memproses permintaan. Status " + status + ".",
    );
  }

  if (!payload.answer) {
    throw userFacingError_("AI Worker tidak mengembalikan jawaban.");
  }

  return String(payload.answer).trim();
}

function callOpenRouter_(apiKey, model, prompt, context) {
  const messages = [
    {
      role: "system",
      content:
        "Anda adalah asisten analisis dashboard monitoring BPS Bireuen. " +
        "Jawab dalam bahasa Indonesia yang ringkas, profesional, dan operasional. " +
        "Gunakan hanya data JSON yang diberikan. Jangan mengarang angka. " +
        "Jika data tidak tersedia, katakan tidak tersedia. " +
        "Beri prioritas, temuan, dan rekomendasi praktis jika relevan.",
    },
    {
      role: "user",
      content:
        "DATA_DASHBOARD_JSON:\n" +
        JSON.stringify(context) +
        "\n\nPERTANYAAN_USER:\n" +
        prompt,
    },
  ];

  let response;

  try {
    response = UrlFetchApp.fetch(APP_CONFIG.AI.API_URL, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      headers: {
        Authorization: "Bearer " + apiKey,
        "HTTP-Referer": "https://script.google.com",
        "X-OpenRouter-Title": APP_CONFIG.APP_NAME,
      },
      payload: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.2,
        max_tokens: 1200,
      }),
    });
  } catch (error) {
    logError_("callOpenRouter_:fetch", error);
    throw userFacingError_(
      "Gagal menghubungi OpenRouter: " +
        sanitizeOpenRouterErrorText_(
          error && error.message ? error.message : error,
        ),
    );
  }

  const status = response.getResponseCode();
  const text = response.getContentText();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch (error) {
    logError_("callOpenRouter_:parse", error);
    throw userFacingError_(
      "OpenRouter mengembalikan response yang tidak dapat dibaca.",
    );
  }

  if (status < 200 || status >= 300) {
    logError_("callOpenRouter_:http", new Error(text));
    throw userFacingError_(buildOpenRouterUserError_(status, payload));
  }

  const answer =
    payload &&
    payload.choices &&
    payload.choices[0] &&
    payload.choices[0].message
      ? payload.choices[0].message.content
      : "";

  if (!answer) {
    throw userFacingError_("OpenRouter tidak mengembalikan jawaban.");
  }

  return String(answer).trim();
}

function buildOpenRouterUserError_(status, payload) {
  const providerMessage = cleanText_(
    payload && payload.error && payload.error.message
      ? payload.error.message
      : "",
  );
  const safeProviderMessage = sanitizeOpenRouterErrorText_(providerMessage);

  if (status === 401 || status === 403) {
    return (
      "OpenRouter menolak API key atau akses model. Periksa Script Property OPENROUTER_API_KEY" +
      (safeProviderMessage ? ": " + safeProviderMessage : ".")
    );
  }

  if (status === 402) {
    return "OpenRouter menolak request karena saldo/limit akun tidak mencukupi.";
  }

  if (status === 404) {
    return (
      "Model OpenRouter tidak ditemukan. Periksa Script Property OPENROUTER_MODEL" +
      (safeProviderMessage ? ": " + safeProviderMessage : ".")
    );
  }

  if (status === 429) {
    return "OpenRouter sedang rate limit. Coba lagi beberapa saat.";
  }

  return (
    "OpenRouter gagal memproses permintaan. Status " +
    status +
    (safeProviderMessage ? ": " + safeProviderMessage : ".")
  );
}

function sanitizeOpenRouterErrorText_(value) {
  return cleanText_(value)
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[API_KEY]")
    .slice(0, 220);
}

function testOpenRouterConnection() {
  return runPublicApi_("testOpenRouterConnection", function () {
    const model = getOpenRouterModel_();
    const answer = callAiWorker_(
      model,
      "Jawab singkat dalam bahasa Indonesia: koneksi OpenRouter berhasil.",
      {
        app: APP_CONFIG.APP_NAME,
        test: true,
        generatedAt: nowText_(),
      },
    );

    Logger.log(answer);

    return {
      success: true,
      model: model,
      answer: answer,
    };
  });
}

function authorizeExternalRequest() {
  const response = UrlFetchApp.fetch(APP_CONFIG.AI.WORKER_HEALTH_URL, {
    method: "get",
    muteHttpExceptions: true,
  });

  const result = {
    success: response.getResponseCode() >= 200 && response.getResponseCode() < 300,
    status: response.getResponseCode(),
    message: "Izin UrlFetchApp sudah aktif jika fungsi ini bisa berjalan.",
  };

  Logger.log(JSON.stringify(result, null, 2));

  return result;
}

/* =========================================================
   KECAMATAN: SHEET PROGRES
========================================================= */

function getKecamatanDashboardData_() {
  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(APP_CONFIG.SHEETS.PROGRES);

  if (!sheet) {
    throw userFacingError_("Sheet tidak ditemukan: " + APP_CONFIG.SHEETS.PROGRES);
  }

  const cfg = APP_CONFIG.PROGRES_RANGE;

  const rows = sheet
    .getRange(cfg.DATA_START_ROW, 1, cfg.DATA_ROWS, cfg.DATA_COLUMNS)
    .getDisplayValues();

  const totalRow = sheet
    .getRange(cfg.TOTAL_ROW, 1, 1, cfg.DATA_COLUMNS)
    .getDisplayValues()[0];

  const targetHarian = toNumber_(
    sheet.getRange(cfg.TARGET_CELL).getDisplayValue(),
  );

  const kondisiData = [
    sheet.getRange("B3").getDisplayValue(),
    sheet.getRange("C3").getDisplayValue(),
    sheet.getRange("D3").getDisplayValue(),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const data = rows
    .filter((row) => row[0] && row[1])
    .map((row) => {
      const item = {
        kode: sanitizeSheetText_(row[0]),
        kecamatan: sanitizeSheetText_(row[1]),
        prelist: toNumber_(row[2]),
        submit: toNumber_(row[3]),
        percentSubmit: toNumber_(row[4]),
        selisihPercent: toNumber_(row[5]),
        rataSubmitPerPPL: toNumber_(row[6]),
        approve: toNumber_(row[7]),
        percentApprove: toNumber_(row[8]),
        jumlahPPL: toNumber_(row[10]),
      };

      item.status = getKecamatanStatus_(item.percentSubmit, targetHarian);
      item.approvalBacklog = Math.max(item.submit - item.approve, 0);
      item.openEstimate = Math.max(item.prelist - item.submit, 0);

      return item;
    });

  const summary = {
    totalPrelist: toNumber_(totalRow[2]),
    totalSubmit: toNumber_(totalRow[3]),
    percentSubmit: toNumber_(totalRow[4]),
    selisihPercent: toNumber_(totalRow[5]),
    rataSubmitPerPPL: toNumber_(totalRow[6]),
    totalApprove: toNumber_(totalRow[7]),
    percentApprove: toNumber_(totalRow[8]),
    totalPPL: toNumber_(totalRow[10]),

    totalKecamatan: data.length,
    targetHarian: targetHarian,

    aboveTarget: data.filter((d) => d.percentSubmit >= targetHarian).length,
    belowTarget: data.filter((d) => d.percentSubmit < targetHarian).length,

    criticalCount: data.filter((d) => d.status === "KRITIS").length,
    warningCount: data.filter((d) => d.status === "PERHATIAN").length,
    goodCount: data.filter((d) => d.status === "AMAN").length,

    totalApprovalBacklog: sum_(data, "approvalBacklog"),
    totalOpenEstimate: sum_(data, "openEstimate"),
  };

  return {
    success: true,
    source: "GOOGLE_SHEETS_PROGRES",
    module: "KECAMATAN",
    meta: {
      title: "Dashboard Monitoring Progress Harian",
      wilayah: "Kabupaten Bireuen",
      sheetName: APP_CONFIG.SHEETS.PROGRES,
      targetCell: APP_CONFIG.PROGRES_RANGE.TARGET_CELL,
      kondisiData: sanitizeSheetText_(kondisiData || "Tidak terbaca"),
      lastUpdate: nowText_(),
    },
    summary: summary,
    data: data,
    rankingSubmit: [...data].sort((a, b) => b.percentSubmit - a.percentSubmit),
    rankingApprove: [...data].sort(
      (a, b) => b.percentApprove - a.percentApprove,
    ),
    warningList: [...data]
      .sort((a, b) => a.percentSubmit - b.percentSubmit)
      .slice(0, 8),
    backlogList: [...data]
      .sort((a, b) => b.approvalBacklog - a.approvalBacklog)
      .slice(0, 8),
  };
}

function getKecamatanStatus_(percent, target) {
  if (percent >= target) return "AMAN";
  if (percent >= target - 5) return "PERHATIAN";
  return "KRITIS";
}

function getKecamatanLookup_() {
  const payload = getKecamatanDashboardData_();
  const map = {};

  payload.data.forEach((item) => {
    map[String(item.kode)] = item.kecamatan;
  });

  return map;
}

/* =========================================================
   SLS: SHEET PETUGAS RAW EXPORT SERASI
========================================================= */

function getSlsDashboardData() {
  return runPublicApi_("getSlsDashboardData", function () {
    enforceApiAccess_("sls");
    return getSuperDashboardData_().sls;
  });
}

function getSlsDashboardData_() {
  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(APP_CONFIG.SHEETS.PETUGAS);

  if (!sheet) {
    throw userFacingError_("Sheet tidak ditemukan: " + APP_CONFIG.SHEETS.PETUGAS);
  }

  const values = sheet.getDataRange().getDisplayValues();

  if (!values || values.length < 2) {
    throw userFacingError_("Sheet Petugas masih kosong atau belum memiliki data.");
  }

  const headerIndex = findPetugasHeaderIndex_(values);

  if (headerIndex === -1) {
    throw userFacingError_(
      "Header Petugas tidak ditemukan. Pastikan header berisi: No, Identitas PPL, Identitas PML, Kode SLS, Total Target FASIH, Total Berhasil DiData, Persentase Realisasi Total, OPEN, DRAFT, DATETIME.",
    );
  }

  const headers = values[headerIndex].map(normalizeHeader_);
  const col = buildPetugasRawHeaderMap_(headers);
  validatePetugasRawHeaderMap_(col);
  const kecamatanLookup = getKecamatanLookup_();

  const rows = values
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cleanText_(cell) !== ""))
    .filter(
      (row) =>
        cleanText_(getCell_(row, col.no)) !== "" ||
        cleanText_(getCell_(row, col.kodeSls)) !== "",
    );

  const data = rows.map((row, index) => {
    const ppl = splitIdentity_(getCell_(row, col.identitasPpl));
    const pml = splitIdentity_(getCell_(row, col.identitasPml));

    const kodeSls = sanitizeSheetText_(getCell_(row, col.kodeSls));
    const kodeKecamatan = extractKodeKecamatan_(kodeSls);
    const kecamatan = sanitizeSheetText_(
      kecamatanLookup[kodeKecamatan] || "TIDAK DIKETAHUI",
    );

    const targetFasih = toNumber_(getCell_(row, col.targetFasih));
    const berhasilDidata = toNumber_(getCell_(row, col.berhasilDidata));

    const persenRealisasiSource = toNumber_(getCell_(row, col.persenRealisasi));
    const persenRealisasi = calculatePercent_(berhasilDidata, targetFasih);
    const selisihPersenSource = round2_(
      persenRealisasi - persenRealisasiSource,
    );
    const persenValidasiStatus = getPersenValidationStatus_(
      persenRealisasi,
      persenRealisasiSource,
      targetFasih,
      berhasilDidata,
    );

    const item = {
      no: toNumber_(getCell_(row, col.no)) || index + 1,

      pplEmail: ppl.email,
      pplNama: ppl.name,

      pmlEmail: pml.email,
      pmlNama: pml.name,

      kodeSls: kodeSls,
      kodeKecamatan: kodeKecamatan,
      kecamatan: kecamatan,

      targetFasih: targetFasih,
      berhasilDidata: berhasilDidata,

      // FINAL LOCK:
      // persenRealisasi selalu hasil hitung dashboard.
      persenRealisasi: persenRealisasi,

      // Source dari export SERASI hanya untuk audit.
      persenRealisasiSource: persenRealisasiSource,
      selisihPersenSource: selisihPersenSource,
      persenValidasiStatus: persenValidasiStatus,

      open: toNumber_(getCell_(row, col.open)),
      draft: toNumber_(getCell_(row, col.draft)),

      datetime: sanitizeSheetText_(getCell_(row, col.datetime)),
    };

    item.status = getPetugasStatus_(item.persenRealisasi);
    item.statusLabel = getPetugasStatusLabel_(item.status);
    item.riskScore = calculateOperationalRiskScore_(item);
    item.riskLabel = getRiskLabel_(item.riskScore);

    return item;
  });

  const totalTarget = sum_(data, "targetFasih");
  const totalBerhasil = sum_(data, "berhasilDidata");
  const totalSourceMismatch = data.filter(
    (d) => d.persenValidasiStatus !== "OK",
  ).length;
  const maxSelisihPersenSource = data.length
    ? Math.max.apply(
        null,
        data.map((d) => Math.abs(Number(d.selisihPersenSource || 0))),
      )
    : 0;

  const summary = {
    totalSLS: data.length,
    totalTarget: totalTarget,
    totalBerhasil: totalBerhasil,
    totalOpen: sum_(data, "open"),
    totalDraft: sum_(data, "draft"),

    // FINAL LOCK:
    // summary juga selalu hasil hitung dari total berhasil / total target.
    persenRealisasi: calculatePercent_(totalBerhasil, totalTarget),

    elite: data.filter((d) => d.status === "ELITE").length,
    onTrack: data.filter((d) => d.status === "ON_TRACK").length,
    perhatian: data.filter((d) => d.status === "PERHATIAN").length,
    kritis: data.filter((d) => d.status === "KRITIS").length,

    auditPersen: {
      sourceField: "Persentase Realisasi Total",
      calculatedFormula: "Total Berhasil DiData / Total Target FASIH * 100",
      totalMismatch: totalSourceMismatch,
      maxSelisih: round2_(maxSelisihPersenSource),
      tolerance: APP_CONFIG.VALIDATION.PERCENT_TOLERANCE,
    },
  };

  return {
    success: true,
    source: "GOOGLE_SHEETS_PETUGAS_RAW",
    module: "SLS",
    meta: {
      title: "Detail SLS dari Export SERASI",
      wilayah: "Kabupaten Bireuen",
      sheetName: APP_CONFIG.SHEETS.PETUGAS,
      pulledAt: nowText_(),
      headerRow: headerIndex + 1,
      totalRows: data.length,
      note: "Kode kecamatan diambil dari 7 digit pertama Kode SLS. Persentase utama dihitung dashboard dari berhasil/target; kolom Persentase Realisasi Total disimpan sebagai source audit.",
    },
    summary: summary,
    data: data,
    ranking: {
      topSls: [...data]
        .sort((a, b) => b.persenRealisasi - a.persenRealisasi)
        .slice(0, 20),
      bottomSls: [...data]
        .sort((a, b) => a.persenRealisasi - b.persenRealisasi)
        .slice(0, 20),
      topOpen: [...data].sort((a, b) => b.open - a.open).slice(0, 20),
      topDraft: [...data].sort((a, b) => b.draft - a.draft).slice(0, 20),
      persenMismatch: [...data]
        .filter((d) => d.persenValidasiStatus !== "OK")
        .sort(
          (a, b) =>
            Math.abs(b.selisihPersenSource) - Math.abs(a.selisihPersenSource),
        )
        .slice(0, 20),
    },
  };
}

function findPetugasHeaderIndex_(values) {
  for (let i = 0; i < Math.min(values.length, 15); i++) {
    const text = values[i].join(" ").toUpperCase();

    if (
      text.indexOf("IDENTITAS PPL") !== -1 &&
      text.indexOf("IDENTITAS PML") !== -1 &&
      text.indexOf("KODE SLS") !== -1
    ) {
      return i;
    }
  }

  return -1;
}

function buildPetugasRawHeaderMap_(headers) {
  return {
    no: findHeaderIndex_(headers, ["NO"]),
    identitasPpl: findHeaderIndex_(headers, ["IDENTITAS PPL"]),
    identitasPml: findHeaderIndex_(headers, ["IDENTITAS PML"]),
    kodeSls: findHeaderIndex_(headers, ["KODE SLS"]),
    targetFasih: findHeaderIndex_(headers, [
      "TOTAL TARGET FASIH",
      "TARGET FASIH",
    ]),
    berhasilDidata: findHeaderIndex_(headers, [
      "TOTAL BERHASIL DIDATA",
      "BERHASIL DIDATA",
    ]),
    persenRealisasi: findHeaderIndex_(headers, [
      "PERSENTASE REALISASI TOTAL",
      "REALISASI TOTAL",
      "PERSENTASE",
    ]),
    open: findHeaderIndex_(headers, ["OPEN"]),
    draft: findHeaderIndex_(headers, ["DRAFT"]),
    datetime: findHeaderIndex_(headers, ["DATETIME", "DATE TIME", "WAKTU"]),
  };
}

function validatePetugasRawHeaderMap_(col) {
  const required = [
    ["no", "No"],
    ["identitasPpl", "Identitas PPL"],
    ["identitasPml", "Identitas PML"],
    ["kodeSls", "Kode SLS"],
    ["targetFasih", "Total Target FASIH"],
    ["berhasilDidata", "Total Berhasil DiData"],
    ["persenRealisasi", "Persentase Realisasi Total"],
    ["open", "OPEN"],
    ["draft", "DRAFT"],
    ["datetime", "DATETIME"],
  ];

  const missing = required
    .filter((item) => col[item[0]] === -1)
    .map((item) => item[1]);

  if (missing.length) {
    throw userFacingError_(
      "Header wajib sheet Petugas tidak lengkap: " + missing.join(", ") + ".",
    );
  }
}

/* =========================================================
   PETUGAS: AGREGASI DARI SLS
========================================================= */

function getPetugasDashboardData(slsPayload) {
  return runPublicApi_("getPetugasDashboardData", function () {
    enforceApiAccess_("petugas");
    return slsPayload
      ? getPetugasDashboardData_(slsPayload)
      : getSuperDashboardData_().petugas;
  });
}

function getPetugasDashboardData_(slsPayload) {
  slsPayload = slsPayload || getSlsDashboardData_();

  if (!slsPayload.success) {
    return {
      success: false,
      source: "GOOGLE_SHEETS_PETUGAS_RAW",
      module: "PETUGAS",
      meta: {
        title: "Monitoring Petugas PPL",
        wilayah: "Kabupaten Bireuen",
        sheetName: APP_CONFIG.SHEETS.PETUGAS,
        pulledAt: nowText_(),
        totalRows: 0,
      },
      message: slsPayload.message || "Data Petugas tidak tersedia.",
      summary: {},
      ranking: {},
      pml: {},
      quality: {},
      risk: {},
      data: [],
    };
  }

  const slsRows = slsPayload.data;
  const petugasRows = aggregatePetugasFromSls_(slsRows);

  return {
    success: true,
    source: "GOOGLE_SHEETS_PETUGAS_RAW",
    module: "PETUGAS",
    meta: {
      title: "Monitoring Petugas PPL",
      wilayah: "Kabupaten Bireuen",
      sheetName: APP_CONFIG.SHEETS.PETUGAS,
      pulledAt: nowText_(),
      mode: "Agregasi otomatis dari detail SLS",
      rawSlsRows: slsRows.length,
      totalRows: petugasRows.length,
      openHighRatio: APP_CONFIG.RISK.OPEN_HIGH_RATIO,
      draftHighRatio: APP_CONFIG.RISK.DRAFT_HIGH_RATIO,
      draftHighMin: APP_CONFIG.RISK.DRAFT_HIGH_MIN,
      note: "Data Petugas berasal dari export SERASI detail SLS. Persentase PPL dihitung dari SUM berhasil / SUM target, bukan rata-rata persen SLS.",
    },
    summary: buildPetugasSummary_(petugasRows),
    ranking: buildPetugasRanking_(petugasRows),
    pml: buildPmlAnalytics_(petugasRows),
    quality: buildQualityAnalytics_(petugasRows),
    risk: buildRiskAnalytics_(petugasRows),
    data: petugasRows,
  };
}

function aggregatePetugasFromSls_(slsRows) {
  const map = {};

  slsRows.forEach((row) => {
    const key =
      row.pplEmail || row.pplNama + "|" + row.pmlEmail + "|" + row.pmlNama;

    if (!map[key]) {
      map[key] = {
        no: 0,

        pplEmail: sanitizeSheetText_(row.pplEmail),
        pplNama: sanitizeSheetText_(row.pplNama),

        pmlEmail: sanitizeSheetText_(row.pmlEmail),
        pmlNama: sanitizeSheetText_(row.pmlNama),

        kecamatanSet: {},
        kodeKecamatanSet: {},
        kodeSlsList: [],

        totalSLS: 0,

        targetFasih: 0,
        berhasilDidata: 0,

        persenRealisasi: 0,
        persenRealisasiSourceAvg: 0,
        persenRealisasiSourceSum: 0,
        selisihPersenSourceAvg: 0,

        open: 0,
        draft: 0,

        persenMismatchCount: 0,

        datetime: "",
      };
    }

    map[key].totalSLS++;
    map[key].targetFasih += row.targetFasih;
    map[key].berhasilDidata += row.berhasilDidata;
    map[key].open += row.open;
    map[key].draft += row.draft;

    map[key].persenRealisasiSourceSum += Number(row.persenRealisasiSource || 0);

    if (row.persenValidasiStatus !== "OK") {
      map[key].persenMismatchCount++;
    }

    if (row.kecamatan) map[key].kecamatanSet[row.kecamatan] = true;
    if (row.kodeKecamatan) map[key].kodeKecamatanSet[row.kodeKecamatan] = true;
    if (row.kodeSls) map[key].kodeSlsList.push(row.kodeSls);

    if (row.datetime) map[key].datetime = row.datetime;
  });

  return Object.values(map).map((item, index) => {
    item.no = index + 1;

    // FINAL LOCK:
    // PPL dihitung dari SUM berhasil / SUM target.
    item.persenRealisasi = calculatePercent_(
      item.berhasilDidata,
      item.targetFasih,
    );

    // Audit saja, bukan sumber ranking/status.
    item.persenRealisasiSourceAvg = item.totalSLS
      ? round2_(item.persenRealisasiSourceSum / item.totalSLS)
      : 0;

    item.selisihPersenSourceAvg = round2_(
      item.persenRealisasi - item.persenRealisasiSourceAvg,
    );

    item.kecamatanList = Object.keys(item.kecamatanSet);
    item.kodeKecamatanList = Object.keys(item.kodeKecamatanSet);
    item.kecamatan = item.kecamatanList.join(", ");
    item.kodeKecamatan = item.kodeKecamatanList.join(", ");

    item.status = getPetugasStatus_(item.persenRealisasi);
    item.statusLabel = getPetugasStatusLabel_(item.status);

    item.riskScore = calculateOperationalRiskScore_(item);
    item.riskLabel = getRiskLabel_(item.riskScore);

    delete item.kecamatanSet;
    delete item.kodeKecamatanSet;
    delete item.persenRealisasiSourceSum;

    return item;
  });
}

/* =========================================================
   PETUGAS ANALYTICS
========================================================= */

function buildPetugasSummary_(data) {
  const totalTarget = sum_(data, "targetFasih");
  const totalBerhasil = sum_(data, "berhasilDidata");

  const pmlSet = new Set(
    data.map((d) => d.pmlEmail || d.pmlNama).filter(Boolean),
  );

  const avgPercent = data.length
    ? round2_(data.reduce((a, b) => a + b.persenRealisasi, 0) / data.length)
    : 0;

  const sortedPercent = data
    .map((d) => d.persenRealisasi)
    .sort((a, b) => a - b);

  return {
    totalPPL: data.length,
    totalPML: pmlSet.size,

    activePPL: data.filter((d) => d.berhasilDidata > 0).length,
    inactivePPL: data.filter((d) => d.berhasilDidata === 0).length,

    totalSLS: sum_(data, "totalSLS"),

    totalTarget: totalTarget,
    totalBerhasil: totalBerhasil,

    // FINAL LOCK:
    // Summary PPL/Kabupaten petugas dihitung dari total berhasil / total target.
    persenRealisasi: calculatePercent_(totalBerhasil, totalTarget),

    avgPercent: avgPercent,
    medianPercent: calculateMedian_(sortedPercent),

    totalOpen: sum_(data, "open"),
    totalDraft: sum_(data, "draft"),

    openRate: totalTarget
      ? round2_((sum_(data, "open") / totalTarget) * 100)
      : 0,
    draftRate: totalTarget
      ? round2_((sum_(data, "draft") / totalTarget) * 100)
      : 0,

    elite: data.filter((d) => d.status === "ELITE").length,
    onTrack: data.filter((d) => d.status === "ON_TRACK").length,
    perhatian: data.filter((d) => d.status === "PERHATIAN").length,
    kritis: data.filter((d) => d.status === "KRITIS").length,

    pplDenganDraft: data.filter((d) => d.draft > 0).length,
    pplOpenTinggi: data.filter(
      (d) =>
        d.targetFasih &&
        d.open / d.targetFasih >= APP_CONFIG.RISK.OPEN_HIGH_RATIO,
    ).length,

    auditPersen: {
      totalMismatchSls: sum_(data, "persenMismatchCount"),
      note: "Ranking/status memakai persenRealisasi hasil hitung. persenRealisasiSourceAvg hanya audit.",
    },
  };
}

function buildPetugasRanking_(data) {
  return {
    topRealisasi: [...data]
      .sort((a, b) => b.persenRealisasi - a.persenRealisasi)
      .slice(0, 15),
    bottomRealisasi: [...data]
      .sort((a, b) => a.persenRealisasi - b.persenRealisasi)
      .slice(0, 15),
    topBerhasil: [...data]
      .sort((a, b) => b.berhasilDidata - a.berhasilDidata)
      .slice(0, 15),
    topDraft: [...data].sort((a, b) => b.draft - a.draft).slice(0, 15),
    topOpen: [...data].sort((a, b) => b.open - a.open).slice(0, 15),
    highestRisk: [...data]
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 15),
    persenMismatch: [...data]
      .filter((d) => d.persenMismatchCount > 0)
      .sort((a, b) => b.persenMismatchCount - a.persenMismatchCount)
      .slice(0, 15),
  };
}

/* =========================================================
   PML ANALYTICS - TANPA APPROVED/REJECTED/BACKLOG
========================================================= */

function buildPmlAnalytics_(data) {
  const map = {};

  data.forEach((item) => {
    const key = item.pmlEmail || item.pmlNama || "UNKNOWN_PML";

    if (!map[key]) {
      map[key] = {
        pmlEmail: item.pmlEmail,
        pmlNama: item.pmlNama,

        kecamatanSet: {},
        kodeKecamatanSet: {},

        totalPPL: 0,
        activePPL: 0,
        totalSLS: 0,

        targetFasih: 0,
        berhasilDidata: 0,
        persenRealisasi: 0,

        open: 0,
        draft: 0,

        persenMismatchCount: 0,

        pplList: [],
      };
    }

    map[key].totalPPL++;
    if (item.berhasilDidata > 0) map[key].activePPL++;

    map[key].totalSLS += item.totalSLS;
    map[key].targetFasih += item.targetFasih;
    map[key].berhasilDidata += item.berhasilDidata;
    map[key].open += item.open;
    map[key].draft += item.draft;
    map[key].persenMismatchCount += item.persenMismatchCount || 0;

    if (item.kecamatan) {
      String(item.kecamatan)
        .split(",")
        .forEach((kec) => {
          const clean = cleanText_(kec);
          if (clean) map[key].kecamatanSet[clean] = true;
        });
    }

    if (item.kodeKecamatan) {
      String(item.kodeKecamatan)
        .split(",")
        .forEach((kode) => {
          const clean = cleanText_(kode);
          if (clean) map[key].kodeKecamatanSet[clean] = true;
        });
    }

    map[key].pplList.push({
      pplNama: sanitizeSheetText_(item.pplNama),
      pplEmail: sanitizeSheetText_(item.pplEmail),
      kecamatan: sanitizeSheetText_(item.kecamatan),
      persenRealisasi: item.persenRealisasi,
      status: item.status,
    });
  });

  const rows = Object.values(map).map((item) => {
    // FINAL LOCK:
    // PML dihitung dari SUM berhasil / SUM target.
    item.persenRealisasi = calculatePercent_(
      item.berhasilDidata,
      item.targetFasih,
    );

    item.avgPplRealisasi = item.totalPPL
      ? round2_(
          item.pplList.reduce((a, b) => a + b.persenRealisasi, 0) /
            item.totalPPL,
        )
      : 0;

    item.kecamatanList = Object.keys(item.kecamatanSet);
    item.kodeKecamatanList = Object.keys(item.kodeKecamatanSet);
    item.kecamatan = item.kecamatanList.join(", ");
    item.kodeKecamatan = item.kodeKecamatanList.join(", ");

    item.status = getPetugasStatus_(item.persenRealisasi);
    item.statusLabel = getPetugasStatusLabel_(item.status);

    item.riskScore = calculateOperationalRiskScore_(item);
    item.riskLabel = getRiskLabel_(item.riskScore);

    delete item.kecamatanSet;
    delete item.kodeKecamatanSet;

    return item;
  });

  return {
    summary: {
      totalPML: rows.length,
      avgRealisasi: rows.length
        ? round2_(rows.reduce((a, b) => a + b.persenRealisasi, 0) / rows.length)
        : 0,
      totalTarget: sum_(rows, "targetFasih"),
      totalBerhasil: sum_(rows, "berhasilDidata"),
      totalOpen: sum_(rows, "open"),
      totalDraft: sum_(rows, "draft"),
      totalSLS: sum_(rows, "totalSLS"),
      pmlKritis: rows.filter((r) => r.status === "KRITIS").length,
      pmlPerhatian: rows.filter((r) => r.status === "PERHATIAN").length,
      pmlOnTrack: rows.filter((r) => r.status === "ON_TRACK").length,
      pmlElite: rows.filter((r) => r.status === "ELITE").length,
      totalPersenMismatchSls: sum_(rows, "persenMismatchCount"),
    },

    data: rows,

    topRealisasi: [...rows]
      .sort((a, b) => b.persenRealisasi - a.persenRealisasi)
      .slice(0, 10),
    bottomRealisasi: [...rows]
      .sort((a, b) => a.persenRealisasi - b.persenRealisasi)
      .slice(0, 10),
    topBerhasil: [...rows]
      .sort((a, b) => b.berhasilDidata - a.berhasilDidata)
      .slice(0, 10),
    topOpen: [...rows].sort((a, b) => b.open - a.open).slice(0, 10),
    topDraft: [...rows].sort((a, b) => b.draft - a.draft).slice(0, 10),
    highestRisk: [...rows]
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10),
    persenMismatch: [...rows]
      .filter((r) => r.persenMismatchCount > 0)
      .sort((a, b) => b.persenMismatchCount - a.persenMismatchCount)
      .slice(0, 10),
  };
}

/* =========================================================
   QUALITY & RISK - SESUAI EXPORT PETUGAS
========================================================= */

function buildQualityAnalytics_(data) {
  const totalTarget = sum_(data, "targetFasih");

  return {
    summary: {
      totalDraft: sum_(data, "draft"),
      totalOpen: sum_(data, "open"),
      draftRate: totalTarget
        ? round2_((sum_(data, "draft") / totalTarget) * 100)
        : 0,
      openRate: totalTarget
        ? round2_((sum_(data, "open") / totalTarget) * 100)
        : 0,
      totalPersenMismatchSls: sum_(data, "persenMismatchCount"),
      note: "Export Petugas/SLS tidak memiliki kolom submitted, approved, rejected, revoked, edited. Quality di sini fokus pada open, draft, dan audit persentase.",
    },

    draftList: [...data]
      .filter((d) => d.draft > 0)
      .sort((a, b) => b.draft - a.draft)
      .slice(0, 20),
    openList: [...data].sort((a, b) => b.open - a.open).slice(0, 20),
    persenMismatchList: [...data]
      .filter((d) => d.persenMismatchCount > 0)
      .sort((a, b) => b.persenMismatchCount - a.persenMismatchCount)
      .slice(0, 20),
  };
}

function buildRiskAnalytics_(data) {
  const highRisk = data.filter((d) => d.riskScore >= 70);
  const mediumRisk = data.filter((d) => d.riskScore >= 40 && d.riskScore < 70);
  const lowRisk = data.filter((d) => d.riskScore < 40);

  return {
    summary: {
      highRisk: highRisk.length,
      mediumRisk: mediumRisk.length,
      lowRisk: lowRisk.length,

      criticalPpl: data.filter((d) => d.status === "KRITIS").length,
      zeroProgress: data.filter((d) => d.berhasilDidata === 0).length,
      highOpen: data.filter(
        (d) =>
          d.targetFasih &&
          d.open / d.targetFasih >= APP_CONFIG.RISK.OPEN_HIGH_RATIO,
      ).length,
      highDraft: data.filter(isDraftHigh_).length,
    },

    data: [...data].sort((a, b) => b.riskScore - a.riskScore),
    highRiskList: [...data]
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 20),
    zeroProgressList: data.filter((d) => d.berhasilDidata === 0).slice(0, 20),
    criticalList: data
      .filter((d) => d.status === "KRITIS")
      .sort((a, b) => a.persenRealisasi - b.persenRealisasi)
      .slice(0, 20),
  };
}

/* =========================================================
   EXECUTIVE SUMMARY
========================================================= */

function buildExecutiveSummary_(kecamatan, petugas) {
  const k = kecamatan && kecamatan.summary ? kecamatan.summary : {};
  const p = petugas && petugas.summary ? petugas.summary : {};

  return {
    wilayah: "Kabupaten Bireuen",
    generatedAt: nowText_(),

    sourceStatus: {
      kecamatan: kecamatan.success ? "OK" : "ERROR",
      petugas: petugas.success ? "OK" : "ERROR",
      petugasSource: petugas.source || "UNKNOWN",
    },

    core: {
      totalKecamatan: k.totalKecamatan || 0,
      totalPPLSpreadsheet: k.totalPPL || 0,
      totalPPLFromPetugas: p.totalPPL || 0,
      totalPMLFromPetugas: p.totalPML || 0,
      totalSLSFromPetugas: p.totalSLS || 0,

      totalPrelistKecamatan: k.totalPrelist || 0,
      totalSubmitKecamatan: k.totalSubmit || 0,
      percentSubmitKecamatan: k.percentSubmit || 0,

      totalTargetPetugas: p.totalTarget || 0,
      totalBerhasilPetugas: p.totalBerhasil || 0,
      percentRealisasiPetugas: p.persenRealisasi || 0,
    },

    operational: {
      targetHarian: k.targetHarian || 0,
      kecamatanAboveTarget: k.aboveTarget || 0,
      kecamatanBelowTarget: k.belowTarget || 0,

      petugasElite: p.elite || 0,
      petugasOnTrack: p.onTrack || 0,
      petugasPerhatian: p.perhatian || 0,
      petugasKritis: p.kritis || 0,

      totalOpen: p.totalOpen || 0,
      totalDraft: p.totalDraft || 0,
    },

    audit: {
      persenMismatchSls: p.auditPersen ? p.auditPersen.totalMismatchSls : 0,
      note: "Semua persentase utama dashboard dihitung dari total berhasil / total target.",
    },
  };
}

/* =========================================================
   STATUS & RISK
========================================================= */

function getPetugasStatus_(percent) {
  if (percent >= APP_CONFIG.TARGETS.PETUGAS.ELITE) return "ELITE";
  if (percent >= APP_CONFIG.TARGETS.PETUGAS.ON_TRACK) return "ON_TRACK";
  if (percent >= APP_CONFIG.TARGETS.PETUGAS.PERHATIAN) return "PERHATIAN";
  return "KRITIS";
}

function getPetugasStatusLabel_(status) {
  const labels = {
    ELITE: "Elite",
    ON_TRACK: "On Track",
    PERHATIAN: "Perhatian",
    KRITIS: "Kritis",
  };

  return labels[status] || status;
}

function calculateOperationalRiskScore_(item) {
  const target = item.targetFasih || 1;

  const openScore = Math.min((item.open / target) * 60, 60);
  const draftScore = Math.min((item.draft / target) * 25, 25);
  const progressPenalty =
    item.persenRealisasi < 10 ? 15 : item.persenRealisasi < 20 ? 8 : 0;

  return round2_(openScore + draftScore + progressPenalty);
}

function isDraftHigh_(item) {
  const draft = Number(item && item.draft ? item.draft : 0);
  const target = Number(item && item.targetFasih ? item.targetFasih : 0);

  if (draft >= APP_CONFIG.RISK.DRAFT_HIGH_MIN) return true;
  return !!target && draft / target >= APP_CONFIG.RISK.DRAFT_HIGH_RATIO;
}

function getRiskLabel_(score) {
  if (score >= 70) return "TINGGI";
  if (score >= 40) return "SEDANG";
  return "RENDAH";
}

/* =========================================================
   HEALTH CHECK
========================================================= */

function healthCheck_() {
  const result = {
    success: true,
    app: APP_CONFIG.APP_NAME,
    version: APP_CONFIG.VERSION,
    checkedAt: nowText_(),
    checks: {},
  };

  try {
    const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);

    result.checks.spreadsheet = {
      ok: true,
      name: ss.getName(),
    };

    result.checks.sheetProgres = {
      ok: !!ss.getSheetByName(APP_CONFIG.SHEETS.PROGRES),
      name: APP_CONFIG.SHEETS.PROGRES,
    };

    result.checks.sheetPetugas = {
      ok: !!ss.getSheetByName(APP_CONFIG.SHEETS.PETUGAS),
      name: APP_CONFIG.SHEETS.PETUGAS,
    };

    const progres = getKecamatanDashboardData_();
    result.checks.targetHarian = {
      ok: true,
      sourceCell: APP_CONFIG.PROGRES_RANGE.TARGET_CELL,
      value: progres.summary.targetHarian,
    };

    const sls = getSlsDashboardData_();
    result.checks.sls = {
      ok: sls.success,
      totalRows: sls.data ? sls.data.length : 0,
      persenFormula: "berhasilDidata / targetFasih * 100",
      totalMismatch:
        sls.summary && sls.summary.auditPersen
          ? sls.summary.auditPersen.totalMismatch
          : 0,
    };
  } catch (error) {
    result.success = false;
    result.checks.error = {
      ok: false,
      error: String(error.message || error),
    };
  }

  return result;
}

/* =========================================================
   SECURITY & ERROR HANDLING
========================================================= */

function enforceApiAccess_(api) {
  const normalizedApi = String(api || "").toLowerCase();
  const sensitiveApis = APP_CONFIG.SECURITY.SENSITIVE_APIS || [];

  if (sensitiveApis.indexOf(normalizedApi) === -1) {
    return;
  }

  if (!hasConfiguredAccessGate_()) {
    return;
  }

  const email = getActiveUserEmail_();

  if (!email || !isAuthorizedEmail_(email)) {
    throw userFacingError_(
      "Akses ditolak. Endpoint ini hanya untuk pengguna yang berwenang.",
    );
  }
}

function runPublicApi_(context, callback) {
  try {
    return callback();
  } catch (error) {
    logError_(context, error);

    return {
      success: false,
      app: APP_CONFIG.APP_NAME,
      version: APP_CONFIG.VERSION,
      error: isUserFacingError_(error)
        ? String(error.message)
        : "Terjadi kesalahan pada server. Silakan hubungi administrator.",
    };
  }
}

function hasConfiguredAccessGate_() {
  const security = APP_CONFIG.SECURITY || {};
  return (
    (security.ALLOWED_EMAILS && security.ALLOWED_EMAILS.length > 0) ||
    (security.ALLOWED_DOMAINS && security.ALLOWED_DOMAINS.length > 0)
  );
}

function getActiveUserEmail_() {
  try {
    return cleanText_(Session.getActiveUser().getEmail()).toLowerCase();
  } catch (error) {
    logError_("getActiveUserEmail_", error);
    return "";
  }
}

function isAuthorizedEmail_(email) {
  const security = APP_CONFIG.SECURITY || {};
  const normalizedEmail = cleanText_(email).toLowerCase();
  const allowedEmails = (security.ALLOWED_EMAILS || []).map((item) =>
    cleanText_(item).toLowerCase(),
  );
  const allowedDomains = (security.ALLOWED_DOMAINS || []).map((item) =>
    cleanText_(item).replace(/^@/, "").toLowerCase(),
  );
  const domain = normalizedEmail.split("@")[1] || "";

  return (
    allowedEmails.indexOf(normalizedEmail) !== -1 ||
    allowedDomains.indexOf(domain) !== -1
  );
}

function userFacingError_(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}

function isUserFacingError_(error) {
  return !!(error && error.userFacing);
}

function logError_(context, error) {
  const message = String(error && error.message ? error.message : error);
  const stack = String(error && error.stack ? error.stack : "");
  const logText = "[" + context + "] " + message + (stack ? "\n" + stack : "");

  try {
    console.error(logText);
  } catch (consoleError) {}

  try {
    Logger.log(logText);
  } catch (loggerError) {}
}

/* =========================================================
   UTILITIES
========================================================= */

function nowText_() {
  return (
    Utilities.formatDate(
      new Date(),
      APP_CONFIG.TIMEZONE,
      "dd MMMM yyyy HH:mm:ss",
    ) + " WIB"
  );
}

function cleanText_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSheetText_(value) {
  return cleanText_(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toNumber_(value) {
  if (value === null || value === undefined || value === "") return 0;

  const text = String(value)
    .replace(/\u00A0/g, " ")
    .replace("%", "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const number = Number(text);

  return isNaN(number) ? 0 : number;
}

function calculatePercent_(numerator, denominator) {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);

  if (!d) return 0;

  return round2_((n / d) * 100);
}

function getPersenValidationStatus_(
  persenHitung,
  persenSource,
  targetFasih,
  berhasilDidata,
) {
  const hitung = Number(persenHitung || 0);
  const source = Number(persenSource || 0);
  const target = Number(targetFasih || 0);
  const berhasil = Number(berhasilDidata || 0);

  if (!target && !berhasil && !source) {
    return "OK";
  }

  const diff = Math.abs(round2_(hitung - source));

  if (diff <= APP_CONFIG.VALIDATION.PERCENT_TOLERANCE) {
    return "OK";
  }

  if (source === 0 && hitung !== 0) {
    return "SOURCE_KOSONG_ATAU_BEDA";
  }

  return "BEDA";
}

function round2_(number) {
  return Math.round((Number(number) || 0) * 100) / 100;
}

function sum_(data, key) {
  return data.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function calculateMedian_(sortedNumbers) {
  if (!sortedNumbers.length) return 0;

  const mid = Math.floor(sortedNumbers.length / 2);

  if (sortedNumbers.length % 2 === 0) {
    return round2_((sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2);
  }

  return round2_(sortedNumbers[mid]);
}

function normalizeHeader_(value) {
  return cleanText_(value)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[^A-Z0-9 %]/g, "")
    .trim();
}

function findHeaderIndex_(headers, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const target = normalizeHeader_(candidates[i]);

    const exact = headers.indexOf(target);
    if (exact !== -1) return exact;

    const contains = headers.findIndex(
      (h) => h.indexOf(target) !== -1 || target.indexOf(h) !== -1,
    );
    if (contains !== -1) return contains;
  }

  return -1;
}

function getCell_(row, index) {
  if (index === -1 || index === undefined || index === null) return "";
  return row[index] !== undefined ? row[index] : "";
}

function splitIdentity_(text) {
  const value = cleanText_(text);
  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  const email = emailMatch ? sanitizeSheetText_(emailMatch[0]) : "";

  let name = value
    .replace(emailMatch ? emailMatch[0] : "", "")
    .replace(/\s+/g, " ")
    .trim();

  if (!name) name = "-";

  return {
    email: email,
    name: sanitizeSheetText_(name),
  };
}

function extractKodeKecamatan_(kodeSls) {
  const text = cleanText_(kodeSls).replace(/\D/g, "");

  if (text.length >= 7) {
    return text.substring(0, 7);
  }

  return "";
}

/* =========================================================
   MANUAL TEST
========================================================= */

function testHealth() {
  Logger.log(JSON.stringify(healthCheck_(), null, 2));
}

function testKecamatan() {
  Logger.log(JSON.stringify(getDashboardData(), null, 2));
}

function testSls() {
  Logger.log(JSON.stringify(getSlsDashboardData(), null, 2));
}

function testPetugas() {
  Logger.log(JSON.stringify(getPetugasDashboardData(), null, 2));
}

function testAll() {
  Logger.log(JSON.stringify(getSuperDashboardData(), null, 2));
}
