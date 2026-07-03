const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "cohere/north-mini-code:free";
const MAX_MODEL_ATTEMPTS = 4;
const SITE_URL = "https://bps.rahmatyoung10.workers.dev";
const SITE_NAME = "Dashboard Monitoring BPS Bireuen";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({
        success: true,
        service: "BPS Bireuen AI Worker",
        endpoints: {
          health: "GET /health",
          chat: "POST /chat",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        success: true,
        openrouterKeyConfigured: Boolean(env.OPENROUTER_API_KEY),
      });
    }

    if (request.method !== "POST" || url.pathname !== "/chat") {
      return jsonResponse(
        {
          success: false,
          error: "Endpoint tidak tersedia.",
        },
        404,
      );
    }

    if (!env.OPENROUTER_API_KEY) {
      return jsonResponse(
        {
          success: false,
          error: "Secret OPENROUTER_API_KEY belum disetel di Cloudflare Worker.",
        },
        500,
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse(
        {
          success: false,
          error: "Body request harus JSON.",
        },
        400,
      );
    }

    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || !messages.length) {
      return jsonResponse(
        {
          success: false,
          error: "Field messages wajib diisi.",
        },
        400,
      );
    }

    const modelChain = normalizeModelChain(body.model_chain, body.model);
    const baseOpenrouterPayload = {
      messages,
      temperature: Number.isFinite(Number(body.temperature))
        ? Number(body.temperature)
        : 0.2,
      max_tokens: Number.isFinite(Number(body.max_tokens))
        ? Number(body.max_tokens)
        : 2200,
    };

    const attempts = [];
    let finalResult = null;

    for (const model of modelChain) {
      const openrouterPayload = {
        ...baseOpenrouterPayload,
        model,
      };

      let upstream;
      let text = "";

      try {
        upstream = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "HTTP-Referer": SITE_URL,
            "X-OpenRouter-Title": SITE_NAME,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(openrouterPayload),
        });
        text = await upstream.text();
      } catch (error) {
        attempts.push({
          model,
          success: false,
          retryable: true,
          error: "Worker gagal menghubungi OpenRouter.",
          detail: safeError(error && error.message ? error.message : error),
        });
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        attempts.push({
          model,
          success: false,
          retryable: true,
          status: upstream.status,
          error: "OpenRouter mengembalikan response yang tidak valid.",
        });
        continue;
      }

      if (!upstream.ok) {
        const retryable = isRetryableStatus(upstream.status);
        attempts.push({
          model,
          success: false,
          retryable,
          status: upstream.status,
          error: openrouterErrorMessage(upstream.status, payload),
        });

        if (retryable) continue;

        return jsonResponse(
          {
            success: false,
            error: openrouterErrorMessage(upstream.status, payload),
            status: upstream.status,
            model,
            attempts,
          },
          upstream.status,
        );
      }

      const answer =
        payload &&
        payload.choices &&
        payload.choices[0] &&
        payload.choices[0].message
          ? String(payload.choices[0].message.content || "").trim()
          : "";

      if (!answer) {
        attempts.push({
          model,
          success: false,
          retryable: true,
          error: "Model mengembalikan jawaban kosong.",
          finish_reason:
            payload && payload.choices && payload.choices[0]
              ? payload.choices[0].finish_reason || ""
              : "",
        });
        continue;
      }

      finalResult = {
        payload,
        answer,
        model: payload.model || openrouterPayload.model,
      };
      attempts.push({
        model,
        success: true,
        resolvedModel: finalResult.model,
      });
      break;
    }

    if (!finalResult) {
      return jsonResponse(
        {
          success: false,
          error: "Semua model AI gagal memproses permintaan.",
          attempts,
        },
        502,
      );
    }

    const payload = finalResult.payload;

    return jsonResponse({
      success: true,
      model: finalResult.model,
      model_chain: modelChain,
      attempts,
      answer: finalResult.answer,
      finish_reason:
        payload &&
        payload.choices &&
        payload.choices[0]
          ? payload.choices[0].finish_reason || ""
          : "",
      usage: payload.usage || undefined,
      raw: body.include_raw ? payload : undefined,
    });
  },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function normalizeModelChain(modelChain, singleModel) {
  const candidates = Array.isArray(modelChain)
    ? modelChain
    : String(singleModel || DEFAULT_MODEL).split(",");
  const normalized = [];

  for (const item of candidates) {
    const model = String(item || "").trim();
    if (model && !normalized.includes(model)) normalized.push(model);
    if (normalized.length >= MAX_MODEL_ATTEMPTS) break;
  }

  return normalized.length ? normalized : [DEFAULT_MODEL];
}

function isRetryableStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function openrouterErrorMessage(status, payload) {
  const providerMessage = safeError(
    payload && payload.error && payload.error.message
      ? payload.error.message
      : "",
  );

  if (status === 401 || status === 403) {
    return (
      "OpenRouter menolak API key atau akses model." +
      (providerMessage ? ` ${providerMessage}` : "")
    );
  }

  if (status === 402) {
    return "Saldo atau limit OpenRouter tidak mencukupi.";
  }

  if (status === 404) {
    return (
      "Model OpenRouter tidak ditemukan." +
      (providerMessage ? ` ${providerMessage}` : "")
    );
  }

  if (status === 429) {
    return "OpenRouter sedang rate limit. Coba lagi beberapa saat.";
  }

  return (
    `OpenRouter gagal memproses permintaan. Status ${status}.` +
    (providerMessage ? ` ${providerMessage}` : "")
  );
}

function safeError(value) {
  return String(value || "")
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[API_KEY]")
    .slice(0, 240);
}
