import { appendFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "data", "a2c-travel-sample.json");
const LEADS_PATH = join(__dirname, "data", "leads.jsonl");
const PORT = Number(process.env.AI_TRAVEL_PORT || 8787);

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization"
};

let cachedKnowledge = null;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length >= 3);
}

function flattenRecord(record) {
  return Object.entries(record)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
      if (value && typeof value === "object") return `${key}: ${JSON.stringify(value)}`;
      return `${key}: ${value ?? ""}`;
    })
    .join("\n");
}

async function loadKnowledge() {
  if (cachedKnowledge) return cachedKnowledge;

  const raw = await readFile(DATA_PATH, "utf8");
  cachedKnowledge = JSON.parse(raw);
  return cachedKnowledge;
}

function collectSearchableRecords(knowledge) {
  return [
    ...(knowledge.destinations || []).map((item) => ({ type: "destination", item })),
    ...(knowledge.tours || []).map((item) => ({ type: "tour", item })),
    ...(knowledge.stays || []).map((item) => ({ type: "stay", item })),
    ...(knowledge.food || []).map((item) => ({ type: "food", item })),
    ...(knowledge.policies || []).map((item) => ({ type: "policy", item }))
  ];
}

function scoreRecord(questionTokens, record) {
  const haystack = normalizeText(flattenRecord(record.item));
  let score = 0;

  for (const token of questionTokens) {
    if (haystack.includes(token)) score += 2;
  }

  if (record.type === "tour" && questionTokens.some((token) => ["tour", "lich", "ngay"].includes(token))) {
    score += 2;
  }

  if (record.type === "stay" && questionTokens.some((token) => ["khach", "san", "hotel", "homestay", "phong"].includes(token))) {
    score += 2;
  }

  if (record.type === "food" && questionTokens.some((token) => ["an", "mon", "food", "nha", "hang"].includes(token))) {
    score += 2;
  }

  return score;
}

function findRelevantContext(question, knowledge) {
  const questionTokens = tokenize(question);
  const records = collectSearchableRecords(knowledge);

  const scored = records
    .map((record) => ({ ...record, score: scoreRecord(questionTokens, record) }))
    .filter((record) => record.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const selected = scored.length > 0 ? scored : records.slice(0, 5);

  return selected
    .map((record) => `Loai: ${record.type}\n${flattenRecord(record.item)}`)
    .join("\n\n---\n\n");
}

function getBrand(knowledge) {
  return {
    ...knowledge.brand,
    hotline: process.env.A2C_HOTLINE || knowledge.brand?.hotline,
    zaloUrl: process.env.A2C_ZALO_URL || knowledge.brand?.zaloUrl
  };
}

function systemPrompt(knowledge) {
  const brand = getBrand(knowledge);

  return [
    `Ban la tro ly du lich cua ${brand.name || "A2C Travel"}.`,
    "Nhiem vu: tu van tour, luu tru, am thuc, diem den va tao goi y lich trinh ngan gon.",
    "Chi duoc dua thong tin gia, lich khoi hanh, phong trong, chinh sach khi du lieu duoc cung cap trong CONTEXT.",
    "Neu thieu du lieu, noi ro chua co thong tin xac nhan va moi khach de lai so dien thoai/Zalo de nhan vien tu van.",
    "Luon uu tien goi y hanh dong tiep theo: xem link dich vu, de lai Zalo, goi hotline hoac cho biet so ngay/so khach/ngan sach.",
    "Tra loi cung ngon ngu voi cau hoi cua khach. Gioi han 180 tu neu khach khong yeu cau chi tiet.",
    `Hotline: ${brand.hotline || "chua cau hinh"}. Zalo: ${brand.zaloUrl || "chua cau hinh"}.`
  ].join("\n");
}

function fallbackReply(question, knowledge, context) {
  const brand = getBrand(knowledge);
  const normalizedQuestion = normalizeText(question);
  const wantsFood = ["an", "mon", "am thuc", "food"].some((token) => normalizedQuestion.includes(token));
  const wantsStay = ["khach san", "hotel", "homestay", "luu tru", "phong"].some((token) => normalizedQuestion.includes(token));
  const wantsTour = ["tour", "lich trinh", "ngay", "di dau"].some((token) => normalizedQuestion.includes(token));

  if (wantsFood) {
    return [
      "A2C goi y ban thu cac dac san Quang Ngai nhu don, ram bap, ca bong song Tra, hai san My Khe, toi Ly Son va keo guong.",
      "Ban muon minh goi y theo khu vuc TP Quang Ngai, My Khe, Sa Huynh hay Ly Son?",
      `Neu can dat ban/tu van nhanh, lien he Zalo: ${brand.zaloUrl || brand.hotline || "chua cau hinh"}.`
    ].join("\n\n");
  }

  if (wantsStay) {
    return [
      "A2C co the goi y luu tru gan bien My Khe hoac Ly Son tuy lich trinh cua ban.",
      "Hien du lieu gia/phong trong chua duoc xac nhan trong ban test, nen AI se khong tu bao gia.",
      `Ban hay de lai ngay di, so khach va Zalo; nhan vien A2C se kiem tra giup. Hotline: ${brand.hotline || "chua cau hinh"}.`
    ].join("\n\n");
  }

  if (wantsTour || normalizedQuestion.includes("quang ngai") || normalizedQuestion.includes("ly son")) {
    return [
      "Neu ban di Quang Ngai 2 ngay 1 dem, goi y phu hop nhat la Ly Son: cong To Vo, hang Cau, dinh Thoi Loi, chua Hang va dao Be.",
      "Neu muon tiet kiem hoac di trong ngay, co the chon bien My Khe - Sa Huynh - dam An Khe.",
      "Ban di may nguoi, ngay nao va ngan sach du kien bao nhieu de A2C goi y sat hon?"
    ].join("\n\n");
  }

  return [
    "Mình co the tu van tour, luu tru, am thuc va lich trinh du lich cho A2C Travel.",
    "Ban cho minh biet tinh/thanh muon di, so ngay, so khach va ngan sach du kien nhe.",
    "Du lieu dang dung cho ban test:\n" + context.split("\n").slice(0, 8).join("\n")
  ].join("\n\n");
}

async function callOpenAI({ question, context, knowledge }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      provider: "fallback",
      answer: fallbackReply(question, knowledge, context)
    };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt(knowledge) },
        { role: "user", content: `CONTEXT A2C TRAVEL:\n${context}\n\nCAU HOI KHACH:\n${question}` }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  return {
    provider: "openai",
    model,
    answer: payload.choices?.[0]?.message?.content?.trim() || "AI chua tao duoc cau tra loi."
  };
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  return JSON.parse(raw);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "access-control-allow-origin": "*"
  });
  response.end(body);
}

function widgetScript() {
  return `
(function () {
  const endpoint = document.currentScript?.dataset.endpoint || "/api/ai-travel-chat";
  const brand = document.currentScript?.dataset.brand || "A2C AI";

  const root = document.createElement("div");
  root.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:99999;font-family:Arial,sans-serif";
  root.innerHTML = \`
    <button data-open style="border:0;border-radius:999px;background:#087f5b;color:#fff;padding:12px 16px;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer">Chat voi \${brand}</button>
    <div data-panel style="display:none;width:330px;max-width:calc(100vw - 36px);height:460px;background:#fff;border:1px solid #ddd;border-radius:16px;box-shadow:0 16px 45px rgba(0,0,0,.22);overflow:hidden">
      <div style="background:#087f5b;color:#fff;padding:12px 14px;font-weight:700">Tu van du lich A2C</div>
      <div data-log style="height:328px;overflow:auto;padding:12px;background:#f8f9fa;font-size:14px;line-height:1.45"></div>
      <form data-form style="display:flex;gap:8px;padding:10px;border-top:1px solid #eee">
        <input data-input placeholder="Hoi ve tour, luu tru, an uong..." style="flex:1;border:1px solid #ddd;border-radius:10px;padding:10px" />
        <button style="border:0;border-radius:10px;background:#087f5b;color:#fff;padding:0 12px">Gui</button>
      </form>
    </div>
  \`;

  document.body.appendChild(root);

  const openButton = root.querySelector("[data-open]");
  const panel = root.querySelector("[data-panel]");
  const form = root.querySelector("[data-form]");
  const input = root.querySelector("[data-input]");
  const log = root.querySelector("[data-log]");

  function addMessage(label, text) {
    const item = document.createElement("div");
    item.style.cssText = "margin:0 0 10px";
    item.innerHTML = "<strong>" + label + ":</strong><br>" + String(text).replace(/\\n/g, "<br>");
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  }

  openButton.addEventListener("click", function () {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    if (!log.dataset.started) {
      addMessage("AI", "Xin chao! Ban muon di tinh nao, may ngay va may nguoi?");
      log.dataset.started = "1";
    }
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    input.value = "";
    addMessage("Ban", message);
    addMessage("AI", "Dang kiem tra du lieu A2C...");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message })
      });
      const payload = await response.json();
      log.lastChild.remove();
      addMessage("AI", payload.answer || "Chua co cau tra loi.");
    } catch (error) {
      log.lastChild.remove();
      addMessage("AI", "Xin loi, hien chua ket noi duoc AI. Vui long thu lai hoac nhan Zalo A2C.");
    }
  });
})();`;
}

function demoPage() {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>A2C Travel AI Assistant Demo</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f4f7f5; color: #1f2933; }
    main { max-width: 860px; margin: 0 auto; padding: 48px 20px; }
    .hero { background: #fff; border-radius: 24px; padding: 32px; box-shadow: 0 18px 60px rgba(0,0,0,.08); }
    h1 { margin-top: 0; color: #087f5b; }
    code { background: #edf2f7; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>A2C Travel AI Assistant - Ban test</h1>
      <p>Mo nut chat goc phai de thu hoi: <code>Toi di Quang Ngai 2 ngay nen di dau?</code></p>
      <p>Neu chua cau hinh <code>OPENAI_API_KEY</code>, server se dung cau tra loi fallback dua tren du lieu mau.</p>
    </section>
  </main>
  <script src="/widget.js" data-endpoint="/api/ai-travel-chat" data-brand="A2C"></script>
</body>
</html>`;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, JSON_HEADERS);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    sendText(response, 200, demoPage(), "text/html; charset=utf-8");
    return;
  }

  if (request.method === "GET" && url.pathname === "/widget.js") {
    sendText(response, 200, widgetScript(), "application/javascript; charset=utf-8");
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "a2c-ai-travel-assistant" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ai-travel-chat") {
    try {
      const body = await readJsonBody(request);
      const question = String(body.message || body.question || "").trim();

      if (!question) {
        sendJson(response, 400, { error: "Missing message" });
        return;
      }

      const knowledge = await loadKnowledge();
      const context = findRelevantContext(question, knowledge);
      const result = await callOpenAI({ question, context, knowledge });

      sendJson(response, 200, {
        answer: result.answer,
        provider: result.provider,
        model: result.model,
        usedContext: context
      });
    } catch (error) {
      sendJson(response, 500, {
        error: "AI_TRAVEL_CHAT_FAILED",
        message: error.message
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ai-travel-lead") {
    try {
      const body = await readJsonBody(request);
      const lead = {
        createdAt: new Date().toISOString(),
        name: body.name || "",
        phone: body.phone || "",
        zalo: body.zalo || "",
        travelDate: body.travelDate || "",
        guests: body.guests || "",
        need: body.need || "",
        note: body.note || ""
      };

      await appendFile(LEADS_PATH, `${JSON.stringify(lead)}\n`, "utf8");
      sendJson(response, 200, { ok: true, lead });
    } catch (error) {
      sendJson(response, 500, {
        error: "AI_TRAVEL_LEAD_FAILED",
        message: error.message
      });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      error: "UNHANDLED_ERROR",
      message: error.message
    });
  });
}).listen(PORT, () => {
  console.log(`A2C Travel AI assistant demo is running at http://localhost:${PORT}`);
});
