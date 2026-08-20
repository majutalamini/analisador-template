// extension/background.js
// Makes clicking the toolbar icon open the persistent side panel
// instead of the old popup that closed on every outside click.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
