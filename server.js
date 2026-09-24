import "dotenv/config";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { evaluateDraft } from "./lib/typesafe.js";

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  // Per-connection cache. Two states matter here, not one: a settled
  // result for text we've already fully evaluated, and an in-flight call
  // for text we're still waiting on. Without the second one, two requests
  // for identical text sent close together (a pause, then a keystroke
  // that retriggers the debounce before the first answer comes back)
  // would both miss the cache and both fire a real, redundant call to Jev.
  let lastDraft = null;
  let lastResult = null;
  let pendingDraft = null;
  let pendingPromise = null;

  socket.on("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const { requestId, customerMessage, draftReply } = payload;
    if (typeof draftReply !== "string" || draftReply.trim() === "") return;

    console.log(`[req ${requestId}] text: "${draftReply}"`);

    // A settled result already exists for this exact text: serve it directly.
    if (draftReply === lastDraft && lastResult) {
      console.log(`[req ${requestId}] cache HIT`);
      socket.send(JSON.stringify({ requestId, ...lastResult, cached: true }));
      return;
    }

    // A call for this exact text is already running. Wait for it instead
    // of starting a second one, so both requests resolve to the same
    // answer rather than two independently computed ones.
    if (draftReply === pendingDraft && pendingPromise) {
      console.log(`[req ${requestId}] joining in-flight call`);
      try {
        const result = await pendingPromise;
        socket.send(JSON.stringify({ requestId, ...result, cached: true }));
      } catch {
        socket.send(
          JSON.stringify({
            requestId,
            error: "Evaluation failed. Check the server logs.",
          })
        );
      }
      return;
    }

    console.log(`[req ${requestId}] cache MISS, calling Jev`);

    pendingDraft = draftReply;
    pendingPromise = (async () => {
      const start = Date.now();
      const answers = await evaluateDraft(customerMessage, draftReply);
      const modelLatencyMs = Date.now() - start;
      return { answers, modelLatencyMs };
    })();

    try {
      const result = await pendingPromise;

      lastDraft = draftReply;
      lastResult = result;

      socket.send(JSON.stringify({ requestId, ...result, cached: false }));
    } catch (err) {
      console.error("Jev evaluation failed:", err);
      socket.send(
        JSON.stringify({
          requestId,
          error: "Evaluation failed. Check the server logs.",
        })
      );
    } finally {
      if (pendingDraft === draftReply) {
        pendingDraft = null;
        pendingPromise = null;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Support co-pilot listening on http://localhost:${PORT}`);
});