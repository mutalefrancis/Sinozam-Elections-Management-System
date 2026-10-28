const params = new URLSearchParams(location.search);
const electionId = params.get("election");

async function loadResults() {
  const container = document.getElementById("results-container");
  if (!electionId) {
    container.innerHTML = `<div class="empty-state">No election specified.</div>`;
    return;
  }

  const { data: election } = await supabaseClient.from("elections").select("*").eq("id", electionId).single();
  if (!election) {
    container.innerHTML = `<div class="empty-state">Election not found.</div>`;
    return;
  }

  document.getElementById("results-title").textContent = election.title;

  if (election.status !== "closed" && election.status !== "completed") {
    container.innerHTML = `<div class="empty-state">Results publish once voting closes. Check back after ${formatDateTime(election.end_time)}.</div>`;
    document.getElementById("turnout-voted").textContent = "—";
    document.getElementById("turnout-pct").textContent = "—";
    return;
  }

  const [{ data: results }, { data: turnout }] = await Promise.all([
    supabaseClient.rpc("get_results", { p_election_id: electionId }),
    supabaseClient.rpc("get_turnout", { p_election_id: electionId }),
  ]);

  if (turnout && turnout[0]) {
    const { eligible, voted } = turnout[0];
    document.getElementById("turnout-voted").textContent = voted;
    document.getElementById("turnout-pct").textContent = eligible > 0 ? Math.round((voted / eligible) * 100) + "%" : "—";
  }

  if (!results || results.length === 0) {
    container.innerHTML = `<div class="empty-state">No results to show.</div>`;
    return;
  }

  const byPosition = {};
  results.forEach(r => {
    byPosition[r.position_name] = byPosition[r.position_name] || [];
    byPosition[r.position_name].push(r);
  });

  container.innerHTML = Object.entries(byPosition).map(([posName, rows]) => {
    const total = rows.reduce((sum, r) => sum + Number(r.vote_count), 0);
    const maxVotes = Math.max(...rows.map(r => Number(r.vote_count)));
    return `
      <div class="position-block">
        <h2>${escapeHtml(posName)}</h2>
        ${rows.map(r => {
          const pct = total > 0 ? Math.round((Number(r.vote_count) / total) * 100) : 0;
          const isWinner = Number(r.vote_count) === maxVotes && maxVotes > 0;
          return `
            <div class="result-row ${isWinner ? "winner" : ""}">
              <div class="top">
                <span class="name">${escapeHtml(r.candidate_name)}</span>
                <span class="mono">${r.vote_count} votes · ${pct}%</span>
              </div>
              <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }).join("");
}

loadResults();
