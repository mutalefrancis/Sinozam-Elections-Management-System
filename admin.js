/* ==========================================================
   SEMS (SINOZAM ELECTIONS MANAGEMENT SYSTEM, formerly SinoVotes) — Unified Committee Admin Dashboard Logic
   ========================================================== */

let currentElection = null;
let currentNominationFilter = "pending";
let selectedNominationId = null;

// Guard Route Check
async function guard() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { 
    location.href = "login.html"; 
    return null; 
  }
  
  const { data: admin } = await supabaseClient
    .from("admins")
    .select("id, role")
    .eq("id", session.user.id)
    .single();

  if (!admin) { 
    await supabaseClient.auth.signOut(); 
    location.href = "login.html"; 
    return null; 
  }

  const welcomeLine = document.getElementById("welcome-line");
  if (welcomeLine) {
    welcomeLine.textContent = `Signed in as ${session.user.email} · ${admin.role || "committee member"}`;
  }
  return admin;
}

// Logout Listener
const logoutLink = document.getElementById("logout-link");
if (logoutLink) {
  logoutLink.addEventListener("click", async (e) => {
    e.preventDefault();
    await supabaseClient.auth.signOut();
    location.href = "login.html";
  });
}

/* ==========================================================
   Elections & Turnout Stats
   ========================================================== */
async function loadStats() {
  const { data: elections } = await supabaseClient
    .from("elections")
    .select("*")
    .order("created_at", { ascending: false });

  renderElections(elections || []);

  const active = (elections || []).find(e => e.status === "open") || (elections || [])[0];
  currentElection = active;

  if (active) {
    const { data: turnout } = await supabaseClient.rpc("get_turnout", { p_election_id: active.id });
    if (turnout && turnout[0]) {
      const { eligible, voted } = turnout[0];
      const statEligible = document.getElementById("stat-eligible");
      const statVoted = document.getElementById("stat-voted");
      const statTurnout = document.getElementById("stat-turnout");

      if (statEligible) statEligible.textContent = eligible;
      if (statVoted) statVoted.textContent = voted;
      if (statTurnout) statTurnout.textContent = eligible > 0 ? Math.round((voted / eligible) * 100) + "%" : "—";
    }
  }
}

function renderElections(elections) {
  const wrap = document.getElementById("elections-list");
  if (!wrap) return;

  if (elections.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No elections created yet. Add one above to begin.</div>`;
    return;
  }

  wrap.innerHTML = elections.map(e => `
    <div class="card" style="margin-bottom:12px; display:flex; align-items:center; justify-content:space-between; gap:16px;">
      <div>
        <div class="meta">${formatDateTime(e.start_time)} → ${formatDateTime(e.end_time)}</div>
        <h3 style="margin-bottom:0;">${escapeHtml(e.title)}</h3>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="status-pill status-${e.status}"><span class="status-dot"></span>${statusLabel(e.status)}</span>
        <select class="btn btn-ghost btn-sm status-select" data-id="${e.id}" style="cursor:pointer;">
          <option value="scheduled" ${e.status === "scheduled" ? "selected" : ""}>Scheduled</option>
          <option value="open" ${e.status === "open" ? "selected" : ""}>Open</option>
          <option value="closed" ${e.status === "closed" ? "selected" : ""}>Closed</option>
          <option value="completed" ${e.status === "completed" ? "selected" : ""}>Completed</option>
        </select>
        <button class="btn btn-ghost btn-sm delete-elec-btn" data-id="${e.id}" data-title="${escapeHtml(e.title)}" style="color:var(--stamp); border-color:var(--stamp);">Delete</button>
        <a class="btn btn-gold btn-sm" href="ballot.html?election=${e.id}">Edit ballot</a>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      const { error } = await supabaseClient.from("elections").update({ status: e.target.value }).eq("id", sel.dataset.id);
      showToast(error ? "Couldn't update status." : "Election status updated.");
      loadStats();
    });
  });

  wrap.querySelectorAll(".delete-elec-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ok = confirm(
        `Delete "${btn.dataset.title}"? This permanently removes it along with every position, ` +
        `candidate, vote and voter record tied to it. This can't be undone.`
      );
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = "Deleting…";
      const { error } = await supabaseClient.rpc("admin_delete_election", { p_election_id: btn.dataset.id });
      showToast(error ? "Couldn't delete — see console." : "Election deleted.");
      if (error) console.error(error);
      loadStats();
    });
  });
}

const createElecBtn = document.getElementById("create-elec-btn");
if (createElecBtn) {
  createElecBtn.addEventListener("click", async () => {
    const title = document.getElementById("elec-title").value.trim();
    const description = document.getElementById("elec-desc").value.trim();
    const start = document.getElementById("elec-start").value;
    const end = document.getElementById("elec-end").value;

    if (!title || !start || !end) { showToast("Title, start time and end time are required."); return; }
    if (new Date(end) <= new Date(start)) { showToast("End time must be after start time."); return; }

    createElecBtn.disabled = true;
    createElecBtn.textContent = "Creating…";

    const { data: created, error } = await supabaseClient.from("elections").insert({
      title,
      description,
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      status: "scheduled",
    }).select().single();

    createElecBtn.disabled = false;
    createElecBtn.textContent = "Create election";

    if (error) { showToast("Couldn't create election."); console.error(error); return; }

    showToast("Election created — now add its positions and candidates.");
    location.href = `ballot.html?election=${created.id}`;
  });
}

/* ==========================================================
   Candidate Nominations Vetting System
   ========================================================== */
async function loadNominationsAdmin() {
  const wrap = document.getElementById("nominations-admin-list");
  if (!wrap) return;

  wrap.innerHTML = `<tr><td colspan="6" style="text-align:center;">Loading nominations...</td></tr>`;

  const { data: nominations, error } = await supabaseClient
    .from("candidates")
    .select("*, positions(name, elections(title))")
    .eq("status", currentNominationFilter)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching nominations:", error);
    showToast("Couldn't load nominations.");
    return;
  }

  if (!nominations || nominations.length === 0) {
    wrap.innerHTML = `<tr><td colspan="6" style="text-align:center;" class="empty-state">No ${currentNominationFilter} nominations found.</td></tr>`;
    return;
  }

  wrap.innerHTML = nominations.map(item => {
    const photoLink = item.photo_url
      ? `<a href="${item.photo_url}" target="_blank" class="btn-link" style="color:var(--gold,#d97706); font-weight:600;">View Photo 📷</a>`
      : `<span class="meta">No photo</span>`;

    let actionButtons = "";
    if (item.status === "pending") {
      actionButtons = `
        <div style="display:flex; gap:6px;">
          <button class="btn btn-ghost btn-sm approve-nom-btn" data-id="${item.id}" style="color:var(--green,#16a34a); border-color:var(--green,#16a34a);">Approve</button>
          <button class="btn btn-ghost btn-sm reject-nom-btn" data-id="${item.id}" style="color:var(--stamp); border-color:var(--stamp);">Reject</button>
        </div>
      `;
    } else if (item.status === "rejected") {
      actionButtons = `<small class="meta" style="color:var(--stamp);">Reason: ${escapeHtml(item.rejection_reason || "None specified")}</small>`;
    } else {
      actionButtons = `<span class="status-pill status-open"><span class="status-dot"></span>On Ballot</span>`;
    }

    return `
      <tr>
        <td>
          <strong>${escapeHtml(item.full_name)}</strong><br>
          <small class="meta">${escapeHtml(item.course || "")}</small>
        </td>
        <td>
          <strong>${escapeHtml(item.positions?.elections?.title || "—")}</strong><br>
          <small class="meta">${item.positions ? escapeHtml(item.positions.name) : 'Position ID: ' + item.position_id}</small>
        </td>
        <td><small class="meta">${escapeHtml(item.manifesto || "—")}</small></td>
        <td>${photoLink}</td>
        <td><span class="status-pill status-${item.status}">${statusLabel(item.status)}</span></td>
        <td>${actionButtons}</td>
      </tr>
    `;
  }).join("");

  wrap.querySelectorAll(".approve-nom-btn").forEach(btn => {
    btn.addEventListener("click", () => approveNomination(btn.dataset.id));
  });

  wrap.querySelectorAll(".reject-nom-btn").forEach(btn => {
    btn.addEventListener("click", () => openRejectModal(btn.dataset.id));
  });
}

async function approveNomination(id) {
  const ok = confirm("Approve candidate? This will automatically publish them to the live election ballot.");
  if (!ok) return;

  const { error } = await supabaseClient
    .from("candidates")
    .update({ status: "approved" })
    .eq("id", id);

  if (error) {
    console.error("Approval error:", error);
    showToast("Couldn't approve candidate.");
  } else {
    showToast("Candidate approved and published to ballot!");
    loadNominationsAdmin();
  }
}

function openRejectModal(id) {
  selectedNominationId = id;
  const modal = document.getElementById("reject-modal");
  const reasonInput = document.getElementById("rejection-reason-input");
  if (reasonInput) reasonInput.value = "";
  if (modal) modal.style.display = "flex";
}

function closeRejectModal() {
  selectedNominationId = null;
  const modal = document.getElementById("reject-modal");
  if (modal) modal.style.display = "none";
}

const confirmRejectBtn = document.getElementById("confirm-reject-btn");
if (confirmRejectBtn) {
  confirmRejectBtn.addEventListener("click", async () => {
    const reasonInput = document.getElementById("rejection-reason-input");
    const reason = reasonInput ? reasonInput.value.trim() : "";

    if (!reason) {
      showToast("Please enter a reason for rejection.");
      return;
    }

    const { error } = await supabaseClient
      .from("candidates")
      .update({ status: "rejected", rejection_reason: reason })
      .eq("id", selectedNominationId);

    if (error) {
      console.error("Rejection error:", error);
      showToast("Couldn't reject nomination.");
    } else {
      showToast("Nomination rejected.");
      closeRejectModal();
      loadNominationsAdmin();
    }
  });
}

document.querySelectorAll(".nomination-tab-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".nomination-tab-btn").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    currentNominationFilter = e.target.dataset.status;
    loadNominationsAdmin();
  });
});

/* ==========================================================
   Voter Roster Uploads (CSV)
   ========================================================== */
const uploadCsvBtn = document.getElementById("upload-csv-btn");
if (uploadCsvBtn) {
  uploadCsvBtn.addEventListener("click", async () => {
    const fileInput = document.getElementById("csv-file-input");
    const file = fileInput ? fileInput.files[0] : null;

    if (!file) {
      showToast("Please select a CSV file first.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const lines = text.split(/\r\n|\n/);
      const studentNumbers = [];

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.toLowerCase().includes("student") && !trimmed.toLowerCase().includes("exam")) {
          const studentNum = trimmed.split(",")[0].replace(/['"]/g, "").trim();
          if (studentNum) studentNumbers.push(studentNum);
        }
      });

      if (studentNumbers.length === 0) {
        showToast("No valid student numbers found in the CSV.");
        return;
      }

      uploadCsvBtn.disabled = true;
      uploadCsvBtn.textContent = "Uploading…";

      const studentRecords = studentNumbers.map((num) => ({ exam_number: num }));
      const { error } = await supabaseClient
        .from("students")
        .upsert(studentRecords, { onConflict: "exam_number" });

      uploadCsvBtn.disabled = false;
      uploadCsvBtn.textContent = "Upload Student Roster";

      if (error) {
        console.error("CSV Upload Error:", error);
        showToast("Couldn't upload roster — see console.");
      } else {
        showToast(`Successfully registered ${studentNumbers.length} students to the global database!`);
        if (fileInput) fileInput.value = "";
        loadStats();
      }
    };

    reader.readAsText(file);
  });
}

/* ==========================================================
   Announcements Management
   ========================================================== */
async function loadAnnouncementsAdmin() {
  const wrap = document.getElementById("announcements-admin-list");
  if (!wrap) return;

  const { data } = await supabaseClient.from("announcements").select("*").order("posted_at", { ascending: false });

  if (!data || data.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No announcements yet.</div>`;
    return;
  }

  wrap.innerHTML = data.map(a => `
    <div class="card" style="margin-bottom:10px; display:flex; justify-content:space-between; gap:16px; align-items:flex-start;">
      <div>
        <div class="meta">${formatDateTime(a.posted_at)} · ${a.published ? "Published" : "Draft"}</div>
        <h3>${escapeHtml(a.title)}</h3>
        <p>${escapeHtml(a.body)}</p>
      </div>
      <button class="btn btn-ghost btn-sm delete-ann-btn" data-id="${a.id}" style="color:var(--stamp); border-color:var(--stamp); flex-shrink:0;">Delete</button>
    </div>
  `).join("");

  wrap.querySelectorAll(".delete-ann-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this announcement? This can't be undone.")) return;
      const { error } = await supabaseClient.from("announcements").delete().eq("id", btn.dataset.id);
      showToast(error ? "Couldn't delete announcement." : "Announcement deleted.");
      loadAnnouncementsAdmin();
    });
  });
}

const postAnnBtn = document.getElementById("post-ann-btn");
if (postAnnBtn) {
  postAnnBtn.addEventListener("click", async () => {
    const titleInput = document.getElementById("ann-title");
    const bodyInput = document.getElementById("ann-body");
    const title = titleInput ? titleInput.value.trim() : "";
    const body = bodyInput ? bodyInput.value.trim() : "";

    if (!title || !body) { showToast("Add a title and body first."); return; }

    const { error } = await supabaseClient.from("announcements").insert({
      title, body, published: true, posted_at: new Date().toISOString(),
    });

    showToast(error ? "Couldn't post announcement." : "Announcement published.");
    if (!error) {
      if (titleInput) titleInput.value = "";
      if (bodyInput) bodyInput.value = "";
      loadAnnouncementsAdmin();
    }
  });
}

/* ==========================================================
   Dashboard Entry-point
   ========================================================== */
(async function init() {
  const admin = await guard();
  if (!admin) return;
  loadStats();
  loadAnnouncementsAdmin();
  loadNominationsAdmin();
})();