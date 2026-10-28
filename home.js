/* ==========================================================
   SEMS (SINOZAM ELECTIONS MANAGEMENT SYSTEM, formerly SinoVotes) — Home / Index Page Logic (Academic Regalia)
   ========================================================== */

async function loadCurrentElection() {
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get("election");

  if (targetId) {
    const { data } = await supabaseClient
      .from("elections")
      .select("*")
      .eq("id", targetId)
      .single();
    if (data) return data;
  }

  let { data: open } = await supabaseClient
    .from("elections")
    .select("*")
    .eq("status", "open")
    .order("start_time", { ascending: true })
    .limit(1);

  if (open && open[0]) return open[0];

  let { data: past } = await supabaseClient
    .from("elections")
    .select("*")
    .in("status", ["closed", "completed"])
    .order("end_time", { ascending: false })
    .limit(1);

  if (past && past[0]) return past[0];

  let { data: scheduled } = await supabaseClient
    .from("elections")
    .select("*")
    .eq("status", "scheduled")
    .order("start_time", { ascending: true })
    .limit(1);

  return scheduled && scheduled[0];
}

function renderElectionHero(election) {
  const titleEl = document.getElementById("election-title");
  const descEl = document.getElementById("election-desc");
  const pill = document.getElementById("status-pill");
  const statusText = document.getElementById("status-text");
  const voteCta = document.getElementById("vote-cta");
  const nominateCta = document.getElementById("nominate-cta");
  const resultsCta = document.getElementById("results-cta");
  const countdown = document.getElementById("countdown");

  // ALWAYS Reset display states first
  if (voteCta) voteCta.style.display = "none";
  if (nominateCta) nominateCta.style.display = "none";
  if (resultsCta) resultsCta.style.display = "none";
  if (countdown) countdown.style.display = "none";

  if (!election) {
    if (titleEl) titleEl.textContent = "No election is scheduled right now";
    if (descEl) descEl.textContent = "Check back soon, or read past announcements below.";
    if (pill) pill.style.display = "none";
    return;
  }

  if (titleEl) titleEl.textContent = election.title;
  if (descEl) descEl.textContent = election.description || "";
  if (pill) {
    pill.style.display = "inline-flex";
    pill.className = "status-pill status-" + election.status;
  }
  if (statusText) statusText.textContent = statusLabel(election.status);

  // Handle CTAs based on election status
  if (election.status === "open" && voteCta) {
    voteCta.href = `vote.html?election=${election.id}`;
    voteCta.style.display = "inline-flex";
  } else if (election.status === "scheduled") {
    if (nominateCta) {
      nominateCta.href = `nominate.html?election=${election.id}`;
      nominateCta.style.display = "inline-flex";
    }
    if (countdown) {
      countdown.style.display = "flex";
      mountCountdown(countdown, election.start_time, () => waitForOpen(election.id));
    }
  } else if ((election.status === "closed" || election.status === "completed") && resultsCta) {
    resultsCta.href = `results.html?election=${election.id}`;
    resultsCta.style.display = "inline-flex";
  }

  loadCandidatesPreview(election.id, election.status);
}

let waitAttempts = 0;
async function waitForOpen(electionId) {
  const countdown = document.getElementById("countdown");
  if (countdown) {
    countdown.innerHTML = `<p style="font-family:var(--mono); font-size:0.85rem; color:var(--parchment-dim);">Waiting for the committee to open voting…</p>`;
  }

  const { data: e } = await supabaseClient.from("elections").select("*").eq("id", electionId).single();
  waitAttempts++;

  if (e && e.status !== "scheduled") {
    renderElectionHero(e);
    return;
  }

  if (waitAttempts > 40) {
    if (countdown) {
      countdown.innerHTML = `<p style="font-family:var(--mono); font-size:0.85rem; color:var(--parchment-dim);">Still scheduled — refresh the page to check again.</p>`;
    }
    return;
  }

  setTimeout(() => waitForOpen(electionId), 3000);
}

async function loadAnnouncements() {
  const list = document.getElementById("announcements-list");
  if (!list) return;

  const { data, error } = await supabaseClient
    .from("announcements")
    .select("*")
    .eq("published", true)
    .order("posted_at", { ascending: false })
    .limit(6);

  if (error || !data || data.length === 0) {
    list.innerHTML = `<div class="empty-state">No announcements yet — check back soon.</div>`;
    return;
  }

  list.innerHTML = data.map(a => `
    <div class="card">
      <div class="meta">${formatDateTime(a.posted_at)}</div>
      <h3>${escapeHtml(a.title)}</h3>
      <p>${escapeHtml(a.body)}</p>
    </div>
  `).join("");
}

async function loadCandidatesPreview(electionId, status) {
  const wrap = document.getElementById("candidates-by-position");
  if (!wrap) return;

  if (status === "closed" || status === "completed") {
    const { data: results, error } = await supabaseClient.rpc("get_election_results", {
      p_election_id: electionId
    });

    if (error || !results || results.length === 0) {
      wrap.innerHTML = `<div class="empty-state">No results available for this election yet.</div>`;
      return;
    }

    const grouped = {};
    results.forEach(r => {
      if (!grouped[r.position_id]) {
        grouped[r.position_id] = { name: r.position_name, candidates: [] };
      }
      grouped[r.position_id].candidates.push(r);
    });

    wrap.innerHTML = Object.values(grouped).map(pos => {
      const winner = pos.candidates[0];
      return `
        <div class="position-block">
          <h2>${escapeHtml(pos.name)}</h2>
          <div style="background: rgba(111, 133, 119, 0.15); border: 1px solid var(--hood-green); padding: 12px 16px; border-radius: var(--radius); margin-bottom: 20px; color: var(--parchment);">
            <strong style="color: var(--trim-gold);">🏆 Winner:</strong> 
            ${escapeHtml(winner ? winner.candidate_name : "None")} 
            <span class="mono" style="color: var(--parchment-dim);">(${winner ? winner.percentage : 0}% — ${winner ? winner.vote_count : 0} votes)</span>
          </div>
          <div class="grid grid-3">
            ${pos.candidates.map(c => `
              <div class="candidate-card-glass" style="background-image: url('${c.photo_url || "images/candidate-placeholder.jpg"}');">
                <div class="glass-panel-dark">
                  <h3 class="glass-candidate-name">${escapeHtml(c.candidate_name)}</h3>
                  <div class="glass-candidate-program">${c.percentage}% (${c.vote_count} votes)</div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");
    return;
  }

  const { data: positions } = await supabaseClient
    .from("positions")
    .select("*")
    .eq("election_id", electionId)
    .order("display_order", { ascending: true });

  if (!positions || positions.length === 0) {
    wrap.innerHTML = `<div class="empty-state">Candidates will appear here once positions are set.</div>`;
    return;
  }

  // UPDATED: Filter candidates by position AND status = 'approved'
  const { data: candidates } = await supabaseClient
    .from("candidates")
    .select("*")
    .in("position_id", positions.map(p => p.id))
    .eq("status", "approved");

  wrap.innerHTML = positions.map(pos => {
    const cands = (candidates || []).filter(c => c.position_id === pos.id);
    return `
      <div class="position-block">
        <h2>${escapeHtml(pos.name)}</h2>
        <div class="grid grid-3">
          ${cands.length > 0 ? cands.map(c => `
            <div class="candidate-card-glass" style="background-image: url('${c.photo_url || "images/candidate-placeholder.jpg"}');">
              <div class="glass-panel-dark">
                <h3 class="glass-candidate-name">${escapeHtml(c.full_name)}</h3>
                <div class="glass-candidate-program">${escapeHtml(c.course || "Candidate")}</div>
                <p class="glass-candidate-manifesto">${escapeHtml(c.manifesto || "No manifesto submitted.")}</p>
              </div>
            </div>
          `).join("") : `<div class="empty-state">No candidates vetted for this position yet.</div>`}
        </div>
      </div>
    `;
  }).join("");
}

(async function init() {
  loadAnnouncements();
  const election = await loadCurrentElection();
  renderElectionHero(election);
})();