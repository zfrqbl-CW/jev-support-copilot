import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const USE_MOCK =
  !process.env.TYPESAFE_API_KEY || process.env.USE_MOCK === "true";

const client = USE_MOCK ? null : new TypeSafeClient();

if (USE_MOCK) {
  console.warn(
    "Running in mock mode: no TYPESAFE_API_KEY was found, or USE_MOCK is set. " +
      "Answers below are deterministic placeholders, not real Jev output. " +
      "Set TYPESAFE_API_KEY and remove USE_MOCK before using this for the article."
  );
}

// One call, four typed questions, evaluated in parallel against the same
// state. This is the pattern TypeSafe's own docs recommend: decompose a
// fuzzy judgment into several narrow, well scoped questions and combine
// them in your own code, rather than asking one model to "grade this reply".
export async function evaluateDraft(customerMessage, draftReply) {
  if (USE_MOCK) {
    return mockEvaluate(draftReply);
  }

  const response = await client.systemOne({
    state: {
      customer_message: customerMessage,
      draft_reply: draftReply,
    },
    questions: {
      tone: choice("What tone does `draft_reply` take toward the customer?", {
        empathetic: "Acknowledges the customer's frustration or situation directly",
        neutral: "Matter of fact, no emotional acknowledgment either way",
        curt: "Short and transactional, reads as dismissive",
        defensive: "Justifies the company's position rather than addressing the customer",
      }),
      makes_commitment: noul(
        "Does `draft_reply` promise a specific refund amount, replacement, or timeline the company may not be able to guarantee?"
      ),
      needs_review: noul(
        "Given `customer_message` and `draft_reply`, should a manager review this reply before it is sent?"
      ),
      predicted_satisfaction: score(
        "How satisfied is the customer likely to be after reading `draft_reply`, given `customer_message`?",
        [
          "Likely to escalate or complain further",
          "Neutral, may follow up again",
          "Satisfied, unlikely to need further contact",
        ]
      ),
    },
  });

  return response.answers;
}

// ---------------------------------------------------------------------
// Mock mode. Lets the app run and the UI get built before you have Jev
// API access, and keeps this repo runnable for anyone reading along who
// doesn't have a key yet either. Swap USE_MOCK off before capturing any
// screenshot or timing number that goes into the article.
// ---------------------------------------------------------------------
const TONES = ["empathetic", "neutral", "curt", "defensive"];
const COMMITMENT_PATTERN = /refund|\$\d|by (tomorrow|monday|friday|end of day)/i;

function mockEvaluate(draftReply) {
  const seed = hashText(draftReply);
  const toneIndex = seed % TONES.length;
  const tone = TONES[toneIndex];

  const makesCommitment = COMMITMENT_PATTERN.test(draftReply) ? 0.82 : 0.12;
  const needsReview = makesCommitment > 0.5 ? 0.71 : 0.18;
  const satisfactionScore = 1 + ((seed % 100) / 100) * 2; // spread across 1 to 3

  return {
    tone: {
      choice: tone,
      probabilities: Object.fromEntries(
        TONES.map((t, i) => [t, i === toneIndex ? 0.58 : 0.42 / 3])
      ),
      confidence: 0.6,
    },
    makes_commitment: { noul: makesCommitment },
    needs_review: { noul: needsReview },
    predicted_satisfaction: {
      score: satisfactionScore,
      legend: {
        1: "Likely to escalate or complain further",
        2: "Neutral, may follow up again",
        3: "Satisfied, unlikely to need further contact",
      },
      probabilities: { 1: 0.2, 2: 0.5, 3: 0.3 },
      confidence: 0.5,
    },
  };
}

function hashText(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
