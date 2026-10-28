const params = new URLSearchParams(location.search);
const electionId = params.get("election");
let openPositionId = null; // which position the "add candidate" modal is for

async function guard() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { location.href = "login.html"; return null; }
  const { data: admin } = await supabaseClient.from("admins").select("id, role").eq("id", session.user.id).single();
  if (!admin) { await supabaseClient.auth.signOut(); location.href = "login.html"; return null; }
  return admin;
}

document.getElementById("logout-link").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabaseClient.auth.signOut();
  location.href = "login.html";
});

async function loadElection() {
  const { data: election } = await supabaseClient.from("elections").select("*").eq("id", electionId).single();
  if (!election) return null;
  document.getElementById("election-title").textContent = election.title;
  return election;
}

async function loadPositionsAndCandidates() {
  const { data: positions } = await supabaseClient
    .from("positions").select("*").eq("election_id", electionId)
    .order("display_order", { ascending: true });

  const { data: candidates } = positions && positions.length
    ? await supabaseClient.from("candidates").select("*").in("position_id", positions.map(p => p.id))
    : { data: [] };

  renderPositions(positions || [], candidates || []);
}

function renderPositions(positions, candidates) {
  const wrap = document.getElementById("positions-list");

  if (positions.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No positions yet — add one above (e.g. President, Vice President, Treasurer).</div>`;
    return;
  }

  wrap.innerHTML = positions.map(pos => {
    const cands = candidates.filter(c => c.position_id === pos.id);
    return `
      <div class="position-block">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid var(--ink); padding-bottom:10px; margin-bottom:16px;">
          <h2 style="border:none; padding:0; margin:0;">${escapeHtml(pos.name)}</h2>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-gold btn-sm add-cand-btn" data-pos="${pos.id}" data-name="${escapeHtml(pos.name)}">+ Add candidate</button>
            <button class="btn btn-ghost btn-sm delete-pos-btn" data-id="${pos.id}" data-name="${escapeHtml(pos.name)}" style="color:var(--stamp); border-color:var(--stamp);">Delete position</button>
          </div>
        </div>
        <div class="grid grid-3">
          ${cands.map(c => `
            <div class="candidate-card">
              <div class="candidate-photo" style="${c.photo_url ? `background-image:url('${c.photo_url}')` : ""}">
                ${c.photo_url ? "" : "No photo"}
              </div>
              <div class="candidate-body">
                <h3>${escapeHtml(c.full_name)}</h3>
                <div class="candidate-course">${escapeHtml(c.course || "")}</div>
                <p class="candidate-manifesto">${escapeHtml(c.manifesto || "No manifesto yet.")}</p>
                <button class="btn btn-ghost btn-sm delete-cand-btn" data-id="${c.id}" data-name="${escapeHtml(c.full_name)}" style="margin-top:10px; color:var(--stamp); border-color:var(--stamp);">Delete</button>
              </div>
            </div>
          `).join("") || `<div class="empty-state" style="grid-column:1/-1;">No candidates yet for this position.</div>`}
        </div>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll(".add-cand-btn").forEach(btn => {
    btn.addEventListener("click", () => openCandidateModal(btn.dataset.pos, btn.dataset.name));
  });

  wrap.querySelectorAll(".delete-pos-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete "${btn.dataset.name}" and every candidate under it?`)) return;
      await supabaseClient.from("candidates").delete().eq("position_id", btn.dataset.id);
      const { error } = await supabaseClient.from("positions").delete().eq("id", btn.dataset.id);
      showToast(error ? "Couldn't delete position." : "Position deleted.");
      loadPositionsAndCandidates();
    });
  });

  wrap.querySelectorAll(".delete-cand-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Remove ${btn.dataset.name} from the ballot?`)) return;
      const { error } = await supabaseClient.from("candidates").delete().eq("id", btn.dataset.id);
      showToast(error ? "Couldn't remove candidate." : "Candidate removed.");
      loadPositionsAndCandidates();
    });
  });
}

document.getElementById("add-pos-btn").addEventListener("click", async () => {
  const name = document.getElementById("pos-name").value.trim();
  const orderRaw = document.getElementById("pos-order").value;
  if (!name) { showToast("Give the position a name."); return; }

  const { error } = await supabaseClient.from("positions").insert({
    election_id: electionId,
    name,
    display_order: orderRaw ? parseInt(orderRaw, 10) : 0,
  });

  showToast(error ? "Couldn't add position." : "Position added.");
  if (error) { console.error(error); return; }

  document.getElementById("pos-name").value = "";
  document.getElementById("pos-order").value = "";
  loadPositionsAndCandidates();
});

// ---- Candidate modal ----
const candModal = document.getElementById("cand-modal");
const candError = document.getElementById("cand-error");

function openCandidateModal(positionId, positionName) {
  openPositionId = positionId;
  document.getElementById("cand-modal-position").textContent = `For: ${positionName}`;
  ["cand-name", "cand-course", "cand-manifesto"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("cand-photo").value = "";
  const preview = document.getElementById("cand-photo-preview");
  preview.style.display = "none";
  preview.src = "";
  candError.style.display = "none";
  candModal.classList.add("open");
}

document.getElementById("cand-photo").addEventListener("change", (e) => {
  const file = e.target.files[0];
  const preview = document.getElementById("cand-photo-preview");
  if (!file) { preview.style.display = "none"; return; }
  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";
});

document.getElementById("cand-cancel").addEventListener("click", () => candModal.classList.remove("open"));

document.getElementById("cand-save").addEventListener("click", async () => {
  const full_name = document.getElementById("cand-name").value.trim();
  const course = document.getElementById("cand-course").value.trim();
  const manifesto = document.getElementById("cand-manifesto").value.trim();
  const photoFile = document.getElementById("cand-photo").files[0];

  if (!full_name) {
    candError.textContent = "Name is required.";
    candError.style.display = "block";
    return;
  }

  const btn = document.getElementById("cand-save");
  btn.disabled = true;

  let photo_url = null;
  if (photoFile) {
    btn.textContent = "Uploading photo…";
    const ext = photoFile.name.split(".").pop();
    const path = `${openPositionId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("candidate-photos")
      .upload(path, photoFile, { upsert: false });

    if (uploadError) {
      candError.textContent = "Couldn't upload photo — check console for details.";
      candError.style.display = "block";
      console.error(uploadError);
      btn.disabled = false;
      btn.textContent = "Add candidate";
      return;
    }

    photo_url = supabaseClient.storage.from("candidate-photos").getPublicUrl(path).data.publicUrl;
  }

  btn.textContent = "Saving…";

  const { error } = await supabaseClient.from("candidates").insert({
    position_id: openPositionId,
    full_name,
    course: course || null,
    manifesto: manifesto || null,
    photo_url,
    status: "approved",
  });

  btn.disabled = false;
  btn.textContent = "Add candidate";

  if (error) {
    candError.textContent = "Couldn't save — check console for details.";
    candError.style.display = "block";
    console.error(error);
    return;
  }

  candModal.classList.remove("open");
  showToast("Candidate added.");
  loadPositionsAndCandidates();
});

(async function init() {
  const admin = await guard();
  if (!admin) return;

  if (!electionId) {
    document.getElementById("no-election").style.display = "block";
    return;
  }

  const election = await loadElection();
  if (!election) {
    document.getElementById("no-election").style.display = "block";
    return;
  }

  document.getElementById("builder").style.display = "block";
  loadPositionsAndCandidates();
})();