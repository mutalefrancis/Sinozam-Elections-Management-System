document.addEventListener("DOMContentLoaded", () => {
  const receiptInput = document.getElementById("receipt-input");
  const verifyBtn = document.getElementById("verify-btn");
  const resultDiv = document.getElementById("verify-result");

  // Automatically check if receipt parameter exists in the URL
  const params = new URLSearchParams(window.location.search);
  const urlReceipt = params.get("receipt");

  if (urlReceipt) {
    receiptInput.value = urlReceipt.trim();
    verifyReceipt(urlReceipt.trim());
  }

  verifyBtn.addEventListener("click", () => {
    const code = receiptInput.value.trim();
    if (!code) {
      showResult("error", "Please enter a receipt number.");
      return;
    }
    verifyReceipt(code);
  });

  receiptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") verifyBtn.click();
  });

  async function verifyReceipt(receiptCode) {
    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verifying…";
    resultDiv.innerHTML = "";

    try {
      // 1. Fetch receipt record from election_voters table
      const { data: voter, error: voterError } = await supabaseClient
        .from("election_voters")
        .select("election_id, voted_at, receipt_id")
        .eq("receipt_id", receiptCode)
        .maybeSingle();

      if (voterError) throw voterError;

      if (!voter) {
        showResult("invalid", "No recorded vote matches this receipt number. Please verify the code and try again.");
        return;
      }

      // 2. Fetch election title
      const { data: election } = await supabaseClient
        .from("elections")
        .select("title")
        .eq("id", voter.election_id)
        .single();

      const electionTitle = election ? election.title : "SEMS Election";
      const votedDate = voter.voted_at 
        ? new Date(voter.voted_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
        : "Recorded";

      // 3. Render valid status card
      showResult("valid", `
        <div style="background: var(--bg-soft, #f4f6f4); border: 1px solid var(--border-color, #dcdfdc); padding: 20px; border-radius: 8px;">
          <div style="color: #2e7d32; font-weight: 700; font-size: 1.1rem; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
            <span>✓</span> Valid Receipt Recorded
          </div>
          <p style="margin: 0 0 12px 0; color: var(--ink-soft, #555); font-size: 0.95rem;">
            This ballot was securely cast and recorded on the database.
          </p>
          <hr style="border: 0; border-top: 1px solid #e0e0e0; margin: 12px 0;" />
          <div style="font-size: 0.9rem; display: flex; flex-direction: column; gap: 6px;">
            <div><strong>Election:</strong> ${escapeHtml(electionTitle)}</div>
            <div><strong>Timestamp:</strong> ${escapeHtml(votedDate)}</div>
            <div><strong>Receipt Ref:</strong> <code>${escapeHtml(voter.receipt_id)}</code></div>
          </div>
        </div>
      `);

    } catch (err) {
      console.error("Verification error:", err);
      showResult("error", "An error occurred while verifying the receipt. Please try again.");
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = "Verify";
    }
  }

  function showResult(type, message) {
    if (type === "valid") {
      resultDiv.innerHTML = message;
    } else {
      const isError = type === "error";
      resultDiv.innerHTML = `
        <div style="padding: 14px 16px; border-radius: 6px; font-size: 0.95rem; background: ${isError ? "#fdeded" : "#fff8e1"}; color: ${isError ? "#5f2120" : "#5d4037"}; border: 1px solid ${isError ? "#f5c2c7" : "#ffe082"};">
          ${message}
        </div>
      `;
    }
  }
});