(async () => {
  const $ = (id) => document.getElementById(id);
  const KEY_INFO = {
    openrouter: { name: "OpenRouter", url: "https://openrouter.ai/settings/keys" },
    openai: { name: "OpenAI", url: "https://platform.openai.com/api-keys" },
    gemini: { name: "Google AI Studio", url: "https://aistudio.google.com/apikey" }
  };
  let s = await SlopSettings.load();

  for (const p of SlopSettings.PRESETS) {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.label + (p === SlopSettings.PRESETS[0] ? " (recommended)" : "");
    $("model").appendChild(o);
  }

  function renderModel() {
    const p = SlopSettings.preset($("model").value);
    const info = KEY_INFO[p.key];
    $("key").value = s.keys[p.key] || "";
    $("key").placeholder = `${info.name} API key`;
    $("keyNote").innerHTML = `Get one at <a href="${info.url}" target="_blank" rel="noopener">${info.url.replace("https://", "")}</a>.`;
    $("modelNote").textContent = p.note || "";
  }
  function renderThreshold() { $("thresholdLabel").textContent = $("threshold").value + "%"; }
  function renderTrusted() {
    $("trusted").innerHTML = "";
    if (!s.trusted.length) { $("trusted").innerHTML = '<li class="muted small">None yet.</li>'; return; }
    for (const h of s.trusted) {
      const li = document.createElement("li");
      li.textContent = "@" + h;
      const x = document.createElement("button");
      x.textContent = "×"; x.title = "Remove";
      x.addEventListener("click", async () => { s = await SlopSettings.save({ trusted: s.trusted.filter((t) => t !== h) }); renderTrusted(); });
      li.appendChild(x);
      $("trusted").appendChild(li);
    }
  }
  const flash = (msg, ok) => { $("status").textContent = msg; $("status").className = "small " + (ok ? "ok" : "err"); };

  $("model").value = SlopSettings.preset(s.model).id;
  $("threshold").value = Math.round(s.threshold * 100);
  document.querySelector(`input[name=scope][value=${s.scope}]`).checked = true;
  $("hideGrok").checked = s.hideGrok;
  renderModel(); renderThreshold(); renderTrusted();

  $("model").addEventListener("change", renderModel);
  $("threshold").addEventListener("input", renderThreshold);

  async function saveAll() {
    const p = SlopSettings.preset($("model").value);
    s = await SlopSettings.save({
      model: p.id,
      threshold: Number($("threshold").value) / 100,
      scope: document.querySelector("input[name=scope]:checked").value,
      hideGrok: $("hideGrok").checked,
      keys: { [p.key]: $("key").value.trim() }
    });
  }
  $("save").addEventListener("click", async () => { await saveAll(); flash("Saved. Reload X to apply to open tabs.", true); });
  for (const el of [$("threshold"), $("hideGrok"), ...document.querySelectorAll("input[name=scope]")]) el.addEventListener("change", saveAll);
  $("test").addEventListener("click", async () => {
    await saveAll();
    flash("Testing…", true);
    const r = await chrome.runtime.sendMessage({ type: "testConnection" });
    if (!r?.ok) return flash(r?.error || "No response", false);
    const [bot, human] = r.probs.map((p) => (p == null ? "?" : Math.round(p * 100) + "%"));
    flash(`Works (${r.ms} ms, ${r.model}). Sample bot reply: ${bot}, sample human reply: ${human}.`, true);
  });
  $("clear").addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "clearCache" }); flash("Cache cleared.", true); });
})();
