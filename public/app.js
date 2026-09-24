const customerMessageEl = document.getElementById("customerMessage");
const draftReplyEl = document.getElementById("draftReply");
const connectionStatusEl = document.getElementById("connection-status");

const gauges = {
  tone: document.getElementById("gauge-tone"),
  makes_commitment: document.getElementById("gauge-commitment"),
  needs_review: document.getElementById("gauge-review"),
  predicted_satisfaction: document.getElementById("gauge-satisfaction"),
};

const latencyTotalEl = document.getElementById("latency-total");
const latencyModelEl = document.getElementById("latency-model");

const DEBOUNCE_MS = 450;
const SLOW_ROUND_TRIP_MS = 600;

let socket;
let debounceTimer = null;
let requestCounter = 0;
let latestRequestId = null;
const sentAt = new Map();

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener("open", () => {
    connectionStatusEl.textContent = "Connected";
  });

  socket.addEventListener("close", () => {
    connectionStatusEl.textContent = "Disconnected, retrying";
    setTimeout(connect, 1000);
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);

    // A newer request has already been sent since this one went out.
    // Drop it so a slow answer to an old draft can't overwrite a fresh one.
    if (data.requestId !== latestRequestId) return;

    const startedAt = sentAt.get(data.requestId);
    const roundTripMs = startedAt ? Date.now() - startedAt : null;
    sentAt.delete(data.requestId);

    if (data.error) {
      connectionStatusEl.textContent = data.error;
      return;
    }

    renderAnswers(data.answers);
    renderLatency(roundTripMs, data.modelLatencyMs, data.cached);
  });
}

function scheduleEvaluation() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sendForEvaluation, DEBOUNCE_MS);
}

function sendForEvaluation() {
  const draftReply = draftReplyEl.value.trim();
  if (!draftReply || !socket || socket.readyState !== WebSocket.OPEN) return;

  const requestId = ++requestCounter;
  latestRequestId = requestId;
  sentAt.set(requestId, Date.now());

  socket.send(
    JSON.stringify({
      requestId,
      customerMessage: customerMessageEl.value,
      draftReply,
    })
  );
}

function renderAnswers(answers) {
  setGauge(gauges.tone, formatTone(answers.tone));
  setGauge(
    gauges.makes_commitment,
    formatNoul(answers.makes_commitment.noul, "Flagged", "Clear")
  );
  setGauge(
    gauges.needs_review,
    formatNoul(answers.needs_review.noul, "Send to manager", "Not needed")
  );
  setGauge(gauges.predicted_satisfaction, formatScore(answers.predicted_satisfaction));
}

function setGauge(el, { text, state }) {
  el.dataset.state = state;
  el.querySelector(".gauge-value").textContent = text;

  el.classList.remove("pulse");
  // Force reflow so the animation can restart on repeated identical states.
  void el.offsetWidth;
  el.classList.add("pulse");
}

function formatTone(toneAnswer) {
  const stateMap = {
    empathetic: "good",
    neutral: "idle",
    curt: "warn",
    defensive: "risk",
  };
  return {
    text: `${capitalize(toneAnswer.choice)} (${Math.round(
      toneAnswer.probabilities[toneAnswer.choice] * 100
    )}%)`,
    state: stateMap[toneAnswer.choice] || "idle",
  };
}

function formatNoul(value, whenTrue, whenFalse) {
  const isTrue = value >= 0.5;
  return {
    text: `${isTrue ? whenTrue : whenFalse} (${Math.round(value * 100)}%)`,
    state: isTrue ? "risk" : "good",
  };
}

function formatScore({ score, legend }) {
  const nearest = Math.round(score);
  const label = legend[nearest] ?? legend[String(nearest)] ?? "";
  const stateByLevel = { 1: "risk", 2: "warn", 3: "good" };
  return {
    text: label,
    state: stateByLevel[nearest] || "idle",
  };
}

function renderLatency(roundTripMs, modelLatencyMs, cached) {
  latencyTotalEl.textContent = roundTripMs !== null ? `${roundTripMs} ms` : "-";
  latencyTotalEl.classList.toggle(
    "slow",
    roundTripMs !== null && roundTripMs > SLOW_ROUND_TRIP_MS
  );
  latencyModelEl.textContent = cached ? "cached" : `${modelLatencyMs} ms`;
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

draftReplyEl.addEventListener("input", scheduleEvaluation);
connect();
