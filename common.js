// Shared helpers

function showToast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

function statusLabel(status) {
  const map = { scheduled: "Scheduled", open: "Open now", closed: "Closed", completed: "Completed", pending: "Pending", approved: "Approved", rejected: "Rejected" };
  return map[status] || status;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
  });
}

// Renders a countdown into el, updating every second until targetIso.
// Calls onZero() once when it reaches zero.
function mountCountdown(el, targetIso, onZero) {
  const target = new Date(targetIso).getTime();
  function tick() {
    const diff = target - Date.now();
    if (diff <= 0) {
      el.innerHTML = "";
      if (onZero) onZero();
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.innerHTML = `
      <div class="cell"><div class="num">${d}</div><div class="label">Days</div></div>
      <div class="cell"><div class="num">${String(h).padStart(2,"0")}</div><div class="label">Hrs</div></div>
      <div class="cell"><div class="num">${String(m).padStart(2,"0")}</div><div class="label">Min</div></div>
      <div class="cell"><div class="num">${String(s).padStart(2,"0")}</div><div class="label">Sec</div></div>
    `;
    requestAnimationFrame(() => setTimeout(tick, 1000));
  }
  tick();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
