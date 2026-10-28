const params = new URLSearchParams(location.search);
const electionId = params.get("election");

let election = null;
let positions = [];
let candidatesByPosition = {};
let selections = {}; // position_id -> candidate_id

const loadingEl = document.getElementById("ballot-loading");
const blockedEl = document.getElementById("ballot-blocked");
const blockedMsg = document.getElementById("blocked-message");
const ballotView = document.getElementById("ballot-view");
const reviewView = document.getElementById("review-view");

function block(message) {
  loadingEl.style.display = "none";
  ballotView.style.display = "none";
  blockedEl.style.display = "block";
  blockedMsg.textContent = message;
}

async function loadBallot() {
  if (!electionId) return block("No election was specified. Go back to the home page and choose an open election.");

  const { data: e } = await supabaseClient.from("elections").select("*").eq("id", electionId).single();
  if (!e) return block("That election couldn't be found.");
  election = e;

  if (election.status !== "open") {
    return block(
      election.status === "scheduled"
        ? "Voting hasn't opened for this election yet."
        : "Voting has closed for this election."
    );
  }

  const { data: pos } = await supabaseClient
    .from("positions").select("*").eq("election_id", electionId)
    .order("display_order", { ascending: true });
  positions = pos || [];

  if (positions.length === 0) return block("This election doesn't have any positions set up yet.");

  const { data: cands } = await supabaseClient
    .from("candidates").select("*").in("position_id", positions.map(p => p.id))
    .eq("status", "approved");

  candidatesByPosition = {};
  positions.forEach(p => candidatesByPosition[p.id] = (cands || []).filter(c => c.position_id === p.id));

  renderBallot();
  loadingEl.style.display = "none";
  ballotView.style.display = "block";
}

function renderProgress(container, activeIndex, total) {
  container.innerHTML = Array.from({ length: total }).map((_, i) =>
    `<div class="step ${i <= activeIndex ? "done" : ""}"></div>`
  ).join("");
}

function renderBallot() {
  document.getElementById("election-name-tag").textContent = election.title;
  renderProgress(document.getElementById("progress"), 0, 2);

  document.getElementById("positions-container").innerHTML = positions.map(pos => `
    <div class="position-block">
      <h2>${escapeHtml(pos.name)}</h2>
      <div class="grid grid-2">
        ${candidatesByPosition[pos.id].map(c => `
          <label class="candidate-card" data-position="${pos.id}" data-candidate="${c.id}">
            <div class="candidate-photo" style="${c.photo_url ? `background-image:url('${c.photo_url}')` : ""}">
              ${c.photo_url ? "" : "No photo"}
            </div>
            <div class="candidate-body">
              <h3>${escapeHtml(c.full_name)}</h3>
              <div class="candidate-course">${escapeHtml(c.course || "")}</div>
              <p class="candidate-manifesto">${escapeHtml(c.manifesto || "No manifesto submitted.")}</p>
              <div class="candidate-select">
                <span class="radio-pill">
                  <input type="radio" name="pos-${pos.id}" value="${c.id}" />
                  Select
                </span>
              </div>
            </div>
          </label>
        `).join("") || `<div class="empty-state">No candidates for this position.</div>`}
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".candidate-card input[type=radio]").forEach(input => {
    input.addEventListener("change", (e) => {
      const card = e.target.closest(".candidate-card");
      const posId = card.dataset.position;
      selections[posId] = card.dataset.candidate;
      document.querySelectorAll(`.candidate-card[data-position="${posId}"]`)
        .forEach(c => c.classList.toggle("selected", c.dataset.candidate === selections[posId]));
    });
  });
}

document.getElementById("to-review-btn").addEventListener("click", () => {
  const missing = positions.filter(p => !selections[p.id]);
  if (missing.length > 0) {
    showToast(`Choose a candidate for: ${missing.map(p => p.name).join(", ")}`);
    return;
  }
  renderReview();
  ballotView.style.display = "none";
  reviewView.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("back-btn").addEventListener("click", () => {
  reviewView.style.display = "none";
  ballotView.style.display = "block";
});

function renderReview() {
  renderProgress(document.getElementById("progress-review"), 1, 2);
  document.getElementById("review-rows").innerHTML = positions.map(pos => {
    const cand = candidatesByPosition[pos.id].find(c => c.id === selections[pos.id]);
    return `
      <div class="review-row">
        <span class="pos">${escapeHtml(pos.name)}</span>
        <span class="cand">${escapeHtml(cand ? cand.full_name : "—")}</span>
      </div>
    `;
  }).join("");
}

// ---- Exam number verification + submit ----
const modal = document.getElementById("exam-modal");
const examInput = document.getElementById("exam-input");
const examError = document.getElementById("exam-error");
const confirmBtn = document.getElementById("exam-confirm");

document.getElementById("submit-btn").addEventListener("click", () => {
  examError.style.display = "none";
  examInput.value = "";
  modal.classList.add("open");
  setTimeout(() => examInput.focus(), 50);
});

document.getElementById("exam-cancel").addEventListener("click", () => modal.classList.remove("open"));

const ERROR_MESSAGES = {
  ELECTION_NOT_FOUND: "That election couldn't be found.",
  ELECTION_NOT_OPEN: "Voting isn't open for this election right now.",
  INVALID_EXAM_NUMBER: "Invalid student or exam number.",
  ALREADY_VOTED: "This exam number has already voted in this election.",
  INCOMPLETE_BALLOT: "Your ballot is incomplete — go back and choose a candidate for every position.",
  INVALID_SELECTION: "One of your selections wasn't valid. Please go back and choose again.",
};

confirmBtn.addEventListener("click", async () => {
  const exam = examInput.value.trim().toUpperCase();
  if (!exam) {
    examError.textContent = "Enter your exam number.";
    examError.style.display = "block";
    return;
  }

  confirmBtn.disabled = true;
  confirmBtn.textContent = "Submitting…";

  const payload = positions.map(p => ({ position_id: p.id, candidate_id: selections[p.id] }));

  const { data, error } = await supabaseClient.rpc("cast_vote", {
    p_election_id: electionId,
    p_exam_number: exam,
    p_selections: payload,
  });

  confirmBtn.disabled = false;
  confirmBtn.textContent = "Confirm & submit";

  if (error) {
    const code = (error.message || "").split(":").pop().trim();
    examError.textContent = ERROR_MESSAGES[code] || "Something went wrong. Please try again.";
    examError.style.display = "block";
    return;
  }

  const receipt = data && data[0] && data[0].receipt_id;
  location.href = `success.html?receipt=${encodeURIComponent(receipt || "")}`;
});

examInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmBtn.click(); });

loadBallot();