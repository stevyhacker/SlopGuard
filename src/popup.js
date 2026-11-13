(async () => {
  const $ = (id) => document.getElementById(id);
  const s = await SlopSettings.load();
  const preset = SlopSettings.preset(s.model);
  const { stats } = await chrome.storage.local.get("stats");
  const today = new Date().toISOString().slice(0, 10);
  const st = stats?.day === today ? stats : { checked: 0, hidden: 0 };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabCount = tab ? (await chrome.runtime.sendMessage({ type: "getTabCount", tabId: tab.id }).catch(() => null))?.n || 0 : 0;

  $("enabled").checked = s.enabled;
  $("tab").textContent = tabCount;
  $("hidden").textContent = st.hidden;
  $("checked").textContent = st.checked;
  $("model").textContent = preset.label.replace(/\s*\(.*\)$/, "");
  $("threshold").textContent = Math.round(s.threshold * 100) + "%";
  const hasKey = !!s.keys[preset.key];
  const render = () => {
    $("state").textContent = !hasKey ? "Add an API key in Settings to start." :
      $("enabled").checked ? "Watching replies on X posts." : "Paused. Replies are shown as normal.";
  };
  render();
  $("enabled").addEventListener("change", async () => { await SlopSettings.save({ enabled: $("enabled").checked }); render(); });
  $("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
})();
