/* ==========================================================
   SEMS (SINOZAM ELECTIONS MANAGEMENT SYSTEM, formerly SinoVotes) — Candidate Self-Nomination Logic
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const electionTypeSelect = document.getElementById("election_type");
  const positionSelect = document.getElementById("position_id");
  const eizSection = document.getElementById("eiz-section");
  const receiptField = document.getElementById("receipt-field");
  const form = document.getElementById("nomination-form");

  // Read election ID dynamically from query string, fallback to default main election
  const params = new URLSearchParams(window.location.search);
  const DEFAULT_ELECTION_ID = params.get("election") || "e6689761-f5d2-4b56-9162-2a79dfd13196";

  // Helper for escaping unsafe string values in dropdowns
  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }

  // 1. Fetch positions from Supabase on load
  async function loadPositions() {
    positionSelect.innerHTML = `<option value="">Loading positions...</option>`;

    const { data: positions, error } = await supabaseClient
      .from("positions")
      .select("*")
      .eq("election_id", DEFAULT_ELECTION_ID)
      .order("display_order", { ascending: true });

    if (error || !positions || positions.length === 0) {
      console.error("Positions load error:", error);
      positionSelect.innerHTML = `<option value="">No positions available</option>`;
      return;
    }

    positionSelect.innerHTML = `<option value="">-- Select Position --</option>` +
      positions.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  }

  loadPositions();

  // 2. Toggle EIZ UI Block
  if (electionTypeSelect) {
    electionTypeSelect.addEventListener("change", (e) => {
      if (e.target.value === "EIZ") {
        if (eizSection) eizSection.style.display = "block";
      } else {
        if (eizSection) eizSection.style.display = "none";
        if (receiptField) receiptField.style.display = "none";
      }
    });
  }

  // 3. Toggle Payment Receipt Display
  const membershipRadios = document.querySelectorAll('input[name="membership_status"]');
  membershipRadios.forEach(radio => {
    radio.addEventListener("change", (e) => {
      if (receiptField) {
        receiptField.style.display = e.target.value === "recent" ? "block" : "none";
      }
    });
  });

  // 4. Submit Candidate Record (Queued as 'pending' for Admin Vetting)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting Nomination...";

    const fullName = document.getElementById("full_name").value.trim();
    const examNumber = document.getElementById("exam_number").value.trim();
    const program = document.getElementById("program").value.trim();
    const positionId = positionSelect.value;
    const manifesto = document.getElementById("manifesto").value.trim();
    
    const photoFileInput = document.getElementById("photo_file");
    const photoFile = photoFileInput && photoFileInput.files ? photoFileInput.files[0] : null;

    try {
      let headshotUrl = "";

      // Safe upload block for headshot photo
      if (photoFile) {
        const ext = photoFile.name.split('.').pop();
        const safeExamNumber = examNumber.replace(/[^a-zA-Z0-9]/g, '_');
        const path = `headshots/${Date.now()}_${safeExamNumber}.${ext}`;
        
        const { error: photoErr } = await supabaseClient
          .storage
          .from("candidate-photos")
          .upload(path, photoFile, { cacheControl: '3600', upsert: true });

        if (photoErr) throw photoErr;

        const { data } = supabaseClient.storage.from("candidate-photos").getPublicUrl(path);
        headshotUrl = data ? data.publicUrl : "";
      }

      // Insert record marked with 'pending' status for admin approval
      const { error: insertErr } = await supabaseClient
        .from("candidates")
        .insert([{
          position_id: positionId,
          full_name: fullName,
          manifesto: manifesto,
          photo_url: headshotUrl,
          course: program,
          status: "pending"
        }]);

      if (insertErr) throw insertErr;

      alert("Nomination submitted successfully! Your application has been sent to the Electoral Committee for vetting.");
      form.reset();
      window.location.href = "index.html";

    } catch (err) {
      console.error("Nomination Submission Error:", err);
      alert("Error submitting nomination: " + (err.message || "Please check database constraints or file uploads."));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Nomination";
    }
  });
});